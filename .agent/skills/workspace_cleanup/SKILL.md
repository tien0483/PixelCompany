---
name: workspace_cleanup
description: "Audit the E:\akselos-dev-3.10 workspace for stale git worktrees and junk files, cross-check ticket status in Jira, and propose (never auto-run) removals. Triggers: 'clean up worktrees', 'workspace cleanup', 'garbage in the workspace', 'what worktrees can I delete'."
---

# workspace_cleanup

Audits the flat worktree layout under `E:\akselos-dev-3.10` (siblings of `akselos-dev-2`, the main checkout) and proposes a cleanup list. This skill only **proposes** — it never deletes or runs `git worktree remove` without explicit user confirmation per invocation, per the harness's destructive-action rules.

## Scope

1. Git worktrees registered against `akselos-dev-2` (`git -C akselos-dev-2 worktree list`).
2. Known junk locations that accumulate at the workspace root and inside worktrees.
3. Duplicate `temp-collection-maker-organization` scratch dirs (Mercurial checkouts made by the Portal's collection-maker tool when downloading a collection for local testing).

## 1. Enumerate worktrees

```bash
git -C akselos-dev-2 worktree list
```

Each row maps a directory to a branch. Ticket-numbered branches (`AKS-20868`, `AKS-20868-wt`, etc.) map 1:1 to a Jira key — strip any `-wt` / descriptive suffix to get the key (e.g. `AKS-20924_coker-bulging-trends-pages` → `AKS-20924`).

## 2. Cross-check Jira status

For each ticket key, query status via the Atlassian MCP tools (`getAccessibleAtlassianResources` for cloudId, then `searchJiraIssuesUsingJql` with `key in (...)`, fields `["summary","status"]`). Batch in groups of ~6 keys — larger batches can blow the tool's output token cap when descriptions are long.

Classify:
- **status.statusCategory.key == "done"** → candidate for cleanup.
- Anything else (`To Do`, `In Progress`/`Code Review and MR`/`Manual Testing`/etc., `Re-opened`) → keep, still active.

A worktree with no ticket-shaped branch name (e.g. `wgpu-pick-wt`, `coker-ai-chat-wt`, `config-consolidation-wt`) has no Jira key to check — ask the user or check recency/branch name intent instead of guessing.

## 3. Safety checks before recommending removal

Even for a Done ticket, verify the worktree is safe to drop:

```bash
git -C <worktree> status --porcelain=v1 --branch
```

- Branch line showing `[gone]` means the remote branch was deleted — almost always because it was merged (squash-merge deletes the remote branch). Good sign.
- Any `M`/`??` lines are uncommitted changes — flag these explicitly, do NOT recommend blind deletion. Surface the specific files so the user can decide (port the diff, stash it, or confirm it's disposable scratch like a handoff `.md` note).

## 4. Junk file sweep

Check the workspace root (`E:\akselos-dev-3.10`) and worktree roots for:
- `*.patch` files (e.g. `all_changes.patch`, `0001-*.patch`) — one-off diffs already applied or superseded.
- Loose `*.csv` / `*.txt` exports from ad-hoc scripts (e.g. `gitlab_mr_comments.csv`, `current_CI_errors.txt`, `mr_responses.csv`) sitting next to the script that produced them (`push_response.py`, `export_gitlab_comments.py`).
- Stray `*.zip` archives (`artifacts (13).zip`, `PixelAgents_FinalLayout.zip`, `full_material_database_plastic.zip`, `qwe.zip`) — confirm they're not the source-of-truth for a fixture before flagging.
- `temp-collection-maker-organization/` directories anywhere under `data/collections/`, `data/papp_data/`, `data/training_data/`, `artifacts_*/`, or inside a worktree's `temp_artifacts/`. These are scratch Mercurial checkouts (look for a `.hg/` dir inside a `tmp*` subfolder) made when a collection was pulled from the Portal for local testing — safe to delete once the applet run that needed them is done. Check size with `du -sh` first; these commonly run into multiple GB.
- Empty `*Host.log` files and other zero-byte logs at the root — harmless but free to remove.

Always `du -sh` a candidate before flagging size in the report — don't guess.

## 5. Report format

Produce a table: worktree/path → Jira key → status → safe-to-recycle verdict (yes / yes-but-check-diff / no) → size. Same for junk files: path → what it is → size → verdict. Then ask the user which items to actually move — do this via confirmation in chat, not automatically.

## 6. Recycle, don't delete

Default workflow is **soft-delete into a dated recycle folder**, not `rm -rf` / `git worktree remove`. The user reviews `_recycle_/<date>/` themselves after ~30 days and purges it manually — this skill (and the agent) should never delete from `_recycle_/` on its own.

```bash
DEST="E:/akselos-dev-3.10/_recycle_/<YYYY-MM-DD>"   # today's date
mkdir -p "$DEST"

# Worktrees: use `git worktree move`, NOT plain `mv` — it updates the
# admin metadata under akselos-dev-2/.git/worktrees/ so git still tracks
# the branch/checkout at its new path. Works even with a dirty worktree
# (use -f). Confirmed on git 2.47 (Windows).
git -C akselos-dev-2 worktree move -f "<worktree-path>" "$DEST/<name>"

# Plain junk files/dirs: normal mv
mv "<junk-path>" "$DEST/"
```

After moving, `git -C akselos-dev-2 worktree list` should show the ticket's branch still checked out, just at the new `_recycle_/<date>/...` path — nothing is lost, it's fully reversible by moving it back (`git worktree move` again).

## Related skills
- `worktree_manager` — creation/teardown mechanics for worktrees (harness copy-in, `BRANCH_MAP.md`). Use this skill's Jira-aware audit to decide *what* to tear down, then hand off to `worktree_manager`'s teardown step (or the same `git worktree remove` command) to execute.
- `clean_warp` — removes WARP-specific harness artifacts from a single target directory; narrower scope than this skill.
