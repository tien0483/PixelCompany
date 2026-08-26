"""Antigravity account re-import scoping and email-match guard."""

import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from manager.antigravity.accounts import (
    AntigravityImportError,
    import_antigravity_account,
    reimport_antigravity_account,
)
from manager.antigravity.credentials import AntigravityCredentialStatus, AntigravityIdentity
from manager.antigravity.switching import antigravity_slot_creds_path
from manager.api.routes.auth import router
from manager.web.database import Database


def _antigravity_status(email="dev@example.com", present=True, refresh_token="refresh-1"):
    if not present:
        return AntigravityCredentialStatus(
            present=False,
            swappable=False,
            reason="not signed in",
            identity=None,
            home=__import__("pathlib").Path("/tmp/.gemini"),
        )
    return AntigravityCredentialStatus(
        present=True,
        swappable=True,
        reason=None,
        identity=AntigravityIdentity(email=email, tier="standard", project_id=None, expires_at=None),
        home=__import__("pathlib").Path("/tmp/.gemini"),
    )


def _antigravity_creds(refresh_token="refresh-1"):
    return {"access_token": "access-1", "refresh_token": refresh_token, "token_type": "Bearer"}


@pytest.fixture
def db(tmp_path):
    d = Database(str(tmp_path / "manager.db"))
    yield d
    d.close()


@pytest.fixture
def client(db):
    app = FastAPI()
    app.include_router(router, prefix="/api/auth")
    app.state.db = db
    return TestClient(app)


def test_reimport_updates_slot(db, tmp_path, monkeypatch):
    monkeypatch.setenv("GEMINI_HOME", str(tmp_path / ".gemini"))
    monkeypatch.setattr(
        "manager.antigravity.accounts.detect_antigravity_account",
        lambda *a, **k: _antigravity_status(email="dev@example.com"),
    )
    monkeypatch.setattr(
        "manager.antigravity.accounts.read_oauth_creds",
        lambda *a, **k: _antigravity_creds(refresh_token="first-token"),
    )
    acct = import_antigravity_account(db, make_active=False)

    monkeypatch.setattr(
        "manager.antigravity.accounts.read_oauth_creds",
        lambda *a, **k: _antigravity_creds(refresh_token="refreshed-token"),
    )
    updated = reimport_antigravity_account(acct["id"], db)
    assert updated["refresh_token"] == "refreshed-token"

    slot = antigravity_slot_creds_path(acct["id"], tmp_path / ".gemini")
    payload = json.loads(slot.read_text(encoding="utf-8"))
    assert payload["refresh_token"] == "refreshed-token"


def test_reimport_email_guard(db, tmp_path, monkeypatch):
    monkeypatch.setenv("GEMINI_HOME", str(tmp_path / ".gemini"))
    monkeypatch.setattr(
        "manager.antigravity.accounts.detect_antigravity_account",
        lambda *a, **k: _antigravity_status(email="stored@example.com"),
    )
    monkeypatch.setattr(
        "manager.antigravity.accounts.read_oauth_creds",
        lambda *a, **k: _antigravity_creds(),
    )
    acct = import_antigravity_account(db, make_active=False)

    monkeypatch.setattr(
        "manager.antigravity.accounts.detect_antigravity_account",
        lambda *a, **k: _antigravity_status(email="other@example.com"),
    )
    with pytest.raises(AntigravityImportError, match="signed in as"):
        reimport_antigravity_account(acct["id"], db)

    # The clicked row's stored email must not have been touched.
    assert db.get_account(acct["id"])["email"] == "stored@example.com"


def test_reimport_raises_without_identity(db, monkeypatch):
    monkeypatch.setattr(
        "manager.antigravity.accounts.detect_antigravity_account",
        lambda *a, **k: _antigravity_status(present=False),
    )
    monkeypatch.setattr(
        "manager.antigravity.accounts.read_oauth_creds",
        lambda *a, **k: _antigravity_creds(),
    )
    acct = db.create_account(
        "someone@example.com",
        "antigravity-managed",
        4102444800,
        refresh_token="r1",
        provider="antigravity",
        organization_uuid="",
    )
    with pytest.raises(AntigravityImportError):
        reimport_antigravity_account(acct["id"], db)


def test_reimport_rejects_non_antigravity_account(db):
    acct = db.create_account(
        "c@example.com",
        "claude-token",
        9999999999,
        provider="claude",
        organization_uuid="",
    )
    with pytest.raises(AntigravityImportError, match="not an Antigravity account"):
        reimport_antigravity_account(acct["id"], db)


def test_reimport_route(client, db, tmp_path, monkeypatch):
    monkeypatch.setenv("GEMINI_HOME", str(tmp_path / ".gemini"))
    monkeypatch.setattr(
        "manager.antigravity.accounts.detect_antigravity_account",
        lambda *a, **k: _antigravity_status(email="route@example.com"),
    )
    monkeypatch.setattr(
        "manager.antigravity.accounts.read_oauth_creds",
        lambda *a, **k: _antigravity_creds(),
    )
    acct = import_antigravity_account(db, make_active=False)

    resp = client.post(f"/api/auth/accounts/{acct['id']}/reimport?provider=antigravity")
    assert resp.status_code == 200
    body = resp.json()
    assert body["provider"] == "antigravity"
    assert body["email"] == "route@example.com"


def test_reimport_route_rejects_mismatched_live_account(client, db, tmp_path, monkeypatch):
    monkeypatch.setenv("GEMINI_HOME", str(tmp_path / ".gemini"))
    monkeypatch.setattr(
        "manager.antigravity.accounts.detect_antigravity_account",
        lambda *a, **k: _antigravity_status(email="seat@example.com"),
    )
    monkeypatch.setattr(
        "manager.antigravity.accounts.read_oauth_creds",
        lambda *a, **k: _antigravity_creds(),
    )
    acct = import_antigravity_account(db, make_active=False)

    monkeypatch.setattr(
        "manager.antigravity.accounts.detect_antigravity_account",
        lambda *a, **k: _antigravity_status(email="different-live@example.com"),
    )
    resp = client.post(f"/api/auth/accounts/{acct['id']}/reimport?provider=antigravity")
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "REIMPORT_FAILED"
    # The seat's row must still show its original email, not the live one.
    assert db.get_account(acct["id"])["email"] == "seat@example.com"
