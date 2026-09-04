/**
 * Reads the tail of a file, and follows a file that is still being appended to.
 *
 * Both exist for the same reason: `agy` writes almost everything a human would
 * want to see about a run into files rather than onto its stdio. Its diagnostics
 * go to its own log (it redirects fd 1 and fd 2 there while still writing
 * stream-json to the parent pipe), and the commands it actually ran — with their
 * output — are only in its brain transcript. A run is therefore observable only
 * by tailing those files while it happens.
 *
 * Deliberately a poller rather than `fs.watch`. The files live under `~/.gemini`,
 * which on this machine is a WSL mount for part of its lifetime, and inotify is
 * not reliable across that boundary — a missed event would silently stop the log
 * mid-run, which is exactly the failure this replaces.
 */
import { open, stat } from "node:fs/promises";

/** How often a followed file is re-`stat`ed for new bytes. */
export const DEFAULT_FOLLOW_INTERVAL_MS = 750;

/**
 * Ceiling on how much a single poll may read. A rebuild's transcript grows by
 * whole command outputs at a time, so one tick can legitimately be large — but
 * not unbounded, or a run that dumps a 25 MB graph into a tool result would pull
 * all of it into memory in one go.
 */
const MAX_BYTES_PER_TICK = 512 * 1024;

export interface FileLineFollower {
	/** Stops polling. Safe to call more than once. */
	stop: () => void;
}

/**
 * Reads up to `maxBytes` from the end of a file. Returns null for anything that
 * is not a readable, non-empty regular file — callers treat "no tail" and "no
 * file" identically.
 */
export async function readFileTail(filePath: string, maxBytes: number): Promise<string | null> {
	try {
		const fileStat = await stat(filePath);
		if (!fileStat.isFile() || fileStat.size <= 0 || maxBytes <= 0) {
			return null;
		}
		const byteLength = Math.min(fileStat.size, maxBytes);
		const start = Math.max(0, fileStat.size - byteLength);
		let handle: Awaited<ReturnType<typeof open>> | null = null;
		try {
			handle = await open(filePath, "r");
			const buffer = Buffer.alloc(byteLength);
			const readResult = await handle.read(buffer, 0, byteLength, start);
			return buffer.subarray(0, readResult.bytesRead).toString("utf8");
		} finally {
			await handle?.close();
		}
	} catch {
		return null;
	}
}

/**
 * Calls `onLine` for every complete line appended to `filePath` from the moment
 * following starts.
 *
 * Every failure mode is silence rather than a throw, and that is the point: the
 * file may not exist yet (agy creates the brain transcript a beat after it
 * reports its conversation id), and `agent-home-cleanup.ts` purges
 * `antigravity-cli/brain` and `antigravity-cli/log` wholesale — so a long
 * rebuild can have the file it is tailing deleted underneath it. Neither is a
 * build failure, and neither may surface as one.
 */
export function followFileLines(input: {
	filePath: string;
	onLine: (line: string) => void;
	intervalMs?: number;
	/** Start from the end of an already-existing file instead of replaying it. */
	fromEnd?: boolean;
}): FileLineFollower {
	let offset = 0;
	let primed = input.fromEnd !== true;
	let partial = "";
	let reading = false;
	let stopped = false;

	const tick = async (): Promise<void> => {
		if (stopped || reading) {
			return;
		}
		reading = true;
		try {
			let size: number;
			try {
				const fileStat = await stat(input.filePath);
				if (!fileStat.isFile()) {
					return;
				}
				size = fileStat.size;
			} catch {
				// Not created yet, or purged mid-run. Keep polling; if it comes back
				// smaller the shrink branch below resets the offset.
				return;
			}

			if (!primed) {
				offset = size;
				primed = true;
				return;
			}
			if (size < offset) {
				// Truncated or replaced. Anything buffered belongs to the old file.
				offset = 0;
				partial = "";
			}
			if (size === offset) {
				return;
			}

			const byteLength = Math.min(size - offset, MAX_BYTES_PER_TICK);
			let handle: Awaited<ReturnType<typeof open>> | null = null;
			let chunk = "";
			try {
				handle = await open(input.filePath, "r");
				const buffer = Buffer.alloc(byteLength);
				const readResult = await handle.read(buffer, 0, byteLength, offset);
				chunk = buffer.subarray(0, readResult.bytesRead).toString("utf8");
				offset += readResult.bytesRead;
			} catch {
				return;
			} finally {
				await handle?.close();
			}

			const lines = `${partial}${chunk}`.split(/\r?\n/);
			// A tick almost always ends mid-line; hold the remainder for the next one.
			partial = lines.pop() ?? "";
			for (const line of lines) {
				if (stopped) {
					return;
				}
				if (line.length === 0) {
					continue;
				}
				try {
					input.onLine(line);
				} catch {
					// A consumer throwing must not stop the follower.
				}
			}
		} finally {
			reading = false;
		}
	};

	const timer = setInterval(() => {
		void tick();
	}, input.intervalMs ?? DEFAULT_FOLLOW_INTERVAL_MS);
	// Never hold the process open for a log tail.
	timer.unref?.();
	void tick();

	return {
		stop: () => {
			stopped = true;
			clearInterval(timer);
		},
	};
}
