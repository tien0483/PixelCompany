import { mkdirSync, readdirSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempDir } from "../../utilities/temp-dir";
import { findOrphanNodeModuleDirs, removeOrphanNodeModuleDirs } from "../../../src/workspace/worktree-orphan-modules";

function touch(path: string) {
	writeFileSync(path, "x");
	utimesSync(path, new Date(), new Date());
}

describe("worktree-orphan-modules", () => {
	let cleanup: (() => void) | null = null;
	let worktreePath = "";

	beforeEach(() => {
		const temp = createTempDir("kanban-orphan-modules-");
		cleanup = temp.cleanup;
		worktreePath = join(temp.path, "worktree");
		mkdirSync(join(worktreePath, "node_modules", "pkg"), { recursive: true });
		mkdirSync(join(worktreePath, "apps", "web", "node_modules"), { recursive: true });
		touch(join(worktreePath, "node_modules", "pkg", "index.js"));
		touch(join(worktreePath, "apps", "web", "node_modules", "index.js"));
		symlinkSync("/tmp/shared-node_modules", join(worktreePath, "linked-node_modules"));
	});

	afterEach(() => {
		cleanup?.();
		cleanup = null;
	});

	it("finds real node_modules directories but not symlinks", async () => {
		const found = await findOrphanNodeModuleDirs(worktreePath);
		expect(found).toHaveLength(2);
		expect(found.some((item) => item.path.endsWith("apps/web/node_modules"))).toBe(true);
		expect(found.some((item) => item.path.endsWith("linked-node_modules"))).toBe(false);
	});

	it("removes orphan node_modules trees without touching the worktree root", async () => {
		const result = await removeOrphanNodeModuleDirs(worktreePath, false);
		expect(result.cleaned).toHaveLength(2);
		expect(readdirSync(worktreePath)).not.toContain("node_modules");
		expect(readdirSync(join(worktreePath, "apps", "web"))).not.toContain("node_modules");
	});
});
