import { existsSync, lstatSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { findStackRoot } from "../../../src/stack/stack-paths";
import { createTempDir } from "../../utilities/temp-dir";

describe("link-stack-skills UA gating", () => {
	it("skips UA skills when the checkout has no graph", async () => {
		const sandboxDir = findStackRoot();
		if (sandboxDir === null) {
			return;
		}

		const { path: checkoutRoot, cleanup } = createTempDir("ua-gate-");
		try {
			for (const dir of [".claude/skills", ".agent/skills", ".cursor/skills"]) {
				mkdirSync(join(checkoutRoot, dir), { recursive: true });
			}
			symlinkSync("/tmp/fake-understand-chat", join(checkoutRoot, ".claude/skills/understand-chat"));

			const mod = await import(
				// @ts-expect-error — plain .mjs script helper, no declaration file
				"../../../../../scripts/link-stack-skills.mjs"
			);
			expect(mod.hasUnderstandAnythingGraph(checkoutRoot)).toBe(false);

			const summary = mod.linkStackSkills({
				sandboxDir,
				destDirs: [
					join(checkoutRoot, ".claude/skills"),
					join(checkoutRoot, ".agent/skills"),
					join(checkoutRoot, ".cursor/skills"),
				],
				repoRootPath: checkoutRoot,
			});

			expect(summary.present).toBe(true);
			expect(summary.understandAnythingActive).toBe(false);
			expect(summary.removed.length).toBeGreaterThan(0);
			expect(existsSync(join(checkoutRoot, ".claude/skills/understand-chat"))).toBe(false);
		} finally {
			cleanup();
		}
	});

	it("links UA skills when .ua/knowledge-graph.json exists", async () => {
		const sandboxDir = findStackRoot();
		if (sandboxDir === null || !existsSync(join(sandboxDir, "src-understand-anything"))) {
			return;
		}

		const { path: checkoutRoot, cleanup } = createTempDir("ua-graph-");
		try {
			mkdirSync(join(checkoutRoot, ".ua"), { recursive: true });
			writeFileSync(join(checkoutRoot, ".ua/knowledge-graph.json"), '{"nodes":[],"edges":[]}\n', "utf8");

			const mod = await import(
				// @ts-expect-error — plain .mjs script helper, no declaration file
				"../../../../../scripts/link-stack-skills.mjs"
			);
			expect(mod.hasUnderstandAnythingGraph(checkoutRoot)).toBe(true);

			const summary = mod.linkStackSkills({
				sandboxDir,
				destDirs: [join(checkoutRoot, ".claude/skills")],
				repoRootPath: checkoutRoot,
			});

			expect(summary.understandAnythingActive).toBe(true);
			const linked = join(checkoutRoot, ".claude/skills/understand-chat");
			expect(existsSync(linked)).toBe(true);
			expect(lstatSync(linked).isSymbolicLink()).toBe(true);
		} finally {
			cleanup();
		}
	});
});
