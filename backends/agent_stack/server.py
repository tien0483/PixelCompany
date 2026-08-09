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
import re
import socket
import tempfile
import time
from contextlib import asynccontextmanager

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

# --- per-seat subagent routing ----------------------------------------------
# A Kanban card can pin an API seat that only its *subagents* bill. The runtime starts one
# Claude Code Router per seat and hands Claude Code
# `CLAUDE_CODE_SUBAGENT_MODEL=ccr-<port>,<modelId>`; Claude Code sends that string as the
# `model` of every subagent request and nothing else, so the model field is the only signal
# that separates a subagent turn from its parent's.
#
# The port travels inside the marker so this process needs no shared state with the runtime.
# It is bounded to the runtime's own allocation window (see `ccr-process.ts`) so a crafted
# model string cannot turn the switchboard into a proxy for arbitrary local ports.
SUBAGENT_MODEL_PATTERN = re.compile(r"^ccr-(\d+),(.+)$")
SEAT_PORT_MIN = int(os.environ.get("STACK_CCR_SEAT_BASE_PORT", "3460"))
SEAT_PORT_MAX = SEAT_PORT_MIN + 39
# Only this endpoint carries a model, and only it is worth buffering.
MODEL_ROUTED_PATHS = ("messages",)

# Hop-by-hop and length headers must not be forwarded verbatim: httpx recomputes
# them, and a stale content-length truncates streamed bodies.
#
# accept-encoding and content-encoding are deliberately NOT stripped. The body is
# relayed byte-for-byte via aiter_raw(), so it stays in whatever encoding the
# upstream chose; dropping content-encoding while forwarding still-gzipped bytes
# hands the client a payload it cannot decode. Passing the caller's
# accept-encoding through keeps that negotiation between the two real endpoints
# instead of letting httpx advertise encodings the caller never asked for.
STRIP_REQUEST_HEADERS = {
    "host",
    "content-length",
    "transfer-encoding",
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "upgrade",
}
STRIP_RESPONSE_HEADERS = {
    "content-length",
    "transfer-encoding",
    "connection",
    "keep-alive",
}

DEFAULT_FLAGS = {k: True for k in FLAG_KEYS}

# No global timeout on read: model responses stream for minutes.
UPSTREAM_TIMEOUT = httpx.Timeout(connect=15.0, read=None, write=60.0, pool=15.0)

# One client for the whole process, not one per request. Every AsyncClient owns
# its own connection pool, so building one per call discarded keep-alive and
# paid a fresh TLS handshake on every direct-to-Anthropic request.
HTTP: httpx.AsyncClient | None = None


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global HTTP
    HTTP = httpx.AsyncClient(timeout=UPSTREAM_TIMEOUT, follow_redirects=False)
    try:
        yield
    finally:
        client, HTTP = HTTP, None
        if client is not None:
            await client.aclose()


app = FastAPI(title="Agent Stack Sandbox", lifespan=lifespan)

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


def resolve_route(flags: dict, live: dict | None = None) -> tuple[str, list[str]]:
    """Return (upstream base URL, human-readable chain).

    Headroom fronts CCR when both are on. Headroom alone still gets used — it
    proxies to Anthropic itself — rather than being silently bypassed.

    `live` maps hop name -> is-the-port-open. When supplied, a hop whose flag is
    on but whose daemon is down is dropped from the route instead of being
    dialled: a dead loopback port turns every request into a 502, which Claude
    Code answers with retry backoff, and the whole thing reads as a hang rather
    than as the daemon crash it is. Skipped hops stay visible at the front of
    the chain so /health and x-stack-chain report the demotion instead of
    quietly claiming the flagged route.
    """
    headroom = bool(flags.get("ENABLE_HEADROOM"))
    ccr = bool(flags.get("ENABLE_CCR"))
    skipped = []
    if live is not None:
        if ccr and not live.get("ccr", True):
            skipped.append("ccr:3456 DOWN (skipped)")
            ccr = False
            # activate-stack.sh starts headroom with --anthropic-api-url pointed
            # at CCR whenever CCR is flagged on, so a dead CCR poisons headroom
            # too — forwarding there would just 502 one hop further along.
            if headroom:
                skipped.append("headroom:8787 (chained to dead ccr, skipped)")
                headroom = False
        if headroom and not live.get("headroom", True):
            skipped.append("headroom:8787 DOWN (skipped)")
            headroom = False
    if headroom and ccr:
        return HEADROOM_URL, skipped + ["headroom:8787", "ccr:3456", "upstream"]
    if headroom:
        return HEADROOM_URL, skipped + ["headroom:8787", "upstream"]
    if ccr:
        return CCR_URL, skipped + ["ccr:3456", "upstream"]
    return ANTHROPIC_URL, skipped + ["api.anthropic.com (direct)"]


def port_open(port: int, host: str = "127.0.0.1") -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.25)
        return s.connect_ex((host, port)) == 0


LIVENESS_TTL = 5.0
_liveness_cache: tuple[float, dict] | None = None


def daemon_liveness() -> dict:
    """Port probes for the three daemons, cached for LIVENESS_TTL seconds.

    The proxy hot path needs this on every request, and a probe against a
    firewalled port costs the full 0.25s timeout, so the result is memoised. The
    TTL is short enough that restarting a daemon is picked up within a few
    seconds without a switchboard restart.
    """
    global _liveness_cache
    now = time.monotonic()
    if _liveness_cache is not None and now - _liveness_cache[0] < LIVENESS_TTL:
        return _liveness_cache[1]
    probed = {
        "headroom": port_open(8787),
        "ccr": port_open(3456),
        "devtools": port_open(DEVTOOLS_PORT),
    }
    _liveness_cache = (now, probed)
    return probed


@app.get("/ui", response_class=HTMLResponse)
def ui() -> str:
    flags = get_flags()
    _, chain = resolve_route(flags, daemon_liveness())
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
    live = daemon_liveness()
    target, chain = resolve_route(flags, live)
    return {
        "sandboxDir": SANDBOX_DIR,
        "flags": flags,
        "route": {"target": target, "chain": chain},
        "daemons": {
            "headroom": {"port": 8787, "up": live["headroom"]},
            "ccr": {"port": 3456, "up": live["ccr"]},
            "devtools": {"port": DEVTOOLS_PORT, "up": live["devtools"]},
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
    """The shared client, rebuilt only if the app was mounted without lifespan."""
    global HTTP
    if HTTP is None or HTTP.is_closed:
        HTTP = httpx.AsyncClient(timeout=UPSTREAM_TIMEOUT, follow_redirects=False)
    return HTTP


def has_caller_credential(request: Request) -> bool:
    """
    True when the caller authenticated as itself rather than with the sandbox placeholder.

    `activate-stack.sh` exports `ANTHROPIC_API_KEY=sk-dummy-key-for-sandbox` precisely so no
    live key sits in an activated shell, and that placeholder must still be replaced. A
    session launched by the runtime instead carries a real Claude Code OAuth bearer, which
    has to survive untouched or its turns would bill this sandbox's account.
    """
    if request.headers.get("authorization", "").strip():
        return True
    api_key = request.headers.get("x-api-key", "").strip()
    return bool(api_key) and not api_key.startswith("sk-dummy-key")


class SubagentRoute:
    """A subagent turn resolved to the seat router that should serve it."""

    __slots__ = ("port", "body")

    def __init__(self, port: int, body: bytes):
        self.port = port
        self.body = body


async def read_subagent_route(request: Request, path: str) -> tuple[bytes | None, SubagentRoute | None]:
    """
    Classifies one request as a subagent turn or an ordinary one.

    Returns `(body, route)`. `body` is non-None only when this function had to buffer the
    request to read its model — every other request keeps streaming, so nothing but
    `/v1/messages` pays the memory cost of a buffered prompt.

    The seat's real model id replaces the marker, because the router forwards `model` to the
    provider verbatim and would otherwise ask it for a model named `ccr-<port>,...`.
    """
    if request.method != "POST" or path.strip("/") not in MODEL_ROUTED_PATHS:
        return None, None

    body = await request.body()
    if not body:
        return body, None
    try:
        payload = json.loads(body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return body, None
    if not isinstance(payload, dict):
        return body, None

    model = payload.get("model")
    match = SUBAGENT_MODEL_PATTERN.match(model) if isinstance(model, str) else None
    if match is None:
        return body, None

    port = int(match.group(1))
    if not SEAT_PORT_MIN <= port <= SEAT_PORT_MAX:
        # Outside the runtime's allocation window: treat it as an ordinary request rather
        # than proxying to whatever else happens to be listening on that port.
        return body, None

    payload["model"] = match.group(2)
    return body, SubagentRoute(port, json.dumps(payload).encode("utf-8"))


@app.api_route(
    "/v1/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
)
async def dynamic_proxy(request: Request, path: str):
    flags = get_flags()
    # Probed off the event loop: port_open blocks for up to 0.25s per closed
    # port, which would stall every other in-flight stream on a cache miss.
    live = await asyncio.to_thread(daemon_liveness)
    base, chain = resolve_route(flags, live)

    body, seat_route = await read_subagent_route(request, path)
    if seat_route is not None:
        # A subagent turn: bypass the flag-driven chain entirely and hand it to the router
        # holding that seat's key. The caller's own credential is not forwarded — the seat
        # authenticates downstream, and passing an Anthropic OAuth token to a third-party
        # endpoint would leak it.
        base = f"http://127.0.0.1:{seat_route.port}"
        chain = ["switchboard", f"ccr-seat:{seat_route.port}"]
        body = seat_route.body

    direct = base == ANTHROPIC_URL

    headers = {
        k: v for k, v in request.headers.items() if k.lower() not in STRIP_REQUEST_HEADERS
    }
    if seat_route is not None:
        headers.pop("authorization", None)
        headers.pop("x-api-key", None)
    elif direct and UPSTREAM_KEY and not has_caller_credential(request):
        # The session key is a sandbox placeholder; swap in the real one. A session that
        # brought its own credential (a Claude Code OAuth bearer, say) keeps it: overwriting
        # that would silently move the session's usage onto this sandbox's account.
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
        content=body if body is not None else request.stream(),
    )

    try:
        upstream = await client.send(req, stream=True)
    except httpx.HTTPError as exc:
        # The client is process-wide now — only the response gets closed here.
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
