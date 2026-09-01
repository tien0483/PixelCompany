import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
	linkStackSkillsForCheckout,
	resolveStackRepoRoot,
} from "../../../src/stack/link-stack-skills-runtime";
import { findStackRoot } from "../../../src/stack/stack-paths";

describe("link-stack-skills-runtime", () => {
	it("resolves the monorepo root from the in-tree agent stack", () => {
		const stackRoot = findStackRoot();
		if (stackRoot === null) {
			return;
		}
		const repoRoot = resolveStackRepoRoot();
		expect(repoRoot).not.toBeNull();
		expect(existsSync(join(repoRoot!, "scripts", "link-stack-skills.mjs"))).toBe(true);
	});

	it("links ponytail skills and rules into a checkout without throwing", async () => {
		const repoRoot = resolveStackRepoRoot();
		if (repoRoot === null) {
			return;
		}
		await expect(linkStackSkillsForCheckout(repoRoot, { quiet: true })).resolves.toBeUndefined();
		expect(existsSync(join(repoRoot, ".cursor", "skills", "ponytail"))).toBe(true);
		expect(existsSync(join(repoRoot, ".claude", "skills", "ponytail"))).toBe(true);
		expect(existsSync(join(repoRoot, ".agents", "rules", "ponytail.md"))).toBe(true);
	});
});
