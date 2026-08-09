"""Agent Stack — control panel UI + dynamic proxy router.

Serves:
  GET  /ui       switchboard (checkbox per tool)
  POST /ui/save  persist flags
  GET  /health   flag state, resolved route, daemon liveness
  *    /v1/*     streaming reverse proxy into the active chain

Everything lives under this directory (backends/agent_stack). No global
installs, no writes outside it except the workspace skill links, which are
explicit and reversible.

Started by the runtime on every Kanban launch — see
backends/runtime/src/stack/stack-process.ts. `SANDBOX_DIR` is derived from
__file__ rather than configured, so the process reports whichever tree it was
actually launched from; a stale answer there means an orphan from an older
location is still holding the port.
"""

import asyncio
import json
import os
import socket
import tempfile

import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse

SANDBOX_DIR = os.path.dirname(os.path.abspath(__file__))
FLAGS_FILE = os.path.join(SANDBOX_DIR, "stack-flags.json")

FLAG_KEYS = (
    "ENABLE_UA",
    "ENABLE_RTK",
    "ENABLE_CAVEMAN",
    "ENABLE_HEADROOM",
    "ENABLE_CCR",
    "ENABLE_DEVTOOLS",
)

FLAG_LABELS = {
    "ENABLE_UA": ("Understand-Anything", "local AST engine, /understand"),
    "ENABLE_RTK": ("RTK", "terminal command interception (PATH-scoped)"),
    "ENABLE_CAVEMAN": ("Caveman", "prompt compression skill in workspace"),
    "ENABLE_HEADROOM": ("Headroom", "context compression proxy :8787"),
    "ENABLE_CCR": ("Claude Code Router", "model routing / tool translation :3456"),
    "ENABLE_DEVTOOLS": ("Claude DevTools", "observability dashboard :3001"),
}

# Only these flags change proxy routing; the rest are activation-time concerns.
HEADROOM_URL = os.environ.get("STACK_HEADROOM_URL", "http://127.0.0.1:8787")
CCR_URL = os.environ.get("STACK_CCR_URL", "http://127.0.0.1:3456")
ANTHROPIC_URL = os.environ.get("STACK_ANTHROPIC_URL", "https://api.anthropic.com")

# Real credential used only when the request goes straight to Anthropic.
# activate-stack.sh exports a dummy ANTHROPIC_API_KEY into the Claude Code
# session (it must not hold a live key while pointed at a local proxy), so the
# genuine key is injected here instead.
UPSTREAM_KEY = os.environ.get("STACK_UPSTREAM_ANTHROPIC_API_KEY", "")

DEVTOOLS_PORT = 3001

# Hop-by-hop and length/encoding headers must not be forwarded verbatim:
# httpx recomputes them, and a stale content-length truncates streamed bodies.
STRIP_REQUEST_HEADERS = {
    "host",
    "content-length",
    "transfer-encoding",
    "connection",
    "keep-alive",
    "accept-encoding",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "upgrade",
}
STRIP_RESPONSE_HEADERS = {
    "content-length",
    "content-encoding",
    "transfer-encoding",
    "connection",
    "keep-alive",
}

DEFAULT_FLAGS = {k: True for k in FLAG_KEYS}

app = FastAPI(title="Agent Stack Sandbox")

# The switchboard is also rendered inside PixelOffice (TopBar, next to
# Office/Cleanup), which is served from a different local origin, so the JSON
# API needs CORS. Scoped to localhost origins only — this daemon binds 127.0.0.1
# and must not become reachable from arbitrary web pages.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^http://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_methods=["GET", "POST", "PUT", "OPTIONS"],
    allow_headers=["*"],
)


def get_flags() -> dict:
    flags = dict(DEFAULT_FLAGS)
    try:
        with open(FLAGS_FILE) as f:
            loaded = json.load(f)
    except (OSError, json.JSONDecodeError):
        return flags
    if isinstance(loaded, dict):
        for k in FLAG_KEYS:
            if k in loaded:
                flags[k] = bool(loaded[k])
    return flags


def save_flags(flags: dict) -> None:
    """Atomic write — a half-written flags file would fall back to all-on."""
    payload = json.dumps({k: bool(flags.get(k, False)) for k in FLAG_KEYS}, indent=2)
    fd, tmp = tempfile.mkstemp(dir=SANDBOX_DIR, prefix=".stack-flags.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as f:
            f.write(payload + "\n")
        os.replace(tmp, FLAGS_FILE)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def resolve_route(flags: dict) -> tuple[str, list[str]]:
    """Return (upstream base URL, human-readable chain).

    Headroom fronts CCR when both are on. Headroom alone still gets used — it
    proxies to Anthropic itself — rather than being silently bypassed.
    """
    headroom = flags.get("ENABLE_HEADROOM")
    ccr = flags.get("ENABLE_CCR")
    if headroom and ccr:
        return HEADROOM_URL, ["headroom:8787", "ccr:3456", "upstream"]
    if headroom:
        return HEADROOM_URL, ["headroom:8787", "upstream"]
    if ccr:
        return CCR_URL, ["ccr:3456", "upstream"]
    return ANTHROPIC_URL, ["api.anthropic.com (direct)"]


def port_open(port: int, host: str = "127.0.0.1") -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.25)
        return s.connect_ex((host, port)) == 0


@app.get("/ui", response_class=HTMLResponse)
def ui() -> str:
    flags = get_flags()
    _, chain = resolve_route(flags)
    rows = []
    for k in FLAG_KEYS:
        label, hint = FLAG_LABELS[k]
        checked = " checked" if flags[k] else ""
        rows.append(
            f"<label class='row'><input type='checkbox' name='{k}'{checked}>"
            f"<span><b>{label}</b> <code>{k}</code><br>"
            f"<small>{hint}</small></span></label>"
        )
    return f"""<!doctype html>
<html><head><meta charset="utf-8"><title>Agent Stack Switchboard</title><style>
 body {{ font-family: ui-sans-serif, system-ui, sans-serif; margin: 2rem auto; max-width: 44rem;
         line-height: 1.5; color: #1c1c1e; }}
 .row {{ display: flex; gap: .75rem; align-items: flex-start; padding: .6rem .8rem;
         border: 1px solid #e5e5ea; border-radius: .5rem; margin-bottom: .5rem; cursor: pointer; }}
 .row:hover {{ background: #f7f7f9; }}
 code {{ background: #f2f2f7; padding: 0 .25rem; border-radius: .25rem; font-size: .8em; }}
 small {{ color: #6c6c70; }}
 button {{ padding: .5rem 1.1rem; border-radius: .5rem; border: 0; background: #1c1c1e;
           color: #fff; font-size: 1rem; cursor: pointer; }}
 .chain {{ background: #f2f2f7; padding: .6rem .8rem; border-radius: .5rem; font-size: .9rem; }}
</style></head><body>
 <h2>Agent Stack Local Switchboard</h2>
 <p class="chain">Active proxy chain: <b>{" &rarr; ".join(chain)}</b></p>
 <form action="/ui/save" method="post">{"".join(rows)}
  <button type="submit">Save &amp; Apply</button>
 </form>
 <p><small>Flags are read per-request — proxy routing changes take effect immediately.
 UA / RTK / Caveman / DevTools are read at <code>activate-stack.sh</code> time, so re-source
 it in a new tab for those. See <a href="/health">/health</a>.</small></p>
</body></html>"""


@app.post("/ui/save")
async def save_ui(request: Request):
    form = await request.form()
    save_flags({k: k in form for k in FLAG_KEYS})
    return HTMLResponse(
        "<p>Saved. <a href='/ui'>Back to switchboard</a></p>", status_code=200
    )


def state_payload() -> dict:
    flags = get_flags()
    target, chain = resolve_route(flags)
    return {
        "sandboxDir": SANDBOX_DIR,
        "flags": flags,
        "route": {"target": target, "chain": chain},
        "daemons": {
            "headroom": {"port": 8787, "up": port_open(8787)},
            "ccr": {"port": 3456, "up": port_open(3456)},
            "devtools": {"port": DEVTOOLS_PORT, "up": port_open(DEVTOOLS_PORT)},
        },
        "upstreamKeyConfigured": bool(UPSTREAM_KEY),
        "activationScopedFlags": ["ENABLE_UA", "ENABLE_RTK", "ENABLE_CAVEMAN", "ENABLE_DEVTOOLS"],
    }


@app.get("/health")
def health() -> JSONResponse:
    return JSONResponse(state_payload())


@app.get("/api/flags")
def api_get_flags() -> JSONResponse:
    return JSONResponse(state_payload())


@app.put("/api/flags")
async def api_put_flags(request: Request) -> JSONResponse:
    try:
        body = await request.json()
    except (json.JSONDecodeError, UnicodeDecodeError):
        return JSONResponse({"error": "body must be JSON"}, status_code=400)
    incoming = body.get("flags") if isinstance(body, dict) and "flags" in body else body
    if not isinstance(incoming, dict):
        return JSONResponse({"error": "expected an object of flag booleans"}, status_code=400)
    unknown = sorted(set(incoming) - set(FLAG_KEYS))
    if unknown:
        return JSONResponse({"error": f"unknown flags: {', '.join(unknown)}"}, status_code=400)
    # Partial updates are allowed: start from what's on disk so a caller can
    # toggle one flag without having to echo back the other five.
    merged = get_flags()
    merged.update({k: bool(v) for k, v in incoming.items()})
    save_flags(merged)
    return JSONResponse(state_payload())


@app.get("/")
def root():
    return JSONResponse({"ui": "/ui", "health": "/health", "proxy": "/v1/{path}"})


def _client() -> httpx.AsyncClient:
    # No global timeout on read: model responses stream for minutes.
    return httpx.AsyncClient(
        timeout=httpx.Timeout(connect=15.0, read=None, write=60.0, pool=15.0),
        follow_redirects=False,
    )


@app.api_route(
    "/v1/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
)
async def dynamic_proxy(request: Request, path: str):
    flags = get_flags()
    base, chain = resolve_route(flags)
    direct = chain[0].startswith("api.anthropic.com")

    headers = {
        k: v for k, v in request.headers.items() if k.lower() not in STRIP_REQUEST_HEADERS
    }
    if direct and UPSTREAM_KEY:
        # The session key is a sandbox placeholder; swap in the real one.
        headers.pop("authorization", None)
        headers["x-api-key"] = UPSTREAM_KEY
    headers["x-stack-chain"] = " -> ".join(chain)

    url = f"{base}/v1/{path}"
    client = _client()
    req = client.build_request(
        request.method,
        url,
        headers=headers,
        params=request.query_params,
        content=request.stream(),
    )

    try:
        upstream = await client.send(req, stream=True)
    except httpx.HTTPError as exc:
        await client.aclose()
        return JSONResponse(
            {
                "error": {
                    "type": "stack_proxy_error",
                    "message": f"upstream {url} unreachable: {exc}",
                    "chain": chain,
                    "hint": "check /health for daemon liveness, or clear the flag for the "
                    "dead hop in /ui",
                }
            },
            status_code=502,
        )

    async def body():
        try:
            async for chunk in upstream.aiter_raw():
                yield chunk
        finally:
            await upstream.aclose()
            await client.aclose()

    return StreamingResponse(
        body(),
        status_code=upstream.status_code,
        headers={
            k: v
            for k, v in upstream.headers.items()
            if k.lower() not in STRIP_RESPONSE_HEADERS
        },
        media_type=upstream.headers.get("content-type"),
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("STACK_UI_PORT", 8000)))
