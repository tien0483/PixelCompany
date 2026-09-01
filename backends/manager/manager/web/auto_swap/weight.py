"""Unified Auto seat weight scoring — mirrors ``claude-auto-seat-ranking.ts``."""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Literal

from manager.web.auto_swap.tiers import target_for_tier, tier_for

FIVE_HOUR_SATURATED_PERCENT = 90
FIVE_HOUR_IMMINENT_RESET_MINUTES = 30
NO_SEVEN_DAY_DATA_TIER = 4

AUTO_SEAT_WEIGHTS = {
    "w7d_urgency": 50.0,
    "w7d_deficit": 0.8,
    "w5h_urgency": 100.0,
    "w_donate": 18.0,
    "w_load": 15.0,
}

TAU_7D_HOURS = 48.0
TAU_5H_MINUTES = 120.0
TIER_URGENCY_BOOST = (1.0, 0.85, 0.6, 0.35)

AutoSeatPickReasonCode = Literal[
    "7d_expiring", "7d_headroom", "5h_room", "donate_headroom", "load_balance",
]


@dataclass(frozen=True)
class AutoSeatWeightResult:
    total: float
    urgency_7d: float
    deficit_7d: float
    urgency_5h: float
    headroom_5h: float
    donate_budget: float
    load_penalty: float
    dominant_reason: AutoSeatPickReasonCode


def _epoch_ms(resets_at: str | None) -> float | None:
    if not resets_at:
        return None
    try:
        dt = datetime.fromisoformat(resets_at.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.timestamp() * 1000.0
    except (ValueError, TypeError):
        return None


def _usage_pressure(account: dict) -> float:
    return max(float(account.get("cached_usage_5h") or 0), float(account.get("cached_usage_7d") or 0))


def _is_five_hour_saturated(account: dict, now) -> bool:
    usage_5h = float(account.get("cached_usage_5h") or 0)
    if usage_5h < FIVE_HOUR_SATURATED_PERCENT:
        return False
    reset_ms = _epoch_ms(account.get("cached_5h_resets_at"))
    if reset_ms is None:
        return True
    now_ms = now.timestamp() * 1000.0
    if reset_ms <= now_ms:
        return False
    minutes_left = (reset_ms - now_ms) / 60_000.0
    return minutes_left > FIVE_HOUR_IMMINENT_RESET_MINUTES


def _tier_urgency_boost(tier: int) -> float:
    if tier >= NO_SEVEN_DAY_DATA_TIER:
        return 0.1
    if 0 <= tier < len(TIER_URGENCY_BOOST):
        return TIER_URGENCY_BOOST[tier]
    return 0.1


def _compute_urgency_7d(account: dict, now) -> float:
    reset_ms = _epoch_ms(account.get("cached_7d_resets_at"))
    if reset_ms is None:
        return 0.0
    now_ms = now.timestamp() * 1000.0
    if reset_ms <= now_ms:
        return 0.0
    hours_left = (reset_ms - now_ms) / 3_600_000.0
    tier = tier_for(account, now=now)
    return math.exp(-hours_left / TAU_7D_HOURS) * _tier_urgency_boost(tier)


def _compute_deficit_7d(
    account: dict,
    now,
    *,
    active_start: str = "06:00",
    active_end: str = "23:00",
    prev_tier: int | None = None,
) -> float:
    tier = tier_for(account, now=now, prev_tier=prev_tier)
    target = target_for_tier(tier, account, now, active_start, active_end)
    if target is None:
        return 0.0
    usage_7d = float(account.get("cached_usage_7d") or 0)
    return max(0.0, target - usage_7d)


def _compute_headroom_5h(account: dict, donate_limit: float, now) -> float:
    if _is_five_hour_saturated(account, now):
        return 0.0
    cap = min(donate_limit, 100.0)
    usage_5h = float(account.get("cached_usage_5h") or 0)
    return max(0.0, cap - usage_5h)


def _compute_urgency_5h(account: dict, donate_limit: float, now) -> float:
    headroom = _compute_headroom_5h(account, donate_limit, now)
    if headroom <= 0:
        return 0.0
    headroom_norm = headroom / 100.0
    reset_ms = _epoch_ms(account.get("cached_5h_resets_at"))
    if reset_ms is None:
        return headroom_norm * 0.5
    now_ms = now.timestamp() * 1000.0
    minutes_left = (reset_ms - now_ms) / 60_000.0
    if minutes_left <= 0:
        return headroom_norm
    window_minutes = 5.0 * 60.0
    time_pressure = 1.0 - min(1.0, minutes_left / window_minutes)
    return headroom_norm * time_pressure


def _compute_donate_budget(account: dict) -> float:
    limit = float(account.get("donate_limit_percent") or 100)
    pressure = _usage_pressure(account)
    if limit <= 0 or pressure >= limit:
        return 0.0
    return (limit - pressure) / limit


def _dominant_reason(terms: dict[str, float]) -> AutoSeatPickReasonCode:
    best: AutoSeatPickReasonCode = "7d_headroom"
    best_value = float("-inf")
    for code in ("7d_expiring", "7d_headroom", "5h_room", "donate_headroom", "load_balance"):
        value = terms[code]
        if value > best_value:
            best = code  # type: ignore[assignment]
            best_value = value
    return best


def compute_auto_seat_weight(
    account: dict,
    now,
    *,
    seat_load: dict[int, int] | None = None,
    active_start: str = "06:00",
    active_end: str = "23:00",
    prev_tier: int | None = None,
) -> AutoSeatWeightResult:
    """Higher total = better Auto seat candidate."""
    donate_limit = float(account.get("donate_limit_percent") or 100)
    urgency_7d = _compute_urgency_7d(account, now)
    deficit_7d = _compute_deficit_7d(
        account, now, active_start=active_start, active_end=active_end, prev_tier=prev_tier,
    )
    headroom_5h = _compute_headroom_5h(account, donate_limit, now)
    urgency_5h = _compute_urgency_5h(account, donate_limit, now)
    donate_budget = _compute_donate_budget(account)
    account_id = account.get("id")
    load_penalty = 0.0
    if seat_load is not None and account_id is not None:
        load_penalty = float(seat_load.get(int(account_id), 0))

    terms = {
        "7d_expiring": AUTO_SEAT_WEIGHTS["w7d_urgency"] * urgency_7d,
        "7d_headroom": AUTO_SEAT_WEIGHTS["w7d_deficit"] * deficit_7d,
        "5h_room": AUTO_SEAT_WEIGHTS["w5h_urgency"] * urgency_5h,
        "donate_headroom": AUTO_SEAT_WEIGHTS["w_donate"] * donate_budget,
        "load_balance": -AUTO_SEAT_WEIGHTS["w_load"] * load_penalty,
    }
    saturated_penalty = -1000.0 if _is_five_hour_saturated(account, now) else 0.0
    tier = tier_for(account, now=now, prev_tier=prev_tier)
    no_seven_day_penalty = -50.0 if tier >= NO_SEVEN_DAY_DATA_TIER else 0.0
    total = sum(terms.values()) + saturated_penalty + no_seven_day_penalty
    return AutoSeatWeightResult(
        total=total,
        urgency_7d=urgency_7d,
        deficit_7d=deficit_7d,
        urgency_5h=urgency_5h,
        headroom_5h=headroom_5h,
        donate_budget=donate_budget,
        load_penalty=load_penalty,
        dominant_reason=_dominant_reason(terms),
    )
