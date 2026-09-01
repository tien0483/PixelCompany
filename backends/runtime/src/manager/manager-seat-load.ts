import type { RuntimeTaskSessionSummary } from "../core/api-contract";
import type { AutoSeatFleetContext } from "./claude-auto-seat-ranking";

/** Count active Claude board sessions pinned to each Manager seat. */
export function buildClaudeSeatLoadFromSummaries(
	summaries: ReadonlyArray<Pick<RuntimeTaskSessionSummary, "agentId" | "managerAccountId" | "state">>,
): Record<number, number> {
	const load: Record<number, number> = {};
	for (const summary of summaries) {
		if (summary.agentId !== "claude") {
			continue;
		}
		if (summary.state !== "running") {
			continue;
		}
		const accountId = summary.managerAccountId;
		if (accountId === null || accountId === undefined) {
			continue;
		}
		load[accountId] = (load[accountId] ?? 0) + 1;
	}
	return load;
}

export function toAutoSeatFleetContext(seatLoad: Record<number, number>): AutoSeatFleetContext {
	return { seatLoad };
}
