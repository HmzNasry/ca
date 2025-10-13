import re, json
from ..helpers import canonical_user, is_dev, COLOR_FLAGS
from ...services.manager import ConnMgr

async def _alert(ws, code: str, text: str):
    await ws.send_text(json.dumps({"type": "alert", "code": code, "text": text}))


async def handle_tag_commands(manager: ConnMgr, ws, sub: str, role: str, txt: str) -> bool:
    # /tag myself "tag" [color]
    m = re.match(r'^\s*/tag\s+myself\s+"([^"]+)"(?:\s+(\-\w+))?\s*$', txt, re.I)
    if m:
        tag_text = m.group(1)
        color_flag = (m.group(2) or '').lower()
        color = COLOR_FLAGS.get(color_flag, 'orange') if color_flag else 'orange'
        if tag_text.strip().lower() in {"dev", "admin"}:
            await _alert(ws, "INFO", "that tag is reserved")
            return True
        if sub in manager.tag_locks and not is_dev(manager, sub):
            await _alert(ws, "INFO", "your tag is locked")
            return True
        manager.tags[sub] = {"text": tag_text, "color": color}
        await manager._user_list()
        await manager._system(f"{sub} was tagged {tag_text}", store=False)
        return True

    # /tag "username" "tag" [color] (admin/promoted only)
    m = re.match(r'^\s*/tag\s+"([^"]+)"\s+"([^"]+)"(?:\s+(\-\w+))?\s*$', txt, re.I)
    if m:
        is_admin = (role == "admin") or (sub in manager.promoted_admins) or is_dev(manager, sub)
        target_label = (m.group(1) or '').strip()
        tag_text = m.group(2)
        color_flag = (m.group(3) or '').lower()
        if not is_admin and target_label.lower() != "myself":
            await _alert(ws, "INFO", 'you can only tag yourself. use: /tag "myself" "tag" [color] or /tag myself "tag" [color]')
            return True
        target = sub if not is_admin else canonical_user(manager, target_label)
        color = COLOR_FLAGS.get(color_flag, 'orange') if color_flag else 'orange'
        is_self = target.lower() == sub.lower()
        if not is_self and target in manager.tag_rejects:
            await _alert(ws, "INFO", f"@{target} has blocked being tagged")
            return True
        if tag_text.strip().lower() in {"dev", "admin"}:
            await _alert(ws, "INFO", "that tag is reserved")
            return True
        if target in manager.tag_locks and not is_dev(manager, sub):
            await _alert(ws, "INFO", f"{target}'s tag is locked")
            return True
        manager.tags[target] = {"text": tag_text, "color": color}
        await manager._user_list()
        await manager._system(f"{target} was tagged {tag_text}", store=False)
        return True

    # /rmtag "username" (admin) or /rmtag (self)
    m = re.match(r'^\s*/rmtag\s+"([^"]+)"\s*$', txt, re.I)
    if m:
        is_admin = (role == "admin") or (sub in manager.promoted_admins) or is_dev(manager, sub)
        if not is_admin:
            await _alert(ws, "INFO", "you can only remove your own tag")
            return True
        target = canonical_user(manager, m.group(1))
        if target in manager.tag_locks and not is_dev(manager, sub):
            await _alert(ws, "INFO", f"{target}'s tag is locked")
            return True
        if target in manager.tags:
            manager.tags.pop(target, None)
            await manager._system(f"{target} tag cleared", store=False)
        await manager._user_list()
        return True

    if re.match(r'^\s*/rmtag\s*$', txt, re.I):
        if sub in manager.tag_locks and not is_dev(manager, sub):
            await _alert(ws, "INFO", "your tag is locked")
            return True
        if sub in manager.tags:
            manager.tags.pop(sub, None)
            await manager._user_list()
            await manager._system(f"{sub} removed their tag", store=False)
        else:
            await _alert(ws, "INFO", "you have no tag")
        return True

    # /rjtag and /acptag
    if re.match(r'^\s*/rjtag\s*$', txt, re.I):
        manager.tag_rejects.add(sub)
        await manager._user_list()
        await manager._system(f"{sub} rejects being tagged by others", store=False)
        return True

    if re.match(r'^\s*/ac(?:p)?tag\s*$', txt, re.I):
        manager.tag_rejects.discard(sub)
        await manager._user_list()
        await manager._system(f"{sub} accepts being tagged by others", store=False)
        return True

    return False
