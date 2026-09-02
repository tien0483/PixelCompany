import { describe, expect, it, vi } from "vitest";

import { handleOpenmaicAgentModelsRequest } from "../../../src/openmaic/openmaic-agent-models-route";
import * as inventory from "../../../src/terminal/agent-model-inventory";

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
	it("returns cursor inventory for loopback requests", async () => {
		vi.spyOn(inventory, "listAgentModelInventory").mockResolvedValue({
			agentId: "cursor",
			source: "fallback",
			models: [{ id: "composer-2.5", label: "Composer 2.5" }],
		});
		const { res, statusCode, body } = createMockResponse();
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
		expect(statusCode()).toBe(200);
		expect(JSON.parse(body())).toMatchObject({
			agentId: "cursor",
			models: [{ id: "composer-2.5", label: "Composer 2.5" }],
		});
		vi.restoreAllMocks();
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
			new URLSearchParams({ agent: "cursor" }),
		);
		expect(handled).toBe(true);
		expect(statusCode()).toBe(403);
		expect(body()).toContain("loopback-only");
	});
});
