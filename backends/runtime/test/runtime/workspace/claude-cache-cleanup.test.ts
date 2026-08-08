import { mkdirSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempDir } from "../../utilities/temp-dir";
import { cleanClaudeCache, getClaudeCacheStatus } from "../../../src/workspace/claude-cache-cleanup";

const OLD_MS = 1000 * 60 * 60 * 24 * 10; // 10 days old
const NEW_MS = 1000 * 60 * 60; // 1 hour old

function touch(path: string, ageMs: number) {
	const time = new Date(Date.now() - ageMs);
	writeFileSync(path, "x");
	utimesSync(path, time, time);
}

describe("claude-cache-cleanup", () => {
	let cleanup: (() => void) | null = null;
	let claudeHomeDir = "";

	beforeEach(() => {
		const temp = createTempDir("kanban-claude-cache-");
		cleanup = temp.cleanup;
		claudeHomeDir = temp.path;
		mkdirSync(join(claudeHomeDir, "cache"), { recursive: true });
		mkdirSync(join(claudeHomeDir, "paste-cache"), { recursive: true });
		mkdirSync(join(claudeHomeDir, "shell-snapshots"), { recursive: true });
		mkdirSync(join(claudeHomeDir, "file-history", "some-uuid"), { recursive: true });
		mkdirSync(join(claudeHomeDir, "projects", "some-project"), { recursive: true });
		mkdirSync(join(claudeHomeDir, "accounts"), { recursive: true }); // protected, not in allowlist

		touch(join(claudeHomeDir, "cache", "old.json"), OLD_MS);
		touch(join(claudeHomeDir, "paste-cache", "old.txt"), OLD_MS);
		touch(join(claudeHomeDir, "shell-snapshots", "old.sh"), OLD_MS);
		touch(join(claudeHomeDir, "file-history", "some-uuid", "old@v1"), OLD_MS);
		touch(join(claudeHomeDir, "shell-snapshots", "new.sh"), NEW_MS);
		touch(join(claudeHomeDir, "projects", "some-project", "old-session.jsonl"), OLD_MS);
		touch(join(claudeHomeDir, "accounts", "secret.json"), OLD_MS);
	});

	afterEach(() => {
		cleanup?.();
		cleanup = null;
	});

	it("counts only allowlisted, aged-out files as safe, and reports transcripts separately", async () => {
		const status = await getClaudeCacheStatus({ claudeHomeDir });
		expect(status.ok).toBe(true);
		expect(status.safeItemCount).toBe(4); // cache/old.json, paste-cache/old.txt, shell-snapshots/old.sh, file-history/.../old@v1
		expect(status.transcriptItemCount).toBe(1); // projects/.../old-session.jsonl
	});

	it("dryRun reports candidates without deleting anything", async () => {
		const result = await cleanClaudeCache({ claudeHomeDir, days: 7, includeTranscripts: false, dryRun: true });
		expect(result.ok).toBe(true);
		expect(result.cleaned).toHaveLength(4);
		expect(result.cleaned.every((item) => item.tier === "safe")).toBe(true);
		// files must still exist after a dry run
		expect(readdirSync(join(claudeHomeDir, "cache"))).toContain("old.json");
	});

	it("real run deletes only safe-tier aged-out files, leaves recent and protected files untouched", async () => {
		const result = await cleanClaudeCache({ claudeHomeDir, days: 7, includeTranscripts: false, dryRun: false });
		expect(result.ok).toBe(true);
		expect(result.cleaned).toHaveLength(4);
		expect(readdirSync(join(claudeHomeDir, "cache"))).not.toContain("old.json");
		expect(readdirSync(join(claudeHomeDir, "shell-snapshots"))).toEqual(["new.sh"]);
		expect(readdirSync(join(claudeHomeDir, "accounts"))).toContain("secret.json");
		expect(readdirSync(join(claudeHomeDir, "projects", "some-project"))).toContain("old-session.jsonl");
	});

	it("includeTranscripts also deletes aged-out session transcripts", async () => {
		const result = await cleanClaudeCache({ claudeHomeDir, days: 7, includeTranscripts: true, dryRun: false });
		expect(result.cleaned.some((item) => item.tier === "transcript")).toBe(true);
		expect(readdirSync(join(claudeHomeDir, "projects", "some-project"))).not.toContain("old-session.jsonl");
	});
});
