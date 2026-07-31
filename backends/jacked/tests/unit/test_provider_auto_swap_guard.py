"""Guard: Cursor must never be selectable by auto-swap."""

from jacked.providers import can_auto_swap, capabilities_for
from jacked.web.auto_swap.selection import pick_best_target


def test_cursor_cannot_auto_swap():
    assert can_auto_swap("cursor") is False
    assert capabilities_for("cursor").can_auto_swap is False


def test_pick_best_target_skips_cursor_even_with_headroom():
    accounts = [
        {
            "id": 1,
            "provider": "claude",
            "is_active": 1,
            "is_deleted": 0,
            "consecutive_failures": 0,
            "validation_status": "valid",
            "cc_access_token": "tok",
            "auto_swap_enabled": 1,
            "cached_usage_5h": 95,
            "cached_usage_7d": 50,
            "cached_5h_resets_at": None,
            "cached_7d_resets_at": "2099-01-01T00:00:00Z",
        },
        {
            "id": 2,
            "provider": "cursor",
            "is_active": 1,
            "is_deleted": 0,
            "consecutive_failures": 0,
            "validation_status": "valid",
            "cc_access_token": "tok",
            "auto_swap_enabled": 1,
            "cached_usage_5h": 10,
            "cached_usage_7d": 10,
            "cached_5h_resets_at": None,
            "cached_7d_resets_at": "2099-01-02T00:00:00Z",
        },
    ]
    # Current is the exhausted Claude account; Cursor looks better on paper
    # but must be filtered by the provider capability gate.
    best = pick_best_target(accounts, current_id=1)
    assert best is None or best.get("provider") != "cursor"
