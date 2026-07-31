import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { migrateRuntimeHome } from "../../../src/state/runtime-home-migration";
import {
	LEGACY_RUNTIME_HOME_PARENT_DIR_NAME,
	RUNTIME_HOME_PARENT_DIR_NAME,
} from "../../../src/workspace/task-worktree-path";
import { createTempDir } from "../../utilities/temp-dir";

function withTemporaryHome<T>(home: string, run: () => Promise<T>): Promise<T> {
	const previousHome = process.env.HOME;
	const previousUserProfile = process.env.USERPROFILE;
	process.env.HOME = home;
	process.env.USERPROFILE = home;
	return run().finally(() => {
		if (previousHome === undefined) {
			delete process.env.HOME;
		} else {
			process.env.HOME = previousHome;
		}
		if (previousUserProfile === undefined) {
			delete process.env.USERPROFILE;
		} else {
			process.env.USERPROFILE = previousUserProfile;
		}
	});
}

/** Mirrors the real layout: boards live under kanban/workspaces/<id>/board.json. */
function seedRuntimeHome(home: string, parentDir: string, boardTitle: string): void {
	const workspaceDir = join(home, parentDir, "kanban", "workspaces", "ws-1");
	mkdirSync(workspaceDir, { recursive: true });
	writeFileSync(join(workspaceDir, "board.json"), JSON.stringify({ title: boardTitle }), "utf8");
	writeFileSync(
		join(home, parentDir, "kanban", "config.json"),
		JSON.stringify({ selectedShortcutLabel: boardTitle }),
		"utf8",
	);
}

function readMigratedBoardTitle(home: string, parentDir: string): string | null {
	const boardPath = join(home, parentDir, "kanban", "workspaces", "ws-1", "board.json");
	if (!existsSync(boardPath)) {
		return null;
	}
	return (JSON.parse(readFileSync(boardPath, "utf8")) as { title?: string }).title ?? null;
}

describe("migrateRuntimeHome", () => {
	it("copies legacy boards forward and leaves the original in place", async () => {
		const { path: home, cleanup } = createTempDir("runtime-home-migration-copy-");
		try {
			seedRuntimeHome(home, LEGACY_RUNTIME_HOME_PARENT_DIR_NAME, "legacy board");

			await withTemporaryHome(home, async () => {
				const result = await migrateRuntimeHome();
				expect(result.migrated).toBe(true);
				expect(result.reason).toBe("copied");
			});

			expect(readMigratedBoardTitle(home, RUNTIME_HOME_PARENT_DIR_NAME)).toBe("legacy board");
			// The legacy tree is a backup, never consumed.
			expect(readMigratedBoardTitle(home, LEGACY_RUNTIME_HOME_PARENT_DIR_NAME)).toBe("legacy board");
		} finally {
			cleanup();
		}
	});

	it("never overwrites state that already exists in the new home", async () => {
		const { path: home, cleanup } = createTempDir("runtime-home-migration-existing-");
		try {
			seedRuntimeHome(home, LEGACY_RUNTIME_HOME_PARENT_DIR_NAME, "legacy board");
			seedRuntimeHome(home, RUNTIME_HOME_PARENT_DIR_NAME, "current board");

			await withTemporaryHome(home, async () => {
				const result = await migrateRuntimeHome();
				expect(result.migrated).toBe(false);
				expect(result.reason).toBe("already-present");
			});

			expect(readMigratedBoardTitle(home, RUNTIME_HOME_PARENT_DIR_NAME)).toBe("current board");
		} finally {
			cleanup();
		}
	});

	it("is a no-op on a machine with no legacy state", async () => {
		const { path: home, cleanup } = createTempDir("runtime-home-migration-fresh-");
		try {
			await withTemporaryHome(home, async () => {
				const result = await migrateRuntimeHome();
				expect(result.migrated).toBe(false);
				expect(result.reason).toBe("no-legacy-state");
			});
			expect(existsSync(join(home, RUNTIME_HOME_PARENT_DIR_NAME, "kanban"))).toBe(false);
		} finally {
			cleanup();
		}
	});

	it("is idempotent across repeated starts", async () => {
		const { path: home, cleanup } = createTempDir("runtime-home-migration-idempotent-");
		try {
			seedRuntimeHome(home, LEGACY_RUNTIME_HOME_PARENT_DIR_NAME, "legacy board");

			await withTemporaryHome(home, async () => {
				expect((await migrateRuntimeHome()).reason).toBe("copied");
				expect((await migrateRuntimeHome()).reason).toBe("already-present");
			});

			expect(readMigratedBoardTitle(home, RUNTIME_HOME_PARENT_DIR_NAME)).toBe("legacy board");
		} finally {
			cleanup();
		}
	});
});
