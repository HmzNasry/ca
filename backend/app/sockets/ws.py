import json, os, re, shutil, asyncio
from datetime import datetime
from fastapi import WebSocket, WebSocketDisconnect, status
from jose import jwt, JWTError
from ..services.manager import ConnMgr
from ..upload import UPLOAD_DIR
from ..auth import SECRET_KEY, ALGORITHM
from ..ollama_client import stream_ollama, TEXT_MODEL
import logging

logger = logging.getLogger(__name__)

# New: import auth module so we can mutate SERVER_PASSWORD at runtime
from .. import auth as auth_mod

# Import shared helpers/constants
from .helpers import (
    safe_name as _safe_name,
    canonical_user as _canonical_user,
    is_effective_admin as _is_effective_admin,
    is_dev as _is_dev,
    COLOR_FLAGS,
)
# New command modules
from .commands.admin import handle_admin_commands
from .commands.moderation import handle_moderation_commands
from .commands.tags import handle_tag_commands

manager = ConnMgr()
manager.HISTORY = 100 if hasattr(manager, 'HISTORY') else None

# --- AI controls/state ---
ai_enabled = True
ai_tasks = {}  # ai_id -> {"task": asyncio.Task, "owner": str}

async def _cancel_all_ai():
    for ai_id, meta in list(ai_tasks.items()):
        task: asyncio.Task = meta.get("task")
        if task and not task.done():
            task.cancel()
        ai_tasks.pop(ai_id, None)


async def _cancel_ai_for_user(target: str):
    for ai_id, meta in list(ai_tasks.items()):
        if meta.get("owner") == target:
            task: asyncio.Task = meta.get("task")
            if task and not task.done():
                task.cancel()
            ai_tasks.pop(ai_id, None)


async def _run_ai(ai_id: str, owner: str, prompt: str, image_url: str | None = None):
    full_text = ""
    history = list(manager.history)  # same history, so /clear wipes it
    try:
        async for chunk in stream_ollama(prompt, image_url=image_url, history=history, invoker=owner):
            full_text += chunk
            try:
                await manager._broadcast({"type": "update", "id": ai_id, "text": full_text})
            except Exception:
                pass
    except asyncio.CancelledError:
        try:
            # Resolve spinner with a stopped marker
            await manager._broadcast({"type": "update", "id": ai_id, "text": "[STOPPED]"})
            await manager._system(f"AI generation by {owner} was stopped", store=False)
        except Exception:
            pass
        raise
    finally:
        try:
            # If no output was ever produced, push a placeholder so spinner ends
            if not full_text.strip():
                try:
                    await manager._broadcast({"type": "update", "id": ai_id, "text": "[NO RESPONSE]"})
                except Exception:
                    pass
            # Persist final text into history
            for msg in manager.history:
                if msg.get("id") == ai_id:
                    msg["text"] = full_text if full_text.strip() else "[NO RESPONSE]"
                    break
        except Exception:
            pass
        ai_tasks.pop(ai_id, None)


async def ws_handler(ws: WebSocket, token: str):
    global ai_enabled
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        sub = payload.get("sub")
        role = payload.get("role", "user")
    except JWTError:
        await ws.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    ip = ws.client.host

    # Reject duplicate usernames (already connected)
    try:
        if sub in manager.active:
            await ws.accept()
            await ws.send_text(json.dumps({"type": "alert", "code": "DUPLICATE", "text": "USERNAME ALREADY ONLINE"}))
            await ws.close()
            return
    except Exception:
        pass

    # check if banned (username or IP)
    if role != "admin" and (sub in manager.banned_users or ip in manager.banned_ips):
        await ws.accept()
        await ws.send_text(json.dumps({"type": "alert", "code": "BANNED_CONNECT", "text": "YOU ARE BANNED FROM CHAT"}))
        await ws.close()
        return

    await ws.accept()
    await manager.connect(ws, sub, role)
    # Special DEV tag for localhost connections
    try:
        if ip in ("127.0.0.1", "::1", "localhost"):
            manager.tags[sub] = {"text": "DEV", "color": "rainbow", "special": "dev"}
            await manager._user_list()
    except Exception:
        pass

    try:
        while True:
            data = await ws.receive_json()
            txt = (data.get("text", "") or "").strip()
            # Normalize accidental leading './' to '/'
            try:
                if re.match(r'^\s*\./', txt):
                    txt = re.sub(r'^(\s*)\./', r'\1/', txt)
            except Exception:
                pass
            now = datetime.utcnow()

            if data.get("typing"):
                # Scope typing to the active thread
                if data.get("thread") == "dm" and isinstance(data.get("peer"), str):
                    peer = data.get("peer").strip()
                    if peer and peer != sub:
                        # Send only to both DM peers, with proper peer routing
                        await manager._broadcast_dm_update(sub, peer, {
                            "type": "typing", "user": sub, "typing": data["typing"], "thread": "dm"
                        })
                else:
                    # Main thread typing: suppress if muted
                    if manager.is_muted(sub):
                        continue
                    await manager._broadcast({"type": "typing", "user": sub, "typing": data["typing"], "thread": "main"})
                continue

            # --- History for Main ---
            if data.get("type") == "history_request":
                await ws.send_text(json.dumps({"type": "history", "items": manager.history}))
                continue

            # --- DM: history request ---
            if data.get("type") == "dm_history" and isinstance(data.get("peer"), str):
                peer = data.get("peer").strip()
                if peer and peer != sub:
                    items = manager.get_dm_history(sub, peer)
                    await ws.send_text(json.dumps({"type": "dm_history", "peer": peer, "items": items}))
                continue

            # --- DM thread: handle commands first (/delete, /clear), then normal DM send ---
            if data.get("thread") == "dm" and isinstance(data.get("peer"), str):
                peer = data.get("peer").strip()
                if peer and peer != sub:
                    # /delete in DM: either party can delete any message in that DM
                    if txt.startswith("/delete "):
                        m = re.match(r"/delete\s+(\S+)", txt)
                        if m:
                            msg_id = m.group(1)
                            ok = manager.delete_dm_message(sub, peer, msg_id, requester=sub, allow_any=True)
                            if ok:
                                await manager._broadcast_dm_update(sub, peer, {"type": "delete", "id": msg_id, "thread": "dm", "peer": peer})
                        continue
                    # /clear in DM: either party can clear the DM history
                    if txt == "/clear":
                        manager.clear_dm_history(sub, peer)
                        # Also wipe the DM uploads folder (will be recreated on next upload)
                        try:
                            a, b = sorted([_safe_name(sub), _safe_name(peer)])
                            dm_dir = os.path.join(UPLOAD_DIR, "dm", f"{a}__{b}")
                            if os.path.isdir(dm_dir):
                                shutil.rmtree(dm_dir)
                        except Exception as e:
                            logger.warning("Failed to remove DM upload dir: %s", e)
                        await manager._broadcast_dm_update(sub, peer, {"type": "clear", "thread": "dm", "peer": peer})
                        continue
                    # Admin commands should also work in DMs
                    if role == "admin" or sub in manager.promoted_admins or _is_dev(manager, sub):
                        # Online target validation (DM context) BEFORE handling
                        if re.match(r'^\s*/(kick|ban|unban|mkadmin|rmadmin|mute|unmute|locktag|unlocktag|tag|rmtag)\b', txt, re.I):
                            m_user = re.match(r'^\s*/(\w+)\s+(?:"([^"]+)"|(\S+))', txt)
                            if m_user:
                                cmd = m_user.group(1).lower()
                                raw = m_user.group(2) or m_user.group(3)
                                if not (cmd == 'tag' and raw.lower() == 'myself'):
                                    target = _canonical_user(manager, raw)
                                    if target not in manager.active:
                                        await ws.send_text(json.dumps({"type": "alert", "code": "NOT_ONLINE", "text": f"{raw} is not online"}))
                                        continue
                        # Delegate to command modules first
                        if await handle_admin_commands(manager, ws, sub, role, txt):
                            continue
                        if await handle_moderation_commands(manager, ws, sub, role, txt):
                            continue
                        # keep tag commands accessible in DM
                        if await handle_tag_commands(manager, ws, sub, role, txt):
                            continue
                        # Online target validation (DM context)
                        if re.match(r'^\s*/(kick|ban|unban|mkadmin|rmadmin|mute|unmute|locktag|unlocktag)\b', txt, re.I):
                            m_user = re.match(r'^\s*/\w+\s+(?:"([^"]+)"|(\S+))', txt)
                            if m_user:
                                raw = m_user.group(1) or m_user.group(2)
                                target = _canonical_user(manager, raw)
                                if target not in manager.active:
                                    await ws.send_text(json.dumps({"type": "alert", "code": "NOT_ONLINE", "text": f"{raw} is not online"}))
                                    continue
                        # fallthrough to the rest of legacy admin handlers (now minimal)
                        # /pass "newpass"
                        m_pass = re.match(r'^\s*/pass\s+"([^"]+)"\s*$', txt, re.I)
                        if m_pass:
                            new_pass = m_pass.group(1)
                            auth_mod.SERVER_PASSWORD = new_pass
                            await manager._system("Server message changed", store=False)
                            logger.info("Server password changed by admin %s (DM)", sub)
                            continue
                        # /mkadmin "username" superpass
                        m_mk = re.match(r'^\s*/mkadmin\s+"([^"]+)"\s+(\S+)\s*$', txt, re.I)
                        if m_mk:
                            target_raw, sup = m_mk.group(1), m_mk.group(2)
                            target = _canonical_user(manager, target_raw)
                            if (manager.tags.get(target, {}).get("text", "").upper() == "WEIRDO"):
                                await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": "Cannot make weirdos admins!"}))
                                continue
                            if sup != getattr(auth_mod, 'SUPER_PASS', ''):
                                await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": "invalid superpass"}))
                                continue
                            manager.promoted_admins.add(target)
                            await manager._system(f"{target} was granted admin", store=False)
                            await manager._user_list()
                            continue
                        # /rmadmin "username" superpass
                        m_rm = re.match(r'^\s*/rmadmin\s+"([^"]+)"\s+(\S+)\s*$', txt, re.I)
                        if m_rm:
                            target_raw, sup = m_rm.group(1), m_rm.group(2)
                            target = _canonical_user(manager, target_raw)
                            if sup != getattr(auth_mod, 'SUPER_PASS', ''):
                                await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": "invalid superpass"}))
                                continue
                            is_builtin = manager.roles.get(target) == "admin"
                            is_promoted = target in manager.promoted_admins
                            if not (is_builtin or is_promoted):
                                await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": "user is not an admin"}))
                                continue
                            manager.promoted_admins.discard(target)
                            manager.demoted_admins.add(target)
                            await manager._system(f"{target} was demoted from admin", store=False)
                            await manager._user_list()
                            continue
                        # /kick "username"
                        m_kick = re.match(r'^\s*/kick\s+"([^"]+)"\s*$', txt, re.I)
                        if m_kick:
                            target = _canonical_user(manager, m_kick.group(1))
                            if _is_effective_admin(manager, target) and not _is_dev(manager, sub):
                                await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": "cannot moderate admins"}))
                                continue
                            if target in manager.active:
                                await manager._system(f"{target} was kicked by admin", store=False)
                                await manager.active[target].send_text(json.dumps({"type": "alert", "code": "KICKED", "text": "YOU WERE KICKED BY ADMIN"}))
                                await manager.active[target].close()
                                manager.active.pop(target, None)
                                await manager._user_list()
                            else:
                                await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": f"{target} is not online"}))
                            continue
                        # /kickA — kick everyone except admins
                        if re.match(r'^\s*/kickA\s*$', txt, re.I):
                            to_kick = [u for u in list(manager.active.keys()) if not ((manager.roles.get(u) == "admin") or (u in manager.promoted_admins))]
                            for u in to_kick:
                                try:
                                    await manager.active[u].send_text(json.dumps({
                                        "type": "alert",
                                        "code": "KICKED",
                                        "text": "YOU WERE KICKED BY ADMIN"
                                    }))
                                except:
                                    pass
                            continue
                        # /ban "username"
                        m_ban = re.match(r'^\s*/ban\s+"([^"]+)"\s*$', txt, re.I)
                        if m_ban:
                            target = _canonical_user(manager, m_ban.group(1))
                            if _is_effective_admin(manager, target) and not _is_dev(manager, sub):
                                await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": "cannot moderate admins"}))
                                continue
                            if target in manager.active:
                                ws_target = manager.active[target]
                                ip_target = ws_target.client.host
                                manager.ban_user(target, ip_target)
                                await manager._system(f"{target} was banned by admin", store=False)
                                try:
                                    await ws_target.send_text(json.dumps({"type": "alert", "code": "BANNED", "text": "You were banned from chat"}))
                                except:
                                    pass
                                await ws_target.close()
                                manager.active.pop(target, None)
                                await manager._user_list()
                            else:
                                manager.ban_user(target)
                                await manager._system(f"{target} (offline) was banned by admin", store=False)
                            continue
                        # /unban "username"
                        m_unban = re.match(r'^\s*/unban\s+"([^"]+)"\s*$', txt, re.I)
                        if m_unban:
                            target = _canonical_user(manager, m_unban.group(1))
                            existed = target in manager.banned_users
                            if existed:
                                manager.unban_user(target)
                                await manager._system(f"{target} was unbanned by admin", store=False)
                            else:
                                await ws.send_text(json.dumps({"type": "alert", "code": "NOT_BANNED", "text": f"{target} IS NOT BANNED"}))
                            continue
                        # /mute "username" minutes (allow quoted or unquoted)
                        m_mute = re.match(r'^\s*/mute\s+(?:"([^"]+)"|(\S+))\s+(\d+)\s*$', txt, re.I)
                        if m_mute:
                            target_raw = m_mute.group(1) or m_mute.group(2)
                            target = _canonical_user(manager, target_raw)
                            minutes = int(m_mute.group(3))
                            if _is_effective_admin(manager, target) and not _is_dev(manager, sub):
                                await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": "cannot moderate admins"}))
                                continue
                            manager.mute_user(target, minutes)
                            await manager._system(f"{target} was muted for {minutes} minute(s)", store=False)
                            # notify target immediately if online
                            if target in manager.active:
                                try:
                                    await manager.active[target].send_text(json.dumps({
                                        "type": "alert",
                                        "code": "MUTED",
                                        "text": "you are muted",
                                        "seconds": manager.remaining_mute_seconds(target)
                                    }))
                                except:
                                    pass
                            continue
                        # /unmute "username" (allow quoted or unquoted)
                        m_unmute2 = re.match(r'^\s*/unmute\s+(?:"([^"]+)"|(\S+))\s*$', txt, re.I)
                        if m_unmute2:
                            target_raw = m_unmute2.group(1) or m_unmute2.group(2)
                            target = _canonical_user(manager, target_raw)
                            manager.unmute_user(target)
                            await manager._system(f"{target} was unmuted", store=False)
                            continue
                        # /locktag "username" (DEV only, allow quoted or unquoted)
                        m_lock = re.match(r'^\s*/locktag\s+(?:"([^"]+)"|(\S+))\s*$', txt, re.I)
                        if m_lock:
                            if not _is_dev(manager, sub):
                                await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": "only DEV can lock tags"}))
                                continue
                            target_raw = m_lock.group(1) or m_lock.group(2)
                            target = _canonical_user(manager, target_raw)
                            manager.tag_locks.add(target)
                            await manager._user_list()
                            await manager._system(f"{target}'s tag was locked", store=False)
                            continue
                        # /unlocktag "username" (DEV only, allow quoted or unquoted)
                        m_unlock = re.match(r'^\s*/unlocktag\s+(?:"([^"]+)"|(\S+))\s*$', txt, re.I)
                        if m_unlock:
                            if not _is_dev(manager, sub):
                                await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": "only DEV can unlock tags"}))
                                continue
                            target_raw = m_unlock.group(1) or m_unlock.group(2)
                            target = _canonical_user(manager, target_raw)
                            manager.tag_locks.discard(target)
                            await manager._user_list()
                            await manager._system(f"{target}'s tag was unlocked", store=False)
                            continue
                    # Normal DM send (text/media) — do not block for mute
                    ts = now.isoformat() + "Z"
                    if data.get("text"):
                        # Reject unknown commands (anything starting with '/') — after command handlers above
                        if txt.startswith('/'):
                            await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": "INVALID COMMAND"}))
                            continue
                        dm_text = str(data.get("text"))[:4000]
                        mid = f"{sub}-{int(now.timestamp()*1000)}"
                        msg = {"id": mid, "sender": sub, "timestamp": ts, "type": "message", "text": dm_text, "thread": "dm", "peer": peer}
                        await manager._broadcast_dm(sub, peer, msg)
                    elif data.get("url"):
                        url = str(data.get("url"))
                        mime = str(data.get("mime") or "")
                        mid = f"{sub}-{int(now.timestamp()*1000)}"
                        msg = {"id": mid, "sender": sub, "timestamp": ts, "type": "media", "url": url, "mime": mime, "thread": "dm", "peer": peer}
                        await manager._broadcast_dm(sub, peer, msg)
                continue

            # --- Admin AI toggles (Main): case-insensitive, allow extra spaces ---
            if role == "admin" or sub in manager.promoted_admins or _is_dev(manager, sub):
                m_ai_toggle = re.match(r"^\s*/ai\s+(enable|disable)\b", txt, re.I)
                if m_ai_toggle:
                    action = m_ai_toggle.group(1).lower()
                    if action == "disable":
                        ai_enabled = False
                        await manager._system("ai has been disabled by admin", store=False)
                        logger.info("AI disabled by admin %s", sub)
                    else:
                        ai_enabled = True
                        await manager._system("ai has been enabled by admin", store=False)
                        logger.info("AI enabled by admin %s", sub)
                    continue

            # Centralized command handling for Main thread commands
            # First: if command requires an online username, validate and block if offline
            if re.match(r'^\s*/(kick|ban|unban|mkadmin|rmadmin|mute|unmute|locktag|unlocktag|tag|rmtag)\b', txt, re.I):
                m_user = re.match(r'^\s*/(\w+)\s+(?:"([^"]+)"|(\S+))', txt)
                if m_user:
                    cmd = m_user.group(1).lower()
                    raw = m_user.group(2) or m_user.group(3)
                    # allow /tag myself ... without online check
                    if not (cmd == 'tag' and raw.lower() == 'myself'):
                        target = _canonical_user(manager, raw)
                        if target not in manager.active:
                            await ws.send_text(json.dumps({"type": "alert", "code": "NOT_ONLINE", "text": f"{raw} is not online"}))
                            continue

            # 1) Admin/dev commands
            if await handle_admin_commands(manager, ws, sub, role, txt):
                continue
            # 2) Moderation (/mute, /unmute, /locktag, /unlocktag)
            if await handle_moderation_commands(manager, ws, sub, role, txt):
                continue
            # 3) Tag commands
            if await handle_tag_commands(manager, ws, sub, role, txt):
                continue

            # Online target validation for username-requiring commands
            if re.match(r'^\s*/(kick|ban|unban|mkadmin|rmadmin|mute|unmute|locktag|unlocktag)\b', txt, re.I):
                # extract the first quoted or unquoted token after the command
                m_user = re.match(r'^\s*/\w+\s+(?:"([^"]+)"|(\S+))', txt)
                if m_user:
                    raw = m_user.group(1) or m_user.group(2)
                    target = _canonical_user(manager, raw)
                    if target not in manager.active:
                        await ws.send_text(json.dumps({"type": "alert", "code": "NOT_ONLINE", "text": f"{raw} is not online"}))
                        continue

            # --- Thread-aware delete (/delete <id>) in Main (admin or author) ---
            if txt.lower().startswith("/delete "):
                m = re.match(r"/delete\s+(\S+)", txt)
                if m:
                    msg_id = m.group(1)
                    if role == "admin":
                        if manager.delete_main_message(msg_id):
                            await manager._broadcast({"type": "delete", "id": msg_id})
                    else:
                        # Allow a user to delete their own message in Main
                        msg = next((x for x in manager.history if x.get("id") == msg_id), None)
                        if msg and msg.get("sender") == sub:
                            if manager.delete_main_message(msg_id):
                                await manager._broadcast({"type": "delete", "id": msg_id})
                        else:
                            await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": "YOU CAN ONLY DELETE YOUR OWN MESSAGES IN MAIN"}))
                continue

            # --- DM-only clear handled above; Global clear (main): admin only ---
            if txt.strip().lower() == "/clear":
                if role == "admin" or sub in manager.promoted_admins:
                    # Cancel all running AI tasks
                    await _cancel_all_ai()
                    # Clear main history
                    try:
                        manager.history.clear()
                    except Exception:
                        manager.history = []
                    # Remove main uploads folder
                    try:
                        main_dir = os.path.join(UPLOAD_DIR, "main")
                        if os.path.isdir(main_dir):
                            shutil.rmtree(main_dir)
                    except Exception:
                        pass
                    # Broadcast clear event and an informational system line
                    try:
                        await manager._broadcast({"type": "clear", "thread": "main"})
                    except Exception:
                        pass
                    await manager._system("Admin cleared the chat", store=False)
                else:
                    await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": "ONLY ADMIN CAN CLEAR CHAT"}))
                continue

            # --- Tagging commands (accessible to all) ---
            # Support non-admin shorthand: /tag myself "tag" [color]
            m_tag_self_short = re.match(r'^\s*/tag\s+myself\s+"([^"]+)"(?:\s+(\-\w+))?\s*$', txt, re.I)
            if m_tag_self_short:
                tag_text = m_tag_self_short.group(1)
                color_flag = (m_tag_self_short.group(2) or '').lower()
                color = COLOR_FLAGS.get(color_flag, 'orange') if color_flag else 'orange'
                # prevent reserved tag names
                if tag_text.strip().lower() in {"dev", "admin"}:
                    await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": "that tag is reserved"}))
                    continue
                # enforce lock unless DEV
                if sub in manager.tag_locks and not _is_dev(manager, sub):
                    await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": "your tag is locked"}))
                    continue
                manager.tags[sub] = {"text": tag_text, "color": color}
                await manager._user_list()
                await manager._system(f"{sub} was tagged {tag_text}", store=False)
                continue

            # /tag "username" "tag" [color];
            # - Non-admins can ONLY use: /tag "myself" "tag" [color] (or /tag myself "tag" [color])
            # - Admins can tag others (respect opt-out)
            m_tag_any = re.match(r'^\s*/tag\s+"([^"]+)"\s+"([^"]+)"(?:\s+(\-\w+))?\s*$', txt, re.I)
            if m_tag_any:
                target_label = (m_tag_any.group(1) or '').strip()
                tag_text = m_tag_any.group(2)
                color_flag = (m_tag_any.group(3) or '').lower()
                is_admin = (role == "admin") or (sub in manager.promoted_admins)
                if not is_admin:
                    if target_label.lower() != "myself":
                        await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": 'you can only tag yourself. use: /tag "myself" "tag" [color] or /tag myself "tag" [color]'}))
                        continue
                    target = sub
                else:
                    target = _canonical_user(manager, target_label)
                color = COLOR_FLAGS.get(color_flag, 'orange') if color_flag else 'orange'
                is_self = target.lower() == sub.lower()
                # Respect opt-out only when tagging someone else
                if not is_self and target in manager.tag_rejects:
                    await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": f"@{target} has blocked being tagged"}))
                    continue
                # prevent reserved tag names
                if tag_text.strip().lower() in {"dev", "admin"}:
                    await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": "that tag is reserved"}))
                    continue
                # enforce lock when tagging a target unless DEV
                if target in manager.tag_locks and not _is_dev(manager, sub):
                    await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": f"{target}'s tag is locked"}))
                    continue
                manager.tags[target] = {"text": tag_text, "color": color}
                await manager._user_list()
                await manager._system(f"{target} was tagged {tag_text}", store=False)
                continue

            # Admin can remove anyone's tag via /rmtag "username"; users can only remove their own tag (no-arg)
            m_rmtag_other = re.match(r'^\s*/rmtag\s+"([^"]+)"\s*$', txt, re.I)
            if m_rmtag_other:
                target_raw = m_rmtag_other.group(1)
                is_admin = (role == "admin") or (sub in manager.promoted_admins)
                if not is_admin:
                    await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": "you can only remove your own tag"}))
                    continue
                target = _canonical_user(manager, target_raw)
                if target in manager.tag_locks and not _is_dev(manager, sub):
                    await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": f"{target}'s tag is locked"}))
                    continue
                if target in manager.tags:
                    manager.tags.pop(target, None)
                    await manager._system(f"{target} tag cleared", store=False)
                await manager._user_list()
                continue

            # /rmtag — drop your own tag
            if re.match(r'^\s*/rmtag\s*$', txt, re.I):
                if sub in manager.tag_locks and not _is_dev(manager, sub):
                    await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": "your tag is locked"}))
                    continue
                if sub in manager.tags:
                    manager.tags.pop(sub, None)
                    await manager._user_list()
                    await manager._system(f"{sub} removed their tag", store=False)
                else:
                    await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": "you have no tag"}))
                continue

            # /rjtag — reject being tagged by others (does not drop current tag)
            if re.match(r'^\s*/rjtag\s*$', txt, re.I):
                manager.tag_rejects.add(sub)
                await manager._user_list()
                await manager._system(f"{sub} rejects being tagged by others", store=False)
                continue

            # /actag (or /acptag) — accept tags from others
            if re.match(r'^\s*/ac(?:p)?tag\s*$', txt, re.I):
                manager.tag_rejects.discard(sub)
                await manager._user_list()
                await manager._system(f"{sub} accepts being tagged by others", store=False)
                continue

            # Bad /tag usage helper
            if re.match(r'^\s*/tag\b', txt, re.I) and not re.match(r'^\s*/tag\s+"[^"]+"\s+"[^"]+"(?:\s+(\-\w+))?\s*$', txt, re.I):
                await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": 'usage: /tag "myself" "tag" [color] (users) or /tag "username" "tag" [color] (admins). Colors: -r|-g|-b|-p|-y|-w|-c|-purple|-violet|-indigo|-teal|-lime|-amber|-emerald|-fuchsia|-sky|-gray'}))
                continue

            # --- Admin commands (Main) ---
            if role == "admin" or sub in manager.promoted_admins or _is_dev(manager, sub):
                # remove old duplicates now handled by modules and keep only usage helpers
                # Usage helpers (including updated quoted/unquoted syntax)
                if re.match(r'^\s*/mkadmin\b', txt, re.I) and not re.match(r'^\s*/mkadmin\s+"[^"]+"\s+\S+\s*$', txt, re.I):
                    await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": 'usage: /mkadmin "username" superpass'}))
                    continue
                if re.match(r'^\s*/rmadmin\b', txt, re.I) and not re.match(r'^\s*/rmadmin\s+"[^"]+"\s+\S+\s*$', txt, re.I):
                    await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": 'usage: /rmadmin "username" superpass'}))
                    continue
                if re.match(r'^\s*/kick\b', txt, re.I) and not re.match(r'^\s*/kick\s+"[^"]+"\s*$', txt, re.I):
                    await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": 'usage: /kick "username"'}))
                    continue
                if re.match(r'^\s*/ban\b', txt, re.I) and not re.match(r'^\s*/ban\s+"[^"]+"\s*$', txt, re.I):
                    await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": 'usage: /ban "username"'}))
                    continue
                if re.match(r'^\s*/unban\b', txt, re.I) and not re.match(r'^\s*/unban\s+"[^"]+"\s*$', txt, re.I):
                    await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": 'usage: /unban "username"'}))
                    continue
                if re.match(r'^\s*/mute\b', txt, re.I) and not re.match(r'^\s*/mute\s+(?:"[^"]+"|\S+)\s+\d+\s*$', txt, re.I):
                    await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": 'usage: /mute "username" minutes'}))
                    continue
                if re.match(r'^\s*/unmute\b', txt, re.I) and not re.match(r'^\s*/unmute\s+(?:"[^"]+"|\S+)\s*$', txt, re.I):
                    await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": 'usage: /unmute "username"'}))
                    continue
                if re.match(r'^\s*/locktag\b', txt, re.I) and not re.match(r'^\s*/locktag\s+(?:"[^"]+"|\S+)\s*$', txt, re.I):
                    await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": 'usage: /locktag "username"'}))
                    continue
                if re.match(r'^\s*/unlocktag\b', txt, re.I) and not re.match(r'^\s*/unlocktag\s+(?:"[^"]+"|\S+)\s*$', txt, re.I):
                    await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": 'usage: /unlocktag "username"'}))
                    continue

    except WebSocketDisconnect:
        pass
    finally:
        try:
            await manager.disconnect(sub)
        except Exception:
            pass
