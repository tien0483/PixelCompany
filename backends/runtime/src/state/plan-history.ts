import { randomUUID } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";

import { createGitProcessEnv } from "../core/git-process-env";
import { lockedFileSystem } from "../fs/locked-file-system";
import { runGit } from "../workspace/git-utils";
import { findSavedPlanById, type SavedPlanEntry } from "./saved-plans";
import { getRuntimeHomePath } from "./workspace-state";

/**
 * Version history for plan documents, so a generated page can be undone and a requirement can be
 * diffed against what it looked like three runs ago.
 *
 * Every HTML pass overwrote `<stem>.html` in place, which made "generate, dislike it, go back"
 * impossible — the only artefacts were the `.bak-<n>` copies brief expansion happens to leave.
 *
 * The store is a bare git repository used purely as a content-addressed blob store: `hash-object`
 * in, `cat-file` out, `diff` between two ids. No commits, no branches, no working tree — a plan
 * lives wherever the user keeps it, which may well be inside somebody else's repository, so this
 * deliberately never touches a `.git` near the plan itself. Git buys deduplication (regenerating
 * the same page twice costs nothing), packing, and a diff engine that already handles every
 * encoding quirk we would otherwise re-implement.
 *
 * Cursor semantics: each (plan, target) pair has a cursor pointing at the version currently on
 * disk. Undo/redo move that cursor and write the blob back out; they never delete entries, so redo
 * survives. Snapshotting new content after an undo appends at the end and moves the cursor there —
 * the versions that were ahead of the cursor stay in the list but are no longer reachable by redo,
 * which is how most editors behave.
 */

const PLAN_HISTORY_DIR_NAME = "plan-history";
const INDEX_FILE_NAME = "versions.json";
/** Per (plan, target). Blobs are shared and cheap; this only bounds the list the UI renders. */
const MAX_ENTRIES_PER_TARGET = 100;
/** Typing produces a save every 500 ms; history only wants a milestone every so often. */
const AUTOSAVE_MIN_INTERVAL_MS = 60_000;

export type PlanHistoryTarget = "md" | "html";

export type PlanHistoryLabel =
	/** A fresh HTML generation. */
	| "generate"
	/** A diff-based Refine pass. */
	| "refine"
	/** Brief expansion rewrote the markdown. */
	| "expand"
	/** The prompt bar drafted or rewrote part of the markdown. */
	| "ai-edit"
	/** Ordinary editing, captured at most once a minute. */
	| "autosave"
	/** The user asked for a marker explicitly. */
	| "manual";

export interface PlanHistoryEntry {
	id: string;
	target: PlanHistoryTarget;
	/** Git object id of the document's bytes. */
	oid: string;
	bytes: number;
	label: PlanHistoryLabel;
	createdAt: number;
	/**
	 * For an HTML entry: the object id of the `<stem>.html.src.md` recorded for it, so restoring the
	 * page also restores the requirement Refine diffs against. Absent for markdown entries and for
	 * pages generated before anything was recorded.
	 */
	pairedSrcOid?: string;
	/** True for the version currently on disk. */
	isCurrent?: boolean;
}

interface PlanHistoryRecord {
	md: PlanHistoryEntry[];
	html: PlanHistoryEntry[];
	cursor: { md: string | null; html: string | null };
}

interface PlanHistoryIndex {
	version: 1;
	plans: Record<string, PlanHistoryRecord>;
}

export interface PlanHistoryListing {
	available: boolean;
	entries: PlanHistoryEntry[];
	/** Entry ids currently materialized on disk, per target. */
	cursor: { md: string | null; html: string | null };
	/** Why history is unavailable, when it is. */
	reason?: string;
}

export interface PlanHistoryMaterialization {
	entry: PlanHistoryEntry;
	target: PlanHistoryTarget;
	path: string;
	content: string;
}

function repoDir(): string {
	return join(getRuntimeHomePath(), PLAN_HISTORY_DIR_NAME);
}

function indexPath(): string {
	return join(repoDir(), INDEX_FILE_NAME);
}

function gitEnv(): NodeJS.ProcessEnv {
	// GIT_DIR alone: nothing here needs a work tree, and pointing one at a plan's folder would put
	// the user's own directory under git's control as a side effect of saving a file.
	return createGitProcessEnv({ GIT_DIR: repoDir() });
}

let availability: Promise<{ available: boolean; reason?: string }> | null = null;

/**
 * Whether `git` can be used at all. Probed once per process: the answer cannot change under a
 * running runtime, and every snapshot would otherwise pay for the check.
 */
export function isPlanHistoryAvailable(): Promise<{ available: boolean; reason?: string }> {
	if (availability === null) {
		availability = (async () => {
			const result = await runGit(getRuntimeHomePath(), ["--version"], { env: createGitProcessEnv() });
			return result.ok
				? { available: true }
				: {
						available: false,
						reason: "git was not found on PATH, so plan version history is unavailable.",
					};
		})();
	}
	return availability;
}

/** Test seam: forget the cached probe. */
export function resetPlanHistoryAvailabilityCache(): void {
	availability = null;
}

let repoReady: Promise<void> | null = null;

async function ensureRepo(): Promise<void> {
	if (repoReady === null) {
		repoReady = (async () => {
			const dir = repoDir();
			await lockedFileSystem.withLock({ path: dir, type: "directory", lockfileName: ".init.lock" }, async () => {
				const initialized = await pathExists(join(dir, "HEAD"));
				if (initialized) {
					return;
				}
				const result = await runGit(getRuntimeHomePath(), ["init", "--bare", "--quiet", dir], {
					env: createGitProcessEnv(),
				});
				if (!result.ok) {
					throw new Error(result.error ?? "Could not create the plan history repository.");
				}
			});
		})().catch((error) => {
			// A failed init must not be cached as done, or every later call would fail silently.
			repoReady = null;
			throw error;
		});
	}
	return repoReady;
}

/** Test seam: drop the memoized init so a new runtime home is initialized on demand. */
export function resetPlanHistoryRepoCache(): void {
	repoReady = null;
}

async function pathExists(target: string): Promise<boolean> {
	try {
		await stat(target);
		return true;
	} catch {
		return false;
	}
}

function emptyRecord(): PlanHistoryRecord {
	return { md: [], html: [], cursor: { md: null, html: null } };
}

async function readIndex(): Promise<PlanHistoryIndex> {
	try {
		const raw = await readFile(indexPath(), "utf8");
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed === "object" && parsed !== null && "plans" in parsed) {
			const plans = (parsed as { plans?: unknown }).plans;
			if (typeof plans === "object" && plans !== null) {
				return { version: 1, plans: plans as Record<string, PlanHistoryRecord> };
			}
		}
	} catch {
		// A missing or corrupt index means "no history yet" — never a hard failure, since the plan
		// files themselves are the source of truth and history is an extra.
	}
	return { version: 1, plans: {} };
}

async function writeIndex(index: PlanHistoryIndex): Promise<void> {
	await lockedFileSystem.writeJsonFileAtomic(indexPath(), index, { lock: null });
}

/** Runs `operation` with exclusive access to the index, handing it the parsed contents. */
async function withIndex<T>(operation: (index: PlanHistoryIndex) => Promise<T> | T): Promise<T> {
	await ensureRepo();
	return await lockedFileSystem.withLock({ path: indexPath(), type: "file" }, async () => {
		const index = await readIndex();
		return await operation(index);
	});
}

/**
 * Which file a (plan, target) pair refers to.
 *
 * Mirrors `writeSavedPlanSibling`: a markdown plan's HTML is `<stem>.html` beside it, and an HTML
 * plan *is* its own HTML with no markdown side. Keying history by the markdown plan's id (rather
 * than the sibling's own library id) means both sides of one document share a history record.
 */
function resolveTargetPath(entry: SavedPlanEntry, target: PlanHistoryTarget): string | null {
	const extension = extname(entry.path).toLowerCase();
	const isHtmlPlan = extension === ".html" || extension === ".htm";
	if (target === "html") {
		if (isHtmlPlan) {
			return entry.path;
		}
		const stem = basename(entry.path, extension);
		return join(dirname(entry.path), `${stem}.html`);
	}
	return isHtmlPlan ? null : entry.path;
}

/** `<stem>.html.src.md` beside the plan — the requirement a generated page came from. */
function resolveHtmlSourcePath(entry: SavedPlanEntry): string {
	const extension = extname(entry.path);
	const stem = basename(entry.path, extension);
	return join(dirname(entry.path), `${stem}.html.src.md`);
}

async function hashFile(path: string): Promise<{ oid: string; bytes: number } | null> {
	if (!(await pathExists(path))) {
		return null;
	}
	const result = await runGit(repoDir(), ["hash-object", "-w", "--", path], { env: gitEnv() });
	if (!result.ok || result.stdout === "") {
		return null;
	}
	const { size } = await stat(path);
	return { oid: result.stdout, bytes: size };
}

async function readBlob(oid: string): Promise<string> {
	// `trimStdout: false`: a document's trailing newlines are part of it, and trimming them would
	// make a restore silently differ from the version it claims to be.
	const result = await runGit(repoDir(), ["cat-file", "blob", oid], { env: gitEnv(), trimStdout: false });
	if (!result.ok) {
		throw new Error(`Version ${oid.slice(0, 8)} could not be read back: ${result.error ?? "unknown git failure"}`);
	}
	return result.stdout;
}

function recordFor(index: PlanHistoryIndex, planId: string): PlanHistoryRecord {
	const existing = index.plans[planId];
	if (existing) {
		existing.md ??= [];
		existing.html ??= [];
		existing.cursor ??= { md: null, html: null };
		return existing;
	}
	const created = emptyRecord();
	index.plans[planId] = created;
	return created;
}

function prune(record: PlanHistoryRecord, target: PlanHistoryTarget): void {
	const entries = record[target];
	if (entries.length <= MAX_ENTRIES_PER_TARGET) {
		return;
	}
	const kept = entries.slice(entries.length - MAX_ENTRIES_PER_TARGET);
	record[target] = kept;
	// The cursor must keep pointing at something that still exists, or undo/redo would dead-end.
	const cursor = record.cursor[target];
	if (cursor !== null && !kept.some((entry) => entry.id === cursor)) {
		record.cursor[target] = kept[0]?.id ?? null;
	}
}

export interface SnapshotPlanVersionInput {
	planId: string;
	target: PlanHistoryTarget;
	label: PlanHistoryLabel;
	/**
	 * `"baseline"` records the document as it stands *before* the first change, and only if nothing
	 * has been recorded for this target yet. Callers run it just before overwriting a file, so undo
	 * can reach the state the plan was opened in — otherwise the oldest reachable version is the
	 * result of the first save, and "put it back the way it was" is impossible.
	 */
	mode?: "normal" | "baseline";
}

/**
 * Records the file's current bytes as a version. Returns the new entry, or `null` when nothing was
 * recorded — the file is absent, git is unavailable, the content matches the version already at the
 * cursor, an `autosave` landed inside the throttle window, or `mode: "baseline"` found a history
 * that already has an entry for this target.
 */
export async function snapshotPlanVersion(input: SnapshotPlanVersionInput): Promise<PlanHistoryEntry | null> {
	const { available } = await isPlanHistoryAvailable();
	if (!available) {
		return null;
	}
	const plan = await findSavedPlanById(input.planId);
	if (!plan) {
		return null;
	}
	const path = resolveTargetPath(plan, input.target);
	if (path === null) {
		return null;
	}
	return await withIndex(async (index) => {
		const record = recordFor(index, input.planId);
		const entries = record[input.target];
		const newest = entries[entries.length - 1] ?? null;
		if (input.mode === "baseline") {
			// A baseline exists to catch the state *before* the first recorded change. Once anything is
			// recorded for this target there is nothing left to establish, and re-running it on every
			// save would be pure noise.
			if (newest !== null) {
				return null;
			}
		} else if (input.label === "autosave" && newest && Date.now() - newest.createdAt < AUTOSAVE_MIN_INTERVAL_MS) {
			return null;
		}
		const hashed = await hashFile(path);
		if (hashed === null) {
			return null;
		}
		const cursorId = record.cursor[input.target];
		const cursorEntry = entries.find((entry) => entry.id === cursorId) ?? newest;
		if (cursorEntry?.oid === hashed.oid) {
			// Same bytes as what is already recorded as current: an autosave with no real change, or
			// a regeneration that produced an identical page. Nothing to add.
			return null;
		}
		const entry: PlanHistoryEntry = {
			id: randomUUID(),
			target: input.target,
			oid: hashed.oid,
			bytes: hashed.bytes,
			label: input.label,
			createdAt: Date.now(),
		};
		if (input.target === "html") {
			const sourceOid = (await hashFile(resolveHtmlSourcePath(plan)))?.oid;
			if (sourceOid) {
				entry.pairedSrcOid = sourceOid;
			}
		}
		entries.push(entry);
		record.cursor[input.target] = entry.id;
		prune(record, input.target);
		await writeIndex(index);
		return entry;
	});
}

/**
 * Attaches the requirement a page was generated from to that page's newest version.
 *
 * Called when `<stem>.html.src.md` is written, which the editor does right *after* saving the HTML —
 * so the snapshot taken during the save could only have seen the previous requirement.
 */
export async function attachPlanHtmlSource(planId: string): Promise<void> {
	const { available } = await isPlanHistoryAvailable();
	if (!available) {
		return;
	}
	const plan = await findSavedPlanById(planId);
	if (!plan) {
		return;
	}
	const hashed = await hashFile(resolveHtmlSourcePath(plan));
	if (hashed === null) {
		return;
	}
	await withIndex(async (index) => {
		const record = recordFor(index, planId);
		const newest = record.html[record.html.length - 1];
		if (!newest || newest.pairedSrcOid === hashed.oid) {
			return;
		}
		newest.pairedSrcOid = hashed.oid;
		await writeIndex(index);
	});
}

/** Every recorded version for a plan, oldest first, with the on-disk ones flagged. */
export async function listPlanVersions(planId: string): Promise<PlanHistoryListing> {
	const { available, reason } = await isPlanHistoryAvailable();
	if (!available) {
		return { available: false, entries: [], cursor: { md: null, html: null }, ...(reason ? { reason } : {}) };
	}
	return await withIndex((index) => {
		const record = recordFor(index, planId);
		const entries = [...record.md, ...record.html]
			.map((entry) => ({ ...entry, isCurrent: record.cursor[entry.target] === entry.id }))
			.sort((left, right) => left.createdAt - right.createdAt);
		return { available: true, entries, cursor: { ...record.cursor } };
	});
}

async function materialize(entry: PlanHistoryEntry, plan: SavedPlanEntry): Promise<PlanHistoryMaterialization> {
	const path = resolveTargetPath(plan, entry.target);
	if (path === null) {
		throw new Error(`This plan has no ${entry.target} document to restore.`);
	}
	const content = await readBlob(entry.oid);
	await writeFile(path, content, "utf8");
	if (entry.target === "html" && entry.pairedSrcOid) {
		// Put the requirement back too, so the next Refine diffs against the page that is actually
		// on screen instead of against a newer requirement it never saw.
		await writeFile(resolveHtmlSourcePath(plan), await readBlob(entry.pairedSrcOid), "utf8");
	}
	return { entry, target: entry.target, path, content };
}

async function moveCursor(
	planId: string,
	target: PlanHistoryTarget,
	direction: -1 | 1,
): Promise<PlanHistoryMaterialization | null> {
	const { available } = await isPlanHistoryAvailable();
	if (!available) {
		return null;
	}
	const plan = await findSavedPlanById(planId);
	if (!plan) {
		return null;
	}
	const next = await withIndex(async (index) => {
		const record = recordFor(index, planId);
		const entries = record[target];
		if (entries.length === 0) {
			return null;
		}
		const cursorId = record.cursor[target];
		const currentIndex = cursorId === null ? entries.length - 1 : entries.findIndex((entry) => entry.id === cursorId);
		const targetIndex = (currentIndex === -1 ? entries.length - 1 : currentIndex) + direction;
		const candidate = entries[targetIndex];
		if (!candidate) {
			return null;
		}
		record.cursor[target] = candidate.id;
		await writeIndex(index);
		return candidate;
	});
	if (next === null) {
		return null;
	}
	return await materialize(next, plan);
}

/** Steps one version back and writes it to disk. `null` when there is nothing older. */
export function undoPlanVersion(planId: string, target: PlanHistoryTarget): Promise<PlanHistoryMaterialization | null> {
	return moveCursor(planId, target, -1);
}

/** Steps one version forward and writes it to disk. `null` when already at the newest. */
export function redoPlanVersion(planId: string, target: PlanHistoryTarget): Promise<PlanHistoryMaterialization | null> {
	return moveCursor(planId, target, 1);
}

/** Writes a specific version back to disk and points the cursor at it. */
export async function restorePlanVersion(planId: string, entryId: string): Promise<PlanHistoryMaterialization | null> {
	const { available } = await isPlanHistoryAvailable();
	if (!available) {
		return null;
	}
	const plan = await findSavedPlanById(planId);
	if (!plan) {
		return null;
	}
	const chosen = await withIndex(async (index) => {
		const record = recordFor(index, planId);
		const entry = [...record.md, ...record.html].find((candidate) => candidate.id === entryId);
		if (!entry) {
			return null;
		}
		record.cursor[entry.target] = entry.id;
		await writeIndex(index);
		return entry;
	});
	if (chosen === null) {
		return null;
	}
	return await materialize(chosen, plan);
}

/**
 * Drops the `diff --git a/<oid> b/<oid>` / `index` / `---` / `+++` preamble, keeping the hunks.
 * Diffing two loose blobs makes git name the "files" after their object ids, which reads as noise
 * in the editor's version list. Mirrors `plan-refine-diff.ts`'s treatment of the same preamble.
 */
function stripDiffHeader(diff: string): string {
	const hunkStart = diff.indexOf("@@");
	return (hunkStart === -1 ? diff : diff.slice(hunkStart)).trimEnd();
}

export interface PlanVersionDiff {
	/** Unified diff from the chosen version to what is on disk now. Empty when identical. */
	diff: string;
	/** False when the on-disk file is byte-identical to the version. */
	changed: boolean;
}

/**
 * Diffs a recorded version against the file as it stands now.
 *
 * The current bytes are hashed into the store first so git can diff two objects; that write is what
 * makes this cheap on a large document — the diff itself never leaves git.
 */
export async function diffPlanVersionAgainstCurrent(planId: string, entryId: string): Promise<PlanVersionDiff | null> {
	const { available } = await isPlanHistoryAvailable();
	if (!available) {
		return null;
	}
	const plan = await findSavedPlanById(planId);
	if (!plan) {
		return null;
	}
	const entry = await withIndex((index) => {
		const record = recordFor(index, planId);
		return [...record.md, ...record.html].find((candidate) => candidate.id === entryId) ?? null;
	});
	if (entry === null) {
		return null;
	}
	const path = resolveTargetPath(plan, entry.target);
	if (path === null) {
		return null;
	}
	const current = await hashFile(path);
	if (current === null) {
		return null;
	}
	if (current.oid === entry.oid) {
		return { diff: "", changed: false };
	}
	// `git diff` exits 1 when the inputs differ, which is the normal case here — so the exit code is
	// not an error signal and stdout is read either way.
	const result = await runGit(repoDir(), ["diff", "--no-color", entry.oid, current.oid], {
		env: gitEnv(),
		trimStdout: false,
	});
	const diff = result.stdout.trim() === "" ? (result.error ?? "") : stripDiffHeader(result.stdout);
	return { diff, changed: true };
}
