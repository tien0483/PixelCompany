# TASK A — mock-data realism: fill the empty widgets (P1+P2+P3)

For a sub-agent. Branch `coker-ai-chat-integration`, worktree `E:/akselos-dev-3.10/coker-ai-chat-wt`
(base commit `b4047822b3`). Runs in PARALLEL with TASK B (`TASK_mock_3d_assets.md`) — strict file
ownership below; do not cross it.

## File ownership (yours)
- `dashboard/papps/backends/demo_ai_dashboard/build_mock_sql_db.py`
- `tests/src/dashboard/papps/backends/demo_ai_dashboard/test_mock_data_endpoints.py`
- new unit-test file(s) for your synthesis helpers under the same tests dir
DO NOT touch: `build_mock_storage.py`, `test_storage_endpoints.py`, anything under
`dashboard/papps/frontends/`, `dashboard/papps/backends/coker_dashboard` (production),
`frontends/src/coker_dashboard` (production), `scrbe/` (forbidden).
NEVER write the read-only snapshot
`E:/akselos-dev-3.10/akselos-dev-2/data/collections/akselos-testing/demo_ai_dashboard/data/database.db`.
Do NOT commit. Python for tests: `E:/akselos-dev-3.10/coker-ai-chat-wt/.venv/Scripts/python.exe`
(system python lacks google-adk).

## Context
`build_mock_sql_db.py` builds `<collection>/data/mock_sql.sqlite` from the read-only snapshot;
the papp's data routers read it via env `SQLITE_DB_FILEPATH_SQL`. E2E screenshots
(`dashboard/papps/frontends/e2e/__screenshots__/`) show many widgets without numbers. Root causes
diagnosed:

## P1 — TIME ALIGNMENT (fixes most blanks)
Snapshot sensor series ends 2025-12-31; the cycle table extends to 2026-03-22; wall-clock "now"
is later still. Result: latest-cycle sensor window is empty (404s), Process Monitoring MAX
temperature/pressure/coke-level cards render bare units without numbers, header shows
"Data Connectivity: Disconnected / Asset Status: Unknown".

Implement inside `build()`:
1. Determine sensor coverage `[min, max]` from `coker_sensor_value`.
2. "Latest" cycle := newest cycle whose `[record_start_at, record_end_at]` lies fully inside
   sensor coverage. DROP later cycles, and filter dependent rows in every copied table that has a
   cycle-id column (inspect each table's columns; don't guess).
3. Uniformly SHIFT every datetime column in every copied table (sensor_value.recorded_at, cycle
   start/end, inspection dates, ...) by one constant delta so the new latest cycle's
   `record_end_at` == the build run's wall clock (datetime.now() is fine in this CLI; document
   that re-runs re-anchor). Durations/waveforms must stay intact.
4. Log chosen latest cycle id + delta. For testability, allow injecting the anchor time into
   `build()` (param `anchor: datetime | None = None`).

## P2 — synthesize `coker_accumulated_damage` (currently EMPTY)
Empty table → Home FATIGUE card 0.00%, "OVERALL COKER ANALYTICAL HORIZON" stuck on skeletons,
Fatigue Status "UNKNOWN" + "-1.0 year(s)" gauges + empty Top-10 tables,
`fatigue-results/cycles/latest` 404.

- Read `tools/papp_components/db_schemas/coker/tables.py` for the EXACT schema (rank, group_name,
  location_type, angle, radius, accumulated damage, remaining life, cycle_id — verify names).
- Read `routers/fatigue_results.py` to see what "latest" + `location-types/{...}` +
  `accumulated-damages-by-date` actually filter on (e.g. the exact location_type strings
  'pressurized'/'non-pressurized').
- Build rows deterministically (NO randomness): for each kept cycle (at least the last ~50 + the
  latest), distribute the snapshot's per-cycle accumulated damage
  (`coker_accumulated_fatigue_result`: cycle_id, accumulated_damage, remaining_life) over the 10
  locations of `coker_top_damage_locations`, rank-weighted (weight_i ∝ that table's accumulated
  damage column), split across the two location_type values.

## P3a — Crack Status page dead
Symptoms: `crack-status/cycles` 404, no cycle picker, empty crack-details table, FAD chart without
points. Read `routers/crack_status.py` + `routers/crack_inspection.py` for exactly what "live"
data they query (scenario_name filter? which tables?). Synthesize matching rows: e.g.
scenario_name='live' `coker_crack_result` rows for the last ~5 kept cycles (crack_length/depth
growing slightly per cycle from the default-scenario baseline) + matching `coker_toughness_load`
points so the FAD gets dots.

## P3b — Bulging live indicator empty
Symptoms: "EST. BULGING LIFE — Cycle ID 0 - Invalid Date"; PSLF 0.000% on Home/Fatigue pages.
Read `routers/bulging_results.py` `get_bulging_live_indicator_data` + `scenario-names/live/latest`
for the exact table/columns (new AKS-20639 schema: predicted_bulging_date, pslf, record_end_at,
zone, ...). Synthesize one plausible row per recent kept cycle: PSLF trending upward toward the
known max 150.99, predicted_bulging_date in the future after the P1 shift.

## Wrap-up
1. Update `test_mock_data_endpoints.py` expectations — endpoints that 404'd for data reasons
   should now be 200: at minimum `fatigue-results/cycles/latest`,
   `bulging-results/scenario-names/live/latest`, `crack-status/cycles`, and the latest-cycle
   sensor window endpoint. VERIFY each against the rebuilt DB; don't guess.
2. Unit tests for the synthesis helpers: time-shift invariants (durations preserved, latest end ==
   injected anchor), accumulated rows sum ≈ per-cycle damage, deterministic across two runs given
   the same anchor.
3. Rebuild the real mock DB: run `build_mock_sql_db.py` from the papp dir with the venv python
   against `E:/akselos-dev-3.10/akselos-dev-2/data/collections/akselos-testing/demo_ai_dashboard`
   (PYTHONPATH: `tools` + `tools/install/set_akselos_path` if needed).
4. Verify: `pytest tests/src/dashboard/papps/backends/demo_ai_dashboard -q` ALL green;
   `uvx ruff check dashboard/papps/backends/demo_ai_dashboard/` clean.

## Report (terse)
Schema findings (exact table/column names), what the routers actually filter on, chosen latest
cycle + delta, rows synthesized per table, endpoints flipped 404→200, test/ruff results.
No commit; leave changes in the working tree for review.
