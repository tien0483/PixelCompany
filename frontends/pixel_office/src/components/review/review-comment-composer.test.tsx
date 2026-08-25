import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReviewCommentComposer } from "@/components/review/review-comment-composer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LocalStorageKey } from "@/storage/local-storage-store";

describe("ReviewCommentComposer", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		previousActEnvironment = (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
			true;
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
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

	async function renderComposer(
		overrides: { startLabel?: string; endLabel?: string; text?: string; onSave?: () => void } = {},
	): Promise<void> {
		await act(async () => {
			// The toolbar's tooltips need the provider every app root already mounts.
			root.render(
				<TooltipProvider>
					<ReviewCommentComposer
						path="src/pay.ts"
						startLabel={overrides.startLabel ?? "+26"}
						endLabel={overrides.endLabel ?? "+33"}
						text={overrides.text ?? ""}
						citedRuleIds={[]}
						onTextChange={() => {}}
						onRemoveCitation={() => {}}
						onCancel={() => {}}
						onSave={overrides.onSave ?? (() => {})}
					/>
				</TooltipProvider>,
			);
		});
	}

	function clickText(label: string): void {
		const button = Array.from(container.querySelectorAll("button")).find(
			(candidate) => candidate.textContent === label,
		);
		if (!button) {
			throw new Error(`No button labelled ${label}.`);
		}
		act(() => {
			button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
	}

	it("mounts the rich editor with its toolbar by default", async () => {
		await renderComposer();

		// The editor is a lazy chunk; awaiting the same import is what tells the test
		// the Suspense boundary is ready to flush.
		await import("@/components/review/review-comment-editor");
		await act(async () => {});
		expect(container.querySelector('[data-testid="review-comment-toolbar"]')).not.toBeNull();
		expect(container.querySelector("textarea")).toBeNull();
	});

	it("switches to a plain textarea and remembers the choice", async () => {
		await renderComposer();
		await import("@/components/review/review-comment-editor");
		await act(async () => {});

		clickText("Switch to plain text editing");

		expect(container.querySelector("textarea")).not.toBeNull();
		expect(window.localStorage.getItem(LocalStorageKey.ReviewCommentEditorMode)).toBe("plain");
	});

	it("opens plain when that is the stored preference", async () => {
		window.localStorage.setItem(LocalStorageKey.ReviewCommentEditorMode, "plain");
		await renderComposer();

		expect(container.querySelector("textarea")).not.toBeNull();
		expect(container.querySelector('[data-testid="review-comment-toolbar"]')).toBeNull();
	});

	it("labels a range with both ends and a single line with one", async () => {
		await renderComposer({ startLabel: "+26", endLabel: "+33" });
		expect(container.textContent).toContain("Commenting on lines");

		await renderComposer({ startLabel: "-7", endLabel: "-7" });
		expect(container.textContent).toContain("Commenting on line");
		expect(container.textContent).not.toContain("Commenting on lines");
	});

	it("refuses to save an empty note", async () => {
		const onSave = vi.fn();
		window.localStorage.setItem(LocalStorageKey.ReviewCommentEditorMode, "plain");
		await renderComposer({ onSave });

		clickText("Add to review");
		expect(onSave).not.toHaveBeenCalled();

		await renderComposer({ onSave, text: "Needs a guard clause." });
		clickText("Add to review");
		expect(onSave).toHaveBeenCalledTimes(1);
	});
});
