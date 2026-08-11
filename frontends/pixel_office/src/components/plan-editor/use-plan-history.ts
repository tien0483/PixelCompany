import { useCallback, useEffect, useMemo, useState } from "react";

import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type { RuntimePlanHistoryEntry, RuntimePlanHistoryLabel, RuntimePlanHistoryTarget } from "@/runtime/types";

export interface PlanHistoryRestore {
	target: RuntimePlanHistoryTarget;
	content: string;
}

export interface UsePlanHistoryResult {
	/** False when the runtime has no `git` to store versions in; the UI hides itself then. */
	available: boolean;
	entries: RuntimePlanHistoryEntry[];
	/** Versions of the document the editor is currently showing, newest last. */
	targetEntries: RuntimePlanHistoryEntry[];
	canUndo: boolean;
	canRedo: boolean;
	refresh: () => Promise<void>;
	/** All three resolve `null` when there was nothing to move to — a no-op, not a failure. */
	undo: () => Promise<PlanHistoryRestore | null>;
	redo: () => Promise<PlanHistoryRestore | null>;
	restore: (entryId: string) => Promise<PlanHistoryRestore | null>;
	/** Unified diff from a recorded version to the file as it stands now. */
	diff: (entryId: string) => Promise<{ diff: string; changed: boolean } | null>;
	/** Records the current bytes under an explicit label — used at AI milestones. */
	mark: (target: RuntimePlanHistoryTarget, label: RuntimePlanHistoryLabel) => Promise<void>;
}

/**
 * The editor's window onto a plan's version history (`state/plan-history.ts`).
 *
 * Undo/redo are per document, because the markdown and its generated page move independently: a
 * Refine produces a new page without touching the requirement, and typing does the reverse.
 */
export function usePlanHistory(
	planId: string | null,
	workspaceId: string | null | undefined,
	target: RuntimePlanHistoryTarget,
): UsePlanHistoryResult {
	const [available, setAvailable] = useState(false);
	const [entries, setEntries] = useState<RuntimePlanHistoryEntry[]>([]);
	const [cursor, setCursor] = useState<{
		md: string | null;
		html: string | null;
	}>({ md: null, html: null });

	const client = useCallback(() => getRuntimeTrpcClient(workspaceId ?? null), [workspaceId]);

	const refresh = useCallback(async () => {
		if (!planId) {
			setEntries([]);
			return;
		}
		try {
			const response = await client().plans.historyList.query({ planId });
			setAvailable(response.available);
			setEntries(response.entries);
			setCursor(response.cursor);
		} catch {
			// History is an extra: a failed read leaves the controls hidden rather than shouting.
			setAvailable(false);
			setEntries([]);
		}
	}, [client, planId]);

	useEffect(() => {
		setEntries([]);
		setCursor({ md: null, html: null });
		void refresh();
	}, [refresh]);

	const targetEntries = useMemo(() => entries.filter((entry) => entry.target === target), [entries, target]);

	const cursorIndex = useMemo(() => {
		const cursorId = cursor[target];
		if (cursorId === null) {
			// No cursor yet means the newest version is what is on disk.
			return targetEntries.length - 1;
		}
		const index = targetEntries.findIndex((entry) => entry.id === cursorId);
		return index === -1 ? targetEntries.length - 1 : index;
	}, [cursor, target, targetEntries]);

	const applyMaterialization = useCallback(
		(response: {
			entry: RuntimePlanHistoryEntry | null;
			target: RuntimePlanHistoryTarget | null;
			content: string | null;
		}): PlanHistoryRestore | null => {
			if (!response.entry || response.target === null || response.content === null) {
				return null;
			}
			setCursor((previous) => ({
				...previous,
				[response.target as RuntimePlanHistoryTarget]: response.entry?.id ?? null,
			}));
			return { target: response.target, content: response.content };
		},
		[],
	);

	const move = useCallback(
		async (direction: "undo" | "redo"): Promise<PlanHistoryRestore | null> => {
			if (!planId) {
				return null;
			}
			const response =
				direction === "undo"
					? await client().plans.historyUndo.mutate({ planId, target })
					: await client().plans.historyRedo.mutate({ planId, target });
			if (!response.ok) {
				throw new Error(response.error ?? "Could not move through the version history.");
			}
			const restored = applyMaterialization(response);
			await refresh();
			return restored;
		},
		[applyMaterialization, client, planId, refresh, target],
	);

	const undo = useCallback(() => move("undo"), [move]);
	const redo = useCallback(() => move("redo"), [move]);

	const restore = useCallback(
		async (entryId: string): Promise<PlanHistoryRestore | null> => {
			if (!planId) {
				return null;
			}
			const response = await client().plans.historyRestore.mutate({
				planId,
				entryId,
			});
			if (!response.ok) {
				throw new Error(response.error ?? "Could not restore that version.");
			}
			const restored = applyMaterialization(response);
			await refresh();
			return restored;
		},
		[applyMaterialization, client, planId, refresh],
	);

	const diff = useCallback(
		async (entryId: string) => {
			if (!planId) {
				return null;
			}
			const response = await client().plans.historyDiff.query({
				planId,
				entryId,
			});
			if (!response.ok) {
				throw new Error(response.error ?? "Could not diff that version.");
			}
			return { diff: response.diff, changed: response.changed };
		},
		[client, planId],
	);

	const mark = useCallback(
		async (markTarget: RuntimePlanHistoryTarget, label: RuntimePlanHistoryLabel) => {
			if (!planId) {
				return;
			}
			try {
				await client().plans.historyMark.mutate({
					planId,
					target: markTarget,
					label,
				});
				await refresh();
			} catch {
				// A missing history marker is not worth interrupting the run the user just made.
			}
		},
		[client, planId, refresh],
	);

	return {
		available,
		entries,
		targetEntries,
		canUndo: targetEntries.length > 0 && cursorIndex > 0,
		canRedo: targetEntries.length > 0 && cursorIndex < targetEntries.length - 1,
		refresh,
		undo,
		redo,
		restore,
		diff,
		mark,
	};
}
