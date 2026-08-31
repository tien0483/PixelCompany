// Does a provider route actually work? The Agents sidebar used to answer that from seat
// presence alone, which is why three routes could report "ready" while every one of them failed
// before sending a request (the studio's own deny list blocked the loopback URL, and the
// Anthropic route was missing its OAuth beta header).
//
// The probe is a *model listing*, not a completion: it exercises auth, the base URL and the
// header set without spending tokens. Results are cached, because the sidebar repolls.
import { resolveFlowiseLlmProxyProviderUrl } from "./flowise-llm-proxy-config";
import type { FlowiseLlmProxyProvider } from "./flowise-llm-proxy-routes";

export interface FlowiseLlmProxyProbeResult {
	ok: boolean;
	detail?: string;
}

interface CacheEntry extends FlowiseLlmProxyProbeResult {
	expiresAtMs: number;
}

const PROBE_TTL_MS = 60_000;
const PROBE_TIMEOUT_MS = 4_000;
const cache = new Map<FlowiseLlmProxyProvider, CacheEntry>();

/** GET paths that list models. Every provider here answers one without billing anything. */
const PROBE_PATHS: Record<FlowiseLlmProxyProvider, string> = {
	anthropic: "/v1/models?limit=1",
	gemini: "/v1beta/models",
	openai: "/models",
	cursor: "/models",
};

export function clearFlowiseLlmProxyProbeCache(): void {
	cache.clear();
}

export async function probeFlowiseLlmProxyProvider(
	provider: FlowiseLlmProxyProvider,
	nowMs = Date.now(),
): Promise<FlowiseLlmProxyProbeResult> {
	const cached = cache.get(provider);
	if (cached !== undefined && cached.expiresAtMs > nowMs) {
		return { ok: cached.ok, detail: cached.detail };
	}
	const url = `${resolveFlowiseLlmProxyProviderUrl(provider)}${PROBE_PATHS[provider]}`;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
	let result: FlowiseLlmProxyProbeResult;
	try {
		const response = await fetch(url, {
			method: "GET",
			headers: { "anthropic-version": "2023-06-01" },
			signal: controller.signal,
		});
		result = response.ok
			? { ok: true }
			: { ok: false, detail: `${String(response.status)} ${(await response.text()).slice(0, 160)}`.trim() };
	} catch (error) {
		result = { ok: false, detail: error instanceof Error ? error.message : String(error) };
	} finally {
		clearTimeout(timer);
	}
	cache.set(provider, { ...result, expiresAtMs: nowMs + PROBE_TTL_MS });
	return result;
}
