import { useCallback, useEffect, useRef } from "react";

import type { RuntimeTaskSessionSummary } from "@/runtime/types";
import type { BoardData } from "@/types";
import { createOfficeProjection, type OfficeProjection, reconcileOffice } from "./adapter/board-to-office.js";
import type { OfficeState } from "./engine/officeState.js";
import { readSeatAssignments, writeSeatAssignments } from "./seat-store.js";
import type { AgentSeatAssignments } from "./types.js";

interface UseOfficeSyncInput {
	officeState: OfficeState | null;
	board: BoardData;
	sessions: Record<string, RuntimeTaskSessionSummary>;
	workspaceId: string | null;
}

interface UseOfficeSyncResult {
	/** Translates an office character id back to the task it represents. */
	resolveTaskId: (characterId: number) => string | null;
	/** Persists desks after the user drags a character to a different seat. */
	handleSeatsPersist: (seats: AgentSeatAssignments) => void;
}

/**
 * Drives the office engine from board and session state.
 *
 * The projection lives in a ref rather than React state: reconciliation mutates the
 * engine directly and must not schedule a render, since the canvas already runs its own
 * animation loop.
 */
export function useOfficeSync({ officeState, board, sessions, workspaceId }: UseOfficeSyncInput): UseOfficeSyncResult {
	const projectionRef = useRef<OfficeProjection>(createOfficeProjection());
	const taskIdByCharacterIdRef = useRef<Map<number, string>>(new Map());
	const workspaceIdRef = useRef<string | null>(null);

	useEffect(() => {
		if (!officeState) {
			return;
		}
		if (workspaceIdRef.current !== workspaceId) {
			workspaceIdRef.current = workspaceId;
			officeState.clearAllAgents();
			projectionRef.current = createOfficeProjection(readSeatAssignments(workspaceId));
			taskIdByCharacterIdRef.current = new Map();
		}

		const result = reconcileOffice({
			officeState,
			board,
			sessions,
			previous: projectionRef.current,
		});
		projectionRef.current = result.projection;
		taskIdByCharacterIdRef.current = result.taskIdByCharacterId;
		if (result.seatByTaskId) {
			writeSeatAssignments(workspaceId, result.seatByTaskId);
		}
	}, [board, officeState, sessions, workspaceId]);

	const resolveTaskId = useCallback((characterId: number): string | null => {
		return taskIdByCharacterIdRef.current.get(characterId) ?? null;
	}, []);

	const handleSeatsPersist = useCallback((seats: AgentSeatAssignments) => {
		const projection = projectionRef.current;
		for (const [rawCharacterId, assignment] of Object.entries(seats)) {
			const taskId = taskIdByCharacterIdRef.current.get(Number(rawCharacterId));
			if (taskId === undefined) {
				continue;
			}
			if (assignment.seatId === null) {
				projection.seatByTaskId.delete(taskId);
			} else {
				projection.seatByTaskId.set(taskId, assignment.seatId);
			}
		}
		writeSeatAssignments(workspaceIdRef.current, Object.fromEntries(projection.seatByTaskId));
	}, []);

	return { resolveTaskId, handleSeatsPersist };
}
