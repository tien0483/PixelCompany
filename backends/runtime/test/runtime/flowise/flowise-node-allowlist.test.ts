import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
	buildFlowiseNodeFilterEnv,
	readFlowiseNodeAllowlist,
	resolveFlowiseNodeAllowlistPath,
} from "../../../src/flowise/flowise-node-allowlist";

describe("flowise node allowlist", () => {
	it("ships a list that resolves and names the PixelOffice category", () => {
		const path = resolveFlowiseNodeAllowlistPath();
		expect(path).not.toBeNull();
		const allowlist = readFlowiseNodeAllowlist(path);
		expect(allowlist.categories).toContain("PixelOffice");
		expect(allowlist.categories).toContain("Agent Flows");
	});

	/** Fail-open: an unreadable list must not be able to hide a node a saved flow depends on. */
	it("filters nothing when the file is missing or malformed", async () => {
		expect(readFlowiseNodeAllowlist(join(tmpdir(), "definitely-absent-allowlist.json"))).toEqual({
			categories: [],
			nodes: [],
			disabledNodes: [],
		});

		const dir = await mkdtemp(join(tmpdir(), "flowise-allowlist-"));
		const broken = join(dir, "node-allowlist.json");
		await writeFile(broken, "{ not json", "utf8");
		expect(buildFlowiseNodeFilterEnv(readFlowiseNodeAllowlist(broken))).toEqual({});
	});

	it("emits only the keys the list actually populates", async () => {
		const dir = await mkdtemp(join(tmpdir(), "flowise-allowlist-"));
		const path = join(dir, "node-allowlist.json");
		await writeFile(
			path,
			JSON.stringify({ categories: ["Chat Models", "Tools"], nodes: ["chainTool"], disabledNodes: [] }),
			"utf8",
		);
		expect(buildFlowiseNodeFilterEnv(readFlowiseNodeAllowlist(path))).toEqual({
			ENABLED_NODE_CATEGORIES: "Chat Models,Tools",
			ENABLED_NODES: "chainTool",
		});
	});

	it("ignores non-string entries rather than passing them through", async () => {
		const dir = await mkdtemp(join(tmpdir(), "flowise-allowlist-"));
		const path = join(dir, "node-allowlist.json");
		await writeFile(path, JSON.stringify({ categories: ["Tools", 7, "", null] }), "utf8");
		expect(readFlowiseNodeAllowlist(path).categories).toEqual(["Tools"]);
	});
});
