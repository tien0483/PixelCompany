"""Manual-only Cursor account switching.

Cursor holds its session inside state.vscdb. The running IDE keeps that file
open and overwrites it on exit, so an automated swap corrupts the session.
``manager.providers`` sets ``can_auto_swap=False`` for Cursor; this module
enforces the same rule at the call site: refuse unless Cursor is not running,
back up the DB first, then write the slot snapshot.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import sqlite3
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping, Optional

from manager.providers import auto_swap_block_reason, can_auto_swap

from .accounts import cursor_account_slot
from .credentials import cursor_state_db_path

logger = logging.getLogger(__name__)


class CursorSwapError(Exception):
    """A Cursor account swap was refused or failed."""


@dataclass
class CursorSwapResult:
    ok: bool
    target_id: int
    outgoing_id: Optional[int]
    backup_path: Optional[str]
    restart_required: bool


def is_cursor_running(env: Optional[Mapping[str, str]] = None) -> bool:
    """Return True if a Cursor process appears to be running.

    Fail-closed: if the probe itself errors, treat Cursor as running so we
    refuse a write rather than risk corrupting state.vscdb.
    """
    env = env if env is not None else os.environ
    try:
        if os.name == "nt":
            # Unfiltered tasklist so Helper / GPU / Renderer children also match.
            result = subprocess.run(
                ["tasklist", "/NH"],
                capture_output=True,
                text=True,
                timeout=5,
                env=dict(env),
            )
            out = (result.stdout or "").lower()
            return "cursor.exe" in out or "cursor helper" in out
        result = subprocess.run(
            ["pgrep", "-if", "Cursor"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        return result.returncode == 0 and len((result.stdout or "").strip()) > 0
    except (OSError, subprocess.SubprocessError):
        logger.warning(
            "cursor process probe failed — refusing swap (fail-closed)",
            exc_info=True,
        )
        return True


def backup_state_vscdb(
    db_path: Optional[Path] = None, env: Optional[Mapping[str, str]] = None
) -> Path:
    """Copy state.vscdb to a timestamped backup next to it."""
    path = db_path or cursor_state_db_path(env)
    if not path.exists():
        raise CursorSwapError(f"state.vscdb not found at {path}")
    stamp = time.strftime("%Y%m%d-%H%M%S")
    backup = path.with_name(f"state.vscdb.jacked-backup-{stamp}")
    shutil.copy2(path, backup)
    return backup


def _write_auth_keys(db_path: Path, auth: dict) -> None:
    """Write cursorAuth/* keys into state.vscdb. Caller must ensure Cursor is closed."""
    conn = sqlite3.connect(str(db_path), timeout=5.0)
    try:
        mapping = {
            "cursorAuth/accessToken":          auth.get("access_token"),
            "cursorAuth/refreshToken":         auth.get("refresh_token"),
            "cursorAuth/cachedEmail":          auth.get("email"),
            "cursorAuth/stripeMembershipType": auth.get("membership_type"),
        }
        for key, value in mapping.items():
            if value is None:
                continue
            conn.execute(
                "INSERT INTO ItemTable(key, value) VALUES(?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (key, str(value)),
            )
        conn.commit()
    finally:
        conn.close()


def swap_cursor_account(
    account_id: int,
    db,
    *,
    force: bool = False,
    db_path: Optional[Path] = None,
    env: Optional[Mapping[str, str]] = None,
) -> CursorSwapResult:
    """Manually activate a Cursor account. Never called from auto-swap.

    Raises ``CursorSwapError`` when Cursor is running (unless ``force=True``,
    which still warns via the provider block reason and is strongly discouraged).
    """
    if can_auto_swap("cursor"):
        # Defensive: the registry must keep Cursor manual-only. If someone
        # flips the flag, refuse here rather than silently automate.
        raise CursorSwapError(
            "cursor auto-swap flag is unexpectedly True — refusing for safety"
        )
    account = db.get_account(account_id)
    if account is None:
        raise CursorSwapError(f"account {account_id} not found")
    if (account.get("provider") or "") != "cursor":
        raise CursorSwapError(f"account {account_id} is not a cursor account")

    if is_cursor_running(env) and not force:
        reason = auto_swap_block_reason("cursor") or "Close Cursor before switching."
        raise CursorSwapError(reason)

    slot = cursor_account_slot(account_id, env)
    if not slot.exists():
        raise CursorSwapError(
            f"no credential snapshot for account {account_id} — re-import from Cursor"
        )
    try:
        auth = json.loads(slot.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        raise CursorSwapError(f"credential snapshot unreadable: {exc}") from exc
    if not isinstance(auth, dict) or not auth.get("access_token"):
        raise CursorSwapError("credential snapshot has no access_token")

    path = db_path or cursor_state_db_path(env)
    backup = backup_state_vscdb(path, env)
    _write_auth_keys(path, auth)
    outgoing_id = db.get_active_account_id(provider="cursor")
    db.set_active_account_id(account_id, provider="cursor")
    logger.info(
        "Manually swapped cursor account %s -> %s (backup %s)",
        outgoing_id, account_id, backup,
    )
    return CursorSwapResult(
        ok=True,
        target_id=account_id,
        outgoing_id=outgoing_id,
        backup_path=str(backup),
        restart_required=True,
    )
