# Multi-agent orchestration (Flowise + Cursor + Antigravity + dsh)

PixelOffice supports **three complementary patterns** for agents that use LLM, tools, and MCP:

| Pattern | Card agent | Cross-provider | Flowise |
|---------|------------|----------------|---------|
| **Single CLI** | Claude / Cursor / Antigravity | No | Card MCP or Cursor `mcp.json` |
| **Claude + API subagents** | Claude + Subagents seat (FPT.AI) | Claude-only children | Phase 2 MCP picker |
| **Orchestrator** | **Orchestrator (dsh)** | **Yes** — delegates to Cursor, Claude, Codex | Via `cursor_agent` + Flowise MCP |

See also: [`flowise-tool-backend.md`](./flowise-tool-backend.md) for the GitLab research AgentFlow reference.

## Architecture

```text
PixelOffice (3484)
├── Flowise :3010        — AgentFlow canvas (inner LLM + MCP + tools)
├── dsh web :3020        — optional (PIXELOFFICE_DSH_WEB=1)
└── Task card
     ├── Orchestrator (dsh headless)  → cursor_agent, subagent_claude_code, …
     ├── Cursor Agent                 → ~/.cursor/mcp.json (Flowise shim)
     └── Antigravity (agy)            → direct session; gemini mcp for tools
```

## 1. Orchestrator (DeepSeek Harness)

**When:** You need one task to delegate across Cursor, Claude Code, and Codex.

### Install

```bash
npm install -g @deepseek-ai/dsh
# or: npx @deepseek-ai/dsh --version
```

Optional product-subagent packages in `DSH_HOME` (default `~/.agent/dsh`) — **auto-installed on `pnpm run solo`** when missing:

```bash
# Manual fallback only:
export DSH_HOME=~/.agent/dsh
cd "$DSH_HOME" && npm install @deepseek-ai/dsh-tool-subagent @deepseek-ai/dsh-subagent-claude-code @deepseek-ai/dsh-subagent-codex @deepseek-ai/dsh-subagent-acp
```

Patch file (shipped): `backends/runtime/config/orchestrator/pixeloffice.patch.yml`

### Task card

1. Agent: **Orchestrator (dsh)**
2. Optional: **Subagents** seat (FPT.AI / API) — bills **Claude Code children** only
3. Prompt example:

```text
Research GitLab context via Flowise (ask cursor_agent to call run_agent), then implement
the fix in this worktree. Use cursor_agent for coding; use subagent_claude_code only if
Cursor is unavailable.
```

### Status

Agents sidebar panel + `tRPC: runtime.orchestrator.status`

### Optional web sidecar

```bash
PIXELOFFICE_DSH_WEB=1 pnpm run solo
# listens on http://127.0.0.1:3020 when dsh is installed
```

## 2. Flowise (inner LLM + tools + MCP)

Build **AgentFlow** in Agents tab with:

- LLM nodes → the **PixelOffice** palette category (seat-backed, no key) or
  **Flowise Credentials** (API keys per provider) for anything else
- MCP nodes → e.g. `https://code.akselos.com/repo/api/v4/mcp`
- Tool nodes → HTTP, RAG, Custom Function
- **Deploy** before use

Outer access:

| Outer agent | How to attach Flowise |
|-------------|----------------------|
| **Cursor** | Card MCP picker → auto-writes `{worktree}/.cursor/mcp.json` on launch |
| **Claude Code** | Card MCP picker → `flowise-*` (org allowlist required at Akselos) |
| **Antigravity** | Card MCP picker → auto-writes `{worktree}/.gemini/settings.json` on launch |
| **Orchestrator** | Card MCP picker → same Cursor project config for `cursor_agent` child |

Template: [`../examples/flowise-mcp.cursor.json`](../examples/flowise-mcp.cursor.json)

## 3. Antigravity (agy) direct session

**When:** Google Antigravity quota, single-agent work, no cross-delegation.

- Card agent: **Antigravity**
- Manager: Antigravity seat
- MCP: Gemini/Antigravity CLI native config (not Claude org allowlist)

```bash
# Gemini-family CLI (when agy exposes mcp):
gemini mcp add mytool <url> --transport http --scope user
```

Flowise: use **Orchestrator + cursor_agent** or call prediction API from a Custom Function node — agy does not share Cursor's `mcp.json`.

## 4. Cursor direct session

**When:** Cursor subscription, custom MCP (Flowise), no dsh.

- Card agent: **Cursor Agent**
- Attach Flowise via card MCP picker (`flowise-*`) — runtime writes project `.cursor/mcp.json` on launch
- Best path under **Akselos org MCP lock** on Claude

## Credential map

| Capability | Where configured |
|------------|------------------|
| Claude parent OAuth | Manager seat on card |
| Claude subagent API (FPT.AI) | Subagents seat on card |
| Cursor auth | `agent login` / `CURSOR_API_KEY` pin |
| Antigravity auth | Manager Antigravity pool |
| Flowise studio login | Auto (`pixeloffice@pixeloffice.local`) |
| Flowise **PixelOffice nodes** | Nothing to configure — the seat pinned in Manager (Claude / Cursor / Antigravity) |
| Flowise **other LLM nodes** | Flowise Credentials in Agents tab |
| Flowise **inner MCP** | MCP nodes in canvas |
| dsh primary model | `DSH_HOME` profile / DeepSeek API key in dsh settings |

## Quick start checklist

- [ ] `pnpm run solo` — Flowise :3010 up
- [ ] Deploy AgentFlow (LLM + GitLab MCP + tools)
- [ ] `print-flowise-mcp-config.mjs` → `~/.cursor/mcp.json`
- [ ] `npm i -g @deepseek-ai/dsh` (for orchestrator)
- [ ] Card: **Orchestrator (dsh)** OR **Cursor** for simpler single-agent flow
- [ ] Subagents seat on orchestrator/claude cards when using FPT.AI for Claude children

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/print-flowise-mcp-config.mjs` | Cursor MCP snippets for deployed flows |
| `scripts/dsh-orchestrator-spike.mjs` | Manual headless dsh test in a worktree |
| `scripts/flowise-mcp-shim.mjs` | stdio MCP → Flowise prediction API |

## Related code

| Path | Role |
|------|------|
| `src/orchestrator/orchestrator-launch.ts` | dsh headless argv + env |
| `src/orchestrator/orchestrator-process.ts` | Optional web sidecar :3020 |
| `src/flowise/flowise-mcp.ts` | Claude card Flowise MCP |
| `src/core/agent-catalog.ts` | `orchestrator` agent id |
