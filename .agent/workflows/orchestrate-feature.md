# /orchestrate-feature — Orchestrate Parallel Feature Branches

Coordinates an agent feature team across a dynamic, concurrent branch model.
The goal: AI agents do split work on small branches in worktrees, but the user runs only the overall integration branch to control the final combined result.

**Execution mode:** hybrid (implementers work in parallel, QA incremental).

**Prerequisites:** 
- A `BRANCH_MAP.md` mapping file must exist to track ownership and live worktrees.
- Use the `worktree_manager` skill to provision environments.

## Branch model
```
master  (untouched)
 ├─ feature_branch_1    feature scope A     ─┐ small review branches off master
 ├─ feature_branch_2    feature scope B     ─┘ each builds/runs alone (concurrently)
 └─ integration_branch  OVERALL integration  ← user runs this (branch_1+branch_2+glue)
```

## Phase 0 — Context + branch check
1. Read `BRANCH_MAP.md`. Read `git worktree list` + `git branch`.
2. Decide which branch(es) the request touches via the ownership table. If it spans multiple, split the task per branch — do NOT mix unrelated feature scopes in one edit.

## Phase 1 — Environment Provisioning
- **Overall integration branch runs in the MAIN checkout** (`git checkout` it; no worktree).
- **Worktrees are for child branches worked in PARALLEL** (e.g. branch A and branch B edited/built at once).
- Use `worktree_manager` to safely create worktrees and copy `.claude/` + `.agent/` harness files.

## Phase 2 — Dispatch (parallel implementers)
- `TaskCreate` per branch. Frontend + backend may run in parallel when files don't overlap.
- Shared seam files (`App.tsx`, `papp_main.py`): require a human-voice marker comment (e.g., `# <branch_id> (<name>):`) on each seam edit so `wrapup-branches` workflow can reconcile.

## Phase 3 — Incremental QA
- As each branch's work lands, run that branch's build check **in isolation** (the branch must build/run alone).
- Block sign-off on any branch until its build is green.

## Phase 4 — Integration handoff
- When small branches are green, hand off to the `/wrapup-branches` workflow to compose the integration branch.
- Remember the audiences: reviewers review child branches; the tester runs the integration branch.
