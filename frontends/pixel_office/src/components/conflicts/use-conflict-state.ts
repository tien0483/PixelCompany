import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
	abortRuntimeConflictOperation,
	continueRuntimeConflictOperation,
	fetchRuntimeConflictState,
	fetchRuntimeMergeConflicts,
	resolveRuntimeMergeConflict,
	skipRuntimeRebaseCommit,
} from "@/runtime/runtime-config-query";
import type {
	RuntimeGitConflictFile,
	RuntimeGitConflictOperationResponse,
	RuntimeGitConflictScope,
	RuntimeGitConflictSide,
	RuntimeGitConflictWorktree,
	RuntimeGitPendingOperation,
} from "@/runtime/types";

export interface ConflictStateController {
	/** Every worktree of the repo stopped mid-operation, newest fetch. */
	stoppedWorktrees: RuntimeGitConflictWorktree[] | null;
	/** Which of them the dialog is showing. Null until one is resolved/selected. */
	activeWorktreePath: string | null;
	selectWorktree: (worktreePath: string) => void;
	operation: RuntimeGitPendingOperation | null;
	autostashHeld: boolean;
	conflicts: RuntimeGitConflictFile[] | null;
	error: string | null;
	isBusy: boolean;
	resolvingPath: string | null;
	reload: () => Promise<void>;
	resolveFile: (path: string, side: RuntimeGitConflictSide, content?: string) => Promise<boolean>;
	continueOperation: () => Promise<boolean>;
	abortOperation: () => Promise<boolean>;
	skipCommit: () => Promise<boolean>;
}

/**
 * Owns everything the resolve-conflicts dialog needs: which worktree holds the
 * unfinished operation, its conflicted files, and the four mutations.
 *
 * The scope matters more than it looks. A conflict can be sitting in the home repo,
 * in a task worktree, or in a borrowed base checkout that only exists to hold a
 * merge into a base ref nobody had checked out — so the dialog asks
 * `getConflictState` where to look rather than assuming the workspace path, which
 * is what made it report "no unresolved conflicts" forever.
 */
export function useConflictState({
	workspaceId,
	enabled,
	preferredScope,
}: {
	workspaceId: string | null;
	enabled: boolean;
	/** The selected card's worktree, when the dialog opens from a card. */
	preferredScope?: RuntimeGitConflictScope | null;
}): ConflictStateController {
	const [stoppedWorktrees, setStoppedWorktrees] = useState<RuntimeGitConflictWorktree[] | null>(null);
	const [selectedWorktreePath, setSelectedWorktreePath] = useState<string | null>(null);
	const [conflicts, setConflicts] = useState<RuntimeGitConflictFile[] | null>(null);
	const [operation, setOperation] = useState<RuntimeGitPendingOperation | null>(null);
	const [autostashHeld, setAutostashHeld] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [isBusy, setIsBusy] = useState(false);
	const [resolvingPath, setResolvingPath] = useState<string | null>(null);

	const preferredTaskInfo = preferredScope?.taskInfo ?? null;
	const preferredWorktreePath = preferredScope?.worktreePath ?? null;

	// `reload` both reads and writes the selection, so it holds it through a ref
	// rather than a dependency — depending on state it sets would re-arm the effect
	// below on every fetch.
	const selectedWorktreePathRef = useRef<string | null>(null);
	selectedWorktreePathRef.current = selectedWorktreePath;

	const reload = useCallback(async () => {
		setError(null);
		const stateResponse = await fetchRuntimeConflictState(workspaceId);
		if (!stateResponse.ok) {
			setStoppedWorktrees([]);
			setConflicts([]);
			setOperation(null);
			setError(stateResponse.error ?? "Failed to look for unfinished merges.");
			return;
		}
		setStoppedWorktrees(stateResponse.worktrees);

		// Prefer whatever the caller pointed at, then a still-valid selection, then
		// the first stopped worktree — so resolving the last file in one worktree
		// moves the dialog on instead of blanking.
		const candidatePaths = [preferredWorktreePath, selectedWorktreePathRef.current].filter(
			(candidate): candidate is string => candidate !== null,
		);
		const nextWorktree =
			stateResponse.worktrees.find((entry) => candidatePaths.includes(entry.worktreePath)) ??
			stateResponse.worktrees[0] ??
			null;

		if (!nextWorktree) {
			setSelectedWorktreePath(null);
			setConflicts([]);
			setOperation(null);
			setAutostashHeld(false);
			return;
		}

		setSelectedWorktreePath(nextWorktree.worktreePath);
		const conflictsResponse = await fetchRuntimeMergeConflicts(workspaceId, {
			worktreePath: nextWorktree.worktreePath,
		});
		if (!conflictsResponse.ok) {
			setConflicts([]);
			setError(conflictsResponse.error ?? "Failed to read merge conflicts.");
			return;
		}
		setConflicts(conflictsResponse.conflicts);
		setOperation(conflictsResponse.operation);
		setAutostashHeld(conflictsResponse.autostashHeld);
	}, [preferredWorktreePath, workspaceId]);

	useEffect(() => {
		if (!enabled) {
			return;
		}
		void reload();
	}, [enabled, reload, preferredTaskInfo?.taskId]);

	const activeScope = useMemo<RuntimeGitConflictScope | null>(
		() => (selectedWorktreePath ? { worktreePath: selectedWorktreePath } : null),
		[selectedWorktreePath],
	);

	const runOperation = useCallback(
		async (
			operationCall: (scope: RuntimeGitConflictScope) => Promise<RuntimeGitConflictOperationResponse>,
		): Promise<boolean> => {
			if (!activeScope) {
				return false;
			}
			setIsBusy(true);
			try {
				const response = await operationCall(activeScope);
				if (!response.ok) {
					setError(response.error ?? "The git operation failed.");
				}
				await reload();
				return response.ok;
			} finally {
				setIsBusy(false);
			}
		},
		[activeScope, reload],
	);

	const resolveFile = useCallback(
		async (path: string, side: RuntimeGitConflictSide, content?: string): Promise<boolean> => {
			if (!activeScope) {
				return false;
			}
			setResolvingPath(path);
			try {
				const response = await resolveRuntimeMergeConflict(workspaceId, {
					...activeScope,
					path,
					side,
					...(content === undefined ? {} : { content }),
				});
				if (!response.ok) {
					setError(response.error ?? "Failed to resolve conflict.");
					return false;
				}
				await reload();
				return true;
			} finally {
				setResolvingPath(null);
			}
		},
		[activeScope, reload, workspaceId],
	);

	return {
		stoppedWorktrees,
		activeWorktreePath: selectedWorktreePath,
		selectWorktree: setSelectedWorktreePath,
		operation,
		autostashHeld,
		conflicts,
		error,
		isBusy,
		resolvingPath,
		reload,
		resolveFile,
		continueOperation: useCallback(
			() => runOperation((scope) => continueRuntimeConflictOperation(workspaceId, scope)),
			[runOperation, workspaceId],
		),
		abortOperation: useCallback(
			() => runOperation((scope) => abortRuntimeConflictOperation(workspaceId, scope)),
			[runOperation, workspaceId],
		),
		skipCommit: useCallback(
			() => runOperation((scope) => skipRuntimeRebaseCommit(workspaceId, scope)),
			[runOperation, workspaceId],
		),
	};
}
