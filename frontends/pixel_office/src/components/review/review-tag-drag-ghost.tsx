import { type ReactElement, useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/components/ui/cn";
import { type ReviewTag, reviewTagColor } from "@/review/review-tags";

/** How far from the cursor the chip rides, so it never sits on the row being aimed at. */
const GHOST_OFFSET_PX = 12;

/**
 * The chip following the cursor during a tag drag.
 *
 * Native drag-and-drop painted this for free out of the source element; a pointer drag
 * has to draw it, and drawing it is an improvement — the browser's snapshot went blank
 * the moment the palette faded, which is a large part of why the old drag read as broken.
 *
 * It keeps its own position state and its own listener so that a pointer moving at 60Hz
 * re-renders one chip rather than the whole diff. `pointer-events: none` is load-bearing
 * twice over: the pane hit-tests rows through the `pointermove` target, so a ghost that
 * could be hit would be the only thing ever under the cursor.
 */
export function ReviewTagDragGhost({ tag }: { tag: ReviewTag | null }): ReactElement | null {
	const [point, setPoint] = useState<{ x: number; y: number } | null>(null);

	useEffect(() => {
		if (!tag) {
			setPoint(null);
			return;
		}
		const handleMove = (event: PointerEvent): void => {
			setPoint({ x: event.clientX, y: event.clientY });
		};
		window.addEventListener("pointermove", handleMove);
		return () => window.removeEventListener("pointermove", handleMove);
	}, [tag]);

	// Nothing is drawn until the pointer has moved once, which is also when the drag
	// began — placing it at the press point would flash the chip at its own resting spot.
	if (!tag || !point) {
		return null;
	}

	return createPortal(
		<div
			data-testid="review-tag-drag-ghost"
			aria-hidden
			className="pointer-events-none fixed top-0 left-0 z-50"
			style={{ transform: `translate3d(${point.x + GHOST_OFFSET_PX}px, ${point.y + GHOST_OFFSET_PX}px, 0)` }}
		>
			{/* The chip's own markup rather than `ReviewTagChip`: that one carries a tooltip
			    trigger, and a tooltip on something the pointer can never reach is dead weight. */}
			<span className={cn("rounded border px-1 text-[9px] shadow-lg", reviewTagColor(tag).chip)}>{tag.label}</span>
		</div>,
		document.body,
	);
}
