"""Add / import a Cursor account into manager.

The live credential stays in Cursor's state.vscdb. On import we snapshot the
auth keys under ``~/.cursor-jacked/accounts/<id>/`` so a later manual switch
has something to write back. Secrets are never logged.
"""

from __future__ import annotations

import json
import logging
import os
import tempfile
import time
from pathlib import Path
from typing import Mapping, Optional

from .credentials import (
    cursor_state_db_path,
    detect_cursor_account,
    read_cursor_auth,
)

logger = logging.getLogger(__name__)

CURSOR_EXPIRES_SENTINEL = 4102444800  # 2100-01-01T00:00:00Z


class CursorImportError(Exception):
    """A Cursor account could not be added."""


class CursorReimportError(Exception):
    """An existing Cursor account could not be re-imported from the IDE."""


def cursor_jacked_home(env: Optional[Mapping[str, str]] = None) -> Path:
    env = env if env is not None else os.environ
    raw = env.get("CURSOR_JACKED_HOME")
    if raw:
        return Path(raw).expanduser()
    return Path.home() / ".cursor-jacked"


def cursor_account_slot(account_id: int, env: Optional[Mapping[str, str]] = None) -> Path:
    return cursor_jacked_home(env) / "accounts" / str(account_id) / "auth.json"


def _write_slot(account_id: int, auth: dict, env: Optional[Mapping[str, str]] = None) -> None:
    path = cursor_account_slot(account_id, env)
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(path.parent, 0o700)
        os.chmod(path.parent.parent, 0o700)
    except OSError:
        pass
    # Only persist the auth fields we understand — never dump unrelated IDE state.
    snapshot = {
        "access_token":    auth.get("access_token"),
        "refresh_token":   auth.get("refresh_token"),
        "email":           auth.get("email"),
        "membership_type": auth.get("membership_type"),
    }
    payload = json.dumps(snapshot, indent=2) + "\n"
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".auth-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(payload)
        os.chmod(tmp, 0o600)
        from manager.api.credential_helpers import _safe_replace

        _safe_replace(tmp, str(path))
        tmp = None
    finally:
        if tmp is not None and os.path.exists(tmp):
            os.unlink(tmp)


def import_cursor_account(
    db,
    db_path: Optional[Path] = None,
    env: Optional[Mapping[str, str]] = None,
    make_active: bool = False,
) -> dict:
    """Persist a ``provider='cursor'`` account from the live state.vscdb."""
    status = detect_cursor_account(db_path, env)
    ident = status.identity
    if not status.present or ident is None:
        raise CursorImportError(
            status.reason or "no Cursor account found — sign in to Cursor first"
        )
    email = ident.email or "cursor-user@local"
    auth = read_cursor_auth(db_path or cursor_state_db_path(env), env)
    if auth is None:
        raise CursorImportError("Cursor auth keys disappeared during import")

    acct = db.create_account(
        email=email,
        access_token="cursor-managed",
        expires_at=CURSOR_EXPIRES_SENTINEL,
        refresh_token=None,
        subscription_type=ident.membership_type,
        organization_uuid="",
        provider="cursor",
    )
    _write_slot(acct["id"], auth, env)
    if make_active:
        db.set_active_account_id(acct["id"], provider="cursor")
    logger.info("Imported cursor account %s (%s)", acct["id"], email)
    return acct


def add_cursor_account(
    db,
    db_path: Optional[Path] = None,
    env: Optional[Mapping[str, str]] = None,
    make_active: bool = True,
) -> dict:
    """Import the currently signed-in Cursor account from state.vscdb.

    Cursor's browser auth/poll flow is owned by the IDE. jacked only imports
    whatever the IDE has already written — there is no safe way to drive the
    poll from a background API without racing the running app.
    """
    return import_cursor_account(db, db_path=db_path, env=env, make_active=make_active)


def _normalize_cursor_email(email: str | None) -> str:
    return (email or "cursor-user@local").strip().lower()


def reimport_cursor_account(
    account_id: int,
    db,
    db_path: Optional[Path] = None,
    env: Optional[Mapping[str, str]] = None,
) -> dict:
    """Refresh an existing Cursor row's slot snapshot from the live IDE session."""
    account = db.get_account(account_id)
    if not account:
        raise CursorReimportError(f"No account with id={account_id}")
    if (account.get("provider") or "") != "cursor":
        raise CursorReimportError(
            f"Account {account_id} is not a Cursor account — re-import is Cursor-only."
        )

    status = detect_cursor_account(db_path, env)
    ident = status.identity
    if not status.present or ident is None:
        raise CursorReimportError(
            status.reason or "no Cursor account found — sign in to Cursor first"
        )

    live_email = _normalize_cursor_email(ident.email)
    row_email = _normalize_cursor_email(account.get("email"))
    if live_email != row_email:
        raise CursorReimportError(
            f"Cursor IDE is signed in as {ident.email or live_email}, "
            f"but account {account_id} is {account.get('email')}. "
            "Sign in to the matching account or import a new seat."
        )

    auth = read_cursor_auth(db_path or cursor_state_db_path(env), env)
    if auth is None:
        raise CursorReimportError("Cursor auth keys disappeared during re-import")

    _write_slot(account_id, auth, env)
    db.clear_account_errors(account_id)
    db.update_account(account_id, validation_status="valid", last_validated_at=int(time.time()))
    logger.info("Re-imported cursor account %s (%s)", account_id, account.get("email"))
    updated = db.get_account(account_id)
    return updated or account


def read_cursor_slot_auth(account_id: int, env: Optional[Mapping[str, str]] = None) -> dict | None:
    """Read the persisted slot snapshot for a Cursor account."""
    path = cursor_account_slot(account_id, env)
    if not path.is_file():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict):
        return None
    return payload


def ensure_cursor_launch_credential(
    account_id: int,
    db,
    db_path: Optional[Path] = None,
    env: Optional[Mapping[str, str]] = None,
) -> str:
    """Return a non-empty Cursor API key, refreshing the slot from IDE when needed."""
    account = db.get_account(account_id)
    if not account or (account.get("provider") or "") != "cursor":
        raise CursorReimportError(f"Account {account_id} is not a Cursor account")

    slot_auth = read_cursor_slot_auth(account_id, env)
    api_key = ""
    if isinstance(slot_auth, dict) and isinstance(slot_auth.get("access_token"), str):
        api_key = slot_auth["access_token"].strip()
    if len(api_key) > 0:
        return api_key

    try:
        reimport_cursor_account(account_id, db, db_path=db_path, env=env)
    except CursorReimportError:
        raise
    slot_auth = read_cursor_slot_auth(account_id, env)
    api_key = ""
    if isinstance(slot_auth, dict) and isinstance(slot_auth.get("access_token"), str):
        api_key = slot_auth["access_token"].strip()
    if len(api_key) == 0:
        raise CursorReimportError(
            f"No Cursor credential snapshot for account {account_id}. Re-import from Cursor."
        )
    return api_key
