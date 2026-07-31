# Pixel-Agents — Dev Guide + Custom-Asset / Local-AI Integration Report

**Goal:** understand how to develop `pixel-agents`, then let a user **draw a sprite in-app** (and optionally **AI-generate one, locally via Ollama**) and drop it into the office as a placeable furniture object.

**Method:** five specialist roles investigated in parallel and answered questions from their point of view. This report synthesizes their findings into a dev guide + a concrete integration plan.

---

## 0. Executive Verdict

| Question | Answer |
|---|---|
| Can we add a "draw your own asset" feature? | **Yes — cleanly.** The asset pipeline already has a runtime, no-rebuild seam (external asset dirs + reload broadcast). We reuse it end-to-end; **zero new rendering/catalog/placement code**. |
| Best AI engine for generating sprites? | **texel-studio.** It is purpose-built pixel-art (LLM *paints pixels*, palette-indexed, game-ready) and **natively supports local Ollama (free, no GPU key)**. |
| Should we use Paint-AI? | **No (deprioritize).** It's Stable-Diffusion img2img → 512×512 *photorealistic raster*, **NVIDIA-GPU + CUDA mandatory**, **GPL-3.0 copyleft**. Wrong output shape, heavy, licensing risk. Keep only as an optional GPU experiment. |
| Total new surface area for the core feature | **1 new `ClientMessage` + 1 server file-writer + 1 React modal.** Everything downstream (decode → merge → broadcast → catalog → place → persist) already exists. |

**The one load-bearing fact:** the office renderer never consumes image URLs. The server decodes every PNG into `SpriteData` (a `string[][]` grid of hex colors) and ships **that JSON** over the transport. So a drawn/generated sprite becomes an office object by writing files into a watched asset dir and re-broadcasting `furnitureAssetsLoaded` — **no CSP, no `asWebviewUri`, no static route needed.**

---

## 1. How to Develop Pixel-Agents (the dev loop)

### Build (already done in this workspace)
```bash
cd pixel-agents-main
npm install          # npm workspaces: root + server + webview-ui (2127 pkgs)
npm run build        # = compile: asyncapi:generate → check-types → lint → esbuild → vite
```
Artifacts land in `dist/`: `cli.js` (standalone), `extension.js` (VS Code), `hooks/claude-hook.js`, `webview/`.

### Run
- **VS Code extension:** press **F5** → Extension Development Host with the local build.
- **Standalone browser:** `node dist/cli.js` → open the printed `http://127.0.0.1:<port>`.

### Watch mode (iterate)
```bash
npm run watch                    # parallel esbuild watch + tsc --noEmit watch
cd webview-ui && npm run dev     # Vite dev server — SEPARATE terminal (not in `watch`)
```

### Test tiers
| Tier | Tool | Run |
|---|---|---|
| Server unit/integration (~200 tests) | Vitest | `npm run test:server` |
| Webview unit | Vitest | `npm run test:webview` |
| **E2E (74 tests, real VS Code + standalone)** | **Playwright** | `npm run e2e` |

E2E drives a **mocked `claude`** at the process boundary (writes append-only JSONL + runs the real hook script); assert only on Playwright-visible outcomes. Filter with `npm run e2e -- --grep "@area:lifecycle"`. Full rules in `pixel-agents-main/e2e/README.md`.

### Three golden rules when changing it
1. **Protocol is generated.** Edit `core/asyncapi.yaml`, then `npm run asyncapi:generate` regenerates `core/src/messages.ts`. **Never hand-edit** `messages.ts` — CI fails on drift (`git diff --exit-code`).
2. **Both surfaces handle every ClientMessage.** A new message must be dispatched in **both** `server/src/clientMessageHandler.ts` (switch at `:66`) **and** `adapters/vscode/PixelAgentsViewProvider.ts` (`onDidReceiveMessage` at `:230`/`:284`). `saveLayout` is the pattern to mirror.
3. **Pixel-art eslint rules block PRs** (`eslint-rules/pixel-agents-rules.mjs`, all error-level): `no-inline-colors` (colors only in `constants.ts` / `--pixel-*` CSS vars), `pixel-shadow` (`var(--pixel-shadow)` or `2px 2px 0px`), `pixel-font` (`FS Pixel Sans`). Build UI from `ui/Modal.tsx` + `ui/Button.tsx` and you inherit all of it (`rounded-none`, `border-2 border-border`, `shadow-pixel`).

---

## 2. Multi-Role Q&A (condensed)

### Role: Asset Pipeline Engineer
**How an office object is defined and loaded.**
- **Tile size = 16 px** (`webview-ui/src/constants.ts:4`). A sprite occupying `footprintW × footprintH` tiles is conventionally `(W*16)×(H*16)` px; taller sprites use `backgroundTiles`.
- **One folder per furniture item:** `assets/furniture/<ID>/manifest.json` + `<ID>.png`. Manifest schema is `FurnitureManifest` (`core/src/assets/manifestUtils.ts:35`). Minimal single-asset manifest (real, from `CACTUS`):
  ```json
  { "id":"MY_ITEM","name":"My Item","category":"decor","type":"asset",
    "canPlaceOnWalls":false,"canPlaceOnSurfaces":false,"backgroundTiles":0,
    "width":32,"height":32,"footprintW":2,"footprintH":2 }
  ```
  (`file` defaults to `<id>.png`; categories: `desks|chairs|storage|electronics|decor|wall|misc`; `isDesk = category==='desks'`.)
- **PNG rules:** RGBA, decoded by `pngToSpriteData` (`core/src/assets/pngDecoder.ts:64`). Alpha `<2` → transparent `''`; `≥255` → `#RRGGBB`; else `#RRGGBBAA`. Dimension mismatch only **warns**. Furniture animation = **separate PNGs** wired by an `animation` group (not a spritesheet).
- **`furniture-catalog.json` is a build artifact for the browser-dev mock only.** The extension/standalone **derive the catalog live** from manifests via `buildDynamicCatalog` (`webview-ui/src/office/layout/furnitureCatalog.ts:77`). **No catalog file edit is ever required.**
- **Two ways to add an object:** (a) bundled folder + `npm run compile` + reload; (b) **external asset dir → no rebuild, no restart.** (b) is the right seam.
- **External dirs:** stored in `~/.pixel-agents/config.json → externalAssetDirectories[]` (`server/src/configPersistence.ts:35`); scanned by `loadFurnitureAssets` (`server/src/assetLoader.ts:62`); merged by `mergeLoadedAssets` (external **wins** on id-collision); re-broadcast as `furnitureAssetsLoaded`.

**Seam recommendation:** a reserved managed dir (e.g. `~/.pixel-agents/custom-assets/`) always present in `externalAssetDirectories`, fed by a new `saveCustomAsset` ClientMessage that writes `manifest.json` + `<id>.png` then calls the existing reload. Reuses `loadFurnitureAssets → mergeLoadedAssets → furnitureAssetsLoaded → buildDynamicCatalog` with **no downstream code**.

### Role: Frontend / Webview Engineer
**Where the draw UI lives and how it talks to the server.**
- `App.tsx` is the whole tree (no router). Modals are mounted flat at the bottom, each gated by a `useState` boolean (pattern: `SettingsModal`, `App.tsx:504`). **Add `DrawAssetModal` next to it**, trigger from `BottomToolbar.tsx`.
- **Do not add an `EditTool`.** The office canvas is **tile-quantized** (`OfficeCanvas.screenToTile:338`) and shares the camera/grid — wrong resolution for a per-pixel sprite editor. A **separate modal with its own `<canvas>`** is the clean architecture.
- The engine's native sprite format **is already** `SpriteData = string[][]` (`office/types.ts:45`). So the pixel editor keeps a local `string[][]` and never needs a PNG round-trip in the browser.
- **Send:** singleton `transport.send({ type: '...', ... })` (`transport/index.ts:36`). **Receive:** one big handler in `useExtensionMessages.ts` mutates the out-of-React `OfficeState`; the rAF loop repaints.
- Reusable primitives: `ItemSelect.tsx` (off-DOM `<canvas>`, `imageSmoothingEnabled=false`) and `ui/ColorPicker.tsx` (palette). The `furnitureAssetsLoaded` branch (`useExtensionMessages.ts:565`) already turns new sprites into placeable catalog items — **a custom asset rides this exact path; no new ServerMessage required.**

### Role: Backend / Server Engineer
**How to accept, persist, and serve a sprite in both surfaces.**
- **Ingress = ClientMessage over the transport, NOT an HTTP POST.** The VS Code webview uses `postMessage` (no HTTP); the standalone browser uses `/ws` **without the bearer token** — so a POST route isn't reachable from the webview. Reserve `POST /api/assets` for an out-of-process AI service (it needs `bearerAuth` + a raised `bodyLimit`; global is 64 KB).
- **Persist** with the atomic tmp+rename pattern (as `layoutPersistence.ts:33`) into a managed dir under `~/.pixel-agents/`, laid out exactly as the loaders scan. **Never write into `dist/assets`** (wiped every build).
- **Serve as decoded `SpriteData`, never as `<img src>`.** VS Code webview has **no `localResourceRoots`/CSP** for arbitrary on-disk images; standalone renderer doesn't fetch PNGs in prod. Decoding server-side and broadcasting `*Loaded` sidesteps all of it, identically on both surfaces.
- **No asset-dir file watcher exists** — after writing files you must **explicitly trigger reload + broadcast** (`onReloadAssets` in `cli.ts:150`; `reloadAndSendFurniture` in `PixelAgentsViewProvider.ts:767`). The e2e test "adding an external asset directory triggers a live asset reload" (`e2e/tests/standalone/ui.spec.ts:95`) confirms reload fires on *registration*, not on a watcher.
- **AI feature home:** a new `server/src/` module (e.g. `paintAi.ts` / `providers/asset/`) called from a new ClientMessage `case`, or an authenticated POST for external callers. Keep any keys server-side.

### Role: texel-studio Integration Analyst
**The right AI engine — and a ready-made pixel editor to steal.**
- **What it is:** an **AI-agent pixel-art generator + manual pixel editor**. An LLM literally paints pixels with tools (`draw_pixel`, `fill_rect`, …), inspects its canvas, iterates → palette-indexed, game-ready sprites. Also has a genuine click-to-paint editor. (`README.md`, `agent.py`, `frontend/src/components/Canvas.tsx`.)
- **Stack:** Python **FastAPI** (`server.py`) + **LangGraph ReAct** agent (`agent.py`); frontend **Next.js/React 19 static export** with an **HTML5-canvas editor** (`Canvas.tsx`).
- **Local AI:** provider is pluggable — Gemini / OpenAI-compatible / **local Ollama (free)**. Routing in `agent.py:_get_llm()` (~`:547`); model lists `server.py:60-84`. **This is exactly your Ollama preference.**
- **Output:** palette-indexed → **RGBA PNG**, sizes **8/16/32/64 square**; also a 16-variant autotile export and a photo→palette quantizer (both pure-PIL, AI-free).
- **License:** custom "source-available" — self-host/modify/integrate (incl. internal/commercial) allowed; only barred from reselling as a competing hosted pixel-art SaaS. Fine for our use.
- **Most reusable piece:** `Canvas.tsx` (~330 lines, pure React + HTML5 canvas, `imageRendering: pixelated`, LMB paint / RMB erase, client-side PNG export) + the `number[][]` palette-index pixel model from `useStudio.ts`. **Portable with no backend for manual drawing.**

### Role: Paint-AI Integration Analyst
**Why it's the wrong tool here.**
- **What it is:** PySide6 desktop paint app → **Stable Diffusion img2img** (`Model/ImageGenerator.py`). Sketch+prompt → **512×512 photorealistic raster**, not pixel art, not alpha-cut sprites.
- **Blockers:** **NVIDIA GPU + CUDA hardcoded** (`ImageGenerator.py:15,23`, no CPU path); multi-GB HF weights at runtime; **GPL-3.0 copyleft** + per-model weight licenses; needs a 512×512 init image (no text-only mode).
- **If ever used:** the inference core `generateImage(prompt, image, …) -> PIL.Image` is Qt-free and wrappable in a ~30-line FastAPI microservice (pipeline stays warm). But output needs heavy post-processing (bg removal → quantize → downscale) to look like a sprite. **Recommendation: skip for now; texel-studio + Ollama covers the AI need far better.**

---

## 3. The Integration Architecture

```
┌─────────────────────────── WEBVIEW (React) ───────────────────────────┐
│  DrawAssetModal  (ported texel-studio Canvas.tsx)                       │
│   • local grid: SpriteData = string[][]  (engine-native, no PNG needed) │
│   • palette via ui/ColorPicker.tsx                                      │
│   • [AI ▷] button  ── prompt ──►  generateSprite (optional)             │
│   • [Save]  ── name, sprite, footprint, category ──►  saveCustomAsset   │
└───────────────────────────────┬────────────────────────────────────────┘
                                 │ transport.send(ClientMessage)
                 ┌───────────────┴───────────────┐
                 ▼                               ▼
      server/clientMessageHandler.ts   adapters/vscode/PixelAgentsViewProvider.ts
                 │  (BOTH surfaces handle it — golden rule #2)
                 ▼
   saveCustomAsset handler:
     1. write ~/.pixel-agents/custom-assets/assets/furniture/<ID>/{manifest.json,<ID>.png}   (atomic tmp+rename)
     2. onReloadAssets(send)   ── reuses existing reload ──►
                 ▼
   loadFurnitureAssets → mergeLoadedAssets → broadcast furnitureAssetsLoaded  (decoded SpriteData JSON)
                 ▼
   webview useExtensionMessages.ts:565 → buildDynamicCatalog → EditorToolbar shows it → user PLACES it
                 ▼
   normal saveLayout → ~/.pixel-agents/layout.json   (persists like any furniture)

   ── OPTIONAL AI (local) ──────────────────────────────────────────────
   generateSprite{prompt} → server calls texel-studio SIDECAR (FastAPI :8500) → Ollama (local, free)
            → returns pixel_data (SSE stream) → render live in the SAME ported canvas → user tweaks → Save
```

### Why this shape
- **Reuses every existing seam.** New code = one message variant, one file-writer, one modal. Decode/merge/broadcast/catalog/placement/persistence are untouched.
- **Transport-symmetric.** The add-dir/reload/re-broadcast handshake already works identically in VS Code (`postMessage`) and standalone (`/ws`).
- **No CSP / static-route / GPU friction.** Sprites travel as `SpriteData` JSON.
- **AI is decoupled and local.** texel-studio runs as a sidecar you call; Ollama keeps it free and offline. You can ship the **manual editor first** and add the AI button later with no rearchitecting.

---

## 4. Implementation Roadmap (phased)

### Phase 0 — Spike (½ day)
Manually create `~/.pixel-agents/custom-assets/assets/furniture/TESTOBJ/{manifest.json,TESTOBJ.png}`, add the dir via **Settings → Add Asset Directory**, confirm it appears in the furniture palette and is placeable. **Proves the whole downstream pipeline before writing any code.**

### Phase 1 — Manual draw → office object (core feature, no AI)
1. **Protocol:** add `SaveCustomAsset` schema to `core/asyncapi.yaml` (`{ type, id, name, category, footprintW, footprintH, sprite: string[][] | pngBase64 }`), add to the `ClientMessage` `oneOf`, run `npm run asyncapi:generate`.
2. **Server:** new `case 'saveCustomAsset'` in `clientMessageHandler.ts` → `writeCustomAsset()` helper (atomic write of `manifest.json` + PNG under the managed dir; ensure the dir is in `externalAssetDirectories`) → `ctx.onReloadAssets(send)`. Mirror the branch in `PixelAgentsViewProvider.ts` (VS Code) calling `reloadAndSendFurniture()`.
3. **Webview:** `DrawAssetModal.tsx` — port texel-studio `Canvas.tsx`, back it with local `string[][]`, palette via `ui/ColorPicker.tsx`, built on `ui/Modal.tsx`. Mount in `App.tsx` next to `SettingsModal`; add a trigger to `BottomToolbar.tsx`. On Save → `transport.send({ type:'saveCustomAsset', ... })`.
4. **Tests:** a standalone e2e (like `ui.spec.ts` asset-reload) that saves a sprite and asserts a `furnitureAssetsLoaded` broadcast + placeable catalog entry; a server unit test for `writeCustomAsset` (atomic write, path-safety, size cap).

### Phase 2 — Local AI generation (Ollama via texel-studio sidecar)
1. Run texel-studio: `python server.py` (`:8500`), configured for **Ollama** (set the provider/model env so `_get_llm()` routes to local Ollama).
2. **Server:** `server/src/paintAi.ts` — `generateSprite(prompt)` → `fetch` texel-studio `POST /api/generate` (SSE), collect final `pixel_data`. New `generateSprite` ClientMessage `case` streams progress back (or returns final sprite) to the modal.
3. **Webview:** an **[AI ▷]** button in `DrawAssetModal` sends the prompt, renders streamed `pixel_data` in the same canvas; user tweaks, then Saves via the Phase-1 path.
4. Fallbacks: if the sidecar is down, the modal still works as a manual editor.

### Phase 3 — Polish (optional)
Rotation/state groups from the editor (multi-orientation draw), autotile export (reuse texel-studio's pure-PIL `generate_tileset`), sharing/export of custom packs, per-item recolor (already supported via `PlacedFurniture.color`).

---

## 5. Risks & Gotchas
- **Golden rule #2** is the easiest to forget: a ClientMessage handled only in `clientMessageHandler.ts` silently no-ops in VS Code (and vice-versa).
- **No asset-dir watcher** — always pair a file write with an explicit reload+broadcast.
- **Body limit** 64 KB if you ever go the POST route; ClientMessage/WS path avoids this.
- **Manifest robustness:** malformed single-asset manifests can yield `NaN` dims (non-null assertions in `loader.ts:120`). Validate `width/height/footprint` server-side before writing.
- **texel-studio static app boots against `localhost:8500`** — don't embed the *whole* app; **port just `Canvas.tsx`**. Embedding the full studio drags in FastAPI+SQLite+hardcoded API base.
- **Paint-AI:** GPL-3.0 means importing its code into a differently-licensed office is a legal issue — only ever call it as a *separate process*. Combined with GPU-only + wrong output shape, **not recommended**.

---

## 6. Decision Matrix — AI engine

| Criterion | texel-studio ✅ | Paint-AI ❌ |
|---|---|---|
| Output type | Palette-indexed **pixel art** (8/16/32/64) | 512×512 **photorealistic raster** |
| Sprite/alpha aware | Yes | No (solid bg; needs bg-removal + quantize + downscale) |
| **Local / free** | **Yes — Ollama built-in** | No — HF weights, NVIDIA-GPU + CUDA required |
| License fit | Source-available, internal/commercial OK | GPL-3.0 copyleft + model licenses |
| Integration | Sidecar `POST /api/generate` (SSE) + port `Canvas.tsx` | Wrap Qt-free core in FastAPI microservice (GPU host) |
| Verdict | **Primary AI + editor source** | **Skip / optional GPU experiment** |

---

## 7. Bottom Line
The expansion is **very feasible** and mostly a matter of **reusing existing seams**. Ship it in two moves:
1. **Manual pixel editor → office object** — port texel-studio's `Canvas.tsx` into a `DrawAssetModal`, add one `saveCustomAsset` message that writes into a managed external asset dir and reuses the reload broadcast. No renderer/catalog/placement changes.
2. **Local AI on top** — run texel-studio as an **Ollama-backed sidecar**, add a `generateSprite` message that streams `pixel_data` into the same canvas. Free, offline, pixel-art-native.

Paint-AI is set aside: wrong output, GPU-locked, GPL. texel-studio + Ollama is the aligned path.

---

## 8. Keeping the Paint-AI *Idea* (brush-steers-AI / sketch-to-pixel) — Local & Pixel-Native

Paint-AI's **engine** is wrong for us, but its **interaction model is excellent** and worth keeping:
- your **brush strokes are the init image**, not just a blank start;
- a **"Strength" slider** trades "preserve my drawing" vs "let AI reinvent";
- it **refines live** toward a text prompt.

We can reproduce that loop **pixel-native and local** — and most of it already exists in texel-studio.

### 8.1 Key finding: texel-studio already supports sketch-seeded refinement
- The agent paints onto a mutable pixel grid — `Canvas` (`texel-studio-main/agent.py:87`), tools bound via `make_tools(canvas)` (`:385`), driven by `run_agent_stream` (`:712`) over a per-thread checkpointer (`:594-605,748`).
- **Continuation starts from existing pixels:** `_run_agent_sse(..., is_continuation)` loads `gen["pixel_data"]` and refines it (`server.py:542,576-577`). This is exactly "AI edits *your* canvas."
- **Manual brush → server:** `POST /api/generations/{id}/update_pixels` writes `pixel_data[y][x]=c` back (`server.py:983-1010`). So the round-trip *user brushes pixels → agent continues from them* is built in.
- **Any Ollama text model qualifies:** the canvas is handed to the LLM as a **text number-grid** (`server.py:431-439`), so the model "reads" the sketch without needing vision. Vision (`make_tools(..., vision=True)`) is an optional upgrade (Ollama `llava` / `llama3.2-vision`).

### 8.2 Critical clarification: Ollama ≠ diffusion
Ollama runs **LLMs / vision-LLMs**, not Stable Diffusion. So:
- **"Brush-steers-AI, pixel output, local via Ollama"** = texel-studio's *LLM-paints-pixels* seeded from your sketch. ✅ Do this.
- The **literal** Paint-AI mechanism (diffusion img2img that morphs as you paint) needs a **separate diffusion runtime** (ComfyUI / A1111 / sd.cpp) + a pixel-art model — GPU-heavy, **not** Ollama. Optional Level 3 below.

### 8.3 A graduated menu (ship low levels first)

| Level | What the user does | Engine | Local? GPU? | Effort |
|---|---|---|---|---|
| **0 — Deterministic sketch→pixel** | draws smooth at high-res, we downscale + palette-quantize | pure PIL (`pixels_to_image` `server.py:216`; `jobs/sprite_from_photo.py`) — **no model** | Yes / No GPU | Low |
| **1 — Brush + LLM refine (RECOMMENDED)** | rough-sketches a sprite, hits **Refine**, agent cleans/completes it toward a prompt | texel-studio agent seeded via `update_pixels` + `is_continuation` | Yes / **Ollama, no GPU** | Medium |
| **2 — Vision-LLM interpretation** | doodles loosely; a multimodal model *looks* at the sketch and guides the paint agent | texel-studio `vision=True` + Ollama `llava`/`llama3.2-vision` | Yes / no GPU (bigger model) | Medium |
| **3 — True diffusion img2img** | paints and watches it morph, "strength" slider | ComfyUI/A1111 + pixel-art LoRA + ControlNet-scribble → downscale/quantize | Yes / **NVIDIA GPU** | High |

### 8.4 Mapping Paint-AI's controls onto the LLM path
- **"Strength" slider** → a *preservation* instruction to the agent ("keep the user's silhouette/outline; only refine shading/details") and/or lock the sketched pixels as fixed. Low strength = agent mostly cleans; high strength = agent reinterprets.
- **"Live regenerate as you draw"** → realistic expectation: an LLM agent loop is **seconds per refine, not per-stroke**. texel-studio already **streams via SSE**, so the UX is *"brush → Refine → watch it repaint live."* (Only Level 3 diffusion on GPU gets near per-generation live, still not per-stroke.)

### 8.5 Data flow (Level 1, the recommended one)
```
DrawAssetModal (ported Canvas.tsx)
  user brushes rough sprite  →  local grid: SpriteData string[][]
  [Refine ▷ prompt]
        │  transport.send(refineSprite{ prompt, sprite, strength })
        ▼
  server/paintAi.ts
        │  1. POST texel-studio /api/generations/{id}/update_pixels   (seed canvas with the sketch)
        │  2. POST /api/chat  (is_continuation) with prompt + strength-as-preservation-hint
        │     → SSE stream of pixel_data snapshots (Ollama refines the number-grid canvas)
        ▼
  stream snapshots back to modal  →  canvas repaints live  →  user tweaks by hand
  [Save]  →  saveCustomAsset  →  (Section 3 pipeline) → placeable office object
```
This **reuses the entire Section 3 pipeline** for persistence; the only additions are one `refineSprite` message and a `paintAi.ts` that talks to the sidecar. Level 0 is a pure-frontend/PIL fallback that needs no sidecar at all.

### 8.6 Recommendation
Build **Level 0 + Level 1**. Level 0 (deterministic downscale+quantize) gives an instant, offline "sketch → pixel" with zero AI, and doubles as the fallback when the sidecar is down. Level 1 (**brush → Ollama refine**) delivers the Paint-AI *feel* — your drawing steers the AI — while staying pixel-native and GPU-free. Add Level 2 (vision) if loose doodles need better interpretation. Keep Level 3 (real diffusion) as an optional GPU power-user mode behind the same modal, since its output still has to pass through the same downscale/quantize + `saveCustomAsset` path.

---

## 9. FINAL TARGET ARCHITECTURE (authoritative — supersedes the sidecar options above)

**User constraints (final):**
1. The whole project ships **inside `pixel-agents-main`** — it *is* the codebase.
2. **Follow the pixel-agents codebase** (layering, protocol generation, both-surfaces rule, eslint pixel rules, constants policy).
3. Sprite generation is exposed as **tabs** (add more tabs as needed).

### 9.1 Decision: no Python. Port the *ideas*, call Ollama directly from Node.
text-studio and Paint-AI are Python — they **cannot be embedded** inside a TS/Node monorepo without violating constraint #2. So:
- **Reuse texel-studio's UX + data model** (the HTML5-canvas pixel editor, palette-indexed grid, sketch-seeded refine, text-number-grid representation) by **re-implementing them in TypeScript** in `webview-ui/` and `server/`.
- **Call Ollama's local REST API directly from the Node server** (`http://localhost:11434`). Ollama is an **external runtime the user installs** — precisely how pixel-agents already treats the Claude Code CLI (external binary, in-repo TS provider). No FastAPI, no LangGraph, no Python in the tarball.
- **Drop** texel-studio's `server.py`/`agent.py`/Next.js and Paint-AI entirely from the shipped project. They remain *reference* for the port only.

| texel-studio / Paint-AI piece | In the final project |
|---|---|
| `Canvas.tsx` pixel editor (React + canvas) | **Port to TS** → `webview-ui/src/components/spritegen/…` |
| palette-indexed `number[][]` / `-1` transparent | **Adopt** as the editor's local model; convert to engine `SpriteData=string[][]` on save |
| `pixels_to_image`, `sprite_from_photo` quantizer (PIL) | **Reimplement in TS** (webview canvas / server `pngjs`) for deterministic sketch→pixel |
| `agent.py` LangGraph ReAct tool-loop | **Drop.** MVP = one-shot **structured-JSON** grid gen via Ollama; optional later: a lightweight TS refine loop |
| `server.py` FastAPI + SQLite + SSE | **Drop.** Use pixel-agents transport (ClientMessage/ServerMessage) + existing persistence |
| Paint-AI Stable-Diffusion img2img | **Drop** (Level 3 optional, external, out of scope for the in-repo build) |

### 9.2 Where each piece lives inside `pixel-agents-main` (respects strict layering)
```
core/
  asyncapi.yaml                       + SaveCustomAsset, GenerateSprite (Client);  + SpriteGenProgress (Server)
  src/messages.ts                     (regenerated — never hand-edit)
webview-ui/src/
  components/spritegen/
    SpriteGenTab.tsx                   NEW editor tab (entry point; sits by furniture/pets/carpet tabs)
    PixelEditor.tsx                    NEW per-pixel <canvas> (ported Canvas.tsx; imageSmoothingEnabled=false)
    usePixelEditor.ts                  NEW local grid state (string[][]) + undo + palette
  office/editor/EditorToolbar.tsx      + a "Create/Sprite" tab button
  hooks/useExtensionMessages.ts        + handle SpriteGenProgress (live repaint); furnitureAssetsLoaded already handled
server/src/
  providers/ai/ollamaClient.ts         NEW — fetch() to http://localhost:11434 (/api/chat, /api/tags), structured JSON, streaming
  spriteGen.ts                         NEW — prompt build (seed sketch as text grid) → Ollama → pixel grid → progress broadcast
  customAssetWriter.ts                 NEW — atomic write manifest.json + <id>.png into managed external dir
  clientMessageHandler.ts              + cases: saveCustomAsset, generateSprite
adapters/vscode/
  PixelAgentsViewProvider.ts           + mirrored branches for the same two ClientMessages (both-surfaces rule)
~/.pixel-agents/
  custom-assets/assets/furniture/<ID>/ managed dir, auto-added to externalAssetDirectories
```
Layering respected: `core` (protocol) → `server` (ollama/spritegen/writer) and `webview-ui` (editor UI) depend only on `core`; `adapters/vscode` composes both. Nothing new crosses a boundary.

### 9.3 New protocol messages (via `asyncapi.yaml` → `npm run asyncapi:generate`)
- **Client → server:** `generateSprite { prompt, seedSprite?: string[][], size, strength }`, `saveCustomAsset { id, name, category, footprintW, footprintH, sprite: string[][] }`.
- **Server → client:** `spriteGenProgress { requestId, sprite: string[][], done }` (streams Ollama refinement into the editor). Save reuses the existing `furnitureAssetsLoaded` broadcast → `buildDynamicCatalog` → placeable.

### 9.4 Ollama integration (TS, server-side)
- Node `fetch` → `POST http://localhost:11434/api/chat` with `format`/structured-output so the model returns **palette-indexed rows as JSON**; `GET /api/tags` to list installed models for a Settings dropdown. Optional `stream:true` for live snapshots; optional `images:[base64]` for a vision model (`llava`/`llama3.2-vision`) to interpret a doodle.
- Prompt seeds the **current sketch as a text number-grid** (texel-studio's proven representation) so even a text-only local model can refine it. "Strength" → a preservation instruction in the prompt.
- Graceful degradation: if Ollama isn't reachable, the tab still works as a **manual editor + deterministic quantize (Level 0)** — no hard dependency.

### 9.5 UI: tabs (per constraint #3)
Add a **"Create" (Sprite) tab** to `EditorToolbar.tsx` alongside the furniture/pets/carpet/areas tabs. The tab hosts `SpriteGenTab` → `PixelEditor` (its **own** small canvas, **not** the tile-quantized office grid). Inside: palette, brush/erase, a prompt box + **Generate/Refine** button (Ollama), and **Save to Office** (fires `saveCustomAsset`). "Add more tabs" later = more sub-tabs (e.g. Draw / AI Generate / Import) under the same Create tab.

### 9.6 Revised phase plan (all in-repo, TS only)
- **P0 Spike** — hand-place files in `~/.pixel-agents/custom-assets/…`, register the dir, confirm placeable. (No code.)
- **P1 Manual editor + Save** — `SpriteGenTab`+`PixelEditor`+`usePixelEditor`; `saveCustomAsset` message; `customAssetWriter.ts`; both-surfaces dispatch; reuse reload→`furnitureAssetsLoaded`. **Ships a working "draw → office object" with zero AI.**
- **P2 Deterministic sketch→pixel** — high-res brush + TS downscale/palette-quantize (Level 0). Still no AI.
- **P3 Local Ollama generate/refine** — `ollamaClient.ts` + `spriteGen.ts`; `generateSprite` message; `spriteGenProgress` stream; model dropdown from `/api/tags`. Brush-steers-AI, pixel-native, GPU-free.
- **P4 (optional)** — vision-model doodle interpretation; lightweight iterative refine loop; Level-3 diffusion as an external power-user toggle.

### 9.7 Non-negotiables when building (from the codebase)
- Protocol edits go through `core/asyncapi.yaml` + `npm run asyncapi:generate`; never hand-edit `core/src/messages.ts` (CI drift-fails).
- Every new ClientMessage handled in **both** `server/src/clientMessageHandler.ts` **and** `adapters/vscode/PixelAgentsViewProvider.ts`.
- New React UI uses only `ui/Modal.tsx`/`ui/Button.tsx`/Tailwind tokens/`--pixel-*` vars/`constants.ts` colors — the 3 eslint rules (`no-inline-colors`, `pixel-shadow`, `pixel-font`) block PRs otherwise.
- No `enum` (use `as const`); `import type`; `.js` extensions on server/adapter relative imports; strict `noUnusedLocals`.
- Add e2e coverage in the existing Playwright suite (a standalone spec like `ui.spec.ts` for save→placeable; a server unit test for `customAssetWriter`).
