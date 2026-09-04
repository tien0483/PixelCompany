import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queryMocks = vi.hoisted(() => ({
	fetchRuntimeWorktrees: vi.fn(),
	cleanRuntimeMergedWorktrees: vi.fn(),
}));

vi.mock("@/runtime/runtime-config-query", () => queryMocks);

import { WorktreesDialog } from "@/components/git-inspector-dialogs";

function findButton(label: string): HTMLButtonElement | null {
	return (
		Array.from(document.querySelectorAll("button")).find(
			(button) => button.textContent?.trim() === label,
		) ?? null
	);
}

async function flush(): Promise<void> {
	await act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});
}

describe("git inspector dialogs", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		(
			globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT = true;
		queryMocks.fetchRuntimeWorktrees.mockReset();
		queryMocks.cleanRuntimeMergedWorktrees.mockReset();
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => root.unmount());
		vi.restoreAllMocks();
		container.remove();
	});

	it("lists worktrees and flags the main one", async () => {
		queryMocks.fetchRuntimeWorktrees.mockResolvedValue({
			ok: true,
			worktrees: [
				{
					path: "/repo",
					head: "a",
					branch: "main",
					isMain: true,
					isDetached: false,
					isBare: false,
				},
				{
					path: "/repo/wt",
					head: "b",
					branch: "feat",
					isMain: false,
					isDetached: false,
					isBare: false,
				},
			],
		});

		await act(async () => {
			root.render(
				<WorktreesDialog open onOpenChange={() => {}} workspaceId="ws-1" />,
			);
		});
		await flush();

		expect(queryMocks.fetchRuntimeWorktrees).toHaveBeenCalledWith("ws-1");
		expect(document.body.textContent).toContain("/repo/wt");
		expect(document.body.textContent).toContain("main");
	});

	it("shows an error when the worktree list fails", async () => {
		queryMocks.fetchRuntimeWorktrees.mockResolvedValue({
			ok: false,
			worktrees: [],
			error: "no repo",
		});

		await act(async () => {
			root.render(
				<WorktreesDialog open onOpenChange={() => {}} workspaceId="ws-1" />,
			);
		});
		await flush();

		expect(document.body.textContent).toContain("no repo");
	});

	// Conflict-resolution coverage moved with the dialog to
	// `components/conflicts/conflicts-dialog.test.tsx`.
});
