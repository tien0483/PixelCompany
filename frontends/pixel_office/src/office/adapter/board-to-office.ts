/**
 * Pure reconciler from Kanban's `{ board, sessions }` to imperative OfficeState mutations.
 *
 * The office is a projection of runtime state, never a second source of truth: every call
 * here is derived from a task session summary. Mutations are diffed against the previous
 * projection so speech bubbles and tool animations only fire when something actually
 * changed, rather than retriggering on every state-stream tick.
 */
import type { RuntimeAgentId, RuntimeTaskSessionSummary } from "@/runtime/types";
import type { BoardCard, BoardColumnId, BoardData } from "@/types";
import { PALETTE_COUNT, SPEECH_BUBBLE_DURATION_SEC } from "../constants.js";
import type { OfficeState } from "../engine/officeState.js";

/** Columns whose cards are represented as staff on the office floor. */
const STAFFED_COLUMNS: readonly BoardColumnId[] = ["in_progress", "review"];

/** Session states that put a character at a desk. `idle` never spawns. */
const STAFFED_STATES: readonly RuntimeTaskSessionSummary["state"][] = [
	"running",
	"awaiting_review",
	"failed",
	"interrupted",
];

/**
 * Seat UID prefixes from default-layout-1 furniture.
 * Grey room ≈ review; prod desks ≈ open-plan floor.
 */
const REVIEW_SEAT_PREFIXES = ["f_grey_", "f_mkt_"] as const;
const FLOOR_SEAT_PREFIXES = ["f_prod_"] as const;

/**
 * Per-agent look. Palette indexes the loaded character sprite sheets; the hue shift
 * separates agents that would otherwise share a palette once the agent count exceeds
 * PALETTE_COUNT, so each CLI still reads as distinct staff.
 */
const AGENT_APPEARANCE: Record<RuntimeAgentId, { palette: number; hueShift: number }> = {
	claude: { palette: 0, hueShift: 0 },
	codex: { palette: 1, hueShift: 0 },
	gemini: { palette: 2, hueShift: 0 },
	cline: { palette: 3, hueShift: 0 },
	droid: { palette: 4, hueShift: 0 },
	kiro: { palette: 5, hueShift: 0 },
	opencode: { palette: 0, hueShift: 140 },
	cursor: { palette: 1, hueShift: 200 },
};

const DEFAULT_APPEARANCE = { palette: 0, hueShift: 60 };

/** What we last pushed for one task, so the next pass can diff against it. */
interface ProjectedCharacter {
	characterId: number;
	columnId: BoardColumnId;
	tool: string | null;
	active: boolean;
	bubble: "none" | "waiting" | "awaiting-input";
	speech: string | null;
	leadCharacterId: number | null;
}

export interface OfficeProjection {
	/** Keyed by taskId. */
	characters: Map<string, ProjectedCharacter>;
	/** Persisted desk choice per task, so a reload does not reshuffle the floor. */
	seatByTaskId: Map<string, string>;
}

export function createOfficeProjection(seatByTaskId?: Record<string, string>): OfficeProjection {
	return {
		characters: new Map(),
		seatByTaskId: new Map(Object.entries(seatByTaskId ?? {})),
	};
}

export interface ReconcileInput {
	officeState: OfficeState;
	board: BoardData;
	sessions: Record<string, RuntimeTaskSessionSummary>;
	previous: OfficeProjection;
}

export interface ReconcileResult {
	projection: OfficeProjection;
	/** taskId to office character id, for translating canvas clicks back to cards. */
	taskIdByCharacterId: Map<number, string>;
	/** Set when a desk assignment changed and the caller should persist it. */
	seatByTaskId: Record<string, string> | null;
}

/**
 * FNV-1a over the task id, clamped to a positive 24-bit range.
 *
 * Positive is required: OfficeState reserves negative ids for subagents. The range is
 * kept small enough to stay well inside a safe integer after collision probing.
 */
export function hashTaskIdToCharacterId(taskId: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < taskId.length; i++) {
		hash ^= taskId.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return (hash % 0xffffff) + 1;
}

/** Stable NPC id band above task character ids (max ~0xffffff). */
export function hashReviewerNpcId(name: string): number {
	return 50_000_000 + (hashTaskIdToCharacterId(name) % 1_000_000);
}

/** Linear probe so two tasks that hash alike still get distinct characters. */
function allocateCharacterId(taskId: string, taken: Set<number>): number {
	let id = hashTaskIdToCharacterId(taskId);
	while (taken.has(id)) {
		id = (id % 0xffffff) + 1;
	}
	taken.add(id);
	return id;
}

function appearanceFor(agentId: RuntimeAgentId | null | undefined): { palette: number; hueShift: number } {
	if (!agentId) {
		return DEFAULT_APPEARANCE;
	}
	const appearance = AGENT_APPEARANCE[agentId];
	if (!appearance) {
		return DEFAULT_APPEARANCE;
	}
	return { palette: appearance.palette % PALETTE_COUNT, hueShift: appearance.hueShift };
}

/** The line the character says. Prefers the agent's own words over a tool trace. */
function speechFor(session: RuntimeTaskSessionSummary): string | null {
	const activity = session.latestHookActivity;
	if (!activity) {
		return null;
	}
	const text = activity.finalMessage ?? activity.activityText ?? activity.toolInputSummary;
	if (text === null || text === undefined) {
		return null;
	}
	const trimmed = text.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function bubbleFor(session: RuntimeTaskSessionSummary): ProjectedCharacter["bubble"] {
	if (session.state === "awaiting_review") {
		return session.reviewReason === "attention" ? "awaiting-input" : "waiting";
	}
	return "none";
}

function seatMatchesPrefixes(seatId: string, prefixes: readonly string[]): boolean {
	return prefixes.some((prefix) => seatId.startsWith(prefix));
}

function desiredSeatPrefixes(columnId: BoardColumnId): readonly string[] {
	return columnId === "review" ? REVIEW_SEAT_PREFIXES : FLOOR_SEAT_PREFIXES;
}

/**
 * Prefer a free seat in the column's room. Falls back to any free seat / persisted preference.
 */
export function pickSeatForColumn(
	officeState: OfficeState,
	columnId: BoardColumnId,
	preferredSeatId?: string,
): string | undefined {
	const prefixes = desiredSeatPrefixes(columnId);
	if (
		preferredSeatId !== undefined &&
		seatMatchesPrefixes(preferredSeatId, prefixes)
	) {
		const preferred = officeState.seats.get(preferredSeatId);
		if (preferred && !preferred.assigned) {
			return preferredSeatId;
		}
	}
	for (const [uid, seat] of officeState.seats) {
		if (!seat.assigned && seatMatchesPrefixes(uid, prefixes)) {
			return uid;
		}
	}
	if (preferredSeatId !== undefined) {
		const preferred = officeState.seats.get(preferredSeatId);
		if (preferred && !preferred.assigned) {
			return preferredSeatId;
		}
	}
	return undefined;
}

/** Cards currently in a column that puts them on the floor, in board order. */
function collectStaffedCards(board: BoardData): { card: BoardCard; columnId: BoardColumnId }[] {
	const staffed: { card: BoardCard; columnId: BoardColumnId }[] = [];
	for (const column of board.columns) {
		if (!STAFFED_COLUMNS.includes(column.id)) {
			continue;
		}
		for (const card of column.cards) {
			staffed.push({ card, columnId: column.id });
		}
	}
	return staffed;
}

function applyDependencyTethers(
	officeState: OfficeState,
	board: BoardData,
	projection: OfficeProjection,
	previous: OfficeProjection,
): void {
	const desiredLeads = new Map<number, number | null>();
	for (const projected of projection.characters.values()) {
		desiredLeads.set(projected.characterId, null);
	}
	for (const dep of board.dependencies) {
		const from = projection.characters.get(dep.fromTaskId);
		const to = projection.characters.get(dep.toTaskId);
		if (!from || !to) {
			continue;
		}
		// Dependent (from) tethers toward dependency (to) as lead.
		desiredLeads.set(from.characterId, to.characterId);
	}
	for (const [taskId, projected] of projection.characters) {
		const lead = desiredLeads.get(projected.characterId) ?? null;
		const prev = previous.characters.get(taskId);
		if (prev && prev.leadCharacterId === lead) {
			projected.leadCharacterId = lead;
			continue;
		}
		officeState.setTeamInfo(
			projected.characterId,
			undefined,
			undefined,
			false,
			lead === null ? undefined : lead,
		);
		projected.leadCharacterId = lead;
	}
}

export function reconcileOffice({ officeState, board, sessions, previous }: ReconcileInput): ReconcileResult {
	const projection: OfficeProjection = {
		characters: new Map(),
		seatByTaskId: new Map(previous.seatByTaskId),
	};
	const taskIdByCharacterId = new Map<number, string>();
	const takenIds = new Set<number>();
	let seatsChanged = false;

	for (const { card, columnId } of collectStaffedCards(board)) {
		const session = sessions[card.id];
		if (!session || !STAFFED_STATES.includes(session.state)) {
			continue;
		}

		const existing = previous.characters.get(card.id);
		let characterId: number;
		if (existing) {
			characterId = existing.characterId;
			takenIds.add(characterId);
		} else {
			characterId = allocateCharacterId(card.id, takenIds);
		}
		taskIdByCharacterId.set(characterId, card.id);

		const preferredSeat = projection.seatByTaskId.get(card.id);
		const columnSeat = pickSeatForColumn(officeState, columnId, preferredSeat);

		if (!officeState.characters.has(characterId)) {
			const { palette, hueShift } = appearanceFor(session.agentId);
			officeState.addAgent(
				characterId,
				palette,
				hueShift,
				columnSeat,
				false,
				card.title,
				session.agentId ?? undefined,
			);
		} else if (existing && existing.columnId !== columnId && columnSeat !== undefined) {
			const currentSeat = officeState.characters.get(characterId)?.seatId ?? null;
			if (currentSeat !== columnSeat) {
				officeState.reassignSeat(characterId, columnSeat);
			}
		} else if (
			columnId === "review" &&
			columnSeat !== undefined &&
			officeState.characters.get(characterId)?.seatId !== columnSeat &&
			!seatMatchesPrefixes(officeState.characters.get(characterId)?.seatId ?? "", REVIEW_SEAT_PREFIXES)
		) {
			officeState.reassignSeat(characterId, columnSeat);
		}

		const seatId = officeState.characters.get(characterId)?.seatId ?? null;
		if (seatId !== null && projection.seatByTaskId.get(card.id) !== seatId) {
			projection.seatByTaskId.set(card.id, seatId);
			seatsChanged = true;
		}

		const tool = session.latestHookActivity?.toolName ?? null;
		const active = session.state === "running";
		const bubble = bubbleFor(session);
		const speech = speechFor(session);

		if (!existing || existing.tool !== tool) {
			officeState.setAgentTool(characterId, tool);
		}
		if (!existing || existing.active !== active) {
			officeState.setAgentActive(characterId, active);
		}
		if (!existing || existing.bubble !== bubble) {
			if (bubble === "none") {
				officeState.clearWaitingBubble(characterId);
			} else {
				officeState.showWaitingBubble(characterId, bubble === "awaiting-input");
			}
		}
		if (speech !== null && (!existing || existing.speech !== speech)) {
			officeState.showSpeech(characterId, speech, SPEECH_BUBBLE_DURATION_SEC);
		}

		projection.characters.set(card.id, {
			characterId,
			columnId,
			tool,
			active,
			bubble,
			speech,
			leadCharacterId: existing?.leadCharacterId ?? null,
		});
	}

	for (const [taskId, projected] of previous.characters) {
		if (projection.characters.has(taskId)) {
			continue;
		}
		officeState.removeAgent(projected.characterId);
		if (projection.seatByTaskId.delete(taskId)) {
			seatsChanged = true;
		}
	}

	applyDependencyTethers(officeState, board, projection, previous);

	return {
		projection,
		taskIdByCharacterId,
		seatByTaskId: seatsChanged ? Object.fromEntries(projection.seatByTaskId) : null,
	};
}
