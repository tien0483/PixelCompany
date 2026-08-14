import { readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";

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

async function isMergedIntoBase(repoPath: string, entry: BranchRegistryEntry): Promise<boolean> {
	if (!entry.baseRef) {
		return false;
	}
	const ancestorCheck = await runGit(repoPath, ["merge-base", "--is-ancestor", entry.branch, entry.baseRef]);
	return ancestorCheck.ok;
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
			reclaimable.push({
				...base,
				category: "merged",
				sizeBytes,
				reason: `Fully merged into ${entry.baseRef}.`,
			});
			continue;
		}

		if (await isUnusedWorktree(entry)) {
			reclaimable.push({
				...base,
				category: "unused",
				sizeBytes,
				reason: `Clean and still on its base commit (${entry.baseRef}) — nothing was written here.`,
			});
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
			reclaimable.push({
				...base,
				category: "orphaned",
				sizeBytes,
				reason: "No card on any board owns this worktree.",
			});
			continue;
		}

		skipped.push({
			...base,
			sizeBytes,
			reason: clean === true ? "Has commits that are not merged into its base ref." : "Has uncommitted changes.",
		});
	}

	reclaimable.push(...(await findUnregisteredWorktrees(claimedPaths)));

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
}): Promise<RuntimeCleanMergedWorktreesResponse> {
	const scan = await scanReclaimableWorktrees(options);
	const categories = new Set<RuntimeWorktreeReclaimCategory>(options.categories ?? DEFAULT_CATEGORIES);
	const taskIdFilter = options.taskIds ? new Set(options.taskIds) : null;

	const cleanedTaskIds: string[] = [];
	const skipped = [...scan.skipped];
	let reclaimedBytes = 0;

	for (const entry of scan.reclaimable) {
		if (!categories.has(entry.category)) {
			continue;
		}
		if (taskIdFilter && !taskIdFilter.has(entry.taskId)) {
			continue;
		}

		if (options.dryRun) {
			cleanedTaskIds.push(entry.taskId);
			reclaimedBytes += entry.sizeBytes;
			continue;
		}

		// `unregistered` has no registry entry, so `deleteTaskWorktree` (which keys
		// off the registry) has nothing to act on. It is reported for visibility and
		// removed through the same path only once a registry entry exists, which by
		// definition it never will — so it is surfaced, not swept, here.
		if (entry.category === "unregistered") {
			skipped.push({
				taskId: entry.taskId,
				branch: entry.branch,
				repoLabel: entry.repoLabel,
				sizeBytes: entry.sizeBytes,
				reason: `Unregistered directory at ${entry.worktreePath} — remove it manually.`,
			});
			continue;
		}

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

		// Best-effort: the worktree is gone either way, so a branch-delete failure
		// (e.g. already removed) shouldn't be reported as a skip. Only merged
		// branches are deleted — an unused/orphaned worktree's branch may still hold
		// the only reference to work, so it is left in place.
		if (entry.category === "merged") {
			await runGitDeleteBranchAction({ cwd: options.repoPath, branch: entry.branch });
		}
		cleanedTaskIds.push(entry.taskId);
		reclaimedBytes += entry.sizeBytes;
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
	};
}
