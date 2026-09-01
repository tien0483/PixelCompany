import { ExternalLink, Hammer, Network, X } from "lucide-react";
import { type ReactElement, useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import { isLightUiTheme, useTheme } from "@/hooks/use-theme";
import { useHtmlAgentStream } from "@/html/use-html-agent-stream";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type {
	RuntimeManagerAccount,
	RuntimeReviewGraphRebuildRequest,
} from "@/runtime/types";

/**
 * The `agy models` id a build runs on.
 *
 * The Review tab deliberately sends *no* model (its comment says the ids carry an
 * effort suffix and change between releases); pinning one here is the user's explicit
 * instruction for this surface. If `agy models` stops listing it the run fails fast
 * with agy's own error, which is the accepted trade — hence one exported constant, so
 * changing it is a one-line edit.
 */
export const UNDERSTAND_REBUILD_MODEL = "gemini-3.7-flash";
export const UNDERSTAND_REBUILD_EFFORT = "medium" as const;

type GraphProbe =
	| { state: "probing" }
	| { state: "absent" }
	| { state: "present" }
	| { state: "error"; message: string };

export interface UnderstandViewProps {
	/** Selects which runtime the tRPC client talks to; not a filter on the graph. */
	workspaceId: string | null;
	/** The checkout whose `.ua/knowledge-graph.json` is served. Null with no project open. */
	projectPath: string | null;
	/** Manager seats; the Antigravity ones are what a build is billed against. */
	managerAccounts?: RuntimeManagerAccount[];
	onClose: () => void;
}

/**
 * Frames the Understand Anything knowledge-graph dashboard for the current project.
 *
 * The whole backend already exists for the Review tab — `review.openGraphDashboard`
 * starts one viewer per project path on 5273+ and hands back a URL with its access
 * token already in the query string. This view only reuses it, and differs in one
 * respect: the Review tab opens a browser tab, this embeds. That is safe because the
 * viewer is a plain `node:http` server that sets neither `X-Frame-Options` nor a CSP.
 *
 * Cross-origin on 127.0.0.1:5273+ rather than through an `/api/*-proxy/` route, for
 * the same reason `AgentStudioView` is: those proxy handlers buffer to text and the
 * WS-upgrade allowlist drops every path but the runtime's own.
 */
export function UnderstandView({
	workspaceId,
	projectPath,
	managerAccounts = [],
	onClose,
}: UnderstandViewProps): ReactElement {
	const { themeId } = useTheme();
	const isLight = isLightUiTheme(themeId);
	const themeParam = isLight ? "light" : "dark";
	const presetParam = isLight ? "light-minimal" : "dark-gold";

	const [probe, setProbe] = useState<GraphProbe>({ state: "probing" });
	const [dashboardUrl, setDashboardUrl] = useState<string | null>(null);
	const [startError, setStartError] = useState<string | null>(null);
	const [isStarting, setIsStarting] = useState(false);
	/** Bumped after a build so the frame remounts onto the regenerated graph. */
	const [reloadToken, setReloadToken] = useState(0);
	const [isLogDismissed, setIsLogDismissed] = useState(false);
	const [currentStep, setCurrentStep] = useState<string | null>(null);

	const logRef = useRef<HTMLDivElement | null>(null);
	const iframeRef = useRef<HTMLIFrameElement | null>(null);

	const handleMeta = useCallback((key: string, value: unknown) => {
		if (key === "step" && value && typeof value === "object") {
			const step = value as { stepType?: unknown; state?: unknown };
			if (typeof step.stepType === "string") {
				setCurrentStep(typeof step.state === "string" ? `${step.stepType} (${step.state})` : step.stepType);
			}
		}
	}, []);

	const rebuild = useHtmlAgentStream<RuntimeReviewGraphRebuildRequest>(
		"/api/review/graph-rebuild",
		handleMeta,
	);

	// Synchronize theme changes to embedded iframe dynamically
	useEffect(() => {
		if (!iframeRef.current?.contentWindow) {
			return;
		}
		iframeRef.current.contentWindow.postMessage(
			{
				type: "theme-change",
				theme: themeParam,
				preset: presetParam,
			},
			"*",
		);
	}, [presetParam, themeParam]);

	/**
	 * Cheap presence check before anything is spawned. `getGraphImpact` with no changed
	 * paths costs no tokens and reads only the graph's index, and it is the one call
	 * that distinguishes "no graph here" from "a graph that failed to load" — starting
	 * the viewer first would collapse both into "the dashboard did not start".
	 */
	useEffect(() => {
		if (projectPath === null) {
			setProbe({ state: "absent" });
			return;
		}
		let cancelled = false;
		setProbe({ state: "probing" });
		void (async () => {
			try {
				const client = getRuntimeTrpcClient(workspaceId);
				const response = await client.review.getGraphImpact.query({ projectPath, changedPaths: [] });
				if (cancelled) {
					return;
				}
				if (!response.ok) {
					setProbe({ state: "error", message: response.error ?? "The knowledge graph could not be read." });
					return;
				}
				setProbe({ state: response.hasGraph ? "present" : "absent" });
			} catch (error) {
				if (!cancelled) {
					setProbe({ state: "error", message: error instanceof Error ? error.message : String(error) });
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [projectPath, workspaceId, reloadToken]);

	/**
	 * Starting is idempotent per project path in the runtime (`review-dashboard-process.ts`
	 * keeps a registry plus an in-flight map), so a remount adopts the running viewer
	 * rather than spawning a second one.
	 */
	useEffect(() => {
		if (projectPath === null || probe.state !== "present") {
			setDashboardUrl(null);
			return;
		}
		let cancelled = false;
		setIsStarting(true);
		setStartError(null);
		void (async () => {
			try {
				const client = getRuntimeTrpcClient(workspaceId);
				const response = await client.review.openGraphDashboard.mutate({ projectPath });
				if (cancelled) {
					return;
				}
				if (!response.ok || !response.url) {
					setStartError(response.error ?? "The graph dashboard could not be started.");
					return;
				}
				setDashboardUrl(response.url);
			} catch (error) {
				if (!cancelled) {
					setStartError(error instanceof Error ? error.message : String(error));
				}
			} finally {
				if (!cancelled) {
					setIsStarting(false);
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [projectPath, probe.state, workspaceId, reloadToken]);

	/**
	 * Re-probe once a build finishes. Guarded on `doneAt` rather than on `status`,
	 * which stays `"done"` for the life of the hook — the same runaway-loop trap
	 * `docs-run-panel.tsx` documents, except here the effect would re-spawn a viewer.
	 */
	const rebuildDoneAt = rebuild.doneAt;
	const rebuildStatus = rebuild.status;
	const lastHandledDoneAtRef = useRef<number | null>(null);
	useEffect(() => {
		if (rebuildStatus === "done" && rebuildDoneAt !== null && lastHandledDoneAtRef.current !== rebuildDoneAt) {
			lastHandledDoneAtRef.current = rebuildDoneAt;
			setReloadToken((token) => token + 1);
		}
	}, [rebuildStatus, rebuildDoneAt]);

	// Auto-scroll on text stream and log updates
	useEffect(() => {
		if (rebuild.text.length === 0 && rebuild.log.length === 0) {
			return;
		}
		if (logRef.current) {
			if (typeof logRef.current.scrollTo === "function") {
				logRef.current.scrollTo({ top: logRef.current.scrollHeight });
			} else {
				logRef.current.scrollTop = logRef.current.scrollHeight;
			}
		}
	}, [rebuild.text, rebuild.log]);

	const isBuilding = rebuild.status === "running";

	const handleBuild = useCallback(() => {
		if (projectPath === null || isBuilding) {
			return;
		}
		setIsLogDismissed(false);
		setCurrentStep(null);
		const antigravitySeat = managerAccounts.find(
			(account) => account.provider === "antigravity" && account.isActive !== false,
		);
		void rebuild.run({
			projectPath,
			model: UNDERSTAND_REBUILD_MODEL,
			effort: UNDERSTAND_REBUILD_EFFORT,
			...(antigravitySeat === undefined ? {} : { managerAccountId: antigravitySeat.id }),
		});
	}, [isBuilding, managerAccounts, projectPath, rebuild]);

	const header = (
		<div className="flex items-center gap-2 border-b border-border bg-surface-1 px-3 py-1.5">
			<Network size={14} className="shrink-0 text-text-secondary" />
			<span className="flex-1 truncate text-[13px] font-medium text-text-primary">
				Understand{projectPath === null ? "" : ` — ${projectPath}`}
			</span>
			<Tooltip
				content={
					probe.state === "present"
						? "Rebuild the knowledge graph on the Antigravity seat — this reads the whole repository"
						: "Build the knowledge graph on the Antigravity seat — this reads the whole repository"
				}
			>
				<Button
					variant="default"
					size="sm"
					icon={isBuilding ? <Spinner size={12} /> : <Hammer size={13} />}
					disabled={projectPath === null || isBuilding}
					onClick={handleBuild}
				>
					{isBuilding ? "Building…" : probe.state === "present" ? "Rebuild graph" : "Build graph"}
				</Button>
			</Tooltip>
			{dashboardUrl === null ? null : (
				<Tooltip content="Open the dashboard in a browser tab">
					<Button
						variant="ghost"
						size="sm"
						icon={<ExternalLink size={14} />}
						aria-label="Open the graph dashboard in a new tab"
						onClick={() => {
							const targetUrl = `${dashboardUrl}${dashboardUrl.includes("?") ? "&" : "?"}theme=${themeParam}&preset=${presetParam}`;
							window.open(targetUrl, "_blank", "noopener,noreferrer");
						}}
					/>
				</Tooltip>
			)}
			<Tooltip content="Close">
				<Button variant="ghost" size="sm" icon={<X size={14} />} aria-label="Close understand" onClick={onClose} />
			</Tooltip>
		</div>
	);

	const hasOutput = rebuild.text.length > 0 || rebuild.log.length > 0;

	const runLog =
		rebuild.status === "idle" || isLogDismissed ? null : (
			<div className="flex h-44 shrink-0 flex-col gap-1 border-t border-border bg-surface-1 p-2">
				<div className="flex items-center gap-2 text-[11px] text-text-secondary">
					<span className="font-medium text-text-tertiary">Graph build</span>
					{rebuild.status === "error" && rebuild.error ? (
						<span className="text-status-red">{rebuild.error}</span>
					) : isBuilding && currentStep ? (
						<span className="flex items-center gap-1.5 text-text-secondary">
							<Spinner size={11} />
							<span>{currentStep}</span>
						</span>
					) : (
						<span>{rebuild.status}</span>
					)}
					{rebuild.notices.map((notice) => (
						<span key={notice} className="text-status-orange">
							{notice}
						</span>
					))}
					<div className="flex-1" />
					<Tooltip content="Close build log">
						<Button
							variant="ghost"
							size="sm"
							icon={<X size={12} />}
							aria-label="Close build log"
							onClick={() => setIsLogDismissed(true)}
						/>
					</Tooltip>
				</div>
				<div
					ref={logRef}
					className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border bg-surface-0 px-2 py-1 font-mono text-[11px] text-text-secondary"
				>
					{!hasOutput ? (
						<div className="flex items-center gap-2 py-1 text-text-tertiary">
							{isBuilding ? <Spinner size={12} /> : null}
							<span>{isBuilding ? (currentStep ? `Running ${currentStep}…` : "Starting rebuild…") : "No output yet."}</span>
						</div>
					) : (
						<div className="flex flex-col gap-0.5">
							{rebuild.text ? (
								<div className="whitespace-pre-wrap break-words">{rebuild.text}</div>
							) : null}
							{rebuild.log.map((line, index) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: log lines are append-only and never reordered.
								<div key={index} className="text-status-red/90">
									{line}
								</div>
							))}
							{isBuilding && currentStep ? (
								<div className="flex items-center gap-1.5 pt-1 text-text-tertiary">
									<Spinner size={10} />
									<span>{currentStep}</span>
								</div>
							) : null}
						</div>
					)}
				</div>
			</div>
		);

	const body = ((): ReactElement => {
		if (probe.state === "probing" || isStarting) {
			return (
				<div className="flex flex-1 min-h-0 items-center justify-center bg-surface-0">
					<Spinner size={24} />
				</div>
			);
		}
		if (probe.state === "error" || startError !== null) {
			const message = probe.state === "error" ? probe.message : (startError as string);
			return (
				<div className="flex flex-1 min-h-0 flex-col items-center justify-center gap-2 bg-surface-0 px-6 text-center">
					<Network size={40} strokeWidth={1} className="text-text-tertiary" />
					<p className="text-sm text-status-red">{message}</p>
				</div>
			);
		}
		if (probe.state === "absent" || dashboardUrl === null) {
			return (
				<div className="flex flex-1 min-h-0 flex-col items-center justify-center gap-2 bg-surface-0 px-6 text-center">
					<Network size={40} strokeWidth={1} className="text-text-tertiary" />
					<p className="text-sm text-text-secondary">
						{projectPath === null
							? "No project is selected."
							: "No knowledge graph for this project."}
					</p>
					{/* Never auto-built: a full build reads the whole repository. */}
					{projectPath === null ? null : (
						<p className="max-w-md text-xs text-text-tertiary">
							Use <span className="text-text-secondary">Build graph</span> above to map how this
							codebase fits together. It analyzes every file, so it is never started for you.
						</p>
					)}
				</div>
			);
		}
		const iframeSrc = `${dashboardUrl}${dashboardUrl.includes("?") ? "&" : "?"}theme=${themeParam}&preset=${presetParam}`;
		return (
			// Keyed on the project (and on the build counter) so a switch remounts rather
			// than swapping `src`: the viewer holds its own selection/zoom state, and the
			// token lives in the URL, so a live src swap carries one project's session into
			// the next.
			<iframe
				ref={iframeRef}
				key={`${projectPath}-${reloadToken}`}
				src={iframeSrc}
				title="Knowledge graph dashboard"
				className="h-full w-full flex-1 border-0"
			/>
		);
	})();

	return (
		<div className="flex flex-1 min-h-0 min-w-0 flex-col bg-surface-0">
			{header}
			{body}
			{runLog}
		</div>
	);
}
