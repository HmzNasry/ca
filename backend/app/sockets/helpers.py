import re
from typing import Dict
from ..services.manager import ConnMgr

# Shared helpers and constants for socket command processing

_SAFE_RE = re.compile(r"[^a-zA-Z0-9_.-]+")


def safe_name(s: str) -> str:
    return _SAFE_RE.sub("_", s or "")


def canonical_user(manager: ConnMgr, name: str) -> str:
    try:
        n = (name or "").strip()
        if not n:
            return name
        low = n.lower()
        for u in list(manager.active.keys()):
            if u.lower() == low:
                return u
        return name
    except Exception:
        return name


def is_effective_admin(manager: ConnMgr, user: str) -> bool:
    try:
        tag = manager.tags.get(user) or {}
        is_dev = isinstance(tag, dict) and (
            tag.get("special") == "dev"
            or tag.get("color") == "rainbow"
            or str(tag.get("text", "")).upper() == "DEV"
        )
        return is_dev or (manager.roles.get(user) == "admin") or (user in manager.promoted_admins)
    except Exception:
        return False


def is_dev(manager: ConnMgr, user: str) -> bool:
    try:
        tag = manager.tags.get(user) or {}
        return isinstance(tag, dict) and (
            tag.get("special") == "dev"
            or tag.get("color") == "rainbow"
            or str(tag.get("text", "")).upper() == "DEV"
        )
    except Exception:
        return False


# Map color flags to canonical color strings for the UI
COLOR_FLAGS: Dict[str, str] = {
    '-r': 'red', '-red': 'red',
    '-g': 'green', '-green': 'green',
    '-b': 'blue', '-blue': 'blue',
    '-p': 'pink', '-pink': 'pink',
    '-y': 'yellow', '-yellow': 'yellow',
    '-w': 'white', '-white': 'white',
    '-c': 'cyan', '-cyan': 'cyan',
    # Additional colors
    '-purple': 'purple',
    '-violet': 'violet',
    '-indigo': 'indigo',
    '-teal': 'teal',
    '-lime': 'lime',
    '-amber': 'amber',
    '-emerald': 'emerald',
    '-fuchsia': 'fuchsia',
    '-sky': 'sky',
    '-gray': 'gray',
}
