import { describe, expect, it } from "vitest";

import { parseCursorListModelsOutput } from "../../../src/terminal/agent-model-inventory";

describe("parseCursorListModelsOutput", () => {
	it("parses agent --list-models lines", () => {
		const stdout = [
			"Available models",
			"",
			"auto - Auto (current, default)",
			"composer-2.5 - Composer 2.5",
			"gpt-5.2 - GPT-5.2",
			"not-a-model-line",
		].join("\n");
		expect(parseCursorListModelsOutput(stdout)).toEqual([
			{ id: "auto", label: "Auto (current, default)" },
			{ id: "composer-2.5", label: "Composer 2.5" },
			{ id: "gpt-5.2", label: "GPT-5.2" },
		]);
	});

	it("dedupes repeated ids", () => {
		const stdout = ["auto - Auto", "auto - Auto again"].join("\n");
		expect(parseCursorListModelsOutput(stdout)).toEqual([{ id: "auto", label: "Auto" }]);
	});
});
