// Pure predicates for paused-task session state. Single source of truth for
// "is this paused-offline" / "is this paused-but-still-live" checks across the
// app — components should import from here instead of re-deriving pausedAt/pid
// logic ad hoc. Keep this file free of React imports; it's shared by hooks,
// board reconciliation, and detail-view components alike.
import type { RuntimeTaskSessionSummary } from "@/runtime/types";

type PausedSessionFields = Pick<RuntimeTaskSessionSummary, "pausedAt" | "pid">;

/**
 * A manual/force pause whose PTY process has already exited (or was never
 * relaunched) — the terminal has nothing live to reattach to, only a replay
 * of the last captured scrollback (see `persistent-terminal-manager.ts`).
 */
export function isSessionPausedOffline(summary: PausedSessionFields): boolean {
	return summary.pausedAt != null && summary.pid == null;
}

/**
 * A manual/force pause whose PTY process is still alive — the complement of
 * `isSessionPausedOffline`. Reattaching resumes the same live process.
 */
export function isSessionPausedLive(summary: PausedSessionFields): boolean {
	return summary.pausedAt != null && summary.pid != null;
}

/** Board-card badge copy for a paused session whose process has already ended. */
export function pausedOfflineBadgeLabel(): string {
	return "Paused — session ended";
}
