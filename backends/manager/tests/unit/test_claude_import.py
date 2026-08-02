"""Import the Claude Code CLI-authenticated account as a Seat.

Covers import_claude_cli_account (reads the live credential as-is, resolves
identity via a read-only profile lookup, persists provider='claude') and the
POST /accounts/add?provider=claude&import_local=true route (import vs
needs_login). Uses asyncio.run() wrappers (project convention — no
pytest-asyncio).
"""

import asyncio

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from manager.api import claude_import
from manager.api.claude_import import ClaudeImportError, import_claude_cli_account
from manager.api.routes.auth import router
from manager.web.database import Database

_LOCAL_OAUTH = {
    "accessToken": "local-access-token",
    "refreshToken": "local-refresh-token",
    "expiresAt": 9999999999000,  # milliseconds
    "scopes": ["user:inference"],
    "subscriptionType": "pro",
}

_PROFILE = {
    "account": {"email_address": "dev@example.com", "display_name": "Dev"},
    "organization": {
        "uuid": "org-123",
        "name": "Acme",
        "organization_type": "",
        "rate_limit_tier": "tier-2",
    },
}

_USAGE = {"five_hour": {"utilization": 0.25, "resets_at": "2026-01-01T00:00:00Z"}}


def _patch_local(monkeypatch, oauth=_LOCAL_OAUTH, profile=_PROFILE, usage=_USAGE):
    monkeypatch.setattr(claude_import, "_read_local_oauth", lambda: oauth)

    async def fake_fetch(_client, url, _token):
        if url == claude_import.PROFILE_URL:
            return profile
        return usage

    monkeypatch.setattr(claude_import, "_fetch_json", fake_fetch)


@pytest.fixture
def db(tmp_path):
    d = Database(str(tmp_path / "manager.db"))
    yield d
    d.close()


def test_import_persists_claude_row(db, monkeypatch):
    _patch_local(monkeypatch)
    acct = asyncio.run(import_claude_cli_account(db))
    assert acct["provider"] == "claude"
    assert acct["email"] == "dev@example.com"
    assert acct["organization_uuid"] == "org-123"
    assert acct["organization_name"] == "Acme"
    assert acct["validation_status"] == "valid"


def test_import_stores_local_tokens_verbatim(db, monkeypatch):
    """We do NOT mint tokens — the stored access/refresh are the local ones."""
    _patch_local(monkeypatch)
    acct = asyncio.run(import_claude_cli_account(db))
    assert acct["access_token"] == "local-access-token"
    assert acct["refresh_token"] == "local-refresh-token"


def test_import_converts_ms_expiry_to_seconds(db, monkeypatch):
    _patch_local(monkeypatch)
    acct = asyncio.run(import_claude_cli_account(db))
    assert acct["expires_at"] == 9999999999  # ms // 1000


def test_reimport_updates_no_duplicate(db, monkeypatch):
    _patch_local(monkeypatch)
    first = asyncio.run(import_claude_cli_account(db))
    second = asyncio.run(import_claude_cli_account(db))
    assert first["id"] == second["id"]
    claude_rows = [a for a in db.list_accounts() if a["provider"] == "claude"]
    assert len(claude_rows) == 1


def test_import_raises_without_login(db, monkeypatch):
    monkeypatch.setattr(claude_import, "_read_local_oauth", lambda: None)
    with pytest.raises(ClaudeImportError):
        asyncio.run(import_claude_cli_account(db))


def test_import_raises_when_profile_has_no_email(db, monkeypatch):
    _patch_local(monkeypatch, profile={})
    with pytest.raises(ClaudeImportError):
        asyncio.run(import_claude_cli_account(db))


def test_make_active_sets_claude_active(db, monkeypatch):
    _patch_local(monkeypatch)
    acct = asyncio.run(import_claude_cli_account(db, make_active=True))
    assert db.get_active_account_id("claude") == acct["id"]


# --------------------------------------------------------------------------
# POST /accounts/add?provider=claude&import_local=true route
# --------------------------------------------------------------------------


@pytest.fixture
def client(db):
    app = FastAPI()
    app.include_router(router, prefix="/api/auth")
    app.state.db = db
    return TestClient(app)


def test_route_imports_claude_account(client, db, monkeypatch):
    _patch_local(monkeypatch)
    resp = client.post("/api/auth/accounts/add?provider=claude&import_local=true")
    assert resp.status_code == 200
    body = resp.json()
    assert body["provider"] == "claude"
    assert body["imported"] is True
    assert body["email"] == "dev@example.com"
    claude = [a for a in db.list_accounts() if a["provider"] == "claude"]
    assert len(claude) == 1


def test_route_needs_login_when_absent(client, monkeypatch):
    monkeypatch.setattr(claude_import, "_read_local_oauth", lambda: None)
    resp = client.post("/api/auth/accounts/add?provider=claude&import_local=true")
    assert resp.status_code == 400
    body = resp.json()
    assert body["needs_login"] is True
    assert body["error"]["code"] == "CLAUDE_LOGIN_REQUIRED"
