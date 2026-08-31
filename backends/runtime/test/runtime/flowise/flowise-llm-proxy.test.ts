import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
	createFlowiseLlmProxyHandler,
	isFlowiseLlmProxyEnabled,
	resolveFlowiseLlmProxyStatus,
} from "../../../src/flowise/flowise-llm-proxy";
import { parseFlowiseLlmProxyRoute } from "../../../src/flowise/flowise-llm-proxy-routes";
import type { ManagerMonitor } from "../../../src/manager/manager-monitor";

const originalFlag = process.env.PIXELOFFICE_FLOWISE_LLM_PROXY;
const originalBaseUrl = process.env.ANTHROPIC_BASE_URL;

afterEach(() => {
	if (originalFlag === undefined) {
		delete process.env.PIXELOFFICE_FLOWISE_LLM_PROXY;
	} else {
		process.env.PIXELOFFICE_FLOWISE_LLM_PROXY = originalFlag;
	}
	if (originalBaseUrl === undefined) {
		delete process.env.ANTHROPIC_BASE_URL;
	} else {
		process.env.ANTHROPIC_BASE_URL = originalBaseUrl;
	}
});

function createMonitor(
	accounts: Array<{ id: number; displayName?: string; email?: string; provider?: string }>,
	activeAccountId: number | null,
): ManagerMonitor {
	return {
		getState: () => ({
			accounts: accounts.map((account) => ({
				id: account.id,
				provider: account.provider ?? "claude",
				isActive: true,
				displayName: account.displayName ?? null,
				email: account.email ?? null,
			})),
			activeAccountId,
		}),
	} as ManagerMonitor;
}

const noopSeatDeps = {
	getAccountLaunchDir: async () => null,
	getAccountLaunchCredential: async () => null,
	useManagerAccount: async () => false,
	resolveApiSeatCredentials: async () => null,
};

describe("flowise-llm-proxy routes", () => {
	it("parses provider routes and legacy anthropic /v1 path", () => {
		expect(parseFlowiseLlmProxyRoute("/api/flowise-llm-proxy/gemini/v1beta/models"))?.toEqual({
			provider: "gemini",
			upstreamPath: "/v1beta/models",
		});
		expect(parseFlowiseLlmProxyRoute("/api/flowise-llm-proxy/v1/messages"))?.toEqual({
			provider: "anthropic",
			upstreamPath: "/v1/messages",
		});
	});
});

describe("flowise-llm-proxy", () => {
	it("is enabled by default and can be disabled with PIXELOFFICE_FLOWISE_LLM_PROXY=0", () => {
		delete process.env.PIXELOFFICE_FLOWISE_LLM_PROXY;
		expect(isFlowiseLlmProxyEnabled()).toBe(true);
		process.env.PIXELOFFICE_FLOWISE_LLM_PROXY = "0";
		expect(isFlowiseLlmProxyEnabled()).toBe(false);
	});

	it("reports disabled status when proxy flag is off", async () => {
		process.env.PIXELOFFICE_FLOWISE_LLM_PROXY = "0";
		const status = await resolveFlowiseLlmProxyStatus({
			monitor: createMonitor([], null),
			...noopSeatDeps,
		});
		expect(status.phase).toBe(3);
		expect(status.enabled).toBe(false);
		expect(status.available).toBe(false);
	});

	it("reports anthropic provider available when Manager seat has OAuth", async () => {
		delete process.env.PIXELOFFICE_FLOWISE_LLM_PROXY;
		process.env.ANTHROPIC_BASE_URL = "http://127.0.0.1:8787";
		const configDir = await mkdtemp(join(tmpdir(), "flowise-llm-proxy-"));
		await writeFile(
			join(configDir, ".credentials.json"),
			JSON.stringify({ claudeAiOauth: { accessToken: "test-token" } }),
			"utf8",
		);
		const status = await resolveFlowiseLlmProxyStatus({
			monitor: createMonitor([{ id: 7, displayName: "Work seat", provider: "claude" }], 7),
			getAccountLaunchDir: async (accountId) => (accountId === 7 ? { configDir } : null),
			getAccountLaunchCredential: async () => null,
			useManagerAccount: async () => true,
			resolveApiSeatCredentials: async () => null,
		});
		expect(status.enabled).toBe(true);
		expect(status.available).toBe(true);
		expect(status.providers?.find((entry) => entry.id === "anthropic")?.available).toBe(true);
		expect(status.providers?.find((entry) => entry.id === "anthropic")?.seatLabel).toBe("Work seat");
	});

	it("rejects non-loopback proxy requests", async () => {
		delete process.env.PIXELOFFICE_FLOWISE_LLM_PROXY;
		const handler = createFlowiseLlmProxyHandler({
			monitor: createMonitor([{ id: 1, provider: "claude" }], 1),
			getAccountLaunchDir: async () => ({ configDir: "/tmp/unused" }),
			getAccountLaunchCredential: async () => null,
			useManagerAccount: async () => true,
			resolveApiSeatCredentials: async () => null,
		});
		const chunks: Buffer[] = [];
		const res = {
			headersSent: false,
			writeHead(status: number, _headers: Record<string, string>) {
				expect(status).toBe(403);
			},
			write(chunk: Buffer | string) {
				chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
			},
			end(payload?: Buffer | string) {
				if (payload !== undefined) {
					chunks.push(typeof payload === "string" ? Buffer.from(payload) : payload);
				}
			},
		};
		const handled = await handler(
			{
				method: "POST",
				url: "/api/flowise-llm-proxy/v1/messages",
				headers: {},
				socket: { remoteAddress: "192.168.1.2" },
			} as import("node:http").IncomingMessage,
			res as import("node:http").ServerResponse,
			"/api/flowise-llm-proxy/v1/messages",
		);
		expect(handled).toBe(true);
		expect(Buffer.concat(chunks).toString("utf8")).toContain("loopback-only");
	});
});
