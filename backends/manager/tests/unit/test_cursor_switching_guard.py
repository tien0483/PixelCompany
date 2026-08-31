"""Cursor process probe and fail-closed swap gating."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest

from manager.cursor.switching import CursorSwapError, is_cursor_running, swap_cursor_account

WINDOWS_DB = Path("/mnt/c/Users/User/AppData/Roaming/Cursor/User/globalStorage/state.vscdb")
LINUX_DB = Path("/home/someone/.config/Cursor/User/globalStorage/state.vscdb")


def _run_result(stdout: str, returncode: int = 0):
    return type("R", (), {"stdout": stdout, "returncode": returncode})()


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


def test_is_cursor_running_wsl_sees_windows_side_cursor():
    """A Windows Cursor.exe is invisible to pgrep — ask Windows via interop."""
    with patch("manager.cursor.switching.is_wsl", return_value=True):
        with patch("manager.cursor.switching.path_is_windows_mount", return_value=True):
            with patch(
                "manager.cursor.switching.subprocess.run",
                return_value=_run_result("Cursor.exe    4321 Console\n"),
            ) as run:
                assert is_cursor_running({}, WINDOWS_DB) is True
    assert run.call_args_list[0].args[0] == ["tasklist.exe", "/NH"]


def test_is_cursor_running_wsl_falls_back_to_pgrep_when_windows_is_clear():
    def fake_run(command, **_kwargs):
        if command[0] == "tasklist.exe":
            return _run_result("chrome.exe    1 Console\n")
        return _run_result("", returncode=1)

    with patch("manager.cursor.switching.is_wsl", return_value=True):
        with patch("manager.cursor.switching.path_is_windows_mount", return_value=True):
            with patch("manager.cursor.switching.subprocess.run", side_effect=fake_run) as run:
                assert is_cursor_running({}, WINDOWS_DB) is False
    assert [call.args[0][0] for call in run.call_args_list] == ["tasklist.exe", "pgrep"]


def test_is_cursor_running_fail_closed_when_interop_is_missing():
    with patch("manager.cursor.switching.is_wsl", return_value=True):
        with patch("manager.cursor.switching.path_is_windows_mount", return_value=True):
            with patch(
                "manager.cursor.switching.subprocess.run",
                side_effect=FileNotFoundError("tasklist.exe"),
            ):
                assert is_cursor_running({}, WINDOWS_DB) is True


def test_is_cursor_running_wsl_native_db_skips_tasklist():
    with patch("manager.cursor.switching.is_wsl", return_value=True):
        with patch("manager.cursor.switching.path_is_windows_mount", return_value=False):
            with patch(
                "manager.cursor.switching.subprocess.run",
                return_value=_run_result("", returncode=1),
            ) as run:
                assert is_cursor_running({}, LINUX_DB) is False
    assert [call.args[0][0] for call in run.call_args_list] == ["pgrep"]


def test_swap_refuses_when_registry_allows_auto_swap(monkeypatch):
    monkeypatch.setattr("manager.cursor.switching.can_auto_swap", lambda _p: True)
    with pytest.raises(CursorSwapError, match="unexpectedly True"):
        swap_cursor_account(1, db=None)  # type: ignore[arg-type]
