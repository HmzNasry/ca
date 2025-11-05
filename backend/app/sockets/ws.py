import json, os, re, shutil, asyncio, httpx
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

SPOTIFY_RE = re.compile(r'(https?://open.spotify.com/(track|playlist|album)/[a-zA-Z0-9]+)')
YOUTUBE_RE = re.compile(r'(https?://(?:www\.)?(?:youtube\.com/watch\?v=|youtube\.com/shorts/|youtu\.be/)[^\s]+)')

async def get_spotify_preview(text: str):
    match = SPOTIFY_RE.search(text)
    if not match:
        return None
    
    spotify_url = match.group(1)
    try:
        async with httpx.AsyncClient() as client:
            # Use Spotify's oEmbed API
            oembed_url = f"https://open.spotify.com/oembed?url={spotify_url}"
            response = await client.get(oembed_url)
            response.raise_for_status()
            data = response.json()
            # Return the HTML for the iframe embed
            return data.get("html")
    except httpx.RequestError as e:
        logger.error(f"Failed to fetch Spotify preview for {spotify_url}: {e}")
        return None
    except Exception as e:
        logger.error(f"An unexpected error occurred while fetching Spotify preview: {e}")
        return None

async def get_youtube_preview(text: str):
    match = YOUTUBE_RE.search(text)
    if not match:
        return None
    
    youtube_url = match.group(1)
    try:
        async with httpx.AsyncClient() as client:
            oembed_url = f"https://www.youtube.com/oembed?url={youtube_url}&format=json"
            response = await client.get(oembed_url, headers={"User-Agent": "GeminiChat/1.0"})
            response.raise_for_status()
            data = response.json()
            return data.get("html")
    except httpx.HTTPStatusError as e:
        logger.error(f"YouTube oEmbed failed for {youtube_url} with status {e.response.status_code}")
        return f"YOUTUBE_PREVIEW_FAILED: HTTP {e.response.status_code}"
    except httpx.RequestError as e:
        logger.error(f"Failed to fetch YouTube preview for {youtube_url}: {e}")
        return "YOUTUBE_PREVIEW_FAILED: RequestError"
    except Exception as e:
        logger.error(f"An unexpected error occurred while fetching YouTube preview: {e}")
        return "YOUTUBE_PREVIEW_FAILED: Unexpected"

manager = ConnMgr()
manager.HISTORY = 100 if hasattr(manager, 'HISTORY') else None
# Map usernames to last known IP
manager.user_ips = {}  # username -> last known IP

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
    # Enforce persistent identity: bind username to uid for this IP and block reserved names
    ok_uid, uid, err = manager.ensure_user_identity(ip, sub)
    if not ok_uid:
        await ws.accept()
        await ws.send_text(json.dumps({"type": "alert", "code": "USERNAME_TAKEN", "text": "Username is reserved for another user"}))
        await ws.close()
        return
    # Update last known IP for this username (legacy per-username mapping)
    manager.user_ips[sub] = ip

    # Reject duplicate usernames (already connected)
    try:
        if sub in manager.active:
            await ws.accept()
            await ws.send_text(json.dumps({"type": "alert", "code": "DUPLICATE", "text": "Username already online"}))
            await ws.close()
            return
    except Exception:
        pass

    # check if banned (username or IP)
    if role != "admin" and (sub in manager.banned_users or ip in manager.banned_ips):
        await ws.accept()
        await ws.send_text(json.dumps({"type": "alert", "code": "BANNED_CONNECT", "text": "You are banned from chat"}))
        await ws.close()
        return

    await ws.accept()
    await manager.connect(ws, sub, role)
    # Send current GC memberships to the user on connect
    try:
        gcs = manager.get_user_gcs(sub)
        await ws.send_text(json.dumps({"type": "gc_list", "gcs": gcs}))
    except Exception:
        pass
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
            now = datetime.utcnow()
            txt = (data.get("text", "") or "").strip()

            

            if data.get("typing"):
                # Scope typing to the active thread
                if data.get("thread") == "dm" and isinstance(data.get("peer"), str):
                    peer = data.get("peer").strip()
                    if peer and peer != sub:
                        # Send only to both DM peers, with proper peer routing
                        await manager._broadcast_dm_update(sub, peer, {
                            "type": "typing", "user": sub, "typing": data["typing"], "thread": "dm"
                        })
                elif data.get("thread") == "gc" and isinstance(data.get("gcid"), str):
                    gid = data.get("gcid").strip()
                    if gid and manager.user_in_gc(gid, sub):
                        await manager._broadcast_gc_update(gid, {"type": "typing", "user": sub, "typing": data["typing"], "thread": "gc"})
                else:
                    # Main thread typing: suppress if muted
                    if manager.is_muted(sub):
                        continue
                    await manager._broadcast({"type": "typing", "user": sub, "typing": data["typing"], "thread": "main"})
                continue

            # NEW: handle activity events (tab active/inactive)
            if data.get("type") == "activity":
                active = bool(data.get("active"))
                manager.user_activity[sub] = active
                await manager._user_list()
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
            # --- GC: history request ---
            if data.get("type") == "gc_history" and isinstance(data.get("gcid"), str):
                gid = data.get("gcid").strip()
                if gid and manager.user_in_gc(gid, sub):
                    items = manager.get_gc_history(gid)
                    await ws.send_text(json.dumps({"type": "gc_history", "gcid": gid, "items": items}))
                continue
            if data.get("thread") == "dm" and isinstance(data.get("peer"), str):
                peer = data.get("peer").strip()
                if peer and peer != sub:
                    # Trigger Create-GC prompt from anywhere
                    if re.match(r'^\s*/makegc\s*$', txt, re.I):
                        await ws.send_text(json.dumps({"type": "gc_prompt"}))
                        continue
                    # Route tag/admin/moderation commands globally even in DM
                    if txt.startswith('/'):
                        # allow tag commands for everyone
                        if re.match(r'^\s*/(tag|rmtag|rjtag|acptag)\b', txt, re.I):
                            if await handle_tag_commands(manager, ws, sub, role, txt):
                                continue
                        # admin/dev
                        if _is_effective_admin(manager, sub):
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
                        # Send system message to both DM users
                        ts = datetime.utcnow().isoformat() + "Z"
                        sysmsg = {"id": f"sys-{int(datetime.utcnow().timestamp()*1000)}", "type": "system", "sender": "SYSTEM", "timestamp": ts, "text": "DM cleared"}
                        await manager._broadcast_dm(sub, peer, sysmsg)
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
                    if txt.startswith('/') and _is_effective_admin(manager, sub):
                        if await handle_admin_commands(manager, ws, sub, role, txt):
                            continue
                        if await handle_moderation_commands(manager, ws, sub, role, txt):
                            continue
                        if await handle_tag_commands(manager, ws, sub, role, txt):
                            continue

                    # --- AI in DM ---
                    m_ai_dm = re.match(r"^\s*@ai\b(.*)$", txt, re.I)
                    if m_ai_dm:
                        if manager.is_dm_muted(peer, sub):
                            await ws.send_text(json.dumps({"type": "alert", "code": "DM_BLOCKED", "text": "You are blocked from dm'ing this user"}))
                            continue
                        prompt = (m_ai_dm.group(1) or "").strip()
                        if not prompt:
                            await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": "usage: @ai <prompt>"}))
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
                        # Tagging and 'Generating Response' identical to Main/GC
                        await manager._broadcast_dm(sub, peer, {"id": echo_id, "sender": sub, "timestamp": ts0, "type": "message", "text": txt, "thread": "dm", "peer": peer})
                        if img_url:
                            mid = f"{sub}-img-{int(datetime.utcnow().timestamp()*1000)}"
                            mime = str(data.get("image_mime") or "image/jpeg")
                            await manager._broadcast_dm(sub, peer, {"id": mid, "sender": sub, "timestamp": ts0, "type": "media", "url": img_url, "mime": mime, "thread": "dm", "peer": peer})
                        await manager._broadcast_dm(sub, peer, {"id": ai_id, "sender": "AI", "timestamp": ts0, "type": "message", "text": "", "model": model, "thread": "dm", "peer": peer})
                        async def run_dm_ai():
                            full_text = ""
                            try:
                                async for chunk in stream_ollama(prompt, image_url=img_url, history=manager.get_dm_history(sub, peer), invoker=sub):
                                    full_text += chunk
                                    try:
                                        await manager._broadcast_dm_update(sub, peer, {"type": "update", "id": ai_id, "text": full_text, "thread": "dm", "peer": peer})
                                    except Exception:
                                        pass
                            except asyncio.CancelledError:
                                try:
                                    await manager._broadcast_dm_update(sub, peer, {"type": "update", "id": ai_id, "text": "[STOPPED]", "thread": "dm", "peer": peer})
                                    await manager._broadcast_dm(sub, peer, {"id": ai_id, "sender": "AI", "timestamp": ts0, "type": "message", "text": "[STOPPED]", "model": model, "thread": "dm", "peer": peer})
                                except Exception:
                                    pass
                                raise
                            finally:
                                try:
                                    if not full_text.strip():
                                        await manager._broadcast_dm_update(sub, peer, {"type": "update", "id": ai_id, "text": "[NO RESPONSE]", "thread": "dm", "peer": peer})
                                        await manager._broadcast_dm(sub, peer, {"id": ai_id, "sender": "AI", "timestamp": ts0, "type": "message", "text": "[NO RESPONSE]", "model": model, "thread": "dm", "peer": peer})
                                    # Persist final text into DM history
                                    dm_hist = manager.dm_histories.get(manager.dm_id(sub, peer), [])
                                    for msg in dm_hist:
                                        if msg.get("id") == ai_id:
                                            msg["text"] = full_text if full_text.strip() else "[NO RESPONSE]"
                                            break
                                except Exception:
                                    pass
                        asyncio.create_task(run_dm_ai())
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
                            if not handled and _is_effective_admin(manager, sub):
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
                        
                        # Get Spotify preview
                        spotify_preview_html = await get_spotify_preview(msg["text"])
                        if spotify_preview_html:
                            msg["spotify_preview_html"] = spotify_preview_html
                        else:
                            # If no Spotify preview, check for YouTube
                            youtube_preview_html = await get_youtube_preview(msg["text"])
                            if youtube_preview_html:
                                msg["youtube_preview_html"] = youtube_preview_html

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

            # --- GC thread handling ---
            if data.get("thread") == "gc" and isinstance(data.get("gcid"), str):
                gid = data.get("gcid").strip()
                # Detect join/leave events and broadcast system messages
                if txt == "/join" and gid and not manager.user_in_gc(gid, sub):
                    manager.add_user_to_gc(gid, sub)
                    ts = datetime.utcnow().isoformat() + "Z"
                    sysmsg = {"id": f"sys-{int(datetime.utcnow().timestamp()*1000)}", "type": "system", "sender": "SYSTEM", "timestamp": ts, "text": f"{sub} joined the group"}
                    await manager._broadcast_gc(gid, sysmsg)
                    continue
                if txt == "/leave" and gid and manager.user_in_gc(gid, sub):
                    manager.remove_user_from_gc(gid, sub)
                    ts = datetime.utcnow().isoformat() + "Z"
                    sysmsg = {"id": f"sys-{int(datetime.utcnow().timestamp()*1000)}", "type": "system", "sender": "SYSTEM", "timestamp": ts, "text": f"{sub} left the group"}
                    await manager._broadcast_gc(gid, sysmsg)
                    continue
                if not gid or not manager.user_in_gc(gid, sub):
                    await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": "not in this group chat"}))
                    continue
                # Route tag/admin/moderation commands within GC as in Main/DM
                if txt.startswith('/'):
                    handled = False
                    # Public tag commands
                    if re.match(r'^\s*/(tag|rmtag|rjtag|acptag)\b', txt, re.I):
                        if await handle_tag_commands(manager, ws, sub, role, txt):
                            handled = True
                    # Admin/dev commands
                    if not handled and _is_effective_admin(manager, sub):
                        if await handle_admin_commands(manager, ws, sub, role, txt):
                            handled = True
                        elif await handle_moderation_commands(manager, ws, sub, role, txt):
                            handled = True
                        elif await handle_tag_commands(manager, ws, sub, role, txt):
                            handled = True
                    if handled:
                        continue
                    # Unknown slash in GC -> invalid command
                    await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": "Invalid command"}))
                    continue
                # Commands in GC
                if txt == "/clear":
                    # Only GC creator can clear
                    try:
                        gc = manager.gcs.get(gid) or {}
                        if gc.get("creator") != sub:
                            await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": "Only creator can clear this GC"}))
                        else:
                            manager.clear_gc_history(gid)
                            # wipe GC uploads folder
                            try:
                                gc_dir = os.path.join(UPLOAD_DIR, "gc", gid)
                                if os.path.isdir(gc_dir):
                                    shutil.rmtree(gc_dir)
                            except Exception as e:
                                logger.warning("Failed to remove GC upload dir: %s", e)
                            await manager._broadcast_gc_update(gid, {"type": "clear", "thread": "gc"})
                            # Send system message to GC
                            ts = datetime.utcnow().isoformat() + "Z"
                            sysmsg = {"id": f"sys-{int(datetime.utcnow().timestamp()*1000)}", "type": "system", "sender": "SYSTEM", "timestamp": ts, "text": "Group cleared"}
                            await manager._broadcast_gc(gid, sysmsg)
                    except Exception:
                        pass
                    continue
                # Delete a message in GC
                m_del_gc = re.match(r'^\s*/delete\s+(\S+)\s*$', txt, re.I)
                if m_del_gc:
                    msg_id = m_del_gc.group(1)
                    
                    # Find message and check permissions
                    gc = manager.gcs.get(gid)
                    if not gc: continue
                    target_msg = next((m for m in gc.get("history", []) if m.get("id") == msg_id), None)
                    if not target_msg:
                        await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": "message not found"}))
                        continue

                    owner = target_msg.get("sender")
                    is_requester_dev = _is_dev(manager, sub)
                    is_requester_admin = _is_effective_admin(manager, sub)
                    is_owner_dev = _is_dev(manager, owner)
                    is_owner_admin = _is_effective_admin(manager, owner)
                    is_requester_creator = gc.get("creator") == sub

                    can_delete = False
                    if is_requester_dev:
                        can_delete = True
                    elif is_requester_admin:
                        if owner == sub or (not is_owner_admin and not is_owner_dev):
                            can_delete = True
                    elif is_requester_creator and owner != sub: # Creator can delete others' messages unless they are admin/dev
                        if not is_owner_admin and not is_owner_dev:
                            can_delete = True
                    elif owner == sub:
                        can_delete = True

                    if not can_delete:
                        await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": "not allowed"}))
                        continue

                    if manager.delete_gc_message(gid, msg_id, requester=sub, allow_any=True):
                        await manager._broadcast_gc_update(gid, {"type": "delete", "id": msg_id, "thread": "gc"})
                    continue
                # Creation prompt
                if re.match(r'^\s*/makegc\s*$', txt, re.I):
                    await ws.send_text(json.dumps({"type": "gc_prompt"}))
                    continue
                # --- AI in GC ---
                m_ai_gc = re.match(r"^\s*@ai\b(.*)$", txt, re.I)
                if m_ai_gc:
                    if manager.is_muted(sub):
                        await ws.send_text(json.dumps({
                            "type": "alert",
                            "code": "MUTED",
                            "text": "You are muted",
                            "seconds": manager.remaining_mute_seconds(sub)
                        }))
                        continue
                    prompt = (m_ai_gc.group(1) or "").strip()
                    if not prompt:
                        await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": "usage: @ai <prompt>"}))
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
                    # Tagging and 'Generating Response' identical to Main/DM
                    await manager._broadcast_gc(gid, {"id": echo_id, "sender": sub, "timestamp": ts0, "type": "message", "text": txt, "thread": "gc", "gcid": gid})
                    if img_url:
                        mid = f"{sub}-img-{int(datetime.utcnow().timestamp()*1000)}"
                        mime = str(data.get("image_mime") or "image/jpeg")
                        await manager._broadcast_gc(gid, {"id": mid, "sender": sub, "timestamp": ts0, "type": "media", "url": img_url, "mime": mime, "thread": "gc", "gcid": gid})
                    # Send 'Generating Response' system message
                    await manager._broadcast_gc(gid, {"id": ai_id, "sender": "AI", "timestamp": ts0, "type": "message", "text": "", "model": model, "thread": "gc", "gcid": gid})
                    async def run_gc_ai():
                        full_text = ""
                        try:
                            async for chunk in stream_ollama(prompt, image_url=img_url, history=manager.get_gc_history(gid), invoker=sub):
                                full_text += chunk
                                try:
                                    await manager._broadcast_gc_update(gid, {"type": "update", "id": ai_id, "text": full_text, "thread": "gc", "gcid": gid})
                                except Exception:
                                    pass
                        except asyncio.CancelledError:
                            try:
                                await manager._broadcast_gc_update(gid, {"type": "update", "id": ai_id, "text": "[STOPPED]", "thread": "gc", "gcid": gid})
                                await manager._broadcast_gc(gid, {"id": ai_id, "sender": "AI", "timestamp": ts0, "type": "message", "text": "[STOPPED]", "model": model, "thread": "gc", "gcid": gid})
                            except Exception:
                                pass
                            raise
                        finally:
                            try:
                                if not full_text.strip():
                                    await manager._broadcast_gc_update(gid, {"type": "update", "id": ai_id, "text": "[NO RESPONSE]", "thread": "gc", "gcid": gid})
                                    await manager._broadcast_gc(gid, {"id": ai_id, "sender": "AI", "timestamp": ts0, "type": "message", "text": "[NO RESPONSE]", "model": model, "thread": "gc", "gcid": gid})
                                # Persist final text into GC history
                                gc_hist = manager.gcs.get(gid, {}).get("history", [])
                                for msg in gc_hist:
                                    if msg.get("id") == ai_id:
                                        msg["text"] = full_text if full_text.strip() else "[NO RESPONSE]"
                                        break
                            except Exception:
                                pass
                    asyncio.create_task(run_gc_ai())
                    continue
                # Normal GC send
                ts = now.isoformat() + "Z"
                if data.get("text"):
                    if manager.is_muted(sub):
                        await ws.send_text(json.dumps({
                            "type": "alert",
                            "code": "MUTED",
                            "text": "You are muted",
                            "seconds": manager.remaining_mute_seconds(sub)
                        }))
                        continue
                    gc_text = str(data.get("text"))[:4000]
                    mid = f"{sub}-{int(now.timestamp()*1000)}"
                    msg = {"id": mid, "sender": sub, "timestamp": ts, "type": "message", "text": gc_text, "thread": "gc"}
                    
                    # Get Spotify preview
                    spotify_preview_html = await get_spotify_preview(msg["text"])
                    if spotify_preview_html:
                        msg["spotify_preview_html"] = spotify_preview_html
                    else:
                        # If no Spotify preview, check for YouTube
                        youtube_preview_html = await get_youtube_preview(msg["text"])
                        if youtube_preview_html:
                            msg["youtube_preview_html"] = youtube_preview_html

                    await manager._broadcast_gc(gid, msg)
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
                    mid = f"{sub}-{int(now.timestamp()*1000)}"
                    msg = {"id": mid, "sender": sub, "timestamp": ts, "type": "media", "url": url, "mime": mime, "thread": "gc"}
                    await manager._broadcast_gc(gid, msg)
                continue

            # --- GC management commands (global) ---
            # Create GC via payload after client collects input in a modal
            if data.get("type") == "create_gc" and isinstance(data.get("name"), str) and isinstance(data.get("members"), list):
                try:
                    name = (data.get("name") or "").strip() or "Group Chat"
                    members = [str(x) for x in data.get("members") if isinstance(x, str)]
                    # sanitize: cannot include self twice
                    members = [m for m in members if m != sub]
                    gid = manager.create_gc(name, sub, members)
                    await manager.send_gc_list([sub] + members)
                    await ws.send_text(json.dumps({"type": "gc_created", "gcid": gid}))
                except Exception as e:
                    await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": "failed to create group"}))
                continue

            # Update GC (creator only): name and/or members list
            if data.get("type") == "update_gc" and isinstance(data.get("gcid"), str):
                gid = data.get("gcid").strip()
                gc = manager.gcs.get(gid) or {}
                if not gid or not gc:
                    continue
                if gc.get("creator") != sub:
                    await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": "only creator can update"}))
                    continue
                name = data.get("name")
                members = data.get("members")
                if isinstance(members, list):
                    members = [str(x) for x in members if isinstance(x, str)]
                else:
                    members = None
                before = set((manager.gcs.get(gid) or {}).get("members", set()))
                creator = (manager.gcs.get(gid) or {}).get("creator")
                manager.update_gc(gid, name=name if isinstance(name, str) else None, members=members)
                after = set((manager.gcs.get(gid) or {}).get("members", set()))
                
                # --- Start of new logic ---
                joined = after - before
                left = before - after

                for user in joined:
                    await manager._broadcast_gc_update(gid, {"type": "gc_member_joined", "user": user, "gcid": gid})
                
                for user in left:
                    await manager._broadcast_gc_update(gid, {"type": "gc_member_left", "user": user, "gcid": gid})
                # --- End of new logic ---

                # Push updated lists to all impacted users (before ∪ after ∪ {creator})
                try:
                    affected = list(before.union(after).union({creator} if creator else set()))
                    await manager.send_gc_list(affected)
                except Exception:
                    pass
                await manager._broadcast_gc_update(gid, {"type": "gc_settings", "name": (name if isinstance(name, str) else gc.get("name"))})
                continue

            # Exit GC: if creator exits, ownership transfers inside manager
            if data.get("type") == "exit_gc" and isinstance(data.get("gcid"), str):
                gid = data.get("gcid").strip()
                if gid and manager.user_in_gc(gid, sub):
                    manager.exit_gc(gid, sub)
                    # Notify members of change and update lists for leaver and remaining
                    try:
                        remaining = list((manager.gcs.get(gid) or {}).get("members", set()))
                        await manager.send_gc_list([sub] + remaining)
                        await manager._broadcast_gc_update(gid, {"type": "gc_member_left", "user": sub})
                    except Exception:
                        pass
                continue

            # Delete GC: creator only; remove GC and notify members to navigate away
            if data.get("type") == "delete_gc" and isinstance(data.get("gcid"), str):
                gid = data.get("gcid").strip()
                gc = manager.gcs.get(gid) or {}
                if gid and gc and gc.get("creator") == sub:
                    # Delete uploads folder for this GC
                    try:
                        gc_dir = os.path.join(UPLOAD_DIR, "gc", gid)
                        if os.path.isdir(gc_dir):
                            shutil.rmtree(gc_dir)
                    except Exception as e:
                        logger.warning("Failed to remove GC upload dir: %s", e)
                    # Capture members, remove
                    members = list(gc.get("members", set()))
                    manager.gcs.pop(gid, None)
                    # Also delete from DB (group + its messages)
                    try:
                        from ..services.persistence import delete_group
                        delete_group(gid)
                    except Exception:
                        pass
                    # Notify members
                    for u in members:
                        try:
                            w = manager.active.get(u)
                            if w:
                                await w.send_text(json.dumps({"type": "gc_deleted", "gcid": gid}))
                        except Exception:
                            pass
                    await manager.send_gc_list(members)
                else:
                    await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": "only creator can delete"}))
                continue

            # Global: /makegc prompt when typed in Main or without thread
            if re.match(r'^\s*/makegc\s*$', txt, re.I):
                await ws.send_text(json.dumps({"type": "gc_prompt"}))
                continue

            # Global /clear for Main (admin/dev only)
            if txt == "/clear" and _is_effective_admin(manager, sub) and not (data.get("thread") == "dm"):
                # Clear history first, then post a system line
                try:
                    manager.history = []
                except Exception:
                    manager.history = []
                # Also wipe Main uploads folder
                try:
                    main_dir = os.path.join(UPLOAD_DIR, "main")
                    if os.path.isdir(main_dir):
                        shutil.rmtree(main_dir)
                except Exception as e:
                    logger.warning("Failed to remove Main upload dir: %s", e)
                # Clear DB for main
                try:
                    from ..services.persistence import clear_history
                    clear_history('main', None)
                except Exception:
                    pass
                # Broadcast clear event and system message to all
                await manager._broadcast({"type": "clear", "thread": "main"})
                ts = datetime.utcnow().isoformat() + "Z"
                sysmsg = {"id": f"sys-{int(datetime.utcnow().timestamp()*1000)}", "type": "system", "sender": "SYSTEM", "timestamp": ts, "text": "Admin cleared the chat"}
                await manager._broadcast(sysmsg)
                continue

            # Main: /delete <id> — allow author or admin/dev
            m_del = re.match(r'^\s*/delete\s+(\S+)\s*$', txt, re.I)
            if m_del and not (data.get("thread") == "dm"):
                msg_id = m_del.group(1)
                # find message in main history
                target_msg = next((m for m in manager.history if m.get("id") == msg_id), None)
                if not target_msg:
                    await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": "message not found"}))
                    continue
                owner = target_msg.get("sender")
                # Deletion permission logic:
                # 1. DEV can delete anything.
                # 2. Admin can delete their own messages or any non-admin/non-DEV user's message.
                # 3. Users can only delete their own messages.
                is_requester_dev = _is_dev(manager, sub)
                is_requester_admin = _is_effective_admin(manager, sub)
                is_owner_dev = _is_dev(manager, owner)
                is_owner_admin = _is_effective_admin(manager, owner)

                can_delete = False
                if is_requester_dev:
                    can_delete = True
                elif is_requester_admin:
                    if owner == sub or (not is_owner_admin and not is_owner_dev):
                        can_delete = True
                elif owner == sub:
                    can_delete = True

                if not can_delete:
                    await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": "not allowed"}))
                    continue
                if manager.delete_main_message(msg_id):
                    await manager._broadcast({"type": "delete", "id": msg_id, "thread": "main"})
                continue

            # --- Admin AI toggles (Main): case-insensitive, allow extra spaces ---
            if _is_effective_admin(manager, sub):
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
                if not ai_enabled and not _is_effective_admin(manager, sub):
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
                    if txt.strip().lower() == '/clear' and _is_effective_admin(manager, sub):
                        continue
                    # Last-chance routing for commands in Main
                    handled = False
                    if re.match(r'^\s*/(tag|rmtag|rjtag|acptag)\b', txt, re.I):
                        if await handle_tag_commands(manager, ws, sub, role, txt):
                            handled = True
                    if not handled and _is_effective_admin(manager, sub):
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
                
                # Get Spotify preview
                spotify_preview_html = await get_spotify_preview(msg["text"])
                if spotify_preview_html:
                    msg["spotify_preview_html"] = spotify_preview_html
                else:
                    # If no Spotify preview, check for YouTube
                    youtube_preview_html = await get_youtube_preview(msg["text"])
                    if youtube_preview_html:
                        msg["youtube_preview_html"] = youtube_preview_html
                
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
