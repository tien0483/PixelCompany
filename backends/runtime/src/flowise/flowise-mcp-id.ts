// Pure id/name helpers for the synthetic `flowise-*` MCP servers. Split out of `flowise-mcp.ts`
// so the frontend can import them: that module reads the filesystem for the shim path, and a
// `node:fs` import cannot be bundled into the browser.

/** Prefix for auto-generated MCP inventory ids — shared by the runtime and the card picker. */
export const FLOWISE_MCP_SERVER_ID_PREFIX = "flowise-";

const DEFAULT_TOOL_NAME = "run_agent";

export function isFlowiseMcpServerId(serverId: string): boolean {
	return serverId.startsWith(FLOWISE_MCP_SERVER_ID_PREFIX);
}

/** Returns the chatflow id embedded in a synthetic inventory id, or null when malformed. */
export function parseFlowiseMcpServerId(serverId: string): string | null {
	if (!isFlowiseMcpServerId(serverId)) {
		return null;
	}
	const flowId = serverId.slice(FLOWISE_MCP_SERVER_ID_PREFIX.length).trim();
	return flowId.length > 0 ? flowId : null;
}

export function buildFlowiseMcpServerId(flowId: string): string {
	return `${FLOWISE_MCP_SERVER_ID_PREFIX}${flowId}`;
}

/** MCP tool names: alphanumeric, underscore, hyphen, max 64 — same rule Flowise uses. */
export function sanitizeFlowiseToolName(raw: string): string {
	const sanitized = raw
		.toLowerCase()
		.replace(/[^a-z0-9_-]/g, "_")
		.replace(/_+/g, "_")
		.replace(/^_|_$/g, "")
		.slice(0, 64);
	return sanitized.length > 0 ? sanitized : DEFAULT_TOOL_NAME;
}
