# PixelOffice-v2

## Harness: PixelOffice merge

**Goal:** Unified monorepo (`frontends/pixel_office` + `backends/runtime` + `backends/manager`) with three-pane home and Claude-only Manager OAuth.

**Trigger:** For PixelOffice merge, flatten, three-pane layout, docked office, Manager Accounts/OAuth, or related follow-ups, use the `pixeloffice-merge-orchestrator` skill. Simple questions can be answered directly.

**Change log:**

| Date | Change | Target | Reason |
|------|--------|--------|--------|
| 2026-07-30 | Initial build | All | Three-pane merge harness |
| 2026-07-30 | Flatten stack | All | Remove nested kanban / claude-jacked-master donors |
| 2026-07-30 | Claude-only gate | Runtime + UI | Cline gated at the agent catalog (reversible); Claude Code is the default and only launchable agent |
| 2026-07-30 | Runtime owns Manager | Runtime + scripts | Manager spawned headless by the runtime; `scripts/solo.mjs` serves everything on one URL |
| 2026-07-30 | Multi-account | Manager + Runtime + UI | Account actions/sessions ported; per-task pinning via `CLAUDE_CONFIG_DIR` |
| 2026-07-31 | Neutral runtime home | Runtime | `~/.cline` → `~/.agent`; boards copied forward, legacy worktrees left in place |
| 2026-07-31 | Manager office theme | UI | Manager surface reads as Manager / Seats / Staff / Playbooks / Training / Handbook (labels only) |
| 2026-07-31 | Skills + packs UI | Runtime + UI | Four feature shelves in the sidebar; `/api/packs` bridged for curated skill bundles |
| 2026-07-31 | WSL dev-setup docs | Docs | Run from native Linux fs, not `/mnt/<drive>`; 9p I/O makes `npm run solo` hang forever on `node_modules` resolution |
| 2026-07-31 | Manager venv auto-detect | Runtime | `resolvePythonBinary` prefers `backends/manager/.venv/bin/python` over bare `python3`; fixes silent auth-router ImportError → 405 on OAuth |
| 2026-07-31 | UI dist auto-rebuild hooks | Root + docs | `.githooks/post-merge`/`post-checkout` rebuild `frontends/pixel_office/dist` when it drifts from HEAD; `core.hooksPath` set via `prepare` script |
| 2026-07-31 | No AI attribution in commits/PRs | Docs | User preference — strip Co-Authored-By and Generated-with footers for this repo |
| 2026-08-01 | npm → pnpm migration | Root + workspaces | Per-worktree `npm install` was duplicating full downloads/disk per agent worktree; pnpm's content-addressable store (`~/.pnpm-store`) shares packages across worktrees. `pnpm-workspace.yaml` holds `packages`, `overrides` (single `zod@4.4.3` — see [[pnpm-prepublish-quirk]]), and `allowBuilds`. Root `package.json` keeps its legacy `"workspaces"` field untouched (pnpm ignores it, cosmetic) per user request — edits to any `package.json` are user-denied for Claude, so dependency/manifest changes must go through `pnpm`/`npm` CLI commands, never the Edit tool. |

## Commit & PR message style
- Do not add `Co-Authored-By: Claude ...` trailer to commits in this repo.
- Do not add "🤖 Generated with Claude Code" (or any AI-attribution) line to PR descriptions in this repo.
- Everything else (Conventional Commits format, PR Summary/Test plan structure) stays as-is.
