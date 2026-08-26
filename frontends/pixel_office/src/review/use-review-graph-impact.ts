import { useCallback, useEffect, useMemo, useState } from "react";

import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type { RuntimeReviewGraphImpactResponse } from "@/runtime/types";

export interface ReviewGraphImpactApi {
	/** Null until the first fetch resolves. */
	impact: RuntimeReviewGraphImpactResponse | null;
	isLoading: boolean;
	/** True once a fetch has resolved and the project has no knowledge graph. */
	hasNoGraph: boolean;
	refresh: () => void;
}

/**
 * The merge request's blast radius, as data.
 *
 * The same walk the review agents get as prose, which is the point: the reviewer
 * can see exactly what the agents were told. It also costs no tokens, so it is
 * fetched whether or not anyone runs an agent — and it is the surface that makes a
 * silently missing graph visible instead of just quietly degrading every prompt.
 */
export function useReviewGraphImpact(input: {
	projectPath: string | undefined;
	changedPaths: string[];
	baseBranch: string | undefined;
	workspaceId: string | null;
}): ReviewGraphImpactApi {
	const { projectPath, baseBranch, workspaceId } = input;
	const [impact, setImpact] = useState<RuntimeReviewGraphImpactResponse | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [reloadToken, setReloadToken] = useState(0);

	// Memoized on the joined string, not the array: the diff list is rebuilt on
	// every session refresh, and a new array identity per poll would re-fetch the
	// whole walk on a timer.
	const changedPathsKey = input.changedPaths.join("\n");
	const changedPaths = useMemo(
		() => (changedPathsKey.length === 0 ? [] : changedPathsKey.split("\n")),
		[changedPathsKey],
	);

	useEffect(() => {
		if (!projectPath) {
			// No local checkout selected, so there is nowhere to look for a graph. This is
			// not an error state — the standalone Review app is always in it.
			setImpact(null);
			setIsLoading(false);
			return;
		}
		let cancelled = false;
		setIsLoading(true);
		void (async () => {
			try {
				const client = getRuntimeTrpcClient(workspaceId);
				const response = await client.review.getGraphImpact.query({
					projectPath,
					changedPaths,
					...(baseBranch === undefined ? {} : { baseBranch }),
				});
				if (!cancelled) {
					setImpact(response);
				}
			} catch (error) {
				if (!cancelled) {
					// Reported in the panel rather than as a toast: a runtime that is still
					// starting would otherwise toast on every review that opens.
					setImpact({
						ok: false,
						hasGraph: false,
						error: error instanceof Error ? error.message : String(error),
					});
				}
			} finally {
				if (!cancelled) {
					setIsLoading(false);
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [projectPath, changedPaths, baseBranch, workspaceId, reloadToken]);

	const refresh = useCallback(() => {
		setReloadToken((token) => token + 1);
	}, []);

	return {
		impact,
		isLoading,
		hasNoGraph: impact !== null && impact.ok && !impact.hasGraph,
		refresh,
	};
}
