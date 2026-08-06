import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runGit } from "../workspace/git-utils.js";
import { resolveGitIdentity } from "./git-identity.js";

/**
 * `git config --global` reads $HOME/.gitconfig, so each case points HOME at a
 * scratch dir and writes the global file directly.
 */
describe("resolveGitIdentity", () => {
	let repo = "";
	let home = "";
	let originalHome: string | undefined;

	async function writeGlobalConfig(name: string | null, email: string | null) {
		const lines = ["[user]"];
		if (name !== null) {
			lines.push(`\tname = ${name}`);
		}
		if (email !== null) {
			lines.push(`\temail = ${email}`);
		}
		await writeFile(join(home, ".gitconfig"), `${lines.join("\n")}\n`, "utf8");
	}

	beforeEach(async () => {
		repo = await mkdtemp(join(tmpdir(), "git-identity-repo-"));
		home = await mkdtemp(join(tmpdir(), "git-identity-home-"));
		originalHome = process.env.HOME;
		process.env.HOME = home;
		await runGit(repo, ["init"]);
		await runGit(repo, ["config", "user.name", "Repo Committer"]);
		await runGit(repo, ["config", "user.email", "repo-committer@example.com"]);
	});

	afterEach(async () => {
		if (originalHome === undefined) {
			delete process.env.HOME;
		} else {
			process.env.HOME = originalHome;
		}
		await rm(repo, { recursive: true, force: true });
		await rm(home, { recursive: true, force: true });
	});

	it("prefers the global identity over a repo-local committer", async () => {
		await writeGlobalConfig("Machine Owner", "owner@akselos.com");
		expect(await resolveGitIdentity(repo)).toEqual({
			name: "Machine Owner",
			email: "owner@akselos.com",
			label: "Machine Owner <owner@akselos.com>",
		});
	});

	it("falls back to the repo-local identity when nothing is set globally", async () => {
		expect(await resolveGitIdentity(repo)).toEqual({
			name: "Repo Committer",
			email: "repo-committer@example.com",
			label: "Repo Committer <repo-committer@example.com>",
		});
	});

	it("labels with whichever field exists when only one is configured", async () => {
		await writeGlobalConfig(null, "owner@akselos.com");
		const identity = await resolveGitIdentity(repo);
		// name is unset globally, so it falls back to the repo-local committer.
		expect(identity.email).toBe("owner@akselos.com");
		expect(identity.label).toBe("Repo Committer <owner@akselos.com>");
	});
});
