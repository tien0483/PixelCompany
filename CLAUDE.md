# PixelOffice-v2

## Harness: PixelOffice merge

**Goal:** Unified monorepo (`frontends/pixel_office` + `backends/runtime` + `backends/jacked`) with three-pane home and Claude-only Jacked OAuth.

**Trigger:** For PixelOffice merge, flatten, three-pane layout, docked office, Jacked Accounts/OAuth, or related follow-ups, use the `pixeloffice-merge-orchestrator` skill. Simple questions can be answered directly.

**Change log:**

| Date | Change | Target | Reason |
|------|--------|--------|--------|
| 2026-07-30 | Initial build | All | Three-pane merge harness |
| 2026-07-30 | Flatten stack | All | Remove nested kanban / claude-jacked-master donors |
| 2026-07-30 | Claude-only gate | Runtime + UI | Cline gated at the agent catalog (reversible); Claude Code is the default and only launchable agent |
| 2026-07-30 | Runtime owns Jacked | Runtime + scripts | Jacked spawned headless by the runtime; `scripts/solo.mjs` serves everything on one URL |
| 2026-07-30 | Multi-account | Jacked + Runtime + UI | Account actions/sessions ported; per-task pinning via `CLAUDE_CONFIG_DIR` |
| 2026-07-31 | Neutral runtime home | Runtime | `~/.cline` → `~/.agent`; boards copied forward, legacy worktrees left in place |
| 2026-07-31 | Manager office theme | UI | Jacked surface reads as Manager / Seats / Staff / Playbooks / Training / Handbook (labels only) |
| 2026-07-31 | Skills + packs UI | Runtime + UI | Four feature shelves in the sidebar; `/api/packs` bridged for curated skill bundles |
| 2026-07-31 | WSL dev-setup docs | Docs | Run from native Linux fs, not `/mnt/<drive>`; 9p I/O makes `npm run solo` hang forever on `node_modules` resolution |
| 2026-07-31 | Jacked venv auto-detect | Runtime | `resolvePythonBinary` prefers `backends/jacked/.venv/bin/python` over bare `python3`; fixes silent auth-router ImportError → 405 on OAuth |
