import type { ReactElement } from "react";
import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { MANAGER_LABELS } from "@/manager/manager-labels";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import { SKILL_INVENTORY_CHANGED_EVENT } from "@/runtime/skill-inventory-events";
import type { RuntimeSkillInventoryItem } from "@/runtime/types";

/**
 * Read-only list of workflows discovered from project .agent/workflows/ directories.
 *
 * Workflows only ever come from the attached repo, so a query without `workspaceId`
 * returns nothing at all — this shelf was permanently empty until it started passing
 * the selected project through.
 */
export function WorkflowsView({
	online,
	workspaceId = null,
}: {
	online: boolean;
	/** Selected project whose `.agent/workflows` to list. */
	workspaceId?: string | null;
}): ReactElement {
	const [workflows, setWorkflows] = useState<RuntimeSkillInventoryItem[] | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const inventory = await getRuntimeTrpcClient(null).runtime.listSkillInventory.query(
				workspaceId ? { workspaceId } : {},
			);
			setWorkflows(inventory.workflows ?? []);
		} catch (err) {
			setWorkflows(null);
			setError(err instanceof Error ? err.message : "Could not load workflows.");
		} finally {
			setLoading(false);
		}
	}, [workspaceId]);

	useEffect(() => {
		if (!online) {
			setWorkflows(null);
			return;
		}
		void load();
	}, [load, online]);

	useEffect(() => {
		const onChanged = () => {
			if (online) void load();
		};
		window.addEventListener(SKILL_INVENTORY_CHANGED_EVENT, onChanged);
		window.addEventListener("focus", onChanged);
		return () => {
			window.removeEventListener(SKILL_INVENTORY_CHANGED_EVENT, onChanged);
			window.removeEventListener("focus", onChanged);
		};
	}, [load, online]);

	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 py-2" data-testid="workflows-view">
			<div className="mb-2 flex items-center justify-between gap-2">
				<p className="text-[12px] font-medium text-text-primary">{MANAGER_LABELS.shelves.workflows.title}</p>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					disabled={!online || loading}
					icon={<RefreshCw size={12} className={cn(loading && "animate-spin")} />}
					onClick={() => { void load(); }}
					aria-label="Refresh workflows"
				/>
			</div>
			<p className="mb-3 text-[11px] text-text-tertiary">{MANAGER_LABELS.shelves.workflows.description}</p>
			{error ? <p className="mb-2 text-[11px] text-status-red">{error}</p> : null}
			{!online ? (
				<p className="text-[11px] text-text-tertiary">{MANAGER_LABELS.offlineHint}</p>
			) : null}
			{online && workflows && workflows.length === 0 ? (
				<p className="text-[11px] text-text-tertiary">{MANAGER_LABELS.shelves.workflows.empty}</p>
			) : null}
			{workflows && workflows.length > 0 ? (
				<ul className="flex flex-col gap-1">
					{workflows.map((wf) => (
						<li
							key={wf.id}
							className="rounded-md border border-border bg-surface-2 px-2 py-1.5"
							title={wf.description ?? wf.id}
						>
							<div className="truncate text-[12px] text-text-primary">{wf.displayName}</div>
							{wf.description ? (
								<div className="mt-0.5 line-clamp-2 text-[10px] text-text-tertiary">{wf.description}</div>
							) : (
								<div className="mt-0.5 truncate text-[10px] text-text-tertiary">{wf.id}</div>
							)}
						</li>
					))}
				</ul>
			) : null}
		</div>
	);
}
