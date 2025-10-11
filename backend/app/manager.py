from datetime import datetime
import json, os
from typing import Dict, List
from fastapi import WebSocket

HISTORY = 100
BAN_FILE = os.path.join(os.path.dirname(__file__), "banned.json")

class ConnMgr:
    def __init__(self):
        self.active: Dict[str, WebSocket] = {}
        self.user_ips: Dict[str, str] = {}  # map username -> last seen IP (in-memory)
        self.history: List[dict] = []  # main chat history
        self.dm_histories: Dict[str, List[dict]] = {}  # key: dm_id(userA,userB) -> history list
        self.banned_users: set[str] = set()
        self.banned_ips: set[str] = set()
        self._load_bans()

    # --- DM helpers ---
    def dm_id(self, a: str, b: str) -> str:
        return "::".join(sorted([a, b]))

    def get_dm_history(self, a: str, b: str) -> List[dict]:
        tid = self.dm_id(a, b)
        return list(self.dm_histories.get(tid, []))

    def _append_dm(self, a: str, b: str, obj: dict):
        tid = self.dm_id(a, b)
        hist = self.dm_histories.setdefault(tid, [])
        hist.append(obj)
        if len(hist) > HISTORY:
            self.dm_histories[tid] = hist[-HISTORY:]

    def update_dm_text(self, a: str, b: str, msg_id: str, text: str) -> bool:
        """Update text of a DM message in-place in the canonical stored history."""
        tid = self.dm_id(a, b)
        arr = self.dm_histories.get(tid)
        if not arr:
            return False
        for m in arr:
            if m.get("id") == msg_id:
                m["text"] = text
                return True
        return False

    async def _broadcast_dm(self, a: str, b: str, obj: dict):
        # Store canonical copy
        base = dict(obj)
        base.setdefault("thread", "dm")
        base.pop("peer", None)
        self._append_dm(a, b, base)
        # Send personalized payloads with peer=other
        for user, other in ((a, b), (b, a)):
            ws = self.active.get(user)
            if not ws:
                continue
            payload = dict(base)
            payload["peer"] = other
            try:
                await ws.send_text(json.dumps(payload))
            except:
                pass

    async def _broadcast_dm_update(self, a: str, b: str, obj: dict):
        # Do not persist; just send update to both with proper peer field
        base = dict(obj)
        base.setdefault("thread", "dm")
        base.pop("peer", None)
        for user, other in ((a, b), (b, a)):
            ws = self.active.get(user)
            if not ws:
                continue
            payload = dict(base)
            payload["peer"] = other
            try:
                await ws.send_text(json.dumps(payload))
            except:
                pass

    # New: delete helpers
    def delete_main_message(self, msg_id: str) -> bool:
        idx = next((i for i, m in enumerate(self.history) if m.get("id") == msg_id), None)
        if idx is None:
            return False
        self.history.pop(idx)
        return True

    def delete_dm_message(self, a: str, b: str, msg_id: str, requester: str | None = None, allow_any: bool = False) -> bool:
        tid = self.dm_id(a, b)
        arr = self.dm_histories.get(tid)
        if not arr:
            return False
        idx = next((i for i, m in enumerate(arr) if m.get("id") == msg_id), None)
        if idx is None:
            return False
        if not allow_any and requester and arr[idx].get("sender") != requester:
            return False
        arr.pop(idx)
        return True

    def clear_dm_history(self, a: str, b: str):
        tid = self.dm_id(a, b)
        self.dm_histories[tid] = []

    # --- presence (join/leave) ---
    async def _presence(self, user: str, action: str):
        # action: "join" | "leave"; not stored in history
        await self._broadcast({"type": "presence", "user": user, "action": action})

    # --- persistence ---
    def _load_bans(self):
        if os.path.exists(BAN_FILE):
            try:
                with open(BAN_FILE, "r") as f:
                    data = json.load(f)
                    self.banned_users = set(data.get("users", []))
                    self.banned_ips = set(data.get("ips", []))
                    # Only load mapping for banned users to avoid noise
                    stored_map = (data.get("user_ips", {}) or {})
                    self.user_ips.update({u: ip for u, ip in stored_map.items() if u in self.banned_users})
            except Exception as e:
                print("Failed to load ban list:", e)

    def _save_bans(self):
        # Persist only mappings for currently banned users
        filtered_map = {u: self.user_ips.get(u) for u in self.banned_users if self.user_ips.get(u)}
        data = {
            "users": list(self.banned_users),
            "ips": list(self.banned_ips),
            "user_ips": filtered_map,
        }
        try:
            with open(BAN_FILE, "w") as f:
                json.dump(data, f, indent=2)
        except Exception as e:
            print("Failed to save ban list:", e)

    # --- connection logic ---
    async def connect(self, ws: WebSocket, user: str):
        self.active[user] = ws
        # record latest IP for the user (in-memory); persist only for banned users
        try:
            ip = ws.client.host
            if ip:
                self.user_ips[user] = ip
                # Do not persist non-banned users to banned.json
                self._save_bans()
        except Exception:
            pass
        await ws.send_text(json.dumps({"type": "history", "items": self.history}))
        # Presence event (no SYSTEM message)
        await self._presence(user, "join")
        await self._user_list()

    async def disconnect(self, user: str):
        if user in self.active:
            self.active.pop(user)
            # Presence event (no SYSTEM message)
            await self._presence(user, "leave")
            await self._user_list()

    async def _user_list(self):
        await self._broadcast({"type": "user_list", "users": list(self.active.keys())})

    async def _system(self, text: str, store: bool = True):
        msg = {
            "id": f"system-{int(datetime.utcnow().timestamp()*1000)}",
            "sender": "SYSTEM",
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "type": "message",
            "text": text,
        }
        if store:
            self.history.append(msg)
            if len(self.history) > HISTORY:
                self.history = self.history[-HISTORY:]
        await self._broadcast(msg)

    async def _broadcast(self, obj: dict):
        if obj.get("type") in ("message", "media") and obj.get("sender") != "SYSTEM" and obj.get("thread", "main") == "main":
            self.history.append(obj)
            if len(self.history) > HISTORY:
                self.history = self.history[-HISTORY:]
        data = json.dumps(obj)
        for ws in list(self.active.values()):
            try:
                await ws.send_text(data)
            except:
                pass

    # ---- helpers for ban/unban ----
    def ban_user(self, username: str, ip: str | None = None):
        self.banned_users.add(username)
        ip_to_add = ip or self.user_ips.get(username)
        if ip_to_add:
            self.banned_ips.add(ip_to_add)
            self.user_ips[username] = ip_to_add
        self._save_bans()

    def unban_user(self, username: str):
        if username in self.banned_users:
            self.banned_users.remove(username)
        # remove IP if known in mapping
        ip = self.user_ips.get(username)
        if ip and ip in self.banned_ips:
            self.banned_ips.remove(ip)
        # also remove stored mapping entry so it doesn't linger
        self.user_ips.pop(username, None)
        self._save_bans()

