"""Donate cap locked for paste-code invite seats."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from manager.api.routes.auth import router
from manager.web.database import Database


@pytest.fixture
def db(tmp_path):
    db = Database(str(tmp_path / "test.db"))
    with db._writer() as conn:
        conn.execute(
            """INSERT INTO accounts
               (id, email, provider, access_token, refresh_token, expires_at,
                donate_limit_percent, donate_limit_locked, is_active, is_deleted, validation_status)
               VALUES (1, 'invited@test.com', 'claude', 'at', 'rt', 1900000000,
                       52, 1, 1, 0, 'valid')"""
        )
        conn.execute(
            """INSERT INTO accounts
               (id, email, provider, access_token, refresh_token, expires_at,
                donate_limit_percent, donate_limit_locked, is_active, is_deleted, validation_status)
               VALUES (2, 'oauth@test.com', 'claude', 'at', 'rt', 1900000000,
                       100, 0, 1, 0, 'valid')"""
        )
        conn.execute(
            """INSERT INTO accounts
               (id, email, provider, access_token, refresh_token, expires_at,
                donate_limit_percent, donate_limit_locked, is_active, is_deleted, validation_status,
                cached_usage_5h, cached_usage_7d)
               VALUES (3, 'locked-over-cap@test.com', 'claude', 'at', 'rt', 1900000000,
                       70, 1, 1, 0, 'valid', 95, 10)"""
        )
        conn.execute(
            """INSERT INTO accounts
               (id, email, provider, access_token, refresh_token, expires_at,
                donate_limit_percent, donate_limit_locked, is_active, is_deleted, validation_status,
                cached_usage_5h, cached_usage_7d)
               VALUES (4, 'unlocked-over-cap@test.com', 'claude', 'at', 'rt', 1900000000,
                       70, 0, 1, 0, 'valid', 95, 10)"""
        )
    yield db
    db.close()


@pytest.fixture
def client(db):
    app = FastAPI()
    app.include_router(router, prefix="/api/auth")
    app.state.db = db
    return TestClient(app)


def test_patch_donate_rejected_when_locked(client, db):
    resp = client.patch("/api/auth/accounts/1", json={"donate_limit_percent": 80})
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "DONATE_LIMIT_LOCKED"
    row = db.get_account(1)
    assert row["donate_limit_percent"] == 52


def test_patch_donate_allowed_when_locked_with_allow_locked(client, db):
    resp = client.patch(
        "/api/auth/accounts/1",
        json={"donate_limit_percent": 100, "allow_locked": True},
    )
    assert resp.status_code == 200
    row = db.get_account(1)
    assert row["donate_limit_percent"] == 100
    # The override is per-request — the seat stays flagged as locked.
    assert row["donate_limit_locked"] == 1
    assert resp.json()["donate_limit_locked"] is True


def test_patch_donate_allowed_when_unlocked(client, db):
    resp = client.patch("/api/auth/accounts/2", json={"donate_limit_percent": 70})
    assert resp.status_code == 200
    assert resp.json()["donate_limit_percent"] == 70


def test_list_accounts_includes_donate_limit_locked(client):
    rows = client.get("/api/auth/accounts?include_inactive=true").json()
    by_id = {row["id"]: row for row in rows}
    assert by_id[1]["donate_limit_locked"] is True
    assert by_id[2]["donate_limit_locked"] is False


def test_use_account_rejected_when_over_locked_cap(client):
    resp = client.post("/api/auth/accounts/3/use")
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "OVER_DONATE_CAP"


def test_use_account_rejected_when_over_unlocked_cap(client):
    resp = client.post("/api/auth/accounts/4/use")
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "OVER_DONATE_CAP"
