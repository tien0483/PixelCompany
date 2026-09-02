import { afterEach, describe, expect, it, vi } from "vitest";

import {
	clearOpenmaicOmniRouteProbeCache,
	probeOmniRouteAudioCapabilities,
} from "../../../src/openmaic/openmaic-omniroute-probe";
import * as proxyConfig from "../../../src/flowise/flowise-llm-proxy-config";

describe("probeOmniRouteAudioCapabilities", () => {
	afterEach(() => {
		clearOpenmaicOmniRouteProbeCache();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it("detects ASR and TTS support from supportedEndpoints", async () => {
		vi.spyOn(proxyConfig, "resolveFlowiseLlmProxyProviderUrl").mockReturnValue("http://127.0.0.1:3484/api/flowise-llm-proxy/openai");
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({
				ok: true,
				json: async () => ({
					data: [
						{ id: "openai/whisper-1", supportedEndpoints: ["audio-transcriptions"] },
						{ id: "openai/tts-1", supportedEndpoints: ["audio-speech"] },
					],
				}),
			})),
		);

		await expect(probeOmniRouteAudioCapabilities()).resolves.toEqual({ asr: true, tts: true });
	});

	it("returns null when the models request fails", async () => {
		vi.spyOn(proxyConfig, "resolveFlowiseLlmProxyProviderUrl").mockReturnValue("http://127.0.0.1:3484/api/flowise-llm-proxy/openai");
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({
				ok: false,
			})),
		);

		await expect(probeOmniRouteAudioCapabilities()).resolves.toBeNull();
	});
});
