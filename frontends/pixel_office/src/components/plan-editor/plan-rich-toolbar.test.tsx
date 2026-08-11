import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PlanRichToolbar } from "@/components/plan-editor/plan-rich-toolbar";
import { TooltipProvider } from "@/components/ui/tooltip";

function createMockEditor(overrides: {
	canUndo?: boolean;
	canRedo?: boolean;
	undo?: () => void;
	redo?: () => void;
} = {}) {
	const undo = overrides.undo ?? vi.fn();
	const redo = overrides.redo ?? vi.fn();
	const chainFocus = {
		undo: () => ({ run: undo }),
		redo: () => ({ run: redo }),
		toggleBold: () => ({ run: vi.fn() }),
		toggleItalic: () => ({ run: vi.fn() }),
		toggleStrike: () => ({ run: vi.fn() }),
		toggleBlockquote: () => ({ run: vi.fn() }),
		toggleCode: () => ({ run: vi.fn() }),
		toggleHeading: () => ({ run: vi.fn() }),
		toggleBulletList: () => ({ run: vi.fn() }),
		toggleOrderedList: () => ({ run: vi.fn() }),
		toggleHighlight: () => ({ run: vi.fn() }),
		setColor: () => ({ run: vi.fn() }),
		focus: () => chainFocus,
	};
	return {
		can: () => ({
			undo: () => overrides.canUndo ?? true,
			redo: () => overrides.canRedo ?? true,
		}),
		isActive: () => false,
		getAttributes: () => ({}),
		chain: () => ({
			focus: () => chainFocus,
		}),
		on: vi.fn(),
		off: vi.fn(),
	};
}

describe("PlanRichToolbar", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
	});

	it("invokes TipTap undo and redo from the toolbar", () => {
		const undo = vi.fn();
		const redo = vi.fn();
		const editor = createMockEditor({ canUndo: true, canRedo: true, undo, redo });

		act(() => {
			root.render(
				<TooltipProvider>
					<PlanRichToolbar
						editor={editor as never}
						showUndoRedo
						onInsertImage={() => {}}
					/>
				</TooltipProvider>,
			);
		});

		const undoButton = container.querySelector('[aria-label="Undo"]');
		const redoButton = container.querySelector('[aria-label="Redo"]');
		expect(undoButton).toBeInstanceOf(HTMLButtonElement);
		expect(redoButton).toBeInstanceOf(HTMLButtonElement);

		act(() => {
			(undoButton as HTMLButtonElement).click();
		});
		expect(undo).toHaveBeenCalledOnce();

		act(() => {
			(redoButton as HTMLButtonElement).click();
		});
		expect(redo).toHaveBeenCalledOnce();
	});

	it("disables undo and redo when the history stack cannot move", () => {
		const editor = createMockEditor({ canUndo: false, canRedo: false });

		act(() => {
			root.render(
				<TooltipProvider>
					<PlanRichToolbar
						editor={editor as never}
						showUndoRedo
						onInsertImage={() => {}}
					/>
				</TooltipProvider>,
			);
		});

		expect((container.querySelector('[aria-label="Undo"]') as HTMLButtonElement).disabled).toBe(true);
		expect((container.querySelector('[aria-label="Redo"]') as HTMLButtonElement).disabled).toBe(true);
	});

	it("omits undo and redo when the pane header owns them", () => {
		const editor = createMockEditor();

		act(() => {
			root.render(
				<TooltipProvider>
					<PlanRichToolbar
						editor={editor as never}
						showUndoRedo={false}
						onInsertImage={() => {}}
					/>
				</TooltipProvider>,
			);
		});

		expect(container.querySelector('[aria-label="Undo"]')).toBeNull();
		expect(container.querySelector('[aria-label="Redo"]')).toBeNull();
		// Formatting controls are untouched by the swap.
		expect(container.querySelector('[aria-label="Bold"]')).toBeInstanceOf(HTMLButtonElement);
	});
});
