"""Cursor process probe and fail-closed swap gating."""

from __future__ import annotations

from unittest.mock import patch

import pytest

from manager.cursor.switching import CursorSwapError, is_cursor_running, swap_cursor_account


def test_is_cursor_running_fail_closed_on_probe_error():
    with patch("manager.cursor.switching.subprocess.run", side_effect=OSError("boom")):
        assert is_cursor_running() is True


def test_is_cursor_running_windows_matches_helper():
    with patch("manager.cursor.switching.os.name", "nt"):
        with patch(
            "manager.cursor.switching.subprocess.run",
            return_value=type("R", (), {"stdout": "Cursor Helper (GPU).exe    123 Console\n"})(),
        ):
            assert is_cursor_running() is True


def test_swap_refuses_when_registry_allows_auto_swap(monkeypatch):
    monkeypatch.setattr("manager.cursor.switching.can_auto_swap", lambda _p: True)
    with pytest.raises(CursorSwapError, match="unexpectedly True"):
        swap_cursor_account(1, db=None)  # type: ignore[arg-type]
