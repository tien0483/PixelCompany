// Phase 3: Flowise LLM nodes bill through Manager / Cline seats instead of studio credentials.
import type { IncomingMessage, ServerResponse } from "node:http";

import type { RuntimeFlowiseLlmProxyProviderStatus, RuntimeFlowiseLlmProxyStatus } from "../core/api-contract";
import { getKanbanRuntimeOrigin } from "../core/runtime-endpoint";
import type { ClineApiSeatCredentials } from "../cline-sdk/cline-provider-service";
import type { ManagerMonitor } from "../manager/manager-monitor";
import {
	isFlowiseLlmProxyEnabled,
	resolveFlowiseLlmCursorUpstreamBaseUrl,
	resolveFlowiseLlmGeminiUpstreamBaseUrl,
	resolveFlowiseLlmProxyPublicPath,
	resolveFlowiseLlmProxyPublicUrl,
	resolveFlowiseLlmUpstreamBaseUrl,
} from "./flowise-llm-proxy-config";
import { parseFlowiseLlmProxyRoute, type FlowiseLlmProxyProvider } from "./flowise-llm-proxy-routes";
import {
	resolveFlowiseLlmAnthropicSeatContext,
	resolveFlowiseLlmCursorSeatContext,
	resolveFlowiseLlmGeminiSeatContext,
	resolveFlowiseLlmOpenAiSeatContext,
} from "./flowise-llm-proxy-seat";

export {
	isFlowiseLlmProxyEnabled,
	resolveFlowiseLlmProxyAnthropicUrl,
	resolveFlowiseLlmProxyProviderUrl,
	resolveFlowiseLlmProxyPublicUrl,
} from "./flowise-llm-proxy-config";

const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const PROXY_MAX_BODY_BYTES = 32 * 1024 * 1024;
const STRIP_REQUEST_HEADERS = new Set([
	"host",
	"connection",
	"content-length",
	"transfer-encoding",
	"keep-alive",
	"proxy-connection",
	"te",
	"trailers",
	"upgrade",
]);

export interface CreateFlowiseLlmProxyHandlerDependencies {
	monitor: ManagerMonitor;
	getAccountLaunchDir: (accountId: number) => Promise<{ configDir: string } | null>;
	getAccountLaunchCredential: (accountId: number) => Promise<{ apiKey: string } | null>;
	useManagerAccount: (accountId: number) => Promise<boolean>;
	resolveApiSeatCredentials: (providerId: string) => Promise<ClineApiSeatCredentials | null>;
	warn?: (message: string) => void;
}

interface ProviderForwardPlan {
	upstreamBase: string;
	upstreamPath: string;
	headers: Headers;
	body?: Buffer;
}

function isLoopbackRequest(req: IncomingMessage): boolean {
	const address = req.socket.remoteAddress ?? "";
	return LOOPBACK_ADDRESSES.has(address);
}

function readRequestBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let total = 0;
		req.on("data", (chunk: Buffer | string) => {
			const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
			total += buffer.length;
			if (total > maxBytes) {
				reject(new Error("Request body too large"));
				req.destroy();
				return;
			}
			chunks.push(buffer);
		});
		req.on("end", () => {
			resolve(Buffer.concat(chunks));
		});
		req.on("error", reject);
	});
}

function copyRequestHeaders(req: IncomingMessage, stripAuth = true): Headers {
	const headers = new Headers();
	for (const [key, value] of Object.entries(req.headers)) {
		if (!value || STRIP_REQUEST_HEADERS.has(key.toLowerCase())) {
			continue;
		}
		if (stripAuth) {
			const lower = key.toLowerCase();
			if (
				lower === "x-api-key" ||
				lower === "authorization" ||
				lower === "x-goog-api-key"
			) {
				continue;
			}
		}
		if (Array.isArray(value)) {
			for (const entry of value) {
				headers.append(key, entry);
			}
		} else {
			headers.set(key, value);
		}
	}
	return headers;
}

function rewriteOpenAiModelBody(body: Buffer | undefined, modelId: string): Buffer | undefined {
	if (body === undefined || body.length === 0) {
		return body;
	}
	try {
		const parsed: unknown = JSON.parse(body.toString("utf8"));
		if (!parsed || typeof parsed !== "object") {
			return body;
		}
		return Buffer.from(JSON.stringify({ ...(parsed as Record<string, unknown>), model: modelId }), "utf8");
	} catch {
		return body;
	}
}

async function buildProviderForwardPlan(
	provider: FlowiseLlmProxyProvider,
	deps: CreateFlowiseLlmProxyHandlerDependencies,
	req: IncomingMessage,
	upstreamPath: string,
	query: string,
	body: Buffer | undefined,
): Promise<ProviderForwardPlan | { errorStatus: number; errorBody: Record<string, unknown> }> {
	const seatInput = {
		monitor: deps.monitor,
		getAccountLaunchDir: deps.getAccountLaunchDir,
		getAccountLaunchCredential: deps.getAccountLaunchCredential,
		useManagerAccount: deps.useManagerAccount,
		resolveApiSeatCredentials: deps.resolveApiSeatCredentials,
	};

	if (provider === "anthropic") {
		const seat = await resolveFlowiseLlmAnthropicSeatContext(seatInput);
		if (seat === null) {
			return {
				errorStatus: 503,
				errorBody: {
					error: {
						type: "flowise_llm_proxy_unavailable",
						message: "No Manager Claude seat with live OAuth.",
					},
				},
			};
		}
		const headers = copyRequestHeaders(req);
		headers.set("authorization", `Bearer ${seat.bearerToken}`);
		return {
			upstreamBase: resolveFlowiseLlmUpstreamBaseUrl(),
			upstreamPath: `${upstreamPath}${query}`,
			headers,
			body,
		};
	}

	if (provider === "gemini") {
		const seat = await resolveFlowiseLlmGeminiSeatContext(seatInput);
		if (seat === null) {
			return {
				errorStatus: 503,
				errorBody: {
					error: {
						type: "flowise_llm_proxy_unavailable",
						message: "No Antigravity/Gemini OAuth — sign in via Seats or run gemini login.",
					},
				},
			};
		}
		const headers = copyRequestHeaders(req);
		headers.set("authorization", `Bearer ${seat.accessToken}`);
		return {
			upstreamBase: resolveFlowiseLlmGeminiUpstreamBaseUrl(),
			upstreamPath: `${upstreamPath}${query}`,
			headers,
			body,
		};
	}

	if (provider === "openai") {
		const seat = await resolveFlowiseLlmOpenAiSeatContext(seatInput);
		if (seat === null) {
			return {
				errorStatus: 503,
				errorBody: {
					error: {
						type: "flowise_llm_proxy_unavailable",
						message: "No Cline API seat configured — set PIXELOFFICE_FLOWISE_LLM_API_SEAT_ID.",
					},
				},
			};
		}
		const headers = copyRequestHeaders(req);
		headers.set("authorization", `Bearer ${seat.apiKey}`);
		return {
			upstreamBase: seat.baseUrl.replace(/\/$/, ""),
			upstreamPath: `${upstreamPath}${query}`,
			headers,
			body,
		};
	}

	const cursorSeat = await resolveFlowiseLlmCursorSeatContext(seatInput);
	const routerSeat = await resolveFlowiseLlmOpenAiSeatContext(seatInput);
	if (cursorSeat === null && routerSeat === null) {
		return {
			errorStatus: 503,
			errorBody: {
				error: {
					type: "flowise_llm_proxy_unavailable",
					message: "Cursor proxy needs a Manager Cursor seat and/or a Cline API seat (OmniRoute).",
				},
			},
		};
	}
	const headers = copyRequestHeaders(req);
	const upstreamBase = resolveFlowiseLlmCursorUpstreamBaseUrl();
	let forwardBody = body;
	if (routerSeat !== null) {
		headers.set("authorization", `Bearer ${routerSeat.apiKey}`);
		forwardBody = rewriteOpenAiModelBody(body, "cursor-api/auto");
	} else if (cursorSeat !== null) {
		headers.set("authorization", `Bearer ${cursorSeat.apiKey}`);
	}
	return {
		upstreamBase,
		upstreamPath: `${upstreamPath}${query}`,
		headers,
		body: forwardBody,
	};
}

async function forwardUpstream(
	res: ServerResponse,
	method: string,
	plan: ProviderForwardPlan,
	warn?: (message: string) => void,
): Promise<void> {
	const upstreamUrl = `${plan.upstreamBase}${plan.upstreamPath}`;
	let upstream: Response;
	try {
		upstream = await fetch(upstreamUrl, {
			method,
			headers: plan.headers,
			body: plan.body && plan.body.length > 0 ? plan.body : undefined,
		});
	} catch (error) {
		warn?.(`Flowise LLM proxy upstream failed: ${error instanceof Error ? error.message : String(error)}`);
		res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
		res.end(JSON.stringify({ error: "Flowise LLM proxy upstream unreachable." }));
		return;
	}
	res.writeHead(upstream.status, {
		...(upstream.headers.get("content-type")
			? { "Content-Type": upstream.headers.get("content-type")! }
			: {}),
		"Cache-Control": "no-store",
	});
	if (!upstream.body) {
		res.end();
		return;
	}
	const reader = upstream.body.getReader();
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}
			if (value) {
				res.write(Buffer.from(value));
			}
		}
		res.end();
	} catch (error) {
		warn?.(`Flowise LLM proxy stream failed: ${error instanceof Error ? error.message : String(error)}`);
		if (!res.headersSent) {
			res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
		}
		res.end();
	} finally {
		reader.releaseLock();
	}
}

export function createFlowiseLlmProxyHandler(
	deps: CreateFlowiseLlmProxyHandlerDependencies,
): (req: IncomingMessage, res: ServerResponse, pathname: string) => Promise<boolean> {
	return async (req, res, pathname) => {
		if (!isFlowiseLlmProxyEnabled()) {
			return false;
		}
		const route = parseFlowiseLlmProxyRoute(pathname);
		if (route === null) {
			return false;
		}
		if (!isLoopbackRequest(req)) {
			res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
			res.end(JSON.stringify({ error: "Flowise LLM proxy is loopback-only." }));
			return true;
		}

		const queryIndex = req.url?.indexOf("?") ?? -1;
		const query = queryIndex >= 0 ? req.url!.slice(queryIndex) : "";
		const method = (req.method ?? "GET").toUpperCase();

		let body: Buffer | undefined;
		if (method !== "GET" && method !== "HEAD") {
			try {
				body = await readRequestBody(req, PROXY_MAX_BODY_BYTES);
			} catch {
				res.writeHead(413, { "Content-Type": "application/json; charset=utf-8" });
				res.end(JSON.stringify({ error: "Request body too large" }));
				return true;
			}
		}

		const plan = await buildProviderForwardPlan(
			route.provider,
			deps,
			req,
			route.upstreamPath,
			query,
			body,
		);
		if ("errorStatus" in plan) {
			res.writeHead(plan.errorStatus, { "Content-Type": "application/json; charset=utf-8" });
			res.end(JSON.stringify(plan.errorBody));
			return true;
		}

		await forwardUpstream(res, method, { ...plan, headers: plan.headers }, deps.warn);
		return true;
	};
}

export interface ResolveFlowiseLlmProxyStatusInput {
	monitor: ManagerMonitor;
	getAccountLaunchDir: (accountId: number) => Promise<{ configDir: string } | null>;
	getAccountLaunchCredential: (accountId: number) => Promise<{ apiKey: string } | null>;
	useManagerAccount: (accountId: number) => Promise<boolean>;
	resolveApiSeatCredentials: (providerId: string) => Promise<ClineApiSeatCredentials | null>;
}

async function buildProviderStatus(
	provider: FlowiseLlmProxyProvider,
	input: ResolveFlowiseLlmProxyStatusInput,
): Promise<RuntimeFlowiseLlmProxyProviderStatus> {
	const seatInput = {
		monitor: input.monitor,
		getAccountLaunchDir: input.getAccountLaunchDir,
		getAccountLaunchCredential: input.getAccountLaunchCredential,
		useManagerAccount: input.useManagerAccount,
		resolveApiSeatCredentials: input.resolveApiSeatCredentials,
	};
	if (provider === "anthropic") {
		const seat = await resolveFlowiseLlmAnthropicSeatContext(seatInput);
		return {
			id: provider,
			available: seat !== null,
			seatLabel: seat?.accountLabel ?? null,
			flowiseNode: "ChatAnthropic",
		};
	}
	if (provider === "gemini") {
		const seat = await resolveFlowiseLlmGeminiSeatContext(seatInput);
		return {
			id: provider,
			available: seat !== null,
			seatLabel: seat?.accountLabel ?? null,
			flowiseNode: "ChatGoogleGenerativeAI",
		};
	}
	if (provider === "openai") {
		const seat = await resolveFlowiseLlmOpenAiSeatContext(seatInput);
		return {
			id: provider,
			available: seat !== null,
			seatLabel: seat?.seatLabel ?? null,
			flowiseNode: "ChatOpenAI",
		};
	}
	const cursorSeat = await resolveFlowiseLlmCursorSeatContext(seatInput);
	const routerSeat = await resolveFlowiseLlmOpenAiSeatContext(seatInput);
	return {
		id: provider,
		available: cursorSeat !== null || routerSeat !== null,
		seatLabel: cursorSeat?.accountLabel ?? routerSeat?.seatLabel ?? null,
		flowiseNode: "ChatOpenAICustom",
	};
}

/** Describes Phase 3 proxy readiness for the Agents sidebar and tRPC. */
export async function resolveFlowiseLlmProxyStatus(
	input: ResolveFlowiseLlmProxyStatusInput,
): Promise<RuntimeFlowiseLlmProxyStatus> {
	const enabled = isFlowiseLlmProxyEnabled();
	const switchboardBaseUrl = resolveFlowiseLlmUpstreamBaseUrl();
	const proxyBaseUrl = enabled ? resolveFlowiseLlmProxyPublicUrl() : null;
	const providers = enabled
		? await Promise.all(
				(["anthropic", "gemini", "openai", "cursor"] as const).map(async (id) => await buildProviderStatus(id, input)),
			)
		: [];
	const available = providers.some((entry) => entry.available);
	const hints: string[] = [];
	if (!enabled) {
		hints.push("Flowise LLM proxy disabled (PIXELOFFICE_FLOWISE_LLM_PROXY=0). Use Flowise Credentials.");
	} else {
		for (const entry of providers) {
			if (entry.available) {
				hints.push(
					`${entry.flowiseNode}: ${entry.id}${entry.seatLabel ? ` (${entry.seatLabel})` : ""}.`,
				);
			}
		}
		if (!available) {
			hints.push("No provider seats ready — sign in via Seats or configure Cline API seats.");
		} else {
			hints.push("No provider API keys needed in Flowise Credentials for wired nodes.");
		}
	}
	const anthropic = providers.find((entry) => entry.id === "anthropic") ?? null;
	return {
		phase: 3,
		enabled,
		available,
		switchboardBaseUrl,
		proxyBaseUrl,
		seatAccountId: null,
		seatLabel: anthropic?.seatLabel ?? null,
		providers,
		hints,
	};
}
