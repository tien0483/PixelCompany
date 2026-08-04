"""Shared 1-token /v1/messages probe.

Two callers, two needs:
  window_keeper.ping_account -> "did the 5h window open?"        (bool)
  auth.validate_account      -> "is this credential entitled?"   (classified)
So the HTTP call lives here once; ping_account is a bool wrapper over it.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Literal

import httpx

from manager.web.oauth import OAUTH_BETA_HEADER

logger = logging.getLogger(__name__)

MESSAGES_URL = "https://api.anthropic.com/v1/messages"
PROBE_MODEL = "claude-haiku-4-5-20251001"
_MAX_MESSAGE_CHARS = 300

ProbeVerdict = Literal[
    "ok",
    "unauthorized",
    "forbidden",
    "rate_limited",
    "bad_request",
    "upstream_error",
    "network_error",
]

_STATUS_VERDICTS: dict[int, ProbeVerdict] = {
    200: "ok",
    401: "unauthorized",
    403: "forbidden",
    429: "rate_limited",
    400: "bad_request",
    404: "bad_request",
    422: "bad_request",
}


@dataclass(frozen=True)
class InferenceProbeResult:
    verdict: ProbeVerdict
    status_code: int | None
    error_type: str | None
    error_message: str | None

    @property
    def ok(self) -> bool:
        return self.verdict == "ok"

    @property
    def proves_credential_bad(self) -> bool:
        return self.verdict in ("unauthorized", "forbidden")

    @property
    def indeterminate(self) -> bool:
        return self.verdict in ("rate_limited", "bad_request", "upstream_error", "network_error")


def _parse_error_body(resp: httpx.Response) -> tuple[str | None, str | None]:
    """Anthropic envelope: {"type":"error","error":{"type":..,"message":..}}.

    Also tolerates a flat string `error` (OAuth style) and non-JSON bodies.
    """
    try:
        data = resp.json()
    except Exception:
        text = (resp.text or "").strip()
        return None, (text[:_MAX_MESSAGE_CHARS] or None)

    err = data.get("error") if isinstance(data, dict) else None
    if isinstance(err, dict):
        etype = err.get("type") if isinstance(err.get("type"), str) else None
        msg = err.get("message") if isinstance(err.get("message"), str) else None
        return etype, (msg.strip()[:_MAX_MESSAGE_CHARS] or None) if msg else None
    if isinstance(err, str):
        return err, None
    return None, None


async def probe_inference(access_token: str, timeout: float = 12.0) -> InferenceProbeResult:
    """Make a minimal 1-token inference call to classify a credential's entitlement.

    Never raises — transport failures and timeouts become verdict="network_error".
    """
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(connect=5, read=timeout, write=5, pool=5)
        ) as client:
            resp = await client.post(
                MESSAGES_URL,
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Content-Type": "application/json",
                    "anthropic-version": "2023-06-01",
                    "anthropic-beta": OAUTH_BETA_HEADER,
                },
                json={
                    "model": PROBE_MODEL,
                    "max_tokens": 1,
                    "messages": [{"role": "user", "content": "hi"}],
                },
            )
    except Exception as exc:
        logger.warning("probe_inference: transport failure — %s", exc)
        return InferenceProbeResult(
            verdict="network_error", status_code=None, error_type=None, error_message=str(exc)[:_MAX_MESSAGE_CHARS]
        )

    if resp.status_code == 200:
        return InferenceProbeResult(verdict="ok", status_code=200, error_type=None, error_message=None)

    error_type, error_message = _parse_error_body(resp)
    verdict = _STATUS_VERDICTS.get(resp.status_code, "upstream_error" if resp.status_code >= 500 else "bad_request")
    return InferenceProbeResult(
        verdict=verdict, status_code=resp.status_code, error_type=error_type, error_message=error_message
    )
