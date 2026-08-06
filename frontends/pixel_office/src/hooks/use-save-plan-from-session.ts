import { useCallback, useState } from "react";

import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type { RuntimeSavedPlan } from "@/runtime/types";

export function useSavePlanFromSession(workspaceId: string | null): {
	savePlan: (input: {
		name: string;
		content: string;
	}) => Promise<RuntimeSavedPlan>;
	isSaving: boolean;
} {
	const [isSaving, setIsSaving] = useState(false);

	const savePlan = useCallback(
		async (input: {
			name: string;
			content: string;
		}): Promise<RuntimeSavedPlan> => {
			setIsSaving(true);
			try {
				const trpcClient = getRuntimeTrpcClient(workspaceId);
				const response = await trpcClient.plans.create.mutate({
					name: input.name,
					content: input.content,
				});
				if (!response.ok || !response.plan) {
					throw new Error(response.error ?? "Failed to save plan.");
				}
				return response.plan;
			} finally {
				setIsSaving(false);
			}
		},
		[workspaceId],
	);

	return { savePlan, isSaving };
}
