import { describe, expect, it } from "vitest";

import {
	listAgentModelInventory,
	parseCursorListModelsOutput,
	parseGeminiListModelsOutput,
} from "../../../src/terminal/agent-model-inventory";

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

describe("parseGeminiListModelsOutput", () => {
	it("parses agy models output lines, normalizes base IDs and dedupes", () => {
		const stdout = [
			"⠋ Fetching available models...⠙ Fetching available models...",
			"gemini-3.7-flash-high     Gemini 3.7 Flash (High)",
			"gemini-3.7-flash-medium   Gemini 3.7 Flash (Medium)",
			"gemini-3.1-pro-high       Gemini 3.1 Pro (High)",
			"claude-sonnet-4-6         Claude Sonnet 4.6 (Thinking)",
			"Available agents:",
			"cavecrew-builder",
		].join("\n");
		expect(parseGeminiListModelsOutput(stdout)).toEqual([
			{ id: "gemini-3.7-flash", label: "Gemini 3.7 Flash" },
			{ id: "gemini-3.1-pro", label: "Gemini 3.1 Pro" },
			{ id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
		]);
	});

	it("falls back to Gemini catalog models when CLI is unavailable", async () => {
		const result = await listAgentModelInventory("gemini");
		expect(result.agentId).toBe("gemini");
		expect(result.models.length).toBeGreaterThan(0);
		expect(result.models.some((m) => m.id === "gemini-3.7-flash")).toBe(true);
	});
});
