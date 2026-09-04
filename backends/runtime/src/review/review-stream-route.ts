// Shared handler for a POST route whose response is a one-shot agent's SSE stream.
//
// Body-read → JSON-parse → schema-validate → SSE headers → `runAgentOneShot`. The
// `/api/html/*` and `/api/doc-skill/*` routes each spell this out inline; the three
// `/api/review/*` routes share it, because they differ only in schema, prompt and
// tools — and because the standalone Review package serves the same three routes and
// must not carry a second copy of the plumbing.
import type { IncomingMessage, ServerResponse } from "node:http";

import { type AgentOneShotEvent, type RunAgentOneShotInput, runAgentOneShot } from "../terminal/agent-oneshot";

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
	 * Defaults to Claude, which is what every review pass uses. The knowledge-graph
	 * rebuild is the exception: it runs on `gemini` so a whole-repository analysis
	 * comes out of the Antigravity quota pool instead of the reviewer's Claude seat.
	 */
	agentId?: "claude" | "gemini";
	/** Antigravity only. */
	effort?: "low" | "medium" | "high";
	/**
	 * Antigravity only. `agy` starts in `request-review` permission mode, so a run
	 * that has to write files needs this or it stalls until the idle watchdog fires.
	 */
	skipPermissions?: boolean;
	/** Overrides the route defaults, for a run that is minutes rather than seconds. */
	idleTimeoutMs?: number;
	timeoutMs?: number;
	/** Persona for the run. Only the review chat sets one. */
	appendSystemPrompt?: string;
	/**
	 * Continues an earlier turn's CLI session. Set only by the review chat; see the
	 * stale-session retry in `handleAgentStreamRoute` for why it cannot be trusted.
	 */
	resumeSessionId?: string;
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

	/**
	 * One `claude -p` run. `holdTerminalFrames` keeps `error`/`done` out of the SSE
	 * stream so a failed first attempt can be retried without the reviewer seeing a
	 * failure that never really happened; everything else still streams live, since
	 * suppressing deltas would trade the flash for a stall.
	 */
	const attempt = async (options2: {
		resumeSessionId?: string;
		holdTerminalFrames: boolean;
	}): Promise<AgentOneShotEvent[]> => {
		const held: AgentOneShotEvent[] = [];
		streamed = "";
		sawError = false;
		await runAgentOneShot({
			agentId: run.agentId ?? "claude",
			prompt: run.prompt,
			cwd: run.cwd,
			model: run.model,
			allowedTools: [...run.allowedTools],
			idleTimeoutMs: run.idleTimeoutMs ?? REVIEW_AGENT_IDLE_TIMEOUT_MS,
			timeoutMs: run.timeoutMs ?? REVIEW_AGENT_HARD_TIMEOUT_MS,
			signal: abortCtl.signal,
			...(run.effort ? { effort: run.effort } : {}),
			...(run.skipPermissions ? { skipPermissions: run.skipPermissions } : {}),
			...(run.appendSystemPrompt ? { appendSystemPrompt: run.appendSystemPrompt } : {}),
			...(options2.resumeSessionId ? { resumeSessionId: options2.resumeSessionId } : {}),
			onEvent: (event) => {
				if (event.type === "delta") {
					streamed += event.text;
				} else if (event.type === "html") {
					streamed = event.text;
				} else if (event.type === "error") {
					sawError = true;
				}
				if (options2.holdTerminalFrames && (event.type === "error" || event.type === "done")) {
					held.push(event);
					return;
				}
				write(event.type, event);
			},
			...(options.buildPinInput ? { pinInput: options.buildPinInput(run.managerAccountId) } : {}),
		});
		return held;
	};

	if (run.resumeSessionId) {
		const held = await attempt({ resumeSessionId: run.resumeSessionId, holdTerminalFrames: true });
		// A session the CLI no longer has fails instantly and produces nothing. That is
		// routine — a runtime restart or a changed cwd loses sessions — and without this
		// the panel would be permanently broken by an id it can never satisfy. Retrying
		// costs the conversation's history, not the turn.
		const sessionUnusable = sawError && streamed.length === 0 && !aborted;
		if (sessionUnusable) {
			write("meta", {
				type: "meta",
				key: "pin_warning",
				value: "The earlier chat session could not be resumed, so this answer starts without the conversation history.",
			});
			await attempt({ holdTerminalFrames: false });
		} else {
			for (const event of held) {
				write(event.type, event);
			}
		}
	} else {
		await attempt({ holdTerminalFrames: false });
	}

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
