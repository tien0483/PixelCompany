import { readdir, rm, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import type {
	RuntimeBoardData,
	RuntimeCleanMergedWorktreesRequest,
	RuntimeCleanMergedWorktreesResponse,
	RuntimeCleanMergedWorktreesSkippedEntry,
	RuntimeWorktreeReclaimCategory,
	RuntimeWorktreeReclaimEntry,
} from "../core/api-contract";
import { hasLiveChainMemberSharingWorktree } from "../core/task-board-mutations";
import { listWorkspaceIndexEntries, loadWorkspaceBoardById } from "../state/workspace-state";
import { type BranchRegistryEntry, listActiveBranchEntries, reconcileBranchRegistry } from "./branch-registry";
import { runGitDeleteBranchAction } from "./git-sync";
import { runGit } from "./git-utils";
import { deleteTaskWorktree, getWorktreesBaseRootPath, pruneEmptyParents } from "./task-worktree";
import { measureDirectorySize } from "./worktree-disk-usage";
import { findOrphanNodeModuleDirs, removeOrphanNodeModuleDirs } from "./worktree-orphan-modules";

const DEFAULT_CATEGORIES: RuntimeWorktreeReclaimCategory[] = ["merged"];

/**
 * Task ids owned by a card on *any* board, not just the workspace being cleaned.
 *
 * A single card can cause worktrees to be created in more than one repo — a task
 * driven from the spm-3d-bi board ended up with an 800 MB akselos-dev worktree —
 * and the akselos-dev registry has no card to match it against. Checking one
 * board at a time therefore mislabels those as orphans and, worse, the old
 * merged-only path could never see them at all. Resolving ownership globally is
 * one board read per workspace and removes that whole class of stranded worktree.
 */
async function collectOwnedTaskIds(): Promise<Set<string>> {
	const owned = new Set<string>();
	let workspaces: { workspaceId: string }[];
	try {
		workspaces = await listWorkspaceIndexEntries();
	} catch {
		// Without the index we cannot prove a task is unowned. Returning an empty
		// set would mark everything orphaned, so signal "unknown" by throwing the
		// decision back to the caller via an empty-but-flagged result instead.
		throw new Error("Could not read the workspace index, so worktree ownership cannot be resolved.");
	}
	for (const workspace of workspaces) {
		let board: RuntimeBoardData;
		try {
			board = await loadWorkspaceBoardById(workspace.workspaceId);
		} catch {
			// A board that cannot be read is treated as owning nothing we can prove.
			continue;
		}
		for (const column of board.columns) {
			for (const card of column.cards) {
				owned.add(card.id);
			}
		}
	}
	return owned;
}

async function isWorktreeClean(worktreePath: string): Promise<boolean | null> {
	const status = await runGit(worktreePath, ["status", "--porcelain"], { trimStdout: false });
	if (!status.ok) {
		return null;
	}
	return status.stdout.trim().length === 0;
}

/**
 * True when the worktree still sits exactly on the commit it was created from and
 * has nothing uncommitted — i.e. the task reserved a worktree and never used it.
 * Deliberately strict: any commit ahead of base, or any dirt, disqualifies.
 */
async function isUnusedWorktree(entry: BranchRegistryEntry): Promise<boolean> {
	if ((await isWorktreeClean(entry.worktreePath)) !== true) {
		return false;
	}
	if (!entry.baseRef) {
		return false;
	}
	const head = await runGit(entry.worktreePath, ["rev-parse", "HEAD"]);
	const base = await runGit(entry.worktreePath, ["rev-parse", `${entry.baseRef}^{commit}`]);
	if (!head.ok || !base.ok) {
		return false;
	}
	if (head.stdout !== base.stdout) {
		return false;
	}
	// Belt-and-braces against a base ref that moved under us: HEAD matching the
	// ref's *current* commit is only meaningful if nothing sits between them.
	const ahead = await runGit(entry.worktreePath, ["rev-list", "--count", `${base.stdout}..HEAD`]);
	return ahead.ok && ahead.stdout === "0";
}

async function isMergedIntoBase(repoPath: string, entry: Pick<BranchRegistryEntry, "branch" | "baseRef">): Promise<boolean> {
	if (!entry.baseRef || !entry.branch) {
		return false;
	}
	const ancestorCheck = await runGit(repoPath, ["merge-base", "--is-ancestor", entry.branch, entry.baseRef]);
	return ancestorCheck.ok;
}

function taskIdFromKanbanBranch(branch: string): string | null {
	const prefix = "kanban/task-";
	if (!branch.startsWith(prefix)) {
		return null;
	}
	const taskId = branch.slice(prefix.length);
	return taskId.length > 0 ? taskId : null;
}

/**
 * Local `kanban/task-*` branches whose commits are already in the base ref but
 * whose worktree directory is gone — common after a manual delete or crash.
 */
async function findStaleMergedKanbanBranches(
	repoPath: string,
	entries: BranchRegistryEntry[],
): Promise<RuntimeWorktreeReclaimEntry[]> {
	const listResult = await runGit(repoPath, ["for-each-ref", "refs/heads/kanban/", "--format=%(refname:short)"]);
	if (!listResult.ok) {
		return [];
	}

	const reclaimable: RuntimeWorktreeReclaimEntry[] = [];
	for (const branch of listResult.stdout.split("\n").map((line) => line.trim()).filter((line) => line.length > 0)) {
		const registryEntry = entries.find((entry) => entry.branch === branch);
		if (registryEntry && (await directoryExists(registryEntry.worktreePath))) {
			continue;
		}
		const baseRef = registryEntry?.baseRef;
		if (!baseRef) {
			continue;
		}
		const mergeEntry: Pick<BranchRegistryEntry, "branch" | "baseRef"> = { branch, baseRef };
		if (!(await isMergedIntoBase(repoPath, mergeEntry))) {
			continue;
		}
		const taskId = registryEntry?.taskId ?? taskIdFromKanbanBranch(branch) ?? branch;
		reclaimable.push({
			taskId,
			branch,
			repoLabel: registryEntry ? basename(registryEntry.worktreePath) : "",
			worktreePath: registryEntry?.worktreePath ?? "",
			category: "stale-branch",
			sizeBytes: 0,
			reason: `Local branch fully merged into ${baseRef} with no worktree on disk.`,
		});
	}
	return reclaimable;
}

async function deleteBranchIfMerged(
	repoPath: string,
	entry: Pick<BranchRegistryEntry, "branch" | "baseRef">,
): Promise<void> {
	if (!entry.branch || !(await isMergedIntoBase(repoPath, entry))) {
		return;
	}
	await runGitDeleteBranchAction({ cwd: repoPath, branch: entry.branch });
}

async function removeUnregisteredWorktreeDirectory(worktreePath: string): Promise<void> {
	await rm(worktreePath, { recursive: true, force: true });
	await pruneEmptyParents(getWorktreesBaseRootPath(), dirname(worktreePath));
}

async function enrichWithOrphanNodeModules(
	entry: RuntimeWorktreeReclaimEntry,
): Promise<RuntimeWorktreeReclaimEntry> {
	if (!(await directoryExists(entry.worktreePath))) {
		return entry;
	}
	const orphanDirs = await findOrphanNodeModuleDirs(entry.worktreePath);
	if (orphanDirs.length === 0) {
		return entry;
	}
	const orphanNodeModulesBytes = orphanDirs.reduce((sum, dir) => sum + dir.sizeBytes, 0);
	return {
		...entry,
		orphanNodeModulesBytes,
		reason:
			orphanNodeModulesBytes > 0
				? `${entry.reason} Also has ${formatBytesShort(orphanNodeModulesBytes)} of unlinked node_modules.`
				: entry.reason,
	};
}

function formatBytesShort(bytes: number): string {
	if (bytes >= 1024 * 1024 * 1024) {
		return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
	}
	if (bytes >= 1024 * 1024) {
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}
	if (bytes >= 1024) {
		return `${(bytes / 1024).toFixed(1)} KB`;
	}
	return `${bytes} B`;
}

async function directoryExists(path: string): Promise<boolean> {
	try {
		return (await stat(path)).isDirectory();
	} catch {
		return false;
	}
}

/**
 * Directories under `~/.agent/worktrees/<taskId>/<repoLabel>` that no registry in
 * any workspace claims. These come from interrupted creates and from agents that
 * wrote to a mis-cased repo path; nothing will ever collect them otherwise.
 */
async function findUnregisteredWorktrees(claimedPaths: Set<string>): Promise<RuntimeWorktreeReclaimEntry[]> {
	const rootPath = getWorktreesBaseRootPath();
	let taskDirs: string[];
	try {
		taskDirs = await readdir(rootPath);
	} catch {
		return [];
	}

	const found: RuntimeWorktreeReclaimEntry[] = [];
	for (const taskId of taskDirs) {
		let repoDirs: string[];
		try {
			repoDirs = await readdir(join(rootPath, taskId));
		} catch {
			continue;
		}
		for (const repoLabel of repoDirs) {
			const worktreePath = join(rootPath, taskId, repoLabel);
			if (claimedPaths.has(worktreePath)) {
				continue;
			}
			found.push({
				taskId,
				branch: "",
				repoLabel,
				worktreePath,
				category: "unregistered",
				sizeBytes: await measureDirectorySize(worktreePath),
				reason: "No branch registry entry in any workspace claims this directory.",
			});
		}
	}
	return found;
}

/**
 * Startup sweep: drop registry entries whose worktree is gone and delete the
 * empty `~/.agent/worktrees/<taskId>` husks they leave behind.
 *
 * Without this, a worktree removed outside the runtime (a manual `git worktree
 * remove`, a kill between `worktree add` and `registerActiveBranch`) leaves an
 * `active` entry forever, and every later cleanup preview over-reports what is
 * still live. Best-effort by design — a workspace that cannot be read must not
 * stop the runtime from booting.
 */
export async function reconcileAllBranchRegistries(): Promise<{ workspaceId: string; droppedTaskIds: string[] }[]> {
	let workspaces: { workspaceId: string }[];
	try {
		workspaces = await listWorkspaceIndexEntries();
	} catch {
		return [];
	}

	const rootPath = getWorktreesBaseRootPath();
	const results: { workspaceId: string; droppedTaskIds: string[] }[] = [];
	for (const workspace of workspaces) {
		try {
			const { droppedTaskIds } = await reconcileBranchRegistry(workspace.workspaceId);
			for (const taskId of droppedTaskIds) {
				await pruneEmptyParents(rootPath, join(rootPath, taskId));
			}
			if (droppedTaskIds.length > 0) {
				results.push({ workspaceId: workspace.workspaceId, droppedTaskIds });
			}
		} catch {
			// Keep going; one unreadable registry shouldn't block the others.
		}
	}
	return results;
}

export interface WorktreeReclaimScan {
	reclaimable: RuntimeWorktreeReclaimEntry[];
	skipped: RuntimeCleanMergedWorktreesSkippedEntry[];
}

/**
 * Classifies every task worktree the runtime knows about without deleting anything.
 *
 * Split out from the delete path so the UI can render an accurate, sized preview,
 * and so the classification is testable on its own.
 */
export async function scanReclaimableWorktrees(options: {
	repoPath: string;
	workspaceId: string;
	board: RuntimeBoardData;
}): Promise<WorktreeReclaimScan> {
	const entries = await listActiveBranchEntries(options.workspaceId);
	const reclaimable: RuntimeWorktreeReclaimEntry[] = [];
	const skipped: RuntimeCleanMergedWorktreesSkippedEntry[] = [];

	let ownedTaskIds: Set<string> | null = null;
	try {
		ownedTaskIds = await collectOwnedTaskIds();
	} catch {
		// Ownership unknown: skip the orphan category entirely rather than risk
		// proposing a live worktree for deletion.
		ownedTaskIds = null;
	}

	const claimedPaths = new Set<string>();

	for (const entry of entries) {
		claimedPaths.add(entry.worktreePath);
		const repoLabel = basename(entry.worktreePath);
		const base = {
			taskId: entry.taskId,
			branch: entry.branch,
			repoLabel,
			worktreePath: entry.worktreePath,
		};

		if (hasLiveChainMemberSharingWorktree(options.board, entry.taskId, entry.taskId)) {
			skipped.push({ ...base, reason: "Shared with a live chain member." });
			continue;
		}

		if (!(await directoryExists(entry.worktreePath))) {
			reclaimable.push({
				...base,
				category: "missing",
				sizeBytes: 0,
				reason: "Registry entry with no worktree on disk.",
			});
			continue;
		}

		const sizeBytes = await measureDirectorySize(entry.worktreePath);

		if (await isMergedIntoBase(options.repoPath, entry)) {
			reclaimable.push(
				await enrichWithOrphanNodeModules({
					...base,
					category: "merged",
					sizeBytes,
					reason: `Fully merged into ${entry.baseRef}.`,
				}),
			);
			continue;
		}

		if (await isUnusedWorktree(entry)) {
			reclaimable.push(
				await enrichWithOrphanNodeModules({
					...base,
					category: "unused",
					sizeBytes,
					reason: `Clean and still on its base commit (${entry.baseRef}) — nothing was written here.`,
				}),
			);
			continue;
		}

		const clean = await isWorktreeClean(entry.worktreePath);
		if (ownedTaskIds && !ownedTaskIds.has(entry.taskId)) {
			if (clean !== true) {
				skipped.push({
					...base,
					sizeBytes,
					reason: "No card owns this worktree, but it has uncommitted changes.",
				});
				continue;
			}
			reclaimable.push(
				await enrichWithOrphanNodeModules({
					...base,
					category: "orphaned",
					sizeBytes,
					reason: "No card on any board owns this worktree.",
				}),
			);
			continue;
		}

		skipped.push({
			...base,
			sizeBytes,
			reason: clean === true ? "Has commits that are not merged into its base ref." : "Has uncommitted changes.",
		});
	}

	const unregistered = await findUnregisteredWorktrees(claimedPaths);
	for (const entry of unregistered) {
		reclaimable.push(await enrichWithOrphanNodeModules(entry));
	}
	reclaimable.push(...(await findStaleMergedKanbanBranches(options.repoPath, entries)));

	return { reclaimable, skipped };
}

/**
 * Removes task worktrees in the requested categories. Safety for `merged` mirrors
 * `git branch -d`: a branch only qualifies once every one of its commits is an
 * ancestor of the base ref, so nothing in-flight is lost. With `dryRun: true`,
 * every eligibility check still runs but nothing is deleted — the same response
 * shape doubles as a preview.
 *
 * Defaults to the `merged` category alone, so callers written before the other
 * categories existed keep their original behaviour.
 */
export async function cleanMergedWorktrees(options: {
	repoPath: string;
	workspaceId: string;
	board: RuntimeBoardData;
	dryRun?: boolean;
	categories?: RuntimeCleanMergedWorktreesRequest["categories"];
	taskIds?: RuntimeCleanMergedWorktreesRequest["taskIds"];
	includeOrphanNodeModules?: RuntimeCleanMergedWorktreesRequest["includeOrphanNodeModules"];
}): Promise<RuntimeCleanMergedWorktreesResponse> {
	const scan = await scanReclaimableWorktrees(options);
	const categories = new Set<RuntimeWorktreeReclaimCategory>(options.categories ?? DEFAULT_CATEGORIES);
	const taskIdFilter = options.taskIds ? new Set(options.taskIds) : null;

	const cleanedTaskIds: string[] = [];
	const cleanedNodeModulePaths: string[] = [];
	const skipped = [...scan.skipped];
	let reclaimedBytes = 0;
	let reclaimedNodeModuleBytes = 0;

	const registryEntries = await listActiveBranchEntries(options.workspaceId);
	const registryByTaskId = new Map(registryEntries.map((entry) => [entry.taskId, entry]));

	async function maybeStripOrphanNodeModules(entry: RuntimeWorktreeReclaimEntry): Promise<void> {
		if (!options.includeOrphanNodeModules || !(await directoryExists(entry.worktreePath))) {
			return;
		}
		const result = await removeOrphanNodeModuleDirs(entry.worktreePath, options.dryRun === true);
		for (const cleaned of result.cleaned) {
			cleanedNodeModulePaths.push(cleaned.path);
			reclaimedNodeModuleBytes += cleaned.sizeBytes;
		}
		skipped.push(
			...result.skipped.map((item) => ({
				taskId: entry.taskId,
				branch: entry.branch,
				repoLabel: entry.repoLabel,
				reason: item.reason,
			})),
		);
	}

	for (const entry of scan.reclaimable) {
		if (taskIdFilter && !taskIdFilter.has(entry.taskId)) {
			continue;
		}
		const deleteWorktree = categories.has(entry.category);
		const stripOrphanModules = options.includeOrphanNodeModules === true;
		if (!deleteWorktree && !stripOrphanModules) {
			continue;
		}

		if (entry.category === "stale-branch") {
			if (!deleteWorktree) {
				continue;
			}
			if (options.dryRun) {
				cleanedTaskIds.push(entry.taskId);
				continue;
			}
			await runGitDeleteBranchAction({ cwd: options.repoPath, branch: entry.branch });
			cleanedTaskIds.push(entry.taskId);
			continue;
		}

		if (options.dryRun) {
			if (deleteWorktree) {
				cleanedTaskIds.push(entry.taskId);
				reclaimedBytes += entry.sizeBytes;
			}
			if (stripOrphanModules && !deleteWorktree) {
				await maybeStripOrphanNodeModules(entry);
			}
			continue;
		}

		if (deleteWorktree && entry.category === "unregistered") {
			try {
				await removeUnregisteredWorktreeDirectory(entry.worktreePath);
				cleanedTaskIds.push(entry.taskId);
				reclaimedBytes += entry.sizeBytes;
			} catch (error) {
				skipped.push({
					taskId: entry.taskId,
					branch: entry.branch,
					repoLabel: entry.repoLabel,
					sizeBytes: entry.sizeBytes,
					reason: error instanceof Error ? error.message : String(error),
				});
			}
			continue;
		}

		if (deleteWorktree && entry.category === "missing") {
			const registryEntry = registryByTaskId.get(entry.taskId);
			const deleteResult = await deleteTaskWorktree({ repoPath: options.repoPath, taskId: entry.taskId });
			if (!deleteResult.ok) {
				skipped.push({
					taskId: entry.taskId,
					branch: entry.branch,
					repoLabel: entry.repoLabel,
					sizeBytes: entry.sizeBytes,
					reason: deleteResult.error ?? "Failed to clear stale registry entry.",
				});
				continue;
			}
			if (registryEntry) {
				await deleteBranchIfMerged(options.repoPath, registryEntry);
			}
			cleanedTaskIds.push(entry.taskId);
			continue;
		}

		if (deleteWorktree) {
			const deleteResult = await deleteTaskWorktree({ repoPath: options.repoPath, taskId: entry.taskId });
			if (!deleteResult.ok) {
				skipped.push({
					taskId: entry.taskId,
					branch: entry.branch,
					repoLabel: entry.repoLabel,
					sizeBytes: entry.sizeBytes,
					reason: deleteResult.error ?? "Failed to remove worktree.",
				});
				continue;
			}
			const registryEntry = registryByTaskId.get(entry.taskId);
			if (registryEntry) {
				await deleteBranchIfMerged(options.repoPath, registryEntry);
			}
			cleanedTaskIds.push(entry.taskId);
			reclaimedBytes += entry.sizeBytes;
			continue;
		}

		if (stripOrphanModules) {
			await maybeStripOrphanNodeModules(entry);
		}
	}

	if (!options.dryRun && cleanedTaskIds.length > 0) {
		// Deleting a worktree leaves its registry entry behind in the failure paths
		// `deleteTaskWorktree` swallows; reconciling here keeps the next scan honest.
		await reconcileBranchRegistry(options.workspaceId);
	}

	return {
		ok: true,
		cleanedTaskIds,
		skipped,
		reclaimable: scan.reclaimable,
		reclaimableBytes: reclaimedBytes,
		cleanedNodeModulePaths: cleanedNodeModulePaths.length > 0 ? cleanedNodeModulePaths : undefined,
		reclaimedNodeModuleBytes: reclaimedNodeModuleBytes > 0 ? reclaimedNodeModuleBytes : undefined,
	};
}
