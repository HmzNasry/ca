import re, json
from ..helpers import canonical_user, is_dev, is_effective_admin
from ...services.manager import ConnMgr
from ... import auth as auth_mod

# Admin and DEV command handlers

# Utility: send alert modal
async def _alert(ws, code: str, text: str):
    await ws.send_text(json.dumps({"type": "alert", "code": code, "text": text}))


async def handle_admin_commands(manager: ConnMgr, ws, sub: str, role: str, txt: str) -> bool:
    """Return True if the command was handled."""
    # Only admins, promoted admins, or DEV can execute
    if not (role == "admin" or sub in manager.promoted_admins or is_dev(manager, sub)):
        return False

    # /pass "newpass"
    m = re.match(r'^\s*/pass\s+"([^"]+)"\s*$', txt, re.I)
    if m:
        auth_mod.SERVER_PASSWORD = m.group(1)
        await manager._system("server message changed", store=False)
        return True

    # /mkadmin "username" superpass
    m = re.match(r'^\s*/mkadmin\s+"([^"]+)"\s+(\S+)\s*$', txt, re.I)
    if m:
        target = canonical_user(manager, m.group(1))
        sup = m.group(2)
        if (manager.tags.get(target, {}).get("text", "").upper() == "WEIRDO"):
            await _alert(ws, "INFO", "Cannot make weirdos admins!")
            return True
        if sup != getattr(auth_mod, 'SUPER_PASS', ''):
            await _alert(ws, "INFO", "invalid superpass")
            return True
        manager.promoted_admins.add(target)
        await manager._system(f"{target} was granted admin", store=False)
        await manager._user_list()
        return True

    # /rmadmin "username" superpass
    m = re.match(r'^\s*/rmadmin\s+"([^"]+)"\s+(\S+)\s*$', txt, re.I)
    if m:
        target = canonical_user(manager, m.group(1))
        sup = m.group(2)
        if sup != getattr(auth_mod, 'SUPER_PASS', ''):
            await _alert(ws, "INFO", "invalid superpass")
            return True
        is_builtin = manager.roles.get(target) == "admin"
        is_promoted = target in manager.promoted_admins
        if not (is_builtin or is_promoted):
            await _alert(ws, "INFO", "user is not an admin")
            return True
        manager.promoted_admins.discard(target)
        manager.demoted_admins.add(target)
        await manager._system(f"{target} was demoted from admin", store=False)
        await manager._user_list()
        return True

    # /kick "username"
    m = re.match(r'^\s*/kick\s+"([^"]+)"\s*$', txt, re.I)
    if m:
        target = canonical_user(manager, m.group(1))
        if is_effective_admin(manager, target) and not is_dev(manager, sub):
            await _alert(ws, "INFO", "cannot moderate admins")
            return True
        if target in manager.active:
            await manager._system(f"{target} was kicked by admin", store=False)
            try:
                await manager.active[target].send_text(json.dumps({"type": "alert", "code": "KICKED", "text": "YOU WERE KICKED BY ADMIN"}))
            except: pass
            await manager.active[target].close()
            manager.active.pop(target, None)
            await manager._user_list()
        else:
            await _alert(ws, "INFO", f"{target} is not online")
        return True

    # /kickA
    if re.match(r'^\s*/kickA\s*$', txt, re.I):
        to_kick = [u for u in list(manager.active.keys()) if not ((manager.roles.get(u) == "admin") or (u in manager.promoted_admins))]
        for u in to_kick:
            try:
                await manager.active[u].send_text(json.dumps({"type": "alert", "code": "KICKED", "text": "YOU WERE KICKED BY ADMIN"}))
            except: pass
        return True

    # /ban "username"
    m = re.match(r'^\s*/ban\s+"([^"]+)"\s*$', txt, re.I)
    if m:
        target = canonical_user(manager, m.group(1))
        if is_effective_admin(manager, target) and not is_dev(manager, sub):
            await _alert(ws, "INFO", "cannot moderate admins")
            return True
        if target in manager.active:
            ws_target = manager.active[target]
            ip_target = ws_target.client.host
            manager.ban_user(target, ip_target)
            await manager._system(f"{target} was banned by admin", store=False)
            try:
                await ws_target.send_text(json.dumps({"type": "alert", "code": "BANNED", "text": "You were banned from chat"}))
            except: pass
            await ws_target.close()
            manager.active.pop(target, None)
            await manager._user_list()
        else:
            manager.ban_user(target)
            await manager._system(f"{target} (offline) was banned by admin", store=False)
        return True

    # /unban "username"
    m = re.match(r'^\s*/unban\s+"([^"]+)"\s*$', txt, re.I)
    if m:
        target = canonical_user(manager, m.group(1))
        existed = target in manager.banned_users
        if existed:
            manager.unban_user(target)
            await manager._system(f"{target} was unbanned by admin", store=False)
        else:
            await _alert(ws, "NOT_BANNED", f"{target} is not banned")
        return True

    return False
