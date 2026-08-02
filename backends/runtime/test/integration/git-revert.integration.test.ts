import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { revertGitFile, revertGitHunk } from "../../src/workspace/git-sync";
import { createGitTestEnv } from "../utilities/git-env";
import { createTempDir } from "../utilities/temp-dir";

function git(cwd: string, args: string[]): void {
	const result = spawnSync("git", args, { cwd, encoding: "utf8", env: createGitTestEnv() });
	if (result.status !== 0) {
		throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
	}
}

describe("git revert integration", () => {
	let repo: string;
	let cleanup: () => void;

	beforeEach(() => {
		const dir = createTempDir("kanban-revert-");
		repo = dir.path;
		cleanup = dir.cleanup;
		git(repo, ["init"]);
		git(repo, ["config", "user.name", "Test"]);
		git(repo, ["config", "user.email", "test@test.com"]);
		writeFileSync(join(repo, "foo.txt"), Array.from({ length: 12 }, (_, i) => `line${i + 1}`).join("\n") + "\n");
		git(repo, ["add", "."]);
		git(repo, ["commit", "-m", "init"]);
	});

	afterEach(() => {
		cleanup();
	});

	it("reverts a tracked file's working changes back to HEAD", async () => {
		writeFileSync(join(repo, "foo.txt"), "totally different\n");
		const response = await revertGitFile({ cwd: repo, path: "foo.txt" });
		expect(response.ok).toBe(true);
		expect(readFileSync(join(repo, "foo.txt"), "utf8")).toContain("line1");
		expect(response.summary.changedFiles).toBe(0);
	});

	it("deletes an untracked file when reverting it", async () => {
		writeFileSync(join(repo, "new.txt"), "brand new\n");
		const response = await revertGitFile({ cwd: repo, path: "new.txt" });
		expect(response.ok).toBe(true);
		expect(existsSync(join(repo, "new.txt"))).toBe(false);
	});

	it("reverts only the selected hunk, leaving other hunks intact", async () => {
		const lines = Array.from({ length: 12 }, (_, i) => `line${i + 1}`);
		lines[1] = "CHANGED_2";
		lines[10] = "CHANGED_11";
		writeFileSync(join(repo, "foo.txt"), lines.join("\n") + "\n");

		// Revert the first hunk (around line 2); the second (around line 11) stays.
		const response = await revertGitHunk({ cwd: repo, path: "foo.txt", hunkIndex: 0 });
		expect(response.ok).toBe(true);

		const contents = readFileSync(join(repo, "foo.txt"), "utf8");
		expect(contents).toContain("line2");
		expect(contents).not.toContain("CHANGED_2");
		expect(contents).toContain("CHANGED_11");
	});

	it("fails gracefully when the hunk index is out of range", async () => {
		writeFileSync(join(repo, "foo.txt"), "line1\nCHANGED\n");
		const response = await revertGitHunk({ cwd: repo, path: "foo.txt", hunkIndex: 99 });
		expect(response.ok).toBe(false);
		expect(response.error).toBeTruthy();
	});
});
