"""Import the Claude Code CLI-authenticated account into manager as a Seat.

Mirrors the Codex/Cursor "add an already-logged-in local account" flow, but for
the Claude Code credential (Keychain "Claude Code-credentials" on macOS, else
``~/.claude/.credentials.json``). The existing on-disk tokens are stored as-is —
we never mint or refresh tokens here — and the account's email/organization
identity is resolved with a single read-only profile GET using that token.
"""

from __future__ import annotations

import json
import logging
import time
from pathlib import Path

import httpx

from manager.web.oauth import (
    DEFAULT_TOKEN_TTL_SECONDS,
    OAUTH_BETA_HEADER,
    ORG_TYPE_MAP,
    PROFILE_URL,
    USAGE_URL,
)

from .credential_helpers import read_platform_credentials

logger = logging.getLogger(__name__)

_HTTP_TIMEOUT = 15.0


class ClaudeImportError(Exception):
    """The local Claude Code credential could not be imported as a Seat."""


def _read_local_oauth() -> dict | None:
    """Return the ``claudeAiOauth`` blob from the live Claude Code credential store.

    Keychain first (macOS), then ``~/.claude/.credentials.json`` — the same
    precedence Claude Code itself uses. Returns None when no usable token exists.
    """
    live = read_platform_credentials()
    if not live:
        cred_path = Path.home() / ".claude" / ".credentials.json"
        if cred_path.exists() and not cred_path.is_symlink():
            try:
                live = json.loads(cred_path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError) as exc:
                logger.debug("Claude credential file read failed: %s", exc)
                live = None
    if not isinstance(live, dict):
        return None
    oauth = live.get("claudeAiOauth")
    if isinstance(oauth, dict) and oauth.get("accessToken"):
        return oauth
    return None


def _coerce_expires_at(raw: object) -> int:
    """Claude Code stores ``expiresAt`` in epoch milliseconds; the DB wants seconds."""
    if isinstance(raw, (int, float)) and raw > 0:
        return int(raw // 1000) if raw > 1e12 else int(raw)
    return int(time.time()) + DEFAULT_TOKEN_TTL_SECONDS


async def _fetch_json(client: httpx.AsyncClient, url: str, access_token: str) -> dict:
    try:
        resp = await client.get(
            url,
            headers={
                "Authorization": f"Bearer {access_token}",
                "anthropic-beta": OAUTH_BETA_HEADER,
            },
        )
        if resp.status_code == 200:
            return resp.json()
        logger.debug("Claude %s fetch HTTP %s", url, resp.status_code)
    except (httpx.HTTPError, ValueError) as exc:
        logger.debug("Claude %s fetch failed: %s", url, exc)
    return {}


async def import_claude_cli_account(db, make_active: bool = False) -> dict:
    """Persist (or update) a ``provider='claude'`` Seat from the live CLI credential.

    The local tokens are stored verbatim; only a read-only profile lookup is made
    to resolve the account identity. Raises ``ClaudeImportError`` when there is no
    readable Claude Code login or the profile lookup yields no email.
    """
    oauth = _read_local_oauth()
    if oauth is None:
        raise ClaudeImportError(
            "no Claude Code login found — run `claude` and sign in first"
        )

    access_token = oauth["accessToken"]
    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
        profile = await _fetch_json(client, PROFILE_URL, access_token)
        usage = await _fetch_json(client, USAGE_URL, access_token)

    account = profile.get("account", {}) or {}
    org = profile.get("organization", {}) or {}
    email = account.get("email_address")
    if not email:
        raise ClaudeImportError(
            "could not resolve the Claude account email from the local login — the "
            "token may be expired; run `claude` to refresh, then try again"
        )

    org_type = org.get("organization_type", "")
    subscription_type = ORG_TYPE_MAP.get(org_type, oauth.get("subscriptionType"))
    scopes = oauth.get("scopes")

    acct = db.create_account(
        email=email,
        access_token=access_token,
        expires_at=_coerce_expires_at(oauth.get("expiresAt")),
        refresh_token=oauth.get("refreshToken"),
        display_name=account.get("display_name"),
        scopes=json.dumps(scopes) if scopes else None,
        subscription_type=subscription_type,
        rate_limit_tier=org.get("rate_limit_tier"),
        organization_uuid=org.get("uuid") or "",
        organization_name=org.get("name") or None,
        provider="claude",
    )
    db.update_account(
        acct["id"], validation_status="valid", last_validated_at=int(time.time())
    )

    five_hour = usage.get("five_hour", {}) or {}
    seven_day = usage.get("seven_day", {}) or {}
    if five_hour or seven_day:
        db.update_account_usage_cache(
            acct["id"],
            five_hour=five_hour.get("utilization"),
            seven_day=seven_day.get("utilization"),
            five_hour_resets_at=five_hour.get("resets_at"),
            seven_day_resets_at=seven_day.get("resets_at"),
            raw=usage,
        )

    if make_active:
        db.set_active_account_id(acct["id"], provider="claude")

    acct = db.get_account(acct["id"]) or acct
    logger.info("Imported Claude CLI account %s (id=%s)", email, acct.get("id"))
    return acct
