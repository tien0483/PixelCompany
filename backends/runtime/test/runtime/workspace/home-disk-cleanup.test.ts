import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempDir } from "../../utilities/temp-dir";
import { cleanHomeDiskCleanup, scanHomeDiskCleanup } from "../../../src/workspace/home-disk-cleanup";

const OLD_MS = 1000 * 60 * 60 * 24 * 10;

function touch(path: string, ageMs: number) {
	const time = new Date(Date.now() - ageMs);
	writeFileSync(path, "x");
	utimesSync(path, time, time);
}

describe("home-disk-cleanup", () => {
	let cleanup: (() => void) | null = null;
	let homeDir = "";
	const previousHome = process.env.HOME;
	const previousRecycleBinEnv = process.env.PIXELOFFICE_RECYCLE_BIN;

	beforeEach(() => {
		const temp = createTempDir("kanban-home-disk-");
		cleanup = temp.cleanup;
		homeDir = temp.path;
		process.env.HOME = homeDir;
		process.env.PIXELOFFICE_RECYCLE_BIN = join(homeDir, ".agent", "recycle-bin");
	});

	afterEach(() => {
		cleanup?.();
		cleanup = null;
		if (previousHome === undefined) {
			delete process.env.HOME;
		} else {
			process.env.HOME = previousHome;
		}
		if (previousRecycleBinEnv === undefined) {
			delete process.env.PIXELOFFICE_RECYCLE_BIN;
		} else {
			process.env.PIXELOFFICE_RECYCLE_BIN = previousRecycleBinEnv;
		}
	});

	it("scans npm cache directories and aged tmp entries", async () => {
		const tmpRoot = join(homeDir, "tmp-root");
		mkdirSync(tmpRoot, { recursive: true });
		mkdirSync(join(homeDir, ".npm", "_cacache"), { recursive: true });
		mkdirSync(join(homeDir, ".npm", "_npx"), { recursive: true });
		touch(join(tmpRoot, "old-entry"), OLD_MS);
		touch(join(tmpRoot, "new-entry"), 1000);

		const originalTmpdir = process.env.TMPDIR;
		process.env.TMPDIR = tmpRoot;

		const scan = await scanHomeDiskCleanup({ days: 7 });
		expect(scan.npmCache).toHaveLength(2);
		expect(scan.tmp.some((entry) => entry.path.endsWith("old-entry"))).toBe(true);
		expect(scan.tmp.some((entry) => entry.path.endsWith("new-entry"))).toBe(false);

		if (originalTmpdir === undefined) {
			delete process.env.TMPDIR;
		} else {
			process.env.TMPDIR = originalTmpdir;
		}
	});

	it("marks the runtime's nvm version as in use", async () => {
		const versionsDir = join(homeDir, ".nvm", "versions", "node", "v99.0.0", "bin");
		mkdirSync(versionsDir, { recursive: true });
		writeFileSync(join(versionsDir, "node"), "#!/bin/sh\n");
		const previousExecPath = process.execPath;
		Object.defineProperty(process, "execPath", {
			configurable: true,
			value: join(versionsDir, "node"),
		});

		const scan = await scanHomeDiskCleanup();
		expect(scan.nvmVersions).toHaveLength(1);
		expect(scan.nvmVersions[0]?.inUse).toBe(true);

		Object.defineProperty(process, "execPath", {
			configurable: true,
			value: previousExecPath,
		});
	});

	it("moves selected npm cache dirs to the recycle bin", async () => {
		const npmCache = join(homeDir, ".npm", "_cacache");
		mkdirSync(npmCache, { recursive: true });
		writeFileSync(join(npmCache, "blob.dat"), "cache");

		const result = await cleanHomeDiskCleanup({
			dryRun: false,
			disposeMode: "recycle-bin",
			includeNpmCache: true,
		});
		expect(result.cleaned).toHaveLength(1);
		expect(result.cleaned[0]?.tier).toBe("npm-cache");
	});
});
