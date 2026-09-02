import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempDir } from "../../utilities/temp-dir";
import {
	emptyRecycleBin,
	moveToRecycleBin,
	resolveRecycleBinPath,
	scanRecycleBin,
} from "../../../src/workspace/recycle-bin";

describe("recycle-bin", () => {
	let cleanup: (() => void) | null = null;
	let recycleBinDir = "";
	const previousRecycleBinEnv = process.env.PIXELOFFICE_RECYCLE_BIN;

	beforeEach(() => {
		const temp = createTempDir("kanban-recycle-bin-");
		cleanup = temp.cleanup;
		recycleBinDir = join(temp.path, "recycle-bin");
		process.env.PIXELOFFICE_RECYCLE_BIN = recycleBinDir;
	});

	afterEach(() => {
		cleanup?.();
		cleanup = null;
		if (previousRecycleBinEnv === undefined) {
			delete process.env.PIXELOFFICE_RECYCLE_BIN;
		} else {
			process.env.PIXELOFFICE_RECYCLE_BIN = previousRecycleBinEnv;
		}
	});

	it("resolves the recycle bin path from the env override", () => {
		expect(resolveRecycleBinPath()).toBe(recycleBinDir);
	});

	it("moves a source directory into the recycle bin", async () => {
		const sourceDir = join(recycleBinDir, "..", "source-dir");
		mkdirSync(sourceDir, { recursive: true });
		writeFileSync(join(sourceDir, "note.txt"), "hello");

		const moved = await moveToRecycleBin(sourceDir);
		expect(moved.sizeBytes).toBeGreaterThan(0);
		expect(moved.destPath.startsWith(recycleBinDir)).toBe(true);

		const scan = await scanRecycleBin();
		expect(scan.itemCount).toBe(1);
		expect(scan.sizeBytes).toBeGreaterThan(0);
	});

	it("dry-run empty reports entries without deleting them", async () => {
		const sourceDir = join(recycleBinDir, "..", "to-empty");
		mkdirSync(sourceDir, { recursive: true });
		await moveToRecycleBin(sourceDir);

		const dryRun = await emptyRecycleBin({ dryRun: true });
		expect(dryRun.cleaned).toHaveLength(1);
		expect(scanRecycleBin()).resolves.toMatchObject({ itemCount: 1 });
	});

	it("empties the recycle bin permanently", async () => {
		const sourceDir = join(recycleBinDir, "..", "to-delete");
		mkdirSync(sourceDir, { recursive: true });
		await moveToRecycleBin(sourceDir);

		const emptied = await emptyRecycleBin({ dryRun: false });
		expect(emptied.cleaned).toHaveLength(1);

		const scan = await scanRecycleBin();
		expect(scan.itemCount).toBe(0);
		expect(scan.sizeBytes).toBe(0);
	});
});
