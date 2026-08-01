"""Per-provider capability registry.

jacked manages accounts for several CLIs, and they are not equally safe to
automate. Claude and Codex keep a swappable credential file. Antigravity mints a
short-lived token on demand, so it can be swapped without touching a running
process. Cursor keeps its session inside the IDE's own sqlite state database,
which the app holds open and rewrites on exit — swapping that behind Cursor's
back corrupts the session, so Cursor is manual-only by construction.

Every code path that would act on an account's credentials must consult this
module rather than testing ``provider == "claude"`` inline. Auto-swap selection,
the dashboard API, and the office UI all read the same table, so a provider is
either safe to automate everywhere or nowhere.

Adding a provider is a two-step change: register it here, then implement the
``{credentials,accounts,switching,usage}`` module quartet under
``jacked/<provider>/``. Until it is registered, the account is inert: the
selection rule skips it and the dashboard renders it as read-only.
"""

from __future__ import annotations

from dataclasses import dataclass

# Where the provider's credential actually lives. Determines which swap
# mechanism (if any) applies, and what a backup has to capture.
CREDENTIAL_FILE = "file"  # plaintext JSON on disk, swappable by replacing it
CREDENTIAL_OAUTH_FILE = "oauth-file"  # OAuth refresh token on disk, access token minted on demand
CREDENTIAL_IDE_SQLITE = "ide-sqlite"  # inside an editor's own state database

PROVIDER_CLAUDE = "claude"
PROVIDER_CODEX = "codex"
PROVIDER_CURSOR = "cursor"
PROVIDER_ANTIGRAVITY = "antigravity"


@dataclass(frozen=True)
class ProviderCapabilities:
    """What jacked is allowed to do with one provider's accounts."""

    provider: str
    label: str
    credential_kind: str
    #: Whether jacked can read a usage/quota number for this provider at all.
    can_track_usage: bool
    #: Whether the auto-swap loop may select this provider without a human.
    can_auto_swap: bool
    #: Why auto-swap is refused. Always set when ``can_auto_swap`` is False, so
    #: callers can surface a concrete reason instead of a bare disabled state.
    auto_swap_block_reason: str | None = None
    #: Extra step the user must take when switching by hand.
    manual_switch_warning: str | None = None


_REGISTRY: dict[str, ProviderCapabilities] = {
    PROVIDER_CLAUDE: ProviderCapabilities(
        provider  = PROVIDER_CLAUDE,
        label     = "Claude Code",
        credential_kind = CREDENTIAL_FILE,
        can_track_usage = True,
        can_auto_swap   = True,
    ),
    PROVIDER_CODEX: ProviderCapabilities(
        provider  = PROVIDER_CODEX,
        label     = "OpenAI Codex",
        credential_kind = CREDENTIAL_FILE,
        can_track_usage = True,
        can_auto_swap   = True,
    ),
    PROVIDER_ANTIGRAVITY: ProviderCapabilities(
        provider  = PROVIDER_ANTIGRAVITY,
        label     = "Antigravity / Gemini",
        credential_kind = CREDENTIAL_OAUTH_FILE,
        can_track_usage = True,
        # Safe to automate: the access token is minted per request from the
        # stored refresh token, so a swap never invalidates work in flight.
        can_auto_swap   = True,
    ),
    PROVIDER_CURSOR: ProviderCapabilities(
        provider  = PROVIDER_CURSOR,
        label     = "Cursor",
        credential_kind = CREDENTIAL_IDE_SQLITE,
        can_track_usage = True,
        can_auto_swap   = False,
        auto_swap_block_reason = (
            "Cursor stores its session in the IDE's state database, which the "
            "running app holds open and overwrites on exit. Switching accounts "
            "requires Cursor to be closed, so it can never be automated."
        ),
        manual_switch_warning = (
            "Close Cursor before switching, and restart it afterwards. jacked "
            "backs up the state database first, but a running Cursor will "
            "overwrite the swap."
        ),
    ),
}

#: Providers jacked knows about, in display order.
KNOWN_PROVIDERS: tuple[str, ...] = (
    PROVIDER_CLAUDE,
    PROVIDER_CODEX,
    PROVIDER_ANTIGRAVITY,
    PROVIDER_CURSOR,
)

#: Fallback for an account row carrying a provider we have never heard of, e.g.
#: written by a newer jacked and then downgraded. Deliberately inert: no usage,
#: no automation, and a reason that says what happened.
_UNKNOWN = ProviderCapabilities(
    provider  = "unknown",
    label     = "Unknown provider",
    credential_kind = CREDENTIAL_FILE,
    can_track_usage = False,
    can_auto_swap   = False,
    auto_swap_block_reason = "Provider is not registered in this version of manager.",
)


def capabilities_for(provider: str | None) -> ProviderCapabilities:
    """Return the capability record for ``provider``.

    Never raises and never returns None: an unregistered provider resolves to an
    inert record so a stray database row cannot take the swap loop down.
    """
    if provider is None:
        return _REGISTRY[PROVIDER_CLAUDE]
    return _REGISTRY.get(provider, _UNKNOWN)


def is_known_provider(provider: str | None) -> bool:
    """Whether ``provider`` has a registered implementation."""
    return provider in _REGISTRY


def can_auto_swap(provider: str | None) -> bool:
    """Whether the auto-swap loop may select accounts from ``provider``."""
    return capabilities_for(provider).can_auto_swap


def can_track_usage(provider: str | None) -> bool:
    """Whether jacked can read a usage number for ``provider``."""
    return capabilities_for(provider).can_track_usage


def auto_swap_block_reason(provider: str | None) -> str | None:
    """Why auto-swap is refused for ``provider``, or None when it is allowed."""
    return capabilities_for(provider).auto_swap_block_reason


def describe_providers() -> list[dict]:
    """Serialize the registry for the dashboard API."""
    return [
        {
            "provider": cap.provider,
            "label": cap.label,
            "credential_kind": cap.credential_kind,
            "can_track_usage": cap.can_track_usage,
            "can_auto_swap": cap.can_auto_swap,
            "auto_swap_block_reason": cap.auto_swap_block_reason,
            "manual_switch_warning": cap.manual_switch_warning,
        }
        for cap in (_REGISTRY[name] for name in KNOWN_PROVIDERS)
    ]
