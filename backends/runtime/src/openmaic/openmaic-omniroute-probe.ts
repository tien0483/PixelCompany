import { resolveFlowiseLlmProxyProviderUrl } from "../flowise/flowise-llm-proxy-config";

export interface OmniRouteAudioProbeResult {
	asr: boolean;
	tts: boolean;
}

const PROBE_TTL_MS = 60_000;
const PROBE_TIMEOUT_MS = 4_000;

interface CacheEntry extends OmniRouteAudioProbeResult {
	expiresAtMs: number;
}

let cachedProbe: CacheEntry | null = null;

export function clearOpenmaicOmniRouteProbeCache(): void {
	cachedProbe = null;
}

interface ModelEntry {
	id?: string;
	supportedEndpoints?: string[];
}

function modelSupportsEndpoint(model: ModelEntry, endpoint: string): boolean {
	const endpoints = model.supportedEndpoints;
	if (Array.isArray(endpoints) && endpoints.includes(endpoint)) {
		return true;
	}
	const id = model.id?.toLowerCase() ?? "";
	if (endpoint === "audio-transcriptions") {
		return id.includes("whisper");
	}
	if (endpoint === "audio-speech") {
		return id.includes("tts");
	}
	return false;
}

function parseAudioCapabilities(body: unknown): OmniRouteAudioProbeResult {
	if (!body || typeof body !== "object") {
		return { asr: false, tts: false };
	}
	const data = (body as { data?: ModelEntry[] }).data;
	if (!Array.isArray(data)) {
		return { asr: false, tts: false };
	}
	let asr = false;
	let tts = false;
	for (const model of data) {
		if (modelSupportsEndpoint(model, "audio-transcriptions")) {
			asr = true;
		}
		if (modelSupportsEndpoint(model, "audio-speech")) {
			tts = true;
		}
		if (asr && tts) {
			break;
		}
	}
	return { asr, tts };
}

/** Token-free probe: parse OmniRoute model catalog for audio ASR/TTS support. */
export async function probeOmniRouteAudioCapabilities(nowMs = Date.now()): Promise<OmniRouteAudioProbeResult | null> {
	if (cachedProbe !== null && cachedProbe.expiresAtMs > nowMs) {
		return { asr: cachedProbe.asr, tts: cachedProbe.tts };
	}
	const url = `${resolveFlowiseLlmProxyProviderUrl("openai")}/models`;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
	try {
		const response = await fetch(url, { method: "GET", signal: controller.signal });
		if (!response.ok) {
			return null;
		}
		const capabilities = parseAudioCapabilities((await response.json()) as unknown);
		cachedProbe = { ...capabilities, expiresAtMs: nowMs + PROBE_TTL_MS };
		return capabilities;
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}
