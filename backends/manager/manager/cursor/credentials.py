"""Read Cursor IDE auth from state.vscdb (read-only).

Cursor stores its session inside the IDE's own SQLite state database. The
running app holds that file open and rewrites it on exit, so this module NEVER
writes — reading is done through an immutable/read-only URI so we cannot
corrupt a live session by accident.
"""

from __future__ import annotations

import logging
import os
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping, Optional

from .wsl import is_wsl, windows_drive_mounts

logger = logging.getLogger(__name__)

# Where Cursor keeps globalStorage under a Windows user profile, relative to the
# drive mount. Globbed per drive under WSL, never touched elsewhere.
_WINDOWS_PROFILE_GLOB = "Users/*/AppData/Roaming/Cursor/User/globalStorage/state.vscdb"

# Keys Cursor writes into ItemTable. Exact set varies by version; we probe all
# known aliases and take the first hit.
_ACCESS_KEYS = (
    "cursorAuth/accessToken",
    "cursorAuth/cachedAccessToken",
)
_REFRESH_KEYS = (
    "cursorAuth/refreshToken",
    "cursorAuth/cachedRefreshToken",
)
_EMAIL_KEYS = (
    "cursorAuth/cachedEmail",
    "cursorAuth/email",
)
_MEMBERSHIP_KEYS = (
    "cursorAuth/stripeMembershipType",
    "cursorAuth/membershipType",
    "cursorAuth/cachedSignUpType",
)


def _native_state_db_path(env: Mapping[str, str]) -> Path:
    """The platform's own Cursor ``state.vscdb`` location."""
    if os.name == "nt":
        appdata = env.get("APPDATA") or str(Path.home() / "AppData" / "Roaming")
        return Path(appdata) / "Cursor" / "User" / "globalStorage" / "state.vscdb"
    if sys_platform_is_darwin(env):
        return (
            Path.home()
            / "Library"
            / "Application Support"
            / "Cursor"
            / "User"
            / "globalStorage"
            / "state.vscdb"
        )
    xdg = env.get("XDG_CONFIG_HOME")
    base = Path(xdg) if xdg else Path.home() / ".config"
    return base / "Cursor" / "User" / "globalStorage" / "state.vscdb"


def _windows_mount_state_db_paths() -> list[Path]:
    """Cursor DBs on mounted Windows drives — WSL only, never raises.

    A 9p/DrvFs hiccup must degrade to "not found" rather than blow up
    ``detect_cursor_account``, which callers rely on to never raise.
    """
    found: list[Path] = []
    for mount in windows_drive_mounts():
        try:
            found.extend(sorted(mount.glob(_WINDOWS_PROFILE_GLOB)))
        except OSError:
            logger.debug("cursor state.vscdb glob failed under %s", mount, exc_info=True)
            continue
    return found


def cursor_state_db_candidates(env: Optional[Mapping[str, str]] = None) -> list[Path]:
    """Every place Cursor's ``state.vscdb`` could live, best guess first.

    Under WSL the manager is Linux but Cursor is a Windows app, so the native
    XDG path does not exist and the real DB sits on a ``/mnt/<drive>`` profile.
    The ``/mnt`` walk is gated on WSL: a plain Linux server must never enumerate
    mounts that may be slow network shares.
    """
    env = env if env is not None else os.environ
    override = env.get("CURSOR_STATE_VSCDB")
    if override:
        return [Path(override).expanduser()]
    candidates = [_native_state_db_path(env)]
    if is_wsl(env):
        candidates.extend(_windows_mount_state_db_paths())
    return candidates


def cursor_state_db_path(env: Optional[Mapping[str, str]] = None) -> Path:
    """Resolve the Cursor ``state.vscdb`` path for the current platform.

    Returns the first candidate that exists, else the first candidate — so a
    host with no Cursor at all still reports the platform-native path in the
    "not found" message.
    """
    candidates = cursor_state_db_candidates(env)
    for candidate in candidates:
        try:
            if candidate.exists():
                return candidate
        except OSError:
            continue
    return candidates[0]


def sys_platform_is_darwin(env: Optional[Mapping[str, str]] = None) -> bool:
    import sys

    return sys.platform == "darwin"


def _open_readonly(db_path: Path) -> sqlite3.Connection:
    """Open state.vscdb read-only + immutable so we cannot write even by bug."""
    uri = db_path.resolve().as_uri() + "?mode=ro&immutable=1"
    return sqlite3.connect(uri, uri=True, timeout=2.0)


def _read_key(conn: sqlite3.Connection, keys: tuple[str, ...]) -> Optional[str]:
    for key in keys:
        try:
            row = conn.execute(
                "SELECT value FROM ItemTable WHERE key = ?", (key,)
            ).fetchone()
        except sqlite3.Error:
            continue
        if row is None:
            continue
        value = row[0]
        if isinstance(value, bytes):
            try:
                value = value.decode("utf-8")
            except UnicodeDecodeError:
                continue
        if isinstance(value, str) and len(value) > 0:
            # Some Cursor builds store JSON-quoted strings.
            if value.startswith('"') and value.endswith('"') and len(value) >= 2:
                value = value[1:-1]
            return value
    return None


def read_cursor_auth(
    db_path: Optional[Path] = None, env: Optional[Mapping[str, str]] = None
) -> Optional[dict]:
    """Return ``{access_token, refresh_token, email, membership_type}`` or None.

    Never returns raw tokens to log sinks — callers must treat the dict as
    secret. Returns None when the DB is missing or has no access token.
    """
    path = db_path or cursor_state_db_path(env)
    if not path.exists():
        return None
    try:
        conn = _open_readonly(path)
    except sqlite3.Error:
        logger.debug("cursor state.vscdb unreadable at %s", path, exc_info=True)
        return None
    try:
        access = _read_key(conn, _ACCESS_KEYS)
        if access is None:
            return None
        return {
            "access_token":    access,
            "refresh_token":   _read_key(conn, _REFRESH_KEYS),
            "email":           _read_key(conn, _EMAIL_KEYS),
            "membership_type": _read_key(conn, _MEMBERSHIP_KEYS),
        }
    finally:
        conn.close()


@dataclass
class CursorIdentity:
    email: Optional[str]
    membership_type: Optional[str]
    has_access_token: bool


@dataclass
class CursorCredentialStatus:
    present: bool
    swappable: bool
    reason: Optional[str]
    identity: Optional[CursorIdentity]
    db_path: Path


def detect_cursor_account(
    db_path: Optional[Path] = None, env: Optional[Mapping[str, str]] = None
) -> CursorCredentialStatus:
    """Probe Cursor's state DB. ``swappable`` is True only when auth is present —

    actual swapping is still gated on Cursor not running (see switching.py).
    """
    path = db_path or cursor_state_db_path(env)
    if not path.exists():
        return CursorCredentialStatus(
            present=False,
            swappable=False,
            reason="Cursor state.vscdb not found — open Cursor and sign in once",
            identity=None,
            db_path=path,
        )
    auth = read_cursor_auth(path, env)
    if auth is None:
        return CursorCredentialStatus(
            present=False,
            swappable=False,
            reason="Cursor is installed but no cursorAuth/* keys found — sign in first",
            identity=None,
            db_path=path,
        )
    identity = CursorIdentity(
        email=auth.get("email"),
        membership_type=auth.get("membership_type"),
        has_access_token=True,
    )
    return CursorCredentialStatus(
        present=True,
        swappable=True,
        reason=None,
        identity=identity,
        db_path=path,
    )
