import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { disposePersistentTerminal, ensurePersistentTerminal } from "@/terminal/persistent-terminal-manager";

// `PersistentTerminal` drives a real `@xterm/xterm` Terminal, which needs a
// canvas 2D context this jsdom environment doesn't provide. Replace it with a
// minimal fake that records `.write()` calls so `applyRestore`'s behavior
// (snapshot content + stale banner) can be asserted without a real renderer.
interface FakeTerminalInstance {
	cols: number;
	rows: number;
	writes: Array<string | Uint8Array>;
}

interface RestoreState {
	restoreWasEmpty: boolean;
	staleRestore: boolean;
}

const testState = vi.hoisted(() => ({
	fakeTerminals: [] as FakeTerminalInstance[],
	webSockets: [] as Array<{ url: string; onmessage: ((event: { data: unknown }) => void) | null }>,
}));

vi.mock("@xterm/xterm", () => {
	class FakeTerminal implements FakeTerminalInstance {
		cols: number;
		rows: number;
		options: Record<string, unknown> = {};
		unicode = { activeVersion: "6" };
		writes: Array<string | Uint8Array> = [];

		constructor(options: { cols: number; rows: number }) {
			this.cols = options.cols;
			this.rows = options.rows;
			testState.fakeTerminals.push(this);
		}

		loadAddon(): void {}
		open(): void {}
		onData(): void {}
		onBinary(): void {}
		attachCustomKeyEventHandler(): void {}
		resize(cols: number, rows: number): void {
			this.cols = cols;
			this.rows = rows;
		}
		reset(): void {}
		write(data: string | Uint8Array, callback?: () => void): void {
			this.writes.push(data);
			callback?.();
		}
		focus(): void {}
		input(): void {}
		paste(): void {}
		clear(): void {}
		hasSelection(): boolean {
			return false;
		}
		getSelection(): string {
			return "";
		}
		dispose(): void {}
	}

	return { Terminal: FakeTerminal };
});

class MockWebSocket {
	static readonly CONNECTING = 0;
	static readonly OPEN = 1;
	static readonly CLOSING = 2;
	static readonly CLOSED = 3;

	readyState = MockWebSocket.CONNECTING;
	binaryType = "blob";
	readonly url: string;
	onopen: (() => void) | null = null;
	onmessage: ((event: { data: unknown }) => void) | null = null;
	onerror: (() => void) | null = null;
	onclose: (() => void) | null = null;
	sent: unknown[] = [];
	private readonly messageListeners: Array<(event: { data: unknown }) => void> = [];

	constructor(url: string) {
		this.url = url;
		testState.webSockets.push(this);
	}

	addEventListener(type: string, handler: (event: { data: unknown }) => void): void {
		if (type === "message") {
			this.messageListeners.push(handler);
		}
	}

	removeEventListener(): void {}

	send(data: unknown): void {
		this.sent.push(data);
	}

	close(): void {
		this.readyState = MockWebSocket.CLOSED;
		this.onclose?.();
	}

	emitMessage(data: unknown): void {
		this.onmessage?.({ data });
		for (const listener of this.messageListeners) {
			listener({ data });
		}
	}
}

async function flushMicrotasks(): Promise<void> {
	for (let i = 0; i < 10; i++) {
		await Promise.resolve();
	}
}

function findControlSocket(): MockWebSocket {
	const socket = testState.webSockets.find((candidate) => candidate.url.includes("/api/terminal/control"));
	if (!socket) {
		throw new Error("Expected a control WebSocket to have been created.");
	}
	return socket as MockWebSocket;
}

describe("PersistentTerminal restore handling", () => {
	beforeEach(() => {
		testState.fakeTerminals.length = 0;
		testState.webSockets.length = 0;
		vi.stubGlobal("WebSocket", MockWebSocket);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	function createTerminal(taskId: string) {
		return ensurePersistentTerminal({
			taskId,
			workspaceId: "workspace-1",
			cursorColor: "cursor",
			terminalBackgroundColor: "background",
		});
	}

	it("writes the snapshot content and appends a dim stale-replay banner for a non-empty stale restore", async () => {
		const taskId = "task-stale-nonempty";
		const terminal = createTerminal(taskId);
		const restoreStates: RestoreState[] = [];
		terminal.subscribe({
			onRestoreState: (state) => {
				restoreStates.push(state);
			},
		});

		const capturedAt = Date.now() - 10 * 60 * 1000;
		findControlSocket().emitMessage(
			JSON.stringify({
				type: "restore",
				snapshot: "$ previous output",
				cols: 80,
				rows: 24,
				stale: true,
				capturedAt,
			}),
		);
		await flushMicrotasks();

		const fakeTerminal = testState.fakeTerminals[testState.fakeTerminals.length - 1];
		if (!fakeTerminal) {
			throw new Error("Expected a fake terminal instance.");
		}
		expect(fakeTerminal.writes[0]).toBe("$ previous output");
		const banner = fakeTerminal.writes[1];
		expect(typeof banner).toBe("string");
		expect(banner as string).toContain("replayed from the previous session");
		expect(banner as string).toContain("10m ago");
		expect(banner as string).toContain("Resume to continue");
		expect(banner as string).not.toContain("resume where you left off");

		expect(restoreStates).toContainEqual({ restoreWasEmpty: false, staleRestore: true });

		disposePersistentTerminal("workspace-1", taskId);
	});

	it("does not write a banner for an empty stale restore but still reports restoreWasEmpty", async () => {
		const taskId = "task-stale-empty";
		const terminal = createTerminal(taskId);
		const restoreStates: RestoreState[] = [];
		terminal.subscribe({
			onRestoreState: (state) => {
				restoreStates.push(state);
			},
		});

		findControlSocket().emitMessage(
			JSON.stringify({
				type: "restore",
				snapshot: "",
				cols: null,
				rows: null,
				stale: true,
				capturedAt: Date.now(),
			}),
		);
		await flushMicrotasks();

		const fakeTerminal = testState.fakeTerminals[testState.fakeTerminals.length - 1];
		if (!fakeTerminal) {
			throw new Error("Expected a fake terminal instance.");
		}
		expect(fakeTerminal.writes).toEqual([]);
		expect(restoreStates).toContainEqual({ restoreWasEmpty: true, staleRestore: false });

		disposePersistentTerminal("workspace-1", taskId);
	});

	it("behaves exactly as before for a non-stale (live) restore: no banner, no restoreWasEmpty regression", async () => {
		const taskId = "task-live-restore";
		const terminal = createTerminal(taskId);
		const restoreStates: RestoreState[] = [];
		terminal.subscribe({
			onRestoreState: (state) => {
				restoreStates.push(state);
			},
		});

		findControlSocket().emitMessage(
			JSON.stringify({
				type: "restore",
				snapshot: "$ live output",
				cols: 80,
				rows: 24,
				stale: false,
				capturedAt: null,
			}),
		);
		await flushMicrotasks();

		const fakeTerminal = testState.fakeTerminals[testState.fakeTerminals.length - 1];
		if (!fakeTerminal) {
			throw new Error("Expected a fake terminal instance.");
		}
		expect(fakeTerminal.writes).toEqual(["$ live output"]);
		expect(restoreStates).toContainEqual({ restoreWasEmpty: false, staleRestore: false });

		disposePersistentTerminal("workspace-1", taskId);
	});

	it("replays the most recent restore state to a subscriber that joins afterward", async () => {
		const taskId = "task-late-subscriber";
		createTerminal(taskId);

		findControlSocket().emitMessage(
			JSON.stringify({
				type: "restore",
				snapshot: "$ live output",
				cols: 80,
				rows: 24,
				stale: false,
				capturedAt: null,
			}),
		);
		await flushMicrotasks();

		const terminal = createTerminal(taskId);
		const restoreStates: RestoreState[] = [];
		terminal.subscribe({
			onRestoreState: (state) => {
				restoreStates.push(state);
			},
		});

		expect(restoreStates).toEqual([{ restoreWasEmpty: false, staleRestore: false }]);

		disposePersistentTerminal("workspace-1", taskId);
	});
});
