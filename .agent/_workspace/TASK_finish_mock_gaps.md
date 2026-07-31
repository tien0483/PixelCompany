# TASK C — finish the last mock-data gaps (ovality / crack image / crack FAD curve)

For a sub-agent. Branch `coker-ai-chat-integration`, worktree `E:/akselos-dev-3.10/coker-ai-chat-wt`
(current HEAD `99625e3d81`). Builds on the realism round already committed. Rules:
- NEVER touch `dashboard/papps/backends/coker_dashboard`, `frontends/src/coker_dashboard`, `scrbe/`.
- NEVER write the read-only snapshot `.../demo_ai_dashboard/data/database.db`.
- Do NOT commit — leave changes staged/working for review.
- pytest via `E:/akselos-dev-3.10/coker-ai-chat-wt/.venv/Scripts/python.exe` (system python lacks google-adk).
- Your files: `build_mock_sql_db.py`, `build_mock_storage.py`, and the two test files
  `tests/src/dashboard/papps/backends/demo_ai_dashboard/{test_mock_data_endpoints.py,test_storage_endpoints.py}`.
  Do NOT edit routers/frontend — these are pure DATA gaps.

Mock DB path (built into the collection):
`E:/akselos-dev-3.10/akselos-dev-2/data/collections/akselos-testing/demo_ai_dashboard/data/mock_sql.sqlite`.
Rebuild after edits by running the two build_*.py scripts from the papp dir with the venv python.

These three widgets are still empty in the e2e screenshots — each is a MISSING-ROWS problem, root
cause already diagnosed (verified against the DB), so just synthesize the rows.

## Gap 1 — Ovality tab all 0.000%, empty polar plot, elevation dropdown stuck on "Select value"
(`e2e/__screenshots__/10_bulging_inspection_ovality_tab.png`)
Cause: the Bulging page's INSPECTION DATA selector is on **"live"**, and the ovality endpoints
(`routers/bulging_results.py`: `get_ovality_elevations`, `get_maximum_ovality_elevation`,
`get_ovality_data_at_elevation`) filter `coker_ovality_result` by that scenario — but
`coker_ovality_result` only has `scenario_name='default'` rows (verified: 4320 rows, all
'default'). So 'live' returns nothing.
Fix in `build_mock_sql_db.py`: synthesize `scenario_name='live'` rows in `coker_ovality_result`
for the recent kept cycles — derive from the existing 'default' rows (same elevation_id/angle
grid, inner_radius nudged slightly per cycle so ovality reads non-zero and < the ASME 1% note
threshold for most, with a couple ≥1% to exercise the orange highlight). `coker_ovality_elevation`
has no scenario column (id/value/original_radius) — leave it; the elevations endpoint derives its
list from the result rows. Check the exact columns with PRAGMA before writing.

## Gap 2 — "Crack Specification" image panel spins forever (both Crack Status + Crack Inspection)
(`04_crack_status.png`, `11_crack_inspection.png` — right panel infinite spinner)
Cause: `routers/crack_inspection.py get_crack_image_from_id` joins `coker_crack_result` →
`coker_crack_location` to build `result_type = f'crack_{inspection_revision}_{crack_location}'`
(spaces stripped), then looks up `coker_image.url WHERE result_type == that`. There are ZERO
`coker_image` rows with a `result_type` starting 'crack' (verified) → endpoint 404s → the
frontend blob fetch never resolves → spinner.
Fix (data on both sides):
- In `build_mock_sql_db.py`: for each distinct `(inspection_revision, crack_location)` present in
  `coker_crack_location` (values seen: revision 'R1', locations 'R1'..'R10' / 'Cone' etc. — query
  them, don't hardcode), INSERT a `coker_image` row with `result_type='crack_{rev}_{loc}'` (strip
  spaces to match the router) and a `url` pointing at a placeholder png path under the collection,
  e.g. `input/images/crack_locations/crack_{rev}_{loc}.png`. Check `coker_image`'s columns with
  PRAGMA (id/url/result_type/...); fill required cols.
- In `build_mock_storage.py`: write the placeholder PNG (copy of `data/images/model_iso.png`) to
  each of those url paths under the collection so `FileResponse(collections_path / url)` resolves.
  Query the just-built mock_sql.sqlite for the crack image urls (so the two scripts stay in sync —
  run order: build_mock_sql_db first, then build_mock_storage reads the urls). Document the run
  order in build_mock_storage.py's docstring.

## Gap 3 — FAD curve (blue envelope) missing on Crack STATUS page (only the green dot + red cutoff)
(`04_crack_status.png` vs `11_crack_inspection.png` where the blue curve IS drawn)
Cause: the FAD blue curve is built from the crack result's `coker_toughness_load` points. Default
crack results have ~102 toughness points each → full curve. The synthesized `scenario_name='live'`
crack results have only **1** `coker_toughness_load` row each (verified) → no curve, just the
single point.
Fix in `build_mock_sql_db.py`: for each live `crack_result_id`, generate a full toughness-load
point set (~100 points) with the same Kr/Lr envelope SHAPE as a default result — copy the
(kr, lr) sequence from one representative default `coker_toughness_load` group and re-key the rows
to the live `crack_result_id` (fresh row ids). Deterministic, no randomness.

## Wrap-up
1. Rebuild both mock artifacts against the real collection (order: build_mock_sql_db.py THEN
   build_mock_storage.py). database.db stays untouched.
2. Update the two test files: add/adjust assertions so the previously-empty endpoints now return
   populated data — at minimum `bulging-results/ovality/scenario-names/live/elevations` non-empty,
   one `crack-inspection/crack-results/{id}/crack-image` returns 200, and a live crack result's
   `crack-inspection/crack-results/{id}/toughness-load` returns the full point set. Verify against
   the rebuilt DB; don't guess ids — query them.
3. Verify: `pytest tests/src/dashboard/papps/backends/demo_ai_dashboard -q` all green;
   `uvx ruff check dashboard/papps/backends/demo_ai_dashboard/` clean.
4. Regenerate screenshots to confirm the fixes:
   `cd dashboard/papps/frontends && npx playwright test e2e/demo_ai_dashboard/full-dashboard-screenshots.spec.js`
   then confirm 04/10/11 show: ovality polar plot + non-zero values, crack specification image
   (placeholder) rendered instead of a spinner, blue FAD curve on Crack Status.

## Report (terse)
Per gap: exact table/columns used, rows synthesized, endpoint(s) flipped empty→populated,
screenshot confirmation. Test/ruff results. No commit.

## NOT part of this task (out of scope / external)
- Chat replies (`/chat/{id}/message`): blocked by an OpenRouter **401** — the API key in
  `.env.local` appears revoked/rotated. Only the USER can fix (new key at
  https://openrouter.ai/settings/keys → put in `dashboard/papps/frontends/.env.local` as
  `VITE_OPENROUTER_API_KEY=`). Do NOT touch the key or the chat code. Once fixed, the chat +
  red-box-evidence e2e specs go green on their own.
- The 2D fatigue-image endpoint 404 (`fatigue-results/.../views/North`) is now UNUSED because the
  sandbox tenant enables the 3D fatigue widget — leave it; do not mock it.
