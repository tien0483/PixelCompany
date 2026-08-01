# Jacked data unfold plan

PixelOffice is moving Jacked’s editable and runtime data out of the Python package
(`backends/jacked/jacked/data/`) into the repo-local `.agent/jacked/` tree so the
catalog is versioned with the app and the package stays a thin runtime.

## Current state (phase 1 — done)

| Location | Contents |
|----------|----------|
| `.agent/jacked/data/` | **Catalog** — skills, agents, commands, rules, `packs.json` (committed) |
| `backends/jacked/jacked/data/` | **Runtime** — hooks, web, lenses, guardrails, git-hooks, templates, plugin stub |

Resolution: `jacked/data_paths.py` → `get_catalog_data_root()` prefers
`PIXELOFFICE_AGENT_JACKED_DATA`, cwd walk, or repo layout; runtime spawn sets the env
from `jacked-process.ts`.

Duplicate catalog copies under the package were removed.

## Phase 2 — unfold runtime assets

Move remaining package data to `.agent/jacked/runtime/` (name TBD):

```
.agent/jacked/
  data/          # catalog (existing)
  runtime/       # new
    hooks/
    web/
    lenses/
    guardrails/
    git-hooks/
    templates/
    .claude-plugin/
```

### Code changes

1. **`data_paths.py`**
   - `get_runtime_data_root()` — mirror catalog resolution for `.agent/jacked/runtime`
   - Keep `get_package_data_root()` as last-resort fallback for standalone `pip install jacked`

2. **Call sites**
   - `api/main.py` — `WEB_DIR`
   - `jacked/cli.py` — hook install paths, `_get_package_data_root()` vs catalog split
   - `guardrails.py`, `memory/githook.py`, codex installer (lenses only if applicable)

3. **Runtime spawn**
   - `jacked-process.ts` — set `PIXELOFFICE_AGENT_JACKED_RUNTIME` (or extend existing env)

4. **Tests**
   - Point hook/web/lens tests at `get_runtime_data_root()` where they today use package paths

### Packaging

- **PixelOffice**: require repo `.agent/jacked/` (document in root README / dev setup).
- **Upstream jacked PyPI** (if still published): ship minimal stub in package or document
  that full assets come from cloning the repo / running from PixelOffice.

### Migration

1. Copy runtime dirs to `.agent/jacked/runtime/` in one commit.
2. Wire `get_runtime_data_root()` and update call sites.
3. Delete runtime duplicates from package (keep `CATALOG.md` + stub README).
4. Run full jacked test suite + `npm run solo` smoke (OAuth, Manager shelves, hook install).

## Phase 3 — install model (future)

Discussed but not implemented:

- **`.agent` as source of truth** — enable/disable toggles distribute to `~/.claude/skills`,
  `~/.claude/agents`, `~/.claude/commands` without copying into Jacked package paths.
- **`.disabled` markers** or state file under `~/.agent` for toggles without deleting catalog files.
- **Handbook (rules)** — continue merging selected rules into global `CLAUDE.md`; optional
  per-task scoping later.

## Phase 4 — docs and contributor UX

- Update `backends/jacked` docs that reference `jacked/data/skills` → `.agent/jacked/data/skills`
  (historical plan docs can keep old paths with a note).
- `.agent/jacked/data/README.md` — editing workflow, Manager shelf mapping, pack workflow.
- CI: assert catalog dirs exist under `.agent` (fail fast if someone deletes the tree).

## Success criteria

- No duplicate skills/agents/commands between package and `.agent`.
- `uv run python -m pytest` green from `backends/jacked`.
- Manager UI reads catalog from `.agent`; toggles install to Claude home dirs.
- Optional: standalone jacked CLI still works with env overrides or package fallback.
