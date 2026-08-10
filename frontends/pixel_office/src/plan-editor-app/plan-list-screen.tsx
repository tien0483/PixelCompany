import { FilePlus2 } from "lucide-react";
import { type ReactElement, useCallback, useState } from "react";

import { showAppToast } from "@/components/app-toaster";
import { HomeSidebarPlansPanel } from "@/components/home-sidebar-plans";
import { Button } from "@/components/ui/button";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type { RuntimeSavedPlan } from "@/runtime/types";

export interface PlanListScreenProps {
	onOpenPlan: (plan: RuntimeSavedPlan) => void;
}

const NEW_PLAN_TEMPLATE = "# New plan\n";

export function PlanListScreen({ onOpenPlan }: PlanListScreenProps): ReactElement {
	const [isCreating, setIsCreating] = useState(false);

	const handleNewPlan = useCallback(async () => {
		setIsCreating(true);
		try {
			const trpcClient = getRuntimeTrpcClient(null);
			const response = await trpcClient.plans.create.mutate({
				name: `Untitled plan ${new Date().toLocaleString()}`,
				content: NEW_PLAN_TEMPLATE,
			});
			if (!response.ok || !response.plan) {
				showAppToast({
					intent: "danger",
					message: response.error ?? "Failed to create plan.",
				});
				return;
			}
			onOpenPlan(response.plan);
		} catch (error) {
			showAppToast({
				intent: "danger",
				message: error instanceof Error ? error.message : String(error),
			});
		} finally {
			setIsCreating(false);
		}
	}, [onOpenPlan]);

	return (
		<div className="flex h-[100svh] flex-col bg-surface-0 text-text-primary">
			<header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
				<h1 className="text-sm font-semibold">Plan Editor</h1>
				<Button
					variant="primary"
					size="sm"
					icon={<FilePlus2 size={14} />}
					onClick={handleNewPlan}
					disabled={isCreating}
				>
					New plan
				</Button>
			</header>
			<div className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col overflow-hidden">
				<HomeSidebarPlansPanel workspaceId={null} onOpenPlan={onOpenPlan} />
			</div>
		</div>
	);
}
