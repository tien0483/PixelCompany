import { useEffect, useState } from "react";

import type { AgentStudioTarget } from "@/components/home-sidebar-agents";
import { AGENT_STUDIO_NEW_FLOW_ID } from "@/hooks/home-route";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";

export interface UseAgentStudioTargetOptions {
	workspaceId: string | null;
	/**
	 * The flow named by the route. `AGENT_STUDIO_NEW_FLOW_ID` opens a blank canvas; `null`
	 * means the studio is not open at all.
	 */
	flowId: string | null;
	/**
	 * What the Agents sidebar handed over when it opened the studio. The warm path needs no
	 * round trip; this is `null` on a cold deep link, which is the case that has to fetch.
	 */
	seed: AgentStudioTarget | null;
}

export interface UseAgentStudioTargetResult {
	target: AgentStudioTarget | null;
	/** True while a deep link is being resolved, so the caller can hold the frame back. */
	isResolving: boolean;
	/** Set when the studio is down or the routed flow does not exist. */
	error: string | null;
}

function seedMatchesFlowId(seed: AgentStudioTarget | null, flowId: string): boolean {
	if (seed === null) {
		return false;
	}
	return flowId === AGENT_STUDIO_NEW_FLOW_ID ? seed.flow === null : seed.flow?.id === flowId;
}

/**
 * Turns `/…/agents/<flowId>` back into an `AgentStudioTarget`.
 *
 * Two things have to be recovered and neither is in the URL: the studio's base URL (it is a
 * separate sidecar on its own port) and the flow's `type` — Flowise routes each kind to a
 * different canvas path (`agents/flowise-studio-url.ts`), so an id alone cannot address a
 * flow. Both come from the same two queries the Agents sidebar already makes.
 */
export function useAgentStudioTarget({
	workspaceId,
	flowId,
	seed,
}: UseAgentStudioTargetOptions): UseAgentStudioTargetResult {
	const [resolved, setResolved] = useState<AgentStudioTarget | null>(null);
	const [isResolving, setIsResolving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const hasSeed = flowId !== null && seedMatchesFlowId(seed, flowId);

	useEffect(() => {
		if (flowId === null || hasSeed) {
			setResolved(null);
			setIsResolving(false);
			setError(null);
			return;
		}

		let cancelled = false;
		setIsResolving(true);
		setError(null);
		void (async () => {
			try {
				const trpcClient = getRuntimeTrpcClient(workspaceId);
				const status = await trpcClient.flowise.status.query();
				if (cancelled) {
					return;
				}
				if (!status.online) {
					setResolved(null);
					setError("The agent studio is not running.");
					return;
				}
				if (flowId === AGENT_STUDIO_NEW_FLOW_ID) {
					setResolved({ flow: null, baseUrl: status.baseUrl });
					return;
				}
				const flows = await trpcClient.flowise.flows.query();
				if (cancelled) {
					return;
				}
				const flow = flows.find((candidate) => candidate.id === flowId) ?? null;
				if (flow === null) {
					setResolved(null);
					setError("That agent no longer exists in the studio.");
					return;
				}
				setResolved({ flow, baseUrl: status.baseUrl });
			} catch (caught) {
				if (cancelled) {
					return;
				}
				setResolved(null);
				setError(caught instanceof Error ? caught.message : String(caught));
			} finally {
				if (!cancelled) {
					setIsResolving(false);
				}
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [flowId, hasSeed, workspaceId]);

	if (flowId === null) {
		return { target: null, isResolving: false, error: null };
	}
	return { target: hasSeed ? seed : resolved, isResolving, error };
}
