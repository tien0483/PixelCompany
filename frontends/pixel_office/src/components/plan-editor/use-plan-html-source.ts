import { useCallback, useEffect, useState } from "react";

import { getRuntimeTrpcClient } from "@/runtime/trpc-client";

export interface UsePlanHtmlSourceResult {
	/**
	 * The markdown the plan's current `<stem>.html` was generated from, or `null` when nothing
	 * has been recorded (an HTML file generated before this was tracked, or a failed load).
	 */
	snapshot: string | null;
	/** Record `content` as the markdown the freshly written HTML came from. */
	commit: (content: string) => Promise<void>;
}

/**
 * Reads and writes `<stem>.html.src.md` — the base Refine diffs against.
 *
 * This lives on disk rather than in a ref because the whole point is to survive a reload: with
 * only in-memory state, the first Refine after reopening a plan had no base and silently
 * degraded into a full regeneration.
 */
export function usePlanHtmlSource(
	planId: string | null,
	workspaceId: string | null | undefined,
): UsePlanHtmlSourceResult {
	const [snapshot, setSnapshot] = useState<string | null>(null);

	useEffect(() => {
		setSnapshot(null);
		if (!planId) {
			return;
		}
		let cancelled = false;
		void (async () => {
			try {
				const response = await getRuntimeTrpcClient(workspaceId ?? null).plans.readHtmlSource.query({ planId });
				if (cancelled) {
					return;
				}
				setSnapshot(response.ok ? response.content : null);
			} catch {
				// No base is a supported state — Refine falls back to a full-content edit.
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [planId, workspaceId]);

	const commit = useCallback(
		async (content: string) => {
			if (!planId) {
				return;
			}
			// Optimistic: the very next Refine reads this, and a failed write only costs us the
			// diff base (falling back to a full-content edit), never correctness of the HTML.
			setSnapshot(content);
			try {
				await getRuntimeTrpcClient(workspaceId ?? null).plans.writeHtmlSource.mutate({ planId, content });
			} catch {
				// Deliberately silent: the HTML itself is already saved, and surfacing a toast
				// for bookkeeping would read as "generation failed" when it did not.
			}
		},
		[planId, workspaceId],
	);

	return { snapshot, commit };
}
