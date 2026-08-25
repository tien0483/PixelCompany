import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	type ReviewCommentDraftInput,
	ReviewDiffPane,
} from "@/components/review/review-diff-pane";
import { DEEP_SCROLL_IDLE_RESET_MS } from "@/review/review-deep-scroll";
import type { ReviewNavDirection } from "@/review/review-target";
import { LocalStorageKey } from "@/storage/local-storage-store";
import type { RuntimeGitlabDiffFile } from "@/runtime/types";

/**
 * Rows, in patch order: context(new 1), added(2), added(3), added(4), removed(old 2),
 * context(new 5). The removed row between the additions and the trailing context is
 * what makes the contiguity clamp observable.
 */
const PATCH = [
	"@@ -1,3 +1,5 @@",
	" const a = 1;",
	"+const b = 2;",
	"+const c = 3;",
	"+const d = 4;",
	"-const old = 2;",
	" const tail = 5;",
].join("\n");

const FILE: RuntimeGitlabDiffFile = {
	oldPath: "src/pay.ts",
	newPath: "src/pay.ts",
	newFile: false,
	renamedFile: false,
	deletedFile: false,
	diff: PATCH,
	binary: false,
	additions: 3,
	deletions: 1,
	tooLarge: false,
};

function mouseEvent(type: string): MouseEvent {
	return new MouseEvent(type, { bubbles: true, cancelable: true });
}

describe("ReviewDiffPane", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		previousActEnvironment = (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
			true;
		// Plain mode keeps the composer synchronous: the rich editor is a lazy TipTap chunk.
		window.localStorage.setItem(LocalStorageKey.ReviewCommentEditorMode, "plain");
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		vi.useRealTimers();
		vi.restoreAllMocks();
		window.localStorage.clear();
		container.remove();
		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
				.IS_REACT_ACT_ENVIRONMENT;
		} else {
			(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
				previousActEnvironment;
		}
	});

	async function renderPane(
		overrides: {
			onAddDraft?: (draft: ReviewCommentDraftInput) => void;
			onNavigate?: (direction: ReviewNavDirection) => void;
			navTargets?: { previous: boolean; next: boolean };
		} = {},
	): Promise<void> {
		await act(async () => {
			root.render(
				<ReviewDiffPane
					file={FILE}
					mode="unified"
					isReviewed={false}
					draftComments={[]}
					discussions={[]}
					pendingCitations={[]}
					deltaBanner={null}
					onModeChange={() => {}}
					onToggleReviewed={() => {}}
					onAddDraft={overrides.onAddDraft ?? (() => {})}
					onRemoveDraft={() => {}}
					onComposerOpenChange={() => {}}
					onClearCitations={() => {}}
					onRemoveCitation={() => {}}
					{...(overrides.onNavigate ? { onNavigate: overrides.onNavigate } : {})}
					{...(overrides.navTargets ? { navTargets: overrides.navTargets } : {})}
				/>,
			);
		});
	}

	function row(rowKey: string, side: "left" | "right"): HTMLElement {
		const element = container.querySelector(`[data-row-key="${rowKey}"][data-diff-side="${side}"]`);
		if (!(element instanceof HTMLElement)) {
			throw new Error(`No ${side}-side row for ${rowKey}.`);
		}
		return element;
	}

	function scrollContainer(): HTMLElement {
		const element = container.querySelector('[data-testid="review-diff-scroll"]');
		if (!(element instanceof HTMLElement)) {
			throw new Error("No diff scroll container.");
		}
		return element;
	}

	/** jsdom never lays anything out, so the scroll geometry has to be asserted onto the node. */
	function setScrollMetrics(
		element: HTMLElement,
		metrics: { scrollHeight: number; clientHeight: number; scrollTop: number },
	): void {
		Object.defineProperty(element, "scrollHeight", { configurable: true, value: metrics.scrollHeight });
		Object.defineProperty(element, "clientHeight", { configurable: true, value: metrics.clientHeight });
		Object.defineProperty(element, "scrollTop", {
			configurable: true,
			writable: true,
			value: metrics.scrollTop,
		});
	}

	/** A hard flick: ticks close enough together to be one gesture, and well past the threshold. */
	function wheelBurst(element: HTMLElement, deltaY: number, ticks = 8): void {
		act(() => {
			for (let index = 0; index < ticks; index += 1) {
				element.dispatchEvent(new WheelEvent("wheel", { deltaY, deltaMode: 0, bubbles: true }));
			}
		});
	}

	function navButton(label: "Prev" | "Next"): HTMLButtonElement {
		const button = Array.from(container.querySelectorAll("button")).find(
			(candidate) => candidate.textContent === label,
		);
		if (!button) {
			throw new Error(`No ${label} button in the header.`);
		}
		return button;
	}

	/**
	 * Writes into the composer. React's value tracker swallows a plain `.value =`
	 * assignment, so the prototype setter is the only way to make `onChange` fire.
	 */
	async function typeNote(text: string): Promise<void> {
		const textarea = container.querySelector("textarea");
		if (!(textarea instanceof HTMLTextAreaElement)) {
			throw new Error("No composer textarea.");
		}
		const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
		await act(async () => {
			setValue?.call(textarea, text);
			textarea.dispatchEvent(new Event("input", { bubbles: true }));
		});
	}

	async function clickSave(): Promise<void> {
		const save = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent === "Add to review",
		);
		if (!save) {
			throw new Error("No save button in the composer.");
		}
		await act(async () => {
			save.dispatchEvent(mouseEvent("click"));
		});
	}

	/** React derives onMouseEnter from native mouseover, so a raw mouseenter is ignored. */
	async function drag(from: HTMLElement, over: HTMLElement[]): Promise<void> {
		await act(async () => {
			from.dispatchEvent(mouseEvent("mousedown"));
		});
		for (const target of over) {
			await act(async () => {
				target.dispatchEvent(mouseEvent("mouseover"));
			});
		}
		await act(async () => {
			window.dispatchEvent(mouseEvent("mouseup"));
		});
	}

	it("opens the composer for the run a drag covers", async () => {
		await renderPane();

		await drag(row("n-2", "right"), [row("n-3", "right"), row("n-4", "right")]);

		expect(container.textContent).toContain("Commenting on lines");
		expect(container.textContent).toContain("+2");
		expect(container.textContent).toContain("+4");
		expect(container.querySelectorAll(".kb-diff-row-selected")).toHaveLength(3);
	});

	it("saves a dragged run as one draft anchored to the end line", async () => {
		const drafts: ReviewCommentDraftInput[] = [];
		await renderPane({ onAddDraft: (draft) => drafts.push(draft) });

		await drag(row("n-2", "right"), [row("n-4", "right")]);
		await typeNote("This retry loop never terminates.");
		await clickSave();

		expect(drafts).toHaveLength(1);
		expect(drafts[0]).toMatchObject({
			newPath: "src/pay.ts",
			newLine: 4,
			oldLine: null,
			lineRange: { startOldLine: null, startNewLine: 2 },
		});
	});

	it("clamps a drag at the first row that is not commentable on its side", async () => {
		const drafts: ReviewCommentDraftInput[] = [];
		await renderPane({ onAddDraft: (draft) => drafts.push(draft) });

		// The trailing context row is commentable on the right, but a removed row sits
		// between it and the additions — the run must stop there.
		await drag(row("n-2", "right"), [row("c-3-5", "right")]);
		await typeNote("note");
		await clickSave();

		expect(drafts[0]).toMatchObject({ newLine: 4, lineRange: { startNewLine: 2 } });
	});

	it("never combines the two sides of the diff into one range", async () => {
		await renderPane();

		await drag(row("n-3", "right"), [row("o-2", "left")]);

		// A single-line note, not a range: the pointer left the side it started on.
		expect(container.textContent).toContain("Commenting on line");
		expect(container.textContent).not.toContain("Commenting on lines");
		expect(container.querySelectorAll(".kb-diff-row-selected")).toHaveLength(1);
	});

	it("keeps click-to-comment working as a one-line range", async () => {
		await renderPane();

		await drag(row("o-2", "left"), []);

		expect(container.textContent).toContain("Commenting on line");
		expect(container.textContent).toContain("-2");
	});

	it("never navigates from a gesture that started mid-file, however far its momentum runs", async () => {
		vi.useFakeTimers();
		const onNavigate = vi.fn();
		await renderPane({ onNavigate });

		// The inertia cascade: one flick from the middle of a long diff that reaches the
		// bottom and keeps delivering deltas. The gesture was disqualified at its first tick.
		const scroller = scrollContainer();
		setScrollMetrics(scroller, { scrollHeight: 900, clientHeight: 300, scrollTop: 400 });
		wheelBurst(scroller, 120, 1);
		scroller.scrollTop = 600;
		wheelBurst(scroller, 120, 20);

		expect(onNavigate).not.toHaveBeenCalled();
	});

	it("never navigates from being parked at the bottom of a long diff", async () => {
		vi.useFakeTimers();
		const onNavigate = vi.fn();
		await renderPane({ onNavigate });

		// No wheel at all: position plus time used to be enough, via a dwell timer.
		const scroller = scrollContainer();
		setScrollMetrics(scroller, { scrollHeight: 900, clientHeight: 300, scrollTop: 600 });
		act(() => {
			scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
			vi.advanceTimersByTime(5_000);
		});

		expect(onNavigate).not.toHaveBeenCalled();
	});

	it("navigates once, not once per tick, from a fresh gesture at the bottom", async () => {
		vi.useFakeTimers();
		const onNavigate = vi.fn();
		await renderPane({ onNavigate });

		const scroller = scrollContainer();
		setScrollMetrics(scroller, { scrollHeight: 900, clientHeight: 300, scrollTop: 600 });
		wheelBurst(scroller, 120);

		expect(onNavigate.mock.calls).toEqual([["next"]]);
	});

	it("navigates both ways on a file with no scroll room", async () => {
		vi.useFakeTimers();
		const onNavigate = vi.fn();
		await renderPane({ onNavigate });

		// Both edges at once — the only navigation signal a non-overflowing diff can give.
		const scroller = scrollContainer();
		setScrollMetrics(scroller, { scrollHeight: 300, clientHeight: 300, scrollTop: 0 });
		wheelBurst(scroller, 120);
		act(() => {
			vi.advanceTimersByTime(DEEP_SCROLL_IDLE_RESET_MS + 50);
		});
		wheelBurst(scroller, -120);

		expect(onNavigate.mock.calls).toEqual([["next"], ["previous"]]);
	});

	it("does not navigate while a comment composer is open", async () => {
		const onNavigate = vi.fn();
		await renderPane({ onNavigate });

		await drag(row("o-2", "left"), []);
		const scroller = scrollContainer();
		setScrollMetrics(scroller, { scrollHeight: 900, clientHeight: 300, scrollTop: 600 });
		wheelBurst(scroller, 120);

		expect(onNavigate).not.toHaveBeenCalled();
	});

	it("navigates each way from the header buttons", async () => {
		const onNavigate = vi.fn();
		await renderPane({ onNavigate });

		await act(async () => {
			navButton("Next").dispatchEvent(mouseEvent("click"));
		});
		await act(async () => {
			navButton("Prev").dispatchEvent(mouseEvent("click"));
		});

		expect(onNavigate.mock.calls).toEqual([["next"], ["previous"]]);
	});

	it("disables the button for a direction with nothing left to read", async () => {
		await renderPane({ onNavigate: () => {}, navTargets: { previous: false, next: true } });

		expect(navButton("Prev").disabled).toBe(true);
		expect(navButton("Next").disabled).toBe(false);
	});

	it("omits the navigation buttons when the host does not handle navigation", async () => {
		await renderPane();

		expect(
			Array.from(container.querySelectorAll("button")).map((button) => button.textContent),
		).not.toContain("Next");
	});
});
