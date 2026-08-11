import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";

import { type ClaspFailureKind, claspCredentialPath, classifyClaspFailure, spawnClasp } from "./clasp-cli";

export type ClaspLoginState = "idle" | "awaiting-consent" | "awaiting-code" | "done" | "failed";

export interface ClaspLoginStatus {
	state: ClaspLoginState;
	/** Google consent URL, once clasp has printed it. */
	url: string | null;
	/** True while the flow expects a code pasted back (the `--no-localhost` variant). */
	awaitingCode: boolean;
	loggedIn: boolean;
	account: string | null;
	error: string | null;
	failure: ClaspFailureKind | null;
	log: string;
}

interface LoginSession {
	child: ChildProcessWithoutNullStreams;
	state: ClaspLoginState;
	url: string | null;
	noLocalhost: boolean;
	output: string;
	error: string | null;
	failure: ClaspFailureKind | null;
}

let session: LoginSession | null = null;

const CONSENT_URL_PATTERN = /(https:\/\/accounts\.google\.com\/[^\s'"<>]+)/;
/** Generous: the first run also pays for `npx` fetching clasp. */
const CONSENT_URL_TIMEOUT_MS = 120_000;

async function pathExists(value: string): Promise<boolean> {
	try {
		await access(value);
		return true;
	} catch {
		return false;
	}
}

function decodeJwtEmail(idToken: string): string | null {
	const payload = idToken.split(".")[1];
	if (!payload) {
		return null;
	}
	try {
		const decoded: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
		if (decoded && typeof decoded === "object" && typeof (decoded as Record<string, unknown>).email === "string") {
			return (decoded as Record<string, string>).email;
		}
	} catch {
		// A credential we cannot read is still a valid credential — clasp owns the format.
	}
	return null;
}

/**
 * Best-effort "who is clasp signed in as", read out of the id_token in `~/.clasprc.json`.
 * Purely informational: the deploy itself never depends on this resolving.
 */
export async function readClaspAccountEmail(): Promise<string | null> {
	try {
		const raw = await readFile(claspCredentialPath(), "utf8");
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object") {
			return null;
		}
		const record = parsed as Record<string, unknown>;
		const token =
			record.token && typeof record.token === "object" ? (record.token as Record<string, unknown>) : record;
		const idToken = token.id_token;
		return typeof idToken === "string" ? decodeJwtEmail(idToken) : null;
	} catch {
		return null;
	}
}

export async function isClaspLoggedIn(): Promise<boolean> {
	return await pathExists(claspCredentialPath());
}

export async function getClaspLoginStatus(): Promise<ClaspLoginStatus> {
	const loggedIn = await isClaspLoggedIn();
	if (!session) {
		return {
			state: loggedIn ? "done" : "idle",
			url: null,
			awaitingCode: false,
			loggedIn,
			account: loggedIn ? await readClaspAccountEmail() : null,
			error: null,
			failure: null,
			log: "",
		};
	}
	return {
		state: session.state,
		url: session.url,
		awaitingCode: session.state === "awaiting-code",
		loggedIn,
		account: loggedIn ? await readClaspAccountEmail() : null,
		error: session.error,
		failure: session.failure,
		log: session.output,
	};
}

export function cancelClaspLogin(): void {
	if (!session) {
		return;
	}
	session.child.kill("SIGTERM");
	session = null;
}

/**
 * Start `clasp login` and resolve as soon as the Google consent URL has been printed, so
 * the caller can open it in the workspace browser profile.
 *
 * Two shapes, both of which print that URL:
 * - default — clasp runs a loopback server and the browser redirect completes the flow;
 * - `--no-localhost` — clasp waits on stdin for a pasted code, which is what
 *   {@link submitClaspLoginCode} feeds it. Kept as a fallback for hosts where the browser
 *   cannot reach the runtime's loopback (a Windows browser driving a WSL runtime relies on
 *   WSL2's localhost forwarding, which is not guaranteed).
 */
export async function startClaspLogin(options: { noLocalhost?: boolean } = {}): Promise<ClaspLoginStatus> {
	cancelClaspLogin();
	const noLocalhost = options.noLocalhost === true;
	const args = noLocalhost ? ["login", "--no-localhost"] : ["login"];

	let child: ChildProcessWithoutNullStreams;
	try {
		// clasp login writes the *global* credential, so the cwd is irrelevant — but it must
		// exist and must not be a clasp project, or clasp treats it as a project login.
		child = spawnClasp(args, tmpdir());
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			state: "failed",
			url: null,
			awaitingCode: false,
			loggedIn: await isClaspLoggedIn(),
			account: null,
			error: message,
			failure: classifyClaspFailure(message),
			log: message,
		};
	}

	const active: LoginSession = {
		child,
		state: "awaiting-consent",
		url: null,
		noLocalhost,
		output: "",
		error: null,
		failure: null,
	};
	session = active;

	await new Promise<void>((resolvePromise) => {
		let settled = false;
		const settle = () => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timer);
			resolvePromise();
		};
		const timer = setTimeout(() => {
			if (active.state === "awaiting-consent" && active.url === null) {
				active.state = "failed";
				active.error = "clasp did not produce a sign-in URL in time.";
				active.child.kill("SIGTERM");
			}
			settle();
		}, CONSENT_URL_TIMEOUT_MS);

		const absorb = (chunk: string) => {
			active.output += chunk;
			if (active.url === null) {
				const match = CONSENT_URL_PATTERN.exec(active.output);
				if (match?.[1]) {
					active.url = match[1];
					active.state = noLocalhost ? "awaiting-code" : "awaiting-consent";
					settle();
				}
			}
		};

		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", absorb);
		child.stderr.on("data", absorb);
		child.on("error", (error) => {
			active.state = "failed";
			active.error = error.message;
			active.failure = classifyClaspFailure(error.message);
			settle();
		});
		child.on("close", (code) => {
			// Only the process that is still the active session may report its own result;
			// a cancelled-and-replaced login must not overwrite the newer one.
			if (session === active) {
				if (code === 0) {
					active.state = "done";
					active.error = null;
				} else {
					active.state = "failed";
					active.error = active.error ?? `clasp login exited with code ${code ?? -1}.`;
					active.failure = classifyClaspFailure(active.output);
				}
			}
			settle();
		});
	});

	return await getClaspLoginStatus();
}

/** Feed the pasted verification code to a `--no-localhost` login and wait for it to finish. */
export async function submitClaspLoginCode(code: string): Promise<ClaspLoginStatus> {
	const active = session;
	if (!active || active.state !== "awaiting-code") {
		return {
			...(await getClaspLoginStatus()),
			error: "No sign-in is waiting for a code. Start the sign-in again.",
		};
	}
	active.child.stdin.write(`${code.trim()}\n`);
	await new Promise<void>((resolvePromise) => {
		if (active.state === "done" || active.state === "failed") {
			resolvePromise();
			return;
		}
		const timer = setTimeout(() => {
			active.child.kill("SIGTERM");
			resolvePromise();
		}, 60_000);
		active.child.once("close", () => {
			clearTimeout(timer);
			resolvePromise();
		});
	});
	return await getClaspLoginStatus();
}
