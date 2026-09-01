import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { createGitProcessEnv } from "../core/git-process-env";

const execFileAsync = promisify(execFile);
const GH_MAX_BUFFER_BYTES = 4 * 1024 * 1024;
const GITHUB_API_BASE_URL = "https://api.github.com";
const PAT_VALIDATION_TIMEOUT_MS = 10_000;

export type ValidateGithubPatResult =
	| { ok: true; login: string }
	| { ok: false; reason: string };

export type GhCliStatus = "authenticated" | "unauthenticated" | "not-installed";

export type GhCommandRunner = (args: string[]) => Promise<{ stdout: string; stderr: string }>;

export async function defaultGhRunner(args: string[]): Promise<{ stdout: string; stderr: string }> {
	const { stdout, stderr } = await execFileAsync("gh", args, {
		encoding: "utf8",
		maxBuffer: GH_MAX_BUFFER_BYTES,
		env: createGitProcessEnv(),
	});
	return { stdout: String(stdout ?? "").trim(), stderr: String(stderr ?? "").trim() };
}

/**
 * Validates a GitHub Personal Access Token (PAT) by calling `GET https://api.github.com/user`.
 * 10 second timeout, never throws — always returns an ok/reason object.
 */
export async function validateGithubPat(
	pat: string,
	fetchFn: typeof fetch = fetch,
): Promise<ValidateGithubPatResult> {
	const token = pat.trim();
	if (!token) {
		return { ok: false, reason: "Personal access token cannot be empty." };
	}

	try {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), PAT_VALIDATION_TIMEOUT_MS);

		let response: Response;
		try {
			response = await fetchFn(`${GITHUB_API_BASE_URL}/user`, {
				method: "GET",
				headers: {
					Authorization: `Bearer ${token}`,
					Accept: "application/vnd.github+json",
					"User-Agent": "PIXTiel",
					"X-GitHub-Api-Version": "2022-11-28",
				},
				signal: controller.signal,
			});
		} finally {
			clearTimeout(timeoutId);
		}

		if (response.status === 200) {
			const data = (await response.json()) as { login?: unknown };
			if (typeof data.login === "string" && data.login.length > 0) {
				return { ok: true, login: data.login };
			}
			return { ok: false, reason: "GitHub API returned a 200 response without a valid login field." };
		}

		if (response.status === 401) {
			return { ok: false, reason: "Invalid or expired GitHub personal access token." };
		}

		if (response.status === 403) {
			return { ok: false, reason: "GitHub API access forbidden or rate limit exceeded." };
		}

		return { ok: false, reason: `GitHub API returned HTTP ${response.status}.` };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (error instanceof Error && error.name === "AbortError") {
			return { ok: false, reason: `GitHub API request timed out after ${PAT_VALIDATION_TIMEOUT_MS / 1000} seconds.` };
		}
		return { ok: false, reason: `Failed to connect to GitHub API: ${message}` };
	}
}

/**
 * Probes the local GitHub CLI authentication status.
 * Spawns `gh auth status` and returns `authenticated`, `unauthenticated`, or `not-installed`.
 */
export async function probeGhCliStatus(runner: GhCommandRunner = defaultGhRunner): Promise<GhCliStatus> {
	try {
		await runner(["auth", "status"]);
		return "authenticated";
	} catch (error) {
		const candidate = error as { code?: unknown };
		if (candidate.code === "ENOENT") {
			return "not-installed";
		}
		return "unauthenticated";
	}
}
