import { afterEach, describe, expect, it } from "vitest";

import { isFlowiseLlmProxyFlagEnabled, resolveFlowiseLlmProxyStatus } from "../../../src/flowise/flowise-llm-proxy";

const originalFlag = process.env.PIXELOFFICE_FLOWISE_LLM_PROXY;
const originalBaseUrl = process.env.ANTHROPIC_BASE_URL;

afterEach(() => {
	if (originalFlag === undefined) {
		delete process.env.PIXELOFFICE_FLOWISE_LLM_PROXY;
	} else {
		process.env.PIXELOFFICE_FLOWISE_LLM_PROXY = originalFlag;
	}
	if (originalBaseUrl === undefined) {
		delete process.env.ANTHROPIC_BASE_URL;
	} else {
		process.env.ANTHROPIC_BASE_URL = originalBaseUrl;
	}
});

describe("flowise-llm-proxy", () => {
	it("reports stub status when flag is off", () => {
		delete process.env.PIXELOFFICE_FLOWISE_LLM_PROXY;
		const status = resolveFlowiseLlmProxyStatus();
		expect(status.phase).toBe(3);
		expect(status.enabled).toBe(false);
		expect(status.available).toBe(false);
		expect(isFlowiseLlmProxyFlagEnabled()).toBe(false);
	});

	it("reports enabled stub when flag is on", () => {
		process.env.PIXELOFFICE_FLOWISE_LLM_PROXY = "1";
		process.env.ANTHROPIC_BASE_URL = "http://127.0.0.1:8787";
		const status = resolveFlowiseLlmProxyStatus();
		expect(status.enabled).toBe(true);
		expect(status.available).toBe(false);
		expect(status.switchboardBaseUrl).toBe("http://127.0.0.1:8787");
	});
});
