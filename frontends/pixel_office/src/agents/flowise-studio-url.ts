import type { RuntimeFlowiseFlow } from "@/runtime/types";

/**
 * Tells the forked studio UI to hide its own chrome (top bar, logo, docs/community links,
 * account menu) so the canvas reads as a PixelOffice surface rather than an embedded
 * product. The un-embedded view stays reachable for debugging the studio on its own.
 */
export const FLOWISE_EMBED_QUERY = "embed=1";

/**
 * Flowise routes a flow by kind, and the kinds do not share one canvas: classic chatflows
 * live at `/canvas`, the older multi-agent editor at `/agentcanvas`, and AgentFlow V2 at
 * `/v2/agentcanvas`. Keeping the whole mapping here means one place to correct if the fork
 * renames a route — every caller builds its URL through this function.
 */
export function buildFlowiseCanvasPath(flow: Pick<RuntimeFlowiseFlow, "id" | "type"> | null): string {
	const kind = flow?.type?.toUpperCase();
	const base = kind === "AGENTFLOW" ? "/v2/agentcanvas" : kind === "MULTIAGENT" ? "/agentcanvas" : "/canvas";
	return flow === null ? base : `${base}/${flow.id}`;
}

/** Absolute, cross-origin URL the Agents tab frames. Empty base URL yields an empty string. */
export function buildFlowiseStudioUrl(
	baseUrl: string,
	flow: Pick<RuntimeFlowiseFlow, "id" | "type"> | null,
): string {
	if (baseUrl.length === 0) {
		return "";
	}
	const embedBaseUrl = alignFlowiseBaseUrlForBrowser(baseUrl);
	return `${embedBaseUrl.replace(/\/$/, "")}${buildFlowiseCanvasPath(flow)}?${FLOWISE_EMBED_QUERY}`;
}

/** Loopback hostnames the runtime and solo use for the studio sidecar. */
export const FLOWISE_LOOPBACK_HOST = "127.0.0.1";

export function alignFlowiseBaseUrlForBrowser(baseUrl: string): string {
	if (baseUrl.length === 0 || typeof window === "undefined") {
		return baseUrl;
	}
	try {
		const parsed = new URL(baseUrl);
		if (
			parsed.hostname === FLOWISE_LOOPBACK_HOST ||
			parsed.hostname === "localhost" ||
			parsed.hostname === "::1" ||
			parsed.hostname === "[::1]"
		) {
			parsed.hostname = FLOWISE_LOOPBACK_HOST;
		}
		return parsed.origin;
	} catch {
		return baseUrl;
	}
}
