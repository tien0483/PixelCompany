import { describe, expect, it } from "vitest";

import {
	parseFindingsFromStream,
	parseSuggestionsFromChat,
	stripSuggestionsBlock,
} from "@/review/review-findings-parse";

describe("parseFindingsFromStream", () => {
	it("reads a bare JSON array", () => {
		const findings = parseFindingsFromStream('[{"newPath":"a.py","newLine":4,"severity":"HIGH","message":"m"}]');

		expect(findings).toHaveLength(1);
		expect(findings[0]?.newPath).toBe("a.py");
		expect(findings[0]?.severity).toBe("HIGH");
	});

	it("tolerates a code fence and trailing prose", () => {
		const findings = parseFindingsFromStream(
			'```json\n[{"newPath":"a.py","newLine":4,"message":"m"}]\n```\nThat is all I found.',
		);

		expect(findings).toHaveLength(1);
		// One stray sentence should not throw away a whole review pass.
		expect(findings[0]?.severity).toBe("MEDIUM");
	});

	it("drops elements that could not be rendered", () => {
		const findings = parseFindingsFromStream(
			'[{"message":"no path"},{"newPath":"a.py"},{"newPath":"b.py","message":"ok"}]',
		);

		expect(findings.map((finding) => finding.newPath)).toEqual(["b.py"]);
	});

	it("keeps a null line rather than inventing one", () => {
		const findings = parseFindingsFromStream('[{"newPath":"a.py","message":"m"}]');

		// The panel disables Accept for these; guessing a line would post a note on the
		// wrong code instead.
		expect(findings[0]?.newLine).toBeNull();
	});

	it("returns nothing for unparseable output", () => {
		expect(parseFindingsFromStream("I could not complete the review.")).toEqual([]);
		expect(parseFindingsFromStream("[{oops}]")).toEqual([]);
	});
});

describe("parseSuggestionsFromChat", () => {
	const answer = [
		"The clamp looks wrong for negative input.",
		"",
		"```suggestions",
		'[{"newPath":"src/buf.ts","newLine":46,"severity":"HIGH","message":"guard the negative case"}]',
		"```",
	].join("\n");

	it("reads the suggestions fence", () => {
		const suggestions = parseSuggestionsFromChat(answer);

		expect(suggestions).toHaveLength(1);
		expect(suggestions[0]?.newLine).toBe(46);
	});

	it("ignores a code sample in the prose", () => {
		// The reason this parser is fence-only: a chat answer is mostly prose and
		// routinely contains arrays. Scanning for the first `[` would turn an
		// explanation into a list of review comments.
		const withSample = [
			"You could write it as:",
			"",
			"```ts",
			'const rows = [{ newPath: "x", message: "not a finding" }];',
			"```",
		].join("\n");

		expect(parseSuggestionsFromChat(withSample)).toEqual([]);
	});

	it("returns nothing when the answer has no fence at all", () => {
		expect(parseSuggestionsFromChat("It clamps the offset to the buffer length.")).toEqual([]);
	});

	it("returns nothing for a malformed fence body", () => {
		expect(parseSuggestionsFromChat("```suggestions\n[not json]\n```")).toEqual([]);
	});

	it("gives audit and chat findings distinct ids for the same problem", () => {
		// They live in the same triage/dismiss namespace, so a collision would let
		// dismissing an audit finding silently hide a chat suggestion.
		const fromChat = parseSuggestionsFromChat(answer)[0]?.id;
		const fromAudit = parseFindingsFromStream(
			'[{"newPath":"src/buf.ts","newLine":46,"severity":"HIGH","message":"guard the negative case"}]',
		)[0]?.id;

		expect(fromChat).not.toBe(fromAudit);
	});
});

describe("stripSuggestionsBlock", () => {
	it("removes the fence so the transcript shows prose only", () => {
		const stripped = stripSuggestionsBlock('Looks wrong.\n\n```suggestions\n[{"newPath":"a.py","message":"m"}]\n```');

		expect(stripped).toBe("Looks wrong.");
		expect(stripped).not.toContain("newPath");
	});

	it("leaves an answer without a fence untouched", () => {
		expect(stripSuggestionsBlock("It clamps the offset.")).toBe("It clamps the offset.");
	});
});
