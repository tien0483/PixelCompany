const IGNORED_PATHS_CACHE_TTL_MS = 60_000;

interface IgnoredPathsCacheEntry {
	head: string;
	paths: string[];
	cachedAt: number;
}

const ignoredPathsCache = new Map<string, IgnoredPathsCacheEntry>();

export function readCachedIgnoredPaths(repoPath: string, head: string): string[] | null {
	const entry = ignoredPathsCache.get(repoPath);
	if (!entry) {
		return null;
	}
	if (entry.head !== head) {
		return null;
	}
	if (Date.now() - entry.cachedAt > IGNORED_PATHS_CACHE_TTL_MS) {
		return null;
	}
	return entry.paths;
}

export function writeCachedIgnoredPaths(repoPath: string, head: string, paths: string[]): void {
	ignoredPathsCache.set(repoPath, {
		head,
		paths,
		cachedAt: Date.now(),
	});
}

export function clearIgnoredPathsCacheForTests(): void {
	ignoredPathsCache.clear();
}
