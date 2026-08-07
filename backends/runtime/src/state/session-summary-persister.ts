import type { RuntimeTaskSessionSummary } from "../core/api-contract";
import { saveWorkspaceSessionSummaries } from "./workspace-state";

const DEFAULT_DEBOUNCE_MS = 400;

/**
 * Fingerprint covering exactly the durable fields of a session summary — the ones
 * that represent a real state change worth persisting to disk. Deliberately excludes
 * `updatedAt`, `lastOutputAt`, `lastHookAt`, `latestHookActivity`, and `warningMessage`:
 * those tick on effectively every PTY chunk / hook event, and persisting on every
 * change to them would turn this into a write-on-every-keystroke churn machine.
 */
export function durableSummaryFingerprint(summary: RuntimeTaskSessionSummary): string {
	return JSON.stringify([
		summary.state,
		summary.pausedAt,
		summary.pauseReason,
		summary.reviewReason,
		summary.agentId,
		summary.workspacePath,
		summary.pid,
		summary.startedAt,
		summary.activeRunMs,
		summary.runningSince,
		summary.managerAccountId ?? null,
		summary.resumeAt ?? null,
		summary.autoResumeOnUsageLimit ?? null,
		summary.exitCode,
		summary.latestTurnCheckpoint?.commit ?? null,
	]);
}

export type WriteSessionSummaries = (
	workspaceId: string,
	summaries: readonly RuntimeTaskSessionSummary[],
) => Promise<void>;

export interface SessionSummaryPersisterOptions {
	workspaceId: string;
	/** Injectable for tests; defaults to the real `saveWorkspaceSessionSummaries`. */
	writeSummaries?: WriteSessionSummaries;
	/** Trailing debounce window in ms. Defaults to ~400ms. */
	debounceMs?: number;
}

export interface SessionSummaryPersister {
	/** Call on every summary change. Schedules a debounced write iff the durable fingerprint changed. */
	handleSummary(summary: RuntimeTaskSessionSummary): void;
	/** Resolves once any pending/in-flight write has completed. Does not itself force a write if nothing changed. */
	flush(): Promise<void>;
	/** Clears timers. Does not flush — callers wanting durability should `flush()` first. */
	dispose(): void;
}

/**
 * Standalone, debounced, serialized writer for `RuntimeTaskSessionSummary` changes.
 *
 * This unit does NOT subscribe to any real event source itself — callers push updates
 * in by calling `handleSummary` (wiring that up to the actual session-manager event
 * stream is a later task). It exists purely to (a) filter out fingerprint-irrelevant
 * churn like `lastOutputAt`, (b) coalesce bursts of changes into one disk write per
 * debounce window, and (c) guarantee writes for a given persister never race each other.
 */
export function createSessionSummaryPersister(options: SessionSummaryPersisterOptions): SessionSummaryPersister {
	const { workspaceId, debounceMs = DEFAULT_DEBOUNCE_MS } = options;
	const writeSummaries = options.writeSummaries ?? saveWorkspaceSessionSummaries;

	const lastFingerprintByTaskId = new Map<string, string>();
	const pendingByTaskId = new Map<string, RuntimeTaskSessionSummary>();

	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	let writeInFlight: Promise<void> | null = null;
	let disposed = false;

	function clearDebounceTimer(): void {
		if (debounceTimer !== null) {
			clearTimeout(debounceTimer);
			debounceTimer = null;
		}
	}

	// Starts (at most) one write for whatever is currently pending, and returns the
	// promise for it. If a write is already in flight, returns that same promise
	// instead of starting a second, overlapping one — this is what guarantees writes
	// are serialized.
	function startWriteIfNeeded(): Promise<void> {
		if (writeInFlight) {
			return writeInFlight;
		}
		if (pendingByTaskId.size === 0) {
			return Promise.resolve();
		}

		const batch = Array.from(pendingByTaskId.values());
		pendingByTaskId.clear();

		writeInFlight = (async () => {
			try {
				await writeSummaries(workspaceId, batch);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.warn(`Could not persist session summaries for workspace ${workspaceId}. ${message}`);
			} finally {
				writeInFlight = null;
				// Anything that arrived while this write was in flight queues for the
				// next debounce cycle rather than being written immediately.
				if (pendingByTaskId.size > 0 && !disposed) {
					scheduleDebouncedWrite();
				}
			}
		})();

		return writeInFlight;
	}

	function scheduleDebouncedWrite(): void {
		if (disposed) {
			return;
		}
		clearDebounceTimer();
		debounceTimer = setTimeout(() => {
			debounceTimer = null;
			void startWriteIfNeeded();
		}, debounceMs);
	}

	return {
		handleSummary(summary: RuntimeTaskSessionSummary): void {
			if (disposed) {
				return;
			}
			const fingerprint = durableSummaryFingerprint(summary);
			if (lastFingerprintByTaskId.get(summary.taskId) === fingerprint) {
				return;
			}
			lastFingerprintByTaskId.set(summary.taskId, fingerprint);
			pendingByTaskId.set(summary.taskId, summary);
			scheduleDebouncedWrite();
		},

		async flush(): Promise<void> {
			// Loop until there is nothing pending and nothing in flight. Re-checked
			// each iteration because completing a write can re-arm the debounce timer
			// (leftover pending items queued while the write was running).
			for (;;) {
				clearDebounceTimer();
				if (writeInFlight) {
					await writeInFlight;
					continue;
				}
				if (pendingByTaskId.size === 0) {
					return;
				}
				await startWriteIfNeeded();
			}
		},

		dispose(): void {
			disposed = true;
			clearDebounceTimer();
		},
	};
}
