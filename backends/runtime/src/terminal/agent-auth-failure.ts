import type { RuntimeAgentId } from "../core/api-contract";

/**
 * Detects agent authentication / login failures in PTY output so Kanban can
 * stop auto-restart loops and ask the user to re-auth instead of relaunching.
 */

const MAX_SCAN_CHARS = 12_000;

const CURSOR_AUTH_PATTERNS: ReadonlyArray<RegExp> = [
	/provided api key is invalid/i,
	/api key was loaded from the cursor_api_key/i,
	/cursor_api_key.*invalid/i,
	/invalid.*cursor_api_key/i,
	/not logged in/i,
	/not authenticated/i,
	/authenticate without it/i,
	/please run [`']?agent login/i,
	/run [`']?agent login/i,
];

const CLAUDE_AUTH_PATTERNS: ReadonlyArray<RegExp> = [
	/please run\s*\/login/i,
	/not logged in\.?\s*please run/i,
	/run\s*\/login\s+to/i,
	// Claude Code's expired-credential banner and its status-line twin. The banner reads
	// "Login expired · Please run /login" (already matched by the first pattern), but the
	// status line reads "Not logged in · Run /login" — no "please", no trailing "to" — so
	// none of the patterns above see it. A session that only ever renders the status-line
	// form would otherwise sit at the login screen unreported.
	/login expired/i,
	/not logged in\W{0,4}run\s*\/login/i,
	/authentication required/i,
	/login required/i,
	/oauth.?token.*(expired|invalid|revoked)/i,
	/invalid api key/i,
	/unauthorized.*anthropic/i,
	/claude\.ai\/login/i,
	/failed to authenticate/i,
];

export function detectAgentAuthFailure(
	agentId: RuntimeAgentId | null | undefined,
	recentOutput: string,
): string | null {
	if (!agentId || recentOutput.trim().length === 0) {
		return null;
	}
	const sample = recentOutput.length > MAX_SCAN_CHARS ? recentOutput.slice(-MAX_SCAN_CHARS) : recentOutput;

	if (agentId === "cursor") {
		for (const pattern of CURSOR_AUTH_PATTERNS) {
			if (pattern.test(sample)) {
				return (
					"Cursor authentication failed (invalid or missing API key). " +
					"Re-import the Cursor account in Seats, pin it on this task, then restart."
				);
			}
		}
		return null;
	}

	if (agentId === "claude") {
		for (const pattern of CLAUDE_AUTH_PATTERNS) {
			if (pattern.test(sample)) {
				return (
					"Claude Code needs login. Open the task terminal and run /login, " +
					"or switch the active account in Seats, then restart the task."
				);
			}
		}
		return null;
	}

	return null;
}
