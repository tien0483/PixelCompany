#!/usr/bin/env node
/**
 * Prints ~/.cursor/mcp.json snippets for deployed Flowise flows.
 *
 * Usage:
 *   node backends/runtime/scripts/print-flowise-mcp-config.mjs
 *   node backends/runtime/scripts/print-flowise-mcp-config.mjs --flow-id <uuid>
 *   PIXELOFFICE_FLOWISE_URL=http://127.0.0.1:3010 node ...
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_BASE_URL = "http://127.0.0.1:3010";
const SHIM_REL = "backends/runtime/scripts/flowise-mcp-shim.mjs";

function parseArgs(argv) {
	let flowId = null;
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--flow-id" && argv[index + 1]) {
			flowId = argv[index + 1].trim();
			index += 1;
		}
	}
	return { flowId };
}

function sanitizeToolName(raw) {
	const sanitized = String(raw)
		.toLowerCase()
		.replace(/[^a-z0-9_-]/g, "_")
		.replace(/_+/g, "_")
		.replace(/^_|_$/g, "")
		.slice(0, 64);
	return sanitized.length > 0 ? sanitized : "run_agent";
}

function resolveShimPath() {
	const override = process.env.PIXELOFFICE_FLOWISE_MCP_SHIM?.trim();
	if (override && existsSync(override)) {
		return override;
	}
	const here = dirname(fileURLToPath(import.meta.url));
	const candidates = [
		resolve(here, "flowise-mcp-shim.mjs"),
		resolve(here, "../../../backends/runtime/scripts/flowise-mcp-shim.mjs"),
	];
	for (const candidate of candidates) {
		if (existsSync(candidate)) {
			return candidate;
		}
	}
	return resolve(process.cwd(), SHIM_REL);
}

async function fetchJson(baseUrl, path) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 8000);
	try {
		const response = await fetch(`${baseUrl}${path}`, { signal: controller.signal });
		if (!response.ok) {
			return null;
		}
		return await response.json();
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}

function buildServerEntry(flow, baseUrl, shimPath) {
	const toolName = sanitizeToolName(flow.name);
	const isAgentFlow = String(flow.type ?? "").toUpperCase() === "AGENTFLOW";
	const description = isAgentFlow
		? `Run the "${flow.name}" AgentFlow canvas`
		: `Run the "${flow.name}" Flowise chatflow`;
	return {
		command: process.execPath,
		args: [shimPath],
		env: {
			PIXELOFFICE_FLOWISE_URL: baseUrl.replace(/\/$/, ""),
			PIXELOFFICE_FLOWISE_FLOW_ID: flow.id,
			PIXELOFFICE_FLOWISE_TOOL_NAME: toolName,
			PIXELOFFICE_FLOWISE_TOOL_DESCRIPTION: description,
		},
	};
}

async function main() {
	const { flowId } = parseArgs(process.argv.slice(2));
	const baseUrl = (process.env.PIXELOFFICE_FLOWISE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/$/, "");
	const version = await fetchJson(baseUrl, "/api/v1/version");
	if (version === null) {
		process.stderr.write(`Flowise not reachable at ${baseUrl}\n`);
		process.stderr.write("Start with: pnpm run solo\n");
		process.exit(1);
	}
	const rawFlows = await fetchJson(baseUrl, "/api/v1/chatflows");
	if (!Array.isArray(rawFlows)) {
		process.stderr.write("Could not read /api/v1/chatflows\n");
		process.exit(1);
	}
	const deployed = rawFlows
		.filter(
			(entry) =>
				entry &&
				typeof entry === "object" &&
				entry.deployed === true &&
				typeof entry.id === "string",
		)
		.map((entry) => ({
			id: entry.id,
			name: typeof entry.name === "string" && entry.name.length > 0 ? entry.name : entry.id,
			type: typeof entry.type === "string" ? entry.type : undefined,
		}));
	if (deployed.length === 0) {
		process.stderr.write("No deployed flows. Deploy one in the Agents tab first.\n");
		process.exit(1);
	}
	const selected = flowId === null ? deployed : deployed.filter((flow) => flow.id === flowId);
	if (flowId !== null && selected.length === 0) {
		process.stderr.write(`Flow ${flowId} is not deployed or missing.\n`);
		process.stderr.write("Deployed ids:\n");
		for (const flow of deployed) {
			process.stderr.write(`  ${flow.id}  ${flow.name}\n`);
		}
		process.exit(1);
	}
	const shimPath = resolveShimPath();
	const mcpServers = {};
	for (const flow of selected) {
		const key = `flowise-${sanitizeToolName(flow.name)}`;
		mcpServers[key] = buildServerEntry(flow, baseUrl, shimPath);
	}
	const payload = { mcpServers };
	process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
	if (selected.length === 1) {
		process.stderr.write(
			`\nMerge into ~/.cursor/mcp.json or set PIXELOFFICE_FLOWISE_FLOW_ID=${selected[0].id}\n`,
		);
	}
}

main().catch((error) => {
	process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
	process.exit(1);
});
