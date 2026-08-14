import serializeAddonModule from "@xterm/addon-serialize";
import headlessTerminalModule from "@xterm/headless";

const { SerializeAddon } = serializeAddonModule as typeof import("@xterm/addon-serialize");
const { Terminal } = headlessTerminalModule as typeof import("@xterm/headless");

const TERMINAL_SCROLLBACK = 10_000;

export interface TerminalRestoreSnapshot {
	snapshot: string;
	cols: number;
	rows: number;
}

export interface TerminalSnapshotOptions {
	/** Cap on scrollback rows serialized, counted from the bottom of the buffer. Omit for the full buffer. */
	maxScrollbackLines?: number;
}

interface TerminalStateMirrorOptions {
	onInputResponse?: (data: string) => void;
}

export class TerminalStateMirror {
	private readonly terminal: InstanceType<typeof Terminal>;
	private readonly serializeAddon = new SerializeAddon();
	private operationQueue: Promise<void> = Promise.resolve();
	private disposed = false;

	constructor(cols: number, rows: number, options: TerminalStateMirrorOptions = {}) {
		this.terminal = new Terminal({
			allowProposedApi: true,
			cols,
			rows,
			scrollback: TERMINAL_SCROLLBACK,
		});
		this.terminal.loadAddon(this.serializeAddon);
		this.terminal.onData((data) => {
			options.onInputResponse?.(data);
		});
	}

	applyOutput(chunk: Buffer): void {
		if (this.disposed) {
			return;
		}
		const chunkCopy = new Uint8Array(chunk);
		this.enqueueOperation(
			() =>
				new Promise<void>((resolve) => {
					// The queue drains asynchronously, so an operation enqueued before a
					// dispose still runs after it — re-check here, not just at enqueue time.
					if (this.disposed) {
						resolve();
						return;
					}
					this.terminal.write(chunkCopy, () => {
						resolve();
					});
				}),
		);
	}

	resize(cols: number, rows: number): void {
		if (this.disposed || (cols === this.terminal.cols && rows === this.terminal.rows)) {
			return;
		}
		this.enqueueOperation(() => {
			if (this.disposed) {
				return;
			}
			this.terminal.resize(cols, rows);
		});
	}

	/**
	 * Resolves `null` once the mirror is disposed. The post-await check is the load-bearing
	 * one: this method yields on the write queue before serializing, and callers dispose the
	 * mirror on restart, so a dispose landing inside that window would otherwise resume into
	 * `SerializeAddon.serialize()` against a dead terminal — xterm's `get buffer()` then
	 * registers a disposable on an already-disposed store, logging a leak warning.
	 */
	async getSnapshot(options: TerminalSnapshotOptions = {}): Promise<TerminalRestoreSnapshot | null> {
		await this.operationQueue;
		if (this.disposed) {
			return null;
		}
		const serializeOptions =
			options.maxScrollbackLines === undefined ? undefined : { scrollback: options.maxScrollbackLines };
		return {
			// `scrollback` limits how many rows of history are serialized,
			// counted from the bottom of the buffer. Passing it (rather than
			// slicing the resulting string) keeps escape sequences intact —
			// a string slice could cut a sequence mid-way through and produce
			// an unreplayable snapshot.
			snapshot: this.serializeAddon.serialize(serializeOptions),
			cols: this.terminal.cols,
			rows: this.terminal.rows,
		};
	}

	dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this.terminal.dispose();
	}

	private enqueueOperation(operation: () => void | Promise<void>): void {
		this.operationQueue = this.operationQueue
			.catch(() => undefined)
			.then(async () => {
				await operation();
			});
	}
}
