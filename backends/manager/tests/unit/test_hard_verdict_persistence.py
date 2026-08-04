"""Tests that a hard validate_account verdict (account_forbidden,
token_unauthorized) survives clear_account_errors — a routine successful
usage/profile poll must not silently repaint a suspended account green.

Uses a real in-memory Database, and asyncio.run() wrappers (project
convention — no pytest-asyncio)."""
import asyncio
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from manager.web.database import Database


@pytest.fixture
def db():
    d = Database(":memory:")
    yield d
    d.close()


class TestClearAccountErrorsHardVerdictGuard:
    def test_clear_account_errors_preserves_hard_verdict(self, db):
        a = db.create_account("a@t.com", "tok", 9999999999)
        db.update_account(
            a["id"],
            validation_status="invalid",
            last_error="Anthropic refused this account (permission_error): suspended.",
            last_error_at=datetime.now(timezone.utc).isoformat(),
            last_error_code="account_forbidden",
        )

        result = db.clear_account_errors(a["id"])

        assert result is True
        row = db.get_account(a["id"])
        assert row["validation_status"] == "invalid"
        assert row["last_error_code"] == "account_forbidden"
        assert "suspended" in row["last_error"]
        # A poll still succeeded — stamp last_used_at/updated_at even though
        # the verdict itself was preserved.
        assert row["last_used_at"] is not None

    def test_clear_account_errors_preserves_token_unauthorized_verdict(self, db):
        a = db.create_account("a@t.com", "tok", 9999999999)
        db.update_account(
            a["id"],
            validation_status="invalid",
            last_error="Token rejected for inference (HTTP 401): bad token",
            last_error_code="token_unauthorized",
        )

        db.clear_account_errors(a["id"])

        row = db.get_account(a["id"])
        assert row["validation_status"] == "invalid"
        assert row["last_error_code"] == "token_unauthorized"

    def test_clear_account_errors_still_clears_soft_error(self, db):
        """A watchdog-style transient error (no hard code) must still clear —
        this is the pre-existing, still-required behavior."""
        a = db.create_account("a@t.com", "tok", 9999999999)
        db.update_account(
            a["id"],
            validation_status="unknown",
            last_error="validation timed out — reset by watchdog",
            last_error_at=datetime.now(timezone.utc).isoformat(),
            last_error_code="profile_network_error",
        )

        result = db.clear_account_errors(a["id"])

        assert result is True
        row = db.get_account(a["id"])
        assert row["validation_status"] == "valid"
        assert row["last_error"] is None
        assert row["last_error_code"] is None

    def test_clear_account_errors_clears_when_no_error_code_set(self, db):
        a = db.create_account("a@t.com", "tok", 9999999999)
        result = db.clear_account_errors(a["id"])
        assert result is True
        row = db.get_account(a["id"])
        assert row["validation_status"] == "valid"


class TestFetchUsageDoesNotRepaintSuspendedAccountGreen:
    def test_fetch_usage_200_does_not_repaint_suspended_account_green(self, db):
        from manager.web import auth as auth_mod

        a = db.create_account("a@t.com", "tok", 9999999999)
        db.update_account(
            a["id"],
            validation_status="invalid",
            last_error="Anthropic refused this account (permission_error): suspended.",
            last_error_code="account_forbidden",
        )

        resp = MagicMock()
        resp.status_code = 200
        resp.json.return_value = {
            "five_hour": {"utilization": 10.0, "resets_at": None},
            "seven_day": {"utilization": 20.0, "resets_at": None},
        }
        client = AsyncMock()
        client.get.return_value = resp
        client.__aenter__.return_value = client
        client.__aexit__.return_value = False

        async def _run():
            with patch.object(auth_mod.httpx, "AsyncClient", return_value=client):
                return await auth_mod.fetch_usage(a["id"], db, access_token="tok", manual=True)

        asyncio.run(_run())

        row = db.get_account(a["id"])
        assert row["validation_status"] == "invalid"
        assert row["last_error_code"] == "account_forbidden"
