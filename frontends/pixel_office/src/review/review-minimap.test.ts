import { describe, expect, it } from "vitest";

import {
	buildMinimapMarks,
	buildMinimapThumb,
	lineAtRulerOffset,
	type MinimapAnnotationKind,
	type MinimapMeasurement,
	type MinimapVariant,
	rankAnnotationKind,
	scrollTopForRulerOffset,
} from "@/review/review-minimap";

const ROW_HEIGHT = 20;

function row(
	index: number,
	variant: MinimapVariant,
	overrides: {
		annotationKind?: MinimapAnnotationKind | null;
		annotationColor?: string | null;
		line?: number | null;
	} = {},
): MinimapMeasurement {
	return {
		top: index * ROW_HEIGHT,
		height: ROW_HEIGHT,
		variant,
		annotationKind: overrides.annotationKind ?? null,
		annotationColor: overrides.annotationColor ?? null,
		line: overrides.line === undefined ? index + 1 : overrides.line,
	};
}

/** 100 rows of content painted onto a 200px ruler: one row is 2px, below the floor. */
const PROJECTION = { contentHeight: 100 * ROW_HEIGHT, rulerHeight: 200 };

describe("buildMinimapMarks", () => {
	it("merges a run of like rows into one band and drops context rows", () => {
		const measurements = [
			row(0, "context"),
			row(1, "added"),
			row(2, "added"),
			row(3, "added"),
			row(4, "context"),
		];

		const { changes } = buildMinimapMarks(measurements, PROJECTION);

		expect(changes).toHaveLength(1);
		expect(changes[0]).toMatchObject({ variant: "added", top: 2, height: 6 });
	});

	it("keeps a deletion and the addition below it as separate bands", () => {
		const { changes } = buildMinimapMarks([row(10, "removed"), row(11, "added")], PROJECTION);

		expect(changes.map((mark) => mark.variant)).toEqual(["removed", "added"]);
	});

	it("floors a single changed line so it stays visible", () => {
		// One row is 20/2000 of a 200px ruler — 2px — and a taller floor has to win.
		const { changes } = buildMinimapMarks([row(50, "added")], { ...PROJECTION, minMarkPx: 4 });

		expect(changes[0]?.height).toBe(4);
	});

	it("keeps the last row of a file on the track", () => {
		const { changes } = buildMinimapMarks([row(99, "added")], { ...PROJECTION, minMarkPx: 6 });

		const mark = changes[0];
		expect(mark).toBeDefined();
		expect((mark?.top ?? 0) + (mark?.height ?? 0)).toBeLessThanOrEqual(PROJECTION.rulerHeight);
	});

	it("splits annotation runs by kind and by colour, and carries the colour through", () => {
		const measurements = [
			row(1, "added", { annotationKind: "tag", annotationColor: "var(--a)" }),
			row(2, "added", { annotationKind: "tag", annotationColor: "var(--a)" }),
			row(3, "added", { annotationKind: "tag", annotationColor: "var(--b)" }),
			row(4, "added", { annotationKind: "draft" }),
		];

		const { annotations } = buildMinimapMarks(measurements, PROJECTION);

		expect(annotations).toHaveLength(3);
		expect(annotations[0]).toMatchObject({ annotationKind: "tag", annotationColor: "var(--a)" });
		expect(annotations[1]).toMatchObject({ annotationKind: "tag", annotationColor: "var(--b)" });
		expect(annotations[2]).toMatchObject({ annotationKind: "draft" });
	});

	it("orders measurements itself, since split mode emits two columns", () => {
		const { changes } = buildMinimapMarks([row(3, "added"), row(1, "removed")], PROJECTION);

		expect(changes.map((mark) => mark.variant)).toEqual(["removed", "added"]);
	});

	it("returns nothing when there is no content or no ruler to paint on", () => {
		expect(buildMinimapMarks([], PROJECTION).changes).toEqual([]);
		expect(buildMinimapMarks([row(1, "added")], { contentHeight: 0, rulerHeight: 200 }).changes).toEqual([]);
		expect(buildMinimapMarks([row(1, "added")], { contentHeight: 2000, rulerHeight: 0 }).changes).toEqual([]);
	});
});

describe("rankAnnotationKind", () => {
	it("prefers the comment that has travelled furthest", () => {
		expect(rankAnnotationKind(["tag", "draft", "thread"])).toBe("thread");
		expect(rankAnnotationKind(["tag", "draft"])).toBe("draft");
		expect(rankAnnotationKind(["tag"])).toBe("tag");
		expect(rankAnnotationKind([null])).toBeNull();
	});
});

describe("scrollTopForRulerOffset", () => {
	const geometry = { rulerHeight: 200, scrollHeight: 2000, clientHeight: 400 };

	it("centres the clicked position in the viewport", () => {
		// Half way down 2000px of content is 1000px; centring backs off half a viewport.
		expect(scrollTopForRulerOffset(100, geometry)).toBe(800);
	});

	it("clamps at both ends instead of overscrolling", () => {
		expect(scrollTopForRulerOffset(0, geometry)).toBe(0);
		expect(scrollTopForRulerOffset(-40, geometry)).toBe(0);
		expect(scrollTopForRulerOffset(200, geometry)).toBe(1600);
		expect(scrollTopForRulerOffset(9000, geometry)).toBe(1600);
	});

	it("stays at zero when the content fits", () => {
		expect(scrollTopForRulerOffset(120, { rulerHeight: 200, scrollHeight: 300, clientHeight: 300 })).toBe(0);
	});
});

describe("buildMinimapThumb", () => {
	it("sizes and places the thumb from the scroll position", () => {
		expect(buildMinimapThumb({ scrollTop: 1000, scrollHeight: 2000, clientHeight: 400 }, 200)).toEqual({
			top: 100,
			height: 40,
		});
	});

	it("floors a thumb that would be a hairline, and keeps it on the track", () => {
		const thumb = buildMinimapThumb({ scrollTop: 99_000, scrollHeight: 100_000, clientHeight: 400 }, 200, 8);

		expect(thumb.height).toBe(8);
		expect(thumb.top + thumb.height).toBeLessThanOrEqual(200);
	});
});

describe("lineAtRulerOffset", () => {
	const measurements = [row(0, "context"), row(50, "added"), row(99, "added")];

	it("reports the nearest post-image line", () => {
		expect(lineAtRulerOffset(measurements, 0, PROJECTION)).toBe(1);
		expect(lineAtRulerOffset(measurements, 100, PROJECTION)).toBe(51);
		expect(lineAtRulerOffset(measurements, 200, PROJECTION)).toBe(100);
	});

	it("ignores rows with no post-image line, and empty input", () => {
		expect(lineAtRulerOffset([row(50, "removed", { line: null })], 100, PROJECTION)).toBeNull();
		expect(lineAtRulerOffset([], 100, PROJECTION)).toBeNull();
	});
});
