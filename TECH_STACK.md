# Tech stack: PixelOffice unified monorepo

One product tree: React UI + Node runtime + Jacked Python. No nested `kanban/` or `claude-jacked-master/` donor folders.

| | **Runtime** | **Frontend** | **Jacked** |
|---|---|---|---|
| **Role** | Board, PTY, tRPC, Jacked bridge | Three-pane shell (board + Accounts + office) | Claude usage / OAuth / swap |
| **Language** | TypeScript (Node ≥22) | TypeScript React 18 + Vite 6 | Python ≥3.10 FastAPI |
| **Path** | `backends/runtime/` | `frontends/pixel_office/` | `backends/jacked/` |
| **API** | tRPC `/api/trpc` + WS; `/api/jacked-proxy/*` | Vite proxies `/api` → runtime | REST + WS on `:8321` |
| **Launch** | Root `npm start` → `scripts/start-stack.mjs` | same | spawned headless by the runtime |

## Home layout

```text
Left sidebar (+ Jacked config) | Center: board | Right: Claude Accounts (upper) + Pixel Office (lower)
```

## Launch modes

| Mode | Command | Processes | URL |
|------|---------|-----------|-----|
| Dev (HMR) | `npm start` | runtime + Vite + jacked | `:5173` |
| Solo (single URL) | `node scripts/solo.mjs` | runtime (serves built UI) + jacked | `:3484` |

The runtime owns jacked in both modes: `backends/runtime/src/jacked/jacked-process.ts` spawns
`python -m jacked webux --no-browser` on startup and stops it on shutdown. It skips the spawn when
`:8321` is already listening (an externally managed service or the macOS menu-bar app keeps it), and
never fails the runtime when Python is missing — the board and office run, Accounts report offline.

## Agents

Claude Code only. `RUNTIME_LAUNCH_SUPPORTED_AGENT_IDS` in `backends/runtime/src/core/agent-catalog.ts`
is the single gate: `normalizeAgentId` coerces any other persisted id to `claude`, curated agent lists
derive from it, and the Cline chat/provider/settings surfaces self-hide. Re-enable an agent by
uncommenting its catalog entry.

## Ports

| Service | Port |
|---------|------|
| Runtime | `127.0.0.1:3484` |
| Vite UI (dev only) | `127.0.0.1:5173` |
| Jacked | `127.0.0.1:8321` |

Browser → UI → same-origin runtime → Jacked (`/api/trpc`, `/api/jacked-proxy` for health). Claude accounts only in product UI. Product chrome does **not** embed or open the raw `:8321` multi-provider dashboard (left Jacked sidebar is native Installations / Settings / Logs / Analytics only; Accounts live upper-right).

## Manager (office theme)

The claude-jacked integration is presented as office staffing. Visible copy lives in one
place — `frontends/pixel_office/src/jacked/manager-labels.ts`:

| Surface | Reads as | Backed by |
|---------|----------|-----------|
| Sidebar tab | **Manager** | jacked snapshot |
| Upper-right pane | **Seats** | Claude accounts + usage meters |
| Staff | subagents you hire | `features` category `agents` |
| Playbooks | slash commands | `features` category `commands` |
| Training | skills + curated packs | `knowledge` entries prefixed `skill_`, plus `/api/packs` |
| Handbook | house rules, reference | remaining `knowledge` entries |

Staff/Playbooks/Training/Handbook are four predicates over the feature list the runtime already
streams (`FEATURE_SHELF_SELECTORS` in `feature-shelf-view.tsx`), so they need no extra fetch; each
row toggles through the existing `jacked.setFeatureEnabled`. Packs are the one extra bridge
(`jacked.packs` / `jacked.setPackEnabled`). Toggling anything writes into the user's global
`~/.claude`.

Naming split, on purpose: files, types, tRPC procedures and test ids keep the `jacked` name so they
stay traceable to the upstream API; only user-facing copy is rethemed. A vitest guard
(`manager-labels.test.ts`) fails if any view renders the vendor name.

## Runtime home

State lives under `~/.agent/` — `kanban/` (config, workspace index, boards, sessions, hook files)
and `worktrees/<taskId>/<workspaceFolder>`. Constants: `RUNTIME_HOME_PARENT_DIR_NAME` and friends in
`backends/runtime/src/workspace/task-worktree-path.ts`.

Pre-rename state under `~/.cline/` is handled without data loss:

- `runtime-home-migration.ts` **copies** `~/.cline/kanban` forward on first start when the new home
  is empty, and leaves the original as a backup. Idempotent; never throws.
- Worktrees are **not** moved — git records absolute paths in `.git/worktrees/*/gitdir`. An existing
  legacy worktree keeps resolving in place (`getWorktreesRootPath`), auto-trust accepts both roots,
  and only new tasks land under `~/.agent/worktrees`.
- `~/.cline/data/settings/cline_mcp_settings.json` belongs to Cline itself and is left alone.

## Multi-account

Accounts pane (upper-right) manages the fleet: Use / Refresh / re-auth / validate / enable-disable /
delete / swap-priority moves, plus a live-session count per account.

Two ways to run several accounts:

- **Global rotation** (unpinned tasks) — jacked swaps one credential file; all unpinned Claude Code
  sessions follow the active account.
- **Per-task pin** — a card carries `jackedAccountId`; the runtime asks jacked for that account's
  `~/.claude/accounts/<id>` directory (`POST /api/auth/accounts/{id}/launch-dir`) and exports it as
  `CLAUDE_CONFIG_DIR` for that PTY session only. Pinned tasks run concurrently on different accounts
  and are immune to swaps. A pin applies at session start; restart a running session to move it.

macOS caveat: Claude Code reads the Keychain before the config-dir file, and jacked's
`prepare_account_dir` writes both, so on darwin preparing a pin also moves the global identity.
Windows/Linux are fully isolated per account.

## WSL development

Run this repo from the Linux native filesystem (e.g. `~/work/PixelCompany`), never from
`/mnt/<drive>/...`. Node/tsx/Vite open thousands of small files in `node_modules` on startup; each
crosses the 9p WSL↔Windows boundary at ms latency instead of µs, so `npm run solo` / `npm start`
appear to hang forever (`main()` never reaches `listen()`, port stays refused even from inside WSL).
Clone or `rsync --exclude node_modules --exclude .git` onto the ext4 filesystem instead — startup
drops from "never finishes" to seconds.

If `npm install` on Linux fails building the UI with `Cannot find module
@rollup/rollup-linux-x64-gnu` (or an equivalent native optional-dep for esbuild/swc), the
`package-lock.json` was generated on a different OS. Delete `package-lock.json` and all
`node_modules` and reinstall — see the npm optional-deps bug
[npm/cli#4828](https://github.com/npm/cli/issues/4828).

## UI dist auto-rebuild

`frontends/pixel_office/dist` is gitignored, and the runtime falls back to serving whatever's
physically on disk when hit directly (`:3484` in solo mode) — so after a `git pull`/merge/checkout
brings in frontend changes, the dist on disk silently goes stale until something rebuilds it. Two
git hooks under `.githooks/` (`post-merge`, `post-checkout`) call
`scripts/rebuild-ui-if-changed.sh`, which rebuilds only when `frontends/pixel_office/{src,package.json,
vite.config.ts,index.html}` actually changed between the old and new ref (or `dist/index.html` is
missing) — a no-op the rest of the time. It calls `vite build` directly, not the `build` npm script,
because that script also runs `tsc --noEmit`, which can fail on pre-existing baseline type errors
unrelated to the change that triggered the hook (`scripts/solo.mjs`'s own `buildUi()` makes the same
choice). It also sources `~/.nvm/nvm.sh` itself when present, since git hooks run in a minimal
non-login shell where nvm-managed Node isn't on `PATH` otherwise.

`core.hooksPath .githooks` is set automatically by the root `prepare` npm script on `npm install` —
nothing to configure by hand.

If OAuth (Add Account / re-auth) fails with **"claude-jacked returned HTTP 405"**, jacked's Python
interpreter is missing a dependency (usually `aiohttp`). The runtime spawns bare `python3` on PATH
by default, which on a fresh WSL box is the system interpreter, not the `uv sync`/`pip install -e .`
venv under `backends/jacked/.venv`. A missing import makes jacked's auth router fail to load
(swallowed by a broad `except ImportError` in `jacked/api/main.py`), so every `/api/auth/*` call
falls through to the SPA static catch-all and 405s instead of erroring clearly. The runtime now
auto-detects `backends/jacked/.venv/bin/python` (`.venv\Scripts\python.exe` on Windows) when
`JACKED_PYTHON` isn't set — see `resolvePythonBinary` in
`backends/runtime/src/jacked/jacked-process.ts`. Run `cd backends/jacked && uv sync` once so that
venv exists; only set `JACKED_PYTHON` yourself to override with a different interpreter.

## Jacked install (once)

```bash
cd backends/jacked
pip install -e .
# or: uv sync
```

The runtime waits briefly for port `8321` in the background after spawning Jacked; if it never opens
it logs the install hint above and keeps running. Set `JACKED_PYTHON` to pick a specific interpreter.

From the monorepo root, run `npm install --install-links` so the `file:` link into `backends/runtime`
resolves (plain `npm install` currently fails during dedupe because the root `package.json` has no
`version` field).
