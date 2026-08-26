"""Antigravity oauth_creds write preserves unknown fields and mode."""

from __future__ import annotations

import json
import os
import stat
from pathlib import Path

from manager.antigravity.credentials import refresh_access_token, write_oauth_creds


def test_write_oauth_creds_preserves_unknown_fields_and_mode(tmp_path: Path, monkeypatch):
    home = tmp_path / ".gemini"
    home.mkdir()
    path = home / "oauth_creds.json"
    original = {
        "access_token": "a1",
        "refresh_token": "r1",
        "extra_cli_field": {"nested": True},
        "gemini_only": "keep-me",
    }
    path.write_text(json.dumps(original), encoding="utf-8")
    os.chmod(path, 0o640)

    monkeypatch.setenv("HOME", str(tmp_path))
    # gemini_home reads HOME / .gemini on unix; force via env map if needed
    updated = dict(original)
    updated["access_token"] = "a2"
    write_oauth_creds(updated, home=home)

    data = json.loads(path.read_text(encoding="utf-8"))
    assert data["access_token"] == "a2"
    assert data["extra_cli_field"] == {"nested": True}
    assert data["gemini_only"] == "keep-me"
    mode = stat.S_IMODE(path.stat().st_mode)
    # On Windows chmod may not stick; assert best-effort when unix-like.
    if os.name != "nt":
        assert mode == 0o640


def test_refresh_access_token_merges_unknown_fields(monkeypatch):
    creds = {
        "access_token": "old",
        "refresh_token": "refresh",
        "custom_field": 42,
    }

    class FakeResp:
        status_code = 200

        def json(self):
            return {
                "access_token": "new",
                "expires_in": 3600,
                "token_type": "Bearer",
            }

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def post(self, *args, **kwargs):
            return FakeResp()

    monkeypatch.setattr("manager.antigravity.credentials.httpx.Client", FakeClient)
    merged = refresh_access_token(creds)
    assert merged["access_token"] == "new"
    assert merged["custom_field"] == 42
    assert merged["refresh_token"] == "refresh"


import pytest


def test_antigravity_pool_uses_antigravity_plugin_type():
    from manager.antigravity.usage import _POOLS

    by_name = {pool["name"]: pool for pool in _POOLS}
    assert by_name["antigravity"]["pluginType"] == "ANTIGRAVITY"
    assert by_name["gemini_cli"]["pluginType"] == "GEMINI"


@pytest.mark.anyio
async def test_fetch_antigravity_usage_loads_account_slot(tmp_path: Path, monkeypatch):
    from manager.antigravity.switching import seed_antigravity_slot
    from manager.antigravity.usage import fetch_antigravity_usage

    home = tmp_path / ".gemini"
    home.mkdir()
    account_id = 42
    creds = {
        "access_token": "valid-token",
        "refresh_token": "ref-42",
        "expiry_date": 9999999999999,
    }
    seed_antigravity_slot(account_id, creds, home=home)

    class FakeDb:
        def __init__(self):
            self.cached = None
            self.active_id = 42

        def get_account(self, aid):
            return {"id": aid, "provider": "antigravity", "refresh_token": "ref-42"}

        def get_active_account_id(self, provider="antigravity"):
            return self.active_id

        def update_account_usage_cache(self, aid, **kwargs):
            self.cached = (aid, kwargs)

        def clear_account_errors(self, aid):
            pass

        def update_account(self, aid, **kwargs):
            pass

    async def fake_fetch_pool(client, token, pool):
        assert token == "valid-token"
        return {
            "name": pool["name"],
            "project_id": "test-project",
            "tier": "STANDARD",
            "buckets": [
                {
                    "model_id": "gemini-2.5-pro",
                    "used_percent": 25.0,
                    "is_pro": True,
                    "is_flash": False,
                    "reset_time": "2026-08-22T15:00:00Z",
                }
            ],
        }

    monkeypatch.setattr("manager.antigravity.usage._fetch_pool", fake_fetch_pool)
    db = FakeDb()
    result = await fetch_antigravity_usage(account_id, db, home=home)
    assert result is not None
    assert db.cached is not None
    assert db.cached[0] == 42
    assert db.cached[1]["five_hour"] == 25.0

