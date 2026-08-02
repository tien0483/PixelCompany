import { act } from "react";
import type { ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GitRefsPanel } from "@/components/git-history/git-refs-panel";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { RuntimeGitRef } from "@/runtime/types";

let container: HTMLDivElement;
let root: Root;

function renderUi(element: ReactElement): void {
	root.render(<TooltipProvider>{element}</TooltipProvider>);
}

const HEAD_BRANCH: RuntimeGitRef = { name: "master", type: "branch", hash: "aaaa", isHead: true };
const FEATURE_BRANCH: RuntimeGitRef = { name: "feature/login", type: "branch", hash: "bbbb", isHead: false };

function findBranchRow(branchName: string): HTMLElement {
	const row = Array.from(container.querySelectorAll<HTMLElement>(".kb-git-ref-row")).find((element) =>
		element.textContent?.includes(branchName),
	);
	expect(row, `expected a branch row for "${branchName}"`).toBeTruthy();
	return row as HTMLElement;
}

function rightClick(row: HTMLElement): void {
	act(() => {
		row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 20 }));
	});
}

function menuItemLabels(): string[] {
	return Array.from(container.querySelectorAll('[role="menuitem"]')).map((item) => item.textContent ?? "");
}

function clickMenuItem(labelFragment: string): void {
	const item = Array.from(container.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((element) =>
		element.textContent?.includes(labelFragment),
	);
	expect(item, `expected a menu item containing "${labelFragment}"`).toBeTruthy();
	act(() => {
		item!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
	});
}

// The create-branch dialog uses the Radix Dialog primitive, which portals its
// content into document.body — so query the whole document, not `container`.
function getNewBranchInput(): HTMLInputElement {
	const input = document.querySelector<HTMLInputElement>('input[aria-label="New branch name"]');
	expect(input, "expected the new branch name input").toBeTruthy();
	return input as HTMLInputElement;
}

function typeInto(input: HTMLInputElement, value: string): void {
	const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
	act(() => {
		setValue?.call(input, value);
		input.dispatchEvent(new Event("input", { bubbles: true }));
	});
}

function clickDocumentButton(labelFragment: string): void {
	const button = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((element) =>
		element.textContent?.includes(labelFragment),
	);
	expect(button, `expected a button containing "${labelFragment}"`).toBeTruthy();
	act(() => {
		button!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
	});
}

beforeEach(() => {
	(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(() => {
	act(() => root.unmount());
	container.remove();
	vi.clearAllMocks();
});

describe("GitRefsPanel branch context menu", () => {
	// Regression: right-clicking the checked-out (HEAD) branch — typically "master" —
	// must open the context menu. When a repo is on master with only remote branches,
	// the head row is the only local branch row, so a missing handler here means the
	// menu never pops up at all.
	it("opens the context menu when right-clicking the checked-out (HEAD) branch row", () => {
		act(() => {
			renderUi(
				<GitRefsPanel
					refs={[HEAD_BRANCH]}
					selectedRefName="master"
					isLoading={false}
					panelWidth={240}
					workingCopyChanges={null}
					onSelectRef={() => undefined}
					onCheckoutRef={() => undefined}
					onDeleteRef={() => undefined}
				/>,
			);
		});

		expect(container.querySelector('[role="menu"]')).toBeNull();

		rightClick(findBranchRow("master"));

		expect(container.querySelector('[role="menu"]')).not.toBeNull();
		const labels = menuItemLabels();
		expect(labels.some((label) => label.includes("Switch to branch"))).toBe(true);
		expect(labels.some((label) => label.includes("Delete branch"))).toBe(true);
	});

	it("opens the context menu when right-clicking a non-HEAD local branch row", () => {
		act(() => {
			renderUi(
				<GitRefsPanel
					refs={[HEAD_BRANCH, FEATURE_BRANCH]}
					selectedRefName="master"
					isLoading={false}
					panelWidth={240}
					workingCopyChanges={null}
					onSelectRef={() => undefined}
					onCheckoutRef={() => undefined}
					onDeleteRef={() => undefined}
				/>,
			);
		});

		rightClick(findBranchRow("feature/login"));

		expect(container.querySelector('[role="menu"]')).not.toBeNull();
		const labels = menuItemLabels();
		expect(labels.some((label) => label.includes("Switch to branch"))).toBe(true);
		expect(labels.some((label) => label.includes("Delete branch"))).toBe(true);
	});

	it("invokes onCheckoutRef with the branch name when choosing Switch to branch", () => {
		const onCheckoutRef = vi.fn();
		act(() => {
			renderUi(
				<GitRefsPanel
					refs={[HEAD_BRANCH, FEATURE_BRANCH]}
					selectedRefName="master"
					isLoading={false}
					panelWidth={240}
					workingCopyChanges={null}
					onSelectRef={() => undefined}
					onCheckoutRef={onCheckoutRef}
					onDeleteRef={() => undefined}
				/>,
			);
		});

		rightClick(findBranchRow("feature/login"));

		const switchItem = Array.from(container.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((item) =>
			item.textContent?.includes("Switch to branch"),
		);
		expect(switchItem).toBeTruthy();
		act(() => {
			switchItem!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
		});

		expect(onCheckoutRef).toHaveBeenCalledWith("feature/login");
		expect(container.querySelector('[role="menu"]')).toBeNull();
	});

	it("shows a 'New branch from' item and creates a branch from the right-clicked ref", () => {
		const onCreateBranch = vi.fn();
		act(() => {
			renderUi(
				<GitRefsPanel
					refs={[HEAD_BRANCH, FEATURE_BRANCH]}
					selectedRefName="master"
					isLoading={false}
					panelWidth={240}
					workingCopyChanges={null}
					onSelectRef={() => undefined}
					onCheckoutRef={() => undefined}
					onDeleteRef={() => undefined}
					onCreateBranch={onCreateBranch}
				/>,
			);
		});

		rightClick(findBranchRow("master"));

		const labels = menuItemLabels();
		expect(labels.some((label) => label.includes("New branch from master"))).toBe(true);

		// Opening the create dialog closes the context menu.
		clickMenuItem("New branch from master");
		expect(container.querySelector('[role="menu"]')).toBeNull();

		const input = getNewBranchInput();
		typeInto(input, "release/1.0");

		clickDocumentButton("Create Branch");

		// Confirming calls the handler with the typed name and the ref as start point.
		expect(onCreateBranch).toHaveBeenCalledWith("release/1.0", "master");
		// The dialog closes after a successful create.
		expect(document.querySelector('input[aria-label="New branch name"]')).toBeNull();
	});
});
