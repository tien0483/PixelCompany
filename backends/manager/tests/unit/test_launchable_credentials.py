"""Tests for ensure_launchable_credentials — the pre-write refresh step.

Every path that writes the GLOBAL credential store (auto-swap, "Set Active",
CLI reconcile) installs the seat that unpinned/"Auto" sessions copy at launch.
Writing an already-expired token there is what put those sessions on
"Login expired · Please run /login" with no recovery: the write refreshed
nothing, and the seat's own CC refresh was skipped for being the active one.
"""

import asyncio
import time
from unittest.mock import AsyncMock, MagicMock, patch


def _account(account_id: int = 1, **overrides) -> dict:
    now = int(time.time())
    account = {
        "id": account_id,
        "provider": "claude",
        "email": f"acct{account_id}@example.com",
        "access_token": "primary_at",
        "refresh_token": "primary_rt",
        "expires_at": now + 3600,
        "cc_access_token": "cc_at",
        "cc_refresh_token": "cc_rt",
        "cc_expires_at": now + 3600,
    }
    account.update(overrides)
    return account


def _db(account: dict) -> MagicMock:
    db = MagicMock()
    db.get_account.return_value = account
    db.get_active_sessions.return_value = []
    return db


class TestEnsureLaunchableCredentials:
    @patch("manager.api.credential_helpers.read_active_account_id", return_value=None)
    @patch("manager.web.auth.refresh_cc_token", new_callable=AsyncMock)
    @patch("manager.web.auth.refresh_account_token", new_callable=AsyncMock)
    def test_fresh_account_refreshes_nothing(
        self, mock_primary, mock_cc, mock_active,
    ):
        from manager.web.auth import ensure_launchable_credentials

        account = _account()
        db = _db(account)

        result = asyncio.run(ensure_launchable_credentials(1, db))

        assert result == account
        mock_primary.assert_not_called()
        mock_cc.assert_not_called()

    @patch("manager.api.credential_helpers.read_active_account_id", return_value=None)
    @patch("manager.web.auth.refresh_cc_token", new_callable=AsyncMock)
    @patch("manager.web.auth.refresh_account_token", new_callable=AsyncMock)
    def test_expired_pairs_are_refreshed_before_the_write(
        self, mock_primary, mock_cc, mock_active,
    ):
        from manager.web.auth import ensure_launchable_credentials

        now = int(time.time())
        db = _db(_account(expires_at=now - 100, cc_expires_at=now - 100))

        asyncio.run(ensure_launchable_credentials(1, db))

        mock_primary.assert_awaited_once_with(1, db)
        mock_cc.assert_awaited_once_with(1, db)

    @patch("manager.api.credential_helpers.read_active_account_id", return_value=None)
    @patch("manager.web.auth.refresh_cc_token", new_callable=AsyncMock)
    @patch("manager.web.auth.refresh_account_token", new_callable=AsyncMock)
    def test_live_session_keeps_its_unexpired_cc_token(
        self, mock_primary, mock_cc, mock_active,
    ):
        """A live session owns the single-use CC refresh token — don't rotate it."""
        from manager.web.auth import ensure_launchable_credentials

        now = int(time.time())
        db = _db(_account(cc_expires_at=now + 60))  # inside the refresh buffer
        db.get_active_sessions.return_value = [{"account_id": 1}]

        asyncio.run(ensure_launchable_credentials(1, db))

        mock_cc.assert_not_called()

    @patch("manager.api.credential_helpers.read_active_account_id", return_value=1)
    @patch("manager.web.auth.refresh_cc_token", new_callable=AsyncMock)
    @patch("manager.web.auth.refresh_account_token", new_callable=AsyncMock)
    def test_active_seat_with_expired_cc_is_still_refreshed(
        self, mock_primary, mock_cc, mock_active,
    ):
        from manager.web.auth import ensure_launchable_credentials

        now = int(time.time())
        db = _db(_account(cc_expires_at=now - 100))

        asyncio.run(ensure_launchable_credentials(1, db))

        mock_cc.assert_awaited_once_with(1, db)

    @patch("manager.api.credential_helpers.read_active_account_id", return_value=None)
    @patch("manager.web.auth.refresh_cc_token", new_callable=AsyncMock)
    @patch("manager.web.auth.refresh_account_token", new_callable=AsyncMock)
    def test_returns_the_reread_row_after_refresh(
        self, mock_primary, mock_cc, mock_active,
    ):
        from manager.web.auth import ensure_launchable_credentials

        now = int(time.time())
        stale = _account(expires_at=now - 100)
        fresh = _account(access_token="rotated_at")
        db = MagicMock()
        db.get_account.side_effect = [stale, fresh, fresh]
        db.get_active_sessions.return_value = []

        result = asyncio.run(ensure_launchable_credentials(1, db))

        assert result["access_token"] == "rotated_at"

    @patch("manager.api.credential_helpers.read_active_account_id", return_value=None)
    @patch("manager.web.auth.refresh_cc_token", new_callable=AsyncMock)
    @patch("manager.web.auth.refresh_account_token", new_callable=AsyncMock,
           side_effect=RuntimeError("token endpoint down"))
    def test_refresh_failure_does_not_block_the_write(
        self, mock_primary, mock_cc, mock_active,
    ):
        """A dead token endpoint must degrade to "write what we have"."""
        from manager.web.auth import ensure_launchable_credentials

        now = int(time.time())
        account = _account(expires_at=now - 100)
        db = _db(account)

        result = asyncio.run(ensure_launchable_credentials(1, db))

        assert result == account

    def test_missing_account_returns_none(self):
        from manager.web.auth import ensure_launchable_credentials

        db = MagicMock()
        db.get_account.return_value = None

        assert asyncio.run(ensure_launchable_credentials(99, db)) is None
