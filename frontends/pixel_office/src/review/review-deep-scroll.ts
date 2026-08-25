import type { ReviewNavDirection } from "@/review/review-target";

/**
 * "Deep scroll": the reviewer keeps wheeling once the diff has nothing left to
 * scroll, which is the only navigation signal a file that does not overflow its
 * viewport can offer at all (a 60-line diff, a binary file, a collapsed large diff)
 * — such a container never emits a `scroll` event.
 *
 * The gesture, not the position, is what fires: navigation happens only when a run of
 * wheel events *begins* while the scroller is already at the relevant edge and that
 * run pushes past `DEEP_SCROLL_DELTA_PX`. A run that starts mid-file stays
 * disqualified for its whole lifetime, which is what stops a single flick from the
 * middle of a long diff cascading through several files on its inertia. Firing locks
 * the gesture, so the momentum arriving after a jump cannot move on again.
 *
 * The accumulator lives here, away from the DOM, so the thresholds are testable and
 * the pane keeps only the wiring. Time comes in as `nowMs` for the same reason.
 */

/** Roughly two deliberate wheel notches — above a single casual flick. */
export const DEEP_SCROLL_DELTA_PX = 400;
/** A gap this long ends the gesture, and is also what releases the post-fire lock. */
export const DEEP_SCROLL_IDLE_RESET_MS = 500;
/** Wheel events in line mode carry lines, not pixels; this is the usual browser factor. */
export const DEEP_SCROLL_LINE_HEIGHT_PX = 16;
/**
 * How close to an edge still counts as being at it. Small on purpose: there is no dwell
 * latch behind this any more, so "near enough" has to mean *at*. Two pixels only absorbs
 * the fractional `scrollHeight` that zoom and devicePixelRatio produce.
 */
export const DEEP_SCROLL_EDGE_EPSILON_PX = 2;

export interface DeepScrollState {
	direction: ReviewNavDirection | null;
	accumulated: number;
	lastEventAtMs: number;
	/** Was the scroller at the relevant edge when this gesture started? Never re-evaluated. */
	armed: boolean;
	/** Has this gesture already navigated? Cleared only by a full idle gap. */
	locked: boolean;
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
	return { direction: null, accumulated: 0, lastEventAtMs: 0, armed: false, locked: false };
}

/**
 * A state that can never fire until the reviewer stops wheeling for a full idle gap.
 * Used to hold off navigation while a comment composer or a drag owns the diff.
 */
export function createLockedDeepScrollState(nowMs: number): DeepScrollState {
	return { direction: null, accumulated: 0, lastEventAtMs: nowMs, armed: false, locked: true };
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
 * Folds one wheel event into the gesture.
 *
 * A container with no scroll room is both `atTop` and `atBottom`, which is exactly how a
 * short file gets navigation in both directions — the delta's sign picks which one.
 */
export function accumulateDeepScroll(state: DeepScrollState, input: DeepScrollInput): DeepScrollResult {
	if (input.deltaPx === 0) {
		return { state, triggered: null };
	}
	const direction: ReviewNavDirection = input.deltaPx > 0 ? "next" : "previous";
	const isFreshGesture =
		state.direction !== direction || input.nowMs - state.lastEventAtMs > DEEP_SCROLL_IDLE_RESET_MS;

	// The edge is read once, when the gesture starts. Re-reading it mid-gesture is what let
	// a flick from the middle of a long diff keep going the moment it hit the bottom.
	const armed = isFreshGesture ? (direction === "next" ? input.atBottom : input.atTop) : state.armed;
	const locked = isFreshGesture ? false : state.locked;

	if (!armed || locked) {
		// Still stamped: the idle gap that ends this gesture — and so releases the lock — has
		// to be measured from the last real event, not from the last one that counted.
		return {
			state: { direction, accumulated: 0, lastEventAtMs: input.nowMs, armed, locked },
			triggered: null,
		};
	}

	const accumulated = (isFreshGesture ? 0 : state.accumulated) + Math.abs(input.deltaPx);
	if (accumulated >= DEEP_SCROLL_DELTA_PX) {
		// Locked rather than merely zeroed: the next file opens at its top, and on a short one
		// it is at both edges, so leftover momentum would otherwise navigate straight on.
		return {
			state: { direction, accumulated: 0, lastEventAtMs: input.nowMs, armed, locked: true },
			triggered: direction,
		};
	}
	return {
		state: { direction, accumulated, lastEventAtMs: input.nowMs, armed, locked },
		triggered: null,
	};
}
