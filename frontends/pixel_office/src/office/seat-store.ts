/**
 * Per-project desk assignments for office characters.
 *
 * Kept in local storage rather than the runtime project config because a desk is a
 * viewer preference, not runtime state: it must not travel with the repo or affect the
 * agent processes, and it has to survive a reload before the runtime stream connects.
 */
const SEAT_STORAGE_PREFIX = "kanban.office-seats.";

export type SeatAssignmentMap = Record<string, string>;

function storageKey(workspaceId: string): string {
	return `${SEAT_STORAGE_PREFIX}${workspaceId}`;
}

export function readSeatAssignments(workspaceId: string | null): SeatAssignmentMap {
	if (workspaceId === null) {
		return {};
	}
	try {
		const raw = window.localStorage.getItem(storageKey(workspaceId));
		if (raw === null) {
			return {};
		}
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
			return {};
		}
		const seats: SeatAssignmentMap = {};
		for (const [taskId, seatId] of Object.entries(parsed)) {
			if (typeof seatId === "string") {
				seats[taskId] = seatId;
			}
		}
		return seats;
	} catch {
		return {};
	}
}

export function writeSeatAssignments(workspaceId: string | null, seats: SeatAssignmentMap): void {
	if (workspaceId === null) {
		return;
	}
	try {
		window.localStorage.setItem(storageKey(workspaceId), JSON.stringify(seats));
	} catch {
		// Storage can be full or blocked; desks simply fall back to auto-assignment.
	}
}
