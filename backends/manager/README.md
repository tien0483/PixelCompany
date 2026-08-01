# backends/manager

Claude usage / OAuth / auto-swap FastAPI service for PixelOffice.

## Install (required once)

```bash
cd backends/manager
pip install -e .
# or: uv sync
```

Root `npm start` sets `PYTHONPATH` and runs `python -m manager webux`. If port `8321` never opens, the stack still boots UI/runtime and prints this install hint.

## Run

```bash
python -m manager webux --host 127.0.0.1 --port 8321 --no-browser
```

Or from repo root: `npm start` (starts runtime + Vite + Manager).

## Asana in `/whats-next`

Optional Asana integration for `/whats-next` goal briefs. Set `ASANA_PERSONAL_ACCESS_TOKEN` in the environment (create a personal access token at https://app.asana.com/0/my-apps). When unconfigured, the whats-next flow skips Asana silently.

## Product rules (PixelOffice)

- **Claude accounts only** — the Node runtime filters non-Claude providers before the UI.
- **Add Account** uses Anthropic OAuth via tRPC (`startClaudeOAuth` / flow status / submit code).
- Browser should not call `:8321` directly in the happy path; use same-origin `/api/trpc` + `/api/manager-proxy/*`.
- Product UI does not embed the multi-provider web dashboard (native React surfaces only).

## Layout

- `manager/api/main.py` — FastAPI app
- `manager/api/routes/` — routers (auth, features, analytics, …)
- `manager/data/web/` — standalone vanilla dashboard (ops / `manager webux` browser; not PixelOffice chrome)

Port default: `8321`.
