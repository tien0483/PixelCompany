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
