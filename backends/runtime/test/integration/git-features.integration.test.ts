import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getBlame } from "../../src/workspace/git-history";
import {
	commitWorkspaceChanges,
	getMergeConflicts,
	resolveMergeConflict,
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
