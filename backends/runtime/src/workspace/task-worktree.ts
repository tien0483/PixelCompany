import { existsSync } from "node:fs";
import { access, lstat, mkdir, readdir, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";

import type {
	RuntimeTaskWorkspaceInfoResponse,
	RuntimeWorktreeDeleteResponse,
	RuntimeWorktreeEnsureResponse,
} from "../core/api-contract";
import { type LockRequest, lockedFileSystem } from "../fs/locked-file-system";
import {
	getLegacyTaskWorktreesHomePath,
	getRuntimeHomePath,
	getTaskWorktreesHomePath,
	loadWorkspaceContext,
} from "../state/workspace-state";
import { deregisterActiveBranch, getActiveBranchEntry, recordTaskWorktreeBaseRef, registerActiveBranch } from "./branch-registry";
import {
	getGitCommandErrorMessage,
	getGitStdout,
	hasLocalGitBranch,
	readGitHeadInfo,
	resolveConcreteBaseBranch,
	runGit,
} from "./git-utils";
import { getCommitsAheadOfBaseRef } from "./git-sync";
import { getWorkspaceFolderLabelForWorktreePath, normalizeTaskIdForWorktreePath } from "./task-worktree-path";
import { listTurbopackNodeModulesSymlinkSkipPaths } from "./task-worktree-turbopack";
import { measureTaskStartSpan } from "./task-start-timing";
import { readCachedIgnoredPaths, writeCachedIgnoredPaths } from "./task-worktree-sync-cache";

const KANBAN_MANAGED_EXCLUDE_BLOCK_START = "# kanban-managed-symlinked-ignored-paths:start";
const KANBAN_MANAGED_EXCLUDE_BLOCK_END = "# kanban-managed-symlinked-ignored-paths:end";
const KANBAN_TRASHED_TASK_PATCHES_DIR_NAME = "trashed-task-patches";
const KANBAN_TASK_WORKTREE_SETUP_LOCKFILE_NAME = "kanban-task-worktree-setup.lock";
const KANBAN_WORKTREE_META_DIR_NAME = ".kanban";
const IGNORED_SYMLINKS_MANIFEST_FILENAME = "ignored-symlinks.json";
const TASK_PATCH_FILE_SUFFIX = ".patch";

interface IgnoredSymlinksManifest {
	homeHead: string;
	syncedPaths: string[];
	syncedAt: number;
}

const SYMLINK_PATH_SEGMENT_BLACKLIST = new Set([
	".git",
	".DS_Store",
	"Thumbs.db",
	"Desktop.ini",
	"Icon\r",
	".Spotlight-V100",
	".Trashes",
]);

type CreateSymlink = (target: string, path: string, type: "dir" | "file") => Promise<void>;

export async function mirrorIgnoredPath(options: {
	sourcePath: string;
	targetPath: string;
	isDirectory: boolean;
	createSymlink?: CreateSymlink;
}): Promise<"mirrored" | "skipped"> {
	const createSymlink = options.createSymlink ?? symlink;
	try {
		await createSymlink(options.sourcePath, options.targetPath, options.isDirectory ? "dir" : "file");
		return "mirrored";
	} catch {
		return "skipped";
	}
}

function toPlatformRelativePath(path: string): string {
	return path
		.trim()
		.replaceAll("\\", "/")
		.replace(/\/+$/g, "")
		.split("/")
		.filter((segment) => segment.length > 0)
		.join("/");
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

function isMissingInitialCommitError(message: string): boolean {
	const normalizedMessage = message.trim().toLowerCase();
	if (!normalizedMessage) {
		return false;
	}

	return (
		normalizedMessage.includes("needed a single revision") ||
		normalizedMessage.includes("ambiguous argument") ||
		normalizedMessage.includes("unknown revision or path not in the working tree") ||
		normalizedMessage.includes("bad revision")
	);
}

function getWorktreeBaseRefResolutionErrorMessage(baseRef: string, errorMessage: string): string {
	if (!isMissingInitialCommitError(errorMessage)) {
		return errorMessage;
	}

	return `This repository does not have an initial commit yet, so Kanban cannot create a task worktree from base ref "${baseRef}". Create an initial commit, then try moving the task to in progress again.`;
}

async function tryRunGit(cwd: string, args: string[]): Promise<string | null> {
	const result = await runGit(cwd, args);
	return result.ok ? result.stdout : null;
}

async function getGitCommonDir(repoPath: string): Promise<string> {
	const gitCommonDir = await getGitStdout(["rev-parse", "--git-common-dir"], repoPath);
	return isAbsolute(gitCommonDir) ? gitCommonDir : join(repoPath, gitCommonDir);
}

async function getTaskWorktreeSetupLock(repoPath: string): Promise<LockRequest> {
	return {
		path: await getGitCommonDir(repoPath),
		type: "directory",
		lockfileName: KANBAN_TASK_WORKTREE_SETUP_LOCKFILE_NAME,
	};
}

export async function removeTaskWorktreeSetupLock(repoPath: string): Promise<boolean> {
	const lockPath = join(repoPath, ".git", KANBAN_TASK_WORKTREE_SETUP_LOCKFILE_NAME);
	const existed = await pathExists(lockPath);
	await rm(lockPath, { force: true, recursive: true });
	return existed;
}

async function withTaskWorktreeSetupLock<T>(repoPath: string, operation: () => Promise<T>): Promise<T> {
	return await lockedFileSystem.withLock(await getTaskWorktreeSetupLock(repoPath), operation);
}

function deriveTaskBranchName(taskId: string): string {
	const normalized = taskId
		.trim()
		.replace(/[^A-Za-z0-9._/-]+/g, "-")
		.replace(/^[-/]+|[-/]+$/g, "");
	return `kanban/task-${normalized || "task"}`;
}

/**
 * Task worktrees start detached; agents often commit on that detached HEAD without
 * checking out {@link deriveTaskBranchName}. Merge needs a branch ref name, so when
 * HEAD is detached but carries commits ahead of the base ref, point the task branch
 * at the current commit before merging.
 */
export async function resolveTaskMergeBranch(options: {
	repoPath: string;
	worktreePath: string;
	workspaceId: string;
	taskId: string;
	baseRef: string;
}): Promise<string | null> {
	const headInfo = await readGitHeadInfo(options.worktreePath);
	if (headInfo.branch && !headInfo.isDetached) {
		return headInfo.branch;
	}

	const entry = await getActiveBranchEntry(options.workspaceId, options.taskId);
	const candidateBranch = entry?.branch ?? deriveTaskBranchName(options.taskId);
	const aheadCount = await getCommitsAheadOfBaseRef(options.worktreePath, options.baseRef);
	if (aheadCount > 0 && headInfo.headCommit) {
		const updateBranchResult = await runGit(options.worktreePath, [
			"branch",
			"-f",
			candidateBranch,
			headInfo.headCommit,
		]);
		if (updateBranchResult.ok) {
			return candidateBranch;
		}
	}

	if (await hasLocalGitBranch(options.repoPath, candidateBranch)) {
		return candidateBranch;
	}

	return null;
}

async function resolveExistingWorktreeBaseRef(options: {
	repoPath: string;
	workspaceId: string;
	taskId: string;
	worktreePath: string;
	requestedBaseRef: string;
}): Promise<string> {
	const fallback = options.requestedBaseRef.trim();
	try {
		const entry = await getActiveBranchEntry(options.workspaceId, options.taskId);
		if (entry?.baseRef) {
			return entry.baseRef;
		}
		// Adopt-on-ensure for worktrees created before the registry recorded a base
		// ref. Normalize first so a legacy task never adopts a floating `HEAD`, which
		// would make its base whatever the home repo happens to be on.
		const adopted = await resolveConcreteBaseBranch(options.repoPath, fallback);
		if (!adopted.ok) {
			return fallback;
		}
		await recordTaskWorktreeBaseRef(options.workspaceId, {
			taskId: options.taskId,
			branch: entry?.branch || deriveTaskBranchName(options.taskId),
			worktreePath: entry?.worktreePath || options.worktreePath,
			baseRef: adopted.branch,
		});
		return adopted.branch;
	} catch {
		return fallback;
	}
}

async function deregisterActiveBranchForRepo(repoPath: string, taskId: string): Promise<void> {
	try {
		const context = await loadWorkspaceContext(repoPath, { autoCreateIfMissing: false });
		await deregisterActiveBranch(context.workspaceId, taskId);
	} catch {
		// Workspace is no longer registered (e.g. project removal already ran); nothing to deregister.
	}
}

function getWorktreesRootPath(taskId: string): string {
	const normalizedTaskId = normalizeTaskIdForWorktreePath(taskId);
	const currentPath = join(getTaskWorktreesHomePath(), normalizedTaskId);
	if (existsSync(currentPath)) {
		return currentPath;
	}
	// A worktree created before the home-directory rename stays where it is: git
	// stores absolute paths in .git/worktrees/*/gitdir, so moving the directory
	// would break it. Only brand-new tasks land under the current root.
	const legacyPath = join(getLegacyTaskWorktreesHomePath(), normalizedTaskId);
	if (existsSync(legacyPath)) {
		return legacyPath;
	}
	return currentPath;
}

export function getWorktreesBaseRootPath(): string {
	return getTaskWorktreesHomePath();
}

function getTrashedTaskPatchesRootPath(): string {
	return join(getRuntimeHomePath(), KANBAN_TRASHED_TASK_PATCHES_DIR_NAME);
}

export function getTaskWorktreePath(repoPath: string, taskId: string): string {
	const workspaceLabel = getWorkspaceFolderLabelForWorktreePath(repoPath);
	return join(getWorktreesRootPath(taskId), workspaceLabel);
}

function getTaskPatchFilePrefix(taskId: string): string {
	return `${normalizeTaskIdForWorktreePath(taskId)}.`;
}

function parseTaskPatchCommit(taskId: string, filename: string): string | null {
	const prefix = getTaskPatchFilePrefix(taskId);
	if (!filename.startsWith(prefix) || !filename.endsWith(TASK_PATCH_FILE_SUFFIX)) {
		return null;
	}
	const commit = filename.slice(prefix.length, -TASK_PATCH_FILE_SUFFIX.length).trim();
	return commit.length > 0 ? commit : null;
}

async function listTaskPatchFiles(taskId: string): Promise<string[]> {
	const patchesRootPath = getTrashedTaskPatchesRootPath();
	try {
		const entries = await readdir(patchesRootPath);
		return entries.filter((entry) => parseTaskPatchCommit(taskId, entry) !== null);
	} catch {
		return [];
	}
}

async function deleteTaskPatchFiles(taskId: string): Promise<void> {
	const patchesRootPath = getTrashedTaskPatchesRootPath();
	const filenames = await listTaskPatchFiles(taskId);
	await Promise.all(filenames.map((filename) => rm(join(patchesRootPath, filename), { force: true })));
}

async function findTaskPatch(taskId: string): Promise<{ path: string; commit: string } | null> {
	const patchesRootPath = getTrashedTaskPatchesRootPath();
	const filenames = await listTaskPatchFiles(taskId);
	const filename = filenames.sort().at(-1);
	if (!filename) {
		return null;
	}
	const commit = parseTaskPatchCommit(taskId, filename);
	if (!commit) {
		return null;
	}
	return {
		path: join(patchesRootPath, filename),
		commit,
	};
}

function ensureTrailingNewline(value: string): string {
	return value.endsWith("\n") ? value : `${value}\n`;
}

async function listUntrackedPaths(worktreePath: string): Promise<string[]> {
	// Original used runGitRaw (throws on failure).
	const output = await getGitStdout(["ls-files", "--others", "--exclude-standard", "-z"], worktreePath, {
		trimStdout: false,
	});
	return output
		.split("\0")
		.map((path) => path.trim())
		.filter((path) => path.length > 0);
}

async function captureTaskPatch(options: { repoPath: string; taskId: string; worktreePath: string }): Promise<void> {
	const headCommit = await getGitStdout(["rev-parse", "--verify", "HEAD"], options.worktreePath);

	const trackedResult = await runGit(options.worktreePath, ["diff", "--binary", "HEAD", "--"], { trimStdout: false });
	if (!trackedResult.ok && trackedResult.exitCode !== 1) {
		throw new Error(trackedResult.error ?? "Failed to capture tracked diff.");
	}
	const trackedPatch = trackedResult.stdout;
	const patchChunks = trackedPatch.trim().length > 0 ? [ensureTrailingNewline(trackedPatch)] : [];

	for (const relativePath of await listUntrackedPaths(options.worktreePath)) {
		const untrackedResult = await runGit(
			options.worktreePath,
			["diff", "--binary", "--no-index", "--", "/dev/null", relativePath],
			{ trimStdout: false },
		);
		if (!untrackedResult.ok && untrackedResult.exitCode !== 1) {
			throw new Error(untrackedResult.error ?? "Failed to capture untracked diff.");
		}
		const untrackedPatch = untrackedResult.stdout;
		if (untrackedPatch.trim().length > 0) {
			patchChunks.push(ensureTrailingNewline(untrackedPatch));
		}
	}

	await deleteTaskPatchFiles(options.taskId);
	if (patchChunks.length === 0) {
		return;
	}

	const patchesRootPath = getTrashedTaskPatchesRootPath();
	await mkdir(patchesRootPath, { recursive: true });
	const patchPath = join(
		patchesRootPath,
		`${normalizeTaskIdForWorktreePath(options.taskId)}.${headCommit}${TASK_PATCH_FILE_SUFFIX}`,
	);
	await lockedFileSystem.writeTextFileAtomic(patchPath, patchChunks.join(""));
}

async function applyTaskPatch(patchPath: string, worktreePath: string): Promise<void> {
	await getGitStdout(["apply", "--binary", "--whitespace=nowarn", patchPath], worktreePath);
}

function shouldSkipSymlink(relativePath: string): boolean {
	const segments = relativePath.split("/").filter((segment) => segment.length > 0);
	if (segments.length === 0) {
		return true;
	}
	return segments.some((segment) => SYMLINK_PATH_SEGMENT_BLACKLIST.has(segment));
}

function isPathWithinRoot(path: string, root: string): boolean {
	return path === root || path.startsWith(`${root}/`);
}

function getUniquePaths(relativePaths: string[]): string[] {
	const uniquePaths = Array.from(new Set(relativePaths.map((path) => toPlatformRelativePath(path)).filter(Boolean)));
	uniquePaths.sort((left, right) => {
		const leftDepth = left.split("/").length;
		const rightDepth = right.split("/").length;
		if (leftDepth !== rightDepth) {
			return leftDepth - rightDepth;
		}
		return left.localeCompare(right);
	});

	const roots: string[] = [];
	for (const path of uniquePaths) {
		if (roots.some((root) => isPathWithinRoot(path, root))) {
			continue;
		}
		roots.push(path);
	}

	return roots;
}

async function listIgnoredPaths(repoPath: string): Promise<string[]> {
	const homeHead = await getRepoHeadCommit(repoPath);
	if (homeHead) {
		const cached = readCachedIgnoredPaths(repoPath, homeHead);
		if (cached) {
			return cached;
		}
	}

	const output = await getGitStdout(
		["ls-files", "--others", "--ignored", "--exclude-per-directory=.gitignore", "--directory"],
		repoPath,
	);
	const paths = output
		.split("\n")
		.map((line) => toPlatformRelativePath(line))
		.filter((line) => line.length > 0);
	if (homeHead) {
		writeCachedIgnoredPaths(repoPath, homeHead, paths);
	}
	return paths;
}

function getWorktreeManifestPath(worktreePath: string): string {
	return join(worktreePath, KANBAN_WORKTREE_META_DIR_NAME, IGNORED_SYMLINKS_MANIFEST_FILENAME);
}

async function readIgnoredSymlinksManifest(worktreePath: string): Promise<IgnoredSymlinksManifest | null> {
	const manifestPath = getWorktreeManifestPath(worktreePath);
	try {
		const raw = await readFile(manifestPath, "utf8");
		const parsed = JSON.parse(raw) as Partial<IgnoredSymlinksManifest>;
		if (
			typeof parsed.homeHead !== "string" ||
			!Array.isArray(parsed.syncedPaths) ||
			typeof parsed.syncedAt !== "number"
		) {
			return null;
		}
		return {
			homeHead: parsed.homeHead,
			syncedPaths: parsed.syncedPaths.filter((path): path is string => typeof path === "string"),
			syncedAt: parsed.syncedAt,
		};
	} catch {
		return null;
	}
}

async function writeIgnoredSymlinksManifest(
	worktreePath: string,
	manifest: IgnoredSymlinksManifest,
): Promise<void> {
	const manifestPath = getWorktreeManifestPath(worktreePath);
	await mkdir(dirname(manifestPath), { recursive: true });
	await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

async function getRepoHeadCommit(repoPath: string): Promise<string | null> {
	return await tryRunGit(repoPath, ["rev-parse", "HEAD"]);
}

async function isValidIgnoredPathMirror(sourcePath: string, targetPath: string): Promise<boolean> {
	if (!(await pathExists(targetPath))) {
		return false;
	}
	try {
		const targetStat = await lstat(targetPath);
		if (!targetStat.isSymbolicLink()) {
			return true;
		}
		const linkTarget = await readlink(targetPath);
		const resolvedTarget = isAbsolute(linkTarget) ? linkTarget : join(dirname(targetPath), linkTarget);
		return resolvedTarget === sourcePath;
	} catch {
		return false;
	}
}

async function areManifestSymlinksValid(
	repoPath: string,
	worktreePath: string,
	manifest: IgnoredSymlinksManifest,
): Promise<boolean> {
	for (const relativePath of manifest.syncedPaths) {
		const sourcePath = join(repoPath, relativePath);
		const targetPath = join(worktreePath, relativePath);
		if (!(await pathExists(sourcePath))) {
			continue;
		}
		if (!(await isValidIgnoredPathMirror(sourcePath, targetPath))) {
			return false;
		}
	}
	return true;
}

async function listConfiguredSubmodulePaths(worktreePath: string): Promise<string[]> {
	const gitmodulesPath = join(worktreePath, ".gitmodules");
	if (!(await pathExists(gitmodulesPath))) {
		return [];
	}

	const result = await runGit(worktreePath, [
		"config",
		"--file",
		gitmodulesPath,
		"--get-regexp",
		"^submodule\\..*\\.path$",
	]);
	if (!result.ok) {
		return [];
	}

	return result.stdout
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.map((line) => {
			const spaceIndex = line.indexOf(" ");
			return spaceIndex >= 0 ? line.slice(spaceIndex + 1).trim() : "";
		})
		.filter((path) => path.length > 0)
		.map((path) => toPlatformRelativePath(path));
}

async function isPopulatedSubmoduleCheckout(submodulePath: string): Promise<boolean> {
	if (!(await pathExists(submodulePath))) {
		return false;
	}
	const gitMarkerPath = join(submodulePath, ".git");
	if (!(await pathExists(gitMarkerPath))) {
		return false;
	}
	try {
		const gitMarkerStat = await lstat(gitMarkerPath);
		return gitMarkerStat.isFile() || gitMarkerStat.isDirectory();
	} catch {
		return false;
	}
}

async function worktreeHasConfiguredSubmodules(worktreePath: string): Promise<boolean> {
	const gitmodulesPath = join(worktreePath, ".gitmodules");
	if (!(await pathExists(gitmodulesPath))) {
		return false;
	}

	const result = await runGit(worktreePath, [
		"config",
		"--file",
		gitmodulesPath,
		"--get-regexp",
		"^submodule\\..*\\.path$",
	]);
	return result.ok && result.stdout.length > 0;
}

function escapeGitIgnoreLiteral(path: string): string {
	const normalized = toPlatformRelativePath(path);
	return normalized
		.replace(/\\/g, "\\\\")
		.replace(/^([#!])/u, "\\$1")
		.replace(/([*?[])/g, "\\$1");
}

function stripManagedExcludeBlock(content: string): string {
	const lines = content.split("\n");
	const nextLines: string[] = [];
	let insideManagedBlock = false;
	for (const line of lines) {
		if (line === KANBAN_MANAGED_EXCLUDE_BLOCK_START) {
			insideManagedBlock = true;
			continue;
		}
		if (line === KANBAN_MANAGED_EXCLUDE_BLOCK_END) {
			insideManagedBlock = false;
			continue;
		}
		if (!insideManagedBlock) {
			nextLines.push(line);
		}
	}
	return nextLines.join("\n").replace(/\n+$/g, "");
}

async function syncManagedIgnoredPathExcludes(repoPath: string, relativePaths: string[]): Promise<void> {
	const excludePathOutput = await getGitStdout(["rev-parse", "--git-path", "info/exclude"], repoPath);
	if (!excludePathOutput) {
		return;
	}
	const excludePath = isAbsolute(excludePathOutput) ? excludePathOutput : join(repoPath, excludePathOutput);

	const existingContent = await readFile(excludePath, "utf8").catch(() => "");
	const preservedContent = stripManagedExcludeBlock(existingContent);
	const managedPaths = getUniquePaths(relativePaths);
	const managedBlock =
		managedPaths.length === 0
			? ""
			: [
					KANBAN_MANAGED_EXCLUDE_BLOCK_START,
					"# Keep symlinked ignored paths ignored inside Kanban task worktrees.",
					...managedPaths.map((relativePath) => `/${escapeGitIgnoreLiteral(relativePath)}`),
					KANBAN_MANAGED_EXCLUDE_BLOCK_END,
				].join("\n");

	const nextContent = [preservedContent, managedBlock].filter(Boolean).join("\n\n").replace(/\n+$/g, "");
	const normalizedNextContent = nextContent ? `${nextContent}\n` : "";
	if (normalizedNextContent === existingContent) {
		return;
	}

	await lockedFileSystem.writeTextFileAtomic(excludePath, normalizedNextContent);
}

async function syncIgnoredPathsIntoWorktree(repoPath: string, worktreePath: string): Promise<string[]> {
	const ignoredPaths = getUniquePaths(await listIgnoredPaths(repoPath)).filter(
		(relativePath) => !shouldSkipSymlink(relativePath),
	);
	const turbopackNodeModulesSkipPaths = new Set(await listTurbopackNodeModulesSymlinkSkipPaths(repoPath));
	const mirroredIgnoredPaths = ignoredPaths.filter((relativePath) => !turbopackNodeModulesSkipPaths.has(relativePath));

	await syncManagedIgnoredPathExcludes(repoPath, mirroredIgnoredPaths);
	const syncedPaths: string[] = [];
	for (const relativePath of mirroredIgnoredPaths) {
		if (shouldSkipSymlink(relativePath)) {
			continue;
		}

		const sourcePath = join(repoPath, relativePath);
		if (!(await pathExists(sourcePath))) {
			continue;
		}

		const targetPath = join(worktreePath, relativePath);
		if (await pathExists(targetPath)) {
			syncedPaths.push(relativePath);
			continue;
		}

		const sourceStat = await lstat(sourcePath);
		await mkdir(dirname(targetPath), { recursive: true });
		const mirrored = await mirrorIgnoredPath({
			sourcePath,
			targetPath,
			isDirectory: sourceStat.isDirectory(),
		});
		if (mirrored === "mirrored") {
			syncedPaths.push(relativePath);
		}
	}
	return syncedPaths;
}

async function syncIgnoredPathsIntoWorktreeIfStale(repoPath: string, worktreePath: string): Promise<void> {
	const homeHead = await getRepoHeadCommit(repoPath);
	if (!homeHead) {
		await syncIgnoredPathsIntoWorktree(repoPath, worktreePath);
		return;
	}

	const manifest = await readIgnoredSymlinksManifest(worktreePath);
	if (
		manifest &&
		manifest.homeHead === homeHead &&
		(await areManifestSymlinksValid(repoPath, worktreePath, manifest))
	) {
		return;
	}

	const syncedPaths = await syncIgnoredPathsIntoWorktree(repoPath, worktreePath);
	const mergedPaths = getUniquePaths([...(manifest?.syncedPaths ?? []), ...syncedPaths]);
	await writeIgnoredSymlinksManifest(worktreePath, {
		homeHead,
		syncedPaths: mergedPaths,
		syncedAt: Date.now(),
	});
}

async function initializeSubmodulesIfNeeded(repoPath: string, worktreePath: string): Promise<void> {
	if (!(await worktreeHasConfiguredSubmodules(worktreePath))) {
		return;
	}

	const submodulePaths = await listConfiguredSubmodulePaths(worktreePath);
	if (submodulePaths.length === 0) {
		await getGitStdout(["submodule", "update", "--init", "--recursive"], worktreePath);
		return;
	}

	const populatedInHomeRepo = await Promise.all(
		submodulePaths.map(async (relativePath) => isPopulatedSubmoduleCheckout(join(repoPath, relativePath))),
	);
	if (populatedInHomeRepo.every(Boolean)) {
		for (const relativePath of submodulePaths) {
			const sourcePath = join(repoPath, relativePath);
			const targetPath = join(worktreePath, relativePath);
			if (await pathExists(targetPath)) {
				continue;
			}
			await mkdir(dirname(targetPath), { recursive: true });
			await mirrorIgnoredPath({
				sourcePath,
				targetPath,
				isDirectory: true,
			});
		}
		return;
	}

	await getGitStdout(["submodule", "update", "--init", "--recursive"], worktreePath);
}

async function prepareNewTaskWorktree(repoPath: string, worktreePath: string): Promise<void> {
	try {
		await initializeSubmodulesIfNeeded(repoPath, worktreePath);
		await syncIgnoredPathsIntoWorktreeIfStale(repoPath, worktreePath);
	} catch (error) {
		await removeTaskWorktreeInternal(repoPath, worktreePath).catch(() => {});
		throw error;
	}
}

async function removeTaskWorktreeInternal(repoPath: string, worktreePath: string): Promise<boolean> {
	const existed = await pathExists(worktreePath);
	const removeResult = await runGit(repoPath, ["worktree", "remove", "--force", worktreePath]);
	if (!removeResult.ok) {
		// If remove failed (e.g. worktree in bad state), prune stale registrations
		// so git doesn't think the path is still registered after we rm it.
		await runGit(repoPath, ["worktree", "prune"]);
	}
	await rm(worktreePath, { recursive: true, force: true });
	return existed;
}

export async function pruneEmptyParents(rootPath: string, fromPath: string): Promise<void> {
	let current = fromPath;
	while (current.startsWith(rootPath) && current !== rootPath) {
		try {
			const entries = await readdir(current);
			if (entries.length > 0) {
				return;
			}
			await rm(current, { recursive: true, force: true });
			current = dirname(current);
		} catch {
			return;
		}
	}
}

export async function ensureTaskWorktreeIfDoesntExist(options: {
	cwd: string;
	taskId: string;
	baseRef: string;
}): Promise<RuntimeWorktreeEnsureResponse> {
	try {
		const context = await loadWorkspaceContext(options.cwd);
		const taskId = normalizeTaskIdForWorktreePath(options.taskId);
		const worktreePath = getTaskWorktreePath(context.repoPath, taskId);
		// Investigation note: ensure is called on every task start. The previous implementation
		// compared the worktree HEAD to the latest baseRef commit and recreated the worktree
		// when the base branch advanced, which could destroy valid task progress. Existing
		// worktrees are now treated as authoritative and only missing worktrees are created.
		const existingResult = await runGit(worktreePath, ["rev-parse", "HEAD"]);
		if (existingResult.ok && existingResult.stdout) {
			await measureTaskStartSpan("ensureWorktree.syncIgnoredPaths", () =>
				syncIgnoredPathsIntoWorktreeIfStale(context.repoPath, worktreePath),
			);
			const baseRef = await resolveExistingWorktreeBaseRef({
				repoPath: context.repoPath,
				workspaceId: context.workspaceId,
				taskId,
				worktreePath,
				requestedBaseRef: options.baseRef,
			});
			return {
				ok: true,
				path: worktreePath,
				baseRef,
				baseCommit: existingResult.stdout,
			};
		}

		return await withTaskWorktreeSetupLock(context.repoPath, async () => {
			const lockedExistingCommit = await tryRunGit(worktreePath, ["rev-parse", "HEAD"]);
			if (lockedExistingCommit) {
				await measureTaskStartSpan("ensureWorktree.syncIgnoredPaths", () =>
					syncIgnoredPathsIntoWorktreeIfStale(context.repoPath, worktreePath),
				);
				const baseRef = await resolveExistingWorktreeBaseRef({
					repoPath: context.repoPath,
					workspaceId: context.workspaceId,
					taskId,
					worktreePath,
					requestedBaseRef: options.baseRef,
				});
				return {
					ok: true,
					path: worktreePath,
					baseRef,
					baseCommit: lockedExistingCommit,
				};
			}

			// The recorded base ref outlives this worktree, so it has to be a fixed
			// branch: a floating `HEAD` would silently re-point at whatever the home
			// repo checks out next, which is what made merges land on the wrong branch.
			const resolvedBaseRef = await resolveConcreteBaseBranch(context.repoPath, options.baseRef);
			if (!resolvedBaseRef.ok) {
				return {
					ok: false,
					path: null,
					baseRef: options.baseRef.trim(),
					baseCommit: null,
					error: resolvedBaseRef.error,
				};
			}
			const requestedBaseRef = resolvedBaseRef.branch;

			const baseRefResult = await runGit(context.repoPath, [
				"rev-parse",
				"--verify",
				`${requestedBaseRef}^{commit}`,
			]);
			if (!baseRefResult.ok) {
				return {
					ok: false,
					path: null,
					baseRef: requestedBaseRef,
					baseCommit: null,
					error: getWorktreeBaseRefResolutionErrorMessage(
						requestedBaseRef,
						baseRefResult.stderr || baseRefResult.output,
					),
				};
			}
			const requestedBaseCommit = baseRefResult.stdout;

			const storedPatch = await findTaskPatch(taskId);
			let baseCommit = storedPatch?.commit ?? requestedBaseCommit;
			let warning: string | undefined;

			if (await pathExists(worktreePath)) {
				await removeTaskWorktreeInternal(context.repoPath, worktreePath);
			}

			// Clean up stale worktree registrations that can linger when git
			// worktree remove fails or the process is interrupted. Without this,
			// git worktree add refuses with "missing but already registered".
			await runGit(context.repoPath, ["worktree", "prune"]);

			await mkdir(dirname(worktreePath), { recursive: true });
			const addResult = await measureTaskStartSpan("ensureWorktree.worktreeAdd", async () =>
				runGit(context.repoPath, ["worktree", "add", "--detach", worktreePath, baseCommit]),
			);
			if (!addResult.ok) {
				if (!storedPatch) {
					return {
						ok: false,
						path: null,
						baseRef: requestedBaseRef,
						baseCommit: null,
						error: addResult.stderr || addResult.output,
					};
				}

				baseCommit = requestedBaseCommit;
				warning =
					"Could not restore the saved task patch onto its original commit. Started from the task base ref instead.";
				await getGitStdout(["worktree", "add", "--detach", worktreePath, baseCommit], context.repoPath);
			}
			await prepareNewTaskWorktree(context.repoPath, worktreePath);
			await registerActiveBranch(context.workspaceId, {
				taskId,
				branch: deriveTaskBranchName(taskId),
				worktreePath,
				baseRef: requestedBaseRef,
				baseCommit: requestedBaseCommit,
			});

			if (storedPatch && baseCommit === storedPatch.commit) {
				try {
					await applyTaskPatch(storedPatch.path, worktreePath);
					await rm(storedPatch.path, { force: true });
				} catch (error) {
					warning = `Saved task changes could not be reapplied automatically. ${getGitCommandErrorMessage(error)}`;
				}
			}

			return {
				ok: true,
				path: worktreePath,
				baseRef: requestedBaseRef,
				baseCommit,
				warning,
			};
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			ok: false,
			path: null,
			baseRef: options.baseRef.trim(),
			baseCommit: null,
			error: message,
		};
	}
}

async function cleanupTaskScratchAndPromptFiles(taskId: string): Promise<void> {
	try {
		const slug = taskId.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120) || "session";
		const scratchDir = join(getRuntimeHomePath(), "task-launch", slug);
		await rm(scratchDir, { recursive: true, force: true });
	} catch {
		// Best effort
	}
	try {
		const geminiPromptFile = join(getRuntimeHomePath(), "hooks", "gemini", `append-system-prompt-${taskId}.md`);
		await rm(geminiPromptFile, { force: true });
	} catch {
		// Best effort
	}
	try {
		const claudePromptFile = join(getRuntimeHomePath(), "hooks", "claude", `append-system-prompt-${taskId}.md`);
		await rm(claudePromptFile, { force: true });
	} catch {
		// Best effort
	}
}

export async function deleteTaskWorktree(options: {
	repoPath: string;
	taskId: string;
}): Promise<RuntimeWorktreeDeleteResponse> {
	try {
		const taskId = normalizeTaskIdForWorktreePath(options.taskId);
		const rootPath = getWorktreesBaseRootPath();
		const worktreePath = getTaskWorktreePath(options.repoPath, taskId);

		const result = await withTaskWorktreeSetupLock(options.repoPath, async (): Promise<RuntimeWorktreeDeleteResponse> => {
			if (!(await pathExists(worktreePath))) {
				await deleteTaskPatchFiles(taskId);
				await pruneEmptyParents(rootPath, dirname(worktreePath));
				return {
					ok: true,
					removed: false,
				};
			}

			try {
				await captureTaskPatch({
					repoPath: options.repoPath,
					taskId,
					worktreePath,
				});
			} catch {
				// Patch capture is best-effort. A corrupted or partially-created
				// worktree (e.g. plain directory, no git init) should still be removed.
			}
			const removed = await removeTaskWorktreeInternal(options.repoPath, worktreePath);
			await pruneEmptyParents(rootPath, dirname(worktreePath));

			return {
				ok: true,
				removed,
			};
		});

		await deregisterActiveBranchForRepo(options.repoPath, taskId);
		await cleanupTaskScratchAndPromptFiles(taskId);
		return result;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			ok: false,
			removed: false,
			error: message,
		};
	}
}

export async function resolveTaskCwd(options: {
	cwd: string;
	taskId: string;
	baseRef: string;
	ensure?: boolean;
}): Promise<string> {
	const context = await loadWorkspaceContext(options.cwd);

	const normalizedBaseRef = options.baseRef.trim();
	if (!normalizedBaseRef) {
		throw new Error("Task base branch is required for task workspace resolution.");
	}

	if (options.ensure) {
		const ensured = await ensureTaskWorktreeIfDoesntExist({
			cwd: options.cwd,
			taskId: options.taskId,
			baseRef: normalizedBaseRef,
		});
		if (!ensured.ok) {
			throw new Error(ensured.error ?? "Worktree setup failed.");
		}
		return ensured.path;
	}

	const worktreePath = getTaskWorktreePath(context.repoPath, options.taskId);
	if (await pathExists(worktreePath)) {
		return worktreePath;
	}
	throw new Error(`Task worktree not found for task "${options.taskId}".`);
}

export async function getTaskWorkspacePathInfo(options: {
	cwd: string;
	workspaceId: string;
	taskId: string;
	baseRef: string;
}): Promise<
	Pick<RuntimeTaskWorkspaceInfoResponse, "taskId" | "path" | "exists" | "baseRef" | "baseRefLocked" | "baseCommit">
> {
	const taskId = normalizeTaskIdForWorktreePath(options.taskId);
	const normalizedBaseRef = options.baseRef.trim();
	const repoPath = options.cwd.trim();
	const workspaceId = options.workspaceId.trim();

	if (!repoPath) {
		throw new Error("Task workspace root is required for task workspace info.");
	}

	if (!workspaceId) {
		throw new Error("Workspace id is required for task workspace info.");
	}

	if (!normalizedBaseRef) {
		throw new Error("Task base branch is required for task workspace info.");
	}

	const worktreePath = getTaskWorktreePath(repoPath, taskId);
	const exists = await pathExists(worktreePath);
	let baseRef = normalizedBaseRef;
	let baseRefLocked = false;
	let baseCommit: string | undefined;
	if (exists) {
		try {
			const entry = await getActiveBranchEntry(workspaceId, taskId);
			if (entry?.baseRef) {
				baseRef = entry.baseRef;
				baseCommit = entry.baseCommit;
				// An entry written by an older runtime can hold a floating `HEAD` (or a
				// branch that has since been deleted). Reporting that as locked would
				// keep the card's picker disabled on a base ref nothing can merge into.
				baseRefLocked = await hasLocalGitBranch(repoPath, entry.baseRef);
			}
		} catch {
			// Registry read must never be fatal on the metadata poll path.
		}
	}
	return {
		taskId,
		path: worktreePath,
		exists,
		baseRef,
		baseRefLocked,
		...(baseCommit ? { baseCommit } : {}),
	};
}

export async function getTaskWorkspaceInfo(options: {
	cwd: string;
	workspaceId: string;
	taskId: string;
	baseRef: string;
}): Promise<RuntimeTaskWorkspaceInfoResponse> {
	const workspacePathInfo = await getTaskWorkspacePathInfo(options);
	if (!workspacePathInfo.exists) {
		return {
			...workspacePathInfo,
			exists: false,
			branch: null,
			isDetached: false,
			headCommit: null,
		};
	}

	const headInfo = await readGitHeadInfo(workspacePathInfo.path);
	return {
		...workspacePathInfo,
		exists: true,
		branch: headInfo.branch,
		isDetached: headInfo.isDetached,
		headCommit: headInfo.headCommit,
	};
}
