---
name: worktree_manager
description: "Worktree setup and teardown manager. Use to spin up isolated git worktrees for parallel agent work, copy the necessary agent harness files (.agent/ and .claude/ dirs) into them, and clean them up when done. Triggers: 'create worktree', 'setup environment', 'tear down worktree'."
---

# worktree_manager

This skill handles the safe creation, configuration, and teardown of Git Worktrees for concurrent agent workflows. 
Worktrees are essential when multiple features are being developed in parallel by different agents, to avoid "cannot switch branch" locks.

## Core Rules
1. A branch lives in **at most one worktree**. Check `git worktree list` first. If a branch is already checked out, use that worktree.
2. **Harness Preservation**: When a worktree is created, it starts bare. The agent harness (`.agent/` and `.claude/` directories) are excluded from git and must be explicitly copied into the new worktree so agents can function inside them.

## 1. Creating a Worktree
When parallel work requires a new branch:
```bash
git worktree add ../akselos-<branch_name> <branch_name>
```

## 2. Copying the Harness
**Crucial:** After creating a worktree, copy the untracked agent harness into it from the main checkout. This ensures the skills and marker files are present.

Run this in WSL (assuming Windows `E:` == WSL `/mnt/e`):
```bash
MAIN=/mnt/e/akselos-dev-3.10/akselos-dev-2     # canonical copy (main checkout)
WT=../akselos-<branch_name>
mkdir -p $WT/.claude/skills $WT/.claude/agents $WT/.agent
cp -r $MAIN/.claude/skills/* $WT/.claude/skills/
cp $MAIN/.claude/agents/*.md $WT/.claude/agents/
cp -r $MAIN/.agent/* $WT/.agent/
```

## 3. Tearing down a Worktree
When work on a feature is fully merged and the worktree is no longer needed:
```bash
# Keep the branch, drop the worktree
git worktree remove ../akselos-<branch_name>
```

## Branch Mapping
Always read and update the `BRANCH_MAP.md` (or equivalent file for the project) every time a worktree is created, reused, or removed.
