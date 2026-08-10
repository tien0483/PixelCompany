import { useCallback, useEffect, useRef, useState } from "react";

export type HtmlStreamStatus = "idle" | "running" | "done" | "error";

export interface HtmlStreamState {
	status: HtmlStreamStatus;
	/** Whatever the agent streamed: the HTML document, or the expanded brief. */
	text: string;
	error: string | null;
	log: string[];
	startedAt: number | null;
	firstByteAt: number | null;
	doneAt: number | null;
}

const INITIAL: HtmlStreamState = {
	status: "idle",
	text: "",
	error: null,
	log: [],
	startedAt: null,
	firstByteAt: null,
	doneAt: null,
};

export interface HtmlGenerateRequest {
	templateId: string;
	content: string;
	format?: string;
	model?: string;
	cwd?: string;
	planId?: string;
	editFromHtml?: string;
	editFromContent?: string;
	managerAccountId?: number;
}

export interface HtmlDraftRequest {
	planId: string;
	/** The user's natural-language instruction from the prompt bar. */
	instruction: string;
	/** The plan's current markdown, for voice and structure. May be empty. */
	context: string;
	/** The excerpt the answer replaces; omitted when the draft is appended instead. */
	selection?: string;
	model?: string;
	managerAccountId?: number;
}

export interface HtmlBriefRequest {
	planId: string;
	content: string;
	templateId?: string;
	model?: string;
	managerAccountId?: number;
}

/**
 * Consumes a runtime one-shot agent SSE endpoint (InvokeEvent union).
 *
 * Both HTML routes stream the same event shape — `/api/html/generate` emits an
 * HTML document, `/api/html/brief` emits markdown — so they share this hook
 * rather than duplicating the frame parser and the timing bookkeeping.
 */
export function useHtmlAgentStream<TRequest>(endpoint: string) {
	const [state, setState] = useState<HtmlStreamState>(INITIAL);
	const abortRef = useRef<AbortController | null>(null);

	const cancel = useCallback(() => {
		abortRef.current?.abort();
		abortRef.current = null;
		setState((prev) => ({ ...prev, status: "idle" }));
	}, []);

	/**
	 * Full teardown for a plan switch: abort any in-flight request and drop back to
	 * the pristine initial state. Unlike `cancel()`, this also clears `text`/`status`
	 * so a stale "done" stream from the previous plan can't be mistaken for the new
	 * plan's content when the completion effects re-fire.
	 */
	const reset = useCallback(() => {
		abortRef.current?.abort();
		abortRef.current = null;
		setState(INITIAL);
	}, []);

	const run = useCallback(
		async (req: TRequest) => {
			abortRef.current?.abort();
			const ctl = new AbortController();
			abortRef.current = ctl;
			setState({
				status: "running",
				text: "",
				error: null,
				log: [],
				startedAt: Date.now(),
				firstByteAt: null,
				doneAt: null,
			});

			try {
				const res = await fetch(endpoint, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(req),
					signal: ctl.signal,
				});
				if (!res.ok || !res.body) {
					const text = await res.text().catch(() => res.statusText);
					throw new Error(`HTTP ${res.status}: ${text}`);
				}

				const reader = res.body.getReader();
				const dec = new TextDecoder();
				let buf = "";
				let lastEvent = "";
				let acc = "";

				while (true) {
					const { value, done } = await reader.read();
					if (done) break;
					buf += dec.decode(value, { stream: true });
					let blank: number;
					while ((blank = buf.indexOf("\n\n")) !== -1) {
						const block = buf.slice(0, blank);
						buf = buf.slice(blank + 2);
						const lines = block.split("\n");
						let event = lastEvent;
						const dataLines: string[] = [];
						for (const line of lines) {
							if (line.startsWith("event:")) event = line.slice(6).trim();
							else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
						}
						lastEvent = event;
						if (dataLines.length === 0) continue;
						let data: Record<string, unknown>;
						try {
							data = JSON.parse(dataLines.join("\n")) as Record<string, unknown>;
						} catch {
							continue;
						}
						if (event === "delta" && typeof data.text === "string") {
							acc += data.text;
							const snapshot = acc;
							setState((prev) => ({
								...prev,
								text: snapshot,
								firstByteAt: prev.firstByteAt ?? Date.now(),
							}));
						} else if (event === "html" && typeof data.text === "string") {
							acc = data.text;
							setState((prev) => ({
								...prev,
								text: data.text as string,
								firstByteAt: prev.firstByteAt ?? Date.now(),
							}));
						} else if (event === "error") {
							const message = String(data.message ?? "agent error");
							setState((prev) => ({
								...prev,
								status: "error",
								error: message,
								log: [...prev.log, message],
								doneAt: prev.doneAt ?? Date.now(),
							}));
						} else if (event === "stderr" && typeof data.text === "string") {
							setState((prev) => ({ ...prev, log: [...prev.log, data.text as string] }));
						} else if (event === "done") {
							setState((prev) => ({
								...prev,
								status: prev.error ? "error" : "done",
								text: acc || prev.text,
								doneAt: prev.doneAt ?? Date.now(),
							}));
						}
					}
				}
				setState((prev) =>
					prev.status === "running"
						? {
								...prev,
								status: prev.error ? "error" : "done",
								text: acc || prev.text,
								doneAt: prev.doneAt ?? Date.now(),
							}
						: prev,
				);
			} catch (err) {
				if ((err as Error)?.name === "AbortError") {
					setState((prev) => ({ ...prev, status: "idle" }));
					return;
				}
				const message = err instanceof Error ? err.message : String(err);
				setState((prev) => ({
					...prev,
					status: "error",
					error: message,
					doneAt: prev.doneAt ?? Date.now(),
				}));
			} finally {
				if (abortRef.current === ctl) {
					abortRef.current = null;
				}
			}
		},
		[endpoint],
	);

	// `key={editingPlan.id}` on the owning `PlanEditorView` means a plan switch
	// unmounts this hook's instance rather than re-rendering it with a new `plan.id` —
	// so `reset()`'s abort-in-flight-request behavior is never reached on a live plan
	// switch unless something aborts here too. Without this, the fetch keeps running
	// server-side with nobody listening to its result after the component is gone.
	useEffect(() => {
		return () => {
			abortRef.current?.abort();
		};
	}, []);

	return { ...state, run, cancel, reset };
}

/** Template → single-file HTML document. */
export function useHtmlGenerate() {
	return useHtmlAgentStream<HtmlGenerateRequest>("/api/html/generate");
}

/** Rough notes + pasted screenshots → the structured brief generation reads from. */
export function useHtmlBrief() {
	return useHtmlAgentStream<HtmlBriefRequest>("/api/html/brief");
}

/** Prompt-bar instruction → markdown appended to, or replacing part of, the plan. */
export function useHtmlDraft() {
	return useHtmlAgentStream<HtmlDraftRequest>("/api/html/draft");
}
