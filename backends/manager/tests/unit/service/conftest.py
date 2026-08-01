"""Shared fixtures for service tests.

Every test in this directory gets ALL of the service modules' ~/.claude
writers redirected to a throwaway tmp dir automatically. Without this, any
test that drives updater.run_update / update_status / the tray (directly or
transitively) scribbles into the user's REAL ~/.claude files:

  - jacked-update.log         (fake PIDs like 12345, "method: editable", ...)
  - jacked-update-failed.txt  (bogus "update failed" recovery banner)
  - jacked-update-status.json (bogus "failed update" the tray surfaces)
  - jacked-service.pid / .log

A test run on a user machine then leaves junk diagnostics behind. Individual
tests may still monkeypatch their own path; this autouse default only covers
the ones that forget.
"""

import pytest


@pytest.fixture(autouse=True)
def _isolate_claude_dir(tmp_path, monkeypatch):
    """Point every service-module ~/.claude path constant at a tmp dir.

    The modules freeze these paths from CLAUDE_DIR at import time, so we patch
    CLAUDE_DIR (for code that re-derives at call time) AND each frozen
    constant — including the `from manager.service import PID_FILE` binding the
    tray captured at import. Module imports are guarded so a missing optional
    dep (e.g. pystray) can't break the whole service test suite.
    """
    fake = tmp_path / ".claude"
    fake.mkdir(parents=True, exist_ok=True)

    # (module path, attribute, value) — set raising=False so a constant that
    # doesn't exist in a given module is silently skipped.
    targets = [
        ("manager.service", "CLAUDE_DIR", fake),
        ("manager.service", "PID_FILE", fake / "jacked-service.pid"),
        ("manager.service", "SERVICE_LOG", fake / "jacked-service.log"),
        ("manager.service.updater", "CLAUDE_DIR", fake),
        ("manager.service.updater", "UPDATE_LOG", fake / "jacked-update.log"),
        ("manager.service.updater", "RECOVERY_FILE", fake / "jacked-update-failed.txt"),
        ("manager.service.update_status", "CLAUDE_DIR", fake),
        ("manager.service.update_status", "UPDATE_STATUS_FILE", fake / "jacked-update-status.json"),
        # Tray captures PID_FILE via `from manager.service import PID_FILE` at
        # import; patch that binding too so remove_pid()/write_pid() in tests
        # can't delete or overwrite the user's real PID file.
        ("manager.service.tray", "PID_FILE", fake / "jacked-service.pid"),
    ]

    import importlib

    for mod_name, attr, value in targets:
        try:
            mod = importlib.import_module(mod_name)
        except Exception:
            continue  # optional dep missing — nothing to patch in this module
        monkeypatch.setattr(mod, attr, value, raising=False)

    yield
