"""Antigravity / Gemini Code Assist quota via cloudcode-pa.googleapis.com.

Two pools exist for the same Google account:

* **Antigravity** — ``ideType=ANTIGRAVITY``, ``pluginType=ANTIGRAVITY``
* **Gemini CLI** — ``ideType=GEMINI_CLI``, ``pluginType=GEMINI``

Both are fetched when possible. Mapping onto jacked's cache columns:

* ``five_hour``  ← worst (highest used %) Pro-like model across both pools
* ``seven_day``  ← worst Flash-like model across both pools

If only one model family reports, its used % lands in ``five_hour`` and
``seven_day`` is cleared so a stale Flash reading cannot linger.
"""

from __future__ import annotations

import logging
import time
from typing import Mapping, Optional

import httpx

from manager.service.menubar_summary import _epoch_to_iso

from .credentials import gemini_home
from .switching import mint_live_token

logger = logging.getLogger(__name__)

_CODE_ASSIST = "https://cloudcode-pa.googleapis.com/v1internal"
_POOLS = (
    {"ideType": "ANTIGRAVITY", "pluginType": "ANTIGRAVITY", "name": "antigravity"},
    {"ideType": "GEMINI_CLI", "pluginType": "GEMINI", "name": "gemini_cli"},
)


class AntigravityUsageError(Exception):
    """Quota fetch failed (auth, network, or empty payload)."""


def _is_pro_model(model_id: str) -> bool:
    lower = model_id.lower()
    return "pro" in lower and "flash" not in lower


def _is_flash_model(model_id: str) -> bool:
    return "flash" in model_id.lower()


def _bucket_used_percent(bucket: dict) -> Optional[float]:
    """Convert a quota bucket to used-percent 0-100.

    ``remainingAmount`` is omitted when the pool is full, so
    ``remainingFraction`` is the authoritative signal.
    """
    frac = bucket.get("remainingFraction")
    if isinstance(frac, (int, float)):
        used = (1.0 - float(frac)) * 100.0
        return max(0.0, min(100.0, used))
    remaining = bucket.get("remainingAmount")
    limit = bucket.get("limit") or bucket.get("totalAmount")
    try:
        rem_f = float(remaining) if remaining is not None else None
        lim_f = float(limit) if limit is not None else None
    except (TypeError, ValueError):
        return None
    if rem_f is None or lim_f is None or lim_f <= 0:
        return None
    return max(0.0, min(100.0, (1.0 - rem_f / lim_f) * 100.0))


def _parse_buckets(payload: dict) -> list[dict]:
    buckets = payload.get("buckets") or payload.get("quota") or []
    if isinstance(payload.get("quotas"), list):
        buckets = payload["quotas"]
    if not isinstance(buckets, list):
        return []
    parsed: list[dict] = []
    for bucket in buckets:
        if not isinstance(bucket, dict):
            continue
        model_id = bucket.get("modelId") or bucket.get("model") or ""
        if not isinstance(model_id, str) or len(model_id) == 0:
            continue
        used = _bucket_used_percent(bucket)
        if used is None:
            continue
        reset = bucket.get("resetTime") or bucket.get("resetsAt")
        parsed.append({
            "model_id": model_id,
            "used_percent": used,
            "reset_time": reset if isinstance(reset, str) else None,
            "is_pro": _is_pro_model(model_id),
            "is_flash": _is_flash_model(model_id),
        })
    return parsed


async def _post_json(
    client: httpx.AsyncClient, url: str, token: str, body: dict
) -> Optional[dict]:
    resp = await client.post(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        json=body,
    )
    if resp.status_code >= 400:
        logger.debug("Code Assist %s -> HTTP %s", url, resp.status_code)
        return None
    data = resp.json()
    return data if isinstance(data, dict) else None


async def _fetch_pool(
    client: httpx.AsyncClient, token: str, pool: dict
) -> dict:
    """Return ``{name, project_id, tier, buckets}`` for one Code Assist pool."""
    load = await _post_json(
        client,
        f"{_CODE_ASSIST}:loadCodeAssist",
        token,
        {"metadata": {"ideType": pool["ideType"], "pluginType": pool["pluginType"]}},
    )
    project_id = None
    tier = None
    if load is not None:
        if isinstance(load.get("cloudaicompanionProject"), str):
            project_id = load["cloudaicompanionProject"]
        current = load.get("currentTier")
        if isinstance(current, dict):
            tier = current.get("id") or current.get("name")
        paid = load.get("paidTier")
        if tier is None and isinstance(paid, dict):
            tier = paid.get("name")
    body: dict = {}
    if isinstance(project_id, str) and len(project_id) > 0:
        body["project"] = project_id
    quota = await _post_json(
        client, f"{_CODE_ASSIST}:retrieveUserQuota", token, body
    )
    buckets = _parse_buckets(quota or {})
    return {
        "name": pool["name"],
        "project_id": project_id if isinstance(project_id, str) else None,
        "tier": tier if isinstance(tier, str) else None,
        "buckets": buckets,
    }


def normalize_pools(pools: list[dict]) -> dict:
    """Collapse dual-pool bucket lists into five_hour / seven_day slots."""
    all_buckets: list[dict] = []
    for pool in pools:
        all_buckets.extend(pool.get("buckets") or [])
    pro = [b for b in all_buckets if b.get("is_pro")]
    flash = [b for b in all_buckets if b.get("is_flash")]
    other = [b for b in all_buckets if not b.get("is_pro") and not b.get("is_flash")]

    def worst(group: list[dict]) -> Optional[dict]:
        if len(group) == 0:
            return None
        return max(group, key=lambda b: b["used_percent"])

    five = worst(pro) or worst(other)
    seven = worst(flash)
    if five is None and seven is not None:
        five = seven
        seven = None
    return {
        "five_hour": {
            "utilization": five["used_percent"] if five else None,
            "resets_at": five.get("reset_time") if five else None,
            "reported": five is not None,
        },
        "seven_day": {
            "utilization": seven["used_percent"] if seven else None,
            "resets_at": seven.get("reset_time") if seven else None,
            "reported": seven is not None,
        },
        "pools": pools,
    }


async def fetch_antigravity_usage(
    account_id: int,
    db,
    state: Optional[dict] = None,
    home=None,
    env: Optional[Mapping[str, str]] = None,
) -> Optional[dict]:
    """Fetch + normalize + cache Antigravity/Gemini quota for ``account_id``."""
    home = home or gemini_home(env)
    try:
        from .credentials import refresh_access_token, write_oauth_creds
        from .switching import _load_slot_or_db_creds, seed_antigravity_slot

        creds = _load_slot_or_db_creds(account_id, db, home, env)
        expiry_ms = creds.get("expiry_date")
        now_ms = int(time.time() * 1000)
        needs_refresh = (
            not isinstance(creds.get("access_token"), str)
            or not isinstance(expiry_ms, (int, float))
            or expiry_ms <= now_ms + 120 * 1000
        )
        if needs_refresh:
            creds = refresh_access_token(creds, env)
            seed_antigravity_slot(account_id, creds, home=home, env=env)
            active_id = db.get_active_account_id(provider="antigravity")
            if active_id == account_id:
                write_oauth_creds(creds, home, env)
    except Exception as exc:
        logger.warning("Antigravity usage auth failed for %s: %s", account_id, exc)
        try:
            db.record_account_error(account_id, str(exc))
        except Exception:
            logger.debug("record_account_error failed", exc_info=True)
        return None
    token = creds.get("access_token")
    if not isinstance(token, str) or len(token) == 0:
        return None

    pools: list[dict] = []
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            for pool in _POOLS:
                try:
                    pools.append(await _fetch_pool(client, token, pool))
                except Exception:
                    logger.debug("pool %s failed", pool["name"], exc_info=True)
    except Exception as exc:
        logger.warning("Antigravity usage transport failed for %s: %s", account_id, exc)
        try:
            db.record_account_error(account_id, str(exc))
        except Exception:
            logger.debug("record_account_error failed", exc_info=True)
        return None

    norm = normalize_pools(pools)
    five = norm["five_hour"]
    seven = norm["seven_day"]

    db.update_account_usage_cache(
        account_id,
        five_hour=five["utilization"],
        seven_day=seven["utilization"],
        five_hour_resets_at=(
            five["resets_at"] if five["utilization"] is not None else None
        ),
        seven_day_resets_at=(
            seven["resets_at"] if seven["utilization"] is not None else None
        ),
        clear_five_hour=not five["reported"],
        clear_seven_day=not seven["reported"],
        raw={"pools": pools, "fetched_at": int(time.time())},
    )
    # Surface a tier label when loadCodeAssist reported one.
    for pool in pools:
        tier = pool.get("tier")
        if isinstance(tier, str) and len(tier) > 0:
            try:
                acct = db.get_account(account_id)
                if acct and acct.get("subscription_type") != tier:
                    db.update_account(account_id, subscription_type=tier)
            except Exception:
                logger.debug("antigravity tier sync failed", exc_info=True)
            break
    try:
        db.clear_account_errors(account_id)
    except Exception:
        logger.debug("clear_account_errors failed", exc_info=True)
    if state is not None:
        state["last_fetched_at"] = time.time()
        state["backoff_until"] = 0
    # Keep menubar happy with an iso-friendly shape if resets_at is epoch-like.
    _ = _epoch_to_iso
    return {"pools": pools, "normalized": norm}
