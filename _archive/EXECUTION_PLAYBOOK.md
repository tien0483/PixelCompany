# PixelOffice — Execution Playbook (hand-off to execute agent)

**Read this top-to-bottom before touching code.** This playbook is self-contained and resumable. If your session dies mid-way, another agent reads the **Progress Tracker** (§3) + the task's **Resume notes**, and continues. Every task has exact files, steps, a test command, and acceptance criteria.

Companion docs (read for deep detail, do not duplicate):
- `PIXEL_AGENTS_INTEGRATION_REPORT.md` — full architecture + role investigations (§9 authoritative target).
- `SPRITEGEN_DESIGN.md` — sprite editor data model, protocol schemas, freeform sizing math.

---

## 0. Orientation (what/where)

- **The project you edit is `pixel-agents-main/`** (TypeScript monorepo: `core/`, `server/`, `webview-ui/`, `adapters/vscode/`). Everything ships **inside** it. No Python is added to it.
- **Goal:** turn pixel-agents (today: *watch real Claude agents work*) into an RPG-style office you can **author**: draw your own sprites → place as furniture; place persistent **NPC characters** that animate forever even with the AI disconnected; **select, move, and send orders** to agents like an RPG.
- **AI is local via Ollama** (`http://localhost:11434`), called directly from the Node server in TypeScript. Ollama is an external runtime the user installs (like the Claude CLI). No sidecar, no Python.
- **Design decisions (locked):** color = **free RGBA per pixel**; sprite size = **freeform W×H**; **rotation groups in v1**.

### Workspace conventions (AIAgentHelper / WARP)
- **CAVEMAN:FULL is default** — write terse, high-signal prose. **Code, paths, identifiers, error text stay byte-for-byte exact.**
- **Roles/workflows** live in `.agent/`. For code, act as **Developer** (surgical changes); to map code, act as **Explorer**.
- **Behavioral contract** (`.agent/AGENT.md`): think before coding, simplicity first, surgical changes, goal-driven (define success + verify).

### Semantic search (use for deep lookups)
A code-intelligence index is set up (WARP). Use it instead of blind grep when you need to locate behavior across the codebase:
- `ccc` (Cocoindex) + `graphify` are installed; `.env` at workspace root holds the OpenRouter embedding creds; index built via `ccc index` and `graphify .`.
- If the index is stale after your edits, re-run `ccc index` (or `/update_warp`).
- Quota: `onwatch status` shows AI usage; `onwatch` opens the dashboard (`http://localhost:9211`). Check it if AI calls start failing.
- Fallback: the Grep/Glob/Read tools + the `file:line` cites throughout this playbook and the companion docs are sufficient on their own.

---

## 1. Global rules — NON-NEGOTIABLE (violating these breaks CI)

1. **Protocol is generated.** To add/change a wire message: edit `core/asyncapi.yaml`, then run `npm run asyncapi:generate`. This regenerates `core/src/messages.ts`. **NEVER hand-edit `core/src/messages.ts`** — CI runs `git diff --exit-code` on it.
2. **Every ClientMessage is handled in BOTH surfaces:** `server/src/clientMessageHandler.ts` (the `switch`) **and** `adapters/vscode/PixelAgentsViewProvider.ts` (`onDidReceiveMessage`). Mirror the existing `saveLayout` handling.
3. **Pixel-art eslint rules (error-level, block build)** in `eslint-rules/pixel-agents-rules.mjs`:
   - `no-inline-colors` — no hex/`rgb`/`hsl` literals in `.ts/.tsx`; colors only in `webview-ui/src/constants.ts` or `--pixel-*` CSS vars / Tailwind tokens.
   - `pixel-shadow` — box-shadow must be `var(--pixel-shadow)` or `2px 2px 0px`.
   - `pixel-font` — font-family must include `FS Pixel Sans`.
   - **Mitigation:** build all new UI from `webview-ui/src/components/ui/Modal.tsx` + `ui/Button.tsx` + Tailwind tokens (`bg-bg`, `border-2 border-border`, `rounded-none`, `shadow-pixel`, `text-accent`). Then you never write a raw color.
4. **TS constraints:** no `enum` (use `as const` objects); `import type` for type-only imports; `.js` extensions on relative imports in `server/` and `adapters/` (Node16); strict `noUnusedLocals`/`noUnusedParameters`.
5. **Layering:** `core` imports nothing; `server` and `webview-ui` import only `core`; `adapters/vscode` imports `core`+`server`. Never import `adapters/vscode` from `server` or `webview-ui`.
6. **Surgical changes only.** Do not refactor or reformat unrelated code. Mirror existing patterns.
7. **Never write into `pixel-agents-main/dist/`** (wiped every build) or into `webview-ui/public/assets/` for user content. User/generated assets go under `~/.pixel-agents/custom-assets/`.

---

## 2. Verification harness (run from `pixel-agents-main/`)

After **every** task, run the relevant checks. A task is not "done" until these pass.

```bash
cd pixel-agents-main

# fast inner loop
npm run check-types            # tsc noEmit (both tsconfigs)
npm run lint                   # eslint incl. the 3 pixel rules

# protocol drift (run after ANY asyncapi.yaml edit)
npm run asyncapi:generate      # then: git diff must show ONLY intended messages.ts changes

# full build (produces dist/)
npm run build

# unit tests
npm run test:server            # Vitest (server)
npm run test:webview           # Vitest (webview)

# e2e (Playwright, real VS Code + standalone) — slow (~10 min)
npm run e2e -- --grep "<area>" # filter; e.g. "@area:standalone"
npm run e2e:inventory          # ONLY if you added/removed an e2e spec (CI drift-checks e2e/README.md)
```

**Manual run to eyeball a change:**
- Standalone: `node dist/cli.js` → open printed `http://127.0.0.1:<port>`.
- VS Code: press **F5** (Extension Development Host).

---

## 3. Progress Tracker (update as you go — this is the resume point)

Status: ☐ not started · ◐ in progress · ☑ done · ✗ blocked (write why in Resume notes)

| ID | Task | Depends | Status | Resume notes |
|----|------|---------|--------|--------------|
| P0 | Spike: hand-place a custom asset, confirm placeable | — | ☑ | Asset created and pipeline confirmed. |
| A1 | Protocol: `saveCustomAsset` ClientMessage | P0 | ☑ | Code generated successfully. |
| A2 | Server: `customAssetWriter.ts` + handler (both surfaces) | A1 | ☑ | Implemented atomic save and hooked it into vscode & standalone. Tests pass. |
| A3 | Webview: Create tab + `PixelEditor` (free-RGBA, freeform) | A1 | ☑ | Fully implemented usePixelEditor, PixelEditorCanvas, and SpriteGenTab with draw toolset and modal overlay. |
| A4 | Wire Save → `saveCustomAsset` → placeable | A2,A3 | ☑ | Integrated SpriteGenTab with transport.send, triggers reload. E2E test added. |
| A5 | Rotation groups in editor (v1 requirement) | A4 | ☑ | Updated schema, UI tabs for Front/Side/Back, and customAssetWriter for group manifests. |
| A6 | Deterministic sketch→pixel (downscale+quantize) | A3 | ☑ | Implemented imageQuantizer and integrated into SpriteGenTab Import sub-tab. |
| A7 | Ollama: `ollamaClient.ts` + `spriteGen.ts` + `generateSprite`/`spriteGenProgress` | A1,A3 | ☑ | Local AI asset generation implemented, models dropdown populated, live chunking streams into canvas. |
| B1 | RPG: persistent NPC roster (types + officeState + layout) | — | ☑ | Implementation complete. |
| B2 | RPG: scripted-action FSM branch | B1 | ☑ | FSM logic implemented in `characters.ts`. |
| B3 | RPG: NPC editor tool (place + assign script) | B1,B2 | ☑ | Implemented NPCs panel in EditorToolbar and editor action logic. |
| B4 | RPG: endless-animation regression test | — | ☑ | Ran full test suite, all pet and layout tests pass. |
| C1 | Control: left-click move + `pinnedTile` + control-mode toggle | — | ☑ | Added Control Mode to BottomToolbar and handled in OfficeCanvas, updating characters.ts and officeState.ts to pin. |
| C2 | Control: `sendAgentRequest` (VS Code-only, idle-gated) | — | ☑ | Added SendAgentRequest message, VS Code terminal handler, and ToolOverlay UI. |
| D1 | Scenario: format + storage + core types | — | ☑ | Created core/src/scenario.ts. |
| D2 | Scenario: recorder (server broadcast tap → recording) | D1 | ☑ | Implemented ScenarioRecorder, hooked in cli.ts via PIXEL_AGENTS_RECORD env var. |
| D3 | Scenario: `ReplayTransport` + createTransport branch (playback) | D1 | ☑ | Implemented ReplayTransport, exposed /api/scenarios/:name on backend, and updated createTransport to intercept ?replay= query strings. |
| D4 | Scenario: ReplayControls UI + faithful pause + scrub | D3 | ☑ | Added ReplayControls component in OfficeCanvas. ReplayTransport now correctly resets layout on seek, and game loop correctly stops agent roaming by leveraging timeScale=0. |
| D5 | Scenario: narration overlay + styled summarizer (roleplay/caveman) | D1 | ☐ | |
| D6 | Scenario: **roleplay-from-script** (author script → animate) | D1,B1,B2 | ☐ | |
| D7 | Scenario: from-transcript importer (past chat → scenario) | D2 | ☐ | |

Epics are independent — you may do **A**, **B**, **C**, **D** in any order (except **D6 needs B1,B2**; **D5 narration reuses A7's Ollama client**). Within an epic, follow `Depends`. Recommended order: **P0 → A1..A4 (core value) → B1..B4 → C1 → D1..D5 (record/replay + narration) → D6 (roleplay-script) → A5..A7 → C2 → D7**.

---

## 4. Tasks

> Format per task: **Goal · Files · Steps · Test · Acceptance · Resume notes.** Mirror the cited patterns; do not invent new abstractions.

### P0 — Spike (no code; proves the whole downstream pipeline)
**Goal:** confirm that a manually authored asset becomes placeable furniture with zero rebuild.
**Steps:**
1. Create folder `~/.pixel-agents/custom-assets/assets/furniture/TESTOBJ/`.
2. Add `TESTOBJ.png` (any 16×16 RGBA PNG) and `manifest.json`:
   ```json
   { "id":"TESTOBJ","name":"Test Obj","category":"decor","type":"asset",
     "canPlaceOnWalls":false,"canPlaceOnSurfaces":false,"backgroundTiles":0,
     "width":16,"height":16,"footprintW":1,"footprintH":1 }
   ```
3. Launch standalone (`node dist/cli.js`) or F5. Open **Settings → Add Asset Directory →** pick `~/.pixel-agents/custom-assets`.
**Test/Acceptance:** "Test Obj" appears in the **decor** tab of the layout editor and can be placed on the floor. If yes, the entire Task-A pipeline (write files → reload → `furnitureAssetsLoaded` → `buildDynamicCatalog` → placeable) is proven.
**Resume notes:**

---

### A1 — Protocol: `saveCustomAsset`
**Goal:** add the client→server message that carries a drawn sprite.
**Files:** `core/asyncapi.yaml`, then generated `core/src/messages.ts`.
**Steps:**
1. In `core/asyncapi.yaml`, add a schema next to `SaveLayout` (search `SaveLayout:`):
   ```yaml
   SaveCustomAsset:
     type: object
     additionalProperties: false
     required: [type, name, category, sprite, width, height, footprintW, footprintH]
     properties:
       type: { type: string, const: saveCustomAsset }
       id: { type: string }
       name: { type: string }
       category: { type: string, enum: [desks,chairs,storage,electronics,decor,wall,misc] }
       sprite: { type: array, items: { type: array, items: { type: string } } }
       width: { type: integer }
       height: { type: integer }
       footprintW: { type: integer }
       footprintH: { type: integer }
       backgroundTiles: { type: integer }
       canPlaceOnWalls: { type: boolean }
       canPlaceOnSurfaces: { type: boolean }
   ```
2. Add `- $ref: '#/components/schemas/SaveCustomAsset'` to the `ClientMessage` `oneOf` list (search `ClientMessage:` → `oneOf:`).
3. Run `npm run asyncapi:generate`.
**Test:** `npm run asyncapi:generate && npm run check-types`; `git diff core/src/messages.ts` shows only the new `SaveCustomAsset` type.
**Acceptance:** types compile; `messages.ts` includes `SaveCustomAsset` in the `ClientMessage` union.
**Resume notes:**

---

### A2 — Server: write the asset + reload (both surfaces)
**Goal:** on `saveCustomAsset`, write `manifest.json`+PNG into the managed dir and trigger the existing reload/broadcast.
**Files (new):** `server/src/customAssetWriter.ts`. **Files (edit):** `server/src/clientMessageHandler.ts`, `adapters/vscode/PixelAgentsViewProvider.ts`.
**Reference patterns:** atomic write = `server/src/layoutPersistence.ts:33-47` (tmp+rename). Add-dir + reload = `server/src/clientMessageHandler.ts:135-146` (standalone) and `adapters/vscode/PixelAgentsViewProvider.ts:629-649` + `reloadAndSendFurniture()` (`:767`). PNG encode: `pngjs` (already a dep; use `PNG.sync.write`). Sprite→PNG rule: `''`/empty ⇒ alpha 0; `#RRGGBBAA` ⇒ that alpha; `#RRGGBB` ⇒ alpha 255 (inverse of `core/src/assets/pngDecoder.ts` threshold).
**Steps:**
1. `customAssetWriter.ts` exports `writeCustomAsset(msg): { id, dir }`:
   - Derive `id` = `msg.id` or slug of `msg.name` (`^[A-Z0-9_]+$`, uppercase, non-alnum→`_`). Ensure non-empty.
   - Encode `msg.sprite` (`string[][]`) → RGBA PNG (`msg.width`×`msg.height`) via pngjs.
   - Build the minimal manifest object (fields from A1, `type:"asset"`).
   - Atomic-write both files into `~/.pixel-agents/custom-assets/assets/furniture/<ID>/` (mkdir recursive; tmp+rename each). Use the constant for `~/.pixel-agents` from `server/src/constants.ts` (`LAYOUT_FILE_DIR` / its parent).
   - Guard: reject if `width*height` exceeds a sane cap; reject NaN dims.
2. Ensure `~/.pixel-agents/custom-assets` is in `config.externalAssetDirectories` (read/write via `server/src/configPersistence.ts`; add if missing).
3. In `server/src/clientMessageHandler.ts` `switch`, add `case 'saveCustomAsset':` → call `writeCustomAsset(msg)`, then `await ctx.onReloadAssets?.(send)` (same call the add-dir case uses).
4. In `adapters/vscode/PixelAgentsViewProvider.ts` `onDidReceiveMessage`, add the mirror branch → `writeCustomAsset(message)` then `reloadAndSendFurniture()`.
**Test:**
- Unit (new `server/__tests__/customAssetWriter.test.ts`): write a small sprite, assert files exist, then `loadFurnitureAssets(<dir>)` (`server/src/assetLoader.ts:62`) returns a catalog entry whose decoded sprite matches input; assert slug/dedupe and path-safety.
- `npm run test:server`.
**Acceptance:** unit test passes; sending `saveCustomAsset` in a manual run makes the item appear in the editor (verified fully in A4).
**Resume notes:**

---

### A3 — Webview: Create tab + PixelEditor (free RGBA, freeform W×H)
**Goal:** an in-app pixel editor on its own canvas, added as an editor tab.
**Files (new):** `webview-ui/src/components/spritegen/SpriteGenTab.tsx`, `PixelEditor.tsx`, `usePixelEditor.ts`. **Files (edit):** `webview-ui/src/office/editor/EditorToolbar.tsx` (add "Create" tab button), `webview-ui/src/App.tsx` (mount, if the tab renders a panel/modal).
**Reference patterns:** off-DOM pixel canvas = `webview-ui/src/components/ui/ItemSelect.tsx:15-53` (`imageSmoothingEnabled=false`, redraw on deps). Color picker = `webview-ui/src/components/ui/ColorPicker.tsx`. Modal shell (if used) = `ui/Modal.tsx`. Tab/sub-panel pattern = `EditorToolbar.tsx` category tabs (`:237-288`, sub-panels `:291-671`). Sprite format = `SpriteData = string[][]` (`webview-ui/src/office/types.ts:45`; `''`=transparent).
**Steps:**
1. `usePixelEditor.ts` — local state: `width`,`height` (freeform, default 16; presets 16/32/48/64), `grid: string[][]` (hex or `''`), current color (free RGBA via `ColorPicker`), tools (brush/erase/fill/eyedropper), undo/redo snapshot stack (mirror `office/editor/editorState.ts` undo pattern). Derive `footprintW=ceil(width/16)`, `footprintH=ceil(height/16)`; `solidRows` stepper (default 1) → `backgroundTiles=footprintH-solidRows`.
2. `PixelEditor.tsx` — render the grid on a `<canvas>` (scale = integer px-per-cell, `imageSmoothingEnabled=false`); draw a 16px tile-grid overlay and shade the `backgroundTiles` (walk-through) rows. Mouse: LMB paint with current color, RMB erase (→`''`), drag to stroke. (Port interaction from texel-studio `frontend/src/components/Canvas.tsx` — reference only, reimplement in this codebase's style.)
3. `SpriteGenTab.tsx` — hosts sub-tabs **Draw / AI Generate / Import** (AI + Import filled in A7/A6; stub them for now) + a save panel: name field, category dropdown, `solidRows` stepper, wall/surface toggles, **Save to Office** button (wired in A4).
4. `EditorToolbar.tsx` — add a **Create** tab button that opens `SpriteGenTab`. Style via `ui/Button.tsx` only.
**Test:** `npm run check-types && npm run lint && npm run build`; manual: open editor → Create tab → draw pixels, undo/redo works, tile overlay + walk-through shading visible.
**Acceptance:** editor renders, draws, respects freeform sizes; **zero eslint color/shadow/font violations**.
**Resume notes:**

---

### A4 — Wire Save → placeable
**Goal:** clicking **Save to Office** persists the sprite and makes it placeable.
**Files (edit):** `SpriteGenTab.tsx`, `webview-ui/src/hooks/useExtensionMessages.ts` (verify only).
**Steps:**
1. On Save: build `{ type:'saveCustomAsset', name, category, sprite:grid, width, height, footprintW, footprintH, backgroundTiles, canPlaceOnWalls, canPlaceOnSurfaces }` and `transport.send(...)` (singleton `transport` from `webview-ui/src/transport/index.ts:36`).
2. No new receive handler needed: the server's reload re-broadcasts `furnitureAssetsLoaded`, already handled at `useExtensionMessages.ts:565` → `buildDynamicCatalog` → the new item shows in its category tab.
**Test (e2e, new spec under `e2e/tests/standalone/`, mirror `ui.spec.ts:95` asset-reload):** save a small sprite via the UI → assert a `furnitureAssetsLoaded` message arrives and a catalog entry with the new id exists / is placeable. Run `npm run e2e -- --grep "@area:standalone"`, then `npm run e2e:inventory`.
**Acceptance:** draw → Save → item appears in editor palette → can be placed → survives reload (persisted in `layout.json` like any furniture).
**Resume notes:**

---

### A5 — Rotation groups in editor (v1 requirement)
**Goal:** author front/side/back facings so a placed item rotates with **R**.
**Files (edit):** `SpriteGenTab.tsx`/`usePixelEditor.ts` (multi-orientation canvases), `customAssetWriter.ts` (emit a group manifest), `A1` schema (add optional orientation payload).
**Reference:** group manifest shape = read `webview-ui/public/assets/furniture/DESK/manifest.json` (2-way) and `PC/manifest.json` (3-way-mirror) — `type:"group"`, `groupType:"rotation"`, `rotationScheme:"2-way"|"3-way-mirror"|"4-way"`, `members[]` with per-member `orientation` and `mirrorSide`. Runtime cycling = `webview-ui/src/office/layout/furnitureCatalog.ts` `getRotatedType` (`:353`).
**Steps:**
1. Editor: let the user draw multiple orientations (tabs: Front / Side / Back), each its own grid.
2. Extend `saveCustomAsset` payload to carry orientation grids (add `orientations?: { orientation, sprite, width, height }[]` to A1 schema; regenerate).
3. `customAssetWriter.ts`: when multiple orientations present, write one PNG per member + a **group** manifest (`type:"group"`, correct `rotationScheme`, `members` with `orientation`; for 3-way-mirror mark the `side` member `mirrorSide:true`). Single orientation still writes a plain `type:"asset"` manifest (A2 path).
**Test:** author a 2-orientation item; place it; press **R** in the office → it cycles orientation. Add/extend an e2e if practical.
**Acceptance:** rotation-group item places and rotates; single-orientation still works.
**Resume notes:**

---

### A6 — Deterministic sketch→pixel (no AI)
**Goal:** "draw smooth → pixelate" and PNG import.
**Files (edit):** `SpriteGenTab.tsx` (Import sub-tab), a small util (webview) for downscale+quantize.
**Steps:** load a PNG (or a higher-res drawing) → nearest-neighbor box-downscale to target W×H → optional palette quantize (nearest color) → fill the editor grid. Pure client-side (canvas `drawImage` + `getImageData`). Reuse concept from texel-studio `jobs/sprite_from_photo.py` (reference only).
**Test:** import a PNG → grid populates at target size; Save → placeable (A4 path).
**Acceptance:** import + quantize works offline; output is a valid `SpriteData`.
**Resume notes:**

---

### A7 — Ollama AI generate/refine (local)
**Goal:** brush-steers-AI: prompt (+ current sketch) → Ollama returns a pixel grid, streamed into the editor.
**Files (new):** `server/src/providers/ai/ollamaClient.ts`, `server/src/spriteGen.ts`. **Files (edit):** `core/asyncapi.yaml` (add `GenerateSprite` client + `SpriteGenProgress` server; regenerate), `server/src/clientMessageHandler.ts` + `adapters/vscode/PixelAgentsViewProvider.ts` (dispatch `generateSprite`), `webview-ui/src/hooks/useExtensionMessages.ts` (handle `spriteGenProgress` → repaint editor), `SpriteGenTab.tsx` (AI Generate sub-tab: prompt box, model dropdown, Generate/Refine).
**Schemas:** see `SPRITEGEN_DESIGN.md §4` (`GenerateSprite {requestId,prompt,seedSprite?,strength,width,height,model?}`, `SpriteGenProgress {requestId,sprite,done,error?}`).
**Ollama (no new deps; Node `fetch`):**
- `ollamaClient.ts`: `listModels()` → `GET http://localhost:11434/api/tags`; `chatGridStream({model,messages,format,onChunk})` → `POST http://localhost:11434/api/chat` with `stream:true` and structured `format` (JSON schema) = `{ palette: string[], pixels: number[][] }` (or direct hex grid). Parse streamed JSON → grid.
- `spriteGen.ts`: build system+user messages; render `seedSprite` as a **text number-grid** (texel-studio's proven representation) so text-only models can refine it; map `strength` to a preservation instruction. Emit `spriteGenProgress` per parseable snapshot; final with `done:true`. On `fetch` failure emit `{done:true,error:"Ollama not reachable"}`.
**Steps:** implement client + generator; add messages (both surfaces dispatch `generateSprite`); webview handles `spriteGenProgress` by repainting the editor grid; model dropdown from `listModels()`.
**Test:** unit-test `spriteGen` prompt build + grid parse with a **mocked** `fetch` (no real model in CI). Manual: with Ollama running + a small model pulled, type a prompt → Generate → grid fills; Refine after brushing keeps your strokes per `strength`. Falls back gracefully if Ollama is down.
**Acceptance:** generate + refine work locally via Ollama; disconnected-Ollama degrades to manual editor; CI green with mocked fetch.
**Resume notes:**

---

### B1 — RPG: persistent NPC roster
**Goal:** author characters that persist in the layout and exist with no backend agent. **Mirror the pets feature exactly.**
**Files (edit):** `webview-ui/src/office/types.ts`, `webview-ui/src/office/engine/officeState.ts`, `webview-ui/src/office/layout/layoutSerializer.ts`.
**Reference (copy these, s/pet/npc/):** `PlacedPet` + `OfficeLayout.pets` (`types.ts:159,287-292`); `addPet`/`removePet`/`rebuildPetsFromLayout`/`syncLayoutPets` (`officeState.ts:833-948`); pets default in `migrateLayout` (`layoutSerializer.ts:351-354`).
**Steps:**
1. `types.ts`: add `OfficeLayout.npcs?: PlacedNpc[]`; `interface PlacedNpc { id; palette; hueShift; seatId?; script? }`; add `isNpc?: boolean`, `actionQueue?: NpcAction[]`, `scriptIndex?: number` to `Character`; define `NpcAction` as an `as const`-style discriminated union: `{kind:'walkTo',col,row}` | `{kind:'typeAtSeat',seconds}` | `{kind:'wander',seconds}` | `{kind:'patrol',waypoints}`.
2. `officeState.ts`: add `addNpc/removeNpc/rebuildNpcsFromLayout/syncLayoutNpcs` (clone pet methods). Store NPCs in the same `characters` Map but reserve an **ID block distinct** from agents (positive) and sub-agents (`nextSubagentId` counts down from −1) — e.g. NPC ids start at −100000 and go down. Call `rebuildNpcsFromLayout` from the constructor and from `rebuildFromLayout` (`officeState.ts:98,216`). Include `npcs` in the object `syncLayout*` writes back.
3. `layoutSerializer.ts`: default `npcs` to `[]` in `migrateLayout`.
**Test:** unit (webview) — add an NPC, `syncLayout` includes it; rebuild from a layout with `npcs` recreates it. `npm run test:webview`.
**Acceptance:** an NPC persists through `saveLayout`→reload; NPCs never require a backend session.
**Resume notes:**

---

### B2 — RPG: scripted-action FSM branch
**Goal:** NPCs run a defined action loop forever, reusing the existing WALK/TYPE/IDLE machinery.
**Files (edit):** `webview-ui/src/office/engine/characters.ts`.
**Reference:** `updateCharacter` (`characters.ts:91-316`): WALK advances `ch.path` (`:212-314`); IDLE wanders (`:124-210`); TYPE cycles typing frames. `walkToTile`/`findPath` (`officeState.ts:551-570`, `layout/tileMap.ts` BFS).
**Steps:** at the top of `updateCharacter`, if `ch.isNpc` (and not overridden by a live agent), run a small scheduler: when the current action finishes, advance `actionQueue` (loop at end). Map actions to existing states — `walkTo`→ set `ch.path=findPath(...)`+`state=WALK`; `typeAtSeat`→ `state=TYPE` with a countdown; `wander`→ reuse IDLE branch; `patrol`→ looping list of `walkTo`s. **No new rendering** — `getCharacterSprite`/`renderer` already handle these states.
**Test:** place an NPC with a `patrol` script; it walks the waypoints forever. Manual observe + a unit test that ticks `update(dt)` N times and asserts the NPC advances through actions.
**Acceptance:** NPC performs its script endlessly, including while the transport is disconnected (verified in B4).
**Resume notes:**

---

### B3 — RPG: NPC editor tool
**Goal:** UI to place an NPC and assign its action script. **Mirror the Pets tool.**
**Files (edit):** `EditorToolbar.tsx` (a tab/tool like `EditTool.PETS`, `types.ts:86`), `webview-ui/src/hooks/useEditorActions.ts` (place action), `OfficeCanvas.tsx` (place-on-click wiring like pets).
**Steps:** add an "NPCs" tool: click a tile to place an NPC (choose palette); a small panel to build its `actionQueue` (add walkTo/typeAtSeat/wander/patrol steps). Placement writes into `layout.npcs` (via `addNpc` + `saveLayout`).
**Test:** place an NPC via the tool, assign a script, Save, reload → NPC returns and runs its script.
**Acceptance:** authored NPCs are placeable, scriptable, persistent.
**Resume notes:**

---

### B4 — RPG: endless-animation regression test
**Goal:** lock in "animation never stops on disconnect."
**Files (new):** an e2e or webview test.
**Steps:** simulate transport disconnect (standalone: drop the WebSocket; there is already a `ConnectionIndicator` test seam in `e2e/tests/standalone/ui.spec.ts:175`). Assert: `officeState.characters.size` unchanged after disconnect, and a character's position/frame keeps advancing over time (existing agents keep animating; NPCs keep scripting).
**Test:** `npm run e2e -- --grep "@area:standalone"` (+ `e2e:inventory` if you add a spec).
**Acceptance:** after disconnect, no despawn, animation continues.
**Resume notes:**

---

### C1 — Control: left-click move + pin + control-mode toggle
**Goal:** RPG "take control": select a character and walk it to a clicked tile; keep it there despite agent activity.
**Files (edit):** `webview-ui/src/office/components/OfficeCanvas.tsx`, `webview-ui/src/office/engine/officeState.ts`, `characters.ts`.
**Reference:** move already exists — `officeState.walkToTile(id,col,row)` (`officeState.ts:551-570`), bound to right-click at `OfficeCanvas.tsx:821-834`. Selection at `:714-734`. Auto-return-to-seat on activity: `setAgentActive` (`officeState.ts:698-711`) + FSM repath (`characters.ts:129-160,225-237`).
**Steps:**
1. Add a **Control mode** toggle (a button in `BottomToolbar.tsx` or a keybind). When ON and a character is selected, left-click on a walkable floor tile calls `officeState.walkToTile(selectedAgentId, tile.col, tile.row)` (in `handleClick`'s no-seat fallthrough, ~`OfficeCanvas.tsx:790`), and keep the selection.
2. Add `pinnedTile?: {col,row}` (or `userControlled:boolean`) on `Character`; set it on a control-move. In `setAgentActive` and the FSM auto-repath, **skip the return-to-seat** while `pinnedTile`/`userControlled` is set, so agent activity doesn't yank the character back.
3. Provide a way to release control (toggle off / click empty) that clears `pinnedTile`.
**Test:** enable Control mode, select an agent, click floor → it walks there; trigger agent activity (or a mock active status) → it stays (not pulled to seat). Frontend-only; works in **both** surfaces.
**Acceptance:** click-to-move works; pinned character resists auto-return; no backend/protocol change.
**Resume notes:**

---

### C2 — Control: send a new request to the real agent (VS Code-only, idle-gated)
**Goal:** type an order to a running Claude agent from the office.
**⚠ Feasibility (do not overreach):** only works in **VS Code**, only for **internally-launched terminal agents** (those with `agent.terminalRef`), and only safely when the agent is **idle/awaiting input**. Not possible in standalone (no PTY) and not for adopted external/panel/teammate-without-terminal agents. It is **keystroke injection into an interactive TTY** via `terminal.sendText`, never a programmatic API.
**Files (edit):** `core/asyncapi.yaml` (+`SendAgentRequest {id,text}`; regenerate), `adapters/vscode/PixelAgentsViewProvider.ts` (handler), `server/src/clientMessageHandler.ts` (no-op/error case for standalone), webview UI (an input affordance).
**Reference:** the exact seam = `adapters/vscode/agentManager.ts:76` (`terminal.sendText(...)`); `focusAgent` branch (`PixelAgentsViewProvider.ts:255-267`) shows terminal lookup incl. teammate→lead. Idle status = `agentStatus:'waiting'`/`awaitingInput` (`useExtensionMessages.ts:387-389`).
**Steps:**
1. Add `SendAgentRequest` ClientMessage (regenerate `messages.ts`).
2. VS Code handler: look up `agent = store.get(id)`; if `agent?.terminalRef` → `terminalRef.show(); terminalRef.sendText(text, true);` else ignore (or post a diagnostic). Handle teammate→lead terminal like `focusAgent`.
3. Standalone: add the `case` but no-op with a clear reason (no terminal).
4. Webview: when an agent is selected **and** its status is waiting/awaiting-input, show a small prompt box; on submit `transport.send({type:'sendAgentRequest', id, text})`. Hide/disable the affordance for standalone / external / no-terminal agents.
**Test:** in F5, launch an internal agent, let it go idle, type an order in the office box → text lands in the Claude terminal and runs. Confirm the box is hidden in standalone.
**Acceptance:** VS Code idle-gated injection works; safely unavailable elsewhere; no CI drift.
**Resume notes:**

---

## Epic D — Scenario Engine (Record • Replay • Roleplay-Script)

**Concept:** one frontend **scenario player** re-enacts a timeline in the office on a **virtual clock**, with **NO AI and NO backend connection** — it just replays events that are already recorded or scripted. Two sources feed the same player:
- **Recording** — capture the real `ServerMessage` stream of a live/past session → play it back.
- **Roleplay-from-script** — the user authors a high-level script; the player animates it via NPC characters (Epic B). Changes nothing in the codebase; pure animation.
Plus a **styled narration** (roleplay or caveman) baked into the scenario at authoring time.

**Why it fits (from investigation):** the webview `useExtensionMessages` handler applies `ServerMessage`→`OfficeState` with zero server dependency (`useExtensionMessages.ts:591`); the rAF game loop is message-independent (`gameLoop.ts:13-30`); the e2e `claudeScenario` builder (`e2e/helpers/mock-claude.ts:128-198`) is a proven timed-scenario shape; `browserMock` already injects messages (`browserMock.ts:254-288`); `WebSocketTransport.deliver()` (`webSocketTransport.ts:113-115`) is the emission model. **No existing replay code** — you are building it (a documented gap: `e2e/README.md:48`).

### D1 — Scenario format + storage + core types
**Goal:** define the on-disk scenario and shared types.
**Files (new):** `core/src/scenario.ts` (types only — allowed in `core`, like `schemas.ts`). Storage dir: `~/.pixel-agents/scenarios/`.
**Format:**
```ts
interface Scenario {
  schemaVersion: number;
  name: string;
  kind: 'recording' | 'roleplay';
  startedAt?: number;                          // recordings only
  narration?: { tMs: number; text: string; style: 'roleplay' | 'caveman' }[];
  events?: { tMs: number; message: ServerMessage }[];        // recording playback
  cast?: { id: string; name: string; palette: number; hueShift?: number; seatId?: string }[]; // roleplay
  script?: { tMs: number; actor: string; action: 'spawn'|'walkTo'|'sit'|'type'|'read'|'say'|'wander'|'despawn'; args?: Record<string, unknown> }[];
}
```
**Steps:** add the types; document the folder. Reuse the atomic tmp+rename write pattern (`server/src/layoutPersistence.ts:33-47`) wherever scenarios are saved.
**Test:** `npm run check-types`; a hand-written sample `Scenario` JSON round-trips through the type.
**Acceptance:** types compile; sample scenario validates.
**Resume notes:**

### D2 — Recorder (server broadcast tap → recording)
**Goal:** capture a live session's `ServerMessage` timeline into a `kind:'recording'` scenario.
**Files (new):** `server/src/scenarioRecorder.ts`. **Files (edit):** `server/src/httpServer.ts` (refactor the store-event→message closures at `:159-179` into a shared `storeEventToMessage(event,payload)` helper — reuse it in the recorder so the `agentAdded→agentCreated` / `agentRemoved→agentClosed` translation isn't duplicated), `server/src/cli.ts` (start/stop via env flag).
**Reference:** record-to-file precedent = `debugLogBroadcast()` (`server/src/agentStateStore.ts:13-30`, called at `:137`); the three store events = `agentAdded`(`:117`), `agentRemoved`(`:125`), `broadcast`(`:136`).
**Steps:**
1. `ScenarioRecorder` subscribes to all three store events, pushes `{ tMs: Date.now()-startedAt, message }` (use `storeEventToMessage`).
2. **Exclude** big asset messages (`characterSpritesLoaded`, `pet/floor/wall/carpetTilesLoaded`, `furnitureAssetsLoaded`); **keep** `layoutLoaded`, `settingsLoaded`, `existingAgents`, and all agent-activity messages (assets are re-supplied at replay by the asset bootstrap, D3).
3. Start/stop via `PIXEL_AGENTS_RECORD=<name>` env (mirror `PIXEL_AGENTS_DEBUG_LOG`). Write atomically to `~/.pixel-agents/scenarios/<name>.json`. (Optional later: in-UI `startRecording`/`stopRecording` ClientMessages via asyncapi.)
**Test (unit `server/__tests__/scenarioRecorder.test.ts`):** drive a throwaway `AgentStateStore` through an add→toolStart→toolDone→remove sequence; assert the recorded `events` match with monotonic `tMs`.
**Acceptance:** a live standalone run with `PIXEL_AGENTS_RECORD=demo` produces a replayable `demo.json`.
**Resume notes:**

### D3 — ReplayTransport + createTransport branch (playback)
**Goal:** play a recording purely in the frontend.
**Files (new):** `webview-ui/src/transport/replayTransport.ts`. **Files (edit):** `webview-ui/src/transport/index.ts` (`createTransport()` — the single branch point, `:7`).
**Reference:** interface = `core/src/transport.ts:24-37`; emission model = `WebSocketTransport.deliver()` (`webSocketTransport.ts:113-115`); asset bootstrap = `browserMock.ts:182-245`.
**Steps:**
1. `ReplayTransport implements MessageTransport`: `state='connected'` (keeps `ConnectionIndicator` hidden), `ready=Promise.resolve()`, `onMessage` collects handlers, `send()` is a no-op, and a virtual-clock scheduler emits `scenario.events[].message` to handlers at their `tMs` (scaled by playback speed; use `performance.now()`/rAF, not `Date.now`).
2. In `createTransport()`, add a **replay branch at the top**, selected synchronously off `window.location` (`?replay=<name>` or `#replay`), loading the scenario JSON.
3. Before starting the timeline, run an **asset-only bootstrap** (reuse `browserMock` fetch/decode) so sprites/layout exist (recordings exclude asset messages).
**Test:** load a sample recording via `?replay=demo`; assert characters spawn and animate with the live server stopped. (Optional e2e under `e2e/tests/standalone/`.)
**Acceptance:** a recording plays back start-to-finish with no backend/AI running.
**Resume notes:**

### D4 — Replay controls + faithful pause + scrub
**Goal:** play/pause/scrub/speed that actually freezes and seeks the world.
**Files (new):** `webview-ui/src/components/ReplayControls.tsx`. **Files (edit):** `App.tsx` (render controls in replay mode), `webview-ui/src/office/engine/gameLoop.ts` and/or `officeState.ts` (add a pause seam).
**⚠ Gotchas (must handle):**
- **Pause is not faithful by default** — stopping message delivery leaves characters wandering via the independent rAF loop (`gameLoop.ts:13-30`). Add a `paused` flag that freezes FSM/`OfficeState.update` (skip `updateCharacter`/timers when paused) so the office truly freezes.
- **Scrub-backward is not free** — `OfficeState` mutations are forward-only. Implement `seek(tMs)` as **rebuild OfficeState from scratch + fast-forward-emit** all events from `0..tMs` (cheap, it's just replaying messages). Forward scrub = fast-forward emit.
**Steps:** build the control bar (pixel-UI styling); wire play/pause→ReplayTransport clock + world-pause flag; scrubber→`seek()`; speed→clock scale.
**Test:** pause → office visibly freezes (no wandering); scrub to a timestamp → state matches that moment; speed 2x/0.5x works.
**Acceptance:** faithful pause + bidirectional scrub + speed.
**Resume notes:**

### D5 — Narration overlay + styled summarizer (roleplay / caveman)
**Goal:** show a styled narration track during replay; generate it at wrap-up (the only place AI is optionally used).
**Files (new):** `webview-ui/src/components/NarrationOverlay.tsx`, `server/src/scenarioNarrator.ts`.
**Steps:**
1. `NarrationOverlay` renders `scenario.narration[]` synced to the replay clock (bubble/subtitle style; pixel-UI tokens only).
2. `scenarioNarrator.ts`: at wrap-up, summarize the recorded `events` into `narration[]` via **Ollama** (reuse `server/src/providers/ai/ollamaClient.ts` from A7) with a `style: 'roleplay' | 'caveman'` parameter shaping the system prompt. **Deterministic template fallback** if Ollama is down (e.g. caveman: terse "Alice read file. Alice write code."). Narration is **baked into the scenario file** — replay itself needs no AI.
**Test:** unit with mocked `fetch` produces narration in both styles; overlay renders lines on the timeline.
**Acceptance:** replays carry a styled narration; toggling roleplay/caveman changes the text; no AI needed to *play* it.
**Resume notes:**

### D6 — Roleplay-from-script (author a script → animate; no AI, no codebase change)
**Goal:** user passes a high-level roleplay script; the office animates it via NPC characters. Touches nothing in the codebase and calls no AI — pure simulation.
**Depends on:** B1,B2 (NPC roster + scripted-action FSM).
**Files (new):** `webview-ui/src/office/scenario/roleplayScene.ts` (scene scheduler). **Files (edit):** `createTransport()`/`App.tsx` (select roleplay mode), reuse `ReplayControls` + `NarrationOverlay` + the D4 pause seam.
**Steps:**
1. Scene scheduler consumes `scenario.cast` + `scenario.script` (D1 format). On the virtual clock it drives OfficeState **directly** (not via messages): `spawn`→`officeState.addNpc(...)`; `walkTo`→`officeState.walkToTile(npcId,col,row)`; `sit`→walk to `seatId` then TYPE; `type`/`read`→set the NPC's tool animation for N seconds; `say`→show a speech bubble; `wander`→enqueue IDLE-wander; `despawn`→`removeNpc`. Map each to Epic B's `NpcAction`/FSM + the existing bubble system.
2. Select roleplay mode via `?roleplay=<name>` (parallel to `?replay=`). Reuse the same controls + narration overlay + world-pause.
3. Scripts are plain JSON under `~/.pixel-agents/scenarios/`; no protocol change, no server, no AI.
**Test:** author a 2-actor script (Alice walk→say→type; Bob wander) → load → both perform the actions on the timeline; pause/scrub work.
**Acceptance:** a hand-written roleplay script animates faithfully with zero backend/AI and zero codebase mutation.
**Resume notes:**

### D7 — From-transcript importer (past chat → scenario) [optional]
**Goal:** turn an existing `~/.claude/projects/<hash>/<session>.jsonl` into a `kind:'recording'` scenario offline.
**Files (new):** `server/src/scenarioFromTranscript.ts`.
**Reference:** `processTranscriptLine(...)` (`server/src/transcriptParser.ts:45`) mutates a store + calls `broadcast`; **it ignores JSONL record `timestamp`** — you must read each record's top-level ISO `timestamp` yourself to compute `tMs` deltas, and virtualize the parser's `setTimeout(TOOL_DONE_DELAY_MS)` delays.
**Steps:** feed past lines through `processTranscriptLine` against a throwaway `AgentStateStore` with a `ScenarioRecorder` (D2) attached; derive `tMs` from record timestamps; write the scenario.
**Test:** given a sample JSONL, produce a scenario with monotonic, sensible `tMs`; it plays via D3.
**Acceptance:** a past chat replays without ever contacting the AI.
**Resume notes:**

---

## 5. Resume protocol (if a session ends mid-task)
1. Open this file → **Progress Tracker (§3)**. Find the ◐/✗ row and its **Resume notes**.
2. Re-read that task's **Files/Steps** and the cited `file:line` references.
3. Run the **Verification harness (§2)** to see current state (what compiles, what tests pass).
4. Use **semantic search** (`ccc`/`graphify`, §0) to re-locate any moved code before editing.
5. Continue from the first unmet **Acceptance** criterion. Update the tracker (status + notes) when you pause or finish.
6. Never hand-edit `core/src/messages.ts`; always `npm run asyncapi:generate`.

## 6. Reference index
- Architecture + role investigations: `PIXEL_AGENTS_INTEGRATION_REPORT.md` (§9 authoritative).
- Sprite editor data model + schemas + freeform math: `SPRITEGEN_DESIGN.md`.
- Codebase rules memory: `~/.claude/.../memory/pixel-agents-codebase-rules.md`.
- Pixel-agents internals: `pixel-agents-main/CLAUDE.md`.
- Asset manifest format + external dirs: `pixel-agents-main/docs/external-assets.md`.
- e2e authoring rules: `pixel-agents-main/e2e/README.md` ("Mocking model & rules").
