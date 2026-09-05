import { type MouseEvent as ReactMouseEvent, type ReactElement, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/components/ui/cn";
import { useResizeDrag } from "@/resize/use-resize-drag";
import {
	buildMinimapMarks,
	buildMinimapThumb,
	lineAtRulerOffset,
	type MinimapAnnotationKind,
	type MinimapMeasurement,
	type MinimapThumb,
	type MinimapVariant,
	rankAnnotationKind,
	scrollTopForRulerOffset,
} from "@/review/review-minimap";

const ANNOTATION_KINDS: readonly MinimapAnnotationKind[] = ["thread", "draft", "tag"];
const VARIANTS: readonly MinimapVariant[] = ["added", "removed", "context"];

function readVariant(element: HTMLElement): MinimapVariant | null {
	const raw = element.dataset.diffVariant;
	return VARIANTS.find((variant) => variant === raw) ?? null;
}

function readAnnotationKind(element: HTMLElement): MinimapAnnotationKind | null {
	const raw = element.dataset.annotationKind;
	return ANNOTATION_KINDS.find((kind) => kind === raw) ?? null;
}

function readLine(element: HTMLElement): number | null {
	const raw = element.dataset.reviewLine;
	if (raw === undefined) {
		return null;
	}
	const line = Number.parseInt(raw, 10);
	return Number.isFinite(line) ? line : null;
}

/**
 * Reads every rendered row's position out of the scroller.
 *
 * Positions come from `getBoundingClientRect` rather than `offsetTop`: the scroller is
 * not a positioned element, so `offsetTop` would be measured against whatever ancestor
 * happens to be, and giving it `position: relative` to fix that would re-stack the
 * composer and the tag flyout that sit over the rows.
 */
function measureRows(scroller: HTMLElement): MinimapMeasurement[] {
	const scrollerTop = scroller.getBoundingClientRect().top - scroller.scrollTop;
	const byRowKey = new Map<string, MinimapMeasurement>();
	for (const element of scroller.querySelectorAll<HTMLElement>("[data-row-key]")) {
		const rowKey = element.dataset.rowKey;
		const variant = readVariant(element);
		if (rowKey === undefined || variant === null) {
			continue;
		}
		const rect = element.getBoundingClientRect();
		const measurement: MinimapMeasurement = {
			top: rect.top - scrollerTop,
			height: rect.height,
			variant,
			annotationKind: readAnnotationKind(element),
			annotationColor: element.dataset.annotationColor ?? null,
			line: readLine(element),
		};
		// Split mode renders an unchanged row once per column under the same key. Keep the
		// taller box, and keep whichever side carries the annotation: only the commentable
		// column has one, and dropping it would erase the dot the reviewer is looking for.
		const existing = byRowKey.get(rowKey);
		if (!existing) {
			byRowKey.set(rowKey, measurement);
			continue;
		}
		byRowKey.set(rowKey, {
			...(existing.height >= measurement.height ? existing : measurement),
			annotationKind: rankAnnotationKind([existing.annotationKind, measurement.annotationKind]),
			annotationColor: existing.annotationColor ?? measurement.annotationColor,
			line: existing.line ?? measurement.line,
		});
	}
	return [...byRowKey.values()];
}

export interface ReviewDiffMinimapProps {
	scrollRef: RefObject<HTMLDivElement | null>;
	/**
	 * Anything that changes what the scroller renders — the display items, the split
	 * toggle, the full-file toggle. A new value re-measures.
	 */
	revision: unknown;
}

/**
 * The overview ruler beside the diff: where the additions, the deletions and the
 * annotations are in the file, and where the viewport currently sits among them.
 *
 * The native scrollbar answers only the last of those, so aiming a scroll at the next
 * hunk meant dragging and reading until one appeared.
 */
export function ReviewDiffMinimap({ scrollRef, revision }: ReviewDiffMinimapProps): ReactElement {
	const railRef = useRef<HTMLDivElement | null>(null);
	const [measurements, setMeasurements] = useState<MinimapMeasurement[]>([]);
	const [contentHeight, setContentHeight] = useState(0);
	const [rulerHeight, setRulerHeight] = useState(0);
	const [thumb, setThumb] = useState<MinimapThumb | null>(null);
	const [hoverLine, setHoverLine] = useState<number | null>(null);
	const { startDrag } = useResizeDrag();

	const syncThumb = useCallback(() => {
		const scroller = scrollRef.current;
		const rail = railRef.current;
		if (!scroller || !rail) {
			return;
		}
		setThumb(
			buildMinimapThumb(
				{
					scrollTop: scroller.scrollTop,
					scrollHeight: scroller.scrollHeight,
					clientHeight: scroller.clientHeight,
				},
				rail.clientHeight,
			),
		);
	}, [scrollRef]);

	const measure = useCallback(() => {
		const scroller = scrollRef.current;
		const rail = railRef.current;
		if (!scroller || !rail) {
			return;
		}
		setMeasurements(measureRows(scroller));
		setContentHeight(scroller.scrollHeight);
		setRulerHeight(rail.clientHeight);
		syncThumb();
	}, [scrollRef, syncThumb]);

	// After paint, not during it: a row's height is only known once the browser has laid
	// the diff out, and expanding a collapsed block changes it again.
	useEffect(() => {
		const frame = requestAnimationFrame(measure);
		return () => {
			cancelAnimationFrame(frame);
		};
	}, [measure, revision]);

	useEffect(() => {
		const scroller = scrollRef.current;
		// jsdom ships no ResizeObserver; the revision effect above still measures, which
		// is what the tests exercise.
		if (!scroller || typeof ResizeObserver === "undefined") {
			return;
		}
		let frame: number | null = null;
		const schedule = (): void => {
			if (frame !== null) {
				return;
			}
			frame = requestAnimationFrame(() => {
				frame = null;
				measure();
			});
		};
		const observer = new ResizeObserver(schedule);
		observer.observe(scroller);
		// The content child too: wrapping a long line reflows the rows without resizing
		// the scroller, and that moves every mark below it.
		const content = scroller.firstElementChild;
		if (content instanceof HTMLElement) {
			observer.observe(content);
		}
		return () => {
			observer.disconnect();
			if (frame !== null) {
				cancelAnimationFrame(frame);
			}
		};
	}, [measure, scrollRef, revision]);

	useEffect(() => {
		const scroller = scrollRef.current;
		if (!scroller) {
			return;
		}
		let frame: number | null = null;
		const onScroll = (): void => {
			if (frame !== null) {
				return;
			}
			frame = requestAnimationFrame(() => {
				frame = null;
				syncThumb();
			});
		};
		scroller.addEventListener("scroll", onScroll, { passive: true });
		return () => {
			scroller.removeEventListener("scroll", onScroll);
			if (frame !== null) {
				cancelAnimationFrame(frame);
			}
		};
	}, [scrollRef, syncThumb]);

	const marks = useMemo(
		() => buildMinimapMarks(measurements, { contentHeight, rulerHeight }),
		[contentHeight, measurements, rulerHeight],
	);

	const scrollToRulerOffset = useCallback(
		(clientY: number) => {
			const scroller = scrollRef.current;
			const rail = railRef.current;
			if (!scroller || !rail) {
				return;
			}
			const offsetY = clientY - rail.getBoundingClientRect().top;
			scroller.scrollTop = scrollTopForRulerOffset(offsetY, {
				rulerHeight: rail.clientHeight,
				scrollHeight: scroller.scrollHeight,
				clientHeight: scroller.clientHeight,
			});
			syncThumb();
		},
		[scrollRef, syncThumb],
	);

	const onMouseDown = useCallback(
		(event: ReactMouseEvent<HTMLDivElement>) => {
			scrollToRulerOffset(event.clientY);
			startDrag(event, {
				axis: "y",
				cursor: "ns-resize",
				onMove: (pointerY) => scrollToRulerOffset(pointerY),
			});
		},
		[scrollToRulerOffset, startDrag],
	);

	const onMouseMove = useCallback(
		(event: ReactMouseEvent<HTMLDivElement>) => {
			const rail = railRef.current;
			if (!rail) {
				return;
			}
			setHoverLine(
				lineAtRulerOffset(measurements, event.clientY - rail.getBoundingClientRect().top, {
					contentHeight,
					rulerHeight,
				}),
			);
		},
		[contentHeight, measurements, rulerHeight],
	);

	return (
		<div
			ref={railRef}
			data-testid="review-diff-minimap"
			aria-hidden
			title={hoverLine === null ? "Changes in this file" : `Line ${hoverLine}`}
			className="kb-review-minimap relative w-3 shrink-0 cursor-pointer border-l border-border bg-surface-1"
			onMouseDown={onMouseDown}
			onMouseMove={onMouseMove}
			onMouseLeave={() => setHoverLine(null)}
		>
			{marks.changes.map((mark) => (
				<div
					key={mark.key}
					className={cn(
						"kb-review-minimap-mark",
						mark.variant === "added" ? "kb-review-minimap-added" : "kb-review-minimap-removed",
					)}
					style={{ top: mark.top, height: mark.height }}
				/>
			))}
			{marks.annotations.map((mark) => (
				<div
					key={mark.key}
					className={cn("kb-review-minimap-annotation", `kb-review-minimap-${mark.annotationKind}`)}
					style={{
						top: mark.top,
						height: mark.height,
						// A tag's dot takes the chip's own colour, so the ruler and the palette
						// agree about what is marked down there.
						background: mark.annotationColor ?? undefined,
					}}
				/>
			))}
			{thumb ? (
				<div className="kb-review-minimap-thumb" style={{ top: thumb.top, height: thumb.height }} />
			) : null}
		</div>
	);
}
