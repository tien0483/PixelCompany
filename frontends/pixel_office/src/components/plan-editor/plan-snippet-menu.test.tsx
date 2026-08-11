import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PlanSnippetMenu } from "@/components/plan-editor/plan-snippet-menu";
import { TooltipProvider } from "@/components/ui/tooltip";

describe("PlanSnippetMenu", () => {
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

	function render(props: Partial<Parameters<typeof PlanSnippetMenu>[0]> = {}): void {
		act(() => {
			root.render(
				<TooltipProvider>
					<PlanSnippetMenu onCommand={props.onCommand ?? (() => {})} disabled={props.disabled} />
				</TooltipProvider>,
			);
		});
	}

	it("renders a closed trigger", () => {
		render();
		const trigger = container.querySelector('[data-testid="plan-editor-snippet-menu"]');
		expect(trigger).toBeInstanceOf(HTMLButtonElement);
		expect((trigger as HTMLButtonElement).getAttribute("aria-expanded")).toBe("false");
		// Items live in a portal and only mount once open.
		expect(document.querySelector('[data-testid="plan-snippet-item-table"]')).toBeNull();
	});

	it("propagates disabled to the trigger", () => {
		render({ disabled: true });
		const trigger = container.querySelector('[data-testid="plan-editor-snippet-menu"]') as HTMLButtonElement;
		expect(trigger.disabled).toBe(true);
	});

	it("does not run a command until an item is picked", () => {
		const onCommand = vi.fn();
		render({ onCommand });
		expect(onCommand).not.toHaveBeenCalled();
	});

	it("inserts the picked snippet as its own block", () => {
		const onCommand = vi.fn();
		render({ onCommand });

		const trigger = container.querySelector('[data-testid="plan-editor-snippet-menu"]') as HTMLButtonElement;
		act(() => {
			trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
		});

		const item = document.querySelector('[data-testid="plan-snippet-item-table"]');
		expect(item).toBeInstanceOf(HTMLElement);
		act(() => {
			(item as HTMLElement).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
		});

		expect(onCommand).toHaveBeenCalledOnce();
		const transform = onCommand.mock.calls[0]?.[0] as (state: {
			value: string;
			selectionStart: number;
			selectionEnd: number;
		}) => { value: string };
		const next = transform({ value: "Intro", selectionStart: 5, selectionEnd: 5 });
		expect(next.value).toBe(
			[
				"Intro",
				"",
				"| Column | Column | Column |",
				"| ------ | ------ | ------ |",
				"|        |        |        |",
				"|        |        |        |",
				"",
			].join("\n"),
		);
	});
});
