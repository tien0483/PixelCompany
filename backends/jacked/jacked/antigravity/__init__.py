"""Antigravity / Gemini provider — OAuth-file credentials with on-demand minting.

Auto-swap is safe: access tokens are minted from the stored refresh token, so
a swap never invalidates work in flight. See ``jacked.providers``.
"""
