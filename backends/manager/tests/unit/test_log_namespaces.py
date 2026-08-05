"""Regression tests for the manager.* logger-visibility fix.

Covers the "Usage API rate limited" investigation: `manager.*` modules log
under their own namespace (`web/auth.py:37` — `getLogger("manager.auth")`),
but only the legacy `"jacked"` namespace was ever raised to INFO, while
`cli.py`'s `basicConfig` pins root to WARNING. Every INFO line from
`manager.*` — including the one that would have explained a 429 backoff
window — was silently dropped from both the log file and the in-app log
buffer.

The shared policy (which namespaces, and how the tray's file handler is
installed) lives in `manager.logging_setup` — a dependency-free leaf module,
so `manager.service.tray` never has to import the FastAPI app graph just to
install a file handler.
"""

import ast
import asyncio
import inspect
import logging
import logging.handlers
import os
import time
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

import manager.logging_setup as logging_setup
from manager.api.log_capture import ServerLogBuffer
from manager.web.auth import fetch_usage


# ---------------------------------------------------------------------------
# raise_log_namespaces_to_info
# ---------------------------------------------------------------------------


class TestRaiseLogNamespacesToInfo:
    def setup_method(self):
        self._saved_levels = {
            name: logging.getLogger(name).level
            for name in (*logging_setup.INFO_LOG_NAMESPACES, "")
        }

    def teardown_method(self):
        for name, level in self._saved_levels.items():
            logging.getLogger(name).setLevel(level)

    def test_raises_manager_and_jacked_namespaces_to_info(self):
        logging.getLogger().setLevel(logging.WARNING)
        for name in logging_setup.INFO_LOG_NAMESPACES:
            logging.getLogger(name).setLevel(logging.NOTSET)

        logging_setup.raise_log_namespaces_to_info()

        for name in logging_setup.INFO_LOG_NAMESPACES:
            assert logging.getLogger(name).getEffectiveLevel() == logging.INFO

    def test_does_not_lower_an_already_stricter_level(self):
        """A namespace explicitly set to DEBUG must not be raised to INFO —
        this is what protects `-v`/DEBUG from being silently clamped."""
        for name in logging_setup.INFO_LOG_NAMESPACES:
            logging.getLogger(name).setLevel(logging.DEBUG)

        logging_setup.raise_log_namespaces_to_info()

        for name in logging_setup.INFO_LOG_NAMESPACES:
            assert logging.getLogger(name).level == logging.DEBUG

    def test_idempotent(self):
        logging.getLogger("manager").setLevel(logging.NOTSET)
        logging_setup.raise_log_namespaces_to_info()
        logging_setup.raise_log_namespaces_to_info()
        assert logging.getLogger("manager").getEffectiveLevel() == logging.INFO


# ---------------------------------------------------------------------------
# install_tray_file_handler
# ---------------------------------------------------------------------------


class TestInstallTrayFileHandler:
    def setup_method(self):
        self._saved_levels = {
            name: logging.getLogger(name).level
            for name in logging_setup.INFO_LOG_NAMESPACES
        }
        self._saved_handlers = {
            name: list(logging.getLogger(name).handlers)
            for name in logging_setup.INFO_LOG_NAMESPACES
        }

    def teardown_method(self):
        for name in logging_setup.INFO_LOG_NAMESPACES:
            lg = logging.getLogger(name)
            lg.setLevel(self._saved_levels[name])
            for h in list(lg.handlers):
                if h not in self._saved_handlers[name]:
                    lg.removeHandler(h)
                    h.close()

    def test_attaches_rotating_handler_to_every_namespace(self, tmp_path):
        log_path = tmp_path / "jacked-tray.log"
        logging_setup.install_tray_file_handler(log_path)

        for name in logging_setup.INFO_LOG_NAMESPACES:
            handlers = [
                h for h in logging.getLogger(name).handlers
                if isinstance(h, logging.handlers.RotatingFileHandler)
                and h.baseFilename == str(log_path)
            ]
            assert len(handlers) == 1, f"expected one rotating handler on {name!r}"

    def test_shares_one_handler_instance_across_namespaces(self, tmp_path):
        """One open file, not one per namespace — avoids the interleaving
        hazard of two independent buffered streams on the same path."""
        log_path = tmp_path / "jacked-tray.log"
        logging_setup.install_tray_file_handler(log_path)

        attached = [
            h for name in logging_setup.INFO_LOG_NAMESPACES
            for h in logging.getLogger(name).handlers
            if isinstance(h, logging.handlers.RotatingFileHandler)
            and h.baseFilename == str(log_path)
        ]
        assert len(set(map(id, attached))) == 1

    def test_chmods_the_log_file_0600(self, tmp_path):
        import os
        import stat
        import sys

        if sys.platform == "win32":
            pytest.skip("POSIX permission bits don't apply on Windows")

        log_path = tmp_path / "jacked-tray.log"
        logging_setup.install_tray_file_handler(log_path)

        mode = stat.S_IMODE(os.stat(log_path).st_mode)
        assert mode == 0o600, f"expected 0600, got {oct(mode)}"

    def test_chmod_survives_rotation(self, tmp_path):
        """Plain RotatingFileHandler reopens the base file at the umask
        default on rollover, silently undoing the one-time chmod — this
        pins the _ChmodRotatingFileHandler override that re-applies 0600
        after every rollover."""
        import os
        import stat
        import sys

        if sys.platform == "win32":
            pytest.skip("POSIX permission bits don't apply on Windows")

        log_path = tmp_path / "jacked-tray.log"
        logging_setup.install_tray_file_handler(log_path)

        [handler] = [
            h for h in logging.getLogger("manager").handlers
            if isinstance(h, logging.handlers.RotatingFileHandler)
        ]
        os.chmod(log_path, 0o644)  # simulate a rollover-reset permission
        handler.doRollover()

        mode = stat.S_IMODE(os.stat(log_path).st_mode)
        assert mode == 0o600, f"expected chmod to survive rollover, got {oct(mode)}"

    def test_uses_utf8_with_replace_so_records_are_never_silently_dropped(
        self, tmp_path,
    ):
        """Regression: the rewrite once omitted encoding="utf-8", so on a
        non-UTF-8 locale (default Windows cp1252) a record containing a
        non-encodable character raised UnicodeEncodeError inside emit(),
        which logging.Handler.handleError routes to stderr — /dev/null for
        a detached service. errors="replace" means the record is degraded,
        never lost."""
        log_path = tmp_path / "jacked-tray.log"
        logging_setup.install_tray_file_handler(log_path)

        logging.getLogger("manager.auth").info("emoji probe 🎉 dash — arrow →")

        content = log_path.read_text(encoding="utf-8")
        assert "emoji probe" in content

    def test_records_actually_land_in_the_file(self, tmp_path):
        """The plumbing (handler attached, level raised) can be fully
        correct while the handler itself is silently misconfigured — this
        is the one assertion that would have caught the dropped encoding=
        regression: read the file back and check the message is there."""
        log_path = tmp_path / "jacked-tray.log"
        logging_setup.install_tray_file_handler(log_path)

        logging.getLogger("manager.auth").info("distinctive probe line 8f3c1")

        content = log_path.read_text(encoding="utf-8")
        assert "distinctive probe line 8f3c1" in content
        assert "manager.auth" in content
        assert "INFO" in content

    def test_handler_capped_at_info_even_when_logger_is_at_debug(self, tmp_path):
        """The logger itself may sit at DEBUG (-v), but the tray file
        handler must stay capped at INFO or it becomes a DEBUG firehose for
        the entire manager.* tree, thrashing its own 5MB rotation."""
        log_path = tmp_path / "jacked-tray.log"
        logging_setup.install_tray_file_handler(log_path)
        logging.getLogger("manager").setLevel(logging.DEBUG)

        logging.getLogger("manager.auth").debug("debug probe should NOT land")
        logging.getLogger("manager.auth").info("info probe SHOULD land")

        content = log_path.read_text(encoding="utf-8")
        assert "info probe SHOULD land" in content
        assert "debug probe should NOT land" not in content

    def test_raises_namespaces_to_info(self, tmp_path):
        for name in logging_setup.INFO_LOG_NAMESPACES:
            logging.getLogger(name).setLevel(logging.WARNING)

        logging_setup.install_tray_file_handler(tmp_path / "jacked-tray.log")

        for name in logging_setup.INFO_LOG_NAMESPACES:
            assert logging.getLogger(name).getEffectiveLevel() == logging.INFO

    def test_does_not_clamp_debug(self, tmp_path):
        """The regression this fixes: a prior version called setLevel(INFO)
        unconditionally, silently disabling `-v`/DEBUG for the whole tree."""
        for name in logging_setup.INFO_LOG_NAMESPACES:
            logging.getLogger(name).setLevel(logging.DEBUG)

        logging_setup.install_tray_file_handler(tmp_path / "jacked-tray.log")

        for name in logging_setup.INFO_LOG_NAMESPACES:
            assert logging.getLogger(name).level == logging.DEBUG

    def test_second_call_does_not_duplicate_handlers(self, tmp_path):
        log_path = tmp_path / "jacked-tray.log"
        logging_setup.install_tray_file_handler(log_path)
        logging_setup.install_tray_file_handler(log_path)

        for name in logging_setup.INFO_LOG_NAMESPACES:
            handlers = [
                h for h in logging.getLogger(name).handlers
                if isinstance(h, logging.handlers.RotatingFileHandler)
                and h.baseFilename == str(log_path)
            ]
            assert len(handlers) == 1, f"expected exactly one handler on {name!r}"

    def test_creates_missing_parent_directory(self, tmp_path):
        """The leaf module must be self-sufficient — it must not rely on a
        caller to have already created the parent directory."""
        log_path = tmp_path / "fresh" / "nested" / "jacked-tray.log"
        logging_setup.install_tray_file_handler(log_path)
        assert log_path.exists()

    def test_raise_survives_a_failed_chmod_and_a_warning_is_logged(
        self, tmp_path, caplog,
    ):
        """The level raise happens first and unconditionally: even if the
        file handler fails to install, that side effect must not be lost,
        and the failure must not be totally silent (JACKED_GUARDRAILS.md:
        "Never silently swallow exceptions. At minimum, log them.")."""
        for name in logging_setup.INFO_LOG_NAMESPACES:
            logging.getLogger(name).setLevel(logging.WARNING)

        caplog.set_level(logging.WARNING, logger="manager.logging_setup")
        with patch(
            "manager.logging_setup.os.chmod",
            side_effect=OSError("permission denied"),
        ):
            logging_setup.install_tray_file_handler(tmp_path / "jacked-tray.log")

        for name in logging_setup.INFO_LOG_NAMESPACES:
            assert logging.getLogger(name).getEffectiveLevel() == logging.INFO
        assert any("unavailable" in r.getMessage() for r in caplog.records)


class TestTrayInstallDelegatesToLoggingSetup:
    """manager.service.tray._install_tray_file_logger must delegate to the
    leaf module rather than importing manager.api.main (the FastAPI app
    graph) — that coupling used to mean any import failure anywhere in the
    api layer silently disabled tray file logging."""

    def test_delegates_without_importing_api_main(self, tmp_path, monkeypatch):
        from manager.service.tray import ServiceRunner

        # CLAUDE_DIR is imported locally inside _install_tray_file_logger
        # (from manager.service import CLAUDE_DIR), so the source attribute
        # on manager.service — not manager.service.tray — is what's read.
        monkeypatch.setattr("manager.service.CLAUDE_DIR", tmp_path)
        with patch(
            "manager.logging_setup.install_tray_file_handler"
        ) as install_mock:
            ServiceRunner()._install_tray_file_logger()

        install_mock.assert_called_once_with(tmp_path / "jacked-tray.log")

    def test_import_failure_inside_install_is_swallowed(self, tmp_path, monkeypatch):
        """Best-effort contract preserved: a broken install must not raise
        out of _install_tray_file_logger (tray startup must not crash)."""
        from manager.service.tray import ServiceRunner

        monkeypatch.setattr("manager.service.CLAUDE_DIR", tmp_path)
        with patch(
            "manager.logging_setup.install_tray_file_handler",
            side_effect=RuntimeError("boom"),
        ):
            ServiceRunner()._install_tray_file_logger()  # must not raise

    def test_works_even_if_manager_api_main_is_unimportable(
        self, tmp_path, monkeypatch,
    ):
        """The real property fix 2 claims: this path must not depend on
        manager.api.main being importable at all. Mocking install_tray_file
        _handler (as the tests above do) only proves the mock was called
        with the right args — it would stay green even if a stray `import
        manager.api.main` were reintroduced into _install_tray_file_logger.
        Poisoning sys.modules proves the actual property: the real,
        unmocked install still runs to completion without that module."""
        import sys

        from manager.service.tray import ServiceRunner

        log_path = tmp_path / "jacked-tray.log"
        resolved = os.path.abspath(str(log_path))
        monkeypatch.setattr("manager.service.CLAUDE_DIR", tmp_path)
        monkeypatch.setitem(sys.modules, "manager.api.main", None)
        try:
            ServiceRunner()._install_tray_file_logger()
        finally:
            for name in logging_setup.INFO_LOG_NAMESPACES:
                lg = logging.getLogger(name)
                for h in list(lg.handlers):
                    if getattr(h, "baseFilename", None) == resolved:
                        lg.removeHandler(h)
                        h.close()

        assert log_path.exists()


# ---------------------------------------------------------------------------
# Rename guard — catches the regression that actually happened
# ---------------------------------------------------------------------------


def _module_level_string_constants(tree):
    """Map NAME = "literal" module-level assignments to their string value,
    so getLogger(SOME_CONSTANT) resolves like getLogger("literal") does."""
    constants = {}
    for node in tree.body:
        if not isinstance(node, (ast.Assign, ast.AnnAssign)):
            continue
        targets = node.targets if isinstance(node, ast.Assign) else [node.target]
        value = node.value
        if not (isinstance(value, ast.Constant) and isinstance(value.value, str)):
            continue
        for target in targets:
            if isinstance(target, ast.Name):
                constants[target.id] = value.value
    return constants


def _iter_string_getlogger_calls(root: Path):
    """Yield (path, lineno, name) for every ``getLogger("literal")`` or
    ``getLogger(SOME_STRING_CONSTANT)`` call under ``root``, skipping the
    dynamic ``getLogger(__name__)`` form (that always resolves under the
    enclosing package and needs no allowlisting)."""
    for path in root.rglob("*.py"):
        # utf-8-sig: several files in this repo carry a BOM.
        tree = ast.parse(path.read_text(encoding="utf-8-sig"))
        constants = _module_level_string_constants(tree)
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            func = node.func
            is_getlogger = (
                (isinstance(func, ast.Name) and func.id == "getLogger")
                or (isinstance(func, ast.Attribute) and func.attr == "getLogger")
            )
            if not is_getlogger or not node.args:
                continue
            arg = node.args[0]
            name = None
            if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                name = arg.value
            elif isinstance(arg, ast.Name) and arg.id in constants:
                name = constants[arg.id]
            if name is not None:
                yield path, node.lineno, name


def test_iter_string_getlogger_calls_resolves_module_level_constants(tmp_path):
    """Direct unit test of the constant-resolution helper: without it, a
    call like `getLogger(SOME_CONSTANT)` is invisible to the rename guard
    below. Uses a synthetic file so the assertion can't pass by accident of
    every real constant in this repo already happening to be compliant."""
    src = (
        "import logging\n"
        "SOME_NAME = 'httpx'\n"
        "logger = logging.getLogger(SOME_NAME)\n"
    )
    fake_module = tmp_path / "fake_module.py"
    fake_module.write_text(src, encoding="utf-8")

    results = list(_iter_string_getlogger_calls(tmp_path))

    assert (fake_module, 3, "httpx") in results


def test_every_explicit_logger_namespace_is_raised_to_info():
    """AST-walk manager/ for ``getLogger("literal.name")`` calls (including
    ones routed through a module-level string constant, e.g.
    ``manager/memory/vault.py``'s ``MEMORY_LOGGER_NAME``) and assert each
    one's top-level namespace segment is in ``INFO_LOG_NAMESPACES``.

    This is the convention enforcer for the rename that caused the original
    bug: a future ``getLogger("something_new")`` that isn't registered here
    will have its INFO output silently dropped by cli.py's WARNING root
    level, exactly like ``manager.auth`` was until this fix.
    """
    repo_root = Path(__file__).parent.parent.parent  # backends/manager
    manager_root = repo_root / "manager"

    # Guard against the scan silently covering zero files (wrong path, repo
    # layout change, running against an installed wheel) — rglob on a
    # missing/empty directory yields nothing and the assertion below would
    # pass vacuously, guarding nothing.
    assert manager_root.is_dir(), f"expected {manager_root} to exist"
    py_files = list(manager_root.rglob("*.py"))
    assert len(py_files) > 50, (
        f"expected to scan >50 .py files under {manager_root}, found "
        f"{len(py_files)} — the scan path is likely wrong"
    )

    calls = list(_iter_string_getlogger_calls(manager_root))
    # Guard against the resolver itself silently matching nothing (e.g. a
    # future refactor to a get_logger() wrapper function) — a guard that
    # never finds a call to check is a guard that always passes.
    assert len(calls) >= 3, (
        f"expected to resolve >=3 explicit getLogger(...) calls under "
        f"{manager_root}, found {len(calls)} — the resolver may no longer "
        "be matching real call sites"
    )

    offenders = []
    for path, lineno, name in calls:
        top = name.split(".")[0]
        if top not in logging_setup.INFO_LOG_NAMESPACES:
            rel = path.relative_to(repo_root).as_posix()
            offenders.append(f"{rel}:{lineno} getLogger({name!r})")

    assert not offenders, (
        "Logger namespace(s) not covered by manager/logging_setup.py's "
        "INFO_LOG_NAMESPACES — their INFO/DEBUG output is silently dropped "
        "by cli.py's WARNING root level. Add the top-level segment to "
        "INFO_LOG_NAMESPACES. Offenders:\n" + "\n".join(offenders)
    )


# ---------------------------------------------------------------------------
# fetch_usage: manual propagated through every recursive retry
# ---------------------------------------------------------------------------


def test_all_recursive_fetch_usage_calls_forward_manual():
    """Regression: `manual` is a parameter of fetch_usage, but the three
    internal retry call sites (401 token refresh, 401 live-credential
    import, 429 token rotation) used to omit it — so any retry silently
    reset manual=False, which is exactly the field the backed-off log line
    was extended with to distinguish a user's Refresh click from a
    background poll. An AST check, not a mocked-async-recursion test,
    because it pins the actual defect (a missing keyword argument at a call
    site) without having to fight the recursive control flow to observe it."""
    import manager.web.auth as mod

    source = inspect.getsource(mod.fetch_usage)
    tree = ast.parse(source)
    func = tree.body[0]
    assert isinstance(func, ast.AsyncFunctionDef) and func.name == "fetch_usage"

    recursive_calls = [
        node for node in ast.walk(func)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "fetch_usage"
    ]
    assert len(recursive_calls) >= 3, (
        f"expected >=3 recursive fetch_usage() calls, found "
        f"{len(recursive_calls)} — fetch_usage was refactored; update this "
        "test's assumption"
    )
    for call in recursive_calls:
        kwarg_names = {kw.arg for kw in call.keywords}
        assert "manual" in kwarg_names, (
            f"fetch_usage() recursive call at line {call.lineno} omits "
            "manual= — a retry silently resets manual=False"
        )


# ---------------------------------------------------------------------------
# fetch_usage: backed-off + blank-exception logging
# ---------------------------------------------------------------------------


def _mock_db(account_overrides=None):
    base = {
        "id": 1,
        "email": "user@test.com",
        "access_token": "test_access_token",
        "refresh_token": "test_refresh_token",
        "is_active": True,
        "usage_cached_at": None,
        "cached_usage_5h": None,
        "cached_usage_7d": None,
    }
    if account_overrides:
        base.update(account_overrides)
    db = MagicMock()
    db.get_account.return_value = base
    db.update_account_usage_cache = MagicMock()
    db.record_account_error = MagicMock()
    return db


class TestBackedOffLogging:
    def setup_method(self):
        import manager.web.auth as mod
        mod._account_usage_state.clear()

    def teardown_method(self):
        import manager.web.auth as mod
        mod._account_usage_state.clear()

    def test_backed_off_short_circuit_logs_remaining_seconds_at_info(self, caplog):
        import manager.web.auth as mod

        state = mod._get_usage_state(1)
        state["backoff_until"] = time.time() + 300

        db = _mock_db()
        caplog.set_level(logging.INFO, logger="manager.auth")
        result = asyncio.run(fetch_usage(1, db))

        assert result == {"_backed_off": True}
        backoff_records = [
            r for r in caplog.records if "backed off" in r.getMessage()
        ]
        assert len(backoff_records) == 1
        assert backoff_records[0].levelno == logging.INFO
        assert "account 1" in backoff_records[0].getMessage()

    def test_backed_off_log_records_whether_the_call_was_manual(self, caplog):
        """The original diagnosis problem: N identical background-poll lines
        vs. the one line that corresponds to the user's own Refresh click.
        manual=True must be distinguishable from manual=False in the log."""
        import manager.web.auth as mod

        state = mod._get_usage_state(1)
        state["backoff_until"] = time.time() + 300

        db = _mock_db()
        caplog.set_level(logging.INFO, logger="manager.auth")
        asyncio.run(fetch_usage(1, db, manual=True))

        [record] = [r for r in caplog.records if "backed off" in r.getMessage()]
        assert "manual=True" in record.getMessage()

    def test_manual_floor_short_circuit_logs_at_info(self, caplog):
        """A user's own Refresh click, swallowed by the 20s manual floor,
        used to return HTTP 200 with unchanged numbers and log nothing at
        DEBUG — the same silent, undiagnosable-without-source symptom the
        429 backoff line was raised to INFO to fix."""
        import manager.web.auth as mod

        mod._get_usage_state(1)["last_fetched_at"] = time.time() - 5

        db = _mock_db({"usage_cached_at": int(time.time()) - 5})
        caplog.set_level(logging.INFO, logger="manager.auth")
        result = asyncio.run(fetch_usage(1, db, manual=True))

        assert result == {"_cached": True}
        assert any(
            "Manual usage floor" in r.getMessage() and r.levelno == logging.INFO
            for r in caplog.records
        )


class TestBlankExceptionFallback:
    def setup_method(self):
        import manager.web.auth as mod
        mod._account_usage_state.clear()

    def teardown_method(self):
        import manager.web.auth as mod
        mod._account_usage_state.clear()

    def _stale_enough_db(self):
        import manager.web.auth as mod

        state = mod._get_usage_state(1)
        # Comfortably past the ceiling so this never depends on its exact
        # value; independent of _USAGE_RATE_LIMIT_CEILING changing later.
        state["last_fetched_at"] = time.time() - (mod._USAGE_RATE_LIMIT_CEILING + 20)
        return _mock_db({"usage_cached_at": int(state["last_fetched_at"])})

    def _client_raising(self, exc):
        client = AsyncMock()
        client.__aenter__ = AsyncMock(return_value=client)
        client.__aexit__ = AsyncMock(return_value=False)
        client.get = AsyncMock(side_effect=exc)
        return client

    def test_empty_exception_message_falls_back_to_class_name(self, caplog):
        db = self._stale_enough_db()
        client = self._client_raising(httpx.ReadTimeout(""))

        caplog.set_level(logging.WARNING, logger="manager.auth")
        with patch("manager.web.auth.httpx.AsyncClient", return_value=client):
            result = asyncio.run(fetch_usage(1, db))

        assert result is None
        error_msg = db.record_account_error.call_args[0][1]
        assert "ReadTimeout" in error_msg
        [record] = [r for r in caplog.records if "ReadTimeout" in r.getMessage()]
        # httpx.ReadTimeout is a TransportError (expected transient network
        # fault) — no traceback needed, the class name already identifies it.
        assert not record.exc_info

    def test_non_empty_exception_message_keeps_both_class_name_and_message(
        self, caplog,
    ):
        """The common case: str(e) is non-empty. The class name must still
        be present — a bare "timed out" doesn't say which of ~8 branches in
        fetch_usage raised it."""
        db = self._stale_enough_db()
        client = self._client_raising(httpx.ConnectTimeout("timed out"))

        caplog.set_level(logging.WARNING, logger="manager.auth")
        with patch("manager.web.auth.httpx.AsyncClient", return_value=client):
            result = asyncio.run(fetch_usage(1, db))

        assert result is None
        error_msg = db.record_account_error.call_args[0][1]
        assert "ConnectTimeout" in error_msg
        assert "timed out" in error_msg
        [record] = [
            r for r in caplog.records
            if "ConnectTimeout" in r.getMessage() and "timed out" in r.getMessage()
        ]
        assert not record.exc_info  # TransportError — no traceback needed

    def test_logs_with_exc_info_for_traceback(self, caplog):
        """A genuine bug inside the try (not just a transient network fault,
        e.g. httpx.TransportError) must produce a traceback, not just a
        message — that's the whole point of restoring diagnosability."""
        db = self._stale_enough_db()
        client = self._client_raising(KeyError("boom"))

        caplog.set_level(logging.WARNING, logger="manager.auth")
        with patch("manager.web.auth.httpx.AsyncClient", return_value=client):
            asyncio.run(fetch_usage(1, db))

        [record] = [r for r in caplog.records if "KeyError" in r.getMessage()]
        assert record.exc_info is not None


# ---------------------------------------------------------------------------
# End-to-end: would this wiring have caught the original bug?
# ---------------------------------------------------------------------------


class TestEndToEndLogVisibility:
    """Proves the actual failure mode: an INFO record from a manager.*
    logger, emitted while root sits at WARNING (cli.py's basicConfig), must
    reach the in-app log buffer once raise_log_namespaces_to_info() has run.
    Every other test in this file proves a piece of the mechanism in
    isolation; this one proves the assembled wiring actually delivers."""

    def test_manager_info_record_reaches_the_log_buffer_after_raise(self):
        root = logging.getLogger()
        manager_root_logger = logging.getLogger("manager")
        manager_logger = logging.getLogger("manager.auth")
        saved_root_level = root.level
        saved_manager_root_level = manager_root_logger.level
        saved_manager_level = manager_logger.level

        buf = ServerLogBuffer(maxlen=50)
        root.addHandler(buf.handler)
        root.setLevel(logging.WARNING)  # mirrors cli.py's basicConfig(WARNING)
        manager_root_logger.setLevel(logging.NOTSET)
        manager_logger.setLevel(logging.NOTSET)

        try:
            # Before the raise: WARNING root drops the INFO record — this
            # is the exact silent-failure mode under investigation.
            manager_logger.info("pre-raise probe line, should NOT be captured")
            assert not any(
                "pre-raise probe line" in e["msg"] for e in buf.get_recent()
            )

            logging_setup.raise_log_namespaces_to_info()
            manager_logger.info("post-raise probe line, should be captured")

            entries = buf.get_recent()
            assert any("post-raise probe line" in e["msg"] for e in entries)
        finally:
            root.removeHandler(buf.handler)
            root.setLevel(saved_root_level)
            manager_root_logger.setLevel(saved_manager_root_level)
            manager_logger.setLevel(saved_manager_level)
