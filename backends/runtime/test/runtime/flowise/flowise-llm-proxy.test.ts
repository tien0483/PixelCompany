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
			resolveApiSeatCredentials: async () => null,
		});
		expect(status.enabled).toBe(true);
		expect(status.available).toBe(true);
		expect(status.providers?.find((entry) => entry.id === "anthropic")?.available).toBe(true);
		expect(status.providers?.find((entry) => entry.id === "anthropic")?.seatLabel).toBe("Work seat");
	});

	/**
	 * A status read must not touch the network: refreshing writes `~/.gemini/oauth_creds.json`,
	 * which the Antigravity CLI owns and rotates, and the Agents sidebar repolls every 5 s.
	 */
	it("reports the gemini seat without refreshing its OAuth file", async () => {
		delete process.env.PIXELOFFICE_FLOWISE_LLM_PROXY;
		const geminiHome = await mkdtemp(join(tmpdir(), "flowise-llm-proxy-gemini-"));
		await writeFile(
			join(geminiHome, "oauth_creds.json"),
			JSON.stringify({ access_token: "live", refresh_token: "r", expiry_date: Date.now() + 3_600_000 }),
			"utf8",
		);
		const originalGeminiHome = process.env.GEMINI_HOME;
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (() => {
			throw new Error("status must not make network calls");
		}) as unknown as typeof globalThis.fetch;
		process.env.GEMINI_HOME = geminiHome;
		try {
			const status = await resolveFlowiseLlmProxyStatus({
				monitor: createMonitor([{ id: 3, displayName: "Agy seat", provider: "antigravity" }], 3),
				getAccountLaunchDir: async () => null,
				getAccountLaunchCredential: async () => null,
				resolveApiSeatCredentials: async () => null,
			});
			expect(status.providers?.find((entry) => entry.id === "gemini")?.available).toBe(true);
		} finally {
			globalThis.fetch = originalFetch;
			if (originalGeminiHome === undefined) {
				delete process.env.GEMINI_HOME;
			} else {
				process.env.GEMINI_HOME = originalGeminiHome;
			}
		}
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

interface CapturedForward {
	url: string;
	headers: Headers;
	body: string;
}

function createResponseStub(): import("node:http").ServerResponse {
	return {
		headersSent: false,
		writeHead() {},
		write() {},
		end() {},
	} as unknown as import("node:http").ServerResponse;
}

function decodeForwardedBody(body: RequestInit["body"]): string {
	if (body === undefined || body === null) {
		return "";
	}
	if (typeof body === "string") {
		return body;
	}
	if (body instanceof Uint8Array) {
		return Buffer.from(body).toString("utf8");
	}
	return String(body);
}

/** Drives one request through the handler and returns what it forwarded upstream. */
async function forwardThroughProxy(
	deps: Parameters<typeof createFlowiseLlmProxyHandler>[0],
	pathname: string,
	requestHeaders: Record<string, string>,
	body: string,
): Promise<CapturedForward> {
	const captured: CapturedForward[] = [];
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
		captured.push({
			url: String(input),
			headers: new Headers(init?.headers ?? {}),
			// The handler forwards a byte view, not a string — stringifying it yields "123,34,…".
			body: decodeForwardedBody(init?.body),
		});
		return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
	}) as typeof globalThis.fetch;
	try {
		const req = {
			method: "POST",
			url: pathname,
			headers: requestHeaders,
			socket: { remoteAddress: "127.0.0.1" },
			on(event: string, listener: (chunk?: Buffer) => void) {
				if (event === "data") {
					listener(Buffer.from(body, "utf8"));
				}
				if (event === "end") {
					listener();
				}
				return req;
			},
			destroy() {},
		} as unknown as import("node:http").IncomingMessage;
		await createFlowiseLlmProxyHandler(deps)(req, createResponseStub(), pathname);
	} finally {
		globalThis.fetch = originalFetch;
	}
	expect(captured).toHaveLength(1);
	return captured[0]!;
}

describe("flowise-llm-proxy forwarding", () => {
	const originalCursorSeat = process.env.PIXELOFFICE_FLOWISE_LLM_CURSOR_SEAT_ID;

	afterEach(() => {
		if (originalCursorSeat === undefined) {
			delete process.env.PIXELOFFICE_FLOWISE_LLM_CURSOR_SEAT_ID;
		} else {
			process.env.PIXELOFFICE_FLOWISE_LLM_CURSOR_SEAT_ID = originalCursorSeat;
		}
	});

	async function claudeSeatDeps(): Promise<Parameters<typeof createFlowiseLlmProxyHandler>[0]> {
		const configDir = await mkdtemp(join(tmpdir(), "flowise-llm-proxy-anthropic-"));
		await writeFile(
			join(configDir, ".credentials.json"),
			JSON.stringify({ claudeAiOauth: { accessToken: "seat-oauth-token" } }),
			"utf8",
		);
		return {
			monitor: createMonitor([{ id: 7, displayName: "Work seat", provider: "claude" }], 7),
			getAccountLaunchDir: async () => ({ configDir }),
			getAccountLaunchCredential: async () => null,
			useManagerAccount: async () => true,
			resolveApiSeatCredentials: async () => null,
		};
	}

	it("opts an OAuth seat bearer into the Anthropic OAuth beta", async () => {
		delete process.env.PIXELOFFICE_FLOWISE_LLM_PROXY;
		process.env.ANTHROPIC_BASE_URL = "http://127.0.0.1:8000";
		const forwarded = await forwardThroughProxy(
			await claudeSeatDeps(),
			"/api/flowise-llm-proxy/anthropic/v1/messages",
			{ "content-type": "application/json" },
			JSON.stringify({ model: "claude-sonnet-4-6", messages: [] }),
		);
		expect(forwarded.headers.get("authorization")).toBe("Bearer seat-oauth-token");
		expect(forwarded.headers.get("anthropic-beta")).toBe("oauth-2025-04-20");
	});

	it("keeps beta flags the node already asked for", async () => {
		delete process.env.PIXELOFFICE_FLOWISE_LLM_PROXY;
		process.env.ANTHROPIC_BASE_URL = "http://127.0.0.1:8000";
		const forwarded = await forwardThroughProxy(
			await claudeSeatDeps(),
			"/api/flowise-llm-proxy/anthropic/v1/messages",
			{ "content-type": "application/json", "anthropic-beta": "prompt-caching-2024-07-31" },
			JSON.stringify({ model: "claude-sonnet-4-6", messages: [] }),
		);
		expect(forwarded.headers.get("anthropic-beta")).toBe("prompt-caching-2024-07-31,oauth-2025-04-20");
	});

	it("prefers a pinned Cursor seat over an OmniRoute router seat", async () => {
		delete process.env.PIXELOFFICE_FLOWISE_LLM_PROXY;
		process.env.PIXELOFFICE_FLOWISE_LLM_CURSOR_SEAT_ID = "5";
		const forwarded = await forwardThroughProxy(
			{
				monitor: createMonitor([{ id: 5, displayName: "Cursor seat", provider: "cursor" }], 5),
				getAccountLaunchDir: async () => null,
				getAccountLaunchCredential: async () => ({ apiKey: "cursor-seat-key" }),
				useManagerAccount: async () => true,
				resolveApiSeatCredentials: async () => ({
					providerId: "omniroute",
					baseUrl: "http://127.0.0.1:8400/v1",
					apiKey: "router-key",
					modelId: "cursor-api/auto",
					name: "OmniRoute",
				}),
			},
			"/api/flowise-llm-proxy/cursor/chat/completions",
			{ "content-type": "application/json" },
			JSON.stringify({ model: "gpt-5", messages: [] }),
		);
		expect(forwarded.headers.get("authorization")).toBe("Bearer cursor-seat-key");
		expect(JSON.parse(forwarded.body).model).toBe("gpt-5");

		const autoModel = await forwardThroughProxy(
			{
				monitor: createMonitor([{ id: 5, displayName: "Cursor seat", provider: "cursor" }], 5),
				getAccountLaunchDir: async () => null,
				getAccountLaunchCredential: async () => ({ apiKey: "cursor-seat-key" }),
				useManagerAccount: async () => true,
				resolveApiSeatCredentials: async () => null,
			},
			"/api/flowise-llm-proxy/cursor/chat/completions",
			{ "content-type": "application/json" },
			JSON.stringify({ model: "auto", messages: [] }),
		);
		expect(JSON.parse(autoModel.body).model).toBe("cursor-api/auto");
	});

	it("keeps the node's model when routing through OmniRoute", async () => {
		delete process.env.PIXELOFFICE_FLOWISE_LLM_PROXY;
		delete process.env.PIXELOFFICE_FLOWISE_LLM_CURSOR_SEAT_ID;
		const deps: Parameters<typeof createFlowiseLlmProxyHandler>[0] = {
			monitor: createMonitor([], null),
			getAccountLaunchDir: async () => null,
			getAccountLaunchCredential: async () => null,
			useManagerAccount: async () => true,
			resolveApiSeatCredentials: async () => ({
				providerId: "omniroute",
				baseUrl: "http://127.0.0.1:8400/v1",
				apiKey: "router-key",
				modelId: "cursor-api/auto",
				name: "OmniRoute",
			}),
		};
		const chosen = await forwardThroughProxy(
			deps,
			"/api/flowise-llm-proxy/cursor/chat/completions",
			{ "content-type": "application/json" },
			JSON.stringify({ model: "cursor-api/gpt-5", messages: [] }),
		);
		expect(JSON.parse(chosen.body).model).toBe("cursor-api/gpt-5");

		const unset = await forwardThroughProxy(
			deps,
			"/api/flowise-llm-proxy/cursor/chat/completions",
			{ "content-type": "application/json" },
			JSON.stringify({ messages: [] }),
		);
		expect(JSON.parse(unset.body).model).toBe("cursor-api/auto");

		const autoAlias = await forwardThroughProxy(
			deps,
			"/api/flowise-llm-proxy/cursor/chat/completions",
			{ "content-type": "application/json" },
			JSON.stringify({ model: "auto", messages: [] }),
		);
		expect(JSON.parse(autoAlias.body).model).toBe("cursor-api/auto");
	});

	it("forwards OpenAI Whisper without duplicating /v1 on OmniRoute seats", async () => {
		delete process.env.PIXELOFFICE_FLOWISE_LLM_PROXY;
		const forwarded = await forwardThroughProxy(
			{
				monitor: createMonitor([], null),
				getAccountLaunchDir: async () => null,
				getAccountLaunchCredential: async () => null,
				useManagerAccount: async () => true,
				resolveApiSeatCredentials: async () => ({
					providerId: "omniroute",
					baseUrl: "http://127.0.0.1:8400/v1",
					apiKey: "router-key",
					modelId: "whisper-1",
					name: "OmniRoute",
				}),
			},
			"/api/flowise-llm-proxy/openai/v1/audio/transcriptions",
			{ "content-type": "multipart/form-data; boundary=test" },
			"--test\r\n",
		);
		expect(forwarded.url).toBe("http://127.0.0.1:8400/v1/audio/transcriptions");
		expect(forwarded.headers.get("authorization")).toBe("Bearer router-key");
	});
});
