# Sprite Studio — Detailed Design (in-repo, freeform W×H)

Implementation-ready design for the draw / AI-generate → placeable-furniture feature, built **inside `pixel-agents-main`**, following its codebase. Companion to `PIXEL_AGENTS_INTEGRATION_REPORT.md` (§9 authoritative). Status: **design/planning — no code yet.** Sprite sizing = **freeform W×H**.

---

## 1. Freeform W×H → footprint → walk-through rows (the core mechanic)

The office is a **16px tile grid**. A sprite occupies a **footprint** of whole tiles, is **anchored bottom-left**, and may be **taller than its footprint's collision area** (e.g. a plant whose leaves overhang a walkable tile). Three derived quantities:

```
footprintW = ceil(W / 16)          # tiles wide
footprintH = ceil(H / 16)          # tiles tall (visual)
backgroundTiles = footprintH - solidRows   # top rows that are walk-through + overlap-allowed
```

- **`solidRows`** = how many *bottom* tile-rows actually block movement / collide. The user sets this (default **1** — only the base tile is solid, everything above overhangs).
- **`backgroundTiles`** = the remaining top rows. Engine semantics (from the asset pipeline): those rows let other furniture be placed under them AND characters walk through them, and they z-sort *behind* the host.

### Sizing rules
- **Recommended:** W and H are multiples of 16 so tile boundaries are clean. The editor's default new-canvas presets are 16/32/48/64, but the **width/height fields accept any integers** (freeform).
- **Non-multiples of 16:** allowed. `footprint = ceil(dim/16)`; the sprite is drawn **anchored to the bottom-left** of the footprint box, leaving transparent padding at top/right. The editor shows a **16px tile-grid overlay** and shades the `backgroundTiles` (walk-through) region so the user sees exactly which rows overhang.
- **Chairs** (`category: "chairs"`) become **seats** — one seat per footprint tile — so a chair sprite should normally be `solidRows = footprintH` (backgroundTiles 0) and small (1×1 or 2×1).

### Worked examples
| Item | W×H px | footprint | solidRows | backgroundTiles | Notes |
|---|---|---|---|---|---|
| Mug (decor) | 16×16 | 1×1 | 1 | 0 | trivial |
| Cactus (decor) | 16×32 | 1×2 | 1 | 1 | top tile walk-through (overhang) |
| Big desk | 48×32 | 3×2 | 1 | 1 | back row overlappable; `isDesk` (category desks) |
| Plant, wide | 32×48 | 2×3 | 1 | 2 | tall overhang |
| Chair, front | 16×16 | 1×1 | 1 | 0 | category chairs → 1 seat |

### UI control for `solidRows`/`backgroundTiles`
A small **"base rows" stepper** (1..footprintH) in the save panel, with the tile-grid overlay live-shading the walk-through rows. Default `solidRows = 1`. For `footprintH === 1`, hide the control (always 0 background).

---

## 2. Editor data model & conversions

### Internal editor state (`usePixelEditor.ts`)
```ts
type PixelGrid = number[][];   // [row][col] palette index; -1 = transparent   (texel-studio model)
interface EditorDoc {
  width: number; height: number;         // px (freeform)
  grid: PixelGrid;                        // height×width
  palette: string[];                      // hex '#RRGGBB' (+ '#RRGGBBAA' allowed)
  // meta for save:
  name: string; category: FurnitureCategory;
  solidRows: number; canPlaceOnWalls: boolean; canPlaceOnSurfaces: boolean;
}
```
Undo/redo = snapshot stack of `grid` (mirror the editor's existing 50-level pattern in `editorState.ts`).

### Conversions
```
editor PixelGrid  --toSpriteData-->  SpriteData = string[][]   // cell = palette[idx] or '' (idx<0)
SpriteData        --(server, pngjs)->  <id>.png (RGBA)          // '' → alpha 0; '#RRGGBBAA' → semi
<id>.png          --(reload, pngToSpriteData)->  SpriteData     // broadcast to office
```
- `SpriteData` (`string[][]`, `''`=transparent) is the **engine-native** sprite format, so the editor↔engine conversion is a trivial index→hex map — no PNG round-trip needed in the browser.
- The **PNG is only produced server-side** (pngjs `PNG.sync.write`, already a dependency) because the furniture manifest requires an on-disk `<id>.png`. Encoding rule mirrors the decoder threshold (`alpha < 2` ⇒ transparent).

---

## 3. UI: the "Create" tab (per your "add tabs" preference)

Add a **Create** tab to `webview-ui/src/office/editor/EditorToolbar.tsx`, alongside furniture / pets / carpet / areas. It hosts `SpriteGenTab`, which has **sub-tabs** (extensible — "add more tabs to gen sprite"):

```
[ Create ]
  ├─ Draw        — PixelEditor: palette, brush/erase/fill/eyedropper, tile-grid overlay, undo/redo
  ├─ AI Generate — prompt box + model dropdown + Generate/Refine (Ollama); paints into the same grid
  └─ Import      — load a PNG file → decode to grid (reuse pngToSpriteData on server or a browser decode)
```
Save panel (shared across sub-tabs): **name, category, base-rows stepper, wall/surface toggles, [Save to Office]**.

The drawing surface is its **own `<canvas>`** (modeled on `ItemSelect.tsx`, `imageSmoothingEnabled=false`) — **not** the tile-quantized office canvas. It never touches `panRef`/zoom/`OfficeState`. Styling via `ui/*` + Tailwind tokens only (satisfies `no-inline-colors` / `pixel-shadow` / `pixel-font`).

Interaction (ported from texel-studio `Canvas.tsx`): LMB paint with selected palette color, RMB erase (→ -1), drag to stroke, pixel-perfect scaling, diff-based redraw.

---

## 4. Protocol (via `core/asyncapi.yaml` → `npm run asyncapi:generate`)

### ClientMessage: `saveCustomAsset`
```yaml
SaveCustomAsset:
  type: object
  additionalProperties: false
  required: [type, name, category, sprite, width, height, footprintW, footprintH]
  properties:
    type:              { const: saveCustomAsset }
    id:                { type: string }        # optional; server slugifies name if absent
    name:              { type: string }
    category:          { type: string, enum: [desks,chairs,storage,electronics,decor,wall,misc] }
    sprite:            { type: array, items: { type: array, items: { type: string } } }  # SpriteData
    width:             { type: integer }
    height:            { type: integer }
    footprintW:        { type: integer }
    footprintH:        { type: integer }
    backgroundTiles:   { type: integer }       # optional (default 0)
    canPlaceOnWalls:   { type: boolean }
    canPlaceOnSurfaces:{ type: boolean }
```

### ClientMessage: `generateSprite`
```yaml
GenerateSprite:
  required: [type, requestId, prompt, width, height]
  properties:
    type:      { const: generateSprite }
    requestId: { type: string }               # correlate progress
    prompt:    { type: string }
    seedSprite:{ type: array, items: { type: array, items: { type: string } } }  # optional current grid
    strength:  { type: number }               # 0..1 preserve→reinvent
    width:     { type: integer }
    height:    { type: integer }
    model:     { type: string }               # optional; from /api/tags
```

### ServerMessage: `spriteGenProgress`
```yaml
SpriteGenProgress:
  required: [type, requestId, sprite, done]
  properties:
    type:      { const: spriteGenProgress }
    requestId: { type: string }
    sprite:    { type: array, items: { type: array, items: { type: string } } }  # partial/final grid
    done:      { type: boolean }
    error:     { type: string }               # optional
```
Save reuses the existing **`furnitureAssetsLoaded`** broadcast — no new "asset available" message.

**Both surfaces** dispatch the two ClientMessages (`server/src/clientMessageHandler.ts` **and** `adapters/vscode/PixelAgentsViewProvider.ts`).

---

## 5. Server flow

### `saveCustomAsset` → `customAssetWriter.ts`
1. Slugify `id` (validate `^[A-Z0-9_]+$`; ensure unique vs loaded catalog).
2. Encode `sprite` → PNG (pngjs, alpha rules).
3. Build minimal manifest:
   ```json
   { "id":"<ID>","name":"<name>","category":"<cat>","type":"asset",
     "canPlaceOnWalls":<bool>,"canPlaceOnSurfaces":<bool>,"backgroundTiles":<n>,
     "width":W,"height":H,"footprintW":fw,"footprintH":fh }
   ```
4. **Atomic write** (tmp+rename) into `~/.pixel-agents/custom-assets/assets/furniture/<ID>/{manifest.json,<ID>.png}`.
5. Ensure `~/.pixel-agents/custom-assets` is in `config.externalAssetDirectories` (add on first save).
6. Call the existing reload: standalone `ctx.onReloadAssets(send)` / VS Code `reloadAndSendFurniture()` → `loadFurnitureAssets` → `mergeLoadedAssets` → **`furnitureAssetsLoaded`** → webview `buildDynamicCatalog` → item appears in its category tab → placeable → persists via normal `saveLayout`.

Guards: size cap (like `MAX_PET_PNG_SIZE`), path-escape (loaders already enforce), reject NaN dims.

### `generateSprite` → `spriteGen.ts` + `providers/ai/ollamaClient.ts`
1. Build messages: system ("you output an N×M palette-indexed pixel grid, transparent = -1, pixel-art, no anti-aliasing…") + user (prompt + `strength` preservation hint + **seed grid rendered as a text number-grid**, texel-studio's proven representation).
2. `POST http://localhost:11434/api/chat` with `format` = JSON schema `{ palette: string[], pixels: number[][] }`, `stream: true`.
3. On each streamed chunk that yields a parseable grid → convert to `SpriteData` → emit `spriteGenProgress{ sprite, done:false }`. Final → `done:true`.
4. Webview `useExtensionMessages` handles `spriteGenProgress` → repaint the editor grid live.
5. **Fallback:** if `fetch` to `:11434` fails → emit `spriteGenProgress{ done:true, error:"Ollama not reachable" }`; the tab remains a manual editor + deterministic quantize.

Model list for the dropdown: `GET http://localhost:11434/api/tags`. Optional vision (doodle interpretation): send the grid as a base64 PNG in `messages[].images` for a multimodal model (`llava`, `llama3.2-vision`).

No new npm deps (Node `fetch` + existing `pngjs`).

---

## 6. Deterministic sketch→pixel (Level 0, no AI)
For "draw smooth → make it pixel": the Import/Draw surface can take a higher-res drawing and **downscale + palette-quantize** in TS (nearest-neighbor box downscale + nearest-palette-color map — the JS equivalent of texel-studio's `sprite_from_photo`). Pure client-side; works offline; also the fallback when Ollama is down.

---

## 7. Testing (existing Playwright + Vitest suites)
- **Server unit:** `customAssetWriter` (atomic write, slug/dedupe, PNG encode round-trips through `pngToSpriteData`, size cap, path-safety); `spriteGen` prompt/parse with a mocked Ollama `fetch`.
- **E2E (standalone, like `ui.spec.ts`):** save a small sprite → assert `furnitureAssetsLoaded` fires and the item is in the catalog / placeable. AI path e2e uses a mock Ollama endpoint (no real model in CI).
- Regenerate `e2e/README.md` inventory (`npm run e2e:inventory`) if specs are added.

---

## 8. Open design decisions (resolve before P1)
1. **Color model** — palette-indexed (cohesive, best for AI, texel-studio-style) vs free RGBA per pixel vs palette-with-custom-colors. *Proposed: palette-indexed with an "add custom color" button.*
2. **Orientation scope in v1** — single orientation only vs support rotation groups (front/side/back) from the start. *Proposed: single orientation in v1; rotation is a later phase (needs multi-canvas + group manifest).*
3. **Storage** — dedicated auto-registered `~/.pixel-agents/custom-assets/` vs let the user choose the folder. *Proposed: dedicated managed dir, auto-added to `externalAssetDirectories`.*
4. **Edit/delete** of existing custom assets (list + delete UI) — v1 or later. *Proposed: create-only in v1; delete via a small "My Assets" list in v2.*
5. **Ollama default model** + how the user configures the endpoint/model (Settings entry). *Proposed: `/api/tags` dropdown; default to first installed; endpoint overridable in Settings.*
6. **`backgroundTiles` UX** — auto (default solidRows=1) vs always explicit. *Proposed: auto default + optional stepper.*

---

## 9. Build order recap (unchanged, freeform-aware)
- **P1** — Create tab + PixelEditor (freeform W×H, tile overlay, base-rows stepper) + `saveCustomAsset` + `customAssetWriter` + both-surfaces dispatch. Draw → office object, **no AI**.
- **P2** — deterministic downscale/quantize (Level 0).
- **P3** — `generateSprite`/`spriteGenProgress` + `ollamaClient`/`spriteGen`; live refine; model dropdown.
- **P4** — vision doodle interpretation; rotation/state groups; edit/delete; (optional) external diffusion.
