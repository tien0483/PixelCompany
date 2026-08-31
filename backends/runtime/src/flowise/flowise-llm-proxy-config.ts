import { getKanbanRuntimeOrigin } from "../core/runtime-endpoint";
import { DEFAULT_OMNIROUTE_PORT, resolveOmniRouteBaseUrl } from "../omniroute/omniroute-endpoint";

const PROXY_ENV = "PIXELOFFICE_FLOWISE_LLM_PROXY";
const PROXY_PATH = "/api/flowise-llm-proxy";
const DEFAULT_SWITCHBOARD = "http://127.0.0.1:8000";
const DEFAULT_GEMINI_UPSTREAM = "https://generativelanguage.googleapis.com";

/** Enabled by default; set PIXELOFFICE_FLOWISE_LLM_PROXY=0 to fall back to manual Flowise Credentials. */
export function isFlowiseLlmProxyEnabled(): boolean {
	const raw = process.env[PROXY_ENV]?.trim();
	if (raw === "0" || raw?.toLowerCase() === "false") {
		return false;
	}
	return true;
}

export function resolveFlowiseLlmProxyPublicPath(): string {
	return PROXY_PATH;
}

export function resolveFlowiseLlmProxyPublicUrl(): string {
	return `${getKanbanRuntimeOrigin()}${PROXY_PATH}`;
}

export function resolveFlowiseLlmProxyProviderUrl(provider: "anthropic" | "gemini" | "openai" | "cursor"): string {
	return `${resolveFlowiseLlmProxyPublicUrl()}/${provider}`;
}

/** Legacy alias — Anthropic nodes use this or `/anthropic`. */
export function resolveFlowiseLlmProxyAnthropicUrl(): string {
	const legacy = process.env.PIXELOFFICE_FLOWISE_LLM_PROXY_URL?.trim();
	if (legacy) {
		return legacy.replace(/\/$/, "");
	}
	return resolveFlowiseLlmProxyProviderUrl("anthropic");
}

export function resolveFlowiseLlmUpstreamBaseUrl(): string {
	const fromEnv = process.env.ANTHROPIC_BASE_URL?.trim() || process.env.PIXELOFFICE_FLOWISE_LLM_UPSTREAM?.trim();
	return (fromEnv || DEFAULT_SWITCHBOARD).replace(/\/$/, "");
}

export function resolveFlowiseLlmGeminiUpstreamBaseUrl(): string {
	const fromEnv = process.env.PIXELOFFICE_FLOWISE_LLM_GEMINI_UPSTREAM?.trim();
	return (fromEnv || DEFAULT_GEMINI_UPSTREAM).replace(/\/$/, "");
}

export function resolveFlowiseLlmCursorUpstreamBaseUrl(): string {
	const fromEnv = process.env.PIXELOFFICE_FLOWISE_LLM_CURSOR_UPSTREAM?.trim();
	if (fromEnv) {
		return fromEnv.replace(/\/$/, "");
	}
	return resolveOmniRouteBaseUrl(null).replace(/\/$/, "") || `http://127.0.0.1:${String(DEFAULT_OMNIROUTE_PORT)}/v1`;
}
