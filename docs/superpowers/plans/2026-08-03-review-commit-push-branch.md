# Review Commit / Branch Name / Push Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix light-theme Open-target icons and replace Review-card Open PR with a compact Commit split menu plus on-card branch form that drives agent commit (settings Git Commit Prompt) and runtime cherry-pick/push.

**Architecture:** Pure helpers decide branch path (new / onto / cherry-pick). `buildTaskGitActionPrompt` accepts an optional `taskBranchOverride`. Review card UI expands an inline form (not chat). Runtime adds cherry-pick and task-scoped push APIs modeled on `mergeTaskBranch`. `use-git-actions` kicks the agent commit, polls HEAD, then runs follow-on git ops with Retry state on the card.

**Tech Stack:** React + Vitest (frontend), tRPC + Zod api-contract + `runGit` (runtime), Radix DropdownMenu/Popover (existing UI).

**Spec:** `docs/superpowers/specs/2026-08-03-review-commit-push-branch-design.md`

## Global Constraints

- Review-column task cards only; top-bar Commit / Create PR unchanged.
- Agent commit must keep using settings **Git Commit Prompt** / defaults; only `{{task_branch}}` changes.
- Push and cherry-pick run in **runtime**, never via agent prompt / `gh pr create` on this path.
- Branch name is entered **on the card**, not in the chat session.
- No force-push; abort cherry-pick on conflict; surface toast + Retry.
- Do not edit `package.json` files; do not add AI commit trailers.
- Prefer focused new modules over growing `board-card.tsx` / `use-git-actions.ts` unboundedly.

## File map

| File | Responsibility |
|------|----------------|
| `frontends/pixel_office/src/hooks/use-theme.ts` | Export `isLightUiTheme(themeId)` from `THEMES` group (do not trust terminal `isLightBackground`, currently false for light themes) |
| `frontends/pixel_office/src/components/open-workspace-button.tsx` | Theme-aware OpenTargetIcon filter |
| `frontends/pixel_office/src/git-actions/build-task-git-action-prompt.ts` | Optional `taskBranchOverride` for `{{task_branch}}` |
| `frontends/pixel_office/src/git-actions/review-commit-branch.ts` | Pure helpers: normalize name, match refs, resolve commit path + push branch |
| `frontends/pixel_office/src/components/board-card-review-git-actions.tsx` | Compact Commit split + on-card expand form |
| `frontends/pixel_office/src/components/board-card.tsx` | Swap Open PR row for new component; pass props |
| `backends/runtime/src/core/api-contract.ts` | Zod schemas for cherry-pick + push-branch |
| `backends/runtime/src/workspace/git-sync.ts` | `runGitCherryPickAction`, `runGitPushBranchAction` |
| `backends/runtime/src/trpc/workspace-api.ts` + `app-router.ts` | Wire mutations (find target worktree like `mergeTaskBranch`) |
| `frontends/pixel_office/src/hooks/use-git-actions.ts` | Orchestrate agent commit + poll + cherry-pick/push + retry maps |
| Wiring: `board-column.tsx`, `kanban-board.tsx`, `App.tsx` (and detail panels only if they still render the old Open PR card buttons) | Pass new handlers / drop `onOpenPr` from **card** surface only |

---

### Task 1: Theme helper + Open-target icon contrast

**Files:**
- Modify: `frontends/pixel_office/src/hooks/use-theme.ts`
- Modify: `frontends/pixel_office/src/components/open-workspace-button.tsx`
- Create: `frontends/pixel_office/src/hooks/use-theme-light.test.ts`
- Create: `frontends/pixel_office/src/components/open-workspace-button.test.tsx` (only if no existing test file)

**Interfaces:**
- Produces: `export function isLightUiTheme(themeId: ThemeId): boolean` — true when `THEMES` entry `group === "light"` OR `themeId === "high-contrast-light"`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { isLightUiTheme } from "@/hooks/use-theme";

describe("isLightUiTheme", () => {
	it("marks light and high-contrast-light themes as light UI", () => {
		expect(isLightUiTheme("light")).toBe(true);
		expect(isLightUiTheme("overcast")).toBe(true);
		expect(isLightUiTheme("high-contrast-light")).toBe(true);
		expect(isLightUiTheme("default")).toBe(false);
		expect(isLightUiTheme("high-contrast-dark")).toBe(false);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontends/pixel_office && pnpm exec vitest run src/hooks/use-theme-light.test.ts`

Expected: FAIL (export missing)

- [ ] **Step 3: Implement `isLightUiTheme`**

```ts
export function isLightUiTheme(themeId: ThemeId): boolean {
	if (themeId === "high-contrast-light") {
		return true;
	}
	const theme = THEMES.find((entry) => entry.id === themeId);
	return theme?.group === "light";
}
```

- [ ] **Step 4: Update `OpenTargetIcon`**

In `open-workspace-button.tsx`, use `useTheme` + `isLightUiTheme`:

```tsx
function OpenTargetIcon({ option }: { option: OpenTargetOption }): React.ReactElement {
	const { themeId } = useTheme();
	const light = isLightUiTheme(themeId);
	return (
		<img
			src={option.iconSrc}
			alt=""
			aria-hidden
			style={{
				width: 14,
				height: 14,
				display: "block",
				objectFit: "contain",
				filter: light ? "none" : "brightness(0) invert(1)",
				opacity: 0.9,
			}}
		/>
	);
}
```

- [ ] **Step 5: Re-run tests**

Run: `cd frontends/pixel_office && pnpm exec vitest run src/hooks/use-theme-light.test.ts`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add frontends/pixel_office/src/hooks/use-theme.ts frontends/pixel_office/src/hooks/use-theme-light.test.ts frontends/pixel_office/src/components/open-workspace-button.tsx
git commit -m "fix(ui): make Open-target icons readable on light themes"
```

---

### Task 2: Prompt `taskBranchOverride`

**Files:**
- Modify: `frontends/pixel_office/src/git-actions/build-task-git-action-prompt.ts`
- Modify: `frontends/pixel_office/src/git-actions/build-task-git-action-prompt.test.ts`

**Interfaces:**
- Produces: extend `BuildTaskGitActionPromptInput` with optional `taskBranchOverride?: string`. When non-empty after trim, use it for `{{task_branch}}` instead of `deriveTaskBranchName(taskId)`.

- [ ] **Step 1: Write the failing test**

```ts
it("uses taskBranchOverride for {{task_branch}} when provided", () => {
	expect(
		buildTaskGitActionPrompt({
			action: "commit",
			workspaceInfo: {
				taskId: "task-123",
				path: "/tmp/task-123",
				exists: true,
				baseRef: "main",
				branch: null,
				isDetached: true,
				headCommit: "abc123",
			},
			taskBranchOverride: "feature/official",
			templates: {
				commitPromptTemplate: "Branch={{task_branch}}",
			},
		}),
	).toBe("Branch=feature/official");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontends/pixel_office && pnpm exec vitest run src/git-actions/build-task-git-action-prompt.test.ts`

Expected: FAIL (override ignored)

- [ ] **Step 3: Implement override**

```ts
interface BuildTaskGitActionPromptInput {
	action: TaskGitAction;
	workspaceInfo: RuntimeTaskWorkspaceInfoResponse;
	templates?: TaskGitPromptTemplates | null;
	agentDisplayName?: string;
	taskBranchOverride?: string;
}

export function buildTaskGitActionPrompt(input: BuildTaskGitActionPromptInput): string {
	const override = input.taskBranchOverride?.trim();
	const taskBranch = override && override.length > 0
		? override
		: deriveTaskBranchName(input.workspaceInfo.taskId);
	const variables: Record<string, string> = {
		[TASK_GIT_BASE_REF_PROMPT_VARIABLE.key]: input.workspaceInfo.baseRef,
		[TASK_GIT_TASK_BRANCH_PROMPT_VARIABLE.key]: taskBranch,
		// ... unchanged seam variables
	};
	// ... rest unchanged
}
```

- [ ] **Step 4: Run tests**

Run: `cd frontends/pixel_office && pnpm exec vitest run src/git-actions/build-task-git-action-prompt.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontends/pixel_office/src/git-actions/build-task-git-action-prompt.ts frontends/pixel_office/src/git-actions/build-task-git-action-prompt.test.ts
git commit -m "feat(git): allow taskBranchOverride in commit prompt interpolation"
```

---

### Task 3: Pure branch-path helpers

**Files:**
- Create: `frontends/pixel_office/src/git-actions/review-commit-branch.ts`
- Create: `frontends/pixel_office/src/git-actions/review-commit-branch.test.ts`

**Interfaces:**
- Produces:

```ts
export type ReviewCommitExistingMode = "onto-branch" | "cherry-pick-from-task";

export type ReviewCommitResolvedPath =
	| { kind: "new-branch"; officialBranch: string; promptTaskBranch: string; pushBranch: string; needsCherryPick: false }
	| { kind: "onto-existing"; officialBranch: string; promptTaskBranch: string; pushBranch: string; needsCherryPick: false }
	| { kind: "cherry-pick"; officialBranch: string; promptTaskBranch: string; pushBranch: string; needsCherryPick: true };

export function normalizeOfficialBranchName(value: string): string;
export function branchExistsInRefNames(officialBranch: string, refNames: readonly string[]): boolean;
export function resolveReviewCommitPath(input: {
	officialBranch: string;
	derivedTaskBranch: string;
	refNames: readonly string[];
	existingMode: ReviewCommitExistingMode | null;
}): ReviewCommitResolvedPath | { error: string };
```

Rules:
- `normalizeOfficialBranchName` = trim; reject empty.
- Existence = exact match against local branch short names in `refNames` (caller strips `refs/heads/`).
- If not exists → `new-branch` with `promptTaskBranch = officialBranch`, `needsCherryPick: false`.
- If exists and `existingMode === "onto-branch"` → `onto-existing`, `promptTaskBranch = officialBranch`.
- If exists and `existingMode === "cherry-pick-from-task"` → `cherry-pick`, `promptTaskBranch = derivedTaskBranch`, `pushBranch = officialBranch`, `needsCherryPick: true`.
- If exists and `existingMode === null` → `{ error: "Choose how to use the existing branch." }`.

- [ ] **Step 1: Write failing tests** covering new branch, onto-existing, cherry-pick, missing mode, empty name.

- [ ] **Step 2: Run tests — expect FAIL**

Run: `cd frontends/pixel_office && pnpm exec vitest run src/git-actions/review-commit-branch.test.ts`

- [ ] **Step 3: Implement helpers**

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add frontends/pixel_office/src/git-actions/review-commit-branch.ts frontends/pixel_office/src/git-actions/review-commit-branch.test.ts
git commit -m "feat(git): add review-commit branch path helpers"
```

---

### Task 4: Runtime cherry-pick + push-branch APIs

**Files:**
- Modify: `backends/runtime/src/core/api-contract.ts`
- Modify: `backends/runtime/src/workspace/git-sync.ts`
- Modify: `backends/runtime/src/core/api-validation.ts` (parse helpers if that pattern is used)
- Modify: `backends/runtime/src/trpc/workspace-api.ts`
- Modify: `backends/runtime/src/trpc/app-router.ts`
- Modify: `backends/runtime/test/runtime/trpc/workspace-api-git.test.ts`
- Create or extend: unit tests under `backends/runtime/test/runtime/` for `runGitCherryPickAction` / `runGitPushBranchAction` (follow existing git-sync test style if present; otherwise cover via workspace-api mocks)

**Interfaces:**
- Produces schemas:

```ts
export const runtimeGitCherryPickRequestSchema = z.object({
	taskId: z.string(),
	baseRef: z.string(),
	commitHash: z.string().min(7),
	targetBranch: z.string().min(1),
});

export const runtimeGitCherryPickResponseSchema = z.object({
	ok: z.boolean(),
	commitHash: z.string(),
	targetBranch: z.string(),
	summary: runtimeGitSyncSummarySchema,
	output: z.string(),
	error: z.string().optional(),
});

export const runtimeGitPushBranchRequestSchema = z.object({
	taskId: z.string().optional(),
	baseRef: z.string().optional(),
	branch: z.string().min(1),
});

export const runtimeGitPushBranchResponseSchema = z.object({
	ok: z.boolean(),
	branch: z.string(),
	summary: runtimeGitSyncSummarySchema,
	output: z.string(),
	error: z.string().optional(),
});
```

- `runGitCherryPickAction({ cwd, commitHash, targetBranch })`:
  - Require `currentBranch === targetBranch` in `cwd` (same guard style as merge).
  - `git cherry-pick <commitHash>`.
  - On failure: `git cherry-pick --abort`, return `ok: false` with error (no force).

- `runGitPushBranchAction({ cwd, branch })`:
  - Ensure branch is checked out or push ref explicitly: prefer `git push -u origin <branch>` when no upstream; else `git push`.
  - Return sync-style response.

- `workspaceApi.cherryPickCommit`: resolve target worktree via `listGitWorktrees` where `entry.branch === targetBranch` (same pattern as `mergeTaskBranch`). If missing, error asking to check out `targetBranch` in a worktree.

- `workspaceApi.pushGitBranch`:
  - If `taskId`+`baseRef` provided and the branch is the task worktree’s current branch, push from task cwd (`resolveTaskCwd`).
  - Else find worktree with `branch` checked out (inventory); push from that path.
  - Do not use home-only `runGitSyncAction` for task pushes.

- Wire tRPC: `workspace.cherryPickCommit`, `workspace.pushGitBranch`.

- [ ] **Step 1: Add failing workspace-api tests** that assert the new methods call the new git-sync functions with expected cwd/args (mirror `mergeTaskBranch` test patterns; add mocks for the new git-sync exports).

- [ ] **Step 2: Run — expect FAIL**

Run: `cd backends/runtime && pnpm exec vitest run test/runtime/trpc/workspace-api-git.test.ts`

- [ ] **Step 3: Implement schemas + git-sync + workspace-api + router**

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add backends/runtime/src/core/api-contract.ts backends/runtime/src/core/api-validation.ts backends/runtime/src/workspace/git-sync.ts backends/runtime/src/trpc/workspace-api.ts backends/runtime/src/trpc/app-router.ts backends/runtime/test/runtime/trpc/workspace-api-git.test.ts
git commit -m "feat(runtime): add cherry-pick and push-branch workspace APIs"
```

---

### Task 5: Review card UI — compact Commit split + on-card form

**Files:**
- Create: `frontends/pixel_office/src/components/board-card-review-git-actions.tsx`
- Create: `frontends/pixel_office/src/components/board-card-review-git-actions.test.tsx`
- Modify: `frontends/pixel_office/src/components/board-card.tsx`
- Modify: `frontends/pixel_office/src/components/board-card.test.tsx`

**Interfaces:**
- Produces component props:

```tsx
export type ReviewGitFormMode = "commit-with-branch" | "commit-and-push";

export function BoardCardReviewGitActions(props: {
	disabled: boolean;
	isCommitLoading: boolean;
	statusMessage?: string | null;
	canRetryFollowOn?: boolean;
	baseRefHint: string;
	branchSuggestions: readonly string[];
	onCommit: () => void;
	onSubmitBranched: (input: {
		mode: ReviewGitFormMode;
		officialBranch: string;
		existingMode: ReviewCommitExistingMode | null;
	}) => void;
	onCancelForm: () => void;
	onRetryFollowOn?: () => void;
}): React.ReactElement;
```

UI behavior:
- Default: split button — primary **Commit** calls `onCommit`; chevron dropdown (Radix DropdownMenu, same patterns as `task-create-dialog.tsx`) with **Commit with branch name…** and **Commit and push…**.
- Selecting a menu item expands inline form on the card: text input (placeholder/hint `baseRefHint`), filtered suggestion buttons from `branchSuggestions`, and if typed name exists in suggestions show two radios/buttons for existing modes.
- **Go** disabled when name empty, or when name exists and no existing mode, or `disabled`/`isCommitLoading`.
- **Cancel** collapses form via `onCancelForm`.
- Show `statusMessage` when set; show **Retry** when `canRetryFollowOn`.
- Remove the **Open PR** button from `board-card.tsx` review actions row; keep **Merge to base** as today.

- [ ] **Step 1: Write component tests**

Assert:
- Renders Commit, no “Open PR”.
- Opening menu and choosing “Commit with branch name…” shows input.
- Go disabled until name entered; for existing suggestion requires mode.
- Cancel hides form.
- Go calls `onSubmitBranched` with expected payload.

- [ ] **Step 2: Run — expect FAIL**

Run: `cd frontends/pixel_office && pnpm exec vitest run src/components/board-card-review-git-actions.test.tsx`

- [ ] **Step 3: Implement component + swap into `board-card.tsx`**

Replace the Commit/Open PR button pair (`showReviewGitActions` block ~lines 950–980) with:

```tsx
<BoardCardReviewGitActions
	disabled={isAnyGitActionLoading}
	isCommitLoading={isCommitLoading}
	statusMessage={reviewGitStatusMessage}
	canRetryFollowOn={Boolean(onRetryReviewGitFollowOn)}
	baseRefHint={card.baseRef}
	branchSuggestions={branchSuggestions ?? []}
	onCommit={() => onCommit?.(card.id)}
	onSubmitBranched={(input) => onSubmitReviewGit?.(card.id, input)}
	onCancelForm={() => onCancelReviewGitForm?.(card.id)}
	onRetryFollowOn={() => onRetryReviewGitFollowOn?.(card.id)}
/>
```

Add the new optional props to `BoardCard` and thread them from `board-column.tsx` (tests can pass no-ops / undefined initially and still compile once optional).

- [ ] **Step 4: Update `board-card.test.tsx`** — if any test looked for Open PR on review cards, switch expectations to Commit / menu.

- [ ] **Step 5: Run tests — expect PASS**

Run: `cd frontends/pixel_office && pnpm exec vitest run src/components/board-card-review-git-actions.test.tsx src/components/board-card.test.tsx`

- [ ] **Step 6: Commit**

```bash
git add frontends/pixel_office/src/components/board-card-review-git-actions.tsx frontends/pixel_office/src/components/board-card-review-git-actions.test.tsx frontends/pixel_office/src/components/board-card.tsx frontends/pixel_office/src/components/board-card.test.tsx frontends/pixel_office/src/components/board-column.tsx
git commit -m "feat(ui): compact review Commit menu with on-card branch form"
```

---

### Task 6: `use-git-actions` orchestration + App wiring

**Files:**
- Modify: `frontends/pixel_office/src/hooks/use-git-actions.ts`
- Modify: `frontends/pixel_office/src/hooks/use-git-actions.test.tsx`
- Modify: `frontends/pixel_office/src/components/kanban-board.tsx`
- Modify: `frontends/pixel_office/src/App.tsx`
- Modify detail/column wiring files that pass `onOpenPr` **into BoardCard** (`board-column.tsx`, `column-context-panel.tsx` if applicable) — remove card Open PR wiring only; leave chat-panel Open PR alone (non-goal).

**Interfaces:**
- Extend `runTaskGitAction` / commit entry points to accept optional:

```ts
type ReviewCommitFollowOn = {
	officialBranch: string;
	promptTaskBranch: string;
	needsCherryPick: boolean;
	pushAfter: boolean;
};

// handleCommitTask(taskId) — unchanged mental model (derived C, no follow-on)
// handleReviewCommitWithBranch(taskId, { mode, officialBranch, existingMode })
```

Flow for `handleReviewCommitWithBranch`:
1. `resolveReviewCommitPath` using `deriveTaskBranchName(taskId)` + refs list (fetch `getGitRefs` with task scope; on failure use `[]` and allow free typing).
2. On resolve error → toast, return.
3. Snapshot `headCommit` before kickoff.
4. Call existing agent commit path with `buildTaskGitActionPrompt({ ..., taskBranchOverride: path.promptTaskBranch, action: "commit" })` (never `"pr"`).
5. Set per-task follow-on state: `{ baselineHead, path, pushAfter: mode === "commit-and-push", phase: "waiting-commit" }` and expose `reviewGitStatusById[taskId] = "Waiting for commit…"`.
6. Poll workspace snapshot (reuse existing snapshot store / refresh) until `headCommit` changes or timeout (~120s). On timeout → status + `canRetryFollowOn`.
7. If `needsCherryPick`: call `trpc.workspace.cherryPickCommit.mutate({ taskId, baseRef, commitHash: newHead, targetBranch: officialBranch })`. On failure → toast, Retry keeps follow-on without re-prompting agent.
8. If `pushAfter`: call `trpc.workspace.pushGitBranch.mutate({ taskId, baseRef, branch: path.pushBranch })`. On failure → toast + Retry.
9. Success → clear follow-on, success toast.
10. `retryReviewGitFollowOn(taskId)` resumes from cherry-pick/push using stored `commitHash` / flags without sending a new agent prompt.

Also keep `handleOpenPrTask` exported for chat/detail panels (non-goal to remove), but **board card** must not call it.

- [ ] **Step 1: Write/extend `use-git-actions.test.tsx`**

Cover:
- Branched commit calls prompt builder with override (mock send path).
- Commit-and-push eventually calls `pushGitBranch`.
- Cherry-pick path calls `cherryPickCommit` after head advances.
- Retry after failed push does not re-send agent input.

- [ ] **Step 2: Run — expect FAIL**

Run: `cd frontends/pixel_office && pnpm exec vitest run src/hooks/use-git-actions.test.tsx`

- [ ] **Step 3: Implement orchestration + wire App → board → column → card**

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add frontends/pixel_office/src/hooks/use-git-actions.ts frontends/pixel_office/src/hooks/use-git-actions.test.tsx frontends/pixel_office/src/App.tsx frontends/pixel_office/src/components/kanban-board.tsx frontends/pixel_office/src/components/board-column.tsx frontends/pixel_office/src/components/detail-panels/column-context-panel.tsx
git commit -m "feat(git): orchestrate review commit, cherry-pick, and runtime push"
```

---

### Task 7: Verification sweep

**Files:** none new — run suites touched by this feature.

- [ ] **Step 1: Frontend targeted tests**

Run:

```bash
cd frontends/pixel_office && pnpm exec vitest run src/hooks/use-theme-light.test.ts src/git-actions/build-task-git-action-prompt.test.ts src/git-actions/review-commit-branch.test.ts src/components/board-card-review-git-actions.test.tsx src/components/board-card.test.tsx src/hooks/use-git-actions.test.tsx src/components/top-bar.test.tsx
```

Expected: PASS (top-bar still has Create PR — unchanged)

- [ ] **Step 2: Runtime git API tests**

Run:

```bash
cd backends/runtime && pnpm exec vitest run test/runtime/trpc/workspace-api-git.test.ts
```

Expected: PASS

- [ ] **Step 3: Manual smoke checklist** (document in commit message body if useful; do not skip)

1. Light theme: Open VS Code/Cursor icons visible on navbar.
2. Review card: Commit one-click still sends settings commit prompt with derived `kanban/task-…`.
3. Commit with branch name → on-card input; existing branch shows two modes.
4. Commit and push → after agent commit, runtime push (no PR dialog).
5. Cherry-pick conflict → toast + Retry; Merge to base still works.

- [ ] **Step 4: Final commit only if verification fixed stragglers**; otherwise done.

---

## Spec coverage self-check

| Spec requirement | Task |
|------------------|------|
| Light-theme Open icons | Task 1 |
| Commit keeps Git Commit Prompt | Tasks 2, 6 |
| Compact Commit + ▾ menu | Task 5 |
| On-card branch input (not chat) | Task 5 |
| New / onto / cherry-pick paths | Tasks 3, 6 |
| Replace Open PR with Commit and push | Tasks 5–6 |
| Runtime push / cherry-pick | Task 4 |
| Waiting + Retry | Task 6 |
| Top-bar / auto-review `pr` unchanged | Task 6–7 (explicit non-touch) |
| Merge to base unchanged | Task 5 |

## Placeholder / consistency check

- No TBD steps.
- `taskBranchOverride`, `ReviewCommitResolvedPath`, `cherryPickCommit`, `pushGitBranch`, and `BoardCardReviewGitActions` names are consistent across tasks.
- Chat-panel Open PR intentionally left in place (spec non-goal).
