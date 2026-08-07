# PixelOffice Manager catalog

Repo-local **Manager catalog** for Claude Code resources. Jacked reads this tree
instead of the Python package for:

| Path | Manager shelf | Installed to |
|------|---------------|--------------|
| `data/skills/` | Training | `~/.claude/skills/<name>/` |
| `data/agents/` | Staff | `~/.claude/agents/<name>.md` |
| `data/commands/` | Playbooks | `~/.claude/commands/<name>.md` |
| `data/rules/` | Handbook | `~/.claude/CLAUDE.md` (rules block) |
| `data/packs.json` | Training → Packs | via `npx skills` |

Runtime assets (hooks, web dashboard, lenses, guardrails, git-hooks, templates)
live in `runtime/` beside this catalog.

Override catalog: `PIXELOFFICE_AGENT_MANAGER_DATA=/absolute/path/to/data`
Override runtime: `PIXELOFFICE_AGENT_MANAGER_RUNTIME=/absolute/path/to/runtime`

Legacy env names `PIXELOFFICE_AGENT_JACKED_*` still work.

**Edit catalog here** — the Python package no longer ships duplicate assets.
