import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	type ReviewCommentDraftInput,
	ReviewDiffPane,
} from "@/components/review/review-diff-pane";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DEEP_SCROLL_IDLE_RESET_MS } from "@/review/review-deep-scroll";
import type { ReviewTag, ReviewTagSection } from "@/review/review-tags";
import type { ReviewLineFocus, ReviewNavDirection } from "@/review/review-target";
import type { FullFileFetchResult } from "@/review/use-full-file-content";
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

/** The post-image of `FILE`. Lines 6-8 are past the hunk, so only a full file shows them. */
const CONTENT = [
	"const a = 1;",
	"const b = 2;",
	"const c = 3;",
	"const d = 4;",
	"const tail = 5;",
	"const extra = 6;",
	"const extra = 7;",
	"const extra = 8;",
	"",
].join("\n");

const OTHER_PATCH = ["@@ -1,1 +1,2 @@", " tax_a", "+tax_b", ""].join("\n");

const OTHER_FILE: RuntimeGitlabDiffFile = {
	...FILE,
	oldPath: "src/tax.ts",
	newPath: "src/tax.ts",
	diff: OTHER_PATCH,
	additions: 1,
	deletions: 0,
};

const OTHER_CONTENT = "tax_a\ntax_b\ntax_c\n";

/**
 * One addition, sixteen unchanged lines, one more addition. The run in the middle is
 * long enough (16 lines, three kept as context at each end) that `buildDisplayItems`
 * elides ten of them — which is what a draft anchored to new line 5 has to survive.
 */
const COLLAPSING_FILE: RuntimeGitlabDiffFile = {
	...FILE,
	oldPath: "src/long.ts",
	newPath: "src/long.ts",
	diff: [
		"@@ -1,16 +1,18 @@",
		"+const head = 0;",
		...Array.from({ length: 16 }, (_unused, index) => ` const keep${index + 1} = ${index + 1};`),
		"+const tail = 99;",
	].join("\n"),
	additions: 2,
	deletions: 0,
};

const SECTIONS: ReviewTagSection[] = [
	{
		id: "tags",
		title: "Tags",
		groups: [
			{
				title: "",
				tags: [
					{ kind: "builtin", label: "Security" },
					{ kind: "rule-category", label: "Naming" },
				],
			},
		],
	},
	{
		id: "smells",
		title: "Smells",
		groups: [{ title: "Couplers", tags: [{ kind: "smell", label: "Feature Envy" }] }],
	},
	{
		id: "refactorings",
		title: "Refactorings",
		groups: [{ title: "Composing Methods", tags: [{ kind: "refactoring", label: "Extract Method" }] }],
	},
];

/** React listens on the prototype setter, so a plain `input.value = …` is invisible to it. */
function setInputValue(input: HTMLInputElement, value: string): void {
	const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
	descriptor?.set?.call(input, value);
	input.dispatchEvent(new Event("input", { bubbles: true }));
}

function mouseEvent(type: string): MouseEvent {
	return new MouseEvent(type, { bubbles: true, cancelable: true });
}

/**
 * jsdom has no `DataTransfer`, so a real `DragEvent` arrives with `dataTransfer: null`
 * and the strip's handler would throw on it. The stub is the whole surface the handler
 * touches.
 */
function dragStartEvent(): Event {
	const event = new Event("dragstart", { bubbles: true, cancelable: true });
	Object.defineProperty(event, "dataTransfer", {
		value: { effectAllowed: "none", setData: () => {} },
	});
	return event;
}

/** The same stub for the receiving half of a drag: `dropEffect` is all the rows set. */
function tagDragEvent(type: "dragenter" | "dragover" | "drop"): Event {
	const event = new Event(type, { bubbles: true, cancelable: true });
	Object.defineProperty(event, "dataTransfer", { value: { dropEffect: "none", getData: () => "" } });
	// The scroll container measures itself on dragover; jsdom lays nothing out, so the
	// autoscroll ramp would read every edge as 0 away and scroll on every event.
	Object.defineProperty(event, "clientY", { value: 200 });
	return event;
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
			file?: RuntimeGitlabDiffFile;
			onAddDraft?: (draft: ReviewCommentDraftInput) => void;
			onNavigate?: (direction: ReviewNavDirection) => void;
			navTargets?: { previous: boolean; next: boolean };
			onFetchFullFile?: () => Promise<FullFileFetchResult>;
			lineFocus?: ReviewLineFocus | null;
			onTagDragStart?: (tag: ReviewTag) => void;
			/** A chip already in flight, which is what the drop handlers are gated on. */
			draggedTag?: ReviewTag;
			onAddAnnotation?: (input: {
				oldLine: number | null;
				newLine: number | null;
				lineRange?: { startOldLine: number | null; startNewLine: number | null };
			}) => void;
			/** Omitted entirely by default, which is how the standalone pane renders. */
			withTags?: boolean;
		} = {},
	): Promise<void> {
		const tagAnnotations = overrides.withTags
			? {
					annotations: [],
					sections: SECTIONS,
					draggedTag: overrides.draggedTag ?? null,
					currentHeadSha: null,
					onDragStart: overrides.onTagDragStart ?? (() => {}),
					onDragEnd: () => {},
					onAdd: overrides.onAddAnnotation ?? (() => {}),
					onRemove: () => {},
				}
			: undefined;
		await act(async () => {
			root.render(
				// The app mounts one provider per entry (main.tsx / main-review.tsx); a bare
				// render of the pane has to supply it for the chips' hover descriptions.
				<TooltipProvider>
				<ReviewDiffPane
					file={overrides.file ?? FILE}
					mode="unified"
					isReviewed={false}
					hasNewCommentsSinceReview={false}
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
					lineFocus={overrides.lineFocus ?? null}
					{...(overrides.onNavigate ? { onNavigate: overrides.onNavigate } : {})}
					{...(overrides.navTargets ? { navTargets: overrides.navTargets } : {})}
					{...(overrides.onFetchFullFile ? { onFetchFullFile: overrides.onFetchFullFile } : {})}
					{...(tagAnnotations ? { tagAnnotations } : {})}
				/>
				</TooltipProvider>,
			);
		});
	}

	/** Resolves the fetch effect the toggle kicks off, plus the render that follows it. */
	async function clickFullFile(): Promise<void> {
		const button = Array.from(container.querySelectorAll("button")).find((candidate) =>
			candidate.textContent?.includes("Full file"),
		);
		if (!button) {
			throw new Error("No Full file button in the header.");
		}
		await act(async () => {
			button.dispatchEvent(mouseEvent("click"));
		});
		await act(async () => {
			await Promise.resolve();
		});
	}

	function fetchOf(content: string): () => Promise<FullFileFetchResult> {
		return () => Promise.resolve({ content, error: null });
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

	function tagChip(label: string): HTMLButtonElement {
		const chip = Array.from(container.querySelectorAll("button")).find(
			(candidate) => candidate.draggable && candidate.textContent === label,
		);
		if (!chip) {
			throw new Error(`No draggable chip for ${label}.`);
		}
		return chip;
	}

	function tagStripToggle(title: string): HTMLButtonElement {
		const toggle = Array.from(container.querySelectorAll("button[aria-expanded]")).find((candidate) =>
			candidate.textContent?.includes(title),
		);
		if (!(toggle instanceof HTMLButtonElement)) {
			throw new Error(`No tag strip toggle for ${title}.`);
		}
		return toggle;
	}

	/** Opens the palette flyout off the diff's tag rail, on the section asked for. */
	async function openTagRail(sectionId: "tags" | "smells" | "refactorings"): Promise<void> {
		const button = container.querySelector(`[data-testid="review-tag-rail-${sectionId}"]`);
		if (!(button instanceof HTMLElement)) {
			throw new Error(`No tag rail button for ${sectionId}.`);
		}
		await act(async () => {
			button.dispatchEvent(mouseEvent("click"));
		});
	}

	it("renders no tag rail when the pane is given no annotation wiring", async () => {
		await renderPane();

		expect(container.querySelector('[data-testid="review-tag-rail-tags"]')).toBeNull();
		expect(container.querySelector("button[aria-expanded]")).toBeNull();
		expect(Array.from(container.querySelectorAll("button")).some((button) => button.draggable)).toBe(false);
	});

	it("keeps the palette off the diff until the rail is asked for", async () => {
		await renderPane({ withTags: true });

		// The rail is the whole cost of the palette until it is wanted: no flyout over the
		// rows, no chips, and nothing between the file toolbar and the first line.
		expect(container.querySelector('[data-testid="review-tag-rail-tags"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="review-tag-flyout"]')).toBeNull();
		expect(() => tagChip("Security")).toThrow();
	});

	it("renders every tag as a draggable chip in the rail's flyout", async () => {
		await renderPane({ withTags: true });
		await openTagRail("tags");

		expect(tagChip("Security")).toBeTruthy();
		expect(tagChip("Naming")).toBeTruthy();
		expect(tagStripToggle("Tags").textContent).toContain("(2)");
	});

	it("keeps the catalog sections closed until they are asked for", async () => {
		await renderPane({ withTags: true });
		await openTagRail("tags");

		// ~90 chips must not be what opening the curated tags puts over the diff.
		expect(tagStripToggle("Smells").getAttribute("aria-expanded")).toBe("false");
		expect(tagStripToggle("Refactorings").getAttribute("aria-expanded")).toBe("false");
		expect(() => tagChip("Feature Envy")).toThrow();
	});

	it("opens the catalog section the rail icon names", async () => {
		await renderPane({ withTags: true });
		await openTagRail("smells");

		expect(tagChip("Feature Envy")).toBeTruthy();
		expect(container.textContent).toContain("Couplers");
	});

	it("stands aside without unmounting, so the chip drag survives", async () => {
		await renderPane({ withTags: true });
		await openTagRail("tags");
		expect(container.querySelector('[data-testid="review-tag-flyout"]')).not.toBeNull();

		// A flyout wide enough for the catalog covers the rows the chip has to land on.
		await renderPane({ withTags: true, draggedTag: { kind: "builtin", label: "Security" } });

		const flyout = container.querySelector('[data-testid="review-tag-flyout"]');
		if (!(flyout instanceof HTMLElement)) {
			throw new Error("The flyout must stay mounted while a chip is in flight.");
		}
		expect(flyout.className).toContain("pointer-events-none");
		expect(flyout.className).toContain("opacity-0");
		expect(container.querySelector('[data-testid="review-tag-rail-tags"]')).not.toBeNull();
	});

	it("keeps the dragged chip in the document once the drag has been reported", async () => {
		// The browser cancels a drag whose source element leaves the document, and the chip
		// lives inside the flyout that gets out of the way — so the node standing aside
		// takes with it is the very thing the drop depends on. jsdom starts no real drag,
		// but it can hold the pane to the one property that made the feature work at all.
		await renderPane({ withTags: true });
		await openTagRail("tags");
		const chip = tagChip("Security");

		await act(async () => {
			chip.dispatchEvent(dragStartEvent());
		});
		await renderPane({ withTags: true, draggedTag: { kind: "builtin", label: "Security" } });

		expect(document.contains(chip)).toBe(true);
	});

	it("gives each chip its own color so a dragged tag is recognisable", async () => {
		await renderPane({ withTags: true });
		await openTagRail("tags");

		expect(tagChip("Security").className).toContain("status-red");
		expect(tagChip("Naming").className).not.toBe(tagChip("Security").className);
	});

	it("reports the tag a chip drag started on", async () => {
		const started: ReviewTag[] = [];
		await renderPane({ withTags: true, onTagDragStart: (tag) => started.push(tag) });
		await openTagRail("tags");

		await act(async () => {
			tagChip("Security").dispatchEvent(dragStartEvent());
		});

		expect(started).toEqual([{ kind: "builtin", label: "Security" }]);
	});

	it("drags a code smell once its section is open, and remembers the section", async () => {
		const started: ReviewTag[] = [];
		await renderPane({ withTags: true, onTagDragStart: (tag) => started.push(tag) });
		await openTagRail("tags");

		await act(async () => {
			tagStripToggle("Smells").dispatchEvent(mouseEvent("click"));
		});
		expect(window.localStorage.getItem(LocalStorageKey.ReviewSmellSectionExpanded)).toBe("true");
		expect(container.textContent).toContain("Couplers");

		await act(async () => {
			tagChip("Feature Envy").dispatchEvent(dragStartEvent());
		});

		expect(started).toEqual([{ kind: "smell", label: "Feature Envy" }]);
	});

	it("filters the open catalog sections", async () => {
		await renderPane({ withTags: true });
		await openTagRail("smells");

		const filter = container.querySelector('input[aria-label="Filter tags"]');
		if (!(filter instanceof HTMLInputElement)) {
			throw new Error("No tag filter input.");
		}
		await act(async () => {
			setInputValue(filter, "envy");
		});

		expect(tagChip("Feature Envy")).toBeTruthy();
		expect(() => tagChip("Security")).toThrow();
	});

	it("collapses a palette section and remembers it", async () => {
		await renderPane({ withTags: true });
		await openTagRail("tags");

		await act(async () => {
			tagStripToggle("Tags").dispatchEvent(mouseEvent("click"));
		});

		expect(Array.from(container.querySelectorAll("button")).some((button) => button.draggable)).toBe(false);
		expect(tagStripToggle("Tags").getAttribute("aria-expanded")).toBe("false");
		expect(window.localStorage.getItem(LocalStorageKey.ReviewTagStripExpanded)).toBe("false");
	});

	/**
	 * Drags a chip across the given rows and releases on the last one. `dragenter` and
	 * `dragover` both fire per row, as a browser does, so the head-reassert path is
	 * exercised too.
	 */
	async function dragTagAcross(rows: HTMLElement[]): Promise<void> {
		await act(async () => {
			for (const element of rows) {
				element.dispatchEvent(tagDragEvent("dragenter"));
				element.dispatchEvent(tagDragEvent("dragover"));
			}
		});
		const last = rows[rows.length - 1];
		if (!last) {
			throw new Error("A tag drag needs at least one row.");
		}
		await act(async () => {
			last.dispatchEvent(tagDragEvent("drop"));
		});
	}

	async function saveTagNote(note: string): Promise<void> {
		const input = Array.from(container.querySelectorAll("input")).find((candidate) =>
			candidate.placeholder.startsWith("Optional note"),
		);
		if (!input) {
			throw new Error("No pending-annotation note input.");
		}
		await act(async () => {
			setInputValue(input, note);
		});
		await act(async () => {
			input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
		});
	}

	const SMELL: ReviewTag = { kind: "smell", label: "Feature Envy" };

	it("marks a run that spans a hunk's additions and its deletion with one chip", async () => {
		const added: Array<{
			oldLine: number | null;
			newLine: number | null;
			lineRange?: { startOldLine: number | null; startNewLine: number | null };
		}> = [];
		await renderPane({ withTags: true, draggedTag: SMELL, onAddAnnotation: (input) => added.push(input) });

		// n-2/n-3/n-4 are additions and o-2 is the deletion after them: the exact pair a
		// GitLab range note may not span, and the reason the clamp had to go for tags.
		await dragTagAcross([row("n-2", "right"), row("n-3", "right"), row("n-4", "right"), row("o-2", "left")]);
		await saveTagNote("This whole rewrite envies the other object.");

		expect(added).toHaveLength(1);
		expect(added[0]).toMatchObject({
			// Filled from the last row that carries each number, so neither side is lost.
			oldLine: 2,
			newLine: 4,
			lineRange: { startOldLine: 2, startNewLine: 2 },
		});
	});

	it("highlights every row a chip drag has crossed, deletions included", async () => {
		await renderPane({ withTags: true, draggedTag: SMELL });

		await act(async () => {
			for (const element of [row("n-2", "right"), row("n-3", "right"), row("o-2", "left")]) {
				element.dispatchEvent(tagDragEvent("dragenter"));
			}
		});

		// Four, not three: the run is anchor-to-head, so n-4 is covered even though a fast
		// pointer never raised an event on it.
		expect(container.querySelectorAll(".kb-diff-row-drop-target")).toHaveLength(4);
		expect(row("n-4", "right").className).toContain("kb-diff-row-drop-target");
		expect(row("o-2", "left").className).toContain("kb-diff-row-drop-target");
	});

	it("tags a single line when the chip is dropped without crossing a row", async () => {
		const added: Array<{ newLine: number | null; lineRange?: unknown }> = [];
		await renderPane({ withTags: true, draggedTag: SMELL, onAddAnnotation: (input) => added.push(input) });

		await dragTagAcross([row("n-3", "right")]);
		await saveTagNote("");

		expect(added).toHaveLength(1);
		expect(added[0]?.newLine).toBe(3);
		// No range: a one-row run is the old click-to-tag, and must stay a single line.
		expect(added[0]?.lineRange).toBeUndefined();
	});

	it("clears the run when the chip leaves the diff without being dropped", async () => {
		await renderPane({ withTags: true, draggedTag: SMELL });

		await act(async () => {
			row("n-2", "right").dispatchEvent(tagDragEvent("dragenter"));
			row("n-3", "right").dispatchEvent(tagDragEvent("dragenter"));
		});
		expect(container.querySelectorAll(".kb-diff-row-drop-target")).toHaveLength(2);

		await act(async () => {
			scrollContainer().dispatchEvent(new Event("dragleave", { bubbles: true }));
		});

		expect(container.querySelectorAll(".kb-diff-row-drop-target")).toHaveLength(0);
	});

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

	it("anchors a note on an unchanged line with both of its line numbers", async () => {
		const drafts: ReviewCommentDraftInput[] = [];
		await renderPane({ onAddDraft: (draft) => drafts.push(draft) });

		// `c-3-5` is the hunk's trailing context: old-side 3, new-side 5. The post-image
		// number alone does not locate it in the pre-image, which is why GitLab wants both.
		await drag(row("c-3-5", "right"), []);
		await typeNote("Worth a comment on unchanged code.");
		await clickSave();

		expect(drafts[0]).toMatchObject({ newLine: 5, oldLine: 3 });
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

	describe("full file", () => {
		it("fills in the lines the patch elided", async () => {
			await renderPane({ onFetchFullFile: fetchOf(CONTENT) });

			expect(container.textContent).not.toContain("const extra = 6;");
			await clickFullFile();

			expect(container.textContent).toContain("const extra = 6;");
			expect(container.textContent).toContain("const extra = 8;");
			// The diff's own rows survive the splice rather than being replaced by plain text.
			expect(container.querySelector('[data-row-key="n-2"]')).not.toBeNull();
			expect(container.querySelector('[data-row-key="o-2"]')).not.toBeNull();
		});

		it("shows the file the reviewer is on, not the one they opened it on", async () => {
			// The reported bug: the content was fetched once and never invalidated, so
			// every file after the first rendered the first one's text.
			await renderPane({ onFetchFullFile: fetchOf(CONTENT) });
			await clickFullFile();
			expect(container.textContent).toContain("const extra = 6;");

			await renderPane({ file: OTHER_FILE, onFetchFullFile: fetchOf(OTHER_CONTENT) });
			await act(async () => {
				await Promise.resolve();
			});

			expect(container.textContent).toContain("tax_c");
			expect(container.textContent).not.toContain("const extra = 6;");
		});

		it("drops a fetch that resolves after the reviewer has moved on", async () => {
			let releaseFirst: (value: FullFileFetchResult) => void = () => {};
			await renderPane({
				onFetchFullFile: () =>
					new Promise<FullFileFetchResult>((resolve) => {
						releaseFirst = resolve;
					}),
			});
			await clickFullFile();

			await renderPane({ file: OTHER_FILE, onFetchFullFile: fetchOf(OTHER_CONTENT) });
			await act(async () => {
				releaseFirst({ content: CONTENT, error: null });
				await Promise.resolve();
			});

			expect(container.textContent).toContain("tax_c");
			expect(container.textContent).not.toContain("const extra = 6;");
		});

		it("makes a line outside the diff commentable, with both of its line numbers", async () => {
			const drafts: ReviewCommentDraftInput[] = [];
			await renderPane({ onAddDraft: (draft) => drafts.push(draft), onFetchFullFile: fetchOf(CONTENT) });
			await clickFullFile();

			// Post-image line 7, which the patch never mentions. GitLab cannot anchor a note
			// there from the new-side number alone.
			await drag(row("f-7", "right"), []);
			await typeNote("This helper is dead code now.");
			await clickSave();

			expect(drafts).toHaveLength(1);
			expect(drafts[0]).toMatchObject({ newPath: "src/pay.ts", newLine: 7, oldLine: 5 });
		});

		it("falls back to the diff when the fetched file does not match the patch", async () => {
			await renderPane({ onFetchFullFile: fetchOf("something\nelse\nentirely\n") });
			await clickFullFile();

			expect(container.textContent).toContain("does not line up with this diff");
			expect(container.textContent).toContain("const b = 2;");
			expect(container.textContent).not.toContain("entirely");
		});

		it("reports why the fetch failed instead of a single flat message", async () => {
			await renderPane({
				onFetchFullFile: () =>
					Promise.resolve({ content: null, error: "GitLab rejected the request (404): File Not Found" }),
			});
			await clickFullFile();

			expect(container.textContent).toContain("404");
			expect(container.textContent).toContain("File Not Found");
		});

		it("hides the toggle for a file with no post-image to fetch", async () => {
			const hasToggle = (): boolean =>
				Array.from(container.querySelectorAll("button")).some((button) =>
					button.textContent?.includes("Full file"),
				);

			await renderPane({ onFetchFullFile: fetchOf(CONTENT) });
			expect(hasToggle()).toBe(true);

			await renderPane({
				file: { ...FILE, deletedFile: true },
				onFetchFullFile: fetchOf(CONTENT),
			});
			expect(hasToggle()).toBe(false);

			await renderPane({ file: { ...FILE, binary: true }, onFetchFullFile: fetchOf(CONTENT) });
			expect(hasToggle()).toBe(false);
		});
	});

	describe("jumping to a line", () => {
		/** jsdom implements no layout and so no `scrollIntoView`; this records the calls. */
		let scrolledInto: HTMLElement[];

		beforeEach(() => {
			scrolledInto = [];
			Object.defineProperty(Element.prototype, "scrollIntoView", {
				configurable: true,
				writable: true,
				value: function scrollIntoView(this: HTMLElement): void {
					scrolledInto.push(this);
				},
			});
		});

		afterEach(() => {
			delete (Element.prototype as Partial<Element>).scrollIntoView;
		});

		function focus(overrides: Partial<ReviewLineFocus>): ReviewLineFocus {
			return { path: FILE.newPath, oldLine: null, newLine: null, nonce: 1, ...overrides };
		}

		it("scrolls to the post-image line a draft is anchored to", async () => {
			await renderPane({ lineFocus: focus({ newLine: 3 }) });

			expect(scrolledInto).toEqual([row("n-3", "right")]);
			expect(row("n-3", "right").className).toContain("kb-diff-row-focused");
		});

		it("scrolls to the pre-image line when the note is on a deleted one", async () => {
			await renderPane({ lineFocus: focus({ oldLine: 2 }) });

			expect(scrolledInto).toEqual([row("o-2", "left")]);
		});

		it("ignores a focus that names another file", async () => {
			await renderPane({ file: OTHER_FILE, lineFocus: focus({ newLine: 3 }) });

			expect(scrolledInto).toEqual([]);
		});

		it("scrolls again when the same draft is clicked twice", async () => {
			await renderPane({ lineFocus: focus({ newLine: 3, nonce: 1 }) });
			await renderPane({ lineFocus: focus({ newLine: 3, nonce: 1 }) });
			expect(scrolledInto).toHaveLength(1);

			await renderPane({ lineFocus: focus({ newLine: 3, nonce: 2 }) });
			expect(scrolledInto).toHaveLength(2);
		});

		it("reveals the collapsed context block hiding the line, then scrolls to it", async () => {
			await renderPane({
				file: COLLAPSING_FILE,
				lineFocus: { path: COLLAPSING_FILE.newPath, oldLine: 4, newLine: 5, nonce: 1 },
			});

			expect(container.textContent).toContain("const keep4 = 4;");
			expect(scrolledInto).toEqual([row("c-4-5", "right")]);
		});
	});
});
