import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTempDir } from "../../utilities/temp-dir";

const workspaceStateMocks = vi.hoisted(() => ({
	getWorkspaceDirectoryPath: vi.fn(),
}));

vi.mock("../../../src/state/workspace-state.js", () => ({
	getWorkspaceDirectoryPath: workspaceStateMocks.getWorkspaceDirectoryPath,
}));

import { createTerminalSnapshotStore, MAX_SNAPSHOT_BYTES } from "../../../src/terminal/terminal-snapshot-store";

describe("terminal-snapshot-store", () => {
	let cleanup: (() => void) | null = null;
	let workspaceDir = "";

	beforeEach(() => {
		const temp = createTempDir("kanban-terminal-snapshot-");
		cleanup = temp.cleanup;
		workspaceDir = join(temp.path, "ws-1");
		mkdirSync(workspaceDir, { recursive: true });
		workspaceStateMocks.getWorkspaceDirectoryPath.mockReturnValue(workspaceDir);
	});

	afterEach(() => {
		cleanup?.();
		cleanup = null;
		vi.clearAllMocks();
	});

	function snapshotFilePath(taskId: string): string {
		return join(workspaceDir, "terminal-snapshots", `${taskId}.json`);
	}

	it("round-trips a snapshot through save/load", async () => {
		const store = createTerminalSnapshotStore("ws-1");
		const record = {
			version: 1 as const,
			taskId: "task-1",
			capturedAt: 1_700_000_000_000,
			cols: 80,
			rows: 24,
			snapshot: "hello world",
			truncated: false,
		};

		await store.save(record);
		const loaded = await store.load("task-1");

		expect(loaded).toEqual(record);
	});

	it("writes under the workspace's terminal-snapshots directory keyed by taskId", async () => {
		const store = createTerminalSnapshotStore("ws-1");
		await store.save({
			version: 1,
			taskId: "task-2",
			capturedAt: 1,
			cols: 80,
			rows: 24,
			snapshot: "x",
			truncated: false,
		});

		const { existsSync } = await import("node:fs");
		expect(existsSync(snapshotFilePath("task-2"))).toBe(true);
	});

	it("returns null for a taskId that was never saved", async () => {
		const store = createTerminalSnapshotStore("ws-1");
		const loaded = await store.load("missing-task");
		expect(loaded).toBeNull();
	});

	it("delete removes the snapshot so a subsequent load returns null", async () => {
		const store = createTerminalSnapshotStore("ws-1");
		await store.save({
			version: 1,
			taskId: "task-3",
			capturedAt: 1,
			cols: 80,
			rows: 24,
			snapshot: "content",
			truncated: false,
		});

		await store.delete("task-3");

		expect(await store.load("task-3")).toBeNull();
	});

	it("delete is a no-op when nothing was ever saved", async () => {
		const store = createTerminalSnapshotStore("ws-1");
		await expect(store.delete("never-existed")).resolves.toBeUndefined();
	});

	it("truncates and drops the snapshot body when it exceeds MAX_SNAPSHOT_BYTES", async () => {
		const store = createTerminalSnapshotStore("ws-1");
		const oversized = "a".repeat(MAX_SNAPSHOT_BYTES + 1);

		await store.save({
			version: 1,
			taskId: "task-4",
			capturedAt: 42,
			cols: 80,
			rows: 24,
			snapshot: oversized,
			truncated: false,
		});

		const loaded = await store.load("task-4");
		expect(loaded).toEqual({
			version: 1,
			taskId: "task-4",
			capturedAt: 42,
			cols: 80,
			rows: 24,
			snapshot: "",
			truncated: true,
		});
	});

	it("keeps a snapshot exactly at MAX_SNAPSHOT_BYTES intact", async () => {
		const store = createTerminalSnapshotStore("ws-1");
		const exact = "a".repeat(MAX_SNAPSHOT_BYTES);

		await store.save({
			version: 1,
			taskId: "task-5",
			capturedAt: 1,
			cols: 80,
			rows: 24,
			snapshot: exact,
			truncated: false,
		});

		const loaded = await store.load("task-5");
		expect(loaded?.truncated).toBe(false);
		expect(loaded?.snapshot).toBe(exact);
	});

	it("returns null (not throw) when the on-disk file is corrupt JSON", async () => {
		const path = snapshotFilePath("task-6");
		mkdirSync(join(workspaceDir, "terminal-snapshots"), { recursive: true });
		writeFileSync(path, "{ not valid json", "utf8");

		const store = createTerminalSnapshotStore("ws-1");
		await expect(store.load("task-6")).resolves.toBeNull();
	});

	it("returns null (not throw) when the on-disk file fails schema validation", async () => {
		const path = snapshotFilePath("task-7");
		mkdirSync(join(workspaceDir, "terminal-snapshots"), { recursive: true });
		writeFileSync(path, JSON.stringify({ version: 1, taskId: "task-7" }), "utf8");

		const store = createTerminalSnapshotStore("ws-1");
		await expect(store.load("task-7")).resolves.toBeNull();
	});

	it("returns null (not throw) when the on-disk file has the wrong version", async () => {
		const path = snapshotFilePath("task-8");
		mkdirSync(join(workspaceDir, "terminal-snapshots"), { recursive: true });
		writeFileSync(
			path,
			JSON.stringify({
				version: 2,
				taskId: "task-8",
				capturedAt: 1,
				cols: 80,
				rows: 24,
				snapshot: "x",
				truncated: false,
			}),
			"utf8",
		);

		const store = createTerminalSnapshotStore("ws-1");
		await expect(store.load("task-8")).resolves.toBeNull();
	});

	it("keeps snapshots for different tasks isolated", async () => {
		const store = createTerminalSnapshotStore("ws-1");
		await store.save({
			version: 1,
			taskId: "task-a",
			capturedAt: 1,
			cols: 10,
			rows: 10,
			snapshot: "A",
			truncated: false,
		});
		await store.save({
			version: 1,
			taskId: "task-b",
			capturedAt: 2,
			cols: 20,
			rows: 20,
			snapshot: "B",
			truncated: false,
		});

		expect((await store.load("task-a"))?.snapshot).toBe("A");
		expect((await store.load("task-b"))?.snapshot).toBe("B");
	});
});
