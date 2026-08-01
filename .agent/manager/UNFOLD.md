# Manager data layout

PixelOffice keeps Manager assets under `.agent/manager/` (not the Python package).
The upstream project name “jacked” is legacy; in PixelOffice this is the **Manager**
surface (Seats, Staff, Playbooks, Training, Handbook).

## Layout

```
.agent/manager/
  data/          # catalog — skills, agents, commands, rules, packs.json
  runtime/       # hooks, web, lenses, guardrails, git-hooks, templates, plugin stub
```

Resolution: `jacked/data_paths.py`

- `get_catalog_data_root()` → `.agent/manager/data`
- `get_runtime_data_root()` → `.agent/manager/runtime`

Runtime spawn (`jacked-process.ts`) sets `PIXELOFFICE_AGENT_MANAGER_DATA` and
`PIXELOFFICE_AGENT_MANAGER_RUNTIME`.

## Phase 3 — install model (future)

- **`.agent` as source of truth** — enable/disable toggles distribute to `~/.claude/skills`,
  `~/.claude/agents`, `~/.claude/commands` without copying into package paths.
- **`.disabled` markers** or state file under `~/.agent` for toggles without deleting catalog files.

## Success criteria

- No duplicate catalog or runtime assets in `backends/jacked/jacked/data/`.
- `uv run python -m pytest` green from `backends/jacked`.
- Manager UI reads catalog from `.agent/manager/data`.
