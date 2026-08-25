import type { ReviewNavDirection } from "@/review/review-target";

/**
 * "Deep scroll": the reviewer keeps wheeling once the diff has nothing left to
 * scroll, which is the only signal available on a file that does not overflow its
 * viewport at all (a 60-line diff, a binary file, a collapsed large diff). The
 * dwell-at-the-bottom rule cannot cover those — a non-scrolling container emits no
 * `scroll` event — and it cannot cover backwards navigation either, because every
 * file opens at the top and a dwell there would jump to the previous file on sight.
 *
 * The accumulator lives here, away from the DOM, so the thresholds are testable and
 * the pane keeps only the wiring.
 */

/** Roughly two deliberate wheel gestures. Low enough to feel like "push past the end". */
export const DEEP_SCROLL_DELTA_PX = 240;
/** A gap this long ends the gesture, so slow incidental wheeling never adds up. */
export const DEEP_SCROLL_IDLE_RESET_MS = 500;
/** Wheel events in line mode carry lines, not pixels; this is the usual browser factor. */
export const DEEP_SCROLL_LINE_HEIGHT_PX = 16;

export interface DeepScrollState {
	direction: ReviewNavDirection | null;
	accumulated: number;
	lastEventAtMs: number;
}

export interface DeepScrollInput {
	/** Wheel delta in pixels, already normalized for `deltaMode`. */
	deltaPx: number;
	atTop: boolean;
	atBottom: boolean;
	nowMs: number;
}

export interface DeepScrollResult {
	state: DeepScrollState;
	triggered: ReviewNavDirection | null;
}

export function createDeepScrollState(): DeepScrollState {
	return { direction: null, accumulated: 0, lastEventAtMs: 0 };
}

/** Converts a wheel event's delta into pixels. `deltaMode`: 0 px, 1 lines, 2 pages. */
export function normalizeWheelDeltaPx(input: { deltaY: number; deltaMode: number; viewportPx: number }): number {
	if (input.deltaMode === 1) {
		return input.deltaY * DEEP_SCROLL_LINE_HEIGHT_PX;
	}
	if (input.deltaMode === 2) {
		return input.deltaY * Math.max(input.viewportPx, 1);
	}
	return input.deltaY;
}

/**
 * Folds one wheel event into the gesture. Only deltas pushing *against* an edge
 * count, so mid-file wheeling is ignored; a container with no scroll room is both
 * `atTop` and `atBottom`, which is exactly how a short file gets both directions.
 */
export function accumulateDeepScroll(state: DeepScrollState, input: DeepScrollInput): DeepScrollResult {
	if (input.deltaPx === 0) {
		return { state, triggered: null };
	}
	const direction: ReviewNavDirection = input.deltaPx > 0 ? "next" : "previous";
	const atRelevantEdge = direction === "next" ? input.atBottom : input.atTop;
	if (!atRelevantEdge) {
		return { state: createDeepScrollState(), triggered: null };
	}

	const isFreshGesture =
		state.direction !== direction || input.nowMs - state.lastEventAtMs > DEEP_SCROLL_IDLE_RESET_MS;
	const accumulated = (isFreshGesture ? 0 : state.accumulated) + Math.abs(input.deltaPx);

	if (accumulated >= DEEP_SCROLL_DELTA_PX) {
		// Zeroed rather than left over the line: navigating consumes the gesture, so the
		// next file needs its own full push instead of inheriting this one's momentum.
		return { state: { direction, accumulated: 0, lastEventAtMs: input.nowMs }, triggered: direction };
	}
	return { state: { direction, accumulated, lastEventAtMs: input.nowMs }, triggered: null };
}
