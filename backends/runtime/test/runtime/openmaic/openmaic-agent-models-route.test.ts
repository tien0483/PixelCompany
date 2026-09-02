import { describe, expect, it, vi } from "vitest";

import { handleOpenmaicAgentModelsRequest } from "../../../src/openmaic/openmaic-agent-models-route";
import * as proxyConfig from "../../../src/flowise/flowise-llm-proxy-config";

function createMockResponse() {
	const chunks: Buffer[] = [];
	let statusCode = 0;
	return {
		res: {
			headersSent: false,
			writeHead(status: number) {
				statusCode = status;
			},
			end(payload?: Buffer | string) {
				if (payload !== undefined) {
					chunks.push(typeof payload === "string" ? Buffer.from(payload) : payload);
				}
			},
		} as import("node:http").ServerResponse,
		statusCode: () => statusCode,
		body: () => Buffer.concat(chunks).toString("utf8"),
	};
}

describe("openmaic agent-models route", () => {
	it("returns OmniRoute catalog for loopback requests", async () => {
		vi.spyOn(proxyConfig, "isFlowiseLlmProxyEnabled").mockReturnValue(true);
		vi.spyOn(proxyConfig, "resolveFlowiseLlmProxyProviderUrl").mockReturnValue("http://127.0.0.1:3484/api/flowise-llm-proxy/openai");
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({
				ok: true,
				json: async () => ({ data: [{ id: "auto/best-coding" }, { id: "dva/claude-opus-4-6" }] }),
			})),
		);
		const { res, statusCode, body } = createMockResponse();
		const handled = await handleOpenmaicAgentModelsRequest(
			{
				method: "GET",
				socket: { remoteAddress: "127.0.0.1" },
			} as import("node:http").IncomingMessage,
			res,
			"/api/openmaic/agent-models",
			new URLSearchParams({ agent: "omniroute" }),
		);
		expect(handled).toBe(true);
		expect(statusCode()).toBe(200);
		expect(JSON.parse(body())).toMatchObject({
			agentId: "omniroute",
			source: "catalog",
			models: [
				{ id: "auto/best-coding", label: "auto/best-coding" },
				{ id: "dva/claude-opus-4-6", label: "dva/claude-opus-4-6" },
			],
		});
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it("rejects non-loopback callers", async () => {
		const { res, statusCode, body } = createMockResponse();
		const handled = await handleOpenmaicAgentModelsRequest(
			{
				method: "GET",
				socket: { remoteAddress: "192.168.1.5" },
			} as import("node:http").IncomingMessage,
			res,
			"/api/openmaic/agent-models",
			new URLSearchParams({ agent: "omniroute" }),
		);
		expect(handled).toBe(true);
		expect(statusCode()).toBe(403);
		expect(JSON.parse(body()).error).toContain("loopback-only");
	});

	it("rejects legacy cursor/gemini agent ids", async () => {
		const { res, statusCode } = createMockResponse();
		const handled = await handleOpenmaicAgentModelsRequest(
			{
				method: "GET",
				socket: { remoteAddress: "127.0.0.1" },
			} as import("node:http").IncomingMessage,
			res,
			"/api/openmaic/agent-models",
			new URLSearchParams({ agent: "cursor" }),
		);
		expect(handled).toBe(true);
		expect(statusCode()).toBe(400);
	});
});
