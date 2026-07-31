# PixelOffice — Handover for Overall Review

Snapshot for a fresh session doing an end-to-end review. Read this first, then the linked docs. Everything below is verified against the actual codebase and test runs (not self-reported).

## 1. What this project is
Extending **`pixel-agents-main/`** (a TS monorepo: `core/`, `server/`, `webview-ui/`, `adapters/vscode/`) — a VS Code extension + standalone web app that renders AI agents as characters in a pixel-art office — into an **authorable RPG office**: draw your own furniture sprites, place persistent NPCs, control agents, and **record/replay/script** scenarios. Local AI is via **Ollama** (`http://localhost:11434`), called directly from the Node server. No Python ships in the product.

## 2. Documents (read in this order)
- **`EXECUTION_PLAYBOOK.md`** — the task list (Epics A–D), progress tracker, per-task steps/tests/acceptance, global rules. Authoritative for scope.
- **`PIXEL_AGENTS_INTEGRATION_REPORT.md`** — architecture + role-by-role investigation (§9 = authoritative target).
- **`SPRITEGEN_DESIGN.md`** — sprite editor data model, protocol schemas, freeform-sizing math.
- **`pixel-agents-main/CLAUDE.md`** — the codebase's own architecture reference.
- This file — current state, what changed, known issues.

## 3. Feature status (Epics A–D)
All epics are **code-complete and build/lint green**. Quality varies — see §6.

| Epic | Feature | State |
|---|---|---|
| A1–A4 | Draw sprite → `saveCustomAsset` → placeable furniture | Done, tested (server) |
| A5 | Rotation groups in editor | Done |
| A6 | Deterministic sketch→pixel (downscale/quantize) | Done |
| A7 | Ollama sprite generate/refine | Done (no dedicated test) |
| B1–B4 | Persistent NPC roster + scripted-action FSM + editor tool | Done, tested (officeState) |
| C1 | Control mode (click-to-move + `pinnedTile`) | Done, fixed (right-click gate), tested |
| C2 | `sendAgentRequest` (VS Code-only, idle-gated TTY inject) | Done |
| D1–D2 | Scenario format + recorder | Done, tested |
| D3–D4 | `ReplayTransport` + controls + faithful pause (`timeScale`) + seek | Done (fixed: `timeline`→`events`, `window` hack, seek race, EOF freeze) |
| D5 | Narration overlay + styled summarizer (roleplay/caveman via Ollama) | Done, tested (narrator) |
| D6 | Roleplay-from-script scene scheduler | Done, `wander` fixed + tested; **`say` still shows a placeholder bubble, not text** (§6) |
| D7 | From-transcript importer (virtual clock) | Done, tested (fixed monotonic-tMs bug) |

## 4. Current verified state (run by me, this machine — Windows)
- **`npm run build`** → **exit 0** ✅ (extension + CLI + webview `tsc -b` + vite).
- **`npm run lint`** → **exit 0** ✅ (adapters/server/core + webview pixel rules).
- **`npm run test:webview`** → **50/50 pass** ✅ (incl. new `roleplayScene.test.ts` + `officeState.test.ts`).
- **`npm run test:server`** → **270 pass / 9 fail (2 files)** — the 9 failures are **pre-existing, Windows-only, not from our work** (see §6). All our new server tests pass.

> **CRITICAL process rule:** `npm run check-types` does **not** type-check `webview-ui`, and Vitest strips types without checking. Earlier "green" claims were false because of this. **The only trustworthy gate is `npm run build && npm run lint` (+ `test:server`/`test:webview`), with exit codes read.** Do not trust `check-types` alone for webview changes.

## 5. Fixed this session
- **Server test isolation (Windows):** added `server/vitest.setup.homedir.ts` (wired in `server/vitest.config.ts`) making `os.homedir()` honor `process.env.HOME`. This fixed 5 previously-failing files (configPersistence, migrateVsCodeState, fileStateAdapter, clientMessageHandler, scenarioRecorder) that broke because Windows `os.homedir()` reads `USERPROFILE`, not `HOME`, so they read the dev-polluted real `~/.pixel-agents`.
- **`scenarioRecorder.test.ts` + `scenarioFromTranscript.test.ts` hygiene:** isolated to a temp `HOME`; mocked `scenarioNarrator` so `stop()` never calls Ollama during tests.
- **`scenarioFromTranscript.ts` real bug:** the importer stamped the initial agent-registration event with a real clock time (~1ms) before the virtual clock was installed → non-monotonic `tMs`. Now installs the virtual clock (and resets `startedAt=0`) **before** the first store mutation. Test passes.
- **D6 `wander` was a no-op:** `characters.ts` suppressed all wander when `isReplayMode` (correct for recorded agents, wrong for authored NPCs). Changed the guard to `(!isReplayMode || ch.isNpc)`, and `roleplayScene` now sets a spawned NPC's `wanderTimer` high so it stays put until a `wander` action fires. Added `webview-ui/test/roleplayScene.test.ts` (spawn/walkTo/wander/despawn).

## 6. Known-remaining issues (prioritized — for the reviewer / next worker)

### High
1. **D6 `say` does not render the spoken text.** `roleplayScene.ts` `say` calls `showWaitingBubble()` (a checkmark sprite) and **ignores `args.text`**. There is no text-bubble system. Fix needs either a real speech bubble or routing `say` text to the narration overlay. Currently misleading.
2. **No tests for the webview replay engine.** `replayTransport` (seek clear-and-replay, EOF freeze), `spriteGen`/`ollamaClient`, and the pixel-editor UI (A3) have **zero tests** — and that layer is where the D3/D4/D6 bugs kept appearing. Add unit tests. No **e2e** exists for any new feature (all 12 Playwright specs are pre-existing).

### Medium
3. **Ollama shutdown can hang.** `chatGridStream` has **no timeout/AbortController** ([ollamaClient.ts](pixel-agents-main/server/src/providers/ai/ollamaClient.ts)). `recorder.stop()` runs two Ollama calls during `Ctrl+C`; if Ollama is up-but-slow, shutdown blocks until SIGKILL. Add a timeout. Also add an `isShuttingDown` guard in `cli.ts` (double-`Ctrl+C` re-enters `shutdown()`).
4. **Narration input is starved.** `scenarioNarrator` sends the LLM only `{ tMs, type }` — no agent id/tool name/folderName — so it can't produce meaningful "Alice read file" lines. Enrich the timeline.

### Low / environmental
5. **Two pre-existing Windows-only test failures** (not our code, pass on CI/Linux): `claude-hook.test.ts` (5) spawns the hook script as a **subprocess** that reads the real `~/.claude` (our `os.homedir` mock can't reach a child process — the test would need to pass `HOME`+`USERPROFILE` to the child env); `mockClaudeRunner.test.ts` (4) **times out at 40s** spawning mock-claude processes on Windows. Both are test-infra/platform issues.
6. **ReplayControls cosmetics:** uses `rounded-lg` + `border` (1px) — the pixel-art system is `rounded-none` + `border-2`. Passes lint; just off-system. Confirm `bg-overlay`/`text-text-main-hover` tokens exist.
7. **`seek()` performance:** replays from t=0 on every commit; fine now (debounced to pointer-release), watch for long recordings.

## 7. Verification protocol (non-negotiable for the next session)
Run from `pixel-agents-main/`, and **read the exit codes**:
```bash
npm run build          # gate 1 — includes webview tsc -b (check-types does NOT)
npm run lint           # gate 2 — includes the 3 pixel-art eslint rules
npm run test:server    # expect 270 pass / 9 pre-existing Windows fails (§6.5)
npm run test:webview   # expect 50 pass
```
A task is "done" only when build+lint exit 0 and the relevant tests pass. Paste exit codes.

## 8. Key architecture facts for the reviewer
- **Protocol is generated:** edit `core/asyncapi.yaml` → `npm run asyncapi:generate` → `core/src/messages.ts`. Never hand-edit `messages.ts` (CI drift-check).
- **Both surfaces** handle every ClientMessage: `server/src/clientMessageHandler.ts` **and** `adapters/vscode/PixelAgentsViewProvider.ts`.
- **Pixel-art eslint (error-level):** no inline colors, `var(--pixel-shadow)`/`2px 2px 0px` shadows, `FS Pixel Sans` font. Build UI from `webview-ui/src/components/ui/*` + Tailwind tokens.
- **Sprites travel as `SpriteData` (`string[][]`), never image URLs** — decoded server-side, broadcast as JSON. This is why no CSP/static-route work was needed.
- **Replay is frontend-only:** `ReplayTransport implements MessageTransport`, swapped in at `createTransport()` via `?replay=`/`?roleplay=`; reuses the `useExtensionMessages` handler with no backend. `timeScale=0` (in `OfficeState.update`) is the faithful-pause mechanism; `isReplayMode` suppresses recorded-agent wander.
- **Custom assets** are written to `~/.pixel-agents/custom-assets/` (auto-registered external dir) and flow through the existing reload → `furnitureAssetsLoaded` → catalog → placeable pipeline.

## 9. Review-findings history (for context)
- **Phase C:** right-click-move pinned agents permanently (fixed: gated on control mode); pinned-type facing (fixed: `Direction.DOWN`); a wander-timer edge case (fixed by the worker). ✅ all resolved.
- **D3/D4:** `scenario.timeline` vs `events` mismatch (whole replay didn't compile), malformed `existingAgents`, `EditorToolbar` NPC props, `getBlockedTiles` typo, `window` hack in `seek`, clear-then-recreate despawn race, missing EOF freeze — **all fixed** and verified.
- **D5:** narrator + overlay solid; Ollama-timeout + narration-enrichment open (§6.3–6.4).
- **D6:** `wander` fixed this session; `say` open (§6.1).
- **D7:** monotonic-tMs bug fixed this session.

**Net:** the build is green, the feature set is complete, and the tests now genuinely cover the server scenario/asset modules + the NPC/pin/roleplay FSM. The gaps to close next are the webview replay-engine tests, the D6 `say` text, and the Ollama shutdown timeout.
