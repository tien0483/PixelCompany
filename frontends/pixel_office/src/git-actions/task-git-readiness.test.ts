import { describe, expect, it } from "vitest";

import { getTaskCommitsAhead, resolveTaskGitReadiness } from "@/git-actions/task-git-readiness";
import type { ReviewTaskWorkspaceSnapshot } from "@/types/board";

function snapshot(overrides: Partial<ReviewTaskWorkspaceSnapshot> = {}): ReviewTaskWorkspaceSnapshot {
	return {
		taskId: "task-1",
		path: "/tmp/task-1",
		branch: "kanban/task-1",
		isDetached: false,
		headCommit: "abc1234",
		changedFiles: 0,
		additions: 0,
		deletions: 0,
		aheadOfBaseCount: 0,
		...overrides,
	};
}

describe("resolveTaskGitReadiness", () => {
	it("is unknown without a snapshot", () => {
		expect(resolveTaskGitReadiness(null)).toBe("unknown");
		expect(resolveTaskGitReadiness(undefined)).toBe("unknown");
	});

	it("is unknown when the git probe failed", () => {
		expect(resolveTaskGitReadiness(snapshot({ changedFiles: null, aheadOfBaseCount: null }))).toBe("unknown");
	});

	it("is empty for a clean worktree with nothing committed on top of the base", () => {
		expect(resolveTaskGitReadiness(snapshot())).toBe("empty");
	});

	it("is dirty when the worktree has uncommitted changes", () => {
		expect(resolveTaskGitReadiness(snapshot({ changedFiles: 2 }))).toBe("dirty");
	});

	it("prefers dirty over ready when commits exist but the tree is not clean", () => {
		expect(resolveTaskGitReadiness(snapshot({ changedFiles: 1, aheadOfBaseCount: 3 }))).toBe("dirty");
	});

	it("is ready for a clean worktree that is ahead of its base ref", () => {
		expect(resolveTaskGitReadiness(snapshot({ changedFiles: 0, aheadOfBaseCount: 3 }))).toBe("ready");
	});
});

describe("getTaskCommitsAhead", () => {
	it("reports the ahead count", () => {
		expect(getTaskCommitsAhead(snapshot({ aheadOfBaseCount: 4 }))).toBe(4);
	});

	it("falls back to zero when unknown", () => {
		expect(getTaskCommitsAhead(null)).toBe(0);
		expect(getTaskCommitsAhead(snapshot({ aheadOfBaseCount: null }))).toBe(0);
	});
});
