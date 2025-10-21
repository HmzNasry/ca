import re, json
from ..helpers import canonical_user, is_dev, is_effective_admin
from ...services.manager import ConnMgr

async def _alert(ws, code: str, text: str):
    await ws.send_text(json.dumps({"type": "alert", "code": code, "text": text}))


async def handle_moderation_commands(manager: ConnMgr, ws, sub: str, role: str, txt: str) -> bool:
    """Handle /mute, /unmute, /locktag, /unlocktag. Return True if handled."""
    is_adminish = is_effective_admin(manager, sub)

    # /mute "user" <minutes>; admin or dev
    m = re.match(r'^\s*/mute\s+"([^"]+)"\s+(\d+)\s*$', txt, re.I)
    if m and is_adminish:
        target_raw = m.group(1)
        target = canonical_user(manager, target_raw)
        minutes = int(m.group(2))
        if is_effective_admin(manager, target) and not is_dev(manager, sub):
            await _alert(ws, "INFO", "cannot moderate admins")
            return True
        manager.mute_user(target, minutes)
        await manager._system(f"{target} was muted for {minutes} minute(s)", store=False)
        if target in manager.active:
            try:
                await manager.active[target].send_text(json.dumps({
                    "type": "alert",
                    "code": "MUTED",
                    "text": "You are muted",
                    "seconds": manager.remaining_mute_seconds(target)
                }))
            except: pass
        return True

    # /unmute "user"; admin or dev
    m = re.match(r'^\s*/unmute\s+"([^"]+)"\s*$', txt, re.I)
    if m and is_adminish:
        target_raw = m.group(1)
        target = canonical_user(manager, target_raw)
        manager.unmute_user(target)
        await manager._system(f"{target} was unmuted", store=False)
        return True

    # /locktag "user" (DEV only)
    m = re.match(r'^\s*/locktag\s+"([^"]+)"\s*$', txt, re.I)
    if m:
        if not is_dev(manager, sub):
            await _alert(ws, "INFO", "only DEV can lock tags")
            return True
        target_raw = m.group(1)
        target = canonical_user(manager, target_raw)
        manager.tag_locks.add(target)
        await manager._user_list()
        await manager._system(f"{target}'s tag was locked", store=False)
        return True

    # /unlocktag "user" (DEV only)
    m = re.match(r'^\s*/unlocktag\s+"([^"]+)"\s*$', txt, re.I)
    if m:
        if not is_dev(manager, sub):
            await _alert(ws, "INFO", "only DEV can unlock tags")
            return True
        target_raw = m.group(1)
        target = canonical_user(manager, target_raw)
        manager.tag_locks.discard(target)
        await manager._user_list()
        await manager._system(f"{target}'s tag was unlocked", store=False)
        return True

    return False