#!/usr/bin/env node
/**
 * Zero-dependency stdio MCP server: one deployed Flowise flow → one tool.
 * Claude Code launches this via --mcp-config; it POSTs to the studio prediction API.
 *
 * Env (set by the runtime at launch):
 *   PIXELOFFICE_FLOWISE_URL       — e.g. http://127.0.0.1:3010
 *   PIXELOFFICE_FLOWISE_FLOW_ID   — chatflow uuid
 *   PIXELOFFICE_FLOWISE_TOOL_NAME — optional, default run_agent
 *   PIXELOFFICE_FLOWISE_TOOL_DESCRIPTION — optional
 */
import { createInterface } from "node:readline";

import { readBrandEnv } from "../../../scripts/lib/brand-env.mjs";

const PROTOCOL_VERSION = "2024-11-05";
const SERVER_NAME = "pixeloffice-flowise-shim";
const SERVER_VERSION = "1.0.0";

function requiredEnv(suffix) {
	const value = readBrandEnv(suffix)?.trim();
	if (!value) {
		process.stderr.write(`[flowise-mcp-shim] missing PIXTIEL_${suffix} (or PIXELOFFICE_${suffix})\n`);
		process.exit(1);
	}
	return value;
}

const baseUrl = requiredEnv("FLOWISE_URL").replace(/\/$/, "");
const flowId = requiredEnv("FLOWISE_FLOW_ID");
const toolName = (readBrandEnv("FLOWISE_TOOL_NAME")?.trim() || "run_agent").slice(0, 64);
const toolDescription =
	readBrandEnv("FLOWISE_TOOL_DESCRIPTION")?.trim() ||
	`Run the Flowise agent flow ${flowId}`;

function writeMessage(message) {
	process.stdout.write(`${JSON.stringify(message)}\n`);
}

function toolSchema() {
	return {
		type: "object",
		properties: {
			question: {
				type: "string",
				description: "The question or prompt to send to the Flowise agent",
			},
		},
		required: ["question"],
	};
}

async function callPrediction(question) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 120_000);
	try {
		const response = await fetch(`${baseUrl}/api/v1/prediction/${flowId}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ question }),
			signal: controller.signal,
		});
		const text = await response.text();
		if (!response.ok) {
			throw new Error(`Flowise prediction failed (${response.status}): ${text.slice(0, 400)}`);
		}
		let parsed;
		try {
			parsed = JSON.parse(text);
		} catch {
			return text;
		}
		if (typeof parsed === "string") {
			return parsed;
		}
		if (typeof parsed?.text === "string") {
			return parsed.text;
		}
		if (parsed?.json !== undefined) {
			return JSON.stringify(parsed.json, null, 2);
		}
		return JSON.stringify(parsed, null, 2);
	} finally {
		clearTimeout(timer);
	}
}

function handleRequest(message) {
	const { id, method, params } = message;

	if (method === "notifications/initialized" || method === "initialized") {
		return;
	}

	if (method === "initialize") {
		writeMessage({
			jsonrpc: "2.0",
			id,
			result: {
				protocolVersion: PROTOCOL_VERSION,
				capabilities: { tools: {} },
				serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
			},
		});
		return;
	}

	if (method === "tools/list") {
		writeMessage({
			jsonrpc: "2.0",
			id,
			result: {
				tools: [
					{
						name: toolName,
						description: toolDescription,
						inputSchema: toolSchema(),
					},
				],
			},
		});
		return;
	}

	if (method === "tools/call") {
		const name = params?.name;
		const args = params?.arguments ?? {};
		if (name !== toolName) {
			writeMessage({
				jsonrpc: "2.0",
				id,
				error: { code: -32602, message: `Unknown tool: ${String(name)}` },
			});
			return;
		}
		const question = typeof args.question === "string" ? args.question.trim() : "";
		if (question.length === 0) {
			writeMessage({
				jsonrpc: "2.0",
				id,
				result: {
					content: [{ type: "text", text: "A non-empty question is required." }],
					isError: true,
				},
			});
			return;
		}
		void callPrediction(question)
			.then((text) => {
				writeMessage({
					jsonrpc: "2.0",
					id,
					result: {
						content: [{ type: "text", text }],
					},
				});
			})
			.catch((error) => {
				const text = error instanceof Error ? error.message : String(error);
				writeMessage({
					jsonrpc: "2.0",
					id,
					result: {
						content: [{ type: "text", text }],
						isError: true,
					},
				});
			});
		return;
	}

	if (id !== undefined && id !== null) {
		writeMessage({
			jsonrpc: "2.0",
			id,
			error: { code: -32601, message: `Method not found: ${String(method)}` },
		});
	}
}

const rl = createInterface({ input: process.stdin, terminal: false });
rl.on("line", (line) => {
	const trimmed = line.trim();
	if (trimmed.length === 0) {
		return;
	}
	let message;
	try {
		message = JSON.parse(trimmed);
	} catch {
		process.stderr.write(`[flowise-mcp-shim] invalid JSON: ${trimmed.slice(0, 120)}\n`);
		return;
	}
	try {
		handleRequest(message);
	} catch (error) {
		process.stderr.write(
			`[flowise-mcp-shim] handler error: ${error instanceof Error ? error.message : String(error)}\n`,
		);
	}
});

process.stdin.on("end", () => {
	process.exit(0);
});
