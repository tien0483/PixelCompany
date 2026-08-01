import { describe, expect, it } from "vitest";

import { detectAgentAuthFailure } from "../../../src/terminal/agent-auth-failure";

describe("detectAgentAuthFailure", () => {
	it("detects Cursor invalid API key output", () => {
		const message = detectAgentAuthFailure(
			"cursor",
			"Error: The provided API key is invalid.\nAPI key was loaded from the CURSOR_API_KEY environment variable.",
		);
		expect(message).toMatch(/Cursor authentication failed/i);
	});

	it("detects Claude /login prompts", () => {
		const message = detectAgentAuthFailure("claude", "Not logged in. Please run /login to continue.");
		expect(message).toMatch(/Claude Code needs login/i);
	});

	it("returns null for unrelated agent output", () => {
		expect(detectAgentAuthFailure("claude", "Reading files...\nDone.")).toBeNull();
		expect(detectAgentAuthFailure("cursor", "Planning next steps")).toBeNull();
		expect(detectAgentAuthFailure("codex", "please run /login")).toBeNull();
	});
});
