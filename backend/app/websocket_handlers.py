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


async def _run_ai(ai_id: str, owner: str, prompt: str):
    full_text = ""
    history = list(manager.history)  # same history, so /clear wipes it
    try:
        async for chunk in stream_ollama(prompt, image_url=None, history=history):
            full_text += chunk
            try:
                await manager._broadcast({"type": "update", "id": ai_id, "text": full_text})
            except Exception:
                pass
    except asyncio.CancelledError:
        try:
            await manager._system(f"AI generation by {owner} was stopped", store=False)
        except Exception:
            pass
        raise
    finally:
        try:
            for msg in manager.history:
                if msg.get("id") == ai_id:
                    msg["text"] = full_text
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
    await manager.connect(ws, sub)

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
                    # Main thread typing
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
                        await manager._broadcast_dm_update(sub, peer, {"type": "clear", "thread": "dm", "peer": peer})
                        continue
                    # Admin can toggle AI from within a DM as well
                    if role == "admin" and txt.lower() in ("/ai disable", "/ai enable"):
                        if txt.lower() == "/ai disable":
                            ai_enabled = False
                            await manager._system("AI HAS BEEN DISABLED BY ADMIN", store=False)
                            logger.info("AI disabled by admin %s (DM)", sub)
                        else:
                            ai_enabled = True
                            await manager._system("AI HAS BEEN ENABLED BY ADMIN", store=False)
                            logger.info("AI enabled by admin %s (DM)", sub)
                        continue

                    # @ai in DM: generate AI response within this DM
                    if re.match(r"^@ai\b", txt, re.I):
                        prompt = re.sub(r"^@ai\s*", "", txt, flags=re.I).strip()
                        if not prompt:
                            await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": "USAGE: @AI <PROMPT>"}))
                            continue
                        if not ai_enabled and role != "admin":
                            await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": "@AI IS DISABLED BY ADMIN"}))
                            continue
                        ai_id = f"AI-{int(datetime.utcnow().timestamp()*1000)}"
                        ts0 = datetime.utcnow().isoformat() + "Z"
                        model = TEXT_MODEL
                        # Echo user's prompt into the DM before AI bubble
                        echo_id = f"{sub}-{int(datetime.utcnow().timestamp()*1000)}"
                        echo = {"id": echo_id, "sender": sub, "timestamp": ts0, "type": "message", "text": txt, "thread": "dm", "peer": peer}
                        await manager._broadcast_dm(sub, peer, echo)
                        bubble = {"id": ai_id, "sender": "AI", "timestamp": ts0, "type": "message", "text": "", "model": model, "thread": "dm", "peer": peer}
                        await manager._broadcast_dm(sub, peer, bubble)
                        async def _run_dm_ai():
                            full_text = ""
                            history = manager.get_dm_history(sub, peer)
                            try:
                                async for chunk in stream_ollama(prompt, image_url=None, history=history):
                                    full_text += chunk
                                    try:
                                        await manager._broadcast_dm_update(sub, peer, {"type": "update", "id": ai_id, "text": full_text, "thread": "dm", "peer": peer})
                                    except Exception:
                                        pass
                            except asyncio.CancelledError:
                                raise
                            finally:
                                manager.update_dm_text(sub, peer, ai_id, full_text)
                        task = asyncio.create_task(_run_dm_ai())
                        ai_tasks[ai_id] = {"task": task, "owner": sub}
                        continue

                    # Normal DM send (text/media)
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

            # --- Admin AI toggles ---
            if role == "admin":
                if txt.lower() == "/ai disable":
                    ai_enabled = False
                    await manager._system("AI HAS BEEN DISABLED BY ADMIN", store=False)
                    logger.info("AI disabled by admin %s", sub)
                    continue
                if txt.lower() == "/ai enable":
                    ai_enabled = True
                    await manager._system("AI HAS BEEN ENABLED BY ADMIN", store=False)
                    logger.info("AI enabled by admin %s", sub)
                    continue

            # --- Thread-aware delete (/delete <id>) in Main (admin or author) ---
            if txt.startswith("/delete "):
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
            if role == "admin":
                if txt == "/clear":
                    await _cancel_all_ai()
                    manager.history.clear()
                    try:
                        # Only clear main uploads, keep per-DM folders intact
                        main_dir = os.path.join(UPLOAD_DIR, "main")
                        if os.path.isdir(main_dir):
                            for f in os.listdir(main_dir):
                                fp = os.path.join(main_dir, f)
                                if os.path.isfile(fp):
                                    os.remove(fp)
                                elif os.path.isdir(fp):
                                    shutil.rmtree(fp)
                        # Also clear any legacy top-level files left directly under uploads/
                        for f in os.listdir(UPLOAD_DIR):
                            fp = os.path.join(UPLOAD_DIR, f)
                            if os.path.isfile(fp):
                                os.remove(fp)
                    except Exception as e:
                        print(f"Error clearing uploads: {e}")
                    await manager._system("ADMIN CLEARED THE CHAT")
                    await manager._broadcast({"type": "clear"})
                    continue

                if txt.startswith("/kick"):
                    m = re.match(r"/kick\s+(\w+)", txt)
                    if m:
                        target = m.group(1)
                        if target in manager.active:
                            await manager._system(f"{target} WAS KICKED BY ADMIN", store=False)
                            await manager.active[target].send_text(json.dumps({"type": "alert", "code": "KICKED", "text": "YOU WERE KICKED FROM CHAT"}))
                            await manager.active[target].close()
                            manager.active.pop(target, None)
                            await manager._user_list()
                    continue

                if txt.startswith("/ban"):
                    m = re.match(r"/ban\s+(\w+)", txt)
                    if m:
                        target = m.group(1)
                        if target == "HAZ":
                            await manager._system("CANNOT BAN ADMIN", store=False)
                            continue
                        if target in manager.active:
                            ws_target = manager.active[target]
                            ip_target = ws_target.client.host
                            manager.ban_user(target, ip_target)
                            await manager._system(f"{target} WAS BANNED BY ADMIN", store=False)
                            try:
                                await ws_target.send_text(json.dumps({"type": "alert", "code": "BANNED", "text": "YOU WERE BANNED FROM CHAT"}))
                            except:
                                pass
                            await ws_target.close()
                            manager.active.pop(target, None)
                            await manager._user_list()
                        else:
                            manager.ban_user(target)
                            await manager._system(f"{target} (OFFLINE) WAS BANNED BY ADMIN", store=False)
                    continue

                if txt.startswith("/unban"):
                    m = re.match(r"/unban\s+(\w+)", txt)
                    if m:
                        target = m.group(1)
                        existed = target in manager.banned_users
                        if existed:
                            manager.unban_user(target)
                            await manager._system(f"{target} WAS UNBANNED BY ADMIN", store=False)
                        else:
                            await ws.send_text(json.dumps({"type": "alert", "code": "NOT_BANNED", "text": f"{target} IS NOT BANNED"}))
                    continue

            if txt == "/clear":
                await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": "ONLY ADMIN CAN CLEAR CHAT"}))
                continue

            if not data.get("url") and not txt:
                continue

            # --- DM quick send via command: /dm <user> <text> ---
            if txt.startswith("/dm "):
                m = re.match(r"/dm\s+(\w+)\s+(.+)$", txt)
                if m:
                    peer = m.group(1)
                    dm_text = m.group(2).strip()
                    if peer and peer != sub and dm_text:
                        mid = f"{sub}-{int(datetime.utcnow().timestamp() * 1000)}"
                        ts = now.isoformat() + "Z"
                        msg = {"id": mid, "sender": sub, "timestamp": ts, "type": "message", "text": dm_text, "thread": "dm", "peer": peer}
                        await manager._broadcast_dm(sub, peer, msg)
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

            # --- AI command ---
            if re.match(r"^@ai\b", txt, re.I):
                prompt = re.sub(r"^@ai\s*", "", txt, flags=re.I).strip()
                if not prompt:
                    await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": "USAGE: @AI <PROMPT>"}))
                    continue
                if not ai_enabled and role != "admin":
                    await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": "@AI IS DISABLED BY ADMIN"}))
                    continue
                if data.get("url"):
                    await ws.send_text(json.dumps({"type": "alert", "code": "INFO", "text": "@AI DOESN'T ACCEPT ATTACHMENTS"}))
                    continue

                ai_id = f"AI-{int(datetime.utcnow().timestamp()*1000)}"
                ts0 = datetime.utcnow().isoformat() + "Z"
                model = TEXT_MODEL
                # If this is a DM context (thread: 'dm' + peer), send AI bubble into that DM and stream only to both peers
                if data.get("thread") == "dm" and isinstance(data.get("peer"), str):
                    peer = data.get("peer").strip()
                    if peer and peer != sub:
                        # Echo user's prompt (with @ai visible) into the DM timeline first
                        echo_id = f"{sub}-{int(datetime.utcnow().timestamp()*1000)}"
                        echo = {"id": echo_id, "sender": sub, "timestamp": ts0, "type": "message", "text": txt, "thread": "dm", "peer": peer}
                        await manager._broadcast_dm(sub, peer, echo)

                        bubble = {"id": ai_id, "sender": "AI", "timestamp": ts0, "type": "message", "text": "", "model": model, "thread": "dm", "peer": peer}
                        await manager._broadcast_dm(sub, peer, bubble)
                        async def _run_dm_ai():
                            full_text = ""
                            # use DM history as context
                            history = manager.get_dm_history(sub, peer)
                            try:
                                async for chunk in stream_ollama(prompt, image_url=None, history=history):
                                    full_text += chunk
                                    try:
                                        await manager._broadcast_dm_update(sub, peer, {"type": "update", "id": ai_id, "text": full_text, "thread": "dm", "peer": peer})
                                    except Exception:
                                        pass
                            except asyncio.CancelledError:
                                raise
                            finally:
                                # finalize in stored DM history
                                manager.update_dm_text(sub, peer, ai_id, full_text)
                        task = asyncio.create_task(_run_dm_ai())
                        ai_tasks[ai_id] = {"task": task, "owner": sub}
                        continue
                # Else, seed AI bubble in Main
                # Echo user's prompt (with @ai visible) into Main timeline first
                echo_id = f"{sub}-{int(datetime.utcnow().timestamp()*1000)}"
                await manager._broadcast({"id": echo_id, "sender": sub, "timestamp": ts0, "type": "message", "text": txt, "thread": "main"})
                await manager._broadcast({"id": ai_id, "sender": "AI", "timestamp": ts0, "type": "message", "text": "", "model": model})
                task = asyncio.create_task(_run_ai(ai_id, sub, prompt))
                ai_tasks[ai_id] = {"task": task, "owner": sub}
                continue

            # --- Normal messages / media (Main chat) ---
            mid = f"{sub}-{int(datetime.utcnow().timestamp() * 1000)}"
            ts = now.isoformat() + "Z"
            if "url" in data:
                msg = {"id": mid, "sender": sub, "timestamp": ts, "type": "media", "url": data.get("url"), "mime": data.get("mime"), "text": data.get("text", ""), "thread": "main"}
            else:
                msg = {"id": mid, "sender": sub, "timestamp": ts, "type": "message", "text": txt, "thread": "main"}
            await manager._broadcast(msg)

    except WebSocketDisconnect:
        pass
    finally:
        await manager.disconnect(sub)

