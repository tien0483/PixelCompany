# Flowise as a task tool backend

Use a **deployed AgentFlow** as a specialist worker while a **task-card session agent**
(Cursor or Claude Code) owns the git worktree. The session agent calls the flow through a
single MCP tool (`run_agent`); Flowise runs LLM nodes, canvas tools, and inner MCP inside
`:3010`.

## Two layers

```text
OUTER (task card)                 INNER (Flowise :3010)
─────────────────                 ─────────────────────
Cursor / Claude Code              AgentFlow canvas
  edits repo                        LLM + tools + MCP
  ~/.cursor/mcp.json or card MCP    Flowise Credentials (LLM keys)
  run_agent(question) ──POST──►   /api/v1/prediction/<flowId>
  ◄──────── final text ──────────
```

Inner MCP (configured in the Agents tab) runs from the **Flowise process**. It does not use
Claude Code org `allowedMcpServers`. Outer MCP on the card is a separate registry.

**Full stack (Orchestrator + Antigravity + Cursor):** see
[`multi-agent-orchestration.md`](./multi-agent-orchestration.md).

## Reference AgentFlow: GitLab research → structured handoff

Build this in the **Agents** tab as an **AgentFlow** (not a plain chatflow). Goal: given a
task question, use GitLab MCP to gather facts, reason with an LLM, return a **patch brief**
the Cursor task agent can implement.

### Canvas layout

```text
[Start]
   │
   ▼
[Agent / LLM node]  ← system prompt (see below)
   │                  tools attached:
   │                    • Custom MCP → GitLab
   │                    • (optional) HTTP Request, Calculator, Retriever
   ▼
[End / output]
```

### System prompt (Agent node)

```text
You are a research agent for PixelOffice tasks. You do NOT edit the repository.

When given a question:
1. Use GitLab MCP to find relevant issues, MRs, or file context on code.akselos.com.
2. Summarize findings in plain language.
3. Return a structured handoff the coding agent can execute:

## Summary
(one paragraph)

## Evidence
(bullets with links or refs from GitLab)

## Suggested changes
(file paths and concrete edits — no full patches unless small)

## Open questions
(anything the coding agent should confirm)

Stay within MCP and tools on this canvas. Do not invent URLs or issue ids.
```

### Inner GitLab MCP (Flowise studio)

Add a **Custom MCP Server** (or MCP Tool node) in the canvas:

| Field | Value |
|-------|--------|
| URL | `https://code.akselos.com/repo/api/v4/mcp` |
| Transport | SSE (Flowise default for remote MCP) |
| Auth | OAuth / token as required by your GitLab instance |

This is the same endpoint family as the org allowlisted GitLab MCP. Here it is invoked by
**Flowise on loopback**, not by Claude Code on the card.

### LLM credential (Flowise → Credentials)

Every **Chat Model** node needs a credential in the studio:

| Provider | Typical use |
|----------|-------------|
| Anthropic | Claude inside the flow |
| OpenAI | GPT inside the flow |
| DeepSeek / OpenRouter | Cheaper research model |

These keys are **only** for hops inside the canvas. They are not Manager OAuth, FPT.AI
subagent seats, or Cursor subscription.

**Deploy** the flow when the canvas is ready. Only deployed flows appear in the MCP picker
and answer the prediction API.

## Wire the outer task agent

### Option 1 — Cursor Agent (recommended under org MCP lock)

Copy [`../examples/flowise-mcp.cursor.json`](../examples/flowise-mcp.cursor.json) into
`~/.cursor/mcp.json` (merge with existing servers). Set `PIXELOFFICE_FLOWISE_FLOW_ID` to
your deployed flow uuid.

Generate snippets from live studio:

```bash
node backends/runtime/scripts/print-flowise-mcp-config.mjs
node backends/runtime/scripts/print-flowise-mcp-config.mjs --flow-id <uuid>
```

Card settings: **Agent = Cursor Agent**, pin Cursor seat if needed.

### Option 2 — Claude Code card MCP picker

1. Start task with **Claude Code**.
2. Launch settings → **MCP** → select `flowise-<uuid>`.
3. Requires org allowlist for the shim `serverCommand` (Akselos: contact it@akselos.com).

Runtime injects `scripts/flowise-mcp-shim.mjs` via `--mcp-config --strict-mcp-config`.

## Task prompt template (Cursor + mixed flow)

Paste into the card prompt or first message:

```text
Workflow:
1. Call the Flowise tool `run_agent` with a question that includes the ticket/MR context
   and what you need researched on GitLab.
2. Read the handoff (Summary, Evidence, Suggested changes).
3. Implement suggested changes in this worktree, run tests, and summarize what you changed.

Research question for run_agent:
<describe the bug, paths, or GitLab issue here>
```

## Checklist

- [ ] `pnpm run solo` — Flowise online on `http://127.0.0.1:3010`
- [ ] AgentFlow built: LLM + GitLab MCP + deploy
- [ ] LLM credentials saved in Flowise studio
- [ ] Outer MCP configured (Cursor `mcp.json` or Claude picker + org allowlist)
- [ ] Task agent selected (Cursor recommended)
- [ ] Prompt uses `run_agent` then implements in repo

## Limitations

| Want | Status |
|------|--------|
| Flowise LLM billed to Manager Claude OAuth / API seat | Phase 3 stub only — `runtime.flowise.llmProxyStatus`; set `PIXELOFFICE_FLOWISE_LLM_PROXY=1` when implemented |
| Same MCP registry on card and canvas | Manual duplicate config |
| Claude `.claude/skills` inside Flowise | Encode behavior in AgentFlow prompt/nodes |
| One subscription for all LLM hops | Task agent seat + Flowise credentials are separate |

## Related code

| File | Role |
|------|------|
| `scripts/flowise-mcp-shim.mjs` | stdio MCP → prediction API |
| `src/flowise/flowise-mcp.ts` | Phase 2 inventory + Claude launch config |
| `src/flowise/flowise-process.ts` | Sidecar supervisor; strips inherited `ANTHROPIC_*` |
