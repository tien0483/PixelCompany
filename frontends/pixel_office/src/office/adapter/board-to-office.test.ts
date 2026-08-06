import { describe, expect, it, vi } from "vitest";
import type { RuntimeTaskSessionSummary } from "@/runtime/types";
import type { BoardData } from "@/types";
import type { OfficeState } from "../engine/officeState.js";
import { createOfficeProjection, hashTaskIdToCharacterId, reconcileOffice } from "./board-to-office";

function makeBoard(taskIds: string[], columnId: "in_progress" | "review" | "backlog" = "in_progress"): BoardData {
	const cards = taskIds.map((id, index) => ({
		id,
		title: `Task ${id}`,
		prompt: "do it",
		startInPlanMode: false,
		baseRef: "main",
		createdAt: index,
		updatedAt: index,
	}));
	return {
		columns: [
			{ id: "backlog", title: "Backlog", cards: columnId === "backlog" ? cards : [] },
			{ id: "in_progress", title: "In Progress", cards: columnId === "in_progress" ? cards : [] },
			{ id: "review", title: "Review", cards: columnId === "review" ? cards : [] },
			{ id: "trash", title: "Trash", cards: [] },
		],
		dependencies: [],
	};
}

function makeSession(taskId: string, overrides: Partial<RuntimeTaskSessionSummary> = {}): RuntimeTaskSessionSummary {
	return {
		taskId,
		state: "running",
		agentId: "claude",
		workspacePath: null,
		pid: 1,
		startedAt: 1,
		activeRunMs: 0,
		runningSince: null,
		pausedAt: null,
		pauseReason: null,
		updatedAt: 1,
		lastOutputAt: 1,
		reviewReason: null,
		exitCode: null,
		lastHookAt: null,
		latestHookActivity: null,
		...overrides,
	};
}

function makeOfficeState(): OfficeState {
	const characters = new Map<number, { seatId: string | null; bubbleType: string | null }>();
	const seats = new Map<string, { assigned: boolean }>([
		["f_prod_08", { assigned: false }],
		["f_prod_11", { assigned: false }],
		["f_grey_05", { assigned: false }],
		["f_grey_08", { assigned: false }],
	]);
	return {
		characters,
		seats,
		addAgent: vi.fn((id: number, _p?: number, _h?: number, preferredSeatId?: string) => {
			const seatId = preferredSeatId ?? `seat-${id}`;
			const seat = seats.get(seatId);
			if (seat) {
				seat.assigned = true;
			}
			characters.set(id, { seatId, bubbleType: null });
		}),
		removeAgent: vi.fn((id: number) => {
			const ch = characters.get(id);
			if (ch?.seatId) {
				const seat = seats.get(ch.seatId);
				if (seat) {
					seat.assigned = false;
				}
			}
			characters.delete(id);
		}),
		reassignSeat: vi.fn((agentId: number, seatId: string) => {
			const ch = characters.get(agentId);
			if (!ch) {
				return;
			}
			if (ch.seatId) {
				const old = seats.get(ch.seatId);
				if (old) {
					old.assigned = false;
				}
			}
			const next = seats.get(seatId);
			if (next) {
				next.assigned = true;
			}
			ch.seatId = seatId;
		}),
		setTeamInfo: vi.fn(),
		setAgentTool: vi.fn(),
		setAgentActive: vi.fn(),
		showSpeech: vi.fn(),
		showWaitingBubble: vi.fn(),
		clearWaitingBubble: vi.fn(),
	} as unknown as OfficeState;
}

describe("hashTaskIdToCharacterId", () => {
	it("returns a stable positive id", () => {
		const a = hashTaskIdToCharacterId("task-abc");
		const b = hashTaskIdToCharacterId("task-abc");
		expect(a).toBe(b);
		expect(a).toBeGreaterThan(0);
	});
});

describe("reconcileOffice", () => {
	it("spawns running in_progress sessions and skips idle", () => {
		const officeState = makeOfficeState();
		const board = makeBoard(["t1", "t2"]);
		const sessions = {
			t1: makeSession("t1", { state: "running" }),
			t2: makeSession("t2", { state: "idle" }),
		};
		const result = reconcileOffice({
			officeState,
			board,
			sessions,
			previous: createOfficeProjection(),
		});
		expect(officeState.addAgent).toHaveBeenCalledTimes(1);
		expect(result.projection.characters.has("t1")).toBe(true);
		expect(result.projection.characters.has("t2")).toBe(false);
	});

	it("does not re-fire speech on unchanged text", () => {
		const officeState = makeOfficeState();
		const board = makeBoard(["t1"]);
		const sessions = {
			t1: makeSession("t1", {
				latestHookActivity: {
					activityText: "hello",
					toolName: "Bash",
					toolInputSummary: null,
					finalMessage: null,
					hookEventName: null,
					notificationType: null,
					source: null,
					planText: null,
				},
			}),
		};
		const first = reconcileOffice({
			officeState,
			board,
			sessions,
			previous: createOfficeProjection(),
		});
		expect(officeState.showSpeech).toHaveBeenCalledTimes(1);
		reconcileOffice({
			officeState,
			board,
			sessions,
			previous: first.projection,
		});
		expect(officeState.showSpeech).toHaveBeenCalledTimes(1);
	});

	it("despawns when a card leaves staffed columns", () => {
		const officeState = makeOfficeState();
		const sessions = { t1: makeSession("t1") };
		const first = reconcileOffice({
			officeState,
			board: makeBoard(["t1"]),
			sessions,
			previous: createOfficeProjection(),
		});
		const characterId = first.projection.characters.get("t1")!.characterId;
		reconcileOffice({
			officeState,
			board: makeBoard(["t1"], "backlog"),
			sessions,
			previous: first.projection,
		});
		expect(officeState.removeAgent).toHaveBeenCalledWith(characterId);
	});

	it("walks review-column agents onto grey seats", () => {
		const officeState = makeOfficeState();
		const sessions = { t1: makeSession("t1", { state: "awaiting_review" }) };
		const result = reconcileOffice({
			officeState,
			board: makeBoard(["t1"], "review"),
			sessions,
			previous: createOfficeProjection(),
		});
		expect(officeState.addAgent).toHaveBeenCalled();
		const seatArg = vi.mocked(officeState.addAgent).mock.calls[0]?.[3];
		expect(seatArg).toMatch(/^f_grey_/);
		expect(result.projection.characters.get("t1")?.columnId).toBe("review");
	});

	it("wires dependency tethers via setTeamInfo", () => {
		const officeState = makeOfficeState();
		const board = makeBoard(["t1", "t2"]);
		board.dependencies = [
			{ id: "d1", fromTaskId: "t1", toTaskId: "t2", createdAt: 1 },
		];
		const sessions = {
			t1: makeSession("t1"),
			t2: makeSession("t2"),
		};
		const result = reconcileOffice({
			officeState,
			board,
			sessions,
			previous: createOfficeProjection(),
		});
		const fromId = result.projection.characters.get("t1")!.characterId;
		const toId = result.projection.characters.get("t2")!.characterId;
		expect(officeState.setTeamInfo).toHaveBeenCalledWith(fromId, undefined, undefined, false, toId);
	});
});
