// Standalone-package copies of the 5 REST/SSE handlers from `server/runtime-server.ts`
// (`/api/html-proxy/*`, `/api/html/generate`, `/api/html/brief`, `/api/html/draft`,
// `/api/plans/asset`).
// Manager account pinning (`buildHtmlAgentPinInput`) is dropped entirely — the
// standalone package has no Manager process, so `runAgentOneShot` runs with no
// `pinInput`, which falls back to the caller's own logged-in Claude Code CLI session.
import type { IncomingMessage, ServerResponse } from "node:http";

import {
	RuntimeHtmlBriefRequestSchema,
	RuntimeHtmlDraftRequestSchema,
	RuntimeHtmlGenerateRequestSchema,
} from "../core/api-contract";
import { HTML_NO_TOOLS, resolveHtmlAgentCwd, resolveHtmlAllowedTools } from "../html/html-agent-args";
import { buildBriefPrompt, loadPromptMasterBody } from "../html/html-brief";
import type { HtmlClient, HtmlPromptFailure } from "../html/html-client";
import { buildDraftPrompt } from "../html/html-draft";
import { findSavedPlanById, readSavedPlanAsset, resolvePlanImageAssets } from "../state/saved-plans";
import { runAgentOneShot } from "../terminal/agent-oneshot";

// Same watchdog numbers as `runtime-server.ts`: a one-shot `-p` run has no UI to
// answer a stray permission prompt, so both routes cap idle time and total time.
const HTML_AGENT_IDLE_TIMEOUT_MS = 120_000;
const HTML_AGENT_HARD_TIMEOUT_MS = 10 * 60_000;

function describeHtmlPromptFailure(failure: HtmlPromptFailure): { status: number; error: string } {
	switch (failure.kind) {
		case "unreachable":
			return { status: 502, error: `HTML sidecar unreachable at ${failure.baseUrl}: ${failure.message}` };
		case "timeout":
			return { status: 504, error: `HTML sidecar timed out after ${failure.timeoutMs}ms at ${failure.baseUrl}` };
		case "http":
			return { status: failure.status, error: failure.body };
		case "malformed":
			return { status: 502, error: `HTML sidecar returned a malformed response: ${failure.body}` };
	}
}

function readRequestBody(req: IncomingMessage, maxBytes = 4096): Promise<string> {
	return new Promise((resolvePromise, reject) => {
		let body = "";
		let size = 0;
		req.on("data", (chunk: Buffer) => {
			size += chunk.length;
			if (size > maxBytes) {
				reject(new Error("Request body too large"));
				return;
			}
			body += chunk.toString("utf8");
		});
		req.on("end", () => resolvePromise(body));
		req.on("error", reject);
	});
}

async function resolveBriefPlanContext(
	planId: string,
	content: string,
): Promise<{ cwd?: string; assetPaths: string[]; unresolvedLinks: string[] }> {
	try {
		const { planDir, assetPaths, unresolvedLinks } = await resolvePlanImageAssets(planId, content);
		return { cwd: planDir, assetPaths, unresolvedLinks };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.warn(`Brief expansion could not resolve plan ${planId}: ${message}`);
		return { assetPaths: [], unresolvedLinks: [] };
	}
}

/**
 * Handles the 5 plan-editor REST/SSE routes if `pathname` matches one of them.
 * Returns `false` (having written nothing) when the request should fall through
 * to static asset serving instead.
 */
export async function tryHandlePlanEditorHtmlRoute(
	req: IncomingMessage,
	res: ServerResponse,
	requestUrl: URL,
	pathname: string,
	htmlClient: HtmlClient,
): Promise<boolean> {
	if (pathname.startsWith("/api/html-proxy/")) {
		const htmlPath = pathname.slice("/api/html-proxy".length) || "/";
		const query = requestUrl.search;
		const method = (req.method ?? "GET").toUpperCase();
		let body: string | null = null;
		if (method !== "GET" && method !== "HEAD") {
			try {
				body = await readRequestBody(req, 1024 * 1024);
			} catch {
				res.writeHead(413, { "Content-Type": "application/json; charset=utf-8" });
				res.end(JSON.stringify({ error: "Request body too large" }));
				return true;
			}
		}
		const contentType = typeof req.headers["content-type"] === "string" ? req.headers["content-type"] : null;
		const proxied = await htmlClient.proxyRequest(method, `${htmlPath}${query}`, body, contentType);
		res.writeHead(proxied.status, { "Content-Type": proxied.contentType, "Cache-Control": "no-store" });
		res.end(proxied.body);
		return true;
	}

	if (pathname === "/api/html/generate" && (req.method ?? "GET").toUpperCase() === "POST") {
		let rawBody: string;
		try {
			rawBody = await readRequestBody(req, 2 * 1024 * 1024);
		} catch {
			res.writeHead(413, { "Content-Type": "application/json; charset=utf-8" });
			res.end(JSON.stringify({ error: "Request body too large" }));
			return true;
		}
		let parsedBody: unknown;
		try {
			parsedBody = JSON.parse(rawBody);
		} catch {
			res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
			res.end(JSON.stringify({ error: "invalid JSON body" }));
			return true;
		}
		const parsed = RuntimeHtmlGenerateRequestSchema.safeParse(parsedBody);
		if (!parsed.success) {
			res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
			res.end(JSON.stringify({ error: parsed.error.message }));
			return true;
		}
		const input = parsed.data;
		const promptResult = await htmlClient.fetchPrompt({
			templateId: input.templateId,
			content: input.content,
			format: input.format,
			editFromHtml: input.editFromHtml,
			editFromContent: input.editFromContent,
		});
		if (!promptResult.ok) {
			const { status, error } = describeHtmlPromptFailure(promptResult.failure);
			res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
			res.end(JSON.stringify({ error }));
			return true;
		}
		const plan = input.planId ? await findSavedPlanById(input.planId).catch(() => null) : null;
		const agentCwd = resolveHtmlAgentCwd({ cwd: input.cwd, planPath: plan?.path });
		const allowedTools = resolveHtmlAllowedTools(promptResult.value.template.allowRead, HTML_NO_TOOLS);

		res.writeHead(200, {
			"Content-Type": "text/event-stream; charset=utf-8",
			"Cache-Control": "no-cache, no-transform",
			Connection: "keep-alive",
			"X-Accel-Buffering": "no",
		});

		const abortCtl = new AbortController();
		req.on("close", () => abortCtl.abort());
		const send = (event: string, data: unknown) => {
			if (res.writableEnded) return;
			res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
		};

		await runAgentOneShot({
			agentId: "claude",
			prompt: promptResult.value.prompt,
			cwd: agentCwd,
			model: input.model,
			idleTimeoutMs: HTML_AGENT_IDLE_TIMEOUT_MS,
			timeoutMs: HTML_AGENT_HARD_TIMEOUT_MS,
			signal: abortCtl.signal,
			allowedTools,
			onEvent: (event) => {
				send(event.type, event);
			},
		});
		if (!res.writableEnded) {
			res.end();
		}
		return true;
	}

	if (pathname === "/api/html/brief" && (req.method ?? "GET").toUpperCase() === "POST") {
		let rawBody: string;
		try {
			rawBody = await readRequestBody(req, 2 * 1024 * 1024);
		} catch {
			res.writeHead(413, { "Content-Type": "application/json; charset=utf-8" });
			res.end(JSON.stringify({ error: "Request body too large" }));
			return true;
		}
		let parsedBody: unknown;
		try {
			parsedBody = JSON.parse(rawBody);
		} catch {
			res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
			res.end(JSON.stringify({ error: "invalid JSON body" }));
			return true;
		}
		const parsed = RuntimeHtmlBriefRequestSchema.safeParse(parsedBody);
		if (!parsed.success) {
			res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
			res.end(JSON.stringify({ error: parsed.error.message }));
			return true;
		}
		const input = parsed.data;
		let briefPrompt: string;
		let briefCwd: string | undefined;
		let briefAssetCount = 0;
		try {
			const planContext = await resolveBriefPlanContext(input.planId, input.content);
			briefCwd = planContext.cwd;
			briefAssetCount = planContext.assetPaths.length;
			briefPrompt = buildBriefPrompt({
				promptMasterBody: await loadPromptMasterBody(),
				content: input.content,
				assetPaths: planContext.assetPaths,
				unresolvedLinks: planContext.unresolvedLinks,
				...(input.templateId ? { templateId: input.templateId } : {}),
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
			res.end(JSON.stringify({ error: message }));
			return true;
		}

		res.writeHead(200, {
			"Content-Type": "text/event-stream; charset=utf-8",
			"Cache-Control": "no-cache, no-transform",
			Connection: "keep-alive",
			"X-Accel-Buffering": "no",
		});

		const abortCtl = new AbortController();
		req.on("close", () => abortCtl.abort());
		const send = (event: string, data: unknown) => {
			if (res.writableEnded) return;
			res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
		};

		await runAgentOneShot({
			agentId: "claude",
			prompt: briefPrompt,
			cwd: briefCwd,
			model: input.model,
			allowedTools: resolveHtmlAllowedTools(briefAssetCount > 0, HTML_NO_TOOLS),
			idleTimeoutMs: HTML_AGENT_IDLE_TIMEOUT_MS,
			timeoutMs: HTML_AGENT_HARD_TIMEOUT_MS,
			signal: abortCtl.signal,
			onEvent: (event) => {
				send(event.type, event);
			},
		});
		if (!res.writableEnded) {
			res.end();
		}
		return true;
	}

	if (pathname === "/api/html/draft" && (req.method ?? "GET").toUpperCase() === "POST") {
		let rawBody: string;
		try {
			rawBody = await readRequestBody(req, 2 * 1024 * 1024);
		} catch {
			res.writeHead(413, { "Content-Type": "application/json; charset=utf-8" });
			res.end(JSON.stringify({ error: "Request body too large" }));
			return true;
		}
		let parsedBody: unknown;
		try {
			parsedBody = JSON.parse(rawBody);
		} catch {
			res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
			res.end(JSON.stringify({ error: "invalid JSON body" }));
			return true;
		}
		const parsed = RuntimeHtmlDraftRequestSchema.safeParse(parsedBody);
		if (!parsed.success) {
			res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
			res.end(JSON.stringify({ error: parsed.error.message }));
			return true;
		}
		const input = parsed.data;
		const plan = await findSavedPlanById(input.planId).catch(() => null);
		const draftPrompt = buildDraftPrompt({
			instruction: input.instruction,
			context: input.context,
			...(input.selection === undefined ? {} : { selection: input.selection }),
		});

		res.writeHead(200, {
			"Content-Type": "text/event-stream; charset=utf-8",
			"Cache-Control": "no-cache, no-transform",
			Connection: "keep-alive",
			"X-Accel-Buffering": "no",
		});

		const abortCtl = new AbortController();
		req.on("close", () => abortCtl.abort());
		const send = (event: string, data: unknown) => {
			if (res.writableEnded) return;
			res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
		};

		await runAgentOneShot({
			agentId: "claude",
			prompt: draftPrompt,
			cwd: resolveHtmlAgentCwd({ planPath: plan?.path }),
			model: input.model,
			// The instruction and the document travel in the prompt, so this pass reads
			// nothing off disk — unlike brief expansion, which opens the plan's images.
			allowedTools: resolveHtmlAllowedTools(false, HTML_NO_TOOLS),
			idleTimeoutMs: HTML_AGENT_IDLE_TIMEOUT_MS,
			timeoutMs: HTML_AGENT_HARD_TIMEOUT_MS,
			signal: abortCtl.signal,
			onEvent: (event) => {
				send(event.type, event);
			},
		});
		if (!res.writableEnded) {
			res.end();
		}
		return true;
	}

	if (pathname === "/api/plans/asset") {
		const planId = requestUrl.searchParams.get("planId");
		const relativePath = requestUrl.searchParams.get("path");
		if (!planId || !relativePath) {
			res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
			res.end('{"error":"Missing planId or path"}');
			return true;
		}
		try {
			const asset = await readSavedPlanAsset(planId, relativePath);
			res.writeHead(200, { "Content-Type": asset.contentType, "Cache-Control": "no-store" });
			res.end(asset.content);
		} catch {
			res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
			res.end('{"error":"Not found"}');
		}
		return true;
	}

	return false;
}
