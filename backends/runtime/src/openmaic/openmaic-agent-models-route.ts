import type { IncomingMessage, ServerResponse } from "node:http";

import { isFlowiseLlmProxyEnabled, resolveFlowiseLlmProxyProviderUrl } from "../flowise/flowise-llm-proxy-config";

const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const OPENMAIC_AGENT_MODELS_PATH = "/api/openmaic/agent-models";
const SUPPORTED_AGENT = "omniroute";

export interface OpenmaicAgentModelInventory {
	agentId: typeof SUPPORTED_AGENT;
	models: Array<{ id: string; label: string }>;
	source: "catalog" | "fallback";
}

function isLoopbackRequest(req: IncomingMessage): boolean {
	const address = req.socket.remoteAddress ?? "";
	return LOOPBACK_ADDRESSES.has(address);
}

function writeJson(res: ServerResponse, status: number, body: Record<string, unknown>): void {
	res.writeHead(status, {
		"Content-Type": "application/json; charset=utf-8",
		"Cache-Control": "no-store",
	});
	res.end(JSON.stringify(body));
}

async function fetchOmniRouteModelInventory(): Promise<OpenmaicAgentModelInventory> {
	if (!isFlowiseLlmProxyEnabled()) {
		return { agentId: SUPPORTED_AGENT, models: [], source: "fallback" };
	}
	const url = `${resolveFlowiseLlmProxyProviderUrl("openai")}/models`;
	try {
		const response = await fetch(url, { method: "GET", signal: AbortSignal.timeout(4_000) });
		if (!response.ok) {
			return { agentId: SUPPORTED_AGENT, models: [], source: "fallback" };
		}
		const body = (await response.json()) as { data?: Array<{ id?: string }> };
		const models = [...new Set((body.data ?? []).map((entry) => entry.id?.trim() ?? "").filter((id) => id.length > 0))]
			.sort((left, right) => left.localeCompare(right))
			.map((id) => ({ id, label: id }));
		return {
			agentId: SUPPORTED_AGENT,
			models,
			source: models.length > 0 ? "catalog" : "fallback",
		};
	} catch {
		return { agentId: SUPPORTED_AGENT, models: [], source: "fallback" };
	}
}

/**
 * Loopback-only model inventory for the OpenMAIC classroom. OpenMAIC runs on a
 * different origin (:3020) and cannot call tRPC from the browser, so the
 * classroom server fetches this route server-side.
 */
export async function handleOpenmaicAgentModelsRequest(
	req: IncomingMessage,
	res: ServerResponse,
	pathname: string,
	searchParams: URLSearchParams,
): Promise<boolean> {
	if (pathname !== OPENMAIC_AGENT_MODELS_PATH) {
		return false;
	}
	if ((req.method ?? "GET").toUpperCase() !== "GET") {
		writeJson(res, 405, { error: "Method not allowed" });
		return true;
	}
	if (!isLoopbackRequest(req)) {
		writeJson(res, 403, { error: "OpenMAIC agent-models is loopback-only." });
		return true;
	}
	const rawAgent = searchParams.get("agent")?.trim() ?? "";
	if (rawAgent !== SUPPORTED_AGENT) {
		writeJson(res, 400, {
			error: 'Query parameter "agent" must be "omniroute".',
		});
		return true;
	}
	const inventory = await fetchOmniRouteModelInventory();
	writeJson(res, 200, inventory);
	return true;
}
