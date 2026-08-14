import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { getWorkspaceChanges } from "../../src/workspace/get-workspace-changes";
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

describe.sequential("workspace changes", () => {
	it("returns full text for ordinary files", async () => {
		const { path: repoPath, cleanup } = createTempDir("kanban-workspace-changes-basic-");
		try {
			initRepository(repoPath);
			writeFileSync(join(repoPath, "tracked.txt"), "one\ntwo\n", "utf8");
			runGit(repoPath, ["add", "."]);
			runGit(repoPath, ["commit", "-qm", "init"]);
			writeFileSync(join(repoPath, "tracked.txt"), "one\ntwo\nthree\n", "utf8");

			const response = await getWorkspaceChanges(repoPath);

			const tracked = response.files.find((file) => file.path === "tracked.txt");
			expect(tracked?.oldText).toBe("one\ntwo");
			expect(tracked?.newText).toBe("one\ntwo\nthree\n");
			expect(tracked?.contentOmitted).toBeUndefined();
			expect(response.truncated).toBeUndefined();
		} finally {
			cleanup();
		}
	});

	it("omits the text of a working-tree file above the size limit but keeps its stats", async () => {
		const { path: repoPath, cleanup } = createTempDir("kanban-workspace-changes-large-");
		try {
			initRepository(repoPath);
			writeFileSync(join(repoPath, "big.txt"), "seed\n", "utf8");
			runGit(repoPath, ["add", "."]);
			runGit(repoPath, ["commit", "-qm", "init"]);

			// Over WORKSPACE_CHANGES_MAX_FILE_BYTES (512 KB).
			const bigLineCount = 40_000;
			const bigContent = `${Array.from({ length: bigLineCount }, (_unused, index) => `line ${String(index)} padding padding`).join("\n")}\n`;
			writeFileSync(join(repoPath, "big.txt"), bigContent, "utf8");

			const response = await getWorkspaceChanges(repoPath);

			const big = response.files.find((file) => file.path === "big.txt");
			expect(big).toBeDefined();
			expect(big?.contentOmitted).toBe(true);
			expect(big?.newText).toBeNull();
			// --numstat never reads the file's text, so the counts stay exact.
			expect(big?.additions).toBe(bigLineCount);
			expect(big?.deletions).toBe(1);
		} finally {
			cleanup();
		}
	});

	it("caps the file list and reports the real total", { timeout: 120_000 }, async () => {
		const { path: repoPath, cleanup } = createTempDir("kanban-workspace-changes-cap-");
		try {
			initRepository(repoPath);
			writeFileSync(join(repoPath, "seed.txt"), "seed\n", "utf8");
			runGit(repoPath, ["add", "."]);
			runGit(repoPath, ["commit", "-qm", "init"]);

			const untrackedCount = 520;
			for (let index = 0; index < untrackedCount; index += 1) {
				writeFileSync(join(repoPath, `new-${String(index).padStart(4, "0")}.txt`), "content\n", "utf8");
			}

			const response = await getWorkspaceChanges(repoPath);

			expect(response.files).toHaveLength(500);
			expect(response.truncated).toBe(true);
			expect(response.totalFileCount).toBe(untrackedCount);
		} finally {
			cleanup();
		}
	});

	it("serves the identical cached response while the working tree is unchanged", async () => {
		const { path: repoPath, cleanup } = createTempDir("kanban-workspace-changes-cache-");
		try {
			initRepository(repoPath);
			writeFileSync(join(repoPath, "tracked.txt"), "one\n", "utf8");
			runGit(repoPath, ["add", "."]);
			runGit(repoPath, ["commit", "-qm", "init"]);
			writeFileSync(join(repoPath, "tracked.txt"), "one\ntwo\n", "utf8");

			const first = await getWorkspaceChanges(repoPath);
			const second = await getWorkspaceChanges(repoPath);

			expect(second).toBe(first);
		} finally {
			cleanup();
		}
	});
});
