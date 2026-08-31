"""Cursor state.vscdb resolution across Linux, WSL, and the env override."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

from manager.cursor.credentials import (
    cursor_state_db_candidates,
    cursor_state_db_path,
    detect_cursor_account,
)
from manager.cursor.wsl import path_is_windows_mount, windows_drive_mounts

XDG_SUFFIX = Path("Cursor/User/globalStorage/state.vscdb")
PROFILE_SUFFIX = Path("Users/User/AppData/Roaming/Cursor/User/globalStorage/state.vscdb")


def _make_windows_mount(root: Path, drive: str = "c") -> Path:
    db = root / drive / PROFILE_SUFFIX
    db.parent.mkdir(parents=True, exist_ok=True)
    db.write_bytes(b"")
    return db


def test_env_override_is_the_only_candidate(tmp_path):
    override = tmp_path / "custom" / "state.vscdb"
    env = {"CURSOR_STATE_VSCDB": str(override)}
    with patch("manager.cursor.credentials.windows_drive_mounts") as mounts:
        assert cursor_state_db_candidates(env) == [override]
        assert cursor_state_db_path(env) == override
    mounts.assert_not_called()


def test_plain_linux_never_walks_windows_mounts(tmp_path):
    env = {"XDG_CONFIG_HOME": str(tmp_path)}
    with patch("manager.cursor.credentials.is_wsl", return_value=False):
        with patch("manager.cursor.credentials.windows_drive_mounts") as mounts:
            candidates = cursor_state_db_candidates(env)
    mounts.assert_not_called()
    assert candidates == [tmp_path / XDG_SUFFIX]


def test_wsl_finds_the_windows_profile_db(tmp_path):
    mount_root = tmp_path / "mnt"
    db = _make_windows_mount(mount_root)
    env = {"XDG_CONFIG_HOME": str(tmp_path / "xdg")}

    with patch("manager.cursor.credentials.is_wsl", return_value=True):
        with patch(
            "manager.cursor.credentials.windows_drive_mounts",
            return_value=[mount_root / "c"],
        ):
            candidates = cursor_state_db_candidates(env)
            # The XDG path does not exist, so the Windows-side DB wins.
            assert cursor_state_db_path(env) == db

    assert candidates == [tmp_path / "xdg" / XDG_SUFFIX, db]


def test_wsl_glob_failure_degrades_to_native_path(tmp_path):
    env = {"XDG_CONFIG_HOME": str(tmp_path)}
    broken = tmp_path / "mnt" / "c"

    with patch("manager.cursor.credentials.is_wsl", return_value=True):
        with patch(
            "manager.cursor.credentials.windows_drive_mounts", return_value=[broken]
        ):
            with patch.object(Path, "glob", side_effect=OSError("9p is having a day")):
                candidates = cursor_state_db_candidates(env)

    assert candidates == [tmp_path / XDG_SUFFIX]


def test_missing_everywhere_keeps_the_sign_in_message(tmp_path):
    env = {"XDG_CONFIG_HOME": str(tmp_path)}
    with patch("manager.cursor.credentials.is_wsl", return_value=False):
        status = detect_cursor_account(env=env)
    assert status.present is False
    assert status.swappable is False
    assert status.reason == "Cursor state.vscdb not found — open Cursor and sign in once"
    assert status.db_path == tmp_path / XDG_SUFFIX


def test_windows_drive_mounts_skips_wsl_dirs(tmp_path):
    for name in ("c", "d", "wsl", "wslg"):
        (tmp_path / name).mkdir()
    (tmp_path / "e").write_text("not a dir")

    assert windows_drive_mounts(tmp_path) == [tmp_path / "c", tmp_path / "d"]


def test_path_is_windows_mount(tmp_path):
    (tmp_path / "c").mkdir()
    assert path_is_windows_mount(tmp_path / "c" / PROFILE_SUFFIX, tmp_path) is True
    assert path_is_windows_mount(Path.home() / ".config" / XDG_SUFFIX, tmp_path) is False


def test_windows_drive_mounts_on_unreadable_root(tmp_path):
    assert windows_drive_mounts(tmp_path / "does-not-exist") == []
