import re, json
from ..helpers import canonical_user, is_dev, COLOR_FLAGS
from ...services.manager import ConnMgr

async def _alert(ws, code: str, text: str):
    await ws.send_text(json.dumps({"type": "alert", "code": code, "text": text}))


def _is_dev_user(manager: ConnMgr, user: str) -> bool:
    return is_dev(manager, user)

async def handle_tag_commands(manager: ConnMgr, ws, sub: str, role: str, txt: str) -> bool:
    # /tag myself "tag" [color]
    m = re.match(r'^\s*/tag\s+myself\s+"([^"]+)"(?:\s+(\-\w+))?\s*$', txt, re.I)
    if m:
        tag_text = m.group(1)
        color_flag = (m.group(2) or '').lower()
        color = COLOR_FLAGS.get(color_flag, 'orange') if color_flag else 'orange'
        if tag_text.strip().lower() in {"dev", "admin"}:
            await _alert(ws, "INFO", "That tag is reserved")
            return True
        # If self is DEV, preserve DEV rainbow and append the personal tag
        if _is_dev_user(manager, sub):
            combined = f"DEV) ({tag_text}"
            manager.tags[sub] = {"text": combined, "color": "rainbow", "special": "dev"}
        else:
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
            await _alert(ws, "INFO", 'You can only tag yourself. Use: /tag "myself" "tag" [color] or /tag myself "tag" [color]')
            return True
        target = sub if not is_admin else canonical_user(manager, target_label)
        # Disallow tagging DEV users unless self
        if _is_dev_user(manager, target) and target.lower() != sub.lower():
            await _alert(ws, "INFO", "Cannot tag DEV users")
            return True
        color = COLOR_FLAGS.get(color_flag, 'orange') if color_flag else 'orange'
        is_self = target.lower() == sub.lower()
        if tag_text.strip().lower() in {"dev", "admin"}:
            await _alert(ws, "INFO", "That tag is reserved")
            return True
        if _is_dev_user(manager, target):
            # Preserve DEV and append the personal tag for self
            combined = f"DEV) ({tag_text}"
            manager.tags[target] = {"text": combined, "color": "rainbow", "special": "dev"}
        else:
            manager.tags[target] = {"text": tag_text, "color": color}
        await manager._user_list()
        await manager._system(f"{target} was tagged {tag_text}", store=False)
        return True

    # /rmtag "username" (admin) or /rmtag (self)
    m = re.match(r'^\s*/rmtag\s+"([^"]+)"\s*$', txt, re.I)
    if m:
        is_admin = (role == "admin") or (sub in manager.promoted_admins) or is_dev(manager, sub)
        target = canonical_user(manager, m.group(1))
        if _is_dev_user(manager, target) and target.lower() != sub.lower():
            await _alert(ws, "INFO", "Cannot modify DEV user's tag")
            return True
        if target in manager.tags:
            if _is_dev_user(manager, target):
                # Revert to base DEV tag
                manager.tags[target] = {"text": "DEV", "color": "rainbow", "special": "dev"}
                await manager._system(f"{target} removed their tag", store=False)
            else:
                manager.tags.pop(target, None)
                await manager._system(f"{target} tag cleared", store=False)
            await manager._user_list()
        else:
            await _alert(ws, "INFO", "User has no tag")
        return True

    if re.match(r'^\s*/rmtag\s*$', txt, re.I):
        if sub in manager.tags:
            if _is_dev_user(manager, sub):
                # Revert to base DEV tag
                manager.tags[sub] = {"text": "DEV", "color": "rainbow", "special": "dev"}
                await manager._user_list()
                await manager._system(f"{sub} removed their tag", store=False)
            else:
                manager.tags.pop(sub, None)
                await manager._user_list()
                await manager._system(f"{sub} removed their tag", store=False)
        else:
            await _alert(ws, "INFO", "You have no tag")
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
