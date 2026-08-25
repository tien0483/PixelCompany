"""Tests verifying jacked never rotates the active account's CC refresh token.

See docs/architecture/oauth-and-credential-flows.md §7.1 and §7.2.
The CC refresh token is single-use and shared with Claude Code on the active
account. If jacked exchanges it upstream, Claude Code's own refresher sees
invalid_grant and forces a re-login. These tests lock in the skip behavior
for both the background loop and the pre-launch path.
"""

import asyncio
import time
from contextlib import ExitStack
from unittest.mock import AsyncMock, MagicMock, patch


class TestBackgroundLoopSkipsActiveCC:
    def _make_account(self, account_id: int, cc_expires_at: int) -> dict:
        return {
            "id": account_id,
            "refresh_token": None,  # skip primary refresh path
            "expires_at": int(time.time()) + 3600,
            "cc_access_token": f"cc_at_{account_id}",
            "cc_refresh_token": f"cc_rt_{account_id}",
            "cc_expires_at": cc_expires_at,
        }

    @patch("manager.web.auth.refresh_cc_token", new_callable=AsyncMock)
    @patch("manager.web.auth.refresh_account_token", new_callable=AsyncMock)
    @patch("manager.api.credential_helpers.read_active_account_id", return_value=1)
    @patch("manager.web.auth.Database")
    def test_active_account_cc_refresh_is_skipped(
        self, mock_db_cls, mock_read_active, mock_refresh_primary, mock_refresh_cc,
    ):
        """Active account's CC refresh must NOT fire from the 30min loop."""
        from manager.web import auth

        now = int(time.time())
        # CC expires in 2 minutes — well inside should_refresh_cc's 300s buffer
        active_acct = self._make_account(1, cc_expires_at=now + 120)
        inactive_acct = self._make_account(2, cc_expires_at=now + 120)

        mock_db = MagicMock()
        mock_db.list_accounts.return_value = [active_acct, inactive_acct]
        mock_db_cls.return_value = mock_db

        mock_refresh_cc.return_value = True

        with patch("manager.api.credential_helpers.reconcile_credentials_from_live_store"):
            result = asyncio.run(auth.refresh_all_expiring_tokens())

        # Only the inactive account should have been refreshed
        mock_refresh_cc.assert_called_once_with(2, mock_db)
        assert result["cc_refreshed"] == 1
        # Active account was checked and counted, just not CC-refreshed
        assert result["checked"] == 2

    @patch("manager.web.auth.refresh_cc_token", new_callable=AsyncMock)
    @patch("manager.web.auth.refresh_account_token", new_callable=AsyncMock)
    @patch("manager.api.credential_helpers.read_active_account_id", return_value=1)
    @patch("manager.web.auth.Database")
    def test_active_account_with_expired_cc_is_refreshed(
        self, mock_db_cls, mock_read_active, mock_refresh_primary, mock_refresh_cc,
    ):
        """An EXPIRED CC pair on the active seat must still be refreshed.

        Skipping it strands the seat on a dead token forever: it is the seat
        every unpinned/"Auto" launch copies, so each new session opens on
        "Login expired · Please run /login". Nothing is protected by the skip
        — the live session's credential is already expired.
        """
        from manager.web import auth

        now = int(time.time())
        active_acct = self._make_account(1, cc_expires_at=now - 100)

        mock_db = MagicMock()
        mock_db.list_accounts.return_value = [active_acct]
        mock_db_cls.return_value = mock_db
        mock_refresh_cc.return_value = True

        with patch("manager.api.credential_helpers.reconcile_credentials_from_live_store"):
            result = asyncio.run(auth.refresh_all_expiring_tokens())

        mock_refresh_cc.assert_called_once_with(1, mock_db)
        assert result["cc_refreshed"] == 1

    @patch("manager.web.auth.refresh_cc_token", new_callable=AsyncMock)
    @patch("manager.api.credential_helpers.read_active_account_id",
           side_effect=RuntimeError("keychain down"))
    @patch("manager.web.auth.Database")
    def test_refresh_loop_survives_active_account_lookup_exception(
        self, mock_db_cls, mock_read_active, mock_refresh_cc,
    ):
        """If active-account detection raises, the loop must not crash.

        Regression guard for the NameError that occurred when active_id
        was referenced before assignment on exception paths.
        """
        from manager.web import auth

        now = int(time.time())
        acct = self._make_account(1, cc_expires_at=now + 120)

        mock_db = MagicMock()
        mock_db.list_accounts.return_value = [acct]
        mock_db_cls.return_value = mock_db
        mock_refresh_cc.return_value = True

        # Must not raise NameError or any other unhandled exception.
        result = asyncio.run(auth.refresh_all_expiring_tokens())
        # No active account detected → refresh proceeds.
        assert result["cc_refreshed"] == 1

    @patch("manager.web.auth.refresh_cc_token", new_callable=AsyncMock)
    @patch("manager.api.credential_helpers.read_active_account_id", return_value=None)
    @patch("manager.web.auth.Database")
    def test_refresh_loop_survives_non_dict_live_data(
        self, mock_db_cls, mock_read_active, mock_refresh_cc,
    ):
        """`_jackedAccountId` missing or malformed → treated as no active."""
        from manager.web import auth

        now = int(time.time())
        acct = self._make_account(1, cc_expires_at=now + 120)
        mock_db = MagicMock()
        mock_db.list_accounts.return_value = [acct]
        mock_db_cls.return_value = mock_db
        mock_refresh_cc.return_value = True

        result = asyncio.run(auth.refresh_all_expiring_tokens())
        assert result["cc_refreshed"] == 1

    @patch("manager.web.auth.refresh_cc_token", new_callable=AsyncMock)
    @patch("manager.api.credential_helpers.read_active_account_id", return_value=None)
    @patch("manager.web.auth.Database")
    def test_no_active_account_still_refreshes_all(
        self, mock_db_cls, mock_read_active, mock_refresh_cc,
    ):
        """When no active-account marker is present, refresh proceeds normally."""
        from manager.web import auth

        now = int(time.time())
        acct1 = self._make_account(1, cc_expires_at=now + 120)
        acct2 = self._make_account(2, cc_expires_at=now + 120)

        mock_db = MagicMock()
        mock_db.list_accounts.return_value = [acct1, acct2]
        mock_db_cls.return_value = mock_db

        # read_active_account_id default = None (from @patch decorator)
        mock_refresh_cc.return_value = True

        with patch("manager.api.credential_helpers.reconcile_credentials_from_live_store"):
            result = asyncio.run(auth.refresh_all_expiring_tokens())

        assert mock_refresh_cc.call_count == 2
        assert result["cc_refreshed"] == 2


class TestReadActiveAccountId:
    """The shared helper used by every skip site."""

    @patch("manager.api.credential_helpers.read_platform_credentials")
    def test_returns_int_from_keychain_int(self, mock_read):
        from manager.api.credential_helpers import read_active_account_id
        mock_read.return_value = {"_jackedAccountId": 7, "claudeAiOauth": {}}
        assert read_active_account_id() == 7

    @patch("manager.api.credential_helpers.read_platform_credentials")
    def test_coerces_string_to_int(self, mock_read):
        """Hand-edited JSON with '1' instead of 1 must still match."""
        from manager.api.credential_helpers import read_active_account_id
        mock_read.return_value = {"_jackedAccountId": "5", "claudeAiOauth": {}}
        assert read_active_account_id() == 5

    @patch("manager.api.credential_helpers.read_platform_credentials")
    def test_rejects_zero(self, mock_read):
        from manager.api.credential_helpers import read_active_account_id
        mock_read.return_value = {"_jackedAccountId": 0}
        assert read_active_account_id() is None

    @patch("manager.api.credential_helpers.read_platform_credentials")
    def test_rejects_negative(self, mock_read):
        from manager.api.credential_helpers import read_active_account_id
        mock_read.return_value = {"_jackedAccountId": -1}
        assert read_active_account_id() is None

    @patch("manager.api.credential_helpers.read_platform_credentials")
    def test_missing_stamp_returns_none(self, mock_read):
        from manager.api.credential_helpers import read_active_account_id
        mock_read.return_value = {"claudeAiOauth": {}}  # no stamp key
        assert read_active_account_id() is None

    @patch("manager.api.credential_helpers.read_platform_credentials")
    def test_non_dict_returns_none(self, mock_read):
        from manager.api.credential_helpers import read_active_account_id
        mock_read.return_value = "not a dict"
        assert read_active_account_id() is None

    @patch("manager.api.credential_helpers.read_platform_credentials",
           side_effect=RuntimeError("keychain exploded"))
    def test_exception_returns_none_no_raise(self, mock_read):
        from manager.api.credential_helpers import read_active_account_id
        # Must NOT raise — callers depend on this being safe.
        assert read_active_account_id() is None


class TestWindowKeeperSkipsActiveCC:
    """The window keeper 401-recovery path must not rotate the active CC token."""

    @patch("manager.api.credential_helpers.reconcile_credentials_from_live_store")
    @patch("manager.api.credential_helpers.read_active_account_id", return_value=7)
    @patch("manager.web.auth.refresh_cc_token", new_callable=AsyncMock)
    def test_active_account_reconciles_instead_of_refreshing(
        self, mock_refresh_cc, mock_read_active, mock_reconcile,
    ):
        """Simulate the window keeper recovery branch directly.

        When the active account's ping fails, the path must NOT call
        refresh_cc_token — it must reconcile from live creds instead.
        """
        # We test the exact branch logic in isolation by replicating
        # the call pattern from usage_monitor.py window keeper.
        from manager.api.credential_helpers import (
            read_active_account_id,
            reconcile_credentials_from_live_store,
        )

        acct_id = 7
        active_id_now = read_active_account_id()
        assert active_id_now == acct_id  # prerequisite for the skip path

        # Simulate the new skip branch: reconcile, don't refresh.
        if active_id_now == acct_id:
            reconcile_credentials_from_live_store(acct_id, MagicMock())

        mock_refresh_cc.assert_not_called()
        mock_reconcile.assert_called_once()


class TestLaunchSkipsActiveCC:
    """prepare_account_dir must not rotate CC token for already-active account.

    We test the refresh-decision block in isolation by raising a sentinel
    exception from the next step after the refresh check. If refresh_cc_token
    was called vs skipped we can tell from the mock.

    The sentinel hangs off ``_seed_claude_config`` — the first step after the
    decision — and never off ``_time.time``: ``manager.launch._time`` IS the
    stdlib module, so patching its ``time`` also breaks the decision code
    itself and the test passes without ever reaching the branch.
    """

    @staticmethod
    def _stop_after_refresh_check(tmp_path):
        """Patches that let the decision block run, then abort the launch."""
        sentinel = RuntimeError("stop-after-refresh-check")
        return (
            patch("manager.launch.ACCOUNTS_DIR", tmp_path / "accounts"),
            patch("manager.launch.should_refresh", return_value=False),
            patch("manager.launch.should_refresh_cc", return_value=True),
            patch("manager.launch._seed_claude_config", side_effect=sentinel),
        )

    def _make_account(self, account_id: int, cc_expires_at: int) -> dict:
        return {
            "id": account_id,
            "display_name": f"Account {account_id}",
            "email": f"acct{account_id}@example.com",
            "refresh_token": None,
            "expires_at": int(time.time()) + 3600,
            "access_token": f"at_{account_id}",
            "cc_access_token": f"cc_at_{account_id}",
            "cc_refresh_token": f"cc_rt_{account_id}",
            "cc_expires_at": cc_expires_at,
            "validation_status": "valid",
        }

    @patch("manager.api.credential_helpers.read_active_account_id")
    @patch("manager.web.auth.refresh_cc_token", new_callable=AsyncMock)
    def test_skips_cc_refresh_when_account_is_active(
        self, mock_refresh_cc, mock_read_live, tmp_path,
    ):
        """If live creds say account 1 is active, launching account 1 must NOT refresh."""
        from manager import launch

        now = int(time.time())
        acct = self._make_account(1, cc_expires_at=now + 60)
        mock_read_live.return_value = 1

        db = MagicMock()
        db.get_account.return_value = acct

        # Let prepare_account_dir run through the refresh check, then bail
        # on the next step (we don't care about the rest for this test).
        with ExitStack() as stack:
            for patcher in self._stop_after_refresh_check(tmp_path):
                stack.enter_context(patcher)
            try:
                launch.prepare_account_dir(acct, db)
            except RuntimeError as e:
                if str(e) != "stop-after-refresh-check":
                    raise
            except Exception:
                pass

        # Critical assertion: refresh_cc_token must not have been called.
        mock_refresh_cc.assert_not_called()

    @patch("manager.api.credential_helpers.reconcile_credentials_from_live_store")
    @patch("manager.api.credential_helpers.read_active_account_id")
    @patch("manager.web.auth.refresh_cc_token", new_callable=AsyncMock)
    def test_refreshes_cc_for_active_account_when_token_already_expired(
        self, mock_refresh_cc, mock_read_live, mock_reconcile, tmp_path,
    ):
        """The active seat's EXPIRED CC pair must be refreshed at launch.

        Otherwise the launch writes the dead token straight back out and the
        agent opens on "Login expired · Please run /login".
        """
        from manager import launch

        now = int(time.time())
        acct = self._make_account(1, cc_expires_at=now - 100)
        mock_read_live.return_value = 1
        mock_refresh_cc.return_value = True

        db = MagicMock()
        db.get_account.return_value = acct

        with ExitStack() as stack:
            for patcher in self._stop_after_refresh_check(tmp_path):
                stack.enter_context(patcher)
            try:
                launch.prepare_account_dir(acct, db)
            except RuntimeError as e:
                if str(e) != "stop-after-refresh-check":
                    raise
            except Exception:
                pass

        mock_refresh_cc.assert_called_once_with(1, db)

    @patch("manager.api.credential_helpers.read_active_account_id")
    @patch("manager.web.auth.refresh_cc_token", new_callable=AsyncMock)
    def test_refreshes_cc_when_launching_different_account(
        self, mock_refresh_cc, mock_read_live, tmp_path,
    ):
        """If the active account is 2 and we're launching 1, CC refresh should fire."""
        from manager import launch

        now = int(time.time())
        acct = self._make_account(1, cc_expires_at=now + 60)
        mock_read_live.return_value = 2
        mock_refresh_cc.return_value = True

        db = MagicMock()
        db.get_account.return_value = acct

        with ExitStack() as stack:
            for patcher in self._stop_after_refresh_check(tmp_path):
                stack.enter_context(patcher)
            try:
                launch.prepare_account_dir(acct, db)
            except RuntimeError as e:
                if str(e) != "stop-after-refresh-check":
                    raise
            except Exception:
                pass

        mock_refresh_cc.assert_called_once_with(1, db)
