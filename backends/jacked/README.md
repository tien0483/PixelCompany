# backends/jacked

Claude usage / OAuth / auto-swap FastAPI service for PixelOffice.

## Install (required once)

```bash
cd backends/jacked
pip install -e .
# or: uv sync
```

Root `npm start` sets `PYTHONPATH` and runs `python -m jacked webux`. If port `8321` never opens, the stack still boots UI/runtime and prints this install hint.

## Run

```bash
python -m jacked webux --host 127.0.0.1 --port 8321 --no-browser
```

Or from repo root: `npm start` (starts runtime + Vite + Jacked).

## Product rules (PixelOffice)

- **Claude accounts only** — the Node runtime filters non-Claude providers before the UI.
- **Add Account** uses Anthropic OAuth via tRPC (`startClaudeOAuth` / flow status / submit code).
- Browser should not call `:8321` directly in the happy path; use same-origin `/api/trpc` + `/api/jacked-proxy/*`.
- Product UI does not embed the multi-provider web dashboard (native React surfaces only).

## Layout

- `jacked/api/main.py` — FastAPI app
- `jacked/api/routes/` — routers (auth, features, analytics, …)
- `jacked/data/web/` — standalone vanilla dashboard (ops / `jacked webux` browser; not PixelOffice chrome)

Port default: `8321`.
