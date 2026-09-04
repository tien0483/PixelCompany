/**
 * Background service for knowledge graph builds and rebuilds.
 *
 * Runs the rebuild process decoupled from individual HTTP requests so that
 * a repository analysis (which can take minutes to hours) continues running
 * in the background even if the user closes or refreshes the browser.
 *
 * Also provides:
 * - Event replay for newly connected or reconnecting clients.
 * - Real-time process control: pause (SIGSTOP) and resume (SIGCONT), plus cancel.
 * - Importing / copying existing .ua graph data from a sibling project.
 * - Checking graph availability across multiple projects.
 */
import { cp, mkdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";

import type { AgyProgressLine } from "../terminal/agy-brain-transcript";
import type { AgentOneShotControl, AgentOneShotEvent, RunAgentOneShotInput } from "../terminal/agent-oneshot";
import { runAgentOneShot } from "../terminal/agent-oneshot";
import {
	KNOWLEDGE_GRAPH_FILE_NAME,
	clearReviewGraphCache,
	resolveReviewGraphLocation,
} from "./review-graph";
import {
	GRAPH_REBUILD_IDLE_TIMEOUT_MS,
	GRAPH_REBUILD_TIMEOUT_MS,
	prepareGraphRebuildLogFile,
	resolveGraphRebuildPrompt,
} from "./review-graph-rebuild";

export type RebuildStatus = "idle" | "running" | "paused" | "done" | "error";

/**
 * How many progress lines a job keeps for replay.
 *
 * Bounded because closing the browser mid-run is a supported path — the job
 * survives, and a reconnecting client replays from here — and a three-hour
 * analysis emits far more lines than anyone scrolls back through.
 */
export const REBUILD_PROGRESS_LINE_LIMIT = 500;

export interface RebuildJob {
	projectPath: string;
	status: RebuildStatus;
	startedAt: number;
	pausedAt: number | null;
	doneAt: number | null;
	error: string | null;
	currentStep: string | null;
	text: string;
	log: string[];
	notices: string[];
	progress: AgyProgressLine[];
	/**
	 * The Antigravity account `agy` authenticated as, once it says so in its log.
	 * Not necessarily the pinned seat — see `manager-account-pin.ts`, which
	 * returns no environment for `gemini` because those credentials are
	 * machine-wide.
	 */
	accountEmail: string | null;
	subscribers: Set<(event: string, data: unknown) => void>;
	abortController: AbortController;
	control: AgentOneShotControl | null;
	childPid: number | null;
}

export interface StartRebuildInput {
	projectPath: string;
	model?: string;
	effort?: "low" | "medium" | "high";
	managerAccountId?: number;
	buildPinInput?: (managerAccountId?: number) => RunAgentOneShotInput["pinInput"];
	/**
	 * Abandons an existing running or paused job for this project and starts a new
	 * one. The escape hatch for a job that cannot finish and cannot be resumed —
	 * without it, a wedged job owns its project until the 3-hour hard timeout and
	 * every click silently attaches to it.
	 */
	force?: boolean;
}

export interface StartOrAttachResult {
	job: RebuildJob;
	/** False when this call started the job, true when it joined one already running. */
	attached: boolean;
}

class ReviewGraphRebuildService {
	private jobs = new Map<string, RebuildJob>();

	/**
	 * Returns an existing running or paused job for this project, or creates and
	 * starts a new background job.
	 */
	startOrAttachJob(input: StartRebuildInput): StartOrAttachResult {
		const existing = this.jobs.get(input.projectPath);
		if (existing && (existing.status === "running" || existing.status === "paused")) {
			if (input.force) {
				this.cancelJob(input.projectPath);
				this.jobs.delete(input.projectPath);
			} else if (this.isJobChildGone(existing)) {
				// The child is gone but the job still claims the project. Nothing can
				// resume it, and leaving it in the map means every later request
				// attaches to a build that will never emit another event.
				this.failJob(existing, "The rebuild process is no longer running.");
				this.jobs.delete(input.projectPath);
			} else {
				return { job: existing, attached: true };
			}
		}

		const abortController = new AbortController();
		const job: RebuildJob = {
			projectPath: input.projectPath,
			status: "running",
			startedAt: Date.now(),
			pausedAt: null,
			doneAt: null,
			error: null,
			currentStep: null,
			text: "",
			log: [],
			notices: [],
			progress: [],
			accountEmail: null,
			subscribers: new Set(),
			abortController,
			control: null,
			childPid: null,
		};
		this.jobs.set(input.projectPath, job);

		// Execute in background
		void this.executeJob(job, input);

		return { job, attached: false };
	}

	/**
	 * True when the job has a pid that no longer exists. Signal 0 checks for the
	 * process without touching it; `EPERM` means it is alive but not ours, which
	 * still counts as alive.
	 */
	private isJobChildGone(job: RebuildJob): boolean {
		if (job.childPid === null) {
			return false;
		}
		try {
			process.kill(job.childPid, 0);
			return false;
		} catch (error) {
			return (error as NodeJS.ErrnoException).code === "ESRCH";
		}
	}

	private failJob(job: RebuildJob, message: string): void {
		job.abortController.abort();
		job.status = "error";
		job.error = message;
		job.doneAt = Date.now();
		this.broadcast(job, "error", { type: "error", message });
		this.broadcast(job, "done", { type: "done", code: 1 });
		this.broadcast(job, "status", { type: "status", status: "error" });
	}

	private recordProgress(job: RebuildJob, progress: AgyProgressLine): void {
		job.progress.push(progress);
		if (job.progress.length > REBUILD_PROGRESS_LINE_LIMIT) {
			job.progress.splice(0, job.progress.length - REBUILD_PROGRESS_LINE_LIMIT);
		}
	}

	private broadcast(job: RebuildJob, event: string, data: unknown): void {
		for (const subscriber of job.subscribers) {
			try {
				subscriber(event, data);
			} catch {
				// Subscriber error (e.g. disconnected socket)
			}
		}
	}

	private async executeJob(job: RebuildJob, input: StartRebuildInput): Promise<void> {
		this.broadcast(job, "start", { type: "start", agent: "gemini", model: input.model });

		const resolved = await resolveGraphRebuildPrompt({ projectPath: input.projectPath });
		if (!resolved.ok) {
			job.status = "error";
			job.error = resolved.error;
			job.doneAt = Date.now();
			this.broadcast(job, "error", { type: "error", message: resolved.error });
			this.broadcast(job, "done", { type: "done", code: 1 });
			return;
		}

		// Opting into observability: this is what lets the run report the commands
		// it is running and the errors agy would otherwise only write to its own
		// log. A failure to prepare it is not a reason to refuse the build.
		const logFilePath = await prepareGraphRebuildLogFile(input.projectPath);

		try {
			await runAgentOneShot({
				agentId: "gemini",
				prompt: resolved.prompt,
				cwd: input.projectPath,
				model: input.model,
				allowedTools: [],
				...(input.effort === undefined ? {} : { effort: input.effort }),
				...(logFilePath === null ? {} : { logFilePath }),
				skipPermissions: true,
				idleTimeoutMs: GRAPH_REBUILD_IDLE_TIMEOUT_MS,
				timeoutMs: GRAPH_REBUILD_TIMEOUT_MS,
				signal: job.abortController.signal,
				onSpawn: (_child, control) => {
					job.control = control;
					job.childPid = _child.pid ?? null;
				},
				onEvent: (event: AgentOneShotEvent) => {
					if (event.type === "delta") {
						job.text += event.text;
						this.broadcast(job, "delta", event);
					} else if (event.type === "html") {
						job.text = event.text;
						this.broadcast(job, "html", event);
					} else if (event.type === "stderr") {
						job.log.push(event.text);
						this.broadcast(job, "stderr", event);
					} else if (event.type === "meta") {
						if (event.key === "step" && event.value && typeof event.value === "object") {
							const step = event.value as { stepType?: unknown; state?: unknown };
							if (typeof step.stepType === "string") {
								job.currentStep =
									typeof step.state === "string" ? `${step.stepType} (${step.state})` : step.stepType;
							}
						} else if (event.key === "pin_warning" && typeof event.value === "string") {
							if (!job.notices.includes(event.value)) {
								job.notices.push(event.value);
							}
						} else if (event.key === "progress_line" && event.value && typeof event.value === "object") {
							this.recordProgress(job, event.value as AgyProgressLine);
						} else if (event.key === "agent_account" && typeof event.value === "string") {
							job.accountEmail = event.value;
						}
						this.broadcast(job, "meta", event);
					} else if (event.type === "error") {
						job.error = event.message;
						job.log.push(event.message);
						this.broadcast(job, "error", event);
					} else if (event.type === "done") {
						// Finalize in the outer block
					} else {
						this.broadcast(job, event.type, event);
					}
				},
				...(input.buildPinInput ? { pinInput: input.buildPinInput(input.managerAccountId) } : {}),
			});

			clearReviewGraphCache();

			if (job.status !== "error") {
				job.status = job.error ? "error" : "done";
			}
			job.doneAt = Date.now();
			this.broadcast(job, "status", { type: "status", status: job.status });
			this.broadcast(job, "done", { type: "done", code: job.error ? 1 : 0 });
		} catch (error) {
			job.status = "error";
			const message = error instanceof Error ? error.message : String(error);
			job.error = message;
			job.doneAt = Date.now();
			this.broadcast(job, "error", { type: "error", message });
			this.broadcast(job, "done", { type: "done", code: 1 });
		}
	}

	/**
	 * Subscribes an SSE or live callback to a job's events.
	 * Immediately replays the current state and buffered history.
	 * Returns an unsubscribe function.
	 */
	subscribe(projectPath: string, listener: (event: string, data: unknown) => void): () => void {
		const job = this.jobs.get(projectPath);
		if (!job) {
			return () => {};
		}

		// Replay initial snapshot
		listener("start", { type: "start", agent: "gemini" });
		listener("status", { type: "status", status: job.status });
		listener("meta", { type: "meta", key: "rebuild_status", value: job.status });
		if (job.currentStep) {
			listener("meta", {
				type: "meta",
				key: "step",
				value: { stepType: job.currentStep, state: job.status === "paused" ? "PAUSED" : "RUNNING" },
			});
		}
		if (job.accountEmail) {
			listener("meta", { type: "meta", key: "agent_account", value: job.accountEmail });
		}
		// Before the text, because these are what happened *during* the run and the
		// accumulated text is the agent's closing summary.
		for (const progress of job.progress) {
			listener("meta", { type: "meta", key: "progress_line", value: progress });
		}
		if (job.text.length > 0) {
			listener("delta", { type: "delta", text: job.text });
		}
		for (const line of job.log) {
			listener("stderr", { type: "stderr", text: line });
		}
		for (const notice of job.notices) {
			listener("meta", { type: "meta", key: "pin_warning", value: notice });
		}
		if (job.status === "done") {
			listener("done", { type: "done", code: 0 });
		} else if (job.status === "error") {
			listener("error", { type: "error", message: job.error ?? "Build failed" });
			listener("done", { type: "done", code: 1 });
		}

		job.subscribers.add(listener);
		return () => {
			job.subscribers.delete(listener);
		};
	}

	pauseJob(projectPath: string): { ok: boolean; error?: string } {
		const job = this.jobs.get(projectPath);
		if (!job) {
			return { ok: false, error: "No rebuild job found for this project." };
		}
		if (job.status !== "running") {
			return { ok: false, error: `Job is not running (currently ${job.status}).` };
		}
		if (job.control) {
			const paused = job.control.pause();
			if (!paused) {
				return { ok: false, error: "Failed to pause process." };
			}
		}
		job.status = "paused";
		job.pausedAt = Date.now();
		this.broadcast(job, "status", { type: "status", status: "paused" });
		this.broadcast(job, "meta", { type: "meta", key: "rebuild_status", value: "paused" });
		if (job.currentStep) {
			this.broadcast(job, "meta", {
				type: "meta",
				key: "step",
				value: { stepType: job.currentStep, state: "PAUSED" },
			});
		}
		return { ok: true };
	}

	resumeJob(projectPath: string): { ok: boolean; error?: string } {
		const job = this.jobs.get(projectPath);
		if (!job) {
			return { ok: false, error: "No rebuild job found for this project." };
		}
		if (job.status !== "paused") {
			return { ok: false, error: `Job is not paused (currently ${job.status}).` };
		}
		if (this.isJobChildGone(job)) {
			// SIGCONT to a pid that no longer exists cannot be recovered from, and
			// reporting "failed to resume" invites the user to try again forever.
			this.failJob(job, "The rebuild process is no longer running. Start a new build.");
			this.jobs.delete(projectPath);
			return { ok: false, error: "The rebuild process is no longer running. Start a new build." };
		}
		if (job.control) {
			const resumed = job.control.resume();
			if (!resumed) {
				return { ok: false, error: "Failed to resume process." };
			}
		}
		job.status = "running";
		job.pausedAt = null;
		this.broadcast(job, "status", { type: "status", status: "running" });
		this.broadcast(job, "meta", { type: "meta", key: "rebuild_status", value: "running" });
		if (job.currentStep) {
			this.broadcast(job, "meta", {
				type: "meta",
				key: "step",
				value: { stepType: job.currentStep, state: "RUNNING" },
			});
		}
		return { ok: true };
	}

	cancelJob(projectPath: string): { ok: boolean; error?: string } {
		const job = this.jobs.get(projectPath);
		if (!job) {
			return { ok: false, error: "No rebuild job found for this project." };
		}
		if (job.status === "done" || job.status === "error") {
			return { ok: true };
		}
		job.abortController.abort();
		job.status = "error";
		job.error = "Build cancelled by user.";
		job.doneAt = Date.now();
		this.broadcast(job, "error", { type: "error", message: "Build cancelled by user." });
		this.broadcast(job, "done", { type: "done", code: 1 });
		this.broadcast(job, "status", { type: "status", status: "error" });
		return { ok: true };
	}

	getJobStatus(projectPath: string): {
		ok: boolean;
		status: RebuildStatus;
		startedAt: number | null;
		pausedAt: number | null;
		doneAt: number | null;
		error: string | null;
		currentStep: string | null;
		text: string;
		log: string[];
		notices: string[];
		progress: AgyProgressLine[];
		accountEmail: string | null;
	} {
		const job = this.jobs.get(projectPath);
		if (!job) {
			return {
				ok: true,
				status: "idle",
				startedAt: null,
				pausedAt: null,
				doneAt: null,
				error: null,
				currentStep: null,
				text: "",
				log: [],
				notices: [],
				progress: [],
				accountEmail: null,
			};
		}
		// Reported before the status is read, so a card whose process died while the
		// tab was closed does not come back as a live build nobody can stop.
		if ((job.status === "running" || job.status === "paused") && this.isJobChildGone(job)) {
			this.failJob(job, "The rebuild process is no longer running.");
		}
		return {
			ok: true,
			status: job.status,
			startedAt: job.startedAt,
			pausedAt: job.pausedAt,
			doneAt: job.doneAt,
			error: job.error,
			currentStep: job.currentStep,
			text: job.text,
			log: [...job.log],
			notices: [...job.notices],
			progress: [...job.progress],
			accountEmail: job.accountEmail,
		};
	}

	/** Test seam. */
	clearJobs(): void {
		for (const job of this.jobs.values()) {
			job.abortController.abort();
		}
		this.jobs.clear();
	}
}

export const reviewGraphRebuildService = new ReviewGraphRebuildService();

/**
 * Copies the `.ua` (or legacy `.understand-anything`) folder from `sourcePath`
 * into `targetPath/.ua`.
 */
export async function copyUnderstandFolder(input: {
	sourcePath: string;
	targetPath: string;
}): Promise<{ ok: boolean; targetDataDir?: string; error?: string }> {
	const sourcePath = input.sourcePath.trim();
	const targetPath = input.targetPath.trim();

	if (!sourcePath || !targetPath) {
		return { ok: false, error: "Both sourcePath and targetPath are required." };
	}
	if (sourcePath === targetPath) {
		return { ok: false, error: "Source and target project paths cannot be identical." };
	}

	let sourceDataDir: string | null = null;
	// Check if sourcePath has a graph location
	const location = await resolveReviewGraphLocation(sourcePath);
	if (location) {
		sourceDataDir = location.dataDir;
	} else {
		// Maybe sourcePath is already pointing directly at .ua or .understand-anything
		const base = basename(sourcePath);
		if (base === ".ua" || base === ".understand-anything") {
			try {
				const s = await stat(join(sourcePath, KNOWLEDGE_GRAPH_FILE_NAME));
				if (s.isFile()) {
					sourceDataDir = sourcePath;
				}
			} catch {
				// not a graph dir
			}
		}
	}

	if (!sourceDataDir) {
		return {
			ok: false,
			error: `No valid knowledge graph (.ua or .understand-anything with ${KNOWLEDGE_GRAPH_FILE_NAME}) found under ${sourcePath}.`,
		};
	}

	const targetDataDir = join(targetPath, ".ua");

	try {
		await mkdir(targetDataDir, { recursive: true });
		await cp(sourceDataDir, targetDataDir, { recursive: true, force: true });
		// Verify graph was copied
		const targetGraph = await stat(join(targetDataDir, KNOWLEDGE_GRAPH_FILE_NAME));
		if (!targetGraph.isFile()) {
			return { ok: false, error: "Copy completed but knowledge-graph.json was not found in destination." };
		}
		clearReviewGraphCache();
		return { ok: true, targetDataDir };
	} catch (error) {
		return {
			ok: false,
			error: `Failed to copy knowledge graph: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

/**
 * Checks which of the supplied project paths contain a valid knowledge graph.
 */
export async function checkProjectsGraphAvailability(
	projectPaths: string[],
): Promise<Record<string, boolean>> {
	const result: Record<string, boolean> = {};
	await Promise.all(
		projectPaths.map(async (projectPath) => {
			try {
				const location = await resolveReviewGraphLocation(projectPath);
				result[projectPath] = location !== null;
			} catch {
				result[projectPath] = false;
			}
		}),
	);
	return result;
}
