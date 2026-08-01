"""Cursor usage via DashboardService GetCurrentPeriodUsage.

Cursor's Plan & Usage UI now exposes two monthly pools (not 5h/7d):

* Cursor Models  ← ``planUsage.autoPercentUsed`` (Auto / Composer / Grok…)
* Other Models   ← ``planUsage.apiPercentUsed`` (named third-party models)

Jacked still stores these in the shared ``five_hour`` / ``seven_day`` cache
columns so Seats / Auto-swap keep one pressure model. Labels in the Seats UI
are Cursor-specific.

Falls back to legacy ``GET /auth/usage`` when the dashboard endpoint is empty
or unavailable (older tokens / builds).
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Mapping, Optional

import httpx

from .accounts import read_cursor_slot_auth
from .credentials import cursor_state_db_path, read_cursor_auth

logger = logging.getLogger(__name__)

_LEGACY_USAGE_URL = "https://api2.cursor.sh/auth/usage"
_PERIOD_USAGE_URL = (
    "https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage"
)
_USER_AGENT = "Cursor/0.50.0"


def _cursor_access_token(
    account_id: int,
    db_path=None,
    env: Optional[Mapping[str, str]] = None,
) -> Optional[str]:
    """Return a non-empty access token, preferring the seat slot over live IDE."""
    slot_auth = read_cursor_slot_auth(account_id, env)
    if isinstance(slot_auth, dict):
        slot_token = slot_auth.get("access_token")
        if isinstance(slot_token, str) and len(slot_token.strip()) > 0:
            return slot_token.strip()
    live = read_cursor_auth(db_path or cursor_state_db_path(env), env)
    if isinstance(live, dict):
        live_token = live.get("access_token")
        if isinstance(live_token, str) and len(live_token.strip()) > 0:
            return live_token.strip()
    return None


class CursorUsageError(Exception):
    """Cursor usage fetch failed."""


def _as_percent(used, limit) -> Optional[float]:
    try:
        used_f = float(used)
        limit_f = float(limit)
    except (TypeError, ValueError):
        return None
    if limit_f <= 0:
        return None
    return max(0.0, min(100.0, (used_f / limit_f) * 100.0))


def _clamp_percent(value) -> Optional[float]:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return max(0.0, min(100.0, float(value)))


def _first_number(source: dict, keys: tuple[str, ...]) -> Optional[float]:
    for key in keys:
        value = source.get(key)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return float(value)
        if isinstance(value, dict):
            nested = _first_number(
                value,
                ("used", "usage", "numRequests", "numRequestsTotal", "percentage", "percentUsed"),
            )
            if nested is not None:
                return nested
    return None


def _ms_to_iso(value) -> Optional[str]:
    """Convert Cursor's unix-ms string/number to an ISO-8601 UTC timestamp."""
    if value is None:
        return None
    try:
        if isinstance(value, str) and len(value.strip()) > 0:
            ms = float(value.strip())
        elif isinstance(value, (int, float)) and not isinstance(value, bool):
            ms = float(value)
        else:
            return None
        # Heuristic: treat small values as seconds.
        if ms < 1_000_000_000_000:
            ms *= 1000.0
        dt = datetime.fromtimestamp(ms / 1000.0, tz=timezone.utc)
        return dt.isoformat().replace("+00:00", "Z")
    except (TypeError, ValueError, OSError, OverflowError):
        return None


def _empty_norm() -> dict:
    return {
        "five_hour": {"utilization": None, "resets_at": None, "reported": False},
        "seven_day": {"utilization": None, "resets_at": None, "reported": False},
    }


def normalize_cursor_period_usage(payload: dict) -> dict:
    """Map GetCurrentPeriodUsage onto five_hour / seven_day slots.

    * five_hour ← Cursor Models (``autoPercentUsed``)
    * seven_day ← Other Models (``apiPercentUsed``)
    * resets    ← ``billingCycleEnd``
    """
    plan = payload.get("planUsage")
    if not isinstance(plan, dict):
        plan = {}
    five = _clamp_percent(plan.get("autoPercentUsed"))
    seven = _clamp_percent(plan.get("apiPercentUsed"))
    # Fall back to total when the split pools are absent (older / team shapes).
    if five is None and seven is None:
        five = _clamp_percent(plan.get("totalPercentUsed"))
    resets_at = _ms_to_iso(payload.get("billingCycleEnd"))
    return {
        "five_hour": {
            "utilization": five,
            "resets_at": resets_at,
            "reported": five is not None,
        },
        "seven_day": {
            "utilization": seven,
            "resets_at": resets_at,
            "reported": seven is not None,
        },
    }


def normalize_cursor_usage(payload: dict) -> dict:
    """Map a Cursor usage payload onto five_hour / seven_day slots.

    Accepts both the dashboard period-usage shape and the legacy
    ``/auth/usage`` request-count shape.
    """
    if isinstance(payload.get("planUsage"), dict) or "billingCycleEnd" in payload:
        return normalize_cursor_period_usage(payload)

    # Legacy shapes observed across older Cursor builds.
    gpt4 = payload.get("gpt-4") or payload.get("gpt4") or payload.get("premium") or {}
    start = payload.get("startOfMonth") or payload.get("start_of_month")
    if not isinstance(gpt4, dict):
        gpt4 = {}

    used = _first_number(gpt4, ("numRequestsTotal", "numRequests", "used", "usage"))
    limit = _first_number(gpt4, ("maxRequestUsage", "maxRequests", "limit", "total"))
    five = _as_percent(used, limit) if used is not None and limit is not None else None
    if five is None and isinstance(gpt4.get("percentage"), (int, float)):
        five = max(0.0, min(100.0, float(gpt4["percentage"])))

    slow = payload.get("gpt-3.5-turbo") or payload.get("gpt35") or payload.get("slow") or {}
    if not isinstance(slow, dict):
        slow = {}
    used7 = _first_number(slow, ("numRequestsTotal", "numRequests", "used", "usage"))
    limit7 = _first_number(slow, ("maxRequestUsage", "maxRequests", "limit", "total"))
    seven = _as_percent(used7, limit7) if used7 is not None and limit7 is not None else None

    if five is None:
        top = _first_number(payload, ("usage", "percentUsed", "percentage"))
        if top is not None and top <= 100:
            five = top

    resets_at = None
    if isinstance(start, str) and len(start) > 0:
        resets_at = start

    return {
        "five_hour": {
            "utilization": five,
            "resets_at": resets_at,
            "reported": five is not None,
        },
        "seven_day": {
            "utilization": seven,
            "resets_at": None,
            "reported": seven is not None,
        },
    }


def _auth_headers(token: str, *, connect: bool = False) -> dict[str, str]:
    headers = {
        "Authorization": f"Bearer {token}",
        "User-Agent": _USER_AGENT,
        "Accept": "application/json",
    }
    if connect:
        headers["Content-Type"] = "application/json"
        headers["Connect-Protocol-Version"] = "1"
    return headers


async def _fetch_period_usage(client: httpx.AsyncClient, token: str) -> Optional[dict]:
    try:
        resp = await client.post(
            _PERIOD_USAGE_URL,
            headers=_auth_headers(token, connect=True),
            content=b"{}",
        )
    except Exception as exc:
        logger.warning("Cursor period usage transport failed: %s", exc)
        return None
    if resp.status_code >= 400:
        logger.warning("Cursor period usage HTTP %s", resp.status_code)
        return None
    try:
        payload = resp.json()
    except ValueError:
        return None
    return payload if isinstance(payload, dict) else None


async def _fetch_legacy_usage(client: httpx.AsyncClient, token: str) -> Optional[dict]:
    try:
        resp = await client.get(
            _LEGACY_USAGE_URL,
            headers=_auth_headers(token),
        )
    except Exception as exc:
        logger.warning("Cursor legacy usage transport failed: %s", exc)
        return None
    if resp.status_code >= 400:
        logger.warning("Cursor legacy usage HTTP %s", resp.status_code)
        return None
    try:
        payload = resp.json()
    except ValueError:
        return None
    return payload if isinstance(payload, dict) else None


async def fetch_cursor_usage(
    account_id: int,
    db,
    state: Optional[dict] = None,
    db_path=None,
    env: Optional[Mapping[str, str]] = None,
) -> Optional[dict]:
    """Fetch + normalize + cache Cursor usage for ``account_id``."""
    token = _cursor_access_token(account_id, db_path=db_path, env=env)
    if token is None:
        try:
            db.record_account_error(
                account_id,
                "no Cursor access token in seat slot or state.vscdb",
            )
        except Exception:
            logger.debug("record_account_error failed", exc_info=True)
        return None

    payload: Optional[dict] = None
    norm = _empty_norm()
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            payload = await _fetch_period_usage(client, token)
            if payload is not None:
                norm = normalize_cursor_usage(payload)
            five = norm["five_hour"]
            seven = norm["seven_day"]
            if five["utilization"] is None and seven["utilization"] is None:
                legacy = await _fetch_legacy_usage(client, token)
                if legacy is not None:
                    payload = legacy
                    norm = normalize_cursor_usage(legacy)
    except Exception as exc:
        logger.warning("Cursor usage transport failed for %s: %s", account_id, exc)
        try:
            db.record_account_error(account_id, str(exc))
        except Exception:
            logger.debug("record_account_error failed", exc_info=True)
        return None

    if payload is None:
        try:
            db.record_account_error(account_id, "Cursor usage HTTP failed")
        except Exception:
            logger.debug("record_account_error failed", exc_info=True)
        return None

    five = norm["five_hour"]
    seven = norm["seven_day"]
    if five["utilization"] is None and seven["utilization"] is None:
        try:
            db.record_account_error(
                account_id,
                "Cursor usage payload had no recognizable windows",
                increment_failures=False,
            )
        except Exception:
            logger.debug("record_account_error failed", exc_info=True)
        return None

    db.update_account_usage_cache(
        account_id,
        five_hour=five["utilization"],
        seven_day=seven["utilization"],
        five_hour_resets_at=five["resets_at"] if five["utilization"] is not None else None,
        seven_day_resets_at=seven["resets_at"] if seven["utilization"] is not None else None,
        clear_five_hour=not five["reported"],
        clear_seven_day=not seven["reported"],
        raw=payload,
    )
    try:
        db.clear_account_errors(account_id)
    except Exception:
        logger.debug("clear_account_errors failed", exc_info=True)
    if state is not None:
        state["last_fetched_at"] = time.time()
        state["backoff_until"] = 0
    return {"normalized": norm, "raw": payload}
