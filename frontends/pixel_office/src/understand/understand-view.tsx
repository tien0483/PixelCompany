import {
	AlertCircle,
	ExternalLink,
	FolderInput,
	Hammer,
	Network,
	Pause,
	Play,
	Square,
	X,
} from "lucide-react";
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
import { ImportUnderstandDialog } from "./import-understand-dialog";

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

export type RebuildStatusState = "idle" | "running" | "paused" | "done" | "error";

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
 * Handles graph presence detection, background builds with pause/resume support,
 * and importing .ua knowledge graph folders across projects.
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
	const [rebuildStatusState, setRebuildStatusState] = useState<RebuildStatusState>("idle");
	const [isActionPending, setIsActionPending] = useState(false);
	const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);

	const logRef = useRef<HTMLDivElement | null>(null);
	const iframeRef = useRef<HTMLIFrameElement | null>(null);

	const handleMeta = useCallback((key: string, value: unknown) => {
		if (key === "step" && value && typeof value === "object") {
			const step = value as { stepType?: unknown; state?: unknown };
			if (typeof step.stepType === "string") {
				setCurrentStep(typeof step.state === "string" ? `${step.stepType} (${step.state})` : step.stepType);
			}
		} else if (key === "rebuild_status" && typeof value === "string") {
			if (
				value === "running" ||
				value === "paused" ||
				value === "done" ||
				value === "error" ||
				value === "idle"
			) {
				setRebuildStatusState(value);
			}
		}
	}, []);

	const rebuild = useHtmlAgentStream<RuntimeReviewGraphRebuildRequest>(
		"/api/review/graph-rebuild",
		handleMeta,
	);

	const isBuilding =
		rebuild.status === "running" ||
		rebuildStatusState === "running" ||
		rebuildStatusState === "paused";
	const isPaused = rebuildStatusState === "paused";

	// Check if a background rebuild is already running/paused on mount
	useEffect(() => {
		if (projectPath === null) {
			return;
		}
		let cancelled = false;
		void (async () => {
			try {
				const client = getRuntimeTrpcClient(workspaceId);
				const res = await client.review.getRebuildStatus.query({ projectPath });
				if (cancelled) {
					return;
				}
				if (res.status === "running" || res.status === "paused") {
					setRebuildStatusState(res.status);
					if (res.currentStep) {
						setCurrentStep(res.currentStep);
					}
					setIsLogDismissed(false);
					// Attach to background stream
					void rebuild.run({
						projectPath,
						model: UNDERSTAND_REBUILD_MODEL,
						effort: UNDERSTAND_REBUILD_EFFORT,
					});
				}
			} catch {
				// Ignore lookup failure
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [projectPath, workspaceId]);

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
	 * Cheap presence check before anything is spawned.
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
	 * Start or connect to graph dashboard viewer when graph is present.
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
	 * Re-probe once a build finishes.
	 */
	const rebuildDoneAt = rebuild.doneAt;
	const rebuildStatus = rebuild.status;
	const lastHandledDoneAtRef = useRef<number | null>(null);
	useEffect(() => {
		if (rebuildStatus === "done" && rebuildDoneAt !== null && lastHandledDoneAtRef.current !== rebuildDoneAt) {
			lastHandledDoneAtRef.current = rebuildDoneAt;
			setRebuildStatusState("done");
			setReloadToken((token) => token + 1);
		} else if (rebuildStatus === "error") {
			setRebuildStatusState("error");
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

	const handleBuild = useCallback(() => {
		if (projectPath === null || isBuilding) {
			return;
		}
		setIsLogDismissed(false);
		setCurrentStep(null);
		setRebuildStatusState("running");
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

	const handlePause = useCallback(async () => {
		if (projectPath === null) {
			return;
		}
		setIsActionPending(true);
		try {
			const client = getRuntimeTrpcClient(workspaceId);
			const res = await client.review.pauseRebuild.mutate({ projectPath });
			if (res.ok) {
				setRebuildStatusState("paused");
			}
		} catch {
			// ignore
		} finally {
			setIsActionPending(false);
		}
	}, [projectPath, workspaceId]);

	const handleResume = useCallback(async () => {
		if (projectPath === null) {
			return;
		}
		setIsActionPending(true);
		try {
			const client = getRuntimeTrpcClient(workspaceId);
			const res = await client.review.resumeRebuild.mutate({ projectPath });
			if (res.ok) {
				setRebuildStatusState("running");
			}
		} catch {
			// ignore
		} finally {
			setIsActionPending(false);
		}
	}, [projectPath, workspaceId]);

	const handleCancel = useCallback(async () => {
		if (projectPath === null) {
			return;
		}
		setIsActionPending(true);
		try {
			const client = getRuntimeTrpcClient(workspaceId);
			await client.review.cancelRebuild.mutate({ projectPath });
			rebuild.cancel();
			setRebuildStatusState("idle");
		} catch {
			// ignore
		} finally {
			setIsActionPending(false);
		}
	}, [projectPath, workspaceId, rebuild]);

	const header = (
		<div className="flex items-center gap-2 border-b border-border bg-surface-1 px-3 py-1.5">
			<Network size={14} className="shrink-0 text-text-secondary" />
			<span className="flex-1 truncate text-[13px] font-medium text-text-primary">
				Understand{projectPath === null ? "" : ` — ${projectPath}`}
			</span>

			{/* Rebuild Controls in Header */}
			{isBuilding ? (
				<div className="flex items-center gap-1.5">
					{isPaused ? (
						<Tooltip content="Resume building the knowledge graph">
							<Button
								variant="default"
								size="sm"
								icon={isActionPending ? <Spinner size={12} /> : <Play size={13} />}
								disabled={isActionPending}
								onClick={handleResume}
							>
								Resume
							</Button>
						</Tooltip>
					) : (
						<Tooltip content="Pause building the knowledge graph">
							<Button
								variant="default"
								size="sm"
								icon={isActionPending ? <Spinner size={12} /> : <Pause size={13} />}
								disabled={isActionPending}
								onClick={handlePause}
							>
								Pause
							</Button>
						</Tooltip>
					)}
					<Tooltip content="Cancel the build">
						<Button
							variant="ghost"
							size="sm"
							icon={<Square size={12} />}
							disabled={isActionPending}
							onClick={handleCancel}
						>
							Cancel
						</Button>
					</Tooltip>
				</div>
			) : (
				<div className="flex items-center gap-1.5">
					<Tooltip
						content={
							probe.state === "present"
								? "Rebuild the knowledge graph on the Antigravity seat — this reads the whole repository"
								: "Build the knowledge graph on the Antigravity seat — this reads the whole repository"
						}
					>
						<Button
							variant="primary"
							size="sm"
							icon={<Hammer size={13} />}
							disabled={projectPath === null}
							onClick={handleBuild}
						>
							{probe.state === "present" ? "Rebuild graph" : "Build graph"}
						</Button>
					</Tooltip>
					<Tooltip content="Import .ua folder from another project sharing this source">
						<Button
							variant="default"
							size="sm"
							icon={<FolderInput size={13} />}
							disabled={projectPath === null}
							onClick={() => setIsImportDialogOpen(true)}
						>
							Import .ua
						</Button>
					</Tooltip>
				</div>
			)}

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

	// Loading state with live progress and log view when building or paused
	const loadingCenterView = (
		<div className="flex flex-1 min-h-0 flex-col items-center justify-center gap-4 bg-surface-0 p-6">
			<div className="flex flex-col items-center gap-2 text-center max-w-md">
				<div className="relative flex items-center justify-center">
					{isPaused ? (
						<div className="flex h-12 w-12 items-center justify-center rounded-full bg-status-orange/20 text-status-orange">
							<Pause size={24} />
						</div>
					) : (
						<div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-500/15 text-primary-500">
							<Spinner size={26} />
						</div>
					)}
				</div>
				<h3 className="text-base font-semibold text-text-primary">
					{isPaused ? "Knowledge graph build paused" : "Building knowledge graph…"}
				</h3>
				<p className="text-xs text-text-secondary">
					{currentStep ? currentStep : isPaused ? "Build is currently suspended" : "Scanning repository files and calculating AST nodes…"}
				</p>
				<span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-1 px-2.5 py-0.5 text-[11px] text-text-tertiary">
					<span
						className={`h-1.5 w-1.5 rounded-full ${
							isPaused ? "bg-status-orange" : "bg-status-green animate-pulse"
						}`}
					/>
					Runs in background — safe to close browser
				</span>

				<div className="flex items-center gap-2 mt-2">
					{isPaused ? (
						<Button
							variant="default"
							size="sm"
							icon={isActionPending ? <Spinner size={12} /> : <Play size={13} />}
							disabled={isActionPending}
							onClick={handleResume}
						>
							Resume build
						</Button>
					) : (
						<Button
							variant="default"
							size="sm"
							icon={isActionPending ? <Spinner size={12} /> : <Pause size={13} />}
							disabled={isActionPending}
							onClick={handlePause}
						>
							Pause build
						</Button>
					)}
					<Button
						variant="ghost"
						size="sm"
						icon={<Square size={13} />}
						disabled={isActionPending}
						onClick={handleCancel}
					>
						Cancel
					</Button>
				</div>
			</div>

			{/* Stream logs box in center */}
			<div className="w-full max-w-2xl flex flex-col gap-1 rounded-md border border-border bg-surface-1 p-2 text-left">
				<div className="flex items-center justify-between text-[11px] text-text-secondary px-1">
					<span className="font-medium text-text-tertiary">Live build logs</span>
					<span className="font-mono text-[10px] text-text-tertiary">
						{isPaused ? "PAUSED" : "RUNNING"}
					</span>
				</div>
				<div
					ref={logRef}
					className="h-44 overflow-y-auto rounded border border-border bg-surface-0 px-2.5 py-1.5 font-mono text-[11px] text-text-secondary"
				>
					{!hasOutput ? (
						<div className="flex items-center gap-2 py-2 text-text-tertiary">
							<Spinner size={12} />
							<span>Starting analysis pipeline…</span>
						</div>
					) : (
						<div className="flex flex-col gap-0.5">
							{rebuild.text ? (
								<div className="whitespace-pre-wrap break-words">{rebuild.text}</div>
							) : null}
							{rebuild.log.map((line, index) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: log lines are append-only.
								<div key={index} className="text-status-red/90">
									{line}
								</div>
							))}
							{!isPaused && currentStep ? (
								<div className="flex items-center gap-1.5 pt-1 text-text-tertiary">
									<Spinner size={10} />
									<span>{currentStep}</span>
								</div>
							) : null}
						</div>
					)}
				</div>
			</div>
		</div>
	);

	const bottomRunLog =
		rebuild.status === "idle" || isLogDismissed || isBuilding ? null : (
			<div className="flex h-44 shrink-0 flex-col gap-1 border-t border-border bg-surface-1 p-2">
				<div className="flex items-center gap-2 text-[11px] text-text-secondary">
					<span className="font-medium text-text-tertiary">Graph build log</span>
					{rebuild.status === "error" && rebuild.error ? (
						<span className="text-status-red">{rebuild.error}</span>
					) : (
						<span className="capitalize">{rebuild.status}</span>
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
					<div className="flex flex-col gap-0.5">
						{rebuild.text ? (
							<div className="whitespace-pre-wrap break-words">{rebuild.text}</div>
						) : null}
						{rebuild.log.map((line, index) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: log lines are append-only.
							<div key={index} className="text-status-red/90">
								{line}
							</div>
						))}
					</div>
				</div>
			</div>
		);

	const body = ((): ReactElement => {
		// When build/rebuild is active, show the loading with progress view
		if (isBuilding) {
			return loadingCenterView;
		}

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
				<div className="flex flex-1 min-h-0 flex-col items-center justify-center gap-3 bg-surface-0 px-6 text-center">
					<AlertCircle size={40} strokeWidth={1.5} className="text-status-red" />
					<p className="text-sm font-medium text-status-red max-w-md">{message}</p>
					<div className="flex items-center gap-2 mt-2">
						<Button variant="default" size="sm" onClick={handleBuild}>
							Try building graph
						</Button>
						<Button variant="default" size="sm" onClick={() => setIsImportDialogOpen(true)}>
							Import .ua folder
						</Button>
					</div>
				</div>
			);
		}

		// When .ua is missing or no graph is found
		if (probe.state === "absent" || dashboardUrl === null) {
			return (
				<div className="flex flex-1 min-h-0 flex-col items-center justify-center gap-3 bg-surface-0 px-6 text-center">
					<Network size={44} strokeWidth={1} className="text-text-tertiary" />
					<h3 className="text-base font-semibold text-text-primary">
						{projectPath === null ? "No project is selected" : "No knowledge graph for this project"}
					</h3>
					{projectPath === null ? null : (
						<>
							<p className="max-w-md text-xs text-text-tertiary">
								This project is missing the <span className="font-mono text-text-secondary">.ua</span> knowledge graph folder.
								Build a new graph by analyzing this codebase, or import an existing .ua folder from another project sharing the same source.
							</p>

							{/* 2 Centered Buttons */}
							<div className="flex items-center gap-3 mt-3">
								<Button
									variant="primary"
									size="md"
									icon={<Hammer size={15} />}
									onClick={handleBuild}
								>
									Build graph
								</Button>
								<Button
									variant="default"
									size="md"
									icon={<FolderInput size={15} />}
									onClick={() => setIsImportDialogOpen(true)}
								>
									Import Understand folder
								</Button>
							</div>

							<p className="text-[11px] text-text-tertiary mt-2">
								Sharing .ua between sibling worktrees or checkouts avoids re-analyzing the repository.
							</p>
						</>
					)}
				</div>
			);
		}

		const iframeSrc = `${dashboardUrl}${dashboardUrl.includes("?") ? "&" : "?"}theme=${themeParam}&preset=${presetParam}`;
		return (
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
			{bottomRunLog}

			{projectPath ? (
				<ImportUnderstandDialog
					open={isImportDialogOpen}
					onOpenChange={setIsImportDialogOpen}
					workspaceId={workspaceId}
					currentTargetProjectPath={projectPath}
					onImportSuccess={() => setReloadToken((token) => token + 1)}
				/>
			) : null}
		</div>
	);
}
