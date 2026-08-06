import { describe, expect, it } from "vitest";

import {
	makeParser,
	rescueHtmlFromToolUse,
} from "../../../src/html/html-stream-parser.js";

describe("rescueHtmlFromToolUse", () => {
	it("rescues Write tool HTML and ignores non-html paths", () => {
		const html = rescueHtmlFromToolUse([
			{ type: "text", text: "writing file" },
			{
				type: "tool_use",
				name: "Write",
				input: { file_path: "out.md", content: "# nope" },
			},
			{
				type: "tool_use",
				name: "Write",
				input: { file_path: "card.html", content: "<html><body>hi</body></html>" },
			},
		]);
		expect(html).toBe("<html><body>hi</body></html>");
	});

	it("returns empty string when content is missing", () => {
		expect(rescueHtmlFromToolUse(undefined)).toBe("");
		expect(rescueHtmlFromToolUse([])).toBe("");
	});
});

describe("makeParser (claude)", () => {
	it("emits text deltas from stream_event and html from Write", () => {
		const parse = makeParser("claude");
		const deltas = parse(
			JSON.stringify({
				type: "stream_event",
				event: { type: "content_block_delta", delta: { type: "text_delta", text: "<h" } },
			}),
		);
		expect(deltas).toEqual([{ kind: "delta", text: "<h" }]);

		const rescued = parse(
			JSON.stringify({
				type: "assistant",
				message: {
					content: [
						{ type: "text", text: "已输出至 card.html" },
						{
							type: "tool_use",
							name: "Write",
							input: { path: "card.html", content: "<html>ok</html>" },
						},
					],
				},
			}),
		);
		expect(rescued.some((part) => part.kind === "html" && part.text === "<html>ok</html>")).toBe(
			true,
		);
	});
});
