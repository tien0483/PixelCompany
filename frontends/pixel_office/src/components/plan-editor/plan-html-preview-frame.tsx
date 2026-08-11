import { memo, type ReactElement, useEffect, useMemo, useRef, useState } from "react";

import { withPreviewBase } from "@/components/plan-editor/plan-html-preview";
import { HTML_LABELS } from "@/html/html-labels";

/**
 * ~3 fps while streaming. Assigning `srcDoc` makes the browser tear down and re-parse the whole
 * document — including re-fetching the CDN CSS and fonts in `<head>` — so one assignment per SSE
 * delta is what made the preview strobe. Same number the sidecar's own preview pane settled on.
 */
export const PREVIEW_STREAM_DEBOUNCE_MS = 320;

const EMPTY_HTML_PREVIEW =
	"<!doctype html><html><body style='font:14px sans-serif;color:#888;padding:16px'>Preview</body></html>";

/** A document is only worth rendering once its `<head>` is closed; before that it is unstyled. */
const HEAD_COMPLETE_PATTERN = /<\/head\s*>|<body\b/i;

export type PlanHtmlPreviewMode =
	/** Fresh generation: nothing better to show, so render the partial document at ~3 fps. */
	| "debounce"
	/** Refine: an accepted page is already on screen — keep it until the new one is complete. */
	| "hold";

export interface PlanHtmlPreviewFrameProps {
	/** The document to show: the streamed text while running, the saved sibling otherwise. */
	html: string;
	/**
	 * The last accepted document, shown instead of a streamed one that is being withheld —
	 * in `"hold"` mode for the whole run, in `"debounce"` mode until `<head>` is closed.
	 */
	fallbackHtml: string;
	streaming: boolean;
	mode: PlanHtmlPreviewMode;
	planId: string;
}

/**
 * The plan editor's HTML preview iframe.
 *
 * Owns *when* the iframe is allowed to reload, which the editor view deliberately does not:
 * - while streaming, updates are debounced, and in `"hold"` mode suppressed entirely;
 * - a partial document is withheld until its `<head>` is closed, so the first frames are never
 *   an unstyled skeleton;
 * - an empty `html` never clears a populated frame. That last rule also covers the gap right
 *   after a save, when the sibling document is re-read from disk and is momentarily "".
 */
function PlanHtmlPreviewFrameImpl({
	html,
	fallbackHtml,
	streaming,
	mode,
	planId,
}: PlanHtmlPreviewFrameProps): ReactElement {
	const [committed, setCommitted] = useState(html);
	/** Last document actually handed to the iframe, so an empty update can be ignored. */
	const committedRef = useRef(html);
	const lastCommitAtRef = useRef(0);

	useEffect(() => {
		const commit = (next: string) => {
			if (next.trim() === "" || next === committedRef.current) {
				return;
			}
			committedRef.current = next;
			lastCommitAtRef.current = Date.now();
			setCommitted(next);
		};
		if (!streaming) {
			// The run is over (or never started): whatever we have is final, show it at once.
			commit(html);
			return;
		}
		if (mode === "hold" || !HEAD_COMPLETE_PATTERN.test(html)) {
			// Nothing worth rendering from this run yet — keep (or restore) the accepted page.
			commit(fallbackHtml);
			return;
		}
		// Throttle rather than debounce: deltas arrive faster than the interval for most of a
		// run, and a trailing debounce would show nothing at all until the stream went quiet.
		const sinceLast = Date.now() - lastCommitAtRef.current;
		if (sinceLast >= PREVIEW_STREAM_DEBOUNCE_MS) {
			commit(html);
			return;
		}
		const timer = setTimeout(() => commit(html), PREVIEW_STREAM_DEBOUNCE_MS - sinceLast);
		return () => clearTimeout(timer);
	}, [fallbackHtml, html, mode, streaming]);

	const srcDoc = useMemo(
		() => (committed.trim() === "" ? EMPTY_HTML_PREVIEW : withPreviewBase(committed, planId)),
		[committed, planId],
	);

	return (
		<iframe
			title={HTML_LABELS.preview}
			sandbox="allow-scripts"
			srcDoc={srcDoc}
			className="min-h-0 w-full flex-1 border-0 bg-white"
			data-testid="plan-editor-html-preview"
		/>
	);
}

export const PlanHtmlPreviewFrame = memo(PlanHtmlPreviewFrameImpl);
