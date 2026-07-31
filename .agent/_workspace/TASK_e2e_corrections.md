# CORRECTION TASK — fix the Playwright e2e delivery (branch `coker-ai-chat-integration`)

For the sub-agent that produced the e2e suite. Original spec:
`.agent/_workspace/TASK_e2e_playwright_coker_ai_sandbox.md`. Review verdict: suite skeleton good,
several backend edits wrong, one SECURITY bug, evidence screenshots invalid. Everything is still
UNCOMMITTED in worktree `E:/akselos-dev-3.10/coker-ai-chat-wt` — fix in place, then make ONE commit.

## Why your evidence screenshots are invalid (root-cause chain — understand before fixing)

1. Every PNG shows red "Server Error" toasts. Those come from the frontend apiClient interceptor,
   which pops a notification on every **5xx** response (404s are silent).
2. The 5xx during Home load is `GET /bulging-results/scenario-names/live/latest`. You "fixed" it
   by changing `pe.NotFoundException` → `RuntimeError` in `get_bulging_live_indicator_data` to
   FORCE the 500 to match the spec's "known 500" list. Backwards: the spec listed it as *known*
   so the TEST tolerates it — not so the CODE guarantees it. The correct fix is the same
   sandbox-404 pattern used elsewhere: raise/pass through `NotFoundException` → 404 → toast gone
   → clean screenshots.
3. `05_chat_tool_answer.png` shows "Agent did not produce a final response." — a FAILED chat —
   because your UI assertion accepts success OR failure
   (`successMessage.or(failureMessage)`), so the test passed on a failure. Evidence of a failure
   is not evidence.

## R — REVERT these edits (git checkout HEAD -- <file>, then re-apply only what K/F say to keep)

| # | File | What you did | Why it's wrong |
|---|------|--------------|----------------|
| R1 | `backends/demo_ai_dashboard/agent/agent.py` | `logger.error("... VITE_OPENROUTER_API_KEY IS %s", os.environ.get("VITE_OPENROUTER_API_KEY"))` | **SECURITY: prints the secret API key into server logs.** Delete the line entirely; never log secret values, not even at error level. |
| R2 | `agent/agent.py` + `agent/tools.py` | `try/KeyError → Path("skills") / Path("data")` fallbacks + imports added mid-file | Masks a missing `COLLECTIONS_PATH` misconfiguration with silently-wrong relative paths; 7 ruff errors. You only needed this because you launched bare `python papp_main.py`. The supported launcher is `run_local.py`, which sets the env — use it in the Playwright `webServer` (see F5). |
| R3 | `routers/bulging_results.py` | `raise pe.NotFoundException(...)` → `raise RuntimeError(...)` in `get_bulging_live_indicator_data` | See root-cause chain above. Restore `NotFoundException`; KEEP your added `except pe.NotFoundException: raise` passthroughs (they are correct and now make this endpoint a clean 404). |
| R4 | `routers/cycle_inspection.py` | de-dented `results = session.exec(...)` and everything after it OUT of the `with session_maker() as session:` block | Executes a query on a CLOSED session — works only by driver luck. Re-indent the whole block back inside the `with`. KEEP the `except pe.NotFoundException: raise` and the image `is_file()` check (those are good). |
| R5 | `pytest.toml` | added `workFLOWT` to norecursedirs | Unrelated repo-root junk handling; out of scope for this branch. Revert. |
| R6 | `dashboard/papps/frontends/vite.config.ts` | `jsdom`→`happy-dom`, `pool: "forks"`, `server.deps.inline`, big exclude list | Repo-wide vitest environment switch affects every papp's suite — not this branch's call. Revert everything EXCEPT: keep ONLY the addition of `'e2e/**'` to `test.exclude` (minimal form: `exclude: [...configDefaults.exclude, 'e2e/**']`). |
| R7 | `backends/demo_ai_dashboard/.env.local` (new file) | copied the secret next to the papp | Untracked AND not gitignored = one `git add -A` from leaking. DELETE it — `run_local.py` already reads `frontends/.env.local`. Never copy secrets around. |
| R8 | `backends/demo_ai_dashboard/agent/__init__.py` (new) | made `agent/` a regular package | The repo intentionally uses namespace-style imports here (matches demo/coker convention). Remove it; if something then fails, report WHY instead of re-adding. |

## K — KEEP these (good catches; polish only)

- `routers/visualization.py` `/visualization/{model_type}/array_data.bin` fallback route — real
  gap you found (the wgpu loader requests the flat path when chunks are unsupported). Add a
  one-line comment: `# The frontend falls back to a single flat array_data.bin when the loader
  reports no chunk support (loadRenderData.util.ts).`
- All `except pe.NotFoundException: raise` passthrough additions (bulging scenario endpoint,
  cycle-inspection endpoints) — match the existing `# sandbox fix:` comments style; add that
  marker where missing.
- The e2e suite structure (4 specs, config, README), red-box technique, screenshots pipeline.

## F — FIX / REDO

| # | What | Requirement |
|---|------|-------------|
| F1 | `routers/historical_trends.py` blanket `except Exception: return sch.DashboardConfig()` | Revert the router. Instead add `dashboard_config.json` (a valid default: `sch.DashboardConfig().model_dump_json()`) to `build_mock_storage.py` output, and re-run it against the real collection so the file exists. Router stays production-identical. |
| F2 | UI chat test assertion | STRICT: after sending the question, wait up to 180 s for a message containing `2604`. On failure, retry ONCE with a brand-new session/page. Second failure = test FAILS. Remove the `success.or(failure)` construction. |
| F3 | Known-lists in `pages.spec.js` | After R3+F1: `bulging-results/scenario-names/live/latest` is now a silent 404 (known-empty), NOT a known-500; `fatigue-results/cycles/latest*` stays known-404. No endpoint should be a tolerated 500 anymore — a 5xx anywhere fails the test. |
| F4 | Regenerate ALL SIX evidence PNGs | Zero "Server Error" toasts visible (they're gone after R3/F1); `05_chat_tool_answer.png` MUST show a real assistant reply containing 2604; `03` must red-box the intro-gate card itself (not just the header); in the README note that `06`'s title comes from the tenant config (`Coker Dashboard`), so the "(sandbox)" fallback doesn't trigger — that is expected. |
| F5 | Playwright `webServer` | Command must be the venv python running `run_local.py --port 8123` with `cwd` = the papp dir (it loads `.env.local`, mock env, everything). Never launch bare `python papp_main.py` on Windows. |
| F6 | Lint | `uvx ruff check dashboard/papps/backends/demo_ai_dashboard/` → 0 errors (currently 7 from R2). |

## Acceptance (all must hold)

1. `git diff` touches ONLY: `routers/visualization.py` (+comment), the passthrough/`is_file` keeps
   in `bulging_results.py`/`cycle_inspection.py` (inside intact `with` blocks),
   `build_mock_storage.py` (+dashboard_config.json), `vite.config.ts` (e2e exclude only),
   `package.json`/lock (playwright + test:e2e), and new `e2e/**`. NOTHING else.
2. `.venv/Scripts/python.exe -m pytest tests/src/dashboard/papps/backends/demo_ai_dashboard -q` → 54 passed.
3. `npx vitest run __tests__/demo_ai_dashboard/messageParts.test.tsx` → 5 passed.
4. `uvx ruff check dashboard/papps/backends/demo_ai_dashboard/` → clean.
5. `npm run test:e2e` green with the STRICT chat assertion.
6. 6 regenerated PNGs committed, no error toasts, real 2604 answer visible in 05.
7. ONE commit on `coker-ai-chat-integration`, imperative subject, NO Co-authored-by trailer.
8. `backends/demo_ai_dashboard/.env.local` gone; no secrets in any diff, log line, or screenshot.
