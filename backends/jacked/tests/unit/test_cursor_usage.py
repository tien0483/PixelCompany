"""Cursor usage fetch prefers seat-slot token over live IDE auth."""

from __future__ import annotations

import asyncio
from unittest.mock import MagicMock


def test_fetch_cursor_usage_prefers_slot_token(monkeypatch):
    from jacked.cursor import usage as usage_mod

    calls: list[str] = []

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
                "startOfMonth": "2099-01-01T00:00:00.000Z",
                "gpt-4": {"numRequests": 10, "maxRequestUsage": 100},
                "gpt-3.5-turbo": {"numRequests": 20, "maxRequestUsage": 200},
            }

    class _Client:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def get(self, url, headers=None, **kwargs):
            calls.append(headers.get("Authorization", ""))
            return _Resp()

    monkeypatch.setattr(usage_mod.httpx, "AsyncClient", _Client)

    db = MagicMock()
    result = asyncio.run(usage_mod.fetch_cursor_usage(7, db))
    assert result is not None
    assert calls == ["Bearer slot-token"]
    db.update_account_usage_cache.assert_called_once()
    db.clear_account_errors.assert_called_once_with(7)


def test_fetch_cursor_usage_falls_back_to_live_token(monkeypatch):
    from jacked.cursor import usage as usage_mod

    calls: list[str] = []

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

    class _Resp:
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

        async def get(self, url, headers=None, **kwargs):
            calls.append(headers.get("Authorization", ""))
            return _Resp()

    monkeypatch.setattr(usage_mod.httpx, "AsyncClient", _Client)

    db = MagicMock()
    result = asyncio.run(usage_mod.fetch_cursor_usage(3, db))
    assert result is not None
    assert calls == ["Bearer live-token"]


def test_cursor_access_token_empty_slot_falls_through(monkeypatch):
    from jacked.cursor import usage as usage_mod

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
