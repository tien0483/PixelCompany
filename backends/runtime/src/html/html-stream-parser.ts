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

export function makeParser(_agent = "claude"): (line: string) => AgentParse[] {
	const state: ParseState = {};
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
