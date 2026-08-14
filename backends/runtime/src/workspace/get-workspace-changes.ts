import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import type {
	RuntimeWorkspaceChangesResponse,
	RuntimeWorkspaceFileChange,
	RuntimeWorkspaceFileStatus,
} from "../core/api-contract";
import { mapWithConcurrency } from "../core/async-pool";
import {
	GIT_READ_TIMEOUT_MS,
	PATH_FINGERPRINT_CONCURRENCY,
	WORKSPACE_CHANGES_CONCURRENCY,
	WORKSPACE_CHANGES_MAX_FILE_BYTES,
	WORKSPACE_CHANGES_MAX_FILES,
} from "./git-limits";
import { getGitStdout, runGit } from "./git-utils";

/**
 * Each retained entry holds the full old and new text of every changed file, so
 * the cache is bounded by bytes as well as by entry count.
 */
const WORKSPACE_CHANGES_CACHE_MAX_ENTRIES = 32;
const WORKSPACE_CHANGES_CACHE_MAX_BYTES = 64 * 1024 * 1024;

interface WorkspaceChangesCacheEntry {
	stateKey: string;
	response: RuntimeWorkspaceChangesResponse;
	lastAccessedAt: number;
	bytes: number;
}

const workspaceChangesCacheByRepoRoot = new Map<string, WorkspaceChangesCacheEntry>();

interface NameStatusEntry {
	path: string;
	status: RuntimeWorkspaceFileStatus;
	previousPath?: string;
}

interface ChangesBetweenRefsInput {
	cwd: string;
	fromRef: string;
	toRef: string;
}

interface ChangesFromRefInput {
	cwd: string;
	fromRef: string;
}

interface DiffStat {
	additions: number;
	deletions: number;
}

interface FileFingerprint {
	path: string;
	size: number | null;
	mtimeMs: number | null;
	ctimeMs: number | null;
}

function mapNameStatus(code: string): RuntimeWorkspaceFileStatus {
	const kind = code.charAt(0);
	if (kind === "M") return "modified";
	if (kind === "A") return "added";
	if (kind === "D") return "deleted";
	if (kind === "R") return "renamed";
	if (kind === "C") return "copied";
	return "unknown";
}

function toLineCount(text: string): number {
	if (!text) {
		return 0;
	}
	return text.split("\n").length;
}

function parseTrackedChanges(output: string): NameStatusEntry[] {
	const entries: NameStatusEntry[] = [];
	const lines = output
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);

	for (const line of lines) {
		const parts = line.split("\t");
		const statusCode = parts[0];
		const status = mapNameStatus(statusCode);

		if ((status === "renamed" || status === "copied") && parts.length >= 3) {
			const previousPath = parts[1];
			const path = parts[2];
			if (path) {
				entries.push({
					path,
					previousPath: previousPath || undefined,
					status,
				});
			}
			continue;
		}

		const path = parts[1];
		if (path) {
			entries.push({
				path,
				status,
			});
		}
	}

	return entries;
}

async function buildFileFingerprints(repoRoot: string, paths: string[]): Promise<FileFingerprint[]> {
	if (paths.length === 0) {
		return [];
	}
	const uniqueSortedPaths = Array.from(new Set(paths)).sort((left, right) => left.localeCompare(right));
	const entries = await mapWithConcurrency(
		uniqueSortedPaths,
		PATH_FINGERPRINT_CONCURRENCY,
		async (path): Promise<FileFingerprint> => {
			const absolutePath = join(repoRoot, path);
			try {
				const fileStat = await stat(absolutePath);
				return {
					path,
					size: fileStat.size,
					mtimeMs: fileStat.mtimeMs,
					ctimeMs: fileStat.ctimeMs,
				} satisfies FileFingerprint;
			} catch {
				return {
					path,
					size: null,
					mtimeMs: null,
					ctimeMs: null,
				} satisfies FileFingerprint;
			}
		},
	);
	return entries;
}

function buildWorkspaceChangesStateKey(input: {
	repoRoot: string;
	headCommit: string | null;
	trackedChangesOutput: string;
	untrackedOutput: string;
	fingerprints: FileFingerprint[];
}): string {
	const fingerprintsToken = input.fingerprints
		.map((entry) => `${entry.path}\t${entry.size ?? "null"}\t${entry.mtimeMs ?? "null"}\t${entry.ctimeMs ?? "null"}`)
		.join("\n");
	return [
		input.repoRoot,
		input.headCommit ?? "no-head",
		input.trackedChangesOutput,
		input.untrackedOutput,
		fingerprintsToken,
	].join("\n--\n");
}

function measureResponseBytes(response: RuntimeWorkspaceChangesResponse): number {
	let bytes = 0;
	for (const file of response.files) {
		bytes += (file.oldText?.length ?? 0) + (file.newText?.length ?? 0);
	}
	return bytes;
}

function pruneWorkspaceChangesCache(): void {
	const entries = Array.from(workspaceChangesCacheByRepoRoot.entries()).sort(
		(left, right) => left[1].lastAccessedAt - right[1].lastAccessedAt,
	);
	let totalBytes = entries.reduce((sum, entry) => sum + entry[1].bytes, 0);
	let index = 0;
	while (
		index < entries.length &&
		(workspaceChangesCacheByRepoRoot.size > WORKSPACE_CHANGES_CACHE_MAX_ENTRIES ||
			totalBytes > WORKSPACE_CHANGES_CACHE_MAX_BYTES)
	) {
		const candidate = entries[index];
		index += 1;
		if (!candidate) {
			break;
		}
		if (workspaceChangesCacheByRepoRoot.delete(candidate[0])) {
			totalBytes -= candidate[1].bytes;
		}
	}
}

/**
 * A file's text plus whether it was skipped for being too large. `text: null`
 * alone is ambiguous — it also means "file does not exist on this side of the
 * diff" — and treating an omitted file as absent renders it as fully added or
 * fully deleted, so the two cases have to stay distinguishable.
 */
interface FileTextRead {
	text: string | null;
	omitted: boolean;
}

const MISSING_FILE_TEXT: FileTextRead = { text: null, omitted: false };

async function readFileAtRevision(repoRoot: string, revision: string, path: string): Promise<FileTextRead> {
	const result = await runGit(repoRoot, ["show", `${revision}:${path}`], {
		maxBuffer: WORKSPACE_CHANGES_MAX_FILE_BYTES,
		timeoutMs: GIT_READ_TIMEOUT_MS,
	});
	if (result.ok) {
		return { text: result.stdout, omitted: false };
	}
	return { text: null, omitted: result.outputTruncated || result.timedOut };
}

async function readHeadFile(repoRoot: string, path: string): Promise<FileTextRead> {
	return await readFileAtRevision(repoRoot, "HEAD", path);
}

async function readFileAtRef(repoRoot: string, ref: string, path: string): Promise<FileTextRead> {
	return await readFileAtRevision(repoRoot, ref, path);
}

async function readWorkingTreeFile(repoRoot: string, path: string): Promise<FileTextRead> {
	const absolutePath = join(repoRoot, path);
	try {
		// The size check is a `stat`, not a read, so an oversized file never lands
		// in the heap on its way to being rejected.
		const fileStat = await stat(absolutePath);
		if (fileStat.size > WORKSPACE_CHANGES_MAX_FILE_BYTES) {
			return { text: null, omitted: true };
		}
		return { text: await readFile(absolutePath, "utf8"), omitted: false };
	} catch {
		return MISSING_FILE_TEXT;
	}
}

function fallbackStats(oldText: string | null, newText: string | null): DiffStat {
	if (oldText == null && newText == null) {
		return { additions: 0, deletions: 0 };
	}
	if (oldText == null) {
		return { additions: toLineCount(newText ?? ""), deletions: 0 };
	}
	if (newText == null) {
		return { additions: 0, deletions: toLineCount(oldText) };
	}

	const oldLines = toLineCount(oldText);
	const newLines = toLineCount(newText);
	return {
		additions: Math.max(newLines - oldLines, 0),
		deletions: Math.max(oldLines - newLines, 0),
	};
}

async function readDiffStat(repoRoot: string, path: string): Promise<DiffStat | null> {
	try {
		const output = await getGitStdout(["diff", "--numstat", "HEAD", "--", path], repoRoot);
		const firstLine = output
			.split("\n")
			.map((line) => line.trim())
			.find(Boolean);
		if (!firstLine) {
			return null;
		}
		const [addedRaw, deletedRaw] = firstLine.split("\t");
		const additions = Number.parseInt(addedRaw ?? "", 10);
		const deletions = Number.parseInt(deletedRaw ?? "", 10);
		return {
			additions: Number.isFinite(additions) ? additions : 0,
			deletions: Number.isFinite(deletions) ? deletions : 0,
		};
	} catch {
		return null;
	}
}

async function readDiffStatBetweenRefs(
	repoRoot: string,
	fromRef: string,
	toRef: string,
	path: string,
): Promise<DiffStat | null> {
	try {
		const output = await getGitStdout(["diff", "--numstat", fromRef, toRef, "--", path], repoRoot);
		const firstLine = output
			.split("\n")
			.map((line) => line.trim())
			.find(Boolean);
		if (!firstLine) {
			return null;
		}
		const [addedRaw, deletedRaw] = firstLine.split("\t");
		const additions = Number.parseInt(addedRaw ?? "", 10);
		const deletions = Number.parseInt(deletedRaw ?? "", 10);
		return {
			additions: Number.isFinite(additions) ? additions : 0,
			deletions: Number.isFinite(deletions) ? deletions : 0,
		};
	} catch {
		return null;
	}
}

async function readDiffStatFromRef(repoRoot: string, fromRef: string, path: string): Promise<DiffStat | null> {
	try {
		const output = await getGitStdout(["diff", "--numstat", fromRef, "--", path], repoRoot);
		const firstLine = output
			.split("\n")
			.map((line) => line.trim())
			.find(Boolean);
		if (!firstLine) {
			return null;
		}
		const [addedRaw, deletedRaw] = firstLine.split("\t");
		const additions = Number.parseInt(addedRaw ?? "", 10);
		const deletions = Number.parseInt(deletedRaw ?? "", 10);
		return {
			additions: Number.isFinite(additions) ? additions : 0,
			deletions: Number.isFinite(deletions) ? deletions : 0,
		};
	} catch {
		return null;
	}
}

/**
 * Assembles one file's change record from its two sides. The three call sites
 * differ only in where each side comes from, so the size-omission handling and
 * the stats fallback live here once.
 *
 * `additions`/`deletions` stay exact for omitted files: they come from
 * `--numstat`, which never reads the file's text.
 */
async function buildFileChangeRecord(input: {
	entry: NameStatusEntry;
	oldTextRead: FileTextRead;
	newTextRead: FileTextRead;
	readStats: () => Promise<DiffStat | null>;
}): Promise<RuntimeWorkspaceFileChange> {
	const { entry, oldTextRead, newTextRead } = input;
	const stats =
		entry.status === "untracked" && !newTextRead.omitted
			? { additions: toLineCount(newTextRead.text ?? ""), deletions: 0 }
			: ((await input.readStats()) ?? fallbackStats(oldTextRead.text, newTextRead.text));

	const change: RuntimeWorkspaceFileChange = {
		path: entry.path,
		previousPath: entry.previousPath,
		status: entry.status,
		additions: stats.additions,
		deletions: stats.deletions,
		oldText: oldTextRead.text,
		newText: newTextRead.text,
	};
	if (oldTextRead.omitted || newTextRead.omitted) {
		change.contentOmitted = true;
	}
	return change;
}

async function buildFileChange(repoRoot: string, entry: NameStatusEntry): Promise<RuntimeWorkspaceFileChange> {
	const basePath = entry.previousPath ?? entry.path;
	const oldTextRead =
		entry.status === "added" || entry.status === "untracked"
			? MISSING_FILE_TEXT
			: await readHeadFile(repoRoot, basePath);
	const newTextRead = entry.status === "deleted" ? MISSING_FILE_TEXT : await readWorkingTreeFile(repoRoot, entry.path);

	return await buildFileChangeRecord({
		entry,
		oldTextRead,
		newTextRead,
		readStats: () => readDiffStat(repoRoot, entry.path),
	});
}

async function buildFileChangeBetweenRefs(
	repoRoot: string,
	entry: NameStatusEntry,
	fromRef: string,
	toRef: string,
): Promise<RuntimeWorkspaceFileChange> {
	const basePath = entry.previousPath ?? entry.path;
	const oldTextRead = entry.status === "added" ? MISSING_FILE_TEXT : await readFileAtRef(repoRoot, fromRef, basePath);
	const newTextRead =
		entry.status === "deleted" ? MISSING_FILE_TEXT : await readFileAtRef(repoRoot, toRef, entry.path);

	return await buildFileChangeRecord({
		entry,
		oldTextRead,
		newTextRead,
		readStats: () => readDiffStatBetweenRefs(repoRoot, fromRef, toRef, entry.path),
	});
}

async function buildFileChangeFromRef(
	repoRoot: string,
	entry: NameStatusEntry,
	fromRef: string,
): Promise<RuntimeWorkspaceFileChange> {
	const basePath = entry.previousPath ?? entry.path;
	const oldTextRead =
		entry.status === "added" || entry.status === "untracked"
			? MISSING_FILE_TEXT
			: await readFileAtRef(repoRoot, fromRef, basePath);
	const newTextRead = entry.status === "deleted" ? MISSING_FILE_TEXT : await readWorkingTreeFile(repoRoot, entry.path);

	return await buildFileChangeRecord({
		entry,
		oldTextRead,
		newTextRead,
		readStats: () => readDiffStatFromRef(repoRoot, fromRef, entry.path),
	});
}

/** Caps the file list, reporting the real total so the UI can say what it is hiding. */
function capChangeEntries(entries: NameStatusEntry[]): {
	entries: NameStatusEntry[];
	truncated: boolean;
	totalFileCount: number;
} {
	if (entries.length <= WORKSPACE_CHANGES_MAX_FILES) {
		return { entries, truncated: false, totalFileCount: entries.length };
	}
	const sorted = [...entries].sort((left, right) => left.path.localeCompare(right.path));
	return {
		entries: sorted.slice(0, WORKSPACE_CHANGES_MAX_FILES),
		truncated: true,
		totalFileCount: entries.length,
	};
}

export async function createEmptyWorkspaceChangesResponse(cwd: string): Promise<RuntimeWorkspaceChangesResponse> {
	const repoRoot = (await getGitStdout(["rev-parse", "--show-toplevel"], cwd)).trim();
	if (!repoRoot) {
		throw new Error("Could not resolve git repository root.");
	}
	return {
		repoRoot,
		generatedAt: Date.now(),
		files: [],
	};
}

export async function getWorkspaceChanges(cwd: string): Promise<RuntimeWorkspaceChangesResponse> {
	const repoRoot = (await getGitStdout(["rev-parse", "--show-toplevel"], cwd)).trim();
	if (!repoRoot) {
		throw new Error("Could not resolve git repository root.");
	}

	const [trackedChangesOutput, untrackedOutput, headCommitOutput] = await Promise.all([
		getGitStdout(["diff", "--name-status", "HEAD", "--"], repoRoot),
		getGitStdout(["ls-files", "--others", "--exclude-standard"], repoRoot),
		getGitStdout(["rev-parse", "--verify", "HEAD"], repoRoot).catch(() => ""),
	]);
	const trackedChanges = parseTrackedChanges(trackedChangesOutput);
	const untrackedPaths = untrackedOutput
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);

	const trackedPaths = new Set(trackedChanges.map((entry) => entry.path));
	const allChanges: NameStatusEntry[] = [
		...trackedChanges,
		...untrackedPaths
			.filter((path) => !trackedPaths.has(path))
			.map((path) => ({
				path,
				status: "untracked" as const,
			})),
	];
	// Capped before the fingerprint pass so the `stat()` fan-out is bounded too.
	const capped = capChangeEntries(allChanges);
	const fingerprintPaths = capped.entries.flatMap(
		(entry) => [entry.path, entry.previousPath].filter(Boolean) as string[],
	);
	const fingerprints = await buildFileFingerprints(repoRoot, fingerprintPaths);
	const stateKey = buildWorkspaceChangesStateKey({
		repoRoot,
		headCommit: headCommitOutput.trim() || null,
		trackedChangesOutput,
		untrackedOutput,
		fingerprints,
	});
	const existing = workspaceChangesCacheByRepoRoot.get(repoRoot);
	if (existing && existing.stateKey === stateKey) {
		existing.lastAccessedAt = Date.now();
		return existing.response;
	}

	const files = await mapWithConcurrency(capped.entries, WORKSPACE_CHANGES_CONCURRENCY, (entry) =>
		buildFileChange(repoRoot, entry),
	);
	files.sort((left, right) => left.path.localeCompare(right.path));
	const response: RuntimeWorkspaceChangesResponse = {
		repoRoot,
		generatedAt: Date.now(),
		files,
		...(capped.truncated ? { truncated: true, totalFileCount: capped.totalFileCount } : {}),
	};
	workspaceChangesCacheByRepoRoot.set(repoRoot, {
		stateKey,
		response,
		lastAccessedAt: Date.now(),
		bytes: measureResponseBytes(response),
	});
	pruneWorkspaceChangesCache();
	return response;
}

export async function getWorkspaceChangesBetweenRefs(
	input: ChangesBetweenRefsInput,
): Promise<RuntimeWorkspaceChangesResponse> {
	const repoRoot = (await getGitStdout(["rev-parse", "--show-toplevel"], input.cwd)).trim();
	if (!repoRoot) {
		throw new Error("Could not resolve git repository root.");
	}

	const trackedChangesOutput = await getGitStdout(
		["diff", "--name-status", "--find-renames", input.fromRef, input.toRef, "--"],
		repoRoot,
	);
	const trackedChanges = parseTrackedChanges(trackedChangesOutput);
	if (trackedChanges.length === 0) {
		return {
			repoRoot,
			generatedAt: Date.now(),
			files: [],
		};
	}

	const capped = capChangeEntries(trackedChanges);
	const files = await mapWithConcurrency(capped.entries, WORKSPACE_CHANGES_CONCURRENCY, (entry) =>
		buildFileChangeBetweenRefs(repoRoot, entry, input.fromRef, input.toRef),
	);
	files.sort((left, right) => left.path.localeCompare(right.path));

	return {
		repoRoot,
		generatedAt: Date.now(),
		files,
		...(capped.truncated ? { truncated: true, totalFileCount: capped.totalFileCount } : {}),
	};
}

export async function getWorkspaceChangesFromRef(input: ChangesFromRefInput): Promise<RuntimeWorkspaceChangesResponse> {
	const repoRoot = (await getGitStdout(["rev-parse", "--show-toplevel"], input.cwd)).trim();
	if (!repoRoot) {
		throw new Error("Could not resolve git repository root.");
	}

	const [trackedChangesOutput, untrackedOutput] = await Promise.all([
		getGitStdout(["diff", "--name-status", "--find-renames", input.fromRef, "--"], repoRoot),
		getGitStdout(["ls-files", "--others", "--exclude-standard"], repoRoot),
	]);
	const trackedChanges = parseTrackedChanges(trackedChangesOutput);
	const untrackedPaths = untrackedOutput
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	const trackedPaths = new Set(trackedChanges.map((entry) => entry.path));
	const allChanges: NameStatusEntry[] = [
		...trackedChanges,
		...untrackedPaths
			.filter((path) => !trackedPaths.has(path))
			.map((path) => ({
				path,
				status: "untracked" as const,
			})),
	];

	if (allChanges.length === 0) {
		return {
			repoRoot,
			generatedAt: Date.now(),
			files: [],
		};
	}

	const capped = capChangeEntries(allChanges);
	const files = await mapWithConcurrency(capped.entries, WORKSPACE_CHANGES_CONCURRENCY, (entry) =>
		buildFileChangeFromRef(repoRoot, entry, input.fromRef),
	);
	files.sort((left, right) => left.path.localeCompare(right.path));
	return {
		repoRoot,
		generatedAt: Date.now(),
		files,
		...(capped.truncated ? { truncated: true, totalFileCount: capped.totalFileCount } : {}),
	};
}
