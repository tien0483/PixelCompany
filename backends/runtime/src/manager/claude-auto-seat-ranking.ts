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
	id?: number;
	fiveHourPercent?: number | null;
	sevenDayPercent?: number | null;
	/** ISO-8601, stored verbatim from Anthropic — mixed `Z` and explicit-offset forms. */
	fiveHourResetsAt?: string | null;
	sevenDayResetsAt?: string | null;
	donateLimitPercent?: number;
}

/** Why Auto picked a seat — surfaced next to the Auto label in the picker. */
export type AutoSeatPickReasonCode =
	| "7d_expiring"
	| "7d_headroom"
	| "5h_room"
	| "donate_headroom"
	| "load_balance";

export interface AutoSeatWeightComponents {
	urgency7d: number;
	deficit7d: number;
	urgency5h: number;
	headroom5h: number;
	donateBudget: number;
	loadPenalty: number;
}

export interface AutoSeatWeightResult {
	total: number;
	components: AutoSeatWeightComponents;
	dominantReason: AutoSeatPickReasonCode;
}

export interface AutoSeatFleetContext {
	/** Active Claude task count per seat id. */
	seatLoad?: Readonly<Record<number, number>>;
}

export interface AutoSeatPickResult<T extends ClaudeAutoSeatRankingInput> {
	seat: T;
	weight: AutoSeatWeightResult;
}

/** Tunable coefficients for the unified Auto seat scorer (runtime + Manager mirror). */
export const AUTO_SEAT_WEIGHTS = {
	w7dUrgency: 50,
	w7dDeficit: 0.8,
	w5hUrgency: 100,
	wDonate: 18,
	wLoad: 15,
} as const;

const TAU_7D_HOURS = 48;
const TIER_URGENCY_BOOST = [1.0, 0.85, 0.6, 0.35] as const;
const T1_TARGET_PERCENT = 90;
const T2_LEAD_PERCENT = 5;

/** Adds the extra-credit pool that the Fable seat ranks on. Also satisfied by `RuntimeManagerAccount`. */
export interface FableSeatRankingInput extends ClaudeAutoSeatRankingInput {
	extraUsage?: {
		isEnabled: boolean;
		monthlyLimitUsd: number | null;
		usedCreditsUsd: number | null;
		utilization: number | null;
	} | null;
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

function usagePressurePercent(account: ClaudeAutoSeatRankingInput): number {
	return Math.max(account.fiveHourPercent ?? 0, account.sevenDayPercent ?? 0);
}

function tierUrgencyBoost(tier: number): number {
	if (tier >= NO_SEVEN_DAY_DATA_TIER) {
		return 0.1;
	}
	return TIER_URGENCY_BOOST[tier] ?? 0.1;
}

/** Wall-clock elapsed fraction (0–1) of the 7d window — mirrors `tiers.white_bar`. */
function whiteBar(account: ClaudeAutoSeatRankingInput, nowMs: number): number | null {
	const resetAt = resetToEpochMs(account.sevenDayResetsAt);
	if (resetAt === null) {
		return null;
	}
	const elapsed = (nowMs - (resetAt - 7 * MS_PER_DAY)) / (7 * MS_PER_DAY);
	return Math.max(0, Math.min(1, elapsed));
}

/** Tier-based 7d usage target (0–100). Simplified T1 uses the 90% floor. */
function targetForTier(tier: number, account: ClaudeAutoSeatRankingInput, nowMs: number): number | null {
	if (tier === NO_SEVEN_DAY_DATA_TIER) {
		return null;
	}
	if (tier === 0) {
		return 100;
	}
	if (tier === 1) {
		return T1_TARGET_PERCENT;
	}
	const wb = whiteBar(account, nowMs);
	if (wb === null) {
		return null;
	}
	if (tier === 2) {
		return Math.min(100, wb * 100 + T2_LEAD_PERCENT);
	}
	return wb * 100;
}

function computeUrgency7d(account: ClaudeAutoSeatRankingInput, nowMs: number): number {
	const resetAt = resetToEpochMs(account.sevenDayResetsAt);
	if (resetAt === null || resetAt <= nowMs) {
		return 0;
	}
	const hoursLeft = (resetAt - nowMs) / MS_PER_HOUR;
	const tier = sevenDayResetTier(account, nowMs);
	return Math.exp(-hoursLeft / TAU_7D_HOURS) * tierUrgencyBoost(tier);
}

function computeDeficit7d(account: ClaudeAutoSeatRankingInput, nowMs: number): number {
	const tier = sevenDayResetTier(account, nowMs);
	const target = targetForTier(tier, account, nowMs);
	if (target === null) {
		return 0;
	}
	return Math.max(0, target - (account.sevenDayPercent ?? 0));
}

function computeHeadroom5h(account: ClaudeAutoSeatRankingInput, donateLimit: number, nowMs: number): number {
	if (isFiveHourSaturated(account, nowMs)) {
		return 0;
	}
	const cap = Math.min(donateLimit, 100);
	return Math.max(0, cap - (account.fiveHourPercent ?? 0));
}

function computeUrgency5h(account: ClaudeAutoSeatRankingInput, donateLimit: number, nowMs: number): number {
	const headroom = computeHeadroom5h(account, donateLimit, nowMs);
	if (headroom <= 0) {
		return 0;
	}
	const headroomNorm = headroom / 100;
	const resetAt = resetToEpochMs(account.fiveHourResetsAt);
	if (resetAt === null) {
		return headroomNorm * 0.5;
	}
	const minutesLeft = (resetAt - nowMs) / MS_PER_MINUTE;
	if (minutesLeft <= 0) {
		return headroomNorm;
	}
	// Rises as the 5h window nears its reset — spend headroom before it evaporates.
	const windowMinutes = 5 * 60;
	const timePressure = 1 - Math.min(1, minutesLeft / windowMinutes);
	return headroomNorm * timePressure;
}

function computeDonateBudget(account: ClaudeAutoSeatRankingInput): number {
	const limit = account.donateLimitPercent ?? 100;
	const pressure = usagePressurePercent(account);
	if (limit <= 0 || pressure >= limit) {
		return 0;
	}
	return (limit - pressure) / limit;
}

function resolveSeatLoad(account: ClaudeAutoSeatRankingInput, fleetContext?: AutoSeatFleetContext): number {
	if (account.id === undefined || fleetContext?.seatLoad === undefined) {
		return 0;
	}
	return fleetContext.seatLoad[account.id] ?? 0;
}

function dominantReasonFromWeightedTerms(
	terms: Readonly<Record<AutoSeatPickReasonCode, number>>,
	account: ClaudeAutoSeatRankingInput,
	nowMs: number,
): AutoSeatPickReasonCode {
	const tier = sevenDayResetTier(account, nowMs);
	if (tier === 0 && terms["7d_expiring"] >= terms["5h_room"]) {
		return "7d_expiring";
	}
	let best: AutoSeatPickReasonCode = "7d_headroom";
	let bestValue = Number.NEGATIVE_INFINITY;
	for (const code of ["7d_expiring", "7d_headroom", "5h_room", "donate_headroom", "load_balance"] as const) {
		const value = terms[code];
		if (value > bestValue) {
			best = code;
			bestValue = value;
		}
	}
	return best;
}

/**
 * Scalar weight for an Auto seat (higher = better). Balances 7d/5h expiry urgency,
 * tier deficit, shared donate cap headroom, and fleet load.
 */
export function computeAutoSeatWeight(
	account: ClaudeAutoSeatRankingInput,
	nowMs: number = Date.now(),
	fleetContext?: AutoSeatFleetContext,
): AutoSeatWeightResult {
	const donateLimit = account.donateLimitPercent ?? 100;
	const urgency7d = computeUrgency7d(account, nowMs);
	const deficit7d = computeDeficit7d(account, nowMs);
	const headroom5h = computeHeadroom5h(account, donateLimit, nowMs);
	const urgency5h = computeUrgency5h(account, donateLimit, nowMs);
	const donateBudget = computeDonateBudget(account);
	const loadPenalty = resolveSeatLoad(account, fleetContext);

	const saturatedPenalty = isFiveHourSaturated(account, nowMs) ? -1_000 : 0;
	const noSevenDayPenalty =
		sevenDayResetTier(account, nowMs) === NO_SEVEN_DAY_DATA_TIER ? -50 : 0;

	const weightedTerms: Record<AutoSeatPickReasonCode, number> = {
		"7d_expiring": AUTO_SEAT_WEIGHTS.w7dUrgency * urgency7d,
		"7d_headroom": AUTO_SEAT_WEIGHTS.w7dDeficit * deficit7d,
		"5h_room": AUTO_SEAT_WEIGHTS.w5hUrgency * urgency5h,
		"donate_headroom": AUTO_SEAT_WEIGHTS.wDonate * donateBudget,
		"load_balance": -AUTO_SEAT_WEIGHTS.wLoad * loadPenalty,
	};

	const total =
		weightedTerms["7d_expiring"] +
		weightedTerms["7d_headroom"] +
		weightedTerms["5h_room"] +
		weightedTerms["donate_headroom"] +
		weightedTerms["load_balance"] +
		saturatedPenalty +
		noSevenDayPenalty;

	return {
		total,
		components: {
			urgency7d,
			deficit7d,
			urgency5h,
			headroom5h,
			donateBudget,
			loadPenalty,
		},
		dominantReason: dominantReasonFromWeightedTerms(weightedTerms, account, nowMs),
	};
}

/** Short reason fragment for the Auto picker label (without seat name). */
export function describeAutoPickReason(
	account: ClaudeAutoSeatRankingInput,
	code: AutoSeatPickReasonCode,
	nowMs: number = Date.now(),
): string {
	switch (code) {
		case "7d_expiring": {
			const resetAt = resetToEpochMs(account.sevenDayResetsAt);
			if (resetAt !== null && resetAt > nowMs) {
				const hours = Math.round((resetAt - nowMs) / MS_PER_HOUR);
				if (hours < 48) {
					return `7d expiring (${hours}h)`;
				}
				return `7d expiring (${Math.round(hours / 24)}d)`;
			}
			return "7d expiring";
		}
		case "7d_headroom":
			return "7d headroom";
		case "5h_room": {
			const resetAt = resetToEpochMs(account.fiveHourResetsAt);
			if (resetAt !== null && resetAt > nowMs) {
				const d = new Date(resetAt);
				const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
				return `5h room (resets ${time})`;
			}
			return "5h room";
		}
		case "donate_headroom": {
			const limit = account.donateLimitPercent ?? 100;
			const under = Math.max(0, Math.round(limit - usagePressurePercent(account)));
			return `${under}% under cap`;
		}
		case "load_balance":
			return "least loaded";
	}
}

/**
 * The best-ranked seat in an already-narrowed pool with the weight breakdown, or null
 * when the pool is empty. Ties keep the earlier candidate, then lower account id.
 */
export function pickBestClaudeAutoSeatWithReason<T extends ClaudeAutoSeatRankingInput>(
	pool: ReadonlyArray<T>,
	nowMs: number = Date.now(),
	fleetContext?: AutoSeatFleetContext,
): AutoSeatPickResult<T> | null {
	let best: AutoSeatPickResult<T> | null = null;
	for (const account of pool) {
		const weight = computeAutoSeatWeight(account, nowMs, fleetContext);
		if (best === null) {
			best = { seat: account, weight };
			continue;
		}
		if (weight.total > best.weight.total) {
			best = { seat: account, weight };
			continue;
		}
		if (weight.total === best.weight.total && (account.id ?? Number.POSITIVE_INFINITY) < (best.seat.id ?? Number.POSITIVE_INFINITY)) {
			best = { seat: account, weight };
		}
	}
	return best;
}

/**
 * The best-ranked seat in an already-narrowed pool, or null when the pool is empty.
 */
export function pickBestClaudeAutoSeat<T extends ClaudeAutoSeatRankingInput>(
	pool: ReadonlyArray<T>,
	nowMs: number = Date.now(),
	fleetContext?: AutoSeatFleetContext,
): T | null {
	return pickBestClaudeAutoSeatWithReason(pool, nowMs, fleetContext)?.seat ?? null;
}

// ---------------------------------------------------------------------------
// Fable seat — the same shape of comparator, inverted on saturation.
//
// The Fable seat exists to spend *extra usage credit*: the monthly pay-as-you-go pool
// Anthropic bills only once a seat's subscription windows are already capped. There is no
// per-request switch that says "bill this to credit", so the only lever is which seat runs
// the turn — and the seat whose next turn lands on credit is the one with NO subscription
// headroom left. That is why `fableSeatSortKey` negates the usage term that
// `claudeAutoSeatSortKey` minimizes, and why the caller must skip the donate-cap gate
// (`manager-account-pin.ts`) rather than reuse `pickHealthyPool`, whose second stage filters
// out exactly these seats.
// ---------------------------------------------------------------------------

/**
 * The model and effort a Fable-seat card runs. Fixed, not defaulted: the preset exists to turn a
 * seat's leftover extra usage credit into the most capable tier, and a card quietly running
 * something else would spend that credit on the wrong thing.
 *
 * They live in this module because it is the only one both the runtime launch path and the
 * frontend picker can import (`@runtime-manager-seat-ranking`) — `task-launch-settings.ts`,
 * where they would otherwise belong, reaches into `node:fs` and cannot be aliased. Typed as bare
 * literals to keep this module dependency-free; `task-launch-settings.ts` binds them to
 * `RuntimeTaskLaunchEffort`, which is what catches a rename of the effort enum.
 */
export const FABLE_SEAT_MODEL_ID = "claude-fable-5";
export const FABLE_SEAT_EFFORT = "medium";

/**
 * Upper edges, in days-to-month-end, of tiers 0..3. Same convention as
 * {@link SEVEN_DAY_TIER_BOUNDARY_HOURS}: a boundary belongs to the less urgent tier.
 */
export const EXTRA_CREDIT_TIER_BOUNDARY_DAYS = [2, 7, 14, 31] as const;

const MS_PER_DAY = 86_400_000;

/**
 * Usable credit left this month, in USD, or null when the seat has none to spend —
 * the pool is off, or the provider reported no figures, or it is already drained.
 *
 * A zero/negative remainder is `null` rather than 0 on purpose: both mean "cannot spend
 * credit here", and collapsing them keeps the sort key's first term a clean boolean.
 */
export function extraCreditRemainingUsd(account: FableSeatRankingInput): number | null {
	const extra = account.extraUsage;
	if (!extra || extra.isEnabled !== true) {
		return null;
	}
	const { monthlyLimitUsd, usedCreditsUsd } = extra;
	if (monthlyLimitUsd === null || monthlyLimitUsd === undefined) {
		return null;
	}
	const remaining = monthlyLimitUsd - (usedCreditsUsd ?? 0);
	return remaining > 0 ? remaining : null;
}

/**
 * Deadline bucket from the UTC calendar month end: 0 for under 2 days left, up to 3 for a
 * fresh month.
 *
 * The month boundary is *derived*, not reported — Manager's `ExtraUsage` carries
 * `{is_enabled, monthly_limit, used_credits, utilization}` and no reset timestamp. The
 * practical consequence is that every seat on the same billing calendar lands in the same
 * tier, so this term usually cancels out and saturation decides. It earns its place only for
 * seats billing on different anniversaries, which the wire cannot currently distinguish.
 */
export function extraCreditMonthEndTier(nowMs: number): number {
	const now = new Date(nowMs);
	const monthEndMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
	const daysLeft = (monthEndMs - nowMs) / MS_PER_DAY;
	const tier = EXTRA_CREDIT_TIER_BOUNDARY_DAYS.findIndex((boundary) => daysLeft < boundary);
	return tier === -1 ? EXTRA_CREDIT_TIER_BOUNDARY_DAYS.length - 1 : tier;
}

/**
 * `[noUsableCredit, -creditRemaining, -subscriptionPressure, monthEndTier]` — smaller wins,
 * compared left to right.
 *
 * A seat with no spendable credit sinks below every seat that has some, but is never removed,
 * so a fleet with no credit at all still names a candidate for the launch's gates to report on.
 * Remaining credit is ranked first so load spreads across the fattest wallets when reset dates
 * align. Subscription pressure — `max(5h%, 7d%)`, **negated** — breaks ties: among seats with
 * equal credit, the most-capped seat is preferred because that is where the spend bills to credit.
 * Month-end tier is last; it usually cancels out when every seat shares the same billing calendar.
 */
export function fableSeatSortKey(account: FableSeatRankingInput, nowMs: number): [number, number, number, number] {
	const remaining = extraCreditRemainingUsd(account);
	return [
		remaining === null ? 1 : 0,
		-(remaining ?? 0),
		-Math.max(account.fiveHourPercent ?? 0, account.sevenDayPercent ?? 0),
		extraCreditMonthEndTier(nowMs),
	];
}

/** The best-ranked Fable seat in an already-narrowed pool. Ties keep the earlier candidate. */
export function pickBestFableSeat<T extends FableSeatRankingInput>(
	pool: ReadonlyArray<T>,
	nowMs: number = Date.now(),
): T | null {
	return pickBestByKey(pool, fableSeatSortKey, nowMs);
}

function pickBestByKey<T>(
	pool: ReadonlyArray<T>,
	sortKey: (account: T, nowMs: number) => readonly number[],
	nowMs: number,
): T | null {
	let best: T | null = null;
	let bestKey: readonly number[] | null = null;
	for (const account of pool) {
		const key = sortKey(account, nowMs);
		if (bestKey === null || compareSortKeys(key, bestKey) < 0) {
			best = account;
			bestKey = key;
		}
	}
	return best;
}
