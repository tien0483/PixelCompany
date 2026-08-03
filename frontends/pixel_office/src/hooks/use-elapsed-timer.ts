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
