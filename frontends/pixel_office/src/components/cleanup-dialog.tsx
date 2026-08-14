import * as RadixCheckbox from "@radix-ui/react-checkbox";
import { Check, Trash2 } from "lucide-react";
import { type ReactElement, useCallback, useEffect, useMemo, useState } from "react";

import { notifyError, showAppToast } from "@/components/app-toaster";
import { CleanupWorktreeSection, worktreeEntryKey } from "@/components/cleanup-worktree-section";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import {
	cleanClaudeCache,
	cleanRuntimeMergedWorktrees,
	fetchClaudeCacheStatus,
} from "@/runtime/runtime-config-query";
import type {
	RuntimeClaudeCacheCleanResponse,
	RuntimeCleanMergedWorktreesResponse,
	RuntimeWorktreeReclaimEntry,
} from "@/runtime/types";
import { formatBytes } from "@/utils/format-bytes";

const SAFE_AGE_DAYS = 7;
const PREVIEW_ITEM_LIMIT = 20;
const ALL_WORKTREE_CATEGORIES = ["missing", "merged", "unused", "orphaned", "unregistered"] as const;

export function CleanupDialog({
	open,
	onOpenChange,
	workspaceId,
}: {
	open: boolean;
	onOpenChange: (nextOpen: boolean) => void;
	workspaceId: string | null;
}): ReactElement {
	const [claudeChecked, setClaudeChecked] = useState(false);
	const [includeTranscripts, setIncludeTranscripts] = useState(false);
	const [legacyChecked, setLegacyChecked] = useState(false);
	const [worktreesChecked, setWorktreesChecked] = useState(false);
	const [claudeStatus, setClaudeStatus] = useState<{
		safeItemCount: number;
		safeSizeBytes: number;
		legacyItemCount?: number;
		legacySizeBytes?: number;
	} | null>(null);
	const [worktreeScan, setWorktreeScan] = useState<RuntimeCleanMergedWorktreesResponse | null>(null);
	// Tracks explicit *de*selection rather than selection, so a worktree that shows
	// up in a later rescan is included by default instead of silently dropping out
	// of an otherwise "everything" choice.
	const [deselectedKeys, setDeselectedKeys] = useState<ReadonlySet<string>>(() => new Set());
	const [expandedCategories, setExpandedCategories] = useState<ReadonlySet<string>>(() => new Set());
	const [isBusy, setIsBusy] = useState(false);
	const [claudePreview, setClaudePreview] = useState<RuntimeClaudeCacheCleanResponse | null>(null);
	const [worktreePreview, setWorktreePreview] = useState<RuntimeCleanMergedWorktreesResponse | null>(null);

	const loadStatus = useCallback(() => {
		void (async () => {
			// These two calls are independent: the Claude-cache status is
			// workspace-independent while the worktree dry run is workspace-scoped
			// and can fail/throw when no project is open. Use `allSettled` so a
			// failure on one side doesn't discard a successful result on the other
			// (`Promise.all` would reject as soon as either promise rejected).
			const [statusResult, worktreeResult] = await Promise.allSettled([
				fetchClaudeCacheStatus(workspaceId),
				// Scan every category so the picture is complete; nothing is deleted on
				// a dry run, and what to act on is chosen at Confirm time.
				cleanRuntimeMergedWorktrees(workspaceId, { dryRun: true, categories: [...ALL_WORKTREE_CATEGORIES] }),
			]);
			if (statusResult.status === "fulfilled") {
				setClaudeStatus(statusResult.value);
			} else {
				notifyError(statusResult.reason instanceof Error ? statusResult.reason.message : String(statusResult.reason));
			}
			if (worktreeResult.status === "fulfilled") {
				setWorktreeScan(worktreeResult.value);
			} else {
				notifyError(
					worktreeResult.reason instanceof Error ? worktreeResult.reason.message : String(worktreeResult.reason),
				);
			}
		})();
	}, [workspaceId]);

	useEffect(() => {
		if (open) {
			setClaudePreview(null);
			setWorktreePreview(null);
			setDeselectedKeys(new Set());
			loadStatus();
		}
	}, [open, loadStatus]);

	const handleOpenChange = useCallback(
		(nextOpen: boolean) => {
			onOpenChange(nextOpen);
		},
		[onOpenChange],
	);

	// Any selection change invalidates whatever preview was shown before it (the
	// preview reflects a specific combination of checked categories/options, and
	// a stale preview would no longer match what Confirm is about to delete).
	const invalidatePreview = useCallback(() => {
		setClaudePreview(null);
		setWorktreePreview(null);
	}, []);

	const handleClaudeCheckedChange = useCallback(
		(checked: boolean | "indeterminate") => {
			setClaudeChecked(checked === true);
			invalidatePreview();
		},
		[invalidatePreview],
	);

	const handleTranscriptsCheckedChange = useCallback(
		(checked: boolean | "indeterminate") => {
			setIncludeTranscripts(checked === true);
			invalidatePreview();
		},
		[invalidatePreview],
	);

	const handleLegacyCheckedChange = useCallback(
		(checked: boolean | "indeterminate") => {
			setLegacyChecked(checked === true);
			invalidatePreview();
		},
		[invalidatePreview],
	);

	const handleWorktreesCheckedChange = useCallback(
		(checked: boolean | "indeterminate") => {
			setWorktreesChecked(checked === true);
			setDeselectedKeys(new Set());
			invalidatePreview();
		},
		[invalidatePreview],
	);

	const reclaimable = useMemo(() => worktreeScan?.reclaimable ?? [], [worktreeScan]);

	const selectedEntries = useMemo(
		() => (worktreesChecked ? reclaimable.filter((entry) => !deselectedKeys.has(worktreeEntryKey(entry))) : []),
		[worktreesChecked, reclaimable, deselectedKeys],
	);

	const selectedKeys = useMemo(() => new Set(selectedEntries.map((entry) => worktreeEntryKey(entry))), [selectedEntries]);

	const handleToggleEntry = useCallback(
		(entry: RuntimeWorktreeReclaimEntry, checked: boolean) => {
			setDeselectedKeys((previous) => {
				const next = new Set(previous);
				if (checked) {
					next.delete(worktreeEntryKey(entry));
				} else {
					next.add(worktreeEntryKey(entry));
				}
				return next;
			});
			invalidatePreview();
		},
		[invalidatePreview],
	);

	const handleToggleCategory = useCallback(
		(entries: RuntimeWorktreeReclaimEntry[], checked: boolean) => {
			setDeselectedKeys((previous) => {
				const next = new Set(previous);
				for (const entry of entries) {
					if (checked) {
						next.delete(worktreeEntryKey(entry));
					} else {
						next.add(worktreeEntryKey(entry));
					}
				}
				return next;
			});
			invalidatePreview();
		},
		[invalidatePreview],
	);

	const handleToggleExpanded = useCallback((category: string) => {
		setExpandedCategories((previous) => {
			const next = new Set(previous);
			if (next.has(category)) {
				next.delete(category);
			} else {
				next.add(category);
			}
			return next;
		});
	}, []);

	/**
	 * Narrowing by task id is only sent once the user has actually deselected
	 * something. Sending the full id list unconditionally would silently exclude
	 * anything the server finds that this (possibly stale) scan did not.
	 */
	const buildWorktreeRequest = useCallback(
		(dryRun: boolean) => {
			const categories = [...new Set(selectedEntries.map((entry) => entry.category))];
			return {
				dryRun,
				// No scan data (older server, or the scan failed): fall back to the
				// server's own default rather than asking for "no categories".
				...(reclaimable.length > 0 ? { categories } : {}),
				...(deselectedKeys.size > 0 ? { taskIds: selectedEntries.map((entry) => entry.taskId) } : {}),
			};
		},
		[selectedEntries, reclaimable, deselectedKeys],
	);

	const claudeCacheChecked = claudeChecked || legacyChecked;
	const canPreview = claudeCacheChecked || worktreesChecked;

	const selectedWorktreeBytes = useMemo(
		() => selectedEntries.reduce((sum, entry) => sum + entry.sizeBytes, 0),
		[selectedEntries],
	);
	const totalReclaimBytes =
		selectedWorktreeBytes +
		(claudeChecked ? (claudeStatus?.safeSizeBytes ?? 0) : 0) +
		(legacyChecked ? (claudeStatus?.legacySizeBytes ?? 0) : 0);
	const totalReclaimableWorktreeBytes = useMemo(
		() => reclaimable.reduce((sum, entry) => sum + entry.sizeBytes, 0),
		[reclaimable],
	);

	const handlePreview = useCallback(() => {
		void (async () => {
			setIsBusy(true);
			try {
				if (claudeCacheChecked) {
					setClaudePreview(
						await cleanClaudeCache(workspaceId, {
							days: SAFE_AGE_DAYS,
							includeTranscripts: claudeChecked && includeTranscripts,
							includeSafe: claudeChecked,
							includeLegacy: legacyChecked,
							dryRun: true,
						}),
					);
				}
				if (worktreesChecked) {
					setWorktreePreview(await cleanRuntimeMergedWorktrees(workspaceId, buildWorktreeRequest(true)));
				}
			} catch (error) {
				notifyError(error instanceof Error ? error.message : String(error));
			} finally {
				setIsBusy(false);
			}
		})();
	}, [
		claudeCacheChecked,
		claudeChecked,
		legacyChecked,
		worktreesChecked,
		includeTranscripts,
		workspaceId,
		buildWorktreeRequest,
	]);

	const handleConfirm = useCallback(() => {
		void (async () => {
			setIsBusy(true);
			try {
				// Both backends report failure via `{ ok: false, error }` rather than
				// throwing, so a resolved promise is not itself proof of success —
				// only report "Cleanup complete" once every response we actually
				// invoked (for a checked category) came back `ok: true`.
				const failures: string[] = [];
				let invokedAny = false;
				if (claudeCacheChecked) {
					invokedAny = true;
					const result = await cleanClaudeCache(workspaceId, {
						days: SAFE_AGE_DAYS,
						includeTranscripts: claudeChecked && includeTranscripts,
						includeSafe: claudeChecked,
						includeLegacy: legacyChecked,
						dryRun: false,
					});
					if (!result.ok) {
						failures.push(result.error ?? "Claude cache cleanup failed");
					}
				}
				if (worktreesChecked) {
					invokedAny = true;
					const result = await cleanRuntimeMergedWorktrees(workspaceId, buildWorktreeRequest(false));
					if (!result.ok) {
						failures.push(result.error ?? "Worktree cleanup failed");
					}
				}
				if (failures.length > 0) {
					notifyError(failures.join(" "));
				} else if (invokedAny) {
					showAppToast({ intent: "success", message: "Cleanup complete" });
				}
				setClaudePreview(null);
				setWorktreePreview(null);
				setClaudeChecked(false);
				setLegacyChecked(false);
				setWorktreesChecked(false);
				setIncludeTranscripts(false);
				setDeselectedKeys(new Set());
				loadStatus();
			} catch (error) {
				notifyError(error instanceof Error ? error.message : String(error));
			} finally {
				setIsBusy(false);
			}
		})();
	}, [
		claudeCacheChecked,
		claudeChecked,
		legacyChecked,
		worktreesChecked,
		includeTranscripts,
		workspaceId,
		buildWorktreeRequest,
		loadStatus,
	]);

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogHeader title="Cleanup" icon={<Trash2 size={16} />} />
			<DialogBody className="space-y-4">
				<label className="flex items-center gap-2 text-[13px] text-text-primary cursor-pointer select-none">
					<RadixCheckbox.Root
						data-testid="cleanup-claude-checkbox"
						checked={claudeChecked}
						onCheckedChange={handleClaudeCheckedChange}
						className="flex h-3.5 w-3.5 items-center justify-center rounded-sm border border-border-bright bg-surface-3 data-[state=checked]:bg-accent data-[state=checked]:border-accent"
					>
						<RadixCheckbox.Indicator>
							<Check size={10} className="text-white" />
						</RadixCheckbox.Indicator>
					</RadixCheckbox.Root>
					Claude cache &amp; logs
					{claudeStatus ? (
						<span className="text-text-secondary">
							({claudeStatus.safeItemCount} items, {formatBytes(claudeStatus.safeSizeBytes)})
						</span>
					) : null}
				</label>
				<label className="ml-6 flex items-center gap-2 text-[12px] text-text-secondary cursor-pointer select-none data-[disabled]:opacity-40 data-[disabled]:cursor-default">
					<RadixCheckbox.Root
						data-testid="cleanup-transcripts-checkbox"
						checked={includeTranscripts}
						disabled={!claudeChecked}
						data-disabled={!claudeChecked ? "" : undefined}
						onCheckedChange={handleTranscriptsCheckedChange}
						className="flex h-3.5 w-3.5 items-center justify-center rounded-sm border border-border-bright bg-surface-3 data-[state=checked]:bg-accent data-[state=checked]:border-accent disabled:cursor-default disabled:opacity-40"
					>
						<RadixCheckbox.Indicator>
							<Check size={10} className="text-white" />
						</RadixCheckbox.Indicator>
					</RadixCheckbox.Root>
					Include session transcripts
				</label>
				<label className="flex items-center gap-2 text-[13px] text-text-primary cursor-pointer select-none">
					<RadixCheckbox.Root
						data-testid="cleanup-legacy-checkbox"
						checked={legacyChecked}
						onCheckedChange={handleLegacyCheckedChange}
						className="flex h-3.5 w-3.5 items-center justify-center rounded-sm border border-border-bright bg-surface-3 data-[state=checked]:bg-accent data-[state=checked]:border-accent"
					>
						<RadixCheckbox.Indicator>
							<Check size={10} className="text-white" />
						</RadixCheckbox.Indicator>
					</RadixCheckbox.Root>
					Legacy leftovers
					{claudeStatus?.legacyItemCount !== undefined ? (
						<span className="text-text-secondary">
							({claudeStatus.legacyItemCount} items, {formatBytes(claudeStatus.legacySizeBytes ?? 0)})
						</span>
					) : null}
				</label>
				<p className="ml-6 -mt-2 text-[11px] text-text-tertiary">
					Old runtime home and CLI caches for worktrees that no longer exist.
				</p>
				<label className="flex items-center gap-2 text-[13px] text-text-primary cursor-pointer select-none">
					<RadixCheckbox.Root
						data-testid="cleanup-worktrees-checkbox"
						checked={worktreesChecked}
						onCheckedChange={handleWorktreesCheckedChange}
						className="flex h-3.5 w-3.5 items-center justify-center rounded-sm border border-border-bright bg-surface-3 data-[state=checked]:bg-accent data-[state=checked]:border-accent"
					>
						<RadixCheckbox.Indicator>
							<Check size={10} className="text-white" />
						</RadixCheckbox.Indicator>
					</RadixCheckbox.Root>
					Task worktrees
					<span className="text-text-secondary">
						({reclaimable.length} reclaimable, {formatBytes(totalReclaimableWorktreeBytes)})
					</span>
				</label>
				{worktreesChecked ? (
					<CleanupWorktreeSection
						reclaimable={reclaimable}
						kept={worktreeScan?.skipped ?? []}
						selectedKeys={selectedKeys}
						expandedCategories={expandedCategories}
						onToggleEntry={handleToggleEntry}
						onToggleCategory={handleToggleCategory}
						onToggleExpanded={handleToggleExpanded}
					/>
				) : null}

				{claudePreview ? (
					<div className="rounded-md border border-border bg-surface-2 p-3 text-xs text-text-secondary space-y-2">
						<div>
							<p className="text-text-primary">
								Claude cache: {claudePreview.cleaned.length} item(s) would be removed.
							</p>
							<ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto">
								{claudePreview.cleaned.slice(0, PREVIEW_ITEM_LIMIT).map((item) => (
									<li key={item.path} className="truncate" title={item.path}>
										{item.path} ({formatBytes(item.sizeBytes)})
									</li>
								))}
								{claudePreview.cleaned.length > PREVIEW_ITEM_LIMIT ? (
									<li>+{claudePreview.cleaned.length - PREVIEW_ITEM_LIMIT} more</li>
								) : null}
							</ul>
						</div>
						{claudePreview.skipped.length > 0 ? (
							<div>
								<p className="text-text-primary">Skipped ({claudePreview.skipped.length}):</p>
								<ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto">
									{claudePreview.skipped.slice(0, PREVIEW_ITEM_LIMIT).map((item) => (
										<li key={item.path} className="truncate" title={item.path}>
											{item.path} — kept, because {item.reason}
										</li>
									))}
									{claudePreview.skipped.length > PREVIEW_ITEM_LIMIT ? (
										<li>+{claudePreview.skipped.length - PREVIEW_ITEM_LIMIT} more</li>
									) : null}
								</ul>
							</div>
						) : null}
					</div>
				) : null}
				{worktreePreview ? (
					<div className="rounded-md border border-border bg-surface-2 p-3 text-xs text-text-secondary space-y-2">
						<div>
							<p className="text-text-primary">
								Worktrees: {worktreePreview.cleanedTaskIds.length} would be removed
								{worktreePreview.reclaimableBytes ? ` (${formatBytes(worktreePreview.reclaimableBytes)})` : ""}.
							</p>
							<ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto">
								{worktreePreview.cleanedTaskIds.slice(0, PREVIEW_ITEM_LIMIT).map((taskId) => (
									<li key={taskId} className="truncate" title={taskId}>
										{taskId}
									</li>
								))}
								{worktreePreview.cleanedTaskIds.length > PREVIEW_ITEM_LIMIT ? (
									<li>+{worktreePreview.cleanedTaskIds.length - PREVIEW_ITEM_LIMIT} more</li>
								) : null}
							</ul>
						</div>
						{worktreePreview.skipped.length > 0 ? (
							<div>
								<p className="text-text-primary">Skipped ({worktreePreview.skipped.length}):</p>
								<ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto">
									{worktreePreview.skipped.slice(0, PREVIEW_ITEM_LIMIT).map((item) => (
										<li key={item.taskId} className="truncate" title={item.branch || item.taskId}>
											{item.branch || item.taskId} — kept, because {item.reason}
										</li>
									))}
									{worktreePreview.skipped.length > PREVIEW_ITEM_LIMIT ? (
										<li>+{worktreePreview.skipped.length - PREVIEW_ITEM_LIMIT} more</li>
									) : null}
								</ul>
							</div>
						) : null}
					</div>
				) : null}
			</DialogBody>
			<DialogFooter>
				<span className="mr-auto text-[12px] text-text-secondary" data-testid="cleanup-total-estimate">
					{totalReclaimBytes > 0 ? `Reclaims ~${formatBytes(totalReclaimBytes)}` : "Nothing selected"}
				</span>
				<Button variant="default" onClick={() => handleOpenChange(false)} disabled={isBusy}>
					Close
				</Button>
				<Button
					data-testid="cleanup-preview-button"
					variant="default"
					disabled={!canPreview || isBusy}
					icon={isBusy ? <Spinner size={12} /> : undefined}
					onClick={handlePreview}
				>
					Preview
				</Button>
				<Button
					data-testid="cleanup-confirm-button"
					variant="danger"
					disabled={!canPreview || isBusy}
					icon={isBusy ? <Spinner size={12} /> : undefined}
					onClick={handleConfirm}
				>
					Confirm delete
				</Button>
			</DialogFooter>
		</Dialog>
	);
}
