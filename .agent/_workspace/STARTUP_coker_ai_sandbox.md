# STARTUP — run the Coker AI sandbox at the portal URL

Target: **http://127.0.0.1/akselos-testing/demo_ai_dashboard/.app/demo_ai_dashboard/**
Branch `coker-ai-chat-integration`, worktree `E:/akselos-dev-3.10/coker-ai-chat-wt`.
(Portal-run knowledge consolidated from `_archive/ai-chat/claude-skills/papp_start` + this branch's
scripts. Full background: `.agent/skills/papp_start/SKILL.md` → "Coker AI sandbox branch".)

## TL;DR (normal day)

```bash
# WSL Ubuntu-22.04 — one command; portal must already be running (systemd services)
bash /mnt/e/akselos-dev-3.10/akselos-dev-2/.agent/skills/papp_start/scripts/start_papp_coker_sandbox.sh
```
Then open http://127.0.0.1/akselos-testing/demo_ai_dashboard/.app/demo_ai_dashboard/ and log in.
The script: exports env from `state-8jpr7a/1.env_vars.json` (must happen BEFORE python — the agent
module reads `COLLECTIONS_PATH` at import), loads `.env.local` (OpenRouter key; `VITE_OPENROUTER_*`
mirrored to `OPENROUTER_*`), cds into the WORKTREE papp dir, execs `/usr/bin/python3 papp_main.py`
→ unix socket `/tmp/akselos-testing.demo_ai_dashboard.1.socket`, which the portal proxies.

Different LLM for this run:
```bash
OPENROUTER_MODEL="nvidia/nemotron-3-super-120b-a12b:free" bash .../start_papp_coker_sandbox.sh
```
(Your `.env.local` default `google/gemma-4-31b-it:free` rate-limits heavily; nemotron verified.)

## One-time prerequisites (all DONE on this machine 2026-07-04 — listed for rebuilds)

1. Junctions in the worktree (Windows cmd):
   `coker-ai-chat-wt/data/collections` → `akselos-dev-2/data/collections`
   `coker-ai-chat-wt/data/papp_data`  → `akselos-dev-2/data/papp_data`
2. Mock data built into the collection (worktree venv python, from the papp dir):
   `build_mock_sql_db.py` (SQL for the page routers) + `build_mock_storage.py` (3D files, images,
   global_config.json).
3. `1.env_vars.json` (in `data/papp_data/akselos-testing/demo_ai_dashboard/state-8jpr7a/`) carries:
   `COLLECTIONS_PATH=akselos-testing/demo_ai_dashboard` (relative name ONLY — an absolute path
   here causes bizarre nested-path 404s), `SQLITE_DB_FILEPATH_SQL=<collection>/data/mock_sql.sqlite`,
   `LOCAL_OBJECT_STORAGE_FILEPATH_OBJECT_STORAGE=<collection>/object_storage`,
   `GLOBAL_CONFIG_FILE=global_config.json`, `META_DATA_IMAGES_FOLDER=images`, `TENANT_NAME=default`.
   ⚠ App-Editor **Apply regenerates this file and breaks COLLECTIONS_PATH** (`&COLLECTIONS_PATH`
   unsubstituted) — after any Apply, re-add the values above, then "Restart dev server", never Apply again.
4. OpenRouter key in `dashboard/papps/frontends/.env.local` (`VITE_OPENROUTER_API_KEY=`...). Chat
   uses the native adapter (`agent/openrouter_llm.py`) — no litellm, no gcloud. Without the key the
   agent falls back to Gemini-on-Vertex (needs `gcloud auth application-default login`).

## Frontend rebuild (after changing frontend code)

```bash
bash /mnt/e/akselos-dev-3.10/akselos-dev-2/.agent/skills/build_papp/scripts/build_papp.sh /mnt/e/akselos-dev-3.10/coker-ai-chat-wt
```
(dist → `backends/demo_ai_dashboard/dist`; skips tsc — non-fatal wasm-bindings error.)
Then RESTART the papp (dist is read at process start).

## Restart / stop

```bash
pkill -f "papp[_]main.py"     # bracket trick: plain "papp_main.py" matches your own wsl command
# then start again with the TL;DR command
```
If the App-Editor dev server for the instance is running, STOP it first — same socket name, they conflict.

## Windows alternative (no portal, no login — what Playwright uses)

```bash
cd E:/akselos-dev-3.10/coker-ai-chat-wt/dashboard/papps/backends/demo_ai_dashboard
E:/akselos-dev-3.10/coker-ai-chat-wt/.venv/Scripts/python.exe run_local.py --port 8123
# → http://127.0.0.1:8123/   (same app, TCP, ~40 s startup)
```

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Portal URL 502/504 | papp not running or socket conflict → restart per above; check `ls /tmp/*.socket` |
| Nested path like `.../data/collections/mnt/e/...` | `COLLECTIONS_PATH` in 1.env_vars.json is absolute — set the relative name, restart |
| `KeyError: COLLECTIONS_PATH` at start | You ran bare `python papp_main.py` — use the start script (it exports env first) |
| Chat: "Agent did not produce a final response." | Usually OpenRouter 429 on a free model — check `grep "OpenRouter" /tmp/coker_sandbox_papp.log`; switch model via `OPENROUTER_MODEL` |
| "Server Error" toasts on Home | An endpoint returned 5xx — `tail /tmp/coker_sandbox_papp.log`; (the known bulging-live 500 becomes a silent 404 after the e2e correction task lands) |
| Portal-level errors | `systemctl list-units --type=service | grep -iE 'akselos|gunicorn'` then `journalctl -u <unit> -n 200 --no-pager` |
| uvicorn not found (App-Editor flow only) | `sudo ln -sf /home/ubuntu/.local/bin/uvicorn /usr/local/bin/uvicorn` (script flow doesn't need it) |
| Empty FATIGUE/CRACK cards, skeleton "analytical horizon" | Known mock gaps: accumulated-damage table empty (snapshot can't be disaggregated), fatigue-latest 404 — cosmetic, charts elsewhere fine |

## Log locations

- Papp (script flow): `/tmp/coker_sandbox_papp.log` (WSL)
- Per-turn LLM trace: lines `OpenRouter turn: finish=... text_chars=... tool_calls=...`
- Portal: journalctl units per table above; App-Editor panel shows dev-server stdout too.
