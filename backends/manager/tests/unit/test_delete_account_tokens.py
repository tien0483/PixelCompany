"""Delete account clears usage (primary) and Claude Code tokens."""

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
                cc_access_token, cc_refresh_token, cc_expires_at,
                priority, is_active, is_deleted, validation_status)
               VALUES (1, 'claude@test.com', 'claude', 'usage_at', 'usage_rt', 1900000000,
                       'cc_at', 'cc_rt', 1900000000,
                       0, 1, 0, 'valid')"""
        )
    yield db
    db.close()


@pytest.fixture
def client(db):
    app = FastAPI()
    app.include_router(router, prefix="/api/auth")
    app.state.db = db
    return TestClient(app)


def test_delete_account_clears_usage_and_cc_tokens(client, db):
    resp = client.delete("/api/auth/accounts/1")
    assert resp.status_code == 200
    assert resp.json()["deleted"] is True

    with db._reader() as conn:
        row = conn.execute(
            """SELECT access_token, refresh_token,
                      cc_access_token, cc_refresh_token, cc_expires_at,
                      is_deleted
               FROM accounts WHERE id = 1"""
        ).fetchone()

    assert row["is_deleted"] == 1
    assert row["access_token"] == ""
    assert row["refresh_token"] is None
    assert row["cc_access_token"] is None
    assert row["cc_refresh_token"] is None
    assert row["cc_expires_at"] is None
