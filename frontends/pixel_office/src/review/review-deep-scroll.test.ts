import { describe, expect, it } from "vitest";

import {
	accumulateDeepScroll,
	createDeepScrollState,
	DEEP_SCROLL_DELTA_PX,
	DEEP_SCROLL_IDLE_RESET_MS,
	DEEP_SCROLL_LINE_HEIGHT_PX,
	type DeepScrollState,
	normalizeWheelDeltaPx,
} from "@/review/review-deep-scroll";

const AT_BOTTOM = { atTop: false, atBottom: true } as const;
const AT_TOP = { atTop: true, atBottom: false } as const;
const MID_FILE = { atTop: false, atBottom: false } as const;
/** A file with no scroll room at all sits at both edges at once. */
const NO_SCROLL_ROOM = { atTop: true, atBottom: true } as const;

/** Feeds a run of equal wheel ticks 50 ms apart — one gesture — and reports what fired. */
function wheel(
	state: DeepScrollState,
	input: { deltaPx: number; atTop: boolean; atBottom: boolean; ticks: number; startMs?: number },
): { state: DeepScrollState; triggers: string[]; endMs: number } {
	let current = state;
	const triggers: string[] = [];
	let nowMs = input.startMs ?? 1_000;
	for (let index = 0; index < input.ticks; index += 1) {
		nowMs = (input.startMs ?? 1_000) + index * 50;
		const result = accumulateDeepScroll(current, {
			deltaPx: input.deltaPx,
			atTop: input.atTop,
			atBottom: input.atBottom,
			nowMs,
		});
		current = result.state;
		if (result.triggered) {
			triggers.push(result.triggered);
		}
	}
	return { state: current, triggers, endMs: nowMs };
}

describe("normalizeWheelDeltaPx", () => {
	it("passes pixel deltas through", () => {
		expect(normalizeWheelDeltaPx({ deltaY: 120, deltaMode: 0, viewportPx: 300 })).toBe(120);
	});

	it("scales line deltas and page deltas", () => {
		expect(normalizeWheelDeltaPx({ deltaY: 3, deltaMode: 1, viewportPx: 300 })).toBe(
			3 * DEEP_SCROLL_LINE_HEIGHT_PX,
		);
		expect(normalizeWheelDeltaPx({ deltaY: -1, deltaMode: 2, viewportPx: 300 })).toBe(-300);
	});
});

describe("accumulateDeepScroll", () => {
	it("does nothing for a gesture short of the threshold", () => {
		const { triggers } = wheel(createDeepScrollState(), { deltaPx: 40, ...AT_BOTTOM, ticks: 2 });
		expect(triggers).toEqual([]);
	});

	it("fires once the accumulated push crosses the threshold", () => {
		const ticks = Math.ceil(DEEP_SCROLL_DELTA_PX / 60);
		const { triggers } = wheel(createDeepScrollState(), { deltaPx: 60, ...AT_BOTTOM, ticks });
		expect(triggers).toEqual(["next"]);
	});

	it("fires once per gesture, not once per tick, however long the momentum runs", () => {
		const { triggers } = wheel(createDeepScrollState(), { deltaPx: 120, ...AT_BOTTOM, ticks: 40 });
		expect(triggers).toEqual(["next"]);
	});

	it("releases the lock after an idle gap, so the next gesture can fire", () => {
		const first = wheel(createDeepScrollState(), { deltaPx: 120, ...AT_BOTTOM, ticks: 8 });
		expect(first.triggers).toEqual(["next"]);

		const second = wheel(first.state, {
			deltaPx: 120,
			...AT_BOTTOM,
			ticks: 8,
			startMs: first.endMs + DEEP_SCROLL_IDLE_RESET_MS + 50,
		});
		expect(second.triggers).toEqual(["next"]);
	});

	it("resets after an idle gap so slow incidental wheeling never adds up", () => {
		let state = createDeepScrollState();
		for (let index = 0; index < 10; index += 1) {
			const result = accumulateDeepScroll(state, {
				deltaPx: 100,
				...AT_BOTTOM,
				nowMs: 1_000 + index * (DEEP_SCROLL_IDLE_RESET_MS + 50),
			});
			state = result.state;
			expect(result.triggered).toBeNull();
		}
	});

	it("resets when the direction flips", () => {
		const down = wheel(createDeepScrollState(), { deltaPx: 100, ...NO_SCROLL_ROOM, ticks: 2 });
		const up = wheel(down.state, { deltaPx: -100, ...NO_SCROLL_ROOM, ticks: 2, startMs: 1_200 });
		expect(down.triggers).toEqual([]);
		expect(up.triggers).toEqual([]);
	});

	it("never fires from a gesture that started mid-file, even once it reaches the edge", () => {
		// The inertia cascade: one hard flick from the middle of a long diff. Reaching the
		// bottom mid-gesture must not arm it — the reviewer has to lift off and flick again.
		let state = createDeepScrollState();
		const triggers: string[] = [];
		for (let index = 0; index < 40; index += 1) {
			const result = accumulateDeepScroll(state, {
				deltaPx: 120,
				// Mid-file for the first few ticks, pinned at the bottom for the rest.
				...(index < 3 ? MID_FILE : AT_BOTTOM),
				nowMs: 1_000 + index * 50,
			});
			state = result.state;
			if (result.triggered) {
				triggers.push(result.triggered);
			}
		}
		expect(triggers).toEqual([]);
	});

	it("arms a gesture that starts at the edge even if the edge is lost later", () => {
		// Mirror of the case above: the arming decision is made once, at the start.
		const { triggers } = wheel(createDeepScrollState(), { deltaPx: 120, ...AT_BOTTOM, ticks: 4 });
		expect(triggers).toEqual(["next"]);
	});

	it("ignores a whole gesture that starts away from either edge", () => {
		const { triggers } = wheel(createDeepScrollState(), {
			deltaPx: DEEP_SCROLL_DELTA_PX * 2,
			...MID_FILE,
			ticks: 3,
		});
		expect(triggers).toEqual([]);
	});

	it("only counts downward pushes at the bottom and upward pushes at the top", () => {
		expect(wheel(createDeepScrollState(), { deltaPx: -300, ...AT_BOTTOM, ticks: 4 }).triggers).toEqual([]);
		expect(wheel(createDeepScrollState(), { deltaPx: 300, ...AT_TOP, ticks: 4 }).triggers).toEqual([]);
	});

	it("navigates both ways on a file with no scroll room", () => {
		const down = wheel(createDeepScrollState(), { deltaPx: DEEP_SCROLL_DELTA_PX, ...NO_SCROLL_ROOM, ticks: 1 });
		expect(down.triggers).toEqual(["next"]);

		const up = wheel(down.state, {
			deltaPx: -DEEP_SCROLL_DELTA_PX,
			...NO_SCROLL_ROOM,
			ticks: 1,
			startMs: down.endMs + DEEP_SCROLL_IDLE_RESET_MS + 50,
		});
		expect(up.triggers).toEqual(["previous"]);
	});

	it("ignores a zero delta", () => {
		const result = accumulateDeepScroll(createDeepScrollState(), {
			deltaPx: 0,
			...NO_SCROLL_ROOM,
			nowMs: 1_000,
		});
		expect(result.triggered).toBeNull();
	});
});
