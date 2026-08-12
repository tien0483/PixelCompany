# Copyright (C) 2026 Akselos
"""Subprocess wrappers around the vendored `harness_doc_site` scripts.

This module does not reimplement any of that skill's logic — every function here shells out to the
real script (either the vendored copy under `skills/harness_doc_site/scripts/`, for the one-time
`init_doc_site.py` scaffold, or the workspace's own copy, for everything after). Every wrapper
returns a `{code, stdout, stderr, ...}` shape instead of raising on a non-zero exit or a timeout, so
a broken subprocess never crashes the HTTP server — `server/app.py` decides what that becomes on the
wire.
"""

from __future__ import annotations

import json
import os
import pathlib
import subprocess
import sys
import time

# server/../  ==  backends/doc_skill
DOC_SKILL_ROOT = pathlib.Path(__file__).resolve().parent.parent
VENDORED_SCRIPTS = DOC_SKILL_ROOT / 'skills' / 'harness_doc_site' / 'scripts'

PYTHON = sys.executable or 'python3'


def _run(args: list[str], cwd: str | pathlib.Path | None, timeout: float) -> dict:
    """Runs a subprocess, always returning `{code, stdout, stderr}` — never raising."""
    try:
        proc = subprocess.run(args, cwd=str(cwd) if cwd is not None else None,
                              capture_output=True, text=True, timeout=timeout)
        return {'code': proc.returncode, 'stdout': proc.stdout, 'stderr': proc.stderr}
    except subprocess.TimeoutExpired as exc:
        stdout = exc.stdout if isinstance(exc.stdout, str) else (exc.stdout or b'').decode('utf-8', 'replace')
        stderr = exc.stderr if isinstance(exc.stderr, str) else (exc.stderr or b'').decode('utf-8', 'replace')
        return {'code': -1, 'stdout': stdout,
                'stderr': stderr + f'\n[sidecar] timed out after {timeout}s'}
    except OSError as exc:
        return {'code': -1, 'stdout': '', 'stderr': f'[sidecar] failed to start subprocess: {exc}'}


def op_init(workspace_abs: str | pathlib.Path, target_repo_abs: str | pathlib.Path,
            project_name: str, sources: list[str] | None = None, tagline: str = '') -> dict:
    """Scaffolds a brand-new workspace by invoking the *vendored* `init_doc_site.py`.

    The workspace directory does not exist yet, so this runs with `cwd` at the vendored scripts dir
    rather than the (nonexistent) workspace.
    """
    script = VENDORED_SCRIPTS / 'init_doc_site.py'
    repo_root = os.path.relpath(str(target_repo_abs), str(workspace_abs))
    args = [PYTHON, str(script),
            '--project', project_name,
            '--dir', str(workspace_abs),
            '--repo-root', repo_root]
    for src in (sources or []):
        args += ['--source', src]
    if tagline:
        args += ['--tagline', tagline]
    return _run(args, cwd=VENDORED_SCRIPTS, timeout=30)


def op_intake(workspace_abs: str | pathlib.Path, paths: list[str], kind: str | None = None,
              title: str | None = None, date: str | None = None) -> dict:
    """Invokes the workspace's own `intake.py` to register input files as docs."""
    script = pathlib.Path(workspace_abs) / 'intake.py'
    args = [PYTHON, str(script), *paths]
    if kind:
        args += ['--kind', kind]
    if title:
        args += ['--title', title]
    if date:
        args += ['--date', date]
    return _run(args, cwd=workspace_abs, timeout=30)


def op_build(workspace_abs: str | pathlib.Path) -> dict:
    """Builds the HTML site: `code_index.py` then `build_site.py --no-subs`.

    Two deliberate deviations from a literal "just run build_site.py":

    1. `build_site.py`'s `citations.Resolver.__init__` reads `code_index.json` unconditionally with
       no existence check — on a workspace that has never had `code_index.py` run, `build_site.py`
       crashes with `FileNotFoundError` before rendering a single page. `code_index.py` takes no CLI
       args and only ever writes that file next to itself, so it always runs first here, exactly
       like the documented human workflow (`README_FIRST.md`: "python code_index.py && python
       build_site.py").
    2. `build_site.py` defaults to also running the "legacy generators" step, which does
       `runpy.run_path(build_capability_visualizers.py)` unconditionally. That file is not among the
       seven scripts `init_doc_site.py` copies into a new workspace (and does not exist anywhere in
       this repo) — running it without `--no-subs` is a guaranteed `FileNotFoundError` on every
       workspace this sidecar creates. `--no-subs` is passed unconditionally to avoid that; the
       `_load_diagrams()` fallback it would otherwise feed already degrades gracefully to "no
       diagrams" when the legacy module is absent, so nothing is lost.

    Returns `{code, stdout, stderr, durationMs}`. `code`/`stdout`/`stderr` are `build_site.py`'s if
    `code_index.py` succeeded, otherwise `code_index.py`'s own failure is returned as-is (with
    `durationMs` still measured) so the caller sees why the build never ran.
    """
    workspace_abs = pathlib.Path(workspace_abs)
    start = time.monotonic()

    index_result = _run([PYTHON, str(workspace_abs / 'code_index.py')], cwd=workspace_abs, timeout=60)
    if index_result['code'] != 0:
        return {**index_result, 'durationMs': int((time.monotonic() - start) * 1000)}

    build_result = _run([PYTHON, str(workspace_abs / 'build_site.py'), '--no-subs'],
                        cwd=workspace_abs, timeout=120)
    duration_ms = int((time.monotonic() - start) * 1000)
    return {
        'code': build_result['code'],
        'stdout': index_result['stdout'] + build_result['stdout'],
        'stderr': index_result['stderr'] + build_result['stderr'],
        'durationMs': duration_ms,
    }


def op_round_status(workspace_abs: str | pathlib.Path) -> dict:
    """Invokes `round_tool.py status --json` and parses the result.

    Returns the parsed dict on success, or `{error, code, stdout, stderr}` if the process failed or
    its stdout was not valid JSON (e.g. an un-forked workspace copy of `round_tool.py` predating the
    `--json` flag).
    """
    script = pathlib.Path(workspace_abs) / 'round_tool.py'
    result = _run([PYTHON, str(script), 'status', '--json'], cwd=workspace_abs, timeout=15)
    if result['code'] != 0:
        return {'error': 'round_tool.py status failed', **result}
    try:
        return json.loads(result['stdout'])
    except json.JSONDecodeError:
        return {'error': 'round_tool.py status did not return valid JSON', **result}


def op_round_open(workspace_abs: str | pathlib.Path, at: str, trigger: str,
                   reports: list[str] | None = None) -> dict:
    """Invokes `round_tool.py open --at ... --trigger ...`."""
    script = pathlib.Path(workspace_abs) / 'round_tool.py'
    args = [PYTHON, str(script), 'open', '--at', at, '--trigger', trigger]
    if reports:
        args += ['--reports', *reports]
    return _run(args, cwd=workspace_abs, timeout=15)


# Request field (camelCase) -> CLI flag, for `op_round_check`. Fields not listed here map to
# `--kebab-case` of the same name (e.g. `doc` -> `--doc`, `match` -> `--match`).
_CHECK_FLAG_OVERRIDES = {
    'fixState': '--fix-state',
    'claimWritten': '--claim-written',
}


def _camel_to_kebab_flag(field: str) -> str:
    out = []
    for ch in field:
        if ch.isupper():
            out.append('-')
            out.append(ch.lower())
        else:
            out.append(ch)
    return '--' + ''.join(out)


def op_round_check(workspace_abs: str | pathlib.Path, **fields) -> dict:
    """Invokes `round_tool.py check ...`, mapping camelCase request fields to CLI flags.

    Accepts any of: doc, match, verdict, now, target, by, provenance, url, fixState, claim,
    claimWritten, at, round. Only fields with a non-None value are passed through.
    """
    script = pathlib.Path(workspace_abs) / 'round_tool.py'
    args = [PYTHON, str(script), 'check']
    for field, value in fields.items():
        if value is None or value == '':
            continue
        flag = _CHECK_FLAG_OVERRIDES.get(field) or _camel_to_kebab_flag(field)
        args += [flag, str(value)]
    return _run(args, cwd=workspace_abs, timeout=15)
