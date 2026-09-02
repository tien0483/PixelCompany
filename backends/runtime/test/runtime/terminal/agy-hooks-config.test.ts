import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
	buildAgyHooksJson,
	ensureAgyHooksExcluded,
	mergeAgyHooksJson,
} from "../../../src/terminal/agy-hooks-config";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) {
			rmSync(dir, { recursive: true, force: true });
		}
	}
});

const buildCommand = (args: string[]): string => `kanban hooks ${args.join(" ")}`;

describe("buildAgyHooksJson", () => {
	it("emits only agy's native events, name-keyed", () => {
		const hooks = buildAgyHooksJson(buildCommand);

		expect(Object.keys(hooks).sort()).toEqual([
			"kanban-post-invocation",
			"kanban-post-tool-use",
			"kanban-pre-invocation",
			"kanban-pre-tool-use",
			"kanban-stop",
		]);
		const events = Object.values(hooks).flatMap((entry) => Object.keys(entry));
		expect(events.sort()).toEqual(["PostInvocation", "PostToolUse", "PreInvocation", "PreToolUse", "Stop"]);
	});

	it("uses flat handler lists for non-tool events and a matcher wrapper for tool events", () => {
		const hooks = buildAgyHooksJson(buildCommand);

		expect(hooks["kanban-stop"]?.Stop).toEqual([
			{ type: "command", command: "kanban hooks gemini-hook --event Stop" },
		]);
		expect(hooks["kanban-pre-invocation"]?.PreInvocation).toEqual([
			{ type: "command", command: "kanban hooks gemini-hook --event PreInvocation" },
		]);
		expect(hooks["kanban-post-tool-use"]?.PostToolUse).toEqual([
			{
				matcher: "*",
				hooks: [{ type: "command", command: "kanban hooks gemini-hook --event PostToolUse" }],
			},
		]);
	});
});

describe("mergeAgyHooksJson", () => {
	const kanbanEntries = buildAgyHooksJson(buildCommand);

	it("returns just the Kanban entries when no file exists", () => {
		expect(mergeAgyHooksJson(null, kanbanEntries)).toEqual(kanbanEntries);
	});

	it("preserves foreign entries and replaces stale Kanban ones", () => {
		const existing = JSON.stringify({
			"team-lint": { PostToolUse: [{ matcher: "*", hooks: [{ type: "command", command: "lint" }] }] },
			"kanban-stop": { Stop: [{ type: "command", command: "/old/path/kanban hooks gemini-hook" }] },
			"kanban-removed-event": { AfterTool: [] },
		});

		const merged = mergeAgyHooksJson(existing, kanbanEntries);

		expect(merged["team-lint"]).toEqual({
			PostToolUse: [{ matcher: "*", hooks: [{ type: "command", command: "lint" }] }],
		});
		expect(merged["kanban-removed-event"]).toBeUndefined();
		expect(merged["kanban-stop"]).toEqual(kanbanEntries["kanban-stop"]);
	});

	it("falls back to the Kanban entries when the file is corrupt", () => {
		expect(mergeAgyHooksJson("{not json", kanbanEntries)).toEqual(kanbanEntries);
		expect(mergeAgyHooksJson("[]", kanbanEntries)).toEqual(kanbanEntries);
	});
});

describe("ensureAgyHooksExcluded", () => {
	it("writes into the common git dir for a linked worktree", () => {
		const root = makeTempDir("kanban-agy-exclude-");
		const commonGitDir = join(root, "repo.git");
		const worktreeGitDir = join(commonGitDir, "worktrees", "task-1");
		mkdirSync(worktreeGitDir, { recursive: true });
		// A linked worktree's gitdir points back at the common dir through `commondir`.
		writeFileSync(join(worktreeGitDir, "commondir"), "../..\n", "utf8");
		const worktree = join(root, "worktree");
		mkdirSync(worktree, { recursive: true });
		writeFileSync(join(worktree, ".git"), `gitdir: ${worktreeGitDir}\n`, "utf8");

		ensureAgyHooksExcluded(worktree);

		const exclude = readFileSync(join(commonGitDir, "info", "exclude"), "utf8");
		expect(exclude).toContain("/.agents/hooks.json");
	});

	it("is idempotent", () => {
		const root = makeTempDir("kanban-agy-exclude-idem-");
		mkdirSync(join(root, ".git", "info"), { recursive: true });
		writeFileSync(join(root, ".git", "info", "exclude"), "# existing\n", "utf8");

		ensureAgyHooksExcluded(root);
		ensureAgyHooksExcluded(root);

		const exclude = readFileSync(join(root, ".git", "info", "exclude"), "utf8");
		expect(exclude.split("\n").filter((line) => line.trim() === "/.agents/hooks.json")).toHaveLength(1);
		expect(exclude).toContain("# existing");
	});

	it("does nothing outside a git checkout", () => {
		const root = makeTempDir("kanban-agy-exclude-nogit-");
		expect(() => {
			ensureAgyHooksExcluded(root);
		}).not.toThrow();
	});
});
