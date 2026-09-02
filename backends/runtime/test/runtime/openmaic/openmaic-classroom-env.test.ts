import { afterEach, describe, expect, it } from "vitest";

import { applyOpenmaicClassroomProxyEnv, OPENMAIC_SEAT_PLACEHOLDER_KEY } from "../../../src/openmaic/openmaic-classroom-env";

describe("applyOpenmaicClassroomProxyEnv", () => {
	const originalProxy = process.env.PIXELOFFICE_FLOWISE_LLM_PROXY;

	afterEach(() => {
		if (originalProxy === undefined) {
			delete process.env.PIXELOFFICE_FLOWISE_LLM_PROXY;
		} else {
			process.env.PIXELOFFICE_FLOWISE_LLM_PROXY = originalProxy;
		}
	});

	it("injects subscription, ASR, image, and TTS env when the proxy is enabled", () => {
		delete process.env.PIXELOFFICE_FLOWISE_LLM_PROXY;
		const env: NodeJS.ProcessEnv = {};
		applyOpenmaicClassroomProxyEnv(env);

		expect(env.CURSOR_API_KEY).toBe(OPENMAIC_SEAT_PLACEHOLDER_KEY);
		expect(env.CURSOR_BASE_URL).toContain("/api/flowise-llm-proxy/cursor/v1");
		expect(env.ANTIGRAVITY_BASE_URL).toContain("/api/flowise-llm-proxy/gemini/v1beta");
		expect(env.ANTHROPIC_BASE_URL).toContain("/api/flowise-llm-proxy/anthropic/v1");
		expect(env.ASR_OPENAI_BASE_URL).toContain("/api/flowise-llm-proxy/openai/v1");
		expect(env.IMAGE_OPENAI_BASE_URL).toContain("/api/flowise-llm-proxy/cursor/v1");
		expect(env.IMAGE_NANO_BANANA_BASE_URL).toContain("/api/flowise-llm-proxy/gemini/v1beta");
		expect(env.TTS_BROWSER_NATIVE_ENABLED).toBe("true");
	});

	it("does nothing when the proxy is disabled", () => {
		process.env.PIXELOFFICE_FLOWISE_LLM_PROXY = "0";
		const env: NodeJS.ProcessEnv = { CURSOR_API_KEY: "keep" };
		applyOpenmaicClassroomProxyEnv(env);
		expect(env.CURSOR_API_KEY).toBe("keep");
		expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
	});
});
