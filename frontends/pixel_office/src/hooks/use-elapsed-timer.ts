import { useState } from "react";
import type { RuntimeTaskSessionSummary } from "@/runtime/types";
import { useInterval } from "@/utils/react-use";

/**
 * Live active-run elapsed (ms) for a task session, matching the backend stopwatch:
 * `activeRunMs + (runningSince != null ? now - runningSince : 0)`.
 *
 * Ticks once a second only while the clock is actually running (`runningSince` set),
 * so a paused / awaiting / done card shows a frozen value with no wasted timers.
 */
export function useElapsedMs(summary: RuntimeTaskSessionSummary | undefined): number {
	const activeRunMs = summary?.activeRunMs ?? 0;
	const runningSince = summary?.runningSince ?? null;
	const [nowTs, setNowTs] = useState(() => Date.now());
	useInterval(
		() => {
			setNowTs(Date.now());
		},
		runningSince != null ? 1000 : null,
	);
	if (runningSince == null) {
		return activeRunMs;
	}
	return activeRunMs + Math.max(0, nowTs - runningSince);
}

/**
 * Live remaining ms until `targetEpoch` (a backlog auto-run time), clamped at 0.
 * Ticks once a second while the target is in the future; returns 0 once elapsed and
 * `null` when there is no scheduled target (so callers can hide the countdown entirely).
 */
export function useCountdownMs(targetEpoch: number | null | undefined): number | null {
	const [nowTs, setNowTs] = useState(() => Date.now());
	const active = typeof targetEpoch === "number" && targetEpoch > nowTs;
	useInterval(
		() => {
			setNowTs(Date.now());
		},
		active ? 1000 : null,
	);
	if (typeof targetEpoch !== "number") {
		return null;
	}
	return Math.max(0, targetEpoch - nowTs);
}
