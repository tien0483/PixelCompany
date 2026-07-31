# Review: PixelOffice three-pane merge — full re-review (2026-07-31)

**Scope:** Full re-review (not incremental). Supersedes `05_merge-qa_review.md` (2026-07-30, layout + Jacked chrome only). Adds coverage for notes 06 (flatten), 07 (Claude-only + multi-account/OAuth + runtime-owned headless Jacked), 08 (office theme/shelves), and commits `095947e` (Seats add-account OAuth UX), `bb247fd` (WSL docs), `7c0092c` (office dim-overlay alpha cap).

**Verdict:** Approve. All three merged modules verify green against the cross-boundary contracts. No blockers or majors. Findings are pre-existing lint/a11y nits, one untested new backend module, and one traceability question. The OAuth `window.open` removal (the highest-risk recent behavioral change) is correct across the runtime↔UI boundary — verified, not a defect.

## Findings

### Blocker
None.

### Major
None.

### Minor

1. **Right-column width separator is not keyboard-operable** — `home-triple-pane.tsx:134-140`. The width drag handle uses `role="separator"` + `aria-orientation="vertical"` but has no `tabIndex` (not focusable) and omits the required `aria-valuenow/valuemin/valuemax`. Keyboard-only users cannot resize the right column, and a screen reader announces an incomplete separator. Pre-existing (initial commit `a0d3974`); not caught by the 05 pass because biome was never run. Failure scenario: keyboard/AT user cannot adjust the Accounts|Office column width at all. (The horizontal watch/office split uses the shared `ResizeHandle` component instead and is not flagged.)

2. **New runtime-owned Jacked supervisor has zero unit coverage** — `backends/runtime/src/jacked/jacked-process.ts`. This is the riskiest new backend code from note 07: TCP port probe, detached spawn, double-spawn guard, and POSIX process-group `process.kill(-pid, "SIGTERM")` teardown. The `src/jacked/` suite (27 tests) covers client/monitor/account-pin only — there is no `jacked-process.test.ts`. The path is exercised solely by manual `solo` boot. Failure scenario: a regression in the probe or group-kill semantics (e.g. leaking the uvicorn worker group, or double-spawning over an already-listening service) ships silently.

3. **Lint (pre-existing) in the Jacked watch surface** — `jacked-accounts-view.tsx:197` `useExhaustiveDependencies` (specifies an unnecessary dep `jacked?.latestSwap?.at`, biome-FIXABLE) and `:803` `noArrayIndexKey` on `swaps.map((swap, index) => key={`${swap.at}-${index}`})`. Both from the initial commit, not introduced by `095947e`. The index-in-key can mis-key swap rows and carry stale component state if the swap history reorders.

4. **Dead defensive clamp** — `office-atmosphere.tsx:22` `Math.min(MAX_DIM_ALPHA, intensity * MAX_DIM_ALPHA)`. Because `pressure` is schema-clamped to ≤1 (`runtimeJackedSnapshotSchema.pressure`), `intensity = (pressure-0.5)/0.5 ≤ 1`, so the product never exceeds `MAX_DIM_ALPHA` and the `min` is unreachable. Harmless; the alpha-cap intent of commit `7c0092c` is already guaranteed by the formula. Nit only.

### Question

1. **No `04_*` office-dock notes artifact.** `_workspace/pixeloffice-merge/` jumps 03 → 05. The office-dock module under review (board-to-office sync, `OfficeJackedSidePanel`/iframe removal) has no dedicated notes file; it is only summarized in `02_kanban-shell-dev_notes.md` ("OfficeView docked lower-right; Jacked iframe panel removed"). Was the office-dock agent's output intentionally folded into 02, or is an artifact missing? Traceability gap, not a code defect.

2. **Local-OAuth status copy vs. server-side browser open.** The "OAuth / Sign in on this computer" path shows "A browser tab should open automatically." Jacked opens the tab server-side (`backends/jacked/jacked/web/oauth.py:294 webbrowser.open`), independent of the `webux --no-browser` flag. When `solo` runs on a remote host reached via tunnel, that tab opens on the server, invisible to the user. Mitigated by the dropdown label "Sign in on this computer" and the always-present fallback link — so not a defect — but should the copy acknowledge the remote-host case?

## Praise

- **OAuth duplicate-tab fix is correct across the boundary.** `095947e` removed the frontend `window.open`; the tab is now opened once by jacked in browser mode (`oauth.py:294`), and the client still maps `auth_url → authUrl` for both browser and manual modes (`jacked-client.ts:512`), so the frontend's fallback `<a>` link renders even after the removal. No flow gets stuck without a link.
- **Single-primary-UX invariant holds.** `JackedAccountsView` mounts only in `App.tsx` upper-right watch slot and the e2e harness — never in the sidebar. No `iframe`/`:8321` embed anywhere in src (`jacked-sidebar-section.tsx` explicitly documents "native surfaces only"). No duplicate Jacked chrome competing for primary UX.
- **Flatten integrity clean.** No `kanban/web-ui` or `claude-jacked-master` donor directories remain, and no residual donor-path imports in `frontends/pixel_office/src` or `backends/runtime/src`.
- **`board-to-office` stays a pure, diffed projection.** Reconciler mutates OfficeState only on observed change (tool/active/bubble/speech/seat/lead), preserves seats across reloads, and correctly gates staff on `STAFFED_COLUMNS` × `STAFFED_STATES`.
- **Right-column ↔ TopBar contract intact.** `rightColumnOpen={isOfficeOpen}` in `App.tsx`; TopBar office button toggles `handleToggleOffice` with correct `aria-label` ("Hide/Show watch and office column") and reuses `office-view-open` persistence per contract 01.

## Deferred / legacy drift

- **4 pre-existing web `tsc` failures**, unchanged and documented in notes 07/08: `officeState.port.test.ts`, `layoutSerializer.port.test.ts` (`Object is possibly undefined` in test bodies), `office-jacked-semantics.test.ts` (zod `.default()` input/output mismatch on `stale`), and `vite.config.ts` (newer rollup `SourceMap`/`sourcesContent` types). Test/config only; product source type-checks clean.
- **`runtime-api.ts` still eagerly imports Cline services** (note 07 deferral) — module-load cost only; AGENTS.md forbids inline imports, so this is deferred rather than half-done.
- **macOS keychain pin caveat** (note 07): `prepare_account_dir` also writes the shared Keychain entry on darwin, so a per-task pin moves the global identity there. Documented in the route docstring + TECH_STACK, not fixed. Windows/Linux fully isolated.

## Verification

| Command (cwd) | Exit | Result |
|---|---|---|
| `npx tsc --noEmit` (`frontends/pixel_office`) | 2 | Only the 4 documented pre-existing test/config files. Product source clean. |
| `npx tsc --noEmit` (`backends/runtime`) | 0 | Clean. |
| `npx vitest run src/office/adapter src/jacked src/office/jacked` (`frontends/pixel_office`) | 0 | 3 files / 10 tests passed. |
| `npx vitest run src/jacked` (`backends/runtime`) | 0 | 3 files / 27 tests passed. |
| `npx biome lint` on 4 changed files (`frontends/pixel_office`) | 1 | 5 findings, all from initial commit `a0d3974` (pre-existing) — see Minor 1/3. |

Cross-boundary checks (per skill): `RuntimeJackedSnapshot` fields ↔ watch/config UI (pressure/stale/activeAccountId consumed correctly, office atmosphere reads `pressure`, `online = jacked!==null && stale!==true`); board cards/sessions ↔ `board-to-office` (verified pure/diffed); right-column open ↔ TopBar Office button (verified `isOfficeOpen`); no duplicate iframe + native watch (verified — native only). All hold.

Note: `merge-qa` retry policy — no verify command required a retry; all commands succeeded first run.
