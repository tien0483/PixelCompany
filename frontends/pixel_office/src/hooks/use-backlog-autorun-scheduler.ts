import { useRef } from "react";

import { getStartableBacklogTaskIds } from "@/hooks/use-task-start-actions";
import type { BoardData } from "@/types";
import { useInterval } from "@/utils/react-use";

const POLL_MS = 1000;
/** Grace window after firing a start before a card is eligible again, covering the async board move. */
const RECENTLY_STARTED_TTL_MS = 10_000;

interface UseBacklogAutorunSchedulerInput {
	board: BoardData;
	/** Concurrent-running cap; a due card waits in backlog until the In Progress count drops below this. */
	maxRunningTasks: number;
	/** Same start path the Start button uses (worktree + kickoff + move to In Progress). */
	onStartTask: (taskId: string) => void;
	enabled?: boolean;
}

/**
 * Client-side backlog auto-run scheduler.
 *
 * Each tick, starts backlog cards whose `autoRunAt` countdown has elapsed — but only up to the
 * `maxRunningTasks` cap and only when the dependency gate (`getStartableBacklogTaskIds`) allows it.
 * Cards that are due while every slot is busy simply wait and are retried next tick ("respect the
 * max-running"). Orchestration already lives on the client, so this reuses the existing start path
 * rather than adding a server daemon.
 */
export function useBacklogAutorunScheduler({
	board,
	maxRunningTasks,
	onStartTask,
	enabled = true,
}: UseBacklogAutorunSchedulerInput): void {
	const recentlyStartedRef = useRef<Map<string, number>>(new Map());

	useInterval(
		() => {
			const now = Date.now();
			for (const [taskId, startedAt] of recentlyStartedRef.current) {
				if (now - startedAt > RECENTLY_STARTED_TTL_MS) {
					recentlyStartedRef.current.delete(taskId);
				}
			}

			const backlogCards = board.columns.find((column) => column.id === "backlog")?.cards ?? [];
			const inProgressCount = board.columns.find((column) => column.id === "in_progress")?.cards.length ?? 0;
			let availableSlots = Math.max(0, maxRunningTasks - inProgressCount);
			if (availableSlots <= 0) {
				return;
			}

			const startable = new Set(getStartableBacklogTaskIds(board));
			const dueCards = backlogCards
				.filter(
					(card) =>
						typeof card.autoRunAt === "number" &&
						card.autoRunAt <= now &&
						startable.has(card.id) &&
						!recentlyStartedRef.current.has(card.id),
				)
				.sort((a, b) => (a.autoRunAt ?? 0) - (b.autoRunAt ?? 0));

			for (const card of dueCards) {
				if (availableSlots <= 0) {
					break;
				}
				recentlyStartedRef.current.set(card.id, now);
				onStartTask(card.id);
				availableSlots -= 1;
			}
		},
		enabled ? POLL_MS : null,
	);
}
