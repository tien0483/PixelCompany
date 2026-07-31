# Brief — Claude-only Kanban + Jacked multi-account (2026-07-30)

Follow-up run on the existing `_workspace/pixeloffice-merge/` (partial scope; layout contract in
`01_layout-architect_contract.md` unchanged, Claude-only accounts work in
`03_jacked-accounts-watch_notes.md` extended).

## Question that triggered it

"Why does the kanban need to start the cline runtime when I only use Claude Code OAuth? Can the
python account manager come into kanban so I start only the kanban, with Claude OAuth and several
accounts controlled at once?"

## Finding

`backends/runtime` **is** the Kanban server (npm `kanban`, `github.com/cline/kanban`) — board state,
PTY, git and the Jacked bridge. It never spawns a Cline process. What is Cline-specific and optional:
`src/cline-sdk/` + `@clinebot/*` (in-process native agent), `DEFAULT_AGENT_ID = "cline"`, the `cline`
catalog entry, and the `cline-*` UI panels.

Jacked is already bridged (client → `jacked-api.ts` → native views). The real gap is concurrency:
Jacked swaps one global credential file, but `jacked/launch.py:prepare_account_dir()` already builds
`~/.claude/accounts/<id>/` for `CLAUDE_CONFIG_DIR` isolation (CLI-only, no HTTP route), and
`claudeAdapter.prepare()` can already inject per-session env.

## Scope (approved plan)

1. Claude-only gate, reversible (catalog + default agent + Cline UI gating).
2. Runtime supervises headless Jacked; `start-stack.mjs` slimmed; `npm run solo` single-process mode.
3. Port remaining Jacked surfaces: account actions (reauth/validate/enable/delete), swap-priority
   reorder, live sessions per account.
4. Per-task account pinning: new Jacked `launch-dir` route → runtime threads `jackedAccountId` →
   `CLAUDE_CONFIG_DIR` per PTY session. Unpinned tasks keep global auto-swap.
5. Docs + change log.

## Constraints carried over

- No nested `kanban/` or `claude-jacked-master/` donor folders (`06_flatten_stack_notes.md`).
- Claude-only, OAuth-only Add Account; no API-key paste (`03_jacked-accounts-watch_notes.md`).
- Cline gated, not deleted — keeps the vendored-merge path cheap (`RISK_MITIGATIONS.md` §1).
- Product chrome never embeds or deep-links the `:8321` dashboard.
