# PixelOffice Jacked catalog

Repo-local **Manager catalog** for Claude Code resources. Jacked reads this tree
instead of `backends/jacked/jacked/data/` for:

| Path | Manager shelf | Installed to |
|------|---------------|--------------|
| `skills/` | Training | `~/.claude/skills/<name>/` |
| `agents/` | Staff | `~/.claude/agents/<name>.md` |
| `commands/` | Playbooks | `~/.claude/commands/<name>.md` |
| `rules/` | Handbook | `~/.claude/CLAUDE.md` (rules block) |
| `packs.json` | Training → Packs | via `npx skills` |

Hooks, web dashboard, lenses, and git-hooks remain in the Python package
(`backends/jacked/jacked/data/`) until [runtime unfold](../UNFOLD.md) phase 2.

Override path: `PIXELOFFICE_AGENT_JACKED_DATA=/absolute/path/to/data`.

**Edit catalog here** — the package no longer ships duplicate `skills/`, `agents/`,
`commands/`, `rules/`, or `packs.json`.
