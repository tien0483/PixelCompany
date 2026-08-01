import type { RuntimeJackedAccount, RuntimeJackedProvider } from "@/runtime/types";

const PROVIDER_LABELS: Record<RuntimeJackedProvider, string> = {
	claude: "Claude",
	codex: "Codex",
	cursor: "Cursor",
	antigravity: "Antigravity",
};

export function jackedProviderLabel(provider: RuntimeJackedProvider): string {
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

/** max(5h%, 7d%) — same family as RuntimeJackedAccount.pressure, as a 0–100 score. */
export function usagePressurePercent(account: Pick<RuntimeJackedAccount, "fiveHourPercent" | "sevenDayPercent">): number {
	return Math.max(account.fiveHourPercent ?? 0, account.sevenDayPercent ?? 0);
}

export function isDonateExhausted(
	account: Pick<RuntimeJackedAccount, "fiveHourPercent" | "sevenDayPercent" | "donateLimitPercent">,
): boolean {
	return usagePressurePercent(account) >= account.donateLimitPercent;
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
