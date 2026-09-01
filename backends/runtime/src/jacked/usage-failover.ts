// Pure decision logic for cross-seat restart when a Claude task hits a usage wall.
// Mirrors auth-failover's seat picker but triggers on quota exhaustion instead of OAuth
// failure. The usage-resume scheduler evaluates this before same-seat pause/resume.

import { isUsageLimitError } from "../cline-sdk/cline-session-state";
import type { RuntimeManagerAccount, RuntimeManagerSnapshot } from "../core/api-contract";
import { toManagerDonateAccount } from "../manager/manager-account-pin";
import { pickAuthFailoverAccountId } from "../terminal/auth-failover";
import { USAGE_WALLED_THRESHOLD } from "./usage-pause";

export interface ClassifyUsageFailoverInput {
	/** Card/session opt-in for cross-seat restart on usage limit. */
	autoFailoverOnUsageLimit: boolean;
	/** Agent that ran this session; only Claude tasks are eligible. */
	agentId: string | null;
	/** The account this session last ran on (resolved seat), or null when unknown. */
	managerAccountId: number | null;
	snapshot: RuntimeManagerSnapshot | null;
	errorText: string | null;
}

function windowIsWalled(percent: number | null): boolean {
	return percent !== null && percent >= USAGE_WALLED_THRESHOLD;
}

function accountIsWalled(account: RuntimeManagerAccount): boolean {
	return windowIsWalled(account.fiveHourPercent) || windowIsWalled(account.sevenDayPercent);
}

/**
 * True when the session exit looks usage-caused (walled jacked window and/or limit error text).
 * Deliberately broader than {@link classifyUsagePause}'s opt-in gate so failover can fire on its own.
 */
export function isUsageLimitedExit(input: {
	managerAccountId: number | null;
	snapshot: RuntimeManagerSnapshot | null;
	errorText: string | null;
}): boolean {
	const errorSaysUsage = isUsageLimitError(input.errorText);
	const { snapshot, managerAccountId } = input;

	if (managerAccountId !== null) {
		const account = snapshot?.accounts.find((candidate) => candidate.id === managerAccountId) ?? null;
		if (account) {
			return accountIsWalled(account) || errorSaysUsage;
		}
		return errorSaysUsage;
	}

	const pacing = snapshot?.pacing ?? null;
	if (pacing?.allExhausted) {
		return errorSaysUsage;
	}

	return errorSaysUsage;
}

/**
 * Pick the next healthy Claude seat when failover is enabled and the exit is usage-caused.
 * Returns null when no alternate seat is available or the task is ineligible.
 */
export function classifyUsageFailover(input: ClassifyUsageFailoverInput): number | null {
	if (!input.autoFailoverOnUsageLimit) {
		return null;
	}
	if (input.agentId !== null && input.agentId !== "claude") {
		return null;
	}
	if (!isUsageLimitedExit(input)) {
		return null;
	}

	const accounts = input.snapshot?.accounts ?? [];
	if (accounts.length === 0) {
		return null;
	}

	const pacing = input.snapshot?.pacing ?? null;
	if (pacing?.allExhausted) {
		return null;
	}

	const donateAccounts = accounts.map(toManagerDonateAccount);
	return pickAuthFailoverAccountId({
		brokenAccountId: input.managerAccountId,
		accounts: donateAccounts,
	});
}
