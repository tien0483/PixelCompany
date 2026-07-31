# Claude-only + multi-account — implementation notes (2026-07-30)

Follow-up run. Brief: `00_input/07_claude-only-multi-account_brief.md`. Layout contract
(`01_layout-architect_contract.md`) unchanged; extends `03_jacked-accounts-watch_notes.md`.

Executed inline rather than via the agent team (session policy forbade spawning subagents);
the skill's phase order, artifact layout and test scenarios were followed.

## 1. Claude-only gate (reversible)

Single seam: `RUNTIME_LAUNCH_SUPPORTED_AGENT_IDS` in `backends/runtime/src/core/agent-catalog.ts`
is now `["claude"]` with the rest commented out. Everything else derives from it —
`normalizeAgentId` coerces persisted ids, `getCuratedDefinitions` filters what the UI sees, and the
Cline settings section / chat panel / model picker are already keyed on `selectedAgentId === "cline"`.
`DEFAULT_AGENT_ID` and `AUTO_SELECT_AGENT_PRIORITY` in `config/runtime-config.ts` moved to Claude.

One hardcoded list needed gating: `ONBOARDING_AGENT_IDS` in
`task-start-agent-onboarding-carousel.tsx` now filters through `isRuntimeAgentLaunchSupported`, and
its `?? "cline"` controller fallback became `"claude"` (that fallback would have fetched the Cline
provider catalog, pulling the gated SDK routes).

**Not done:** lazy-loading `@clinebot/core` out of the boot path (`runtime-api.ts:10-14` still
imports the Cline services eagerly). It costs a module load, not a process, and `AGENTS.md` forbids
inline imports inside modules — deferred rather than half-done.

## 2. Runtime owns jacked

New `backends/runtime/src/jacked/jacked-process.ts` spawns
`python -m jacked webux --host 127.0.0.1 --port 8321 --no-browser`, wired in `cli.ts` next to
`createJackedClient` and stopped in `close()`. Behaviour:

- Probes the port first and **does not** double-spawn when jacked is already listening.
- Readiness is awaited in the background, so board/PTY/office never wait on Python.
- Missing package or interpreter → warning + install hint; the runtime keeps running.
- POSIX: detached, killed by process group. Windows: tree-kill through `terminateProcessForTimeout`.
- `webux` was verified to start no tray/menubar; `--host 127.0.0.1` keeps the remote-access DB
  setting out of play.

`scripts/start-stack.mjs` no longer spawns Python (still frees `:8321` on `--restart` so a stale
service can't shadow the runtime's child).

New `scripts/solo.mjs`: single-URL mode. Builds the UI if needed, then runs the runtime alone.
Flags: `--restart`, `--skip-build`, `--build`, `--no-open`; port via `PIXELOFFICE_PORT`.

Two latent bugs surfaced while booting it:

- `getWebUiDir()` in `server/assets.ts` resolved the monorepo dist one directory too high
  (`../../../` from `src/server` lands in `backends/`, not the repo root) — solo mode could never
  have served the built UI. Fixed to `../../../../`.
- Both launchers only looked for `tsx`/`vite` in package-local `node_modules`; a workspace install
  hoists them to the root. Both now resolve either location.

## 3. Ported Jacked surfaces

Bridge: `updateAccount`, `deleteAccount`, `validateAccount`, `reorderAccounts`,
`startAccountReauth`, `fetchActiveSessions`, `fetchAccountLaunchDir` on the client;
matching `jacked.*` tRPC procedures behind the existing `refuseNonClaudeAccount` guard.
`startClaudeOAuth` and re-auth now share one `startOAuthFlow` helper (both jacked endpoints return
the same flow handle). OAuth completion copy changed "added" → "authorized" since the flow is shared.

UI: `jacked-account-actions.tsx` (re-auth / validate / enable-disable / delete-with-confirm /
priority up-down) and `use-jacked-sessions.ts` (15s poll, grouped per account) feeding a
"N live" chip on each account row.

**Deviation from the plan:** priority uses explicit up/down moves instead of `@hello-pangea/dnd`.
The pane is ~300px wide, jacked's endpoint wants the full order either way, and arrows are keyboard
accessible. `moveAccount()` builds the complete id order per move.

## 4. Per-task account pinning

- Python: `POST /api/auth/accounts/{id}/launch-dir` in `api/routes/auth.py` delegates to
  `jacked.launch.prepare_account_dir` (the `jacked claude <id>` path) through `asyncio.to_thread`,
  because that function calls `asyncio.run()` internally and would explode on the event loop.
  Claude-only; returns jacked's normal 404/400 envelopes.
- Runtime: `jackedAccountId` added to the session-start request, the task summary and the board
  card schema. `jacked-account-pin.ts` turns a pin into `{CLAUDE_CONFIG_DIR}` and **never fails a
  launch** — jacked offline or refusing means the session runs unpinned on the active credential.
  `session-manager` already merged `request.env` into the PTY, so no adapter change was needed.
- UI: `TaskAccountPicker` in the card detail strip, `setTaskJackedAccount` in board-state (pins
  survive other card edits because `updateTask` spreads the card), `App.tsx` handler.

**macOS caveat (documented, not fixed):** `prepare_account_dir` also writes the shared Keychain
entry because Claude Code reads Keychain before the config dir on darwin, so a pin there moves the
global identity too. Windows/Linux are fully isolated. Noted in the route docstring and TECH_STACK.

## Test scenarios (skill)

- **Normal:** solo mode booted; `GET /` served the built app, `jacked.state` and
  `jacked.activeSessions` answered 200 through the single origin, `/api/jacked-proxy/api/health`
  returned `{"status":"ok","db":true}`, and the runtime log showed
  `jacked listening on 127.0.0.1:8321 (headless)`.
- **Error:** unknown-account `launch-dir` returns jacked's 404 envelope; pin resolver unit tests
  cover jacked offline / blank dir / throw → unpinned launch, never a failure.

## Results

| Suite | Result |
|-------|--------|
| runtime `tsc --noEmit` | clean |
| runtime vitest (jacked, config, agent-registry, workspace-api) | 48 passed |
| web vitest (full) | 530 passed / 77 files |
| web `tsc --noEmit` | 4 pre-existing files (see below) |
| e2e `playwright.solo.config.ts` | 9 passed, 2 skipped |
| e2e `tests/office.spec.ts` | 6 passed |

Pre-existing / environmental failures left alone:

- 14 runtime unit failures under `test/runtime/{workspace,trpc,terminal,cline-sdk}` are Windows
  path/quoting assertions (`C:\tmp` vs `/tmp`, `'x'` vs `"x"`) — RISK_MITIGATIONS §3 debt.
- Frontend `tsc` errors in `officeState.port.test.ts`, `layoutSerializer.port.test.ts`,
  `office-jacked-semantics.test.ts` (zod `.default()` input/output mismatch on `stale`), and
  `vite.config.ts` (newer rollup types pulled by the re-resolved install).

Test expectations updated because the product changed (not to make red go green):

- `runtime-config.test.ts` — default/coercion now Claude; the concurrency regression switched to
  two observable non-default keys since `selectedAgentId` always reads back as `claude`.
- `agent-registry.test.ts` — curated list is `["claude"]`; probe count derives from
  `RUNTIME_AGENT_CATALOG.length + 1` (was a stale hardcoded 8 against an 8-entry catalog + npx).
- `native-agent.test.ts` — the fallback agent in the fixture must itself be launch-supported.
- `office.spec.ts` — dropped multi-provider expectations that contradicted the shipped Claude-only
  meter wall (this spec was already red before this run).
- `office-e2e-harness.tsx` — fixture account 2 is now enabled, so "Use Account" is exercisable.

## Environment notes

`Edit(**/package.json)` is denied by the org-managed policy in `~/.claude/remote-settings.json`, so
the user added the npm aliases by hand: root `solo`, `test:e2e`, `test:e2e:solo`, plus `e2e:solo` in
the web package. All four verified working after that.

Plain `npm install` fails on dedupe (root `package.json` has no `version` field) — use
`npm install --install-links`. That install also rewrote the root `package-lock.json`.

Both Playwright suites now skip, with actionable messages, on preconditions they cannot create:
a running runtime (dev config starts only Vite) and a registered project (writing one would touch
the user's real `~/.cline/kanban` config). `npm run test:e2e` → 6 passed / 4 skipped;
`npm run test:e2e:solo` → 9 passed / 2 skipped.
