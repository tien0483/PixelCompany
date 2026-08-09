# PixelOffice-v2

## Agent stack

Installed at `backends/agent_stack`, symlinked into every task worktree. Two
tools are available without any setup:

**`understand-chat` — codebase questions.** When a question spans three or more
files ("how does X work", "what calls Y", "where does Z get set"), check for
`.ua/knowledge-graph.json` first:

- Graph present → answer via the `understand-chat` skill instead of opening files
  one by one.
- Graph absent → answer normally, and mention once that `/understand` would build
  the graph. Do **not** run `/understand` unprompted: a full build reads the whole
  repo and is expensive. It also redirects worktree output to the main repo root,
  so one build serves every task.

**`rtk` — token-compressing CLI proxy.** On PATH in every runtime-spawned agent
session. Prefer it for shell commands with bulky output — `rtk git status`,
`rtk tsc`, `rtk lint`, `rtk test`, `rtk grep`. It only helps for *shell* commands:
the Read/Grep/Glob tools never pass through it, so keep using those for file
reads. `rtk gain` shows what it saved.

Proxy routing (Headroom/CCR) is deliberately NOT applied to task agents — see
`backends/runtime/src/stack/stack-process.ts` for why.

**Exception: subagent seats.** A card can pin an API seat that only its *subagents*
bill (Account picker → "Subagents", Claude Code only). Such a task launches with
`ANTHROPIC_BASE_URL` at the switchboard and `CLAUDE_CODE_SUBAGENT_MODEL=ccr-<port>,<model>`,
and never with `ANTHROPIC_API_KEY` — so the parent keeps its own OAuth seat while the
switchboard diverts marker-model requests to a per-seat CCR on 3460+. The user's own
`ENABLE_CCR` router keeps 3456. Every failure degrades to "subagents share the task's
seat" instead of blocking the launch.

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
| 2026-08-01 | post-checkout hook guard | Scripts | `git worktree add` (task worktree creation) fires the `post-checkout` hook **before** the runtime symlinks `node_modules` into the new worktree, so `scripts/rebuild-ui-if-changed.sh` ran `npx vite build` with no deps → `ERR_MODULE_NOT_FOUND: @tailwindcss/vite` → non-zero hook exit aborted worktree creation, leaving a symlink-less shell and every backlog task failing at start. Script now early-exits when `frontends/pixel_office/node_modules` is absent. |
| 2026-08-07 | Immutable task baseRef + push | Runtime + UI | Persist worktree base ref in branch registry at creation; merge/UI use that over editable card metadata. Git view gains "Push to remote". Chain followers surface the root's locked base ref. |
| 2026-08-09 | Agent stack moved in-tree | Backends + scripts + gitignore | `~/agent-stack-sandbox` → `backends/agent_stack`. Half the stack already shipped in-repo (Stack Control dialog + client, `link-stack-skills.mjs`, `solo.mjs` probe), so a fresh clone had UI for a backend it could not install. Runtime now spawns the switchboard headless (`src/stack/stack-process.ts`, mirroring `manager-process.ts`) — but never exports the proxy env for spawned agents: `activate-stack.sh` sets `ANTHROPIC_API_KEY=sk-dummy-key-for-sandbox` and CCR ships no credentials, so inherited routing would fail every task agent with `Authentication failed`. Payload dirs are gitignored *so that* `syncIgnoredPathsIntoWorktree` symlinks them into each task worktree (UA skills + `bin/rtk` per task, no 2 GB copy). venv rebuilt as `.venv` via `uv sync` — console-script shebangs are absolute, so a venv cannot be moved. |
| 2026-08-09 | Subagent seats | Runtime + UI + agent_stack | Cards can pin an API seat that only the session's *subagents* bill, so orchestration-heavy tasks stop burning the main OAuth seat's 5h/7d cap. Claude Code sends `CLAUDE_CODE_SUBAGENT_MODEL` verbatim as the `model` of every subagent request and nothing else — that is the only per-turn signal separating a subagent from its parent, and no other CLI reads it. Launch sets `ANTHROPIC_BASE_URL` (switchboard) + the marker `ccr-<port>,<modelId>`, never `ANTHROPIC_API_KEY`: Claude Code prefers that key over its OAuth credential, which would move the parent off the card's seat too. `server.py` buffers only `POST /v1/messages`, routes marker models to the seat's router with the model rewritten and caller auth stripped, and now only swaps in `STACK_UPSTREAM_ANTHROPIC_API_KEY` when the caller sent no real credential. The vendored CCR routes **by category only** — `"provider,model"` strings log `Unknown model …, using default` and `routing.rules` is ignored — so each seat gets its own router (3460+, clear of the user's 3456) with CCR's shipped codewhisperer/shuaihong providers neutralized, or they win `default`. |

## Commit & PR message style
- Do not add `Co-Authored-By: Claude ...` trailer to commits in this repo.
- Do not add "🤖 Generated with Claude Code" (or any AI-attribution) line to PR descriptions in this repo.
- Everything else (Conventional Commits format, PR Summary/Test plan structure) stays as-is.
