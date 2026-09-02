import type { IncomingMessage, ServerResponse } from "node:http";

import type { RuntimeAgentId } from "../core/api-contract";
import { listAgentModelInventory } from "../terminal/agent-model-inventory";

const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const OPENMAIC_AGENT_MODELS_PATH = "/api/openmaic/agent-models";
const SUPPORTED_AGENTS = new Set<RuntimeAgentId>(["cursor", "gemini"]);

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
	if (!SUPPORTED_AGENTS.has(rawAgent as RuntimeAgentId)) {
		writeJson(res, 400, {
			error: 'Query parameter "agent" must be "cursor" or "gemini".',
		});
		return true;
	}
	const inventory = await listAgentModelInventory(rawAgent as RuntimeAgentId);
	writeJson(res, 200, inventory);
	return true;
}
