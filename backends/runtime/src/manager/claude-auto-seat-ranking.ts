// Ranking rule for the seat an "Auto" (unpinned) Claude card runs on.
//
// Ranking on 5h usage alone strands 7d capacity: a seat whose 7d window resets in
// 20 hours with 40% unspent is worth more right now than an equally-loaded seat whose
// 7d window has five days left, because the first seat's headroom evaporates at the
// reset and the second's does not. So the key leads with a deadline bucket ("tier",
// borrowed from jacked's auto-swap daemon) and only then compares usage.
//
// This module must stay dependency-free: the frontend imports it directly through the
// `@runtime-manager-seat-ranking` alias so the picker's `Auto · <name>` label and the
// launch-time pick cannot drift apart. `manager-account-pin.ts` cannot be aliased that
// way — it reaches into `../terminal/task-launch-settings` — which is why the frontend
// used to carry a hand-copied second implementation.
//
// Deliberately NOT ported from `backends/manager/manager/web/auto_swap/`:
//   - tier hysteresis (`tiers.py` `tier_for`'s 5-minute damping). That exists because
//     the daemon re-decides the *global* active seat every 300s and would ping-pong
//     across a boundary on Anthropic's ±30s timestamp jitter. An Auto pick is made once
//     per launch and never revisited, so there is nothing to oscillate.
//   - the candidate filters (`selection.py` `pick_best_target`). Auto must always name a
//     seat — the caller's `pickHealthyPool` already does the eligibility narrowing, and
//     the launch's hard-block gates report on whatever comes back. So every rule here is
//     a sort key, never an exclusion.

/** The usage fields this ranking reads. Structurally satisfied by `RuntimeManagerAccount`. */
export interface ClaudeAutoSeatRankingInput {
	fiveHourPercent?: number | null;
	sevenDayPercent?: number | null;
	/** ISO-8601, stored verbatim from Anthropic — mixed `Z` and explicit-offset forms. */
	fiveHourResetsAt?: string | null;
	sevenDayResetsAt?: string | null;
}

/**
 * Upper edges, in hours-to-7d-reset, of tiers 0..3. A boundary belongs to the
 * higher-numbered (less urgent) tier, matching `tiers.py`: exactly 24h is tier 1.
 */
export const SEVEN_DAY_TIER_BOUNDARY_HOURS = [24, 48, 96, 168] as const;

/**
 * Tier for a seat with no usable 7d deadline — missing, unparseable, or already past.
 * Sorts after every real tier. A past reset is staleness, not urgency: the window has
 * flipped and the cached percentages describe a window that no longer exists.
 */
export const NO_SEVEN_DAY_DATA_TIER = SEVEN_DAY_TIER_BOUNDARY_HOURS.length;

/** A 5h window at/above this percent has no usable room. Mirrors `selection.py`'s `_FIVE_H_HEADROOM_LIMIT`. */
export const FIVE_HOUR_SATURATED_PERCENT = 90;

/**
 * A saturated 5h window resetting within this many minutes is not demoted: the session
 * gets its room back almost immediately. Mirrors `burn.py`'s `RESET_SUPPRESS_MINUTES`.
 */
export const FIVE_HOUR_IMMINENT_RESET_MINUTES = 30;

const MS_PER_HOUR = 3_600_000;
const MS_PER_MINUTE = 60_000;

/** Manager reports window resets as ISO-8601 strings; ranking needs epoch ms. */
function resetToEpochMs(value: string | null | undefined): number | null {
	if (value === null || value === undefined || value.length === 0) {
		return null;
	}
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Deadline bucket from the seat's 7d reset: 0 for under 24h left, up to 3 for a full
 * week, and {@link NO_SEVEN_DAY_DATA_TIER} when there is no usable future reset.
 */
export function sevenDayResetTier(account: ClaudeAutoSeatRankingInput, nowMs: number): number {
	const resetAt = resetToEpochMs(account.sevenDayResetsAt);
	if (resetAt === null || resetAt <= nowMs) {
		return NO_SEVEN_DAY_DATA_TIER;
	}
	const hoursLeft = (resetAt - nowMs) / MS_PER_HOUR;
	const tier = SEVEN_DAY_TIER_BOUNDARY_HOURS.findIndex((boundary) => hoursLeft < boundary);
	// Beyond the last boundary a 7d window cannot go, but a clock skew or a provider
	// quirk could still report it; treat that as the least urgent real tier.
	return tier === -1 ? SEVEN_DAY_TIER_BOUNDARY_HOURS.length - 1 : tier;
}

/**
 * True when the seat's 5h window is full and not about to reset — it cannot usefully run
 * a task right now, whatever its 7d deadline says. A missing 5h reset on a saturated
 * window counts as saturated (no evidence relief is coming); a *past* one does not, since
 * the window already flipped and the cached percentage is stale. Both match `_has_5h_headroom`.
 */
export function isFiveHourSaturated(account: ClaudeAutoSeatRankingInput, nowMs: number): boolean {
	if ((account.fiveHourPercent ?? 0) < FIVE_HOUR_SATURATED_PERCENT) {
		return false;
	}
	const resetAt = resetToEpochMs(account.fiveHourResetsAt);
	if (resetAt === null) {
		return true;
	}
	if (resetAt <= nowMs) {
		return false;
	}
	return (resetAt - nowMs) / MS_PER_MINUTE > FIVE_HOUR_IMMINENT_RESET_MINUTES;
}

/**
 * `[fiveHourSaturated, tier, usagePercent, sevenDayResetEpochMs]` — smaller wins, compared
 * left to right.
 *
 * A saturated 5h window sinks the seat below every usable one but never removes it, so a
 * fully saturated fleet still names a candidate. Then the deadline bucket, so expiring
 * capacity is spent first. Then usage — `max(5h%, 7d%)`, the same quantity as
 * `usagePressurePercent` and the donate-cap rule — so within one bucket the emptiest seat
 * wins. The reset timestamp only breaks ties, and is `Infinity` when unknown so a seat
 * with no deadline sorts last among equals (the `_epoch_or_inf` convention).
 */
export function claudeAutoSeatSortKey(
	account: ClaudeAutoSeatRankingInput,
	nowMs: number,
): [number, number, number, number] {
	return [
		isFiveHourSaturated(account, nowMs) ? 1 : 0,
		sevenDayResetTier(account, nowMs),
		Math.max(account.fiveHourPercent ?? 0, account.sevenDayPercent ?? 0),
		resetToEpochMs(account.sevenDayResetsAt) ?? Number.POSITIVE_INFINITY,
	];
}

function compareSortKeys(a: readonly number[], b: readonly number[]): number {
	for (let index = 0; index < a.length; index += 1) {
		const left = a[index] ?? 0;
		const right = b[index] ?? 0;
		if (left !== right) {
			return left < right ? -1 : 1;
		}
	}
	return 0;
}

/**
 * The best-ranked seat in an already-narrowed pool, or null when the pool is empty.
 * Ties keep the earlier candidate, matching the determinism of the `reduce`-based picker
 * this replaced.
 */
export function pickBestClaudeAutoSeat<T extends ClaudeAutoSeatRankingInput>(
	pool: ReadonlyArray<T>,
	nowMs: number = Date.now(),
): T | null {
	if (pool.length === 0) {
		return null;
	}
	let best: T | null = null;
	let bestKey: [number, number, number, number] | null = null;
	for (const account of pool) {
		const key = claudeAutoSeatSortKey(account, nowMs);
		if (bestKey === null || compareSortKeys(key, bestKey) < 0) {
			best = account;
			bestKey = key;
		}
	}
	return best;
}
