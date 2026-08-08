# Cleanup button — design

## Problem

Claude Code accumulates disk usage under `~/.claude` (debug logs, tool-result caches, shell snapshots, session transcripts) with no built-in cleanup. Separately, this repo's runtime accumulates task worktrees under `~/.agent` that are already merged and safe to delete — the backend logic for that already exists (`cleanMergedWorktrees`) but has no UI entry point. We want one `Cleanup` button, next to the `Office` toggle in the top bar, that lets the user pick which kind of trash to remove.

Reference: [hoangvu12/claude-clean](https://github.com/hoangvu12/claude-clean) — a CLI-only tool (`@hoangvu12/claude-clean`, no programmatic API, text output) that categorizes `~/.claude` contents into a safe tier (>7 days old: debug logs, tool-result cache, shell snapshots, file history, temp files) and a medium-risk tier (session transcripts, opt-in via `--all`), while protecting config/credentials/settings/memory. We reimplement this categorization natively rather than shelling out to the CLI, since it has no JSON output and no importable API.

## Architecture

Two independent cleanup domains behind one UI entry point:

1. **Runtime worktrees** (existing, no backend changes) — `workspace.cleanMergedWorktrees` tRPC mutation (`backends/runtime/src/trpc/workspace-api.ts:646`, schema in `backends/runtime/src/core/api-contract.ts:2530-2543`) deletes task worktrees whose branch is fully merged, skipping worktrees shared by live chain members or with unmerged branches. Frontend helper `cleanRuntimeMergedWorktrees` (`frontends/pixel_office/src/runtime/runtime-config-query.ts:347-352`) already exists but is unused. We add a companion read-only list query (existing `listWorktrees` inventory) for the modal's preview, and wire the mutation to the new UI.

2. **Claude cache/logs** (new) — `backends/runtime/src/workspace/claude-cache-cleanup.ts`, same shape as `git-worktree-cleanup.ts`:
   - Scans `~/.claude`, categorizes entries into safe tier (debug logs, tool-result cache, shell snapshots, file history, temp files) and transcript tier (session transcripts).
   - Age filter: safe tier defaults to >7 days old (matches claude-clean); "active" files (mtime within threshold) are treated as in-use and skipped regardless of tier.
   - Hard-excludes protected paths: config, credentials, settings, global instructions, memory directory — these are never scanned for deletion candidates.
   - Two tRPC procedures mirror the worktree pair:
     - `claudeCache.status` — read-only, returns categorized counts/sizes.
     - `claudeCache.clean({ days, includeTranscripts, dryRun })` — `dryRun: true` returns the same shape as `status` scoped to what-would-be-deleted (no fs writes); `dryRun: false` deletes and returns per-item results, with per-item failures recorded as `skipped` (reason) rather than aborting the batch.

## UI / data flow

- New `Cleanup` button in `frontends/pixel_office/src/components/top-bar.tsx`, placed after the `Office` toggle button (~line 869), same `Button variant="ghost" size="sm"` pattern as the Office/Terminal/Debug buttons, `Trash2` icon, tooltip "Clean up Claude cache and runtime worktrees". Opens `CleanupModal`.
- On open, the modal fires both status queries in parallel: `claudeCache.status` and the worktree inventory list. Renders two checkbox rows, both unchecked by default:
  - "Claude cache & logs (N items, X MB)"
  - "Merged runtime worktrees (N worktrees)"
  - A nested checkbox "Include session transcripts" appears under the Claude row, disabled until that row is checked.
- "Preview" (enabled once ≥1 row is checked):
  - For Claude cache: calls `claudeCache.clean({ dryRun: true, includeTranscripts, days: 7 })`, renders the returned item list with sizes.
  - For worktrees: no dry-run mutation needed — the inventory list already distinguishes merged/mergeable worktrees from skip-worthy ones, so preview renders that list directly.
- "Confirm delete" runs the real mutation(s) for checked categories only, shows a toast per category (removed count/size, skipped count with reasons), then re-runs both status queries to refresh the modal in place (it stays open).
- Closing the modal at any point (before confirm) makes no changes.

## Error handling

- `claude-cache-cleanup.ts`: per-item try/catch around each delete. A locked or permission-denied path is recorded in the response's `skipped` list with a reason string; the batch continues to the next item. Never throws for a single bad item — only for scan-level failures (e.g. `~/.claude` missing entirely), which surface as a normal tRPC error toast.
- Worktree cleanup already has equivalent per-item skip behavior (live chain members, unmerged branches) — reused as-is.
- Protected paths (config/credentials/settings/memory) are excluded at the scan stage, not the delete stage — they never appear as candidates, so there's no reliance on delete-time checks to avoid destroying them.

## Testing

- Unit tests for `claude-cache-cleanup.ts`: safe-tier vs transcript-tier categorization, age-filter boundary (>7 days vs active), protected paths never appear in scan results, `dryRun: true` performs zero fs writes.
- tRPC procedure tests for `claudeCache.status` and `claudeCache.clean` (dry-run and real) against a fixture `~/.claude`-shaped temp dir.
- Frontend test for `CleanupModal`: checkbox gating (transcripts checkbox disabled until parent checked, Preview disabled until ≥1 row checked), preview→confirm flow renders returned items and calls the right mutations for only the checked categories.

## Out of scope

- No support for other agents beyond this repo's own runtime worktrees (e.g. no `~/.cline` legacy sweep) — can be added later as a third checkbox row if needed.
- No scheduling/automatic cleanup — this is a manual, user-initiated action only.
- No shelling out to the upstream `claude-clean` CLI package.
