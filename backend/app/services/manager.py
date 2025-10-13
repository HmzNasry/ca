from datetime import datetime, timedelta
import json, os
from typing import Dict, List
from fastapi import WebSocket

HISTORY = 100
BAN_FILE = os.path.join(os.path.dirname(__file__), "..", "banned.json")
BAN_FILE = os.path.abspath(BAN_FILE)

class ConnMgr:
    def __init__(self):
        self.active: Dict[str, WebSocket] = {}
        self.user_ips: Dict[str, str] = {}  # map username -> last seen IP (in-memory)
        self.history: List[dict] = []  # main chat history
        self.dm_histories: Dict[str, List[dict]] = {}  # key: dm_id(userA,userB) -> history list
        # moderation/admin & roles
        self.roles: Dict[str, str] = {}  # username -> role (e.g., 'admin' or 'user')
        self.promoted_admins: set[str] = set()  # runtime-granted admins
        self.demoted_admins: set[str] = set()   # runtime-demoted built-in admins (session only)
        # tagging
        self.tags: Dict[str, dict] = {}  # username -> { text: str, color: str }
        self.tag_rejects: set[str] = set()
        # tag locks: when a user is locked, only DEV can change/remove/set their tag
        self.tag_locks: set[str] = set()
        # mutes
        self.mutes: Dict[str, datetime] = {}
        # per-DM mutes: key = (receiver, sender)
        self.dm_mutes: Dict[tuple[str, str], datetime] = {}
        # bans
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
            # If this is a message/media from 'sender', and 'user' has muted 'sender' in DM, skip delivery
            if base.get("type") in ("message", "media"):
                sender = base.get("sender")
                if sender and self.is_dm_muted(user, sender):
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
    async def connect(self, ws: WebSocket, user: str, role: str = "user"):
        self.active[user] = ws
        # set/refresh role for this session
        self.roles[user] = role or "user"
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
            # Clean up session-scoped demotions/promotions/tags for this user if desired
            # Note: we do not remove tags by default; keep until session end or explicit clear
            await self._user_list()

    def _effective_admins(self) -> List[str]:
        admins: List[str] = []
        for u in self.active.keys():
            base_admin = (self.roles.get(u) == "admin") and (u not in self.demoted_admins)
            promoted = u in self.promoted_admins
            if base_admin or promoted:
                admins.append(u)
        return admins

    async def _user_list(self):
        payload = {"type": "user_list", "users": list(self.active.keys())}
        # include admins and tags to support richer clients (ignored by older clients)
        payload["admins"] = self._effective_admins()
        payload["tags"] = self.tags
        await self._broadcast(payload)

    async def _system(self, text: str, store: bool = True):
        # Capitalize first letter of system messages
        try:
            s_raw = (text or "").strip()
            s = (s_raw[:1].upper() + s_raw[1:]) if s_raw else s_raw
        except Exception:
            s = text
        msg = {
            "id": f"system-{int(datetime.utcnow().timestamp()*1000)}",
            "sender": "SYSTEM",
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "type": "system",
            "text": s,
        }
        if store:
            self.history.append(msg)
            if len(self.history) > HISTORY:
                self.history = self.history[-HISTORY:]
        await self._broadcast(msg)

    async def _broadcast(self, obj: dict):
        # Persist only main thread user messages/media in history
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

    # ---- mute helpers ----
    def mute_user(self, username: str, minutes: int):
        try:
            mins = max(int(minutes), 0)
        except Exception:
            mins = 0
        until = datetime.utcnow() + timedelta(minutes=mins)
        self.mutes[username] = until

    def unmute_user(self, username: str):
        self.mutes.pop(username, None)

    def is_muted(self, username: str) -> bool:
        until = self.mutes.get(username)
        if not until:
            return False
        if datetime.utcnow() >= until:
            # expired
            self.mutes.pop(username, None)
            return False
        return True

    def remaining_mute_seconds(self, username: str) -> int:
        until = self.mutes.get(username)
        if not until:
            return 0
        delta = (until - datetime.utcnow()).total_seconds()
        return max(int(delta), 0)

    # ---- per-DM mute helpers (receiver mutes sender) ----
    def mute_dm(self, receiver: str, sender: str, minutes: int):
        try:
            mins = max(int(minutes), 0)
        except Exception:
            mins = 0
        until = datetime.utcnow() + timedelta(minutes=mins)
        self.dm_mutes[(receiver, sender)] = until

    def unmute_dm(self, receiver: str, sender: str):
        self.dm_mutes.pop((receiver, sender), None)

    def is_dm_muted(self, receiver: str, sender: str) -> bool:
        until = self.dm_mutes.get((receiver, sender))
        if not until:
            return False
        if datetime.utcnow() >= until:
            self.dm_mutes.pop((receiver, sender), None)
            return False
        return True

    def remaining_dm_mute_seconds(self, receiver: str, sender: str) -> int:
        until = self.dm_mutes.get((receiver, sender))
        if not until:
            return 0
        delta = (until - datetime.utcnow()).total_seconds()
        return max(int(delta), 0)
