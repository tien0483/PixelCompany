# Copyright (C) 2026 Akselos
"""HTTP router for the doc-skill sidecar.

`RequestHandler` is a stdlib `http.server.BaseHTTPRequestHandler` subclass consumed by
`ThreadingHTTPServer` in `__main__.py`. JSON request/response throughout, except `/site/*` which
serves raw file bytes. Every endpoint other than project creation/adoption takes a project `id` and
looks its paths up in `registry.py` — no raw filesystem path is ever taken directly from a request
outside of `targetRepo`/`workspaceDir` at creation/adoption time, and those are validated by
`registry.resolve_workspace` before anything touches disk.

Non-2xx statuses are reserved for the sidecar's own request-handling errors (bad input, unknown
route/project, oversized body, unexpected exception). A subprocess wrapped by `ops.py` failing or
timing out is still a 200 — the HTTP layer did its job; the body carries `{code, stdout, stderr}` so
the caller can see what the underlying tool did.
"""

from __future__ import annotations

import datetime
import json
import pathlib
import urllib.parse
from http.server import BaseHTTPRequestHandler

from . import ops, registry, static

VERSION = '0.1.0'
MAX_BODY_BYTES = 1024 * 1024  # 1 MB


class HttpError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


class BadRequest(HttpError):
    def __init__(self, message: str = 'bad request') -> None:
        super().__init__(400, message)


class NotFound(HttpError):
    def __init__(self, message: str = 'not found') -> None:
        super().__init__(404, message)


class TooLarge(HttpError):
    def __init__(self, message: str = 'request body too large') -> None:
        super().__init__(413, message)


def _iso(ts: float) -> str:
    return datetime.datetime.fromtimestamp(ts, tz=datetime.timezone.utc).isoformat().replace('+00:00', 'Z')


def _read_site_json(workspace: pathlib.Path) -> dict | None:
    site_json = workspace / 'site.json'
    if not site_json.exists():
        return None
    try:
        return json.loads(site_json.read_text(encoding='utf-8'))
    except (json.JSONDecodeError, OSError):
        return None


def _project_summary(record: dict) -> dict:
    workspace = pathlib.Path(record['workspaceDir'])
    site = _read_site_json(workspace)
    index_html = workspace / 'index.html'
    last_build_at = _iso(index_html.stat().st_mtime) if index_html.exists() else None
    return {
        **record,
        'hasSite': site is not None,
        'docCount': len(site.get('docs', [])) if site else 0,
        'lastBuildAt': last_build_at,
    }


def _project_detail(record: dict) -> dict:
    workspace = pathlib.Path(record['workspaceDir'])
    site = _read_site_json(workspace)
    return {
        **record,
        'site': site,
        'docs': (site.get('docs', []) if site else []),
        'rounds': ops.op_round_status(workspace),
    }


class RequestHandler(BaseHTTPRequestHandler):
    server_version = f'DocSkillSidecar/{VERSION}'

    # ------------------------------------------------------------------ plumbing
    def _send_json(self, status: int, payload) -> None:
        body = json.dumps(payload).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_bytes(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self) -> dict:
        length_header = self.headers.get('Content-Length')
        try:
            length = int(length_header) if length_header else 0
        except ValueError:
            raise BadRequest('invalid Content-Length header') from None
        if length > MAX_BODY_BYTES:
            raise TooLarge()
        raw = self.rfile.read(length) if length > 0 else b''
        if not raw:
            return {}
        try:
            data = json.loads(raw.decode('utf-8'))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise BadRequest(f'invalid JSON body: {exc}') from exc
        if not isinstance(data, dict):
            raise BadRequest('request body must be a JSON object')
        return data

    def _require_project(self, project_id: str) -> dict:
        record = registry.get_project(project_id)
        if record is None:
            raise NotFound('unknown project')
        return record

    # ------------------------------------------------------------------ dispatch
    def do_GET(self) -> None:
        self._dispatch('GET')

    def do_POST(self) -> None:
        self._dispatch('POST')

    def do_DELETE(self) -> None:
        self._dispatch('DELETE')

    def _dispatch(self, method: str) -> None:
        try:
            parsed = urllib.parse.urlsplit(self.path)
            decoded_path = urllib.parse.unquote(parsed.path)
            parts = [p for p in decoded_path.split('/') if p != '']
            self._route(method, parts)
        except HttpError as exc:
            self._send_json(exc.status, {'error': exc.message})
        except Exception as exc:  # noqa: BLE001 - last-resort safety net, never crash the server
            self._send_json(500, {'error': f'internal error: {exc}'})

    def _route(self, method: str, parts: list[str]) -> None:
        if method == 'GET' and parts == ['api', 'health']:
            return self._send_json(200, {'ok': True, 'version': VERSION})

        if parts[:2] == ['api', 'projects']:
            tail = parts[2:]
            if not tail:
                if method == 'GET':
                    return self._list_projects()
                if method == 'POST':
                    return self._create_project()
            elif tail == ['adopt']:
                if method == 'POST':
                    return self._adopt_project()
            elif len(tail) == 1:
                project_id = tail[0]
                if method == 'GET':
                    return self._get_project(project_id)
                if method == 'DELETE':
                    return self._delete_project(project_id)
            elif len(tail) == 2:
                project_id, action = tail
                if action == 'intake' and method == 'POST':
                    return self._intake(project_id)
                if action == 'build' and method == 'POST':
                    return self._build(project_id)
                if action == 'rounds' and method == 'GET':
                    return self._rounds_status(project_id)
            elif len(tail) == 3 and tail[1] == 'rounds':
                project_id, _rounds, sub = tail
                if sub == 'open' and method == 'POST':
                    return self._rounds_open(project_id)
                if sub == 'check' and method == 'POST':
                    return self._rounds_check(project_id)
            raise NotFound('unknown route')

        if method == 'GET' and parts[:1] == ['site'] and len(parts) >= 2:
            project_id = parts[1]
            sub_path = '/'.join(parts[2:])
            return self._serve_static(project_id, sub_path)

        raise NotFound('unknown route')

    # ------------------------------------------------------------------ handlers
    def _list_projects(self) -> None:
        records = registry.list_projects()
        self._send_json(200, [_project_summary(r) for r in records])

    def _create_project(self) -> None:
        body = self._read_json_body()
        name = body.get('name')
        target_repo = body.get('targetRepo')
        workspace_dir = body.get('workspaceDir')
        if not name or not target_repo or not workspace_dir:
            raise BadRequest('name, targetRepo, workspaceDir are required')
        sources = body.get('sources') or []
        tagline = body.get('tagline', '') or ''

        try:
            target_repo_abs, workspace_abs = registry.resolve_workspace(target_repo, workspace_dir)
        except registry.PathError as exc:
            raise BadRequest(str(exc)) from exc

        init_result = ops.op_init(workspace_abs, target_repo_abs, name, sources, tagline)
        if init_result['code'] != 0:
            self._send_json(200, init_result)
            return

        record = registry.register_project(name, str(target_repo_abs), str(workspace_abs), tagline)
        self._send_json(200, {**record, 'init': init_result})

    def _adopt_project(self) -> None:
        body = self._read_json_body()
        target_repo = body.get('targetRepo')
        workspace_dir = body.get('workspaceDir')
        if not target_repo or not workspace_dir:
            raise BadRequest('targetRepo, workspaceDir are required')
        try:
            record = registry.adopt_project(target_repo, workspace_dir)
        except registry.PathError as exc:
            raise BadRequest(str(exc)) from exc
        self._send_json(200, record)

    def _delete_project(self, project_id: str) -> None:
        if not registry.unregister_project(project_id):
            raise NotFound('unknown project')
        self._send_json(200, {'ok': True})

    def _get_project(self, project_id: str) -> None:
        record = self._require_project(project_id)
        self._send_json(200, _project_detail(record))

    def _intake(self, project_id: str) -> None:
        record = self._require_project(project_id)
        body = self._read_json_body()
        paths = body.get('paths') or []
        if not paths:
            raise BadRequest('paths is required and must be a non-empty list')
        result = ops.op_intake(record['workspaceDir'], paths, body.get('kind'), body.get('title'),
                               body.get('date'))
        self._send_json(200, result)

    def _build(self, project_id: str) -> None:
        record = self._require_project(project_id)
        result = ops.op_build(record['workspaceDir'])
        self._send_json(200, result)

    def _rounds_status(self, project_id: str) -> None:
        record = self._require_project(project_id)
        self._send_json(200, ops.op_round_status(record['workspaceDir']))

    def _rounds_open(self, project_id: str) -> None:
        record = self._require_project(project_id)
        body = self._read_json_body()
        at = body.get('at')
        trigger = body.get('trigger')
        if not at or not trigger:
            raise BadRequest('at, trigger are required')
        result = ops.op_round_open(record['workspaceDir'], at, trigger, body.get('reports'))
        self._send_json(200, result)

    def _rounds_check(self, project_id: str) -> None:
        record = self._require_project(project_id)
        body = self._read_json_body()
        missing = [f for f in ('doc', 'match', 'verdict', 'now') if not body.get(f)]
        if missing:
            raise BadRequest(f'missing required fields: {", ".join(missing)}')
        result = ops.op_round_check(
            record['workspaceDir'],
            doc=body.get('doc'), match=body.get('match'), verdict=body.get('verdict'),
            now=body.get('now'), target=body.get('target'), by=body.get('by'),
            provenance=body.get('provenance'), url=body.get('url'),
            fixState=body.get('fixState'), claim=body.get('claim'),
            claimWritten=body.get('claimWritten'), at=body.get('at'), round=body.get('round'),
        )
        self._send_json(200, result)

    def _serve_static(self, project_id: str, sub_path: str) -> None:
        record = self._require_project(project_id)
        try:
            loaded = static.load_static_file(record['workspaceDir'], sub_path)
        except static.TraversalError:
            raise HttpError(403, 'path escapes workspace') from None
        if loaded is None:
            raise NotFound('file not found')
        body, content_type = loaded
        self._send_bytes(200, body, content_type)

    # Quieter default logging would be nice, but stdlib's default (stderr, one line per request) is
    # left as-is — it is useful when this runs supervised by the Node runtime in Task 3+.
