# PixelOffice — Session Wrap-up

Date: 2026-07-19. Scope: started as an end-to-end review of `HANDOVER.md` (Epics A–D), then turned into a long live-testing + feature session on `pixel-agents-main/`.

> **Verification convention used all session (non-negotiable):** the real gate is `npm run build && npm run lint` (build includes webview `tsc -b` + `asyncapi:generate`; `check-types` does NOT cover webview). `test:server` baseline = **9 pre-existing, Windows-only failures** (`claude-hook.test.ts` ×5, `mockClaudeRunner.test.ts` ×4); "green" = same 9, no new. Every change below was verified with pasted exit codes, not self-reported.

---

## ✅ Done & verified (build 0 / lint 0 / tests green)

### Initial review of the A–D handover
- Independently re-ran the gate: matched the handover exactly (build 0, lint 0, webview 50 pass, server 270 pass / 9 pre-existing fails). Handover confirmed honest.
- Surfaced two **undocumented** issues → became FIX-1 and the ollamaClient work.

### FIX batch 1–6 (planned as Magic Prompts, executed, independently verified)
| ID | What | Key files |
|----|------|-----------|
| FIX-1 | ReplayControls now renders for **roleplay** (`getDuration()`), scrub resets `timeScale` (no permanent EOF freeze) | `replayTransport.ts`, `ReplayControls.tsx` |
| FIX-2 | D6 `say` renders real **speech bubbles** (`showSpeech` + `SpeechOverlay`) | `officeState.ts`, `roleplayScene.ts`, `SpeechOverlay.tsx` |
| FIX-3 | ollamaClient **request timeout** (AbortController) + **NDJSON cross-chunk buffering** | `ollamaClient.ts` |
| FIX-4 | CLI **shutdown guard** (`isShuttingDown`) + double-Ctrl+C force-exit | `cli.ts` |
| FIX-5 | **Narration enrichment** (id/tool/status/folder into the LLM timeline) | `scenarioNarrator.ts` |
| FIX-6 | Webview replay-engine + spriteGen **unit tests** | `webview-ui/test/*`, `server/__tests__/*` |
- Reviewed the batch, caught + applied 3 nits (`loadScenarioForTest`→`loadScenario`, `TILE_SIZE*2` constant, stale comment).

### Live-test-driven fixes & features
- **Corrupt `~/.pixel-agents/layout.json`** (`cols:30,rows:15,tiles:[9]`) caused a full **magenta** office → moved aside to `layout.json.corrupt.bak`; default 21×22 loads.
- **Agent naming** (name-file convention): `~/.pixel-agents/agent-names.json` (`{id|folder: name}`) + `AgentNamesSync` poller + `GET/POST /api/agent-names`; **chat-driven auto-detect** — when an agent writes `assistant-name-<X>.md`, the office adopts + persists the name. Name shown **inside the speech bubble** (`Name: text`), no separate tag.
- **Roleplay:** `say ... to <actor>` draws a **tether** between speakers; the right-side **Activity feed** is fed by roleplay actions; **⌂ back-to-office** control; replay control buttons relabeled to text (`Home · -5s · Play · +5s`) since the pixel font can't render media-control emoji.
- **Scenario authoring UI** (plain HTTP, no protocol drift): `GET /api/scenarios` list + **Scenarios ▾** picker (Play), **● Record** start/stop (`/api/record/*`), **Script** editor (`POST /api/scenarios/:name` + `ScriptEditor.tsx`), **delete** recordings (`x` + `DELETE`), and a **recording snapshot fix** (recorder now snapshots existing agents on start so replays reconstruct the scene + narration).
- **Quit-reset:** external agents **idle-despawn after ~90s** (mtime-based, `EXTERNAL_IDLE_DESPAWN_MS`) and the Activity feed clears when the office empties.
- **Texel engine ported to TypeScript** (FIX-12, sub-agent-built, independently verified): `texelEngine.ts` (Canvas + ~16 drawing tools + ReAct loop), Ollama **tool-calling** (`chatWithTools` in `ollamaClient.ts`), `agentMode`/`palette`/`spriteType` added to `GenerateSprite` (asyncapi regenerated, **no drift**), branched in `spriteGen.ts`, **"Agent painter"** toggle in `SpriteGenTab.tsx`. No Python. Server tests added (mocked Ollama).
- **Layout:** ScenarioBar centered top; ActivityFeed height capped; direct **Paint** button; painter modal — bigger prompt (`h-40 resize-y`) + Properties pane un-squished (`min-w-0` flexbox fix).
- **Ollama CORS proxy:** `GET /api/ollama/models` (server→Ollama, no CORS) so the model dropdown can list models instead of falling back to "llama3".

**Last full verification:** build 0 · lint 0 · webview 0 · **server 286 pass / 9 pre-existing fails** · asyncapi regen clean.

### Docs created
- `.agent/plans/implementation_plan.md`, `.agent/plans/review_plan.md`
- `.agent/prompts/fix-1…fix-12*.md` (Magic-Prompt handoffs for sub-agents)
- `.agent/rules/office-conventions.md` (R1 naming, R2 roleplay conversations, R3 recording + Skill/Workflow templates)
- Scenarios: `~/.pixel-agents/scenarios/demo-roleplay.json`, `ai-chatbot-team.json`

---

## ⚠️ Needs attention / NOT done

### Immediate runtime issue (was mid-fix when session was interrupted)
- **Orphaned server processes on port 3100.** Repeated `node dist/cli.js` restarts left a stale process (**PID 38776**) holding `:3100`; a fresh launch printed *"Reusing existing standalone server … (PID 38776)"* — so the port may be served by **older server-side code** (missing `/api/ollama/models` + Texel routes), even though the webview on disk is current. `TaskStop` didn't always kill the node child.
  - **Action:** kill everything on 3100, launch ONE fresh server:
    ```bash
    # find PIDs on 3100 then kill them (Windows / git-bash):
    netstat -ano | grep ":3100" | awk '{print $5}' | sort -u   # → PIDs
    taskkill //F //PID <pid>                                    # each
    node pixel-agents-main/dist/cli.js --port 3100              # one clean launch
    ```
    Confirm the log says "Server listening" (NOT "Reusing existing…").

### Not verifiable from here (need your eyes / machine)
- **All UI changes are build/lint/test-verified only — not visually confirmed.** Everything needs a **hard refresh** (Ctrl+Shift+R); soft refresh served stale bundles repeatedly this session (latest bundle hash was `index-DW-FmETM.js`).
- **Ollama connection unproven.** The sandbox blocks localhost probes, so I couldn't hit your Ollama. The CORS proxy is in but untested live. After a clean server + hard refresh: painter → AI Generate → dropdown should list your models. The **Agent painter needs a tool-capable model** (`ollama pull llama3.1` or `qwen2.5`); plain `llama3` may not tool-call.
- **Scenario walk coordinates** in `ai-chatbot-team.json` assume the default 21×22 layout; if furniture blocks a target tile, that NPC just won't move there (graceful).

### Known limitations / deferred
- **Texel port:** square canvas only (`max(width,height)`); deferred Texel features — concept-art/vision reference, autotile tileset, generation history, S3, Redis queue.
- **Activity feed idle-filter** drops any line containing the substrings "idle"/"waiting" (can over-filter legitimate text). Whole-status match is the cleaner fix.
- **ScenarioBar centered top** may overlap the `ConnectionIndicator` (also top-center) if that indicator is shown.
- **Roleplay tether** renders above floor but below furniture (documented z-order trade-off).
- **9 pre-existing Windows test failures** untouched (out of scope; env-only: subprocess reads real `~/.claude`; mock-claude 40s timeout).
- **Org spend limit** killed in-process child agents mid-task (FIX-11 was finished by hand). Raising it via `/usage-credits` re-enables the child-agent workflow.

---

## Recommended next steps
1. **Clean the server** (kill orphans on 3100, one fresh launch) — see command above.
2. **Hard-refresh** and confirm: centered scenario bar, Paint button, roomy painter modal, model dropdown populated (if Ollama up with a tool-capable model).
3. Live-test the **Agent painter** end-to-end (prompt → tool-by-tool paint → save custom asset).
4. Optional polish: tighten the feed idle-filter; de-conflict ScenarioBar vs ConnectionIndicator; add a whole-status match; a unified responsive top toolbar.
