import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { probeGitConflictState } from "../../src/workspace/git-conflict-state";
import {
	abortConflictOperation,
	continueConflictOperation,
	getMergeConflicts,
	resolveMergeConflict,
	runGitCherryPickAction,
	runGitRebaseCurrentOntoAction,
	skipConflictRebaseCommit,
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

/**
 * These cover the behaviour the Resolve-merge-conflicts dialog depends on: every
 * merge/rebase/cherry-pick used to run its own `--abort` in the failure branch, so
 * the conflict never survived the request and the dialog always reported "no
 * unresolved conflicts".
 */
describe("git conflict state integration", () => {
	let repo: string;
	let cleanup: () => void;
	let mainBranch: string;

	beforeEach(() => {
		const dir = createTempDir("kanban-conflict-");
		repo = dir.path;
		cleanup = dir.cleanup;
		git(repo, ["init"]);
		git(repo, ["config", "user.name", "Alice"]);
		git(repo, ["config", "user.email", "alice@test.com"]);
		writeFileSync(join(repo, "foo.txt"), "line1\nline2\nline3\n");
		writeFileSync(join(repo, "untouched.txt"), "untouched\n");
		git(repo, ["add", "."]);
		git(repo, ["commit", "-m", "init"]);
		mainBranch = git(repo, ["rev-parse", "--abbrev-ref", "HEAD"]);
	});

	afterEach(() => {
		cleanup();
	});

	/** Two branches that both rewrote line 2, so any integration of them conflicts. */
	function createDivergentBranches(): void {
		git(repo, ["checkout", "-b", "topic"]);
		writeFileSync(join(repo, "foo.txt"), "line1\nTOPIC\nline3\n");
		git(repo, ["commit", "-am", "topic change"]);
		git(repo, ["checkout", mainBranch]);
		writeFileSync(join(repo, "foo.txt"), "line1\nMAIN\nline3\n");
		git(repo, ["commit", "-am", "main change"]);
	}

	describe("rebase", () => {
		it("leaves a conflicting rebase stopped, then continues once resolved", async () => {
			createDivergentBranches();

			const response = await runGitRebaseCurrentOntoAction({ cwd: repo, branch: "topic" });

			expect(response.ok).toBe(false);
			expect(response.conflictState).toMatchObject({ operation: "rebase", paths: ["foo.txt"] });
			expect(response.error).toContain("Resolve them to continue the rebase");
			// The sequencer state is still on disk — the whole point of the change.
			expect(git(repo, ["rev-parse", "-q", "--verify", "REBASE_HEAD"])).toBeTruthy();
			expect(response.summary.pendingOperation).toBe("rebase");
			expect(response.summary.conflictedFiles).toBe(1);

			const conflicts = await getMergeConflicts({ cwd: repo });
			expect(conflicts.operation).toBe("rebase");
			expect(conflicts.conflicts).toHaveLength(1);
			// During a rebase "ours" is the branch being replayed onto (topic).
			expect(conflicts.conflicts[0]?.ours).toContain("TOPIC");
			expect(conflicts.conflicts[0]?.theirs).toContain("MAIN");
			expect(conflicts.conflicts[0]?.merged).toContain("<<<<<<<");
			expect(conflicts.conflicts[0]?.contentOmitted).toBe(false);

			const resolved = await resolveMergeConflict({
				cwd: repo,
				path: "foo.txt",
				side: "manual",
				content: "line1\nBOTH\nline3\n",
			});
			expect(resolved.ok).toBe(true);

			const continued = await continueConflictOperation({ cwd: repo });
			expect(continued.ok).toBe(true);
			expect(continued.conflictState).toBeNull();
			expect(readFileSync(join(repo, "foo.txt"), "utf8")).toBe("line1\nBOTH\nline3\n");
			expect(await probeGitConflictState(repo)).toMatchObject({ operation: null });
			// The rebased branch now sits on top of topic.
			expect(git(repo, ["rev-parse", "topic"])).toBe(git(repo, ["rev-parse", "HEAD~1"]));
		});

		it("refuses to continue while a file is still conflicted", async () => {
			createDivergentBranches();
			await runGitRebaseCurrentOntoAction({ cwd: repo, branch: "topic" });

			const continued = await continueConflictOperation({ cwd: repo });

			expect(continued.ok).toBe(false);
			expect(continued.error).toContain("still conflicted");
			expect(continued.conflictState).toMatchObject({ operation: "rebase" });
		});

		it("drops the stopped commit on skip", async () => {
			createDivergentBranches();
			const mainHead = git(repo, ["rev-parse", mainBranch]);
			await runGitRebaseCurrentOntoAction({ cwd: repo, branch: "topic" });

			const skipped = await skipConflictRebaseCommit({ cwd: repo });

			expect(skipped.ok).toBe(true);
			expect(skipped.conflictState).toBeNull();
			// The only commit being replayed was skipped, so the branch is now just topic.
			expect(git(repo, ["rev-parse", "HEAD"])).toBe(git(repo, ["rev-parse", "topic"]));
			expect(git(repo, ["rev-parse", "HEAD"])).not.toBe(mainHead);
			expect(readFileSync(join(repo, "foo.txt"), "utf8")).toContain("TOPIC");
		});

		it("restores the working tree on abort", async () => {
			createDivergentBranches();
			const mainHead = git(repo, ["rev-parse", mainBranch]);
			await runGitRebaseCurrentOntoAction({ cwd: repo, branch: "topic" });

			const aborted = await abortConflictOperation({ cwd: repo });

			expect(aborted.ok).toBe(true);
			expect(aborted.conflictState).toBeNull();
			expect(git(repo, ["rev-parse", "HEAD"])).toBe(mainHead);
			expect(readFileSync(join(repo, "foo.txt"), "utf8")).toContain("MAIN");
		});

		it("autostashes a dirty tree instead of refusing outright", async () => {
			// The old behaviour was a flat "Working tree has local changes. Commit,
			// stash, or discard changes before rebasing." — the manual stash push/pop.
			git(repo, ["checkout", "-b", "topic"]);
			writeFileSync(join(repo, "other.txt"), "topic only\n");
			git(repo, ["add", "."]);
			git(repo, ["commit", "-m", "topic file"]);
			git(repo, ["checkout", mainBranch]);
			writeFileSync(join(repo, "untouched.txt"), "dirty edit\n");

			const response = await runGitRebaseCurrentOntoAction({ cwd: repo, branch: "topic" });

			expect(response.ok).toBe(true);
			// The uncommitted edit came back, and the rebase still happened.
			expect(readFileSync(join(repo, "untouched.txt"), "utf8")).toBe("dirty edit\n");
			expect(readFileSync(join(repo, "other.txt"), "utf8")).toBe("topic only\n");
		});

		it("reports the autostash while a conflicting rebase is stopped", async () => {
			createDivergentBranches();
			writeFileSync(join(repo, "untouched.txt"), "dirty edit\n");

			const response = await runGitRebaseCurrentOntoAction({ cwd: repo, branch: "topic" });

			expect(response.ok).toBe(false);
			// The user sees this edit missing from the working tree while resolving, and
			// nothing on disk says where it went — so it has to be reported.
			expect(response.conflictState?.autostashHeld).toBe(true);
			expect(readFileSync(join(repo, "untouched.txt"), "utf8")).toBe("untouched\n");

			await resolveMergeConflict({ cwd: repo, path: "foo.txt", side: "ours" });
			const continued = await continueConflictOperation({ cwd: repo });

			expect(continued.ok).toBe(true);
			expect(readFileSync(join(repo, "untouched.txt"), "utf8")).toBe("dirty edit\n");
		});
	});

	describe("cherry-pick", () => {
		it("leaves a conflicting pick stopped, then finishes it once resolved", async () => {
			createDivergentBranches();

			const response = await runGitCherryPickAction({
				cwd: repo,
				commitHash: git(repo, ["rev-parse", "topic"]),
				targetBranch: mainBranch,
			});

			expect(response.ok).toBe(false);
			expect(response.conflictState).toMatchObject({ operation: "cherry-pick", paths: ["foo.txt"] });
			expect(git(repo, ["rev-parse", "-q", "--verify", "CHERRY_PICK_HEAD"])).toBeTruthy();

			const conflicts = await getMergeConflicts({ cwd: repo });
			expect(conflicts.operation).toBe("cherry-pick");
			expect(conflicts.conflicts[0]?.ours).toContain("MAIN");
			expect(conflicts.conflicts[0]?.theirs).toContain("TOPIC");

			await resolveMergeConflict({ cwd: repo, path: "foo.txt", side: "theirs" });
			const continued = await continueConflictOperation({ cwd: repo });

			expect(continued.ok).toBe(true);
			expect(continued.conflictState).toBeNull();
			expect(readFileSync(join(repo, "foo.txt"), "utf8")).toContain("TOPIC");
		});

		it("still aborts a failure that has nothing to resolve", async () => {
			// A non-conflict failure must not leave the worktree stranded mid-operation.
			const response = await runGitCherryPickAction({
				cwd: repo,
				commitHash: "0000000000000000000000000000000000000000",
				targetBranch: mainBranch,
			});

			expect(response.ok).toBe(false);
			expect(response.conflictState).toBeNull();
			expect(await probeGitConflictState(repo)).toMatchObject({ operation: null });
		});
	});

	describe("oversized and binary conflicts", () => {
		it("omits content instead of shipping a truncated side", async () => {
			const bigLine = `${"x".repeat(2000)}\n`;
			writeFileSync(join(repo, "big.txt"), bigLine.repeat(400));
			git(repo, ["add", "."]);
			git(repo, ["commit", "-m", "big file"]);
			git(repo, ["checkout", "-b", "topic"]);
			writeFileSync(join(repo, "big.txt"), `TOPIC\n${bigLine.repeat(400)}`);
			git(repo, ["commit", "-am", "topic big"]);
			git(repo, ["checkout", mainBranch]);
			writeFileSync(join(repo, "big.txt"), `MAIN\n${bigLine.repeat(400)}`);
			git(repo, ["commit", "-am", "main big"]);
			git(repo, ["merge", "topic"], true);

			const conflicts = await getMergeConflicts({ cwd: repo });

			expect(conflicts.conflicts).toHaveLength(1);
			expect(conflicts.conflicts[0]).toMatchObject({
				path: "big.txt",
				contentOmitted: true,
				ours: null,
				theirs: null,
				merged: null,
			});
		});
	});
});
