import { type RefObject, useCallback, useEffect, useRef } from "react";

/** How close to an edge the pointer has to be before the container starts scrolling. */
const EDGE_ZONE_PX = 56;

/** Pixels per frame at the very edge; scaled down linearly across the zone. */
const MAX_SPEED_PX_PER_FRAME = 18;

export interface DragAutoscrollHandlers {
	onDragOver: (event: { clientY: number }) => void;
	stop: () => void;
}

/**
 * Scrolls a container while something is dragged near its top or bottom edge.
 *
 * A native HTML5 drag suppresses wheel and keyboard scrolling, so without this a chip
 * can only ever be dropped on a row that was already on screen when the drag started —
 * which makes any range longer than the viewport unreachable.
 *
 * The speed is a ramp rather than a constant: at the very edge it moves fast enough to
 * cross a long file, and a pointer that merely grazes the zone barely moves at all.
 */
export function useDragAutoscroll(
	containerRef: RefObject<HTMLElement | null>,
	enabled: boolean,
): DragAutoscrollHandlers {
	const frameRef = useRef<number | null>(null);
	const speedRef = useRef(0);

	const stop = useCallback(() => {
		speedRef.current = 0;
		if (frameRef.current !== null) {
			cancelAnimationFrame(frameRef.current);
			frameRef.current = null;
		}
	}, []);

	// A drag that ends outside the container — or is cancelled with Escape — raises no
	// event on it, so the loop has to be stopped from the window as well.
	useEffect(() => {
		if (!enabled) {
			stop();
			return;
		}
		window.addEventListener("dragend", stop);
		window.addEventListener("drop", stop);
		return () => {
			window.removeEventListener("dragend", stop);
			window.removeEventListener("drop", stop);
			stop();
		};
	}, [enabled, stop]);

	const step = useCallback(() => {
		const element = containerRef.current;
		if (!element || speedRef.current === 0) {
			frameRef.current = null;
			return;
		}
		element.scrollTop += speedRef.current;
		frameRef.current = requestAnimationFrame(step);
	}, [containerRef]);

	const onDragOver = useCallback(
		(event: { clientY: number }) => {
			const element = containerRef.current;
			if (!enabled || !element) {
				return;
			}
			const bounds = element.getBoundingClientRect();
			const fromTop = event.clientY - bounds.top;
			const fromBottom = bounds.bottom - event.clientY;
			// A negative distance means the pointer is past that edge, i.e. outside the
			// container. Clamping it to zero instead would read as "hard against the edge"
			// and scroll at full speed for a pointer that has left the diff entirely.
			const speed =
				fromTop < 0 || fromBottom < 0
					? 0
					: fromTop < EDGE_ZONE_PX
						? -Math.ceil(((EDGE_ZONE_PX - fromTop) / EDGE_ZONE_PX) * MAX_SPEED_PX_PER_FRAME)
						: fromBottom < EDGE_ZONE_PX
							? Math.ceil(((EDGE_ZONE_PX - fromBottom) / EDGE_ZONE_PX) * MAX_SPEED_PX_PER_FRAME)
							: 0;
			speedRef.current = speed;
			if (speed !== 0 && frameRef.current === null) {
				frameRef.current = requestAnimationFrame(step);
			}
		},
		[containerRef, enabled, step],
	);

	return { onDragOver, stop };
}
