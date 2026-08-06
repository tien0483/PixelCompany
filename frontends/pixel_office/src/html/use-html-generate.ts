import { useCallback, useRef, useState } from "react";

export type HtmlGenerateStatus = "idle" | "running" | "done" | "error";

export interface HtmlGenerateState {
	status: HtmlGenerateStatus;
	html: string;
	error: string | null;
	log: string[];
}

const INITIAL: HtmlGenerateState = {
	status: "idle",
	html: "",
	error: null,
	log: [],
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

/**
 * Consumes runtime `POST /api/html/generate` SSE (InvokeEvent union).
 */
export function useHtmlGenerate() {
	const [state, setState] = useState<HtmlGenerateState>(INITIAL);
	const abortRef = useRef<AbortController | null>(null);

	const cancel = useCallback(() => {
		abortRef.current?.abort();
		abortRef.current = null;
		setState((prev) => ({ ...prev, status: "idle" }));
	}, []);

	const run = useCallback(async (req: HtmlGenerateRequest) => {
		abortRef.current?.abort();
		const ctl = new AbortController();
		abortRef.current = ctl;
		setState({ status: "running", html: "", error: null, log: [] });

		try {
			const res = await fetch("/api/html/generate", {
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
			let htmlAcc = "";

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
						htmlAcc += data.text;
						const snapshot = htmlAcc;
						setState((prev) => ({ ...prev, html: snapshot }));
					} else if (event === "html" && typeof data.text === "string") {
						htmlAcc = data.text;
						setState((prev) => ({ ...prev, html: data.text as string }));
					} else if (event === "error") {
						const message = String(data.message ?? "agent error");
						setState((prev) => ({
							...prev,
							status: "error",
							error: message,
							log: [...prev.log, message],
						}));
					} else if (event === "stderr" && typeof data.text === "string") {
						setState((prev) => ({ ...prev, log: [...prev.log, data.text as string] }));
					} else if (event === "done") {
						setState((prev) => ({
							...prev,
							status: prev.error ? "error" : "done",
							html: htmlAcc || prev.html,
						}));
					}
				}
			}
			setState((prev) =>
				prev.status === "running"
					? { ...prev, status: prev.error ? "error" : "done", html: htmlAcc || prev.html }
					: prev,
			);
		} catch (err) {
			if ((err as Error)?.name === "AbortError") {
				setState((prev) => ({ ...prev, status: "idle" }));
				return;
			}
			const message = err instanceof Error ? err.message : String(err);
			setState((prev) => ({ ...prev, status: "error", error: message }));
		} finally {
			if (abortRef.current === ctl) {
				abortRef.current = null;
			}
		}
	}, []);

	return { ...state, run, cancel };
}
