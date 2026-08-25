/**
 * Frame-level plumbing for the runtime's one-shot agent SSE endpoints.
 *
 * Split out of `use-html-agent-stream` because there are two shapes of consumer and
 * only one wire format. The hook renders a run as it arrives, which has to be React
 * state; a caller that just wants the finished text — the review panel's
 * comment-rewrite pass — wants a promise it can `await` inside an event handler.
 * Both need exactly this parser, and a second copy of it is how the two would drift.
 */

export interface AgentSseFrame {
	event: string;
	data: Record<string, unknown>;
}

/**
 * These routes reject with `{"error": "..."}` before the stream opens. Showing the
 * raw body would put `HTTP 409: {"error":"No rules have been extracted…"}` in front
 * of the user, so the sentence is unwrapped when it is there and the status kept as
 * the prefix — a 413 with an empty body still has to say something.
 */
export function describeHttpFailure(status: number, body: string): string {
	try {
		const parsed: unknown = JSON.parse(body);
		if (typeof parsed === "object" && parsed !== null && typeof (parsed as { error?: unknown }).error === "string") {
			return (parsed as { error: string }).error;
		}
	} catch {
		// Not JSON — fall through to the raw body.
	}
	return `HTTP ${status}: ${body}`;
}

/**
 * Reads an SSE body, calling `onFrame` per complete frame.
 *
 * Frames without an `event:` line inherit the previous one's name, which is what the
 * spec says and what the runtime relies on when it writes several data lines in a
 * row. A frame whose data is not JSON is skipped rather than fatal: one malformed
 * frame should not discard a run that is otherwise fine.
 */
export async function readAgentSseFrames(
	body: ReadableStream<Uint8Array>,
	onFrame: (frame: AgentSseFrame) => void,
): Promise<void> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffered = "";
	let lastEvent = "";

	while (true) {
		const { value, done } = await reader.read();
		if (done) {
			break;
		}
		buffered += decoder.decode(value, { stream: true });
		let blank: number;
		while ((blank = buffered.indexOf("\n\n")) !== -1) {
			const block = buffered.slice(0, blank);
			buffered = buffered.slice(blank + 2);
			let event = lastEvent;
			const dataLines: string[] = [];
			for (const line of block.split("\n")) {
				if (line.startsWith("event:")) {
					event = line.slice(6).trim();
				} else if (line.startsWith("data:")) {
					dataLines.push(line.slice(5).trim());
				}
			}
			lastEvent = event;
			if (dataLines.length === 0) {
				continue;
			}
			let data: Record<string, unknown>;
			try {
				data = JSON.parse(dataLines.join("\n")) as Record<string, unknown>;
			} catch {
				continue;
			}
			onFrame({ event, data });
		}
	}
}

/**
 * Runs a one-shot agent route and resolves with everything it streamed.
 *
 * Rejects on an HTTP failure or an `error` frame, so a caller can `try`/`catch`
 * around it — the review panel needs that to fall back to unpolished text rather
 * than silently dropping the reviewer's comment.
 */
export async function runAgentTextRequest(
	endpoint: string,
	body: unknown,
	signal?: AbortSignal,
): Promise<string> {
	const response = await fetch(endpoint, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
		...(signal ? { signal } : {}),
	});
	if (!response.ok || !response.body) {
		const text = await response.text().catch(() => response.statusText);
		throw new Error(describeHttpFailure(response.status, text));
	}

	let accumulated = "";
	let failure: string | null = null;
	await readAgentSseFrames(response.body, ({ event, data }) => {
		if (event === "delta" && typeof data.text === "string") {
			accumulated += data.text;
		} else if (event === "html" && typeof data.text === "string") {
			// A whole-document event, not a chunk — it replaces rather than appends.
			accumulated = data.text;
		} else if (event === "error") {
			failure = String(data.message ?? "agent error");
		}
	});

	if (failure !== null) {
		throw new Error(failure);
	}
	const text = accumulated.trim();
	if (text.length === 0) {
		throw new Error("The agent returned nothing.");
	}
	return text;
}
