import type {
	RuntimeGitBlameLine,
	RuntimeGitBlameResponse,
	RuntimeGitCommit,
	RuntimeGitCommitDiffResponse,
	RuntimeGitLogResponse,
	RuntimeGitRef,
	RuntimeGitRefsResponse,
} from "../core/api-contract";
import {
	COMMIT_DIFF_GIT_MAX_BUFFER_BYTES,
	COMMIT_DIFF_MAX_FILE_PATCH_BYTES,
	COMMIT_DIFF_MAX_FILES,
	COMMIT_DIFF_MAX_TOTAL_PATCH_BYTES,
	COMMIT_DIFF_PATCH_LINE_LIMIT,
	GIT_LOG_DEFAULT_MAX_COUNT,
	GIT_LOG_MAX_COUNT_LIMIT,
	GIT_LOG_MAX_SKIP,
	GIT_LOG_RELATION_MAX_COMMITS,
	GIT_LOG_TOTAL_COUNT_PROBE_LIMIT,
	GIT_READ_TIMEOUT_MS,
	GIT_REFS_MAX_COUNT,
} from "./git-limits";
import { type RunGitOptions, runGit } from "./git-utils";

const LOG_FIELD_SEPARATOR = "\x1f";
const LOG_RECORD_SEPARATOR = "\x1e";

const LOG_FORMAT = ["%H", "%h", "%an", "%ae", "%aI", "%s", "%P"].join(LOG_FIELD_SEPARATOR);

type CommitRelation = NonNullable<RuntimeGitCommit["relation"]>;

function parseCommitRecord(record: string): RuntimeGitCommit | null {
	const fields = record.split(LOG_FIELD_SEPARATOR);
	if (fields.length < 7) {
		return null;
	}
	const [hash, shortHash, authorName, authorEmail, dateIso, subject, parentHashes] = fields;
	if (!hash || !shortHash || !authorName || !dateIso || !subject) {
		return null;
	}
	return {
		hash,
		shortHash,
		authorName,
		authorEmail: authorEmail ?? "",
		date: dateIso,
		message: subject,
		parentHashes: (parentHashes ?? "").split(" ").filter(Boolean),
	};
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

/** Shared read options: every git call on a UI read path is time-boxed and cancellable. */
function gitReadOptions(signal: AbortSignal | undefined, overrides: RunGitOptions = {}): RunGitOptions {
	return {
		timeoutMs: GIT_READ_TIMEOUT_MS,
		...(signal ? { signal } : {}),
		...overrides,
	};
}

export async function getGitLog(options: {
	cwd: string;
	ref?: string | null;
	refs?: string[] | null;
	maxCount?: number;
	skip?: number;
	signal?: AbortSignal;
}): Promise<RuntimeGitLogResponse> {
	const { cwd, ref, refs, signal } = options;
	// Clamped here as well as in the request schema so direct callers cannot ask
	// the runtime to walk a 100k-commit history in one page.
	const maxCount = clamp(options.maxCount ?? GIT_LOG_DEFAULT_MAX_COUNT, 1, GIT_LOG_MAX_COUNT_LIMIT);
	const skip = clamp(options.skip ?? 0, 0, GIT_LOG_MAX_SKIP);

	const repoRootResult = await runGit(cwd, ["rev-parse", "--show-toplevel"], gitReadOptions(signal));
	if (!repoRootResult.ok || !repoRootResult.stdout) {
		return { ok: false, commits: [], totalCount: 0, error: "No git repository detected." };
	}
	const repoRoot = repoRootResult.stdout;
	const requestedRefs = normalizeRequestedRefs(refs, ref);

	const logArgs = [
		"log",
		"--topo-order",
		"--date-order",
		`--format=${LOG_RECORD_SEPARATOR}${LOG_FORMAT}`,
		`--max-count=${maxCount}`,
		`--skip=${skip}`,
	];

	if (requestedRefs.length > 0) {
		logArgs.push(...requestedRefs);
	}

	// `--max-count` stops the count walk early, so `totalCount` becomes a floor on
	// a big repo instead of a full-history traversal. The probe never sits below
	// the page the caller asked for, or paging would stop before the page did.
	const countProbeLimit = Math.max(GIT_LOG_TOTAL_COUNT_PROBE_LIMIT, skip + maxCount + 1);

	// None of these three depends on another; they were serialized by accident.
	const [logResult, relations, countResult] = await Promise.all([
		runGit(repoRoot, logArgs, gitReadOptions(signal)),
		buildCommitRelationMap(repoRoot, requestedRefs, signal),
		runGit(
			repoRoot,
			[
				"rev-list",
				"--count",
				`--max-count=${countProbeLimit}`,
				...(requestedRefs.length > 0 ? requestedRefs : ["HEAD"]),
			],
			gitReadOptions(signal),
		),
	]);

	if (!logResult.ok) {
		return { ok: false, commits: [], totalCount: 0, error: logResult.error ?? "Failed to read git log." };
	}

	const commits: RuntimeGitCommit[] = [];
	const records = logResult.stdout.split(LOG_RECORD_SEPARATOR).filter(Boolean);
	for (const record of records) {
		const commit = parseCommitRecord(record.trim());
		if (commit) {
			commits.push(commit);
		}
	}

	if (relations) {
		for (let index = 0; index < commits.length; index += 1) {
			const commit = commits[index];
			if (!commit) {
				continue;
			}
			commits[index] = {
				...commit,
				relation: relations.relationMap.get(commit.hash) ?? "shared",
			};
		}
	}

	const totalCount = countResult.ok ? Number.parseInt(countResult.stdout, 10) || commits.length : commits.length;

	return {
		ok: true,
		commits,
		totalCount,
		totalCountIsExact: totalCount < countProbeLimit,
		relationsComplete: relations ? relations.complete : true,
	};
}

function parseTrackCounts(trackDescriptor: string | null): { ahead?: number; behind?: number } {
	if (!trackDescriptor) {
		return {};
	}
	const aheadMatch = trackDescriptor.match(/ahead (\d+)/);
	const behindMatch = trackDescriptor.match(/behind (\d+)/);
	const ahead = aheadMatch ? Number.parseInt(aheadMatch[1] ?? "", 10) : Number.NaN;
	const behind = behindMatch ? Number.parseInt(behindMatch[1] ?? "", 10) : Number.NaN;
	return {
		ahead: Number.isFinite(ahead) ? ahead : undefined,
		behind: Number.isFinite(behind) ? behind : undefined,
	};
}

const REF_FORMAT = "%(refname)\x1f%(refname:short)\x1f%(objectname)\x1f%(upstream:short)\x1f%(upstream:track)";

interface BranchEntry {
	fullName: string;
	name: string;
	type: "branch" | "remote";
	hash: string;
	upstream: string | null;
	ahead?: number;
	behind?: number;
}

function parseRefLines(stdout: string): BranchEntry[] {
	const branches: BranchEntry[] = [];
	if (!stdout) {
		return branches;
	}
	for (const line of stdout.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) {
			continue;
		}
		const parts = trimmed.split("\x1f");
		const fullName = parts[0];
		const name = parts[1];
		const hash = parts[2];
		const upstream = parts[3] || null;
		const trackDescriptor = parts[4] || null;
		if (!fullName || !name || !hash) {
			continue;
		}
		if (fullName.endsWith("/HEAD")) {
			continue;
		}
		const type = fullName.startsWith("refs/remotes/") ? "remote" : "branch";
		branches.push({
			fullName,
			name,
			type,
			hash,
			upstream,
			...parseTrackCounts(type === "branch" ? trackDescriptor : null),
		});
	}
	return branches;
}

export async function getGitRefs(cwd: string, options: { signal?: AbortSignal } = {}): Promise<RuntimeGitRefsResponse> {
	const { signal } = options;
	const repoRootResult = await runGit(cwd, ["rev-parse", "--show-toplevel"], gitReadOptions(signal));
	if (!repoRootResult.ok || !repoRootResult.stdout) {
		return { ok: false, refs: [], error: "No git repository detected." };
	}
	const repoRoot = repoRootResult.stdout;

	const [headResult, branchResult, headRefResult] = await Promise.all([
		runGit(repoRoot, ["rev-parse", "HEAD"], gitReadOptions(signal)),
		// Capped and ordered by recency: a CI-heavy remote carries thousands of
		// `refs/remotes/*`, and the whole set used to be parsed and shipped on every
		// branch change and every poll-driven refresh.
		runGit(
			repoRoot,
			[
				"for-each-ref",
				`--format=${REF_FORMAT}`,
				"--sort=-committerdate",
				`--count=${GIT_REFS_MAX_COUNT}`,
				"refs/heads/",
				"refs/remotes/",
			],
			gitReadOptions(signal),
		),
		runGit(repoRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"], gitReadOptions(signal)),
	]);

	const headCommit = headResult.ok ? headResult.stdout : null;
	const currentBranch = headRefResult.ok ? headRefResult.stdout : null;
	const isDetached = !headRefResult.ok;
	if (!headResult.ok) {
		return { ok: false, refs: [], error: headResult.error ?? "Failed to resolve HEAD." };
	}
	if (!branchResult.ok) {
		return { ok: false, refs: [], error: branchResult.error ?? "Failed to read git refs." };
	}

	const refs: RuntimeGitRef[] = [];

	if (isDetached && headCommit) {
		refs.push({
			name: headCommit.slice(0, 7),
			type: "detached",
			hash: headCommit,
			isHead: true,
		});
	}

	const branches = parseRefLines(branchResult.ok ? branchResult.stdout : "");
	const truncated = branches.length >= GIT_REFS_MAX_COUNT;

	// `--count` sorts by recency, so a stale checked-out branch (or its upstream)
	// can fall outside the window. Without them `activeRef` resolves to null on the
	// client and the whole history panel renders empty, so they are re-queried by
	// name and put back.
	if (truncated && currentBranch) {
		const restoreRef = async (fullRefName: string): Promise<void> => {
			const result = await runGit(
				repoRoot,
				["for-each-ref", `--format=${REF_FORMAT}`, fullRefName],
				gitReadOptions(signal),
			);
			if (result.ok && result.stdout) {
				branches.unshift(...parseRefLines(result.stdout));
			}
		};

		if (!branches.some((entry) => entry.type === "branch" && entry.name === currentBranch)) {
			await restoreRef(`refs/heads/${currentBranch}`);
		}
		// Resolved only after the branch above is back, since its own entry carries
		// the upstream name.
		const upstreamName =
			branches.find((entry) => entry.type === "branch" && entry.name === currentBranch)?.upstream ?? null;
		if (upstreamName && !branches.some((entry) => entry.name === upstreamName)) {
			await restoreRef(`refs/remotes/${upstreamName}`);
		}
	}

	for (let i = 0; i < branches.length; i++) {
		const branch = branches[i];
		if (!branch) {
			continue;
		}
		refs.push({
			name: branch.name,
			type: branch.type,
			hash: branch.hash,
			isHead: branch.type === "branch" && branch.name === currentBranch,
			upstreamName: branch.type === "branch" ? (branch.upstream ?? undefined) : undefined,
			ahead: branch.ahead,
			behind: branch.behind,
		});
	}

	return truncated ? { ok: true, refs, truncated: true } : { ok: true, refs };
}

function normalizeRequestedRefs(refs: string[] | null | undefined, fallbackRef?: string | null): string[] {
	const candidates = refs && refs.length > 0 ? refs : fallbackRef ? [fallbackRef] : [];
	return Array.from(new Set(candidates.map((candidate) => candidate.trim()).filter(Boolean)));
}

interface CommitRelations {
	relationMap: Map<string, CommitRelation>;
	/** False when either divergence walk hit `GIT_LOG_RELATION_MAX_COMMITS`. */
	complete: boolean;
}

/**
 * Tints each row as belonging to the selected ref, its upstream, or both.
 *
 * The walks are capped: a branch that diverged thousands of commits ago used to
 * materialise its entire asymmetric difference here just to decorate the 150
 * rows actually on screen. Commits past the cap fall back to "shared" tinting.
 */
async function buildCommitRelationMap(
	repoRoot: string,
	refs: string[],
	signal: AbortSignal | undefined,
): Promise<CommitRelations | null> {
	if (refs.length !== 2) {
		return null;
	}

	const [selectedRef, upstreamRef] = refs;
	if (!selectedRef || !upstreamRef) {
		return null;
	}

	const maxCountArg = `--max-count=${GIT_LOG_RELATION_MAX_COMMITS}`;
	const [selectedOnlyResult, upstreamOnlyResult] = await Promise.all([
		runGit(repoRoot, ["rev-list", maxCountArg, selectedRef, "--not", upstreamRef], gitReadOptions(signal)),
		runGit(repoRoot, ["rev-list", maxCountArg, upstreamRef, "--not", selectedRef], gitReadOptions(signal)),
	]);

	if (!selectedOnlyResult.ok || !upstreamOnlyResult.ok) {
		return null;
	}

	const relationMap = new Map<string, CommitRelation>();
	let selectedCount = 0;
	for (const hash of selectedOnlyResult.stdout.split("\n")) {
		const trimmedHash = hash.trim();
		if (trimmedHash) {
			relationMap.set(trimmedHash, "selected");
			selectedCount += 1;
		}
	}
	let upstreamCount = 0;
	for (const hash of upstreamOnlyResult.stdout.split("\n")) {
		const trimmedHash = hash.trim();
		if (trimmedHash) {
			relationMap.set(trimmedHash, "upstream");
			upstreamCount += 1;
		}
	}

	return {
		relationMap,
		complete: selectedCount < GIT_LOG_RELATION_MAX_COMMITS && upstreamCount < GIT_LOG_RELATION_MAX_COMMITS,
	};
}

export interface CommitDiffFile {
	path: string;
	previousPath?: string;
	status: "modified" | "added" | "deleted" | "renamed";
	additions: number;
	deletions: number;
	patch: string;
}

interface CommitDiffStatEntry {
	path: string;
	previousPath?: string;
	additions: number;
	deletions: number;
}

function parseCommitNameStatusEntries(output: string): Array<{
	path: string;
	previousPath?: string;
	status: "modified" | "added" | "deleted" | "renamed";
}> {
	const tokens = output.split("\0").filter(Boolean);
	const entries: Array<{
		path: string;
		previousPath?: string;
		status: "modified" | "added" | "deleted" | "renamed";
	}> = [];

	for (let index = 0; index < tokens.length; index += 1) {
		const statusCode = tokens[index];
		if (!statusCode) {
			continue;
		}
		const kind = statusCode.charAt(0);
		if (kind === "R") {
			const previousPath = tokens[index + 1];
			const path = tokens[index + 2];
			if (previousPath && path) {
				entries.push({
					path,
					previousPath,
					status: "renamed",
				});
			}
			index += 2;
			continue;
		}
		const path = tokens[index + 1];
		if (!path) {
			continue;
		}
		entries.push({
			path,
			status: kind === "A" ? "added" : kind === "D" ? "deleted" : "modified",
		});
		index += 1;
	}

	return entries;
}

function parseCommitNumstatEntries(output: string): CommitDiffStatEntry[] {
	const tokens = output.split("\0").filter(Boolean);
	const entries: CommitDiffStatEntry[] = [];

	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (!token) {
			continue;
		}
		const simpleMatch = token.match(/^([-\d]+)\t([-\d]+)\t(.+)$/);
		if (simpleMatch) {
			const additions = simpleMatch[1] === "-" ? 0 : Number.parseInt(simpleMatch[1] ?? "", 10);
			const deletions = simpleMatch[2] === "-" ? 0 : Number.parseInt(simpleMatch[2] ?? "", 10);
			const path = simpleMatch[3];
			if (path) {
				entries.push({
					path,
					additions: Number.isFinite(additions) ? additions : 0,
					deletions: Number.isFinite(deletions) ? deletions : 0,
				});
			}
			continue;
		}

		const renameMatch = token.match(/^([-\d]+)\t([-\d]+)\t$/);
		if (!renameMatch) {
			continue;
		}
		const previousPath = tokens[index + 1];
		const path = tokens[index + 2];
		const additions = renameMatch[1] === "-" ? 0 : Number.parseInt(renameMatch[1] ?? "", 10);
		const deletions = renameMatch[2] === "-" ? 0 : Number.parseInt(renameMatch[2] ?? "", 10);
		if (previousPath && path) {
			entries.push({
				path,
				previousPath,
				additions: Number.isFinite(additions) ? additions : 0,
				deletions: Number.isFinite(deletions) ? deletions : 0,
			});
		}
		index += 2;
	}

	return entries;
}

function parseCommitPatchEntries(output: string): Array<{
	path: string;
	previousPath?: string;
	patch: string;
}> {
	const patchSegments = output.split(/^diff --git /m);
	const entries: Array<{
		path: string;
		previousPath?: string;
		patch: string;
	}> = [];

	for (const segment of patchSegments) {
		if (!segment.trim()) {
			continue;
		}
		const fullPatch = `diff --git ${segment}`;
		const headerMatch = fullPatch.match(/^diff --git a\/(.+) b\/(.+)$/m);
		if (!headerMatch?.[1] || !headerMatch[2]) {
			continue;
		}
		const previousPath = headerMatch[1];
		const path = headerMatch[2];
		entries.push({
			path,
			previousPath: previousPath !== path ? previousPath : undefined,
			patch: fullPatch,
		});
	}

	return entries;
}

interface BlameCommitMeta {
	author: string;
	authorTime: number | null;
	summary: string;
}

/**
 * Parses `git blame --porcelain` output. The porcelain format emits a commit's
 * full metadata (author, time, summary) only the first time that commit appears;
 * later lines from the same commit carry just the hash header, so metadata is
 * cached by hash and reused.
 */
export function parseBlamePorcelain(output: string): RuntimeGitBlameLine[] {
	const lines = output.split("\n");
	const metaByHash = new Map<string, BlameCommitMeta>();
	const result: RuntimeGitBlameLine[] = [];

	let currentHash: string | null = null;
	let currentFinalLine = 0;

	for (const line of lines) {
		const headerMatch = line.match(/^([0-9a-f]{40}) \d+ (\d+)(?: \d+)?$/);
		if (headerMatch?.[1] && headerMatch[2]) {
			currentHash = headerMatch[1];
			currentFinalLine = Number.parseInt(headerMatch[2], 10);
			if (!metaByHash.has(currentHash)) {
				metaByHash.set(currentHash, { author: "", authorTime: null, summary: "" });
			}
			continue;
		}
		if (currentHash === null) {
			continue;
		}
		const meta = metaByHash.get(currentHash);
		if (meta) {
			if (line.startsWith("author ")) {
				meta.author = line.slice("author ".length);
				continue;
			}
			if (line.startsWith("author-time ")) {
				const epoch = Number.parseInt(line.slice("author-time ".length), 10);
				meta.authorTime = Number.isFinite(epoch) ? epoch : null;
				continue;
			}
			if (line.startsWith("summary ")) {
				meta.summary = line.slice("summary ".length);
				continue;
			}
		}
		if (line.startsWith("\t")) {
			// The tab-prefixed line is the actual file content — it closes the entry.
			const resolved = metaByHash.get(currentHash) ?? { author: "", authorTime: null, summary: "" };
			result.push({
				lineNumber: currentFinalLine,
				commitHash: currentHash,
				shortHash: currentHash.slice(0, 7),
				author: resolved.author,
				date: resolved.authorTime === null ? null : new Date(resolved.authorTime * 1000).toISOString(),
				summary: resolved.summary,
			});
		}
	}

	return result;
}

export async function getBlame(options: { cwd: string; path: string }): Promise<RuntimeGitBlameResponse> {
	const { cwd, path } = options;
	const targetPath = path.trim();
	if (!targetPath) {
		return { ok: false, path: targetPath, lines: [], error: "No file path provided for blame." };
	}

	const repoRootResult = await runGit(cwd, ["rev-parse", "--show-toplevel"]);
	if (!repoRootResult.ok || !repoRootResult.stdout) {
		return { ok: false, path: targetPath, lines: [], error: "No git repository detected." };
	}
	const repoRoot = repoRootResult.stdout;

	const blameResult = await runGit(repoRoot, ["blame", "--porcelain", "--", targetPath], { trimStdout: false });
	if (!blameResult.ok) {
		return { ok: false, path: targetPath, lines: [], error: blameResult.error ?? "Failed to blame file." };
	}

	return { ok: true, path: targetPath, lines: parseBlamePorcelain(blameResult.stdout) };
}

export async function getCommitDiff(options: {
	cwd: string;
	commitHash: string;
	signal?: AbortSignal;
}): Promise<RuntimeGitCommitDiffResponse> {
	const { cwd, commitHash, signal } = options;

	const repoRootResult = await runGit(cwd, ["rev-parse", "--show-toplevel"], gitReadOptions(signal));
	if (!repoRootResult.ok || !repoRootResult.stdout) {
		return { ok: false, commitHash, files: [], error: "No git repository detected." };
	}
	const repoRoot = repoRootResult.stdout;

	// Metadata first. Both of these are O(changed files) and cheap even for a
	// vendor drop; the patch text is what has to be rationed, so `git show` only
	// runs once we know which files are worth asking for.
	const [nameStatusResult, numstatResult] = await Promise.all([
		runGit(
			repoRoot,
			["diff-tree", "--root", "--no-commit-id", "-r", "-M", "--name-status", "-z", commitHash],
			gitReadOptions(signal),
		),
		runGit(
			repoRoot,
			["diff-tree", "--root", "--no-commit-id", "-r", "-M", "--numstat", "-z", commitHash],
			gitReadOptions(signal),
		),
	]);

	const filesByKey = new Map<string, RuntimeGitCommitDiffResponse["files"][number]>();
	const getEntryKey = (path: string, previousPath?: string): string =>
		previousPath ? `${previousPath}\0${path}` : path;

	const nameStatusEntries = nameStatusResult.ok ? parseCommitNameStatusEntries(nameStatusResult.stdout) : [];
	for (const entry of nameStatusEntries) {
		filesByKey.set(getEntryKey(entry.path, entry.previousPath), {
			path: entry.path,
			previousPath: entry.previousPath,
			status: entry.status,
			additions: 0,
			deletions: 0,
			patch: "",
		});
	}

	const numstatEntries = numstatResult.ok ? parseCommitNumstatEntries(numstatResult.stdout) : [];
	for (const entry of numstatEntries) {
		const key = getEntryKey(entry.path, entry.previousPath);
		const existing = filesByKey.get(key);
		if (existing) {
			existing.additions = entry.additions;
			existing.deletions = entry.deletions;
			continue;
		}
		filesByKey.set(key, {
			path: entry.path,
			previousPath: entry.previousPath,
			status: entry.previousPath ? "renamed" : "modified",
			additions: entry.additions,
			deletions: entry.deletions,
			patch: "",
		});
	}

	const allFiles: RuntimeGitCommitDiffResponse["files"] = [];
	for (const file of filesByKey.values()) {
		allFiles.push(file);
	}
	allFiles.sort((a, b) => a.path.localeCompare(b.path));

	const totalFileCount = allFiles.length;
	const files = allFiles.slice(0, COMMIT_DIFF_MAX_FILES);
	let truncated = files.length < totalFileCount;

	// Files whose diff is larger than the UI will ever render inline ship without
	// a patch rather than dragging megabytes of text through the response.
	const patchTargets = files.filter((file) => file.additions + file.deletions <= COMMIT_DIFF_PATCH_LINE_LIMIT);
	const patchTargetSet = new Set(patchTargets);
	for (const file of files) {
		if (!patchTargetSet.has(file)) {
			file.patchOmitted = true;
			truncated = true;
		}
	}

	if (patchTargets.length > 0) {
		const pathspec: string[] = [];
		for (const file of patchTargets) {
			pathspec.push(file.path);
			if (file.previousPath) {
				pathspec.push(file.previousPath);
			}
		}

		const diffResult = await runGit(
			repoRoot,
			[
				"show",
				"--format=",
				"--find-renames",
				"--patch",
				"--diff-algorithm=histogram",
				commitHash,
				"--",
				...pathspec,
			],
			gitReadOptions(signal, { trimStdout: false, maxBuffer: COMMIT_DIFF_GIT_MAX_BUFFER_BYTES }),
		);

		if (diffResult.ok) {
			const patchByKey = new Map<string, string>();
			for (const entry of parseCommitPatchEntries(diffResult.stdout)) {
				patchByKey.set(getEntryKey(entry.path, entry.previousPath), entry.patch);
			}

			let remainingPatchBytes = COMMIT_DIFF_MAX_TOTAL_PATCH_BYTES;
			for (const file of patchTargets) {
				const patch = patchByKey.get(getEntryKey(file.path, file.previousPath));
				if (patch === undefined) {
					continue;
				}
				if (remainingPatchBytes <= 0) {
					file.patchOmitted = true;
					truncated = true;
					continue;
				}
				const limit = Math.min(COMMIT_DIFF_MAX_FILE_PATCH_BYTES, remainingPatchBytes);
				if (patch.length > limit) {
					file.patch = patch.slice(0, limit);
					file.patchTruncated = true;
					truncated = true;
				} else {
					file.patch = patch;
				}
				remainingPatchBytes -= file.patch.length;
			}
		} else {
			// A patch too big even for the raised buffer, or one that timed out, is
			// not a failed request: the file list is still useful, so the panel gets
			// metadata plus an explicit truncation flag instead of a hard error.
			for (const file of patchTargets) {
				file.patchOmitted = true;
			}
			truncated = true;
		}
	}

	return truncated
		? { ok: true, commitHash, files, truncated: true, totalFileCount }
		: { ok: true, commitHash, files };
}
