"""OmniRoute Special Seat support for Manager.

OmniRoute is a unified AI router service. This module manages its seat row in manager's
SQLite database so that users can select OmniRoute via "Use Account" or pin OmniRoute
for main task cards and subagents.
"""

from __future__ import annotations

import logging
from typing import Optional

logger = logging.getLogger(__name__)

OMNIROUTE_EXPIRES_SENTINEL = 4102444800  # 2100-01-01T00:00:00Z
OMNIROUTE_SPECIAL_SEAT_EMAIL = "omniroute@pixelcompany.local"


def ensure_omniroute_account(db, make_active: bool = False) -> dict:
    """Ensure the OmniRoute Special Seat exists in the accounts database."""
    accounts = db.list_accounts(include_inactive=True)
    for acct in accounts:
        if acct.get("provider") == "omniroute" or acct.get("email") == OMNIROUTE_SPECIAL_SEAT_EMAIL:
            if make_active:
                db.set_active_account_id(acct["id"], provider="omniroute")
            return acct

    # Create the special seat if missing
    acct = db.create_account(
        email=OMNIROUTE_SPECIAL_SEAT_EMAIL,
        access_token="omniroute-special-seat",
        expires_at=OMNIROUTE_EXPIRES_SENTINEL,
        refresh_token=None,
        subscription_type="pro",
        organization_uuid="omniroute",
        provider="omniroute",
    )
    db.update_account(
        acct["id"],
        display_name="OmniRoute (Special Seat)",
        validation_status="valid",
        is_active=True,
    )
    res = db.get_account(acct["id"]) or acct
    if make_active:
        db.set_active_account_id(res["id"], provider="omniroute")
    logger.info("Created OmniRoute Special Seat account (id=%s)", res.get("id"))
    return res
