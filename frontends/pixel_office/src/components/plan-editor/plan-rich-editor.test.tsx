import type { Editor } from "@tiptap/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PlanRichEditor from "@/components/plan-editor/plan-rich-editor";
import { TooltipProvider } from "@/components/ui/tooltip";

function flush(): Promise<void> {
	return act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});
}

async function waitForRichEditor(container: HTMLDivElement): Promise<Element> {
	for (let attempt = 0; attempt < 40; attempt += 1) {
		const editorRoot = container.querySelector(
			'[data-testid="plan-rich-editor"]',
		);
		if (editorRoot) {
			return editorRoot;
		}
		await act(async () => {
			await new Promise((resolveWait) => setTimeout(resolveWait, 25));
		});
	}
	throw new Error("plan rich editor never mounted");
}

describe("PlanRichEditor", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(async () => {
		await act(async () => {
			root.unmount();
		});
		container.remove();
	});

	it("renders toolbar and propagates markdown edits via onChange", async () => {
		const onChange = vi.fn();
		const onInsertImage = vi.fn();
		let editorInstance: Editor | null = null;

		await act(async () => {
			root.render(
				<TooltipProvider>
					<PlanRichEditor
						content="# Roadmap\n"
						onChange={onChange}
						planId="plan-1"
						onInsertImage={onInsertImage}
						onEditorReady={(editor) => {
							editorInstance = editor;
						}}
					/>
				</TooltipProvider>,
			);
		});
		await flush();

		const editorRoot = await waitForRichEditor(container);
		expect(editorRoot).not.toBeNull();
		expect(container.querySelector("button")).not.toBeNull();
		expect(container.textContent).toMatch(/Roadmap/i);
		expect(editorInstance).not.toBeNull();

		await act(async () => {
			editorInstance?.commands.insertContent(" edited");
		});
		await flush();

		expect(onChange).toHaveBeenCalled();
		expect(
			onChange.mock.calls.some((call) => String(call[0]).includes("edited")),
		).toBe(true);
	});

	it("displays content that arrives after the editor has already mounted", async () => {
		const onChange = vi.fn();

		await act(async () => {
			root.render(
				<TooltipProvider>
					<PlanRichEditor
						content=""
						onChange={onChange}
						planId="plan-1"
						onInsertImage={vi.fn()}
					/>
				</TooltipProvider>,
			);
		});
		await flush();
		await waitForRichEditor(container);

		// Simulates the plan finishing its async load after the rich editor already
		// mounted with the initial empty content.
		await act(async () => {
			root.render(
				<TooltipProvider>
					<PlanRichEditor
						content="# Loaded content\n"
						onChange={onChange}
						planId="plan-1"
						onInsertImage={vi.fn()}
					/>
				</TooltipProvider>,
			);
		});
		await flush();

		expect(container.textContent).toMatch(/Loaded content/i);
	});
});
