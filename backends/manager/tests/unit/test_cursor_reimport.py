"""Cursor account re-import, validate, refresh, and route guards."""

import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from manager.api.routes.auth import router
from manager.cursor.accounts import (
    CursorImportError,
    CursorReimportError,
    cursor_account_slot,
    import_cursor_account,
    reimport_cursor_account,
)
from manager.cursor.credentials import CursorCredentialStatus, CursorIdentity
from manager.web.database import Database


def _cursor_status(email="dev@cursor.com", present=True):
    if not present:
        return CursorCredentialStatus(
            present=False,
            swappable=False,
            reason="not signed in",
            identity=None,
            db_path=__import__("pathlib").Path("/tmp/state.vscdb"),
        )
    return CursorCredentialStatus(
        present=True,
        swappable=True,
        reason=None,
        identity=CursorIdentity(
            email=email,
            membership_type="pro",
            has_access_token=True,
        ),
        db_path=__import__("pathlib").Path("/tmp/state.vscdb"),
    )


def _cursor_auth(email="dev@cursor.com", token="cursor-access-token"):
    return {
        "access_token": token,
        "refresh_token": "cursor-refresh-token",
        "email": email,
        "membership_type": "pro",
    }


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


def test_import_persists_cursor_row(db, tmp_path, monkeypatch):
    monkeypatch.setenv("CURSOR_JACKED_HOME", str(tmp_path / ".cursor-jacked"))
    monkeypatch.setattr(
        "manager.cursor.accounts.detect_cursor_account",
        lambda *a, **k: _cursor_status(),
    )
    monkeypatch.setattr(
        "manager.cursor.accounts.read_cursor_auth",
        lambda *a, **k: _cursor_auth(),
    )
    acct = import_cursor_account(db, make_active=False)
    assert acct["provider"] == "cursor"
    assert acct["email"] == "dev@cursor.com"
    slot = cursor_account_slot(acct["id"], {"CURSOR_JACKED_HOME": str(tmp_path / ".cursor-jacked")})
    assert slot.is_file()
    payload = json.loads(slot.read_text(encoding="utf-8"))
    assert payload["access_token"] == "cursor-access-token"


def test_reimport_updates_slot(db, tmp_path, monkeypatch):
    monkeypatch.setenv("CURSOR_JACKED_HOME", str(tmp_path / ".cursor-jacked"))
    monkeypatch.setattr(
        "manager.cursor.accounts.detect_cursor_account",
        lambda *a, **k: _cursor_status(),
    )
    monkeypatch.setattr(
        "manager.cursor.accounts.read_cursor_auth",
        lambda *a, **k: _cursor_auth(token="first-token"),
    )
    acct = import_cursor_account(db, make_active=False)
    monkeypatch.setattr(
        "manager.cursor.accounts.read_cursor_auth",
        lambda *a, **k: _cursor_auth(token="refreshed-token"),
    )
    updated = reimport_cursor_account(acct["id"], db)
    assert updated["validation_status"] == "valid"
    slot = cursor_account_slot(acct["id"], {"CURSOR_JACKED_HOME": str(tmp_path / ".cursor-jacked")})
    payload = json.loads(slot.read_text(encoding="utf-8"))
    assert payload["access_token"] == "refreshed-token"


def test_reimport_email_guard(db, tmp_path, monkeypatch):
    monkeypatch.setenv("CURSOR_JACKED_HOME", str(tmp_path / ".cursor-jacked"))
    monkeypatch.setattr(
        "manager.cursor.accounts.detect_cursor_account",
        lambda *a, **k: _cursor_status(email="stored@cursor.com"),
    )
    monkeypatch.setattr(
        "manager.cursor.accounts.read_cursor_auth",
        lambda *a, **k: _cursor_auth(email="stored@cursor.com"),
    )
    acct = import_cursor_account(db, make_active=False)
    monkeypatch.setattr(
        "manager.cursor.accounts.detect_cursor_account",
        lambda *a, **k: _cursor_status(email="other@cursor.com"),
    )
    monkeypatch.setattr(
        "manager.cursor.accounts.read_cursor_auth",
        lambda *a, **k: _cursor_auth(email="other@cursor.com"),
    )
    with pytest.raises(CursorReimportError, match="signed in as"):
        reimport_cursor_account(acct["id"], db)


def test_import_raises_without_identity(db, monkeypatch):
    monkeypatch.setattr(
        "manager.cursor.accounts.detect_cursor_account",
        lambda *a, **k: _cursor_status(present=False),
    )
    with pytest.raises(CursorImportError):
        import_cursor_account(db)


def test_validate_cursor_uses_slot_not_anthropic(db, tmp_path, monkeypatch):
    import asyncio

    from manager.web.auth import validate_account

    monkeypatch.setenv("CURSOR_JACKED_HOME", str(tmp_path / ".cursor-jacked"))
    acct = db.create_account(
        "v@cursor.com",
        "cursor-managed",
        4102444800,
        provider="cursor",
        organization_uuid="",
    )
    db.update_account(acct["id"], validation_status="invalid")
    slot = cursor_account_slot(acct["id"])
    slot.parent.mkdir(parents=True, exist_ok=True)
    slot.write_text(json.dumps(_cursor_auth(email="v@cursor.com")))

    res = asyncio.run(validate_account(acct["id"], db))
    assert res["valid"] is True
    assert db.get_account(acct["id"])["validation_status"] == "valid"


def test_validate_cursor_signed_out_is_invalid(db, tmp_path, monkeypatch):
    import asyncio

    from manager.web.auth import validate_account

    monkeypatch.setenv("CURSOR_JACKED_HOME", str(tmp_path / ".cursor-jacked"))
    acct = db.create_account(
        "o@cursor.com",
        "cursor-managed",
        4102444800,
        provider="cursor",
        organization_uuid="",
    )
    res = asyncio.run(validate_account(acct["id"], db))
    assert res["valid"] is False
    assert db.get_account(acct["id"])["validation_status"] == "invalid"


def test_reimport_route(client, db, tmp_path, monkeypatch):
    monkeypatch.setenv("CURSOR_JACKED_HOME", str(tmp_path / ".cursor-jacked"))
    monkeypatch.setattr(
        "manager.cursor.accounts.detect_cursor_account",
        lambda *a, **k: _cursor_status(email="route@cursor.com"),
    )
    monkeypatch.setattr(
        "manager.cursor.accounts.read_cursor_auth",
        lambda *a, **k: _cursor_auth(email="route@cursor.com"),
    )
    acct = import_cursor_account(db, make_active=False)
    resp = client.post(f"/api/auth/accounts/{acct['id']}/reimport?provider=cursor")
    assert resp.status_code == 200
    body = resp.json()
    assert body["provider"] == "cursor"
    assert body["email"] == "route@cursor.com"
    assert body["is_active_for_provider"] is False


def test_reauth_route_rejects_cursor(client, db):
    acct = db.create_account(
        "r@cursor.com",
        "cursor-managed",
        4102444800,
        provider="cursor",
        organization_uuid="",
    )
    resp = client.post(f"/api/auth/accounts/{acct['id']}/reauth")
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "CURSOR_NOT_OAUTH"


def test_refresh_route_reimports_cursor(client, db, tmp_path, monkeypatch):
    monkeypatch.setenv("CURSOR_JACKED_HOME", str(tmp_path / ".cursor-jacked"))
    monkeypatch.setattr(
        "manager.cursor.accounts.detect_cursor_account",
        lambda *a, **k: _cursor_status(email="refresh@cursor.com"),
    )
    monkeypatch.setattr(
        "manager.cursor.accounts.read_cursor_auth",
        lambda *a, **k: _cursor_auth(email="refresh@cursor.com", token="new-token"),
    )
    acct = import_cursor_account(db, make_active=False)
    db.update_account(acct["id"], validation_status="invalid")
    resp = client.post(f"/api/auth/accounts/{acct['id']}/refresh")
    assert resp.status_code == 200
    assert db.get_account(acct["id"])["validation_status"] == "valid"


def test_launch_credential_route_returns_api_key(client, db, tmp_path, monkeypatch):
    monkeypatch.setenv("CURSOR_JACKED_HOME", str(tmp_path / ".cursor-jacked"))
    monkeypatch.setattr(
        "manager.cursor.accounts.detect_cursor_account",
        lambda *a, **k: _cursor_status(email="launch@cursor.com"),
    )
    monkeypatch.setattr(
        "manager.cursor.accounts.read_cursor_auth",
        lambda *a, **k: _cursor_auth(email="launch@cursor.com", token="launch-key"),
    )
    acct = import_cursor_account(db, make_active=False)
    resp = client.post(f"/api/auth/accounts/{acct['id']}/launch-credential")
    assert resp.status_code == 200
    assert resp.json()["api_key"] == "launch-key"


def test_launch_credential_route_rejects_claude(client, db):
    acct = db.create_account(
        "c@example.com",
        "claude-token",
        9999999999,
        provider="claude",
        organization_uuid="",
    )
    resp = client.post(f"/api/auth/accounts/{acct['id']}/launch-credential")
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "PROVIDER_NOT_SUPPORTED"


def test_ensure_cursor_launch_credential_reimports_when_slot_empty(db, tmp_path, monkeypatch):
    from manager.cursor.accounts import ensure_cursor_launch_credential

    monkeypatch.setenv("CURSOR_JACKED_HOME", str(tmp_path / ".cursor-jacked"))
    monkeypatch.setattr(
        "manager.cursor.accounts.detect_cursor_account",
        lambda *a, **k: _cursor_status(email="ensure@cursor.com"),
    )
    monkeypatch.setattr(
        "manager.cursor.accounts.read_cursor_auth",
        lambda *a, **k: _cursor_auth(email="ensure@cursor.com", token="live-key"),
    )
    acct = import_cursor_account(db, make_active=False)
    slot = cursor_account_slot(acct["id"])
    if slot.is_file():
        slot.unlink()
    api_key = ensure_cursor_launch_credential(acct["id"], db)
    assert api_key == "live-key"
