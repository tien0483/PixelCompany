/**
 * Geometry for the diff pane's overview ruler.
 *
 * The ruler exists because the diff scroller is a plain `overflow-auto` div: the native
 * scrollbar says how far down the file the reviewer is, and nothing at all about where
 * the changes or the annotations sit. Everything here is pure so the projection can be
 * tested without a layout engine; the component only measures the DOM and paints.
 */

export type MinimapVariant = "added" | "removed" | "context";

/** Ranked, most important first: one row can carry all three, and a dot shows one. */
export type MinimapAnnotationKind = "thread" | "draft" | "tag";

const ANNOTATION_PRIORITY: readonly MinimapAnnotationKind[] = ["thread", "draft", "tag"];

/** One measured diff row, in scroll-content pixels. */
export interface MinimapMeasurement {
	top: number;
	height: number;
	variant: MinimapVariant;
	annotationKind: MinimapAnnotationKind | null;
	/** The tag's own colour, so a dot matches the chip that made it. */
	annotationColor: string | null;
	/** Post-image line number, for the hover readout. Null on a deletion. */
	line: number | null;
}

/** One painted band, in ruler pixels. */
export interface MinimapMark {
	key: string;
	top: number;
	height: number;
	variant: MinimapVariant;
	annotationKind: MinimapAnnotationKind | null;
	annotationColor: string | null;
	line: number | null;
}

export interface MinimapMarks {
	/** Green/red bands for the added and removed runs. */
	changes: MinimapMark[];
	/** Dots for tagged, drafted and discussed lines, painted over the bands. */
	annotations: MinimapMark[];
}

export interface MinimapProjection {
	contentHeight: number;
	rulerHeight: number;
	/** Floor for a band's painted height, so a one-line change cannot vanish. */
	minMarkPx?: number;
}

const EMPTY_MARKS: MinimapMarks = { changes: [], annotations: [] };

/**
 * Picks the kind a row's dot should show when it carries more than one. A published
 * thread outranks an unsent draft, which outranks a tag: the further along the comment
 * is, the more it matters that the reviewer can find it again.
 */
export function rankAnnotationKind(
	kinds: readonly (MinimapAnnotationKind | null)[],
): MinimapAnnotationKind | null {
	for (const candidate of ANNOTATION_PRIORITY) {
		if (kinds.includes(candidate)) {
			return candidate;
		}
	}
	return null;
}

function projectMark(
	run: { top: number; end: number; sample: MinimapMeasurement },
	index: number,
	prefix: string,
	projection: MinimapProjection,
): MinimapMark {
	const rulerHeight = Math.max(projection.rulerHeight, 0);
	const minMarkPx = projection.minMarkPx ?? 2;
	const scale = rulerHeight / Math.max(projection.contentHeight, 1);
	const rawTop = run.top * scale;
	const rawHeight = (run.end - run.top) * scale;
	const height = Math.max(minMarkPx, Math.round(rawHeight));
	// Clamping the top (not the height) is what keeps the last row of a file on the
	// ruler: rounding a band that ends at the very bottom would otherwise push it past
	// the track and hide the change the reviewer is most likely still scrolling toward.
	const top = Math.max(0, Math.min(Math.round(rawTop), Math.max(0, rulerHeight - height)));
	return {
		key: `${prefix}-${index}`,
		top,
		height,
		variant: run.sample.variant,
		annotationKind: run.sample.annotationKind,
		annotationColor: run.sample.annotationColor,
		line: run.sample.line,
	};
}

/**
 * Merges consecutive measurements the predicate calls alike into runs, then projects
 * each run onto the ruler. Rows are merged in content space rather than ruler space so
 * a hunk stays one band no matter how long the file is.
 */
function buildRuns(
	measurements: readonly MinimapMeasurement[],
	isSameRun: (previous: MinimapMeasurement, next: MinimapMeasurement) => boolean,
): { top: number; end: number; sample: MinimapMeasurement }[] {
	const runs: { top: number; end: number; sample: MinimapMeasurement }[] = [];
	let previous: MinimapMeasurement | null = null;
	for (const measurement of measurements) {
		const end = measurement.top + measurement.height;
		const current = runs[runs.length - 1];
		// `+ 1`: a sub-pixel row height leaves a hairline gap between two rows that are
		// visually adjacent, and treating that as a break would shred a hunk into stripes.
		const isContiguous =
			current !== undefined && previous !== null && measurement.top <= current.end + 1 && isSameRun(previous, measurement);
		if (current && isContiguous) {
			current.end = Math.max(current.end, end);
		} else {
			runs.push({ top: measurement.top, end, sample: measurement });
		}
		previous = measurement;
	}
	return runs;
}

export function buildMinimapMarks(
	measurements: readonly MinimapMeasurement[],
	projection: MinimapProjection,
): MinimapMarks {
	if (measurements.length === 0 || projection.rulerHeight <= 0 || projection.contentHeight <= 0) {
		return EMPTY_MARKS;
	}
	const ordered = [...measurements].sort((left, right) => left.top - right.top);

	const changeRuns = buildRuns(
		ordered.filter((measurement) => measurement.variant !== "context"),
		(previous, next) => previous.variant === next.variant,
	);
	const annotationRuns = buildRuns(
		ordered.filter((measurement) => measurement.annotationKind !== null),
		(previous, next) =>
			previous.annotationKind === next.annotationKind && previous.annotationColor === next.annotationColor,
	);

	return {
		changes: changeRuns.map((run, index) => projectMark(run, index, "change", projection)),
		annotations: annotationRuns.map((run, index) => projectMark(run, index, "annotation", projection)),
	};
}

export interface RulerScrollGeometry {
	rulerHeight: number;
	scrollHeight: number;
	clientHeight: number;
}

/**
 * Where to scroll so the ruler position the reviewer pressed lands in the middle of the
 * viewport. Centring rather than aligning to the top is what makes an aimed click land
 * on the hunk instead of just above it.
 */
export function scrollTopForRulerOffset(offsetY: number, geometry: RulerScrollGeometry): number {
	const rulerHeight = Math.max(geometry.rulerHeight, 1);
	const maxScrollTop = Math.max(0, geometry.scrollHeight - geometry.clientHeight);
	const fraction = Math.max(0, Math.min(1, offsetY / rulerHeight));
	const target = fraction * geometry.scrollHeight - geometry.clientHeight / 2;
	return Math.max(0, Math.min(maxScrollTop, Math.round(target)));
}

export interface MinimapThumb {
	top: number;
	height: number;
}

/** The box showing what is on screen, in ruler pixels. */
export function buildMinimapThumb(
	scroll: { scrollTop: number; scrollHeight: number; clientHeight: number },
	rulerHeight: number,
	minThumbPx = 8,
): MinimapThumb {
	const scrollHeight = Math.max(scroll.scrollHeight, 1);
	const scale = Math.max(rulerHeight, 0) / scrollHeight;
	const height = Math.max(minThumbPx, Math.round(scroll.clientHeight * scale));
	const top = Math.max(0, Math.min(Math.round(scroll.scrollTop * scale), Math.max(0, rulerHeight - height)));
	return { top, height };
}

/** The post-image line nearest a ruler position, for the hover readout. */
export function lineAtRulerOffset(
	measurements: readonly MinimapMeasurement[],
	offsetY: number,
	projection: Pick<MinimapProjection, "contentHeight" | "rulerHeight">,
): number | null {
	if (measurements.length === 0 || projection.rulerHeight <= 0) {
		return null;
	}
	const fraction = Math.max(0, Math.min(1, offsetY / Math.max(projection.rulerHeight, 1)));
	const contentOffset = fraction * projection.contentHeight;
	let bestLine: number | null = null;
	let bestDistance = Number.POSITIVE_INFINITY;
	for (const measurement of measurements) {
		if (measurement.line === null) {
			continue;
		}
		const centre = measurement.top + measurement.height / 2;
		const distance = Math.abs(centre - contentOffset);
		if (distance < bestDistance) {
			bestDistance = distance;
			bestLine = measurement.line;
		}
	}
	return bestLine;
}
