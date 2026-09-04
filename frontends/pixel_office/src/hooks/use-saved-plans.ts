import { useCallback, useEffect, useState } from "react";

import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type { RuntimeSavedPlan } from "@/runtime/types";

export function useSavedPlans(workspaceId: string | null): {
	plans: RuntimeSavedPlan[];
	/**
	 * False until the first query settles. An empty `plans` means "no plans" only after this
	 * is true — before it, a routed plan id is still resolving rather than missing.
	 */
	hasLoaded: boolean;
	refresh: () => Promise<void>;
} {
	const [plans, setPlans] = useState<RuntimeSavedPlan[]>([]);
	const [hasLoaded, setHasLoaded] = useState(false);

	const refresh = useCallback(async () => {
		try {
			const trpcClient = getRuntimeTrpcClient(workspaceId);
			const response = await trpcClient.plans.list.query();
			setPlans(response.ok ? response.plans : []);
		} catch {
			setPlans([]);
		} finally {
			setHasLoaded(true);
		}
	}, [workspaceId]);

	useEffect(() => {
		setHasLoaded(false);
		void refresh();
	}, [refresh]);

	return { plans, hasLoaded, refresh };
}
