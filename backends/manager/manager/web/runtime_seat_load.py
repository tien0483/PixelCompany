"""In-memory seat load reported by the Kanban runtime."""

from __future__ import annotations

import time
from threading import Lock

_lock = Lock()
_seat_load: dict[int, int] = {}
_updated_at: float = 0.0
_TTL_SECONDS = 120.0


def update_seat_load(load: dict[int, int]) -> None:
    global _seat_load, _updated_at
    with _lock:
        _seat_load = {int(k): int(v) for k, v in load.items() if int(v) > 0}
        _updated_at = time.time()


def get_seat_load() -> dict[int, int]:
    with _lock:
        if time.time() - _updated_at > _TTL_SECONDS:
            return {}
        return dict(_seat_load)
