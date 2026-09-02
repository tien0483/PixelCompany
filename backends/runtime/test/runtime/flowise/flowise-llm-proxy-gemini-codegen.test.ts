import { describe, expect, it } from "vitest";

import {
	buildGeminiCodegenForwardPlan,
	clearCodeAssistProjectCache,
} from "../../../src/flowise/flowise-llm-proxy-gemini-codegen";

describe("flowise-llm-proxy-gemini-codegen", () => {
	it("wraps generateContent in a Code Assist envelope", async () => {
		clearCodeAssistProjectCache();
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async (input: string | URL | Request) => {
			const url = String(input);
			if (url.includes("loadCodeAssist")) {
				return new Response(JSON.stringify({ cloudaicompanionProject: "proj-123" }), { status: 200 });
			}
			throw new Error(`unexpected fetch: ${url}`);
		}) as typeof globalThis.fetch;
		try {
			const plan = await buildGeminiCodegenForwardPlan(
				"POST",
				"/v1beta/models/gemini-2.5-flash:generateContent",
				Buffer.from(JSON.stringify({ contents: [{ role: "user", parts: [{ text: "hi" }] }] }), "utf8"),
				"token-abc",
			);
			expect(plan).not.toBeNull();
			expect(plan?.upstreamUrl).toContain("generateContent");
			expect(plan?.streaming).toBe(false);
			const envelope = JSON.parse(plan?.body?.toString("utf8") ?? "{}") as Record<string, unknown>;
			expect(envelope.project).toBe("proj-123");
			expect(envelope.model).toBe("gemini-2.5-flash");
			expect(envelope.requestType).toBe("agent");
			expect((envelope.request as { contents: unknown[] }).contents).toHaveLength(1);
		} finally {
			globalThis.fetch = originalFetch;
			clearCodeAssistProjectCache();
		}
	});
});
