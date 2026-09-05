/**
 * Blast-radius analysis for a merge request, computed from the project's
 * Understand Anything knowledge graph.
 *
 * This exists to keep the review agents *out* of the graph file. `akselos-dev`'s
 * `.ua/knowledge-graph.json` is 24 MB / 33 500 nodes; the `understand-diff` skill
 * answers "what else does this touch" by grepping that JSON from inside the agent,
 * which is both slow and the single most expensive thing a review turn can do. The
 * walk itself is deterministic — match changed paths to nodes, follow one hop of
 * dependency edges, name the layers — so it belongs in TypeScript, and the agent
 * gets a few kilobytes of prose instead of a search budget.
 *
 * Nothing here reads the working tree except `readReviewGraphFreshness`, which
 * only asks git what moved since the graph was built.
 */
import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { runGit } from "../workspace/git-utils";

/**
 * Legacy directory first, matching the viewer and every `understand-*` skill: a
 * project analyzed before the `.ua` rename keeps its `.understand-anything/`, and
 * picking the new name when both exist would read a graph nobody is updating.
 */
export const UA_DATA_DIR_CANDIDATES = [".understand-anything", ".ua"] as const;

export const KNOWLEDGE_GRAPH_FILE_NAME = "knowledge-graph.json";
export const DIFF_OVERLAY_FILE_NAME = "diff-overlay.json";

/**
 * Edge types that mean "if the source changes, the target may care". Deliberately
 * excludes `contains` and `exports`: those link a file to the functions declared
 * inside it, so counting them as impact makes every changed file "affect" its own
 * contents and drowns the real callers. `contains` is still read, separately, to
 * expand a changed file into its members.
 */
export const GRAPH_IMPACT_EDGE_TYPES: ReadonlySet<string> = new Set([
	"imports",
	"calls",
	"depends_on",
	"configures",
	"documents",
	"deploys",
	"triggers",
	"related",
	"tested_by",
	"cites",
]);

/** Structural edges: a file to the functions/classes declared in it. */
const GRAPH_CONTAINMENT_EDGE_TYPES: ReadonlySet<string> = new Set(["contains"]);

/**
 * Which end of an edge is the one that would break.
 *
 * This distinction is the difference between a useful brief and a misleading one.
 * `a imports b` means *a* depends on *b*: if `b` changed, `a` may break, but if `a`
 * changed, `b` is merely something `a` relies on and is almost certainly fine.
 * Reporting both as "affected" — which is what a naive symmetric walk does, and
 * what the `understand-diff` skill's wording invites — puts the change's own
 * dependencies in the list of things to check.
 *
 * `tested_by` runs the other way: `a tested_by b` means `b` exercises `a`, so a
 * change to `a` puts `b` at risk. `akselos-dev`'s graph has exactly three edge
 * types — `contains`, `imports`, `tested_by` — so both directions are load-bearing
 * there.
 */
const DEPENDENT_IS_EDGE_SOURCE: ReadonlySet<string> = new Set([
	"imports",
	"calls",
	"depends_on",
	"configures",
	"documents",
	"cites",
]);
const DEPENDENT_IS_EDGE_TARGET: ReadonlySet<string> = new Set(["tested_by", "deploys", "triggers"]);

/** How a neighbour relates to the change. */
export type ReviewGraphImpactDirection =
	/** Depends on the changed code: what may break. */
	| "dependent"
	/** The changed code depends on it: context, not blast radius. */
	| "dependency"
	/** The graph does not say which way round it is (`related`). */
	| "related";

export function classifyImpactDirection(input: {
	edgeType: string;
	changedEndIsSource: boolean;
}): ReviewGraphImpactDirection {
	if (DEPENDENT_IS_EDGE_SOURCE.has(input.edgeType)) {
		// The source depends on the target, so the *other* end is a dependent exactly
		// when the changed end was the target.
		return input.changedEndIsSource ? "dependency" : "dependent";
	}
	if (DEPENDENT_IS_EDGE_TARGET.has(input.edgeType)) {
		return input.changedEndIsSource ? "dependent" : "dependency";
	}
	return "related";
}

/**
 * Refuse rather than parse. `JSON.parse` peaks at several times the file size, and
 * a runtime that OOMs while answering a review question is worse than one that
 * says the graph is too big — `akselos-dev` is 24 MB, so this is 8x headroom, not
 * a limit anyone is expected to hit.
 */
export const MAX_KNOWLEDGE_GRAPH_BYTES = 192 * 1024 * 1024;

/** How many dependents reach the prompt. Past this the brief stops being a brief. */
export const DEFAULT_MAX_AFFECTED_NODES = 40;
/**
 * Dependencies get a much smaller slice than dependents. They are context for
 * reading the change rather than things to go and check, and a changed file's
 * import list is long and mostly uninteresting.
 */
export const DEFAULT_MAX_DEPENDENCY_NODES = 12;
/** Summary text is the useful part of a node, but a full one is a paragraph. */
const SUMMARY_BUDGET = 220;

export interface ReviewGraphProject {
	name?: string;
	description?: string;
	languages?: string[];
	frameworks?: string[];
	analyzedAt?: string;
	gitCommitHash?: string;
}

export interface ReviewGraphNode {
	id: string;
	type: string;
	name: string;
	filePath?: string;
	summary?: string;
	complexity?: number | string;
	/**
	 * Where in the file it is declared, when the graph recorded it. Frequently absent
	 * — `akselos-dev`'s 33 500 nodes carry none at all, while this repo's carry them
	 * for four fifths — so every reader has to treat it as a bonus, not a field.
	 */
	lineRange?: readonly [number, number];
}

interface RawGraphEdge {
	source?: unknown;
	target?: unknown;
	type?: unknown;
	weight?: unknown;
}

interface RawGraphLayer {
	id?: unknown;
	name?: unknown;
	description?: unknown;
	nodeIds?: unknown;
}

export interface ReviewGraphLayer {
	id: string;
	name: string;
	description?: string;
	nodeIds: Set<string>;
}

/**
 * A dependency edge, reduced to what impact needs. `weight` survives because it is
 * the only ranking signal the graph offers for "how strongly connected".
 */
export interface ReviewGraphImpactEdge {
	source: string;
	target: string;
	type: string;
	weight: number;
}

/**
 * The parsed graph, reduced to lookups and dropped. Holding the raw document would
 * pin ~10x the file size in heap for the lifetime of the cache; this keeps node
 * metadata (with truncated summaries) plus two adjacency lists, which for
 * `akselos-dev` is a few MB rather than a few hundred.
 */
export interface ReviewGraphIndex {
	projectPath: string;
	dataDir: string;
	graphPath: string;
	project: ReviewGraphProject;
	nodeCount: number;
	edgeCount: number;
	nodesById: Map<string, ReviewGraphNode>;
	/** Repo-relative POSIX path to every node declared in that file. */
	nodeIdsByFilePath: Map<string, string[]>;
	/** Lowercased path suffix index, for the mismatched-root fallback. */
	nodeIdsByLowerFilePath: Map<string, string[]>;
	/**
	 * Lowercased node name to the ids declaring it, for the symbol locator. Names are
	 * far from unique — 92% of `akselos-dev`'s 27 600 distinct names resolve to one
	 * node, but `go` resolves to 432 — so the value is a list and every reader has to
	 * handle ambiguity rather than take the first.
	 */
	nodeIdsByLowerName: Map<string, string[]>;
	/** File node id to the ids it `contains`. */
	containedNodeIds: Map<string, string[]>;
	impactEdges: ReviewGraphImpactEdge[];
	layers: ReviewGraphLayer[];
}

export interface ReviewGraphLocation {
	dataDir: string;
	graphPath: string;
}

/**
 * Finds the project's graph, or null when it has never been analyzed. Callers treat
 * null as "answer without a graph" — a missing graph must never fail a review.
 */
export async function resolveReviewGraphLocation(projectPath: string): Promise<ReviewGraphLocation | null> {
	for (const candidate of UA_DATA_DIR_CANDIDATES) {
		const dataDir = path.join(projectPath, candidate);
		const graphPath = path.join(dataDir, KNOWLEDGE_GRAPH_FILE_NAME);
		try {
			const stats = await stat(graphPath);
			if (stats.isFile()) {
				return { dataDir, graphPath };
			}
		} catch {
			// Next candidate.
		}
	}
	return null;
}

function truncateSummary(value: unknown): string | undefined {
	if (typeof value !== "string" || value.length === 0) {
		return undefined;
	}
	return value.length <= SUMMARY_BUDGET ? value : `${value.slice(0, SUMMARY_BUDGET - 1).trimEnd()}…`;
}

/** Graph paths are POSIX and repo-relative; a Windows-authored graph is not. */
function normalizeGraphFilePath(value: unknown): string | undefined {
	if (typeof value !== "string" || value.length === 0) {
		return undefined;
	}
	return value.split("\\").join("/").replace(/^\.\//, "");
}

function toWeight(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 1;
}

/** `[start, end]` as the generator writes it, or nothing. Never a partial range. */
function normalizeLineRange(value: unknown): readonly [number, number] | undefined {
	if (!Array.isArray(value) || value.length < 2) {
		return undefined;
	}
	const [start, end] = value;
	if (typeof start !== "number" || typeof end !== "number" || !Number.isFinite(start) || !Number.isFinite(end)) {
		return undefined;
	}
	return [start, end];
}

function buildIndex(input: {
	projectPath: string;
	dataDir: string;
	graphPath: string;
	raw: unknown;
}): ReviewGraphIndex {
	const document = (input.raw ?? {}) as {
		project?: ReviewGraphProject;
		nodes?: unknown;
		edges?: unknown;
		layers?: unknown;
	};
	const rawNodes = Array.isArray(document.nodes) ? document.nodes : [];
	const rawEdges = Array.isArray(document.edges) ? document.edges : [];
	const rawLayers = Array.isArray(document.layers) ? document.layers : [];

	const nodesById = new Map<string, ReviewGraphNode>();
	const nodeIdsByFilePath = new Map<string, string[]>();
	const nodeIdsByLowerFilePath = new Map<string, string[]>();
	const nodeIdsByLowerName = new Map<string, string[]>();

	for (const candidate of rawNodes) {
		const raw = candidate as Record<string, unknown>;
		const id = typeof raw.id === "string" ? raw.id : null;
		if (id === null || id.length === 0) {
			continue;
		}
		const filePath = normalizeGraphFilePath(raw.filePath);
		const lineRange = normalizeLineRange(raw.lineRange);
		const node: ReviewGraphNode = {
			id,
			type: typeof raw.type === "string" ? raw.type : "node",
			name: typeof raw.name === "string" ? raw.name : id,
			...(filePath ? { filePath } : {}),
			...(truncateSummary(raw.summary) ? { summary: truncateSummary(raw.summary) } : {}),
			...(typeof raw.complexity === "number" || typeof raw.complexity === "string"
				? { complexity: raw.complexity }
				: {}),
			...(lineRange ? { lineRange } : {}),
		};
		nodesById.set(id, node);
		const lowerName = node.name.toLowerCase();
		if (lowerName.length > 0) {
			const existingName = nodeIdsByLowerName.get(lowerName);
			if (existingName) {
				existingName.push(id);
			} else {
				nodeIdsByLowerName.set(lowerName, [id]);
			}
		}
		if (filePath) {
			const existing = nodeIdsByFilePath.get(filePath);
			if (existing) {
				existing.push(id);
			} else {
				nodeIdsByFilePath.set(filePath, [id]);
			}
			const lower = filePath.toLowerCase();
			const existingLower = nodeIdsByLowerFilePath.get(lower);
			if (existingLower) {
				existingLower.push(id);
			} else {
				nodeIdsByLowerFilePath.set(lower, [id]);
			}
		}
	}

	const impactEdges: ReviewGraphImpactEdge[] = [];
	const containedNodeIds = new Map<string, string[]>();
	for (const candidate of rawEdges) {
		const raw = candidate as RawGraphEdge;
		const source = typeof raw.source === "string" ? raw.source : null;
		const target = typeof raw.target === "string" ? raw.target : null;
		const type = typeof raw.type === "string" ? raw.type : null;
		if (source === null || target === null || type === null) {
			continue;
		}
		if (GRAPH_CONTAINMENT_EDGE_TYPES.has(type)) {
			const existing = containedNodeIds.get(source);
			if (existing) {
				existing.push(target);
			} else {
				containedNodeIds.set(source, [target]);
			}
			continue;
		}
		if (!GRAPH_IMPACT_EDGE_TYPES.has(type)) {
			continue;
		}
		impactEdges.push({ source, target, type, weight: toWeight(raw.weight) });
	}

	const layers: ReviewGraphLayer[] = [];
	for (const candidate of rawLayers) {
		const raw = candidate as RawGraphLayer;
		const id = typeof raw.id === "string" ? raw.id : null;
		if (id === null) {
			continue;
		}
		const nodeIds = Array.isArray(raw.nodeIds)
			? raw.nodeIds.filter((value): value is string => typeof value === "string")
			: [];
		layers.push({
			id,
			name: typeof raw.name === "string" ? raw.name : id,
			...(typeof raw.description === "string" ? { description: raw.description } : {}),
			nodeIds: new Set(nodeIds),
		});
	}

	return {
		projectPath: input.projectPath,
		dataDir: input.dataDir,
		graphPath: input.graphPath,
		project: document.project ?? {},
		nodeCount: nodesById.size,
		edgeCount: rawEdges.length,
		nodesById,
		nodeIdsByFilePath,
		nodeIdsByLowerFilePath,
		nodeIdsByLowerName,
		containedNodeIds,
		impactEdges,
		layers,
	};
}

interface CacheEntry {
	key: string;
	index: ReviewGraphIndex;
}

/**
 * One graph at a time, keyed by path + mtime + size. Two of these repos are 24 MB
 * each, and the reviewer only ever looks at one project's merge request, so a
 * second slot buys a rare hit for a large permanent cost. A rebuild by
 * `/understand` changes mtime, which is what invalidates this.
 */
let cachedGraph: CacheEntry | null = null;

/** Test seam. */
export function clearReviewGraphCache(): void {
	cachedGraph = null;
}

export interface LoadReviewGraphResult {
	index: ReviewGraphIndex | null;
	/** Set when a graph exists but could not be used, for the UI to show verbatim. */
	error?: string;
}

export async function loadReviewGraphIndex(projectPath: string): Promise<LoadReviewGraphResult> {
	const location = await resolveReviewGraphLocation(projectPath);
	if (location === null) {
		return { index: null };
	}
	let stats: Awaited<ReturnType<typeof stat>>;
	try {
		stats = await stat(location.graphPath);
	} catch (error) {
		return { index: null, error: error instanceof Error ? error.message : String(error) };
	}
	if (stats.size > MAX_KNOWLEDGE_GRAPH_BYTES) {
		return {
			index: null,
			error: `Knowledge graph is ${Math.round(stats.size / (1024 * 1024))} MB, larger than the ${Math.round(
				MAX_KNOWLEDGE_GRAPH_BYTES / (1024 * 1024),
			)} MB cap this runtime will parse.`,
		};
	}

	const key = `${location.graphPath}:${stats.mtimeMs}:${stats.size}`;
	if (cachedGraph && cachedGraph.key === key) {
		return { index: cachedGraph.index };
	}

	let raw: unknown;
	try {
		raw = JSON.parse(await readFile(location.graphPath, "utf8"));
	} catch (error) {
		return { index: null, error: error instanceof Error ? error.message : String(error) };
	}
	const index = buildIndex({ projectPath, dataDir: location.dataDir, graphPath: location.graphPath, raw });
	cachedGraph = { key, index };
	return { index };
}

/**
 * Maps a changed path to the graph's nodes.
 *
 * The exact match is the normal case: both the graph and GitLab speak
 * repo-relative POSIX. The lowercase retry covers a graph built on a
 * case-insensitive filesystem, and the suffix retry covers a graph built from a
 * subdirectory of the repo the merge request is against — which is exactly the
 * `akselos-dev` / `akselos-master` shape, where two checkouts share one remote.
 */
export function matchChangedPathNodeIds(index: ReviewGraphIndex, changedPath: string): string[] {
	const normalized = normalizeGraphFilePath(changedPath);
	if (normalized === undefined) {
		return [];
	}
	const exact = index.nodeIdsByFilePath.get(normalized);
	if (exact) {
		return exact;
	}
	const lower = index.nodeIdsByLowerFilePath.get(normalized.toLowerCase());
	if (lower) {
		return lower;
	}
	const suffix = `/${normalized.toLowerCase()}`;
	const matches: string[] = [];
	for (const [candidate, ids] of index.nodeIdsByLowerFilePath) {
		if (candidate.endsWith(suffix)) {
			matches.push(...ids);
		}
	}
	return matches;
}

/**
 * Above this many nodes sharing a name, the graph cannot locate anything useful and
 * says so instead. Picked off the data: it excludes exactly the 27 `akselos-dev`
 * names that are pure noise (`go` at 432, `get_parser` at 373, `run` at 49) while
 * keeping the 105 names in the 6-20 band listable at four-of-N.
 */
export const AMBIGUOUS_SYMBOL_THRESHOLD = 20;
/** How many definitions of one name reach the prompt before it says "and N more". */
export const MAX_DEFINITIONS_PER_SYMBOL = 4;
/**
 * How many distinct names one turn may look up. A question naming more than a handful
 * of symbols is not a question about a symbol, and the extractor's no-backtick
 * fallback is a heuristic that must not be allowed to fill the section on its own.
 */
export const MAX_LOOKUP_SYMBOLS = 6;

export interface ReviewGraphSymbolDefinition {
	nodeId: string;
	type: string;
	name: string;
	filePath?: string;
	summary?: string;
	complexity?: number | string;
	lineRange?: readonly [number, number];
}

export interface ReviewGraphSymbolLookup {
	/** The name as the reviewer wrote it, so the prompt can echo their spelling. */
	name: string;
	kind: "found" | "ambiguous" | "absent";
	/** Every node sharing the name, before `MAX_DEFINITIONS_PER_SYMBOL` truncation. */
	totalMatches: number;
	definitions: ReviewGraphSymbolDefinition[];
}

/**
 * Locates named symbols in the graph. A *locator*, deliberately not a describer.
 *
 * The graph records no signature, no parameter list and no return type — not in this
 * repo's and not in `akselos-dev`'s — so this can never answer "what does this
 * return". What it answers is "which file is this in", which is the question standing
 * between the agent and a targeted `Read` it is already allowed to do. That is the
 * whole value: `get_empirical_data_dir` resolves to two files in `akselos-dev`, and
 * knowing which two is the difference between reading one and hedging.
 *
 * Exact lowercase lookup only. No prefix, substring or fuzzy matching: the one linear
 * scan in this module is per changed *path* over a bounded list, and doing the same
 * per prompt token over 33 500 names is the sweep the whole module exists to avoid.
 */
export function lookupReviewGraphSymbols(
	index: ReviewGraphIndex,
	names: readonly string[],
	options?: { maxDefinitions?: number; ambiguousThreshold?: number },
): ReviewGraphSymbolLookup[] {
	const maxDefinitions = options?.maxDefinitions ?? MAX_DEFINITIONS_PER_SYMBOL;
	const ambiguousThreshold = options?.ambiguousThreshold ?? AMBIGUOUS_SYMBOL_THRESHOLD;
	const lookups: ReviewGraphSymbolLookup[] = [];
	const seen = new Set<string>();

	for (const name of names) {
		const trimmed = name.trim();
		const lower = trimmed.toLowerCase();
		if (lower.length === 0 || seen.has(lower)) {
			continue;
		}
		seen.add(lower);

		const nodeIds = index.nodeIdsByLowerName.get(lower) ?? [];
		if (nodeIds.length === 0) {
			lookups.push({ name: trimmed, kind: "absent", totalMatches: 0, definitions: [] });
			continue;
		}
		// Past the threshold, listing four of forty-nine reads as an answer rather than
		// as a sample, so nothing is listed at all.
		if (nodeIds.length > ambiguousThreshold) {
			lookups.push({ name: trimmed, kind: "ambiguous", totalMatches: nodeIds.length, definitions: [] });
			continue;
		}

		const definitions: ReviewGraphSymbolDefinition[] = [];
		for (const nodeId of nodeIds.slice(0, maxDefinitions)) {
			const node = index.nodesById.get(nodeId);
			if (node === undefined) {
				continue;
			}
			definitions.push({
				nodeId: node.id,
				type: node.type,
				name: node.name,
				...(node.filePath ? { filePath: node.filePath } : {}),
				...(node.summary ? { summary: node.summary } : {}),
				...(node.complexity !== undefined ? { complexity: node.complexity } : {}),
				...(node.lineRange ? { lineRange: node.lineRange } : {}),
			});
		}
		lookups.push({
			name: trimmed,
			kind: nodeIds.length === 1 ? "found" : "ambiguous",
			totalMatches: nodeIds.length,
			definitions,
		});
	}

	return lookups;
}

export interface ReviewGraphImpactComponent {
	nodeId: string;
	type: string;
	name: string;
	filePath?: string;
	summary?: string;
	complexity?: number | string;
	/** How the change reaches it, e.g. `imports` — absent for changed components. */
	via?: string;
	/** Which way round the relationship runs. Absent for changed components. */
	direction?: ReviewGraphImpactDirection;
	/** The changed node this was reached from. Absent for changed components. */
	fromNodeId?: string;
}

export interface ReviewGraphImpact {
	graphPath: string;
	dataDir: string;
	project: ReviewGraphProject;
	changedPaths: string[];
	/** Paths the graph has no node for — new files, or a graph that predates them. */
	unmatchedPaths: string[];
	changed: ReviewGraphImpactComponent[];
	/** Things that depend on the change: the blast radius. */
	affected: ReviewGraphImpactComponent[];
	/** Affected components dropped to stay inside `maxAffected`. */
	affectedOmitted: number;
	/** Things the change depends on: context for reading it, not blast radius. */
	dependencies: ReviewGraphImpactComponent[];
	dependenciesOmitted: number;
	layers: Array<{ id: string; name: string; description?: string }>;
	changedNodeIds: string[];
	/** Dependent node ids only — this is what the dashboard overlay highlights. */
	affectedNodeIds: string[];
}

function componentFromNode(
	node: ReviewGraphNode,
	extra?: { via?: string; direction?: ReviewGraphImpactDirection; fromNodeId?: string },
): ReviewGraphImpactComponent {
	return {
		nodeId: node.id,
		type: node.type,
		name: node.name,
		...(node.filePath ? { filePath: node.filePath } : {}),
		...(node.summary ? { summary: node.summary } : {}),
		...(node.complexity !== undefined ? { complexity: node.complexity } : {}),
		...(extra?.via ? { via: extra.via } : {}),
		...(extra?.direction ? { direction: extra.direction } : {}),
		...(extra?.fromNodeId ? { fromNodeId: extra.fromNodeId } : {}),
	};
}

function complexityScore(value: number | string | undefined): number {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === "string") {
		const byName: Record<string, number> = { low: 1, medium: 2, high: 3, very_high: 4, "very high": 4 };
		return byName[value.toLowerCase()] ?? 0;
	}
	return 0;
}

/**
 * One hop out from the changed files.
 *
 * "One hop" is the whole point: two hops on a graph this dense reaches most of the
 * repo, which tells a reviewer nothing. A changed *file* is expanded into the
 * functions and classes it contains first, because the interesting edges
 * (`imports`, `calls`) land on those, not on the file node.
 */
export function computeReviewGraphImpact(
	index: ReviewGraphIndex,
	changedPaths: string[],
	options: { maxAffected?: number; maxDependencies?: number } = {},
): ReviewGraphImpact {
	const maxAffected = options.maxAffected ?? DEFAULT_MAX_AFFECTED_NODES;
	const maxDependencies = options.maxDependencies ?? DEFAULT_MAX_DEPENDENCY_NODES;

	const changedNodeIds = new Set<string>();
	const unmatchedPaths: string[] = [];
	const directlyMatchedIds = new Set<string>();
	for (const changedPath of changedPaths) {
		const matched = matchChangedPathNodeIds(index, changedPath);
		if (matched.length === 0) {
			unmatchedPaths.push(changedPath);
			continue;
		}
		for (const id of matched) {
			directlyMatchedIds.add(id);
			changedNodeIds.add(id);
		}
	}
	// Members of a changed file count as changed, so an edge into one of them is an
	// edge into the change.
	for (const id of directlyMatchedIds) {
		for (const contained of index.containedNodeIds.get(id) ?? []) {
			changedNodeIds.add(contained);
		}
	}

	interface NeighbourMeta {
		via: string;
		direction: ReviewGraphImpactDirection;
		fromNodeId: string;
		weight: number;
	}
	const neighbourByNodeId = new Map<string, NeighbourMeta>();
	for (const edge of index.impactEdges) {
		const sourceChanged = changedNodeIds.has(edge.source);
		const targetChanged = changedNodeIds.has(edge.target);
		if (sourceChanged === targetChanged) {
			// Both inside the change, or both outside it — neither is blast radius.
			continue;
		}
		const outsideId = sourceChanged ? edge.target : edge.source;
		const insideId = sourceChanged ? edge.source : edge.target;
		const direction = classifyImpactDirection({ edgeType: edge.type, changedEndIsSource: sourceChanged });
		const existing = neighbourByNodeId.get(outsideId);
		// A node reachable both ways is a dependent: that is the reading that matters,
		// and a mutual import is exactly the case where a change can come back around.
		const upgradesDirection =
			existing !== undefined && existing.direction !== "dependent" && direction === "dependent";
		if (
			existing === undefined ||
			upgradesDirection ||
			(existing.direction === direction && edge.weight > existing.weight)
		) {
			neighbourByNodeId.set(outsideId, { via: edge.type, direction, fromNodeId: insideId, weight: edge.weight });
		}
	}

	// A changed path matches its file node *and* every function and class declared in
	// it — they all carry the same `filePath`. Listing all of them was measured at
	// 27 entries and ~5 KB of an 8 KB brief for a 6-file merge request, every one of
	// them a restatement of something the diff already shows ("Function `_t` defined
	// in docs/tools/build_review_guide.py"). So the list is topped: a matched node is
	// dropped when another matched node contains it. The full set still drives the
	// edge walk above, which is where the members earn their place.
	const containedByMatched = new Set<string>();
	for (const id of directlyMatchedIds) {
		for (const contained of index.containedNodeIds.get(id) ?? []) {
			if (directlyMatchedIds.has(contained)) {
				containedByMatched.add(contained);
			}
		}
	}
	const changed: ReviewGraphImpactComponent[] = [];
	for (const id of directlyMatchedIds) {
		if (containedByMatched.has(id)) {
			continue;
		}
		const node = index.nodesById.get(id);
		if (node) {
			changed.push(componentFromNode(node));
		}
	}
	changed.sort((a, b) => (a.filePath ?? a.name).localeCompare(b.filePath ?? b.name));

	const ranked = [...neighbourByNodeId.entries()]
		.flatMap(([nodeId, meta]) => {
			const node = index.nodesById.get(nodeId);
			return node ? [{ node, meta }] : [];
		})
		.sort((a, b) => {
			const byWeight = b.meta.weight - a.meta.weight;
			if (byWeight !== 0) {
				return byWeight;
			}
			const byComplexity = complexityScore(b.node.complexity) - complexityScore(a.node.complexity);
			if (byComplexity !== 0) {
				return byComplexity;
			}
			return (a.node.filePath ?? a.node.name).localeCompare(b.node.filePath ?? b.node.name);
		});

	const toComponent = ({ node, meta }: { node: ReviewGraphNode; meta: NeighbourMeta }): ReviewGraphImpactComponent =>
		componentFromNode(node, { via: meta.via, direction: meta.direction, fromNodeId: meta.fromNodeId });

	// `related` is grouped with dependents: the graph will not say which way round it
	// runs, and under-reporting a possible breakage is the worse error.
	const rankedDependents = ranked.filter(({ meta }) => meta.direction !== "dependency");
	const rankedDependencies = ranked.filter(({ meta }) => meta.direction === "dependency");
	const affected = rankedDependents.slice(0, maxAffected).map(toComponent);
	const dependencies = rankedDependencies.slice(0, maxDependencies).map(toComponent);

	const touchedIds = new Set<string>([...changedNodeIds, ...neighbourByNodeId.keys()]);
	const layers = index.layers
		.filter((layer) => {
			for (const id of touchedIds) {
				if (layer.nodeIds.has(id)) {
					return true;
				}
			}
			return false;
		})
		.map((layer) => ({
			id: layer.id,
			name: layer.name,
			...(layer.description ? { description: layer.description } : {}),
		}));

	return {
		graphPath: index.graphPath,
		dataDir: index.dataDir,
		project: index.project,
		changedPaths: [...changedPaths],
		unmatchedPaths,
		changed,
		affected,
		affectedOmitted: Math.max(0, rankedDependents.length - affected.length),
		dependencies,
		dependenciesOmitted: Math.max(0, rankedDependencies.length - dependencies.length),
		layers,
		changedNodeIds: [...directlyMatchedIds],
		affectedNodeIds: rankedDependents.map(({ node }) => node.id),
	};
}

/**
 * How far the graph has drifted from the checkout.
 *
 * A hash mismatch on its own is not staleness: in a monorepo a commit that only
 * touched a sibling project leaves this project's slice of the graph correct. The
 * `-- .` pathspec is what makes that distinction, and it is the same rule the
 * `understand-diff` skill applies by hand.
 */
export interface ReviewGraphFreshness {
	graphCommit: string | null;
	headCommit: string | null;
	/** Project files that changed since the graph's commit, capped for display. */
	changedSinceGraph: string[];
	changedSinceGraphCount: number;
	isStale: boolean;
	/** Set when git could not be consulted at all — reported, never fatal. */
	error?: string;
}

const FRESHNESS_PATH_SAMPLE = 20;

export async function readReviewGraphFreshness(
	projectPath: string,
	project: ReviewGraphProject,
	options: { dataDir?: string } = {},
): Promise<ReviewGraphFreshness> {
	const graphCommitRaw = typeof project.gitCommitHash === "string" ? project.gitCommitHash : null;
	const head = await runGit(projectPath, ["rev-parse", "HEAD"]);
	if (!head.ok) {
		return {
			graphCommit: graphCommitRaw,
			headCommit: null,
			changedSinceGraph: [],
			changedSinceGraphCount: 0,
			isStale: false,
			error: head.error ?? "git rev-parse HEAD failed",
		};
	}
	const headCommit = head.stdout.trim();
	if (graphCommitRaw === null) {
		// No recorded commit: nothing to compare, so say so rather than guessing stale.
		return {
			graphCommit: null,
			headCommit,
			changedSinceGraph: [],
			changedSinceGraphCount: 0,
			isStale: false,
			error: "The graph records no commit hash, so its freshness cannot be checked.",
		};
	}

	const resolved = await runGit(projectPath, [
		"rev-parse",
		"--verify",
		"--end-of-options",
		`${graphCommitRaw}^{commit}`,
	]);
	if (!resolved.ok) {
		return {
			graphCommit: graphCommitRaw,
			headCommit,
			changedSinceGraph: [],
			changedSinceGraphCount: 0,
			isStale: false,
			error: `The graph's commit ${graphCommitRaw.slice(0, 8)} is not in this checkout, so its freshness cannot be checked.`,
		};
	}
	const graphCommit = resolved.stdout.trim();

	// Committed drift plus the three working-tree states, all project-scoped. The
	// data directory is excluded because a graph rebuild writes into it, and a
	// rebuild must not make its own output look like source drift.
	const dataDirName = options.dataDir ? path.basename(options.dataDir) : null;
	const excludeDataDir = dataDirName ? [`:(exclude)${dataDirName}`, `:(exclude)${dataDirName}/**`] : [];
	const pathspec = [".", ...excludeDataDir];
	const [committed, staged, unstaged, untracked] = await Promise.all([
		runGit(projectPath, ["diff", "--name-only", graphCommit, headCommit, "--", ...pathspec]),
		runGit(projectPath, ["diff", "--cached", "--name-only", "--", ...pathspec]),
		runGit(projectPath, ["diff", "--name-only", "--", ...pathspec]),
		runGit(projectPath, ["ls-files", "--others", "--exclude-standard", "--", ...pathspec]),
	]);

	const changed = new Set<string>();
	for (const result of [committed, staged, unstaged, untracked]) {
		if (!result.ok) {
			continue;
		}
		for (const line of result.stdout.split("\n")) {
			const trimmed = line.trim();
			if (trimmed.length > 0) {
				changed.add(trimmed);
			}
		}
	}
	const sorted = [...changed].sort();

	return {
		graphCommit,
		headCommit,
		changedSinceGraph: sorted.slice(0, FRESHNESS_PATH_SAMPLE),
		changedSinceGraphCount: sorted.length,
		isStale: sorted.length > 0,
	};
}

/**
 * Writes the overlay the dashboard reads to highlight a diff.
 *
 * Same file and shape the `understand-diff` skill produces, so the review tab and
 * the skill are interchangeable producers for one consumer. `generatedAt` is
 * supplied by the caller rather than read from the clock here, so the writer can
 * be tested.
 */
export async function writeReviewGraphDiffOverlay(input: {
	dataDir: string;
	baseBranch: string;
	generatedAt: string;
	changedPaths: string[];
	changedNodeIds: string[];
	affectedNodeIds: string[];
}): Promise<void> {
	const changed = new Set(input.changedNodeIds);
	const payload = {
		version: "1.0.0",
		baseBranch: input.baseBranch,
		generatedAt: input.generatedAt,
		changedFiles: input.changedPaths,
		changedNodeIds: input.changedNodeIds,
		affectedNodeIds: input.affectedNodeIds.filter((id) => !changed.has(id)),
	};
	await writeFile(path.join(input.dataDir, DIFF_OVERLAY_FILE_NAME), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

/**
 * Stable id for a graph, so a client can tell "same graph" from "rebuilt" without
 * being handed the path. Used as the cache-buster on the impact query.
 */
export function reviewGraphFingerprint(index: ReviewGraphIndex): string {
	return createHash("sha1")
		.update(`${index.graphPath}:${index.nodeCount}:${index.edgeCount}:${index.project.gitCommitHash ?? ""}`)
		.digest("hex")
		.slice(0, 12);
}
