/**
 * Turns `agy`'s brain transcript into progress lines.
 *
 * This is the only place a caller can see what an `agy -p` run is *doing*. Its
 * stream-json wire format carries, for every tool step, nothing but
 * `{"event":"step_update","step_update":{"step_type":"run_command","state":"ACTIVE"}}`
 * — no command, no output — and the planner's prose arrives in a single record
 * at the end of the turn. Measured on a knowledge-graph rebuild: four minutes of
 * identical `run_command (ACTIVE)` frames, then all 54 phase lines at once.
 *
 * The transcript has all of it. One JSON object per line, appended live:
 *
 *   {"step_index":1,"source":"MODEL","type":"PLANNER_RESPONSE",
 *    "thinking":"…","tool_calls":[{"name":"run_command","args":{"CommandLine":"…"}}]}
 *   {"step_index":2,"source":"MODEL","type":"GENERIC",
 *    "content":"Created At: …\n\nThe command exited with code 0.\nOutput:\n…"}
 *   {"step_index":107,"source":"MODEL","type":"PLANNER_RESPONSE","content":"[Phase 0/7] …"}
 *
 * The directory is keyed by `conversation_id`, which the runtime already
 * receives: `parseAgyLine` emits it as the `session` meta frame off `init`.
 */
import { homedir } from "node:os";
import { join } from "node:path";

/** How a progress line should read; the UI colours by this. */
export type AgyProgressKind = "command" | "output" | "phase" | "notice" | "error";

export interface AgyProgressLine {
	kind: AgyProgressKind;
	line: string;
}

/** One log line stays one log line: long command output is summarized, not paged. */
const MAX_PROGRESS_LINE_LENGTH = 220;
/** How many lines of a tool result are worth showing. The rest is in the graph. */
const MAX_OUTPUT_LINES = 4;

export function resolveAgyBrainTranscriptPath(conversationId: string): string {
	return join(
		homedir(),
		".gemini",
		"antigravity-cli",
		"brain",
		conversationId,
		".system_generated",
		"logs",
		"transcript.jsonl",
	);
}

function truncate(value: string, limit = MAX_PROGRESS_LINE_LENGTH): string {
	const collapsed = value.replace(/\s+/g, " ").trim();
	return collapsed.length > limit ? `${collapsed.slice(0, limit - 1)}…` : collapsed;
}

/**
 * agy stores a `run_command` command line as a JSON-quoted, escaped shell
 * script, so the raw value arrives as `"\"PROJECT_ROOT=\\\"/x\\\"\\nls\""`.
 * Unwrap one layer of quoting so the log shows the command a person typed
 * rather than its encoding.
 */
function unwrapQuoted(value: string): string {
	const trimmed = value.trim();
	if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
		try {
			const parsed: unknown = JSON.parse(trimmed);
			if (typeof parsed === "string") {
				return parsed;
			}
		} catch {
			// Not valid JSON after all; fall through to the raw value.
		}
	}
	return trimmed;
}

/** Argument fields worth showing, in the order agy's own tools use them. */
const TOOL_ARG_KEYS = ["CommandLine", "AbsolutePath", "TargetFile", "Query", "SearchDirectory", "Path", "File"];

function describeToolCall(call: unknown): string | null {
	if (!call || typeof call !== "object" || Array.isArray(call)) {
		return null;
	}
	const record = call as { name?: unknown; args?: unknown };
	const name = typeof record.name === "string" && record.name.length > 0 ? record.name : "tool";
	const args = record.args;
	if (!args || typeof args !== "object" || Array.isArray(args)) {
		return name;
	}
	const argRecord = args as Record<string, unknown>;
	for (const key of TOOL_ARG_KEYS) {
		const value = argRecord[key];
		if (typeof value === "string" && value.trim().length > 0) {
			return `${name}: ${truncate(unwrapQuoted(value))}`;
		}
	}
	const keys = Object.keys(argRecord);
	return keys.length > 0 ? `${name}: ${truncate(keys.join(", "))}` : name;
}

/**
 * agy prefixes every tool result with its own timing header. It is noise next to
 * a `created_at` we already have, and it pushes the useful part — the exit code
 * and the first lines of output — past where anyone reads.
 */
function stripToolResultHeader(content: string): string {
	return content.replace(/^(?:Created At|Completed At):[^\n]*\n?/gm, "").trim();
}

/**
 * Maps one transcript record to the progress lines it deserves, or an empty
 * array for records that carry nothing a watcher needs.
 *
 * `USER_INPUT` is dropped on purpose: for a graph rebuild that record is the
 * runtime's own ~46 KB prompt (the whole inlined `understand` skill), which
 * would bury the run's first real command.
 */
export function describeAgyTranscriptRecord(record: unknown): AgyProgressLine[] {
	if (!record || typeof record !== "object" || Array.isArray(record)) {
		return [];
	}
	const entry = record as {
		type?: unknown;
		content?: unknown;
		tool_calls?: unknown;
	};
	const type = typeof entry.type === "string" ? entry.type : "";
	if (type === "USER_INPUT") {
		return [];
	}

	const out: AgyProgressLine[] = [];

	if (Array.isArray(entry.tool_calls)) {
		for (const call of entry.tool_calls) {
			const described = describeToolCall(call);
			if (described) {
				out.push({ kind: "command", line: described });
			}
		}
	}

	if (typeof entry.content === "string" && entry.content.trim().length > 0) {
		if (type === "GENERIC") {
			// A tool result. Keep the exit line plus a glimpse of the output.
			const body = stripToolResultHeader(entry.content);
			const lines = body
				.split(/\r?\n/)
				.map((line) => line.trim())
				.filter((line) => line.length > 0);
			for (const line of lines.slice(0, MAX_OUTPUT_LINES)) {
				out.push({ kind: "output", line: truncate(line) });
			}
			if (lines.length > MAX_OUTPUT_LINES) {
				out.push({ kind: "output", line: `… ${lines.length - MAX_OUTPUT_LINES} more output line(s)` });
			}
		} else {
			// Planner prose. This is where the skill's `[Phase n/7]` lines live, so
			// keep its own line breaks rather than collapsing it into one entry.
			for (const line of entry.content.split(/\r?\n/)) {
				const trimmed = line.trim();
				if (trimmed.length > 0) {
					out.push({ kind: "phase", line: truncate(trimmed, MAX_PROGRESS_LINE_LENGTH * 2) });
				}
			}
		}
	}

	return out;
}

/** Parses one transcript line, tolerating the partial writes a tail can catch. */
export function describeAgyTranscriptLine(line: string): AgyProgressLine[] {
	const trimmed = line.trim();
	if (trimmed.length === 0 || !trimmed.startsWith("{")) {
		return [];
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch {
		return [];
	}
	return describeAgyTranscriptRecord(parsed);
}
