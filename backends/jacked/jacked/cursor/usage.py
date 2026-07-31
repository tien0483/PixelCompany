"""Cursor usage via api2.cursor.sh/auth/usage.

Reads the access token from the live state.vscdb (read-only) and normalizes
the response onto jacked's five_hour / seven_day cache columns:

* ``five_hour``  ← start-of-month / fast-request / premium short window
* ``seven_day``  ← billing-cycle / slow-request / monthly window

Exact field names vary across Cursor builds; every lookup is defensive.
"""

from __future__ import annotations

import logging
import time
from typing import Mapping, Optional

import httpx

from .credentials import cursor_state_db_path, read_cursor_auth

logger = logging.getLogger(__name__)

_USAGE_URL = "https://api2.cursor.sh/auth/usage"
_USER_AGENT = "Cursor/0.50.0"


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


def _first_number(source: dict, keys: tuple[str, ...]) -> Optional[float]:
    for key in keys:
        value = source.get(key)
        if isinstance(value, (int, float)):
            return float(value)
        if isinstance(value, dict):
            nested = _first_number(
                value,
                ("used", "usage", "numRequests", "numRequestsTotal", "percentage", "percentUsed"),
            )
            if nested is not None:
                return nested
    return None


def normalize_cursor_usage(payload: dict) -> dict:
    """Map a Cursor usage payload onto five_hour / seven_day slots."""
    # Common shapes observed across Cursor builds.
    gpt4 = payload.get("gpt-4") or payload.get("gpt4") or payload.get("premium") or {}
    start = payload.get("startOfMonth") or payload.get("start_of_month")
    if not isinstance(gpt4, dict):
        gpt4 = {}

    used = _first_number(gpt4, ("numRequestsTotal", "numRequests", "used", "usage"))
    limit = _first_number(gpt4, ("maxRequestUsage", "maxRequests", "limit", "total"))
    five = _as_percent(used, limit) if used is not None and limit is not None else None
    if five is None and isinstance(gpt4.get("percentage"), (int, float)):
        five = max(0.0, min(100.0, float(gpt4["percentage"])))

    # Monthly / slow pool
    slow = payload.get("gpt-3.5-turbo") or payload.get("gpt35") or payload.get("slow") or {}
    if not isinstance(slow, dict):
        slow = {}
    used7 = _first_number(slow, ("numRequestsTotal", "numRequests", "used", "usage"))
    limit7 = _first_number(slow, ("maxRequestUsage", "maxRequests", "limit", "total"))
    seven = _as_percent(used7, limit7) if used7 is not None and limit7 is not None else None

    # Some builds expose a single `usage` percent — treat it as five_hour.
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


async def fetch_cursor_usage(
    account_id: int,
    db,
    state: Optional[dict] = None,
    db_path=None,
    env: Optional[Mapping[str, str]] = None,
) -> Optional[dict]:
    """Fetch + normalize + cache Cursor usage for ``account_id``."""
    auth = read_cursor_auth(db_path or cursor_state_db_path(env), env)
    if auth is None or not isinstance(auth.get("access_token"), str):
        try:
            db.record_account_error(account_id, "no Cursor access token in state.vscdb")
        except Exception:
            logger.debug("record_account_error failed", exc_info=True)
        return None
    token = auth["access_token"]
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.get(
                _USAGE_URL,
                headers={
                    "Authorization": f"Bearer {token}",
                    "User-Agent": _USER_AGENT,
                    "Accept": "application/json",
                },
            )
    except Exception as exc:
        logger.warning("Cursor usage transport failed for %s: %s", account_id, exc)
        try:
            db.record_account_error(account_id, str(exc))
        except Exception:
            logger.debug("record_account_error failed", exc_info=True)
        return None

    if resp.status_code >= 400:
        msg = f"Cursor usage HTTP {resp.status_code}"
        logger.warning("%s for account %s", msg, account_id)
        try:
            db.record_account_error(account_id, msg)
        except Exception:
            logger.debug("record_account_error failed", exc_info=True)
        return None

    try:
        payload = resp.json()
    except ValueError:
        return None
    if not isinstance(payload, dict):
        return None

    norm = normalize_cursor_usage(payload)
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
        seven_day_resets_at=None,
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
