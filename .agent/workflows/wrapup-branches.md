# /wrapup-branches — Merge and Wrapup Branches

Single workflow for merging small review branches into the overall integration hub branch.

**Prerequisites:** 
- A `BRANCH_MAP.md` mapping file must exist to track ownership.
- Enable `git rerere` (`git config rerere.enabled true`) before any cross-branch merge to record seam resolutions.

## Branch model
```
master  (untouched baseline)
 ├─ feature_branch_1    feature scope A     ─┐ small branches off master @<commit>
 ├─ feature_branch_2    feature scope B     ─┘ each must build/run on its own
 └─ integration_branch  OVERALL integration  ← user runs this = branch_1 + branch_2 + glue
```

## Splitting working-tree changes into small branches
When work was done in one tree and must be split:
1. Read `BRANCH_MAP.md` ownership table; classify each changed path → correct feature branch / shared.
2. Stage by ownership, not all-at-once: `git add` the feature_1-owned paths, commit on the feature_1 branch/worktree; repeat for feature_2.
3. Verify each branch builds alone before committing the next.
4. Update `BRANCH_MAP.md` status.

## Composing / refreshing the overall branch
1. Ensure the integration branch exists (off master). If missing, create it and record in `BRANCH_MAP.md`.
2. Merge the feature branches into it. Conflicts cluster on seam files — resolve using the marker comments (e.g. `# <Ticket-ID> (<Name>):`).
3. Add minimal integration glue as separate commits so they are individually un-mergeable.
4. Build + run the overall branch — this is the artifact the user runs.

## Un-merging (pull a feature back out)
1. Identify the feature's commits/glue on the integration branch (grep prefix).
2. Prefer `git revert` of those commits on the overall branch (keeps history) over rebase, so parallel worktrees don't get rewritten history under them.

## Master Update (Backward Flow)
1. Ensure `git rerere.enabled true` is set.
2. Merge `master` into **each child branch** in its own worktree; resolve seam conflicts there. rerere records each resolution.
3. Merge `master` into the integration branch; rerere **replays the same resolutions**, so the overall branch resolves identically to the children.
4. Re-merge the children up into overall, build + run.
