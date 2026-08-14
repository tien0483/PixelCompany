import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getBlame } from "../../src/workspace/git-history";
import {
	commitWorkspaceChanges,
	getMergeConflicts,
	resolveMergeConflict,
	runGitCreateBranchAction,
	runGitMergeBranchInTemporaryWorktree,
	runGitSyncAction,
} from "../../src/workspace/git-sync";
import { createGitTestEnv } from "../utilities/git-env";
import { createTempDir } from "../utilities/temp-dir";

function git(cwd: string, args: string[], allowFailure = false): string {
	const result = spawnSync("git", args, { cwd, encoding: "utf8", env: createGitTestEnv() });
	if (result.status !== 0 && !allowFailure) {
		throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
	}
	return result.stdout.trim();
}

describe("git feature backends integration", () => {
	let repo: string;
	let cleanup: () => void;

	beforeEach(() => {
		const dir = createTempDir("kanban-features-");
		repo = dir.path;
		cleanup = dir.cleanup;
		git(repo, ["init"]);
		git(repo, ["config", "user.name", "Alice"]);
		git(repo, ["config", "user.email", "alice@test.com"]);
		writeFileSync(join(repo, "foo.txt"), "line1\nline2\nline3\n");
		git(repo, ["add", "."]);
		git(repo, ["commit", "-m", "init"]);
	});

	afterEach(() => {
		cleanup();
	});

	it("commits working changes (Phase 3)", async () => {
		writeFileSync(join(repo, "foo.txt"), "line1\nCHANGED\nline3\n");
		const response = await commitWorkspaceChanges({ cwd: repo, message: "tweak line 2" });
		expect(response.ok).toBe(true);
		expect(response.summary.changedFiles).toBe(0);
		expect(git(repo, ["log", "-1", "--format=%s"])).toBe("tweak line 2");
	});

	it("rejects a commit with no changes", async () => {
		const response = await commitWorkspaceChanges({ cwd: repo, message: "nothing" });
		expect(response.ok).toBe(false);
		expect(response.error).toContain("no changes");
	});

	it("stashes and restores working changes (Phase 5)", async () => {
		writeFileSync(join(repo, "foo.txt"), "dirty\n");
		const stashed = await runGitSyncAction({ cwd: repo, action: "stash" });
		expect(stashed.ok).toBe(true);
		expect(stashed.summary.changedFiles).toBe(0);

		const popped = await runGitSyncAction({ cwd: repo, action: "stash-pop" });
		expect(popped.ok).toBe(true);
		expect(readFileSync(join(repo, "foo.txt"), "utf8")).toBe("dirty\n");
	});

	it("blames a committed file (Phase 6)", async () => {
		const response = await getBlame({ cwd: repo, path: "foo.txt" });
		expect(response.ok).toBe(true);
		expect(response.lines).toHaveLength(3);
		// createGitTestEnv sets GIT_AUTHOR_NAME=Test, which overrides local config.
		expect(response.lines[0]).toMatchObject({ lineNumber: 1, author: "Test", summary: "init" });
	});

	it("creates a new branch from a start point without moving HEAD", async () => {
		const startBranch = git(repo, ["rev-parse", "--abbrev-ref", "HEAD"]);
		const startHead = git(repo, ["rev-parse", "HEAD"]);

		const response = await runGitCreateBranchAction({
			cwd: repo,
			newBranch: "feature/new-work",
			startPoint: startBranch,
		});

		expect(response.ok).toBe(true);
		expect(response.branch).toBe("feature/new-work");
		expect(response.startPoint).toBe(startBranch);
		// The new branch now exists...
		expect(git(repo, ["branch", "--list", "feature/new-work"])).toContain("feature/new-work");
		// ...and HEAD did not move: still on the original branch at the original commit.
		expect(git(repo, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe(startBranch);
		expect(git(repo, ["rev-parse", "HEAD"])).toBe(startHead);
		// Both refs point at the same commit.
		expect(git(repo, ["rev-parse", "feature/new-work"])).toBe(startHead);
	});

	it("rejects creating a branch that already exists", async () => {
		const startBranch = git(repo, ["rev-parse", "--abbrev-ref", "HEAD"]);
		git(repo, ["branch", "existing"]);

		const response = await runGitCreateBranchAction({
			cwd: repo,
			newBranch: "existing",
			startPoint: startBranch,
		});

		expect(response.ok).toBe(false);
		expect(response.error).toContain("already exists");
	});

	it("rejects an empty branch name before touching git", async () => {
		const response = await runGitCreateBranchAction({
			cwd: repo,
			newBranch: "   ",
			startPoint: "HEAD",
		});
		expect(response.ok).toBe(false);
		expect(response.error).toContain("Branch name cannot be empty.");
	});

	it("merges into a base branch that is checked out nowhere without moving HEAD", async () => {
		const homeBranch = git(repo, ["rev-parse", "--abbrev-ref", "HEAD"]);
		git(repo, ["checkout", "-b", "release"]);
		writeFileSync(join(repo, "release.txt"), "release\n");
		git(repo, ["add", "."]);
		git(repo, ["commit", "-m", "release base"]);
		git(repo, ["checkout", "-b", "kanban/task-1"]);
		writeFileSync(join(repo, "task.txt"), "task work\n");
		git(repo, ["add", "."]);
		git(repo, ["commit", "-m", "task work"]);
		// The home repo sits on its own branch, so nothing has `release` checked out.
		git(repo, ["checkout", homeBranch]);
		const releaseHeadBefore = git(repo, ["rev-parse", "release"]);

		const response = await runGitMergeBranchInTemporaryWorktree({
			repoPath: repo,
			branch: "kanban/task-1",
			baseRef: "release",
		});

		expect(response.ok).toBe(true);
		expect(response.baseRef).toBe("release");
		// The base branch advanced with an explicit merge commit...
		expect(git(repo, ["rev-parse", "release"])).not.toBe(releaseHeadBefore);
		expect(git(repo, ["log", "-1", "--format=%s", "release"])).toBe("Merge branch 'kanban/task-1' into release");
		expect(git(repo, ["log", "-1", "--format=%P", "release"]).split(" ")).toHaveLength(2);
		// ...while HEAD stayed where the user left it and no worktree leaked.
		expect(git(repo, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe(homeBranch);
		expect(response.summary.currentBranch).toBe(homeBranch);
		expect(git(repo, ["worktree", "list", "--porcelain"])).not.toContain("kanban-merge-base-");
	});

	it("reports a conflicting merge into a base branch that is checked out nowhere", async () => {
		const homeBranch = git(repo, ["rev-parse", "--abbrev-ref", "HEAD"]);
		git(repo, ["checkout", "-b", "release"]);
		writeFileSync(join(repo, "foo.txt"), "line1\nRELEASE\nline3\n");
		git(repo, ["commit", "-am", "release change"]);
		git(repo, ["checkout", "-b", "kanban/task-2", homeBranch]);
		writeFileSync(join(repo, "foo.txt"), "line1\nTASK\nline3\n");
		git(repo, ["commit", "-am", "task change"]);
		git(repo, ["checkout", homeBranch]);
		const releaseHeadBefore = git(repo, ["rev-parse", "release"]);

		const response = await runGitMergeBranchInTemporaryWorktree({
			repoPath: repo,
			branch: "kanban/task-2",
			baseRef: "release",
		});

		expect(response.ok).toBe(false);
		expect(response.error).toBeTruthy();
		// The aborted merge left the base branch untouched, and the throwaway worktree is gone.
		expect(git(repo, ["rev-parse", "release"])).toBe(releaseHeadBefore);
		expect(git(repo, ["worktree", "list", "--porcelain"])).not.toContain("kanban-merge-base-");
	});

	it("detects and resolves a merge conflict by picking ours (Phase 7)", async () => {
		const mainBranch = git(repo, ["rev-parse", "--abbrev-ref", "HEAD"]);
		git(repo, ["checkout", "-b", "feature"]);
		writeFileSync(join(repo, "foo.txt"), "line1\nFEATURE\nline3\n");
		git(repo, ["commit", "-am", "feature change"]);
		git(repo, ["checkout", mainBranch]);
		writeFileSync(join(repo, "foo.txt"), "line1\nMAIN\nline3\n");
		git(repo, ["commit", "-am", "main change"]);
		git(repo, ["merge", "feature"], true); // conflict → non-zero exit is expected

		const conflicts = await getMergeConflicts({ cwd: repo });
		expect(conflicts.ok).toBe(true);
		expect(conflicts.conflicts).toHaveLength(1);
		expect(conflicts.conflicts[0]).toMatchObject({ path: "foo.txt" });
		expect(conflicts.conflicts[0]?.ours).toContain("MAIN");
		expect(conflicts.conflicts[0]?.theirs).toContain("FEATURE");

		const resolved = await resolveMergeConflict({ cwd: repo, path: "foo.txt", side: "ours" });
		expect(resolved.ok).toBe(true);
		expect(readFileSync(join(repo, "foo.txt"), "utf8")).toContain("MAIN");

		const remaining = await getMergeConflicts({ cwd: repo });
		expect(remaining.conflicts).toHaveLength(0);
	});
});
