# Papp frontend — repo standards reference

> **Shared reference.** Single source of truth used by both `review-papp` and
> `implement-papp` (folder `.claude/skills/_shared/papp-standards/`). Phrases like "is a
> finding" come from the review perspective — for implementation, read them as "don't do
> this".

Detailed conventions backing the review dimensions in SKILL.md. Everything here was
extracted from the actual code; when in doubt, the code wins — re-check the cited file.

Frontend root: `dashboard/papps/frontends/`. All paths below are relative to it.
Stack: React 19, TypeScript ~5.7 (strict), Vite 6, Vitest 4, SCSS, Zustand 5 (+ immer),
TanStack Query 5, Mantine 8, ECharts 5 via echarts-for-react 3, axios, dayjs.

## Aliases & import rules

- `@library/*` → `src/library/*`, `src/*` → `src/*` — defined in BOTH `vite.config.ts`
  and `tsconfig.json` paths. Deep `../../..` chains into library are a finding.
- Barrels: every `src/library/*` subfolder and every `components/{Group}/` folder has an
  `index.ts`; consumers import through it. **Documented exceptions** (do not "fix"):
  - `@library/charting/echartsCore` — deliberately NOT in the charting barrel (rendering
    code imports it directly; pure-data consumers deep-import `@library/charting/chartData`
    to stay ECharts-free).
  - `@library/components/WgpuCanvas` — deliberately NOT in the components barrel
    (side-effectful WASM); import directly.
  - `@library/hooks/*` — has no barrel at all; deep imports are the convention there.

## Charting layer (`src/library/charting/`)

- `echartsCore.ts`: the single tree-shaken ECharts instance —
  `import * as echarts from "echarts/core"` + `echarts.use([...])` registering only what's
  used (Line/Bar/Scatter/Gauge/Custom charts; Grid/Tooltip/Legend/DataZoom/MarkLine/
  Polar/Geo components; Canvas/SVG renderers). **A chart type or component not registered
  here renders blank at runtime with no build error** — when a diff adds a new chart
  feature, verify the registration.
- `BaseChart.tsx`: the one wrapper all charts render through. Imports
  `echarts-for-react/lib/core` (the subpath — package-root import defeats tree-shaking),
  passes `echarts={echarts}` + `theme={COKER_THEME_NAME}`, `notMerge`, loading/empty
  placeholders, optional `square` via `useSquareResize`.
- `theme.ts`: importing it registers the `"coker"` theme (side effect). Chart styling
  comes from `CHART_TOKENS`/`CHART_PALETTE`; `presets.ts` holds composable option
  builders (`timeAxis`, `valueAxis`, `lineChartGrid`, `timeDataZoom`, tooltip formatters) —
  layout/behavior only, styling stays in the theme.
- `chartData.ts` is pure (no React/ECharts): date helpers, `findBoundaries` (binary
  search), `sliceByTimeRange`, `downloadSeriesCsv` (escapes CSV formula injection —
  preserve that if touched).
- Chart placement rule: `charting/` is the shared layer; single-consumer chart code
  co-locates with its consumer; `hooks/` and `utils/` must contain no chart code.

## ServerCommunication (`src/coker_dashboard/ServerCommunication/`)

Layout: `apiClient.ts` + per-resource `{resource}.service.ts` (split by domain, not by
page — `sensor`, `metadata`, `fatigue`, `bulging`, `cycle`, `crack`, `historicalTrends`)
+ `index.ts` barrel. `apiClient` itself is intentionally NOT re-exported from the barrel.

- `apiClient.ts`: one shared `axios.create({ timeout: 60000 })`, no baseURL. Response
  interceptor shows Mantine notifications on 403 ("Access Denied") and ≥500 ("Server
  Error"), then re-rejects. New endpoints must go through `apiClient` so failures hit the
  interceptor.
- Service function shape: `async`, returns `Promise<DomainType>`, calls
  `apiClient.get<T>(...)`, returns `response.data` (services unwrap). Path params through
  `encodeURIComponent`; query params through axios `{ params }`.
- Blob/image endpoints delegate to `fetchObjectUrl(url)` (returns an object URL). The one
  exception, `downloadFatigueDamage`, manages + revokes its own blob and carries a
  comment saying why — new deviations need the same why-comment.
- Types come from `src/coker_dashboard/types`; small endpoint-local response shapes may be
  local interfaces in the service file.

## TanStack Query hooks (in `zustand/store.tsx`, not in ServerCommunication)

- Query keys: string-prefixed arrays including **every** argument the queryFn uses
  (`["fatigue_cycle", locationType, cycleId, top]`). A key missing an arg = stale-cache bug.
- Conditional fetching via `enabled:` (`enabled: Number.isFinite(cycleId)`), not
  conditional hook calls.
- Every hook returns renamed fields with a default-value fallback
  (`result.data ?? defaultData`) so consumers never see `undefined`.
  **Caution:** the fallback must be a module-level constant. Several existing hooks
  declare `defaultData` *inside* the hook body — a fresh object every render, which
  churns anything keyed on its identity downstream (e.g. a chart `useEffect` that
  dispose/re-inits on data change). In review, an in-body fallback object is a finding;
  do not copy the idiom from the older hooks.
- **staleTime tiers:**
  | Tier | staleTime | Examples |
  |---|---|---|
  | Config / tenant / design params | `Infinity` | `tenant_config`, `design_operating_parameters` |
  | Slow-changing ranges | `1000*60*60` (1h) | `disabled_sensors`, `yearly_cycle_date_range` |
  | Images / blobs / exceedances | `1000*60*5` (5m) | `fatigue_image_data`, `crack_image` |
  | Live / frequently-changing | default (0) | sensor readings, live results |
- Blob lifecycle: `@library/query/revokeBlobUrlsOnEviction` (wired once in `main.tsx`)
  revokes `blob:` strings on cache eviction — covers react-query blobs only. Blobs stored
  in zustand need revoke-on-overwrite in the setter.
- Request cancellation is delegated to TanStack Query; app code does not use
  AbortController. Progressive loading is done with `Promise.all` + immer merge
  (`useProgressiveSensorLoader`), not cancellation.

## Zustand (`src/coker_dashboard/zustand/`)

- `store.tsx` (stores + all query hooks) + `slices/` per feature + `slices/types.ts`
  (store/state shapes live HERE, not in `types/`).
- Slices are `StateCreator<XState>` factories named `create{Name}Slice`; **all mutations
  via immer `produce`**; actions grouped under one nested key per slice (`actions`,
  `fatigueActions`, …).
- Selector conventions: multi-field data selectors use `useShallow((s) => ({...}))`;
  action selectors return the action group directly; imperative access outside React via
  `useXStore.getState().xActions`.
- `devtools` wrapper only in DEV (`import.meta.env.DEV`).

## Types (`src/coker_dashboard/types/`)

- Barrel + per-feature files (`sensor.ts`, `fatigue.ts`, `crack.ts`, `bulging.ts`,
  `cycle.ts`, `common.ts`). `common.ts` = cross-cutting app-meta. Shared `Datapoint`
  re-exported from `@library/charting/types`.
- Enums mirroring backend query params carry a comment pointing to the Python schema
  source (e.g. `backends/.../schemas/fatigue_results.py`) — keep it when touched.

## SCSS design system (`src/assets/sass/`)

- `themes/_tokens.scss` (values) + `themes/_mixins.scss` (mixins); `_variables.scss` is a
  compat shim (`@forward` both) so files keep `@use "../themes/variables" as *;`
  (pages under `pages/coker/` are two levels deep: `../../themes/variables`).
- `styles.scss` is the global `@forward` barrel imported once in `main.tsx`. Every new
  `.scss` file must be forwarded there — and because everything lands in ONE global
  sheet, every new class name must be grepped across `sass/` for collisions first.
- **Canonical tokens:** fonts `$text-xxs`(10px)…`$text-6xl`(60px); weights
  `$regular/$mediumW/$semiBold/$bold`; breakpoints `$breakpoint-xs/sm/md/lg/xl/xxl`;
  spacing `$theme-padding/$theme-margin/$global-margin`; radius `$theme-radius`; shadows
  `$shadow-card/$shadow-card-hover`; colors `$main-color/$sub-title-color/$surface-color/
  $divider-color/$dark-text-color`; layout `$header-height/$indicator-height/
  $page-content-height`.
- **Legacy tokens — flag in any new/changed line:** `$xxxsmall…$xlarge` px scale,
  `$font-size-xs/sm/md`, `$breakpoint-l` (1200px → use `$breakpoint-xl`), `$breakpoint-m`
  (1024px → use `$breakpoint-lg`). Marked "do not use in new code" in `_tokens.scss`.
- **Key mixins:** `card-surface` (card chrome), `indicator-chrome` (+hover lift),
  `indicator-status-border` (left stripe via `var(--status-color)`), `status-dot($size)`,
  `label-caps(...)`, `title-help-icon`, `clickable-underline`,
  `responsive-font-system($xs…$xxl)` (mobile-first). Hand-written
  background/radius/box-shadow chrome duplicating these is a finding.
- BEM shape: one block per page `.{page}-page`, `&__element`, `&--modifier`; component
  files may be element-only when the DOM root is a shared class (see `indicator.scss` —
  bare `.indicator` is never emitted). Status colors flow through the `--status-color`
  CSS variable, not per-status classes.
- Dedup upward: a value repeated across multiple pages → promote to token/mixin; repeated
  within one file → local `$var` at the top.

## Testing

- Tests live in top-level `__tests__/` mirroring `src/` (per `__tests__/README.md`);
  the lone co-located exception is `src/library/hooks/useElementSize.test.tsx`.
- Vitest config sits inside `vite.config.ts` (jsdom, globals, `vitest.setup.ts` — which
  polyfills `ResizeObserver` and `matchMedia` for Mantine). `tsconfig.test.json` adds
  `__tests__` for tooling, but `__tests__` is NOT covered by the main typecheck.
- House style: `describe`/`it` + AAA; `render` inside a `<MantineProvider>` helper;
  `beforeEach(() => vi.clearAllMocks())`; `vi.mock` (hoisted) + `vi.mocked` for typing;
  prefer role/text queries over DOM-structure assertions.
- The proven strategy: pure logic extracted to `*Utils.ts` and tested directly with real
  imports; component render tests mock the store/query hooks.
- `__tests__/WgpuCanvas.test.tsx` runs under `// @vitest-environment happy-dom` and fully
  mocks `WgpuRenderer` — any new renderer export the component calls must be added to
  that mock. happy-dom environment warnings in output are known noise.
- Verify commands (always from `dashboard/papps/frontends/`):
  - `npx vitest run` (= `npm test`). Never invoke from repo root with `--root` — it fails
    to resolve `@vitest/runner` and every file reports "No test suite found"; that's an
    invocation error, not real failures.
  - `npx tsc -p tsconfig.json --noEmit` — NOT `tsconfig.app.json` (missing aliases +
    WgpuCanvas exclude).
  - `npx eslint .` — flat config: TS recommended + `react-hooks` recommended
    (rules-of-hooks, exhaustive-deps) + `react-refresh/only-export-components`.
    No Prettier/Stylelint; formatting is by convention (2-space, double quotes,
    trailing commas).

## Intentional patterns — do NOT flag as defects

- **No React Router**: hand-rolled `useView()` (`@library/hooks/hook`, `view` query param
  + `popstate`/`locationchange`) and `navigateTo()` (`history.pushState`). `App.tsx` is a
  `switch(pathname)`.
- **No `React.lazy`/code-splitting of pages**; instead a deliberate **keep-alive**
  pattern — heavy pages (`ProcessMonitoring`, `FatigueStatus` with its WgpuCanvas 3D
  download) stay mounted and toggle `display:none` so re-entry doesn't re-download.
  Documented in comments; converting to unmount-on-navigate is a regression.
- **No error boundaries** (today): error surface = axios interceptor notifications +
  per-hook default data + Skeletons. Raising boundary-lessness as a question is fine.
- **No i18n**; inline English strings are the norm.
- **No debounce/throttle utility** exists yet; flagging a missing debounce on rapid input
  is valid, but there is no house helper to point to.
- Feature gating via `useTenantConfig().features` / `hasFeature("crack")`.
- dayjs with `utc` + `customParseFormat`; display formats `DD/MM/YYYY` (`dateFormatStr`)
  and `DD/MM/YYYY HH:mm:ss` (`dateLabelFormatStr`) from `@library/charting/chartData`;
  `dayjs.extend` called idempotently in the modules that need it.

## Known existing smells — precedent, not license

Do not let authors cite these as justification, and do not demand they be fixed in
unrelated PRs (list under "Deferred / legacy drift"):

- `App.tsx`: dead `fatigueVisitedRef` + commented-out code.
- `components/Home/` has no barrel yet (Home deep-imports `OverallCokerRemainingLife`).
- `OverallCokerRemainingLife/utils.ts` is untested (coverage gap).
- Some store hooks carry copy-paste numbered comments ("2. Add sensor_type…").
- Some store hooks declare their `defaultData` fallback inside the hook body (unstable
  identity — see the caution in the query-hooks section).
- `FailureAssessmentDiagram` lives in `pages/CrackInspection/` but is cross-imported by
  `CrackStatus` (should move to `components/Crack/`); an empty
  `components/Crack/FailureAssessmentDiagram/` folder was created for that move and
  abandoned — expect reviewers to trip over both until the crack pages are refactored.
- Legacy coker pages predate the token/mixin migration and the 3-file split; only Home
  has the full trio, `FatigueStatus` is partway (`fatigueStatusUtils.ts`, no
  `useFatigueStatus`).
