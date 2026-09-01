import { extraCreditRemainingUsd } from "@runtime-manager-seat-ranking";

import type { RuntimeManagerAccount, RuntimeManagerProvider } from "@/runtime/types";

const PROVIDER_LABELS: Record<RuntimeManagerProvider, string> = {
	claude: "Claude",
	codex: "Codex",
	cursor: "Cursor",
	antigravity: "Antigravity",
	omniroute: "OmniRoute",
};

export function managerProviderLabel(provider: RuntimeManagerProvider): string {
	return PROVIDER_LABELS[provider] ?? provider;
}

export function formatPercent(value: number | null): string {
	if (value === null) {
		return "—";
	}
	return `${Math.round(value)}%`;
}

export function pressureBarColor(pressure: number, canAutoSwap: boolean): string {
	if (!canAutoSwap) {
		return "var(--color-text-tertiary)";
	}
	if (pressure >= 0.9) {
		return "var(--color-status-red)";
	}
	if (pressure >= 0.7) {
		return "var(--color-status-orange)";
	}
	return "var(--color-status-green)";
}

/** max(5h%, 7d%) — same family as RuntimeManagerAccount.pressure, as a 0–100 score. */
export function usagePressurePercent(account: Pick<RuntimeManagerAccount, "fiveHourPercent" | "sevenDayPercent">): number {
	return Math.max(account.fiveHourPercent ?? 0, account.sevenDayPercent ?? 0);
}

export function isDonateExhausted(
	account: Pick<RuntimeManagerAccount, "fiveHourPercent" | "sevenDayPercent" | "donateLimitPercent">,
): boolean {
	return usagePressurePercent(account) >= account.donateLimitPercent;
}

/**
 * True when the seat's Claude credentials are dead: jacked's probe marked it
 * `ccNeedsAuth`, or its last validation came back `invalid`/`expired`. Mirrors
 * the runtime's `isManagerAccountAuthBroken` so the picker's Auto preview and
 * the actual launch agree on which seat is healthy.
 */
export function isAuthBroken(account: Pick<RuntimeManagerAccount, "ccNeedsAuth" | "validationStatus">): boolean {
	if (account.ccNeedsAuth) {
		return true;
	}
	return account.validationStatus === "invalid" || account.validationStatus === "expired";
}

/** Compact reset hint from an ISO timestamp (`resets 3:00 PM` / `resets May 4 …`). */
export function formatResetHint(iso: string | null | undefined, nowMs: number = Date.now()): string | null {
	if (!iso) {
		return null;
	}
	const resetAt = Date.parse(iso);
	if (!Number.isFinite(resetAt)) {
		return null;
	}
	if (resetAt <= nowMs) {
		return "no active window";
	}
	const d = new Date(resetAt);
	const now = new Date(nowMs);
	const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
	if (d.toDateString() === now.toDateString()) {
		return `resets ${time}`;
	}
	const date = d.toLocaleDateString([], { month: "short", day: "numeric" });
	return `resets ${date} ${time}`;
}

/**
 * Time left until an ISO reset, as a compact `45m` / `19h` / `3d`. Null when the
 * timestamp is missing, unparseable, or already past.
 *
 * Distinct from {@link formatResetHint}, which names the wall-clock moment. The Auto seat
 * ranking turns on *how much runway is left*, so the picker's label needs the duration.
 */
export function formatResetCountdown(iso: string | null | undefined, nowMs: number = Date.now()): string | null {
	if (!iso) {
		return null;
	}
	const resetAt = Date.parse(iso);
	if (!Number.isFinite(resetAt) || resetAt <= nowMs) {
		return null;
	}
	const minutes = Math.round((resetAt - nowMs) / 60_000);
	if (minutes < 60) {
		return `${minutes}m`;
	}
	const hours = Math.round(minutes / 60);
	if (hours < 48) {
		return `${hours}h`;
	}
	return `${Math.round(hours / 24)}d`;
}

/**
 * Extra usage credit as a dollar label (`$12.40`). Null when the seat has none to spend —
 * the pool is off, unreported, or drained.
 *
 * The remaining figure itself comes from the runtime's `extraCreditRemainingUsd`, the same
 * function the Fable seat ranks with, so a label and the launch's pick cannot disagree.
 */
export function formatExtraCreditRemaining(account: Pick<RuntimeManagerAccount, "extraUsage">): string | null {
	const remaining = extraCreditRemainingUsd(account);
	return remaining === null ? null : `$${remaining.toFixed(2)}`;
}

/** True when the seat has extra usage credit the Fable preset could actually spend. */
export function hasUsableExtraCredit(account: Pick<RuntimeManagerAccount, "extraUsage">): boolean {
	return extraCreditRemainingUsd(account) !== null;
}

/**
 * Days until the extra-credit pool rolls over, as `6d` / `today`.
 *
 * Derived from the UTC calendar month, not from provider data — Manager reports no reset
 * timestamp for extra usage. Mirrors `extraCreditMonthEndTier`'s assumption.
 */
export function formatMonthEndCountdown(nowMs: number = Date.now()): string {
	const now = new Date(nowMs);
	const monthEndMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
	const days = Math.floor((monthEndMs - nowMs) / 86_400_000);
	return days <= 0 ? "today" : `${days}d`;
}

/** Short cache-age label from unix seconds (`just now` / `5m ago` / `never`). */
export function formatUsageCacheAge(usageCachedAt: number | null | undefined, nowMs: number = Date.now()): string {
	if (usageCachedAt === null || usageCachedAt === undefined) {
		return "never";
	}
	const seconds = Math.floor(nowMs / 1000 - usageCachedAt);
	if (seconds < 60) {
		return "just now";
	}
	if (seconds < 3600) {
		return `${Math.floor(seconds / 60)}m ago`;
	}
	if (seconds < 86400) {
		return `${Math.floor(seconds / 3600)}h ago`;
	}
	return `${Math.floor(seconds / 86400)}d ago`;
}
