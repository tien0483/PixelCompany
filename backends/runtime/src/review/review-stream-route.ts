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
	/**
	 * Runs once the agent has finished, with everything it streamed. This is where a
	 * route persists its result: the SSE stream reaches the browser, but the browser
	 * is not the store — the rules extractor's bundle has to be written server-side,
	 * or a reload loses the whole (expensive) run.
	 */
	onComplete?: (text: string) => Promise<void>;
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
	let aborted = false;
	req.on("close", () => {
		aborted = true;
		abortCtl.abort();
	});

	const write = (event: string, data: unknown): void => {
		if (res.writableEnded) {
			return;
		}
		res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
	};

	// Same accumulation the browser hook performs, kept server-side so `onComplete`
	// sees exactly what the reviewer saw. `html` replaces rather than appends: it is
	// a whole-document event, not a chunk.
	let streamed = "";
	let sawError = false;

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
			if (event.type === "delta") {
				streamed += event.text;
			} else if (event.type === "html") {
				streamed = event.text;
			} else if (event.type === "error") {
				sawError = true;
			}
			write(event.type, event);
		},
		...(options.buildPinInput ? { pinInput: options.buildPinInput(run.managerAccountId) } : {}),
	});

	// Skipped on a failed or cancelled run: half a stream parses to a partial result,
	// and persisting that would replace a good bundle with the fragment of a run the
	// reviewer already saw fail.
	if (run.onComplete && !sawError && !aborted && streamed.length > 0) {
		try {
			await run.onComplete(streamed);
		} catch (error) {
			// The stream's headers are long gone, so this cannot become a 500 — it has to
			// reach the reviewer as an SSE error or the run looks like it succeeded.
			write("error", {
				type: "error",
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}

	if (!res.writableEnded) {
		res.end();
	}
}
