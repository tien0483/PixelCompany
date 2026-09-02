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

	it("injects OmniRoute subscription, ASR, and TTS env when the proxy is enabled", () => {
		delete process.env.PIXELOFFICE_FLOWISE_LLM_PROXY;
		const env: NodeJS.ProcessEnv = {};
		applyOpenmaicClassroomProxyEnv(env);

		expect(env.OMNIROUTE_API_KEY).toBe(OPENMAIC_SEAT_PLACEHOLDER_KEY);
		expect(env.OMNIROUTE_BASE_URL).toContain("/api/flowise-llm-proxy/openai/v1");
		expect(env.ASR_OPENAI_BASE_URL).toContain("/api/flowise-llm-proxy/openai/v1");
		expect(env.TTS_OPENAI_BASE_URL).toContain("/api/flowise-llm-proxy/openai/v1");
		expect(env.TTS_OPENAI_API_KEY).toBe(OPENMAIC_SEAT_PLACEHOLDER_KEY);
		expect(env.CURSOR_API_KEY).toBeUndefined();
		expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
	});

	it("does nothing when the proxy is disabled", () => {
		process.env.PIXELOFFICE_FLOWISE_LLM_PROXY = "0";
		const env: NodeJS.ProcessEnv = { OMNIROUTE_API_KEY: "keep" };
		applyOpenmaicClassroomProxyEnv(env);
		expect(env.OMNIROUTE_API_KEY).toBe("keep");
		expect(env.OMNIROUTE_BASE_URL).toBeUndefined();
	});
});
