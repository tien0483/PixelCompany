"""usage-overview route: tokscale metrics + Claude flags."""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
from unittest.mock import patch

from fastapi import FastAPI
from starlette.testclient import TestClient

from manager.api.routes.analytics import router
from manager.web.analytics_db import AnalyticsDB
from manager.web.tokscale_usage import clear_tokscale_cache


def _app(analytics_db=None):
    app = FastAPI()
    app.state.analytics_db = analytics_db
    app.include_router(router, prefix="/api/analytics")
    return app


def _file_db():
    path = os.path.join(
        tempfile.gettempdir(),
        f"jacked_test_usage_overview_{os.getpid()}.db",
    )
    if os.path.exists(path):
        os.unlink(path)
    return AnalyticsDB(db_path=path)


SAMPLE = {
    "entries": [
        {
            "client": "claude",
            "provider": "anthropic",
            "model": "opus",
            "input": 100,
            "output": 20,
            "cacheRead": 80,
            "cacheWrite": 0,
            "cost": 0.5,
            "messageCount": 1,
        }
    ]
}


class TestUsageOverviewRoute:
    def setup_method(self):
        clear_tokscale_cache()

    def test_tokscale_ok_without_analytics_db(self):
        def run(argv):
            return subprocess.CompletedProcess(argv, 0, stdout=json.dumps(SAMPLE), stderr="")

        with patch("manager.web.tokscale_usage._default_run", run):
            client = TestClient(_app(None))
            resp = client.get("/api/analytics/usage-overview?days=1")
        assert resp.status_code == 200
        body = resp.json()
        assert body["source"] == "tokscale"
        assert body["error"] is None
        assert body["flags"] == []
        assert body["overview"]["total_tokens"] == 200
        assert body["overview"]["by_provider"][0]["provider"] == "anthropic"

    def test_tokscale_fail_still_returns_flags(self):
        db = _file_db()
        db.insert_flag("cache_health", "warn", "s1", "p1", "drop")

        def run(argv):
            return subprocess.CompletedProcess(argv, 127, stdout="", stderr="missing")

        with patch("manager.web.tokscale_usage._default_run", run):
            client = TestClient(_app(db))
            resp = client.get("/api/analytics/usage-overview?days=7")
        assert resp.status_code == 200
        body = resp.json()
        assert body["source"] == "none"
        assert len(body["flags"]) == 1
        assert body["overview"]["total_tokens"] is None
        db.close()
