import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

import { lockedFileSystem } from "../fs/locked-file-system";
import { getWorkspaceDirectoryPath } from "../state/workspace-state";

const TERMINAL_SNAPSHOTS_DIR_NAME = "terminal-snapshots";
const SNAPSHOT_RECORD_VERSION = 1;

/**
 * Hard cap on the `snapshot` string persisted to disk, in UTF-8 bytes.
 *
 * Size-cap contract: `save()` is the sole enforcement point. If the caller's
 * `snapshot` exceeds this cap, the store does NOT slice the string to fit —
 * xterm serialization is a stream of escape sequences, and truncating it
 * blindly at a byte boundary can cut a sequence in half and produce garbage
 * (or an inconsistent replay) on the next load. Only a re-serialization at a
 * smaller scrollback window (which `TerminalStateMirror.getSnapshot` now
 * supports via `maxScrollbackLines`) can safely shrink it, and that requires
 * a live terminal buffer this store doesn't have.
 *
 * So instead, an oversized snapshot is replaced on write with an explicit
 * empty/truncated marker (`{ snapshot: "", truncated: true }`), never with a
 * mangled partial string. Callers that want a smaller-but-intact snapshot
 * (e.g. the session manager's progressive 2000 -> 500 line retry) must
 * produce one and pass it in before hitting this backstop; this cap exists
 * so a bad caller (or a pathological terminal buffer) can never write an
 * unbounded file to disk.
 */
export const MAX_SNAPSHOT_BYTES = 512_000;

export interface TerminalSnapshotRecord {
	version: 1;
	taskId: string;
	capturedAt: number;
	cols: number;
	rows: number;
	snapshot: string;
	truncated: boolean;
}

const terminalSnapshotRecordSchema = z.object({
	version: z.literal(SNAPSHOT_RECORD_VERSION),
	taskId: z.string().min(1),
	capturedAt: z.number(),
	cols: z.number().int().positive(),
	rows: z.number().int().positive(),
	snapshot: z.string(),
	truncated: z.boolean(),
});

export interface TerminalSnapshotStore {
	/**
	 * Loads the persisted snapshot for `taskId`. Never throws: a missing
	 * file, malformed JSON, or a payload that fails schema validation all
	 * resolve to `null` so a corrupt snapshot file can never break boot.
	 */
	load(taskId: string): Promise<TerminalSnapshotRecord | null>;
	/**
	 * Persists `record` atomically. If `record.snapshot` exceeds
	 * {@link MAX_SNAPSHOT_BYTES}, the snapshot body is dropped and the
	 * written record is marked `truncated: true` instead (see the size-cap
	 * contract documented on {@link MAX_SNAPSHOT_BYTES}).
	 */
	save(record: TerminalSnapshotRecord): Promise<void>;
	/** Deletes the persisted snapshot for `taskId`, if any. No-op if absent. */
	delete(taskId: string): Promise<void>;
}

function getSnapshotDirectoryPath(workspaceId: string): string {
	return join(getWorkspaceDirectoryPath(workspaceId), TERMINAL_SNAPSHOTS_DIR_NAME);
}

function getSnapshotFilePath(workspaceId: string, taskId: string): string {
	return join(getSnapshotDirectoryPath(workspaceId), `${taskId}.json`);
}

function enforceSizeCap(record: TerminalSnapshotRecord): TerminalSnapshotRecord {
	if (Buffer.byteLength(record.snapshot, "utf8") <= MAX_SNAPSHOT_BYTES) {
		return record;
	}
	return {
		...record,
		snapshot: "",
		truncated: true,
	};
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
	return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code;
}

async function readFileOrNull(path: string): Promise<string | null> {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		if (isNodeErrorWithCode(error, "ENOENT")) {
			return null;
		}
		throw error;
	}
}

/**
 * Creates a file-per-task snapshot store for a workspace, rooted at
 * `~/.agent/kanban/workspaces/<workspaceId>/terminal-snapshots/<taskId>.json`.
 *
 * One file per task (rather than one shared file for the whole workspace) so
 * a write for one task never rewrites or lock-contends with every other
 * task's snapshot.
 */
export function createTerminalSnapshotStore(workspaceId: string): TerminalSnapshotStore {
	return {
		async load(taskId: string): Promise<TerminalSnapshotRecord | null> {
			// No lock on read: writes are atomic (temp file + rename), so a read
			// either sees the previous complete file or the new one, never a
			// partial write. This mirrors readWorkspaceSessions/readWorkspaceBoard
			// in state/workspace-state.ts, which also read unlocked.
			const path = getSnapshotFilePath(workspaceId, taskId);
			try {
				const raw = await readFileOrNull(path);
				if (raw === null) {
					return null;
				}
				const parsedJson: unknown = JSON.parse(raw);
				const parsed = terminalSnapshotRecordSchema.safeParse(parsedJson);
				if (!parsed.success || parsed.data.taskId !== taskId) {
					return null;
				}
				return parsed.data;
			} catch {
				// Corrupt-safe: any read/parse failure yields "no snapshot" rather
				// than breaking boot.
				return null;
			}
		},

		async save(record: TerminalSnapshotRecord): Promise<void> {
			const path = getSnapshotFilePath(workspaceId, record.taskId);
			const safeRecord = enforceSizeCap(record);
			await lockedFileSystem.writeJsonFileAtomic(path, safeRecord);
		},

		async delete(taskId: string): Promise<void> {
			const path = getSnapshotFilePath(workspaceId, taskId);
			await lockedFileSystem.withLock({ path, type: "file" }, async () => {
				await rm(path, { force: true });
			});
		},
	};
}
