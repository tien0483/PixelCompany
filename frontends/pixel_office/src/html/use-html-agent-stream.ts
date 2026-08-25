import { useCallback, useEffect, useRef, useState } from "react";

import { describeHttpFailure, readAgentSseFrames } from "@/html/agent-sse";

export type HtmlStreamStatus = "idle" | "running" | "done" | "error";

export interface HtmlStreamState {
	status: HtmlStreamStatus;
	/** Whatever the agent streamed: the HTML document, or the expanded brief. */
	text: string;
	error: string | null;
	log: string[];
	/**
	 * Things the run wants the user to know that are not failures — chiefly which
	 * seat it actually landed on when the runtime redirected it. These arrive as
	 * `meta` frames, which used to be dropped entirely, so a redirect or a rate
	 * limit was invisible even though the runtime had already explained itself.
	 */
	notices: string[];
	startedAt: number | null;
	firstByteAt: number | null;
	doneAt: number | null;
}

/**
 * `meta` frames carry everything the stream parser can extract — model, session,
 * cwd, thinking deltas, partial usage, cost, timings. An allowlist rather than a
 * denylist because the noisy keys outnumber the useful ones and `thinking` alone
 * would push a frame per token into `notices`.
 */
function describeMetaNotice(key: string, value: unknown): string | null {
	if (key === "pin_warning") {
		return typeof value === "string" ? value : null;
	}
	if (key === "rate_limit") {
		return `Rate limited upstream: ${typeof value === "string" ? value : JSON.stringify(value)}`;
	}
	// `result` is emitted on every run; only a non-success subtype says anything.
	if (key === "result" && typeof value === "string" && value !== "success") {
		return `Run ended as "${value}".`;
	}
	return null;
}

const INITIAL: HtmlStreamState = {
	status: "idle",
	text: "",
	error: null,
	log: [],
	notices: [],
	startedAt: null,
	firstByteAt: null,
	doneAt: null,
};

export interface HtmlGenerateRequest {
	/**
	 * Omitted when no template is selected: the runtime then builds the prompt from the
	 * plan's own markdown instead of asking the sidecar for a template's, so generation
	 * works with the template registry offline.
	 */
	templateId?: string;
	content: string;
	format?: string;
	model?: string;
	cwd?: string;
	planId?: string;
	editFromHtml?: string;
	editFromContent?: string;
	/**
	 * Unified diff of the markdown against the version `editFromHtml` was generated from.
	 * Sent instead of `editFromContent` so a one-line requirement change costs a one-line
	 * prompt instead of the whole requirement twice.
	 */
	editDiff?: string;
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
export function useHtmlAgentStream<TRequest>(
	endpoint: string,
	/**
	 * Every `meta` frame, before the notice allowlist filters it. The allowlist keeps
	 * the panel readable, but it also means a caller cannot see the frames it does not
	 * render — and the review chat needs `session`, which is how it resumes the
	 * conversation on the next turn. Callers that render notices only pass nothing.
	 */
	onMeta?: (key: string, value: unknown) => void,
) {
	const [state, setState] = useState<HtmlStreamState>(INITIAL);
	const abortRef = useRef<AbortController | null>(null);
	// Held in a ref so a caller can pass an inline closure without re-creating `run`
	// on every render — `run` is a dependency of effects in the plan editor.
	const onMetaRef = useRef(onMeta);
	onMetaRef.current = onMeta;

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
				notices: [],
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
					throw new Error(describeHttpFailure(res.status, text));
				}

				let acc = "";

				await readAgentSseFrames(res.body, ({ event, data }) => {
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
					} else if (event === "meta" && typeof data.key === "string") {
						onMetaRef.current?.(data.key, data.value);
						// Deliberately not folded into `error`: a pin warning accompanies a
						// run that went on to succeed on another seat, and treating it as a
						// failure would mark a working answer as broken.
						const notice = describeMetaNotice(data.key, data.value);
						if (notice !== null) {
							setState((prev) =>
								prev.notices.includes(notice) ? prev : { ...prev, notices: [...prev.notices, notice] },
							);
						}
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
				});
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
