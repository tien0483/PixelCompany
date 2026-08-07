import { existsSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
	findAgentDataRepoRoot,
	findToggleableCatalogSource,
	listAgentDataSources,
	readAgentDataManifest,
} from "../../../src/state/agent-data-manifest";

/** Every asset root this repo actually contains, so nothing can go unlisted. */
function agentDataSubdirectories(repoRoot: string): string[] {
	const found: string[] = [];
	for (const group of ["catalog", "runtime", "templates"]) {
		const groupDir = join(repoRoot, "agent-data", group);
		if (!existsSync(groupDir)) {
			continue;
		}
		found.push(`agent-data/${group}`);
	}
	return found;
}

function backendAssetDirectories(repoRoot: string): string[] {
	const backendsDir = join(repoRoot, "backends");
	const found: string[] = [];
	for (const entry of readdirSync(backendsDir, { withFileTypes: true })) {
		if (!entry.isDirectory()) {
			continue;
		}
		for (const rootName of [".claude", ".agent"]) {
			if (existsSync(join(backendsDir, entry.name, rootName))) {
				found.push(`backends/${entry.name}/${rootName}`);
			}
		}
	}
	return found;
}

describe("agent-data manifest", () => {
	it("resolves the repo root from the runtime package", () => {
		const repoRoot = findAgentDataRepoRoot();
		expect(repoRoot).not.toBeNull();
		expect(existsSync(join(repoRoot as string, "agent-data", "manifest.json"))).toBe(true);
	});

	it("declares every agent-data group that exists on disk", async () => {
		const repoRoot = findAgentDataRepoRoot() as string;
		const sources = await listAgentDataSources(repoRoot);
		// A source may declare a group directly (`agent-data/catalog`) or a path
		// inside it (`agent-data/templates/skills`) — either one covers the group.
		for (const group of agentDataSubdirectories(repoRoot)) {
			const covered = sources.some((source) => source.root === group || source.root.startsWith(`${group}/`));
			expect(covered, `${group} is not declared in agent-data/manifest.json`).toBe(true);
		}
	});

	it("covers every backends/*/.claude and backends/*/.agent directory", async () => {
		const repoRoot = findAgentDataRepoRoot() as string;
		const sources = await listAgentDataSources(repoRoot);
		for (const root of backendAssetDirectories(repoRoot)) {
			const source = sources.find((candidate) => candidate.root === root);
			expect(source, `${root} is neither declared nor discovered`).toBeDefined();
			// Per-backend dirs are bound to that backend's role — never shelf-toggleable.
			expect(source?.toggleable).toBe(false);
		}
	});

	it("marks every manifest source present in this checkout", async () => {
		const repoRoot = findAgentDataRepoRoot() as string;
		const sources = await listAgentDataSources(repoRoot);
		const missing = sources.filter((source) => !source.present).map((source) => source.root);
		expect(missing).toEqual([]);
	});

	it("exposes exactly one toggleable catalog source", async () => {
		const repoRoot = findAgentDataRepoRoot() as string;
		const sources = await listAgentDataSources(repoRoot);
		const toggleable = sources.filter((source) => source.toggleable);
		expect(toggleable.map((source) => source.root)).toEqual(["agent-data/catalog"]);

		const catalog = await findToggleableCatalogSource(repoRoot);
		expect(catalog?.id).toBe("manager-catalog");
		// The Manager shelves read these four; a move that breaks one is a silent
		// empty shelf, which is what the Workflows shelf did before this change.
		for (const kind of ["skills", "agents", "commands", "rules"]) {
			expect(existsSync(join(catalog?.absolutePath as string, kind)), `catalog/${kind}`).toBe(true);
		}
	});

	it("keeps html_anything's template skills resolvable and non-empty", async () => {
		const repoRoot = findAgentDataRepoRoot() as string;
		const sources = await listAgentDataSources(repoRoot);
		const templates = sources.find((source) => source.id === "html-anything-templates");
		expect(templates?.present).toBe(true);
		expect(templates?.toggleable).toBe(false);
		// loader.ts reads this directory. It used to be joined onto `process.cwd()`, so an
		// empty result here is exactly the silent breakage the resolver replaced.
		expect(readdirSync(templates?.absolutePath as string).length).toBeGreaterThan(50);
	});

	it("discovers a newly added backend's assets without a manifest edit", async () => {
		const fakeRepo = await mkdtemp(join(tmpdir(), "agent-data-manifest-"));
		await mkdir(join(fakeRepo, "agent-data"), { recursive: true });
		await mkdir(join(fakeRepo, "agent-data", "catalog"), { recursive: true });
		await mkdir(join(fakeRepo, "backends", "future_thing", ".claude"), { recursive: true });
		await writeFile(
			join(fakeRepo, "agent-data", "manifest.json"),
			JSON.stringify({
				version: 1,
				sources: [
					{
						id: "manager-catalog",
						root: "agent-data/catalog",
						owner: "manager",
						kinds: ["skill"],
						toggleable: true,
					},
				],
			}),
			"utf8",
		);

		const sources = await listAgentDataSources(fakeRepo);
		const discovered = sources.find((source) => source.root === "backends/future_thing/.claude");
		expect(discovered?.owner).toBe("future_thing");
		expect(discovered?.discovered).toBe(true);
		expect(discovered?.toggleable).toBe(false);
	});

	it("lets a manifest entry override a discoverable backend root", async () => {
		const fakeRepo = await mkdtemp(join(tmpdir(), "agent-data-manifest-override-"));
		await mkdir(join(fakeRepo, "agent-data"), { recursive: true });
		await mkdir(join(fakeRepo, "backends", "future_thing", ".claude"), { recursive: true });
		await writeFile(
			join(fakeRepo, "agent-data", "manifest.json"),
			JSON.stringify({
				version: 1,
				sources: [
					{
						id: "future-thing-optin",
						root: "backends/future_thing/.claude",
						owner: "future_thing",
						kinds: ["skill"],
						toggleable: true,
					},
				],
			}),
			"utf8",
		);

		const sources = await listAgentDataSources(fakeRepo);
		const matching = sources.filter((source) => source.root === "backends/future_thing/.claude");
		expect(matching).toHaveLength(1);
		expect(matching[0]?.toggleable).toBe(true);
		expect(matching[0]?.discovered).toBe(false);
	});

	it("rejects a manifest with an unknown version", async () => {
		const fakeRepo = await mkdtemp(join(tmpdir(), "agent-data-manifest-bad-"));
		await mkdir(join(fakeRepo, "agent-data"), { recursive: true });
		await writeFile(
			join(fakeRepo, "agent-data", "manifest.json"),
			JSON.stringify({ version: 2, sources: [] }),
			"utf8",
		);
		await expect(readAgentDataManifest(fakeRepo)).rejects.toThrow();
	});
});
