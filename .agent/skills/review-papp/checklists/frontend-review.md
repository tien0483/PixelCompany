# Frontend review checklist (papp)

Domain checklist for reviewing code under `dashboard/papps/frontends/`. Used either
inline by the main reviewer or by a spawned frontend-review subagent. Read the shared
standards first: `.claude/skills/_shared/papp-standards/frontend-standards.md`.

## The reference frame — what "standard" means

The **gold standard is the coker_dashboard Home page** and the shared `src/library/`:

- `src/coker_dashboard/pages/Home/Home.tsx` — pure view (`const vm = useHome();`).
- `src/coker_dashboard/pages/Home/useHome.ts` — hook orchestrating store/query hooks into one flat, section-grouped view-model. No JSX, no formatting math.
- `src/coker_dashboard/pages/Home/homeUtils.ts` — strictly pure, unit-testable functions.
- `src/coker_dashboard/components/Home/OverallCokerRemainingLife/` — complex sub-component shape (`.tsx` + co-located pure `utils.ts`).
- `src/assets/sass/pages/home.scss` + `themes/_tokens.scss` + `themes/_mixins.scss` — BEM/kebab/token SCSS.

**Calibration — most of the codebase is NOT the standard:**

- Other coker pages (`ProcessMonitoring`, `FatigueStatus`, `BulgingInspection`,
  `CycleInspection`, `CrackInspection`, `CrackStatus`, `HistoricalTrends`) are
  **mid-refactor legacy**. Never cite them as precedent; never let "page X already does
  it this way" justify new code that deviates from Home.
- Other apps (`aiv_dashboard`, `reactor_*`, `jobs_dashboard`, `demo_ai_dashboard`, …) are
  separate lineages. Hold them to the general dimensions below, but only hold
  coker_dashboard code to the coker-specific structure rules.

## Working method

**Scale to the diff:** run only the checks the changed code could violate — a diff with
no SCSS needs no SCSS/collision pass, no new hooks means no hooks audit, no tests
touched and no new pure logic means dimension 4 is a one-line note. The dimensions
below are the full menu, not a mandatory sequence.

1. Read the shared frontend standards, then the changed files **in full**, not just
   hunks — the defect is usually in the interaction between new lines and surrounding
   code (missing cleanup, stale query key, class collision). If the diff touches an area
   whose reference you haven't internalized (SCSS → `_tokens.scss`/`_mixins.scss`; a
   page → the Home trio; a chart → `library/charting`), read the actual reference file —
   it evolves, and the review must match the code, not this checklist's snapshot.
2. Mechanical checks (cheap greps): class-name collisions across `sass/`, deep relative
   imports into library, `: any` / `as any` / `as unknown` / ` as [A-Z]` / `@ts-`
   escapes, echarts root imports, old class names left behind after renames.
3. **New-definition inventory:** list every definition the diff *introduces* — exported
   function/hook/component/type/constant, SCSS class/token/mixin — and check both directions:
   - *Backward (duplication):* does an equivalent already exist? Search by name AND by
     concept in `coker_dashboard/utils`, `constants`, `types/`, `zustand/store.tsx`
     hooks, `@library/{components,charting,utils,hooks,query}`,
     `sass/themes/_tokens.scss`/`_mixins.scss`. A near-duplicate (same job, slightly
     different rules) is worse than an exact copy — it silently splits behavior.
   - *Forward (reuse potential):* genuinely page-local, or a formatting rule / status
     threshold / chart option / chrome pattern other pages will need? If reusable, the
     finding is about its *home* (promote to utils/constants/@library/token/mixin) and
     its API (generic enough for the second consumer).
4. Optionally verify when the diff is substantial: `npx tsc -p tsconfig.json --noEmit`
   (NOT `tsconfig.app.json`), `npx vitest run` — both from `dashboard/papps/frontends/`
   (never repo root with `--root`), `npx eslint .` on changed files.
5. Verify each finding before reporting — re-read the code and confirm the failure
   scenario is real.

## Dimensions

Work through all five; report only what you actually found. 1 and 2 carry the most weight.

### 1. Architecture & design

- **3-file page split** (coker pages): view / `use{Page}` / `{page}Utils` — view has no
  business logic, hook has no JSX/formatting math, utils is pure. The split is a
  *ceiling, not a quota* — flag an empty `use{Page}.ts` created "for symmetry" just as
  hard as business logic inlined in JSX. A view-model past ~30 fields should decompose
  into per-section hooks that `use{Page}` composes.
- **Component placement:** extracted sub-components live in `components/{Page}/` (or a
  shared folder once a **second** page needs one — never cross-import between pages),
  fronted by an `index.ts` barrel. Simple = single `.tsx`; complex (own logic/types/tests)
  = folder + co-located `utils.ts`.
- **Abstraction level:** flag both over-engineering (a generic factory for one call site,
  premature config objects) and under-engineering (copy-pasted blocks, hardcoded values
  that already exist in `constants/`). Ask "what problem does this abstraction solve
  today?" as a question, not an accusation.
- **State placement:** ephemeral UI state → local `useState`; cross-component/page state →
  zustand slice pattern (immer `produce`, grouped `actions`, `useShallow` selectors);
  server data → TanStack Query hooks in `zustand/store.tsx` — never `useEffect`+`useState`
  fetching, never server data copied into zustand. Flag prop-drilling deeper than ~2
  levels where a selector hook exists, and global state only one component reads.
- **Reuse before rebuild:** a re-implementation of an existing helper is a finding even
  when the new code is correct (see the inventory above).
- **Component API:** props express intent, typed precisely (no `data: any`), no
  boolean-explosion (`isX`/`isY`/`isZ` that are really one mode enum).

### 2. Performance

- **Effect hygiene:** every `useEffect` that subscribes (listener, interval, store
  subscription, `locationchange`) must clean up. Missing cleanup on a keep-alive page is
  worse than usual — the page never unmounts, so the leak compounds.
- **Blob URLs:** anything creating `URL.createObjectURL` needs a revocation path —
  react-query blobs are covered by `revokeBlobUrlsOnEviction`; blobs stored in zustand
  need revoke-on-overwrite in the setter; one-shot downloads revoke inline.
- **Memoization — calibrated, not maximal:** require stable identities for
  objects/callbacks passed into hooks or chart adapters (fresh identity = re-seeding /
  re-render churn; includes fallback/default objects — they must be module-level
  constants); do NOT demand `useMemo`/`useCallback` on cheap scalars or `React.memo`
  everywhere.
- **Bundle / tree-shaking:** charts go through `BaseChart` /
  `@library/charting/echartsCore` — never `import * from "echarts"` or the
  `echarts-for-react` package root (must be `echarts-for-react/lib/core`). A new chart
  type/component needs registering in `echartsCore.ts` `echarts.use([...])` — missing
  registration = silent blank chart at runtime, check explicitly. `WgpuCanvas` imports
  directly, never via the components barrel.
- **Network:** query keys include every argument the queryFn uses; conditional fetches
  gate with `enabled:`; staleTime follows the tier table (Infinity config / 1h slow /
  5m images / 0 live); hooks return default-value fallbacks. Duplicate requests usually
  mean a fetch bypassed the query layer. Rapid-fire inputs with no debounce are a
  legitimate finding (no house debounce utility exists yet).
- **Async done right:** independent awaits run concurrently — `Promise.all([...])`
  (house precedent: `useProgressiveSensorLoader`), not a sequential `await` chain that
  serializes unrelated requests; loading flags cleared on ALL exit paths
  (`finally`/query state, so an error never leaves a spinner stuck); no unhandled
  promise rejections (a floating `.then()` without error path); async results guarded
  against out-of-order arrival when the input can change mid-flight (TanStack Query
  handles this — hand-rolled fetch code must, too).
- **React hooks used correctly:** rules-of-hooks respected — never call hooks
  conditionally/in loops (gate the *query* with `enabled:`, not the hook call);
  `exhaustive-deps` warnings fixed, not silenced (a deliberately-omitted dep needs a
  why-comment); the right tool for the job — a derived value is computed in render or
  `useMemo`, never mirrored into state via `useEffect`+`setState` (extra render + drift
  risk); subscriptions/imperative work in `useEffect` with cleanup; logic repeated
  across components extracted into a custom hook in the proper home
  (page hook, `zustand/store.tsx`, or `@library/hooks`).
- **Do not "fix" intentional patterns:** static page imports + keep-alive
  (`display:none`) instead of `React.lazy`; hand-rolled `useView`/`navigateTo` routing.
  Questioning them is fine; flagging as defects is not.

### 3. Maintainability & type safety

- **Type-clean, no escape hatches:** no `any` (explicit, or implicit via untyped
  params/callbacks — annotate them), no `as` to silence the compiler, no `!` on
  genuinely-nullable values, no `@ts-ignore`/`@ts-expect-error` without a reason
  comment. Every new function signature, prop interface, and hook return is fully
  typed; nullable API fields are `T | null`-typed so consumers are forced to guard.
  tsconfig is strict — code that fights it is the finding, not the config.
- **Type placement:** domain/API types → `src/coker_dashboard/types/{feature}.ts`
  (barrel re-exported); store shapes → `zustand/slices/types.ts`; endpoint-local response
  shapes may stay in the service file; view-model piece types live in `{page}Utils.ts`.
  Enums mirroring backend query params keep the comment pointing at the Python schema.
- **Imports:** use `@library/*` and `src/*` aliases; import through barrels (except the
  documented exceptions: `echartsCore`, `chartData` deep import for ECharts-free code,
  `WgpuCanvas`, `@library/hooks/*` which has no barrel).
- **Naming states intent, not implementation**; booleans read as predicates; SCSS kebab-case.
- **Comments explain *why*, not *what*** — required on workarounds, browser/library-limit
  hacks, threshold tables, and intentional deviations. Flag both missing-why on a hack
  and noise comments narrating the code.

### 4. Testing & error handling

- **Placement & style:** tests in top-level `__tests__/` mirroring `src/`;
  `describe`/`it` + AAA; components wrapped in `<MantineProvider>`;
  `beforeEach(() => vi.clearAllMocks())`; `vi.mock` + `vi.mocked`. WgpuCanvas tests fully
  mock `WgpuRenderer` — a new export used by the component must be added to that mock.
- **Strategy over coverage:** house pattern = extract pure logic into `*Utils.ts` and
  test the real functions, plus a render test with store hooks mocked. New pure logic
  without a direct unit test is a finding. Tests asserting deep DOM structure that break
  on cosmetic changes are a finding — prefer role/text queries.
- **Error handling:** error surface = axios interceptor (Mantine notifications) +
  per-hook default data + loading `Skeleton`s. New service calls flow through `apiClient`
  and unwrap `.data`, typed `Promise<DomainType>`. A component rendering `NaN`/`undefined`
  or crashing on empty data is a real defect — check empty-array and null paths
  explicitly. No React error boundaries exist — a new white-screen risk is a question,
  not an instant blocker.

### 5. UI/UX & accessibility

- **SCSS standard:** BEM + kebab-case, one block per page (`.{page}-page`),
  `&__element`/`&--modifier`; shared mixins (`card-surface`, `indicator-chrome`,
  `status-dot`, `label-caps`, `title-help-icon`, `clickable-underline`,
  `responsive-font-system`) instead of hand-written chrome; canonical tokens (`$text-*`,
  `$breakpoint-xs..xxl`, `$theme-*`, `$shadow-card`…). **Legacy tokens are a flag in
  new/changed lines:** `$xxsmall/$small/…`, `$font-size-*`, `$breakpoint-l/$breakpoint-m`.
  Status colors flow through `--status-color`, not per-status classes.
- **Global-stylesheet hazards:**
  - *Collisions:* all SCSS lands in one global sheet via `styles.scss`. Grep every NEW
    class name across `sass/`; generic names (`.tooltip`, `.card`, `.item`, `.label`…)
    are taken. New `.scss` files must be `@forward`ed in `styles.scss`.
  - *Portals:* Mantine `Tooltip`/`Popover`/`Modal`/`Menu` content renders in a body
    portal — its selectors must be top-level (BEM `&__` concatenation is fine; descendant
    nesting under the page block silently never matches).
  - *Rename ripples:* renamed classes update atomically across `.tsx` classNames, `.scss`
    selectors, and JS `classList`/`closest()` — grep the old name for zero hits.
- **Keyboard & aria:** clickable non-button elements get `role` + `tabIndex={0}` +
  Enter/Space `onKeyDown` (house pattern in `Card.tsx`, `OverallCokerRemainingLife`);
  icon-only `ActionIcon`s get `aria-label`.
- **Responsive:** new font sizing uses `responsive-font-system(...)`; layout breakpoints
  use canonical `$breakpoint-*`; check grid steps when layout changes.
- **Complete UI states:** every async piece of UI ships the full state set, consistent
  with the house patterns — loading (`Skeleton` / `isLoading` props, reserving space so
  the layout doesn't jump), empty/missing data (the `—` degrade, `ChartPlaceholder` for
  charts — never `NaN`/`undefined` rendered), and error (interceptor notification +
  sensible fallback content). Interactive affordances stay consistent: pointer cursor +
  hover state on clickables, disabled states visibly disabled, status conveyed by the
  `--status-color` system rather than ad-hoc colors.
