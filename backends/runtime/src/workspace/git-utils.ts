import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createGitProcessEnv } from "../core/git-process-env";

const execFileAsync = promisify(execFile);
const GIT_MAX_BUFFER_BYTES = 10 * 1024 * 1024;

interface GitCommandResult {
	ok: boolean;
	stdout: string;
	stderr: string;
	output: string;
	error: string | null;
	exitCode: number;
	/** The command produced more than `maxBuffer` bytes and was killed. */
	outputTruncated: boolean;
	/** The command exceeded `timeoutMs` and was killed. */
	timedOut: boolean;
	/** The caller's `AbortSignal` fired (e.g. the HTTP request went away). */
	aborted: boolean;
}

export interface RunGitOptions {
	trimStdout?: boolean;
	env?: NodeJS.ProcessEnv;
	/** Defaults to `GIT_MAX_BUFFER_BYTES`; raise it for whole-commit patches. */
	maxBuffer?: number;
	signal?: AbortSignal;
	timeoutMs?: number;
}

function normalizeProcessExitCode(code: unknown): number {
	if (typeof code === "number" && Number.isFinite(code)) {
		return code;
	}
	if (typeof code === "string") {
		const parsed = Number(code);
		if (Number.isInteger(parsed)) {
			return parsed;
		}
	}
	return -1;
}

export async function runGit(cwd: string, args: string[], options: RunGitOptions = {}): Promise<GitCommandResult> {
	try {
		const fullArgs = ["-c", "core.quotepath=false", ...args];
		const { stdout, stderr } = await execFileAsync("git", fullArgs, {
			cwd,
			encoding: "utf8",
			maxBuffer: options.maxBuffer ?? GIT_MAX_BUFFER_BYTES,
			env: options.env || createGitProcessEnv(),
			...(options.signal ? { signal: options.signal } : {}),
			...(options.timeoutMs ? { timeout: options.timeoutMs } : {}),
		});
		const normalizedStdout = String(stdout ?? "").trim();
		const normalizedStderr = String(stderr ?? "").trim();
		return {
			ok: true,
			stdout: options.trimStdout === false ? stdout : normalizedStdout,
			stderr: normalizedStderr,
			output: [normalizedStdout, normalizedStderr].filter(Boolean).join("\n"),
			error: null,
			exitCode: 0,
			outputTruncated: false,
			timedOut: false,
			aborted: false,
		};
	} catch (error) {
		const candidate = error as {
			code?: string | number | null;
			killed?: boolean;
			stdout?: unknown;
			stderr?: unknown;
			message?: unknown;
		};
		const rawStdout = String(candidate.stdout ?? "");
		const stdout = options.trimStdout === false ? rawStdout : rawStdout.trim();
		const stderr = String(candidate.stderr ?? "").trim();
		const message = String(candidate.message ?? "").trim();
		const command = `git ${args.join(" ")} failed`;
		const exitCode = normalizeProcessExitCode(candidate.code);

		// These three are not git failures — they are our own limits firing. Callers
		// can degrade (truncate, skip, drop the request) instead of surfacing the
		// generic "Failed to run Git Command", which is all they used to get.
		const outputTruncated = candidate.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
		const aborted = candidate.code === "ABORT_ERR";
		const timedOut = !outputTruncated && !aborted && candidate.killed === true && options.timeoutMs !== undefined;

		let errorMessage: string;
		if (outputTruncated) {
			const limit = options.maxBuffer ?? GIT_MAX_BUFFER_BYTES;
			errorMessage = `Git output exceeded ${String(limit)} bytes: \n Command: \n ${command}`;
		} else if (timedOut) {
			errorMessage = `Git command timed out after ${String(options.timeoutMs)}ms: \n Command: \n ${command}`;
		} else {
			errorMessage = `Failed to run Git Command: \n Command: \n ${command} \n ${stderr || message}`;
		}

		return {
			ok: false,
			stdout,
			stderr,
			output: [stdout, stderr].filter(Boolean).join("\n"),
			error: errorMessage,
			exitCode,
			outputTruncated,
			timedOut,
			aborted,
		};
	}
}

export async function getGitStdout(args: string[], cwd: string, options: RunGitOptions = {}): Promise<string> {
	const result = await runGit(cwd, args, options);
	if (!result.ok) {
		throw new Error(result.error || result.stdout);
	}

	return result.stdout;
}

export interface GitHeadInfo {
	branch: string | null;
	headCommit: string | null;
	isDetached: boolean;
}

/**
 * Read the current HEAD commit, branch name, and detached state for a
 * repository (or worktree) at `cwd`.
 */
export async function readGitHeadInfo(cwd: string): Promise<GitHeadInfo> {
	const headResult = await runGit(cwd, ["rev-parse", "--verify", "HEAD"]);
	const headCommit = headResult.ok ? headResult.stdout : null;
	const branchResult = await runGit(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
	const branch = branchResult.ok ? branchResult.stdout : null;
	return {
		branch,
		headCommit,
		isDetached: headCommit !== null && branch === null,
	};
}

export function getGitCommandErrorMessage(error: unknown): string {
	if (error && typeof error === "object" && "stderr" in error) {
		const stderr = (error as { stderr?: unknown }).stderr;
		if (typeof stderr === "string" && stderr.trim()) {
			return stderr.trim();
		}
	}
	return error instanceof Error ? error.message : String(error);
}
