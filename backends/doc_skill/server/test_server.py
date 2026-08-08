# Copyright (C) 2026 Akselos
"""Unit + integration tests for the doc-skill sidecar.

Run via `python3 -m unittest discover backends/doc_skill/server` from the repo root. Every test uses
`tempfile.TemporaryDirectory()` for isolation — the real `~/.agent/doc-skill/projects.json` is never
touched; every `registry` call in here passes an explicit `path=` pointing at a temp file instead.

Import note: with that exact invocation, `start_dir` and `top_level_dir` are the same directory (no
`-t` given), so `unittest`'s discovery imports this file as a bare top-level module (`test_server`,
not `server.test_server`) — see `TestLoader._find_tests`. A `from . import ...` relative import
would fail in that mode (`ImportError: attempted relative import with no known parent package`), so
the sibling modules are imported flat here instead; discovery already puts this directory at the
front of `sys.path`, so `import ops` etc. resolve directly. `server/app.py` and `server/__main__.py`
keep proper relative imports (`from . import ops`) since they only ever run as part of the `server`
package (`python3 -m server`), a different execution path from this test discovery mode.
"""

from __future__ import annotations

import json
import pathlib
import tempfile
import unittest

import ops
import registry
import static


class RegistryRoundTripTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.tmp = pathlib.Path(self._tmp.name)
        self.state_path = self.tmp / 'registry' / 'projects.json'  # parent dir does not exist yet

        self.target_repo = self.tmp / 'target_repo'
        self.target_repo.mkdir()
        (self.target_repo / 'workspace').mkdir()

    def test_register_list_get_unregister(self) -> None:
        record = registry.register_project(
            'My Project', str(self.target_repo), 'workspace', tagline='hi', path=self.state_path)
        self.assertTrue(self.state_path.exists(), 'save_registry should create parent dirs')
        self.assertEqual(record['name'], 'My Project')
        self.assertEqual(record['tagline'], 'hi')
        self.assertEqual(record['id'], registry.make_id(pathlib.Path(record['workspaceDir'])))

        listed = registry.list_projects(path=self.state_path)
        self.assertEqual([p['id'] for p in listed], [record['id']])

        fetched = registry.get_project(record['id'], path=self.state_path)
        self.assertEqual(fetched, record)

        self.assertIsNone(registry.get_project('doesnotexist', path=self.state_path))

        removed = registry.unregister_project(record['id'], path=self.state_path)
        self.assertTrue(removed)
        self.assertEqual(registry.list_projects(path=self.state_path), [])

        # unregister never touches files on disk
        self.assertTrue((self.target_repo / 'workspace').exists())

        # unregistering again reports nothing removed
        self.assertFalse(registry.unregister_project(record['id'], path=self.state_path))

    def test_register_rejects_dotdot_escape(self) -> None:
        with self.assertRaises(registry.PathError):
            registry.register_project(
                'Escaper', str(self.target_repo), '../../etc', path=self.state_path)
        self.assertEqual(registry.list_projects(path=self.state_path), [])

    def test_register_rejects_symlink_escape(self) -> None:
        outside = self.tmp / 'outside'
        outside.mkdir()
        symlink = self.target_repo / 'escape_link'
        symlink.symlink_to(outside, target_is_directory=True)
        with self.assertRaises(registry.PathError):
            registry.register_project(
                'Escaper', str(self.target_repo), 'escape_link', path=self.state_path)

    def test_adopt_requires_site_json(self) -> None:
        with self.assertRaises(registry.PathError):
            registry.adopt_project(str(self.target_repo), 'workspace', path=self.state_path)

        (self.target_repo / 'workspace' / 'site.json').write_text(
            json.dumps({'project': 'Adopted'}), encoding='utf-8')
        record = registry.adopt_project(str(self.target_repo), 'workspace', path=self.state_path)
        self.assertEqual(record['name'], 'Adopted')

    def test_adopt_rejects_traversal_same_as_register(self) -> None:
        with self.assertRaises(registry.PathError):
            registry.adopt_project(str(self.target_repo), '../../etc', path=self.state_path)


class StaticTraversalTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.workspace = pathlib.Path(self._tmp.name) / 'workspace'
        self.workspace.mkdir()
        (self.workspace / 'index.html').write_text('<html>hub</html>', encoding='utf-8')
        (self.workspace / 'doc_summary.html').write_text('<html>doc</html>', encoding='utf-8')

    def test_serves_named_file(self) -> None:
        body, content_type = static.load_static_file(self.workspace, 'doc_summary.html')
        self.assertEqual(body, b'<html>doc</html>')
        self.assertEqual(content_type, 'text/html')

    def test_empty_path_serves_index(self) -> None:
        body, content_type = static.load_static_file(self.workspace, '')
        self.assertEqual(body, b'<html>hub</html>')
        self.assertEqual(content_type, 'text/html')

    def test_missing_file_returns_none(self) -> None:
        self.assertIsNone(static.load_static_file(self.workspace, 'nope.html'))

    def test_dotdot_traversal_rejected(self) -> None:
        with self.assertRaises(static.TraversalError):
            static.load_static_file(self.workspace, '../../../etc/passwd')

    def test_symlink_traversal_rejected(self) -> None:
        outside = pathlib.Path(self._tmp.name) / 'secret.txt'
        outside.write_text('top secret', encoding='utf-8')
        link = self.workspace / 'escape.txt'
        link.symlink_to(outside)
        with self.assertRaises(static.TraversalError):
            static.load_static_file(self.workspace, 'escape.txt')

    def test_content_type_guessing(self) -> None:
        for name, expected in (
            ('a.css', 'text/css'), ('a.md', 'text/markdown'), ('a.js', 'text/javascript'),
            ('a.json', 'application/json'), ('a.svg', 'image/svg+xml'),
            ('a.bin', 'application/octet-stream'),
        ):
            (self.workspace / name).write_text('x', encoding='utf-8')
            _body, content_type = static.load_static_file(self.workspace, name)
            self.assertEqual(content_type, expected, name)


class HappyPathIntegrationTests(unittest.TestCase):
    """Real subprocess calls into the vendored scripts — not mocked."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.tmp = pathlib.Path(self._tmp.name)

        self.target_repo = self.tmp / 'target_repo'
        self.target_repo.mkdir()
        (self.target_repo / 'hello.py').write_text(
            'def greet(name):\n    """Say hi."""\n    return f"hi {name}"\n', encoding='utf-8')

        self.inputs_dir = self.tmp / 'inputs'
        self.inputs_dir.mkdir()
        (self.inputs_dir / 'notes.md').write_text('# Notes\n\nSome kickoff notes.\n', encoding='utf-8')

        self.workspace = self.target_repo / '.agent' / 'doc_ws'

    def test_init_intake_build(self) -> None:
        init_result = ops.op_init(
            workspace_abs=self.workspace,
            target_repo_abs=self.target_repo,
            project_name='Happy Path Test',
            sources=['hello.py'],
            tagline='integration test',
        )
        self.assertEqual(init_result['code'], 0, init_result['stderr'])
        self.assertTrue((self.workspace / 'site.json').exists())

        intake_result = ops.op_intake(
            workspace_abs=self.workspace,
            paths=[str(self.inputs_dir / 'notes.md')],
        )
        self.assertEqual(intake_result['code'], 0, intake_result['stderr'])

        build_result = ops.op_build(self.workspace)
        self.assertEqual(build_result['code'], 0, build_result['stderr'])
        self.assertIn('durationMs', build_result)
        self.assertTrue((self.workspace / 'index.html').exists())

        status = ops.op_round_status(self.workspace)
        self.assertNotIn('error', status)
        self.assertEqual(status['claims'], 0)
        self.assertEqual(status['currentRound'], 0)


if __name__ == '__main__':
    unittest.main()
