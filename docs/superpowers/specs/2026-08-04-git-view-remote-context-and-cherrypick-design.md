# Git view: remote branch context menu + commit cherry-pick — Design

Date: 2026-08-04  
Status: approved for implementation planning  
Scope: PixelOffice Git History view (`GitRefsPanel` + `GitCommitListPanel`); home worktree HEAD as cherry-pick target

## Problem

1. **Remote refs** in the left refs panel have no right-click handler. Local branches already open a context menu; remotes only support select.
2. **Commits** in the history list have no context menu. Users cannot cherry-pick a commit onto the current branch from the Git view.

## Goals

- Right-click a **remote** ref → **Checkout** and **Create branch from…** only.
- Right-click any **commit** → single action **Cherry pick to current** (onto main worktree HEAD).
- Reuse existing checkout / create-branch / `cherryPickCommit` runtime paths (Approach 1 — wire into existing panels).

## Non-goals

- Merge / Rebase / Delete on remote refs.
- Extra commit menu items (Copy SHA, Checkout commit, etc.).
- Confirm dialog before cherry-pick.
- Cherry-pick onto the *selected* ref (must be HEAD, not selected panel ref).
- Auto-resolving cherry-pick conflicts (runtime already aborts on failure).
- Agents/Glass Cursor IDE menus (this is in-app PixelOffice UI only).

## Decisions (from brainstorming)

| Topic | Choice |
|-------|--------|
| Remote menu scope | Checkout + Create branch from only |
| Cherry-pick target | Main worktree HEAD branch |
| Commit menu | One item: Cherry pick to current |
| Implementation | Extend existing panels / menus; no new shared menu framework |

## UI design

### Remote refs (`git-refs-panel.tsx`)

Today local rows call `openBranchContextMenu`; remote rows under **Remotes** do not.

Change:

- Attach `onContextMenu` on remote `RefRow` when checkout and/or create-branch callbacks exist.
- Open the same `BranchContextMenu`, but pass **only**:
  - `onCheckout` → `onCheckoutRef(remoteName)` (e.g. `origin/feature`)
  - `onCreateFrom` → existing “New branch” dialog with remote as start point
- Do **not** pass `onMergeIntoCurrent`, `onRebaseCurrentOnto`, or `onDelete` for remotes.
- Optional: double-click remote → checkout (parity with local rows) if checkout handler exists.

Labels stay as today (`Switch to branch`, create-from wording). Header shows the remote ref name.

### Commits (`git-commit-list-panel.tsx`)

- Add a fixed-position context menu (same backdrop / styling pattern as `BranchContextMenu`).
- Right-click commit row → one menuitem: **Cherry pick to current** (or `Cherry pick onto <headBranch>` when HEAD name is known).
- Hide/disable the menu (or the action) when HEAD is detached or `currentBranch` is unavailable.
- No confirm dialog; close menu on click; invoke parent callback with `commit.hash`.

### Wiring (`git-history-view.tsx` → `App.tsx` / `use-git-actions.ts`)

- New optional prop: `onCherryPickCommit?: (commitHash: string) => void` (and optional `headBranchName` for label).
- `App` home Git History path wires a new `cherryPickOntoHomeHead(commitHash)` (name flexible) that:
  1. Reads `homeGitSummary.currentBranch` as `targetBranch`
  2. Calls `workspace.cherryPickCommit` with `{ commitHash, targetBranch }`
  3. Toasts success/failure; refreshes git history / summary on success

## API / runtime

`workspace.cherryPickCommit` already runs `git cherry-pick` in the worktree checked out to `targetBranch` and aborts on conflict.

Today `runtimeGitCherryPickRequestSchema` requires `taskId` + `baseRef`, but `workspace-api.cherryPickCommit` **does not use them** — only `commitHash` + `targetBranch`.

**Required contract tweak:** make `taskId` and `baseRef` optional (same pattern as `pushGitBranch`), so the home Git view can cherry-pick without inventing a fake task id.

No change to `runGitCherryPickAction` behavior.

Checkout of remotes already goes through `checkoutGitBranch` / `switch --track` for `origin/…` style names — no new checkout API.

## Error handling

| Case | UX |
|------|----|
| Cherry-pick conflicts / failure | Toast with runtime `error`; worktree left clean (abort) |
| No HEAD / detached | Do not offer cherry-pick (or no-op with warning toast) |
| Target branch not in a worktree | Runtime error toast (existing message) |
| Create/checkout remote failures | Existing toast paths from `switchHomeBranch` / `createHomeBranch` |

## Testing

- `git-refs-panel.test.tsx`: right-click remote opens menu with Checkout + Create from; **no** Delete / Merge / Rebase.
- `git-commit-list-panel` (or history view) tests: right-click commit opens single cherry-pick item; callback receives hash; no menu when HEAD unavailable (if covered).
- Keep existing local-branch context menu regressions green.
- Optional: unit/contract test that cherry-pick request accepts omitted `taskId`/`baseRef`.

## Out of scope follow-ups

- Delete remote branch from UI
- Cherry-pick onto arbitrary selected branch
- Multi-commit cherry-pick range
