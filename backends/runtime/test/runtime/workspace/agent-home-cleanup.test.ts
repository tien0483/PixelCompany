import { mkdirSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTempDir } from "../../utilities/temp-dir";
import { cleanAgentHomes, scanAgentHomes } from "../../../src/workspace/agent-home-cleanup";

const OLD_MS = 1000 * 60 * 60 * 24 * 10;
const NEW_MS = 1000 * 60 * 60;

function touch(path: string, ageMs: number) {
	const time = new Date(Date.now() - ageMs);
	writeFileSync(path, "x");
	utimesSync(path, time, time);
}

describe("agent-home-cleanup", () => {
	let cleanup: (() => void) | null = null;
	let homeDir = "";

	beforeEach(() => {
		const temp = createTempDir("kanban-agent-home-");
		cleanup = temp.cleanup;
		homeDir = temp.path;
		vi.stubEnv("HOME", homeDir);

		mkdirSync(join(homeDir, ".cursor", "chats", "session-a"), { recursive: true });
		mkdirSync(join(homeDir, ".cursor", "ai-tracking"), { recursive: true });
		mkdirSync(join(homeDir, ".cursor", "skills-cursor"), { recursive: true });
		mkdirSync(join(homeDir, ".cursor", "projects", "repo", "agent-transcripts", "abc"), { recursive: true });
		mkdirSync(join(homeDir, ".gemini", "tmp"), { recursive: true });
		mkdirSync(join(homeDir, ".gemini", "accounts"), { recursive: true });
		mkdirSync(join(homeDir, ".gemini", "antigravity-cli", "conversations"), { recursive: true });
		mkdirSync(join(homeDir, ".gemini", "antigravity-cli", "bin"), { recursive: true });
		mkdirSync(join(homeDir, ".antigravity", "cache"), { recursive: true });

		touch(join(homeDir, ".cursor", "chats", "session-a", "chat.json"), OLD_MS);
		touch(join(homeDir, ".cursor", "ai-tracking", "events.log"), OLD_MS);
		touch(join(homeDir, ".cursor", "skills-cursor", "skill.md"), OLD_MS);
		touch(join(homeDir, ".cursor", "projects", "repo", "agent-transcripts", "abc", "abc.jsonl"), OLD_MS);
		touch(join(homeDir, ".gemini", "tmp", "scratch.bin"), OLD_MS);
		writeFileSync(join(homeDir, ".gemini", "oauth_creds.json"), "{}");
		touch(join(homeDir, ".gemini", "antigravity-cli", "conversations", "thread.json"), OLD_MS);
		touch(join(homeDir, ".gemini", "antigravity-cli", "bin", "cli"), OLD_MS);
		touch(join(homeDir, ".antigravity", "cache", "blob"), OLD_MS);
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		cleanup?.();
		cleanup = null;
	});

	it("reports cursor, gemini, and antigravity cache sizes without touching oauth or skills", async () => {
		const leftovers = await scanAgentHomes({ days: 7 });
		const paths = leftovers.map((item) => item.path);
		expect(paths.some((path) => path.includes(".cursor/chats"))).toBe(true);
		expect(paths.some((path) => path.includes(".gemini/tmp"))).toBe(true);
		expect(paths.some((path) => path.includes("antigravity-cli/conversations"))).toBe(true);
		expect(paths.some((path) => path.includes(".antigravity/cache"))).toBe(true);
		expect(paths.some((path) => path.includes("skills-cursor"))).toBe(false);
		expect(paths.some((path) => path.includes("oauth_creds"))).toBe(false);
		expect(paths.some((path) => path.includes("antigravity-cli/bin"))).toBe(false);
	});

	it("cleans only the requested provider homes", async () => {
		const result = await cleanAgentHomes({
			days: 7,
			dryRun: false,
			includeCursor: true,
			includeGemini: false,
			includeAntigravityHome: false,
		});
		expect(readdirSync(join(homeDir, ".cursor"))).not.toContain("chats");
		expect(readdirSync(join(homeDir, ".gemini", "tmp"))).toContain("scratch.bin");
		expect(readdirSync(join(homeDir, ".antigravity", "cache"))).toContain("blob");
		expect(result.cleaned.some((item) => item.tier === "cursor")).toBe(true);
	});
});
