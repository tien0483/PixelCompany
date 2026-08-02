import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	CommitComposerDialog,
	PullRequestDialog,
} from "@/components/git-composer-dialogs";

function findButton(label: string): HTMLButtonElement | null {
	return (
		Array.from(document.querySelectorAll("button")).find(
			(button) => button.textContent?.trim() === label,
		) ?? null
	);
}

function setTextValue(
	el: HTMLInputElement | HTMLTextAreaElement,
	value: string,
): void {
	const proto =
		el instanceof HTMLTextAreaElement
			? HTMLTextAreaElement.prototype
			: HTMLInputElement.prototype;
	const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
	setter?.call(el, value);
	el.dispatchEvent(new Event("input", { bubbles: true }));
}

async function click(button: HTMLButtonElement | null): Promise<void> {
	await act(async () => {
		button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
	});
}

describe("git composer dialogs", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		(
			globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => root.unmount());
		vi.restoreAllMocks();
		container.remove();
	});

	it("disables Commit until a message is entered", async () => {
		await act(async () => {
			root.render(
				<CommitComposerDialog
					open
					onOpenChange={() => {}}
					changedFiles={2}
					onCommit={async () => true}
				/>,
			);
		});
		expect(findButton("Commit")?.disabled).toBe(true);

		const textarea = document.querySelector("textarea") as HTMLTextAreaElement;
		await act(async () => setTextValue(textarea, "fix bug"));
		expect(findButton("Commit")?.disabled).toBe(false);
	});

	it("commits the trimmed message and closes on success", async () => {
		const onCommit = vi.fn(async () => true);
		const onOpenChange = vi.fn();
		await act(async () => {
			root.render(
				<CommitComposerDialog
					open
					onOpenChange={onOpenChange}
					changedFiles={1}
					onCommit={onCommit}
				/>,
			);
		});
		const textarea = document.querySelector("textarea") as HTMLTextAreaElement;
		await act(async () => setTextValue(textarea, "  hello  "));
		await click(findButton("Commit"));

		expect(onCommit).toHaveBeenCalledWith("hello");
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});

	it("keeps the commit dialog open when the commit fails", async () => {
		const onOpenChange = vi.fn();
		await act(async () => {
			root.render(
				<CommitComposerDialog
					open
					onOpenChange={onOpenChange}
					changedFiles={1}
					onCommit={async () => false}
				/>,
			);
		});
		const textarea = document.querySelector("textarea") as HTMLTextAreaElement;
		await act(async () => setTextValue(textarea, "msg"));
		await click(findButton("Commit"));

		expect(onOpenChange).not.toHaveBeenCalledWith(false);
	});

	it("disables Create PR until a title is entered, then submits", async () => {
		const onCreate = vi.fn(async () => ({ ok: true, url: "https://pr" }));
		const onOpenChange = vi.fn();
		await act(async () => {
			root.render(
				<PullRequestDialog
					open
					onOpenChange={onOpenChange}
					onCreate={onCreate}
				/>,
			);
		});
		expect(findButton("Create PR")?.disabled).toBe(true);

		const title = document.querySelector("input") as HTMLInputElement;
		await act(async () => setTextValue(title, "My PR"));
		expect(findButton("Create PR")?.disabled).toBe(false);

		await click(findButton("Create PR"));
		expect(onCreate).toHaveBeenCalledWith("My PR", "", undefined);
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});
});
