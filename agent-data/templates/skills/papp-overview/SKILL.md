---
name: papp-overview
zh_name: "Akselos Papp 总览"
en_name: "Papp Overview Dashboard"
emoji: "🏭"
description: "Akselos asset-integrity Papp home page — status banner, KPI strip, equipment table, model panel"
category: dashboard
scenario: engineering
aspect_hint: "Desktop 1440"
tags: ["papp", "akselos", "asset-integrity", "dashboard", "spec-to-mockup"]
recommended: 1
design_directives: none
prompt_language: en
allow_read: true
example_id: "example-papp-overview"
example_name: "Coke Drum Overview"
example_format: "markdown"
example_tagline: "Customer spec → Papp home page"
example_desc: "A refinery asset-integrity spec turned into the Papp home dashboard."
---

【Template: Akselos Papp — Overview / Home page】

You are producing a **click-through HTML mockup of an Akselos Papp** (platform application)
from a customer specification. The reader is the customer: it must look like the shipped
product, not like a wireframe and not like a generic admin theme.

This template covers the **home / overview page** — the one that answers "what is the state
of this asset right now, and how long has it got".

## 1. Read the input before designing

- The content may reference local files as relative markdown links
  (`![spec](my-plan.assets/hex-spec.png)`). **Read every one of them.** Screenshots and
  annotated mockups are the authoritative layout; prose is secondary where they disagree.
- An annotated screenshot usually pairs with a numbered requirement list: red boxes
  labelled `(1)…(5)` on the image, and numbered instructions beside it. Apply each
  instruction to the region its arrow points at. "Remove the donut chart" means that region
  is **absent** from your output — do not reinterpret it as "make it smaller".
- Reuse the customer's real vocabulary verbatim: asset ids (`113-D-0006`, `2E-2146A`),
  sensor tags (`113TI6164A.PV`), site and unit names, units of measure, limit values.
- Where the spec implies a panel but gives no numbers, invent engineering-plausible values
  and mark that element `data-mock="true"` so mock values stay greppable.
  Never lorem ipsum, never "Your text here".
- Section count follows the spec. Every requirement in it must be visible somewhere in the
  output; nothing gets summarised away.

## 2. Akselos Papp chrome — reproduce exactly

**Shell**
- Fixed left sidebar, 280px, solid `#072b4b`, full height, square corners.
  - Top: square logo mark + `AKSELOS` wordmark (white, bold, ~22px, slight tracking), a
    white `Beta` pill, and a panel-collapse icon at the right edge.
  - Nav items: ~44px tall, 15px medium white, 18px inline-SVG icon, 10px radius, 16px side
    padding. Active item is filled `#0084ff`; hover is `rgba(255,255,255,.08)`.
  - Items with children (`SPM Monitoring`, `Asset Integrity`) carry a chevron and expand to
    indented children with a 2px left rule; the active child is the filled one.
  - Footer pinned to the bottom above a hairline: `Logout` with icon, then
    `Time format: DD/MM/YYYY HH:mm:ss` at 12px `rgba(255,255,255,.55)`.
- Content area on a pale blue wash (`#eef4fb` → `#f7fbff` vertical gradient), 24px gutters.

**Page header**
- Left: page title, ~32px bold `#111827` — `<Site> <Unit> <Asset> Dashboard`.
- Right: connection/status pair as label-over-value, 12px grey label and 14px value with a
  ⊗ glyph — `Data Connectivity: Disconnected`, `Asset Status: Unknown`. Grey when unknown,
  `#3fb950` when healthy, `#f85149` when failed.
- A primary action button (`#0084ff`, white text, 6px radius) sits at the far right only
  when the spec asks for one.

**Cards**
- White, 8px radius, 1px `rgba(0,0,0,.06)` border, shadow
  `0 1px 3px rgba(0,0,0,.12), 0 1px 2px rgba(0,0,0,.24)`, 16–20px padding.
- A card carrying a status takes a 4px left border and tints its headline value to match:
  green `#3fb950` (nominal), amber `#d29922` (warning), red `#f85149` (attention required).
- Card title: 11–12px, uppercase, letter-spacing `.06em`, `#6b7280`, followed by a small
  circled `?` help affordance (`title=` tooltip). **Every panel title has one** — it is a
  Papp signature.
- Headline metric 28–34px semibold; unit and qualifier in 12px grey beneath; a coloured
  6px dot before a subtitle when it names a component (`● Cone`, `● Skirt`).

**Typography**: `Segoe UI, system-ui, -apple-system, sans-serif` throughout. No serif, no
Chinese-first font stack, no Google Font import unless the spec asks for one.

**Charts**: ECharts 5 from jsdelivr. Palette in order
`#5470c6 #91cc75 #fac858 #ee6666 #73c0de #3ba272 #fc8452 #9a60b4 #ea7ccc`; axis labels
`#464646`; split lines `#ccc`; axis names bold. This mirrors the real `library/charting`
theme, so the mockup and the eventual implementation agree.

## 3. Layout pool for this page

Pick what the spec calls for and repeat a recipe as often as the data needs. A pool, not a
page order, and not a quota.

- **Analytical-horizon banner** — full-width card split into pressurized / non-pressurized
  halves by a vertical rule. Each half: group label (11px uppercase grey), status word in
  the status colour (`NOMINAL` / `WARNING` / `ATTENTION REQUIRED`), a large remaining-life
  figure with a component dot, and a mini bar list of failure modes (crack / bulging /
  fatigue) — each row a label, a horizontal progress track, a value, and a `MIN` chip on
  the governing one. Modes without data read `No data` in grey italics.
- **KPI strip** — 4–6 equal cards in one row: metric name + `?`, headline value, a status
  dot line naming the limit (`Inside DOW (limit 505°C)`), a grey sensor tag, a timestamp,
  and a chevron at the bottom-right meaning "drill down".
- **Split metric card** — one card carrying two related numbers side by side
  (crack `LENGTH` / `DEPTH`, fatigue `Toriconical Head` / `Skirt`) with per-value colour.
- **Equipment data table** — two-column `Items` / `Value` table, zebra `#f9fafb` rows,
  12px uppercase grey header, no vertical rules.
- **Model panel** — card holding a technical illustration. Draw it as inline SVG: a
  sectioned vessel elevation with per-course colour blocks, a component legend, a compass
  rose with azimuth marks, and an elevation scale. Never hotlink an external image.
- **Trend strip** — small multiples of sparkline-style line charts when the spec asks for
  history on the home page.

## 4. Build blueprint (always the last element)

After `</main>`, emit a collapsed `<details id="build-blueprint">` with summary
`Build blueprint — how this maps onto the Papp codebase`, styled so a customer demo can
ignore it (muted, bordered, monospace only for paths). Contents:

- **Recipes**: which of R1 (read-only endpoint), R2 (new page), R3 (new chart),
  R4 (new table ⚠ needs DB confirmation) this page implies.
- **Backend**: per panel, the router function and path (`routers/<resource>.py` →
  `GET /<resource>/<action>`) and the response schema class in `schemas/<resource>.py`,
  one line per field (name, type, `description=`). Note which fields are nullable.
- **Frontend**: `ServerCommunication/<resource>.service.ts` function; the `useQuery` key
  (list **every** argument the query function reads) and the `staleTime` tier; the type in
  `types/<feature>.ts`; the page split
  `pages/<Page>/{<Page>.tsx, use<Page>.ts, <page>Utils.ts}`; sub-components in
  `components/<Page>/` behind a barrel; SCSS block at
  `assets/sass/pages/coker/<page>.scss` in BEM using the shared tokens/mixins.
- **ECharts registration**: every chart type, component and feature used, listed for
  `library/charting/echartsCore.ts` — an unregistered one renders a blank chart with no
  error at all.
- **Tenancy**: any panel that should sit behind `hasFeature(...)` or a tenant config value.
- **Open questions**: what the spec did not answer (limits, refresh cadence, who may see
  what, which values are computed vs stored).

Write it in that vocabulary — it is handed straight to the `implement-papp` skill.
