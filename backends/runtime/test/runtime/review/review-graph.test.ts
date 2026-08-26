import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	clearReviewGraphCache,
	computeReviewGraphImpact,
	loadReviewGraphIndex,
	matchChangedPathNodeIds,
	type ReviewGraphIndex,
	resolveReviewGraphLocation,
	writeReviewGraphDiffOverlay,
} from "../../../src/review/review-graph";
import { formatGraphImpactForPrompt } from "../../../src/review/review-prompts";

/**
 * A graph shaped like the real ones: a file node per file, `contains` edges down to
 * its functions, and `imports` edges between files. The `contains`/`imports` split
 * is the important part — in `akselos-dev` those two are 24 530 and 10 120 of the
 * 34 663 edges, so treating `contains` as impact is what would drown the answer.
 */
function graphDocument(): unknown {
	return {
		version: "1.0.0",
		project: {
			name: "sample",
			languages: ["python"],
			frameworks: [],
			gitCommitHash: "0000000000000000000000000000000000000000",
		},
		nodes: [
			{ id: "file:src/core.py", type: "file", name: "core.py", filePath: "src/core.py", summary: "Core." },
			{
				id: "function:src/core.py:solve",
				type: "function",
				name: "solve",
				filePath: "src/core.py",
				summary: "Solves it.",
				complexity: 7,
			},
			{ id: "file:src/api.py", type: "file", name: "api.py", filePath: "src/api.py", summary: "HTTP layer." },
			{
				id: "function:src/api.py:handler",
				type: "function",
				name: "handler",
				filePath: "src/api.py",
				summary: "Calls solve.",
				complexity: 3,
			},
			{ id: "file:src/unrelated.py", type: "file", name: "unrelated.py", filePath: "src/unrelated.py" },
			{ id: "file:tests/test_core.py", type: "file", name: "test_core.py", filePath: "tests/test_core.py" },
		],
		edges: [
			{ source: "file:src/core.py", target: "function:src/core.py:solve", type: "contains", weight: 1 },
			{ source: "file:src/api.py", target: "function:src/api.py:handler", type: "contains", weight: 1 },
			{ source: "file:src/api.py", target: "file:src/core.py", type: "imports", weight: 3 },
			{ source: "function:src/api.py:handler", target: "function:src/core.py:solve", type: "calls", weight: 1 },
			{ source: "file:tests/test_core.py", target: "file:src/core.py", type: "imports", weight: 1 },
			{ source: "file:src/unrelated.py", target: "file:tests/test_core.py", type: "imports", weight: 9 },
		],
		layers: [
			{ id: "layer:core", name: "Core", description: "Solver core", nodeIds: ["file:src/core.py"] },
			{ id: "layer:api", name: "API", nodeIds: ["file:src/api.py"] },
			{ id: "layer:cold", name: "Cold", nodeIds: ["file:src/unrelated.py"] },
		],
		tour: [],
	};
}

let projectDir: string;

async function writeGraph(dirName: string, document: unknown): Promise<void> {
	const dataDir = path.join(projectDir, dirName);
	await mkdir(dataDir, { recursive: true });
	await writeFile(path.join(dataDir, "knowledge-graph.json"), JSON.stringify(document), "utf8");
}

async function loadIndex(): Promise<ReviewGraphIndex> {
	const loaded = await loadReviewGraphIndex(projectDir);
	if (loaded.index === null) {
		throw new Error(`expected an index, got error: ${loaded.error ?? "none"}`);
	}
	return loaded.index;
}

beforeEach(async () => {
	clearReviewGraphCache();
	projectDir = await mkdtemp(path.join(tmpdir(), "review-graph-"));
});

afterEach(async () => {
	clearReviewGraphCache();
	await rm(projectDir, { recursive: true, force: true });
});

describe("resolveReviewGraphLocation", () => {
	it("returns null when the project has never been analyzed", async () => {
		expect(await resolveReviewGraphLocation(projectDir)).toBeNull();
	});

	it("prefers the legacy .understand-anything directory over .ua", async () => {
		await writeGraph(".ua", graphDocument());
		await writeGraph(".understand-anything", graphDocument());

		const location = await resolveReviewGraphLocation(projectDir);

		expect(location?.dataDir).toBe(path.join(projectDir, ".understand-anything"));
	});
});

describe("loadReviewGraphIndex", () => {
	it("indexes nodes by file path and keeps containment out of the impact edges", async () => {
		await writeGraph(".ua", graphDocument());

		const index = await loadIndex();

		expect(index.nodeCount).toBe(6);
		expect(index.edgeCount).toBe(6);
		expect(index.nodeIdsByFilePath.get("src/core.py")).toEqual(["file:src/core.py", "function:src/core.py:solve"]);
		expect(index.containedNodeIds.get("file:src/core.py")).toEqual(["function:src/core.py:solve"]);
		expect(index.impactEdges.map((edge) => edge.type).sort()).toEqual(["calls", "imports", "imports", "imports"]);
	});

	it("reports a parse failure instead of throwing", async () => {
		const dataDir = path.join(projectDir, ".ua");
		await mkdir(dataDir, { recursive: true });
		await writeFile(path.join(dataDir, "knowledge-graph.json"), "{ not json", "utf8");

		const loaded = await loadReviewGraphIndex(projectDir);

		expect(loaded.index).toBeNull();
		expect(loaded.error).toBeTruthy();
	});

	it("re-reads the graph after a rebuild rewrites it", async () => {
		await writeGraph(".ua", graphDocument());
		const first = await loadIndex();
		expect(first.nodeCount).toBe(6);

		const rebuilt = graphDocument() as { nodes: unknown[] };
		rebuilt.nodes = rebuilt.nodes.slice(0, 2);
		// mtime granularity can be coarse enough to collide within one test tick, and
		// the cache key includes size, which this changes too.
		await writeGraph(".ua", rebuilt);

		const second = await loadIndex();

		expect(second.nodeCount).toBe(2);
	});
});

describe("matchChangedPathNodeIds", () => {
	it("matches an exact repo-relative path", async () => {
		await writeGraph(".ua", graphDocument());
		const index = await loadIndex();

		expect(matchChangedPathNodeIds(index, "src/api.py")).toEqual(["file:src/api.py", "function:src/api.py:handler"]);
	});

	it("falls back to a path suffix, so a graph built from a subdirectory still matches", async () => {
		await writeGraph(".ua", graphDocument());
		const index = await loadIndex();

		// What a merge request looks like when the graph was built one level down.
		expect(matchChangedPathNodeIds(index, "repo-root/src/api.py")).toEqual([]);
		expect(matchChangedPathNodeIds(index, "SRC/API.PY")).toEqual(["file:src/api.py", "function:src/api.py:handler"]);
	});

	it("returns nothing for a path the graph has never seen", async () => {
		await writeGraph(".ua", graphDocument());
		const index = await loadIndex();

		expect(matchChangedPathNodeIds(index, "src/brand_new.py")).toEqual([]);
	});
});

describe("computeReviewGraphImpact", () => {
	it("reports one hop of dependents, not the changed file's own members", async () => {
		await writeGraph(".ua", graphDocument());
		const index = await loadIndex();

		const impact = computeReviewGraphImpact(index, ["src/core.py"]);

		// `solve` matched the path too, but its own file matched and contains it, so it
		// is not worth a line of its own.
		expect(impact.changed.map((component) => component.nodeId)).toEqual(["file:src/core.py"]);
		// `solve` is contained by the changed file, so it must not be listed as affected.
		expect(impact.affected.map((component) => component.nodeId).sort()).toEqual([
			"file:src/api.py",
			"file:tests/test_core.py",
			"function:src/api.py:handler",
		]);
		// Two hops away — reachable only through `tests/test_core.py`.
		expect(impact.affectedNodeIds).not.toContain("file:src/unrelated.py");
	});

	it("names the edge each dependent was reached by", async () => {
		await writeGraph(".ua", graphDocument());
		const index = await loadIndex();

		const impact = computeReviewGraphImpact(index, ["src/core.py"]);
		const api = impact.affected.find((component) => component.nodeId === "file:src/api.py");

		expect(api?.via).toBe("imports");
		expect(api?.direction).toBe("dependent");
		expect(api?.fromNodeId).toBe("file:src/core.py");
	});

	it("separates what the change relies on from what relies on the change", async () => {
		await writeGraph(".ua", graphDocument());
		const index = await loadIndex();

		// `api.py` imports `core.py`, so changing `api.py` puts nothing at risk in
		// `core.py` — it is a dependency, and listing it as blast radius would send
		// the reviewer to check a file the change cannot have broken.
		const impact = computeReviewGraphImpact(index, ["src/api.py"]);

		expect(impact.affected.map((component) => component.nodeId)).toEqual([]);
		expect(impact.dependencies.map((component) => component.nodeId).sort()).toEqual([
			"file:src/core.py",
			"function:src/core.py:solve",
		]);
		expect(impact.dependencies[0]?.direction).toBe("dependency");
		// The overlay highlights dependents only.
		expect(impact.affectedNodeIds).toEqual([]);
	});

	it("treats a test that exercises the change as a dependent, not a dependency", async () => {
		const document = graphDocument() as { edges: Array<Record<string, unknown>> };
		document.edges = [
			{ source: "file:src/core.py", target: "function:src/core.py:solve", type: "contains", weight: 1 },
			{ source: "file:src/core.py", target: "file:tests/test_core.py", type: "tested_by", weight: 1 },
		];
		await writeGraph(".ua", document);
		const index = await loadIndex();

		const impact = computeReviewGraphImpact(index, ["src/core.py"]);

		expect(impact.affected.map((component) => component.nodeId)).toEqual(["file:tests/test_core.py"]);
		expect(impact.affected[0]?.direction).toBe("dependent");
		expect(impact.dependencies).toEqual([]);
	});

	it("caps dependencies separately from dependents", async () => {
		await writeGraph(".ua", graphDocument());
		const index = await loadIndex();

		const impact = computeReviewGraphImpact(index, ["src/api.py"], { maxDependencies: 1 });

		expect(impact.dependencies).toHaveLength(1);
		expect(impact.dependenciesOmitted).toBe(1);
	});

	it("lists only the layers the change actually reaches", async () => {
		await writeGraph(".ua", graphDocument());
		const index = await loadIndex();

		const impact = computeReviewGraphImpact(index, ["src/core.py"]);

		expect(impact.layers.map((layer) => layer.id).sort()).toEqual(["layer:api", "layer:core"]);
	});

	it("collects paths the graph has no node for, so the brief can admit the gap", async () => {
		await writeGraph(".ua", graphDocument());
		const index = await loadIndex();

		const impact = computeReviewGraphImpact(index, ["src/core.py", "src/brand_new.py"]);

		expect(impact.unmatchedPaths).toEqual(["src/brand_new.py"]);
	});

	it("caps the affected list and says how much it dropped", async () => {
		await writeGraph(".ua", graphDocument());
		const index = await loadIndex();

		const impact = computeReviewGraphImpact(index, ["src/core.py"], { maxAffected: 1 });

		expect(impact.affected).toHaveLength(1);
		expect(impact.affectedOmitted).toBe(2);
		// Highest edge weight wins the single slot.
		expect(impact.affected[0]?.nodeId).toBe("file:src/api.py");
	});

	it("reports nothing affected when nothing depends on the change", async () => {
		await writeGraph(".ua", graphDocument());
		const index = await loadIndex();

		// Nothing imports `unrelated.py`; it only imports outwards itself.
		const impact = computeReviewGraphImpact(index, ["src/unrelated.py"]);

		expect(impact.changed.map((component) => component.nodeId)).toEqual(["file:src/unrelated.py"]);
		expect(impact.affected).toEqual([]);
		expect(impact.dependencies.map((component) => component.nodeId)).toEqual(["file:tests/test_core.py"]);
	});
});

describe("formatGraphImpactForPrompt", () => {
	it("tells the agent the walk is already done and names the gaps", async () => {
		await writeGraph(".ua", graphDocument());
		const index = await loadIndex();
		const impact = computeReviewGraphImpact(index, ["src/core.py", "src/brand_new.py"], { maxAffected: 1 });

		const text = formatGraphImpactForPrompt({
			impact,
			freshness: {
				graphCommit: "abcdef1234567890",
				headCommit: "1234567890abcdef",
				changedSinceGraph: ["src/core.py"],
				changedSinceGraphCount: 1,
				isStale: true,
			},
		});

		expect(text).toContain("do not search the repository");
		expect(text).toContain("src/api.py");
		expect(text).toContain("reached via `imports`");
		expect(text).toContain("2 further dependents omitted");
		expect(text).toContain("src/brand_new.py");
		expect(text).toContain("may be incomplete");
	});

	it("labels the dependency section as context rather than blast radius", async () => {
		await writeGraph(".ua", graphDocument());
		const index = await loadIndex();
		const impact = computeReviewGraphImpact(index, ["src/api.py"]);

		const text = formatGraphImpactForPrompt({ impact, freshness: null });

		expect(text).toContain("context, not blast radius");
		expect(text).toContain("None: nothing in the graph depends on the changed nodes.");
	});
});

describe("writeReviewGraphDiffOverlay", () => {
	it("writes the shape the dashboard reads and never repeats a changed node as affected", async () => {
		await writeGraph(".ua", graphDocument());
		const dataDir = path.join(projectDir, ".ua");

		await writeReviewGraphDiffOverlay({
			dataDir,
			baseBranch: "main",
			generatedAt: "2026-08-26T00:00:00.000Z",
			changedPaths: ["src/core.py"],
			changedNodeIds: ["file:src/core.py"],
			affectedNodeIds: ["file:src/core.py", "file:src/api.py"],
		});

		const written = JSON.parse(await readFile(path.join(dataDir, "diff-overlay.json"), "utf8"));

		expect(written).toEqual({
			version: "1.0.0",
			baseBranch: "main",
			generatedAt: "2026-08-26T00:00:00.000Z",
			changedFiles: ["src/core.py"],
			changedNodeIds: ["file:src/core.py"],
			affectedNodeIds: ["file:src/api.py"],
		});
	});
});
