import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createPullRequest } from "../../src/workspace/git-gh";
import { createGitTestEnv } from "../utilities/git-env";
import { createTempDir } from "../utilities/temp-dir";

function git(cwd: string, args: string[]): void {
	const result = spawnSync("git", args, { cwd, encoding: "utf8", env: createGitTestEnv() });
	if (result.status !== 0) {
		throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
	}
}

describe("createPullRequest (Phase 8)", () => {
	let repo: string;
	let cleanup: () => void;

	beforeEach(() => {
		const dir = createTempDir("kanban-gh-");
		repo = dir.path;
		cleanup = dir.cleanup;
		git(repo, ["init"]);
		git(repo, ["config", "user.name", "Alice"]);
		git(repo, ["config", "user.email", "alice@test.com"]);
		writeFileSync(join(repo, "foo.txt"), "hi\n");
		git(repo, ["add", "."]);
		git(repo, ["commit", "-m", "init"]);
	});

	afterEach(() => {
		cleanup();
	});

	it("rejects an empty title before touching git or gh", async () => {
		const response = await createPullRequest({ cwd: repo, title: "  ", body: "b" });
		expect(response.ok).toBe(false);
		expect(response.error).toContain("title cannot be empty");
	});

	it("fails clearly when there is no origin remote", async () => {
		const response = await createPullRequest({ cwd: repo, title: "My PR", body: "b" });
		expect(response.ok).toBe(false);
		expect(response.error).toContain("origin");
	});

	it("creates a PR and returns the URL from gh's last stdout line", async () => {
		git(repo, ["remote", "add", "origin", "https://github.com/acme/repo.git"]);
		const ghCalls: string[][] = [];
		const ghRunner = async (_cwd: string, args: string[]) => {
			ghCalls.push(args);
			if (args[0] === "auth") {
				return { ok: true, stdout: "Logged in", stderr: "", error: null };
			}
			return { ok: true, stdout: "Creating PR\nhttps://github.com/acme/repo/pull/7", stderr: "", error: null };
		};

		const response = await createPullRequest({
			cwd: repo,
			title: "My PR",
			body: "body",
			base: "main",
			ghRunner,
		});

		expect(response.ok).toBe(true);
		expect(response.url).toBe("https://github.com/acme/repo/pull/7");
		// auth status checked, then pr create with title/body/base.
		expect(ghCalls[0]).toEqual(["auth", "status"]);
		expect(ghCalls[1]).toEqual(["pr", "create", "--title", "My PR", "--body", "body", "--base", "main"]);
	});

	it("surfaces a gh auth failure as an actionable error", async () => {
		git(repo, ["remote", "add", "origin", "https://github.com/acme/repo.git"]);
		const ghRunner = async () => ({ ok: false, stdout: "", stderr: "not logged in", error: "not logged in" });

		const response = await createPullRequest({ cwd: repo, title: "My PR", body: "b", ghRunner });

		expect(response.ok).toBe(false);
		expect(response.error).toContain("not logged in");
	});
});
