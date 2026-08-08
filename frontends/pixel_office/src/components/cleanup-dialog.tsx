import * as RadixCheckbox from "@radix-ui/react-checkbox";
import { Check, Trash2 } from "lucide-react";
import { type ReactElement, useCallback, useState } from "react";

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
			try {
				const [status, worktreeDryRun] = await Promise.all([
					fetchClaudeCacheStatus(workspaceId),
					cleanRuntimeMergedWorktrees(workspaceId, { dryRun: true }),
				]);
				setClaudeStatus(status);
				setWorktreeCount(worktreeDryRun.cleanedTaskIds.length);
			} catch (error) {
				notifyError(error instanceof Error ? error.message : String(error));
			}
		})();
	}, [workspaceId]);

	const handleOpenChange = useCallback(
		(nextOpen: boolean) => {
			onOpenChange(nextOpen);
			if (nextOpen) {
				setClaudePreview(null);
				setWorktreePreview(null);
				loadStatus();
			}
		},
		[onOpenChange, loadStatus],
	);

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
				if (claudeChecked) {
					await cleanClaudeCache(workspaceId, { days: SAFE_AGE_DAYS, includeTranscripts, dryRun: false });
				}
				if (worktreesChecked) {
					await cleanRuntimeMergedWorktrees(workspaceId);
				}
				showAppToast({ intent: "success", message: "Cleanup complete" });
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
						onCheckedChange={(checked) => setClaudeChecked(checked === true)}
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
						onCheckedChange={(checked) => setIncludeTranscripts(checked === true)}
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
						onCheckedChange={(checked) => setWorktreesChecked(checked === true)}
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
					<div className="rounded-md border border-border bg-surface-2 p-3 text-xs text-text-secondary">
						<p>Claude cache: {claudePreview.cleaned.length} item(s) would be removed.</p>
					</div>
				) : null}
				{worktreePreview ? (
					<div className="rounded-md border border-border bg-surface-2 p-3 text-xs text-text-secondary">
						<p>Worktrees: {worktreePreview.cleanedTaskIds.length} would be removed.</p>
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
