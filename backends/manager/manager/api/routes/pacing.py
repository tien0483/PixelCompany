"""Fleet pacing route.

Exposes ``jacked.service.usage_pacing.compute_best_account_summary`` over HTTP so
consumers other than the ``jacked usage --json`` CLI (notably the Kanban runtime's
auto-pause-until-reset scheduler) can read the fleet's pause target without shelling
out. Pure re-exposure — the pacing math stays in ``usage_pacing`` and is pinned by
``tests/unit/test_usage_cmd.py``.
"""

from fastapi import APIRouter, Request, status
from fastapi.responses import JSONResponse

from manager.service.usage_pacing import compute_best_account_summary

router = APIRouter()


@router.get("/usage-pacing")
async def usage_pacing(request: Request):
    """Fleet pacing summary: most-headroom account + earliest workable reset.

    Returns the ``compute_best_account_summary`` shape verbatim:
    ``{"accounts_with_usage_data", "best_account_email", "best_account_id",
    "best_account_worst_window_pct", "best_account_cache_age_seconds",
    "pause_until"}``. ``pause_until`` is an ISO timestamp (or null when unknown),
    and ``best_account_worst_window_pct`` at/above the constrained threshold means
    every eligible account is walled. A missing DB yields 503 so the caller can
    fall back to error-driven pacing rather than a wrong number.
    """
    db = getattr(request.app.state, "db", None)
    if db is None:
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={"error": {"message": "Database unavailable", "code": "DB_UNAVAILABLE"}},
        )

    # Active accounts only (matches the menubar route); compute_best_account_summary
    # still applies its own eligibility filter (a disabled/invalid login never reports
    # headroom) on top, so a stale-but-active dead login can't set a false wake time.
    rows = db.list_accounts(include_inactive=False)
    return compute_best_account_summary(rows)
