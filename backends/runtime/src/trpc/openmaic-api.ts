import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { RuntimeOpenmaicHealth, RuntimeOpenmaicStatus } from "../core/api-contract";
import {
	DEFAULT_OPENMAIC_HOST,
	findOpenmaicRoot,
	isOpenmaicBuilt,
	isOpenmaicBuiltForEmbedding,
	resolveOpenmaicBaseUrl,
	resolveOpenmaicPort,
} from "../openmaic/openmaic-endpoint";
import { probePort } from "../stack/stack-ports";
import type { RuntimeTrpcContext } from "./app-router";

/**
 * Availability for the Learning tab.
 *
 * There is no HTTP client the way Flowise has one: OpenMAIC exposes no version endpoint
 * worth depending on, and the only question the tab asks is "can I frame it". A TCP probe
 * answers that without pulling a Next.js page render on every 5 s poll.
 */
export function createOpenmaicApi(): RuntimeTrpcContext["openmaicApi"] {
	return {
		status: async (): Promise<RuntimeOpenmaicStatus> => {
			const root = findOpenmaicRoot();
			const baseUrl = resolveOpenmaicBaseUrl(undefined);
			const online = await probePort(DEFAULT_OPENMAIC_HOST, resolveOpenmaicPort(undefined));
			const built = root !== null && isOpenmaicBuilt(root);
			return {
				online,
				installed: root !== null,
				built,
				embeddable: built && root !== null && isOpenmaicBuiltForEmbedding(root),
				baseUrl,
			};
		},
		health: async (): Promise<RuntimeOpenmaicHealth> => {
			const root = findOpenmaicRoot();
			if (root === null) {
				return {
					openmaicConfigured: false,
					asrReady: false,
					ttsReady: false,
					videoReady: false,
					subscriptionSeatRoutingReady: false,
					missingKeys: [
						"OpenMAIC not installed (`backends/openmaic` missing)",
						"OpenMAIC `.env.local` missing",
					],
				};
			}
			const envPath = join(root, ".env.local");
			const envMap = parseEnvFile(envPath);
			const missingKeys = collectMissingCapabilityKeys(envMap, existsSync(envPath));
			return {
				openmaicConfigured: envMap.size > 0,
				asrReady: isAsrReady(envMap),
				ttsReady: isTtsReady(envMap),
				videoReady: isVideoReady(envMap),
				// OpenMAIC calls providers from its own Next server config; it does not use
				// PixelOffice Manager seat subscriptions automatically.
				subscriptionSeatRoutingReady: false,
				missingKeys,
			};
		},
	};
}

function parseEnvFile(envPath: string): Map<string, string> {
	if (!existsSync(envPath)) {
		return new Map();
	}
	const raw = readFileSync(envPath, "utf8");
	const lines = raw.split(/\r?\n/);
	const values = new Map<string, string>();
	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed.length === 0 || trimmed.startsWith("#")) {
			continue;
		}
		const separator = trimmed.indexOf("=");
		if (separator <= 0) {
			continue;
		}
		const key = trimmed.slice(0, separator).trim();
		const value = trimmed.slice(separator + 1).trim();
		if (key.length === 0) {
			continue;
		}
		values.set(key, stripWrappingQuotes(value));
	}
	return values;
}

function stripWrappingQuotes(value: string): string {
	if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
		return value.slice(1, -1).trim();
	}
	return value;
}

function isConfiguredSecret(value: string | undefined): boolean {
	if (!value) {
		return false;
	}
	const normalized = value.trim().toLowerCase();
	if (normalized.length === 0) {
		return false;
	}
	return ![
		"your_key_here",
		"changeme",
		"replace_me",
		"replace-with-your-key",
		"example",
		"null",
		"none",
	].includes(normalized);
}

function isFeatureEnabled(env: Map<string, string>, key: string): boolean {
	const value = env.get(key);
	if (!value) {
		return false;
	}
	const normalized = value.trim().toLowerCase();
	return normalized === "true" || normalized === "1" || normalized === "yes";
}

function hasAnyConfigured(env: Map<string, string>, keys: string[]): boolean {
	for (const key of keys) {
		if (isConfiguredSecret(env.get(key))) {
			return true;
		}
	}
	return false;
}

function isAsrReady(env: Map<string, string>): boolean {
	const browserAsr = isFeatureEnabled(env, "ASR_BROWSER_NATIVE_ENABLED");
	const providerAsr = hasAnyConfigured(env, [
		"GEMINI_API_KEY",
		"OPENAI_API_KEY",
		"AZURE_OPENAI_API_KEY",
		"DEEPGRAM_API_KEY",
	]);
	return browserAsr || providerAsr;
}

function isTtsReady(env: Map<string, string>): boolean {
	const browserTts = isFeatureEnabled(env, "TTS_BROWSER_NATIVE_ENABLED");
	const providerTts = hasAnyConfigured(env, [
		"GEMINI_API_KEY",
		"OPENAI_API_KEY",
		"ELEVENLABS_API_KEY",
		"MINIMAX_API_KEY",
		"AZURE_OPENAI_API_KEY",
	]);
	return browserTts || providerTts;
}

function isVideoReady(env: Map<string, string>): boolean {
	return hasAnyConfigured(env, [
		"GOOGLE_API_KEY",
		"GEMINI_API_KEY",
		"KLING_ACCESS_KEY",
		"KLING_SECRET_KEY",
		"LUMA_API_KEY",
		"PIKA_API_KEY",
		"VEO3_API_KEY",
	]);
}

function collectMissingCapabilityKeys(env: Map<string, string>, hasEnvFile: boolean): string[] {
	const missing: string[] = [];
	if (!hasEnvFile) {
		missing.push("Create `backends/openmaic/.env.local` from `.env.example`");
	}
	if (!isAsrReady(env)) {
		missing.push("ASR: enable browser ASR or configure a provider API key");
	}
	if (!isTtsReady(env)) {
		missing.push("TTS: enable browser TTS or configure a provider API key");
	}
	if (!isVideoReady(env)) {
		missing.push("Video: configure a video generation provider API key");
	}
	missing.push("Subscriptions (Antigravity/Cursor/Claude) are not auto-wired into OpenMAIC");
	return missing;
}
