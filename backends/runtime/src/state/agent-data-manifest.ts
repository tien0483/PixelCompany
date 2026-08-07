import { existsSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/**
 * Every agent asset this monorepo ships lives under one root: `agent-data/`.
 * Before that, the Manager catalog, Manager runtime assets and html_anything's
 * template skills each sat somewhere different and every consumer hardcoded its
 * own path — which is how a shelf toggle ended up writing to `~/.claude`
 * regardless of the selected project.
 *
 * The manifest declares each source and, crucially, whether its entries are
 * user-toggleable (Manager shelves) or bound to a backend's role (html_anything
 * templates, Manager hooks). Backends added later need no manifest edit: any
 * `backends/<name>/.claude` or `backends/<name>/.agent` is auto-discovered as a
 * role-bound source owned by `<name>`. A manifest entry for the same root wins,
 * so a new backend can still opt its assets into the shelves explicitly.
 */

export const AGENT_DATA_DIR_NAME = "agent-data";
export const AGENT_DATA_MANIFEST_FILENAME = "manifest.json";

/** Absolute-path override, mirroring `PIXELOFFICE_AGENT_MANAGER_DATA` in data_paths.py. */
const AGENT_DATA_ENV = "PIXELOFFICE_AGENT_DATA";

const MAX_PARENT_WALK_DEPTH = 10;

const agentDataSourceSchema = z.object({
	id: z.string().min(1, "Source id cannot be empty."),
	/** Repo-relative POSIX path. */
	root: z.string().min(1, "Source root cannot be empty."),
	owner: z.string().min(1, "Source owner cannot be empty."),
	kinds: z.array(z.string().min(1)).min(1, "A source must declare at least one kind."),
	toggleable: z.boolean(),
	description: z.string().optional(),
});

const agentDataManifestSchema = z.object({
	version: z.literal(1),
	sources: z.array(agentDataSourceSchema),
});

export type AgentDataSource = z.infer<typeof agentDataSourceSchema>;
export type AgentDataManifest = z.infer<typeof agentDataManifestSchema>;

/** A source plus where it actually resolved to on this machine. */
export interface ResolvedAgentDataSource extends AgentDataSource {
	absolutePath: string;
	/** `false` for a manifest entry whose directory is absent from this checkout. */
	present: boolean;
	/** `true` when discovered from `backends/*` rather than listed in the manifest. */
	discovered: boolean;
}

function moduleDirectory(): string {
	return dirname(fileURLToPath(import.meta.url));
}

function walkParents(start: string): string[] {
	const roots: string[] = [];
	let current = resolve(start);
	for (let depth = 0; depth < MAX_PARENT_WALK_DEPTH; depth += 1) {
		roots.push(current);
		const parent = dirname(current);
		if (parent === current) {
			break;
		}
		current = parent;
	}
	return roots;
}

/**
 * Repo root holding `agent-data/manifest.json`: env override, then a parent walk
 * from this module (so a `dist/` build resolves the same as `src/`), then from
 * the process cwd. Returns `null` when no manifest is reachable.
 */
export function findAgentDataRepoRoot(): string | null {
	const override = process.env[AGENT_DATA_ENV]?.trim();
	if (override) {
		// The override points at `agent-data/` itself; the repo root is its parent.
		return existsSync(join(override, AGENT_DATA_MANIFEST_FILENAME)) ? dirname(resolve(override)) : null;
	}
	for (const base of [...walkParents(moduleDirectory()), ...walkParents(process.cwd())]) {
		if (existsSync(join(base, AGENT_DATA_DIR_NAME, AGENT_DATA_MANIFEST_FILENAME))) {
			return base;
		}
	}
	return null;
}

/** Absolute path to `<repo>/agent-data`, or `null` when unreachable. */
export function findAgentDataRoot(): string | null {
	const repoRoot = findAgentDataRepoRoot();
	return repoRoot === null ? null : join(repoRoot, AGENT_DATA_DIR_NAME);
}

export async function readAgentDataManifest(repoRoot: string): Promise<AgentDataManifest> {
	const manifestPath = join(repoRoot, AGENT_DATA_DIR_NAME, AGENT_DATA_MANIFEST_FILENAME);
	const raw: unknown = JSON.parse(await readFile(manifestPath, "utf8"));
	return agentDataManifestSchema.parse(raw);
}

/** Per-backend asset dirs are role-bound by convention — never shelf-toggleable. */
const DISCOVERED_BACKEND_ROOTS = [".claude", ".agent"] as const;

function discoverBackendSources(repoRoot: string): ResolvedAgentDataSource[] {
	const backendsDir = join(repoRoot, "backends");
	let entries: string[];
	try {
		entries = readdirSync(backendsDir, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name)
			.sort();
	} catch {
		return [];
	}
	const discovered: ResolvedAgentDataSource[] = [];
	for (const backend of entries) {
		for (const rootName of DISCOVERED_BACKEND_ROOTS) {
			const absolutePath = join(backendsDir, backend, rootName);
			if (!existsSync(absolutePath)) {
				continue;
			}
			discovered.push({
				id: `backend-${backend}${rootName === ".claude" ? "" : "-agent"}`,
				root: `backends/${backend}/${rootName}`,
				owner: backend,
				kinds: ["skill", "agent", "command", "workflow"],
				toggleable: false,
				description: `Auto-discovered ${rootName} assets owned by the ${backend} backend.`,
				absolutePath,
				present: true,
				discovered: true,
			});
		}
	}
	return discovered;
}

/**
 * Every agent-data source visible from `repoRoot`: manifest entries first, then
 * auto-discovered backend dirs whose root isn't already claimed by the manifest.
 */
export async function listAgentDataSources(repoRoot?: string): Promise<ResolvedAgentDataSource[]> {
	const root = repoRoot ?? findAgentDataRepoRoot();
	if (root === null) {
		return [];
	}
	const manifest = await readAgentDataManifest(root);
	const declared: ResolvedAgentDataSource[] = manifest.sources.map((source) => {
		const absolutePath = join(root, ...source.root.split("/"));
		return { ...source, absolutePath, present: existsSync(absolutePath), discovered: false };
	});
	const claimedRoots = new Set(declared.map((source) => source.root));
	const discovered = discoverBackendSources(root).filter((source) => !claimedRoots.has(source.root));
	return [...declared, ...discovered];
}

/** The one source whose entries the Manager shelves may install and uninstall. */
export async function findToggleableCatalogSource(
	repoRoot?: string,
): Promise<ResolvedAgentDataSource | null> {
	const sources = await listAgentDataSources(repoRoot);
	return sources.find((source) => source.toggleable && source.present) ?? null;
}
