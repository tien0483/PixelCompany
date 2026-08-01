"""Unit tests for the fleet pacing endpoint (GET /api/usage-pacing).

The route is a thin HTTP re-exposure of
``jacked.service.usage_pacing.compute_best_account_summary`` (whose math is pinned
separately by ``test_usage_cmd.py``); these tests only assert the wiring — status
codes, the summary shape, and DB-unavailable handling.
"""

from fastapi import FastAPI
from starlette.testclient import TestClient

from manager.api.routes.pacing import router


class _FakeDB:
    def __init__(self, rows):
        self._rows = rows

    def list_accounts(self, include_inactive: bool = False):
        if include_inactive:
            return list(self._rows)
        return [r for r in self._rows if r.get("is_active")]


def _make_app(rows=None) -> FastAPI:
    app = FastAPI()
    app.include_router(router, prefix="/api")
    if rows is not None:
        app.state.db = _FakeDB(rows)
    return app


# Reset timestamps far in the future keep the assertions stable no matter the real
# clock: a future reset is never "stale headroom", so the cached percent stands.
_FUTURE_5H = "2099-01-02T01:00:00Z"
_FUTURE_7D = "2099-01-05T00:00:00Z"
# usage_cached_at is a fixed past epoch (2024-01-01) — older than the future resets,
# so it predates no turnover and the 96% stays 96%.
_CACHED_AT = 1_704_067_200


def _constrained_account():
    """A live account whose 7d window is walled (96%) with a known future reset."""
    return {
        "id": 2,
        "email": "live@x.com",
        "is_active": 1,
        "validation_status": "valid",
        "cached_usage_5h": 8.0,
        "cached_usage_7d": 96.0,
        "usage_cached_at": _CACHED_AT,
        "cached_5h_resets_at": _FUTURE_5H,
        "cached_7d_resets_at": _FUTURE_7D,
    }


def test_returns_summary_shape():
    app = _make_app([_constrained_account()])
    resp = TestClient(app).get("/api/usage-pacing")
    assert resp.status_code == 200
    data = resp.json()
    assert data["best_account_email"] == "live@x.com"
    assert data["best_account_worst_window_pct"] == 96.0
    # pause_until is the CONSTRAINED 7d window, not the idle 5h one.
    assert data["pause_until"].startswith("2099-01-05")


def test_headroom_account_has_null_pause():
    """A fresh account (low usage) is not constrained → pause_until is null."""
    acct = _constrained_account()
    acct["cached_usage_7d"] = 10.0
    app = _make_app([acct])
    resp = TestClient(app).get("/api/usage-pacing")
    assert resp.status_code == 200
    data = resp.json()
    assert data["best_account_worst_window_pct"] == 10.0
    assert data["pause_until"] is None


def test_missing_db_returns_503():
    app = _make_app(rows=None)
    resp = TestClient(app).get("/api/usage-pacing")
    assert resp.status_code == 503
    assert resp.json()["error"]["code"] == "DB_UNAVAILABLE"
