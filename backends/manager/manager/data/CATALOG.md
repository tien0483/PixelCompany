# Assets moved to `agent-data/`

All Manager data now lives in the PixelOffice repo, under the single top-level
`agent-data/` root beside `frontends/` and `backends/`:

| Path | Contents |
|------|----------|
| `agent-data/catalog/` | Catalog — skills, agents, commands, rules, packs |
| `agent-data/runtime/` | Hooks, web UI, lenses, guardrails, git-hooks, templates |

Both previously sat under `.agent/manager/`; `data_paths.py` still falls back there so an
un-migrated checkout resolves.

The Python package (`backends/manager`) is code-only for PixelOffice.

See `agent-data/UNFOLD.md`.
