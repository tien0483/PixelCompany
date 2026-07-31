# TASK — Playwright E2E + tool-usage auto tests for the Coker AI sandbox

For a sub-agent. Self-contained: do not re-derive context from the repo history.
**Branch: `coker-ai-chat-integration`** (the user calls it "coker-ai-chat") — already checked out
in worktree **`E:/akselos-dev-3.10/coker-ai-chat-wt`** @ `66a0e1dd2d` (= master + 3 commits).
Work ONLY in that worktree, commit ONLY to that branch.

## 1. What the app is

`demo_ai_dashboard` papp = sandbox clone of the production Coker Dashboard + a docked AI chat
sidebar. All data is mock (SQLite + object-storage files inside the collection). The AI agent
answers chat questions by CALLING TOOLS (SQL/schema/visualization) against the mock database —
that tool usage is the main thing to test.

- Frontend: `dashboard/papps/frontends/src/demo_ai_dashboard/` (React+Vite, Mantine, ECharts,
  chat on @assistant-ui/react). Build: `VITE_MY_APP=demo_ai_dashboard npm run build` from
  `dashboard/papps/frontends` (dist → `../backends/demo_ai_dashboard/dist`).
- Backend: `dashboard/papps/backends/demo_ai_dashboard/` (FastAPI). Chat: `POST /chat/sessions`
  → `{session_id}`, `POST /chat/{session_id}/message` body `{"text": "..."}` →
  `{"response": str, "artifacts": [{data: b64, mime_type}]}`.
- LLM: env `OPENROUTER_API_KEY` present → native OpenRouter adapter
  (`agent/openrouter_llm.py`), no Google creds needed. The runner scripts auto-load the key
  from `.env.local` (never read or print that file's contents; never commit it).

## 2. How to run the app for tests (Windows, no portal login — REQUIRED for Playwright)

The portal route needs interactive login; tests must instead use the standalone runner, which
serves the SAME built frontend + API on plain TCP with no auth:

```bash
# one-time data prep (already done on this machine, safe to re-run):
cd E:/akselos-dev-3.10/coker-ai-chat-wt/dashboard/papps/backends/demo_ai_dashboard
E:/akselos-dev-3.10/coker-ai-chat-wt/.venv/Scripts/python.exe build_mock_sql_db.py
E:/akselos-dev-3.10/coker-ai-chat-wt/.venv/Scripts/python.exe build_mock_storage.py

# server (loads .env.local incl. OpenRouter key automatically):
E:/akselos-dev-3.10/coker-ai-chat-wt/.venv/Scripts/python.exe run_local.py --port 8123
# → http://127.0.0.1:8123/  (frontend + API same origin)
```

Startup takes ~40 s (heavy imports). Health probe: `GET /sensor-data/latest-readings` → 200 JSON.

⚠ Model note: the free OpenRouter models rate-limit (HTTP 429). The adapter retries
(Retry-After honored) but replies can still fail or take >60 s. `nvidia/nemotron-3-super-120b-a12b:free`
worked reliably; override with env `OPENROUTER_MODEL` before starting the server if needed.

## 3. Deliverable A — Playwright setup

1. Add dev deps in `dashboard/papps/frontends/package.json`: `@playwright/test` (latest).
   ⚠ `node_modules` in the worktree is a Windows **junction** to
   `akselos-dev-2/dashboard/papps/frontends/node_modules` (shared). `npm install` there is OK
   (adds the package to the shared dir) but do NOT delete/recreate node_modules.
   Then `npx playwright install chromium`.
2. Create `dashboard/papps/frontends/playwright.config.ts`:
   - testDir `./e2e`
   - baseURL `http://127.0.0.1:8123`
   - `webServer`: command
     `E:/akselos-dev-3.10/coker-ai-chat-wt/.venv/Scripts/python.exe ../backends/demo_ai_dashboard/run_local.py --port 8123`
     with `cwd` pointing at `../backends/demo_ai_dashboard`, `url` set to
     `http://127.0.0.1:8123/sensor-data/latest-readings`, `timeout: 180_000`,
     `reuseExistingServer: true`.
   - screenshots dir: `e2e/__results__/` (gitignore it? NO — screenshots ARE evidence the user
     wants; commit the final marked screenshots, keep them small/png).
   - retries 1, single worker (one shared backend).
3. `npm run test:e2e` script → `playwright test`.

## 4. Deliverable B — the tests (`dashboard/papps/frontends/e2e/demo_ai_dashboard/`)

Navigation model: no router lib — pages via query param, e.g. `/?view=/process-monitoring`.
Route list: `""` Home, `/process-monitoring`, `/spm-monitoring` + `/fatigue-status`,
`/cycle-inspection`, `/historical-trends` (bulging/crack routes are tenant-feature-gated OFF by
default — skip them).

### B1 `smoke.spec.ts`
- App shell loads: heading "Coker Dashboard", menu links Home / Process Monitoring /
  SPM Monitoring / Asset Integrity, **"Ask AI" launcher button visible**.
- Home mock values render: text `2604` (total cycles), a TEMPERATURE card, equipment table row
  "Asset Name" = "Coker 1A".

### B2 `pages.spec.ts`
- For each route above: navigate, expect no crash, expect ≥1 ECharts canvas where applicable
  (`[_echarts_instance_]` attribute) on process-monitoring + historical-trends.
- Historical Trends shows the From/To date pickers.
- Console-error budget: collect page errors; fail on any uncaught exception EXCEPT known noise:
  3D `visualization/*` fetches are fine (object storage IS mocked; they should be 200 now) —
  treat any 4xx/5xx network response other than `bulging-results/scenario-names/live/latest`
  (known 500) and `fatigue-results/cycles/latest*` (known 404) as a failure.

### B3 `chat-tool-usage.spec.ts` — the core one
Flow (UI level):
1. Click the "Ask AI" launcher (button title `Ask Akselos Assistant`).
2. Intro gate appears → click "Start chat".
3. Type into the composer: `How many operating cycles are recorded in the database? Answer briefly.`
   and send.
4. Wait (timeout 180 s) for an assistant message containing **`2604`** — that number can ONLY
   come from the agent executing its SQL tool against the mock DB, i.e. this asserts real tool
   usage end-to-end.
5. If the reply errors/timeouts, retry ONCE in a fresh session (free-model flakiness), then fail.

Also API-level tool-usage tests in the same spec (faster, run first):
- `POST /chat/sessions` → 200 + session_id.
- `POST /chat/{id}/message` with the cycles question → response text contains `2604`
  (same retry policy).
- SQL guard negative check is unit-tested already — do NOT try to prompt-inject; out of scope.

### B4 `red-box-evidence.spec.ts` — marked screenshots (user requirement)
The user wants every CHANGED area marked with a **red box** in screenshots ("assign the red box
for the place that we change and use that for mark"). Changed-by-this-branch UI areas:

| # | Element | How to locate | Screenshot file |
|---|---------|---------------|-----------------|
| 1 | "Ask AI" launcher button (bottom-right) | `page.getByRole('button', { name: /Ask AI/ })` | `01_home_askai_launcher.png` (full page) |
| 2 | Chat sidebar panel (open state) | after opening: the fixed right panel — locate via the collapse button `getByTitle('Collapse sidebar')` then `locator('..')` up to the panel root, or the element containing the "Assistant" title | `02_chat_sidebar_open.png` |
| 3 | Intro gate (privacy/terms card + "Start chat") | `getByRole('button', { name: 'Start chat' })` ancestor | `03_chat_intro_gate.png` |
| 4 | Composer input row | the chat textbox (`getByRole('textbox')` inside the sidebar) | `04_chat_composer.png` |
| 5 | Assistant reply bubble w/ the `2604` answer | message element containing `2604` | `05_chat_tool_answer.png` |
| 6 | Header title fallback "Coker AI Dashboard (sandbox)" | heading text (only shows when tenant config lacks project_name — assert presence; if the mock global_config provides a project name, red-box the header anyway and note it) | `06_header_sandbox_title.png` |

Red-box technique (apply BEFORE each screenshot):
```ts
await locator.evaluate((el) => {
  el.style.outline = '4px solid red';
  el.style.outlineOffset = '2px';
});
await page.screenshot({ path: 'e2e/__results__/01_home_askai_launcher.png', fullPage: true });
```
CSS-module class names are hashed — NEVER select by class; use roles/titles/text as in the table.
Set viewport 1440×900 for all evidence shots.

## 5. Tool usage reference (scripts this branch ships — document them in the test README)

Write `dashboard/papps/frontends/e2e/README.md` covering:
- `run_local.py [--port]` — standalone server (Windows), auto-loads `.env.local`.
- `build_mock_sql_db.py` / `build_mock_storage.py` — rebuild mock data (dry-run/apply semantics
  in their docstrings).
- `csv_loader.py` — CSV→SQLite refresh mechanism (dry-run default).
- WSL alternative (portal flow): `bash .agent/skills/papp_start/scripts/start_papp_coker_sandbox.sh`
  (main checkout `.agent/`), build via `.agent/skills/build_papp/scripts/build_papp.sh <worktree>`.
- How to run the e2e suite: `npm run test:e2e` (webServer auto-starts the backend).

## 6. Rules / constraints

- NEVER touch `dashboard/papps/frontends/src/coker_dashboard`, `dashboard/papps/backends/coker_dashboard`
  (production papp) or `scrbe/` (forbidden dir).
- Never read/print/commit `.env.local` (secrets). Screenshots must not show the key.
- Python: use the worktree venv `E:/akselos-dev-3.10/coker-ai-chat-wt/.venv/Scripts/python.exe`
  (system python lacks google-adk).
- Commits: on `coker-ai-chat-integration` only, imperative subject, **NO Co-authored-by trailer**.
  Suggested: one commit "demo_ai_dashboard: add Playwright e2e suite with red-box evidence".
- Keep the existing suites green: `.venv/Scripts/python.exe -m pytest
  tests/src/dashboard/papps/backends/demo_ai_dashboard -q` (54 tests) and
  `npx vitest run __tests__/demo_ai_dashboard/messageParts.test.tsx` (5 tests).
- A papp instance may already be running in WSL on the portal socket — irrelevant to these tests
  (different transport); do not kill it.

## 7. Acceptance criteria

1. `npm run test:e2e` green locally (chat spec may soft-retry once; document flake policy).
2. Six red-box evidence PNGs exist under `e2e/__results__/` and are committed.
3. e2e README written.
4. Existing pytest 54/54 + vitest 5/5 still green; ruff untouched areas clean.
5. Single commit on the branch, no trailer, nothing under production/forbidden paths changed.
