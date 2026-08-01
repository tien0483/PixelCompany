"""Primary-seat delete guard is scoped per provider."""

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
                priority, is_active, is_deleted, validation_status)
               VALUES (1, 'claude@test.com', 'claude', 'at_1', 'rt_1', 1900000000,
                       0, 1, 0, 'valid')"""
        )
        conn.execute(
            """INSERT INTO accounts
               (id, email, provider, access_token, refresh_token, expires_at,
                priority, is_active, is_deleted, validation_status)
               VALUES (2, 'cursor@test.com', 'cursor', 'at_2', 'rt_2', 1900000000,
                       1, 1, 0, 'valid')"""
        )
    yield db
    db.close()


@pytest.fixture
def client(db):
    app = FastAPI()
    app.include_router(router, prefix="/api/auth")
    app.state.db = db
    return TestClient(app)


def test_delete_claude_primary_allowed_when_only_cursor_also_active(client, db):
    """Mixed-provider fleet: Claude primary can be deleted when Cursor is active."""
    resp = client.delete("/api/auth/accounts/1")
    assert resp.status_code == 200
    assert resp.json()["deleted"] is True
    assert db.get_account(1) is None


def test_delete_claude_primary_blocked_when_second_claude_exists(client, db):
    with db._writer() as conn:
        conn.execute(
            """INSERT INTO accounts
               (id, email, provider, access_token, refresh_token, expires_at,
                priority, is_active, is_deleted, validation_status)
               VALUES (3, 'claude2@test.com', 'claude', 'at_3', 'rt_3', 1900000000,
                       1, 1, 0, 'valid')"""
        )

    resp = client.delete("/api/auth/accounts/1")
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "CANNOT_DELETE_PRIMARY"
