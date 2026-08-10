import { useCallback, useEffect, useState } from "react";

import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import { useWindowEvent } from "@/utils/react-use";

/**
 * The server caches every read for a minute (`CLAUDE_USAGE_CACHE_TTL_MS`), so polling
 * faster than that only costs a round trip and never a fresh upstream call.
 */
const CLAUDE_USAGE_POLL_MS = 60_000;

export interface ClaudeUsageAvailable {
	available: true;
	fiveHourPercent: number | null;
	sevenDayPercent: number | null;
	fiveHourResetsAt: string | null;
	sevenDayResetsAt: string | null;
	/** Unix seconds. */
	fetchedAt: number;
}

export interface ClaudeUsageUnavailable {
	available: false;
	reason: "no-credentials" | "unauthorized" | "unreachable";
}

export type ClaudeUsageState = ClaudeUsageAvailable | ClaudeUsageUnavailable;

const PENDING: ClaudeUsageState = { available: false, reason: "unreachable" };

/**
 * The local Claude account's rolling 5h / 7d windows. Reads `claude.usage`, which
 * both the full runtime and the standalone Plan Editor expose, so this works with or
 * without a Manager process behind it.
 */
export function useClaudeUsage(): ClaudeUsageState {
	const [usage, setUsage] = useState<ClaudeUsageState>(PENDING);

	const load = useCallback(async () => {
		try {
			const result = await getRuntimeTrpcClient(null).claude.usage.query();
			setUsage(result);
		} catch {
			// Keep the last known reading; the next tick resyncs.
		}
	}, []);

	useEffect(() => {
		void load();
		const timer = setInterval(() => {
			void load();
		}, CLAUDE_USAGE_POLL_MS);
		return () => clearInterval(timer);
	}, [load]);

	// A tab left open overnight shows a stale window until it is looked at again.
	useWindowEvent("focus", () => {
		void load();
	});

	return usage;
}
