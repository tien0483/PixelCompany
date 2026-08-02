import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { RuntimeGitPullRequestResponse } from "../core/api-contract";
import { createGitProcessEnv } from "../core/git-process-env";
import { runGit } from "./git-utils";

const execFileAsync = promisify(execFile);
const GH_MAX_BUFFER_BYTES = 4 * 1024 * 1024;

interface GhCommandResult {
	ok: boolean;
	stdout: string;
	stderr: string;
	error: string | null;
}

/**
 * Thin wrapper around the GitHub CLI, mirroring {@link runGit}'s never-throw
 * contract. Returns `ok: false` with the captured stderr instead of raising so
 * callers can surface a clean error envelope.
 */
export async function runGh(cwd: string, args: string[]): Promise<GhCommandResult> {
	try {
		const { stdout, stderr } = await execFileAsync("gh", args, {
			cwd,
			encoding: "utf8",
			maxBuffer: GH_MAX_BUFFER_BYTES,
			env: createGitProcessEnv(),
		});
		return { ok: true, stdout: String(stdout ?? "").trim(), stderr: String(stderr ?? "").trim(), error: null };
	} catch (error) {
		const candidate = error as { stdout?: unknown; stderr?: unknown; message?: unknown; code?: unknown };
		const stderr = String(candidate.stderr ?? "").trim();
		const message = String(candidate.message ?? "").trim();
		// `code === "ENOENT"` means the gh binary is not installed.
		const notInstalled = candidate.code === "ENOENT";
		return {
			ok: false,
			stdout: String(candidate.stdout ?? "").trim(),
			stderr,
			error: notInstalled ? "The GitHub CLI (gh) is not installed or not on PATH." : stderr || message,
		};
	}
}

export async function createPullRequest(options: {
	cwd: string;
	title: string;
	body: string;
	base?: string;
	/** Injectable GitHub CLI runner (defaults to {@link runGh}); overridden in tests. */
	ghRunner?: typeof runGh;
}): Promise<RuntimeGitPullRequestResponse> {
	const gh = options.ghRunner ?? runGh;
	const title = options.title.trim();
	if (!title) {
		return { ok: false, url: null, output: "", error: "Pull request title cannot be empty." };
	}

	const remoteResult = await runGit(options.cwd, ["remote", "get-url", "origin"]);
	if (!remoteResult.ok || !remoteResult.stdout) {
		return { ok: false, url: null, output: remoteResult.output, error: "No 'origin' remote is configured." };
	}

	const authResult = await gh(options.cwd, ["auth", "status"]);
	if (!authResult.ok) {
		return {
			ok: false,
			url: null,
			output: [authResult.stdout, authResult.stderr].filter(Boolean).join("\n"),
			error: authResult.error ?? "GitHub CLI is not authenticated. Run `gh auth login`.",
		};
	}

	const args = ["pr", "create", "--title", title, "--body", options.body];
	const base = options.base?.trim();
	if (base) {
		args.push("--base", base);
	}
	const createResult = await gh(options.cwd, args);
	const output = [createResult.stdout, createResult.stderr].filter(Boolean).join("\n");
	if (!createResult.ok) {
		return { ok: false, url: null, output, error: createResult.error ?? "Failed to create pull request." };
	}

	// `gh pr create` prints the new PR URL as its last stdout line.
	const url =
		createResult.stdout
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean)
			.at(-1) ?? null;
	return { ok: true, url, output };
}
