# Agent Stack

Seven-tool agent stack, contained in this directory. Nothing is installed globally;
nothing outside this dir is modified except one reversible symlink
(`~/.understand-anything-plugin`, required — see below).

Lived at `~/agent-stack-sandbox` until 2026-08-09. It moved in-tree because half
of it already was: the Stack Control dialog, its client and the skill linker all
ship in this repo, so a fresh clone had UI for a backend it could not install.

```
backends/agent_stack/
├── bin/                  local binaries (rtk)                       [gitignored]
├── skills/caveman/       symlink to the Caveman plugin              [gitignored]
├── src-ponytail/         upstream ponytail checkout                 [gitignored]
├── node_modules/         local npm packages (claude-code-router, …) [gitignored]
├── .venv/                local Python env (headroom, fastapi, …)    [gitignored]
├── src-*/                upstream checkouts (UA, DevTools)          [gitignored]
├── ccr-home/             scoped HOME for CCR                        [gitignored]
├── logs/                 per-daemon logs                            [gitignored]
├── stack-flags.json      switchboard state (7 toggles)              [gitignored]
├── server.py             control panel UI + dynamic proxy router
├── pyproject.toml        deps for .venv (`uv sync`)
├── activate-stack.sh     per-shell activator (source it)
└── stop-stack.sh         stop only the daemons the activator started
```

Everything heavy is gitignored, and that is load-bearing rather than incidental:
the runtime symlinks every git-ignored path into each task worktree
(`syncIgnoredPathsIntoWorktree` in `backends/runtime/src/workspace/task-worktree.ts`),
so a task agent gets `bin/rtk` and one shared `stack-flags.json` at the same
relative paths instead of 2 GB copied per worktree.

## Who starts what

| Piece | Started by | Scope |
|-------|-----------|-------|
| Switchboard (`server.py`, :8000) | the runtime, on every Kanban launch (`backends/runtime/src/stack/stack-process.ts`) | shared |
| Headroom (:8787) | the runtime (`src/stack/headroom-process.ts`), or `activate-stack.sh` | shared, restarted on crash |
| CCR (:3456) / DevTools (:3001) | the runtime when flagged on (`src/stack/stack-extra-daemons.ts`), or `activate-stack.sh` | shared, restarted on crash |
| `rtk` on PATH | the runtime per spawned session (`withStackBinOnPath`) and the activator | every task agent |
| venv on PATH | `activate-stack.sh` only | the sourcing shell |
| `ANTHROPIC_BASE_URL` for agents | `scripts/solo.mjs` (opt out with `--no-proxy-env`) or the activator | every task agent |
| `.claude/skills` symlinks | `scripts/link-stack-skills.mjs` (run by `solo.mjs`) and the activator | this checkout |

Every runtime-owned daemon skips a port that is already served, so an activated
shell keeps ownership of the daemons it started, and pidfiles stay usable by
`stop-stack.sh` either way.

`ANTHROPIC_API_KEY` is the one thing that must never reach a spawned agent:
`activate-stack.sh` sets it to `sk-dummy-key-for-sandbox`, and Claude Code prefers
an API key over its OAuth credential, so exporting it moves the session off the
seat the card resolved and onto a key the switchboard has to substitute
(`Authentication failed` when `STACK_UPSTREAM_ANTHROPIC_API_KEY` is unset).
`solo.mjs` therefore exports only the base URL — `has_caller_credential()` sees
the session's real OAuth bearer and forwards it untouched.

`stop-stack.sh` only knows daemons that wrote a pidfile, i.e. the ones the
activator started. A switchboard the runtime spawned is stopped by the runtime.

## Use

Nothing to do for the switchboard and skills — `pnpm run solo --restart --build`
handles shallow clones (ponytail when flagged), `uv sync` when the venv is missing,
skill/rule links, stack daemon restart, UI rebuild, and runtime boot. Use that as
the normal dev loop after stack changes.

For `rtk` on PATH and proxy routing in your own shell:

```bash
cd <repo>
source backends/agent_stack/activate-stack.sh
claude
```

Other terminal tabs — and Cursor, Roo Code, Ollama, etc. — are untouched, because
every change the activator makes (PATH, venv, `ANTHROPIC_BASE_URL`) is scoped to
the shell that sourced it.

Stop the activator's daemons: `backends/agent_stack/stop-stack.sh`

## Install

```bash
cd backends/agent_stack
uv sync                       # .venv: headroom, fastapi, uvicorn, h2
npm install                   # node_modules: claude-code-router
```

Then the upstream checkouts (`src-understand-anything`, `src-claude-devtools`)
and `bin/rtk`, none of which are tracked — see the per-tool notes below.

The `.venv` name matches `backends/manager`, which is what lets the runtime find
the interpreter with the same venv-first probe it uses for Manager. A venv cannot
be relocated: its console scripts hardcode an absolute shebang, which is why the
2026-08-09 move rebuilt it with `uv sync` rather than copying it.

## Switchboard

Two front-ends over the same `stack-flags.json`:

- Standalone: <http://127.0.0.1:8000/ui>
- PixelOffice: the sliders button in the top bar, next to **Office** / **Cleanup**
  (talks to `/api/flags` on this backend; set `VITE_STACK_CONTROL_URL` if you move
  the port)

`GET /health` and `GET /api/flags` return flags, the resolved proxy chain, and
per-daemon liveness.

### Which flags take effect when

| Flag | Effect | Applies |
|------|--------|---------|
| `ENABLE_HEADROOM`, `ENABLE_CCR` | proxy chain routing | immediately (read per request) |
| `ENABLE_UA`, `ENABLE_RTK`, `ENABLE_CAVEMAN`, `ENABLE_PONYTAIL`, `ENABLE_DEVTOOLS` | PATH/skill/daemon setup | next `source activate-stack.sh` |

## Proxy chain

`server.py` on :8000 is what `ANTHROPIC_BASE_URL` points at. It resolves the
upstream per request:

| Headroom | CCR | Chain |
|----------|-----|-------|
| on | on | `:8000 → headroom:8787 → ccr:3456 → provider` |
| on | off | `:8000 → headroom:8787 → provider` |
| off | on | `:8000 → ccr:3456 → provider` |
| off | off | `:8000 → api.anthropic.com` |

Headroom does **not** chain to CCR on its own — the activator passes
`--anthropic-api-url http://127.0.0.1:3456` to make that hop real.

### Credentials

`activate-stack.sh` exports `ANTHROPIC_API_KEY=sk-dummy-key-for-sandbox`, since a
live key should not sit in a session pointed at a local proxy. For the
Headroom-off + CCR-off (direct) path, give the switchboard the real key instead:

```bash
export STACK_UPSTREAM_ANTHROPIC_API_KEY=sk-ant-...   # before sourcing
```

It is swapped in server-side for direct requests only.

## Status of the seven tools

| Tool | State |
|------|-------|
| Headroom | installed (`.venv/bin/headroom`), `proxy --port 8787 --mode cache`, tool-result protection — see `config/headroom-proxy.json` |
| CCR | installed (`node_modules/.bin/ccr`), HOME-scoped to `ccr-home/`, verified up |
| Caveman | wired to the already-installed Claude Code plugin (see below) |
| Ponytail | skills + always-on rules for Cursor, Claude Code, Antigravity (see below) |
| Understand-Anything | installed as skills (`src-understand-anything`), core built, 9 skills |
| RTK | installed (`bin/rtk` 0.45.0) — **relocated by hand**, see below |
| Claude DevTools | built from source as a standalone server, verified serving on :3001 |

`skills/caveman` is a symlink to the Caveman *plugin* already installed at
`~/.claude/plugins/cache/caveman/caveman/<hash>/skills/caveman`, rather than a
fresh `git clone`. Two consequences:

- Caveman is already active globally via that plugin, so `ENABLE_CAVEMAN` mainly
  matters for workspaces where the plugin is not enabled.
- The path contains a plugin-version hash, so a plugin update will break the
  symlink. Re-point it, or replace it with a real clone:
  `git clone https://github.com/juliusbrussee/caveman backends/agent_stack/skills/caveman`

### Ponytail minimizes generated code

[Ponytail](https://github.com/DietrichGebert/ponytail) is the complement to Caveman:
Caveman shrinks what the agent *says*; Ponytail shrinks what it *builds*. Pair them.

Install the upstream checkout (gitignored, symlinked into every task worktree like UA):

```bash
git clone --depth 1 https://github.com/DietrichGebert/ponytail.git backends/agent_stack/src-ponytail
```

When `ENABLE_PONYTAIL` is on, `activate-stack.sh` and `scripts/link-stack-skills.mjs`
link:

- all six `skills/ponytail*` dirs into `.claude/skills`, `.agent/skills`, `.cursor/skills`
  (Claude Code slash commands, Cursor skills, Antigravity skills)
- `.cursor/rules/ponytail.mdc` for Cursor CLI / IDE always-on rules
- `.agents/rules/ponytail.md` for Antigravity CLI always-on rules

The runtime also calls the same linker at boot (`cli.ts`) and on every task worktree
ensure (`task-worktree.ts`), so task agents get the stack even when solo was never run
or the worktree was created before ponytail was installed. Gitignored skill/rule symlinks
are mirrored into worktrees by `syncIgnoredPathsIntoWorktree`.

For Claude Code plugin-tier hooks (per-turn ruleset injection + subagent propagation),
install the marketplace plugin separately:

```
/plugin marketplace add DietrichGebert/ponytail
/plugin install ponytail@ponytail
```

The stack's skill links are enough for task agents launched from PixelOffice; the plugin
adds lifecycle hooks on top. Caveman + Ponytail together is the intended combo.

### Caveman + Headroom + Ponytail (safe coexistence)

All three can run together when each stays in its lane — see
`rules/stack-compression-coexistence.mdc` (linked into `.cursor/rules` and
`.agents/rules` when any of the three flags is on).

| Layer | Scope | Protected from compression |
|-------|--------|---------------------------|
| **Ponytail** | Code you generate (YAGNI ladder) | Wrapped in `<system_rules do_not_compress="true">` in hooks + linked rules |
| **Caveman** | User/assistant chat prose only | Code fences, tool results, system_rules blocks |
| **Headroom** | Network prefill trim (`cache` mode) | Tool results in `config/headroom-proxy.json`; ``` fences |

Headroom defaults (`config/headroom-proxy.json`):

```json
{
  "mode": "cache",
  "protectToolResults": ["Read", "Grep", "Glob", "Bash", "Write", "Edit"]
}
```

Use `token` mode only when you accept lossy rewrite of older turns. Override tools via
`HEADROOM_PROTECT_TOOL_RESULTS` or edit the JSON, then restart headroom.

Headroom needed one dependency it does not declare: `h2` (it defaults to
`http2=True`, and without `h2` startup dies with `ImportError` on every launch).
It is pinned in `pyproject.toml` here.

### Understand-Anything has no binary

UA is not a CLI — it is a git checkout plus a set of `SKILL.md` directories, which
is already Claude Code's own skill format. Skills link **only when the project has
a built graph** (`.ua/knowledge-graph.json`, or legacy `.understand-anything/knowledge-graph.json`).
Projects without either directory skip UA entirely — stack-provided `understand-*`
symlinks are removed so `/understand` does not appear on agents that cannot use it.

Its `install.sh` never reads
`INSTALL_DIR` (only `UA_DIR` and `UA_REPO_URL`), and its platform menu has no
Claude entry — every target is a hardcoded `$HOME` path for some other tool. So
the installer is not used here. Instead:

- the repo is cloned to `src-understand-anything/`
- `packages/core` is built (`pnpm install && pnpm run build`) — `/understand`
  imports `@understand-anything/core`, and no `dist/` ships in the repo
- `activate-stack.sh` symlinks all 9 `understand-*` skills into the workspace's
  `.claude/skills/`
- `~/.understand-anything-plugin` → this checkout

That last symlink is the one thing outside the sandbox, and it is required: the
skill resolves its own plugin root at runtime by probing `$CLAUDE_PLUGIN_ROOT`,
`~/.understand-anything-plugin`, `~/.agents/skills/understand`,
`~/.copilot/skills/understand` and a few `$HOME` clone paths — it never looks in
`.claude/skills/`, so without the link `/understand` exits with "Cannot find the
understand-anything plugin root". Remove it with
`rm ~/.understand-anything-plugin`.

### DevTools is built from source

The npm package's postinstall fails on linux ("No matching binary found"), but the
repo has a non-Electron `standalone:build` target. `src-claude-devtools/` holds
that checkout, built to `dist-standalone/index.cjs` and launched as
`PORT=3001 HOST=127.0.0.1 node dist-standalone/index.cjs`. Setting `PORT` is
mandatory: the standalone server defaults to **3456**, which is CCR's port.

The dashboard is surfaced in two places:

- `http://127.0.0.1:3001` directly
- inside PixelOffice, as a **DevTools** tab next to *All Changes* / *Last Turn* in
  each session's detail view (hidden when the daemon is down)

### RTK ignores INSTALL_DIR

`INSTALL_DIR=<repo>/backends/agent_stack/bin` had no effect — rtk's installer reported
`Successfully installed rtk to /home/ubuntu/.local/bin/rtk`, i.e. it hardcodes
`~/.local/bin`. The binary was moved into `bin/` afterwards and the global copy
removed. **Any rtk reinstall or self-update will land in `~/.local/bin` again**
and must be moved back:

```bash
mv ~/.local/bin/rtk backends/agent_stack/bin/rtk
```

rtk is a per-invocation proxy (`rtk git status`, `rtk tsc`) with no shell hooks,
so having it on the sandbox PATH is the whole integration. Two things that *do*
write outside the sandbox, so run them only if you want them globally:

- `rtk init` — writes assistant instruction files into the current workspace
- `rtk config` — creates a config file under `~/.config`

The switchboard and activator already handle all seven; missing tools are reported
as `SKIPPED` at activation instead of failing silently.

### CCR configuration

CCR generates `ccr-home/.claude-code-router/config-router.json` on first start
and ignores the older `config.json` (`Providers`/`Router`) schema. Its shipped
default routes to CodeWhisperer with empty credentials, so requests fail with
`Authentication failed` until you edit that file to add a real provider.

Verified end-to-end plumbing (with no credentials configured):

```
POST :8000/v1/messages
  → headroom:8787 → ccr:3456 → provider
  ccr.log: "Processing messages request" → "Failed to add authentication token"
```

i.e. the chain forwards correctly; only the credentials are missing.
`CLAUDE_CODE_SUBAGENT_MODEL` defaults to `openrouter,deepseek/deepseek-chat`,
which needs a matching provider entry in `config-router.json`.
