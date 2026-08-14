import { afterEach, describe, expect, it, vi } from "vitest";

import {
	type TerminalRestoreSnapshot,
	type TerminalSnapshotOptions,
	TerminalStateMirror,
} from "../../../src/terminal/terminal-state-mirror";

const mirrors: TerminalStateMirror[] = [];

function createMirror(cols = 80, rows = 24): TerminalStateMirror {
	const mirror = new TerminalStateMirror(cols, rows);
	mirrors.push(mirror);
	return mirror;
}

async function snapshotOf(
	mirror: TerminalStateMirror,
	options?: TerminalSnapshotOptions,
): Promise<TerminalRestoreSnapshot> {
	const snapshot = await mirror.getSnapshot(options);
	if (!snapshot) {
		throw new Error("Expected a snapshot from a live mirror.");
	}
	return snapshot;
}

afterEach(() => {
	while (mirrors.length > 0) {
		mirrors.pop()?.dispose();
	}
});

describe("TerminalStateMirror", () => {
	it("serializes inline terminal content and dimensions", async () => {
		const mirror = createMirror(100, 30);

		mirror.applyOutput(Buffer.from("hello\r\nworld", "utf8"));

		const snapshot = await snapshotOf(mirror);

		expect(snapshot.cols).toBe(100);
		expect(snapshot.rows).toBe(30);
		expect(snapshot.snapshot).toContain("hello");
		expect(snapshot.snapshot).toContain("world");
	});

	it("preserves alternate-screen state when the active buffer is alternate", async () => {
		const mirror = createMirror();

		mirror.applyOutput(Buffer.from("\u001b[?1049h\u001b[Hfullscreen", "utf8"));

		const snapshot = await snapshotOf(mirror);

		expect(snapshot.snapshot).toContain("\u001b[?1049h");
		expect(snapshot.snapshot).toContain("fullscreen");
	});

	it("applies queued resizes before generating a snapshot", async () => {
		const mirror = createMirror(80, 24);

		mirror.applyOutput(Buffer.from("before resize", "utf8"));
		mirror.resize(120, 40);
		mirror.applyOutput(Buffer.from("\r\nafter resize", "utf8"));

		const snapshot = await snapshotOf(mirror);

		expect(snapshot.cols).toBe(120);
		expect(snapshot.rows).toBe(40);
		expect(snapshot.snapshot).toContain("after resize");
	});

	it("emits terminal query responses through the optional callback", async () => {
		const onInputResponse = vi.fn();
		const mirror = new TerminalStateMirror(80, 24, {
			onInputResponse,
		});
		mirrors.push(mirror);

		mirror.applyOutput(Buffer.from("\u001b[6n", "utf8"));
		await snapshotOf(mirror);

		expect(onInputResponse).toHaveBeenCalledWith("\u001b[1;1R");
	});

	it("serializes the full scrollback by default", async () => {
		const mirror = createMirror(20, 3);

		for (let i = 0; i < 50; i += 1) {
			mirror.applyOutput(Buffer.from(`line-${i}\r\n`, "utf8"));
		}

		const snapshot = await snapshotOf(mirror);

		expect(snapshot.snapshot).toContain("line-0");
		expect(snapshot.snapshot).toContain("line-49");
	});

	it("limits serialized scrollback when maxScrollbackLines is provided", async () => {
		const mirror = createMirror(20, 3);

		for (let i = 0; i < 50; i += 1) {
			mirror.applyOutput(Buffer.from(`line-${i}\r\n`, "utf8"));
		}

		const limited = await snapshotOf(mirror, { maxScrollbackLines: 2 });

		expect(limited.snapshot).not.toContain("line-0");
		expect(limited.snapshot).toContain("line-49");
	});

	// `getSnapshot` yields on the write queue before it serializes, so a dispose landing in
	// that window used to resume into `SerializeAddon.serialize()` against a dead terminal —
	// xterm then logs "Trying to add a disposable to a DisposableStore that has already been
	// disposed of" from its `get buffer()` accessor and leaks the disposable.
	it("returns null instead of serializing a terminal disposed mid-snapshot", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const mirror = createMirror();

		mirror.applyOutput(Buffer.from("hello", "utf8"));
		const pending = mirror.getSnapshot();
		mirror.dispose();

		await expect(pending).resolves.toBeNull();
		expect(warnSpy).not.toHaveBeenCalled();
		warnSpy.mockRestore();
	});

	it("returns null for snapshots requested after dispose", async () => {
		const mirror = createMirror();

		mirror.applyOutput(Buffer.from("hello", "utf8"));
		await snapshotOf(mirror);
		mirror.dispose();

		await expect(mirror.getSnapshot()).resolves.toBeNull();
	});

	it("ignores output and resizes queued around dispose", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const mirror = createMirror();

		// Queued before dispose, executed after it: the queue drains asynchronously, so the
		// disposed check has to happen when the operation runs, not when it is enqueued.
		mirror.applyOutput(Buffer.from("queued before dispose", "utf8"));
		mirror.resize(120, 40);
		mirror.dispose();
		mirror.applyOutput(Buffer.from("after dispose", "utf8"));
		mirror.resize(200, 60);

		await expect(mirror.getSnapshot()).resolves.toBeNull();
		expect(warnSpy).not.toHaveBeenCalled();
		warnSpy.mockRestore();
	});

	it("tolerates repeated dispose calls", () => {
		const mirror = createMirror();

		expect(() => {
			mirror.dispose();
			mirror.dispose();
		}).not.toThrow();
	});
});
