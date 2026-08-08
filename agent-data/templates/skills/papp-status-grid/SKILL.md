---
name: papp-status-grid
zh_name: "Akselos Papp 资产状态网格"
en_name: "Papp Asset Status Grid"
emoji: "🟩"
description: "Akselos Papp fleet page — colour-coded asset tiles with paired metrics, unit selector, adjacent pop-ups"
category: dashboard
scenario: engineering
aspect_hint: "Desktop 1440"
tags: ["papp", "akselos", "fleet", "status-grid", "spec-to-mockup"]
recommended: 3
design_directives: none
prompt_language: en
allow_read: true
example_id: "example-papp-status-grid"
example_name: "Waste Gas HEX Fleet"
example_format: "markdown"
example_tagline: "Annotated mockup → fleet grid"
example_desc: "A marked-up screenshot with numbered change requests turned into a Papp fleet page."
---

【Template: Akselos Papp — Asset Status Grid】

You are producing a **click-through HTML mockup of an Akselos Papp** (platform application)
from a customer specification. The reader is the customer: it must look like the shipped
product, not like a wireframe and not like a generic admin theme.

This template covers the **fleet page**: dozens of equipment items shown at once as
colour-coded tiles, each carrying a couple of numbers, grouped by train or unit.

## 1. Read the input before designing

- The content may reference local files as relative markdown links
  (`![spec](my-plan.assets/hex-spec.png)`). **Read every one of them.** For this page type
  the input is very often a screenshot of the *current* page with red annotations plus a
  numbered list of changes — that image is the specification.
- Annotation protocol: a red box labelled `(n)` marks a region; instruction `n` in the list
  says what to do with it. Honour the verb exactly.
  - *"Simplify"* → fewer items, same layout language.
  - *"Remove the stress & fatigue bar charts and the donut chart"* → those panels do **not**
    appear in your output. Do not shrink them, do not move them into a tab.
  - *"Add pop-ups"* → an interactive element anchored beside the tile, not a centred modal.
  - *"Consolidate view: both trains on a single page"* → drop the selector that used to
    switch between them and show both groups stacked.
- Reuse the customer's real vocabulary verbatim: equipment tags (`2E-2146A`), train names,
  metric names and units (`Von-Mises Stress (MPa)`, `Fatigue Damage (%)`).
- Where the spec gives a shape but no values, generate plausible values consistent with the
  colour of each tile and mark the element `data-mock="true"`. Never lorem ipsum.
- Every numbered requirement must be satisfied and visible.

## 2. Akselos Papp chrome — reproduce exactly

**Shell**
- Fixed left sidebar, 280px, solid `#072b4b`, full height, square corners.
  - Top: square logo mark + `AKSELOS` wordmark (white, bold, ~22px, slight tracking).
  - Nav items: ~44px tall, 15px medium white, 18px inline-SVG icon, 10px radius. Active
    item filled `#0084ff`; hover `rgba(255,255,255,.08)`.
  - A grouped radio list (e.g. `Train 1` / `Train 2`) may live in the sidebar under the nav,
    boxed with a hairline — **unless** the spec consolidates the groups onto one page, in
    which case it is removed.
  - Footer pinned to the bottom: a version line (`Version 3.0`) and/or a primary button
    (`Go To Monitor`), then `Logout` when the spec shows one.
- Content area on a pale blue wash (`#eef4fb` → `#f7fbff`), 24px gutters; a faint hexagonal
  watermark behind the page is acceptable when the source shows one.

**Page header**: title ~32px bold `#111827` (`Waste Gas HEX Dashboard`), status pair on the
right when the spec shows one.

**Cards**: white, 8px radius, 1px `rgba(0,0,0,.06)` border, shadow
`0 1px 3px rgba(0,0,0,.12), 0 1px 2px rgba(0,0,0,.24)`. Titles 11–12px uppercase `#6b7280`
with a circled `?` help affordance.

**Typography**: `Segoe UI, system-ui, -apple-system, sans-serif`.

**Charts** (only if the spec keeps them): ECharts 5 from jsdelivr, palette
`#5470c6 #91cc75 #fac858 #ee6666 #73c0de #3ba272 #fc8452 #9a60b4 #ea7ccc`, axis labels
`#464646`, split lines `#ccc`.

## 3. Layout pool for this page

- **Asset tile** — a rounded rectangle, ~150×64px, bold dark-on-light tag text centred,
  filled by a severity ramp: green `#7ed957` → yellow `#e8f125` → amber `#f5a623` →
  orange `#f4761f` → red `#e8402a`. The fill encodes the worst of its metrics; the bands
  come from the spec. A 2px `#111` border marks a selected tile.
- **Metric pair** — beside each tile, two stacked mini-cells on a pale green (`#e8f5e9`)
  ground: value on the left, metric name on the right
  (`145.98 | Von-Mises Stress (MPa)`, `60.00 | Fatigue Damage (%)`). One pair may serve two
  tiles that sit either side of it, exactly as in the source layout.
- **Grid group** — a card holding one unit's tiles as a 2×2 (A/B over C/D) with the metric
  pair in the middle column; groups tile 2-up across the page.
- **Status legend** — a simple green/grey key for operational vs non-operational when the
  spec asks for status boxes instead of charts.
- **Adjacent pop-up** — an anchored panel appearing on hover/click beside its tile (never a
  centred modal): tag as the title, a small cumulative-damage-over-time line chart, current
  values, and a close affordance. Plain CSS/JS: absolutely positioned, `hidden` toggled, an
  arrow pointing back at the tile, and it must not push the grid around. The trigger is
  keyboard-focusable.
- **Group selector** — radio list for train or unit, sidebar-boxed. Present only when the
  spec has not consolidated the groups.
- **Fleet roll-ups** — donut of in-service vs out-of-service, and per-asset comparison bar
  charts. Include **only** when the spec keeps them.

## 4. Build blueprint (always the last element)

After `</main>`, emit a collapsed `<details id="build-blueprint">` with summary
`Build blueprint — how this maps onto the Papp codebase`, muted and bordered. Contents:

- **Recipes**: which of R1 (read-only endpoint), R2 (new page), R3 (new chart),
  R4 (new table ⚠ needs DB confirmation) this page implies.
- **Backend**: one list endpoint returning every asset with its latest metrics rather than
  one request per tile — call the N+1 out explicitly, since a fleet page is where it bites.
  Give the router function, path, response schema (`schemas/<resource>.py`, one line per
  field with `description=`) and the columns needing `index=True` if a table is involved.
  The pop-up's history series is a second endpoint keyed by asset tag.
- **Frontend**: `ServerCommunication/<resource>.service.ts`; the `useQuery` key (including
  the group/train argument), `enabled:` for the pop-up's lazy history query, `staleTime`
  tier, module-level default; types in `types/<feature>.ts`; page split
  `pages/<Page>/{<Page>.tsx, use<Page>.ts, <page>Utils.ts}` with the tile colour thresholds
  living in `<page>Utils.ts` as pure functions (they are the piece worth unit-testing);
  tiles and pop-up in `components/<Page>/` behind a barrel; SCSS block at
  `assets/sass/pages/coker/<page>.scss`, status colour flowing through `--status-color`.
- **ECharts registration**: every type and component used by the surviving charts, for
  `library/charting/echartsCore.ts`.
- **Open questions**: the exact metric→colour thresholds, what "non-operational" means in
  the data, whether one representative asset per unit is a display rule or a query filter.

Write it in that vocabulary — it is handed straight to the `implement-papp` skill.
