"""Tests that heal_invalid_accounts never phantom-heals a suspended account:
a refresh token surviving proves the OAuth grant is alive, not that the
account is entitled to run inference. Also covers the hard-verdict cooldown
that stops re-probing a permanently dead account every 5 minutes forever.

heal_invalid_accounts creates its own Database() internally, so these tests
patch manager.web.auth.Database to return a tmp_path-backed instance —
same pattern as test_refresh_deadlock.py / test_token_refresh.py.
Uses asyncio.run() wrappers (project convention — no pytest-asyncio)."""
import asyncio
import time
from unittest.mock import AsyncMock, patch

from manager.web.auth import TokenExchangeResult, heal_invalid_accounts
from manager.web.database import Database


def _make_db(tmp_path, validation_status="invalid", **extra):
    db = Database(str(tmp_path / "test.db"))
    acct = db.create_account(
        "heal@test.com", "tok", int(time.time()) + 3600, refresh_token="rt-test",
    )
    db.update_account(acct["id"], validation_status=validation_status, **extra)
    return db, acct


class TestRefreshAloneDoesNotHeal:
    def test_successful_refresh_alone_does_not_mark_valid(self, tmp_path):
        """A refresh token surviving (still exchanges fine) must NOT heal the
        account by itself — a suspended account's refresh token still works,
        so only validate_account's live-inference verdict is authoritative."""
        db, acct = _make_db(tmp_path)
        refresh_flow = AsyncMock(return_value=TokenExchangeResult(
            success=True, access_token="new-at", refresh_token="new-rt", expires_in=3600,
        ))
        validate = AsyncMock(return_value={
            "valid": False,
            "error": "Anthropic refused this account (permission_error): suspended.",
            "verdict": "bad",
            "code": "account_forbidden",
        })

        with patch("manager.web.auth.Database", return_value=db), \
             patch("manager.web.auth._refresh_token_flow", refresh_flow), \
             patch("manager.web.auth.validate_account", validate):
            result = asyncio.run(heal_invalid_accounts())

        refresh_flow.assert_awaited_once()
        validate.assert_awaited_once()
        assert result["healed"] == 0
        assert result["confirmed_invalid"] == 1
        assert db.get_account(acct["id"])["validation_status"] != "valid"


class TestIndeterminateDoesNotOverwriteStatus:
    def test_indeterminate_validation_does_not_overwrite_status(self, tmp_path):
        """An indeterminate verdict (e.g. rate-limited probe) must not be
        treated as healed, and must not flip a still-invalid row to valid."""
        db, acct = _make_db(tmp_path, validation_status="unknown")
        exchange = AsyncMock(return_value=TokenExchangeResult(success=False, error="network_error"))
        validate = AsyncMock(return_value={
            "valid": True,
            "error": "Credential looks good; the live inference check was rate-limited — try again in a few minutes.",
            "verdict": "indeterminate",
            "code": None,
        })

        with patch("manager.web.auth.Database", return_value=db), \
             patch("manager.web.auth._exchange_refresh_token", exchange), \
             patch("manager.web.auth.validate_account", validate):
            result = asyncio.run(heal_invalid_accounts())

        assert result["healed"] == 0
        assert result["confirmed_invalid"] == 1
        assert db.get_account(acct["id"])["validation_status"] == "unknown"


class TestHardVerdictCooldown:
    def test_hard_verdict_within_cooldown_is_not_reprobed(self, tmp_path):
        """An account confirmed bad (account_forbidden/token_unauthorized)
        recently must be skipped entirely — no refresh attempt, no validate
        call — otherwise a permanently suspended account gets re-probed
        against Anthropic every 5 minutes forever."""
        db, acct = _make_db(
            tmp_path,
            validation_status="invalid",
            last_error_code="account_forbidden",
            last_validated_at=int(time.time()),
        )
        exchange = AsyncMock()
        validate = AsyncMock()

        with patch("manager.web.auth.Database", return_value=db), \
             patch("manager.web.auth._exchange_refresh_token", exchange), \
             patch("manager.web.auth.validate_account", validate):
            result = asyncio.run(heal_invalid_accounts())

        exchange.assert_not_awaited()
        validate.assert_not_awaited()
        assert result["checked"] == 0
        assert result["healed"] == 0
        assert result["confirmed_invalid"] == 0

    def test_hard_verdict_outside_cooldown_is_reprobed(self, tmp_path):
        """Once the cooldown has elapsed, a hard-verdict account is eligible
        for another heal attempt (in case the suspension was lifted)."""
        from manager.web import auth as auth_mod

        db, acct = _make_db(
            tmp_path,
            validation_status="invalid",
            last_error_code="account_forbidden",
            last_validated_at=int(time.time()) - auth_mod._HEAL_HARD_VERDICT_COOLDOWN - 10,
        )
        exchange = AsyncMock(return_value=TokenExchangeResult(success=False, error="invalid_grant"))
        validate = AsyncMock(return_value={
            "valid": False, "error": "still suspended", "verdict": "bad", "code": "account_forbidden",
        })

        with patch("manager.web.auth.Database", return_value=db), \
             patch("manager.web.auth._exchange_refresh_token", exchange), \
             patch("manager.web.auth.validate_account", validate):
            result = asyncio.run(heal_invalid_accounts())

        validate.assert_awaited_once()
        assert result["checked"] == 1
        assert result["confirmed_invalid"] == 1
