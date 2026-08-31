import { resolveFlowiseLlmProxyPublicPath } from "./flowise-llm-proxy-config";

export type FlowiseLlmProxyProvider = "anthropic" | "gemini" | "openai" | "cursor";

export interface FlowiseLlmProxyRoute {
	provider: FlowiseLlmProxyProvider;
	upstreamPath: string;
}

const PROVIDER_PREFIXES: FlowiseLlmProxyProvider[] = ["anthropic", "gemini", "openai", "cursor"];

/** Maps `/api/flowise-llm-proxy/{provider}/…` and legacy `/v1/…` → anthropic. */
export function parseFlowiseLlmProxyRoute(pathname: string): FlowiseLlmProxyRoute | null {
	const prefix = resolveFlowiseLlmProxyPublicPath();
	if (!pathname.startsWith(prefix)) {
		return null;
	}
	const rest = pathname.slice(prefix.length) || "/";
	for (const provider of PROVIDER_PREFIXES) {
		const providerPrefix = `/${provider}`;
		if (rest === providerPrefix || rest.startsWith(`${providerPrefix}/`)) {
			const upstreamPath = rest.slice(providerPrefix.length) || "/";
			return { provider, upstreamPath };
		}
	}
	if (rest.startsWith("/v1/") || rest === "/v1") {
		return { provider: "anthropic", upstreamPath: rest };
	}
	return null;
}
