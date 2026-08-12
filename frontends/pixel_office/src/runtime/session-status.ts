// Pure predicates for paused-task session state. Single source of truth for
// "is this paused-offline" / "is this paused-but-still-live" checks across the
// app — components should import from here instead of re-deriving pausedAt/pid
// logic ad hoc. Keep this file free of React imports; it's shared by hooks,
// board reconciliation, and detail-view components alike.
import type { RuntimeTaskSessionSummary } from "@/runtime/types";

type PausedSessionFields = Pick<RuntimeTaskSessionSummary, "pausedAt" | "pid" | "agentId">;

/**
 * A manual/force pause whose PTY process has already exited (or was never
 * relaunched) — the terminal has nothing live to reattach to, only a replay
 * of the last captured scrollback (see `persistent-terminal-manager.ts`).
 *
 * Cline sessions have no PTY/`pid` at all — they're SDK-managed, not an OS
 * process — so a paused Cline task is always resumable in place, never "offline".
 */
export function isSessionPausedOffline(summary: PausedSessionFields): boolean {
	if (summary.agentId === "cline") {
		return false;
	}
	return summary.pausedAt != null && summary.pid == null;
}

/**
 * A manual/force pause whose PTY process is still alive — the complement of
 * `isSessionPausedOffline`. Reattaching resumes the same live process.
 */
export function isSessionPausedLive(summary: PausedSessionFields): boolean {
	if (summary.agentId === "cline") {
		return summary.pausedAt != null;
	}
	return summary.pausedAt != null && summary.pid != null;
}

/** Board-card badge copy for a paused session whose process has already ended. */
export function pausedOfflineBadgeLabel(): string {
	return "Paused — session ended";
}
