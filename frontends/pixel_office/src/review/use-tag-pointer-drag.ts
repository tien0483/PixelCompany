import { useCallback, useEffect, useRef } from "react";

import type { ReviewTag } from "@/review/review-tags";

/**
 * How far the pointer has to travel before a press on a chip becomes a drag. Below it
 * the press is still a click, which is what keeps the chip's tooltip and keyboard
 * behaviour intact.
 */
const DRAG_THRESHOLD_PX = 4;

export interface TagPointerDragHandlers {
	startGesture: (event: { button: number; clientX: number; clientY: number }, tag: ReviewTag) => void;
}

/**
 * The chip half of a tag drag: watch a press until it moves far enough to mean business,
 * then report the tag and get out of the way.
 *
 * Deliberately *not* the HTML5 drag-and-drop API, and deliberately without
 * `setPointerCapture`. Native DnD cancels a drag whose source element leaves the
 * document, and capture would pin every `pointermove` to the chip — either one ties the
 * live drag to the palette staying mounted, which is exactly what the reviewer wants it
 * to stop doing. Window listeners survive the palette unmounting; nothing else does.
 *
 * Only the *start* lives here. Everything after it — which rows the pointer crosses, the
 * drop, the cancel — belongs to the diff pane, which is the component that already holds
 * the rows and the range. Splitting it any other way would have two window handlers
 * racing to decide who clears the dragged tag.
 */
export function useTagPointerDrag({ onStart }: { onStart: (tag: ReviewTag) => void }): TagPointerDragHandlers {
	/** The press being watched: null between gestures, `started` once it passed the threshold. */
	const gestureRef = useRef<{ tag: ReviewTag; originX: number; originY: number; started: boolean } | null>(null);
	const onStartRef = useRef(onStart);
	onStartRef.current = onStart;

	useEffect(() => {
		const handleMove = (event: PointerEvent): void => {
			const gesture = gestureRef.current;
			if (!gesture || gesture.started) {
				return;
			}
			if (Math.hypot(event.clientX - gesture.originX, event.clientY - gesture.originY) <= DRAG_THRESHOLD_PX) {
				return;
			}
			gesture.started = true;
			onStartRef.current(gesture.tag);
		};

		// The gesture ends here, but the *drag* does not: the pane owns `draggedTag` and
		// clears it from its own `pointerup`, so the two handlers never race over it.
		//
		// Nor does this hook own the cursor and the text-selection lock, tempting as it is:
		// reporting the drag is what unmounts the palette, and this hook with it, so the
		// cleanup would undo them one frame into a drag that still has seconds to run.
		const endGesture = (): void => {
			gestureRef.current = null;
		};

		const handleKeyDown = (event: KeyboardEvent): void => {
			if (event.key === "Escape") {
				endGesture();
			}
		};

		window.addEventListener("pointermove", handleMove);
		window.addEventListener("pointerup", endGesture);
		window.addEventListener("pointercancel", endGesture);
		window.addEventListener("blur", endGesture);
		window.addEventListener("keydown", handleKeyDown);
		return () => {
			window.removeEventListener("pointermove", handleMove);
			window.removeEventListener("pointerup", endGesture);
			window.removeEventListener("pointercancel", endGesture);
			window.removeEventListener("blur", endGesture);
			window.removeEventListener("keydown", handleKeyDown);
		};
	}, []);

	const startGesture = useCallback(
		(event: { button: number; clientX: number; clientY: number }, tag: ReviewTag): void => {
			// Left button only: a right-click opens the context menu, and a middle-click
			// press that turned into a drag would leave autoscroll fighting the browser's.
			if (event.button !== 0) {
				return;
			}
			gestureRef.current = { tag, originX: event.clientX, originY: event.clientY, started: false };
		},
		[],
	);

	return { startGesture };
}
