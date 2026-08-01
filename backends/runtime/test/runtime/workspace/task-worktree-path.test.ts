import { describe, expect, it } from "vitest";

import {
	buildTaskWorktreeDisplayPath,
	getWorkspaceFolderLabelForWorktreePath,
	KANBAN_RUNTIME_HOME_DIR_NAME,
	KANBAN_TASK_WORKTREES_DIR_NAME,
	KANBAN_TASK_WORKTREES_DISPLAY_ROOT,
	KANBAN_TASK_WORKTREES_HOME_DIR_NAME,
	LEGACY_KANBAN_RUNTIME_HOME_DIR_NAME,
	LEGACY_KANBAN_TASK_WORKTREES_HOME_DIR_NAME,
	LEGACY_RUNTIME_HOME_PARENT_DIR_NAME,
	normalizeTaskIdForWorktreePath,
	RUNTIME_HOME_PARENT_DIR_NAME,
} from "../../../src/workspace/task-worktree-path";

describe("runtime home directory naming", () => {
	it("uses the vendor-neutral .agent parent, not the legacy .cline parent", () => {
		expect(RUNTIME_HOME_PARENT_DIR_NAME).toBe(".agent");
		expect(LEGACY_RUNTIME_HOME_PARENT_DIR_NAME).toBe(".cline");
	});

	it("derives kanban/worktrees paths from the current parent, not a hardcoded legacy string", () => {
		expect(KANBAN_RUNTIME_HOME_DIR_NAME).toBe(".agent/kanban");
		expect(KANBAN_TASK_WORKTREES_HOME_DIR_NAME).toBe(".agent/worktrees");
		expect(KANBAN_TASK_WORKTREES_DISPLAY_ROOT).toBe("~/.agent/worktrees");
	});

	it("keeps legacy paths pinned to .cline for pre-rename state", () => {
		expect(LEGACY_KANBAN_RUNTIME_HOME_DIR_NAME).toBe(".cline/kanban");
		expect(LEGACY_KANBAN_TASK_WORKTREES_HOME_DIR_NAME).toBe(".cline/worktrees");
	});
});

describe("normalizeTaskIdForWorktreePath", () => {
	it("trims whitespace", () => {
		expect(normalizeTaskIdForWorktreePath("  task-1  ")).toBe("task-1");
	});

	it("rejects ids that would escape the worktrees root", () => {
		expect(() => normalizeTaskIdForWorktreePath("../escape")).toThrow();
		expect(() => normalizeTaskIdForWorktreePath("a/b")).toThrow();
		expect(() => normalizeTaskIdForWorktreePath("a\\b")).toThrow();
		expect(() => normalizeTaskIdForWorktreePath("   ")).toThrow();
	});
});

describe("getWorkspaceFolderLabelForWorktreePath", () => {
	it("returns the trailing path segment", () => {
		expect(getWorkspaceFolderLabelForWorktreePath("/home/user/my-repo")).toBe("my-repo");
		expect(getWorkspaceFolderLabelForWorktreePath("/home/user/my-repo/")).toBe("my-repo");
	});

	it("falls back to workspace for an empty or unusable path", () => {
		expect(getWorkspaceFolderLabelForWorktreePath("")).toBe("workspace");
		expect(getWorkspaceFolderLabelForWorktreePath("///")).toBe("workspace");
	});

	it("strips control characters from the label", () => {
		expect(getWorkspaceFolderLabelForWorktreePath("/home/user/my\x00repo")).toBe("myrepo");
	});
});

describe("buildTaskWorktreeDisplayPath", () => {
	it("composes the display root, task id, and workspace label", () => {
		expect(buildTaskWorktreeDisplayPath("task-1", "/home/user/my-repo")).toBe(
			`${KANBAN_TASK_WORKTREES_DISPLAY_ROOT}/task-1/my-repo`,
		);
	});

	it("uses the plain worktrees directory name as its final path segment", () => {
		expect(KANBAN_TASK_WORKTREES_HOME_DIR_NAME.endsWith(KANBAN_TASK_WORKTREES_DIR_NAME)).toBe(true);
	});
});
