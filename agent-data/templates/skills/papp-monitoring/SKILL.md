---
name: papp-monitoring
zh_name: "Akselos Papp 监测与趋势"
en_name: "Papp Monitoring & Trends"
emoji: "📈"
description: "Akselos Papp monitoring page — limit cards, time series with design limits, gauges, top-N damage tables"
category: dashboard
scenario: engineering
aspect_hint: "Desktop 1440"
tags: ["papp", "akselos", "monitoring", "timeseries", "spec-to-mockup"]
recommended: 2
design_directives: none
prompt_language: en
allow_read: true
example_id: "example-papp-monitoring"
example_name: "Process Monitoring"
example_format: "markdown"
example_tagline: "Sensor spec → monitoring page"
example_desc: "A sensor and limit specification turned into a Papp process-monitoring page."
---

【Template: Akselos Papp — Monitoring & Trends page】

You are producing a **click-through HTML mockup of an Akselos Papp** (platform application)
from a customer specification. The reader is the customer: it must look like the shipped
product, not like a wireframe and not like a generic admin theme.

This template covers the **monitoring and inspection pages** — process monitoring, fatigue
status, crack status, cycle inspection: pages built around measurements over time, their
design limits, and where on the asset the damage is.

## 1. Read the input before designing

- The content may reference local files as relative markdown links
  (`![spec](my-plan.assets/monitoring-spec.png)`). **Read every one of them.** Screenshots
  and annotated mockups are the authoritative layout; prose is secondary where they
  disagree.
- An annotated screenshot usually pairs with a numbered requirement list: red boxes
  labelled `(1)…(5)` on the image, and numbered instructions beside it. Apply each
  instruction to the region its arrow points at. "Remove the bar charts" means those
  regions are **absent** from your output.
- Reuse the customer's real vocabulary verbatim: sensor tags (`113TI6164A.PV`), asset ids,
  design limits (`Max Design: 505`), units, cycle ids, date format (`DD/MM/YYYY`).
- Where the spec implies a panel but gives no numbers, generate engineering-plausible
  series (a realistic trace, not a clean sine wave) and mark that element
  `data-mock="true"`. Never lorem ipsum.
- Every requirement in the spec must be visible somewhere in the output.

## 2. Akselos Papp chrome — reproduce exactly

**Shell**
- Fixed left sidebar, 280px, solid `#072b4b`, full height, square corners.
  - Top: square logo mark + `AKSELOS` wordmark (white, bold, ~22px, slight tracking), a
    white `Beta` pill, and a panel-collapse icon at the right edge.
  - Nav items: ~44px tall, 15px medium white, 18px inline-SVG icon, 10px radius, 16px side
    padding. Active item is filled `#0084ff`; hover is `rgba(255,255,255,.08)`.
  - Items with children (`SPM Monitoring`, `Asset Integrity`) carry a chevron and expand to
    indented children with a 2px left rule; the active child is the filled one. On a
    monitoring page the parent is expanded and the current child is active.
  - Footer pinned to the bottom above a hairline: `Logout` with icon, then
    `Time format: DD/MM/YYYY HH:mm:ss` at 12px `rgba(255,255,255,.55)`.
- Content area on a pale blue wash (`#eef4fb` → `#f7fbff` vertical gradient), 24px gutters.

**Page header**
- Left: page title, ~32px bold `#111827` — `<Site> <Unit> <Asset> Dashboard`.
- Right: `Data Connectivity` / `Asset Status` pair as label-over-value with a ⊗ glyph, then
  a primary action button (`#0084ff`, white, 6px radius) such as `Inspect Last Cycle` when
  the spec calls for one.

**Cards**
- White, 8px radius, 1px `rgba(0,0,0,.06)` border, shadow
  `0 1px 3px rgba(0,0,0,.12), 0 1px 2px rgba(0,0,0,.24)`, 16–20px padding.
- A card carrying a status takes a 4px left border and tints its headline value: green
  `#3fb950`, amber `#d29922`, red `#f85149`.
- Card title: 11–12px uppercase, letter-spacing `.06em`, `#6b7280`, always followed by a
  small circled `?` help affordance (`title=` tooltip). Chart cards additionally carry a
  download icon and a list/table-toggle icon at the top right.
- Headline metric 28–34px semibold, unit inline, qualifier lines 12px grey.

**Typography**: `Segoe UI, system-ui, -apple-system, sans-serif`. No serif, no Chinese-first
font stack.

**Charts**: ECharts 5 from jsdelivr. Palette in order
`#5470c6 #91cc75 #fac858 #ee6666 #73c0de #3ba272 #fc8452 #9a60b4 #ea7ccc`; axis labels
`#464646`; split lines `#ccc`; axis names bold and shown (`Date`, `Temperature [DegC]`).
This mirrors the real `library/charting` theme so mockup and implementation agree.

## 3. Layout pool for this page

Pick what the spec calls for; repeat a recipe per measurement group. A pool, not a quota.

- **Limit card** — `MAX. <MEASURE>` + `?`, headline value with unit, a status dot line
  naming the envelope (`Inside DOW (limit 11.73 Barg)`), the sensor tag in grey, then a
  footer row of exceedance counters (`30d exc: 0`   `90d exc: 0`) with the count green at
  zero and red above it.
- **Time-series card** — ECharts line chart, y-axis named with unit in brackets, x-axis
  `Date` in `DD/MM/YYYY`, a dashed blue `markLine` labelled `Max Design: <value>` at the
  limit, a `dataZoom` slider under the plot, and a vertical mini range-selector rail on the
  right edge. Download and table-toggle icons in the card header.
- **Time information panel** — `Duration` select (`Last 7 days`), `From date` / `To date`
  inputs in `DD/MM/YYYY`, a two-handle range slider beneath, and `Latest Update: <date>` at
  the top right.
- **Sensor location panel** — inline-SVG elevation of the vessel with sensor pins in status
  colours, callout labels carrying the sensor tags, a fullscreen and a home icon at the top
  left, and a small North/West/Vertical-Up axis triad at the bottom.
- **Gauge card** — half-doughnut gauge with coloured bands (red `0-5 years`, amber
  `5-25 years`, green `25-35 years`), a legend of those bands above it, tick marks, a grey
  needle, and the value written under the needle (`3.2 year(s)`).
- **Status summary card** — group label, status word in the status colour, then a row of
  `MAX. DAMAGE` / `LAST CYCLE DAMAGE` / `MIN. EST. FATIGUE LIFE` figures, a component dot
  line (`● R1 | Skirt`) and a grey `Cycle: <id>` footer.
- **Top-N table** — `Top 10 Damage Locations at <group> Parts` with columns
  `No / Damage [%] / Remaining Life [years] / Azimuth [°] / Elevation [m] / Direction`,
  units on their own header line, zebra rows, numeric columns right-aligned.
- **Exceedance log** — a parameter line, a pill toggle group (`Temperature` | `Pressure`,
  active pill dark navy), and either the log rows or a centred grey empty state
  (`No exceedance data in the last 90 days`).
- **Selector card** — `Cycle ID` select plus `Status: Good` and the cycle time range.

## 4. Build blueprint (always the last element)

After `</main>`, emit a collapsed `<details id="build-blueprint">` with summary
`Build blueprint — how this maps onto the Papp codebase`, muted and bordered so a customer
demo can ignore it. Contents:

- **Recipes**: which of R1 (read-only endpoint), R2 (new page), R3 (new chart),
  R4 (new table ⚠ needs DB confirmation) this page implies.
- **Backend**: per panel, the router function and path (`routers/<resource>.py` →
  `GET /<resource>/<action>`), its query and path parameters (date range, cycle id, sensor
  tag) and the response schema in `schemas/<resource>.py`, one line per field with
  `description=`. Flag any endpoint that would otherwise return an unbounded series — time
  range and decimation belong in the query, not in the browser.
- **Frontend**: `ServerCommunication/<resource>.service.ts` function; the `useQuery` key
  including **every** argument (date range and cycle id are arguments — omitting one serves
  stale data after it changes), the `enabled:` gate for conditional args, the `staleTime`
  tier, and a module-level constant as the default; the type in `types/<feature>.ts`; the
  page split `pages/<Page>/{<Page>.tsx, use<Page>.ts, <page>Utils.ts}`; sub-components in
  `components/<Page>/` behind a barrel; SCSS block at
  `assets/sass/pages/coker/<page>.scss`.
- **ECharts registration**: list every type and component used — `LineChart`, `GaugeChart`,
  `BarChart`, `DataZoomComponent`, `MarkLineComponent`, `ToolboxComponent`,
  `TooltipComponent`, `LegendComponent`, `GridComponent` — for
  `library/charting/echartsCore.ts`. A missing registration is a blank chart with no error.
- **Open questions**: sampling rate and retention, what "DOW" resolves to per tenant,
  refresh cadence, whether exceedance counts are computed server-side.

Write it in that vocabulary — it is handed straight to the `implement-papp` skill.
