# Handoff — Coker AI-chat sandbox papp session 2026-07-03 (read first)

For the next AI agent / human. Topic: porting the demo_ai_dashboard sidebar AI chat toward
the Coker dashboard. NOT related to the wgpu work in `BRANCH_MAP.md` / `HANDOFF_SESSION_2026-07-02.md`.
`.agent/` is gitignored — this doc is local only.

## TL;DR
- **`coker_dashboard` is DEPLOYED TO PRODUCTION — never modify it.** All AI-chat work lives in a
  new sandbox papp **`coker_ai_dashboard`** (full clone of coker_dashboard).
- **Worktree:** `E:/akselos-dev-3.10/coker-ai-chat-wt`
- **Branch:** `coker-ai-chat-integration` @ `77d4ade7fb`, base `master @ 078276f512`, **5 commits ahead, NOT pushed.**
- **coker_dashboard verified byte-identical to master** at HEAD (`git diff master HEAD -- <coker paths>` empty).
- Builds/tests green: vitest chat suite 5/5, `tsc -b` clean (only pre-existing wasm errors),
  `VITE_MY_APP=coker_ai_dashboard vite build` succeeds, ruff + py_compile clean,
  `test_papp_integrity` 60/60.

## Branch map
```
master @ 078276f512  (untouched)
 └─ coker-ai-chat-integration  (worktree coker-ai-chat-wt)
     8c4640aa90  coker_dashboard: add AI chat backend (agent and /chat endpoints)   ← superseded
     db8cabd92d  coker_dashboard: add sidebar AI chat ported from demo_ai_dashboard ← superseded
     7dadc458ed  coker_dashboard: revert AI chat integration (restores master state)
     b4a6883f7b  coker_ai_dashboard: add AI-chat sandbox clone of coker_dashboard   ← the real work
     77d4ade7fb  coker_ai_dashboard: register papp in production coverage config
```
History intentionally keeps the in-place integration + revert pair. If this becomes an MR,
consider squashing the first three commits (do NOT rebase if other agents hold the branch).
Commit style: neat imperative, **NO Co-authored-by trailer** (user override of AGENTS.md rule).

## What coker_ai_dashboard is
Full clone of coker_dashboard (frontend `dashboard/papps/frontends/src/coker_ai_dashboard/`,
backend `dashboard/papps/backends/coker_ai_dashboard/`) with:
- **All production routes DISABLED, placeholder text only** ("… disabled in the AI sandbox clone"):
  - Frontend: page imports + switch cases commented out in `App.tsx` (`AltText` component renders
    per route). Page sources kept in `./pages/` — re-enable = uncomment import + case.
  - Backend: only `routers/chat.py` registered; the 9 data routers commented out in BOTH
    `papp_main.py` AND `routers/__init__.py`.
- **Live feature = sidebar AI chat** (ported from demo_ai_dashboard):
  - `Chat/` components: FloatingChatbot launcher → drag-resizable ChatSidebar → Thread/Composer/
    Message on `@assistant-ui/react`; NO full-page ChatPage//chatgpt route (deliberately dropped).
  - `ServerCommunication/chat.service.ts` — createChatSession/sendChatMessage/artifactsToImageParts
    via the shared coker `apiClient`; exported from the barrel `index.ts`.
  - `App.tsx` wraps in `AssistantProvider`, mounts `<FloatingChatbot />` inside `.appBody`.
  - Backend `agent/` = Gemini 2.5 Flash (google-adk) + Schema/SQL/Visualization/Analysis tools.
  - Header falls back to "Coker AI Dashboard (sandbox)" (metadata/tenant route is off).
- `papp_type.json`: ui_name "Coker AI Dashboard", single dependency `adk_agent_helper`
  (table/SQL deps removed since data routers are off). `TAG` = 1.
- Test: `__tests__/coker_ai_dashboard/messageParts.test.tsx` (5 tests).

## Build / run
- Frontend: `cd dashboard/papps/frontends && VITE_MY_APP=coker_ai_dashboard npm run build`
  (dist → `backends/coker_ai_dashboard/dist/`, gitignored).
- Backend debug: `python papp_main.py` in the papp dir (debug_service, collection
  `akselos-testing/test_coker_dashboard_ver2`).
- Tests: `npx vitest run __tests__/coker_ai_dashboard/messageParts.test.tsx`.

## Gotchas
1. **`node_modules` in the worktree is a Windows junction** → `akselos-dev-2/dashboard/papps/frontends/node_modules`. Remove the junction before running `npm install` inside the worktree.
2. `.agent/` + `.claude/` are untracked → exist only in the main checkout, NOT in the worktree.
3. New papps must be listed in `.gitlab-ci/scripts/production_coverages_papp.yml` (test_papp_integrity fails otherwise) — already done for coker_ai_dashboard.
4. Agent quality depends on collection files the coker collection does not have yet:
   `prompts/system_prompt.md`, `skills/` (ADK skills), `data/schema.json`, `data/database.db`.
   Missing files only WARN at startup; chat runs but answers poorly.
5. Pre-existing, unrelated: 2 tsc errors for missing wgpu wasm artifact (fresh worktrees lack the
   built `wgpu_renderer.js`); `test_testing_integrity` has ~18 baseline failures on master too.

## Session 2026-07-04 — data wiring (commit `f7dcdb1f51`)
DISCOVERY: the `akselos-testing/demo_ai_dashboard` collection (at
`E:/akselos-dev-3.10/akselos-dev-2/data/collections/akselos-testing/demo_ai_dashboard`) ALREADY
holds the full coker mock dataset: database.db (15 coker_* tables, ~794k rows, dominated by
coker_sensor_value 731k), schema.json (hand-authored docs incl. coker_sensor_feature 53-col
aggregate), 17 DCU_* CSVs, coker system_prompt.md, 4 ADK skills (data-context/schema/sql-query/
visualization). No new collection created (user rule).

Data-access design (implemented):
- Agent NEVER touches production SQL. Reads only the collection SQLite snapshot.
- `agent/sql_guard.py`: pure `validate_readonly_sql` — single statement, SELECT/WITH only,
  forbidden keywords (PRAGMA/ATTACH/INSERT/...), LLM-friendly error strings. Defense-in-depth.
- `agent/tools.py`: connection opened `file:...?mode=ro` (URI) — the PRIMARY write guard.
- `csv_loader.py` (papp backend): deterministic CSV→SQLite loader. Dry-run default, `--apply`
  makes database.db.bak first, strict two-way column validation, specs: rename | {"uuid5": [cols]}
  (deterministic ids) | {"const": v}, plus drop_csv_columns. ONE reference mapping wired:
  DCU_TopDamageLocations.csv → coker_top_damage_locations. Other tables excluded ON PURPOSE —
  synthetic UUID PKs/FKs or enriched rows (reasons in module docstring). Extend _MAPPING there.
- `papp_main.py` debug collection → `akselos-testing/demo_ai_dashboard`.
- Tests: 24 pass (`.venv/Scripts/python.exe -m pytest tests/src/dashboard/papps/backends/coker_ai_dashboard -q`).
  NOTE: system `py -3.10` lacks google.adk → use the worktree `.venv` python for these tests.
- Real collection DB never written during dev (MD5 verified unchanged).

## Session 2026-07-04 (later) — sandbox renamed onto demo_ai_dashboard path (commit `b342d79388`)
USER DECISION: no separate coker_ai_dashboard papp. The sandbox now LIVES AT the existing
`demo_ai_dashboard` path (frontend `src/demo_ai_dashboard`, backend `backends/demo_ai_dashboard`).
On this branch the old demo papp content (Home page, files/temperature routers) is REPLACED by
the coker sandbox (coker shell + placeholder routes + sidebar chat + guarded data access +
csv_loader). papp_type ui_name "Demo AI Dashboard" + TAG 19 kept. Coverage yml: dedicated entry
dropped (demo_ai_dashboard/* entry already covers it). Build: `VITE_MY_APP=demo_ai_dashboard`.
Verified after rename: backend pytest 24/24, vitest 5/5, vite build OK, test_papp_integrity 58/58,
ruff clean. Branch now 7 commits ahead of master, not pushed.

## Session 2026-07-04 (later still) — all pages live on mock SQL (commit `538d312f7a`)
All 9 data routers enabled + production App.tsx routing restored (keep-alive blocks, feature
gates) with chat kept. Data path: `build_mock_sql_db.py` builds `<collection>/data/mock_sql.sqlite`
matching the coker sqlmodel schemas by copying/renaming from the read-only snapshot (renames:
coker_fatigue_result→coker_single_damage, coker_fatigue_image→coker_image; synthesized NOT NULL
cols; derived coker_crack_location; coker_accumulated_damage EMPTY — snapshot lacks per-location
breakdown). Routers pick it up via env `SQLITE_DB_FILEPATH_SQL=<...>/data/mock_sql.sqlite`
(same mechanism the repo test fixtures use). papp_type.json = coker deps + AI_PLATFORM.
Endpoint smoke (test_mock_data_endpoints.py): 32/36 frontend GETs return data; 2×404 legit-empty
(accumulated damage; latest-cycle sensor window), 2×500 pre-existing router NotFound-wrapping,
12 image/3D endpoints SKIPPED (need OBJECT_STORAGE files, not SQL). wasm for FatigueStatus 3D:
copy src/library/components/wasm/ from main checkout into worktree (untracked build artifact).
Backend tests 26/26; tsc 0 errors; vite build green.
Local run recipe: set SQLITE_DB_FILEPATH_SQL + TENANT_NAME (tenants/*.json) [+
LOCAL_OBJECT_STORAGE_FILEPATH_OBJECT_STORAGE for images], run build_mock_sql_db.py once, then
`python papp_main.py` + `VITE_MY_APP=demo_ai_dashboard npm run build:dev`.

## Session 2026-07-04 (final) — live browser run verified (commit `392b3bd3d7`)
`run_local.py` added to the papp: standalone TCP uvicorn (debug_service's unix socket does not
work on Windows), serves dist/ same-origin, defaults env (COLLECTIONS_PATH, TENANT_NAME=default,
SQLITE_DB_FILEPATH_SQL→collection data/mock_sql.sqlite, GCP_PROJECT + PAPP_URL_NAME placeholders)
and stubs PappBase.get_folder_secret_b64 (terraform-backed, unused in sqlite mode — same stub the
test fixture uses). Run: `python build_mock_sql_db.py` once, then from the papp dir
`.venv python run_local.py --port 8123`, open http://127.0.0.1:8123.
ALSO REQUIRED once per worktree: junction `worktree/data/collections` →
`akselos-dev-2/data/collections` (collection lives only in the main checkout).
`.claude/launch.json` at E:/akselos-dev-3.10/ has a "demo-ai-sandbox" preview config.
BROWSER-VERIFIED: Home = live mock values (cycle 2604 22/03/2026, temp 438.02°C 113TI6164D.PV,
pressure 1.7274 Barg, bulging PSLF 150.99%); Process Monitoring = 6 ECharts instances, all five
sensor feeds 200 with 7-day hourly series; Historical Trends renders; Ask AI launcher present.
Known gaps in browser: meta-data/design-operating-parameters 404 (equipment table "Not Found"),
image/3D endpoints 500 (no object-storage mock → wgpu canvas errors + screenshot tool hangs),
crack-status/cycles 500 (pre-existing NotFound→500 wrapping), fatigue latest 404 (accumulated
table empty).

## Session 2026-07-04 (review prep) — ALL handoff items done, branch REBUILT ON CURRENT MASTER
FINAL STATE: branch `coker-ai-chat-integration` = master `e15cb966df` + exactly 2 commits:
- `70e54da122` frontend: self-contained coker-page clone (imports rewritten src/coker_dashboard →
  src/demo_ai_dashboard) + sidebar chat. Includes new master coker features (AKS-20744 latest
  readings, AKS-20734 utilized cycles, AKS-20776 tooltips).
- `0ccf1b8b1c` backend: coker routers + chat + guards + mock pipeline on the NEW PappBase() API
  (create() removed upstream; create_adk_agent_helper(agent, max_tool_retries=3); ADK App +
  ReflectAndRetryToolPlugin). TAG 22.
Old 10-commit history squashed then rebuilt on master (merge had heavy conflicts: upstream
refactored PappBase, demo agent tools, coker frontend). Safety ref with the pre-rebuild squash:
local branch `keep/sandbox-squashed` (delete when MR lands).

Completed handoff items:
- Object-storage + metadata mocks: build_mock_storage.py → <collection>/object_storage
  (render_group.avro, array_data/array_data.bin — frontend fallback path confirmed from
  loadRenderData.util.ts, sensorLocations.csv) + <collection>/input/global_config.json (from
  DCU_ModelMetaData.csv + placeholder design pressure/temp/cycle-limit/material) + placeholder
  images. Browser-verified: render-group 200, images 200, equipment table fully populated,
  3D canvas gets real avro.
- design-operating-parameters: 200 with mocked values.
- NotFound→500 fixes: crack_status.get_crack_cycles, cycle_inspection sensors-data, bulging
  ovality ×2 (`except pe.NotFoundException: raise`), fatigue latest-image file-existence check.
  All marked `# sandbox fix:`; production coker_dashboard untouched. NOTE: new endpoint
  bulging-results/scenario-names/live/latest still 500s upstream-style (documented in test).
- Chat live test: session creates; reply fails with google.auth DefaultCredentialsError — machine
  has no ADC. Code path verified to the auth call. Fix: `gcloud auth application-default login`.
- Squash: done (2 commits above).
Verified on the rebuilt branch: backend pytest 32/32, tsc 0 errors, vitest 5/5, vite build green,
test_papp_integrity 58/58, ruff clean, live browser Home shows DOW limits + utilized cycles +
full equipment table + Ask AI.

## For the reviewer (MR draft)
Title: demo_ai_dashboard: coker AI sandbox — coker dashboard pages + sidebar AI chat on mock data
Scope: replaces the old demo papp. Two commits (frontend/backend). Production coker_dashboard
untouched (verify: `git diff master HEAD -- dashboard/papps/backends/coker_dashboard
dashboard/papps/frontends/src/coker_dashboard` → empty).
Key review areas: agent/sql_guard.py (AI SQL access policy), routers/chat.py, build_mock_sql_db.py
mapping table, sandbox-fix comments in routers.
NOT pushed — push + MR creation left to Tien.

## Session 2026-07-04 (addendum) — OpenRouter chat mode (commit `de7e12faf8`)
gcloud/ADC is only needed because AdkAgentHelper forces Vertex. Alternative wired in:
`agent/agent.py _select_model()` — when env `OPENROUTER_API_KEY` set, the agent's LLM goes
through ADK `LiteLlm` (OpenRouter) with ALL tools intact; otherwise Gemini/Vertex as before.
`run_local.py` auto-loads `.env.local` (papp dir, then `frontends/.env.local` where Tien's key
lives from the old AKS-20213 browser-direct stash — stash_1..4 in dev-2 root) and mirrors
`VITE_OPENROUTER_*` → `OPENROUTER_*`. Model override: env `OPENROUTER_MODEL`
(default `openrouter/google/gemini-2.5-flash`).
BLOCKED ON USER: `litellm` package not installed — pip/uv installs are deny-ruled for agents.
User must run e.g. `uv pip install litellm` (kept OUT of pyproject on purpose: deployed papp
stays Vertex-only). Old browser-direct OpenRouter mode (frontend adapter) deliberately NOT
restored — it bypasses the backend agent and loses all SQL/schema/visualization tools.

## Session 2026-07-04 (addendum 2) — WSL flow wired per papp_start skill
User's normal flow = WSL portal dev server (papp_start skill). Wired without touching the main
checkout (it holds ACTIVE AKS-20548 work @ 6041d86e80 — never checkout the sandbox branch there):
papp runs FROM THE WORKTREE in WSL; portal proxies by socket name so it just works.
- Added junction `coker-ai-chat-wt/data/papp_data` → dev-2 papp_data (collections junction existed).
- WSL import smoke from worktree: OK (`/usr/bin/python3 -c "import papp_main"` with env).
- `1.env_vars.json` updated with the mock env (SQLITE_DB_FILEPATH_SQL, LOCAL_OBJECT_STORAGE…,
  GLOBAL_CONFIG_FILE, META_DATA_IMAGES_FOLDER, TENANT_NAME). Apply regenerates it — re-add after Apply.
- papp_start SKILL.md gained a "Coker AI sandbox branch" section with the full recipe.
- WSL /usr/bin/python3 has google-adk but NOT litellm.

## Session 2026-07-04 (addendum 3) — WSL start/build scripts, papp VERIFIED LIVE from worktree
Adapted the archived AI-chat harness scripts (E:/akselos-dev-3.10/_archive/ai-chat — README there
documents the AKS-20213/20215 era archive):
- `.agent/skills/build_papp/scripts/build_papp.sh` now takes optional repo-root arg (worktree);
  no arg = old main-checkout behavior. Verified: worktree build green in WSL (4m56s).
- NEW `.agent/skills/papp_start/scripts/start_papp_coker_sandbox.sh` — exports env from
  1.env_vars.json BEFORE python (agent module reads COLLECTIONS_PATH at import; bare
  `python papp_main.py` KeyErrors), then execs /usr/bin/python3 papp_main.py from the worktree.
  Verified: socket `/tmp/akselos-testing.demo_ai_dashboard.1.socket` up, direct socket curl of
  /sensor-data/latest-readings returns mock data, portal proxy responds (302 login for curl).
- Papp LEFT RUNNING (nohup, log /tmp/coker_sandbox_papp.log) — user can log into the portal and
  browse now. Restart needed after adding OPENROUTER_API_KEY / installing litellm.

## Session 2026-07-04 (addendum 4) — CHAT LIVE via native OpenRouter adapter, NO litellm
User initialized .env.local and rejected the litellm dependency. Replaced with
`agent/openrouter_llm.py` — self-contained ADK BaseLlm over OpenRouter's OpenAI-compatible API
via httpx (no new deps). Text + function-calling; non-streaming; 429 retry honoring Retry-After;
per-turn summary log lines ("OpenRouter turn: finish=... text_chars=... tool_calls=...").
Squashed with the litellm-option commit → branch = master + 3 commits:
70e54da122 (frontend) / 0ccf1b8b1c (backend) / 66a0e1dd2d (OpenRouter backend).
`start_papp_coker_sandbox.sh` now also loads .env.local files (papp dir → worktree frontends →
main-checkout frontends; VITE_OPENROUTER_* mirrored to OPENROUTER_*; shell env wins).
LIVE VERIFIED (WSL, portal socket): agent answered "How many operating cycles are recorded in
the database?" → "2604 operating cycles are recorded in the database." (correct; via SQL tool on
mock_sql? no — snapshot database.db via agent SQLTool). Turn trace: tool_call → tool_call → text.
Notes: user's .env.local default model (google/gemma-4-31b-it:free) was upstream-rate-limited all
session; `nvidia/nemotron-3-super-120b-a12b:free` worked. Override per run:
`OPENROUTER_MODEL="<model>" bash .../start_papp_coker_sandbox.sh`. Papp LEFT RUNNING with the
nemotron override (log /tmp/coker_sandbox_papp.log).
pgrep/pkill gotcha: patterns containing "papp_main.py" match the wsl bash -lc command itself —
use `pkill -f "papp[_]main.py"`.

## Next steps
- Push branch + open MR (user action). 3 commits, all verified.
- Optional: set a reliable model in .env.local (VITE_OPENROUTER_MODEL / OPENROUTER_MODEL).
- Port the NotFound→500 fixes upstream to coker_dashboard if the team wants them in production.
