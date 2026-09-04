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
	RuntimeAgentProgressLine,
	RuntimeManagerAccount,
	RuntimeReviewGraphRebuildRequest,
} from "@/runtime/types";
import { GraphBuildLog } from "./graph-build-log";
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

/**
 * Kept in step with `REBUILD_PROGRESS_LINE_LIMIT` in the runtime service, which
 * bounds the same list server-side for replay. Not imported: the frontend shares
 * only *types* with the contract, so a value would have to cross that boundary.
 */
const PROGRESS_LINE_LIMIT = 500;

/** What the runtime reports about the job this stream just joined. */
interface AttachedJobInfo {
	attached: boolean;
	status: RebuildStatusState;
	startedAt: number | null;
	pausedAt: number | null;
}

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
	/** The run's real work, read out of agy's transcript by the runtime. */
	const [progress, setProgress] = useState<RuntimeAgentProgressLine[]>([]);
	/**
	 * The Antigravity account the build actually authenticated as. Worth showing
	 * because it is not necessarily the seat picked below: those credentials are
	 * machine-wide in `~/.gemini`, so the pin only ever refuses a run — which is
	 * why a build can complete while the pinned seat's usage never moves.
	 */
	const [accountEmail, setAccountEmail] = useState<string | null>(null);
	const [attachedJob, setAttachedJob] = useState<AttachedJobInfo | null>(null);

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
		} else if (key === "progress_line" && value && typeof value === "object") {
			const line = value as RuntimeAgentProgressLine;
			if (typeof line.line === "string" && typeof line.kind === "string") {
				setProgress((prev) => {
					const next = [...prev, line];
					return next.length > PROGRESS_LINE_LIMIT ? next.slice(next.length - PROGRESS_LINE_LIMIT) : next;
				});
			}
		} else if (key === "agent_account" && typeof value === "string") {
			setAccountEmail(value);
		} else if (key === "rebuild_attached" && value && typeof value === "object") {
			const info = value as AttachedJobInfo;
			setAttachedJob(info);
			// The joined job's status wins over the optimistic "running" a click sets:
			// a build paused before this tab existed must not read as in-flight.
			if (info.attached) {
				setRebuildStatusState(info.status);
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
					// Seeded before the stream opens so the panel is never blank while
					// re-attaching; the stream's own replay then supersedes it.
					setProgress(res.progress.slice(-PROGRESS_LINE_LIMIT));
					setAccountEmail(res.accountEmail);
					setAttachedJob({
						attached: true,
						status: res.status,
						startedAt: res.startedAt,
						pausedAt: res.pausedAt,
					});
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

	const antigravitySeat = managerAccounts.find(
		(account) => account.provider === "antigravity" && account.isActive !== false,
	);

	const startBuild = useCallback(
		(options?: { force?: boolean }) => {
			if (projectPath === null) {
				return;
			}
			setIsLogDismissed(false);
			setCurrentStep(null);
			setProgress([]);
			setAttachedJob(null);
			setRebuildStatusState("running");
			void rebuild.run({
				projectPath,
				model: UNDERSTAND_REBUILD_MODEL,
				effort: UNDERSTAND_REBUILD_EFFORT,
				...(antigravitySeat === undefined ? {} : { managerAccountId: antigravitySeat.id }),
				...(options?.force === true ? { force: true } : {}),
			});
		},
		[antigravitySeat, projectPath, rebuild],
	);

	const handleBuild = useCallback(() => {
		if (isBuilding) {
			return;
		}
		startBuild();
	}, [isBuilding, startBuild]);

	/**
	 * Abandons the job that owns this project and starts a new one.
	 *
	 * The escape hatch for a build that cannot finish and cannot be resumed —
	 * a process that was suspended and then died, say. Without it, the runtime
	 * keys jobs by project path and every click attaches to the wedged one, which
	 * is indistinguishable from the button doing nothing at all.
	 */
	const handleForceRestart = useCallback(() => {
		startBuild({ force: true });
	}, [startBuild]);

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

	/**
	 * Names the account the run is really billed against.
	 *
	 * The seat picked above is honoured only for its refusals — `agy` reads its
	 * credential from the machine-wide keyring, whichever seat Manager last made
	 * active — so a mismatch here is the answer to "the build ran but my seat
	 * shows no usage".
	 */
	const billedAccountNote =
		accountEmail === null ? null : (
			<span className="text-[11px] text-text-tertiary">
				Billed to <span className="font-mono text-text-secondary">{accountEmail}</span>
				{antigravitySeat && antigravitySeat.email.toLowerCase() !== accountEmail.toLowerCase()
					? ` — not the pinned seat (${antigravitySeat.email}); Antigravity credentials are machine-wide`
					: ""}
			</span>
		);

	const formatClockTime = (timestamp: number | null): string =>
		timestamp === null ? "an unknown time" : new Date(timestamp).toLocaleTimeString();

	/**
	 * Shown when this stream joined a job it did not start. Previously
	 * indistinguishable from a fresh build, which is how a suspended job could own
	 * a project invisibly.
	 */
	const attachedJobBanner =
		attachedJob?.attached !== true ? null : (
			<div className="flex w-full max-w-2xl flex-col gap-1.5 rounded-md border border-status-orange/40 bg-status-orange/10 px-3 py-2 text-left">
				<span className="text-[11px] text-text-secondary">
					{attachedJob.status === "paused"
						? `Joined a build that has been paused since ${formatClockTime(attachedJob.pausedAt ?? attachedJob.startedAt)}.`
						: `Joined a build already running since ${formatClockTime(attachedJob.startedAt)}.`}
				</span>
				<div className="flex items-center gap-2">
					{attachedJob.status === "paused" ? (
						<Button
							variant="default"
							size="sm"
							icon={isActionPending ? <Spinner size={12} /> : <Play size={13} />}
							disabled={isActionPending}
							onClick={handleResume}
						>
							Resume it
						</Button>
					) : null}
					<Button
						variant="ghost"
						size="sm"
						icon={<Hammer size={12} />}
						disabled={isActionPending}
						onClick={handleForceRestart}
					>
						Start a new build
					</Button>
				</div>
			</div>
		);

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
				{billedAccountNote}

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

			{attachedJobBanner}

			{/* Stream logs box in center */}
			<div className="w-full max-w-2xl flex flex-col gap-1 rounded-md border border-border bg-surface-1 p-2 text-left">
				<div className="flex items-center justify-between text-[11px] text-text-secondary px-1">
					<span className="font-medium text-text-tertiary">Live build logs</span>
					<span className="font-mono text-[10px] text-text-tertiary">
						{isPaused ? "PAUSED" : "RUNNING"}
					</span>
				</div>
				<GraphBuildLog
					className="h-44 overflow-y-auto rounded border border-border bg-surface-0 px-2.5 py-1.5 font-mono text-[11px] text-text-secondary"
					progress={progress}
					errors={rebuild.log}
					summary={rebuild.text}
					currentStep={currentStep}
					isPaused={isPaused}
					pendingLabel="Starting analysis pipeline…"
				/>
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
					{billedAccountNote}
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
				<GraphBuildLog
					className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border bg-surface-0 px-2 py-1 font-mono text-[11px] text-text-secondary"
					progress={progress}
					errors={rebuild.log}
					summary={rebuild.text}
					currentStep={null}
					isPaused={isPaused}
					pendingLabel="No output was captured for this run."
				/>
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
