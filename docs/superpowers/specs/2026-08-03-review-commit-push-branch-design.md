# Review card Commit / Commit and push / branch name — Design

Date: 2026-08-03  
Status: approved for implementation planning  
Scope: Review-column task cards + Open-target icon contrast; top-bar git actions unchanged

## Problem

1. **Open in VS Code / Cursor icons** use `filter: brightness(0) invert(1)`, so they stay white and wash out on light themes.
2. PixelOffice creates a **task worktree (B)** with an **arbitrary task branch (C)** (`kanban/task-…`) from a chosen **base branch (A)**. Plain Commit / “Open PR” do not match how humans name and publish work.
3. Agent rules forbid reliable AI-driven **push** / **PR create**. Push must run via the **runtime** in the correct environment.
4. Review cards are **narrow**; three full text buttons do not fit. Branch names must be entered **on the card**, not inside each chat session.

## Goals

- Fix Open-target icon contrast for light and dark themes.
- Keep one-click **Commit** on task branch **C** using the settings **Git Commit Prompt**.
- Add **Commit with branch name** and **Commit and push** with on-card branch input.
- Agent performs commit (prompt-driven); runtime performs **cherry-pick** (when chosen) and **push**.
- Replace Review card **Open PR** with **Commit and push** (no `gh pr create` on this path).

## Non-goals

- Top-bar Commit / Create PR dialogs.
- Renaming auto-review `pr` mode / Open PR automation.
- Changing default commit prompt copy beyond feeding `{{task_branch}}` from the card.
- Force-push, rewriting remote history, or resolving cherry-pick conflicts automatically.

## Naming map

| Concept | Meaning |
|---------|---------|
| **A** | Task base (`{{base_ref}}`) — branch chosen when creating the task |
| **B** | Task worktree path |
| **C** | Derived task branch (`{{task_branch}}`, typically `kanban/task-<id>`) |
| **D** | Official branch name typed on the card |

## UI design

### Open-target icons

File: `frontends/pixel_office/src/components/open-workspace-button.tsx`

- Stop always applying white invert.
- Use theme light/dark (`isLightBackground` / equivalent): dark themes keep current inverted glyph; light themes use natural or dark glyph so icons remain visible on the Open button and in the dropdown.

### Review card chrome (compact)

File: `frontends/pixel_office/src/components/board-card.tsx` (and related wiring)

Default row (collapsed):

| Control | Presentation | Behavior |
|---------|--------------|----------|
| **Commit** | Primary text (or split primary) | Agent + Git Commit Prompt; `{{task_branch}}` = **C** |
| **▾** | Chevron on Commit | Menu: **Commit with branch name…**, **Commit and push…** |
| **Merge to base** | Keep existing control (may stay icon/short if space requires) | Unchanged |

**Open PR** button is removed from this card surface and replaced by the Commit-and-push menu path.

### On-card expand (not chat, not a large modal)

When the user chooses **Commit with branch name…** or **Commit and push…**, expand an inline strip on the **same card**:

1. Branch name input (required). Suggest matches from `getGitRefs` for the task workspace; hint default toward **A** / `base_ref`.
2. If **D** already exists locally (or clearly matches a ref): two choices —
   - **Commit onto that branch** — agent prompt with `{{task_branch}}` = **D**
   - **Commit on task branch, then cherry-pick** — agent prompt with `{{task_branch}}` = **C**; after new commit on **C**, runtime cherry-picks onto **D**
3. If **D** is new: agent prompt with `{{task_branch}}` = **D** (no cherry-pick step).
4. **Go** / **Cancel**. Go disabled while the name is empty or an action is in flight.

Submitting does **not** require typing the branch inside the chat session. The session may keep running; the card sends the commit prompt into the existing agent session (same mechanism as today’s Commit).

## Orchestration

### Agent commit (all commit paths)

- Continue using `buildTaskGitActionPrompt` / settings **Git Commit Prompt** (and defaults).
- Only the interpolated `{{task_branch}}` (and thus prompt steps) change based on the card choice (**C** or **D**).
- Do not instruct the agent to push or open a PR on the Commit-and-push path.

### Runtime follow-ons

| Path | After agent commit kickoff |
|------|----------------------------|
| Plain Commit / onto **D** / new **D** | No cherry-pick |
| On **C**, then cherry-pick onto **D** | When worktree **C** gains a new commit, cherry-pick that commit onto **D** in the worktree that has **D** checked out (often home if **D** = **A**). On conflict: toast, stop, expose **Retry** on the card. No force. |
| Commit and push | After the commit (and cherry-pick if any) succeeds for the branch to publish (**C** or **D**), call existing `runGitSyncAction({ action: "push" })` (or equivalent scoped to that workspace/branch). Prefer `git push -u origin <branch>` when upstream is missing; otherwise surface a clear error toast. |

### Timing

Agent commit is asynchronous. For cherry-pick/push that depend on a new commit:

- Poll task workspace snapshot until HEAD advances (or commit appears on **C**), with a timeout.
- Show card status such as “Waiting for commit…”.
- On timeout or failure, leave **Retry** for cherry-pick/push without re-sending the agent prompt unless the user commits again.

## Architecture / components

| Unit | Responsibility |
|------|----------------|
| `OpenTargetIcon` | Theme-aware icon filter |
| Review card git strip | Compact Commit split + expand form state |
| Branch form controller (hook or small module) | Validate name, ref suggestions, path selection (new / onto / cherry-pick), push flag |
| `use-git-actions` (extend) | Kick agent commit with overridden task branch; schedule runtime cherry-pick/push; loading maps |
| Runtime cherry-pick API (new if missing) | Cherry-pick commit onto target branch in correct cwd; return conflict/error |
| Existing `runGitSyncAction` push | Publish branch from correct worktree |

## Error handling

- Empty **D**: Go disabled.
- Unknown refs / fetch failure for suggestions: allow free typing; suggestions best-effort.
- Cherry-pick conflict: toast with git message; card Retry; do not leave the user without status.
- Push failure: toast; card Retry push without re-prompting commit if commit already landed.
- Duplicate Go while in flight: ignored / disabled.

## Testing

- OpenTargetIcon / open-workspace-button: light vs dark theme filter behavior.
- Board card: Commit still calls existing commit path; Open PR control gone; menu opens on-card form.
- Form: new name vs existing name shows correct choices; Cancel clears expand state.
- Git actions: prompt receives overridden `{{task_branch}}`; push called for commit-and-push; cherry-pick called only for that path; conflicts and push errors surfaced.
- Regression: Merge to base still works; top-bar PR/commit unchanged.

## Open decisions (resolved)

- Surface: Review cards only.
- Commit: agent + settings Git Commit Prompt.
- Push: runtime API (not agent, not manual terminal paste).
- Existing branch: user picks onto-branch vs commit-on-C-then-cherry-pick.
- Commit and push: same on-card branch flow, then runtime push.
- Layout: compact split + on-card expand (not three full-width text buttons; not chat input for branch name).
