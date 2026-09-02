import { ExternalLink, GraduationCap, X } from "lucide-react";
import { type ReactElement, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import { isLightUiTheme, useTheme } from "@/hooks/use-theme";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type { RuntimeOpenmaicHealth, RuntimeOpenmaicStatus } from "@/runtime/types";

export interface LearningViewProps {
	/** Selects which runtime the tRPC client talks to. The classroom itself is global. */
	workspaceId: string | null;
	onClose: () => void;
}

/** Matches the Agents sidebar's studio poll; only runs while the classroom is down. */
const POLL_INTERVAL_MS = 5_000;

/**
 * `ALLOWED_FRAME_ANCESTORS` is upstream's own opt-in for embedding, and it has to be set at
 * *build* time: `next.config.ts` `headers()` runs during the build and bakes the result into
 * the routes manifest, so setting it at `next start` is silently ignored. Without it the
 * classroom serves `X-Frame-Options: SAMEORIGIN` and this frame renders blank.
 *
 * `CI=true` + the pinned pnpm mirror upstream's Dockerfile: it activates pnpm 10.28 via
 * corepack, and this repo runs pnpm 11, which would otherwise negotiate the pinned version
 * over the network and refuse to replace `node_modules` without a TTY.
 */
const SETUP_COMMANDS = [
	"git submodule update --init backends/openmaic",
	"cd backends/openmaic && CI=true npx pnpm@10.28.0 install --frozen-lockfile",
	'ALLOWED_FRAME_ANCESTORS="http://127.0.0.1:3484 http://localhost:3484" \\\n  CI=true npx pnpm@10.28.0 build',
];

/**
 * Frames OpenMAIC — an open-source multi-agent interactive classroom — in the center pane,
 * so course material sits next to the board instead of in a browser tab.
 *
 * Locally served rather than embedded from GitHub: github.com sends `X-Frame-Options: deny`,
 * so a raw frame at the upstream repo renders blank. The runtime supervises the app on
 * 127.0.0.1:3020 (`openmaic-process.ts`) and this frames it cross-origin, the same shape as
 * `AgentStudioView` and for the same reason — the `/api/*-proxy/` handlers buffer to text
 * and the WS-upgrade allowlist drops every path but the runtime's own, neither of which a
 * Next.js bundle survives.
 *
 * Security posture, stated here because the UI is where anyone will read it: the classroom
 * has no login in front of it and needs an LLM provider key in
 * `backends/openmaic/.env.local` — Next.js reads that file from the process cwd and
 * nowhere else, and upstream's own `.gitignore` already covers `.env*`. The loopback bind
 * is the entire boundary.
 */
export function LearningView({ workspaceId, onClose }: LearningViewProps): ReactElement {
	const { themeId } = useTheme();
	const isLight = isLightUiTheme(themeId);
	const themeParam = isLight ? "light" : "dark";

	const [status, setStatus] = useState<RuntimeOpenmaicStatus | null>(null);
	const [health, setHealth] = useState<RuntimeOpenmaicHealth | null>(null);
	const [error, setError] = useState<string | null>(null);
	const iframeRef = useRef<HTMLIFrameElement | null>(null);

	// Synchronize theme changes to embedded classroom iframe dynamically
	useEffect(() => {
		if (!iframeRef.current?.contentWindow) {
			return;
		}
		iframeRef.current.contentWindow.postMessage(
			{
				type: "theme-change",
				theme: themeParam,
				themeId,
			},
			"*",
		);
	}, [themeParam, themeId]);

	/**
	 * Polled while offline, not fetched once: the runtime starts the classroom at boot and
	 * `next start` takes a few seconds, so a single fetch on mount lands on "not responding"
	 * and stays there until the tab is toggled. The interval stops as soon as it is up —
	 * there is nothing to watch for after that, and the frame is live anyway.
	 */
	const isFramable = status?.online === true && status.embeddable;
	useEffect(() => {
		if (isFramable) {
			return;
		}
		let cancelled = false;
		const poll = async (): Promise<void> => {
			try {
				const client = getRuntimeTrpcClient(workspaceId);
				const [statusResponse, healthResponse] = await Promise.all([
					client.openmaic.status.query(),
					client.openmaic.health.query(),
				]);
				if (!cancelled) {
					setStatus(statusResponse);
					setHealth(healthResponse);
					setError(null);
				}
			} catch (caught) {
				if (!cancelled) {
					setError(caught instanceof Error ? caught.message : String(caught));
				}
			}
		};
		void poll();
		const timer = window.setInterval(() => {
			void poll();
		}, POLL_INTERVAL_MS);
		return () => {
			cancelled = true;
			window.clearInterval(timer);
		};
	}, [isFramable, workspaceId]);

	const header = (
		<div className="flex items-center gap-2 border-b border-border bg-surface-1 px-3 py-1.5">
			<GraduationCap size={14} className="shrink-0 text-text-secondary" />
			<span className="flex-1 truncate text-[13px] font-medium text-text-primary">Learning</span>
			{status?.online === true ? (
				<Tooltip content="Open the classroom in a browser tab">
					<Button
						variant="ghost"
						size="sm"
						icon={<ExternalLink size={14} />}
						aria-label="Open the classroom in a new tab"
						onClick={() => {
							const targetUrl = `${status.baseUrl}${status.baseUrl.includes("?") ? "&" : "?"}theme=${themeParam}&themeId=${encodeURIComponent(themeId)}`;
							window.open(targetUrl, "_blank", "noopener,noreferrer");
						}}
					/>
				</Tooltip>
			) : null}
			<Tooltip content="Close">
				<Button variant="ghost" size="sm" icon={<X size={14} />} aria-label="Close learning" onClick={onClose} />
			</Tooltip>
		</div>
	);

	const healthPanel =
		status?.online === true && health !== null ? (
			<div className="grid grid-cols-1 gap-2 border-b border-border bg-surface-1 px-3 py-2 md:grid-cols-2">
				<div className="rounded-md border border-border bg-surface-2 px-2 py-1">
					<p className="text-[11px] font-medium text-text-secondary">Speech recognition</p>
					<p className={health.asrReady ? "text-xs text-status-green" : "text-xs text-status-orange"}>
						{health.asrReady ? "Ready" : "Needs provider/browser setup"}
					</p>
				</div>
				<div className="rounded-md border border-border bg-surface-2 px-2 py-1">
					<p className="text-[11px] font-medium text-text-secondary">Text to speech</p>
					<p className={health.ttsReady ? "text-xs text-status-green" : "text-xs text-status-orange"}>
						{health.ttsReady ? "Ready" : "Needs provider/browser setup"}
					</p>
				</div>
				<div className="rounded-md border border-border bg-surface-2 px-2 py-1">
					<p className="text-[11px] font-medium text-text-secondary">Video generation</p>
					<p className={health.videoReady ? "text-xs text-status-green" : "text-xs text-status-orange"}>
						{health.videoReady ? "Ready" : "Needs provider setup"}
					</p>
				</div>
				<div className="rounded-md border border-border bg-surface-2 px-2 py-1">
					<p className="text-[11px] font-medium text-text-secondary">Subscription routing</p>
					<p
						className={
							health.subscriptionSeatRoutingReady ? "text-xs text-status-green" : "text-xs text-status-orange"
						}
					>
						{health.subscriptionSeatRoutingReady
							? "Ready"
							: "Not auto-wired (uses OpenMAIC provider env keys)"}
					</p>
				</div>
				{health.missingKeys.length > 0 ? (
					<div className="col-span-1 rounded-md border border-border bg-surface-2 px-2 py-1 md:col-span-2">
						<p className="text-[11px] font-medium text-text-secondary">Learning health notes</p>
						<p className="text-xs text-text-tertiary">{health.missingKeys.join(" | ")}</p>
					</div>
				) : null}
			</div>
		) : null;

	const body = ((): ReactElement => {
		if (error !== null) {
			return (
				<div className="flex flex-1 min-h-0 flex-col items-center justify-center gap-2 bg-surface-0 px-6 text-center">
					<GraduationCap size={40} strokeWidth={1} className="text-text-tertiary" />
					<p className="text-sm text-status-red">{error}</p>
				</div>
			);
		}
		if (status === null) {
			return (
				<div className="flex flex-1 min-h-0 items-center justify-center bg-surface-0">
					<Spinner size={24} />
				</div>
			);
		}
		if (status.online && status.embeddable) {
			const iframeSrc = `${status.baseUrl}${status.baseUrl.includes("?") ? "&" : "?"}theme=${themeParam}&themeId=${encodeURIComponent(themeId)}`;
			return (
				<iframe
					ref={iframeRef}
					src={iframeSrc}
					title="Learning"
					allow="microphone; autoplay; camera"
					className="h-full w-full flex-1 border-0"
				/>
			);
		}
		// Four distinct states, because each has a different fix — see
		// `RuntimeOpenmaicStatusSchema`. The `online && !embeddable` case is the subtle one:
		// the classroom is up and works in a browser tab, and only the *frame* is refused.
		const headline = !status.installed
			? "The classroom is not installed yet."
			: !status.built
				? "The classroom is cloned but has not been built."
				: status.online
					? "The classroom is running, but it refuses to be embedded."
					: "The classroom is installed but is not responding.";
		return (
			<div className="flex flex-1 min-h-0 flex-col items-center justify-center gap-3 bg-surface-0 px-6 text-center">
				<GraduationCap size={40} strokeWidth={1} className="text-text-tertiary" />
				<p className="text-sm text-text-secondary">{headline}</p>
				{status.online && !status.embeddable ? (
					<>
						<p className="max-w-lg text-xs text-text-tertiary">
							It was built without <code className="font-mono">ALLOWED_FRAME_ANCESTORS</code>, so it
							sends <code className="font-mono">X-Frame-Options: SAMEORIGIN</code> and the browser
							blocks this frame. That flag is read at build time, so a restart will not help —
							rebuild with the last command below. It still opens fine in a tab.
						</p>
						<Button
							variant="primary"
							size="sm"
							icon={<ExternalLink size={13} />}
							onClick={() => {
								window.open(status.baseUrl, "_blank", "noopener,noreferrer");
							}}
						>
							Open in a tab
						</Button>
						<div className="flex flex-col items-stretch gap-1">
							{SETUP_COMMANDS.slice(2).map((command) => (
								<code
									key={command}
									className="whitespace-pre rounded-md border border-border bg-surface-2 px-2 py-1 text-left font-mono text-xs text-text-primary"
								>
									{command}
								</code>
							))}
						</div>
					</>
				) : status.installed && status.built ? (
					<p className="text-xs text-text-tertiary">
						Nothing is listening on {status.baseUrl}. Check the runtime log, or{" "}
						<code className="font-mono">backends/openmaic/.openmaic/classroom.log</code> (where this
						supervisor sends the child's output).
					</p>
				) : (
					<div className="flex flex-col items-stretch gap-1">
						{SETUP_COMMANDS.map((command) => (
							<code
								key={command}
								className="rounded-md border border-border bg-surface-2 px-2 py-1 text-left font-mono text-xs text-text-primary"
							>
								{command}
							</code>
						))}
					</div>
				)}
				<p className="max-w-md text-xs text-text-tertiary">
					It needs an LLM provider key in{" "}
					<code className="font-mono">backends/openmaic/.env.local</code> (copy{" "}
					<code className="font-mono">.env.example</code>). There is no login in front of the classroom
					— it is bound to loopback, and that bind is the whole boundary.
				</p>
			</div>
		);
	})();

	return (
		<div className="flex flex-1 min-h-0 min-w-0 flex-col bg-surface-0">
			{header}
			{healthPanel}
			{body}
		</div>
	);
}
