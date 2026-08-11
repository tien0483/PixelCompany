import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PlanAiPromptBar, type PlanAiPromptBarProps } from "@/components/plan-editor/plan-ai-prompt-bar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { HTML_LABELS } from "@/html/html-labels";

describe("PlanAiPromptBar", () => {
	let container: HTMLDivElement;
	let root: Root;

	function render(props: Partial<PlanAiPromptBarProps> = {}): Promise<void> {
		const resolved: PlanAiPromptBarProps = {
			mode: "draft",
			status: "idle",
			onSubmit: vi.fn(),
			onCancel: vi.fn(),
			onAttachFile: vi.fn(),
			...props,
		};
		return act(async () => {
			root.render(
				<TooltipProvider>
					<PlanAiPromptBar {...resolved} />
				</TooltipProvider>,
			);
		});
	}

	function getInput(): HTMLInputElement {
		const input = container.querySelector('[data-testid="plan-ai-prompt-input"]');
		if (!(input instanceof HTMLInputElement)) {
			throw new Error("prompt input not found");
		}
		return input;
	}

	function getSubmit(): HTMLButtonElement {
		const button = container.querySelector('[data-testid="plan-ai-prompt-submit"]');
		if (!(button instanceof HTMLButtonElement)) {
			throw new Error("submit button not found");
		}
		return button;
	}

	function type(value: string): Promise<void> {
		const input = getInput();
		const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
		return act(async () => {
			setter?.call(input, value);
			input.dispatchEvent(new Event("input", { bubbles: true }));
		});
	}

	function pressKey(key: string, init: KeyboardEventInit = {}): Promise<void> {
		return act(async () => {
			getInput().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }));
		});
	}

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

	it("cannot submit an empty instruction", async () => {
		const onSubmit = vi.fn();
		await render({ onSubmit });

		expect(getSubmit().disabled).toBe(true);

		await type("   ");
		expect(getSubmit().disabled).toBe(true);

		await pressKey("Enter");
		expect(onSubmit).not.toHaveBeenCalled();
	});

	it("submits the trimmed instruction and clears the input", async () => {
		const onSubmit = vi.fn();
		await render({ onSubmit });
		await type("  draft a risks section  ");

		await act(async () => {
			getSubmit().click();
		});

		expect(onSubmit).toHaveBeenCalledWith("draft a risks section");
		expect(getInput().value).toBe("");
	});

	it("submits on Enter and on ⌘/Ctrl+Enter", async () => {
		const onSubmit = vi.fn();
		await render({ onSubmit });

		await type("one");
		await pressKey("Enter");
		await type("two");
		await pressKey("Enter", { metaKey: true });

		expect(onSubmit.mock.calls.map((call) => call[0])).toEqual(["one", "two"]);
	});

	it("clears the instruction on Escape without letting it close the editor", async () => {
		// `PlanEditorView` closes the plan on Escape from an ancestor's onKeyDown, so the
		// assertion that matters is that the bar's Escape never reaches such a handler.
		const onAncestorKeyDown = vi.fn();
		await act(async () => {
			root.render(
				<TooltipProvider>
					{/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: mirrors the editor's own container handler */}
					<div onKeyDown={onAncestorKeyDown}>
						<PlanAiPromptBar
							mode="draft"
							status="idle"
							onSubmit={vi.fn()}
							onCancel={vi.fn()}
							onAttachFile={vi.fn()}
						/>
					</div>
				</TooltipProvider>,
			);
		});
		await type("never mind");

		await pressKey("Escape");

		expect(getInput().value).toBe("");
		expect(onAncestorKeyDown).not.toHaveBeenCalled();
	});

	it("switches label and placeholder in edit mode", async () => {
		await render({ mode: "draft" });
		expect(getSubmit().textContent).toContain(HTML_LABELS.aiSubmit);
		expect(getInput().placeholder).toBe(HTML_LABELS.aiPlaceholder);

		await render({ mode: "edit" });
		expect(getSubmit().textContent).toContain(HTML_LABELS.aiSubmitSelection);
		expect(getInput().placeholder).toBe(HTML_LABELS.aiPlaceholderSelection);
	});

	it("turns into Stop while running and cancels instead of submitting", async () => {
		const onCancel = vi.fn();
		const onSubmit = vi.fn();
		await render({ status: "running", onCancel, onSubmit });

		expect(getSubmit().textContent).toContain(HTML_LABELS.aiStop);
		expect(getSubmit().disabled).toBe(false);
		expect(getInput().disabled).toBe(true);

		await act(async () => {
			getSubmit().click();
		});

		expect(onCancel).toHaveBeenCalledTimes(1);
		expect(onSubmit).not.toHaveBeenCalled();
	});

	it("hands a picked file to the attachment pipeline", async () => {
		const onAttachFile = vi.fn();
		await render({ onAttachFile });

		const fileInput = container.querySelector('input[type="file"]');
		if (!(fileInput instanceof HTMLInputElement)) {
			throw new Error("file input not found");
		}
		const file = new File(["png"], "shot.png", { type: "image/png" });
		Object.defineProperty(fileInput, "files", { value: [file], configurable: true });
		await act(async () => {
			fileInput.dispatchEvent(new Event("change", { bubbles: true }));
		});

		expect(onAttachFile).toHaveBeenCalledWith(file);
	});

	it("shows a stream error under the input", async () => {
		await render({ status: "error", error: "agent exited 1" });

		expect(container.textContent).toContain("agent exited 1");
	});
});
