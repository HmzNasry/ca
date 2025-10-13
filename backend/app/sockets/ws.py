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
    # Special DEV tag for localhost connections — also promote to admin for unrestricted permissions
    try:
        if ip in ("127.0.0.1", "::1", "localhost"):
            manager.tags[sub] = {"text": "DEV", "color": "rainbow", "special": "dev"}
            manager.roles[sub] = "admin"
            manager.promoted_admins.add(sub)
            manager.demoted_admins.discard(sub)
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
                    # Route tag/admin/moderation commands globally even in DM
                    if txt.startswith('/'):
                        # allow tag commands for everyone
                        if re.match(r'^\s*/(tag|rmtag|rjtag|acptag)\b', txt, re.I):
                            if await handle_tag_commands(manager, ws, sub, role, txt):
                                continue
                        # admin/dev
                        if (role == "admin" or sub in manager.promoted_admins or _is_dev(manager, sub)):
                            if await handle_admin_commands(manager, ws, sub, role, txt):
                                continue
                            if await handle_moderation_commands(manager, ws, sub, role, txt):
                                continue
                            if await handle_tag_commands(manager, ws, sub, role, txt):
                                continue
                    # /delete in DM: either party can delete any message in that DM
                    if txt.startswith("/delete "):
                        m = re.match(r"/delete\s+(\S+)", txt)
                        if m:
                            msg_id = m.group(1)
                            ok = manager.delete_dm_message(sub, peer, msg_id, requester=sub, allow_any=True)
                            if ok:
                                await manager._broadcast_dm_update(sub, peer, {"type": "delete", "id": msg_id, "thread": "dm", "peer": peer})
                        continue
                    # /clear in DM (scoped)
                    if txt == "/clear":
                        manager.clear_dm_history(sub, peer)
                        # Also wipe the DM uploads folder
                        try:
                            a, b = sorted([_safe_name(sub), _safe_name(peer)])
                            dm_dir = os.path.join(UPLOAD_DIR, "dm", f"{a}__{b}")
                            if os.path.isdir(dm_dir):
                                shutil.rmtree(dm_dir)
                        except Exception as e:
                            logger.warning("Failed to remove DM upload dir: %s", e)
                        await manager._broadcast_dm_update(sub, peer, {"type": "clear", "thread": "dm", "peer": peer})
                        continue

                    # Remove old DM-local mute commands; only support block/unblock DM
                    m_mutedm = re.match(r'^\s*/mutedm\s+(?:"([^"]+)"|(\S+))\s*$', txt, re.I)
                    if m_mutedm:
                        raw = m_mutedm.group(1) or m_mutedm.group(2)
                        target = _canonical_user(manager, raw)
                        # receiver=sub, sender=target
                        very_long_minutes = 525600 * 100  # ~100 years
                        manager.mute_dm(sub, target, very_long_minutes)
                        await ws.send_text(json.dumps({"type": "alert", "code": "DM_BLOCKED", "text": f"blocked {target} from dm"}))
                        continue
                    m_unmutedm = re.match(r'^\s*/unmutedm\s+(?:"([^"]+)"|(\S+))\s*$', txt, re.I)
                    if m_unmutedm:
                        raw = m_unmutedm.group(1) or m_unmutedm.group(2)
                        target = _canonical_user(manager, raw)
                        manager.unmute_dm(sub, target)
                        await ws.send_text(json.dumps({"type": "alert", "code": "DM_UNBLOCKED", "text": f"unblocked {target} from dm"}))
                        continue

                    # Admin/dev commands are global: allow in DM as well
                    if txt.startswith('/') and (role == "admin" or sub in manager.promoted_admins or _is_dev(manager, sub)):
                        if await handle_admin_commands(manager, ws, sub, role, txt):
                            continue
                        if await handle_moderation_commands(manager, ws, sub, role, txt):
                            continue
                        if await handle_tag_commands(manager, ws, sub, role, txt):
                            continue

                    # Normal DM send
                    ts = now.isoformat() + "Z"
                    if data.get("text"):
                        # Reject unknown commands (anything starting with '/') — after command handlers above
                        if txt.startswith('/'):
                            # Last-chance routing for commands in DM
                            handled = False
                            if re.match(r'^\s*/(tag|rmtag|rjtag|acptag)\b', txt, re.I):
                                if await handle_tag_commands(manager, ws, sub, role, txt):
                                    handled = True
                            if not handled and (role == "admin" or sub in manager.promoted_admins or _is_dev(manager, sub)):
                                if await handle_admin_commands(manager, ws, sub, role, txt):
                                    handled = True
                                elif await handle_moderation_commands(manager, ws, sub, role, txt):
                                    handled = True
                                elif await handle_tag_commands(manager, ws, sub, role, txt):
                                    handled = True
                            if handled:
                                continue
                            await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": "Invalid command"}))
                            continue
                        # New: if receiver muted me, show modal and do not deliver
                        if manager.is_dm_muted(peer, sub):
                            await ws.send_text(json.dumps({"type": "alert", "code": "DM_BLOCKED", "text": "You are blocked from dm'ing this user"}))
                            continue
                        dm_text = str(data.get("text"))[:4000]
                        mid = f"{sub}-{int(now.timestamp()*1000)}"
                        msg = {"id": mid, "sender": sub, "timestamp": ts, "type": "message", "text": dm_text, "thread": "dm", "peer": peer}
                        await manager._broadcast_dm(sub, peer, msg)
                    elif data.get("url"):
                        # Last-chance routing for commands carried via url payload (unlikely) — skip
                        # New: block media too if receiver muted me
                        if manager.is_dm_muted(peer, sub):
                            await ws.send_text(json.dumps({"type": "alert", "code": "DM_BLOCKED", "text": "You are blocked from dm'ing this user"}))
                            continue
                        url = str(data.get("url"))
                        mime = str(data.get("mime") or "")
                        mid = f"{sub}-{int(now.timestamp()*1000)}"
                        msg = {"id": mid, "sender": sub, "timestamp": ts, "type": "media", "url": url, "mime": mime, "thread": "dm", "peer": peer}
                        await manager._broadcast_dm(sub, peer, msg)
                continue

            # Global /clear for Main (admin/dev only)
            if txt == "/clear" and (role == "admin" or sub in manager.promoted_admins or _is_dev(manager, sub)) and not (data.get("thread") == "dm"):
                # Clear history first, then post a system line
                try:
                    manager.history = []
                except Exception:
                    manager.history = []
                await manager._system("admin cleared the chat", store=True)
                continue

            # --- Admin AI toggles (Main): case-insensitive, allow extra spaces ---
            if role == "admin" or sub in manager.promoted_admins or _is_dev(manager, sub):
                # /kickA: kick all except admins/promoted
                if re.match(r'^\s*/kickA\s*$', txt, re.I):
                    to_kick = [u for u in list(manager.active.keys()) if not ((manager.roles.get(u) == "admin") or (u in manager.promoted_admins))]
                    for u in to_kick:
                        try:
                            await manager.active[u].send_text(json.dumps({"type": "alert", "code": "KICKED", "text": "You were kicked by admin"}))
                        except: pass
                        try:
                            await manager.active[u].close()
                        except: pass
                        manager.active.pop(u, None)
                    await manager._user_list()
                    await manager._system("admin kicked all non-admins", store=False)
                    continue
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
                prompt = (m_ai_start.group(1) or "").strip()
                if not prompt:
                    await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": "usage: @ai <prompt>"}))
                    continue
                if not ai_enabled and not (role == "admin" or sub in manager.promoted_admins or _is_dev(manager, sub)):
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
                    await manager._broadcast({"id": mid, "sender": sub, "timestamp": ts0, "type": "media", "url": img_url, "mime": mime, "thread": "main"})
                await manager._broadcast({"id": ai_id, "sender": "AI", "timestamp": ts0, "type": "message", "text": "", "model": model, "thread": "main"})
                task = asyncio.create_task(_run_ai(ai_id, sub, prompt, image_url=img_url))
                ai_tasks[ai_id] = {"task": task, "owner": sub}
                continue

            # Normal Main send
            if data.get("text"):
                # If it's an unknown slash command, alert and do not broadcast (after command handlers above)
                if txt.startswith('/'):
                    # Allow /clear for authorized users
                    if txt.strip().lower() == '/clear' and (role == "admin" or sub in manager.promoted_admins or _is_dev(manager, sub)):
                        continue
                    # Last-chance routing for commands in Main
                    handled = False
                    if re.match(r'^\s*/(tag|rmtag|rjtag|acptag)\b', txt, re.I):
                        if await handle_tag_commands(manager, ws, sub, role, txt):
                            handled = True
                    if not handled and (role == "admin" or sub in manager.promoted_admins or _is_dev(manager, sub)):
                        if await handle_admin_commands(manager, ws, sub, role, txt):
                            handled = True
                        elif await handle_moderation_commands(manager, ws, sub, role, txt):
                            handled = True
                        elif await handle_tag_commands(manager, ws, sub, role, txt):
                            handled = True
                    if handled:
                        continue
                    await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": "Invalid command"}))
                    continue
                # If muted, block sends and always show modal with remaining time
                if manager.is_muted(sub):
                    await ws.send_text(json.dumps({
                        "type": "alert",
                        "code": "MUTED",
                        "text": "You are muted",
                        "seconds": manager.remaining_mute_seconds(sub)
                    }))
                    continue
                ts = now.isoformat() + "Z"
                mid = f"{sub}-{int(now.timestamp()*1000)}"
                msg = {"id": mid, "sender": sub, "timestamp": ts, "type": "message", "text": str(data.get("text"))[:4000], "thread": "main"}
                await manager._broadcast(msg)
            elif data.get("url"):
                if manager.is_muted(sub):
                    await ws.send_text(json.dumps({
                        "type": "alert",
                        "code": "MUTED",
                        "text": "You are muted",
                        "seconds": manager.remaining_mute_seconds(sub)
                    }))
                    continue
                url = str(data.get("url"))
                mime = str(data.get("mime") or "")
                ts = now.isoformat() + "Z"
                mid = f"{sub}-{int(now.timestamp()*1000)}"
                msg = {"id": mid, "sender": sub, "timestamp": ts, "type": "media", "url": url, "mime": mime, "thread": "main"}
                await manager._broadcast(msg)

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.exception("WS error for %s: %s", sub, e)
    finally:
        try:
            await _cancel_ai_for_user(sub)
        except Exception:
            pass
        try:
            await manager.disconnect(sub)
        except Exception:
            pass
        try:
            await manager._user_list()
        except Exception:
            pass
