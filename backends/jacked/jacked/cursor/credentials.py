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

logger = logging.getLogger(__name__)

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


def cursor_state_db_path(env: Optional[Mapping[str, str]] = None) -> Path:
    """Resolve the Cursor ``state.vscdb`` path for the current platform."""
    env = env if env is not None else os.environ
    override = env.get("CURSOR_STATE_VSCDB")
    if override:
        return Path(override).expanduser()
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
