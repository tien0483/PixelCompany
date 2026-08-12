# Copyright (C) 2026 Akselos
"""Entry point: `python3 -m server --host 127.0.0.1 --port 8323`, run with `cwd=backends/doc_skill`.

Stdlib-only on purpose: `http.server.ThreadingHTTPServer` needs no venv and no `pip install`, unlike
the sibling `backends/manager` (FastAPI), where a missing/wrong venv has silently broken auth
routing before. `python3 -m server` must just work with a stock Python 3.10+.
"""

from __future__ import annotations

import argparse
import signal
from http.server import ThreadingHTTPServer

from .app import RequestHandler


def _install_sigterm_handler() -> None:
    def _handle(_signum, _frame):
        raise KeyboardInterrupt

    try:
        signal.signal(signal.SIGTERM, _handle)
    except (ValueError, AttributeError):
        # SIGTERM isn't available on every platform (e.g. some Windows setups); KeyboardInterrupt
        # via Ctrl+C still works either way.
        pass


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog='server', description='doc-skill HTTP sidecar')
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8323)
    args = parser.parse_args(argv)

    _install_sigterm_handler()

    httpd = ThreadingHTTPServer((args.host, args.port), RequestHandler)
    print(f'doc-skill sidecar listening on http://{args.host}:{args.port}')
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
