import { Archive, Check, GitMerge, Loader2, SkipForward, X } from "lucide-react";

import { ConflictFileResolver } from "@/components/conflicts/conflict-file-resolver";
import { useConflictState } from "@/components/conflicts/use-conflict-state";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Dialog, DialogBody, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import type { RuntimeGitConflictScope, RuntimeGitPendingOperation } from "@/runtime/types";

const OPERATION_LABEL: Record<RuntimeGitPendingOperation, string> = {
	merge: "Merge",
	rebase: "Rebase",
	"cherry-pick": "Cherry-pick",
};

/** What finishing the operation is called, since only a merge is "committed". */
const CONTINUE_LABEL: Record<RuntimeGitPendingOperation, string> = {
	merge: "Commit merge",
	rebase: "Continue rebase",
	"cherry-pick": "Finish cherry-pick",
};

export function ConflictsDialog({
	open,
	onOpenChange,
	workspaceId,
	scope,
	onResolved,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	workspaceId: string | null;
	/** Where to look first — the selected card's worktree, or a path from a failed merge. */
	scope?: RuntimeGitConflictScope | null;
	onResolved?: () => void;
}): React.ReactElement {
	const controller = useConflictState({ workspaceId, enabled: open, preferredScope: scope });
	const {
		stoppedWorktrees,
		activeWorktreePath,
		selectWorktree,
		operation,
		autostashHeld,
		conflicts,
		error,
		isBusy,
		resolvingPath,
	} = controller;

	const unresolvedCount = conflicts?.length ?? 0;
	const isLoading = stoppedWorktrees === null || conflicts === null;
	const activeWorktree = stoppedWorktrees?.find((entry) => entry.worktreePath === activeWorktreePath) ?? null;

	const runAndNotify = async (action: () => Promise<boolean>): Promise<void> => {
		if (await action()) {
			onResolved?.();
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange} size="lg">
			<DialogHeader title="Resolve merge conflicts" icon={<GitMerge size={16} />} />
			<DialogBody>
				{error ? <p className="mb-2 text-[13px] text-status-red">{error}</p> : null}

				{isLoading ? (
					<div className="flex items-center gap-2 text-text-secondary">
						<Loader2 size={14} className="animate-spin" /> Loading…
					</div>
				) : !operation ? (
					<p className="text-[13px] text-text-secondary">
						No unfinished merge, rebase or cherry-pick in this project.
					</p>
				) : (
					<div className="flex flex-col gap-3">
						{/* More than one worktree can be stopped at once — a task worktree
						    mid-rebase and a borrowed base checkout mid-merge, say. */}
						{stoppedWorktrees && stoppedWorktrees.length > 1 ? (
							<div className="flex flex-wrap gap-1.5">
								{stoppedWorktrees.map((entry) => (
									<button
										key={entry.worktreePath}
										type="button"
										title={entry.worktreePath}
										className={cn(
											"rounded-md border px-2 py-1 text-[11px]",
											entry.worktreePath === activeWorktreePath
												? "border-accent bg-surface-3 text-text-primary"
												: "border-border bg-surface-2 text-text-secondary hover:bg-surface-3",
										)}
										onClick={() => selectWorktree(entry.worktreePath)}
									>
										{OPERATION_LABEL[entry.operation]} ·{" "}
										{entry.branch ?? entry.worktreePath.split("/").at(-1) ?? "detached"} (
										{entry.conflictedPaths.length})
									</button>
								))}
							</div>
						) : null}

						<div className="rounded-md border border-border bg-surface-1 px-2.5 py-2 text-[12px]">
							<p className="text-text-primary">
								{OPERATION_LABEL[operation]} in progress
								{activeWorktree?.branch ? ` on ${activeWorktree.branch}` : ""} ·{" "}
								{unresolvedCount === 0
									? "all files resolved"
									: `${String(unresolvedCount)} file${unresolvedCount === 1 ? "" : "s"} to resolve`}
							</p>
							{activeWorktreePath ? (
								<p className="mt-0.5 truncate font-mono text-[11px] text-text-tertiary" title={activeWorktreePath}>
									{activeWorktreePath}
									{activeWorktree?.isConflictWorktree ? " (borrowed for this merge)" : ""}
								</p>
							) : null}
							{autostashHeld ? (
								<p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-status-orange">
									<Archive size={12} className="mt-0.5 shrink-0" aria-hidden />
									{/* Measured on git 2.34.1: the entry comes back on commit,
									    on --continue and on --abort alike, so this is
									    reassurance rather than a warning. */}
									<span>
										Your uncommitted changes are stashed while this runs. Git puts them back when you finish or
										abort.
									</span>
								</p>
							) : null}
						</div>

						{unresolvedCount === 0 ? (
							<p className="text-[13px] text-text-secondary">
								Every conflict is resolved. {CONTINUE_LABEL[operation]} to finish.
							</p>
						) : (
							<ul className="flex flex-col gap-2">
								{conflicts.map((conflict) => (
									<ConflictFileResolver
										key={conflict.path}
										conflict={conflict}
										operation={operation}
										isResolving={resolvingPath === conflict.path}
										onResolve={(path, side, content) => {
											void runAndNotify(() => controller.resolveFile(path, side, content));
										}}
									/>
								))}
							</ul>
						)}
					</div>
				)}
			</DialogBody>
			{operation ? (
				<DialogFooter>
					<Button
						variant="danger"
						icon={<X size={14} />}
						disabled={isBusy}
						onClick={() => {
							void runAndNotify(controller.abortOperation);
						}}
					>
						Abort {OPERATION_LABEL[operation].toLowerCase()}
					</Button>
					{operation === "rebase" ? (
						<Button
							variant="default"
							icon={<SkipForward size={14} />}
							disabled={isBusy}
							onClick={() => {
								void runAndNotify(controller.skipCommit);
							}}
						>
							Skip this commit
						</Button>
					) : null}
					<Button
						variant="primary"
						icon={isBusy ? <Spinner size={14} /> : <Check size={14} />}
						disabled={isBusy || unresolvedCount > 0}
						onClick={() => {
							void runAndNotify(controller.continueOperation);
						}}
					>
						{CONTINUE_LABEL[operation]}
					</Button>
				</DialogFooter>
			) : null}
		</Dialog>
	);
}
