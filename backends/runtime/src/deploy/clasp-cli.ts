import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * clasp is run through `npx` rather than being added to `package.json`.
 *
 * It is a developer-machine tool needed by one optional feature, and pinning it here keeps
 * the runtime's install footprint unchanged. v2 is pinned deliberately: it ships its own
 * OAuth client and stores the credential at `~/.clasprc.json`, both of which v3 changed.
 */
export const CLASP_PACKAGE = "@google/clasp@2.4.2";

/** Where clasp v2 writes the global credential after a successful `clasp login`. */
export function claspCredentialPath(): string {
	return join(homedir(), ".clasprc.json");
}

export type ClaspFailureKind = "needsLogin" | "needsApiEnabled" | "needsNetwork";

export interface ClaspResult {
	ok: boolean;
	stdout: string;
	stderr: string;
	/** stdout and stderr interleaved in arrival order — what the deploy log shows. */
	output: string;
	exitCode: number;
	failure: ClaspFailureKind | null;
}

export interface RunClaspOptions {
	cwd: string;
	timeoutMs?: number;
	/** Written to stdin and closed immediately; for the non-interactive calls this is nothing. */
	input?: string;
}

const DEFAULT_TIMEOUT_MS = 180_000;

const NEEDS_LOGIN_PATTERNS = [
	"could not read api credentials",
	"you are not logged in",
	"please login",
	"invalid credentials",
	"invalid_grant",
];

const NEEDS_API_ENABLED_PATTERNS = [
	"user has not enabled the apps script api",
	"apps script api has not been used",
	"script.googleapis.com",
];

const NEEDS_NETWORK_PATTERNS = [
	"enotfound",
	"eai_again",
	"econnrefused",
	"etimedout",
	"network socket disconnected",
	"getaddrinfo",
];

/**
 * Map clasp's stderr onto the three failures the UI can actually do something about.
 * Everything else stays an opaque error string — guessing at a remedy for an unknown
 * failure is worse than showing the log.
 */
export function classifyClaspFailure(output: string): ClaspFailureKind | null {
	const haystack = output.toLowerCase();
	// Checked before login: an API-disabled response also mentions credentials, and the
	// remedy (a one-click settings page) is the more specific one.
	if (NEEDS_API_ENABLED_PATTERNS.some((pattern) => haystack.includes(pattern))) {
		return "needsApiEnabled";
	}
	if (NEEDS_LOGIN_PATTERNS.some((pattern) => haystack.includes(pattern))) {
		return "needsLogin";
	}
	if (NEEDS_NETWORK_PATTERNS.some((pattern) => haystack.includes(pattern))) {
		return "needsNetwork";
	}
	return null;
}

export function spawnClasp(args: string[], cwd: string): ChildProcessWithoutNullStreams {
	return spawn("npx", ["--yes", CLASP_PACKAGE, ...args], {
		cwd,
		env: process.env,
		stdio: ["pipe", "pipe", "pipe"],
	});
}

export async function runClasp(args: string[], options: RunClaspOptions): Promise<ClaspResult> {
	return await new Promise<ClaspResult>((resolvePromise) => {
		let child: ChildProcessWithoutNullStreams;
		try {
			child = spawnClasp(args, options.cwd);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			resolvePromise({
				ok: false,
				stdout: "",
				stderr: message,
				output: message,
				exitCode: -1,
				failure: classifyClaspFailure(message),
			});
			return;
		}

		let stdout = "";
		let stderr = "";
		let output = "";
		let settled = false;

		const timer = setTimeout(() => {
			if (settled) {
				return;
			}
			child.kill("SIGTERM");
			stderr += `\nTimed out after ${options.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms.`;
			output += `\nTimed out after ${options.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms.`;
		}, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			stdout += chunk;
			output += chunk;
		});
		child.stderr.on("data", (chunk: string) => {
			stderr += chunk;
			output += chunk;
		});

		const finish = (exitCode: number) => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timer);
			resolvePromise({
				ok: exitCode === 0,
				stdout,
				stderr,
				output,
				exitCode,
				failure: exitCode === 0 ? null : classifyClaspFailure(output),
			});
		};

		child.on("error", (error) => {
			stderr += error.message;
			output += error.message;
			finish(-1);
		});
		child.on("close", (code) => finish(typeof code === "number" ? code : -1));

		child.stdin.end(options.input ?? "");
	});
}
