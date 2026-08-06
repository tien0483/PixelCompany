import { FileText, FolderOpen, Plus, Trash2 } from "lucide-react";
import { type ReactElement, useCallback, useEffect, useState } from "react";

import { showAppToast } from "@/components/app-toaster";
import { RemoteFileBrowserDialog } from "@/components/remote-file-browser-dialog";
import { cn } from "@/components/ui/cn";
import { Spinner } from "@/components/ui/spinner";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type { RuntimeSavedPlan } from "@/runtime/types";
import { LocalStorageKey, readLocalStorageItem, writeLocalStorageItem } from "@/storage/local-storage-store";

export function HomeSidebarPlansTab({
	active,
	onSelect,
}: {
	active: boolean;
	onSelect: () => void;
}): ReactElement {
	return (
		<button
			type="button"
			data-testid="sidebar-plans-tab"
			onClick={onSelect}
			className={cn(
				"cursor-pointer rounded-sm px-1.5 py-1 text-[11px] font-medium",
				active
					? "bg-surface-4 text-text-primary border border-border"
					: "text-text-secondary hover:text-text-primary border border-transparent",
			)}
		>
			Plans
		</button>
	);
}

export function HomeSidebarPlansPanel({
	workspaceId = null,
	onOpenPlan,
}: {
	workspaceId?: string | null;
	onOpenPlan: (plan: RuntimeSavedPlan) => void;
}): ReactElement {
	const [plans, setPlans] = useState<RuntimeSavedPlan[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [isImporting, setIsImporting] = useState(false);
	const [isBrowserOpen, setIsBrowserOpen] = useState(false);
	const [lastImportFolder, setLastImportFolder] = useState<string | undefined>(
		() => readLocalStorageItem(LocalStorageKey.PlansLastImportFolder) ?? undefined,
	);

	const refreshPlans = useCallback(async () => {
		setIsLoading(true);
		try {
			const trpcClient = getRuntimeTrpcClient(workspaceId);
			const response = await trpcClient.plans.list.query();
			if (!response.ok) {
				showAppToast({
					intent: "danger",
					message: response.error ?? "Failed to load plans.",
				});
				setPlans([]);
				return;
			}
			setPlans(response.plans);
		} catch (error) {
			showAppToast({
				intent: "danger",
				message: error instanceof Error ? error.message : String(error),
			});
			setPlans([]);
		} finally {
			setIsLoading(false);
		}
	}, [workspaceId]);

	useEffect(() => {
		void refreshPlans();
	}, [refreshPlans]);

	const handleImportFolder = useCallback(
		async (folderPath: string) => {
			setIsImporting(true);
			try {
				const trpcClient = getRuntimeTrpcClient(workspaceId);
				const response = await trpcClient.plans.importFromFolder.mutate({ folderPath });
				if (!response.ok) {
					showAppToast({
						intent: "danger",
						message: response.error ?? "Failed to import plans.",
					});
					return;
				}
				const addedCount = response.added.length;
				showAppToast({
					intent: "success",
					message:
						addedCount === 0
							? response.skipped > 0
								? "No new plans (already in library)."
								: "No .md or .txt plans found in that folder."
							: `Added ${addedCount} plan${addedCount === 1 ? "" : "s"}.`,
				});
				await refreshPlans();
			} catch (error) {
				showAppToast({
					intent: "danger",
					message: error instanceof Error ? error.message : String(error),
				});
			} finally {
				setIsImporting(false);
			}
		},
		[refreshPlans, workspaceId],
	);

	const handleImportFile = useCallback(
		async (filePath: string) => {
			setIsImporting(true);
			try {
				const trpcClient = getRuntimeTrpcClient(workspaceId);
				const response = await trpcClient.plans.importFile.mutate({ filePath });
				if (!response.ok) {
					showAppToast({
						intent: "danger",
						message: response.error ?? "Failed to import plan.",
					});
					return;
				}
				showAppToast({
					intent: "success",
					message: response.alreadyExists ? "Already in library." : "Added plan.",
				});
				await refreshPlans();
			} catch (error) {
				showAppToast({
					intent: "danger",
					message: error instanceof Error ? error.message : String(error),
				});
			} finally {
				setIsImporting(false);
			}
		},
		[refreshPlans, workspaceId],
	);

	const handleRemove = useCallback(
		async (planId: string) => {
			try {
				const trpcClient = getRuntimeTrpcClient(workspaceId);
				const response = await trpcClient.plans.remove.mutate({ planId });
				if (!response.ok) {
					showAppToast({
						intent: "danger",
						message: response.error ?? "Failed to remove plan.",
					});
					return;
				}
				await refreshPlans();
			} catch (error) {
				showAppToast({
					intent: "danger",
					message: error instanceof Error ? error.message : String(error),
				});
			}
		},
		[refreshPlans, workspaceId],
	);

	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="sidebar-plans-panel">
			<div className="flex-1 min-h-0 overflow-y-auto overscroll-contain flex flex-col gap-1 px-3 py-1">
				{isLoading ? (
					<div className="flex items-center justify-center py-6">
						<Spinner size={16} />
					</div>
				) : null}

				{!isLoading && plans.length === 0 ? (
					<p className="text-[12px] text-text-tertiary py-3 px-1">
						Add plans from a saved folder to use them when creating tasks. Double-click a plan to edit it.
					</p>
				) : null}

				{plans.map((plan) => (
					<div
						key={plan.id}
						role="button"
						tabIndex={0}
						data-testid={`sidebar-plan-row-${plan.id}`}
						className={cn(
							"group flex cursor-pointer items-start gap-1.5 rounded-md px-2 py-1.5 text-left",
							plan.missing
								? "text-text-tertiary opacity-70"
								: "text-text-secondary hover:bg-surface-3 hover:text-text-primary",
						)}
						onDoubleClick={() => {
							if (plan.missing) {
								return;
							}
							onOpenPlan(plan);
						}}
						onKeyDown={(event) => {
							if (event.key === "Enter" && !plan.missing) {
								onOpenPlan(plan);
							}
						}}
					>
						<FileText size={14} className="mt-0.5 shrink-0" />
						<span className="min-w-0 flex-1">
							<span className="block text-sm truncate">{plan.name}</span>
							<span className="block text-[10px] text-text-tertiary truncate" title={plan.path}>
								{plan.missing ? "Missing — " : ""}
								{plan.path}
							</span>
						</span>
						<button
							type="button"
							aria-label={`Remove ${plan.name}`}
							className="opacity-0 group-hover:opacity-100 text-text-tertiary hover:text-status-red cursor-pointer p-0.5"
							onClick={(event) => {
								event.stopPropagation();
								void handleRemove(plan.id);
							}}
						>
							<Trash2 size={12} />
						</button>
					</div>
				))}

				<button
					type="button"
					className="kb-project-row flex cursor-pointer items-center gap-1.5 rounded-md text-text-secondary hover:text-text-primary px-2 py-1.5 disabled:opacity-40"
					onClick={() => setIsBrowserOpen(true)}
					disabled={isImporting}
					data-testid="sidebar-plans-add-from-folder"
				>
					{isImporting ? <Spinner size={14} /> : <Plus size={14} className="shrink-0" />}
					<span className="text-sm">Add from folder</span>
					<FolderOpen size={12} className="ml-auto opacity-60" />
				</button>
			</div>

			<RemoteFileBrowserDialog
				open={isBrowserOpen}
				onOpenChange={setIsBrowserOpen}
				workspaceId={workspaceId}
				initialPath={lastImportFolder}
				onSelect={(path, type) => {
					setIsBrowserOpen(false);
					if (type === "file") {
						void handleImportFile(path);
						return;
					}
					writeLocalStorageItem(LocalStorageKey.PlansLastImportFolder, path);
					setLastImportFolder(path);
					void handleImportFolder(path);
				}}
			/>
		</div>
	);
}
