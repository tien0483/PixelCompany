import { type ReactElement, useEffect, useState } from "react";

import { HTML_LABELS } from "@/html/html-labels";

/** Fast enough for a 0.1 s readout to look live, slow enough to stay off the render hot path. */
const TICK_INTERVAL_MS = 100;

export interface PlanHtmlRunMetricsProps {
	running: boolean;
	startedAt: number | null;
	firstByteAt: number | null;
	doneAt: number | null;
	htmlSizeBytes: number;
}

function formatElapsed(ms: number): string {
	return `${(ms / 1000).toFixed(1)}s`;
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	return `${(bytes / 1024).toFixed(1)} KB`;
}

/**
 * Elapsed / TTFB / size readout for a running HTML pass.
 *
 * Its own component purely so the 10 Hz clock re-renders this one span group instead of the
 * whole generate bar (and, through it, everything the bar's props are derived from).
 */
export function PlanHtmlRunMetrics({
	running,
	startedAt,
	firstByteAt,
	doneAt,
	htmlSizeBytes,
}: PlanHtmlRunMetricsProps): ReactElement | null {
	const [, setTick] = useState(0);

	useEffect(() => {
		if (!running) return;
		const id = window.setInterval(() => setTick((n) => n + 1), TICK_INTERVAL_MS);
		return () => window.clearInterval(id);
	}, [running]);

	if (startedAt === null) {
		return null;
	}
	const elapsedMs = (doneAt ?? Date.now()) - startedAt;
	const ttfbMs = firstByteAt === null ? null : firstByteAt - startedAt;

	return (
		<span
			className="hidden items-center gap-2 font-mono text-[10px] uppercase tracking-wide text-text-tertiary xl:inline-flex"
			data-testid="plan-html-run-metrics"
		>
			<span>
				{HTML_LABELS.elapsed} {formatElapsed(elapsedMs)}
			</span>
			<span>
				{HTML_LABELS.ttfb} {ttfbMs !== null ? formatElapsed(ttfbMs) : "—"}
			</span>
			<span>
				{HTML_LABELS.size} {htmlSizeBytes > 0 ? formatBytes(htmlSizeBytes) : "—"}
			</span>
		</span>
	);
}
