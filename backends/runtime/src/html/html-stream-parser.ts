/**
 * Port of html-anything's Claude stream-json parser half
 * (`next/src/lib/agents/argv.ts`), focused on Claude + Write-tool rescue.
 * Zero Node imports — liftable unit.
 */

export type AgentParse =
	| { kind: "delta"; text: string }
	| { kind: "meta"; key: string; value: unknown }
	| { kind: "html"; text: string }
	| { kind: "noise" };

export type ParseState = {
	sawStreamEventText?: boolean;
};

/**
 * Antigravity's `agy` speaks its own stream, not Claude's.
 *
 * Every field below was read off a live run rather than a document: `-p=` with
 * `--input-format=stream-json` emits `{"event":"init",…}` once, then one
 * `{"event":"step_update",…}` per step (`agent_response` steps carry
 * `text_delta`), then a single `{"event":"result",…}`. Nothing in it matches
 * Claude's `type`-keyed frames, which is why `makeParser` needs to dispatch at
 * all — it took its agent argument and ignored it until there was a second engine.
 */
export function parseAgyLine(line: string, state: ParseState): AgentParse[] {
	const trimmed = line.trim();
	if (!trimmed) return [];

	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch {
		return [{ kind: "noise" }];
	}
	if (!parsed || typeof parsed !== "object") return [];
	const obj = parsed as Record<string, unknown>;
	const out: AgentParse[] = [];

	if (obj.event === "init") {
		const init = (obj.init ?? {}) as { cwd?: unknown };
		// `conversation_id` is agy's session handle. Reported under the same key as
		// Claude's `session_id` so a caller that persists it needs no second branch.
		if (typeof obj.conversation_id === "string") {
			out.push({ kind: "meta", key: "session", value: obj.conversation_id });
		}
		if (typeof init.cwd === "string") {
			out.push({ kind: "meta", key: "cwd", value: init.cwd });
		}
	}

	if (obj.event === "step_update") {
		const step = (obj.step_update ?? {}) as {
			step_type?: unknown;
			state?: unknown;
			text_delta?: unknown;
			usage?: unknown;
		};
		if (typeof step.text_delta === "string" && step.text_delta.length > 0) {
			state.sawStreamEventText = true;
			out.push({ kind: "delta", text: step.text_delta });
		}
		// Tool and thinking steps carry no text, and for a long run they are the only
		// progress signal there is — a graph rebuild is minutes of `run_command`
		// steps before any prose appears.
		if (typeof step.step_type === "string" && typeof step.text_delta !== "string") {
			out.push({ kind: "meta", key: "step", value: { stepType: step.step_type, state: step.state } });
		}
		if (step.usage) {
			out.push({ kind: "meta", key: "usage_partial", value: step.usage });
		}
	}

	if (obj.event === "result") {
		const result = (obj.result ?? {}) as {
			status?: unknown;
			response?: unknown;
			duration_seconds?: unknown;
			usage?: unknown;
		};
		// Same rescue as the Claude branch: a run that streamed nothing still has its
		// whole answer here, and dropping it would render as an empty result.
		if (!state.sawStreamEventText && typeof result.response === "string" && result.response.length > 0) {
			out.push({ kind: "delta", text: result.response });
		}
		if (result.usage) {
			out.push({ kind: "meta", key: "usage", value: result.usage });
		}
		if (typeof result.duration_seconds === "number") {
			out.push({ kind: "meta", key: "duration_ms", value: Math.round(result.duration_seconds * 1000) });
		}
		if (typeof result.status === "string") {
			// Lowercased to match Claude's `subtype` ("success"), which is what consumers
			// of the `result` meta key already compare against.
			out.push({ kind: "meta", key: "result", value: result.status.toLowerCase() });
		}
	}

	return out;
}

/**
 * Some agents ignore the "stream HTML inline" prompt and dump the document via
 * Write. Rescue the HTML from the tool_use input so the preview still gets the
 * real content.
 */
export function rescueHtmlFromToolUse(
	content: Array<{ type?: string; name?: string; input?: unknown }> | undefined,
): string {
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const block of content) {
		if (!block || block.type !== "tool_use") continue;
		const name = (block.name ?? "").toLowerCase();
		if (
			name !== "write" &&
			name !== "create_file" &&
			name !== "createfile" &&
			name !== "writefile" &&
			name !== "write_file" &&
			name !== "filewrite"
		) {
			continue;
		}
		const input = block.input as Record<string, unknown> | undefined;
		if (!input || typeof input !== "object") continue;
		const path = String(input.file_path ?? input.path ?? input.filename ?? "").toLowerCase();
		if (path && !/\.(html?|htm)$/.test(path)) continue;
		const text =
			typeof input.content === "string"
				? input.content
				: typeof input.text === "string"
					? input.text
					: typeof input.file_content === "string"
						? input.file_content
						: "";
		if (text) parts.push(text);
	}
	return parts.join("");
}

export function makeParser(agent = "claude"): (line: string) => AgentParse[] {
	const state: ParseState = {};
	// `gemini` is the catalog id for the Antigravity CLI; `agy` is its binary.
	if (agent === "gemini" || agent === "agy" || agent === "antigravity") {
		return (line: string) => parseAgyLine(line, state);
	}
	return (line: string) => parseLineWithState(line, state);
}

export function parseLineWithState(line: string, state: ParseState): AgentParse[] {
	const trimmed = line.trim();
	if (!trimmed) return [];

	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch {
		return [{ kind: "noise" }];
	}
	if (!parsed || typeof parsed !== "object") return [];
	const obj = parsed as Record<string, unknown>;
	const out: AgentParse[] = [];

	if (obj.type === "system" && obj.subtype === "init") {
		out.push({ kind: "meta", key: "model", value: obj.model });
		out.push({ kind: "meta", key: "session", value: obj.session_id });
		if (obj.cwd) out.push({ kind: "meta", key: "cwd", value: obj.cwd });
	}
	if (obj.type === "stream_event" && obj.event && typeof obj.event === "object") {
		const ev = obj.event as {
			type?: string;
			delta?: { type?: string; text?: string; thinking?: string };
		};
		if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta" && typeof ev.delta.text === "string") {
			state.sawStreamEventText = true;
			out.push({ kind: "delta", text: ev.delta.text });
		} else if (ev.type === "content_block_delta" && ev.delta?.type === "thinking_delta") {
			out.push({ kind: "meta", key: "thinking", value: ev.delta.thinking });
		}
	}
	if (obj.type === "assistant" && obj.message && typeof obj.message === "object") {
		const msg = obj.message as {
			content?: Array<{ type?: string; text?: string; name?: string; input?: unknown }>;
			usage?: Record<string, number>;
			model?: string;
		};
		const toolHtml = rescueHtmlFromToolUse(msg.content);
		if (toolHtml) {
			out.push({ kind: "html", text: toolHtml });
			state.sawStreamEventText = true;
		}
		if (!state.sawStreamEventText) {
			const text = (msg.content ?? [])
				.filter((c) => c?.type === "text" && typeof c.text === "string")
				.map((c) => c.text!)
				.join("");
			if (text) out.push({ kind: "delta", text });
		}
		if (msg.usage) out.push({ kind: "meta", key: "usage_partial", value: msg.usage });
	}
	if (obj.type === "result") {
		if (obj.usage) out.push({ kind: "meta", key: "usage", value: obj.usage });
		if (typeof obj.duration_ms === "number") out.push({ kind: "meta", key: "duration_ms", value: obj.duration_ms });
		if (typeof obj.total_cost_usd === "number") out.push({ kind: "meta", key: "cost_usd", value: obj.total_cost_usd });
		if (typeof obj.subtype === "string") out.push({ kind: "meta", key: "result", value: obj.subtype });
	}
	if (obj.type === "rate_limit_event" && obj.rate_limit_info) {
		out.push({ kind: "meta", key: "rate_limit", value: obj.rate_limit_info });
	}

	return out;
}
