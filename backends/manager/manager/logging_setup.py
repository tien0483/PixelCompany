"""Shared logger-namespace policy for the server log, in-app buffer, and tray log.

Deliberately dependency-free (stdlib ``logging`` only) so ``manager.service.tray``
can install its file handler without importing the FastAPI app graph — that
import used to live inline in tray.py and any failure inside it (a broken
router import, a missing optional dep) silently disabled tray file logging,
since the whole thing ran inside a swallowed ``except Exception: pass``.
"""

from __future__ import annotations

import logging
import logging.handlers
import os
import time
from pathlib import Path

# Namespaces that must reach INFO for the file log + in-app buffer to be
# useful. "jacked" is the pre-rename namespace kept for any caller that still
# logs under it; "manager" is the current one (see manager/web/auth.py etc.).
# cli.py's basicConfig() pins root to WARNING, which would otherwise silently
# drop every INFO line from both.
INFO_LOG_NAMESPACES = ("manager", "jacked")

# Shared rotation caps for every file sink carrying the manager.* INFO
# stream — the server log (manager/api/main.py) and the tray log below both
# mirror the same stream, so one source of truth instead of a duplicated
# pair of constants per file.
LOG_FILE_MAX_BYTES = 5_000_000  # 5 MB
LOG_FILE_BACKUP_COUNT = 3

_LOG_FORMAT = "%(asctime)s - %(name)s - %(levelname)s - %(message)s"

_logger = logging.getLogger(__name__)


def build_log_formatter() -> logging.Formatter:
    """UTC-stamped formatter shared by every file sink of the manager.*
    stream, so the server log and the tray log correlate without a
    timezone-offset mental step when both carry the same records."""
    fmt = logging.Formatter(_LOG_FORMAT)
    fmt.converter = time.gmtime
    return fmt


def raise_log_namespaces_to_info() -> None:
    """Raise each configured namespace to INFO, never lowering a stricter level."""
    for name in INFO_LOG_NAMESPACES:
        lg = logging.getLogger(name)
        if lg.getEffectiveLevel() > logging.INFO:
            lg.setLevel(logging.INFO)


class _ChmodRotatingFileHandler(logging.handlers.RotatingFileHandler):
    """RotatingFileHandler that re-applies chmod 600 after every rollover.

    Plain RotatingFileHandler reopens the base file at the umask default
    (0644 typical) on rollover, silently undoing a one-time chmod. This
    handler's file carries account emails (OAuth/import events), so it must
    stay 0600 for the process lifetime, not just until the first 5 MB.
    """

    def doRollover(self) -> None:
        super().doRollover()
        try:
            os.chmod(self.baseFilename, 0o600)
        except OSError:
            pass  # best-effort — a failed re-chmod must not break rotation


def install_tray_file_handler(log_path: Path) -> None:
    """Attach one rotating, chmod 600 FileHandler to every configured namespace.

    A single handler instance is shared across namespaces (one open file, not
    one per namespace). Chmod 600 because this file now carries manager.*
    INFO output, which includes account emails on OAuth/import events —
    the same protection manager/api/main.py's server log already gets.
    Idempotent: skips attaching if a handler for this exact path already
    exists on a given logger (run() can be called more than once).

    The level raise happens first and unconditionally: even if the file
    handler below fails to install (locked file, read-only filesystem, a
    log left behind by a differently-privileged prior run), the level raise
    must not become collateral damage of that failure — it's the only one
    of the two effects this function has that other sinks (root capture
    handler, stderr) can still make use of.
    """
    raise_log_namespaces_to_info()

    try:
        log_path.parent.mkdir(parents=True, exist_ok=True)
        handler = _ChmodRotatingFileHandler(
            log_path,
            maxBytes=LOG_FILE_MAX_BYTES,
            backupCount=LOG_FILE_BACKUP_COUNT,
            encoding="utf-8",
            errors="replace",
        )
        handler.setFormatter(build_log_formatter())
        # Cap this handler at INFO even when -v raises the logger itself to
        # DEBUG — the tray log otherwise becomes a DEBUG firehose for the
        # whole manager.* tree and thrashes its own rotation.
        handler.setLevel(logging.INFO)
        os.chmod(str(log_path), 0o600)

        resolved = os.path.abspath(str(log_path))
        for name in INFO_LOG_NAMESPACES:
            logger_obj = logging.getLogger(name)
            already = any(
                isinstance(h, logging.handlers.RotatingFileHandler)
                and getattr(h, "baseFilename", None) == resolved
                for h in logger_obj.handlers
            )
            if not already:
                logger_obj.addHandler(handler)
    except OSError as e:
        _logger.warning("Tray file logging unavailable: %s", e)
