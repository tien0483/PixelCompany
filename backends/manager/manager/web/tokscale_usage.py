"""On-demand tokscale CLI → usage overview aggregates (by provider / client).

Headline tokens, cost, and cache hit come from tokscale only. The Claude
analytics_db still owns anomaly flags elsewhere.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import threading
import time
from datetime import date, timedelta
from typing import Any, Callable

TOKSCALE_TIMEOUT_SEC = 60
CACHE_TTL_SEC = 60.0
INSTALL_HINT = "Install tokscale (`npm i -g tokscale` or `npx tokscale@latest`) for multi-agent usage."

_cache_lock = threading.Lock()
_cache: dict[str, tuple[float, dict[str, Any]]] = {}

RunTokscaleFn = Callable[[list[str]], subprocess.CompletedProcess[str]]


def date_flags_for_days(days: int, *, today: date | None = None) -> list[str]:
    """Map Analytics day chips to tokscale date flags."""
    if days <= 1:
        return ["--today"]
    if days == 7:
        return ["--week"]
    anchor = today or date.today()
    # Inclusive window of `days` calendar days ending today.
    since = anchor - timedelta(days=max(days, 1) - 1)
    return ["--since", since.isoformat()]


def resolve_tokscale_argv(extra: list[str]) -> list[str]:
    """Build argv: TOKSCALE_BIN → PATH tokscale → npx tokscale@latest."""
    env_bin = (os.environ.get("TOKSCALE_BIN") or "").strip()
    if env_bin:
        return [env_bin, *extra]
    which = shutil.which("tokscale")
    if which:
        return [which, *extra]
    return ["npx", "--yes", "tokscale@latest", *extra]


def _num(value: Any) -> float:
    if value is None or isinstance(value, bool):
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return 0.0
    return 0.0


def _row_tokens(entry: dict[str, Any]) -> float:
    for key in ("totalTokens", "total_tokens", "tokens"):
        if key in entry and entry[key] is not None:
            return _num(entry[key])
    return (
        _num(entry.get("input"))
        + _num(entry.get("output"))
        + _num(entry.get("cacheRead", entry.get("cache_read")))
        + _num(entry.get("cacheWrite", entry.get("cache_write")))
        + _num(entry.get("reasoning"))
    )


def _row_cost(entry: dict[str, Any]) -> float:
    for key in ("cost", "totalCost", "total_cost", "total_cost_usd"):
        if key in entry and entry[key] is not None:
            return _num(entry[key])
    return 0.0


def _row_cache_parts(entry: dict[str, Any]) -> tuple[float, float]:
    cache_read = _num(entry.get("cacheRead", entry.get("cache_read")))
    input_tokens = _num(entry.get("input", entry.get("input_tokens")))
    return cache_read, input_tokens


def cache_hit_ratio(cache_read: float, input_tokens: float) -> float | None:
    denom = cache_read + input_tokens
    if denom <= 0:
        return None
    return round(cache_read / denom, 4)


def _entries_from_payload(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [e for e in payload if isinstance(e, dict)]
    if not isinstance(payload, dict):
        return []
    for key in ("entries", "models", "data"):
        raw = payload.get(key)
        if isinstance(raw, list):
            return [e for e in raw if isinstance(e, dict)]
    return []


def aggregate_tokscale_entries(entries: list[dict[str, Any]]) -> dict[str, Any]:
    """Roll tokscale model rows into overall + by_provider + by_client."""
    total_tokens = 0.0
    total_cost = 0.0
    total_cache_read = 0.0
    total_input = 0.0
    total_messages = 0.0
    has_messages = False

    by_provider: dict[str, dict[str, float]] = {}
    by_client: dict[tuple[str, str], dict[str, float]] = {}

    for entry in entries:
        tokens = _row_tokens(entry)
        cost = _row_cost(entry)
        cache_read, input_tokens = _row_cache_parts(entry)
        provider = str(entry.get("provider") or "unknown")
        client = str(entry.get("client") or "unknown")

        total_tokens += tokens
        total_cost += cost
        total_cache_read += cache_read
        total_input += input_tokens

        msg = entry.get("messageCount", entry.get("message_count"))
        if msg is not None:
            has_messages = True
            total_messages += _num(msg)

        p = by_provider.setdefault(
            provider,
            {"total_tokens": 0.0, "total_cost_usd": 0.0, "cache_read": 0.0, "input": 0.0},
        )
        p["total_tokens"] += tokens
        p["total_cost_usd"] += cost
        p["cache_read"] += cache_read
        p["input"] += input_tokens

        c = by_client.setdefault(
            (client, provider),
            {"total_tokens": 0.0, "total_cost_usd": 0.0, "cache_read": 0.0, "input": 0.0},
        )
        c["total_tokens"] += tokens
        c["total_cost_usd"] += cost
        c["cache_read"] += cache_read
        c["input"] += input_tokens

    provider_rows = [
        {
            "provider": name,
            "total_tokens": int(round(vals["total_tokens"])),
            "total_cost_usd": round(vals["total_cost_usd"], 6),
            "cache_hit_ratio": cache_hit_ratio(vals["cache_read"], vals["input"]),
        }
        for name, vals in by_provider.items()
    ]
    provider_rows.sort(key=lambda r: r["total_cost_usd"], reverse=True)

    client_rows = [
        {
            "client": key[0],
            "provider": key[1],
            "total_tokens": int(round(vals["total_tokens"])),
            "total_cost_usd": round(vals["total_cost_usd"], 6),
            "cache_hit_ratio": cache_hit_ratio(vals["cache_read"], vals["input"]),
        }
        for key, vals in by_client.items()
    ]
    client_rows.sort(key=lambda r: r["total_cost_usd"], reverse=True)

    return {
        "total_tokens": int(round(total_tokens)) if entries else None,
        "total_cost_usd": round(total_cost, 6) if entries else None,
        "cache_hit_ratio": cache_hit_ratio(total_cache_read, total_input),
        "session_count": None,
        "message_count": int(round(total_messages)) if has_messages else None,
        "by_provider": provider_rows,
        "by_client": client_rows,
    }


def empty_overview() -> dict[str, Any]:
    return {
        "total_tokens": None,
        "total_cost_usd": None,
        "cache_hit_ratio": None,
        "session_count": None,
        "message_count": None,
        "by_provider": [],
        "by_client": [],
    }


def _default_run(argv: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        argv,
        capture_output=True,
        text=True,
        timeout=TOKSCALE_TIMEOUT_SEC,
        check=False,
    )


def fetch_tokscale_overview(
    days: int,
    *,
    run: RunTokscaleFn | None = None,
    use_cache: bool = True,
    today: date | None = None,
) -> dict[str, Any]:
    """Return {source, error, overview}. Never raises for tokscale failures."""
    cache_key = f"{days}:{','.join(date_flags_for_days(days, today=today))}"
    now = time.monotonic()
    if use_cache:
        with _cache_lock:
            hit = _cache.get(cache_key)
            if hit is not None and now - hit[0] < CACHE_TTL_SEC:
                return hit[1]

    extra = [
        "models",
        "--json",
        "--group-by",
        "client,provider,model",
        *date_flags_for_days(days, today=today),
    ]
    argv = resolve_tokscale_argv(extra)
    runner = run or _default_run

    try:
        proc = runner(argv)
    except FileNotFoundError:
        result = {
            "source": "none",
            "error": f"tokscale not found. {INSTALL_HINT}",
            "overview": empty_overview(),
        }
        return result
    except subprocess.TimeoutExpired:
        result = {
            "source": "none",
            "error": f"tokscale timed out after {TOKSCALE_TIMEOUT_SEC}s. {INSTALL_HINT}",
            "overview": empty_overview(),
        }
        return result
    except OSError as exc:
        result = {
            "source": "none",
            "error": f"tokscale failed to start: {exc}. {INSTALL_HINT}",
            "overview": empty_overview(),
        }
        return result

    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "").strip().splitlines()
        tail = detail[-1] if len(detail) > 0 else f"exit {proc.returncode}"
        result = {
            "source": "none",
            "error": f"tokscale failed: {tail}. {INSTALL_HINT}",
            "overview": empty_overview(),
        }
        return result

    stdout = (proc.stdout or "").strip()
    if len(stdout) == 0:
        result = {
            "source": "none",
            "error": f"tokscale returned empty output. {INSTALL_HINT}",
            "overview": empty_overview(),
        }
        return result

    try:
        payload = json.loads(stdout)
    except json.JSONDecodeError:
        result = {
            "source": "none",
            "error": f"tokscale returned invalid JSON. {INSTALL_HINT}",
            "overview": empty_overview(),
        }
        return result

    overview = aggregate_tokscale_entries(_entries_from_payload(payload))
    # Empty successful report is still a valid tokscale response.
    if overview["total_tokens"] is None and len(overview["by_provider"]) == 0:
        overview = {
            **empty_overview(),
            "total_tokens": 0,
            "total_cost_usd": 0.0,
            "by_provider": [],
            "by_client": [],
        }

    result = {"source": "tokscale", "error": None, "overview": overview}
    if use_cache:
        with _cache_lock:
            _cache[cache_key] = (time.monotonic(), result)
    return result


def clear_tokscale_cache() -> None:
    with _cache_lock:
        _cache.clear()
