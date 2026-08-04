import { useCallback, useEffect, useState } from "react";

import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type { RuntimeSavedPlan } from "@/runtime/types";

export function useSavedPlans(workspaceId: string | null): {
	plans: RuntimeSavedPlan[];
	refresh: () => Promise<void>;
} {
	const [plans, setPlans] = useState<RuntimeSavedPlan[]>([]);

	const refresh = useCallback(async () => {
		try {
			const trpcClient = getRuntimeTrpcClient(workspaceId);
			const response = await trpcClient.plans.list.query();
			setPlans(response.ok ? response.plans : []);
		} catch {
			setPlans([]);
		}
	}, [workspaceId]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	return { plans, refresh };
}
