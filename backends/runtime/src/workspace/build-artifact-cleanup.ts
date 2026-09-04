import type { Dirent } from "node:fs";
import { existsSync } from "node:fs";
import { lstat, readdir, realpath } from "node:fs/promises";
import { basename, dirname, join, parse, resolve, sep } from "node:path";

import type { RuntimeCleanupDisposeMode } from "../core/api-contract";
import { listWorkspaceIndexEntries } from "../state/workspace-state";
import { runGit } from "./git-utils";
import {
	findProtectedBuildOutput,
	listProtectedBuildOutputs,
	type ProtectedBuildOutput,
} from "./protected-build-outputs";
import { disposePath } from "./recycle-bin";
import { getWorktreesBaseRootPath } from "./task-worktree";
import { measureDirectorySize } from "./worktree-disk-usage";

export type BuildArtifactTier = "build-cache" | "build-output";

export interface BuildArtifact {
	path: string;
	sizeBytes: number;
	tier: BuildArtifactTier;
	reason: string;
	/** Directory name of the project the artifact was found under, for display. */
	projectLabel: string;
}

export interface BuildArtifactScan {
	artifacts: BuildArtifact[];
	skipped: { path: string; reason: string }[];
	/** Carried on the scan so the delete path re-checks against exactly the same list. */
	protectedOutputs: ProtectedBuildOutput[];
}

/** How deep below a project root a build directory is still looked for. */
const MAX_SCAN_DEPTH = 6;

/** Directories that are pure cache wherever they appear. */
const CACHE_DIR_NAMES = new Set([".turbo", ".vite", "coverage", "__pycache__", ".pytest_cache"]);

/**
 * Directories that hold build *output*. `.build` is here because a Next app can move
 * its `distDir` (`backends/OmniRoute/next.config.mjs` uses `.build/next`), and that is
 * where the largest tree on this machine lives; `target` is Cargo's, and taking it
 * whole is what stops the walk from matching the `build` directories scattered inside.
 */
const OUTPUT_DIR_NAMES = new Set(["dist", "build", "out", ".next", ".build", "target"]);

/**
 * Never descended into. Dependency trees are not this feature's business, and Python
 * ones are the reason: an unpruned `akselos-dev/.venv` contributes several thousand
 * `__pycache__` directories from installed packages, which is both a pointless walk and
 * a `check-ignore` argument list long enough to fail outright.
 */
const PRUNED_DIR_NAMES = new Set(["node_modules", ".git", ".venv", "venv", "site-packages", ".tox", ".nox"]);

/** Paths per `git check-ignore` call, kept well clear of the platform's argv limit. */
const CHECK_IGNORE_BATCH_SIZE = 200;

/**
 * Next writes this on every successful build, and `isOpenmaicBuilt()` already relies on
 * it. Its presence is what distinguishes a real dist directory — whose `cache` and `dev`
 * children are throwaway — from a source directory that merely happens to be called
 * `dist` or to contain a `cache` (`backends/flowise/packages/components/nodes/cache` is
 * hand-written source).
 */
const NEXT_BUILD_MARKER_FILE = "BUILD_ID";

/** Regenerable children of a Next dist directory: the build cache and the dev-server cache. */
const NEXT_CACHE_CHILD_NAMES = new Set(["cache", "dev"]);

/**
 * How far inside a matched output directory a Next dist directory is looked for.
 *
 * It is not always the match itself: with `distDir: ".build/next"` the marker sits one
 * level down, and missing that is the difference between reporting 15.8 GB of reclaimable
 * cache and reporting one 21 GB output nobody dares check.
 */
const NEXT_DIST_SEARCH_DEPTH = 2;

interface Candidate {
	path: string;
	rootPath: string;
	projectLabel: string;
}

async function isRealDirectory(path: string): Promise<boolean> {
	try {
		const stats = await lstat(path);
		return stats.isDirectory() && !stats.isSymbolicLink();
	} catch {
		return false;
	}
}

/**
 * Collects build directories under `rootPath` without following symlinks and without
 * descending into a directory it already matched.
 *
 * Not following symlinks is load-bearing rather than defensive: every task worktree gets
 * `frontends/pixel_office/dist` symlinked in from the main checkout, so a following
 * walker would offer the live UI build up once per worktree.
 */
async function collectCandidates(rootPath: string): Promise<Candidate[]> {
	const projectLabel = basename(rootPath);
	const found: Candidate[] = [];

	async function walk(dir: string, depth: number): Promise<void> {
		if (depth > MAX_SCAN_DEPTH) {
			return;
		}
		let entries: Dirent[];
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (!entry.isDirectory() || entry.isSymbolicLink() || PRUNED_DIR_NAMES.has(entry.name)) {
				continue;
			}
			const fullPath = join(dir, entry.name);
			if (CACHE_DIR_NAMES.has(entry.name) || OUTPUT_DIR_NAMES.has(entry.name)) {
				found.push({ path: fullPath, rootPath, projectLabel });
				continue;
			}
			await walk(fullPath, depth + 1);
		}
	}

	await walk(rootPath, 0);
	return found;
}

async function collectRoots(): Promise<string[]> {
	const roots = new Set<string>();
	try {
		for (const entry of await listWorkspaceIndexEntries()) {
			roots.add(entry.repoPath);
		}
	} catch {
		// Without the index there are no registered projects to scan; task worktrees
		// below are still reachable.
	}

	const worktreesRoot = getWorktreesBaseRootPath();
	let taskDirs: string[];
	try {
		taskDirs = await readdir(worktreesRoot);
	} catch {
		return [...roots];
	}
	for (const taskId of taskDirs) {
		let repoDirs: string[];
		try {
			repoDirs = await readdir(join(worktreesRoot, taskId));
		} catch {
			continue;
		}
		for (const repoLabel of repoDirs) {
			roots.add(join(worktreesRoot, taskId, repoLabel));
		}
	}
	return [...roots];
}

/**
 * Nearest enclosing repository, found by walking up to the closest `.git`.
 *
 * `.git` is a *file* in both a submodule and a task worktree, so testing for existence
 * rather than for a directory is what makes those resolve to themselves. It has to be
 * the nearest one: `git check-ignore` run from a superproject refuses a path inside a
 * submodule outright (`fatal: Pathspec '…' is in submodule '…'`).
 */
function findNearestRepoRoot(startDir: string): string | null {
	let current = resolve(startDir);
	const { root } = parse(current);
	while (true) {
		if (existsSync(join(current, ".git"))) {
			return current;
		}
		if (current === root) {
			return null;
		}
		current = dirname(current);
	}
}

/**
 * The subset of `paths` that git ignores, resolved in one call per repository.
 *
 * Returns null when the answer cannot be trusted, which the caller treats as "keep
 * everything here". `check-ignore` exits 1 when *nothing* matched — a valid answer, not
 * a failure — so only some other non-zero exit means the check itself broke. One such
 * failure is naming a path inside a submodule, which is why the caller groups by the
 * *nearest* repository.
 *
 * Output is newline-separated rather than NUL-separated because git 2.34 — what ships
 * here — refuses `-z` outside `--stdin` mode (`fatal: -z only makes sense with
 * --stdin`). A path containing a newline would come back quoted and simply fail to
 * match, which keeps the directory rather than deleting the wrong one.
 */
async function selectGitIgnoredPaths(repoRoot: string, paths: string[]): Promise<Set<string> | null> {
	const ignored = new Set<string>();
	for (let offset = 0; offset < paths.length; offset += CHECK_IGNORE_BATCH_SIZE) {
		const batch = paths.slice(offset, offset + CHECK_IGNORE_BATCH_SIZE);
		const result = await runGit(repoRoot, ["check-ignore", "--", ...batch], { trimStdout: false });
		if (!result.ok && result.exitCode !== 1) {
			return null;
		}
		for (const line of result.stdout.split("\n")) {
			const trimmed = line.trim();
			if (trimmed.length > 0) {
				ignored.add(resolve(repoRoot, trimmed));
			}
		}
	}
	return ignored;
}

/**
 * The `cache` / `dev` children of every Next dist directory at or just below `dir`.
 *
 * The search has depth because `distDir` is configurable: `.build` matches the walk but
 * the marker and the caches live in `.build/next`.
 */
async function findNextCacheChildren(dir: string, depth = 0): Promise<string[]> {
	let entries: Dirent[];
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return [];
	}
	const found: string[] = [];
	const isNextDistDir = entries.some((entry) => entry.isFile() && entry.name === NEXT_BUILD_MARKER_FILE);
	for (const entry of entries) {
		if (!entry.isDirectory() || entry.isSymbolicLink()) {
			continue;
		}
		const fullPath = join(dir, entry.name);
		if (isNextDistDir && NEXT_CACHE_CHILD_NAMES.has(entry.name)) {
			found.push(fullPath);
			continue;
		}
		if (!isNextDistDir && depth < NEXT_DIST_SEARCH_DEPTH) {
			found.push(...(await findNextCacheChildren(fullPath, depth + 1)));
		}
	}
	return found;
}

/**
 * Apparent size of `rootPath` with `excluded` subtrees left out, so an output entry and
 * the cache entries carved out of it never double-count. Symlinks are counted as the
 * link, never followed — same contract as `measureDirectorySize`.
 */
async function measureExcluding(rootPath: string, excluded: ReadonlySet<string>): Promise<number> {
	let total = 0;

	async function walk(dir: string): Promise<void> {
		let entries: Dirent[];
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const fullPath = join(dir, entry.name);
			if (entry.isDirectory() && !entry.isSymbolicLink()) {
				if (!excluded.has(fullPath)) {
					await walk(fullPath);
				}
				continue;
			}
			try {
				total += (await lstat(fullPath)).size;
			} catch {
				// Vanished or dangling between readdir and lstat.
			}
		}
	}

	await walk(rootPath);
	return total;
}

async function classifyCandidate(candidate: Candidate): Promise<BuildArtifact[]> {
	const name = basename(candidate.path);
	const shared = { projectLabel: candidate.projectLabel };

	if (CACHE_DIR_NAMES.has(name)) {
		return [
			{
				...shared,
				path: candidate.path,
				sizeBytes: await measureDirectorySize(candidate.path),
				tier: "build-cache",
				reason: `${name} — regenerated by the next build.`,
			},
		];
	}

	const cacheChildren = await findNextCacheChildren(candidate.path);
	const excluded = new Set(cacheChildren);
	const artifacts: BuildArtifact[] = [];
	for (const cacheChild of cacheChildren) {
		artifacts.push({
			...shared,
			path: cacheChild,
			sizeBytes: await measureDirectorySize(cacheChild),
			tier: "build-cache",
			reason: `Next ${basename(cacheChild)} cache under ${name} — never served.`,
		});
	}
	artifacts.push({
		...shared,
		path: candidate.path,
		sizeBytes: await measureExcluding(candidate.path, excluded),
		tier: "build-output",
		reason: `${name} — build output; the project needs a rebuild to run again.`,
	});
	return artifacts;
}

/**
 * Finds regenerable build directories across every registered project and task worktree.
 *
 * Two guards decide what may be offered, and they are independent because neither covers
 * the other:
 *
 * - **git must ignore it.** `akselos-master/dashboard/public/semantic/dist` is vendored
 *   Semantic UI, tracked in git, and nothing would ever regenerate it.
 * - **the runtime must not be serving it.** Every PixelOffice build output *is*
 *   gitignored, so the first guard says nothing about `frontends/pixel_office/dist` —
 *   the UI this dialog is rendered by. See `protected-build-outputs.ts`.
 *
 * Both fail closed: an unverifiable ignore status keeps the directory.
 */
export async function scanBuildArtifacts(options?: {
	/** Overrides the registered-projects-plus-worktrees default; used by tests. */
	roots?: string[];
}): Promise<BuildArtifactScan> {
	const artifacts: BuildArtifact[] = [];
	const skipped: { path: string; reason: string }[] = [];

	const roots = options?.roots ?? (await collectRoots());
	const protectedOutputs = listProtectedBuildOutputs(roots);
	const candidateLists = await Promise.all(roots.map((rootPath) => collectCandidates(rootPath)));
	const candidates = candidateLists.flat();

	// Group by repository so `check-ignore` runs once per repo instead of once per path,
	// and so a submodule is asked about its own paths.
	const byRepoRoot = new Map<string, Candidate[]>();
	for (const candidate of candidates) {
		const repoRoot = findNearestRepoRoot(dirname(candidate.path));
		if (!repoRoot) {
			skipped.push({ path: candidate.path, reason: "Not inside a git repository, so it cannot be verified." });
			continue;
		}
		const group = byRepoRoot.get(repoRoot);
		if (group) {
			group.push(candidate);
		} else {
			byRepoRoot.set(repoRoot, [candidate]);
		}
	}

	for (const [repoRoot, group] of byRepoRoot) {
		const ignored = await selectGitIgnoredPaths(
			repoRoot,
			group.map((candidate) => candidate.path),
		);
		if (!ignored) {
			for (const candidate of group) {
				skipped.push({ path: candidate.path, reason: "Could not ask git whether this path is ignored." });
			}
			continue;
		}
		for (const candidate of group) {
			if (!ignored.has(resolve(candidate.path))) {
				skipped.push({ path: candidate.path, reason: "Tracked by git — not a build artifact." });
				continue;
			}
			// Protection is applied per classified artifact, not per candidate: a
			// protected Next dist directory is withheld while its `cache` and `dev`
			// children stay reclaimable, which is where most of its size is.
			for (const artifact of await classifyCandidate(candidate)) {
				const protectedOutput =
					artifact.tier === "build-output" ? findProtectedBuildOutput(artifact.path, protectedOutputs) : null;
				if (protectedOutput) {
					skipped.push({ path: artifact.path, reason: protectedOutput.reason });
					continue;
				}
				artifacts.push(artifact);
			}
		}
	}

	return { artifacts, skipped, protectedOutputs };
}

export function summarizeBuildArtifacts(scan: BuildArtifactScan): {
	buildCacheItemCount: number;
	buildCacheSizeBytes: number;
	buildOutputItemCount: number;
	buildOutputSizeBytes: number;
	buildArtifacts: { path: string; sizeBytes: number; tier: BuildArtifactTier; projectLabel: string }[];
} {
	const caches = scan.artifacts.filter((artifact) => artifact.tier === "build-cache");
	const outputs = scan.artifacts.filter((artifact) => artifact.tier === "build-output");
	const sum = (items: BuildArtifact[]) => items.reduce((total, item) => total + item.sizeBytes, 0);
	return {
		buildCacheItemCount: caches.length,
		buildCacheSizeBytes: sum(caches),
		buildOutputItemCount: outputs.length,
		buildOutputSizeBytes: sum(outputs),
		buildArtifacts: [...scan.artifacts]
			.sort((left, right) => right.sizeBytes - left.sizeBytes)
			.map((artifact) => ({
				path: artifact.path,
				sizeBytes: artifact.sizeBytes,
				tier: artifact.tier,
				projectLabel: artifact.projectLabel,
			})),
	};
}

export async function cleanBuildArtifacts(options: {
	dryRun: boolean;
	disposeMode?: RuntimeCleanupDisposeMode;
	includeBuildCaches?: boolean;
	includeBuildOutputs?: boolean;
	/** When set, only these paths are eligible. */
	paths?: string[];
	/** Overrides the scanned roots; used by tests. */
	roots?: string[];
}): Promise<{ cleaned: BuildArtifact[]; skipped: { path: string; reason: string }[] }> {
	const scan = await scanBuildArtifacts({ roots: options.roots });
	const cleaned: BuildArtifact[] = [];
	// Seeded with the scan's own refusals, not just this pass's. Everything the two
	// guards withheld — a served output with its rebuild command, a tracked `dist` — is
	// filtered out before it ever becomes a target, so without this the dialog's Kept
	// list would come back empty and the guards would be invisible.
	const skipped: { path: string; reason: string }[] = [...scan.skipped];
	const protectedOutputs = scan.protectedOutputs;
	const pathFilter = options.paths ? new Set(options.paths.map((path) => resolve(path))) : null;

	const targets = scan.artifacts.filter((artifact) => {
		if (artifact.tier === "build-cache" && !options.includeBuildCaches) {
			return false;
		}
		if (artifact.tier === "build-output" && !options.includeBuildOutputs) {
			return false;
		}
		return pathFilter === null || pathFilter.has(resolve(artifact.path));
	});

	for (const target of targets) {
		// Every guard is re-checked here rather than trusted from the scan: the scan and
		// the confirm are separate requests, and anything could have been rebuilt,
		// replaced with a symlink, or started being served in between.
		const protectedOutput =
			target.tier === "build-output" ? findProtectedBuildOutput(target.path, protectedOutputs) : null;
		if (protectedOutput) {
			skipped.push({ path: target.path, reason: protectedOutput.reason });
			continue;
		}
		if (!(await isRealDirectory(target.path))) {
			continue;
		}
		try {
			const resolvedRoot = await realpath(findNearestRepoRoot(dirname(target.path)) ?? target.path);
			const resolvedPath = await realpath(target.path);
			if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(resolvedRoot + sep)) {
				skipped.push({ path: target.path, reason: "Path escapes the repository it was found in." });
				continue;
			}
			const result = await disposePath(target.path, options.disposeMode, {
				dryRun: options.dryRun,
				sizeBytes: target.sizeBytes,
			});
			cleaned.push({ ...target, path: result.destPath, sizeBytes: result.sizeBytes });
		} catch (error) {
			skipped.push({
				path: target.path,
				reason: error instanceof Error ? error.message : String(error),
			});
		}
	}

	return { cleaned, skipped };
}
