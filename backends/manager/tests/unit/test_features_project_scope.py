"""Per-project scoping of the Manager catalog.

The catalog used to install into ``~/.claude`` unconditionally, so a shelf toggle
ignored whichever project PixelOffice had selected and every project shared one set
of staff and playbooks. These tests pin the project-scoped behaviour: installs land
in ``<repo>/.claude``, the global dir is left alone, and ``installed`` flags read
back per project.
"""

import asyncio
from unittest import mock

import pytest

from manager.api.routes import features
from manager.api.routes.features import (
    FeatureToggleRequest,
    _target_claude_dir,
    list_features,
    toggle_feature,
)


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


@pytest.fixture
def catalog(tmp_path):
    """Minimal catalog with one agent, one command, one skill and the rules source."""
    root = tmp_path / "catalog"
    (root / "agents").mkdir(parents=True)
    (root / "agents" / "qa-bot.md").write_text(
        "---\nname: QA Bot\ndescription: checks things\n---\nbody\n", encoding="utf-8"
    )
    (root / "commands").mkdir()
    (root / "commands" / "ship.md").write_text(
        "---\ndescription: ships it\n---\nbody\n", encoding="utf-8"
    )
    skill_dir = root / "skills" / "dcr"
    skill_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text("---\nname: dcr\n---\nbody\n", encoding="utf-8")
    (root / "rules").mkdir()
    (root / "rules" / "manager_behaviors.md").write_text("# rules\n", encoding="utf-8")
    (root / "rules" / "manager-reference.md").write_text("# reference\n", encoding="utf-8")
    return root


@pytest.fixture
def global_claude(tmp_path):
    """Stand-in for ~/.claude so a leak out of the project dir is detectable."""
    return tmp_path / "global-home" / ".claude"


@pytest.fixture(autouse=True)
def _pinned(catalog, global_claude):
    with (
        mock.patch.object(features, "DATA_ROOT", catalog),
        mock.patch.object(features, "CLAUDE_DIR", global_claude),
        mock.patch.object(features, "CLAUDE_MD", global_claude / "CLAUDE.md"),
    ):
        yield


class _Request:
    """`toggle_feature` only reads `request.app.state.db`, and only for hooks."""

    class app:  # noqa: N801 - mimics the FastAPI attribute chain
        class state:
            db = None


def _toggle(category, name, enabled, repo_path=None):
    body = FeatureToggleRequest(enabled=enabled, repo_path=repo_path)
    return _run(toggle_feature(category=category, name=name, body=body, request=_Request()))


class TestTargetClaudeDir:
    def test_repo_path_selects_project_dir(self, tmp_path):
        assert _target_claude_dir(str(tmp_path)) == tmp_path.resolve() / ".claude"

    def test_blank_and_missing_fall_back_to_global(self, global_claude):
        assert _target_claude_dir(None) == global_claude
        assert _target_claude_dir("   ") == global_claude


class TestToggleInstallsIntoProject:
    def test_agent_lands_in_project_and_not_global(self, tmp_path, global_claude):
        repo = tmp_path / "project-a"
        repo.mkdir()

        result = _toggle("agents", "qa-bot", True, repo_path=str(repo))

        assert result == {"name": "qa-bot", "category": "agents", "enabled": True}
        assert (repo / ".claude" / "agents" / "qa-bot.md").exists()
        assert not (global_claude / "agents" / "qa-bot.md").exists()

    def test_command_lands_in_project(self, tmp_path, global_claude):
        repo = tmp_path / "project-a"
        repo.mkdir()

        _toggle("commands", "ship", True, repo_path=str(repo))

        assert (repo / ".claude" / "commands" / "ship.md").exists()
        assert not (global_claude / "commands" / "ship.md").exists()

    def test_skill_lands_in_project_and_uninstall_removes_the_dir(self, tmp_path):
        repo = tmp_path / "project-a"
        repo.mkdir()
        skill_md = repo / ".claude" / "skills" / "dcr" / "SKILL.md"

        _toggle("knowledge", "skill_dcr", True, repo_path=str(repo))
        assert skill_md.exists()

        _toggle("knowledge", "skill_dcr", False, repo_path=str(repo))
        assert not skill_md.parent.exists()

    def test_skill_copies_entire_directory_including_scripts(self, tmp_path, catalog):
        repo = tmp_path / "project-b"
        repo.mkdir()
        script_file = catalog / "skills" / "dcr" / "scripts" / "run.sh"
        script_file.parent.mkdir(parents=True, exist_ok=True)
        script_file.write_text("#!/bin/bash\necho ok", encoding="utf-8")

        _toggle("knowledge", "skill_dcr", True, repo_path=str(repo))
        installed_script = repo / ".claude" / "skills" / "dcr" / "scripts" / "run.sh"
        assert installed_script.exists()
        assert installed_script.read_text(encoding="utf-8") == "#!/bin/bash\necho ok"

    def test_rules_append_to_the_project_claude_md(self, tmp_path, global_claude):
        repo = tmp_path / "project-a"
        repo.mkdir()

        _toggle("knowledge", "rules", True, repo_path=str(repo))

        assert (repo / ".claude" / "CLAUDE.md").read_text(encoding="utf-8").strip() == "# rules"
        assert not (global_claude / "CLAUDE.md").exists()

    def test_reference_lands_in_project(self, tmp_path, global_claude):
        repo = tmp_path / "project-a"
        repo.mkdir()

        _toggle("knowledge", "reference", True, repo_path=str(repo))

        assert (repo / ".claude" / "manager-reference.md").exists()
        assert not (global_claude / "manager-reference.md").exists()

    def test_omitting_repo_path_still_writes_globally(self, global_claude):
        _toggle("agents", "qa-bot", True)
        assert (global_claude / "agents" / "qa-bot.md").exists()


class TestListFeaturesScope:
    def test_installed_flags_are_per_project(self, tmp_path):
        repo_a = tmp_path / "project-a"
        repo_b = tmp_path / "project-b"
        repo_a.mkdir()
        repo_b.mkdir()
        _toggle("agents", "qa-bot", True, repo_path=str(repo_a))

        listing_a = _run(list_features(repo_path=str(repo_a)))
        listing_b = _run(list_features(repo_path=str(repo_b)))

        assert [a["installed"] for a in listing_a["agents"] if a["name"] == "qa-bot"] == [True]
        assert [a["installed"] for a in listing_b["agents"] if a["name"] == "qa-bot"] == [False]

    def test_scope_is_reported_back(self, tmp_path):
        repo = tmp_path / "project-a"
        repo.mkdir()

        listing = _run(list_features(repo_path=str(repo)))

        assert listing["scope"]["repo_path"] == str(repo.resolve())
        assert listing["scope"]["claude_dir"] == str(repo.resolve() / ".claude")
        # Hooks patch machine-wide Claude Code settings, so they stay out of the
        # project-scoped set even when a project is selected.
        assert "hooks" not in listing["scope"]["project_scoped_categories"]

    def test_global_listing_reports_no_repo(self, global_claude):
        listing = _run(list_features(repo_path=None))
        assert listing["scope"]["repo_path"] is None
        assert listing["scope"]["claude_dir"] == str(global_claude)


class TestTraversalGuard:
    def test_escape_from_the_project_dir_is_rejected(self, tmp_path):
        repo = tmp_path / "project-a"
        repo.mkdir()
        # A name that resolves outside <repo>/.claude must be refused, not written.
        response = _toggle("agents", "../../escape", True, repo_path=str(repo))
        assert getattr(response, "status_code", None) == 422
        assert not (tmp_path / "escape.md").exists()


class TestInstallationsOverviewIsProjectScoped:
    """`/api/installations/overview` used to read ~/.claude regardless of project,
    so every per-project install showed as missing in the Installations view."""

    @staticmethod
    def _overview(repo_path=None):
        from manager.api.routes.system import installations_overview

        return _run(installations_overview(request=_Request(), repo_path=repo_path))

    @staticmethod
    def _installed(overview, section, name):
        items = getattr(overview.global_install, section)
        return [i.installed for i in items if i.name == name]

    def test_project_install_reads_back_for_that_project_only(self, tmp_path):
        repo_a = tmp_path / "project-a"
        repo_a.mkdir()
        repo_b = tmp_path / "project-b"
        repo_b.mkdir()
        _toggle("knowledge", "skill_dcr", True, repo_path=str(repo_a))
        _toggle("agents", "qa-bot", True, repo_path=str(repo_a))
        _toggle("commands", "ship", True, repo_path=str(repo_a))

        overview_a = self._overview(str(repo_a))
        assert self._installed(overview_a, "skills", "skill_dcr") == [True]
        assert self._installed(overview_a, "agents", "qa-bot") == [True]
        assert self._installed(overview_a, "commands", "ship") == [True]

        overview_b = self._overview(str(repo_b))
        assert self._installed(overview_b, "skills", "skill_dcr") == [False]
        assert self._installed(overview_b, "agents", "qa-bot") == [False]
        assert self._installed(overview_b, "commands", "ship") == [False]

    def test_no_repo_path_still_reads_the_global_dir(self, tmp_path):
        repo = tmp_path / "project-a"
        repo.mkdir()
        _toggle("knowledge", "skill_dcr", True, repo_path=str(repo))

        # The project install must not leak into the global readout.
        assert self._installed(self._overview(None), "skills", "skill_dcr") == [False]

    def test_hooks_stay_machine_wide(self, tmp_path):
        repo = tmp_path / "project-a"
        repo.mkdir()
        # Hooks patch settings.json, not <repo>/.claude, so scoping must not touch them.
        assert [h.name for h in self._overview(str(repo)).global_install.hooks] == ["sounds"]
