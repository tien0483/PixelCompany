"""WSL detection and Windows drive-mount helpers.

Cursor is a Windows app. Under WSL the manager backend is Linux Python, so the
IDE's ``state.vscdb`` lives on a ``/mnt/<drive>`` DrvFs mount rather than under
``~/.config``, and a Linux process probe cannot see ``Cursor.exe`` at all. Both
of those facts are needed in two different modules, so they live here.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Mapping, Optional

DEFAULT_WINDOWS_MOUNT_ROOT = Path("/mnt")


def _read_proc_version() -> str:
    try:
        return Path("/proc/version").read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


def is_wsl(env: Optional[Mapping[str, str]] = None) -> bool:
    """Return True when running on the WSL interop kernel.

    Mirrors the runtime's ``detectHostEnvironment`` (host-environment.ts): WSL
    sets ``WSL_DISTRO_NAME``/``WSL_INTEROP`` and ships a kernel advertising
    "microsoft"/"WSL" in ``/proc/version``. Any one signal is enough — env vars
    can be stripped by a bare shell, and ``/proc/version`` is unreadable in some
    sandboxes.
    """
    if os.name == "nt":
        return False
    env = env if env is not None else os.environ
    if env.get("WSL_DISTRO_NAME") or env.get("WSL_INTEROP"):
        return True
    normalized = _read_proc_version().lower()
    return "microsoft" in normalized or "wsl" in normalized


def windows_drive_mounts(root: Path = DEFAULT_WINDOWS_MOUNT_ROOT) -> list[Path]:
    """Return the mounted Windows drives under ``root`` (``/mnt/c``, ``/mnt/d``…).

    Only single-character names count — that is what keeps WSL's own ``/mnt/wsl``
    and ``/mnt/wslg`` out of the list. Never raises: an unreadable root yields [].
    """
    try:
        entries = sorted(root.iterdir())
    except OSError:
        return []
    mounts = []
    for entry in entries:
        if len(entry.name) != 1:
            continue
        try:
            if entry.is_dir():
                mounts.append(entry)
        except OSError:
            continue
    return mounts


def path_is_windows_mount(
    path: Path, root: Path = DEFAULT_WINDOWS_MOUNT_ROOT
) -> bool:
    """Return True when ``path`` sits under a mounted Windows drive."""
    for mount in windows_drive_mounts(root):
        try:
            path.relative_to(mount)
        except ValueError:
            continue
        return True
    return False
