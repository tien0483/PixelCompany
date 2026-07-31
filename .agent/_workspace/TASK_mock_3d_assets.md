# TASK B — mock 3D solution assets: make the wgpu panels render (P4)

For a sub-agent. Branch `coker-ai-chat-integration`, worktree `E:/akselos-dev-3.10/coker-ai-chat-wt`
(base commit `b4047822b3`). Runs in PARALLEL with TASK A (`TASK_mock_data_realism.md`) — strict
file ownership below; do not cross it.

## File ownership (yours)
- `dashboard/papps/backends/demo_ai_dashboard/build_mock_storage.py`
- `tests/src/dashboard/papps/backends/demo_ai_dashboard/test_storage_endpoints.py`
DO NOT touch: `build_mock_sql_db.py`, `test_mock_data_endpoints.py`, anything under
`dashboard/papps/frontends/`, production papps (`coker_dashboard` front+back), `scrbe/`.
NEVER write `.../demo_ai_dashboard/data/database.db` (read-only snapshot). Do NOT commit.
Python: `E:/akselos-dev-3.10/coker-ai-chat-wt/.venv/Scripts/python.exe`.

## Context / diagnosis (already established — trust these, verify the details)
- The wgpu 3D panels render BLANK: "Sensor's Location" (Process Monitoring) and
  "Total Fatigue Damage" (Fatigue Status). See `e2e/__screenshots__/02_process_monitoring.png`,
  `03_fatigue_status.png`.
- NOT a GPU problem: headless/headed Playwright Chromium here has no WebGPU adapter, BUT the
  wasm glue (`src/library/components/wasm/wgpu_renderer/wgpu_renderer.js`) contains WebGL2
  bindings — the renderer falls back to WebGL2. Blank = missing assets / failed fetches.
- `build_mock_storage.py` already mocks the "model" model-type:
  `<collection>/object_storage/coker_model/model/{render_group.avro, sensorLocations.csv,
  array_data/array_data.bin}` — those endpoints return 200.
- MISSING: the SOLUTION model-type assets. `routers/visualization.py` (READ IT — confirm exact
  paths, don't trust this summary):
  - `/visualization/solution/render-group` → storage `coker_model/solution/shared_mesh/render_group.avro`
  - `/visualization/solution/array_data/{chunk}` → `coker_model/solution/shared_mesh/array_data/{chunk}`
  - `/visualization/solution/cycles/{cycle_id}/fields/{field_name}` → `coker_model/solution/cycle_{cycle_id}/{field_name}.bin`
- Frontend chunk fallback: when the avro carries no chunk manifest, the loader requests one flat
  `array_data.bin` (see `src/library/components/WgpuCanvas/utils/loadRenderData.util.ts`).

## Tasks
1. DISCOVER the exact requests the two blank panels make: grep
   `dashboard/papps/frontends/src/demo_ai_dashboard/pages/FatigueStatus`,
   `.../pages/ProcessMonitoring`, and `src/library/components/WgpuCanvas` for the model_type each
   canvas uses, and how the fatigue page derives `field_name` + `cycle_id` for
   `/visualization/solution/cycles/...`. Report the exact request shapes before building.
2. Extend `build_mock_storage.py`:
   a. Mirror the model assets under `coker_model/solution/shared_mesh/` (copy render_group.avro +
      `array_data/array_data.bin`, same as the model dir — plain copy is fine).
   b. Generate per-cycle field bins: parse `render_group.avro`'s array_descriptors to get the
      scalar array length (check whether `fastavro` or `avro` exists in the venv — pick what's
      installed; if neither, minimal hand-rolled parse of the container is acceptable). Emit
      deterministic little-endian float32 arrays, e.g. `value_i = 50 + 40*sin(i/50 + cycle_id)`,
      so the color bar shows a real range. Cycle ids: DO NOT hardcode — query
      `<collection>/data/mock_sql.sqlite` at build time for the ~5 most recent cycle ids (TASK A
      may re-anchor cycles concurrently; querying at build time keeps you correct). Generate for
      every field name your step-1 findings say the frontend requests.
   c. Placeholder images: `routers/cycle_inspection.py` `get_inspection_cycle_image` serves
      `<collection>/<url>` where `url` comes from `coker_image` rows. Query mock_sql.sqlite (or
      the read-only snapshot) for the ~20 most recent image urls and write the placeholder PNG
      (copy of `data/images/model_iso.png`) at those relative paths under the collection. Also
      fix Crack Status "Image is not available": read `routers/crack_status.py` /
      `crack_inspection.py` for the image path it serves and mock those files too.
3. Update `test_storage_endpoints.py`: solution render-group 200; one cycle field bin 200 with
   the correct byte length (array_len * 4); one inspection image 200.
4. Run `build_mock_storage.py` against the real collection
   (`E:/akselos-dev-3.10/akselos-dev-2/data/collections/akselos-testing/demo_ai_dashboard`) —
   allowed; database.db stays untouched. Then verify the new endpoints return 200 via TestClient.
5. `uvx ruff check dashboard/papps/backends/demo_ai_dashboard/build_mock_storage.py` clean;
   `pytest tests/src/dashboard/papps/backends/demo_ai_dashboard/test_storage_endpoints.py -q` green.

## Report (terse)
Exact frontend request shapes discovered; avro array length; files generated (count + bytes);
endpoint verification results; test/ruff results. No commit; leave changes in the working tree.

## After BOTH tasks land (for the coordinator, not you)
Re-run `npx playwright test e2e/demo_ai_dashboard/full-dashboard-screenshots.spec.js` from
`dashboard/papps/frontends` and compare the 12 screenshots: cards must show numbers, gauges real
values, 3D panels non-blank (WebGL2). Chat specs still blocked on the OpenRouter key (401).
