# Cleanup Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `Cleanup` button next to the `Office` toggle in the top bar that opens a modal where the user picks Claude cache/logs and/or merged runtime worktrees to preview and delete.

**Architecture:** Two independent backend cleanup domains (`claude-cache-cleanup.ts` new, `git-worktree-cleanup.ts` extended with a `dryRun` flag) exposed via tRPC, consumed by one frontend modal (`CleanupDialog` + `useCleanupTools` hook) that lets the user check categories, preview via dry-run, then confirm.

**Tech Stack:** TypeScript, tRPC (zod schemas in `api-contract.ts`), React, Radix UI (`@radix-ui/react-checkbox`), Vitest, `lucide-react` icons.

## Global Constraints

- Safe tier age cutoff defaults to 7 days (matches claude-clean's default), based on file mtime.
- Claude cache scan touches only this explicit allowlist under `~/.claude`: `cache/`, `paste-cache/`, `shell-snapshots/`, `file-history/` (safe tier) and `projects/**/*.jsonl` (transcript tier, opt-in only). Nothing else under `~/.claude` is ever scanned.
- No `Co-Authored-By` or AI-attribution trailers in commits (repo-wide rule, see root `CLAUDE.md`).
- No edits to any `package.json` (repo-wide deny rule) — no new dependencies are needed for this plan; everything uses packages already in the tree (`@radix-ui/react-checkbox`, `lucide-react`, `sonner` via `showAppToast`/`notifyError`).
- Per-item delete failures must be recorded in a `skipped` list with a reason, never thrown — the batch continues.

---

### Task 1: `cleanMergedWorktrees` dry-run support

**Files:**
- Modify: `backends/runtime/src/workspace/git-worktree-cleanup.ts`
- Modify: `backends/runtime/src/core/api-contract.ts` (add request schema near line 2530)
- Modify: `backends/runtime/src/trpc/workspace-api.ts:646` (`cleanMergedWorktrees` method)
- Modify: `backends/runtime/src/trpc/app-router.ts` (interface at ~line 526+ block, and procedure at line 1109-1113)
- Test: `backends/runtime/test/runtime/workspace/git-worktree-cleanup.test.ts` (new file)

**Interfaces:**
- Consumes: existing `listActiveBranchEntries`, `hasLiveChainMemberSharingWorktree`, `runGit`, `deleteTaskWorktree`, `runGitDeleteBranchAction` (all already imported in `git-worktree-cleanup.ts`, no signature changes needed).
- Produces: `cleanMergedWorktrees(options: { repoPath: string; workspaceId: string; board: RuntimeBoardData; dryRun?: boolean }): Promise<RuntimeCleanMergedWorktreesResponse>` — same response shape as before (`{ ok, cleanedTaskIds, skipped }`); later tasks are unaffected by this signature (it's additive/optional).

- [ ] **Step 1: Write the failing test for dry-run behavior**

Create `backends/runtime/test/runtime/workspace/git-worktree-cleanup.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";

const branchRegistryMocks = vi.hoisted(() => ({
	listActiveBranchEntries: vi.fn(),
}));
const taskBoardMutationsMocks = vi.hoisted(() => ({
	hasLiveChainMemberSharingWorktree: vi.fn(),
}));
const gitSyncMocks = vi.hoisted(() => ({
	runGitDeleteBranchAction: vi.fn(),
}));
const gitUtilsMocks = vi.hoisted(() => ({
	runGit: vi.fn(),
}));
const taskWorktreeMocks = vi.hoisted(() => ({
	deleteTaskWorktree: vi.fn(),
}));

vi.mock("../../../src/workspace/branch-registry.js", () => ({
	listActiveBranchEntries: branchRegistryMocks.listActiveBranchEntries,
}));
vi.mock("../../../src/core/task-board-mutations.js", () => ({
	hasLiveChainMemberSharingWorktree: taskBoardMutationsMocks.hasLiveChainMemberSharingWorktree,
}));
vi.mock("../../../src/workspace/git-sync.js", () => ({
	runGitDeleteBranchAction: gitSyncMocks.runGitDeleteBranchAction,
}));
vi.mock("../../../src/workspace/git-utils.js", () => ({
	runGit: gitUtilsMocks.runGit,
}));
vi.mock("../../../src/workspace/task-worktree.js", () => ({
	deleteTaskWorktree: taskWorktreeMocks.deleteTaskWorktree,
}));

import { cleanMergedWorktrees } from "../../../src/workspace/git-worktree-cleanup";

function resetMocks() {
	branchRegistryMocks.listActiveBranchEntries.mockReset();
	taskBoardMutationsMocks.hasLiveChainMemberSharingWorktree.mockReset();
	gitSyncMocks.runGitDeleteBranchAction.mockReset();
	gitUtilsMocks.runGit.mockReset();
	taskWorktreeMocks.deleteTaskWorktree.mockReset();
}

describe("cleanMergedWorktrees dryRun", () => {
	it("reports would-clean entries without deleting or deleting branches", async () => {
		resetMocks();
		branchRegistryMocks.listActiveBranchEntries.mockResolvedValue([
			{ taskId: "task-1", branch: "kanban/task-1", baseRef: "main" },
		]);
		taskBoardMutationsMocks.hasLiveChainMemberSharingWorktree.mockReturnValue(false);
		gitUtilsMocks.runGit.mockResolvedValue({ ok: true });

		const response = await cleanMergedWorktrees({
			repoPath: "/repo",
			workspaceId: "ws-1",
			board: {} as never,
			dryRun: true,
		});

		expect(response).toEqual({ ok: true, cleanedTaskIds: ["task-1"], skipped: [] });
		expect(taskWorktreeMocks.deleteTaskWorktree).not.toHaveBeenCalled();
		expect(gitSyncMocks.runGitDeleteBranchAction).not.toHaveBeenCalled();
	});

	it("still reports skip reasons in dryRun without deleting anything", async () => {
		resetMocks();
		branchRegistryMocks.listActiveBranchEntries.mockResolvedValue([
			{ taskId: "task-2", branch: "kanban/task-2", baseRef: "main" },
		]);
		taskBoardMutationsMocks.hasLiveChainMemberSharingWorktree.mockReturnValue(false);
		gitUtilsMocks.runGit.mockResolvedValue({ ok: false });

		const response = await cleanMergedWorktrees({
			repoPath: "/repo",
			workspaceId: "ws-1",
			board: {} as never,
			dryRun: true,
		});

		expect(response.ok).toBe(true);
		expect(response.cleanedTaskIds).toEqual([]);
		expect(response.skipped).toEqual([
			{ taskId: "task-2", branch: "kanban/task-2", reason: "Not merged into its base ref." },
		]);
		expect(taskWorktreeMocks.deleteTaskWorktree).not.toHaveBeenCalled();
	});

	it("deletes for real when dryRun is not set", async () => {
		resetMocks();
		branchRegistryMocks.listActiveBranchEntries.mockResolvedValue([
			{ taskId: "task-3", branch: "kanban/task-3", baseRef: "main" },
		]);
		taskBoardMutationsMocks.hasLiveChainMemberSharingWorktree.mockReturnValue(false);
		gitUtilsMocks.runGit.mockResolvedValue({ ok: true });
		taskWorktreeMocks.deleteTaskWorktree.mockResolvedValue({ ok: true });
		gitSyncMocks.runGitDeleteBranchAction.mockResolvedValue({ ok: true });

		const response = await cleanMergedWorktrees({
			repoPath: "/repo",
			workspaceId: "ws-1",
			board: {} as never,
		});

		expect(response).toEqual({ ok: true, cleanedTaskIds: ["task-3"], skipped: [] });
		expect(taskWorktreeMocks.deleteTaskWorktree).toHaveBeenCalledWith({ repoPath: "/repo", taskId: "task-3" });
		expect(gitSyncMocks.runGitDeleteBranchAction).toHaveBeenCalledWith({ cwd: "/repo", branch: "kanban/task-3" });
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backends/runtime && npx vitest run test/runtime/workspace/git-worktree-cleanup.test.ts`
Expected: FAIL — `dryRun` option is not recognized / real delete calls happen in the dry-run cases (the first two assertions fail because `deleteTaskWorktree`/`runGitDeleteBranchAction` get called even in "dryRun: true").

- [ ] **Step 3: Implement `dryRun` in `cleanMergedWorktrees`**

Edit `backends/runtime/src/workspace/git-worktree-cleanup.ts`:

```typescript
import type { RuntimeBoardData, RuntimeCleanMergedWorktreesResponse } from "../core/api-contract";
import { hasLiveChainMemberSharingWorktree } from "../core/task-board-mutations";
import { listActiveBranchEntries } from "./branch-registry";
import { runGitDeleteBranchAction } from "./git-sync";
import { runGit } from "./git-utils";
import { deleteTaskWorktree } from "./task-worktree";

/**
 * Removes task worktrees whose branch is fully merged into its recorded base
 * ref. Safety mirrors `git branch -d`: a branch only qualifies once every one
 * of its commits is an ancestor of the base ref, so nothing in-flight is lost.
 * With `dryRun: true`, every eligibility check still runs but no worktree or
 * branch is actually deleted — the same response shape doubles as a preview.
 */
export async function cleanMergedWorktrees(options: {
	repoPath: string;
	workspaceId: string;
	board: RuntimeBoardData;
	dryRun?: boolean;
}): Promise<RuntimeCleanMergedWorktreesResponse> {
	const entries = await listActiveBranchEntries(options.workspaceId);
	const cleanedTaskIds: string[] = [];
	const skipped: { taskId: string; branch: string; reason: string }[] = [];

	for (const entry of entries) {
		if (hasLiveChainMemberSharingWorktree(options.board, entry.taskId, entry.taskId)) {
			skipped.push({ taskId: entry.taskId, branch: entry.branch, reason: "Shared with a live chain member." });
			continue;
		}
		if (!entry.baseRef) {
			skipped.push({ taskId: entry.taskId, branch: entry.branch, reason: "No base ref recorded." });
			continue;
		}

		const ancestorCheck = await runGit(options.repoPath, [
			"merge-base",
			"--is-ancestor",
			entry.branch,
			entry.baseRef,
		]);
		if (!ancestorCheck.ok) {
			skipped.push({ taskId: entry.taskId, branch: entry.branch, reason: "Not merged into its base ref." });
			continue;
		}

		if (options.dryRun) {
			cleanedTaskIds.push(entry.taskId);
			continue;
		}

		const deleteResult = await deleteTaskWorktree({ repoPath: options.repoPath, taskId: entry.taskId });
		if (!deleteResult.ok) {
			skipped.push({
				taskId: entry.taskId,
				branch: entry.branch,
				reason: deleteResult.error ?? "Failed to remove worktree.",
			});
			continue;
		}

		// Best-effort: the worktree is gone either way, so a branch-delete failure
		// (e.g. already removed) shouldn't be reported as a skip.
		await runGitDeleteBranchAction({ cwd: options.repoPath, branch: entry.branch });
		cleanedTaskIds.push(entry.taskId);
	}

	return { ok: true, cleanedTaskIds, skipped };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backends/runtime && npx vitest run test/runtime/workspace/git-worktree-cleanup.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Add the request schema**

In `backends/runtime/src/core/api-contract.ts`, immediately before `runtimeCleanMergedWorktreesSkippedEntrySchema` (around line 2530), add:

```typescript
export const runtimeCleanMergedWorktreesRequestSchema = z.object({
	dryRun: z.boolean().optional(),
});
export type RuntimeCleanMergedWorktreesRequest = z.infer<typeof runtimeCleanMergedWorktreesRequestSchema>;
```

- [ ] **Step 6: Thread `dryRun` through `workspace-api.ts`**

In `backends/runtime/src/trpc/workspace-api.ts`, change the `cleanMergedWorktrees` method (line 646) from:

```typescript
		cleanMergedWorktrees: async (workspaceScope) => {
			try {
				const { board } = await loadWorkspaceState(workspaceScope.workspacePath);
				const response = await cleanMergedWorktrees({
					repoPath: workspaceScope.workspacePath,
					workspaceId: workspaceScope.workspaceId,
					board,
				});
				if (response.cleanedTaskIds.length > 0) {
					void deps.broadcastRuntimeWorkspaceStateUpdated(
						workspaceScope.workspaceId,
						workspaceScope.workspacePath,
					);
				}
				return response;
```

to:

```typescript
		cleanMergedWorktrees: async (workspaceScope, input) => {
			try {
				const { board } = await loadWorkspaceState(workspaceScope.workspacePath);
				const response = await cleanMergedWorktrees({
					repoPath: workspaceScope.workspacePath,
					workspaceId: workspaceScope.workspaceId,
					board,
					dryRun: input?.dryRun,
				});
				if (!input?.dryRun && response.cleanedTaskIds.length > 0) {
					void deps.broadcastRuntimeWorkspaceStateUpdated(
						workspaceScope.workspaceId,
						workspaceScope.workspacePath,
					);
				}
				return response;
```

(the `catch` block and the rest of the function body are unchanged — only the parameter list and the two lines above change).

- [ ] **Step 7: Update the `workspaceApi` interface type and router procedure in `app-router.ts`**

Find the `workspaceApi` interface entry for `cleanMergedWorktrees` (in the type block starting around line 526) and change:

```typescript
		cleanMergedWorktrees: (scope: RuntimeTrpcWorkspaceScope) => Promise<RuntimeCleanMergedWorktreesResponse>;
```

to:

```typescript
		cleanMergedWorktrees: (
			scope: RuntimeTrpcWorkspaceScope,
			input?: RuntimeCleanMergedWorktreesRequest,
		) => Promise<RuntimeCleanMergedWorktreesResponse>;
```

Then update the procedure registration (lines 1109-1113) from:

```typescript
			cleanMergedWorktrees: workspaceProcedure
				.output(runtimeCleanMergedWorktreesResponseSchema)
				.mutation(async ({ ctx }) => {
					return await ctx.workspaceApi.cleanMergedWorktrees(ctx.workspaceScope);
				}),
```

to:

```typescript
			cleanMergedWorktrees: workspaceProcedure
				.input(runtimeCleanMergedWorktreesRequestSchema.optional())
				.output(runtimeCleanMergedWorktreesResponseSchema)
				.mutation(async ({ ctx, input }) => {
					return await ctx.workspaceApi.cleanMergedWorktrees(ctx.workspaceScope, input ?? undefined);
				}),
```

Add `runtimeCleanMergedWorktreesRequestSchema` and `RuntimeCleanMergedWorktreesRequest` to the existing import block from `../core/api-contract` at the top of `app-router.ts` (find the line importing `runtimeCleanMergedWorktreesResponseSchema` and add the new names alongside it, same for the `workspace-api.ts` import of `RuntimeCleanMergedWorktreesResponse`/related types if `RuntimeCleanMergedWorktreesRequest` is referenced there too — it is not needed in `workspace-api.ts` itself since `input?.dryRun` is accessed structurally, but if TypeScript strict mode requires an explicit type for the `input` parameter, import `RuntimeCleanMergedWorktreesRequest` from `../core/api-contract` in `workspace-api.ts` and annotate: `input?: RuntimeCleanMergedWorktreesRequest`).

- [ ] **Step 8: Typecheck**

Run: `cd backends/runtime && npx tsc --noEmit`
Expected: no errors. If there are import errors, add the missing named imports reported by tsc.

- [ ] **Step 9: Run full backend test suite for this area**

Run: `cd backends/runtime && npx vitest run test/runtime/workspace/git-worktree-cleanup.test.ts test/runtime/trpc/workspace-api.test.ts`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add backends/runtime/src/workspace/git-worktree-cleanup.ts backends/runtime/src/core/api-contract.ts backends/runtime/src/trpc/workspace-api.ts backends/runtime/src/trpc/app-router.ts backends/runtime/test/runtime/workspace/git-worktree-cleanup.test.ts
git commit -m "feat(runtime): add dryRun preview to cleanMergedWorktrees"
```

---

### Task 2: `claude-cache-cleanup.ts` module + schemas + tRPC wiring

**Files:**
- Create: `backends/runtime/src/workspace/claude-cache-cleanup.ts`
- Modify: `backends/runtime/src/core/api-contract.ts` (new schemas, add anywhere near the worktree schemas from Task 1)
- Modify: `backends/runtime/src/trpc/runtime-api.ts` (add two methods near `openFile`/`getHostEnvironment`, ~line 883-899)
- Modify: `backends/runtime/src/trpc/app-router.ts` (add to `runtimeApi` interface ~line 520-525, and to the `runtime: t.router({...})` block ~line 1005-1019)
- Test: `backends/runtime/test/runtime/workspace/claude-cache-cleanup.test.ts` (new file)

**Interfaces:**
- Consumes: nothing from Task 1 (independent module). Uses `node:fs/promises` (`readdir`, `stat`, `unlink`, `rmdir` or `rm`), `node:path` (`join`), `node:os` (`homedir`).
- Produces:
  - `getClaudeCacheStatus(options?: { claudeHomeDir?: string }): Promise<RuntimeClaudeCacheStatusResponse>`
  - `cleanClaudeCache(options: { claudeHomeDir?: string; days?: number; includeTranscripts: boolean; dryRun: boolean }): Promise<RuntimeClaudeCacheCleanResponse>`
  - Types (all in `api-contract.ts`): `RuntimeClaudeCacheStatusResponse = { ok: boolean; safeItemCount: number; safeSizeBytes: number; transcriptItemCount: number; transcriptSizeBytes: number; error?: string }`, `RuntimeClaudeCacheCleanRequest = { days?: number; includeTranscripts: boolean; dryRun: boolean }`, `RuntimeClaudeCacheCleanedItem = { path: string; sizeBytes: number; tier: "safe" | "transcript" }`, `RuntimeClaudeCacheSkippedItem = { path: string; reason: string }`, `RuntimeClaudeCacheCleanResponse = { ok: boolean; cleaned: RuntimeClaudeCacheCleanedItem[]; skipped: RuntimeClaudeCacheSkippedItem[]; error?: string }`.
  - These four exported names (`getClaudeCacheStatus`, `cleanClaudeCache`, and the two response/request type names) are what Task 4 (frontend client helpers) and this task's own `runtime-api.ts`/`app-router.ts` wiring rely on. Task 3+ only ever import from `@/runtime/types` (re-exported) and `@/runtime/runtime-config-query`, never directly from the backend module.

- [ ] **Step 1: Write the failing unit tests**

Create `backends/runtime/test/runtime/workspace/claude-cache-cleanup.test.ts`:

```typescript
import { mkdirSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempDir } from "../../utilities/temp-dir";
import { cleanClaudeCache, getClaudeCacheStatus } from "../../../src/workspace/claude-cache-cleanup";

const OLD_MS = 1000 * 60 * 60 * 24 * 10; // 10 days old
const NEW_MS = 1000 * 60 * 60; // 1 hour old

function touch(path: string, ageMs: number) {
	const time = new Date(Date.now() - ageMs);
	writeFileSync(path, "x");
	utimesSync(path, time, time);
}

describe("claude-cache-cleanup", () => {
	let cleanup: (() => void) | null = null;
	let claudeHomeDir = "";

	beforeEach(() => {
		const temp = createTempDir("kanban-claude-cache-");
		cleanup = temp.cleanup;
		claudeHomeDir = temp.path;
		mkdirSync(join(claudeHomeDir, "cache"), { recursive: true });
		mkdirSync(join(claudeHomeDir, "paste-cache"), { recursive: true });
		mkdirSync(join(claudeHomeDir, "shell-snapshots"), { recursive: true });
		mkdirSync(join(claudeHomeDir, "file-history", "some-uuid"), { recursive: true });
		mkdirSync(join(claudeHomeDir, "projects", "some-project"), { recursive: true });
		mkdirSync(join(claudeHomeDir, "accounts"), { recursive: true }); // protected, not in allowlist

		touch(join(claudeHomeDir, "cache", "old.json"), OLD_MS);
		touch(join(claudeHomeDir, "paste-cache", "old.txt"), OLD_MS);
		touch(join(claudeHomeDir, "shell-snapshots", "old.sh"), OLD_MS);
		touch(join(claudeHomeDir, "file-history", "some-uuid", "old@v1"), OLD_MS);
		touch(join(claudeHomeDir, "shell-snapshots", "new.sh"), NEW_MS);
		touch(join(claudeHomeDir, "projects", "some-project", "old-session.jsonl"), OLD_MS);
		touch(join(claudeHomeDir, "accounts", "secret.json"), OLD_MS);
	});

	afterEach(() => {
		cleanup?.();
		cleanup = null;
	});

	it("counts only allowlisted, aged-out files as safe, and reports transcripts separately", async () => {
		const status = await getClaudeCacheStatus({ claudeHomeDir });
		expect(status.ok).toBe(true);
		expect(status.safeItemCount).toBe(4); // cache/old.json, paste-cache/old.txt, shell-snapshots/old.sh, file-history/.../old@v1
		expect(status.transcriptItemCount).toBe(1); // projects/.../old-session.jsonl
	});

	it("dryRun reports candidates without deleting anything", async () => {
		const result = await cleanClaudeCache({ claudeHomeDir, days: 7, includeTranscripts: false, dryRun: true });
		expect(result.ok).toBe(true);
		expect(result.cleaned).toHaveLength(4);
		expect(result.cleaned.every((item) => item.tier === "safe")).toBe(true);
		// files must still exist after a dry run
		expect(readdirSync(join(claudeHomeDir, "cache"))).toContain("old.json");
	});

	it("real run deletes only safe-tier aged-out files, leaves recent and protected files untouched", async () => {
		const result = await cleanClaudeCache({ claudeHomeDir, days: 7, includeTranscripts: false, dryRun: false });
		expect(result.ok).toBe(true);
		expect(result.cleaned).toHaveLength(4);
		expect(readdirSync(join(claudeHomeDir, "cache"))).not.toContain("old.json");
		expect(readdirSync(join(claudeHomeDir, "shell-snapshots"))).toEqual(["new.sh"]);
		expect(readdirSync(join(claudeHomeDir, "accounts"))).toContain("secret.json");
		expect(readdirSync(join(claudeHomeDir, "projects", "some-project"))).toContain("old-session.jsonl");
	});

	it("includeTranscripts also deletes aged-out session transcripts", async () => {
		const result = await cleanClaudeCache({ claudeHomeDir, days: 7, includeTranscripts: true, dryRun: false });
		expect(result.cleaned.some((item) => item.tier === "transcript")).toBe(true);
		expect(readdirSync(join(claudeHomeDir, "projects", "some-project"))).not.toContain("old-session.jsonl");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backends/runtime && npx vitest run test/runtime/workspace/claude-cache-cleanup.test.ts`
Expected: FAIL with a module-not-found error for `../../../src/workspace/claude-cache-cleanup`.

- [ ] **Step 3: Implement the module**

Create `backends/runtime/src/workspace/claude-cache-cleanup.ts`:

```typescript
import { readdir, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import type {
	RuntimeClaudeCacheCleanRequest,
	RuntimeClaudeCacheCleanResponse,
	RuntimeClaudeCacheStatusResponse,
} from "../core/api-contract";

const SAFE_TIER_SUBDIRS = ["cache", "paste-cache", "shell-snapshots", "file-history"] as const;
const DEFAULT_SAFE_AGE_DAYS = 7;

interface ScannedFile {
	path: string;
	sizeBytes: number;
	ageMs: number;
}

function resolveClaudeHomeDir(claudeHomeDir?: string): string {
	return claudeHomeDir ?? join(homedir(), ".claude");
}

async function walkFiles(rootDir: string): Promise<ScannedFile[]> {
	const results: ScannedFile[] = [];
	let entries: string[];
	try {
		entries = await readdir(rootDir, { recursive: true } as never);
	} catch {
		return results;
	}
	const now = Date.now();
	for (const entry of entries) {
		const fullPath = join(rootDir, entry);
		let fileStat: { isDirectory: () => boolean; size: number; mtimeMs: number };
		try {
			fileStat = await stat(fullPath);
		} catch {
			continue;
		}
		if (fileStat.isDirectory()) {
			continue;
		}
		results.push({ path: fullPath, sizeBytes: fileStat.size, ageMs: now - fileStat.mtimeMs });
	}
	return results;
}

async function scanSafeTier(claudeHomeDir: string): Promise<ScannedFile[]> {
	const all: ScannedFile[] = [];
	for (const subdir of SAFE_TIER_SUBDIRS) {
		all.push(...(await walkFiles(join(claudeHomeDir, subdir))));
	}
	return all;
}

async function scanTranscriptTier(claudeHomeDir: string): Promise<ScannedFile[]> {
	const projectsDir = join(claudeHomeDir, "projects");
	const files = await walkFiles(projectsDir);
	return files.filter((file) => file.path.endsWith(".jsonl"));
}

export async function getClaudeCacheStatus(options?: {
	claudeHomeDir?: string;
	days?: number;
}): Promise<RuntimeClaudeCacheStatusResponse> {
	try {
		const claudeHomeDir = resolveClaudeHomeDir(options?.claudeHomeDir);
		const ageCutoffMs = (options?.days ?? DEFAULT_SAFE_AGE_DAYS) * 24 * 60 * 60 * 1000;
		const safeFiles = (await scanSafeTier(claudeHomeDir)).filter((file) => file.ageMs > ageCutoffMs);
		const transcriptFiles = (await scanTranscriptTier(claudeHomeDir)).filter((file) => file.ageMs > ageCutoffMs);
		return {
			ok: true,
			safeItemCount: safeFiles.length,
			safeSizeBytes: safeFiles.reduce((sum, file) => sum + file.sizeBytes, 0),
			transcriptItemCount: transcriptFiles.length,
			transcriptSizeBytes: transcriptFiles.reduce((sum, file) => sum + file.sizeBytes, 0),
		};
	} catch (error) {
		return {
			ok: false,
			safeItemCount: 0,
			safeSizeBytes: 0,
			transcriptItemCount: 0,
			transcriptSizeBytes: 0,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

export async function cleanClaudeCache(
	options: RuntimeClaudeCacheCleanRequest & { claudeHomeDir?: string },
): Promise<RuntimeClaudeCacheCleanResponse> {
	try {
		const claudeHomeDir = resolveClaudeHomeDir(options.claudeHomeDir);
		const ageCutoffMs = (options.days ?? DEFAULT_SAFE_AGE_DAYS) * 24 * 60 * 60 * 1000;

		const candidates: { file: ScannedFile; tier: "safe" | "transcript" }[] = [];
		for (const file of await scanSafeTier(claudeHomeDir)) {
			if (file.ageMs > ageCutoffMs) {
				candidates.push({ file, tier: "safe" });
			}
		}
		if (options.includeTranscripts) {
			for (const file of await scanTranscriptTier(claudeHomeDir)) {
				if (file.ageMs > ageCutoffMs) {
					candidates.push({ file, tier: "transcript" });
				}
			}
		}

		const cleaned: { path: string; sizeBytes: number; tier: "safe" | "transcript" }[] = [];
		const skipped: { path: string; reason: string }[] = [];

		for (const candidate of candidates) {
			if (options.dryRun) {
				cleaned.push({ path: candidate.file.path, sizeBytes: candidate.file.sizeBytes, tier: candidate.tier });
				continue;
			}
			try {
				await rm(candidate.file.path, { force: true });
				cleaned.push({ path: candidate.file.path, sizeBytes: candidate.file.sizeBytes, tier: candidate.tier });
			} catch (error) {
				skipped.push({
					path: candidate.file.path,
					reason: error instanceof Error ? error.message : String(error),
				});
			}
		}

		return { ok: true, cleaned, skipped };
	} catch (error) {
		return { ok: false, cleaned: [], skipped: [], error: error instanceof Error ? error.message : String(error) };
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backends/runtime && npx vitest run test/runtime/workspace/claude-cache-cleanup.test.ts`
Expected: PASS (4 tests). If `readdir(..., { recursive: true })` type-errors on the installed Node types, cast is already applied (`as never`) — if vitest still fails at runtime because the Node version doesn't support the `recursive` option, replace `walkFiles` with an explicit recursive directory walker (readdir without `recursive`, recurse into subdirectories manually) — check `node --version` in this repo's `.nvmrc` or `package.json engines` field first and only do this fallback if `recursive: true` actually fails.

- [ ] **Step 5: Add zod schemas**

In `backends/runtime/src/core/api-contract.ts`, add near the worktree schemas from Task 1:

```typescript
export const runtimeClaudeCacheStatusResponseSchema = z.object({
	ok: z.boolean(),
	safeItemCount: z.number(),
	safeSizeBytes: z.number(),
	transcriptItemCount: z.number(),
	transcriptSizeBytes: z.number(),
	error: z.string().optional(),
});
export type RuntimeClaudeCacheStatusResponse = z.infer<typeof runtimeClaudeCacheStatusResponseSchema>;

export const runtimeClaudeCacheCleanRequestSchema = z.object({
	days: z.number().optional(),
	includeTranscripts: z.boolean(),
	dryRun: z.boolean(),
});
export type RuntimeClaudeCacheCleanRequest = z.infer<typeof runtimeClaudeCacheCleanRequestSchema>;

export const runtimeClaudeCacheCleanedItemSchema = z.object({
	path: z.string(),
	sizeBytes: z.number(),
	tier: z.enum(["safe", "transcript"]),
});
export type RuntimeClaudeCacheCleanedItem = z.infer<typeof runtimeClaudeCacheCleanedItemSchema>;

export const runtimeClaudeCacheSkippedItemSchema = z.object({
	path: z.string(),
	reason: z.string(),
});
export type RuntimeClaudeCacheSkippedItem = z.infer<typeof runtimeClaudeCacheSkippedItemSchema>;

export const runtimeClaudeCacheCleanResponseSchema = z.object({
	ok: z.boolean(),
	cleaned: z.array(runtimeClaudeCacheCleanedItemSchema),
	skipped: z.array(runtimeClaudeCacheSkippedItemSchema),
	error: z.string().optional(),
});
export type RuntimeClaudeCacheCleanResponse = z.infer<typeof runtimeClaudeCacheCleanResponseSchema>;
```

- [ ] **Step 6: Wire into `runtime-api.ts`**

In `backends/runtime/src/trpc/runtime-api.ts`:
1. Add to the imports near the top: `import { cleanClaudeCache, getClaudeCacheStatus } from "../workspace/claude-cache-cleanup";`
2. Add these two methods to the returned object, next to `getHostEnvironment`/`openFile` (around line 897):

```typescript
		getClaudeCacheStatus: async () => {
			return await getClaudeCacheStatus();
		},
		cleanClaudeCache: async (input) => {
			return await cleanClaudeCache(input);
		},
```

- [ ] **Step 7: Add to `runtimeApi` interface type and router in `app-router.ts`**

1. Add to the `runtimeApi` interface (near line 521, next to `openFile`):

```typescript
			getClaudeCacheStatus: () => Promise<RuntimeClaudeCacheStatusResponse>;
			cleanClaudeCache: (input: RuntimeClaudeCacheCleanRequest) => Promise<RuntimeClaudeCacheCleanResponse>;
```

2. Add the two new type names to the existing `import type { ... } from "../core/api-contract"` block at the top of the file.
3. Add to the `runtime: t.router({ ... })` block (near line 1017, right after `runUpdateNow`):

```typescript
		getClaudeCacheStatus: t.procedure.output(runtimeClaudeCacheStatusResponseSchema).query(async ({ ctx }) => {
			return await ctx.runtimeApi.getClaudeCacheStatus();
		}),
		cleanClaudeCache: t.procedure
			.input(runtimeClaudeCacheCleanRequestSchema)
			.output(runtimeClaudeCacheCleanResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.cleanClaudeCache(input);
			}),
```

4. Add `runtimeClaudeCacheStatusResponseSchema`, `runtimeClaudeCacheCleanRequestSchema`, `runtimeClaudeCacheCleanResponseSchema` to the schema import block at the top of the file (same block as Step 2 above, or a separate `import { ... } from "../core/api-contract"` value import if the file already separates type-only and value imports — check the existing import style at the top of `app-router.ts` and match it).

- [ ] **Step 8: Typecheck**

Run: `cd backends/runtime && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 9: Run the full workspace test directory**

Run: `cd backends/runtime && npx vitest run test/runtime/workspace/`
Expected: PASS (all files, including Task 1's and this task's new test file)

- [ ] **Step 10: Commit**

```bash
git add backends/runtime/src/workspace/claude-cache-cleanup.ts backends/runtime/src/core/api-contract.ts backends/runtime/src/trpc/runtime-api.ts backends/runtime/src/trpc/app-router.ts backends/runtime/test/runtime/workspace/claude-cache-cleanup.test.ts
git commit -m "feat(runtime): add claude cache cleanup module and tRPC endpoints"
```

---

### Task 3: Frontend client helpers

**Files:**
- Modify: `frontends/pixel_office/src/runtime/runtime-config-query.ts`

**Interfaces:**
- Consumes: `RuntimeClaudeCacheStatusResponse`, `RuntimeClaudeCacheCleanRequest`, `RuntimeClaudeCacheCleanResponse`, `RuntimeCleanMergedWorktreesRequest`, `RuntimeCleanMergedWorktreesResponse` — all from `../core/api-contract` re-exports (check how existing types like `RuntimeCleanMergedWorktreesResponse` are imported at the top of this file already; add the new names to that same import line/block, and check whether this file imports from `"../core/api-contract"` directly or from a frontend-local `@/runtime/types` re-export module — if the latter, add the new types there too, following whatever existing entries for `RuntimeCleanMergedWorktreesResponse` do).
- Produces:
  - `fetchClaudeCacheStatus(workspaceId: string | null): Promise<RuntimeClaudeCacheStatusResponse>`
  - `cleanClaudeCache(workspaceId: string | null, input: RuntimeClaudeCacheCleanRequest): Promise<RuntimeClaudeCacheCleanResponse>`
  - `cleanRuntimeMergedWorktrees(workspaceId: string | null, input?: RuntimeCleanMergedWorktreesRequest): Promise<RuntimeCleanMergedWorktreesResponse>` (modified signature — Task 4 calls this with `{ dryRun: true }` for preview and with no args for the real run)
  - These three functions are what Task 4's hook imports directly by name.

- [ ] **Step 1: Check the type import source**

Run: `grep -n "RuntimeCleanMergedWorktreesResponse" frontends/pixel_office/src/runtime/runtime-config-query.ts frontends/pixel_office/src/runtime/types.ts` to find exactly where this type is imported from in this file, so the new types are added in the same place with the same import style.

- [ ] **Step 2: Add the new types to whatever file Step 1 found** (either directly `import type { ... } from "../core/api-contract"` if that's the existing pattern in `runtime-config-query.ts`, or add re-exports to `frontends/pixel_office/src/runtime/types.ts` if that's the indirection layer — mirror exactly how `RuntimeCleanMergedWorktreesResponse` already gets from the backend into this file today).

- [ ] **Step 3: Update `cleanRuntimeMergedWorktrees` and add the two new functions**

In `frontends/pixel_office/src/runtime/runtime-config-query.ts`, change:

```typescript
export async function cleanRuntimeMergedWorktrees(
	workspaceId: string | null,
): Promise<RuntimeCleanMergedWorktreesResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.workspace.cleanMergedWorktrees.mutate();
}
```

to:

```typescript
export async function cleanRuntimeMergedWorktrees(
	workspaceId: string | null,
	input?: RuntimeCleanMergedWorktreesRequest,
): Promise<RuntimeCleanMergedWorktreesResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.workspace.cleanMergedWorktrees.mutate(input);
}
```

Then add, near `fetchRuntimeWorktrees`:

```typescript
export async function fetchClaudeCacheStatus(workspaceId: string | null): Promise<RuntimeClaudeCacheStatusResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.getClaudeCacheStatus.query();
}

export async function cleanClaudeCache(
	workspaceId: string | null,
	input: RuntimeClaudeCacheCleanRequest,
): Promise<RuntimeClaudeCacheCleanResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.cleanClaudeCache.mutate(input);
}
```

- [ ] **Step 4: Typecheck**

Run: `cd frontends/pixel_office && npx tsc --noEmit`
Expected: no errors. (No dedicated test for this file — it's exercised by Task 4's component test, matching this codebase's existing convention of not unit-testing these thin tRPC-client wrapper functions individually.)

- [ ] **Step 5: Commit**

```bash
git add frontends/pixel_office/src/runtime/runtime-config-query.ts frontends/pixel_office/src/runtime/types.ts
git commit -m "feat(pixel-office): add claude cache client helpers, worktree dryRun param"
```

(drop `types.ts` from the `git add` if Step 2 didn't touch it)

---

### Task 4: `useCleanupTools` hook + `CleanupDialog` component

**Files:**
- Create: `frontends/pixel_office/src/hooks/use-cleanup-tools.ts`
- Create: `frontends/pixel_office/src/components/cleanup-dialog.tsx`
- Test: `frontends/pixel_office/src/components/cleanup-dialog.test.tsx`

**Interfaces:**
- Consumes: `fetchClaudeCacheStatus`, `cleanClaudeCache`, `cleanRuntimeMergedWorktrees` from `@/runtime/runtime-config-query` (Task 3); `fetchRuntimeWorktrees` already exists for context but is NOT used here (worktree preview comes from `cleanRuntimeMergedWorktrees({ dryRun: true })`, per Task 1); `notifyError` and `showAppToast`/`toast` for feedback (check `@/components/app-toaster` exports, mirror `use-debug-tools.ts`'s `notifyError` usage and find the success-toast equivalent, e.g. `notifySuccess` or `toast.success` — grep the codebase: `grep -rn "notifySuccess\|toast.success" frontends/pixel_office/src/components/app-toaster.tsx` to find the exact exported name before writing this step).
- Produces:
  - `useCleanupTools(params: { workspaceId: string | null }): { isCleanupDialogOpen: boolean; handleOpenCleanupDialog: () => void; handleCleanupDialogOpenChange: (next: boolean) => void }` — the hook owns only the open/closed state; `CleanupDialog` owns everything else (status fetching, checkboxes, preview, confirm) internally since those only matter while the dialog is mounted. This mirrors `use-debug-tools.ts` (which itself only owns open state + one boolean flag) — the difference here is `CleanupDialog` is more self-sufficient because it has no dependency on parent-level runtime config state the way `DebugDialog` does.
  - `CleanupDialog(props: { open: boolean; onOpenChange: (next: boolean) => void; workspaceId: string | null }): ReactElement`
  - These two exported names (`useCleanupTools`, `CleanupDialog`) are what Task 5 (`App.tsx` wiring) imports.

- [ ] **Step 1: Find the toast helper names**

Run: `grep -n "^export" frontends/pixel_office/src/components/app-toaster.tsx`

Note the exact success-notification export name for use in Step 3 below (referred to as `notifySuccess` in this plan — replace with whatever the grep shows, e.g. it might just be `showAppToast` used directly with a variant argument).

- [ ] **Step 2: Write the failing component test**

Create `frontends/pixel_office/src/components/cleanup-dialog.test.tsx`:

```tsx
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CleanupDialog } from "@/components/cleanup-dialog";
import { TooltipProvider } from "@/components/ui/tooltip";

const mockGetClaudeCacheStatus = vi.fn();
const mockCleanClaudeCache = vi.fn();
const mockCleanMergedWorktrees = vi.fn();

vi.mock("@/runtime/trpc-client", () => ({
	getRuntimeTrpcClient: () => ({
		runtime: {
			getClaudeCacheStatus: { query: mockGetClaudeCacheStatus },
			cleanClaudeCache: { mutate: mockCleanClaudeCache },
		},
		workspace: {
			cleanMergedWorktrees: { mutate: mockCleanMergedWorktrees },
		},
	}),
}));

function flush() {
	return act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
}

describe("CleanupDialog", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		mockGetClaudeCacheStatus.mockReset().mockResolvedValue({
			ok: true,
			safeItemCount: 12,
			safeSizeBytes: 2048,
			transcriptItemCount: 3,
			transcriptSizeBytes: 4096,
		});
		mockCleanClaudeCache.mockReset();
		mockCleanMergedWorktrees.mockReset().mockResolvedValue({ ok: true, cleanedTaskIds: [], skipped: [] });
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
	});

	it("disables the transcripts checkbox until the Claude row is checked, and Preview until something is checked", async () => {
		await act(async () => {
			root.render(
				<TooltipProvider>
					<CleanupDialog open={true} onOpenChange={() => {}} workspaceId={null} />
				</TooltipProvider>,
			);
		});
		await flush();

		const transcriptsCheckbox = container.querySelector('[data-testid="cleanup-transcripts-checkbox"]');
		const previewButton = container.querySelector('[data-testid="cleanup-preview-button"]');
		expect(transcriptsCheckbox?.getAttribute("data-disabled")).toBeTruthy();
		expect((previewButton as HTMLButtonElement)?.disabled).toBe(true);

		const claudeCheckbox = container.querySelector('[data-testid="cleanup-claude-checkbox"]') as HTMLElement;
		await act(async () => {
			claudeCheckbox.click();
		});
		await flush();

		expect((previewButton as HTMLButtonElement)?.disabled).toBe(false);
	});

	it("runs dry-run preview then confirm, calling clean only for checked categories", async () => {
		mockCleanClaudeCache.mockResolvedValue({
			ok: true,
			cleaned: [{ path: "/home/x/.claude/cache/old.json", sizeBytes: 100, tier: "safe" }],
			skipped: [],
		});

		await act(async () => {
			root.render(
				<TooltipProvider>
					<CleanupDialog open={true} onOpenChange={() => {}} workspaceId={null} />
				</TooltipProvider>,
			);
		});
		await flush();
		mockCleanMergedWorktrees.mockClear(); // dialog-open already called this once for the worktree count

		const claudeCheckbox = container.querySelector('[data-testid="cleanup-claude-checkbox"]') as HTMLElement;
		await act(async () => {
			claudeCheckbox.click();
		});
		await flush();

		const previewButton = container.querySelector('[data-testid="cleanup-preview-button"]') as HTMLButtonElement;
		await act(async () => {
			previewButton.click();
		});
		await flush();

		expect(mockCleanClaudeCache).toHaveBeenCalledWith(
			expect.objectContaining({ dryRun: true, includeTranscripts: false }),
		);
		expect(mockCleanMergedWorktrees).not.toHaveBeenCalled(); // worktrees checkbox was never checked, so Preview must not touch it

		const confirmButton = container.querySelector('[data-testid="cleanup-confirm-button"]') as HTMLButtonElement;
		await act(async () => {
			confirmButton.click();
		});
		await flush();

		expect(mockCleanClaudeCache).toHaveBeenCalledWith(
			expect.objectContaining({ dryRun: false, includeTranscripts: false }),
		);
	});
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontends/pixel_office && npx vitest run src/components/cleanup-dialog.test.tsx`
Expected: FAIL — `@/components/cleanup-dialog` does not exist yet.

- [ ] **Step 4: Implement `useCleanupTools`**

Create `frontends/pixel_office/src/hooks/use-cleanup-tools.ts`:

```typescript
import { useCallback, useState } from "react";

interface UseCleanupToolsResult {
	isCleanupDialogOpen: boolean;
	handleOpenCleanupDialog: () => void;
	handleCleanupDialogOpenChange: (nextOpen: boolean) => void;
}

export function useCleanupTools(): UseCleanupToolsResult {
	const [isCleanupDialogOpen, setIsCleanupDialogOpen] = useState(false);

	const handleOpenCleanupDialog = useCallback(() => {
		setIsCleanupDialogOpen(true);
	}, []);

	const handleCleanupDialogOpenChange = useCallback((nextOpen: boolean) => {
		setIsCleanupDialogOpen(nextOpen);
	}, []);

	return { isCleanupDialogOpen, handleOpenCleanupDialog, handleCleanupDialogOpenChange };
}
```

- [ ] **Step 5: Implement `CleanupDialog`**

Create `frontends/pixel_office/src/components/cleanup-dialog.tsx`. Before writing the JSX, re-check `@/components/ui/dialog` (`Dialog`, `DialogHeader`, `DialogBody`, `DialogFooter`) and `@/components/ui/button` (`Button` variants) exports to match exact prop names used elsewhere (e.g. `debug-dialog.tsx` from earlier). Use `RadixCheckbox` exactly as shown in `task-create-dialog.tsx` (`import * as RadixCheckbox from "@radix-ui/react-checkbox"`).

```tsx
import * as RadixCheckbox from "@radix-ui/react-checkbox";
import { Check, Trash2 } from "lucide-react";
import { type ReactElement, useCallback, useState } from "react";

import { notifyError } from "@/components/app-toaster"; // add the success-toast import found in Task 4 Step 1
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import {
	cleanClaudeCache,
	cleanRuntimeMergedWorktrees,
	fetchClaudeCacheStatus,
} from "@/runtime/runtime-config-query";
import type { RuntimeClaudeCacheCleanResponse, RuntimeCleanMergedWorktreesResponse } from "@/runtime/types";

const SAFE_AGE_DAYS = 7;

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function CleanupDialog({
	open,
	onOpenChange,
	workspaceId,
}: {
	open: boolean;
	onOpenChange: (nextOpen: boolean) => void;
	workspaceId: string | null;
}): ReactElement {
	const [claudeChecked, setClaudeChecked] = useState(false);
	const [includeTranscripts, setIncludeTranscripts] = useState(false);
	const [worktreesChecked, setWorktreesChecked] = useState(false);
	const [claudeStatus, setClaudeStatus] = useState<{ safeItemCount: number; safeSizeBytes: number } | null>(null);
	const [worktreeCount, setWorktreeCount] = useState<number | null>(null);
	const [isBusy, setIsBusy] = useState(false);
	const [claudePreview, setClaudePreview] = useState<RuntimeClaudeCacheCleanResponse | null>(null);
	const [worktreePreview, setWorktreePreview] = useState<RuntimeCleanMergedWorktreesResponse | null>(null);

	const loadStatus = useCallback(() => {
		void (async () => {
			try {
				const [status, worktreeDryRun] = await Promise.all([
					fetchClaudeCacheStatus(workspaceId),
					cleanRuntimeMergedWorktrees(workspaceId, { dryRun: true }),
				]);
				setClaudeStatus(status);
				setWorktreeCount(worktreeDryRun.cleanedTaskIds.length);
			} catch (error) {
				notifyError(error instanceof Error ? error.message : String(error));
			}
		})();
	}, [workspaceId]);

	const handleOpenChange = useCallback(
		(nextOpen: boolean) => {
			onOpenChange(nextOpen);
			if (nextOpen) {
				setClaudePreview(null);
				setWorktreePreview(null);
				loadStatus();
			}
		},
		[onOpenChange, loadStatus],
	);

	const canPreview = claudeChecked || worktreesChecked;

	const handlePreview = useCallback(() => {
		void (async () => {
			setIsBusy(true);
			try {
				if (claudeChecked) {
					setClaudePreview(
						await cleanClaudeCache(workspaceId, { days: SAFE_AGE_DAYS, includeTranscripts, dryRun: true }),
					);
				}
				if (worktreesChecked) {
					setWorktreePreview(await cleanRuntimeMergedWorktrees(workspaceId, { dryRun: true }));
				}
			} catch (error) {
				notifyError(error instanceof Error ? error.message : String(error));
			} finally {
				setIsBusy(false);
			}
		})();
	}, [claudeChecked, worktreesChecked, includeTranscripts, workspaceId]);

	const handleConfirm = useCallback(() => {
		void (async () => {
			setIsBusy(true);
			try {
				if (claudeChecked) {
					await cleanClaudeCache(workspaceId, { days: SAFE_AGE_DAYS, includeTranscripts, dryRun: false });
				}
				if (worktreesChecked) {
					await cleanRuntimeMergedWorktrees(workspaceId);
				}
				setClaudePreview(null);
				setWorktreePreview(null);
				setClaudeChecked(false);
				setWorktreesChecked(false);
				setIncludeTranscripts(false);
				loadStatus();
			} catch (error) {
				notifyError(error instanceof Error ? error.message : String(error));
			} finally {
				setIsBusy(false);
			}
		})();
	}, [claudeChecked, worktreesChecked, includeTranscripts, workspaceId, loadStatus]);

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogHeader title="Cleanup" icon={<Trash2 size={16} />} />
			<DialogBody className="space-y-4">
				<label className="flex items-center gap-2 text-[13px] text-text-primary cursor-pointer select-none">
					<RadixCheckbox.Root
						data-testid="cleanup-claude-checkbox"
						checked={claudeChecked}
						onCheckedChange={(checked) => setClaudeChecked(checked === true)}
						className="flex h-3.5 w-3.5 items-center justify-center rounded-sm border border-border-bright bg-surface-3 data-[state=checked]:bg-accent data-[state=checked]:border-accent"
					>
						<RadixCheckbox.Indicator>
							<Check size={10} className="text-white" />
						</RadixCheckbox.Indicator>
					</RadixCheckbox.Root>
					Claude cache & logs
					{claudeStatus ? (
						<span className="text-text-secondary">
							({claudeStatus.safeItemCount} items, {formatBytes(claudeStatus.safeSizeBytes)})
						</span>
					) : null}
				</label>
				<label className="ml-6 flex items-center gap-2 text-[12px] text-text-secondary cursor-pointer select-none data-[disabled]:opacity-40 data-[disabled]:cursor-default">
					<RadixCheckbox.Root
						data-testid="cleanup-transcripts-checkbox"
						checked={includeTranscripts}
						disabled={!claudeChecked}
						data-disabled={!claudeChecked ? "" : undefined}
						onCheckedChange={(checked) => setIncludeTranscripts(checked === true)}
						className="flex h-3.5 w-3.5 items-center justify-center rounded-sm border border-border-bright bg-surface-3 data-[state=checked]:bg-accent data-[state=checked]:border-accent disabled:cursor-default disabled:opacity-40"
					>
						<RadixCheckbox.Indicator>
							<Check size={10} className="text-white" />
						</RadixCheckbox.Indicator>
					</RadixCheckbox.Root>
					Include session transcripts
				</label>
				<label className="flex items-center gap-2 text-[13px] text-text-primary cursor-pointer select-none">
					<RadixCheckbox.Root
						data-testid="cleanup-worktrees-checkbox"
						checked={worktreesChecked}
						onCheckedChange={(checked) => setWorktreesChecked(checked === true)}
						className="flex h-3.5 w-3.5 items-center justify-center rounded-sm border border-border-bright bg-surface-3 data-[state=checked]:bg-accent data-[state=checked]:border-accent"
					>
						<RadixCheckbox.Indicator>
							<Check size={10} className="text-white" />
						</RadixCheckbox.Indicator>
					</RadixCheckbox.Root>
					Merged runtime worktrees
					{worktreeCount !== null ? <span className="text-text-secondary">({worktreeCount} worktrees)</span> : null}
				</label>

				{claudePreview ? (
					<div className="rounded-md border border-border bg-surface-2 p-3 text-xs text-text-secondary">
						<p>Claude cache: {claudePreview.cleaned.length} item(s) would be removed.</p>
					</div>
				) : null}
				{worktreePreview ? (
					<div className="rounded-md border border-border bg-surface-2 p-3 text-xs text-text-secondary">
						<p>Worktrees: {worktreePreview.cleanedTaskIds.length} would be removed.</p>
					</div>
				) : null}
			</DialogBody>
			<DialogFooter>
				<Button variant="default" onClick={() => handleOpenChange(false)} disabled={isBusy}>
					Close
				</Button>
				<Button
					data-testid="cleanup-preview-button"
					variant="default"
					disabled={!canPreview || isBusy}
					icon={isBusy ? <Spinner size={12} /> : undefined}
					onClick={handlePreview}
				>
					Preview
				</Button>
				<Button
					data-testid="cleanup-confirm-button"
					variant="danger"
					disabled={!canPreview || isBusy}
					icon={isBusy ? <Spinner size={12} /> : undefined}
					onClick={handleConfirm}
				>
					Confirm delete
				</Button>
			</DialogFooter>
		</Dialog>
	);
}
```

If `RuntimeClaudeCacheCleanResponse`/`RuntimeCleanMergedWorktreesResponse` aren't available from `@/runtime/types` (Task 3 may have added them directly to `runtime-config-query.ts` instead), adjust the import source accordingly to wherever Task 3 actually put them.

- [ ] **Step 6: Run test to verify it passes**

Run: `cd frontends/pixel_office && npx vitest run src/components/cleanup-dialog.test.tsx`
Expected: PASS (2 tests). If the `data-disabled` assertion in the first test doesn't match Radix's actual disabled-state DOM attribute, inspect the rendered output (`console.log(transcriptsCheckbox?.outerHTML)` temporarily) and adjust the test assertion to whatever attribute Radix actually sets (likely `data-disabled=""` or `disabled=""` — Radix Checkbox sets `disabled` as a real DOM attribute on the underlying button when `disabled` prop is true, so the test may need `transcriptsCheckbox?.hasAttribute("disabled")` instead — verify against actual output rather than assuming).

- [ ] **Step 7: Typecheck**

Run: `cd frontends/pixel_office && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add frontends/pixel_office/src/hooks/use-cleanup-tools.ts frontends/pixel_office/src/components/cleanup-dialog.tsx frontends/pixel_office/src/components/cleanup-dialog.test.tsx
git commit -m "feat(pixel-office): add Cleanup dialog with Claude cache and worktree preview/confirm"
```

---

### Task 5: Wire the `Cleanup` button into `TopBar` and `App.tsx`

**Files:**
- Modify: `frontends/pixel_office/src/components/top-bar.tsx` (add prop + button near line 851-869 desktop block, and near line 918-931 mobile block)
- Modify: `frontends/pixel_office/src/components/top-bar.test.tsx` (add one assertion)
- Modify: `frontends/pixel_office/src/App.tsx` (wire hook, pass prop, render dialog)

**Interfaces:**
- Consumes: `useCleanupTools`, `CleanupDialog` from Task 4.
- Produces: nothing new consumed by later tasks — this is the last task.

- [ ] **Step 1: Add the failing assertion to `top-bar.test.tsx`**

In `frontends/pixel_office/src/components/top-bar.test.tsx`, add a new test using the existing `findButtonByText` helper (or an `aria-label` query, matching whichever selector style the file already uses for the Office button):

```tsx
it("renders the Cleanup button when onOpenCleanup is provided", async () => {
	const onOpenCleanup = vi.fn();

	await act(async () => {
		root.render(
			<TopBar
				openTargetOptions={[]}
				selectedOpenTargetId="vscode"
				onSelectOpenTarget={() => {}}
				openPlatformOverride="auto"
				onSelectOpenPlatform={() => {}}
				detectedOpenPlatform={null}
				onOpenWorkspace={() => {}}
				canOpenWorkspace={false}
				isOpeningWorkspace={false}
				shortcuts={[]}
				onOpenCleanup={onOpenCleanup}
			/>,
		);
	});

	const cleanupButton = container.querySelector('[aria-label="Cleanup"]') as HTMLButtonElement | null;
	expect(cleanupButton).not.toBeNull();

	await act(async () => {
		cleanupButton?.click();
	});
	expect(onOpenCleanup).toHaveBeenCalledTimes(1);
});
```

Check the full list of `TopBar` required props first (`grep -n "^\tonOpenWorkspace\|^\tselectedOpenTargetId" frontends/pixel_office/src/components/top-bar.tsx` and read the props type block) — the render call above copies the minimal set from the existing test at the top of the file; add any other props that TypeScript reports as missing/required when this test is typechecked.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontends/pixel_office && npx vitest run src/components/top-bar.test.tsx`
Expected: FAIL — `onOpenCleanup` prop doesn't exist / no button found.

- [ ] **Step 3: Add the prop and button to `TopBar`**

In `frontends/pixel_office/src/components/top-bar.tsx`:

1. Add `Trash2` to the `lucide-react` import at the top of the file (alongside `Building2`, `Bug`, etc.).
2. Add to the props destructuring (near line 467, alongside `showDebugButton`, `onOpenDebugDialog`): `onOpenCleanup,`
3. Add to the props type block (near line 514-515): `onOpenCleanup?: () => void;`
4. Add the button in the desktop block, right after the Office `Tooltip`/`Button` closes (after line 869, before the Terminal toggle block):

```tsx
{onOpenCleanup ? (
	<Tooltip side="bottom" content="Clean up Claude cache and runtime worktrees">
		<Button
			variant="ghost"
			size="sm"
			icon={<Trash2 size={16} />}
			onClick={onOpenCleanup}
			aria-label="Cleanup"
			className="ml-2"
		/>
	</Tooltip>
) : null}
```

5. Add the mobile equivalent in the mobile block (near line 918-931, right after the Office mobile button):

```tsx
{onOpenCleanup ? (
	<Button
		variant="ghost"
		size="sm"
		icon={<Trash2 size={16} />}
		onClick={onOpenCleanup}
		aria-label="Cleanup"
		className={MOBILE_TOUCH_TARGET}
	/>
) : null}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontends/pixel_office && npx vitest run src/components/top-bar.test.tsx`
Expected: PASS (all tests in the file, including the new one).

- [ ] **Step 5: Wire into `App.tsx`**

In `frontends/pixel_office/src/App.tsx`:
1. Add imports: `import { CleanupDialog } from "@/components/cleanup-dialog";` and `import { useCleanupTools } from "@/hooks/use-cleanup-tools";`
2. Call the hook near where `useDebugTools` is called (near line 237-243): `const { isCleanupDialogOpen, handleOpenCleanupDialog, handleCleanupDialogOpenChange } = useCleanupTools();`
3. Pass the prop into the `<TopBar ... />` render (near line 1187, alongside `showDebugButton`/`onOpenDebugDialog` around line 1268-1270): `onOpenCleanup={handleOpenCleanupDialog}`
4. Render the dialog near `<DebugDialog ... />` (near line 1671-1673): find the `workspaceId` variable already in scope in `App.tsx` (it's used elsewhere for other runtime calls — grep `workspaceId` in this file to find the right variable name) and render:

```tsx
<CleanupDialog
	open={isCleanupDialogOpen}
	onOpenChange={handleCleanupDialogOpenChange}
	workspaceId={workspaceId}
/>
```

- [ ] **Step 6: Typecheck**

Run: `cd frontends/pixel_office && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Run the full frontend test suite**

Run: `cd frontends/pixel_office && npx vitest run`
Expected: PASS (no regressions).

- [ ] **Step 8: Manual verification**

Start the dev server per this repo's usual run flow (check for a project `run` skill or `README`/`package.json` `dev` script), open the app, click the new Cleanup icon next to Office, confirm the modal opens, check a box, click Preview, confirm the preview text renders, click Confirm delete, confirm the modal shows updated counts and doesn't error. Take note of anything visually off (icon spacing, tooltip position) and fix inline before considering this task done.

- [ ] **Step 9: Commit**

```bash
git add frontends/pixel_office/src/components/top-bar.tsx frontends/pixel_office/src/components/top-bar.test.tsx frontends/pixel_office/src/App.tsx
git commit -m "feat(pixel-office): add Cleanup button to top bar"
```
