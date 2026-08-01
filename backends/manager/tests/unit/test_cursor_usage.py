"""Cursor usage prefers seat-slot token and DashboardService period usage."""

from __future__ import annotations

import asyncio
from unittest.mock import MagicMock


def test_normalize_period_usage_maps_cursor_and_other_models():
    from manager.cursor.usage import normalize_cursor_usage

    norm = normalize_cursor_usage(
        {
            "billingCycleEnd": "1787985945000",
            "planUsage": {
                "autoPercentUsed": 80.41,
                "apiPercentUsed": 100,
                "totalPercentUsed": 83.0,
            },
        }
    )
    assert norm["five_hour"]["utilization"] == 80.41
    assert norm["seven_day"]["utilization"] == 100.0
    assert norm["five_hour"]["resets_at"] == "2026-08-29T06:45:45Z"
    assert norm["seven_day"]["resets_at"] == "2026-08-29T06:45:45Z"
    assert norm["five_hour"]["reported"] is True
    assert norm["seven_day"]["reported"] is True


def test_normalize_legacy_usage_still_works():
    from manager.cursor.usage import normalize_cursor_usage

    norm = normalize_cursor_usage(
        {
            "startOfMonth": "2099-01-01T00:00:00.000Z",
            "gpt-4": {"numRequests": 10, "maxRequestUsage": 100},
            "gpt-3.5-turbo": {"numRequests": 20, "maxRequestUsage": 200},
        }
    )
    assert norm["five_hour"]["utilization"] == 10.0
    assert norm["seven_day"]["utilization"] == 10.0


def test_normalize_legacy_null_limits_is_empty():
    from manager.cursor.usage import normalize_cursor_usage

    norm = normalize_cursor_usage(
        {
            "startOfMonth": "2026-07-29T06:45:45.000Z",
            "gpt-4": {
                "numRequests": 0,
                "numRequestsTotal": 0,
                "maxRequestUsage": None,
            },
        }
    )
    assert norm["five_hour"]["utilization"] is None
    assert norm["seven_day"]["utilization"] is None


def test_fetch_cursor_usage_prefers_slot_token_and_period_endpoint(monkeypatch):
    from manager.cursor import usage as usage_mod

    posts: list[str] = []
    gets: list[str] = []

    monkeypatch.setattr(
        usage_mod,
        "read_cursor_slot_auth",
        lambda _account_id, _env=None: {"access_token": "slot-token"},
    )
    monkeypatch.setattr(
        usage_mod,
        "read_cursor_auth",
        lambda *_a, **_k: {"access_token": "live-token"},
    )

    class _Resp:
        status_code = 200

        def json(self):
            return {
                "billingCycleEnd": "1787985945000",
                "planUsage": {"autoPercentUsed": 80.0, "apiPercentUsed": 100.0},
            }

    class _Client:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, url, headers=None, content=None, **kwargs):
            posts.append(headers.get("Authorization", ""))
            assert "GetCurrentPeriodUsage" in url
            assert headers.get("Authorization") == "Bearer slot-token"
            return _Resp()

        async def get(self, url, headers=None, **kwargs):
            gets.append(url)
            raise AssertionError("legacy GET should not run when period usage parses")

    monkeypatch.setattr(usage_mod.httpx, "AsyncClient", _Client)

    db = MagicMock()
    result = asyncio.run(usage_mod.fetch_cursor_usage(7, db))
    assert result is not None
    assert posts == ["Bearer slot-token"]
    assert gets == []
    db.update_account_usage_cache.assert_called_once()
    db.clear_account_errors.assert_called_once_with(7)


def test_fetch_cursor_usage_falls_back_to_legacy_when_period_empty(monkeypatch):
    from manager.cursor import usage as usage_mod

    monkeypatch.setattr(
        usage_mod,
        "read_cursor_slot_auth",
        lambda *_a, **_k: None,
    )
    monkeypatch.setattr(
        usage_mod,
        "read_cursor_auth",
        lambda *_a, **_k: {"access_token": "live-token"},
    )

    class _PeriodResp:
        status_code = 200

        def json(self):
            return {"planUsage": {}}

    class _LegacyResp:
        status_code = 200

        def json(self):
            return {"gpt-4": {"numRequests": 5, "maxRequestUsage": 50}}

    class _Client:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, url, headers=None, content=None, **kwargs):
            return _PeriodResp()

        async def get(self, url, headers=None, **kwargs):
            assert headers.get("Authorization") == "Bearer live-token"
            return _LegacyResp()

    monkeypatch.setattr(usage_mod.httpx, "AsyncClient", _Client)

    db = MagicMock()
    result = asyncio.run(usage_mod.fetch_cursor_usage(3, db))
    assert result is not None
    assert result["normalized"]["five_hour"]["utilization"] == 10.0


def test_cursor_access_token_empty_slot_falls_through(monkeypatch):
    from manager.cursor import usage as usage_mod

    monkeypatch.setattr(
        usage_mod,
        "read_cursor_slot_auth",
        lambda *_a, **_k: {"access_token": "   "},
    )
    monkeypatch.setattr(
        usage_mod,
        "read_cursor_auth",
        lambda *_a, **_k: {"access_token": "live-token"},
    )
    assert usage_mod._cursor_access_token(1) == "live-token"
