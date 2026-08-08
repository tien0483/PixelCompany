import { useEffect, useState } from "react";

import {
	fetchStackState,
	stackDevtoolsUrl,
} from "@/stack/stack-control-client";

interface UseStackDevtoolsResult {
	/** Dashboard URL, or null when DevTools is disabled, down, or unreachable. */
	devtoolsUrl: string | null;
}

/**
 * Resolves the agent-stack DevTools dashboard URL.
 *
 * The sandbox is opt-in per shell, so an unreachable switchboard is a normal
 * state: it resolves to null and the caller simply omits the tab. Polling is
 * cheap (one localhost request) but only runs while `enabled`, so closed detail
 * views cost nothing.
 */
export function useStackDevtools(
	enabled: boolean,
	pollIntervalMs = 30_000,
): UseStackDevtoolsResult {
	const [devtoolsUrl, setDevtoolsUrl] = useState<string | null>(null);

	useEffect(() => {
		if (!enabled) return;
		let cancelled = false;

		const load = async () => {
			try {
				const state = await fetchStackState();
				if (!cancelled) setDevtoolsUrl(stackDevtoolsUrl(state));
			} catch {
				// Switchboard not running — no dashboard to show, and nothing worth
				// surfacing as an error from a passive status poll.
				if (!cancelled) setDevtoolsUrl(null);
			}
		};

		void load();
		const timer = setInterval(() => void load(), pollIntervalMs);
		return () => {
			cancelled = true;
			clearInterval(timer);
		};
	}, [enabled, pollIntervalMs]);

	return { devtoolsUrl };
}
