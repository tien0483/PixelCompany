"""Add / import an Antigravity (Gemini OAuth) account into jacked.

Tokens stay in ``~/.gemini/oauth_creds.json``. The DB row holds identity plus
the refresh token so auto-swap can mint a fresh access token on demand without
needing the live file for every non-active account.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Mapping, Optional

from .credentials import (
    detect_antigravity_account,
    gemini_home,
    read_oauth_creds,
)

logger = logging.getLogger(__name__)

ANTIGRAVITY_EXPIRES_SENTINEL = 4102444800  # 2100-01-01T00:00:00Z


class AntigravityImportError(Exception):
    """An Antigravity account could not be added."""


def import_antigravity_account(
    db,
    home: Optional[Path] = None,
    env: Optional[Mapping[str, str]] = None,
    make_active: bool = False,
) -> dict:
    """Persist (or update) a ``provider='antigravity'`` account from live oauth creds."""
    home = home if home is not None else gemini_home(env)
    status = detect_antigravity_account(home, env)
    ident = status.identity
    if not status.swappable or ident is None or not ident.email:
        raise AntigravityImportError(
            status.reason or "no Antigravity/Gemini account found — log in first"
        )
    creds = read_oauth_creds(home, env) or {}
    refresh = creds.get("refresh_token")
    if not isinstance(refresh, str) or len(refresh) == 0:
        raise AntigravityImportError("oauth_creds.json has no refresh_token")

    expires_at = ident.expires_at or ANTIGRAVITY_EXPIRES_SENTINEL
    acct = db.create_account(
        email=ident.email,
        access_token="antigravity-managed",
        expires_at=expires_at,
        refresh_token=refresh,
        subscription_type=ident.tier,
        organization_uuid="",
        provider="antigravity",
    )
    # Keep a copy of the refresh token in the slot so non-active accounts can
    # still be swapped in later without re-reading a different live session.
    from .switching import seed_antigravity_slot

    seed_antigravity_slot(acct["id"], creds, home=home, env=env)

    if make_active:
        db.set_active_account_id(acct["id"], provider="antigravity")
    logger.info("Imported antigravity account %s (%s)", acct["id"], ident.email)
    return acct


def add_antigravity_account(
    db,
    home: Optional[Path] = None,
    env: Optional[Mapping[str, str]] = None,
    make_active: bool = True,
) -> dict:
    """Import the currently logged-in Antigravity/Gemini account."""
    return import_antigravity_account(db, home=home, env=env, make_active=make_active)
