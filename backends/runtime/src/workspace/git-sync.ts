import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
	RuntimeCleanStashResponse,
	RuntimeGitCheckoutResponse,
	RuntimeGitCherryPickResponse,
	RuntimeGitCommitResponse,
	RuntimeGitConflictFile,
	RuntimeGitConflictOperationResponse,
	RuntimeGitConflictSide,
	RuntimeGitConflictState,
	RuntimeGitConflictsResponse,
	RuntimeGitCreateBranchResponse,
	RuntimeGitDeleteBranchResponse,
	RuntimeGitDiscardResponse,
	RuntimeGitMergeBranchResponse,
	RuntimeGitMergeIntoCurrentResponse,
	RuntimeGitPushBranchResponse,
	RuntimeGitRebaseCurrentOntoResponse,
	RuntimeGitResolveConflictResponse,
	RuntimeGitRevertResponse,
	RuntimeGitSyncAction,
	RuntimeGitSyncResponse,
	RuntimeGitSyncSummary,
} from "../core/api-contract";
import { mapWithConcurrency } from "../core/async-pool";
import { appendBranchRegistryStatusLog, getActiveBranchEntry } from "./branch-registry";
import type { GitConflictState } from "./git-conflict-state";
import {
	abortGitOperation,
	continueGitOperation,
	isMergeInProgress,
	isRebaseInProgress,
	probeGitConflictState,
	skipRebaseCommit,
	stoppedOnResolvableConflict,
} from "./git-conflict-state";
import { borrowBaseWorktree, releaseBaseWorktree } from "./git-conflict-worktree";
import {
	CONFLICT_FILE_MAX_BYTES,
	PATH_FINGERPRINT_CONCURRENCY,
	UNTRACKED_ADDITION_MAX_FILE_BYTES,
	UNTRACKED_ADDITION_SCAN_MAX_FILES,
	UNTRACKED_FINGERPRINT_MAX_PATHS,
	WORKSPACE_CHANGES_CONCURRENCY,
} from "./git-limits";
import { getGitStdout, resolveGitRepoRoot as resolveRepoRoot, runGit } from "./git-utils";

interface GitPathFingerprint {
	path: string;
	size: number | null;
	mtimeMs: number | null;
	ctimeMs: number | null;
}

export interface GitWorkspaceProbe {
	repoRoot: string;
	headCommit: string | null;
	currentBranch: string | null;
	upstreamBranch: string | null;
	aheadCount: number;
	behindCount: number;
	changedFiles: number;
	untrackedPaths: string[];
	stateToken: string;
}

function countLines(text: string): number {
	if (!text) {
		return 0;
	}
	return text.split("\n").length;
}

function parseNumstatTotals(output: string): { additions: number; deletions: number } {
	let additions = 0;
	let deletions = 0;

	for (const rawLine of output.split("\n")) {
		const line = rawLine.trim();
		if (!line) {
			continue;
		}
		const [addedRaw, deletedRaw] = line.split("\t");
		const added = Number.parseInt(addedRaw ?? "", 10);
		const deleted = Number.parseInt(deletedRaw ?? "", 10);
		if (Number.isFinite(added)) {
			additions += added;
		}
		if (Number.isFinite(deleted)) {
			deletions += deleted;
		}
	}

	return { additions, deletions };
}

function parseAheadBehindCounts(output: string): { aheadCount: number; behindCount: number } {
	const [aheadRaw, behindRaw] = output.trim().split(/\s+/, 2);
	const ahead = Math.abs(Number.parseInt(aheadRaw ?? "", 10));
	const behind = Math.abs(Number.parseInt(behindRaw ?? "", 10));
	return {
		aheadCount: Number.isFinite(ahead) ? ahead : 0,
		behindCount: Number.isFinite(behind) ? behind : 0,
	};
}

function buildFingerprintToken(fingerprints: GitPathFingerprint[]): string {
	return fingerprints
		.map((entry) => `${entry.path}\t${entry.size ?? "null"}\t${entry.mtimeMs ?? "null"}\t${entry.ctimeMs ?? "null"}`)
		.join("\n");
}

async function buildPathFingerprints(repoRoot: string, paths: string[]): Promise<GitPathFingerprint[]> {
	const uniqueSortedPaths = Array.from(new Set(paths))
		.sort((left, right) => left.localeCompare(right))
		// This `stat()` fan-out — not the `git status` call — is what makes a poll
		// tick expensive on a repo with thousands of untracked paths. The token it
		// feeds only has to change when the working tree does, and the raw status
		// output (also part of the token) already covers paths beyond this cap.
		.slice(0, UNTRACKED_FINGERPRINT_MAX_PATHS);
	return await mapWithConcurrency(
		uniqueSortedPaths,
		PATH_FINGERPRINT_CONCURRENCY,
		async (path): Promise<GitPathFingerprint> => {
			try {
				const fileStat = await stat(join(repoRoot, path));
				return {
					path,
					size: fileStat.size,
					mtimeMs: fileStat.mtimeMs,
					ctimeMs: fileStat.ctimeMs,
				} satisfies GitPathFingerprint;
			} catch {
				return {
					path,
					size: null,
					mtimeMs: null,
					ctimeMs: null,
				} satisfies GitPathFingerprint;
			}
		},
	);
}

function parseStatusPath(line: string): string | null {
	const trimmed = line.trim();
	if (!trimmed) {
		return null;
	}
	const parts = trimmed.split("\t");
	const metadata = parts[0]?.trim() ?? "";
	const tokens = metadata.split(/\s+/);
	return tokens[tokens.length - 1] ?? null;
}

export async function probeGitWorkspaceState(cwd: string): Promise<GitWorkspaceProbe> {
	const repoRoot = await resolveRepoRoot(cwd);
	const [statusResult, headCommitResult] = await Promise.all([
		runGit(repoRoot, ["status", "--porcelain=v2", "--branch", "--untracked-files=all"]),
		runGit(repoRoot, ["rev-parse", "--verify", "HEAD"]),
	]);

	if (!statusResult.ok) {
		throw new Error(statusResult.error ?? "Git status command failed.");
	}

	let currentBranch: string | null = null;
	let upstreamBranch: string | null = null;
	let aheadCount = 0;
	let behindCount = 0;
	const fingerprintPaths: string[] = [];
	const untrackedPaths: string[] = [];
	let changedFiles = 0;

	for (const rawLine of statusResult.stdout.split("\n")) {
		const line = rawLine.trim();
		if (!line) {
			continue;
		}
		if (line.startsWith("# branch.head ")) {
			const branchName = line.slice("# branch.head ".length).trim();
			currentBranch = branchName && branchName !== "(detached)" ? branchName : null;
			continue;
		}
		if (line.startsWith("# branch.upstream ")) {
			upstreamBranch = line.slice("# branch.upstream ".length).trim() || null;
			continue;
		}
		if (line.startsWith("# branch.ab ")) {
			const counts = parseAheadBehindCounts(line.slice("# branch.ab ".length));
			aheadCount = counts.aheadCount;
			behindCount = counts.behindCount;
			continue;
		}
		if (line.startsWith("? ")) {
			const path = line.slice(2).trim();
			if (!path) {
				continue;
			}
			changedFiles += 1;
			untrackedPaths.push(path);
			fingerprintPaths.push(path);
			continue;
		}
		if (line.startsWith("1 ") || line.startsWith("2 ") || line.startsWith("u ")) {
			const path = parseStatusPath(line);
			if (!path) {
				continue;
			}
			changedFiles += 1;
			fingerprintPaths.push(path);
			const renameParts = line.split("\t");
			const previousPath = renameParts[1]?.trim();
			if (previousPath) {
				fingerprintPaths.push(previousPath);
			}
		}
	}

	const headCommit = headCommitResult.ok && headCommitResult.stdout ? headCommitResult.stdout : null;
	const fingerprints = await buildPathFingerprints(repoRoot, fingerprintPaths);

	return {
		repoRoot,
		headCommit,
		currentBranch,
		upstreamBranch,
		aheadCount,
		behindCount,
		changedFiles,
		untrackedPaths,
		stateToken: [
			repoRoot,
			headCommit ?? "no-head",
			currentBranch ?? "detached",
			upstreamBranch ?? "no-upstream",
			String(aheadCount),
			String(behindCount),
			statusResult.stdout,
			buildFingerprintToken(fingerprints),
		].join("\n--\n"),
	};
}

/**
 * Reads untracked files to count their lines for the `+N` badge. Every byte of
 * every untracked file used to land in memory at once, every poll tick; the
 * caps below make it a bounded estimate instead, which is all a badge needs.
 */
async function countUntrackedAdditions(repoRoot: string, untrackedPaths: string[]): Promise<number> {
	const scannedPaths = untrackedPaths.slice(0, UNTRACKED_ADDITION_SCAN_MAX_FILES);
	const counts = await mapWithConcurrency(scannedPaths, PATH_FINGERPRINT_CONCURRENCY / 2, async (relativePath) => {
		const absolutePath = join(repoRoot, relativePath);
		try {
			const fileStat = await stat(absolutePath);
			if (fileStat.size > UNTRACKED_ADDITION_MAX_FILE_BYTES) {
				return 0;
			}
			const contents = await readFile(absolutePath, "utf8");
			return countLines(contents);
		} catch {
			return 0;
		}
	});
	return counts.reduce((total, value) => total + value, 0);
}

async function hasGitRef(repoRoot: string, ref: string): Promise<boolean> {
	const result = await runGit(repoRoot, ["show-ref", "--verify", "--quiet", ref]);
	return result.ok;
}

export async function getGitSyncSummary(
	cwd: string,
	options?: { probe?: GitWorkspaceProbe },
): Promise<RuntimeGitSyncSummary> {
	const probe = options?.probe ?? (await probeGitWorkspaceState(cwd));
	const diffResult = await runGit(probe.repoRoot, ["diff", "--numstat", "HEAD", "--"]);
	const trackedTotals = diffResult.ok ? parseNumstatTotals(diffResult.stdout) : { additions: 0, deletions: 0 };
	const untrackedAdditions = await countUntrackedAdditions(probe.repoRoot, probe.untrackedPaths);
	// An unfinished merge/rebase/cherry-pick rides along on the summary so the git
	// panel and the top bar can badge it without a second round trip.
	const conflictState = await probeGitConflictState(probe.repoRoot);

	return {
		currentBranch: probe.currentBranch,
		upstreamBranch: probe.upstreamBranch,
		changedFiles: probe.changedFiles,
		additions: trackedTotals.additions + untrackedAdditions,
		deletions: trackedTotals.deletions,
		aheadCount: probe.aheadCount,
		behindCount: probe.behindCount,
		conflictedFiles: conflictState.paths.length,
		pendingOperation: conflictState.operation,
	};
}

/**
 * Commits reachable from the worktree's HEAD but not from `baseRef`. Used to decide whether
 * a task branch has anything to merge even when the working tree is clean (changedFiles === 0)
 * — e.g. right after a commit lands and there's no more uncommitted diff.
 */
export async function getCommitsAheadOfBaseRef(worktreePath: string, baseRef: string): Promise<number> {
	const trimmedBaseRef = baseRef.trim();
	if (!trimmedBaseRef) {
		return 0;
	}
	const result = await getGitStdout(["rev-list", "--count", `${trimmedBaseRef}..HEAD`], worktreePath).catch(
		() => null,
	);
	if (!result) {
		return 0;
	}
	const count = Number.parseInt(result, 10);
	return Number.isFinite(count) ? count : 0;
}

export async function runGitSyncAction(options: {
	cwd: string;
	action: RuntimeGitSyncAction;
}): Promise<RuntimeGitSyncResponse> {
	const initialSummary = await getGitSyncSummary(options.cwd);

	if (options.action === "pull" && initialSummary.changedFiles > 0) {
		return {
			ok: false,
			action: options.action,
			summary: initialSummary,
			output: "",
			error: "Pull failed: working tree has local changes. Commit, stash, or discard changes first.",
		};
	}

	const argsByAction: Record<RuntimeGitSyncAction, string[]> = {
		fetch: ["fetch", "--all", "--prune"],
		pull: ["pull", "--ff-only"],
		push: ["push"],
		// `-u` also stashes untracked files so the working tree ends fully clean.
		stash: ["stash", "push", "-u"],
		"stash-pop": ["stash", "pop"],
	};
	const commandResult = await runGit(options.cwd, argsByAction[options.action]);
	const nextSummary = await getGitSyncSummary(options.cwd);

	if (!commandResult.ok) {
		return {
			ok: false,
			action: options.action,
			summary: nextSummary,
			output: commandResult.output,
			error: commandResult.error ?? "Git command failed.",
		};
	}

	return {
		ok: true,
		action: options.action,
		summary: nextSummary,
		output: commandResult.output,
	};
}

/**
 * Drops every entry in the stash (`git stash clear`). Counts entries via
 * `stash list` first so the response can report how many were removed —
 * `stash clear` itself prints nothing on success.
 */
export async function cleanGitStash(cwd: string): Promise<RuntimeCleanStashResponse> {
	const repoRoot = await resolveRepoRoot(cwd);
	const listResult = await runGit(repoRoot, ["stash", "list"]);
	if (!listResult.ok) {
		return {
			ok: false,
			clearedCount: 0,
			output: listResult.output,
			error: listResult.error ?? "Failed to list stash entries.",
		};
	}

	const clearedCount = listResult.stdout
		? listResult.stdout.split("\n").filter((line) => line.trim().length > 0).length
		: 0;
	if (clearedCount === 0) {
		return { ok: true, clearedCount: 0, output: "" };
	}

	const clearResult = await runGit(repoRoot, ["stash", "clear"]);
	if (!clearResult.ok) {
		return {
			ok: false,
			clearedCount: 0,
			output: clearResult.output,
			error: clearResult.error ?? "Failed to clear stash.",
		};
	}

	return { ok: true, clearedCount, output: clearResult.output };
}

export async function commitWorkspaceChanges(options: {
	cwd: string;
	message: string;
	paths?: string[];
}): Promise<RuntimeGitCommitResponse> {
	const repoRoot = await resolveRepoRoot(options.cwd);
	const message = options.message.trim();

	if (!message) {
		return {
			ok: false,
			summary: await getGitSyncSummary(repoRoot),
			output: "",
			error: "Commit message cannot be empty.",
		};
	}

	const initialSummary = await getGitSyncSummary(repoRoot);
	if (initialSummary.changedFiles === 0) {
		return {
			ok: false,
			summary: initialSummary,
			output: "",
			error: "There are no changes to commit.",
		};
	}

	// Stage the selected changeset (or everything). `-A` also stages deletions and
	// untracked files, matching what the summary counts as "changed".
	const selectedPaths = options.paths?.map((path) => path.trim()).filter(Boolean) ?? [];
	const addResult =
		selectedPaths.length > 0
			? await runGit(repoRoot, ["add", "--", ...selectedPaths])
			: await runGit(repoRoot, ["add", "-A"]);
	if (!addResult.ok) {
		return {
			ok: false,
			summary: await getGitSyncSummary(repoRoot),
			output: addResult.output,
			error: addResult.error ?? "Failed to stage changes.",
		};
	}

	const commitResult = await runGit(repoRoot, ["commit", "-m", message]);
	const summary = await getGitSyncSummary(repoRoot);
	if (!commitResult.ok) {
		return {
			ok: false,
			summary,
			output: commitResult.output,
			error: commitResult.error ?? "Failed to commit changes.",
		};
	}
	return { ok: true, summary, output: commitResult.output };
}

export async function runGitCheckoutAction(options: {
	cwd: string;
	branch: string;
}): Promise<RuntimeGitCheckoutResponse> {
	const requestedBranch = options.branch.trim();
	const initialSummary = await getGitSyncSummary(options.cwd);

	if (!requestedBranch) {
		return {
			ok: false,
			branch: requestedBranch,
			summary: initialSummary,
			output: "",
			error: "Branch name cannot be empty.",
		};
	}

	if (initialSummary.currentBranch === requestedBranch) {
		return {
			ok: true,
			branch: requestedBranch,
			summary: initialSummary,
			output: `Already on '${requestedBranch}'.`,
		};
	}

	const repoRoot = await resolveRepoRoot(options.cwd);

	const hasLocalBranch = await hasGitRef(repoRoot, `refs/heads/${requestedBranch}`);
	const commandResult = hasLocalBranch
		? await runGit(repoRoot, ["switch", requestedBranch])
		: (await hasGitRef(repoRoot, `refs/remotes/origin/${requestedBranch}`))
			? await runGit(repoRoot, ["switch", "--track", `origin/${requestedBranch}`])
			: await runGit(repoRoot, ["switch", requestedBranch]);
	const nextSummary = await getGitSyncSummary(repoRoot);

	if (!commandResult.ok) {
		return {
			ok: false,
			branch: requestedBranch,
			summary: nextSummary,
			output: commandResult.output,
			error: commandResult.error ?? "Git branch switch failed.",
		};
	}

	return {
		ok: true,
		branch: requestedBranch,
		summary: nextSummary,
		output: commandResult.output,
	};
}

export async function runGitDeleteBranchAction(options: {
	cwd: string;
	branch: string;
	force?: boolean;
}): Promise<RuntimeGitDeleteBranchResponse> {
	const requestedBranch = options.branch.trim();
	const summary = await getGitSyncSummary(options.cwd);

	if (!requestedBranch) {
		return {
			ok: false,
			branch: requestedBranch,
			summary,
			output: "",
			error: "Branch name cannot be empty.",
		};
	}

	if (summary.currentBranch === requestedBranch) {
		return {
			ok: false,
			branch: requestedBranch,
			summary,
			output: "",
			error: `Cannot delete '${requestedBranch}' because it is the current branch. Switch to another branch first.`,
		};
	}

	const repoRoot = await resolveRepoRoot(options.cwd);

	const hasLocalBranch = await hasGitRef(repoRoot, `refs/heads/${requestedBranch}`);
	if (!hasLocalBranch) {
		return {
			ok: false,
			branch: requestedBranch,
			summary,
			output: "",
			error: `Local branch '${requestedBranch}' does not exist.`,
		};
	}

	// `-d` refuses to drop a branch that is not fully merged, which keeps the
	// action data-safe; callers pass `force: true` for an explicit `-D`.
	const deleteFlag = options.force ? "-D" : "-d";
	const commandResult = await runGit(repoRoot, ["branch", deleteFlag, requestedBranch]);
	const nextSummary = await getGitSyncSummary(repoRoot);

	if (!commandResult.ok) {
		return {
			ok: false,
			branch: requestedBranch,
			summary: nextSummary,
			output: commandResult.output,
			error: commandResult.error ?? "Git branch delete failed.",
		};
	}

	return {
		ok: true,
		branch: requestedBranch,
		summary: nextSummary,
		output: commandResult.output,
	};
}

export async function runGitCreateBranchAction(options: {
	cwd: string;
	newBranch: string;
	startPoint: string;
}): Promise<RuntimeGitCreateBranchResponse> {
	const requestedBranch = options.newBranch.trim();
	const startPoint = options.startPoint.trim();
	const summary = await getGitSyncSummary(options.cwd);

	if (!requestedBranch) {
		return {
			ok: false,
			branch: requestedBranch,
			startPoint,
			summary,
			output: "",
			error: "Branch name cannot be empty.",
		};
	}

	if (!startPoint) {
		return {
			ok: false,
			branch: requestedBranch,
			startPoint,
			summary,
			output: "",
			error: "Start point cannot be empty.",
		};
	}

	const repoRoot = await resolveRepoRoot(options.cwd);

	const hasLocalBranch = await hasGitRef(repoRoot, `refs/heads/${requestedBranch}`);
	if (hasLocalBranch) {
		return {
			ok: false,
			branch: requestedBranch,
			startPoint,
			summary,
			output: "",
			error: `Local branch '${requestedBranch}' already exists.`,
		};
	}

	// `git branch <new> <start>` creates the branch without moving HEAD, so creating
	// from another ref (e.g. master) leaves the current checkout in place. git errors
	// out on an invalid name or an unknown start point, which is surfaced cleanly below.
	const commandResult = await runGit(repoRoot, ["branch", requestedBranch, startPoint]);
	const nextSummary = await getGitSyncSummary(repoRoot);

	if (!commandResult.ok) {
		return {
			ok: false,
			branch: requestedBranch,
			startPoint,
			summary: nextSummary,
			output: commandResult.output,
			error: commandResult.error ?? "Git branch create failed.",
		};
	}

	return {
		ok: true,
		branch: requestedBranch,
		startPoint,
		summary: nextSummary,
		output: commandResult.output,
	};
}

/**
 * Decides what to do with a merge/rebase/cherry-pick that just failed.
 *
 * A conflict is *left in place* so the user can resolve it from the
 * Resolve-merge-conflicts dialog — aborting it unconditionally, as every one of
 * these actions used to, meant `MERGE_HEAD` never survived a request and the dialog
 * could never see a conflict at all. Any other failure (an unknown ref, a hook
 * refusal) has nothing to resolve, so it is still aborted rather than leaving the
 * worktree stranded half-way.
 */
function toConflictState(state: GitConflictState, worktreePath: string): RuntimeGitConflictState | null {
	if (!state.operation) {
		return null;
	}
	return {
		operation: state.operation,
		worktreePath,
		paths: state.paths,
		autostashHeld: state.autostashHeld,
	};
}

async function settleFailedGitOperation(
	repoRoot: string,
	worktreePath: string,
): Promise<RuntimeGitConflictState | null> {
	const conflict = await stoppedOnResolvableConflict(repoRoot);
	if (conflict) {
		return toConflictState(conflict, worktreePath);
	}
	const state = await probeGitConflictState(repoRoot);
	if (state.operation) {
		await abortGitOperation(repoRoot, state.operation);
	}
	return null;
}

/**
 * Merges {@link options.branch} into {@link options.baseRef}. {@link options.cwd}
 * must be the worktree that currently has `baseRef` checked out. Uses `--no-ff`
 * so the merge is always an explicit commit, and leaves a *conflicting* merge in
 * place for the user to resolve while still aborting any other failure.
 */
export async function runGitMergeBranchAction(options: {
	cwd: string;
	branch: string;
	baseRef: string;
}): Promise<RuntimeGitMergeBranchResponse> {
	const branch = options.branch.trim();
	const baseRef = options.baseRef.trim();
	const initialSummary = await getGitSyncSummary(options.cwd);

	if (!branch) {
		return {
			ok: false,
			branch,
			baseRef,
			summary: initialSummary,
			output: "",
			error: "Task branch name cannot be empty.",
		};
	}

	if (initialSummary.currentBranch !== baseRef) {
		return {
			ok: false,
			branch,
			baseRef,
			summary: initialSummary,
			output: "",
			error: `Expected '${baseRef}' to be checked out for the merge but found '${initialSummary.currentBranch ?? "a detached HEAD"}'.`,
		};
	}

	const mergeResult = await runGit(options.cwd, [
		"merge",
		"--no-ff",
		"--autostash",
		branch,
		"-m",
		`Merge branch '${branch}' into ${baseRef}`,
	]);

	if (!mergeResult.ok) {
		const repoRoot = await resolveRepoRoot(options.cwd);
		const conflictState = await settleFailedGitOperation(repoRoot, repoRoot);
		return {
			ok: false,
			branch,
			baseRef,
			summary: await getGitSyncSummary(options.cwd),
			output: mergeResult.output,
			error: conflictState
				? `Merging '${branch}' into ${baseRef} hit ${conflictState.paths.length === 1 ? "a conflict" : `${String(conflictState.paths.length)} conflicts`}. Resolve them to finish the merge.`
				: (mergeResult.error ?? `Could not merge '${branch}' into ${baseRef}. The merge was aborted.`),
			conflictState,
		};
	}

	return {
		ok: true,
		branch,
		baseRef,
		summary: await getGitSyncSummary(options.cwd),
		output: mergeResult.output,
		conflictState: null,
	};
}

/**
 * Merges {@link options.branch} into {@link options.baseRef} when no existing worktree
 * has that base checked out.
 *
 * A task's base ref is pinned at worktree creation, but the home repo moves on, so
 * requiring the base to be the current HEAD somewhere made the merge target follow
 * whatever the user last checked out. A borrowed worktree gives the base branch a
 * checkout of its own and leaves every existing worktree (including the home repo's
 * HEAD) untouched.
 *
 * The borrowed checkout is released as soon as the merge finishes — but **not** when
 * it stops on a conflict, because the conflict lives inside it. Its predecessor was
 * an `mkdtemp` deleted in a `finally`, so a conflicting merge-to-base had its state
 * destroyed before the response was even sent; the next attempt reuses whatever is
 * still stopped there rather than starting a second one.
 */
export async function runGitMergeBranchInBorrowedWorktree(options: {
	repoPath: string;
	branch: string;
	baseRef: string;
}): Promise<RuntimeGitMergeBranchResponse> {
	const branch = options.branch.trim();
	const baseRef = options.baseRef.trim();
	const borrowed = await borrowBaseWorktree(options.repoPath, baseRef);
	if (!borrowed.ok) {
		return {
			ok: false,
			branch,
			baseRef,
			summary: await getGitSyncSummary(options.repoPath),
			output: borrowed.output,
			error: borrowed.error,
			conflictState: null,
		};
	}

	const worktreePath = borrowed.worktree.path;
	// A reused checkout may already be stopped mid-conflict from a previous attempt;
	// re-running the merge there would only fail with "you have unmerged files".
	const existing = await stoppedOnResolvableConflict(worktreePath);
	if (existing?.operation) {
		return {
			ok: false,
			branch,
			baseRef,
			summary: await getGitSyncSummary(options.repoPath),
			output: "",
			error: `An earlier merge into ${baseRef} is still unresolved. Finish or abort it to merge again.`,
			conflictState: {
				operation: existing.operation,
				worktreePath,
				paths: existing.paths,
				autostashHeld: existing.autostashHeld,
			},
		};
	}

	let response: RuntimeGitMergeBranchResponse;
	try {
		response = await runGitMergeBranchAction({ cwd: worktreePath, branch, baseRef });
	} catch (error) {
		await releaseBaseWorktree(options.repoPath, worktreePath);
		throw error;
	}

	if (!response.conflictState) {
		await releaseBaseWorktree(options.repoPath, worktreePath);
	}
	// Report the home repo's summary: the caller feeds this into the home git panel,
	// and the borrowed checkout's state would flash the wrong branch there.
	return { ...response, summary: await getGitSyncSummary(options.repoPath) };
}

/**
 * Merges {@link options.branch} into the currently checked-out branch (HEAD stays put).
 * Aborts the merge on conflict so the worktree is never left half-merged.
 */
export async function runGitMergeIntoCurrentAction(options: {
	cwd: string;
	branch: string;
}): Promise<RuntimeGitMergeIntoCurrentResponse> {
	const branch = options.branch.trim();
	const repoRoot = await resolveRepoRoot(options.cwd);
	const initialSummary = await getGitSyncSummary(repoRoot);

	if (!branch) {
		return {
			ok: false,
			branch,
			summary: initialSummary,
			output: "",
			error: "Branch name cannot be empty.",
		};
	}

	if (!initialSummary.currentBranch) {
		return {
			ok: false,
			branch,
			summary: initialSummary,
			output: "",
			error: "Cannot merge while HEAD is detached. Check out a branch first.",
		};
	}

	if (initialSummary.currentBranch === branch) {
		return {
			ok: false,
			branch,
			summary: initialSummary,
			output: "",
			error: `Already on '${branch}'. Choose a different branch to merge.`,
		};
	}

	if (await isMergeInProgress(repoRoot)) {
		return {
			ok: false,
			branch,
			summary: initialSummary,
			output: "",
			error: "A merge is already in progress. Finish or abort it first.",
		};
	}

	if (await isRebaseInProgress(repoRoot)) {
		return {
			ok: false,
			branch,
			summary: initialSummary,
			output: "",
			error: "A rebase is already in progress. Finish or abort it first.",
		};
	}

	// `--autostash` replaces what used to be a flat refusal on a dirty tree, which
	// forced a manual stash push/merge/pop cycle outside the app. Git holds the work
	// in `MERGE_AUTOSTASH` and restores it when the merge finishes *or* aborts.
	const mergeResult = await runGit(repoRoot, [
		"merge",
		"--no-ff",
		"--autostash",
		branch,
		"-m",
		`Merge branch '${branch}' into ${initialSummary.currentBranch}`,
	]);
	const nextSummary = await getGitSyncSummary(repoRoot);

	if (!mergeResult.ok) {
		await runGit(repoRoot, ["merge", "--abort"]);
		return {
			ok: false,
			branch,
			summary: await getGitSyncSummary(repoRoot),
			output: mergeResult.output,
			error:
				mergeResult.error ??
				`Could not merge '${branch}' into ${initialSummary.currentBranch} (likely conflicts). The merge was aborted.`,
		};
	}

	return {
		ok: true,
		branch,
		summary: nextSummary,
		output: mergeResult.output,
	};
}

/**
 * Rebases the currently checked-out branch onto {@link options.branch} (HEAD stays on current).
 * A conflicting step is left stopped so the user can resolve it; any other failure
 * is still aborted.
 */
export async function runGitRebaseCurrentOntoAction(options: {
	cwd: string;
	branch: string;
}): Promise<RuntimeGitRebaseCurrentOntoResponse> {
	const branch = options.branch.trim();
	const repoRoot = await resolveRepoRoot(options.cwd);
	const initialSummary = await getGitSyncSummary(repoRoot);

	if (!branch) {
		return {
			ok: false,
			branch,
			summary: initialSummary,
			output: "",
			error: "Branch name cannot be empty.",
		};
	}

	if (!initialSummary.currentBranch) {
		return {
			ok: false,
			branch,
			summary: initialSummary,
			output: "",
			error: "Cannot rebase while HEAD is detached. Check out a branch first.",
		};
	}

	if (initialSummary.currentBranch === branch) {
		return {
			ok: false,
			branch,
			summary: initialSummary,
			output: "",
			error: `Already on '${branch}'. Choose a different branch to rebase onto.`,
		};
	}

	if (await isMergeInProgress(repoRoot)) {
		return {
			ok: false,
			branch,
			summary: initialSummary,
			output: "",
			error: "A merge is already in progress. Finish or abort it first.",
		};
	}

	if (await isRebaseInProgress(repoRoot)) {
		return {
			ok: false,
			branch,
			summary: initialSummary,
			output: "",
			error: "A rebase is already in progress. Finish or abort it first.",
		};
	}

	// `--autostash` replaces what used to be a flat refusal on a dirty tree; git
	// restores the work on `rebase --continue` and on `rebase --abort` alike.
	const rebaseResult = await runGit(repoRoot, ["rebase", "--autostash", branch]);

	if (!rebaseResult.ok) {
		const conflictState = await settleFailedGitOperation(repoRoot, repoRoot);
		return {
			ok: false,
			branch,
			summary: await getGitSyncSummary(repoRoot),
			output: rebaseResult.output,
			error: conflictState
				? `Rebasing '${initialSummary.currentBranch}' onto '${branch}' stopped on ${conflictState.paths.length === 1 ? "a conflict" : `${String(conflictState.paths.length)} conflicts`}. Resolve them to continue the rebase.`
				: (rebaseResult.error ??
					`Could not rebase '${initialSummary.currentBranch}' onto '${branch}'. The rebase was aborted.`),
			conflictState,
		};
	}

	return {
		ok: true,
		branch,
		summary: await getGitSyncSummary(repoRoot),
		output: rebaseResult.output,
		conflictState: null,
	};
}

/**
 * Cherry-picks {@link options.commitHash} onto {@link options.targetBranch}.
 * {@link options.cwd} must be the worktree that currently has `targetBranch` checked out.
 * A conflicting pick is left stopped so the user can resolve it; any other failure
 * is still aborted.
 *
 * Note there is no `--autostash` for cherry-pick — git has no such flag — so its own
 * dirty-tree refusal stands.
 */
export async function runGitCherryPickAction(options: {
	cwd: string;
	commitHash: string;
	targetBranch: string;
}): Promise<RuntimeGitCherryPickResponse> {
	const commitHash = options.commitHash.trim();
	const targetBranch = options.targetBranch.trim();
	const initialSummary = await getGitSyncSummary(options.cwd);

	if (!commitHash) {
		return {
			ok: false,
			commitHash,
			targetBranch,
			summary: initialSummary,
			output: "",
			error: "Commit hash cannot be empty.",
		};
	}
	if (!targetBranch) {
		return {
			ok: false,
			commitHash,
			targetBranch,
			summary: initialSummary,
			output: "",
			error: "Target branch cannot be empty.",
		};
	}
	if (initialSummary.currentBranch !== targetBranch) {
		return {
			ok: false,
			commitHash,
			targetBranch,
			summary: initialSummary,
			output: "",
			error: `Expected '${targetBranch}' to be checked out for the cherry-pick but found '${initialSummary.currentBranch ?? "a detached HEAD"}'.`,
		};
	}

	const cherryPickResult = await runGit(options.cwd, ["cherry-pick", commitHash]);

	if (!cherryPickResult.ok) {
		const repoRoot = await resolveRepoRoot(options.cwd);
		const conflictState = await settleFailedGitOperation(repoRoot, repoRoot);
		return {
			ok: false,
			commitHash,
			targetBranch,
			summary: await getGitSyncSummary(options.cwd),
			output: cherryPickResult.output,
			error: conflictState
				? `Cherry-picking '${commitHash}' onto ${targetBranch} hit ${conflictState.paths.length === 1 ? "a conflict" : `${String(conflictState.paths.length)} conflicts`}. Resolve them to finish the pick.`
				: (cherryPickResult.error ??
					`Could not cherry-pick '${commitHash}' onto ${targetBranch}. The cherry-pick was aborted.`),
			conflictState,
		};
	}

	return {
		ok: true,
		commitHash,
		targetBranch,
		summary: await getGitSyncSummary(options.cwd),
		output: cherryPickResult.output,
		conflictState: null,
	};
}

/**
 * Pushes {@link options.branch} to origin from {@link options.cwd}.
 * Uses `-u` when the current branch has no upstream configured.
 */
export async function runGitPushBranchAction(options: {
	cwd: string;
	branch: string;
}): Promise<RuntimeGitPushBranchResponse> {
	const branch = options.branch.trim();
	const initialSummary = await getGitSyncSummary(options.cwd);

	if (!branch) {
		return {
			ok: false,
			branch,
			summary: initialSummary,
			output: "",
			error: "Branch name cannot be empty.",
		};
	}

	const args =
		initialSummary.currentBranch === branch && !initialSummary.upstreamBranch
			? ["push", "-u", "origin", branch]
			: ["push", "origin", branch];
	const pushResult = await runGit(options.cwd, args);
	const nextSummary = await getGitSyncSummary(options.cwd);

	if (!pushResult.ok) {
		return {
			ok: false,
			branch,
			summary: nextSummary,
			output: pushResult.output,
			error: pushResult.error ?? `Could not push '${branch}'.`,
		};
	}

	return {
		ok: true,
		branch,
		summary: nextSummary,
		output: pushResult.output,
	};
}

export async function runGitSafeForcePush(options: {
	cwd: string;
	workspaceId: string;
	taskId: string;
	branch: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
	const entry = await getActiveBranchEntry(options.workspaceId, options.taskId);
	if (!entry) {
		return { ok: false, reason: "no active registry entry for this task/branch — refusing to force-push" };
	}

	const expectedSha = await getGitStdout(["rev-parse", `origin/${options.branch}`], options.cwd).catch(() => "");

	await runGit(options.cwd, ["fetch", "origin", options.branch]);

	const pushResult = await runGit(options.cwd, [
		"push",
		`--force-with-lease=${options.branch}:${expectedSha}`,
		"origin",
		options.branch,
	]);

	if (!pushResult.ok) {
		const actualSha = await getGitStdout(["rev-parse", `origin/${options.branch}`], options.cwd).catch(
			() => "unknown",
		);
		await appendBranchRegistryStatusLog(options.workspaceId, {
			taskId: options.taskId,
			op: "force-push-rejected",
			detail: `expected ${expectedSha || "none"}, actual ${actualSha}`,
		});
		return { ok: false, reason: "push rejected — branch diverged from expected SHA, needs manual reconciliation" };
	}

	await appendBranchRegistryStatusLog(options.workspaceId, {
		taskId: options.taskId,
		op: "force-push",
		detail: `${options.branch} pushed (expected ${expectedSha || "none"})`,
	});
	return { ok: true };
}

/**
 * Splits a single-file `git diff` into its leading header (`diff --git`, `index`,
 * `---`/`+++`) and its `@@` hunk blocks, then returns a minimal patch containing
 * the header plus the one hunk at {@link hunkIndex}. Returns `null` when the diff
 * has no header or the index is out of range. The result is a valid patch that
 * `git apply` can reverse in isolation, so the user reverts one hunk without
 * touching the rest of the file.
 */
export function extractSingleHunkPatch(fullPatch: string, hunkIndex: number): string | null {
	const firstHunkAt = fullPatch.indexOf("\n@@");
	if (firstHunkAt === -1) {
		return null;
	}
	const header = fullPatch.slice(0, firstHunkAt + 1);
	const hunkBody = fullPatch.slice(firstHunkAt + 1);
	const hunks: string[] = [];
	for (const line of hunkBody.split("\n")) {
		if (line.startsWith("@@")) {
			hunks.push(`${line}\n`);
		} else if (hunks.length > 0) {
			hunks[hunks.length - 1] += `${line}\n`;
		}
	}
	const selected = hunks[hunkIndex];
	if (!selected) {
		return null;
	}
	return `${header}${selected}`;
}

export async function revertGitFile(options: { cwd: string; path: string }): Promise<RuntimeGitRevertResponse> {
	const repoRoot = await resolveRepoRoot(options.cwd);
	const targetPath = options.path.trim();

	if (!targetPath) {
		return {
			ok: false,
			summary: await getGitSyncSummary(repoRoot),
			output: "",
			error: "No file path provided to revert.",
		};
	}

	const probe = await probeGitWorkspaceState(repoRoot);
	const isUntracked = probe.untrackedPaths.includes(targetPath);

	if (isUntracked) {
		// Untracked files have no HEAD version to restore to — reverting means
		// deleting the new file. `rm` with `force` tolerates a concurrent delete.
		try {
			await rm(join(repoRoot, targetPath), { force: true, recursive: true });
		} catch (error) {
			return {
				ok: false,
				summary: await getGitSyncSummary(repoRoot),
				output: "",
				error: error instanceof Error ? error.message : "Failed to delete untracked file.",
			};
		}
		return {
			ok: true,
			summary: await getGitSyncSummary(repoRoot),
			output: `Deleted untracked file '${targetPath}'.`,
		};
	}

	const restoreResult = await runGit(repoRoot, ["restore", "--source=HEAD", "--worktree", "--", targetPath]);
	const summary = await getGitSyncSummary(repoRoot);
	if (!restoreResult.ok) {
		return {
			ok: false,
			summary,
			output: restoreResult.output,
			error: restoreResult.error ?? "Failed to revert file.",
		};
	}
	return { ok: true, summary, output: restoreResult.output };
}

export async function revertGitHunk(options: {
	cwd: string;
	path: string;
	hunkIndex: number;
}): Promise<RuntimeGitRevertResponse> {
	const repoRoot = await resolveRepoRoot(options.cwd);
	const targetPath = options.path.trim();

	if (!targetPath) {
		return {
			ok: false,
			summary: await getGitSyncSummary(repoRoot),
			output: "",
			error: "No file path provided to revert.",
		};
	}

	const diffResult = await runGit(repoRoot, ["diff", "HEAD", "--", targetPath]);
	if (!diffResult.ok) {
		return {
			ok: false,
			summary: await getGitSyncSummary(repoRoot),
			output: diffResult.output,
			error: diffResult.error ?? "Failed to read file diff.",
		};
	}

	const hunkPatch = extractSingleHunkPatch(diffResult.stdout, options.hunkIndex);
	if (!hunkPatch) {
		return {
			ok: false,
			summary: await getGitSyncSummary(repoRoot),
			output: "",
			error: "The selected hunk no longer matches the file; refresh and try again.",
		};
	}

	// `git apply --reverse` undoes just this hunk. The patch is written to a temp
	// file rather than piped via stdin because the async `execFile` used by runGit
	// has no stdin channel. `--whitespace=nowarn` matches the existing apply idiom
	// used for worktree checkpoints (task-worktree.ts).
	const patchDir = await mkdtemp(join(tmpdir(), "kanban-hunk-"));
	const patchFile = join(patchDir, "revert.patch");
	let applyResult: Awaited<ReturnType<typeof runGit>>;
	try {
		await writeFile(patchFile, hunkPatch, "utf8");
		applyResult = await runGit(repoRoot, ["apply", "--reverse", "--whitespace=nowarn", patchFile]);
	} finally {
		await rm(patchDir, { force: true, recursive: true });
	}
	const summary = await getGitSyncSummary(repoRoot);
	if (!applyResult.ok) {
		return {
			ok: false,
			summary,
			output: applyResult.output,
			error: applyResult.error ?? "Failed to revert hunk; the file may have changed.",
		};
	}
	return { ok: true, summary, output: applyResult.output };
}

async function readConflictStage(repoRoot: string, stage: 1 | 2 | 3, path: string): Promise<string | null> {
	// Stage 1 = base, 2 = ours, 3 = theirs. A missing stage (add/add or
	// delete/modify conflicts) yields a non-ok result, reported as null.
	const result = await runGit(repoRoot, ["show", `:${stage}:${path}`], { trimStdout: false });
	return result.ok ? result.stdout : null;
}

function looksBinary(text: string): boolean {
	// git's own heuristic: a NUL byte in the first 8 KB.
	return text.slice(0, 8000).includes("\0");
}

/**
 * The working-tree file, i.e. git's merge with `<<<<<<<` markers in it. Seeds the
 * resolver's editable pane, which is the only way to settle a conflict that neither
 * side wins outright.
 */
async function readConflictWorkingCopy(repoRoot: string, path: string): Promise<string | null> {
	try {
		const absolutePath = join(repoRoot, path);
		const fileStat = await stat(absolutePath);
		if (fileStat.size > CONFLICT_FILE_MAX_BYTES) {
			return null;
		}
		return await readFile(absolutePath, "utf8");
	} catch {
		// Absent on disk for a delete/modify conflict; not an error.
		return null;
	}
}

async function readConflictFile(repoRoot: string, path: string): Promise<RuntimeGitConflictFile> {
	const [base, ours, theirs, merged] = await Promise.all([
		readConflictStage(repoRoot, 1, path),
		readConflictStage(repoRoot, 2, path),
		readConflictStage(repoRoot, 3, path),
		readConflictWorkingCopy(repoRoot, path),
	]);

	const sides = [base, ours, theirs, merged];
	const binary = sides.some((side) => side !== null && looksBinary(side));
	const oversized = sides.some((side) => side !== null && side.length > CONFLICT_FILE_MAX_BYTES);
	if (binary || oversized) {
		// Ship no text at all rather than a truncated side: a shortened `ours` diffed
		// against a full `theirs` renders as a wrong diff, not a missing one.
		return { path, base: null, ours: null, theirs: null, merged: null, binary, contentOmitted: true };
	}
	return { path, base, ours, theirs, merged, binary: false, contentOmitted: false };
}

export async function getMergeConflicts(options: { cwd: string }): Promise<RuntimeGitConflictsResponse> {
	const repoRoot = await resolveRepoRoot(options.cwd);
	const state = await probeGitConflictState(repoRoot);
	const unmergedResult = await runGit(repoRoot, ["diff", "--name-only", "--diff-filter=U", "-z"]);
	if (!unmergedResult.ok) {
		return {
			ok: false,
			conflicts: [],
			operation: state.operation,
			worktreePath: repoRoot,
			autostashHeld: state.autostashHeld,
			error: unmergedResult.error ?? "Failed to list conflicted files.",
		};
	}

	const paths = unmergedResult.stdout.split("\0").filter(Boolean);
	const conflicts = await mapWithConcurrency(paths, WORKSPACE_CHANGES_CONCURRENCY, (path) =>
		readConflictFile(repoRoot, path),
	);

	return {
		ok: true,
		conflicts,
		operation: state.operation,
		worktreePath: repoRoot,
		autostashHeld: state.autostashHeld,
	};
}

/**
 * Finishes the unfinished operation in this worktree — `git commit` for a merge,
 * `--continue` for a rebase or cherry-pick. A rebase with more commits to replay can
 * stop again immediately, which is why the remaining state is reported back.
 */
export async function continueConflictOperation(options: {
	cwd: string;
}): Promise<RuntimeGitConflictOperationResponse> {
	const repoRoot = await resolveRepoRoot(options.cwd);
	const state = await probeGitConflictState(repoRoot);
	if (!state.operation) {
		return {
			ok: false,
			summary: await getGitSyncSummary(repoRoot),
			output: "",
			error: "Nothing to continue: no merge, rebase or cherry-pick is in progress here.",
			conflictState: null,
		};
	}
	if (state.paths.length > 0) {
		return {
			ok: false,
			summary: await getGitSyncSummary(repoRoot),
			output: "",
			error: `${String(state.paths.length)} file${state.paths.length === 1 ? "" : "s"} still conflicted. Resolve every file first.`,
			conflictState: toConflictState(state, repoRoot),
		};
	}

	const result = await continueGitOperation(repoRoot, state.operation);
	const conflictState = toConflictState(await probeGitConflictState(repoRoot), repoRoot);

	if (!result.ok) {
		return {
			ok: false,
			summary: await getGitSyncSummary(repoRoot),
			output: result.output,
			error: result.error ?? `Could not continue the ${state.operation}.`,
			conflictState,
		};
	}
	return { ok: true, summary: await getGitSyncSummary(repoRoot), output: result.output, conflictState };
}

export async function abortConflictOperation(options: { cwd: string }): Promise<RuntimeGitConflictOperationResponse> {
	const repoRoot = await resolveRepoRoot(options.cwd);
	const state = await probeGitConflictState(repoRoot);
	if (!state.operation) {
		return {
			ok: false,
			summary: await getGitSyncSummary(repoRoot),
			output: "",
			error: "Nothing to abort: no merge, rebase or cherry-pick is in progress here.",
			conflictState: null,
		};
	}

	const result = await abortGitOperation(repoRoot, state.operation);
	if (!result.ok) {
		return {
			ok: false,
			summary: await getGitSyncSummary(repoRoot),
			output: result.output,
			error: result.error ?? `Could not abort the ${state.operation}.`,
			conflictState: toConflictState(state, repoRoot),
		};
	}
	return { ok: true, summary: await getGitSyncSummary(repoRoot), output: result.output, conflictState: null };
}

/** Drops the commit a rebase is stopped on and moves to the next one. */
export async function skipConflictRebaseCommit(options: { cwd: string }): Promise<RuntimeGitConflictOperationResponse> {
	const repoRoot = await resolveRepoRoot(options.cwd);
	const state = await probeGitConflictState(repoRoot);
	if (state.operation !== "rebase") {
		return {
			ok: false,
			summary: await getGitSyncSummary(repoRoot),
			output: "",
			error: "Only a rebase can skip a commit.",
			conflictState: toConflictState(state, repoRoot),
		};
	}

	const result = await skipRebaseCommit(repoRoot);
	const conflictState = toConflictState(await probeGitConflictState(repoRoot), repoRoot);
	if (!result.ok) {
		return {
			ok: false,
			summary: await getGitSyncSummary(repoRoot),
			output: result.output,
			error: result.error ?? "Could not skip the commit.",
			conflictState,
		};
	}
	return { ok: true, summary: await getGitSyncSummary(repoRoot), output: result.output, conflictState };
}

export async function resolveMergeConflict(options: {
	cwd: string;
	path: string;
	side: RuntimeGitConflictSide;
	content?: string;
}): Promise<RuntimeGitResolveConflictResponse> {
	const repoRoot = await resolveRepoRoot(options.cwd);
	const targetPath = options.path.trim();
	if (!targetPath) {
		return {
			ok: false,
			summary: await getGitSyncSummary(repoRoot),
			output: "",
			error: "No file path provided to resolve.",
		};
	}

	let stageResult: Awaited<ReturnType<typeof runGit>>;
	if (options.side === "manual") {
		if (options.content === undefined) {
			return {
				ok: false,
				summary: await getGitSyncSummary(repoRoot),
				output: "",
				error: "Manual conflict resolution requires merged file content.",
			};
		}
		try {
			await writeFile(join(repoRoot, targetPath), options.content, "utf8");
		} catch (error) {
			return {
				ok: false,
				summary: await getGitSyncSummary(repoRoot),
				output: "",
				error: error instanceof Error ? error.message : "Failed to write merged content.",
			};
		}
		stageResult = await runGit(repoRoot, ["add", "--", targetPath]);
	} else {
		const flag = options.side === "ours" ? "--ours" : "--theirs";
		const checkoutResult = await runGit(repoRoot, ["checkout", flag, "--", targetPath]);
		if (!checkoutResult.ok) {
			return {
				ok: false,
				summary: await getGitSyncSummary(repoRoot),
				output: checkoutResult.output,
				error: checkoutResult.error ?? "Failed to pick conflict side.",
			};
		}
		stageResult = await runGit(repoRoot, ["add", "--", targetPath]);
	}

	const summary = await getGitSyncSummary(repoRoot);
	if (!stageResult.ok) {
		return {
			ok: false,
			summary,
			output: stageResult.output,
			error: stageResult.error ?? "Failed to stage the resolved file.",
		};
	}
	return { ok: true, summary, output: stageResult.output };
}

export async function discardGitChanges(options: { cwd: string }): Promise<RuntimeGitDiscardResponse> {
	const repoRoot = await resolveRepoRoot(options.cwd);
	const initialSummary = await getGitSyncSummary(repoRoot);

	if (initialSummary.changedFiles === 0) {
		return {
			ok: true,
			summary: initialSummary,
			output: "Working tree is already clean.",
		};
	}

	const restoreResult = await runGit(repoRoot, ["restore", "--source=HEAD", "--staged", "--worktree", "--", "."]);
	const cleanResult = restoreResult.ok ? await runGit(repoRoot, ["clean", "-fd", "--", "."]) : null;
	const nextSummary = await getGitSyncSummary(repoRoot);
	const output = [restoreResult.output, cleanResult?.output ?? ""].filter(Boolean).join("\n");

	if (!restoreResult.ok) {
		return {
			ok: false,
			summary: nextSummary,
			output,
			error: restoreResult.error ?? "Discard failed.",
		};
	}

	if (cleanResult && !cleanResult.ok) {
		return {
			ok: false,
			summary: nextSummary,
			output,
			error: cleanResult.error ?? "Discard failed while cleaning untracked files.",
		};
	}

	return {
		ok: true,
		summary: nextSummary,
		output,
	};
}
