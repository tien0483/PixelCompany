import { FileText, FolderOpen, Plus, Trash2 } from "lucide-react";
import { type ReactElement, useCallback, useEffect, useState } from "react";

import { showAppToast } from "@/components/app-toaster";
import { RemoteFileBrowserDialog } from "@/components/remote-file-browser-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogBody,
	AlertDialogCancel,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/dialog";
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
	const [isClearDialogOpen, setIsClearDialogOpen] = useState(false);
	const [isClearing, setIsClearing] = useState(false);
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
								: "No .md, .txt, or .html files directly in that folder — subfolders are not scanned."
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

	const handleImportFiles = useCallback(
		async (filePaths: string[]) => {
			if (filePaths.length === 0) {
				return;
			}
			setIsImporting(true);
			try {
				const trpcClient = getRuntimeTrpcClient(workspaceId);
				let added = 0;
				let alreadyPresent = 0;
				const failures: string[] = [];
				for (const filePath of filePaths) {
					const response = await trpcClient.plans.importFile.mutate({ filePath });
					if (!response.ok) {
						failures.push(response.error ?? `Failed to import ${filePath}.`);
						continue;
					}
					if (response.alreadyExists) {
						alreadyPresent += 1;
					} else {
						added += 1;
					}
				}
				if (failures.length > 0) {
					showAppToast({ intent: "danger", message: failures.join(" ") });
				}
				if (added > 0) {
					showAppToast({ intent: "success", message: `Added ${added} plan${added === 1 ? "" : "s"}.` });
				} else if (alreadyPresent > 0 && failures.length === 0) {
					showAppToast({ intent: "success", message: "Already in library." });
				}
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

	const handleClearAll = useCallback(async () => {
		setIsClearing(true);
		try {
			const trpcClient = getRuntimeTrpcClient(workspaceId);
			const response = await trpcClient.plans.clearAll.mutate();
			if (!response.ok) {
				showAppToast({
					intent: "danger",
					message: response.error ?? "Failed to clear registered plans.",
				});
				return;
			}
			const count = response.clearedCount ?? 0;
			showAppToast({
				intent: "success",
				message: `Cleared ${count} registered plan${count === 1 ? "" : "s"}.`,
			});
			setIsClearDialogOpen(false);
			await refreshPlans();
		} catch (error) {
			showAppToast({
				intent: "danger",
				message: error instanceof Error ? error.message : String(error),
			});
		} finally {
			setIsClearing(false);
		}
	}, [refreshPlans, workspaceId]);

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
					data-testid="sidebar-plans-add"
				>
					{isImporting ? <Spinner size={14} /> : <Plus size={14} className="shrink-0" />}
					<span className="text-sm">Add plan…</span>
					<FolderOpen size={12} className="ml-auto opacity-60" />
				</button>

				{plans.length > 0 ? (
					<button
						type="button"
						className="kb-project-row flex cursor-pointer items-center gap-1.5 rounded-md text-text-secondary hover:text-status-red px-2 py-1.5 disabled:opacity-40"
						onClick={() => setIsClearDialogOpen(true)}
						disabled={isLoading || isClearing}
						data-testid="sidebar-plans-clear-all"
					>
						{isClearing ? <Spinner size={14} /> : <Trash2 size={14} className="shrink-0" />}
						<span className="text-sm">Clear all plans</span>
					</button>
				) : null}
			</div>

			<AlertDialog
				open={isClearDialogOpen}
				onOpenChange={(open) => {
					if (!isClearing) {
						setIsClearDialogOpen(open);
					}
				}}
			>
				<AlertDialogHeader>
					<AlertDialogTitle>Clear all registered plans?</AlertDialogTitle>
				</AlertDialogHeader>
				<AlertDialogBody>
					<AlertDialogDescription>
						This will remove all {plans.length} registered plan{plans.length === 1 ? "" : "s"} from the plan editor library. The actual files on disk will not be deleted.
					</AlertDialogDescription>
				</AlertDialogBody>
				<AlertDialogFooter>
					<AlertDialogCancel asChild>
						<Button variant="default" disabled={isClearing} onClick={() => setIsClearDialogOpen(false)}>
							Cancel
						</Button>
					</AlertDialogCancel>
					<AlertDialogAction asChild>
						<Button
							variant="danger"
							disabled={isClearing}
							onClick={(event) => {
								event.preventDefault();
								void handleClearAll();
							}}
							data-testid="sidebar-plans-confirm-clear"
						>
							{isClearing ? <Spinner size={14} /> : null}
							Clear all
						</Button>
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialog>

			{/*
			 * The browser handles both shapes of import, so it replaces the native folder
			 * dialog entirely: that dialog can only ever return a directory, which left
			 * single-file import unreachable on any machine that had one installed.
			 */}
			<RemoteFileBrowserDialog
				open={isBrowserOpen}
				onOpenChange={setIsBrowserOpen}
				workspaceId={workspaceId}
				initialPath={lastImportFolder}
				multiSelectFiles
				selectLabel="Import"
				onSelect={(path, type) => {
					setIsBrowserOpen(false);
					if (type === "file") {
						void handleImportFiles([path]);
						return;
					}
					writeLocalStorageItem(LocalStorageKey.PlansLastImportFolder, path);
					setLastImportFolder(path);
					void handleImportFolder(path);
				}}
				onSelectFiles={(paths) => {
					setIsBrowserOpen(false);
					void handleImportFiles(paths);
				}}
			/>
		</div>
	);
}
