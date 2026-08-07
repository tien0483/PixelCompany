import type { RuntimeTaskSessionSummary } from "../core/api-contract";

export interface TerminalSessionListener {
	onOutput?: (chunk: Buffer) => void;
	onState?: (summary: RuntimeTaskSessionSummary) => void;
	onExit?: (code: number | null) => void;
}

/**
 * Result of a restore lookup: either the live in-RAM terminal mirror (`stale: false`,
 * `capturedAt: null` since "now" needs no timestamp), a memoized disk snapshot loaded
 * once the mirror is gone (`stale: true`, `capturedAt` from when it was captured), or
 * `null` when neither is available.
 */
export interface TerminalRestoreResult {
	snapshot: string;
	cols: number | null;
	rows: number | null;
	stale: boolean;
	capturedAt: number | null;
}

export interface TerminalSessionService {
	attach(taskId: string, listener: TerminalSessionListener): (() => void) | null;
	getRestoreSnapshot(taskId: string): Promise<TerminalRestoreResult | null>;
	recoverStaleSession(taskId: string): RuntimeTaskSessionSummary | null;
	writeInput(taskId: string, data: Buffer): RuntimeTaskSessionSummary | null;
	resize(taskId: string, cols: number, rows: number, pixelWidth?: number, pixelHeight?: number): boolean;
	pauseOutput(taskId: string): boolean;
	resumeOutput(taskId: string): boolean;
	stopTaskSession(taskId: string): Promise<RuntimeTaskSessionSummary | null>;
}
