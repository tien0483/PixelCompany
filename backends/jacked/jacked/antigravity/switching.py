"""Switch the active Antigravity / Gemini account by minting tokens on demand.

Because access tokens are minted from the stored refresh token, a swap never
needs to stop a running process: write the incoming refresh token into
``~/.gemini/oauth_creds.json`` (preserving unknown fields), mint a fresh
access token, and mark the account active in the DB.
"""

from __future__ import annotations

import json
import logging
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping, Optional

from .credentials import (
    ensure_fresh_access_token,
    gemini_home,
    read_oauth_creds,
    refresh_access_token,
    write_oauth_creds,
)

logger = logging.getLogger(__name__)


class AntigravitySwapError(Exception):
    """An Antigravity account swap was refused or failed."""


@dataclass
class AntigravitySwapResult:
    ok: bool
    target_id: int
    outgoing_id: Optional[int]


def antigravity_account_home(
    account_id: int, base: Optional[Path] = None, env: Optional[Mapping[str, str]] = None
) -> Path:
    """Per-account slot: ``$GEMINI_HOME/accounts/<id>``."""
    base = base or gemini_home(env)
    return base / "accounts" / str(account_id)


def antigravity_slot_creds_path(
    account_id: int, base: Optional[Path] = None, env: Optional[Mapping[str, str]] = None
) -> Path:
    return antigravity_account_home(account_id, base, env) / "oauth_creds.json"


def seed_antigravity_slot(
    account_id: int,
    creds: dict,
    home: Optional[Path] = None,
    env: Optional[Mapping[str, str]] = None,
) -> Path:
    """Persist a full oauth_creds snapshot into the account's slot at mode 0600."""
    path = antigravity_slot_creds_path(account_id, home, env)
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(path.parent, 0o700)
    except OSError:
        pass
    payload = json.dumps(creds, indent=2) + "\n"
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".slot-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(payload)
        os.chmod(tmp, 0o600)
        from jacked.api.credential_helpers import _safe_replace

        _safe_replace(tmp, str(path))
        tmp = None
    finally:
        if tmp is not None and os.path.exists(tmp):
            os.unlink(tmp)
    return path


def _load_slot_or_db_creds(account_id: int, db, home: Path, env) -> dict:
    """Build a creds dict from the slot file, falling back to the DB refresh token."""
    slot = antigravity_slot_creds_path(account_id, home, env)
    if slot.exists():
        try:
            data = json.loads(slot.read_text(encoding="utf-8"))
            if isinstance(data, dict) and isinstance(data.get("refresh_token"), str):
                return data
        except (OSError, json.JSONDecodeError, ValueError):
            logger.debug("antigravity slot unreadable for %s", account_id, exc_info=True)
    account = db.get_account(account_id)
    if account is None:
        raise AntigravitySwapError(f"account {account_id} not found")
    refresh = account.get("refresh_token")
    if not isinstance(refresh, str) or len(refresh) == 0:
        raise AntigravitySwapError(
            f"account {account_id} has no refresh_token — re-import from ~/.gemini"
        )
    return {"refresh_token": refresh, "token_type": "Bearer"}


def swap_antigravity_account(
    account_id: int,
    db,
    home: Optional[Path] = None,
    env: Optional[Mapping[str, str]] = None,
) -> AntigravitySwapResult:
    """Activate ``account_id`` by writing its refresh token into the live oauth file."""
    home = home or gemini_home(env)
    account = db.get_account(account_id)
    if account is None:
        raise AntigravitySwapError(f"account {account_id} not found")
    if (account.get("provider") or "") != "antigravity":
        raise AntigravitySwapError(f"account {account_id} is not an antigravity account")

    outgoing_id = db.get_active_account_id(provider="antigravity")
    live = read_oauth_creds(home, env) or {}
    # Capture the live session into the outgoing slot before overwriting.
    if outgoing_id is not None and outgoing_id != account_id and live.get("refresh_token"):
        seed_antigravity_slot(outgoing_id, live, home=home, env=env)

    incoming = _load_slot_or_db_creds(account_id, db, home, env)
    # Preserve unknown live fields so Gemini CLI extras survive the swap.
    merged = dict(live)
    merged.update({k: v for k, v in incoming.items() if v is not None})
    try:
        merged = refresh_access_token(merged, env)
    except ValueError as exc:
        raise AntigravitySwapError(str(exc)) from exc
    write_oauth_creds(merged, home, env)
    seed_antigravity_slot(account_id, merged, home=home, env=env)
    db.set_active_account_id(account_id, provider="antigravity")
    logger.info(
        "Swapped antigravity account %s -> %s (%s)",
        outgoing_id, account_id, account.get("email"),
    )
    return AntigravitySwapResult(
        ok=True, target_id=account_id, outgoing_id=outgoing_id
    )


def mint_live_token(
    home: Optional[Path] = None, env: Optional[Mapping[str, str]] = None
) -> dict:
    """Ensure the live oauth_creds access token is fresh; return the creds dict."""
    return ensure_fresh_access_token(home=home, env=env)
