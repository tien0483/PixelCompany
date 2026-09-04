import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queryMocks = vi.hoisted(() => ({
	fetchRuntimeConflictState: vi.fn(),
	fetchRuntimeMergeConflicts: vi.fn(),
	resolveRuntimeMergeConflict: vi.fn(),
	continueRuntimeConflictOperation: vi.fn(),
	abortRuntimeConflictOperation: vi.fn(),
	skipRuntimeRebaseCommit: vi.fn(),
}));

vi.mock("@/runtime/runtime-config-query", () => queryMocks);

import { ConflictsDialog } from "@/components/conflicts/conflicts-dialog";

const WORKTREE = "/repo/.worktrees/task-1";

function conflictFile(overrides: Record<string, unknown> = {}) {
	return {
		path: "a.ts",
		base: "base\n",
		ours: "line1\nOURS\nline3\n",
		theirs: "line1\nTHEIRS\nline3\n",
		merged: "line1\n<<<<<<< HEAD\nOURS\n=======\nTHEIRS\n>>>>>>> topic\nline3\n",
		binary: false,
		contentOmitted: false,
		...overrides,
	};
}

function stoppedState(operation = "merge", conflictedPaths = ["a.ts"]) {
	return {
		ok: true,
		worktrees: [
			{
				worktreePath: WORKTREE,
				branch: "main",
				operation,
				conflictedPaths,
				autostashHeld: false,
				isConflictWorktree: false,
			},
		],
	};
}

function findButton(label: string): HTMLButtonElement | null {
	return (
		Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.trim() === label) ?? null
	);
}

/**
 * React installs its own `value` setter on the element, so assigning `.value`
 * directly leaves its internal tracker thinking nothing changed and `onChange`
 * never fires. Going through the prototype setter is what makes the event real.
 */
function typeIntoTextarea(textarea: HTMLTextAreaElement, value: string): void {
	const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
	setter?.call(textarea, value);
	textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

async function flush(): Promise<void> {
	await act(async () => {
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
	});
}

describe("ConflictsDialog", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		for (const mock of Object.values(queryMocks)) mock.mockReset();
		queryMocks.resolveRuntimeMergeConflict.mockResolvedValue({ ok: true, summary: {}, output: "" });
		queryMocks.continueRuntimeConflictOperation.mockResolvedValue({
			ok: true,
			summary: {},
			output: "",
			conflictState: null,
		});
		queryMocks.abortRuntimeConflictOperation.mockResolvedValue({
			ok: true,
			summary: {},
			output: "",
			conflictState: null,
		});
		queryMocks.skipRuntimeRebaseCommit.mockResolvedValue({
			ok: true,
			summary: {},
			output: "",
			conflictState: null,
		});
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => root.unmount());
		vi.restoreAllMocks();
		container.remove();
	});

	async function render(onResolved = vi.fn()): Promise<void> {
		await act(async () => {
			root.render(
				<ConflictsDialog open onOpenChange={() => {}} workspaceId="ws-1" onResolved={onResolved} />,
			);
		});
		await flush();
	}

	it("reads conflicts from the worktree that is actually stopped, not the workspace path", async () => {
		queryMocks.fetchRuntimeConflictState.mockResolvedValue(stoppedState());
		queryMocks.fetchRuntimeMergeConflicts.mockResolvedValue({
			ok: true,
			conflicts: [conflictFile()],
			operation: "merge",
			worktreePath: WORKTREE,
			autostashHeld: false,
		});

		await render();

		// The old dialog sent `null` here, which always meant the home repo.
		expect(queryMocks.fetchRuntimeMergeConflicts).toHaveBeenCalledWith("ws-1", { worktreePath: WORKTREE });
		expect(document.body.textContent).toContain("a.ts");
		expect(document.body.textContent).toContain("Merge in progress");
	});

	it("seeds the editable pane from the marker file and saves it as a manual resolution", async () => {
		queryMocks.fetchRuntimeConflictState.mockResolvedValue(stoppedState());
		queryMocks.fetchRuntimeMergeConflicts.mockResolvedValue({
			ok: true,
			conflicts: [conflictFile()],
			operation: "merge",
			worktreePath: WORKTREE,
			autostashHeld: false,
		});
		const onResolved = vi.fn();

		await render(onResolved);

		const textarea = document.querySelector("textarea");
		expect(textarea?.value).toContain("<<<<<<< HEAD");

		await act(async () => {
			if (textarea) {
				typeIntoTextarea(textarea, "line1\nBOTH\nline3\n");
			}
		});
		await act(async () => {
			findButton("Save resolution")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		await flush();

		expect(queryMocks.resolveRuntimeMergeConflict).toHaveBeenCalledWith("ws-1", {
			worktreePath: WORKTREE,
			path: "a.ts",
			side: "manual",
			content: "line1\nBOTH\nline3\n",
		});
		expect(onResolved).toHaveBeenCalled();
	});

	it("picks a whole side without sending content", async () => {
		queryMocks.fetchRuntimeConflictState.mockResolvedValue(stoppedState());
		queryMocks.fetchRuntimeMergeConflicts.mockResolvedValue({
			ok: true,
			conflicts: [conflictFile()],
			operation: "merge",
			worktreePath: WORKTREE,
			autostashHeld: false,
		});

		await render();
		await act(async () => {
			findButton("Use ours")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		await flush();

		expect(queryMocks.resolveRuntimeMergeConflict).toHaveBeenCalledWith("ws-1", {
			worktreePath: WORKTREE,
			path: "a.ts",
			side: "ours",
		});
	});

	it("only offers the whole-file pick when content was omitted", async () => {
		queryMocks.fetchRuntimeConflictState.mockResolvedValue(stoppedState());
		queryMocks.fetchRuntimeMergeConflicts.mockResolvedValue({
			ok: true,
			conflicts: [
				conflictFile({ binary: true, contentOmitted: true, ours: null, theirs: null, merged: null }),
			],
			operation: "merge",
			worktreePath: WORKTREE,
			autostashHeld: false,
		});

		await render();

		expect(document.querySelector("textarea")).toBeNull();
		expect(findButton("Use ours")).not.toBeNull();
		expect(document.body.textContent).toContain("binary");
	});

	it("blocks Commit merge while a file is still conflicted and allows it once clear", async () => {
		queryMocks.fetchRuntimeConflictState.mockResolvedValue(stoppedState());
		queryMocks.fetchRuntimeMergeConflicts.mockResolvedValue({
			ok: true,
			conflicts: [conflictFile()],
			operation: "merge",
			worktreePath: WORKTREE,
			autostashHeld: false,
		});
		await render();
		expect(findButton("Commit merge")?.disabled).toBe(true);

		queryMocks.fetchRuntimeConflictState.mockResolvedValue(stoppedState("merge", []));
		queryMocks.fetchRuntimeMergeConflicts.mockResolvedValue({
			ok: true,
			conflicts: [],
			operation: "merge",
			worktreePath: WORKTREE,
			autostashHeld: false,
		});
		await act(async () => {
			findButton("Use ours")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		await flush();

		expect(findButton("Commit merge")?.disabled).toBe(false);
		await act(async () => {
			findButton("Commit merge")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		await flush();
		expect(queryMocks.continueRuntimeConflictOperation).toHaveBeenCalledWith("ws-1", {
			worktreePath: WORKTREE,
		});
	});

	it("offers Skip this commit only for a rebase", async () => {
		queryMocks.fetchRuntimeConflictState.mockResolvedValue(stoppedState("rebase"));
		queryMocks.fetchRuntimeMergeConflicts.mockResolvedValue({
			ok: true,
			conflicts: [conflictFile()],
			operation: "rebase",
			worktreePath: WORKTREE,
			autostashHeld: false,
		});

		await render();

		expect(document.body.textContent).toContain("Rebase in progress");
		expect(findButton("Continue rebase")).not.toBeNull();
		await act(async () => {
			findButton("Skip this commit")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		await flush();
		expect(queryMocks.skipRuntimeRebaseCommit).toHaveBeenCalled();
	});

	it("says where the autostashed work went", async () => {
		queryMocks.fetchRuntimeConflictState.mockResolvedValue({
			ok: true,
			worktrees: [{ ...stoppedState().worktrees[0], autostashHeld: true }],
		});
		queryMocks.fetchRuntimeMergeConflicts.mockResolvedValue({
			ok: true,
			conflicts: [conflictFile()],
			operation: "merge",
			worktreePath: WORKTREE,
			autostashHeld: true,
		});

		await render();

		expect(document.body.textContent).toContain("stashed while this runs");
	});

	it("reports plainly when nothing is unfinished", async () => {
		queryMocks.fetchRuntimeConflictState.mockResolvedValue({ ok: true, worktrees: [] });

		await render();

		expect(queryMocks.fetchRuntimeMergeConflicts).not.toHaveBeenCalled();
		expect(document.body.textContent).toContain("No unfinished merge, rebase or cherry-pick");
		expect(findButton("Commit merge")).toBeNull();
	});
});
