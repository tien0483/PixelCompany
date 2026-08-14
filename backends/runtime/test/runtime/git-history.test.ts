import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { getCommitDiff, getGitLog, getGitRefs } from "../../src/workspace/git-history";
import { discardGitChanges, getGitSyncSummary } from "../../src/workspace/git-sync";
import { createGitTestEnv } from "../utilities/git-env";
import { createTempDir } from "../utilities/temp-dir";

function runGit(cwd: string, args: string[]): string {
	const result = spawnSync("git", args, {
		cwd,
		encoding: "utf8",
		env: createGitTestEnv(),
	});
	if (result.status !== 0) {
		throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} failed`);
	}
	return result.stdout.trim();
}

function initRepository(path: string): void {
	runGit(path, ["init", "-q"]);
	runGit(path, ["config", "user.name", "Test User"]);
	runGit(path, ["config", "user.email", "test@example.com"]);
}

function commitAll(cwd: string, message: string): string {
	runGit(cwd, ["add", "."]);
	runGit(cwd, ["commit", "-qm", message]);
	return runGit(cwd, ["rev-parse", "HEAD"]);
}

describe.sequential("git history runtime", () => {
	it("returns correct metadata for root commit diffs", async () => {
		const { path: repoPath, cleanup } = createTempDir("kanban-git-history-root-");
		try {
			initRepository(repoPath);
			writeFileSync(join(repoPath, "first.txt"), "hello\nworld\n", "utf8");
			const rootCommit = commitAll(repoPath, "first commit");

			const response = await getCommitDiff({
				cwd: repoPath,
				commitHash: rootCommit,
			});

			expect(response.ok).toBe(true);
			expect(response.files).toHaveLength(1);
			expect(response.files[0]).toMatchObject({
				path: "first.txt",
				status: "added",
				additions: 2,
				deletions: 0,
			});
			expect(response.files[0]?.patch).toContain("+++ b/first.txt");
		} finally {
			cleanup();
		}
	});

	it("returns rename metadata for rename-only commits", async () => {
		const { path: repoPath, cleanup } = createTempDir("kanban-git-history-rename-");
		try {
			initRepository(repoPath);
			writeFileSync(join(repoPath, "old.txt"), "hello\n", "utf8");
			commitAll(repoPath, "init");

			runGit(repoPath, ["mv", "old.txt", "new.txt"]);
			const renameCommit = commitAll(repoPath, "rename file");

			const response = await getCommitDiff({
				cwd: repoPath,
				commitHash: renameCommit,
			});

			expect(response.ok).toBe(true);
			expect(response.files).toHaveLength(1);
			expect(response.files[0]).toMatchObject({
				path: "new.txt",
				previousPath: "old.txt",
				status: "renamed",
				additions: 0,
				deletions: 0,
			});
			expect(response.files[0]?.patch).toContain("rename from old.txt");
			expect(response.files[0]?.patch).toContain("rename to new.txt");
		} finally {
			cleanup();
		}
	});

	it("discards tracked, staged, and untracked working copy changes", async () => {
		const { path: repoPath, cleanup } = createTempDir("kanban-git-history-discard-");
		try {
			initRepository(repoPath);
			writeFileSync(join(repoPath, "tracked.txt"), "original\n", "utf8");
			commitAll(repoPath, "init");

			writeFileSync(join(repoPath, "tracked.txt"), "changed\n", "utf8");
			runGit(repoPath, ["add", "tracked.txt"]);
			mkdirSync(join(repoPath, "scratch"), { recursive: true });
			writeFileSync(join(repoPath, "scratch", "note.txt"), "temp\n", "utf8");

			const response = await discardGitChanges({ cwd: repoPath });

			expect(response.ok).toBe(true);
			expect(response.summary.changedFiles).toBe(0);
			expect(readFileSync(join(repoPath, "tracked.txt"), "utf8").replace(/\r\n/gu, "\n")).toBe("original\n");
			expect(existsSync(join(repoPath, "scratch", "note.txt"))).toBe(false);
		} finally {
			cleanup();
		}
	});

	it("returns correct UTF-8 paths for non-ASCII filenames", async () => {
		const { path: repoPath, cleanup } = createTempDir("kanban-git-history-nonascii-");
		try {
			initRepository(repoPath);
			const dirName = "提出書類";
			const fileName = "設計書.md";
			const relativePath = `${dirName}/${fileName}`;
			mkdirSync(join(repoPath, dirName), { recursive: true });
			writeFileSync(join(repoPath, dirName, fileName), "# 設計書\n", "utf8");
			const commitHash = commitAll(repoPath, "add non-ASCII path");

			const response = await getCommitDiff({
				cwd: repoPath,
				commitHash,
			});

			expect(response.ok).toBe(true);
			expect(response.files).toHaveLength(1);
			expect(response.files[0]).toMatchObject({
				path: relativePath,
				status: "added",
			});
			expect(response.files[0]?.patch).toContain(`+++ b/${relativePath}`);
		} finally {
			cleanup();
		}
	});

	it("reads ahead and behind counts from tracked branches", { timeout: 15_000 }, async () => {
		const { path: sandboxRoot, cleanup } = createTempDir("kanban-git-history-refs-");
		try {
			const remotePath = join(sandboxRoot, "remote.git");
			const localPath = join(sandboxRoot, "local");
			const peerPath = join(sandboxRoot, "peer");

			mkdirSync(remotePath, { recursive: true });
			runGit(remotePath, ["init", "--bare", "-q"]);

			mkdirSync(localPath, { recursive: true });
			initRepository(localPath);
			writeFileSync(join(localPath, "file.txt"), "base\n", "utf8");
			commitAll(localPath, "init");
			runGit(localPath, ["remote", "add", "origin", remotePath]);
			const currentBranch = runGit(localPath, ["symbolic-ref", "--short", "HEAD"]);
			runGit(localPath, ["push", "-u", "origin", currentBranch]);

			runGit(sandboxRoot, ["clone", "-q", remotePath, peerPath]);
			runGit(peerPath, ["config", "user.name", "Peer User"]);
			runGit(peerPath, ["config", "user.email", "peer@example.com"]);
			writeFileSync(join(peerPath, "peer.txt"), "remote\n", "utf8");
			commitAll(peerPath, "remote commit");
			runGit(peerPath, ["push", "origin", currentBranch]);

			writeFileSync(join(localPath, "local.txt"), "local\n", "utf8");
			commitAll(localPath, "local commit");
			runGit(localPath, ["fetch", "origin"]);

			const refsResponse = await getGitRefs(localPath);
			expect(refsResponse.ok).toBe(true);
			const headBranch = refsResponse.refs.find((ref) => ref.isHead);
			expect(headBranch).toMatchObject({
				name: currentBranch,
				type: "branch",
				upstreamName: `origin/${currentBranch}`,
				ahead: 1,
				behind: 1,
			});

			expect(refsResponse.refs).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						name: `origin/${currentBranch}`,
						type: "remote",
					}),
				]),
			);

			expect(refsResponse.truncated).toBeUndefined();

			const summary = await getGitSyncSummary(localPath);
			expect(summary.aheadCount).toBe(1);
			expect(summary.behindCount).toBe(1);

			const logResponse = await getGitLog({
				cwd: localPath,
				refs: [currentBranch, `origin/${currentBranch}`],
			});
			expect(logResponse.ok).toBe(true);
			expect(logResponse.commits).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						message: "local commit",
						relation: "selected",
					}),
					expect.objectContaining({
						message: "remote commit",
						relation: "upstream",
					}),
				]),
			);
			expect(logResponse.relationsComplete).toBe(true);
		} finally {
			cleanup();
		}
	});

	it("clamps an oversized page request and reports the count as exact on a small repo", async () => {
		const { path: repoPath, cleanup } = createTempDir("kanban-git-history-clamp-");
		try {
			initRepository(repoPath);
			for (let index = 0; index < 5; index += 1) {
				writeFileSync(join(repoPath, `file-${String(index)}.txt`), `line ${String(index)}\n`, "utf8");
				commitAll(repoPath, `commit ${String(index)}`);
			}

			const response = await getGitLog({ cwd: repoPath, maxCount: 10_000_000, skip: 0 });

			expect(response.ok).toBe(true);
			// The page is clamped to GIT_LOG_MAX_COUNT_LIMIT, which is far above the
			// five commits this repo has, so every commit still comes back.
			expect(response.commits).toHaveLength(5);
			expect(response.totalCount).toBe(5);
			expect(response.totalCountIsExact).toBe(true);
		} finally {
			cleanup();
		}
	});

	it("caps the file list of a very wide commit and reports the real total", { timeout: 60_000 }, async () => {
		const { path: repoPath, cleanup } = createTempDir("kanban-git-history-wide-");
		try {
			initRepository(repoPath);
			writeFileSync(join(repoPath, "seed.txt"), "seed\n", "utf8");
			commitAll(repoPath, "seed");

			const fileCount = 320;
			for (let index = 0; index < fileCount; index += 1) {
				writeFileSync(join(repoPath, `wide-${String(index).padStart(4, "0")}.txt`), "content\n", "utf8");
			}
			const wideCommit = commitAll(repoPath, "wide commit");

			const response = await getCommitDiff({ cwd: repoPath, commitHash: wideCommit });

			expect(response.ok).toBe(true);
			expect(response.files).toHaveLength(300);
			expect(response.truncated).toBe(true);
			expect(response.totalFileCount).toBe(fileCount);
			// The files that survived the cap still carry their patches.
			expect(response.files[0]?.patch).toContain("+content");
		} finally {
			cleanup();
		}
	});

	it("omits the patch of a file whose diff is larger than the inline limit", { timeout: 60_000 }, async () => {
		const { path: repoPath, cleanup } = createTempDir("kanban-git-history-huge-file-");
		try {
			initRepository(repoPath);
			writeFileSync(join(repoPath, "seed.txt"), "seed\n", "utf8");
			commitAll(repoPath, "seed");

			// Over COMMIT_DIFF_PATCH_LINE_LIMIT (2000) changed lines.
			const hugeLines = Array.from({ length: 5_000 }, (_unused, index) => `line ${String(index)}`).join("\n");
			writeFileSync(join(repoPath, "huge.txt"), `${hugeLines}\n`, "utf8");
			writeFileSync(join(repoPath, "small.txt"), "small\n", "utf8");
			const commitHash = commitAll(repoPath, "huge and small");

			const response = await getCommitDiff({ cwd: repoPath, commitHash });

			expect(response.ok).toBe(true);
			expect(response.truncated).toBe(true);

			const huge = response.files.find((file) => file.path === "huge.txt");
			expect(huge?.patchOmitted).toBe(true);
			expect(huge?.patch).toBe("");
			// Stats come from --numstat, so they stay exact for an omitted patch.
			expect(huge?.additions).toBe(5_000);

			const small = response.files.find((file) => file.path === "small.txt");
			expect(small?.patchOmitted).toBeUndefined();
			expect(small?.patch).toContain("+small");
		} finally {
			cleanup();
		}
	});
});
