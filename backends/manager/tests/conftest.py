"""Shared fixtures for jacked tests."""

import pytest
from unittest.mock import patch



@pytest.fixture(autouse=True)
def _block_keychain_writes():
    """Prevent any test from writing to the real macOS Keychain.

    write_platform_credentials is imported by name in manager.launch,
    so we must patch both the definition and the import site.
    """
    with patch(
        "manager.api.credential_helpers.write_platform_credentials",
        return_value=True,
    ), patch(
        "manager.launch.write_platform_credentials",
        return_value=True,
    ):
        yield


@pytest.fixture(autouse=True)
def _block_browser_open():
    """Prevent any test from opening a real browser window.

    The OAuth flow calls webbrowser.open() which pops up the Anthropic
    login page during test runs. Block it globally.
    """
    with patch("webbrowser.open", return_value=True):
        yield


@pytest.fixture(autouse=True)
def _isolate_claude_config_dir(monkeypatch):
    """Strip CLAUDE_CONFIG_DIR so tests can't write into a real live session.

    claude_config_dir() (manager/api/credential_helpers.py) checks this env
    var BEFORE falling back to Path.home(), so a test that mocks Path.home
    but runs in a shell that already has CLAUDE_CONFIG_DIR set (e.g. inside
    a running Claude Code task session) silently ignores that mock and
    writes fixture data straight into the real, live .credentials.json for
    that session — a genuine incident, not just a flaky test (2026-08-19).
    Every test gets a clean slate here regardless of the ambient shell.
    """
    monkeypatch.delenv("CLAUDE_CONFIG_DIR", raising=False)
