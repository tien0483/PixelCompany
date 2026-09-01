# Multi-agent orchestration (Flowise + Cursor + Antigravity + dsh)

PixelOffice supports **three complementary patterns** for agents that use LLM, tools, and MCP:

| Pattern | Card agent | Cross-provider | Flowise |
|---------|------------|----------------|---------|
| **Single CLI** | Claude / Cursor / Antigravity | No | Card MCP or Cursor `mcp.json` |
| **Claude + API subagents** | Claude + Subagents seat (FPT.AI) | Claude-only children | Phase 2 MCP picker |
| **Custom Agent** | **Custom Agent (dsh)** | **Yes** — delegates to Cursor, Claude, Codex | Native: one `dsh-mcp-client` row per picked flow |

See also: [`flowise-tool-backend.md`](./flowise-tool-backend.md) for the GitLab research AgentFlow reference.

## Architecture

```text
PixelOffice (3484)
├── Flowise :3010        — AgentFlow canvas (inner LLM + MCP + tools)
├── dsh web :3020        — optional (PIXELOFFICE_DSH_WEB=1)
└── Task card
     ├── Custom Agent (dsh headless)  → cursor_agent, subagent_claude_code, mcp__<flow>__*
     ├── Cursor Agent                 → ~/.cursor/mcp.json (Flowise shim)
     └── Antigravity (agy)            → direct session; gemini mcp for tools
```

## 1. Custom Agent (DeepSeek Harness)

**When:** You need one task to delegate across Cursor, Claude Code, and Codex.

### Install

```bash
npm install -g @deepseek-ai/dsh
# or: npx @deepseek-ai/dsh --version
```

Product plugins live in the **task profile**, `$DSH_HOME/profiles/headless` (default
`~/.agent/dsh/profiles/headless`) — dsh resolves out-of-tree plugins from the dsh installation
first and then from the profile's own `node_modules`, never from `$DSH_HOME` itself.
**Auto-installed on `pnpm run solo`** when missing:

```bash
# Manual fallback only:
export DSH_HOME=~/.agent/dsh
dsh plugin --profile headless add \
  @deepseek-ai/dsh-tool-subagent @deepseek-ai/dsh-subagent-claude-code \
  @deepseek-ai/dsh-subagent-codex @deepseek-ai/dsh-subagent-acp @deepseek-ai/dsh-mcp-client
```

Patch file (shipped): `backends/runtime/config/orchestrator/pixeloffice.patch.yml`. Its rows add
new plugin ids, so they sit under `insert:` — a bare top-level entry only overrides a row that
already exists. Inspect the composed tree with:

```bash
dsh --profile headless --patch backends/runtime/config/orchestrator/pixeloffice.patch.yml --dump-config
```

### Launcher grammar (do not add flags)

The dsh launcher parses only `--profile`, `--patch`, `--resume`, `--help`, `--version`,
`--dump-config`, `--dump-default-config`, and hands **everything from the first token it does not
recognize** to the booted profile. The headless app then reads the *positional* argument as its
task. So the launch is:

```text
dsh --profile headless --patch <shipped> [--patch <generated flowise overlay>] "<prompt>"
```

There is no `--prompt`, no `--cwd` (the PTY already spawns in the worktree) and no `--force`; any
of them would silently become the task text instead of the card's prompt.

### Task card

1. Agent: **Custom Agent (dsh)**
2. **Custom agent (flow)**: pick one or more deployed Flowise flows. Each becomes a
   `@deepseek-ai/dsh-mcp-client` row in a per-launch `--patch` overlay, so the harness itself
   holds the canvas as `mcp__<flow>__<tool>` — no `cursor_agent` hop required.
3. Optional: **Subagents** seat (FPT.AI / API) — bills **Claude Code children** only
4. Prompt example:

```text
Research GitLab context with the Flowise tool, then implement the fix in this worktree.
Use cursor_agent for coding; use subagent_claude_code only if Cursor is unavailable.
```

### Custom Agent LLM (no DeepSeek key needed)

dsh mounts `@deepseek-ai/dsh-llm-pi-ai` — a generic multi-provider adapter — but ships it with
**no config**, so it registers no routes, and `agent-default-model` points at `deepseek-official`.
`orchestrator-llm-patch.ts` generates a second `--patch` overlay that configures the first row and
repoints the second at PixelOffice's own seat-backed proxy, so the orchestrator bills the Manager
seat the card already pins.

Both ids exist in the composed tree, so those rows are plain **overrides** — unlike the Flowise
rows, which introduce new ids and need `insert:`.

| Env | Default | Meaning |
|-----|---------|---------|
| `PIXELOFFICE_DSH_LLM_PROVIDER` | `cursor` | `cursor` \| `openai` \| `anthropic` \| `gemini`, or `deepseek` to keep dsh's own route |
| `PIXELOFFICE_DSH_LLM_MODEL` | per provider | Overrides the model id |

Route status, measured against the live proxy on 2026-09-01:

| Route | pi-ai route | Result |
|-------|-------------|--------|
| `/cursor` | `openai` | **Works** — full dsh turn completed on the Cursor seat |
| `/openai` | `openai` | 200; same OmniRoute upstream as `/cursor` |
| `/anthropic` | `anthropic` | Seat bearer accepted; was rate-limited (429) at the time |
| `/gemini` | `google` | **Broken upstream** — `403 ACCESS_TOKEN_SCOPE_INSUFFICIENT`; the seat's OAuth token is not scoped for `generativelanguage.googleapis.com`. Affects the Flowise Gemini node too, not just dsh. |

Models are **declared outright**, never inherited: the seat routes serve ids pi-ai's shipped
catalog does not know (`auto/best-coding` is OmniRoute's), and an undeclared id fails with
`UNKNOWN_MODEL` before any request leaves the process.

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
| **Custom Agent** | **Custom agent (flow)** picker → native `dsh-mcp-client` row; the card's other MCP servers still reach the `cursor_agent` child through `.cursor/mcp.json` |

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

Flowise: use **Custom Agent** or call the prediction API from a Custom Function node — agy does not share Cursor's `mcp.json`.

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
| Custom Agent (dsh) model | **Seat-backed by default — no key.** A generated `--patch` overlay points dsh's own `llm-pi-ai` row at `/api/flowise-llm-proxy/<provider>`; see "Custom Agent LLM" below. `PIXELOFFICE_DSH_LLM_PROVIDER=deepseek` restores dsh's DeepSeek route, which then needs `DEEPSEEK_API_KEY`. |

## Quick start checklist

- [ ] `pnpm run solo` — Flowise :3010 up
- [ ] Deploy AgentFlow (LLM + GitLab MCP + tools)
- [ ] `print-flowise-mcp-config.mjs` → `~/.cursor/mcp.json`
- [ ] `npm i -g @deepseek-ai/dsh` (for Custom Agent)
- [ ] Card: **Custom Agent (dsh)** + a flow under **Custom agent (flow)**, OR **Cursor** for a simpler single-agent flow
- [ ] Subagents seat on Custom Agent / Claude cards when using FPT.AI for Claude children

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
| `src/orchestrator/orchestrator-flowise-patch.ts` | Generated `dsh-mcp-client` patch overlay |
| `src/orchestrator/orchestrator-llm-patch.ts` | Generated LLM overlay — seat-backed proxy instead of DeepSeek |
| `src/flowise/flowise-mcp.ts` | Deployed-flow resolution + Claude card Flowise MCP |
| `src/flowise/flowise-mcp-id.ts` | `flowise-*` id helpers shared with the frontend picker |
| `src/core/agent-catalog.ts` | `orchestrator` agent id (label: **Custom Agent (dsh)**) |
