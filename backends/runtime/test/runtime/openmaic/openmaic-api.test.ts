import { describe, expect, it } from "vitest";

import { buildOpenmaicHealth } from "../../../src/trpc/openmaic-api";

describe("buildOpenmaicHealth", () => {
	it("prioritizes Gemini API key for ASR/TTS/Video when present", () => {
		const envMap = new Map<string, string>([
			["GEMINI_API_KEY", "AIza-test"],
			["OPENAI_API_KEY", "sk-openai"],
		]);

		const health = buildOpenmaicHealth({
			envMap,
			hasEnvFile: true,
			seatSummary: null,
			geminiProbe: { ok: true, detail: "Gemini models endpoint reachable." },
		});

		expect(health.asrReady).toBe(true);
		expect(health.ttsReady).toBe(true);
		expect(health.videoReady).toBe(true);
		expect(health.asrSource).toBe("gemini-api-key");
		expect(health.ttsSource).toBe("gemini-api-key");
		expect(health.videoSource).toBe("gemini-api-key");
		expect(health.asrVerified).toBe(true);
		expect(health.ttsVerified).toBe(true);
		expect(health.videoVerified).toBe(true);
	});

	it("uses Gemini seat routing when seat is available", () => {
		const envMap = new Map<string, string>([["OPENAI_API_KEY", "sk-openai"]]);

		const health = buildOpenmaicHealth({
			envMap,
			hasEnvFile: true,
			seatSummary: { accountId: 7, accountLabel: "Antigravity seat" },
			geminiProbe: null,
		});

		expect(health.asrSource).toBe("gemini-seat");
		expect(health.ttsSource).toBe("gemini-seat");
		expect(health.videoSource).toBe("gemini-seat");
		expect(health.subscriptionSeatRoutingReady).toBe(true);
		expect(health.subscriptionSeatRoutingDetail).toContain("Antigravity seat");
		expect(health.asrVerified).toBe(false);
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
			geminiProbe: null,
		});

		expect(health.asrReady).toBe(false);
		expect(health.ttsReady).toBe(false);
		expect(health.videoReady).toBe(false);
		expect(health.missingKeys).toContain("Create `backends/openmaic/.env.local` from `.env.example`");
		expect(health.missingKeys).toContain("ASR: enable browser ASR or configure a provider API key");
		expect(health.missingKeys).toContain("TTS: enable browser TTS or configure a provider API key");
		expect(health.missingKeys).toContain("Video: configure a video generation provider API key");
	});
});
