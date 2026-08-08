import * as RadixCheckbox from "@radix-ui/react-checkbox";
import { Check, Trash2 } from "lucide-react";
import { type ReactElement, useCallback, useEffect, useState } from "react";

import { notifyError, showAppToast } from "@/components/app-toaster";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import {
	cleanClaudeCache,
	cleanRuntimeMergedWorktrees,
	fetchClaudeCacheStatus,
} from "@/runtime/runtime-config-query";
import type { RuntimeClaudeCacheCleanResponse, RuntimeCleanMergedWorktreesResponse } from "@/runtime/types";

const SAFE_AGE_DAYS = 7;
const PREVIEW_ITEM_LIMIT = 20;

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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
	const [worktreesChecked, setWorktreesChecked] = useState(false);
	const [claudeStatus, setClaudeStatus] = useState<{ safeItemCount: number; safeSizeBytes: number } | null>(null);
	const [worktreeCount, setWorktreeCount] = useState<number | null>(null);
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
				cleanRuntimeMergedWorktrees(workspaceId, { dryRun: true }),
			]);
			if (statusResult.status === "fulfilled") {
				setClaudeStatus(statusResult.value);
			} else {
				notifyError(statusResult.reason instanceof Error ? statusResult.reason.message : String(statusResult.reason));
			}
			if (worktreeResult.status === "fulfilled") {
				setWorktreeCount(worktreeResult.value.cleanedTaskIds.length);
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
			loadStatus();
		}
	}, [open, loadStatus]);

	const handleOpenChange = useCallback(
		(nextOpen: boolean) => {
			onOpenChange(nextOpen);
		},
		[onOpenChange],
	);

	// Any checkbox change invalidates whatever preview was shown before it (the
	// preview reflects a specific combination of checked categories/options, and
	// a stale preview would no longer match what Confirm is about to delete).
	const handleClaudeCheckedChange = useCallback((checked: boolean | "indeterminate") => {
		setClaudeChecked(checked === true);
		setClaudePreview(null);
		setWorktreePreview(null);
	}, []);

	const handleTranscriptsCheckedChange = useCallback((checked: boolean | "indeterminate") => {
		setIncludeTranscripts(checked === true);
		setClaudePreview(null);
		setWorktreePreview(null);
	}, []);

	const handleWorktreesCheckedChange = useCallback((checked: boolean | "indeterminate") => {
		setWorktreesChecked(checked === true);
		setClaudePreview(null);
		setWorktreePreview(null);
	}, []);

	const canPreview = claudeChecked || worktreesChecked;

	const handlePreview = useCallback(() => {
		void (async () => {
			setIsBusy(true);
			try {
				if (claudeChecked) {
					setClaudePreview(
						await cleanClaudeCache(workspaceId, { days: SAFE_AGE_DAYS, includeTranscripts, dryRun: true }),
					);
				}
				if (worktreesChecked) {
					setWorktreePreview(await cleanRuntimeMergedWorktrees(workspaceId, { dryRun: true }));
				}
			} catch (error) {
				notifyError(error instanceof Error ? error.message : String(error));
			} finally {
				setIsBusy(false);
			}
		})();
	}, [claudeChecked, worktreesChecked, includeTranscripts, workspaceId]);

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
				if (claudeChecked) {
					invokedAny = true;
					const result = await cleanClaudeCache(workspaceId, { days: SAFE_AGE_DAYS, includeTranscripts, dryRun: false });
					if (!result.ok) {
						failures.push(result.error ?? "Claude cache cleanup failed");
					}
				}
				if (worktreesChecked) {
					invokedAny = true;
					const result = await cleanRuntimeMergedWorktrees(workspaceId);
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
				setWorktreesChecked(false);
				setIncludeTranscripts(false);
				loadStatus();
			} catch (error) {
				notifyError(error instanceof Error ? error.message : String(error));
			} finally {
				setIsBusy(false);
			}
		})();
	}, [claudeChecked, worktreesChecked, includeTranscripts, workspaceId, loadStatus]);

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
					Claude cache & logs
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
						data-testid="cleanup-worktrees-checkbox"
						checked={worktreesChecked}
						onCheckedChange={handleWorktreesCheckedChange}
						className="flex h-3.5 w-3.5 items-center justify-center rounded-sm border border-border-bright bg-surface-3 data-[state=checked]:bg-accent data-[state=checked]:border-accent"
					>
						<RadixCheckbox.Indicator>
							<Check size={10} className="text-white" />
						</RadixCheckbox.Indicator>
					</RadixCheckbox.Root>
					Merged runtime worktrees
					{worktreeCount !== null ? <span className="text-text-secondary">({worktreeCount} worktrees)</span> : null}
				</label>

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
								Worktrees: {worktreePreview.cleanedTaskIds.length} would be removed.
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
