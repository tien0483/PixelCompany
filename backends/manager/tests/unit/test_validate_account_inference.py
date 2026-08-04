"""Tests for validate_account's profile x inference-probe decision table
(backends/manager/manager/web/auth.py).

Uses a real in-memory Database so DB writes are exercised, and
asyncio.run() wrappers (project convention — no pytest-asyncio)."""
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from manager.web.database import Database
from manager.web.inference_probe import InferenceProbeResult


@pytest.fixture
def db():
    d = Database(":memory:")
    yield d
    d.close()


def _fake_profile_client(status_code=200, body=None):
    resp = MagicMock()
    resp.status_code = status_code
    resp.json.return_value = body or {}
    client = AsyncMock()
    client.get.return_value = resp
    client.__aenter__.return_value = client
    client.__aexit__.return_value = False
    return client


def _probe(verdict, status_code=None, error_type=None, error_message=None):
    return InferenceProbeResult(
        verdict=verdict, status_code=status_code, error_type=error_type, error_message=error_message
    )


def _run_validate(account_id, db, probe_result_or_side_effect):
    from manager.web import auth as auth_mod

    profile_client = _fake_profile_client(200, {})

    if callable(probe_result_or_side_effect) or isinstance(probe_result_or_side_effect, list):
        probe_mock = AsyncMock(side_effect=probe_result_or_side_effect)
    else:
        probe_mock = AsyncMock(return_value=probe_result_or_side_effect)

    async def _run():
        with patch.object(auth_mod.httpx, "AsyncClient", return_value=profile_client), \
             patch.object(auth_mod, "probe_inference", probe_mock):
            return await auth_mod.validate_account(account_id, db)

    result = asyncio.run(_run())
    return result, probe_mock


class TestProfile200ProbeDecisionTable:
    def test_probe_403_marks_invalid_with_upstream_message(self, db):
        """Headline regression: a suspended account 200s on profile but the
        probe catches it — this must invalidate with the real reason."""
        a = db.create_account("a@t.com", "primary_tok", 9999999999)

        result, _ = _run_validate(
            a["id"], db,
            _probe("forbidden", 403, "permission_error", "Your account has been suspended."),
        )

        assert result["valid"] is False
        assert result["verdict"] == "bad"
        assert result["code"] == "account_forbidden"
        assert "permission_error" in result["error"]
        assert "Your account has been suspended." in result["error"]

        row = db.get_account(a["id"])
        assert row["validation_status"] == "invalid"
        assert row["last_error_code"] == "account_forbidden"
        assert "Your account has been suspended." in row["last_error"]

    def test_probe_200_marks_valid_and_clears_error_code(self, db):
        a = db.create_account("a@t.com", "primary_tok", 9999999999)
        db.update_account(a["id"], validation_status="invalid", last_error_code="account_forbidden", last_error="old")

        result, _ = _run_validate(a["id"], db, _probe("ok", 200))

        assert result == {"valid": True, "error": None, "verdict": "good", "code": None}
        row = db.get_account(a["id"])
        assert row["validation_status"] == "valid"
        assert row["last_error"] is None
        assert row["last_error_code"] is None

    def test_probe_429_keeps_valid_and_writes_no_last_error(self, db):
        a = db.create_account("a@t.com", "primary_tok", 9999999999)
        db.update_account(a["id"], validation_status="valid")

        result, _ = _run_validate(a["id"], db, _probe("rate_limited", 429))

        assert result["valid"] is True
        assert result["verdict"] == "indeterminate"
        assert result["code"] is None
        row = db.get_account(a["id"])
        assert row["validation_status"] == "valid"
        assert row["last_error"] is None

    def test_probe_400_keeps_valid(self, db):
        a = db.create_account("a@t.com", "primary_tok", 9999999999)
        db.update_account(a["id"], validation_status="valid")

        result, _ = _run_validate(
            a["id"], db, _probe("bad_request", 400, "invalid_request_error", "model retired")
        )

        assert result["valid"] is True
        assert result["verdict"] == "indeterminate"
        row = db.get_account(a["id"])
        assert row["validation_status"] == "valid"

    def test_probe_5xx_preserves_prior_status_and_last_error(self, db):
        a = db.create_account("a@t.com", "primary_tok", 9999999999)
        db.update_account(a["id"], validation_status="unknown", last_error="prior issue", last_error_code="profile_http_error")

        result, _ = _run_validate(a["id"], db, _probe("upstream_error", 503))

        assert result["valid"] is True
        assert result["verdict"] == "indeterminate"
        row = db.get_account(a["id"])
        # Never false-invalidate: profile status update path (_finalize_validate_result)
        # does not touch validation_status/last_error on this branch.
        assert row["validation_status"] == "unknown"
        assert row["last_error"] == "prior issue"

    def test_probe_timeout_does_not_false_invalidate(self, db):
        a = db.create_account("a@t.com", "primary_tok", 9999999999)
        db.update_account(a["id"], validation_status="valid")

        result, _ = _run_validate(a["id"], db, _probe("network_error", None, None, "connection reset"))

        assert result["valid"] is True
        assert result["verdict"] == "indeterminate"
        row = db.get_account(a["id"])
        assert row["validation_status"] == "valid"


class TestProfileNon200SkipsProbe:
    def test_profile_401_refresh_failed_skips_probe(self, db):
        from manager.web import auth as auth_mod

        a = db.create_account("a@t.com", "primary_tok", 9999999999)
        resp401 = MagicMock()
        resp401.status_code = 401
        client = AsyncMock()
        client.get.return_value = resp401
        client.__aenter__.return_value = client
        client.__aexit__.return_value = False

        probe_mock = AsyncMock()

        async def _run():
            with patch.object(auth_mod.httpx, "AsyncClient", return_value=client), \
                 patch.object(auth_mod, "_try_refresh_primary_token", AsyncMock(return_value=None)), \
                 patch.object(auth_mod, "probe_inference", probe_mock):
                return await auth_mod.validate_account(a["id"], db)

        result = asyncio.run(_run())
        assert result["valid"] is False
        assert result["verdict"] == "bad"
        assert result["code"] == "profile_unauthorized"
        probe_mock.assert_not_awaited()

    def test_profile_429_skips_probe(self, db):
        from manager.web import auth as auth_mod

        a = db.create_account("a@t.com", "primary_tok", 9999999999)
        resp429 = MagicMock()
        resp429.status_code = 429
        client = AsyncMock()
        client.get.return_value = resp429
        client.__aenter__.return_value = client
        client.__aexit__.return_value = False

        probe_mock = AsyncMock()

        async def _run():
            with patch.object(auth_mod.httpx, "AsyncClient", return_value=client), \
                 patch.object(auth_mod, "probe_inference", probe_mock):
                return await auth_mod.validate_account(a["id"], db)

        result = asyncio.run(_run())
        assert result["valid"] is False
        assert result["verdict"] == "indeterminate"
        assert result["code"] == "profile_rate_limited"
        probe_mock.assert_not_awaited()


class TestProbeTokenSelection:
    def test_probe_prefers_cc_token(self, db):
        from manager.web import auth as auth_mod

        a = db.create_account("a@t.com", "primary_tok", 9999999999)
        db.update_account(a["id"], cc_access_token="cc_tok", cc_refresh_token="cc_rt", cc_expires_at=9999999999)

        probe_mock = AsyncMock(return_value=_probe("ok", 200))
        profile_client = _fake_profile_client(200, {})

        async def _run():
            with patch.object(auth_mod.httpx, "AsyncClient", return_value=profile_client), \
                 patch.object(auth_mod, "probe_inference", probe_mock):
                return await auth_mod.validate_account(a["id"], db)

        asyncio.run(_run())
        probe_mock.assert_awaited_once()
        assert probe_mock.await_args.args[0] == "cc_tok"

    def test_probe_falls_back_to_primary_without_cc_token(self, db):
        from manager.web import auth as auth_mod

        a = db.create_account("a@t.com", "primary_tok", 9999999999)

        probe_mock = AsyncMock(return_value=_probe("ok", 200))
        profile_client = _fake_profile_client(200, {})

        async def _run():
            with patch.object(auth_mod.httpx, "AsyncClient", return_value=profile_client), \
                 patch.object(auth_mod, "probe_inference", probe_mock):
                return await auth_mod.validate_account(a["id"], db)

        asyncio.run(_run())
        probe_mock.assert_awaited_once()
        assert probe_mock.await_args.args[0] == "primary_tok"

    def test_probe_uses_primary_for_active_account_with_stale_cc(self, db):
        from manager.web import auth as auth_mod

        a = db.create_account("a@t.com", "primary_tok", 9999999999)
        db.update_account(a["id"], cc_access_token="stale_cc_tok", cc_refresh_token="cc_rt", cc_expires_at=1)

        probe_mock = AsyncMock(return_value=_probe("ok", 200))
        profile_client = _fake_profile_client(200, {})

        async def _run():
            with patch.object(auth_mod.httpx, "AsyncClient", return_value=profile_client), \
                 patch.object(auth_mod, "probe_inference", probe_mock), \
                 patch(
                     "manager.api.credential_helpers.read_active_account_id",
                     return_value=a["id"],
                 ):
                return await auth_mod.validate_account(a["id"], db)

        asyncio.run(_run())
        probe_mock.assert_awaited_once()
        assert probe_mock.await_args.args[0] == "primary_tok"


class TestCcTokenExpiredFallback:
    def test_cc_401_then_primary_ok_reports_cc_expired_without_invalidating(self, db):
        from manager.web import auth as auth_mod

        a = db.create_account("a@t.com", "primary_tok", 9999999999)
        db.update_account(a["id"], cc_access_token="stale_cc_tok", cc_refresh_token="cc_rt", cc_expires_at=9999999999)

        probe_mock = AsyncMock(
            side_effect=[_probe("unauthorized", 401, "authentication_error", "expired"), _probe("ok", 200)]
        )
        profile_client = _fake_profile_client(200, {})

        async def _run():
            with patch.object(auth_mod.httpx, "AsyncClient", return_value=profile_client), \
                 patch.object(auth_mod, "probe_inference", probe_mock), \
                 patch(
                     "manager.api.credential_helpers.read_active_account_id",
                     return_value=None,
                 ):
                return await auth_mod.validate_account(a["id"], db)

        result = asyncio.run(_run())
        assert probe_mock.await_count == 2
        assert result["valid"] is False
        assert result["verdict"] == "bad"
        assert result["code"] == "cc_token_expired"
        row = db.get_account(a["id"])
        assert row["validation_status"] == "valid"
        assert row["last_error_code"] == "cc_token_expired"


class TestProbeCostControl:
    def test_probe_called_once_on_success(self, db):
        a = db.create_account("a@t.com", "primary_tok", 9999999999)
        _, probe_mock = _run_validate(a["id"], db, _probe("ok", 200))
        probe_mock.assert_awaited_once()

    def test_budget_exhausted_skips_probe(self, db):
        from manager.web import auth as auth_mod

        a = db.create_account("a@t.com", "primary_tok", 9999999999)
        probe_mock = AsyncMock(return_value=_probe("ok", 200))
        profile_client = _fake_profile_client(200, {})

        async def _run():
            with patch.object(auth_mod.httpx, "AsyncClient", return_value=profile_client), \
                 patch.object(auth_mod, "probe_inference", probe_mock), \
                 patch.object(auth_mod, "_VALIDATE_BUDGET_SECONDS", 0.0):
                return await auth_mod.validate_account(a["id"], db)

        result = asyncio.run(_run())
        probe_mock.assert_not_awaited()
        assert result["valid"] is True
        assert result["verdict"] == "indeterminate"
        assert "skipped" in result["error"]
