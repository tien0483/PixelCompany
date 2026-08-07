import { GitMerge, Loader2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { showAppToast } from "@/components/app-toaster";
import { Button } from "@/components/ui/button";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogBody,
	AlertDialogCancel,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	Dialog,
	DialogBody,
	DialogHeader,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import {
	cleanRuntimeMergedWorktrees,
	fetchRuntimeMergeConflicts,
	fetchRuntimeWorktrees,
	resolveRuntimeMergeConflict,
} from "@/runtime/runtime-config-query";
import type {
	RuntimeGitConflictFile,
	RuntimeGitWorktreeEntry,
} from "@/runtime/types";

export function WorktreesDialog({
	open,
	onOpenChange,
	workspaceId,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	workspaceId: string | null;
}): React.ReactElement {
	const [worktrees, setWorktrees] = useState<RuntimeGitWorktreeEntry[] | null>(
		null,
	);
	const [error, setError] = useState<string | null>(null);
	const [isCleaningMerged, setIsCleaningMerged] = useState(false);
	const [isCleanConfirmOpen, setIsCleanConfirmOpen] = useState(false);

	const load = useCallback(async () => {
		setWorktrees(null);
		setError(null);
		const response = await fetchRuntimeWorktrees(workspaceId);
		if (response.ok) {
			setWorktrees(response.worktrees);
		} else {
			setError(response.error ?? "Failed to list worktrees.");
		}
	}, [workspaceId]);

	useEffect(() => {
		if (!open) {
			return;
		}
		void load();
	}, [open, load]);

	const cleanMerged = useCallback(async () => {
		setIsCleaningMerged(true);
		try {
			const response = await cleanRuntimeMergedWorktrees(workspaceId);
			if (!response.ok) {
				showAppToast({
					intent: "danger",
					icon: "warning-sign",
					message: response.error ?? "Failed to clean merged worktrees.",
					timeout: 7000,
				});
				return;
			}
			showAppToast({
				intent: "success",
				icon: "tick",
				message:
					response.cleanedTaskIds.length > 0
						? `Removed ${response.cleanedTaskIds.length} merged worktree${response.cleanedTaskIds.length === 1 ? "" : "s"}.`
						: "No merged worktrees to remove.",
				timeout: 4000,
			});
			await load();
		} finally {
			setIsCleaningMerged(false);
		}
	}, [workspaceId, load]);

	return (
		<Dialog
			open={open}
			onOpenChange={onOpenChange}
			contentClassName="max-w-2xl"
		>
			<DialogHeader title="Worktrees">
				<Button
					variant="default"
					size="sm"
					icon={isCleaningMerged ? <Spinner size={14} /> : <Trash2 size={14} />}
					disabled={isCleaningMerged}
					onClick={() => setIsCleanConfirmOpen(true)}
				>
					Clean merged
				</Button>
			</DialogHeader>
			<DialogBody>
				{error ? (
					<p className="text-[13px] text-status-red">{error}</p>
				) : worktrees === null ? (
					<div className="flex items-center gap-2 text-text-secondary">
						<Loader2 size={14} className="animate-spin" /> Loading…
					</div>
				) : worktrees.length === 0 ? (
					<p className="text-[13px] text-text-secondary">No worktrees found.</p>
				) : (
					<ul className="flex flex-col gap-1">
						{worktrees.map((worktree) => (
							<li
								key={worktree.path}
								className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[12px]"
							>
								<span
									className="min-w-0 flex-1 truncate font-mono text-text-primary"
									title={worktree.path}
								>
									{worktree.path}
								</span>
								<span className="shrink-0 text-text-secondary">
									{worktree.isDetached ? "detached" : (worktree.branch ?? "—")}
								</span>
								{worktree.isMain ? (
									<span className="shrink-0 rounded bg-surface-3 px-1.5 py-0.5 text-[11px] text-text-tertiary">
										main
									</span>
								) : null}
							</li>
						))}
					</ul>
				)}
			</DialogBody>
			<AlertDialog
				open={isCleanConfirmOpen}
				onOpenChange={setIsCleanConfirmOpen}
			>
				<AlertDialogHeader>
					<AlertDialogTitle>Clean merged worktrees?</AlertDialogTitle>
				</AlertDialogHeader>
				<AlertDialogBody>
					<AlertDialogDescription>
						Removes every task worktree whose branch is fully merged into its
						base ref, and deletes that local branch. Worktrees shared with a
						live chain member or not yet merged are left alone.
					</AlertDialogDescription>
				</AlertDialogBody>
				<AlertDialogFooter>
					<AlertDialogCancel asChild>
						<Button
							variant="default"
							onClick={() => setIsCleanConfirmOpen(false)}
						>
							Cancel
						</Button>
					</AlertDialogCancel>
					<AlertDialogAction asChild>
						<Button
							variant="danger"
							onClick={() => {
								setIsCleanConfirmOpen(false);
								void cleanMerged();
							}}
						>
							Clean merged
						</Button>
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialog>
		</Dialog>
	);
}

export function ConflictsDialog({
	open,
	onOpenChange,
	workspaceId,
	onResolved,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	workspaceId: string | null;
	onResolved?: () => void;
}): React.ReactElement {
	const [conflicts, setConflicts] = useState<RuntimeGitConflictFile[] | null>(
		null,
	);
	const [error, setError] = useState<string | null>(null);
	const [resolvingPath, setResolvingPath] = useState<string | null>(null);

	const load = useCallback(async () => {
		setConflicts(null);
		setError(null);
		const response = await fetchRuntimeMergeConflicts(workspaceId);
		if (response.ok) {
			setConflicts(response.conflicts);
		} else {
			setError(response.error ?? "Failed to read merge conflicts.");
		}
	}, [workspaceId]);

	useEffect(() => {
		if (!open) {
			return;
		}
		void load();
	}, [open, load]);

	const resolve = async (
		path: string,
		side: "ours" | "theirs",
	): Promise<void> => {
		setResolvingPath(path);
		const response = await resolveRuntimeMergeConflict(workspaceId, {
			path,
			side,
		});
		setResolvingPath(null);
		if (response.ok) {
			onResolved?.();
			await load();
		} else {
			setError(response.error ?? "Failed to resolve conflict.");
		}
	};

	return (
		<Dialog
			open={open}
			onOpenChange={onOpenChange}
			contentClassName="max-w-2xl"
		>
			<DialogHeader
				title="Resolve merge conflicts"
				icon={<GitMerge size={16} />}
			/>
			<DialogBody>
				{error ? (
					<p className="mb-2 text-[13px] text-status-red">{error}</p>
				) : null}
				{conflicts === null ? (
					<div className="flex items-center gap-2 text-text-secondary">
						<Loader2 size={14} className="animate-spin" /> Loading…
					</div>
				) : conflicts.length === 0 ? (
					<p className="text-[13px] text-text-secondary">
						No unresolved conflicts.
					</p>
				) : (
					<ul className="flex flex-col gap-2">
						{conflicts.map((conflict) => (
							<li
								key={conflict.path}
								className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 py-2 text-[12px]"
							>
								<span
									className="min-w-0 flex-1 truncate font-mono text-text-primary"
									title={conflict.path}
								>
									{conflict.path}
								</span>
								<Button
									variant="default"
									size="sm"
									disabled={resolvingPath === conflict.path}
									onClick={() => void resolve(conflict.path, "ours")}
								>
									Use ours
								</Button>
								<Button
									variant="default"
									size="sm"
									disabled={resolvingPath === conflict.path}
									onClick={() => void resolve(conflict.path, "theirs")}
								>
									Use theirs
								</Button>
							</li>
						))}
					</ul>
				)}
			</DialogBody>
		</Dialog>
	);
}
