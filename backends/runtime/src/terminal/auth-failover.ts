// Pure decision logic for restarting a task's session on a different Manager
// account after a live OAuth-revoked/401 detection. Kept side-effect-free so
// account selection and request-building are unit-testable without a running
// TerminalSessionManager or Manager client; the caller (cli.ts) does the I/O
// (validate the broken account, fetch the new account's launch dir, call
// startTaskSession).
import {
	CLAUDE_CONFIG_DIR_ENV,
	type ManagerDonateAccountLike,
	pickDefaultClaudeAccountId,
} from "../manager/manager-account-pin";
import { appendFableSeatPostStartInput, isFableSeatModelId } from "../manager/claude-auto-seat-ranking";
import type { RestartableSessionRequest, StartTaskSessionRequest } from "./session-manager";

/**
 * Picks the failover target: the healthy, under-donate-cap Claude account
 * with the lowest 5h usage, excluding the account that just failed. The
 * exclusion is explicit rather than relying on `validationStatus` already
 * reflecting the failure — `ManagerClient.validateAccount` is async and a
 * cached snapshot can still show the broken seat as healthy.
 */
export function pickAuthFailoverAccountId(input: {
	brokenAccountId: number | null;
	accounts: ReadonlyArray<ManagerDonateAccountLike & { id: number }>;
}): number | null {
	const candidates = input.accounts.filter((account) => account.id !== input.brokenAccountId);
	return pickDefaultClaudeAccountId({ accounts: candidates, activeAccountId: null });
}

/**
 * Rebuilds the task's last start request pinned to the new account, with
 * `resumeFromPersistence` so the per-agent adapter resumes the conversation
 * (`--continue`) instead of starting fresh. Returns null for a shell session
 * or a missing retry request — failover only applies to task sessions.
 */
export function buildAuthFailoverRequest(
	retryRequest: RestartableSessionRequest | null,
	nextAccountId: number,
	configDir: string,
): StartTaskSessionRequest | null {
	if (retryRequest === null || retryRequest.kind !== "task") {
		return null;
	}
	return {
		...retryRequest.request,
		prompt: "",
		resumeFromPersistence: true,
		managerAccountId: nextAccountId,
		env: { ...retryRequest.request.env, [CLAUDE_CONFIG_DIR_ENV]: configDir },
	};
}

/**
 * Rebuilds the task's last start request for a **same-seat** relaunch: the account pin is
 * kept exactly as it was and only `CLAUDE_CONFIG_DIR` is refreshed, because the caller has
 * just re-prepared that seat's launch dir (which is what refreshes an expired Claude Code
 * token — `prepare_account_dir` on the Manager side). `resumeFromPersistence` makes the
 * adapter relaunch with `--continue`, and `postStartInput` types the `continue` the user
 * would otherwise type by hand once the TUI is up.
 *
 * Returns null for a shell session or a missing retry request, same as
 * `buildAuthFailoverRequest`.
 */
export function buildSameSeatRecoveryRequest(
	retryRequest: RestartableSessionRequest | null,
	configDir: string,
	postStartInput: string,
): StartTaskSessionRequest | null {
	if (retryRequest === null || retryRequest.kind !== "task") {
		return null;
	}
	const composedPostStartInput = isFableSeatModelId(retryRequest.request.taskLaunchSettings?.modelId)
		? appendFableSeatPostStartInput(postStartInput)
		: postStartInput;
	return {
		...retryRequest.request,
		prompt: "",
		resumeFromPersistence: true,
		postStartInput: composedPostStartInput,
		env: { ...retryRequest.request.env, [CLAUDE_CONFIG_DIR_ENV]: configDir },
	};
}

const AUTH_FAILOVER_MAX_ATTEMPTS = 3;
const AUTH_FAILOVER_WINDOW_MS = 10 * 60_000;

export interface AuthFailoverGuard {
	/** True when this task hasn't exceeded the attempt cap within the trailing window. */
	shouldAttempt(taskId: string, nowMs: number): boolean;
	recordAttempt(taskId: string, nowMs: number): void;
}

/**
 * Caps repeated auto-failover attempts per task so a fully broken account
 * fleet can't loop forever restarting the same task. Independent of
 * `SessionEntry`'s own crash-restart flap guard, which the auth-failure path
 * deliberately disarms (`suppressAutoRestartOnExit`).
 */
export function createAuthFailoverGuard(): AuthFailoverGuard {
	const attempts = new Map<string, number[]>();
	return {
		shouldAttempt(taskId, nowMs) {
			const recent = (attempts.get(taskId) ?? []).filter((timestamp) => nowMs - timestamp < AUTH_FAILOVER_WINDOW_MS);
			attempts.set(taskId, recent);
			return recent.length < AUTH_FAILOVER_MAX_ATTEMPTS;
		},
		recordAttempt(taskId, nowMs) {
			attempts.set(taskId, [...(attempts.get(taskId) ?? []), nowMs]);
		},
	};
}
