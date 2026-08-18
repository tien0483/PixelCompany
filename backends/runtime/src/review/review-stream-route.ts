// Shared handler for a POST route whose response is a one-shot agent's SSE stream.
//
// Body-read → JSON-parse → schema-validate → SSE headers → `runAgentOneShot`. The
// `/api/html/*` and `/api/doc-skill/*` routes each spell this out inline; the three
// `/api/review/*` routes share it, because they differ only in schema, prompt and
// tools — and because the standalone Review package serves the same three routes and
// must not carry a second copy of the plumbing.
import type { IncomingMessage, ServerResponse } from "node:http";

import { type RunAgentOneShotInput, runAgentOneShot } from "../terminal/agent-oneshot";

/**
 * Cancels a run that goes quiet — a stray permission prompt a one-shot `-p` process
 * cannot answer — and puts a hard ceiling on the request regardless of output. Same
 * numbers as the HTML agent routes, for the same reason.
 */
export const REVIEW_AGENT_IDLE_TIMEOUT_MS = 120_000;
export const REVIEW_AGENT_HARD_TIMEOUT_MS = 10 * 60_000;

const DEFAULT_MAX_BODY_BYTES = 4 * 1024 * 1024;

export interface AgentStreamRunPlan {
	prompt: string;
	cwd?: string;
	model?: string;
	allowedTools: readonly string[];
	managerAccountId?: number;
}

export type AgentStreamBuildResult = { ok: false; status: number; error: string } | ({ ok: true } & AgentStreamRunPlan);

export interface HandleAgentStreamRouteOptions<TInput> {
	schema: {
		safeParse: (value: unknown) => { success: true; data: TInput } | { success: false; error: Error };
	};
	maxBodyBytes?: number;
	/**
	 * May reject before any agent is spawned — a missing rules bundle, say. That has to
	 * happen here rather than mid-run, because a stream whose headers are already out
	 * cannot become a 400.
	 */
	buildRun: (input: TInput) => Promise<AgentStreamBuildResult>;
	/** Absent in the standalone package, which has no Manager and so no seat to pin. */
	buildPinInput?: (managerAccountId?: number) => RunAgentOneShotInput["pinInput"];
}

function readRequestBody(req: IncomingMessage, maxBytes: number): Promise<string> {
	return new Promise((resolve, reject) => {
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
		req.on("end", () => resolve(body));
		req.on("error", reject);
	});
}

export async function handleAgentStreamRoute<TInput>(
	req: IncomingMessage,
	res: ServerResponse,
	options: HandleAgentStreamRouteOptions<TInput>,
): Promise<void> {
	let rawBody: string;
	try {
		rawBody = await readRequestBody(req, options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES);
	} catch {
		res.writeHead(413, { "Content-Type": "application/json; charset=utf-8" });
		res.end(JSON.stringify({ error: "Request body too large" }));
		return;
	}

	let parsedBody: unknown;
	try {
		parsedBody = JSON.parse(rawBody);
	} catch {
		res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
		res.end(JSON.stringify({ error: "invalid JSON body" }));
		return;
	}

	const parsed = options.schema.safeParse(parsedBody);
	if (!parsed.success) {
		res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
		res.end(JSON.stringify({ error: parsed.error.message }));
		return;
	}

	const run = await options.buildRun(parsed.data);
	if (!run.ok) {
		res.writeHead(run.status, { "Content-Type": "application/json; charset=utf-8" });
		res.end(JSON.stringify({ error: run.error }));
		return;
	}

	res.writeHead(200, {
		"Content-Type": "text/event-stream; charset=utf-8",
		"Cache-Control": "no-cache, no-transform",
		Connection: "keep-alive",
		"X-Accel-Buffering": "no",
	});

	const abortCtl = new AbortController();
	req.on("close", () => abortCtl.abort());

	await runAgentOneShot({
		agentId: "claude",
		prompt: run.prompt,
		cwd: run.cwd,
		model: run.model,
		allowedTools: [...run.allowedTools],
		idleTimeoutMs: REVIEW_AGENT_IDLE_TIMEOUT_MS,
		timeoutMs: REVIEW_AGENT_HARD_TIMEOUT_MS,
		signal: abortCtl.signal,
		onEvent: (event) => {
			if (res.writableEnded) {
				return;
			}
			res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
		},
		...(options.buildPinInput ? { pinInput: options.buildPinInput(run.managerAccountId) } : {}),
	});

	if (!res.writableEnded) {
		res.end();
	}
}
