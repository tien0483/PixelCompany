# Git view remote context + cherry-pick Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable right-click on remote refs (Checkout + Create branch from) and right-click on commits (Cherry pick onto main-worktree HEAD) in PixelOffice Git History.

**Architecture:** Extend existing `BranchContextMenu` / refs panel for remotes with a `kind: "local" | "remote"` menu state so remote menus omit Merge/Rebase/Delete. Add a one-item commit context menu in `GitCommitListPanel`, wire `onCherryPickCommit` through `GitHistoryView` → `App` → new `cherryPickOntoHomeHead` in `use-git-actions`. Make `taskId`/`baseRef` optional on `runtimeGitCherryPickRequestSchema` so home cherry-pick needs no fake task id.

**Tech Stack:** React + Vitest (frontend), Zod api-contract + tRPC workspace API (runtime), existing toast + git refresh patterns.

**Spec:** `docs/superpowers/specs/2026-08-04-git-view-remote-context-and-cherrypick-design.md`

## Global Constraints

- Remote menu: **Checkout** + **Create branch from** only (no Merge / Rebase / Delete).
- Cherry-pick target: main worktree **HEAD** branch only (not selected ref).
- Commit menu: one item — Cherry pick to current (optional HEAD name in label).
- No confirm dialog before cherry-pick.
- Reuse existing checkout / create-branch / `cherryPickCommit` paths.
- Do not edit `package.json`; no AI commit trailers.
- Do not commit unless the user explicitly asks.

## File map

| File | Responsibility |
|------|----------------|
| `backends/runtime/src/core/api-contract.ts` | Make `taskId` / `baseRef` optional on cherry-pick request |
| `backends/runtime/test/runtime/trpc/workspace-api-git.test.ts` | Cover cherry-pick without taskId/baseRef |
| `frontends/pixel_office/src/components/git-history/git-refs-panel.tsx` | Remote row context menu (checkout + create from) |
| `frontends/pixel_office/src/components/git-history/git-refs-panel.test.tsx` | Remote menu tests |
| `frontends/pixel_office/src/components/git-history/git-commit-list-panel.tsx` | Commit context menu + cherry-pick callback |
| `frontends/pixel_office/src/components/git-history/git-commit-list-panel.test.tsx` | Create or extend commit menu tests |
| `frontends/pixel_office/src/components/git-history-view.tsx` | Pass cherry-pick + head branch props |
| `frontends/pixel_office/src/hooks/use-git-actions.ts` | `cherryPickOntoHomeHead` |
| `frontends/pixel_office/src/App.tsx` | Wire handler into home `GitHistoryView` |

---

### Task 1: Optional taskId/baseRef on cherry-pick API

**Files:**
- Modify: `backends/runtime/src/core/api-contract.ts` (`runtimeGitCherryPickRequestSchema`)
- Modify: `backends/runtime/test/runtime/trpc/workspace-api-git.test.ts`

**Interfaces:**
- Produces: `RuntimeGitCherryPickRequest` with optional `taskId?: string` and `baseRef?: string`; required `commitHash` and `targetBranch` unchanged.

- [ ] **Step 1: Write failing test** — add under `describe("workspaceApi.cherryPickCommit")`:

```ts
it("accepts cherry-pick without taskId or baseRef (home git view)", async () => {
	worktreeInventoryMocks.listGitWorktrees.mockResolvedValue({
		ok: true,
		worktrees: [{ path: "/repo", branch: "main" }],
	});
	gitSyncMocks.runGitCherryPickAction.mockResolvedValue({
		ok: true,
		commitHash: "abcdef1234567",
		targetBranch: "main",
		summary: SUMMARY,
		output: "",
	});
	const { api, broadcast } = makeApi();

	const res = await api.cherryPickCommit(SCOPE, {
		commitHash: "abcdef1234567",
		targetBranch: "main",
	});

	expect(gitSyncMocks.runGitCherryPickAction).toHaveBeenCalledWith({
		cwd: "/repo",
		commitHash: "abcdef1234567",
		targetBranch: "main",
	});
	expect(broadcast).toHaveBeenCalledWith("ws-1", "/repo");
	expect(res.ok).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `backends/runtime`):
`pnpm exec vitest run test/runtime/trpc/workspace-api-git.test.ts -t "accepts cherry-pick without"`
Expected: FAIL (Zod validation / parse rejects missing taskId).

- [ ] **Step 3: Minimal schema change**

In `api-contract.ts`, change:

```ts
export const runtimeGitCherryPickRequestSchema = z.object({
	taskId: z.string().optional(),
	baseRef: z.string().optional(),
	commitHash: z.string().min(7),
	targetBranch: z.string().min(1),
});
```

No `workspace-api.ts` logic change required (it already ignores taskId/baseRef).

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm exec vitest run test/runtime/trpc/workspace-api-git.test.ts -t "cherryPickCommit"`
Expected: PASS (old + new cases).

- [ ] **Step 5: Commit** — skip unless user asks.

---

### Task 2: Remote branch context menu in GitRefsPanel

**Files:**
- Modify: `frontends/pixel_office/src/components/git-history/git-refs-panel.tsx`
- Modify: `frontends/pixel_office/src/components/git-history/git-refs-panel.test.tsx`

**Interfaces:**
- Consumes: existing `onCheckoutRef`, `onCreateBranch`
- Produces: remote rows open menu with Switch + New branch from only

- [ ] **Step 1: Write failing tests** in `git-refs-panel.test.tsx`:

```ts
const REMOTE_REF: RuntimeGitRef = {
	name: "origin/feature/login",
	type: "remote",
	hash: "cccc",
	isHead: false,
};

it("opens a checkout/create-only context menu when right-clicking a remote ref", () => {
	act(() => {
		renderUi(
			<GitRefsPanel
				refs={[HEAD_BRANCH, REMOTE_REF]}
				selectedRefName="master"
				isLoading={false}
				panelWidth={240}
				workingCopyChanges={null}
				onSelectRef={() => undefined}
				onCheckoutRef={() => undefined}
				onDeleteRef={() => undefined}
				onCreateBranch={() => undefined}
				onMergeIntoCurrent={() => undefined}
				onRebaseCurrentOnto={() => undefined}
			/>,
		);
	});

	rightClick(findBranchRow("origin/feature/login"));

	const labels = menuItemLabels();
	expect(labels.some((label) => label.includes("Switch to branch"))).toBe(true);
	expect(labels.some((label) => label.includes("New branch from"))).toBe(true);
	expect(labels.some((label) => label.includes("Delete branch"))).toBe(false);
	expect(labels.some((label) => label.includes("Merge into Current"))).toBe(false);
	expect(labels.some((label) => label.includes("Rebase Current onto Selected"))).toBe(false);
});

it("invokes onCheckoutRef with the remote name when switching from a remote", () => {
	const onCheckoutRef = vi.fn();
	act(() => {
		renderUi(
			<GitRefsPanel
				refs={[HEAD_BRANCH, REMOTE_REF]}
				selectedRefName="master"
				isLoading={false}
				panelWidth={240}
				workingCopyChanges={null}
				onSelectRef={() => undefined}
				onCheckoutRef={onCheckoutRef}
				onCreateBranch={() => undefined}
			/>,
		);
	});

	rightClick(findBranchRow("origin/feature/login"));
	clickMenuItem("Switch to branch");
	expect(onCheckoutRef).toHaveBeenCalledWith("origin/feature/login");
});
```

- [ ] **Step 2: Run tests — expect FAIL** (no remote context menu)

Run (from `frontends/pixel_office`):
`pnpm exec vitest run src/components/git-history/git-refs-panel.test.tsx -t "remote"`

- [ ] **Step 3: Implement**

1. Change context menu state to include kind:

```ts
const [contextMenu, setContextMenu] = useState<{
	branch: string;
	x: number;
	y: number;
	kind: "local" | "remote";
} | null>(null);
```

2. Update opener:

```ts
const openBranchContextMenu = (
	branch: string,
	event: React.MouseEvent,
	kind: "local" | "remote",
): void => {
	event.preventDefault();
	event.stopPropagation();
	setContextMenu({ branch, x: event.clientX, y: event.clientY, kind });
};
```

3. `hasRemoteContextActions = Boolean(onCheckoutRef || onCreateBranch)`

4. On remote `RefRow`, add:

```tsx
onContextMenu={
	hasRemoteContextActions
		? (event) => openBranchContextMenu(ref.name, event, "remote")
		: undefined
}
onDoubleClick={onCheckoutRef ? () => onCheckoutRef(ref.name) : undefined}
```

5. Pass `kind: "local"` from existing local/HEAD openers.

6. When rendering `BranchContextMenu`, if `contextMenu.kind === "remote"`:
   - pass `onCheckout` / `onCreateFrom` only
   - do **not** pass merge, rebase, or delete

- [ ] **Step 4: Run tests — expect PASS**

`pnpm exec vitest run src/components/git-history/git-refs-panel.test.tsx`

- [ ] **Step 5: Commit** — skip unless user asks.

---

### Task 3: Commit list cherry-pick context menu

**Files:**
- Modify: `frontends/pixel_office/src/components/git-history/git-commit-list-panel.tsx`
- Create or modify: `frontends/pixel_office/src/components/git-history/git-commit-list-panel.test.tsx`

**Interfaces:**
- Consumes: `onCherryPickCommit?: (commitHash: string) => void`, `headBranchName?: string | null`
- Produces: right-click fires `onCherryPickCommit(hash)` when HEAD is available

- [ ] **Step 1: Write failing tests**

Use a complete `RuntimeGitCommit` fixture matching `@/runtime/types` / api-contract fields.

```ts
it("opens cherry-pick menu on right-click when HEAD is available", () => {
	const onCherryPickCommit = vi.fn();
	// render GitCommitListPanel with headBranchName="main" and onCherryPickCommit
	// right-click .kb-git-commit-row
	// expect menuitem containing "Cherry pick"
	// click it; expect onCherryPickCommit(COMMIT.hash)
});

it("does not open cherry-pick menu when HEAD is unavailable", () => {
	// headBranchName={null} even if onCherryPickCommit is provided
	// right-click; expect no [role=menu]
});
```

Mirror React root setup from `git-refs-panel.test.tsx`.

- [ ] **Step 2: Run — expect FAIL**

`pnpm exec vitest run src/components/git-history/git-commit-list-panel.test.tsx`

- [ ] **Step 3: Implement in `git-commit-list-panel.tsx`**

Add props `headBranchName?: string | null` and `onCherryPickCommit?: (commitHash: string) => void`.

Context menu state: `{ commitHash, x, y } | null`. Close on Escape / outside click (same pattern as refs panel).

On commit row, when `onCherryPickCommit && headBranchName`, handle `onContextMenu`.

Menu label: `Cherry pick onto ${headBranchName}`. Reuse `kb-branch-context-menu` classes.

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit** — skip unless user asks.

---

### Task 4: Wire cherry-pick through GitHistoryView, use-git-actions, App

**Files:**
- Modify: `frontends/pixel_office/src/components/git-history-view.tsx`
- Modify: `frontends/pixel_office/src/hooks/use-git-actions.ts`
- Modify: `frontends/pixel_office/src/App.tsx`

**Interfaces:**
- Consumes: Task 1 optional API fields; Task 3 panel props
- Produces: `cherryPickOntoHomeHead(commitHash: string) => Promise<void>` from `useGitActions`

- [ ] **Step 1: Extend `GitHistoryViewProps`** with `onCherryPickCommit?: (commitHash: string) => void`.

Pass to `GitCommitListPanel`:

```tsx
headBranchName={gitHistory.refs.find((r) => r.isHead && r.type === "branch")?.name ?? null}
onCherryPickCommit={onCherryPickCommit}
```

- [ ] **Step 2: Add `cherryPickOntoHomeHead` in `use-git-actions.ts`**

Call `workspace.cherryPickCommit.mutate({ commitHash, targetBranch: homeGitSummary.currentBranch })` without taskId/baseRef. Toast success/failure; on success update summary + `refreshGitHistory()`. Match existing toast `intent`/`icon` conventions in this file. Export on the hook return object.

- [ ] **Step 3: Wire in `App.tsx`** on the home `GitHistoryView` that already has checkout/create handlers:

```tsx
onCherryPickCommit={(commitHash) => {
	void cherryPickOntoHomeHead(commitHash);
}}
```

Leave the read-only `GitHistoryView` instance (if any) without the handler.

- [ ] **Step 4: Smoke-run**

```
pnpm exec vitest run src/components/git-history/git-refs-panel.test.tsx src/components/git-history/git-commit-list-panel.test.tsx
```

- [ ] **Step 5: Commit** — skip unless user asks.

---

## Spec coverage check

| Spec requirement | Task |
|------------------|------|
| Remote Checkout + Create from | Task 2 |
| No remote Merge/Rebase/Delete | Task 2 tests |
| Commit cherry-pick onto HEAD | Tasks 3–4 |
| Optional taskId/baseRef | Task 1 |
| Toast + refresh on success/fail | Task 4 |
| No confirm dialog | Task 3 |
| Detached/unavailable HEAD hides action | Task 3 |
