import { describe, expect, it } from "vitest";

import { buildOpenmaicHealth } from "../../../src/trpc/openmaic-api";

describe("buildOpenmaicHealth", () => {
	it("prioritizes Gemini API key for TTS/Video but not ASR when present", () => {
		const envMap = new Map<string, string>([
			["GEMINI_API_KEY", "AIza-test"],
			["OPENAI_API_KEY", "sk-openai"],
		]);

		const health = buildOpenmaicHealth({
			envMap,
			hasEnvFile: true,
			seatSummary: null,
			asrSeatLabel: null,
			geminiProbe: { ok: true, detail: "Gemini models endpoint reachable." },
		});

		expect(health.asrReady).toBe(true);
		expect(health.ttsReady).toBe(true);
		expect(health.videoReady).toBe(true);
		expect(health.asrSource).toBe("browser-native");
		expect(health.ttsSource).toBe("gemini-api-key");
		expect(health.videoSource).toBe("gemini-api-key");
		expect(health.asrVerified).toBe(false);
		expect(health.ttsVerified).toBe(true);
		expect(health.videoVerified).toBe(true);
	});

	it("uses Gemini seat routing for TTS/video but not ASR (no Gemini transcription backend)", () => {
		const envMap = new Map<string, string>([["OPENAI_API_KEY", "sk-openai"]]);

		const health = buildOpenmaicHealth({
			envMap,
			hasEnvFile: true,
			seatSummary: { accountId: 7, accountLabel: "Antigravity seat" },
			asrSeatLabel: null,
			geminiProbe: null,
		});

		expect(health.ttsSource).toBe("gemini-seat");
		expect(health.videoSource).toBe("gemini-seat");
		expect(health.asrSource).toBe("browser-native");
		expect(health.asrReady).toBe(true);
		expect(health.subscriptionSeatRoutingReady).toBe(true);
		expect(health.subscriptionSeatRoutingDetail).toContain("Antigravity seat");
		expect(health.asrVerified).toBe(false);
	});

	it("reports Manager API seat routing for ASR when the proxy seat is available", () => {
		const health = buildOpenmaicHealth({
			envMap: new Map(),
			hasEnvFile: false,
			seatSummary: null,
			asrSeatLabel: "OmniRoute",
			geminiProbe: null,
		});

		expect(health.asrReady).toBe(true);
		expect(health.asrSource).toBe("provider-api-key");
		expect(health.asrDetail).toContain("OmniRoute");
	});

	it("falls back to browser/native and provider keys when Gemini is unavailable", () => {
		const envMap = new Map<string, string>([
			["ASR_BROWSER_NATIVE_ENABLED", "true"],
			["TTS_BROWSER_NATIVE_ENABLED", "1"],
			["LUMA_API_KEY", "luma-key"],
		]);

		const health = buildOpenmaicHealth({
			envMap,
			hasEnvFile: true,
			seatSummary: null,
			asrSeatLabel: null,
			geminiProbe: null,
		});

		expect(health.asrSource).toBe("browser-native");
		expect(health.ttsSource).toBe("browser-native");
		expect(health.videoSource).toBe("provider-api-key");
		expect(health.videoReady).toBe(true);
		expect(health.missingKeys).toContain("Subscriptions (Antigravity/Cursor/Claude) are not auto-wired into OpenMAIC");
	});

	it("reports missing setup when nothing is configured", () => {
		const health = buildOpenmaicHealth({
			envMap: new Map(),
			hasEnvFile: false,
			seatSummary: null,
			asrSeatLabel: null,
			geminiProbe: null,
		});

		expect(health.asrReady).toBe(false);
		expect(health.ttsReady).toBe(false);
		expect(health.videoReady).toBe(false);
		expect(health.missingKeys).toContain("Create `backends/openmaic/.env.local` from `.env.example`");
		expect(health.missingKeys).toContain(
			"ASR: configure a Manager API seat (OmniRoute) or use browser-native speech recognition",
		);
		expect(health.missingKeys).toContain("TTS: enable browser TTS or configure a provider API key");
		expect(health.missingKeys).toContain("Video: configure a video generation provider API key");
	});
});
