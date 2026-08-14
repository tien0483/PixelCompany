import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTempDir } from "../../utilities/temp-dir";

const workspaceStateMocks = vi.hoisted(() => ({
	getWorkspaceBranchRegistryPath: vi.fn(),
}));

vi.mock("../../../src/state/workspace-state.js", () => ({
	getWorkspaceBranchRegistryPath: workspaceStateMocks.getWorkspaceBranchRegistryPath,
}));

import {
	getActiveBranchEntry,
	recordTaskWorktreeBaseRef,
	registerActiveBranch,
} from "../../../src/workspace/branch-registry";

describe("branch-registry baseRef", () => {
	let cleanup: (() => void) | null = null;
	let registryPath = "";

	beforeEach(() => {
		const temp = createTempDir("kanban-branch-registry-");
		cleanup = temp.cleanup;
		const dir = join(temp.path, "ws-1");
		mkdirSync(dir, { recursive: true });
		registryPath = join(dir, "branch-registry.json");
		workspaceStateMocks.getWorkspaceBranchRegistryPath.mockReturnValue(registryPath);
	});

	afterEach(() => {
		cleanup?.();
		cleanup = null;
		vi.clearAllMocks();
	});

	it("round-trips baseRef through registerActiveBranch", async () => {
		await registerActiveBranch("ws-1", {
			taskId: "task-1",
			branch: "kanban/task-1",
			worktreePath: "/tmp/worktree",
			baseRef: "main",
		});
		const entry = await getActiveBranchEntry("ws-1", "task-1");
		expect(entry).toMatchObject({
			taskId: "task-1",
			branch: "kanban/task-1",
			worktreePath: "/tmp/worktree",
			baseRef: "main",
			status: "active",
		});
	});

	it("parses a legacy entry without baseRef without throwing", async () => {
		await registerActiveBranch("ws-1", {
			taskId: "legacy",
			branch: "kanban/task-legacy",
			worktreePath: "/tmp/legacy",
		});
		const entry = await getActiveBranchEntry("ws-1", "legacy");
		expect(entry?.baseRef).toBeUndefined();
		expect(entry?.status).toBe("active");
	});

	it("recordTaskWorktreeBaseRef never overwrites an already-set baseRef and preserves status", async () => {
		await registerActiveBranch("ws-1", {
			taskId: "task-2",
			branch: "kanban/task-2",
			worktreePath: "/tmp/wt-2",
			baseRef: "main",
			status: "merging",
			agentDisplayName: "Claude",
		});

		await recordTaskWorktreeBaseRef("ws-1", {
			taskId: "task-2",
			branch: "kanban/task-2-other",
			worktreePath: "/tmp/other",
			baseRef: "release",
		});

		const entry = await getActiveBranchEntry("ws-1", "task-2");
		expect(entry).toMatchObject({
			baseRef: "main",
			status: "merging",
			agentDisplayName: "Claude",
			branch: "kanban/task-2",
			worktreePath: "/tmp/wt-2",
		});
	});

	it("registerActiveBranch keeps the first baseRef when the worktree is recreated", async () => {
		await registerActiveBranch("ws-1", {
			taskId: "task-4",
			branch: "kanban/task-4",
			worktreePath: "/tmp/wt-4",
			baseRef: "release",
			baseCommit: "aaa111",
		});

		// Re-created worktree: the card's current base ref is whatever the home repo is
		// on now, and it must not win over the ref the task actually branched from.
		await registerActiveBranch("ws-1", {
			taskId: "task-4",
			branch: "kanban/task-4",
			worktreePath: "/tmp/wt-4-new",
			baseRef: "main",
			baseCommit: "bbb222",
		});

		const entry = await getActiveBranchEntry("ws-1", "task-4");
		expect(entry).toMatchObject({
			baseRef: "release",
			baseCommit: "aaa111",
			worktreePath: "/tmp/wt-4-new",
			status: "active",
		});
	});

	it("registerActiveBranch adopts a baseRef onto an entry that has none", async () => {
		await registerActiveBranch("ws-1", {
			taskId: "task-5",
			branch: "kanban/task-5",
			worktreePath: "/tmp/wt-5",
		});

		await registerActiveBranch("ws-1", {
			taskId: "task-5",
			branch: "kanban/task-5",
			worktreePath: "/tmp/wt-5",
			baseRef: "develop",
			baseCommit: "ccc333",
		});

		expect(await getActiveBranchEntry("ws-1", "task-5")).toMatchObject({
			baseRef: "develop",
			baseCommit: "ccc333",
		});
	});

	it("recordTaskWorktreeBaseRef adopts baseRef onto a legacy entry", async () => {
		await registerActiveBranch("ws-1", {
			taskId: "task-3",
			branch: "kanban/task-3",
			worktreePath: "/tmp/wt-3",
			status: "active",
			agentDisplayName: "Agent",
		});

		await recordTaskWorktreeBaseRef("ws-1", {
			taskId: "task-3",
			branch: "ignored",
			worktreePath: "/tmp/ignored",
			baseRef: "develop",
		});

		const entry = await getActiveBranchEntry("ws-1", "task-3");
		expect(entry).toMatchObject({
			baseRef: "develop",
			status: "active",
			agentDisplayName: "Agent",
			branch: "kanban/task-3",
			worktreePath: "/tmp/wt-3",
		});
	});
});
