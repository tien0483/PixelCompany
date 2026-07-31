---
name: start_papp
description: "Papp 실행/디버그 스킬 (WSL) — start or debug any Papp (e.g. demo_ai_dashboard) correctly in WSL. Use to: start/restart the papp dev server, run the app to verify a change, or check logs. Triggers: 'start the papp', 'run <papp_name>', 'restart the dev server'."
---

# start_papp — Run & Debug (WSL)

Starts and debugs a Papp. Two hard lessons this skill encodes: (1) the papp runs in **WSL only**, and (2) concurrent Papp branches must be run on isolated ports using the parameter script.

## Run the papp (WSL)
For isolated concurrent testing, bypass the portal UI and use the parameterized start script:
```bash
wsl bash .agent/skills/papp_start/scripts/start_papp.sh --isolated-port <PORT> --papp-name <PAPP_NAME> --collection <COLLECTION> <worktree_path>
```

Example for `demo_ai_dashboard` in the main checkout:
```bash
wsl bash .agent/skills/papp_start/scripts/start_papp.sh --isolated-port 8123 --papp-name demo_ai_dashboard --collection akselos-testing/demo_ai_dashboard /mnt/e/akselos-dev-3.10/akselos-dev-2
```

- The script auto-detects the active state directory inside `data/papp_data/<collection>/` and loads its `1.env_vars.json`.
- App URL: Access the isolated port via `http://127.0.0.1:<PORT>`.
- A rebuilt frontend (`dist/`) only takes effect after a dev-server **restart**.

## Known Errors & Debugging
- **404 for Static Mounts / `/csv`**: If static files return 404, check how `papp_main.py` mounts the directory. If it uses `fastapi.staticfiles.StaticFiles(directory=str(csv_in_collection))` evaluated at module import time, it will fail because the `COLLECTIONS_PATH` env var isn't fully injected before import. Fix this by replacing `StaticFiles` with a dynamic route (e.g. `@fast_api.get("/csv/{file_path:path}")`).
- **404 / Bizarre Nested Paths**: If the backend searches for a path nested inside itself, it means `COLLECTIONS_PATH` in `1.env_vars.json` was incorrectly set to an absolute Windows or WSL path (like `/mnt/e/...`). It must be the relative collection name **only** (e.g., `akselos-testing/demo_ai_dashboard`). Fix it and restart the dev server.
