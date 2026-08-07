# Agent data layout

PixelOffice keeps every agent asset it ships under this one `agent-data/` root, beside
`frontends/` and `backends/`. The upstream project name “jacked” is legacy; in PixelOffice
the catalog feeds the **Manager** surface (Seats, Staff, Playbooks, Training, Handbook).

## Layout

```
agent-data/
  manifest.json    # declares every source: id, root, owner, kinds, toggleable
  catalog/         # skills, agents, commands, rules, packs.json  — toggleable
  runtime/         # hooks, web, lenses, guardrails, git-hooks, templates, plugin stub
  templates/       # html_anything's template skills — role-bound
```

Before this, the catalog and runtime assets lived under `.agent/manager/` and the
template skills under `backends/html_anything/next/src/lib/templates/skills`. Nothing
owned "agent data", so every consumer hardcoded a path of its own — which is how a
Manager shelf toggle ended up writing to `~/.claude` no matter which project was
selected. The old locations remain as resolver fallbacks so an un-migrated checkout
still boots.

## manifest.json

Each source declares `toggleable`:

- `true` — the Manager shelves may install and uninstall its entries. Only
  `agent-data/catalog` is toggleable.
- `false` — bound to a backend's role (html_anything's templates, Manager's hooks and
  web UI). Never offered as a user toggle.

Backends added later need no manifest edit: any `backends/<name>/.claude` or
`backends/<name>/.agent` is auto-discovered as a role-bound source owned by `<name>`.
Add a manifest entry for that same root only to override the default — for example to
opt a new backend's assets into the shelves. `backends/runtime/test/runtime/state/agent-data-manifest.test.ts`
fails if a directory on disk is neither declared nor discoverable.

## Resolution

`backends/manager/manager/data_paths.py`

- `get_catalog_data_root()` → `agent-data/catalog` (fallback `.agent/manager/data`)
- `get_runtime_data_root()` → `agent-data/runtime` (fallback `.agent/manager/runtime`)

`backends/runtime/src/state/agent-data-manifest.ts` reads the manifest and lists sources.
`backends/html_anything/next/src/lib/agent-data-root.ts` resolves `agent-data/templates/skills`.

Env overrides: `PIXELOFFICE_AGENT_MANAGER_DATA`, `PIXELOFFICE_AGENT_MANAGER_RUNTIME`,
`PIXELOFFICE_AGENT_DATA`. The runtime spawn (`manager-process.ts`) sets the first two.

## Install model

The catalog is **per project**. Toggling a shelf entry ON copies it into the currently
selected project's `.claude/<kind>/`, not into `~/.claude`; per-project state lives in
the workspace meta under `~/.agent/kanban/workspaces/<id>/meta.json`. Hook features
(sounds, memory vault, statusline) stay global — they patch `~/.claude/settings.json`
and the Claude Code statusline, where per-project has no meaning.

## Success criteria

- No duplicate catalog or runtime assets under `backends/manager/manager/data/`.
- `uv run python -m pytest` green from `backends/manager`.
- Manager UI reads the catalog from `agent-data/catalog`.
