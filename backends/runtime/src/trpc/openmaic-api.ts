import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { ClineApiSeatCredentials } from "../cline-sdk/cline-provider-service";
import type { RuntimeOpenmaicHealth, RuntimeOpenmaicStatus } from "../core/api-contract";
import type { ManagerMonitor } from "../manager/manager-monitor";
import { type FlowiseLlmGeminiSeatSummary, resolveFlowiseLlmGeminiSeatSummary, resolveFlowiseLlmOpenAiSeatContext } from "../flowise/flowise-llm-proxy-seat";
import { isFlowiseLlmProxyEnabled } from "../flowise/flowise-llm-proxy-config";
import {
	type FlowiseLlmProxyProbeResult,
	probeFlowiseLlmProxyProvider,
} from "../flowise/flowise-llm-proxy-probe";
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

const GEMINI_PROBE_TTL_MS = 60_000;
const GEMINI_PROBE_TIMEOUT_MS = 4_000;
const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

const GEMINI_ENV_KEYS = ["GEMINI_API_KEY", "GOOGLE_API_KEY"];
const ASR_PROVIDER_KEYS = ["ASR_OPENAI_API_KEY", "OPENAI_API_KEY", "AZURE_OPENAI_API_KEY", "DEEPGRAM_API_KEY"];
const TTS_PROVIDER_KEYS = ["OPENAI_API_KEY", "ELEVENLABS_API_KEY", "MINIMAX_API_KEY", "AZURE_OPENAI_API_KEY"];
const VIDEO_PROVIDER_KEYS = ["KLING_ACCESS_KEY", "KLING_SECRET_KEY", "LUMA_API_KEY", "PIKA_API_KEY", "VEO3_API_KEY"];

interface GeminiProbeResult {
	ok: boolean;
	detail: string;
}

interface CachedGeminiProbe extends GeminiProbeResult {
	apiKey: string;
	expiresAtMs: number;
}

let cachedGeminiProbe: CachedGeminiProbe | null = null;

type OpenmaicCapabilitySource = "gemini-seat" | "gemini-api-key" | "browser-native" | "provider-api-key" | "missing";

export interface CreateOpenmaicApiDependencies {
	monitor?: ManagerMonitor;
	resolveGeminiSeatSummary?: () => Promise<FlowiseLlmGeminiSeatSummary | null>;
	resolveApiSeatCredentials?: (providerId: string) => Promise<ClineApiSeatCredentials | null>;
	probeGeminiApiKey?: (apiKey: string) => Promise<GeminiProbeResult>;
}

interface OpenmaicCapabilityHealth {
	ready: boolean;
	source: OpenmaicCapabilitySource;
	verified: boolean;
	detail?: string;
}

export interface OpenmaicSubscriptionProbeResults {
	cursor: FlowiseLlmProxyProbeResult;
	gemini: FlowiseLlmProxyProbeResult;
	anthropic: FlowiseLlmProxyProbeResult;
}

export interface BuildOpenmaicHealthInput {
	envMap: Map<string, string>;
	hasEnvFile: boolean;
	seatSummary: FlowiseLlmGeminiSeatSummary | null;
	asrSeatLabel: string | null;
	geminiProbe: GeminiProbeResult | null;
	proxySubscriptionWired: boolean;
	subscriptionProbes: OpenmaicSubscriptionProbeResults | null;
}

async function probeGeminiApiKey(apiKey: string): Promise<GeminiProbeResult> {
	if (cachedGeminiProbe && cachedGeminiProbe.apiKey === apiKey && cachedGeminiProbe.expiresAtMs > Date.now()) {
		return { ok: cachedGeminiProbe.ok, detail: cachedGeminiProbe.detail };
	}

	const controller = new AbortController();
	const timeout = setTimeout(() => {
		controller.abort();
	}, GEMINI_PROBE_TIMEOUT_MS);

	let result: GeminiProbeResult;
	try {
		const response = await fetch(`${GEMINI_API_BASE_URL}?key=${encodeURIComponent(apiKey)}&pageSize=1`, {
			method: "GET",
			signal: controller.signal,
		});
		if (response.ok) {
			result = { ok: true, detail: "Gemini models endpoint reachable." };
		} else {
			result = { ok: false, detail: `Gemini models probe failed (${response.status}).` };
		}
	} catch (error) {
		result = { ok: false, detail: error instanceof Error ? error.message : String(error) };
	} finally {
		clearTimeout(timeout);
	}

	cachedGeminiProbe = {
		apiKey,
		ok: result.ok,
		detail: result.detail,
		expiresAtMs: Date.now() + GEMINI_PROBE_TTL_MS,
	};
	return result;
}

async function defaultResolveGeminiSeatSummary(monitor: ManagerMonitor | undefined): Promise<FlowiseLlmGeminiSeatSummary | null> {
	if (monitor === undefined) {
		return null;
	}
	return await resolveFlowiseLlmGeminiSeatSummary({
		monitor,
		getAccountLaunchDir: async () => null,
		getAccountLaunchCredential: async () => null,
		resolveApiSeatCredentials: async (): Promise<ClineApiSeatCredentials | null> => null,
	});
}

async function defaultProbeSubscriptionRoutes(): Promise<OpenmaicSubscriptionProbeResults | null> {
	if (!isFlowiseLlmProxyEnabled()) {
		return null;
	}
	const [cursor, gemini, anthropic] = await Promise.all([
		probeFlowiseLlmProxyProvider("cursor"),
		probeFlowiseLlmProxyProvider("gemini"),
		probeFlowiseLlmProxyProvider("anthropic"),
	]);
	return { cursor, gemini, anthropic };
}

function formatSubscriptionProbeDetail(probes: OpenmaicSubscriptionProbeResults): string {
	const line = (label: string, probe: FlowiseLlmProxyProbeResult): string =>
		probe.ok ? `${label}: ok` : `${label}: ${probe.detail ?? "route failed"}`;
	return [line("Cursor", probes.cursor), line("Antigravity", probes.gemini), line("Claude", probes.anthropic)].join(
		"; ",
	);
}

function subscriptionRoutesReady(input: BuildOpenmaicHealthInput): boolean {
	if (input.proxySubscriptionWired) {
		if (input.subscriptionProbes === null) {
			return false;
		}
		return (
			input.subscriptionProbes.cursor.ok &&
			input.subscriptionProbes.gemini.ok &&
			input.subscriptionProbes.anthropic.ok
		);
	}
	return input.seatSummary !== null;
}

async function defaultResolveAsrSeatLabel(
	monitor: ManagerMonitor | undefined,
	resolveApiSeatCredentials: ((providerId: string) => Promise<ClineApiSeatCredentials | null>) | undefined,
): Promise<string | null> {
	if (!isFlowiseLlmProxyEnabled() || monitor === undefined || resolveApiSeatCredentials === undefined) {
		return null;
	}
	const seat = await resolveFlowiseLlmOpenAiSeatContext({
		monitor,
		getAccountLaunchDir: async () => null,
		getAccountLaunchCredential: async () => null,
		resolveApiSeatCredentials,
	});
	return seat?.seatLabel ?? null;
}

/**
 * Availability for the Learning tab.
 *
 * There is no HTTP client the way Flowise has one: OpenMAIC exposes no version endpoint
 * worth depending on, and the only question the tab asks is "can I frame it". A TCP probe
 * answers that without pulling a Next.js page render on every 5 s poll.
 */
export function createOpenmaicApi(deps: CreateOpenmaicApiDependencies = {}): RuntimeTrpcContext["openmaicApi"] {
	const resolveSeatSummary = deps.resolveGeminiSeatSummary ?? (async () => await defaultResolveGeminiSeatSummary(deps.monitor));
	const probeGeminiKey = deps.probeGeminiApiKey ?? probeGeminiApiKey;
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
			const seatSummary = await resolveSeatSummary();
			const asrSeatLabel = await defaultResolveAsrSeatLabel(deps.monitor, deps.resolveApiSeatCredentials);
			const geminiApiKey = resolveConfiguredSecret(envMap, GEMINI_ENV_KEYS);
			const geminiProbe = geminiApiKey ? await probeGeminiKey(geminiApiKey) : null;
			const proxySubscriptionWired = isFlowiseLlmProxyEnabled();
			const subscriptionProbes = proxySubscriptionWired ? await defaultProbeSubscriptionRoutes() : null;
			return buildOpenmaicHealth({
				envMap,
				hasEnvFile: existsSync(envPath),
				seatSummary,
				asrSeatLabel,
				geminiProbe,
				proxySubscriptionWired,
				subscriptionProbes,
			});
		},
	};
}

function buildCapabilityHealth({
	geminiAvailable,
	geminiProbe,
	browserEnabled,
	providerFallbackReady,
	browserLabel,
	providerLabel,
	seatLabel,
}: {
	geminiAvailable: boolean;
	geminiProbe: GeminiProbeResult | null;
	browserEnabled: boolean;
	providerFallbackReady: boolean;
	browserLabel: string;
	providerLabel: string;
	seatLabel: string | null;
}): OpenmaicCapabilityHealth {
	if (geminiAvailable) {
		const source: OpenmaicCapabilitySource = seatLabel ? "gemini-seat" : "gemini-api-key";
		return {
			ready: true,
			source,
			verified: geminiProbe?.ok ?? false,
			detail:
				geminiProbe?.detail ??
				(seatLabel ? `Using Gemini seat${seatLabel ? ` (${seatLabel})` : ""}; no API-key probe available.` : "Gemini key configured."),
		};
	}
	if (browserEnabled) {
		return {
			ready: true,
			source: "browser-native",
			verified: false,
			detail: browserLabel,
		};
	}
	if (providerFallbackReady) {
		return {
			ready: true,
			source: "provider-api-key",
			verified: false,
			detail: providerLabel,
		};
	}
	return {
		ready: false,
		source: "missing",
		verified: false,
	};
}

export function buildOpenmaicHealth(input: BuildOpenmaicHealthInput): RuntimeOpenmaicHealth {
	const geminiAvailable = input.seatSummary !== null || hasAnyConfigured(input.envMap, GEMINI_ENV_KEYS);
	const seatLabel = input.seatSummary?.accountLabel ?? null;
	const asrSeatWired = isFlowiseLlmProxyEnabled() && input.asrSeatLabel !== null;
	const asr = asrSeatWired
		? {
				ready: true,
				source: "provider-api-key" as const,
				verified: false,
				detail: `Whisper ASR routed via Manager API seat (${input.asrSeatLabel}) through PixelOffice proxy.`,
			}
		: buildCapabilityHealth({
				// Gemini seat routing is for LLM proxy paths only — OpenMAIC has no Gemini ASR backend.
				geminiAvailable: false,
				geminiProbe: null,
				browserEnabled: isBrowserNativeAsrAvailable(input.envMap),
				providerFallbackReady: hasAnyConfigured(input.envMap, ASR_PROVIDER_KEYS),
				browserLabel: "Browser-native ASR (Chrome/Edge Web Speech API); no server API key required.",
				providerLabel: "Server ASR provider key configured (e.g. ASR_OPENAI_API_KEY).",
				seatLabel: null,
			});
	const tts = buildCapabilityHealth({
		geminiAvailable,
		geminiProbe: input.geminiProbe,
		browserEnabled: isFeatureEnabled(input.envMap, "TTS_BROWSER_NATIVE_ENABLED"),
		providerFallbackReady: hasAnyConfigured(input.envMap, TTS_PROVIDER_KEYS),
		browserLabel: "Browser-native TTS enabled; browser runtime itself is not probed server-side.",
		providerLabel: "TTS fallback provider key configured (non-Gemini).",
		seatLabel,
	});
	const video = buildCapabilityHealth({
		geminiAvailable,
		geminiProbe: input.geminiProbe,
		browserEnabled: false,
		providerFallbackReady: hasAnyConfigured(input.envMap, VIDEO_PROVIDER_KEYS),
		browserLabel: "",
		providerLabel: "Video fallback provider key configured (non-Gemini).",
		seatLabel,
	});
	const missingKeys = collectMissingCapabilityKeys({
		hasEnvFile: input.hasEnvFile,
		asrReady: asr.ready,
		ttsReady: tts.ready,
		videoReady: video.ready,
		seatRoutingReady: subscriptionRoutesReady(input),
		proxySubscriptionWired: input.proxySubscriptionWired,
	});
	const subscriptionReady = subscriptionRoutesReady(input);
	return {
		openmaicConfigured:
			input.envMap.size > 0 || input.seatSummary !== null || input.proxySubscriptionWired,
		asrReady: asr.ready,
		ttsReady: tts.ready,
		videoReady: video.ready,
		asrSource: asr.source,
		ttsSource: tts.source,
		videoSource: video.source === "browser-native" ? "provider-api-key" : video.source,
		asrVerified: asr.verified,
		ttsVerified: tts.verified,
		videoVerified: video.verified,
		asrDetail: asr.detail,
		ttsDetail: tts.detail,
		videoDetail: video.detail,
		subscriptionSeatRoutingReady: subscriptionReady,
		subscriptionSeatRoutingDetail: input.proxySubscriptionWired
			? input.subscriptionProbes === null
				? "PixelOffice proxy routes are not probeable."
				: formatSubscriptionProbeDetail(input.subscriptionProbes)
			: input.seatSummary === null
				? "No Gemini seat credential detected."
				: `Gemini seat routing is available${input.seatSummary.accountLabel ? ` (${input.seatSummary.accountLabel})` : ""}.`,
		missingKeys,
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

/**
 * OpenMAIC's client default ASR provider is browser-native. It is available unless
 * the operator explicitly disables it — a Gemini seat does not wire to /api/transcription.
 */
function isBrowserNativeAsrAvailable(env: Map<string, string>): boolean {
	const raw = env.get("ASR_BROWSER_NATIVE_ENABLED");
	if (raw === undefined) {
		return true;
	}
	return isFeatureEnabled(env, "ASR_BROWSER_NATIVE_ENABLED");
}

function hasAnyConfigured(env: Map<string, string>, keys: string[]): boolean {
	for (const key of keys) {
		if (isConfiguredSecret(env.get(key))) {
			return true;
		}
	}
	return false;
}

function resolveConfiguredSecret(env: Map<string, string>, keys: string[]): string | null {
	for (const key of keys) {
		const value = env.get(key);
		if (isConfiguredSecret(value)) {
			return value!;
		}
	}
	return null;
}

function collectMissingCapabilityKeys({
	hasEnvFile,
	asrReady,
	ttsReady,
	videoReady,
	seatRoutingReady,
	proxySubscriptionWired,
}: {
	hasEnvFile: boolean;
	asrReady: boolean;
	ttsReady: boolean;
	videoReady: boolean;
	seatRoutingReady: boolean;
	proxySubscriptionWired: boolean;
}): string[] {
	const missing: string[] = [];
	if (!hasEnvFile && !proxySubscriptionWired) {
		missing.push("Create `backends/openmaic/.env.local` from `.env.example`");
	}
	if (!asrReady) {
		missing.push(
			"ASR: configure a Manager API seat (OmniRoute) or use browser-native speech recognition",
		);
	}
	if (!ttsReady) {
		missing.push("TTS: enable browser TTS or configure a provider API key");
	}
	if (!videoReady) {
		missing.push("Video: configure a video generation provider API key");
	}
	if (!seatRoutingReady) {
		missing.push(
			proxySubscriptionWired
				? "Subscription proxy routes (Cursor/Antigravity/Claude) are not all reachable — check Seats and restart OpenMAIC"
				: "Subscriptions (Antigravity/Cursor/Claude) are not auto-wired into OpenMAIC",
		);
	}
	return missing;
}
