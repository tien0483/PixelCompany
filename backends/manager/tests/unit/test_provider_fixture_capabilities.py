"""Offline fixture: provider capability registry for Cursor / Antigravity."""

from manager.providers import (
    PROVIDER_ANTIGRAVITY,
    PROVIDER_CURSOR,
    can_auto_swap,
    capabilities_for,
)


def test_cursor_cannot_auto_swap():
    assert can_auto_swap(PROVIDER_CURSOR) is False
    cursor = capabilities_for(PROVIDER_CURSOR)
    assert cursor.can_auto_swap is False
    assert cursor.auto_swap_block_reason is not None
    assert len(cursor.auto_swap_block_reason) > 0


def test_antigravity_can_auto_swap():
    assert can_auto_swap(PROVIDER_ANTIGRAVITY) is True
    antigravity = capabilities_for(PROVIDER_ANTIGRAVITY)
    assert antigravity.can_auto_swap is True
