import json, os, re, shutil, asyncio
from datetime import datetime
from fastapi import WebSocket, WebSocketDisconnect, status
from jose import jwt, JWTError
from .manager import ConnMgr
from .upload import UPLOAD_DIR
from .auth import SECRET_KEY, ALGORITHM
from .ollama_client import stream_ollama, TEXT_MODEL
import logging

logger = logging.getLogger(__name__)

# New: import auth module so we can mutate SERVER_PASSWORD at runtime
from . import auth as auth_mod

manager = ConnMgr()
manager.HISTORY = 100 if hasattr(manager, 'HISTORY') else None

# --- AI controls/state ---
ai_enabled = True
ai_tasks = {}  # ai_id -> {"task": asyncio.Task, "owner": str}

# Safe-name helper to mirror upload.py folder naming
_SAFE_RE = re.compile(r"[^a-zA-Z0-9_.-]+")

def _safe_name(s: str) -> str:
    return _SAFE_RE.sub("_", s or "")

# Resolve a username to the exact online casing; fallback to the original if not found
def _canonical_user(name: str) -> str:
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

# Check if a user is an effective admin (built-in or promoted)
def _is_effective_admin(user: str) -> bool:
    try:
        return (manager.roles.get(user) == "admin") or (user in manager.promoted_admins)
    except Exception:
        return False

# Map color flags to canonical color strings for the UI
COLOR_FLAGS = {
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

    # check if banned (username or IP)
    if role != "admin" and (sub in manager.banned_users or ip in manager.banned_ips):
        await ws.accept()
        await ws.send_text(json.dumps({"type": "alert", "code": "BANNED_CONNECT", "text": "YOU ARE BANNED FROM CHAT"}))
        await ws.close()
        return

    await ws.accept()
    await manager.connect(ws, sub, role)

    try:
        while True:
            data = await ws.receive_json()
            txt = (data.get("text", "") or "").strip()
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
                    # Admin can toggle AI from within a DM as well (case-insensitive, extra spaces ok)
                    if role == "admin" or sub in manager.promoted_admins:
                        m_ai_toggle = re.match(r"^\s*/ai\s+(enable|disable)\b", txt, re.I)
                        if m_ai_toggle:
                            action = m_ai_toggle.group(1).lower()
                            if action == "disable":
                                ai_enabled = False
                                # Do not cancel running tasks; just block new requests
                                await manager._system("AI has been disabled by admin", store=False)
                                logger.info("AI disabled by admin %s (DM)", sub)
                            else:
                                ai_enabled = True
                                await manager._system("AI has been enabled by admin", store=False)
                                logger.info("AI enabled by admin %s (DM)", sub)
                            continue

                    # @ai in DM: only if at start (do not block when muted)
                    m_ai_dm = re.match(r"^\s*@ai\b(.*)$", txt, re.I)
                    if m_ai_dm:
                        # removed mute block for DM
                        prompt = (m_ai_dm.group(1) or "").strip()
                        if not prompt:
                            await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": "usage: @ai <prompt>"}))
                            continue
                        if not ai_enabled and not (role == "admin" or sub in manager.promoted_admins):
                            await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": "@ai is disabled by admin"}))
                            continue
                        # Validate attachments: allow at most one image via `image`; reject generic `url` or multiples
                        if data.get("url"):
                            await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": "@ai only accepts a single image"}))
                            continue
                        img_url = data.get("image") if isinstance(data.get("image"), str) else None
                        # Extra guard: only accept static images (png/jpg/jpeg/webp); reject gif and non-images
                        if img_url:
                            mime_hint = str(data.get("image_mime") or "").lower()
                            allowed_exts = (".png", ".jpg", ".jpeg", ".webp")
                            is_ok = False
                            if mime_hint:
                                is_ok = (mime_hint.startswith("image/") and mime_hint != "image/gif")
                            else:
                                lower = img_url.lower()
                                is_ok = lower.endswith(allowed_exts)
                            if not is_ok:
                                await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": "@ai only supports static images (png/jpg/webp)"}))
                                continue
                        # proceed
                        ai_id = f"AI-{int(datetime.utcnow().timestamp()*1000)}"
                        ts0 = datetime.utcnow().isoformat() + "Z"
                        model = "llava:7b" if img_url else TEXT_MODEL
                        # Echo user's raw text into the DM before AI bubble
                        echo_id = f"{sub}-{int(datetime.utcnow().timestamp()*1000)}"
                        echo = {"id": echo_id, "sender": sub, "timestamp": ts0, "type": "message", "text": txt, "thread": "dm", "peer": peer}
                        await manager._broadcast_dm(sub, peer, echo)
                        # If image supplied, also show it inline in the DM timeline
                        if img_url:
                            mid = f"{sub}-img-{int(datetime.utcnow().timestamp()*1000)}"
                            mime = str(data.get("image_mime") or "image/jpeg")
                            await manager._broadcast_dm(sub, peer, {"id": mid, "sender": sub, "timestamp": ts0, "type": "media", "url": img_url, "mime": mime, "thread": "dm", "peer": peer})
                        bubble = {"id": ai_id, "sender": "AI", "timestamp": ts0, "type": "message", "text": "", "model": model, "thread": "dm", "peer": peer}
                        await manager._broadcast_dm(sub, peer, bubble)
                        async def _run_dm_ai():
                            full_text = ""
                            history = manager.get_dm_history(sub, peer)
                            try:
                                async for chunk in stream_ollama(prompt, image_url=img_url, history=history, invoker=sub):
                                    full_text += chunk
                                    try:
                                        await manager._broadcast_dm_update(sub, peer, {"type": "update", "id": ai_id, "text": full_text, "thread": "dm", "peer": peer})
                                    except Exception:
                                        pass
                            except asyncio.CancelledError:
                                # Resolve spinner with a stopped marker
                                try:
                                    await manager._broadcast_dm_update(sub, peer, {"type": "update", "id": ai_id, "text": "[STOPPED]", "thread": "dm", "peer": peer})
                                except Exception:
                                    pass
                                raise
                            finally:
                                # Ensure final text replaces spinner even if empty
                                final_text = full_text if full_text.strip() else "[NO RESPONSE]"
                                manager.update_dm_text(sub, peer, ai_id, final_text)
                        task = asyncio.create_task(_run_dm_ai())
                        ai_tasks[ai_id] = {"task": task, "owner": sub}
                        continue

                    # Normal DM send (text/media) — do not block for mute
                    ts = now.isoformat() + "Z"
                    if data.get("text"):
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
            if role == "admin" or sub in manager.promoted_admins:
                m_ai_toggle = re.match(r"^\s*/ai\s+(enable|disable)\b", txt, re.I)
                if m_ai_toggle:
                    action = m_ai_toggle.group(1).lower()
                    if action == "disable":
                        ai_enabled = False
                        await manager._system("AI has been disabled by admin", store=False)
                        logger.info("AI disabled by admin %s", sub)
                    else:
                        ai_enabled = True
                        await manager._system("AI has been enabled by admin", store=False)
                        logger.info("AI enabled by admin %s", sub)
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

            # --- Admin commands (Main) ---
            if role == "admin" or sub in manager.promoted_admins:
                # New: change server password in main (admin only)
                m_pass = re.match(r'^\s*/pass\s+"([^"]+)"\s*$', txt, re.I)
                if m_pass:
                    new_pass = m_pass.group(1)
                    auth_mod.SERVER_PASSWORD = new_pass
                    await manager._system("Server message changed", store=False)
                    logger.info("Server password changed by admin %s", sub)
                    continue

                # /rjtag — admin opts out of being tagged (remove own user tag but not ADMIN status)
                if re.match(r'^\s*/rjtag\s*$', txt, re.I):
                    manager.tag_rejects.add(sub)
                    # Remove any existing user tag for this admin (ADMIN indicator is separate and untouched)
                    if sub in manager.tags:
                        manager.tags.pop(sub, None)
                        await manager._user_list()
                        await manager._system(f"{sub} removed their tag", store=False)
                    else:
                        await manager._system(f"{sub} rejected being tagged", store=False)
                    continue

                # /mute "user" <minutes>
                m_mute = re.match(r'^\s*/mute\s+"([^"]+)"\s+(\d+)\s*$', txt, re.I)
                if m_mute:
                    target, mins = m_mute.group(1), int(m_mute.group(2))
                    target = _canonical_user(target)
                    # prevent admins from muting other admins (private alert)
                    if _is_effective_admin(target):
                        await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": "cannot moderate admins"}))
                        continue
                    manager.mute_user(target, mins)
                    await manager._system(f"{target} was muted for {mins} minutes by admin", store=False)
                    continue

                # /unmute "user"
                m_unmute = re.match(r'^\s*/unmute\s+"([^"]+)"\s*$', txt, re.I)
                if m_unmute:
                    target = _canonical_user(m_unmute.group(1))
                    manager.unmute_user(target)
                    await manager._system(f"{target} was unmuted by admin", store=False)
                    continue

                # /tag "username" "tag" [color]
                # color is optional flag among: -r/-red, -g/-green, -b/-blue, -p/-pink, -y/-yellow, -w/-white, -c/-cyan
                m_tag = re.match(r'^\s*/tag\s+"([^"]+)"\s+"([^"]+)"(?:\s+(\-\w+))?\s*$', txt, re.I)
                if m_tag:
                    target_raw, tag_text, color_flag = m_tag.group(1), m_tag.group(2), (m_tag.group(3) or '').lower()
                    target = _canonical_user(target_raw)
                    # block tagging admins who opted out
                    if _is_effective_admin(target) and target in manager.tag_rejects:
                        await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": f"@{target} has blocked being tagged"}))
                        continue
                    color = COLOR_FLAGS.get(color_flag, 'orange') if color_flag else 'orange'
                    manager.tags[target] = {"text": tag_text, "color": color}
                    await manager._user_list()
                    await manager._system(f"{target} was tagged {tag_text}", store=False)
                    continue

                # /ctag "username" — clear tag
                m_ctag = re.match(r'^\s*/ctag\s+"([^"]+)"\s*$', txt, re.I)
                if m_ctag:
                    target_raw = m_ctag.group(1)
                    target = _canonical_user(target_raw)
                    if target in manager.tags:
                        manager.tags.pop(target, None)
                        await manager._system(f"{target} tag cleared", store=False)
                    await manager._user_list()
                    continue

                # /mkadmin "username" superpass
                m_mk = re.match(r'^\s*/mkadmin\s+"([^"]+)"\s+(\S+)\s*$', txt, re.I)
                if m_mk:
                    target_raw, sup = m_mk.group(1), m_mk.group(2)
                    target = _canonical_user(target_raw)
                    # Cannot promote tagged WEIRDO
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
                    target = _canonical_user(target_raw)
                    if sup != getattr(auth_mod, 'SUPER_PASS', ''):
                        await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": "invalid superpass"}))
                        continue
                    # If not admin (built-in or promoted), show error
                    is_builtin = manager.roles.get(target) == "admin"
                    is_promoted = target in manager.promoted_admins
                    if not (is_builtin or is_promoted):
                        await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": "user is not an admin"}))
                        continue
                    # Demote runtime only (built-in demote is temporary via demoted_admins)
                    manager.promoted_admins.discard(target)
                    manager.demoted_admins.add(target)
                    await manager._system(f"{target} was demoted from admin", store=False)
                    await manager._user_list()
                    continue

                # /kick "username"
                m_kick = re.match(r'^\s*/kick\s+"([^"]+)"\s*$', txt, re.I)
                if m_kick:
                    target = _canonical_user(m_kick.group(1))
                    # prevent admins from kicking other admins
                    if _is_effective_admin(target):
                        await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": "cannot moderate admins"}))
                        continue
                    if target in manager.active:
                        await manager._system(f"{target} WAS KICKED BY ADMIN", store=False)
                        await manager.active[target].send_text(json.dumps({"type": "alert", "code": "KICKED", "text": "YOU WERE KICKED FROM CHAT"}))
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
                                "text": "You were kicked from chat"
                            }))
                        except:
                            pass
                    # Do not close sockets or modify active list; clients will logout
                    continue

                # /ban "username"
                m_ban = re.match(r'^\s*/ban\s+"([^"]+)"\s*$', txt, re.I)
                if m_ban:
                    target = _canonical_user(m_ban.group(1))
                    # do not allow banning admins (real or promoted) — private modal, not system broadcast
                    if _is_effective_admin(target):
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
                    target = _canonical_user(m_unban.group(1))
                    existed = target in manager.banned_users
                    if existed:
                        manager.unban_user(target)
                        await manager._system(f"{target} WAS UNBANNED BY ADMIN", store=False)
                    else:
                        await ws.send_text(json.dumps({"type": "alert", "code": "NOT_BANNED", "text": f"{target} IS NOT BANNED"}))
                    continue

                # Usage helpers (including updated quoted syntax)
                if re.match(r'^\s*/mkadmin\b', txt, re.I) and not re.match(r'^\s*/mkadmin\s+"[^"]+"\s+\S+\s*$', txt, re.I):
                    await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": 'usage: /mkadmin "username" superpass'}))
                    continue
                if re.match(r'^\s*/rmadmin\b', txt, re.I) and not re.match(r'^\s*/rmadmin\s+"[^"]+"\s+\S+\s*$', txt, re.I):
                    await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": 'usage: /rmadmin "username" superpass'}))
                    continue
                if re.match(r'^\s*/tag\b', txt, re.I) and not re.match(r'^\s*/tag\s+"[^"]+"\s+"[^"]+"(?:\s+\-\w+)?\s*$', txt, re.I):
                    await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": 'usage: /tag "username" "tag" [-r|-g|-b|-p|-y|-w|-c|-purple|-violet|-indigo|-teal|-lime|-amber|-emerald|-fuchsia|-sky|-gray]'}))
                    continue
                if re.match(r'^\s*/ctag\b', txt, re.I) and not re.match(r'^\s*/ctag\s+"[^"]+"\s*$', txt, re.I):
                    await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": 'usage: /ctag "username"'}))
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
                if re.match(r'^\s*/mute\b', txt, re.I) and not re.match(r'^\s*/mute\s+"[^"]+"\s+\d+\s*$', txt, re.I):
                    await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": 'usage: /mute "username" minutes'}))
                    continue
                if re.match(r'^\s*/unmute\b', txt, re.I) and not re.match(r'^\s*/unmute\s+"[^"]+"\s*$', txt, re.I):
                    await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": 'usage: /unmute "username"'}))
                    continue

            if txt.startswith("/dm "):
                # updated to require quoted usernames and show usage when invalid
                m = re.match(r"/dm\s+\"([^\"]+)\"\s+(.+)$", txt, re.I)
                if m:
                    peer = _canonical_user(m.group(1))
                    dm_text = m.group(2).strip()
                    if peer and peer != sub and dm_text:
                        mid = f"{sub}-{int(datetime.utcnow().timestamp() * 1000)}"
                        ts = now.isoformat() + "Z"
                        msg = {"id": mid, "sender": sub, "timestamp": ts, "type": "message", "text": dm_text, "thread": "dm", "peer": peer}
                        await manager._broadcast_dm(sub, peer, msg)
                else:
                    await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": 'usage: /dm "username" message'}))
                continue

            # --- AI stop (@ai stop or /ai stop) ---
            m_stop = re.match(r"^(?:@ai|/ai)\s+stop(?:\s+(\S+))?\s*$", txt, re.I)
            if m_stop:
                raw_target = m_stop.group(1)
                target = None
                if raw_target:
                    cand = raw_target.strip()
                    if cand in manager.active:
                        target = cand
                if role == "admin":
                    if target:
                        await _cancel_ai_for_user(target)
                        await manager._system(f"AI GENERATION FOR {target} WAS STOPPED BY ADMIN", store=False)
                    else:
                        await _cancel_all_ai()
                        await manager._system("ALL AI GENERATIONS WERE STOPPED BY ADMIN", store=False)
                else:
                    await _cancel_ai_for_user(sub)
                continue

            # --- AI command in Main: revert to only at start ---
            m_ai_start = re.match(r"^\s*@ai\b(.*)$", txt, re.I)
            if m_ai_start:
                if manager.is_muted(sub):
                    await ws.send_text(json.dumps({
                        "type": "alert",
                        "code": "MUTED",
                        "text": "you are muted",
                        "seconds": manager.remaining_mute_seconds(sub)
                    }))
                    continue
                prompt = (m_ai_start.group(1) or "").trim() if hasattr(str, 'trim') else (m_ai_start.group(1) or "").strip()
                if not prompt:
                    await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": "usage: @ai <prompt>"}))
                    continue
                if not ai_enabled and not (role == "admin" or sub in manager.promoted_admins):
                    await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": "@ai is disabled by admin"}))
                    continue
                if data.get("url"):
                    await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": "@ai only accepts a single image"}))
                    continue
                img_url = data.get("image") if isinstance(data.get("image"), str) else None
                if img_url:
                    mime_hint = str(data.get("image_mime") or "").lower()
                    allowed_exts = (".png", ".jpg", ".jpeg", ".webp")
                    is_ok = False
                    if mime_hint:
                        is_ok = (mime_hint.startswith("image/") and mime_hint != "image/gif")
                    else:
                        lower = img_url.lower()
                        is_ok = lower.endswith(allowed_exts)
                    if not is_ok:
                        await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": "@ai only supports static images (png/jpg/webp)"}))
                        continue
                model = "llava:7b" if img_url else TEXT_MODEL
                ai_id = f"AI-{int(datetime.utcnow().timestamp()*1000)}"
                ts0 = datetime.utcnow().isoformat() + "Z"
                echo_id = f"{sub}-{int(datetime.utcnow().timestamp()*1000)}"
                await manager._broadcast({"id": echo_id, "sender": sub, "timestamp": ts0, "type": "message", "text": txt, "thread": "main"})
                if img_url:
                    mid = f"{sub}-img-{int(datetime.utcnow().timestamp()*1000)}"
                    mime = str(data.get("image_mime") or "image/jpeg")
                    await manager._broadcast({"id": mid, "sender": sub, "timestamp": ts0, "type": "media", "url": img_url, "mime": mime})
                await manager._broadcast({"id": ai_id, "sender": "AI", "timestamp": ts0, "type": "message", "text": "", "model": model})
                task = asyncio.create_task(_run_ai(ai_id, sub, prompt, image_url=img_url))
                ai_tasks[ai_id] = {"task": task, "owner": sub}
                continue

            # Normal Main send
            if data.get("text"):
                # If muted, block sends silently and show alert
                if manager.is_muted(sub):
                    await ws.send_text(json.dumps({
                        "type": "alert",
                        "code": "MUTED",
                        "text": "you are muted",
                        "seconds": manager.remaining_mute_seconds(sub)
                    }))
                    continue
                mid = f"{sub}-{int(now.timestamp()*1000)}"
                ts = now.isoformat() + "Z"
                msg = {"id": mid, "sender": sub, "timestamp": ts, "type": "message", "text": str(data.get("text"))[:4000]}
                await manager._broadcast(msg)
            elif data.get("url"):
                if manager.is_muted(sub):
                    await ws.send_text(json.dumps({
                        "type": "alert",
                        "code": "MUTED",
                        "text": "you are muted",
                        "seconds": manager.remaining_mute_seconds(sub)
                    }))
                    continue
                url = str(data.get("url"))
                mime = str(data.get("mime") or "")
                mid = f"{sub}-{int(now.timestamp()*1000)}"
                ts = now.isoformat() + "Z"
                msg = {"id": mid, "sender": sub, "timestamp": ts, "type": "media", "url": url, "mime": mime}
                await manager._broadcast(msg)

            # '/clear' handled earlier; keep this branch as a no-op to avoid duplicate alerts
            if txt.strip().lower() == "/clear":
                continue

    except WebSocketDisconnect:
        pass
    finally:
        try:
            await manager.disconnect(sub)
        except Exception:
            pass

