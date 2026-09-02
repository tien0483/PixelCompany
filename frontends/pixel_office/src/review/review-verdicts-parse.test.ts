import { describe, expect, it } from "vitest";

import { parseVerdictsFromStream } from "@/review/review-findings-parse";

describe("parseVerdictsFromStream", () => {
	it("extracts a verdict from a bare JSON array", () => {
		const verdicts = parseVerdictsFromStream(
			'[{"annotationId":"ann-1","verdict":"confirmed","reasoning":"clear bug"}]',
		);

		expect(verdicts).toHaveLength(1);
		expect(verdicts[0]).toEqual({
			annotationId: "ann-1",
			verdict: "confirmed",
			reasoning: "clear bug",
		});
	});

	it("extracts verdicts from a code-fenced array alongside findings", () => {
		const stream = [
			"Some preamble from Claude.",
			"```json",
			'[',
			'  {"newPath":"a.ts","newLine":4,"message":"real finding"},',
			'  {"annotationId":"ann-2","verdict":"not_an_issue","reasoning":"false positive"},',
			'  {"annotationId":"ann-3","verdict":"partial","reasoning":"sort of"}',
			']',
			"```",
		].join("\n");

		const verdicts = parseVerdictsFromStream(stream);
		expect(verdicts).toHaveLength(2);
		expect(verdicts[0]?.annotationId).toBe("ann-2");
		expect(verdicts[0]?.verdict).toBe("not_an_issue");
		expect(verdicts[1]?.verdict).toBe("partial");
	});

	it("drops items with an unknown verdict value", () => {
		const verdicts = parseVerdictsFromStream(
			'[{"annotationId":"ann-1","verdict":"maybe","reasoning":"unsure"}]',
		);

		// Unknown verdict is worse than none — silently dropped.
		expect(verdicts).toEqual([]);
	});

	it("drops items without an annotationId", () => {
		const verdicts = parseVerdictsFromStream(
			'[{"verdict":"confirmed","reasoning":"oops, no id"}]',
		);
		expect(verdicts).toEqual([]);
	});

	it("defaults reasoning to empty string when absent", () => {
		const verdicts = parseVerdictsFromStream(
			'[{"annotationId":"ann-1","verdict":"confirmed"}]',
		);

		expect(verdicts[0]?.reasoning).toBe("");
	});

	it("does not confuse finding items (which have newPath) with verdict items", () => {
		const verdicts = parseVerdictsFromStream(
			'[{"newPath":"a.ts","newLine":5,"message":"bug"},{"annotationId":"ann-9","verdict":"partial","reasoning":"r"}]',
		);

		// Only the verdict item must be returned; findings are not verdicts.
		expect(verdicts).toHaveLength(1);
		expect(verdicts[0]?.annotationId).toBe("ann-9");
	});

	it("returns empty array for unparseable text", () => {
		expect(parseVerdictsFromStream("I found nothing notable.")).toEqual([]);
		expect(parseVerdictsFromStream("[{bad json}]")).toEqual([]);
	});
});
