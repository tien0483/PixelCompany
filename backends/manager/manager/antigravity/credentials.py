"""Antigravity / Gemini CLI OAuth credentials.

Credentials live in ``~/.gemini/oauth_creds.json`` (shared by Gemini CLI and
Antigravity). Access tokens are short-lived and minted from the refresh token
on demand, so a swap never needs to interrupt a running process — write the
refresh token, mint a fresh access token, and leave unknown fields intact so
the CLI keeps working.
"""

from __future__ import annotations

import json
import logging
import os
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping, Optional

import httpx

from manager.codex.credentials import decode_jwt_claims

logger = logging.getLogger(__name__)

# Public installed-app OAuth client shipped inside the Gemini CLI binary.
# Overridable via env for forks that rebrand the client.
_DEFAULT_CLIENT_ID = (
    "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com"
)
_DEFAULT_CLIENT_SECRET = "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"
_TOKEN_URL = "https://oauth2.googleapis.com/token"


def gemini_home(env: Optional[Mapping[str, str]] = None) -> Path:
    """Resolve GEMINI_HOME (``$GEMINI_HOME`` or ``~/.gemini``)."""
    env = env if env is not None else os.environ
    raw = env.get("GEMINI_HOME")
    if raw:
        return Path(raw).expanduser()
    return Path.home() / ".gemini"


def oauth_client_id(env: Optional[Mapping[str, str]] = None) -> str:
    env = env if env is not None else os.environ
    return (env.get("GEMINI_OAUTH_CLIENT_ID") or _DEFAULT_CLIENT_ID).strip()


def oauth_client_secret(env: Optional[Mapping[str, str]] = None) -> str:
    env = env if env is not None else os.environ
    return (env.get("GEMINI_OAUTH_CLIENT_SECRET") or _DEFAULT_CLIENT_SECRET).strip()


def read_oauth_creds(
    home: Optional[Path] = None, env: Optional[Mapping[str, str]] = None
) -> Optional[dict]:
    """Parse ``oauth_creds.json``; ``None`` if missing or unreadable."""
    home = home or gemini_home(env)
    path = home / "oauth_creds.json"
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, ValueError):
        logger.debug("oauth_creds.json unreadable at %s", path, exc_info=True)
        return None
    return data if isinstance(data, dict) else None


def read_google_accounts(
    home: Optional[Path] = None, env: Optional[Mapping[str, str]] = None
) -> Optional[dict]:
    """Parse ``google_accounts.json``; ``None`` if missing or unreadable."""
    home = home or gemini_home(env)
    path = home / "google_accounts.json"
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, ValueError):
        logger.debug("google_accounts.json unreadable at %s", path, exc_info=True)
        return None
    return data if isinstance(data, dict) else None


def write_oauth_creds(
    data: dict,
    home: Optional[Path] = None,
    env: Optional[Mapping[str, str]] = None,
) -> None:
    """Atomically write ``oauth_creds.json`` at mode 0600, preserving unknown fields.

    Callers must pass the full dict (read → mutate → write). We never drop keys
    we did not understand: Gemini CLI and Antigravity both store extra fields.
    """
    home = home or gemini_home(env)
    home.mkdir(parents=True, exist_ok=True)
    path = home / "oauth_creds.json"
    mode = 0o600
    try:
        mode = path.stat().st_mode & 0o777
    except OSError:
        pass
    payload = json.dumps(data, indent=2, sort_keys=False) + "\n"
    fd, tmp = tempfile.mkstemp(dir=str(home), prefix=".oauth-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(payload)
        os.chmod(tmp, mode)
        from manager.api.credential_helpers import _safe_replace

        _safe_replace(tmp, str(path))
        tmp = None
    finally:
        if tmp is not None and os.path.exists(tmp):
            os.unlink(tmp)


def refresh_access_token(
    creds: dict, env: Optional[Mapping[str, str]] = None
) -> dict:
    """Refresh the access token in-place and return the merged creds dict.

    Preserves every unknown field from the input. Raises ``ValueError`` when
    there is no refresh token or the token endpoint rejects the request.
    """
    refresh = creds.get("refresh_token")
    if not isinstance(refresh, str) or len(refresh) == 0:
        raise ValueError("oauth_creds.json has no refresh_token")
    form = {
        "client_id":     oauth_client_id(env),
        "client_secret": oauth_client_secret(env),
        "refresh_token": refresh,
        "grant_type":    "refresh_token",
    }
    with httpx.Client(timeout=20.0) as client:
        resp = client.post(_TOKEN_URL, data=form)
    if resp.status_code >= 400:
        raise ValueError(f"token refresh failed: HTTP {resp.status_code}")
    body = resp.json()
    if not isinstance(body, dict) or "access_token" not in body:
        raise ValueError("token refresh returned no access_token")
    merged = dict(creds)
    merged["access_token"] = body["access_token"]
    if isinstance(body.get("refresh_token"), str) and len(body["refresh_token"]) > 0:
        merged["refresh_token"] = body["refresh_token"]
    if isinstance(body.get("id_token"), str) and len(body["id_token"]) > 0:
        merged["id_token"] = body["id_token"]
    if isinstance(body.get("expires_in"), (int, float)):
        merged["expiry_date"] = int(time.time() * 1000) + int(body["expires_in"]) * 1000
    if isinstance(body.get("scope"), str):
        merged["scope"] = body["scope"]
    if isinstance(body.get("token_type"), str):
        merged["token_type"] = body["token_type"]
    return merged


def ensure_fresh_access_token(
    home: Optional[Path] = None,
    env: Optional[Mapping[str, str]] = None,
    skew_seconds: int = 120,
) -> dict:
    """Return live creds, refreshing when the access token is within ``skew_seconds``."""
    home = home or gemini_home(env)
    creds = read_oauth_creds(home, env)
    if creds is None:
        raise ValueError("no ~/.gemini/oauth_creds.json — run `gemini` login first")
    expiry_ms = creds.get("expiry_date")
    now_ms = int(time.time() * 1000)
    needs_refresh = (
        not isinstance(creds.get("access_token"), str)
        or not isinstance(expiry_ms, (int, float))
        or expiry_ms <= now_ms + skew_seconds * 1000
    )
    if needs_refresh:
        creds = refresh_access_token(creds, env)
        write_oauth_creds(creds, home, env)
    return creds


@dataclass
class AntigravityIdentity:
    """Who an Antigravity / Gemini account is."""

    email: Optional[str]
    tier: Optional[str]
    project_id: Optional[str]
    expires_at: Optional[int]


def extract_identity(
    creds: Mapping, accounts: Optional[Mapping] = None
) -> AntigravityIdentity:
    """Derive identity from oauth creds + optional google_accounts.json."""
    email: Optional[str] = None
    expires_at: Optional[int] = None
    id_token = creds.get("id_token")
    if isinstance(id_token, str) and len(id_token) > 0:
        try:
            claims = decode_jwt_claims(id_token)
            email = claims.get("email") if isinstance(claims.get("email"), str) else None
            exp = claims.get("exp")
            if isinstance(exp, (int, float)):
                expires_at = int(exp)
        except ValueError:
            logger.debug("antigravity id_token failed to decode", exc_info=True)
    if email is None and accounts is not None:
        active = accounts.get("active") or accounts.get("activeAccount")
        if isinstance(active, str) and len(active) > 0:
            email = active
        elif isinstance(accounts.get("accounts"), list) and len(accounts["accounts"]) > 0:
            first = accounts["accounts"][0]
            if isinstance(first, str):
                email = first
            elif isinstance(first, dict):
                email = first.get("email") if isinstance(first.get("email"), str) else None
    expiry_ms = creds.get("expiry_date")
    if expires_at is None and isinstance(expiry_ms, (int, float)):
        expires_at = int(expiry_ms / 1000)
    return AntigravityIdentity(
        email=email,
        tier=None,
        project_id=None,
        expires_at=expires_at,
    )


@dataclass
class AntigravityCredentialStatus:
    """Result of probing ~/.gemini for a manageable account."""

    present: bool
    swappable: bool
    reason: Optional[str]
    identity: Optional[AntigravityIdentity]
    home: Path


def detect_antigravity_account(
    home: Optional[Path] = None, env: Optional[Mapping[str, str]] = None
) -> AntigravityCredentialStatus:
    """Probe GEMINI_HOME and report whether jacked can manage the account."""
    home = home or gemini_home(env)
    creds = read_oauth_creds(home, env)
    if creds is None:
        return AntigravityCredentialStatus(
            present=False,
            swappable=False,
            reason="no ~/.gemini/oauth_creds.json — run Gemini CLI or Antigravity login first",
            identity=None,
            home=home,
        )
    refresh = creds.get("refresh_token")
    if not isinstance(refresh, str) or len(refresh) == 0:
        return AntigravityCredentialStatus(
            present=True,
            swappable=False,
            reason="oauth_creds.json has no refresh_token — re-login with offline access",
            identity=extract_identity(creds, read_google_accounts(home, env)),
            home=home,
        )
    return AntigravityCredentialStatus(
        present=True,
        swappable=True,
        reason=None,
        identity=extract_identity(creds, read_google_accounts(home, env)),
        home=home,
    )
