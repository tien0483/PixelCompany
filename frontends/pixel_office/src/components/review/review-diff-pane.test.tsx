import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	type ReviewCommentDraftInput,
	ReviewDiffPane,
} from "@/components/review/review-diff-pane";
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
			onReachedEnd?: () => void;
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
					{...(overrides.onReachedEnd ? { onReachedEnd: overrides.onReachedEnd } : {})}
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

	it("advances once after dwelling at the bottom of the diff", async () => {
		vi.useFakeTimers();
		const onReachedEnd = vi.fn();
		await renderPane({ onReachedEnd });

		const scroller = scrollContainer();
		Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 900 });
		Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 300 });
		Object.defineProperty(scroller, "scrollTop", { configurable: true, writable: true, value: 600 });

		act(() => {
			scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
		});
		expect(onReachedEnd).not.toHaveBeenCalled();

		act(() => {
			vi.advanceTimersByTime(400);
		});
		expect(onReachedEnd).toHaveBeenCalledTimes(1);

		// Still at the bottom: further scroll events must not advance again.
		act(() => {
			scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
			vi.advanceTimersByTime(400);
		});
		expect(onReachedEnd).toHaveBeenCalledTimes(1);
	});

	it("does not advance from a file that is shorter than the viewport", async () => {
		vi.useFakeTimers();
		const onReachedEnd = vi.fn();
		await renderPane({ onReachedEnd });

		const scroller = scrollContainer();
		Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 300 });
		Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 300 });
		Object.defineProperty(scroller, "scrollTop", { configurable: true, writable: true, value: 0 });

		act(() => {
			scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
			vi.advanceTimersByTime(400);
		});
		expect(onReachedEnd).not.toHaveBeenCalled();
	});

	it("does not advance while a comment is being written", async () => {
		vi.useFakeTimers();
		const onReachedEnd = vi.fn();
		await renderPane({ onReachedEnd });

		await act(async () => {
			row("n-2", "right").dispatchEvent(mouseEvent("mousedown"));
			window.dispatchEvent(mouseEvent("mouseup"));
		});

		const scroller = scrollContainer();
		Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 900 });
		Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 300 });
		Object.defineProperty(scroller, "scrollTop", { configurable: true, writable: true, value: 600 });

		act(() => {
			scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
			vi.advanceTimersByTime(400);
		});
		expect(onReachedEnd).not.toHaveBeenCalled();
	});
});
