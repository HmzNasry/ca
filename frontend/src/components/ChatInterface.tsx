import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import TextareaAutosize from "react-textarea-autosize";
import { Paperclip, Send, Loader2, Smile, Trash2, ChevronDown, Ban, LogOut, Pencil, CornerDownLeft, MoreHorizontal, X } from "lucide-react";
import EmojiPicker, { Theme as EmojiTheme } from "emoji-picker-react";
import EmojiConvertor from "emoji-js";
import AlertModal from "@/components/AlertModal";

import * as api from "@/services/api";
import Sidebar from "./Sidebar";
import EmojiPanel from "./EmojiPanel";
import AttachmentPreview from "./AttachmentPreview";
import CreateGcModal from "./modals/CreateGcModal";
import GcSettingsModal from "./modals/GcSettingsModal";
import TagModal from "./modals/TagModal";
import KickBanModal from "./modals/KickBanModal";
import UnbanModal from "./modals/UnbanModal";
import AdminRoleModal from "./modals/AdminRoleModal";
import ConfirmModal from "./modals/ConfirmModal";
import MuteModal from "./modals/MuteModal";
import UnmuteModal from "./modals/UnmuteModal";
import RemoveTagModal from "./modals/RemoveTagModal";
import TagLockModal from "./modals/TagLockModal";
import SpotifyPreview from "./SpotifyPreview";
import YouTubePreview from "./YouTubePreview";
import PsaModal from "./modals/PsaModal";
import PassModal from "./modals/PassModal";
import MuteAllModal from "./modals/MuteAllModal";
import UsersModal from "./modals/UsersModal";
import ResetModal from "./modals/ResetModal";
import AccountModal from "./modals/AccountModal";
import AdminAccountModal from "./modals/AdminAccountModal";
import PollModal from "./modals/PollModal";

export function ChatInterface({ token, onLogout }: { token: string; onLogout: () => void }) {
  
  // Helper to fully log out and clear username
  const fullLogout = useCallback(() => {
    try {
      localStorage.removeItem("chat-username");
      localStorage.removeItem("chat-login-error");
      document.cookie = "chat-username=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
    } catch {}
    onLogout();
  }, [onLogout]);
  const [me, setMe] = useState("");
  const [role, setRole] = useState("");
  const [users, setUsers] = useState<string[]>([]);
  const [admins, setAdmins] = useState<string[]>([]);
  const [tagsMap, setTagsMap] = useState<Record<string, any>>({});
  const [tagLocks, setTagLocks] = useState<Set<string>>(new Set());
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [sidebar, setSidebar] = useState(true);
  const [showPicker, setShowPicker] = useState(false);
  // DM/thread prep state
  const [activeDm, setActiveDm] = useState<string | null>(null); // null = Main Chat, otherwise username
  // Group Chats (GC) state
  type GC = { id: string; name: string; creator: string; members: string[] };
  const [gcs, setGcs] = useState<GC[]>([]);
  const [activeGc, setActiveGc] = useState<string | null>(null);
  const [unreadMain, setUnreadMain] = useState(0); // mention pings in Main when not viewing it
  const [unreadDm, setUnreadDm] = useState<Record<string, number>>({}); // future DM pings per user
  const [unreadGc, setUnreadGc] = useState<Record<string, number>>({});
  const [blockedDm, setBlockedDm] = useState<Record<string, boolean>>({});
  // typing indicator state
  const [typingUser, setTypingUser] = useState("");
  const [typingVisible, setTypingVisible] = useState(false);
  // alert modal state
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertText, setAlertText] = useState("");
  const [alertButton, setAlertButton] = useState<string | undefined>("OK");
  const alertActionRef = useRef<(() => void) | null>(null);
  const muteIntervalRef = useRef<number | null>(null);
  const [makeGcOpen, setMakeGcOpen] = useState(false);
  const [gcSettingsOpen, setGcSettingsOpen] = useState(false);
  const [tagOpen, setTagOpen] = useState(false);
  const [kickOpen, setKickOpen] = useState(false);
  const [banOpen, setBanOpen] = useState(false);
  const [adminRoleOpen, setAdminRoleOpen] = useState(false);
  const [adminRoleMode, setAdminRoleMode] = useState<"mkadmin" | "rmadmin">("mkadmin");
  const [purgeConfirmOpen, setPurgeConfirmOpen] = useState(false);
  const [muteOpen, setMuteOpen] = useState(false);
  const [unbanOpen, setUnbanOpen] = useState(false);
  const [bannedList, setBannedList] = useState<string[]>([]);
  const [unmuteOpen, setUnmuteOpen] = useState(false);
  const [mutedList, setMutedList] = useState<string[]>([]);
  const [rmtagOpen, setRmtagOpen] = useState(false);
  const [lockOpen, setLockOpen] = useState(false);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [psaOpen, setPsaOpen] = useState(false);
  const [passOpen, setPassOpen] = useState(false);
  const [kickAllConfirm, setKickAllConfirm] = useState(false);
  const [unmuteAllConfirm, setUnmuteAllConfirm] = useState(false);
  const [muteAllOpen, setMuteAllOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [clearMainConfirm, setClearMainConfirm] = useState(false);
  const [clearGcConfirm, setClearGcConfirm] = useState(false);
  const [usersRegOpen, setUsersRegOpen] = useState(false);
  const [usersRegList, setUsersRegList] = useState<string[]>([]);
  const [adminAcctOpen, setAdminAcctOpen] = useState(false);
  const [adminAcctUser, setAdminAcctUser] = useState<string | null>(null);
  const [pollOpen, setPollOpen] = useState(false);
  // New: reply / edit state
  const [replyTo, setReplyTo] = useState<{ id: string; sender: string; text: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState<string>("");
  const [reactionPickerFor, setReactionPickerFor] = useState<string | null>(null);
  // Track recent edits to reconcile servers that re-emit edits as new messages
  const recentEditsRef = useRef<Array<{ oldId: string; sender: string; text: string; threadKey: string; time: number }>>([]);

  // Re-added foundational refs required for thread context, scrolling, and socket interaction.
  const ws = useRef<WebSocket | null>(null);
  const txtRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const activeDmRef = useRef<string | null>(null);
  const activeGcRef = useRef<string | null>(null);
  const seen = useRef<Set<string>>(new Set());

  // Time formatter (24h HH:MM) used in message headers
  const fmtTime = useCallback((iso?: string) => {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      const h = d.getHours().toString().padStart(2, '0');
      const m = d.getMinutes().toString().padStart(2, '0');
      return `${h}:${m}`;
    } catch { return ""; }
  }, []);

  // Reaction picker close helper
  const closeReactionPicker = useCallback(() => {
    setReactionPickerFor(null);
    setReactionPickerPos(null);
  }, []);

  // Normalize text for robust edit reconciliation (collapse whitespace, trim)
  const normText = (s?: string) => {
    if (typeof s !== 'string') return '';
    return s
      .replace(/[\u200B-\u200D\uFEFF]/g, '') // zero-width chars
      .replace(/\s+/g, ' ') // collapse whitespace/newlines
      .trim();
  };
  const textsMatch = (a?: string, b?: string) => {
    const na = normText(a); const nb = normText(b);
    if (!na || !nb) return false;
    if (na === nb) return true;
    const shorter = na.length < nb.length ? na : nb;
    const longer = na.length < nb.length ? nb : na;
    const ratio = shorter.length / Math.max(longer.length, 1);
    return (ratio >= 0.8) && (longer.includes(shorter));
  };

  // Shorten helper for reply preview with explicit ellipsis
  const shortenReply = (s?: string, mobileMax = 28, desktopMax = 42) => {
    const t = (s || '').replace(/\s+/g, ' ').trim();
    const max = (typeof window !== 'undefined' ? (window.innerWidth < 640) : false) ? mobileMax : desktopMax;
    if (t.length <= max) return t;
    return t.slice(0, Math.max(0, max - 1)) + '…';
  };
  // Absolute overlay position for emoji picker
  const [reactionPickerPos, setReactionPickerPos] = useState<{ top: number; left: number } | null>(null);
  // Mobile: per-message action tray toggler
  const [showTrayFor, setShowTrayFor] = useState<string | null>(null);
  // Close action tray when clicking anywhere outside or pressing Escape
  useEffect(() => {
    if (!showTrayFor) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (!t.closest('.msg-tray') && !t.closest('.msg-dots')) {
        setShowTrayFor(null);
      }
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowTrayFor(null); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('touchstart', onDown, { passive: true } as any);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('touchstart', onDown as any);
      window.removeEventListener('keydown', onKey);
    };
  }, [showTrayFor]);
  // Helper: ensure messages list has unique ids (keep last occurrence)
  const uniqueById = useCallback((arr: any[]) => {
    const seenIds = new Set<string>();
    const out: any[] = [];
    for (let i = arr.length - 1; i >= 0; i--) {
      const it = arr[i];
      try {
        const sid = it && it.id != null ? String(it.id) : '';
        if (sid) {
          if (seenIds.has(sid)) continue;
          seenIds.add(sid);
        }
      } catch {}
      out.push(it);
    }
    return out.reverse();
  }, []);

  const openReactionPicker = (e: React.MouseEvent, mid: string) => {
    try {
      const W = 280, H = 380, pad = 8;
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const preferredTop = rect.top - H - 8;
      const top = preferredTop >= pad ? preferredTop : Math.min(window.innerHeight - H - pad, rect.bottom + 8);
      const leftCenter = rect.left + rect.width / 2 - W / 2;
      const left = Math.min(Math.max(leftCenter, pad), window.innerWidth - W - pad);
      setReactionPickerPos({ top, left });
      setReactionPickerFor(mid);
    } catch {}
  };

  useEffect(() => { activeGcRef.current = activeGc; }, [activeGc]);
  useEffect(() => { activeDmRef.current = activeDm; }, [activeDm]);
  // Track ids received from initial history to avoid flashing old mentions
  const historyIdsRef = useRef<Set<string>>(new Set());
  // timers for typing indicator
  const typingStopTimer = useRef<number | null>(null);
  const typingHideTimer = useRef<number | null>(null);
  const typingUserRef = useRef<string>("");
  // Throttle AI streaming updates so UI remains responsive
  const aiPendingRef = useRef<Record<string, string>>({});
  const aiUpdateTimer = useRef<number | null>(null);
  // Cache off-thread updates to apply on next history load for that thread
  const pendingTextUpdatesRef = useRef<Record<string, Record<string, { text: string; edited?: boolean }>>>({});
  const pendingReactionUpdatesRef = useRef<Record<string, Record<string, { reactions: Record<string, string[]> }>>>({});

  // Track message DOM nodes and flashing state for mention alerts
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const observerRef = useRef<IntersectionObserver | null>(null);
  const timeoutRefs = useRef<Record<string, number>>({});
  const flashedRef = useRef<Set<string>>(new Set());
  const [flashMap, setFlashMap] = useState<Record<string, boolean>>({});
  const fallbackFlashRefs = useRef<Record<string, number>>({});
  // Chat scroll container (use as IntersectionObserver root)
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll management
  const [isAtBottom, setIsAtBottom] = useState(true);
  const isAtBottomRef = useRef(true);
  const forceScrollRef = useRef(false);

  // NEW: ResizeObserver to handle scrolling on content changes (e.g. images loading)
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      if (isAtBottomRef.current) {
        bottomRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
      }
    });
    if (messageListRef.current) {
      observer.observe(messageListRef.current);
    }
    return () => observer.disconnect();
  }, []);

  // Active mention targets: online users + 'ai'
  const activeMentions = useMemo(() => {
    const s = new Set<string>(["ai", "everyone"]);
    users.forEach(u => s.add(u.toLowerCase()));
    return s;
  }, [users]);

  // Emoji shortcode support (:joy: -> 😀)
  const emoji = useMemo(() => {
    const e = new (EmojiConvertor as any)();
    try { e.replace_mode = "unified"; e.allow_native = true; } catch {}
    return e;
  }, []);

  const isAdmin = admins.includes(me) || role === "admin";
  // DEV detection: only explicit special==='dev' confers DEV powers; rainbow color or 'DEV' text alone do not
  const myTagVal = (tagsMap as any)[me];
  const myTagObj = typeof myTagVal === 'string' ? { text: myTagVal, color: 'white' } : (myTagVal || null);
  const isDevMe = !!(myTagObj && (myTagObj as any).special === 'dev');
  const isAdminEffective = isAdmin || isDevMe;
  const full = (url: string) => (url.startsWith("/") ? location.origin + url : url);

  // Ask for notification permission on mount
  useEffect(() => {
    try {
      if (Notification && Notification.permission === "default") {
        Notification.requestPermission().catch(() => {});
      }
    } catch {}
  }, []);

  // Mention detection helper (extracted from corrupted block) – stable across renders
  const mentionsMe = useCallback((text: string) => {
    if (!me) return false;
    const meEsc = me.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
    // Match @me (word-bounded) or @"me" (quoted)
    const rePlain = new RegExp(`(^|\\s|[^\\w])@${meEsc}(?![\\w])`, "i");
    const reQuoted = new RegExp(`@"\\s*${meEsc}\\s*"`, "i");
    const everyone = /(^|\s|[^\w])@everyone(?![\w])/i.test(text) || /@"\s*everyone\s*"/i.test(text);
    return everyone || rePlain.test(text) || reQuoted.test(text);
  }, [me]);

  // Helper: map color name to Tailwind class
  const colorClass = useCallback((c?: string) => {
    switch ((c || "white").toLowerCase()) {
      case "red": return "text-red-500";
      case "green": return "text-green-500";
      case "blue": return "text-blue-400";
      case "pink": return "text-pink-400";
      case "yellow": return "text-yellow-400";
      case "white": return "text-white";
      case "cyan": return "text-cyan-400";
      case "purple": return "text-purple-400";
      case "violet": return "text-violet-400";
      case "indigo": return "text-indigo-400";
      case "teal": return "text-teal-400";
      case "lime": return "text-lime-400";
      case "amber": return "text-amber-400";
      case "emerald": return "text-emerald-400";
      case "fuchsia": return "text-fuchsia-400";
      case "sky": return "text-sky-400";
      case "gray": return "text-gray-400";
      default: return "text-white";
    }
  }, []);

  // Start flashing for new messages that mention me (not my own)
  useEffect(() => {
    if (!me) return;
    const toFlash: Record<string, boolean> = {};
    messages.forEach((m) => {
      if (!m || !m.id) return;
      if ((m.type === "message" || m.type === "media") && m.sender !== me) {
        const t = (m.text || "");
        if (mentionsMe(t) && !flashMap[m.id] && !historyIdsRef.current.has(m.id) && !flashedRef.current.has(m.id)) {
          toFlash[m.id] = true;
        }
      }
    });
    if (Object.keys(toFlash).length) {
      setFlashMap(prev => ({ ...prev, ...toFlash }));
      // Fallback: stop flashing automatically after 6s even if not intersecting
      Object.keys(toFlash).forEach(id => {
        if (fallbackFlashRefs.current[id]) return;
        const tid = window.setTimeout(() => {
          // mark as flashed so it never restarts
          flashedRef.current.add(id);
          setFlashMap(prev => {
            if (!prev[id]) return prev;
            const copy = { ...prev } as Record<string, boolean>;
            delete copy[id];
            return copy;
          });
          delete fallbackFlashRefs.current[id];
        }, 6000);
        fallbackFlashRefs.current[id] = tid;
      });
    }
  }, [messages, me, mentionsMe]);

  // Observe flashing messages within the chat scroller and stop after 2s once sufficiently in view
  useEffect(() => {
    // Lazily (re)create the observer when needed and the scroller is mounted
    if (!observerRef.current && chatScrollRef.current) {
      observerRef.current = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          const el = entry.target as HTMLDivElement;
          const id = (el.dataset && (el.dataset as any).mid) || "";
          if (!id) return;
          if (entry.isIntersecting && flashMap[id] && !flashedRef.current.has(id)) {
            flashedRef.current.add(id);
            const t = window.setTimeout(() => {
              setFlashMap(prev => {
                const copy = { ...prev } as Record<string, boolean>;
                delete copy[id];
                return copy;
              });
              try { observerRef.current?.unobserve(el); } catch {}
            }, 2000);
            timeoutRefs.current[id] = t;
          }
        });
      }, { root: chatScrollRef.current, threshold: 0.5 });
    }

    const obs = observerRef.current;
    if (!obs) return;

    // Observe/unobserve based on current flashing set
    Object.keys(flashMap).forEach(id => {
      const el = messageRefs.current[id];
      if (!el) return;
      try { flashMap[id] ? obs.observe(el) : obs.unobserve(el); } catch {}
    });

    return () => {
      // Do not disconnect here to preserve the observer between renders
    };
  }, [flashMap, chatScrollRef.current]);

  // Track scroll position to only auto-scroll when at bottom
  useEffect(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const at = el.scrollHeight - el.scrollTop - el.clientHeight <= 24;
      if (isAtBottomRef.current !== at) {
        isAtBottomRef.current = at;
        setIsAtBottom(at);
      }
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    // initialize
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Disconnect observer and clear timers on unmount
  useEffect(() => () => {
    Object.values(timeoutRefs.current).forEach(t => window.clearTimeout(t));
    Object.values(fallbackFlashRefs.current).forEach(t => window.clearTimeout(t));
    try { observerRef.current?.disconnect(); } catch {}
  }, []);

  // Track users in a ref for case-preserving normalization
  const usersRef = useRef<string[]>([]);
  useEffect(() => { usersRef.current = users; }, [users]);
  // Track latest GCs in a ref for invite detection inside ws.onmessage
  const gcsRef = useRef<GC[]>([]);
  useEffect(() => { gcsRef.current = gcs; }, [gcs]);

  // Auto-collapse sidebar on small screens and keep it in sync on resize
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (ws.current && ws.current.readyState === WebSocket.OPEN) {
        if (document.hidden) {
          ws.current.send(JSON.stringify({ type: "activity", active: false }));
        } else {
          ws.current.send(JSON.stringify({ type: "activity", active: true }));
        }
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (ws.current && ws.current.readyState === WebSocket.OPEN) {
        if (document.hidden) {
          ws.current.send(JSON.stringify({ type: "activity", active: false }));
        } else {
          ws.current.send(JSON.stringify({ type: "activity", active: true }));
        }
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  

  useEffect(() => {
    const sync = () => setSidebar(window.innerWidth >= 1024);
    sync();
    const onResize = () => {
      const shouldOpen = window.innerWidth >= 1024;
      setSidebar(prev => (prev === shouldOpen ? prev : shouldOpen));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      if (ws.current && ws.current.readyState === WebSocket.OPEN) {
        const t0 = Date.now();
        ws.current.send(JSON.stringify({ type: "ping", timestamp: t0 }));
      }
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const payload = JSON.parse(atob(token.split(".")[1]));
    setMe(payload.sub);
    setRole(payload.role || "user");
    const currentUser = payload.sub;

    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws.current = new WebSocket(`${proto}://${location.host}/ws/${token}`);

    ws.current.onmessage = e => {
      const d = JSON.parse(e.data);
      // central alerts (private modal only, do not append to chat)
      if (d.type === "alert") {
        const code = String(d.code || "");
        // Special handling: MUTED with live countdown
        if (code === "MUTED") {
          let s = Number(d.seconds || 0) || 0;
          if (muteIntervalRef.current) { window.clearInterval(muteIntervalRef.current); muteIntervalRef.current = null; }
          const update = () => {
            const mm = Math.floor(s / 60).toString().padStart(2, "0");
            const ss = Math.floor(s % 60).toString().padStart(2, "0");
            setAlertText(`You are muted. Time left: ${mm}:${ss}`);
            setAlertButton("OK");
            setAlertOpen(true);
          };
          alertActionRef.current = () => {
            if (muteIntervalRef.current) { window.clearInterval(muteIntervalRef.current); muteIntervalRef.current = null; }
          };
          update();
          muteIntervalRef.current = window.setInterval(() => {
            s -= 1;
            if (s <= 0) {
              if (muteIntervalRef.current) { window.clearInterval(muteIntervalRef.current); muteIntervalRef.current = null; }
              setAlertOpen(false);
            } else {
              update();
            }
          }, 1000);
          return;
        }
        if (code === "DM_BLOCKED") {
          setBlockedDm(prev => ({ ...prev, [activeDmRef.current || ""]: true }));
          return;
        }
        if (code === "DM_UNBLOCKED") {
          setBlockedDm(prev => ({ ...prev, [activeDmRef.current || ""]: false }));
          return;
        }
  const textRaw2 = d.text || "";
  const t2 = (textRaw2 || "").trim().replace(/[.]+$/, "");
  const text = t2 ? t2[0].toUpperCase() + t2.slice(1) : t2;
        const shouldLogout = code === "KICKED" || code === "BANNED" || code === "BANNED_CONNECT" || code === "DUPLICATE" || code === "ACCOUNT_DELETED" || code === "REMOVED" || code === "RESET";
        if (code === "DUPLICATE") {
          try {
            localStorage.removeItem("chat-username");
            localStorage.setItem("chat-login-error", "Username already online. Pick a different name.");
          } catch {}
        }
        if (code === "ACCOUNT_DELETED" || code === "REMOVED") {
          try { localStorage.removeItem("chat-username"); } catch {}
        }
        if (code === "RESET") {
          try {
            localStorage.removeItem("chat-username");
          } catch {}
        }
        showAlert(text, shouldLogout ? () => onLogout() : undefined);
        return;
      }

      // Group chat lists
      if (d.type === "gc_list" && Array.isArray(d.gcs)) {
        // Detect new GCs and schedule an invite toast when sidebar is collapsed
        try {
          const incoming = d.gcs as GC[];
          const prevIds = new Set(gcsRef.current.map(g => g.id));
          const newOnes = incoming.filter(g => !prevIds.has(g.id));
          if (newOnes.length > 0) {
            const newest = newOnes[newOnes.length - 1];
            scheduleGcInviteToast(newest.id, newest.name || 'Group');
          }
          // If currently viewing a GC that is no longer in the list (left or deleted), exit it
          const active = activeGcRef.current;
          if (active && !incoming.some(g => g.id === active)) {
            setActiveGc(null);
            setActiveDm(null);
            try { ws.current?.send(JSON.stringify({ type: 'history_request' })); } catch {}
          }
        } catch {}
        setGcs(d.gcs as GC[]);
        return;
      }
      // Unban prompt from server
      if (d.type === "unban_prompt" && Array.isArray(d.banned)) {
        setBannedList(d.banned);
        setUnbanOpen(true);
        return;
      }
      // Unmute prompt from server
      if (d.type === "unmute_prompt" && Array.isArray(d.muted)) {
        setMutedList(d.muted);
        setUnmuteOpen(true);
        return;
      }
      // Users registry prompt (DEV)
      if (d.type === "users_prompt" && Array.isArray(d.users)) {
        setUsersRegList(d.users);
        setUsersRegOpen(true);
        return;
      }
      if (d.type === "poll_prompt") {
        setPollOpen(true);
        return;
      }
      // Reset prompt (DEV)
      if (d.type === "reset_prompt") {
        setResetOpen(true);
        return;
      }
      if (d.type === "gc_prompt") {
        setMakeGcOpen(true);
        return;
      }

      // Helper: reconcile history on load using recent edits (avoid old+new duplicates after thread switch)
      const reconcileOnLoad = (items: any[], tk: string) => {
        try {
          const out: any[] = [];
          const byId = new Map<string, any>();
          // First pass: keep in arrival order, collapse by id
          for (const it of items || []) {
            const sid = it && it.id != null ? String(it.id) : '';
            if (sid && !byId.has(sid)) {
              byId.set(sid, { ...it });
            } else if (!sid) {
              out.push({ ...it });
            }
          }
          let base = [...out, ...Array.from(byId.values())];

          // Apply any pending off-thread updates that were cached for this thread
          try {
            const textUpdates = pendingTextUpdatesRef.current[tk];
            if (textUpdates) {
              base = base.map(m => {
                const sid = m && m.id != null ? String(m.id) : '';
                if (!sid) return m;
                const upd = textUpdates[sid];
                if (!upd) return m;
                return { ...m, text: upd.text ?? m.text, edited: upd.edited ?? m.edited };
              });
              delete pendingTextUpdatesRef.current[tk];
            }

            const reactionUpdates = pendingReactionUpdatesRef.current[tk];
            if (reactionUpdates) {
              base = base.map(m => {
                const sid = m && m.id != null ? String(m.id) : '';
                if (!sid) return m;
                const upd = reactionUpdates[sid];
                if (!upd) return m;
                // Deep merge reactions
                const mergedReactions = { ...(m.reactions || {}) };
                for (const emoji in upd.reactions) {
                  const newUsers = new Set(mergedReactions[emoji] || []);
                  for (const user of upd.reactions[emoji]) {
                    newUsers.add(user);
                  }
                  mergedReactions[emoji] = Array.from(newUsers).sort();
                }
                return { ...m, reactions: mergedReactions };
              });
              delete pendingReactionUpdatesRef.current[tk];
            }
          } catch {}

          // Second pass: apply recent edit mapping in this thread, preferring edited=true content
          const edits = (recentEditsRef.current || []).filter(e => e.threadKey === tk && (Date.now() - e.time) < 30000);
          for (const e of edits) {
            // Find a candidate message whose text matches the edited text and from same sender
            const idx = base.findIndex(m => m && typeof m.text === 'string' && textsMatch(m.text, e.text));
            if (idx !== -1) {
              const cand = base[idx];
              const oldIdx = base.findIndex(m => m && String(m.id) === String(e.oldId));
              if (oldIdx !== -1) {
                // Merge onto existing original-id entry
                const merged = { ...base[oldIdx], ...cand, id: e.oldId, edited: true } as any;
                // Merge reactions if both present
                try {
                  const r1 = base[oldIdx]?.reactions || {};
                  const r2 = cand?.reactions || {};
                  const keys = new Set([...Object.keys(r1), ...Object.keys(r2)]);
                  const rr: any = {};
                  keys.forEach(k => {
                    const a = new Set<string>(r1[k] || []);
                    (r2[k] || []).forEach((u: string) => a.add(u));
                    if (a.size) rr[k] = Array.from(a).sort();
                  });
                  merged.reactions = rr;
                } catch {}
                base[oldIdx] = merged;
                base.splice(idx, 1);
              } else {
                // No original present: rewrite id to oldId so future updates match
                base[idx] = { ...cand, id: e.oldId, edited: true } as any;
              }
            }
          }

          return uniqueById(base);
        } catch {
          return items || [];
        }
      };

      // GC history
      if (d.type === "gc_history" && Array.isArray(d.items)) {
        const tk = d.gcid ? `gc:${d.gcid}` : 'gc:unknown';
        const rec = reconcileOnLoad(d.items, tk);
        seen.current.clear();
        rec.forEach((x: any) => x?.id && seen.current.add(String(x.id)));
        historyIdsRef.current = new Set((rec || []).map((x: any) => x && String(x.id)).filter(Boolean));
        forceScrollRef.current = true; // scroll to latest
        return setMessages(rec);
      }

      if (d.type === "gc_created" && typeof d.gcid === 'string') {
        // Switch to the newly created GC
        setActiveDm(null);
        setActiveGc(d.gcid);
        try { ws.current?.send(JSON.stringify({ type: 'gc_history', gcid: d.gcid })); } catch {}
        return;
      }

      if (d.type === 'gc_settings' && typeof d.gcid === 'string') {
        // Update GC name locally
        setGcs(prev => prev.map(gc => gc.id === d.gcid ? { ...gc, name: (typeof d.name === 'string' ? d.name : gc.name) } : gc));
        return;
      }

      if (d.type === "gc_deleted" && typeof d.gcid === 'string') {
        if (activeGcRef.current === d.gcid) {
          setActiveGc(null);
          setActiveDm(null);
          try { ws.current?.send(JSON.stringify({ type: 'history_request' })); } catch {}
        }
        setGcs(prev => prev.filter(gc => gc.id !== d.gcid));
        return;
      }

      // Presence events (join/leave): show in correct GC, not in main thread
      if (d.type === "gc_member_joined" && typeof d.user === "string" && typeof d.gcid === "string") {
        const gc = gcsRef.current.find(g => g.id === d.gcid);
        if (gc) {
          const user = String(d.user || "");
          const text = `${user} has joined the group`;
          if (activeGcRef.current === d.gcid) {
            const sysMsg = {
              id: `gc-presence-join-${Date.now()}-${Math.random()}`,
              type: "system",
              sender: "SYSTEM",
              text,
              timestamp: new Date().toISOString(),
            } as any;
            setMessages(prev => [...prev, sysMsg]);
          }
          if (user !== me) {
            notify(`New member in ${gc.name}`, text);
          }
        }
        return;
      }
      if (d.type === "gc_member_left" && typeof d.user === "string" && typeof d.gcid === "string") {
        const gc = gcsRef.current.find(g => g.id === d.gcid);
        if (gc) {
          const user = String(d.user || "");
          const text = `${user} has left the group`;
          if (activeGcRef.current === d.gcid) {
            const sysMsg = {
              id: `gc-presence-leave-${Date.now()}-${Math.random()}`,
              type: "system",
              sender: "SYSTEM",
              text,
              timestamp: new Date().toISOString(),
            } as any;
            setMessages(prev => [...prev, sysMsg]);
          }
          if (user !== me) {
            notify(`Member left ${gc.name}`, text);
          }
        }
        return;
      }
      // Main thread presence (join/leave) only if not in DM or GC
      if (d.type === "presence" && typeof d.user === "string" && typeof d.action === "string") {
        if (activeDmRef.current !== null || activeGcRef.current) {
          return;
        }
        const user = String(d.user || "");
        const actionRaw = String(d.action || "");
        const action = actionRaw.toLowerCase() === "join" ? "has joined chat" : actionRaw.toLowerCase() === "leave" ? "has left chat" : actionRaw;
        const text = `${user} ${action}`;
        notify(user, action);
        const sysMsg = {
          id: `presence-${Date.now()}-${Math.random()}`,
          type: "system",
          sender: "SYSTEM",
          text,
          timestamp: new Date().toISOString(),
        } as any;
        setMessages(prev => [...prev, sysMsg]);
        return;
      }

      // Handle delete events (main, DM, GC)
      if (d.type === "delete" && d.id) {
        if (d.thread === "dm") {
          if (activeDmRef.current === d.peer) {
            setMessages(prev => prev.filter(m => String(m.id) !== String(d.id)));
          }
        } else if (d.thread === 'gc') {
          if (activeGcRef.current === d.gcid) {
            setMessages(prev => prev.filter(m => String(m.id) !== String(d.id)));
          }
        } else {
          if (activeDmRef.current === null && !activeGcRef.current) {
            setMessages(prev => prev.filter(m => String(m.id) !== String(d.id)));
          }
        }
        return;
      }

  // Handle message text edits
  if (d.type === "message_update" && d.id != null) {
        const isGC = d.thread === 'gc' && typeof d.gcid === 'string';
        const isDM = d.thread === 'dm' && typeof d.peer === 'string';
        const isMain = !d.thread || d.thread === 'main';
        const threadKey = isGC ? `gc:${d.gcid}` : isDM ? `dm:${d.peer}` : 'main';
        // Off-thread? cache to apply on next history load for that thread
        const offThread = (isGC && activeGcRef.current !== d.gcid) || (isDM && activeDmRef.current !== d.peer) || (isMain && (activeDmRef.current !== null || !!activeGcRef.current));
        if (offThread) {
          try {
            if (!pendingTextUpdatesRef.current[threadKey]) pendingTextUpdatesRef.current[threadKey] = {};
            pendingTextUpdatesRef.current[threadKey][String(d.id)] = { text: d.text, edited: true };
          } catch {}
          return;
        }
        setMessages(prev => uniqueById(prev.map(m => (String(m.id) === String(d.id) ? { ...m, text: d.text, edited: true } : m))));
        return;
      }

      // Handle reaction updates
  if (d.type === "reaction_update" && d.id != null) {
        const isGC = d.thread === 'gc' && typeof d.gcid === 'string';
        const isDM = d.thread === 'dm' && typeof d.peer === 'string';
        const isMain = !d.thread || d.thread === 'main';
        const threadKey = isGC ? `gc:${d.gcid}` : isDM ? `dm:${d.peer}` : 'main';
        // Off-thread? cache to apply later on history load
        const offThread = (isGC && activeGcRef.current !== d.gcid) || (isDM && activeDmRef.current !== d.peer) || (isMain && (activeDmRef.current !== null || !!activeGcRef.current));
        if (offThread) {
          try {
            if (d.reactions && typeof d.reactions === 'object') {
              if (!pendingReactionUpdatesRef.current[threadKey]) pendingReactionUpdatesRef.current[threadKey] = {};
              pendingReactionUpdatesRef.current[threadKey][String(d.id)] = { reactions: d.reactions };
            }
          } catch {}
          return;
        }
        setMessages(prev => uniqueById(prev.map(m => {
          if (String(m.id) !== String(d.id)) return m;
          const nextReacts = d.reactions || {};
          return { ...m, reactions: nextReacts };
        })));
        return;
      }

      // Flash ping: highlight a specific message id for me
  if (d.type === 'flash' && d.id != null) {
        setFlashMap(prev => ({ ...prev, [d.id]: true }));
        return;
      }

      // Handle clear events (main, DM, GC)
      if (d.type === "clear") {
        // For DM/GC/Main, just clear timeline and wait for server 'system' message
        if (d.thread === "dm" && activeDmRef.current === d.peer) {
          setMessages([]);
        } else if (d.thread === 'gc' && activeGcRef.current === d.gcid) {
          setMessages([]);
        } else if ((d.thread === "main" || !d.thread) && activeDmRef.current === null && !activeGcRef.current) {
          setMessages([]);
        }
        return;
      }

      // Histories
      if (d.type === "history" && Array.isArray(d.items)) {
        const rec = reconcileOnLoad(d.items, 'main');
        seen.current.clear();
        rec.forEach((x: any) => x?.id && seen.current.add(String(x.id)));
        historyIdsRef.current = new Set((rec || []).map((x: any) => x && String(x.id)).filter(Boolean));
        forceScrollRef.current = true; // scroll to latest after loading history
        return setMessages(rec);
      }
      if (d.type === "dm_history" && Array.isArray(d.items)) {
        const tk = d.peer ? `dm:${d.peer}` : 'dm:unknown';
        const rec = reconcileOnLoad(d.items, tk);
        seen.current.clear();
        rec.forEach((x: any) => x?.id && seen.current.add(String(x.id)));
        historyIdsRef.current = new Set((rec || []).map((x: any) => x && String(x.id)).filter(Boolean));
        forceScrollRef.current = true; // scroll to latest after loading dm history
        return setMessages(rec);
      }

      // Throttled AI streaming updates — apply only for the active thread
      if (d.type === "update" && d.id) {
        // Gate by thread
        const isGC = d.thread === 'gc' && typeof d.gcid === 'string';
        const isDM = d.thread === 'dm' && typeof d.peer === 'string';
        const isMain = !d.thread || d.thread === 'main';
        if (isGC && activeGcRef.current !== d.gcid) return;
        if (isDM && activeDmRef.current !== d.peer) return;
        if (isMain && (activeDmRef.current !== null || !!activeGcRef.current)) return;
        aiPendingRef.current[d.id] = d.text ?? "";
        if (!aiUpdateTimer.current) {
          aiUpdateTimer.current = window.setTimeout(() => {
            const batch = aiPendingRef.current;
            aiPendingRef.current = {};
            aiUpdateTimer.current = null;
            setMessages(prev => prev.map(m => (batch[m.id] !== undefined ? { ...m, text: batch[m.id] } : m)));
          }, 50);
        }
        return;
      }

      // Poll updates are incremental
  if (d.type === "poll_update" && d.id != null) {
  setMessages(prev => uniqueById(prev.map(m => (String(m.id) === String(d.id) ? { ...m, counts: d.counts, total_voters: d.total_voters, votes: d.votes || m.votes } : m))));
        return;
      }

      // AI streaming via repeated 'message' events with the same id: append chunks
      if (d.type === "message" && d.sender === "AI" && d.id) {
        const isHidden = typeof document !== "undefined" && document.hidden;
        // Thread context detection
        const isGC = d.thread === "gc" && typeof d.gcid === "string";
        const isDM = d.thread === "dm" && typeof d.peer === "string";
        const isMain = !d.thread || d.thread === "main";

        // Only notify for actual AI responses (not prompts), and only if not viewing the relevant thread or tab is hidden
        let shouldNotify = false;
        let notifyTitle = "AI";
        let notifyBody = typeof d.text === "string" && d.text ? d.text : "AI is responding";
        // Only notify if there is actual AI response text (not just spinner)
        const hasResponse = typeof d.text === "string" && d.text.trim().length > 0;
        // Only notify for AI responses, not prompts (AI prompt messages have empty text)
        if (hasResponse) {
          if (isGC) {
            if (activeGcRef.current !== d.gcid) {
              shouldNotify = true;
              notifyTitle = `AI replied in GC: ${gcsRef.current.find(x=>x.id===d.gcid)?.name || 'Group'}`;
            } else if (isHidden) {
              shouldNotify = true;
              notifyTitle = `AI replied in GC: ${gcsRef.current.find(x=>x.id===d.gcid)?.name || 'Group'}`;
            }
          } else if (isDM) {
            if (activeDmRef.current !== d.peer) {
              shouldNotify = true;
              notifyTitle = `AI replied in DM with ${d.peer}`;
            } else if (isHidden) {
              shouldNotify = true;
              notifyTitle = `AI replied in DM with ${d.peer}`;
            }
          } else if (isMain) {
            if (activeDmRef.current !== null || activeGcRef.current) {
              shouldNotify = true;
              notifyTitle = `AI replied in Main Chat`;
            } else if (isHidden) {
              shouldNotify = true;
              notifyTitle = `AI replied in Main Chat`;
            }
          }
        }
        if (shouldNotify) {
          notify(notifyTitle, notifyBody);
        }

        // Only render spinner and AI responses in the correct thread
        if ((isGC && activeGcRef.current === d.gcid) || (isDM && activeDmRef.current === d.peer) || (isMain && activeDmRef.current === null && !activeGcRef.current)) {
          setMessages(prev => {
            const idx = prev.findIndex(m => String(m.id) === String(d.id));
            if (idx !== -1) {
              const copy = [...prev];
              const old = copy[idx];
              copy[idx] = { ...old, text: (old.text || "") + (d.text || "") };
              return copy;
            }
            // First packet for this AI id. If text is empty, it will show spinner
            return [...prev, d];
          });
        }
        return;
      }

      if (d.type === "typing") {
        if (d.user === currentUser) return;
        // Only show typing for the active thread
        if (d.thread === "dm") {
          if (activeDmRef.current !== d.peer) return;
        } else if (d.thread === 'gc') {
          if (activeGcRef.current !== d.gcid) return;
        } else {
          // main typing only when not in DM or GC
          if (activeDmRef.current !== null || activeGcRef.current) return;
        }
        if (d.typing) {
          setTypingUser(d.user || "");
          setTypingVisible(true);
          if (typingStopTimer.current) window.clearTimeout(typingStopTimer.current);
          if (typingHideTimer.current) window.clearTimeout(typingHideTimer.current);
          typingStopTimer.current = window.setTimeout(() => {
            setTypingVisible(false);
            typingHideTimer.current = window.setTimeout(() => setTypingUser(""), 160);
          }, 1000);
        } else {
          setTypingVisible(false);
          if (typingHideTimer.current) window.clearTimeout(typingHideTimer.current);
          typingHideTimer.current = window.setTimeout(() => setTypingUser(""), 160);
        }
        return;
      }

      if ((d.type === "message" || d.type === "media") && d.sender && d.sender === typingUserRef.current) {
        setTypingVisible(false);
        if (typingHideTimer.current) window.clearTimeout(typingHideTimer.current);
        typingHideTimer.current = window.setTimeout(() => setTypingUser(""), 120);
      }

  // Route DM/GC events and update unread counters + toast when sidebar collapsed
      if ((d.type === "message" || d.type === "media") && d.thread === "dm" && typeof d.peer === "string") {
        const isHidden = typeof document !== "undefined" && document.hidden;
        // If not on that DM thread, raise unread and do not render here
        if (activeDmRef.current !== d.peer) {
          setUnreadDm(prev => ({ ...prev, [d.peer]: (prev[d.peer] || 0) + 1 }));
          const title = `${d.sender} sent you a message (DM)`;
          const body = typeof d.text === "string" && d.text ? d.text : (d.mime || "media");
          if (d.sender !== me) notify(title, body);
          scheduleDmToast(d.sender === me ? d.peer : d.sender);
          return;
        } else if (isHidden && d.sender !== me) {
          const title = `${d.sender} sent you a message (DM)`;
          const body = typeof d.text === "string" && d.text ? d.text : (d.mime || "media");
          notify(title, body);
        }
      }
      if ((d.type === 'message' || d.type === 'media') && d.thread === 'gc' && typeof d.gcid === 'string') {
        const isHidden = typeof document !== "undefined" && document.hidden;
        if (activeGcRef.current !== d.gcid) {
          const title = `${d.sender} in ${gcsRef.current.find(x=>x.id===d.gcid)?.name || 'Group'}`;
          const body = typeof d.text === 'string' && d.text ? d.text : (d.mime || 'media');
          notify(title, body);
          setUnreadGc(prev => ({ ...prev, [d.gcid]: (prev[d.gcid] || 0) + 1 }));
          if (typeof d.text === 'string' && d.sender !== me && mentionsMe(d.text || '')) {
            const label = gcsRef.current.find(x=>x.id===d.gcid)?.name || 'Group';
            scheduleMentionToast('gc', label, d.gcid);
          }
          return;
        } else if (isHidden) {
          const title = `${d.sender} in ${gcsRef.current.find(x=>x.id===d.gcid)?.name || 'Group'}`;
          const body = typeof d.text === 'string' && d.text ? d.text : (d.mime || 'media');
          notify(title, body);
        }
      }

      // Main thread notifications / unread when off main OR mention OR tab hidden
      if ((d.type === "message" || d.type === "media") && (!d.thread || d.thread === "main") && d.sender) {
        const isHidden = typeof document !== "undefined" && document.hidden;
        const notOnMain = activeDmRef.current !== null || !!activeGcRef.current; // user is in DM or GC
        const isMention = typeof d.text === "string" && d.sender !== me && mentionsMe(d.text || "");
        // Increment unread counter only for mentions when off main or hidden
        if ((notOnMain || isHidden) && isMention) setUnreadMain(c => c + 1);
        if (notOnMain && isMention) scheduleMentionToast('main', 'Main Chat');
        // Notify if off main (any message not from me) OR hidden and mention
        if ((notOnMain && d.sender !== me) || (isHidden && (isMention || d.sender !== me))) {
          const title = `${d.sender} (Main)`;
          const body = typeof d.text === "string" && d.text ? d.text : (d.mime || "media");
          notify(title, body);
        }
        if (activeDmRef.current !== null || activeGcRef.current) return; // don't render main while viewing DM or GC
      }

      

      

      if (d.type === "user_list") {
        setUsers(d.users);
        if (Array.isArray(d.admins)) setAdmins(d.admins);
        if (d.tags && typeof d.tags === "object") setTagsMap(d.tags);
        // NEW: user activity map (if present)
        if (d.user_activity && typeof d.user_activity === "object") {
          setUserActivity(d.user_activity);
        }
        if (Array.isArray(d.tag_locks)) {
          setTagLocks(new Set(d.tag_locks));
        }
        return;
      }

      // System events notifications and handle clear wording
      if (d.type === "system") {
        const txt = String(d.text || "");
        // No frontend capitalization, use backend casing as-is
        if (activeDmRef.current === null && /cleared the chat/i.test(txt)) {
          notify("SYSTEM", txt);
          return setMessages([{ ...d, sender: "SYSTEM", text: txt }]);
        }
        // Suppress general system lines while viewing a DM or GC (main-only)
        if (activeDmRef.current !== null || activeGcRef.current) {
          return;
        }
        notify("SYSTEM", txt);
        return setMessages(p => [...p, { ...d, text: txt }]);
      }

      // Final fallback: merge-or-append in a single state update to avoid race duplicates
      setMessages(prev => {
        // First, reconcile servers that re-emit edits as brand-new 'message' events.
        // If this payload matches a very recent edit from me in this thread, merge it onto the original id.
        try {
          const hasText = typeof d.text === 'string' && d.text.length > 0;
          if ((d.type === 'message' || d.type === 'media') && hasText) {
            const tk = (d.thread === 'gc' && d.gcid) ? `gc:${d.gcid}` : (d.thread === 'dm' && d.peer) ? `dm:${d.peer}` : 'main';
            // Match by thread and robust text comparison within time window; prefer same-sender hits
            const candidates = recentEditsRef.current.filter(e => e.threadKey === tk && (Date.now() - e.time) < 30000 && textsMatch(e.text, d.text));
            // Prefer exact same sender if available
            const hit = candidates.find(e => String(e.sender) === String(d.sender)) || candidates[0];
            if (hit) {
              const idx = prev.findIndex(m => String(m.id) === String(hit.oldId));
              if (idx !== -1) {
                const copy = prev.slice();
                // Replace old message inplace using new payload; ensure it's marked edited
                copy[idx] = { ...copy[idx], ...d, edited: true } as any;
                // Evict consumed mapping
                recentEditsRef.current = recentEditsRef.current.filter(e => e !== hit);
                return uniqueById(copy);
              }
            }
          }
        } catch {}

        // If this payload has an id that already exists, merge it in place
        if (d.id) {
          const idx = prev.findIndex(m => m && String(m.id) === String(d.id));
          if (idx !== -1) {
            const copy = prev.slice();
            copy[idx] = { ...copy[idx], ...d } as any;
            return uniqueById(copy);
          }
          // If we've already seen this id (history or earlier append), don't add again
          if (seen.current.has(String(d.id))) return prev;
        }

        // Gate by active thread before appending
        const isMain = !activeDmRef.current && !activeGcRef.current;
        const okForMain = (!d.thread || d.thread === 'main') && isMain;
        const okForDm = (d.thread === 'dm' && d.peer === activeDmRef.current);
        const okForGc = (d.thread === 'gc' && d.gcid === activeGcRef.current);
        if (okForMain || okForDm || okForGc) {
          if (d.id) seen.current.add(String(d.id));
          return uniqueById([...prev, d]);
        }
        return prev;
      });
    };

    return () => {
      ws.current?.close();
      if (typingStopTimer.current) window.clearTimeout(typingStopTimer.current);
      if (typingHideTimer.current) window.clearTimeout(typingHideTimer.current);
      if (aiUpdateTimer.current) window.clearTimeout(aiUpdateTimer.current);
      if (muteIntervalRef.current) { window.clearInterval(muteIntervalRef.current); muteIntervalRef.current = null; }
    };
  }, [token]);

  // Global Esc handlers: cancel reply when open
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (replyTo) {
          setReplyTo(null);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [replyTo]);

  // Reset unread counts and request history when switching threads
  // Always request correct history when switching threads
  useEffect(() => {
    if (!ws.current || ws.current.readyState !== WebSocket.OPEN) return;
    if (activeGc) {
      try { ws.current.send(JSON.stringify({ type: "gc_history", gcid: activeGc })); } catch {}
      setUnreadGc(prev => ({ ...prev, [activeGc]: 0 }));
    } else if (activeDm) {
      try { ws.current.send(JSON.stringify({ type: "dm_history", peer: activeDm })); } catch {}
      setUnreadDm(prev => ({ ...prev, [activeDm]: 0 }));
    } else {
      try { ws.current.send(JSON.stringify({ type: "history_request" })); } catch {}
      setUnreadMain(0);
    }
  }, [activeDm, activeGc]);

  // Auto-scroll on new messages only if at bottom or when explicitly forced (e.g., after loading history)
  useEffect(() => {
    if (!messages) return;
    if (forceScrollRef.current || isAtBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      forceScrollRef.current = false;
    }
  }, [messages]);

  // Small mount animation for each message (fast + smooth) — run only once per element
  const animateIn = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    if ((el as any).dataset.animated === "true") return; // prevent re-animating on re-renders
    (el as any).dataset.animated = "true";
    el.style.opacity = "0";
    el.style.transform = "translateY(4px) scale(0.98)";
    el.style.transition = "none";
    requestAnimationFrame(() => {
      el.style.transition = "opacity 180ms ease-out, transform 180ms ease-out";
      el.style.opacity = "1";
      el.style.transform = "translateY(0) scale(1)";
    });
  }, []);

  // Send typing ping only when there's content
  const pingTyping = useCallback((val: string) => {
    if (!ws.current || ws.current.readyState !== WebSocket.OPEN) return;
    if (!val || !val.trim()) return;
    const threadPayload = activeGcRef.current ? { thread: 'gc', gcid: activeGcRef.current } : (activeDmRef.current ? { thread: "dm", peer: activeDmRef.current } : { thread: "main" } as any);
    try { ws.current.send(JSON.stringify({ typing: true, ...threadPayload })); } catch {}
  }, []);

  const showAlert = useCallback((text: string, action?: () => void) => {
    const t = (() => {
      const s = (text || "").trim().replace(/[.]+$/, "");
      return s ? s[0].toUpperCase() + s.slice(1) : s;
    })();
    setAlertText(t);
    setAlertButton("OK");
    alertActionRef.current = action || null;
    setAlertOpen(true);
  }, []);

  // Stop flashing immediately (on hover/click) for a given message id
  const stopFlashing = useCallback((id: string) => {
    if (!id) return;
    // once stopped, never flash this id again
    flashedRef.current.add(id);
    const el = messageRefs.current[id] || null;
    const t = timeoutRefs.current[id];
    if (t) { window.clearTimeout(t); delete timeoutRefs.current[id]; }
    const ft = fallbackFlashRefs.current[id];
    if (ft) { window.clearTimeout(ft); delete fallbackFlashRefs.current[id]; }
    setFlashMap(prev => {
      if (!prev[id]) return prev;
      const copy = { ...prev } as Record<string, boolean>;
      delete copy[id];
      return copy;
    });
    try { if (el) observerRef.current?.unobserve(el); } catch {}
  }, []);

  // Scroll to a message by id and flash it briefly
  const scrollToMessage = useCallback((id: string) => {
    try {
      const el = messageRefs.current[id];
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setFlashMap(prev => ({ ...prev, [id]: true }));
        window.setTimeout(() => {
          setFlashMap(prev => { const c = { ...prev }; delete (c as any)[id]; return c; });
        }, 2000);
      }
    } catch {}
  }, []);

  const isAiAnywhere = (t: string) => /^\s*@ai\b/i.test(t); // revert to only at start
  const extractAiPrompt = (t: string) => {
    const m = t.match(/^\s*@ai\b(.*)$/i);
    return (m ? m[1] : "").trim();
  };

  const send = async () => {
    if (editingId) return; // Don't send a new message while editing inline
    if (sending) return;
    let txt = input.trim();
    if (!txt && files.length === 0) return;

    // Client-side shortcut: open Create GC modal on /makegc
    if (/^\s*\/makegc\s*$/i.test(txt)) {
      setMakeGcOpen(true);
      setInput("");
      return;
    }

    // Interactive shortcuts based on incomplete commands
    // /tag: if not fully specified, open modal
    if (/^\s*\/tag\b/i.test(txt)) {
      const okFull = /^\s*\/tag\s+"[^"]+"\s+"[^"]+"(?:\s+(?:-\w+|-#[0-9a-fA-F]{3,8}|#[0-9a-fA-F]{3,8}))?\s*$/i.test(txt);
      if (!okFull) {
        // If normal user and their tag is locked, do not open modal; show alert instead
        if (!isAdminEffective && tagLocks.has(me)) {
          showAlert("Your tag is locked (DEV only)");
          setInput("");
          return;
        }
        setTagOpen(true);
        setInput("");
        return;
      }
    }

    // Admin flows
    if (isAdminEffective) {
      // /kick: open modal if no user specified
      if (/^\s*\/kick\b/i.test(txt)) {
        const okFull = /^\s*\/kick\s+"[^"]+"\s*$/i.test(txt);
        if (!okFull) {
          setKickOpen(true);
          setInput("");
          return;
        }
      }
      // /clear in Main: confirm
      if (/^\s*\/clear\s*$/i.test(txt) && !activeDmRef.current && !activeGcRef.current) {
        setClearMainConfirm(true);
        setInput("");
        return;
      }
      // /clear in GC: confirm
      if (/^\s*\/clear\s*$/i.test(txt) && !!activeGcRef.current) {
        setClearGcConfirm(true);
        setInput("");
        return;
      }
      // /ban: open modal if no user specified
      if (/^\s*\/ban\b/i.test(txt)) {
        const okFull = /^\s*\/ban\s+"[^"]+"\s*$/i.test(txt);
        if (!okFull) {
          setBanOpen(true);
          setInput("");
          return;
        }
      }
      // /unban: if no username specified, request banned list (server will reply with unban_prompt)
      if (/^\s*\/unban\b/i.test(txt)) {
        const okFull = /^\s*\/unban\s+"[^"]+"\s*$/i.test(txt);
        if (!okFull) {
          try { ws.current?.send(JSON.stringify({ text: '/unban' })); } catch {}
          setInput("");
          return;
        }
      }
      // /pass: open modal if missing args
      if (/^\s*\/pass\b/i.test(txt)) {
        const okFull = /^\s*\/pass\s+"[^"]+"\s*$/i.test(txt);
        if (!okFull) {
          setPassOpen(true);
          setInput("");
          return;
        }
      }
      // /unmute: if no username specified, request muted list (server will reply with unmute_prompt)
      if (/^\s*\/unmute\b/i.test(txt)) {
        const okFull = /^\s*\/unmute\s+"[^"]+"\s*$/i.test(txt);
        if (!okFull) {
          try { ws.current?.send(JSON.stringify({ text: '/unmute' })); } catch {}
          setInput("");
          return;
        }
      }
      // /account: open account modal
      if (/^\s*\/account\s*$/i.test(txt)) {
        setAccountOpen(true);
        setInput("");
        return;
      }
      // /mute: open modal if missing args
      if (/^\s*\/mute\b/i.test(txt)) {
        const okFull = /^\s*\/mute\s+(?:"[^"]+"|\S+)\s+\d+\s*$/i.test(txt);
        if (!okFull) {
          setMuteOpen(true);
          setInput("");
          return;
        }
      }
  // DEV-only: /mkadmin and /rmadmin without args -> modal
      if (isDevMe && /^\s*\/mkadmin\b/i.test(txt)) {
        const okFull = /^\s*\/mkadmin\s+"[^"]+"\s+\S+\s*$/i.test(txt);
        if (!okFull) {
          setAdminRoleMode("mkadmin");
          setAdminRoleOpen(true);
          setInput("");
          return;
        }
      }
      if (isDevMe && /^\s*\/rmadmin\b/i.test(txt)) {
        const okFull = /^\s*\/rmadmin\s+"[^"]+"\s+\S+\s*$/i.test(txt);
        if (!okFull) {
          setAdminRoleMode("rmadmin");
          setAdminRoleOpen(true);
          setInput("");
          return;
        }
      }
      // DEV-only: /locktag and /unlocktag without args -> open modal
      if (isDevMe && /^\s*\/locktag\b/i.test(txt)) {
        const okFull = /^\s*\/locktag\s+(?:"[^"]+"|\S+)\s*$/i.test(txt);
        if (!okFull) {
          setLockOpen(true);
          setInput("");
          return;
        }
      }
      if (isDevMe && /^\s*\/unlocktag\b/i.test(txt)) {
        const okFull = /^\s*\/unlocktag\s+(?:"[^"]+"|\S+)\s*$/i.test(txt);
        if (!okFull) {
          setUnlockOpen(true);
          setInput("");
          return;
        }
      }
      // DEV-only: /psa without args -> modal
      if (isDevMe && /^\s*\/psa\b/i.test(txt)) {
        const okFull = /^\s*\/psa\s+"[^"]+"\s*$/i.test(txt);
        if (!okFull) {
          setPsaOpen(true);
          setInput("");
          return;
        }
      }
      // DEV-only: /kickA, /muteA, /unmuteA helpers
      if (isDevMe && /^\s*\/kickA\b/i.test(txt)) {
        setKickAllConfirm(true);
        setInput("");
        return;
      }
      // DEV-only: /users -> request registry list
      if (isDevMe && /^\s*\/users\b/i.test(txt)) {
        const okFull = /^\s*\/users\s*$/i.test(txt);
        if (!okFull || okFull) {
          try { ws.current?.send(JSON.stringify({ text: '/users' })); } catch {}
          setInput("");
          return;
        }
      }
      // /poll -> open modal (anyone can create polls; keep here so admin intercept doesn't block)
      if (/^\s*\/poll\s*$/i.test(txt)) {
        setPollOpen(true);
        setInput("");
        return;
      }
      // DEV-only: /reset -> require superpass modal if missing args
      if (isDevMe && /^\s*\/reset\b/i.test(txt)) {
        const okFull = /^\s*\/reset\s+"[^\"]+"\s*$/i.test(txt);
        if (!okFull) {
          setResetOpen(true);
          setInput("");
          return;
        }
      }
      if (isDevMe && /^\s*\/muteA\b/i.test(txt)) {
        const okFull = /^\s*\/muteA\s+\d+\s*$/i.test(txt);
        if (!okFull) {
          setMuteAllOpen(true);
          setInput("");
          return;
        }
      }
      if (isDevMe && /^\s*\/unmuteA\b/i.test(txt)) {
        setUnmuteAllConfirm(true);
        setInput("");
        return;
      }
    }

    // /rmtag: if not fully specified, open modal (available to everyone; admins can pick others)
    if (/^\s*\/rmtag\b/i.test(txt)) {
      const okFull = /^\s*\/rmtag\s+"[^"]+"\s*$/i.test(txt);
      if (!okFull) {
        setRmtagOpen(true);
        setInput("");
        return;
      }
    }

    // /account: open self account modal for everyone
    if (/^\s*\/account\s*$/i.test(txt)) {
      setAccountOpen(true);
      setInput("");
      return;
    }
    // /poll for non-admins too
    if (/^\s*\/poll\s*$/i.test(txt)) {
      setPollOpen(true);
      setInput("");
      return;
    }

    // Intercept admin-only commands for non-admins and show modal instead of sending
    if (!isAdminEffective) {
  const adminOnly = /^(\/kick|\/ban|\/unban|\/clear|\/pass|\/mute|\/unmute|\/kickA|\/mkadmin|\/rmadmin|\/locktag|\/unlocktag|\/purgeadmin|\/muteA|\/unmuteA|\/psa)(?:\s|$)/i;
      // allow /clear in DM (scoped)
      if (/^\s*\/clear\s*$/i.test(txt) && activeDm) {
        // let it through
      } else if (adminOnly.test(txt)) {
        if (/^\s*\/tag\b/i.test(txt)) {
          showAlert('You can only tag yourself. Use: /tag "myself" "tag" [named color like -red or hex like -#RRGGBB]');
        } else {
          showAlert('Only admin can use that command');
        }
        return;
      }
      if (/^\//.test(txt)) {
        const publicOk = /^\s*\/(tag\b|rmtag\b|rjtag\b|ac(?:p)?tag\b|dm\b|clear\b)/i.test(txt);
        if (!publicOk) {
          showAlert('Invalid command');
          return;
        }
      }
    }

    // Admin command param validation (client-side UX)
    if (isAdminEffective) {
      if(/^\s*\/mute\b/i.test(txt) && !/^\s*\/mute\s+(?:"[^"]+"|\S+)\s+\d+\s*$/i.test(txt)){
        showAlert('Usage: /mute "username" minutes');
        return;
      }
      if(/^\s*\/muteA\b/i.test(txt) && !/^\s*\/muteA\s+\d+\s*$/i.test(txt)) {
        showAlert('Usage: /muteA minutes');
        return;
      }
      // /tag handled above: if incomplete, modal is opened. If it reaches here, it is full and allowed.
      if (/^\s*\/kick\b/i.test(txt) && !/^\s*\/kick\s+"[^"]+"\s*$/i.test(txt)) {
        showAlert('Usage: /kick "username"');
        return;
      }
      if (/^\s*\/psa/i.test(txt) && !/^\s*\/psa\s+"[^"]+"\s*$/i.test(txt)) {
        showAlert('Usage: /psa "message"');
        return;
      }
      if (/^\s*\/ban/i.test(txt) && !/^\s*\/ban\s+"[^"]+"\s*$/i.test(txt)) {
        showAlert('Usage: /ban "username"');
        return;
      }
      // /unban usage check not needed here; incomplete form is handled above by prompting
      if (/^\s*\/mkadmin/i.test(txt) && !/^\s*\/mkadmin\s+"[^"]+"\s+\S+\s*$/i.test(txt)) {
        // If DEV and no args: handled by modal before; otherwise show usage
        if (!isDevMe) { showAlert('Usage: /mkadmin "username" superpass'); return; }
      }
      if (/^\s*\/rmadmin/i.test(txt) && !/^\s*\/rmadmin\s+"[^"]+"\s+\S+\s*$/i.test(txt)) {
        if (!isDevMe) { showAlert('Usage: /rmadmin "username" superpass'); return; }
      }
      if (/^\s*\/locktag/i.test(txt) && !/^\s*\/locktag\s+(?:"[^"]+"|\S+)\s*$/i.test(txt)) {
        showAlert('Usage: /locktag "username"');
        return;
      }
      if (/^\s*\/unlocktag/i.test(txt) && !/^\s*\/unlocktag\s+(?:"[^"]+"|\S+)\s*$/i.test(txt)) {
        showAlert('Usage: /unlocktag "username"');
        return;
      }
      if (/^\s*\/unmute\b/i.test(txt) && !/^\s*\/unmute\s+"[^"]+"\s*$/i.test(txt)) {
        showAlert('Usage: /unmute "username"');
        return;
      }
    }

    // Validate @ai attachments: allow only a single image (no other files)
    if (isAiAnywhere(txt) && files.length > 0) {
      const imgs = files.filter(f => f.type && f.type.startsWith("image"));
      if (!(files.length === 1 && imgs.length === 1)) {
        showAlert("Attach a single image for @ai image mode");
        return; // keep state so user can adjust
      }
      if (imgs[0].type === "image/gif") {
        showAlert("@ai only supports static images (png/jpg/webp)");
        return;
      }
    }

    // @ai mention triggers AI (anywhere in message)
  if (isAiAnywhere(txt)) {
      const promptOnly = extractAiPrompt(txt);
      if (!promptOnly) {
        showAlert("Usage: @ai <prompt>");
        return;
      }

      try {
  const threadPayload = activeGcRef.current ? { thread: 'gc', gcid: activeGcRef.current } : (activeDmRef.current ? { thread: "dm", peer: activeDmRef.current } : {});
        // If an image is attached, upload it and include as `image` for llava
        const imgFile = files.find(f => f.type && f.type.startsWith("image"));
        if (imgFile) {
          const up = await api.uploadFile(imgFile, activeGcRef.current ? { thread: 'gc', gcid: activeGcRef.current, user: me } : (activeDmRef.current ? { thread: "dm", peer: activeDmRef.current, user: me } : { thread: "main", user: me }));
          if (!up?.url) throw new Error("upload failed");
          ws.current?.send(JSON.stringify({ text: input, image: up.url, image_mime: up.mime, ...threadPayload }));
        } else {
          // Send full message; backend will parse @ai anywhere and echo it
          ws.current?.send(JSON.stringify({ text: input, ...threadPayload }));
        }
        setInput("");
        setReplyTo(null);
        setFiles([]);
        setShowPicker(false);
      } catch {
        showAlert("Failed to send ai request");
      } finally {
        if (fileRef.current) fileRef.current.value = "";
        txtRef.current?.focus();
      }
      return;
    }

  // Normal send flow (supports Main, DM, and GC)
    setSending(true);
    forceScrollRef.current = true; // always scroll to bottom when sending
    const threadPayload = activeGcRef.current ? { thread: 'gc', gcid: activeGcRef.current } : (activeDmRef.current ? { thread: "dm", peer: activeDmRef.current } : {});
    try {
      if (txt && files.length > 0) {
        if (ws.current && ws.current.readyState === WebSocket.OPEN) {
          const extra = replyTo ? { reply_to_id: replyTo.id } : {};
          ws.current.send(JSON.stringify({ text: txt, ...threadPayload, ...extra }));
        } else {
          throw new Error("socket not connected");
        }
        for (const f of files) {
          const up = await api.uploadFile(f, activeGcRef.current ? { thread: 'gc', gcid: activeGcRef.current, user: me } : (activeDmRef.current ? { thread: "dm", peer: activeDmRef.current, user: me } : { thread: "main", user: me }));
          if (!up?.url) throw new Error("upload failed");
          ws.current?.send(JSON.stringify({ url: up.url, mime: up.mime, ...threadPayload }));
        }
      } else if (txt) {
        if (ws.current && ws.current.readyState === WebSocket.OPEN) {
          const extra = replyTo ? { reply_to_id: replyTo.id } : {};
          ws.current.send(JSON.stringify({ text: txt, ...threadPayload, ...extra }));
        } else {
          throw new Error("socket not connected");
        }
      } else {
        for (const f of files) {
          const up = await api.uploadFile(f, activeGcRef.current ? { thread: 'gc', gcid: activeGcRef.current, user: me } : (activeDmRef.current ? { thread: "dm", peer: activeDmRef.current, user: me } : { thread: "main", user: me }));
          if (!up?.url) throw new Error("upload failed");
          ws.current?.send(JSON.stringify({ url: up.url, mime: up.mime, ...threadPayload }));
        }
      }
    } catch (e) {
      showAlert("Failed to send message or upload file(s)");
    } finally {
      setInput("");
      setReplyTo(null);
      setFiles([]);
      setShowPicker(false);
      if (fileRef.current) fileRef.current.value = "";
      setSending(false);
      txtRef.current?.focus();
    }
  };

  const deleteMsg = (id: string) => {
    setMessages(prev => prev.filter(m => String(m.id) !== String(id)));
    const threadPayload = activeGcRef.current
      ? { thread: 'gc', gcid: activeGcRef.current }
      : (activeDmRef.current
        ? { thread: 'dm', peer: activeDmRef.current }
        : { thread: 'main' } as any);
    try {
      ws.current?.send(JSON.stringify({ type: 'delete_message', id, ...threadPayload }));
    } catch {}
  };

  

  // New: start reply to a message
  const startReply = (m: any) => {
    const text = (m.type === 'message' ? (m.text || '') : (m.type === 'media' ? '[media]' : m.type === 'poll' ? '[poll]' : '')).toString();
    setReplyTo({ id: m.id, sender: m.sender, text: text.length > 120 ? text.slice(0, 120) : text });
    try { txtRef.current?.focus(); } catch {}
  };

  // New: send a reaction (toggle)
  const reactTo = (id: string, emoji: string) => {
    // Enforce 5 unique reactions client-side too
    const msg = messages.find(m => m.id === id);
    const keys = msg && msg.reactions ? Object.keys(msg.reactions) : [];
    if (keys && emoji && !keys.includes(emoji) && keys.length >= 5) {
      showAlert("You can only add up to 5 reactions");
      return;
    }
    // Optimistic UI: toggle my reaction locally for snappy UX
    setMessages(prev => uniqueById(prev.map(m => {
      if (m.id !== id) return m;
      const map = (m.reactions && typeof m.reactions === 'object') ? { ...m.reactions } : {} as Record<string, string[]>;
      const arr = new Set<string>(Array.isArray(map[emoji]) ? map[emoji] : []);
      if (arr.has(me)) arr.delete(me); else arr.add(me);
      map[emoji] = Array.from(arr).sort();
      // prune empty emoji buckets
      Object.keys(map).forEach(k => { if (!map[k] || map[k].length === 0) delete map[k]; });
      return { ...m, reactions: map };
    })));
    const payload = activeGcRef.current ? { thread: 'gc', gcid: activeGcRef.current } : (activeDmRef.current ? { thread: 'dm', peer: activeDmRef.current } : { thread: 'main' } as any);
    try { ws.current?.send(JSON.stringify({ type: 'react_message', id, emoji, ...payload })); } catch {}
  };

  // New: edit message inline save/cancel
  const beginEdit = (m: any) => {
    setEditingId(m.id);
    setEditingText(m.text || '');
  };
  const cancelEdit = () => { setEditingId(null); setEditingText(''); };
  const saveEdit = () => {
    if (!editingId) return;
    // Proper in-place edit to avoid duplicate messages
    const payload = activeGcRef.current ? { thread: 'gc', gcid: activeGcRef.current } : (activeDmRef.current ? { thread: 'dm', peer: activeDmRef.current } : {} as any);
    try { ws.current?.send(JSON.stringify({ type: 'edit_message', id: editingId, text: editingText, ...payload })); } catch {}
    // Optimistic in-place update so the UI reflects immediately
  setMessages(prev => uniqueById(prev.map(m => String(m.id) === String(editingId) ? { ...m, text: editingText, edited: true } : m)));
    // Record this edit so if the server sends a fresh 'message' instead of 'message_update',
    // we can merge it back onto the original instead of appending a duplicate
    const threadKey = activeGcRef.current ? `gc:${activeGcRef.current}` : (activeDmRef.current ? `dm:${activeDmRef.current}` : 'main');
    try {
      recentEditsRef.current.push({ oldId: String(editingId), sender: me, text: String(editingText), threadKey, time: Date.now() });
      // keep only the last few seconds of edits
      recentEditsRef.current = recentEditsRef.current.filter(e => Date.now() - e.time < 15000).slice(-20);
    } catch {}
    setEditingId(null);
    setEditingText('');
  };

  const createGc = (name: string, members: string[]) => {
    try { ws.current?.send(JSON.stringify({ type: 'create_gc', name, members })); } catch {}
  };

  // Helpers for URL previews
  // Removed unused isDataUrl to avoid lint error
  const getDataUrlMime = (u: string) => (u.match(/^data:([^;]+);base64,/i)?.[1] || "");
  const extractFirstUrl = (t?: string) => {
    if (!t) return null;
    const m = t.match(/(https?:\/\/[^ ^\s]+|data:[^\s]+)/i);
    return m ? m[1] : null;
  };
  const isImgUrl = (u: string) => /^data:image\//i.test(u) || /\.(png|jpe?g|gif|webp|avif)$/i.test(u);
  const isVidUrl = (u: string) => /^data:video\//i.test(u) || /\.(mp4|webm|ogg)$/i.test(u);

  // Helper: render URLs and @mentions in message text (no background; blue only for active targets)
  const renderRichText = (text: string) => {
    // First, convert :shortcodes: to unicode
    try { text = emoji.replace_colons(text); } catch {}
    // Recognize @"Quoted User" or @name, plus URLs and data URLs
    const parts = text.split(/(@\"[^\"]+\"|@[A-Za-z0-9_]+|https?:\/\/[^ ^\s]+|data:[^\s]+)/g);
    return parts.map((p, i) => {
      if (!p) return null;
      if (p.startsWith("@\"")) {
        const inner = p.slice(2, -1).trim();
        const active = activeMentions.has(inner.toLowerCase()) || inner.toLowerCase() === "ai";
        return <span key={i} className={active ? "text-blue-400" : undefined}>@"{inner}"</span>;
      }
      if (p.startsWith("@")) {
        const name = p.slice(1);
        const active = activeMentions.has(name.toLowerCase());
        return <span key={i} className={active ? "text-blue-400" : undefined}>{p}</span>;
      }
      if (/^https?:\/\//i.test(p)) {
        return (
          <a key={i} href={p} target="_blank" className="underline break-all">{p}</a>
        );
      }
      if (/^data:/i.test(p)) {
        const mime = getDataUrlMime(p);
        return (
          <a key={i} href={p} target="_blank" className="underline break-all">[{mime || "data"} url]</a>
        );
      }
      return <span key={i}>{p}</span>;
    });
  };

  // Helper: mention highlighting for the input (overlay renderer)
  const renderInputHighlight = (text: string) => renderRichText(text);

  // Helpers for URL previews
  // Deleted duplicate definitions of extractFirstUrl/isImgUrl/isVidUrl to fix redeclaration errors
  // const extractFirstUrl = (t?: string) => { /* duplicate removed */ };
  // const isImgUrl = (u: string) => { /* duplicate removed */ };
  // const isVidUrl = (u: string) => { /* duplicate removed */ };

  // Audio ping for notifications (no MP3 needed)
  const audioCtxRef = useRef<AudioContext | null>(null);
  const playPing = useCallback(() => {
    try {
      const AC: any = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      let ctx = audioCtxRef.current;
      if (!ctx) {
        ctx = new AC();
        audioCtxRef.current = ctx as AudioContext;
      }
      if (ctx && (ctx as any).state === "suspended") (ctx as any).resume();

      const now = (ctx as any).currentTime;

      // First tone (lower)
      const o1 = (ctx as any).createOscillator();
      const g1 = (ctx as any).createGain();
      o1.type = "sine";
      o1.frequency.setValueAtTime(600, now);
      o1.connect(g1);
      g1.connect((ctx as any).destination);
      g1.gain.setValueAtTime(0.0001, now);
      g1.gain.exponentialRampToValueAtTime(0.1, now + 0.02);
      g1.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      o1.start(now);
      o1.stop(now + 0.22);

      // Second tone (higher)
      const o2 = (ctx as any).createOscillator();
      const g2 = (ctx as any).createGain();
      o2.type = "sine";
      o2.frequency.setValueAtTime(900, now + 0.1);
      o2.connect(g2);
      g2.connect((ctx as any).destination);
      g2.gain.setValueAtTime(0.0001, now + 0.1);
      g2.gain.exponentialRampToValueAtTime(0.08, now + 0.12);
      g2.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      o2.start(now + 0.1);
      o2.stop(now + 0.27);
    } catch {}
  }, []);

  // Notifications
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, []);
  const notify = useCallback((title: string, body?: string) => {
    playPing();
    try {
      if (!("Notification" in window)) return;
      if (Notification.permission !== "granted") return;
      const n = new Notification(title, { body });
      setTimeout(() => n.close(), 5000);
    } catch {}
  }, [playPing]);

  // Render a poll message with options, progress bars, and vote action
  const renderPoll = useCallback((m: any, threadPayload: any) => {
    const counts: number[] = Array.isArray(m.counts) ? m.counts : [];
    const opts: string[] = Array.isArray(m.options) ? m.options : [];
    const total = Math.max(0, counts.reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0));
    const totalPossible = typeof m.total_possible === 'number' ? m.total_possible : undefined;
    const myChoice = (() => {
      try { const v = m.votes && typeof m.votes === 'object' ? m.votes[me] : undefined; return typeof v === 'number' ? v : -1; } catch { return -1; }
    })();
    const vote = (idx: number) => {
      try {
        ws.current?.send(JSON.stringify({ type: 'vote_poll', poll_id: m.id, choice: idx, ...threadPayload }));
      } catch {}
    };
    return (
  <div className="relative inline-block max-w-[50vw] sm:max-w-[70ch] pt-2 -mt-2">
        <div className="rounded-2xl px-4 py-3 bg-[#111827]/80 text-[#f7f3e8] border border-white/10 w-full">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-semibold text-blue-400">Poll by {m.sender}</div>
            <div className="text-xs text-white/70">{total}/{totalPossible ?? '—'}</div>
          </div>
          <div className="text-[15px] font-medium mb-3">{m.question || ''}</div>
          <div className="space-y-2">
            {opts.map((label, i) => {
              const c = counts[i] || 0;
              const pct = total > 0 ? Math.round((c * 100) / total) : 0;
              const mine = myChoice === i;
              return (
                <button key={i} type="button" onClick={() => vote(i)}
                  className={`w-full text-left rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition p-2 ${mine ? 'ring-2 ring-blue-400/70' : ''}`}>
                  <div className="flex items-center justify-between text-xs text-white/80">
                    <span>{label}</span>
                    <span>{c} • {pct}%</span>
                  </div>
                  <div className="mt-1 h-2 rounded-full bg-white/10 overflow-hidden">
                    <div className="h-full bg-white/90" style={{ width: `${pct}%` }} />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }, [me]);

  // Track last DM toast visibility
  const [dmToast, setDmToast] = useState<{ user: string; id: number } | null>(null);
  const [mentionToast, setMentionToast] = useState<{ where: 'main' | 'gc'; label: string; gcid?: string; id: number } | null>(null);
  const [gcInviteToast, setGcInviteToast] = useState<{ gcid: string; label: string; id: number } | null>(null);
  const sidebarRef = useRef(true);
  useEffect(() => { sidebarRef.current = sidebar; }, [sidebar]);
  const scheduleDmToast = useCallback((user: string) => {
    if (sidebarRef.current) return; // only when collapsed
    setDmToast({ user, id: Date.now() });
    window.setTimeout(() => {
      setDmToast(t => (t && Date.now() - t.id >= 4800 ? null : t));
    }, 5000);
  }, []);
  const scheduleMentionToast = useCallback((where: 'main' | 'gc', label: string, gcid?: string) => {
    if (sidebarRef.current) return; // keep consistent with DM toast behavior
    setMentionToast({ where, label, gcid, id: Date.now() });
    window.setTimeout(() => {
      setMentionToast(t => (t && Date.now() - t.id >= 4800 ? null : t));
    }, 5000);
  }, []);
  const scheduleGcInviteToast = useCallback((gcid: string, label: string) => {
    if (sidebarRef.current) return;
    setGcInviteToast({ gcid, label, id: Date.now() });
    window.setTimeout(() => {
      setGcInviteToast(t => (t && Date.now() - t.id >= 4800 ? null : t));
    }, 5000);
  }, []);

  // totalUnreadDm removed (was used only by removed mobile button); unread counts still available individually
  const [isMobile, setIsMobile] = useState<boolean>(typeof window !== 'undefined' ? window.innerWidth < 1024 : false);
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 1024);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // NEW: user activity state
  const [userActivity, setUserActivity] = useState<Record<string, boolean>>({});

  return (
  <div className="flex h-[100svh] bg-black text-[#f7f3e8] overflow-hidden relative">
      {/* utilities */}
      <style>{`
        /* hide scrollbars but keep scroll */
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        .no-scrollbar::-webkit-scrollbar { display: none; }
        /* typing dots keyframes */
        @keyframes typing-dot { 0%,20%{opacity:.2} 50%{opacity:1} 100%{opacity:.2} }
        /* flashing red border */
        @keyframes flash-red { 0%,100%{ box-shadow:0 0 0 0 rgba(239,68,68,0); border-color: rgba(239,68,68,0); } 50%{ box-shadow:0 0 0 6px rgba(239,68,68,0.28); border-color: rgba(239,68,68,0.9); } }
        /* composer fade from bottom */
        @keyframes fade-rise { from { opacity: 0; transform: translateY(12px); } to { opacity: 0.35; transform: translateY(0); } }
        /* Animated rainbow gradient text for DEV tag */
        @keyframes rainbow-shift { 0% { background-position: 0% 50%; } 100% { background-position: 100% 50%; } }
        .dev-rainbow { background: linear-gradient(90deg, #ff3b30, #ff9500, #ffcc00, #ffffff, #34c759, #5ac8fa, #007aff, #af52de, #ff3b30); background-size: 400% 100%; -webkit-background-clip: text; background-clip: text; color: transparent; animation: rainbow-shift 6s linear infinite; }
      `}</style>
      {/* Global alert modal */}
      <AlertModal
        open={alertOpen}
        text={alertText}
        buttonLabel={alertButton}
        onButton={() => { setAlertOpen(false); alertActionRef.current?.(); }}
        onClose={() => { setAlertOpen(false); alertActionRef.current?.(); }}
      />
      {/* Backdrop only for mobile overlay */}
      {isMobile && sidebar && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-30" onClick={()=>setSidebar(false)} />
      )}
  <div className={isMobile ? `fixed inset-y-0 left-0 z-40 ${!sidebar && 'pointer-events-none'}` : `relative z-20 h-full transition-all duration-300 ${sidebar ? 'w-64' : 'w-12'}`}>
        <Sidebar
          users={users}
          me={me}
          activeDm={activeDm}
          unreadDm={unreadDm}
          unreadMain={unreadMain}
          sidebar={sidebar}
          setSidebar={setSidebar}
          onSelectDm={(u) => { setActiveGc(null); setActiveDm(u); if (isMobile) setSidebar(false); if (u !== null) { try { ws.current?.send(JSON.stringify({ type: 'dm_history', peer: u })); } catch {} } }}
          gcs={gcs}
          activeGcId={activeGc}
          onSelectGc={(gid) => { setActiveDm(null); setActiveGc(gid || null); if (gid) { try { ws.current?.send(JSON.stringify({ type: 'gc_history', gcid: gid })); } catch {} } if (isMobile) setSidebar(false); }}
          onLogout={fullLogout}
          admins={admins}
          tags={tagsMap}
          isMobile={isMobile}
          unreadGc={unreadGc}
          userActivity={userActivity}
        />
      </div>

      {/* Mobile open button removed per revised requirements (chevron only). */}

      {/* (mobile floating toggle removed per updated design) */}

  {/* Modals */}
  <CreateGcModal open={makeGcOpen} me={me} users={users} onClose={() => setMakeGcOpen(false)} onCreate={createGc} />
  <TagModal
    open={tagOpen}
    me={me}
    users={users}
    tagsMap={tagsMap}
    tagLocks={Array.from(tagLocks)}
    isAdminEffective={isAdminEffective}
    onClose={() => setTagOpen(false)}
    onSubmit={(target: string, label: string, hex: string) => {
      try {
        const hexFlag = hex ? ` -#${hex.replace(/^#/,'')}` : '';
        const who = (!isAdminEffective || target === me) ? 'myself' : target;
        const cmd = `/tag "${who}" "${label}"${hexFlag}`;
        const threadPayload = activeGcRef.current ? { thread: 'gc', gcid: activeGcRef.current } : (activeDmRef.current ? { thread: "dm", peer: activeDmRef.current } : {});
        ws.current?.send(JSON.stringify({ text: cmd, ...threadPayload }));
      } catch {}
    }}
    onClear={(target: string) => {
      try {
        const who = (!isAdminEffective || target === me) ? me : target;
        const quoted = (who === me && !isAdminEffective) ? '' : ` "${who}"`;
        const cmd = `/rmtag${quoted}`;
        const threadPayload = activeGcRef.current ? { thread: 'gc', gcid: activeGcRef.current } : (activeDmRef.current ? { thread: "dm", peer: activeDmRef.current } : {});
        ws.current?.send(JSON.stringify({ text: cmd, ...threadPayload }));
      } catch {}
    }}
  />
  {/* Admin: Kick/Ban modals */}
  <KickBanModal
    open={kickOpen}
    me={me}
    users={users}
    admins={admins}
    tagsMap={tagsMap}
    isDevEffective={isDevMe}
    mode="kick"
    onClose={() => setKickOpen(false)}
    onSubmit={(sel: string[]) => {
      try {
        sel.forEach(u => ws.current?.send(JSON.stringify({ text: `/kick "${u}"` })));
      } catch {}
    }}
  />
  <UnbanModal
    open={unbanOpen}
    banned={bannedList}
    onClose={() => setUnbanOpen(false)}
    onSubmit={(sel: string[]) => {
      try {
        sel.forEach(u => ws.current?.send(JSON.stringify({ text: `/unban "${u}"` })));
      } catch {}
    }}
  />
  <KickBanModal
    open={banOpen}
    me={me}
    users={users}
    admins={admins}
    tagsMap={tagsMap}
    isDevEffective={isDevMe}
    mode="ban"
    onClose={() => setBanOpen(false)}
    onSubmit={(sel: string[]) => {
      try {
        sel.forEach(u => ws.current?.send(JSON.stringify({ text: `/ban "${u}"` })));
      } catch {}
    }}
  />
  {/* DEV: Admin role modal with purge */}
  <AdminRoleModal
    open={adminRoleOpen}
    me={me}
    users={users}
    admins={admins}
    tagsMap={tagsMap}
    mode={adminRoleMode}
    showPurge={isDevMe}
    onClose={() => setAdminRoleOpen(false)}
    onSubmit={(user: string, sp: string) => {
      try {
        const cmd = adminRoleMode === 'mkadmin' ? `/mkadmin "${user}" ${sp}` : `/rmadmin "${user}" ${sp}`;
        ws.current?.send(JSON.stringify({ text: cmd }));
      } catch {}
    }}
    onPurgeAdmins={() => setPurgeConfirmOpen(true)}
  />
  <MuteModal
    open={muteOpen}
    me={me}
    users={users}
    admins={admins}
    tagsMap={tagsMap}
    isDevEffective={isDevMe}
    onClose={() => setMuteOpen(false)}
    onSubmit={(sel: string[], mins: number) => {
      try {
        sel.forEach(u => ws.current?.send(JSON.stringify({ text: `/mute "${u}" ${mins}` })));
      } catch {}
    }}
  />
  <UnmuteModal
    open={unmuteOpen}
    muted={mutedList}
    onClose={() => setUnmuteOpen(false)}
    onSubmit={(sel: string[]) => {
      try { sel.forEach(u => ws.current?.send(JSON.stringify({ text: `/unmute "${u}"` }))); } catch {}
    }}
  />
  <RemoveTagModal
    open={rmtagOpen}
    me={me}
    users={users}
    admins={admins}
    tagsMap={tagsMap}
    isAdminEffective={isAdminEffective}
    isDevEffective={isDevMe}
    tagLocks={Array.from(tagLocks)}
    onClose={() => setRmtagOpen(false)}
    onSubmit={(sel: string[]) => {
      try { sel.forEach(u => ws.current?.send(JSON.stringify({ text: `/rmtag "${u}"` }))); } catch {}
    }}
  />
  <TagLockModal
    open={lockOpen}
    mode="lock"
    users={users}
    tagLocks={Array.from(tagLocks)}
    onClose={() => setLockOpen(false)}
    onSubmit={(sel: string[]) => {
      try { sel.forEach(u => ws.current?.send(JSON.stringify({ text: `/locktag "${u}"` }))); } catch {}
    }}
  />
  <TagLockModal
    open={unlockOpen}
    mode="unlock"
    users={users}
    tagLocks={Array.from(tagLocks)}
    onClose={() => setUnlockOpen(false)}
    onSubmit={(sel: string[]) => {
      try { sel.forEach(u => ws.current?.send(JSON.stringify({ text: `/unlocktag "${u}"` }))); } catch {}
    }}
  />
  <ConfirmModal
    open={purgeConfirmOpen}
    title="Are you sure?"
    body="This will demote all admins."
    onCancel={() => setPurgeConfirmOpen(false)}
    onOk={() => {
      try { ws.current?.send(JSON.stringify({ text: '/purgeadmin' })); } catch {}
      setPurgeConfirmOpen(false);
    }}
  />
  <ConfirmModal
    open={clearMainConfirm}
    title="Clear main chat?"
    body="This will remove all messages from Main for everyone."
    onCancel={() => setClearMainConfirm(false)}
    onOk={() => { try { ws.current?.send(JSON.stringify({ text: '/clear' })); } catch {} setClearMainConfirm(false); }}
  />
  <ConfirmModal
    open={clearGcConfirm}
    title="Clear this group chat?"
    body="This will remove all messages from this group for everyone."
    onCancel={() => setClearGcConfirm(false)}
    onOk={() => { const gcid = activeGcRef.current; if (gcid) { try { ws.current?.send(JSON.stringify({ text: '/clear', thread: 'gc', gcid })); } catch {} } setClearGcConfirm(false); }}
  />
  {/* DEV-only utilities */}
  <PsaModal
    open={psaOpen}
    onClose={() => setPsaOpen(false)}
    onSubmit={(msg: string) => { try { ws.current?.send(JSON.stringify({ text: `/psa "${msg}"` })); } catch {} }}
  />
  <PassModal
    open={passOpen}
    onClose={() => setPassOpen(false)}
    onSubmit={(p: string) => { try { ws.current?.send(JSON.stringify({ text: `/pass "${p}"` })); } catch {} }}
  />
  <ConfirmModal
    open={kickAllConfirm}
    title="Kick everyone?"
    body="This will force-disconnect all users except you."
    onCancel={() => setKickAllConfirm(false)}
    onOk={() => { try { ws.current?.send(JSON.stringify({ text: '/kickA' })); } catch {} setKickAllConfirm(false); }}
  />
  <MuteAllModal
    open={muteAllOpen}
    onClose={() => setMuteAllOpen(false)}
    onSubmit={(n: number) => { try { ws.current?.send(JSON.stringify({ text: `/muteA ${n}` })); } catch {} }}
  />
  <ResetModal
    open={resetOpen}
    onClose={() => setResetOpen(false)}
    onSubmit={(sp: string) => { try { ws.current?.send(JSON.stringify({ text: `/reset "${sp}"` })); } catch {} }}
  />
  <AccountModal
    open={accountOpen}
    token={token}
    onClose={() => setAccountOpen(false)}
    onUpdated={(newTok: string) => { try { localStorage.setItem("chat-token", newTok); } catch {}; location.reload(); }}
  />
  <UsersModal
    open={usersRegOpen}
    users={usersRegList}
    onClose={() => setUsersRegOpen(false)}
    mode="pick"
    onPick={(u: string) => { setAdminAcctUser(u); setAdminAcctOpen(true); }}
    onSubmit={(_sel: string[]) => { /* not used in pick mode */ }}
  />
  <PollModal
    open={pollOpen}
    onClose={() => setPollOpen(false)}
    onCreate={(question: string, options: string[]) => {
      const threadPayload = activeGcRef.current ? { thread: 'gc', gcid: activeGcRef.current } : (activeDmRef.current ? { thread: 'dm', peer: activeDmRef.current } : {});
      try { ws.current?.send(JSON.stringify({ type: 'create_poll', question, options, ...threadPayload })); } catch {}
    }}
  />
  <AdminAccountModal
    open={adminAcctOpen}
    token={token}
    username={adminAcctUser || ""}
    onClose={() => { setAdminAcctOpen(false); setAdminAcctUser(null); }}
    onSaved={() => { /* could refresh list or notify */ }}
  />
  <ConfirmModal
    open={unmuteAllConfirm}
    title="Unmute everyone?"
    body="This will lift all mutes immediately."
    onCancel={() => setUnmuteAllConfirm(false)}
    onOk={() => { try { ws.current?.send(JSON.stringify({ text: '/unmuteA' })); } catch {} setUnmuteAllConfirm(false); }}
  />
  <GcSettingsModal
    open={gcSettingsOpen}
    me={me}
    users={users}
    gc={activeGc ? gcs.find(g=>g.id===activeGc) || null : null}
    onClose={() => setGcSettingsOpen(false)}
    onSave={(name, members) => {
      if (!activeGc) return;
      // Optimistic update: reflect new name immediately in UI
      setGcs(prev => prev.map(gc => gc.id === activeGc ? { ...gc, name } : gc));
      try { ws.current?.send(JSON.stringify({ type: 'update_gc', gcid: activeGc, name, members })); } catch {}
    }}
    onDelete={() => { if (activeGc) { try { ws.current?.send(JSON.stringify({ type: 'delete_gc', gcid: activeGc })); } catch {} setGcSettingsOpen(false); } }}
  />

  {/* CHAT */}
  <main className={`flex-1 flex flex-col bg-black relative transition-[padding] duration-500 ease-in-out ${isMobile && !sidebar ? 'pl-10' : 'pl-0'}`}>
        {/* Sticky Header */}
        <div className="sticky top-0 z-10 bg-black/50 backdrop-blur-lg p-6 pb-2">
          <div>
            <h3 className="text-lg font-bold text-white tracking-wide flex items-center justify-between">
              <span>{activeGc ? `GC: ${gcs.find(g=>g.id===activeGc)?.name || 'Group'}` : (activeDm ? `DM with ${activeDm}` : "Main Chat")}</span>
              {activeGc ? (
                <div className="flex items-center">
                  {(() => {
                    const mine = gcs.find(g=>g.id===activeGc);
                    const amCreator = !!(mine && mine.creator === me);
                    return (
                      <>
                        {amCreator && (
                          <button
                            onClick={() => setClearGcConfirm(true)}
                            className="ml-2 inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl bg-red-600/90 hover:bg-red-700 text-white shadow-[0_0_10px_rgba(255,0,0,0.3)] transition-all"
                          >
                            <Trash2 className="h-3.5 w-3.5" /> Clear GC
                          </button>
                        )}
                        {amCreator && (
                          <button
                            onClick={() => setGcSettingsOpen(true)}
                            className="ml-2 inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white border border-white/10"
                            title="Group settings"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h-.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0A1.65 1.65 0 0 0 9 3.09V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0A1.65 1.65 0 0 0 20.91 9H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/></svg>
                            Settings
                          </button>
                        )}
                        {!amCreator && (
                          <button
                            onClick={() => ws.current?.send(JSON.stringify({ type: 'exit_gc', gcid: activeGc }))}
                            className="ml-2 inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl bg-red-600/90 hover:bg-red-700 text-white shadow-[0_0_10px_rgba(255,0,0,0.3)]"
                          >
                            <span className="mr-0.5">Leave</span>
                            <LogOut className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </>
                    );
                  })()}
                </div>
              ) : activeDm && (
                <div className="flex items-center">
                  <button
                    onClick={() => ws.current?.send(JSON.stringify({ text: "/clear", thread: "dm", peer: activeDm }))}
                    className="ml-3 inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl bg-red-600/90 hover:bg-red-700 text-white shadow-[0_0_10px_rgba(255,0,0,0.3)] transition-all"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Clear DM
                  </button>
                  <button
                    onClick={() => {
                      const blocked = blockedDm[activeDm] === true;
                      if (blocked) {
                        ws.current?.send(JSON.stringify({ text: `/unmutedm "${activeDm}"`, thread: "dm", peer: activeDm }));
                      } else {
                        ws.current?.send(JSON.stringify({ text: `/mutedm "${activeDm}"`, thread: "dm", peer: activeDm }));
                      }
                    }}
                    className={`ml-2 inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl border transition-all ${blockedDm[activeDm] ? "bg-red-900/40 border-red-600 text-red-300" : "bg-white/10 hover:bg-white/20 text-white border-white/10"}`}
                    title={blockedDm[activeDm] ? "Unblock this user" : "Block this user from DMing you"}
                  >
                    <Ban className="h-3.5 w-3.5" /> {blockedDm[activeDm] ? "Unblock DM" : "Block DM"}
                  </button>
                </div>
              )}
            </h3>
            <hr className="border-white/10 mt-2 mb-4" />
          </div>
          
        </div>

  <div ref={chatScrollRef} className="flex-1 min-h-0 p-6 overflow-y-auto overflow-x-hidden no-scrollbar">
          <div ref={messageListRef}>
          {activeGc ? (
            <>
              {messages.map((m, i) => {
                if (m.sender === "SYSTEM") {
                  return (
                    <div key={m.id} className="flex justify-center mb-2">
                      <div className="text-xs text-[#cfc7aa]/90 italic">{m.text || ""}</div>
                    </div>
                  );
                }
                const mine = m.sender === me;
                const first = i === 0 || messages[i - 1].sender !== m.sender;
                const canDelete = mine || isAdminEffective;
                const mime = m.mime || "";
                const isImage = typeof mime === 'string' && mime.startsWith("image");
                const isVideo = typeof mime === 'string' && mime.startsWith("video");
                const isAudio = typeof mime === 'string' && mime.startsWith("audio");
                const firstUrl = m.type === "message" ? extractFirstUrl(m.text) : null;
                const onlyLinkOnly = !!firstUrl && (m.text || "").trim() === firstUrl;
                const showUrlImg = !!firstUrl && onlyLinkOnly && isImgUrl(firstUrl);
                const showUrlVid = !!firstUrl && onlyLinkOnly && isVidUrl(firstUrl);
                const displayText = m.type === "message" ? (m.text || "").replace(/^\/ai\b/i, "@ai") : m.text;
                const mentionedCurrentUser = (m.type === "message" || m.type === "media") && mentionsMe(m.text || "");
                const shouldFlash = !mine && mentionedCurrentUser && !!flashMap[m.id];
                const alignRight = mine;
                const tagVal = (tagsMap as any)[m.sender];
                const tagObj = typeof tagVal === 'string' ? { text: tagVal, color: 'white' } : (tagVal || null);
                return (
                  <div
                    key={m.id}
                    className={`flex w-full group/message ${alignRight ? "justify-end" : "justify-start"} ${first && i !== 0 ? "mt-3" : ""} mb-2`}
                    onMouseDownCapture={(e) => {
                      if (showTrayFor === m.id) {
                        const t = e.target as HTMLElement;
                        if (!t.closest('.msg-tray') && !t.closest('.msg-dots')) {
                          setShowTrayFor(null);
                        }
                      }
                    }}
                  >
                    <div
                      ref={(el) => {
                        animateIn(el);
                        if (el) {
                          (el as any).dataset.mid = m.id;
                          messageRefs.current[m.id] = el;
                        }
                      }}
                      onMouseEnter={() => stopFlashing(m.id)}
                      onClick={() => stopFlashing(m.id)}
                      className={`relative max-w-[95%] inline-flex flex-col ${alignRight ? "items-end" : "items-start"} ${shouldFlash ? "border-2 rounded-2xl" : ""}`}
                      style={shouldFlash ? { animation: "flash-red 1.6s ease-in-out infinite", borderColor: "rgba(239,68,68,0.85)", padding: "0.16rem" } : undefined}
                    >
                      {first && (
                        <div className="flex items-baseline gap-2 mb-0.5">
                          <span className={`text-sm font-semibold ${m.sender === "AI" ? "text-blue-400" : (mine ? "text-[#e7dec3]" : "text-[#cfc7aa]")}`}>
                            {m.sender === "AI" && m.model ? `AI (${m.model})` : (
                              <>
                                {m.sender}
                                {(() => { const tv = (tagsMap as any)[m.sender]; const tobj = typeof tv === 'string' ? { text: tv, color: 'white' } : (tv || null); const isDevSender = !!(tobj && (tobj as any).special === 'dev'); return (
                                  <>
                                    {isDevSender && <span className="dev-rainbow font-semibold"> (DEV)</span>}
                                    {admins.includes(m.sender) && <span className="text-red-500 font-semibold"> (ADMIN)</span>}
                                  </>
                                ); })()}
                                {tagObj && (() => {
                                  const c = (tagObj as any).color as string | undefined;
                                  const label = String((tagObj as any).text || "");
                                  if (!label || label.toUpperCase() === 'DEV') return null;
                                  const isHex = !!(c && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(c));
                                  if ((c || '').toLowerCase() === 'rainbow') return <span className="dev-rainbow font-semibold"> ({label})</span>;
                                  if (isHex) return <span className={`font-semibold`} style={{ color: c! }}> ({label})</span>;
                                  return <span className={`${colorClass(c)} font-semibold`}> ({label})</span>;
                                })()}
                              </>
                            )}
                          </span>
                          <span className="text-xs text-[#b5ad94]">{fmtTime(m.timestamp)}{m.edited ? ' · edited' : ''}</span>
                        </div>
                      )}

                      {/* AI spinner when text is empty (match DM/Main) */}
                      {m.type === "message" && m.sender === "AI" && !(m.text && m.text.trim()) && (
                        <div className={`relative inline-block rounded-2xl px-4 py-3 break-words whitespace-pre-wrap max-w-[70vw] sm:max-w-[80ch] ${mine ? "bg-[#e7dec3]/90 text-[#1c1c1c]" : "bg-[#2b2b2b]/70 text-[#f7f3e8]"}`} style={{ wordBreak: "break-word", overflowWrap: "anywhere" }}>
                           <span className="inline-flex items-center gap-2 text-[#cfc7aa]">
                             Generating Response <Loader2 className="h-4 w-4 animate-spin" />
                           </span>
                         </div>
                       )}
                      {m.type === "message" && !(showUrlImg || showUrlVid) && !(m.sender === "AI" && !(m.text && m.text.trim())) && (
                        <div className="relative inline-block max-w-[70vw] sm:max-w-[80ch] pt-2 -mt-2">
                          <div className={`relative rounded-2xl px-4 sm:pt-3 pt-6 pb-3 break-words whitespace-pre-wrap overflow-visible ${mine ? "bg-[#e7dec3]/90 text-[#1c1c1c]" : "bg-[#2b2b2b]/70 text-[#f7f3e8]"}`} style={{ wordBreak: "break-word", overflowWrap: "anywhere" }}>
                            {m.reply_to && (
                              <div className="mb-2 flex items-center gap-2">
                                <button
                                  onClick={() => scrollToMessage(m.reply_to.id)}
                                  className={`flex-1 min-w-0 text-left text-[11px] ${mine ? 'bg-black/10 text-[#1c1c1c]/80' : 'bg-white/10 text-[#f7f3e8]/80'} border border-white/10 rounded-xl px-2 py-1`}
                                >
                                  <span className="font-semibold">{m.reply_to.sender}</span>: <span className="truncate align-top block max-w-[28ch] sm:max-w-[42ch]" title={m.reply_to.text}>{shortenReply(m.reply_to.text)}</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => scrollToMessage(m.reply_to.id)}
                                  title="Go to replied message"
                                  className="shrink-0 p-1 rounded-full text-[#cfc7aa] hover:bg-white/10 transition"
                                >
                                  <CornerDownLeft className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            )}
                            {editingId === m.id ? (
                              <div className="space-y-2">
                                <TextareaAutosize
                                  value={editingText}
                                  onChange={e=>setEditingText(e.target.value)}
                                  onKeyDown={e => {
                                    e.stopPropagation();
                                    if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
                                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(); }
                                  }}
                                  className="w-full bg-transparent border border-white/20 rounded-md px-2 py-1 text-sm text-inherit"
                                />
                                <div className="flex gap-2 justify-end">
                                  <button onClick={cancelEdit} className="text-xs text-black">Cancel</button>
                                  <button onClick={saveEdit} className="text-xs text-black px-2 py-0.5 rounded">Save</button>
                                </div>
                              </div>
                            ) : (
                              <>
                                {renderRichText(displayText || "")}
                                {m.edited && (
                                  <span className="ml-1 inline-block align-baseline text-[10px] font-medium opacity-70 select-none">(edited)</span>
                                )}
                              </>
                            )}
                            {/* Desktop (xl+): tray anchored to bubble to prevent vertical drift from reaction rows */}
                            <div className={`hidden xl:block absolute z-30 top-1/2 -translate-y-1/2 ${alignRight ? 'right-full mr-2' : 'left-full ml-2'}`}>
                              <div className="msg-tray flex items-center gap-1 bg-black/80 border border-white/15 backdrop-blur-sm shadow-lg px-2 py-1 rounded-2xl opacity-0 pointer-events-none transition-all duration-200 ease-out group-hover/message:opacity-100 group-hover/message:pointer-events-auto">
                                <button type="button" onClick={() => { startReply(m); }} title="Reply" className={`p-1 rounded-full ${mine ? 'text-white/90' : 'text-[#cfc7aa]'} hover:bg-white/10 transition`}><CornerDownLeft className="h-3.5 w-3.5" /></button>
                                {mine && m.type === 'message' && (
                                  <button type="button" onClick={() => { beginEdit(m); }} title="Edit" className="p-1 rounded-full text-[#cfc7aa] hover:bg-white/10 transition"><Pencil className="h-3.5 w-3.5" /></button>
                                )}
                                <button type="button"
                                  onClick={(e) => {
                                    const keys = m.reactions ? Object.keys(m.reactions) : [];
                                    if (keys.length >= 5) { showAlert('You can only add up to 5 reactions'); return; }
                                    openReactionPicker(e, m.id);
                                  }}
                                  title="React"
                                  className="p-1 rounded-full text-[#cfc7aa] hover:bg-white/10 transition"
                                >
                                  <Smile className="h-3.5 w-3.5" />
                                </button>
                                {canDelete && (
                                  <button type="button" onClick={() => { deleteMsg(m.id); }} title="Delete" className="p-1 rounded-full text-red-500 hover:bg-white/10 transition"><Trash2 className="h-3.5 w-3.5" strokeWidth={2.25} /></button>
                                )}
                              </div>
                            </div>
                          </div>
                          {/* Mobile actions toggle + anchored popover (outside bubble to avoid clipping) */}
                          <div className={`xl:hidden absolute top-0 ${alignRight ? 'right-0 translate-x-1' : 'left-0 -translate-x-1'} z-30`}>
                            <button
                              type="button"
                              onClick={() => setShowTrayFor(prev => prev === m.id ? null : m.id)}
                              className="msg-dots group p-0.5 rounded-full bg-black/60 text-[#e7dec3] ring-1 ring-white/10"
                              aria-label={showTrayFor === m.id ? "Close actions" : "Message actions"}
                            >
                              <span className="relative block h-4 w-4">
                                <MoreHorizontal className={`absolute inset-0 h-4 w-4 transition-all duration-150 ease-out ${showTrayFor === m.id ? 'opacity-0 scale-75' : 'opacity-100 scale-100'}`} />
                                <X className={`absolute inset-0 h-4 w-4 transition-all duration-150 ease-out transform ${showTrayFor === m.id ? 'opacity-100 scale-100 group-hover:rotate-90' : 'opacity-0 scale-75'}`} />
                              </span>
                            </button>
                            {showTrayFor === m.id && (
                              <>
                                <div className={`absolute top-1/2 -translate-y-1/2 ${alignRight ? 'right-full mr-0' : 'left-full ml-0'} z-30`}>
                                  <div className="msg-tray flex items-center gap-1 bg-black/70 border border-white/10 backdrop-blur-md shadow-lg px-2 py-1 rounded-2xl transition-all duration-150 ease-out">
                                    <button type="button" onClick={() => { startReply(m); setShowTrayFor(null); }} title="Reply" className={`p-1 rounded-full ${mine ? 'text-white/90' : 'text-[#cfc7aa]'} hover:bg-white/10 transition`}><CornerDownLeft className="h-3.5 w-3.5" /></button>
                                    {mine && m.type === 'message' && (
                                      <button type="button" onClick={() => { beginEdit(m); setShowTrayFor(null); }} title="Edit" className="p-1 rounded-full text-[#cfc7aa] hover:bg-white/10 transition"><Pencil className="h-3.5 w-3.5" /></button>
                                    )}
                                    <button type="button"
                                      onClick={(e) => {
                                        const keys = m.reactions ? Object.keys(m.reactions) : [];
                                        if (keys.length >= 5) { showAlert('You can only add up to 5 reactions'); return; }
                                        setShowTrayFor(null);
                                        openReactionPicker(e, m.id);
                                      }}
                                      title="React"
                                      className="p-1 rounded-full text-[#cfc7aa] hover:bg-white/10 transition"
                                    >
                                      <Smile className="h-3.5 w-3.5" />
                                    </button>
                                    {canDelete && (
                                      <button type="button" onClick={() => { deleteMsg(m.id); setShowTrayFor(null); }} title="Delete" className="p-1 rounded-full text-red-500 hover:bg-white/10 transition"><Trash2 className="h-3.5 w-3.5" strokeWidth={2.25} /></button>
                                    )}
                                  </div>
                                </div>
                              </>
                            )}
                          </div>
                          
                          
                          {/* Reactions row */}
                          {m.reactions && Object.values(m.reactions).some((arr: any) => Array.isArray(arr) && arr.length > 0) && (
                            <div className="mt-1.5 flex items-center gap-1">
                              {Object.keys(m.reactions).map((emo: any) => {
                                const users: string[] = m.reactions[emo] || [];
                                if (!users.length) return null;
                                const mineReact = users.includes(me);
                                const title = `${users.join(', ')} reacted`;
                                return (
                                  <button key={emo} title={title} onClick={() => reactTo(m.id, emo)} className={`px-2 py-0.5 rounded-full text-xs border ${mineReact ? 'bg-white/20 border-white/30' : 'bg-white/10 border-white/10'} text-[#e7dec3]`}>{emo} {users.length}</button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}

                      {m.type === "poll" && (
                        <div className="relative">
                          {renderPoll(m, { thread: 'gc', gcid: activeGcRef.current })}
                          {canDelete && (
                            <button onClick={() => deleteMsg(m.id)} title="Delete" className={`absolute -top-2 -right-2 opacity-0 group-hover:opacity-100 hover:opacity-100 focus:opacity-100 transition p-1 rounded-full bg-black text-red-500 shadow-md z-30 ring-1 ring-white/15 pointer-events-auto`}>
                              <Trash2 className="h-3 w-3" strokeWidth={2.25} />
                            </button>
                          )}
                        </div>
                      )}

                      {m.type === "message" && (showUrlImg || showUrlVid) && (
                        <div className="relative inline-block">
                          {showUrlImg ? (
                            <img src={firstUrl!} className="max-w-[70vw] sm:max-w-[80ch] rounded-xl" />
                          ) : (
                            <video src={firstUrl!} controls className="max-w-[70vw] sm:max-w-[80ch] rounded-xl" />
                          )}
                          {canDelete && (
                            <button onClick={() => deleteMsg(m.id)} title="Delete" className="absolute -top-2 -right-2 opacity-0 group-hover:opacity-100 hover:opacity-100 focus:opacity-100 transition p-1 rounded-full bg-black text-red-500 shadow-md z-30 ring-1 ring-white/15 pointer-events-auto">
                              <Trash2 className="h-3 w-3" strokeWidth={2.25} />
                            </button>
                          )}
                        </div>
                      )}

                      {/* Media message (image/video/audio) with actions + reactions */}
                      {m.type === "media" && (
                        <div className="relative inline-block">
                          {isImage ? (
                            <img src={full(m.url)} className="max-w-[70vw] sm:max-w-[80ch] rounded-xl" />
                          ) : isVideo ? (
                            <video src={full(m.url)} controls className="max-w-[70vw] sm:max-w-[80ch] rounded-xl" />
                          ) : isAudio ? (
                            <audio src={full(m.url)} controls className="w-[85vw] max-w-[80ch]" />
                          ) : (
                            <a href={full(m.url)} target="_blank" className={`block rounded-2xl px-4 py-3 ${mine ? "bg-[#e7dec3]/90 text-[#1c1c1c]" : "bg-[#2b2b2b]/70 text-[#f7f3e8]"} underline`}>Download file ({m.mime || "file"})</a>
                          )}
                          {/* Mobile actions toggle + anchored popover */}
                          <div className={`xl:hidden absolute top-0 ${alignRight ? 'right-0 translate-x-1' : 'left-0 -translate-x-1'} z-30`}>
                            <button
                              type="button"
                              onClick={() => setShowTrayFor(prev => prev === m.id ? null : m.id)}
                              className="msg-dots group p-0.5 rounded-full bg-black/60 text-[#e7dec3] ring-1 ring-white/10"
                              aria-label={showTrayFor === m.id ? "Close actions" : "Message actions"}
                            >
                              <span className="relative block h-4 w-4">
                                <MoreHorizontal className={`absolute inset-0 h-4 w-4 transition-all duration-150 ease-out ${showTrayFor === m.id ? 'opacity-0 scale-75' : 'opacity-100 scale-100'}`} />
                                <X className={`absolute inset-0 h-4 w-4 transition-all duration-150 ease-out transform ${showTrayFor === m.id ? 'opacity-100 scale-100 group-hover:rotate-90' : 'opacity-0 scale-75'}`} />
                              </span>
                            </button>
                            {showTrayFor === m.id && (
                              <>
                                <div className={`absolute top-1/2 -translate-y-1/2 ${alignRight ? 'right-full mr-0' : 'left-full ml-0'} z-30`}>
                                  <div className="msg-tray flex items-center gap-1 bg-black/70 border border-white/10 backdrop-blur-md shadow-lg px-2 py-1 rounded-2xl transition-all duration-150 ease-out">
                                    <button type="button" onClick={() => { startReply(m); setShowTrayFor(null); }} title="Reply" className={`p-1 rounded-full ${mine ? 'text-white/90' : 'text-[#cfc7aa]'} hover:bg-white/10 transition`}><CornerDownLeft className="h-3.5 w-3.5" /></button>
                                    <button type="button"
                                      onClick={(e) => {
                                        const keys = m.reactions ? Object.keys(m.reactions) : [];
                                        if (keys.length >= 5) { showAlert('You can only add up to 5 reactions'); return; }
                                        setShowTrayFor(null);
                                        openReactionPicker(e, m.id);
                                      }}
                                      title="React"
                                      className="p-1 rounded-full text-[#cfc7aa] hover:bg-white/10 transition"
                                    >
                                      <Smile className="h-3.5 w-3.5" />
                                    </button>
                                    {canDelete && (
                                      <button type="button" onClick={() => { deleteMsg(m.id); setShowTrayFor(null); }} title="Delete" className="p-1 rounded-full text-red-500 hover:bg-white/10 transition"><Trash2 className="h-3.5 w-3.5" strokeWidth={2.25} /></button>
                                    )}
                                  </div>
                                </div>
                              </>
                            )}
                          </div>
                          {/* Desktop (xl+): side action tray on hover (DM media) */}
                          <div className="hidden xl:block absolute top-1 right-0 z-20">
                            <div className="msg-tray flex items-center gap-1 bg-black/80 border border-white/15 backdrop-blur-sm shadow-lg px-2 py-1 rounded-2xl opacity-0 pointer-events-none transition-all duration-200 ease-out group-hover/message:opacity-100 group-hover/message:pointer-events-auto">
                              <button onClick={() => { startReply(m); }} title="Reply" className={`p-1 rounded-full ${mine ? 'text-white/90' : 'text-[#cfc7aa]'} hover:bg-white/10 transition`}><CornerDownLeft className="h-3 w-3" /></button>
                              <button
                                onClick={(e) => {
                                  const keys = m.reactions ? Object.keys(m.reactions) : [];
                                  if (keys.length >= 5) { showAlert('You can only add up to 5 reactions'); return; }
                                  openReactionPicker(e, m.id);
                                }}
                                title="React"
                                className="p-1 rounded-full text-[#cfc7aa] hover:bg-white/10 transition"
                              >
                                <Smile className="h-3 w-3" />
                              </button>
                              {canDelete && (
                                <button onClick={() => { deleteMsg(m.id); }} title="Delete" className="p-1 rounded-full text-red-500 hover:bg-white/10 transition"><Trash2 className="h-3 w-3" strokeWidth={2.25} /></button>
                              )}
                            </div>
                          </div>
                          {/* Desktop (xl+): side action tray on hover (GC media) */}
                          <div className={`hidden xl:block absolute z-30 top-1/2 -translate-y-1/2 ${alignRight ? 'right-full mr-2' : 'left-full ml-2'}`}>
                            <div className="msg-tray flex items-center gap-1 bg-black/80 border border-white/15 backdrop-blur-sm shadow-lg px-2 py-1 rounded-2xl opacity-0 pointer-events-none transition-all duration-200 ease-out group-hover/message:opacity-100 group-hover/message:pointer-events-auto">
                              <button type="button" onClick={() => { startReply(m); }} title="Reply" className={`p-1 rounded-full ${mine ? 'text-white/90' : 'text-[#cfc7aa]'} hover:bg-white/10 transition`}><CornerDownLeft className="h-3.5 w-3.5" /></button>
                              <button type="button"
                                onClick={(e) => {
                                  const keys = m.reactions ? Object.keys(m.reactions) : [];
                                  if (keys.length >= 5) { showAlert('You can only add up to 5 reactions'); return; }
                                  openReactionPicker(e, m.id);
                                }}
                                title="React"
                                className="p-1 rounded-full text-[#cfc7aa] hover:bg-white/10 transition"
                              >
                                <Smile className="h-3.5 w-3.5" />
                              </button>
                              {canDelete && (
                                <button type="button" onClick={() => { deleteMsg(m.id); }} title="Delete" className="p-1 rounded-full text-red-500 hover:bg-white/10 transition"><Trash2 className="h-3.5 w-3.5" strokeWidth={2.25} /></button>
                              )}
                            </div>
                          </div>
                          {/* Reactions row */}
                          {m.reactions && Object.values(m.reactions).some((arr: any) => Array.isArray(arr) && arr.length > 0) && (
                            <div className="mt-1.5 flex items-center gap-1">
                              {Object.keys(m.reactions).map((emo: any) => {
                                const users: string[] = m.reactions[emo] || [];
                                if (!users.length) return null;
                                const mineReact = users.includes(me);
                                const title = `${users.join(', ')} reacted`;
                                return (
                                  <button key={emo} title={title} onClick={() => reactTo(m.id, emo)} className={`px-2 py-0.5 rounded-full text-xs border ${mineReact ? 'bg-white/20 border-white/30' : 'bg-white/10 border-white/10'} text-[#e7dec3]`}>{emo} {users.length}</button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              {typingUser && (
                <div
                  className={`mt-1 mb-2 text-m text-[#cfc7aa]/70 italic transition-all duration-250 ease-out ${typingVisible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-0.5"}`}
                  style={{ willChange: "opacity, transform" }}
                >
                  {typingUser} is typing
                  <span className="inline-flex w-6 ml-1">
                    <span style={{ animation: "typing-dot 1.1s infinite ease-in-out", animationDelay: "0ms" }}>.</span>
                    <span style={{ animation: "typing-dot 1.1s infinite ease-in-out", animationDelay: "200ms" }}>.</span>
                    <span style={{ animation: "typing-dot 1.1s infinite ease-in-out", animationDelay: "300ms" }}>.</span>
                  </span>
                </div>
              )}
              <div ref={bottomRef} />
            </>
          ) : activeDm ? (
            <>
              {messages.map((m, i) => {
                if (m.sender === "SYSTEM") {
                  return (
                    <div key={m.id} className="flex justify-center mb-2">
                      <div className="text-xs text-[#cfc7aa]/90 italic">{m.text || ""}</div>
                    </div>
                  );
                }
                const mine = m.sender === me;
                const first = i === 0 || messages[i - 1].sender !== m.sender;
                // Only show delete if it's my own message or I'm admin/dev
                const canDelete = mine || isAdminEffective;
                const mime = m.mime || "";
                const isImage = typeof mime === "string" && mime.startsWith("image");
                const isVideo = typeof mime === "string" && mime.startsWith("video");
                const isAudio = typeof mime === "string" && mime.startsWith("audio");
                const firstUrl = m.type === "message" ? extractFirstUrl(m.text) : null;
                const onlyLinkOnly = !!firstUrl && (m.text || "").trim() === firstUrl;
                const showUrlImg = !!firstUrl && onlyLinkOnly && isImgUrl(firstUrl);
                const showUrlVid = !!firstUrl && onlyLinkOnly && isVidUrl(firstUrl);
                const displayText = m.type === "message" ? (m.text || "").replace(/^\/ai\b/i, "@ai") : m.text;
                const mentionedCurrentUser = (m.type === "message" || m.type === "media") && mentionsMe(m.text || "");
                const shouldFlash = !mine && mentionedCurrentUser && !!flashMap[m.id];
                const alignRight = mine; // keep AI spinner on the left
                // resolve tag for sender
                const tagVal = (tagsMap as any)[m.sender];
                const tagObj = typeof tagVal === 'string' ? { text: tagVal, color: 'white' } : (tagVal || null);
                return (
                  <div
                    key={m.id}
                    className={`flex w-full group/message ${alignRight ? "justify-end" : "justify-start"} ${first && i !== 0 ? "mt-3" : ""} mb-2`}
                    onMouseDownCapture={(e) => {
                      if (showTrayFor === m.id) {
                        const t = e.target as HTMLElement;
                        if (!t.closest('.msg-tray') && !t.closest('.msg-dots')) {
                          setShowTrayFor(null);
                        }
                      }
                    }}
                  >
                    <div
                      ref={(el) => {
                        animateIn(el);
                        if (el) {
                          (el as any).dataset.mid = m.id;
                          messageRefs.current[m.id] = el;
                        }
                      }}
                      onMouseEnter={() => stopFlashing(m.id)}
                      onClick={() => stopFlashing(m.id)}
                      className={`relative max-w-[95%] inline-flex flex-col ${alignRight ? "items-end" : "items-start"} ${shouldFlash ? "border-2 rounded-2xl" : ""}`}
                      style={shouldFlash ? { animation: "flash-red 1.6s ease-in-out infinite", borderColor: "rgba(239,68,68,0.85)", padding: "0.16rem" } : undefined}
                    >
                      {first && (
                        <div className="flex items-baseline gap-2 mb-0.5">
                          <span className={`text-sm font-semibold ${m.sender === "AI" ? "text-blue-400" : (mine ? "text-[#e7dec3]" : "text-[#cfc7aa]")}`}>
                            {m.sender === "AI" && m.model ? `AI (${m.model})` : (
                              <>
                                {m.sender}
                                {(() => { const tv = (tagsMap as any)[m.sender]; const tobj = typeof tv === 'string' ? { text: tv, color: 'white' } : (tv || null); const isDevSender = !!(tobj && (tobj as any).special === 'dev'); return (
                                  <>
                                    {isDevSender && <span className="dev-rainbow font-semibold"> (DEV)</span>}
                                    {admins.includes(m.sender) && <span className="text-red-500 font-semibold"> (ADMIN)</span>}
                                  </>
                                ); })()}
                                {tagObj && (() => {
                                  const c = (tagObj as any).color as string | undefined;
                                  const label = String((tagObj as any).text || "");
                                  if (!label || label.toUpperCase() === 'DEV') return null;
                                  const isHex = !!(c && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(c));
                                  if ((c || '').toLowerCase() === 'rainbow') return <span className="dev-rainbow font-semibold"> ({label})</span>;
                                  if (isHex) return <span className={`font-semibold`} style={{ color: c! }}> ({label})</span>;
                                  return <span className={`${colorClass(c)} font-semibold`}> ({label})</span>;
                                })()}
                              </>
                            )}
                          </span>
                          <span className="text-xs text-[#b5ad94]">{fmtTime(m.timestamp)}{m.edited ? ' · edited' : ''}</span>
                        </div>
                      )}

                      {/* AI spinner when text is empty */}
                      {m.type === "message" && m.sender === "AI" && !(m.text && m.text.trim()) && (
                        <div className={`relative inline-block rounded-2xl px-4 py-3 break-words whitespace-pre-wrap max-w-[70vw] sm:max-w-[80ch] ${mine ? "bg-[#e7dec3]/90 text-[#1c1c1c]" : "bg-[#2b2b2b]/70 text-[#f7f3e8]"}`} style={{ wordBreak: "break-word", overflowWrap: "anywhere" }}>
                           <span className="inline-flex items-center gap-2 text-[#cfc7aa]">
                             Generating Response <Loader2 className="h-4 w-4 animate-spin" />
                           </span>
                         </div>
                       )}
                      {m.type === "message" && !(showUrlImg || showUrlVid) && !(m.sender === "AI" && !(m.text && m.text.trim())) && (
                        <div className="relative inline-block max-w-[70vw] sm:max-w-[80ch] pt-2 -mt-2">
                          <div className={`relative rounded-2xl px-4 sm:pt-3 pt-6 pb-3 break-words whitespace-pre-wrap overflow-visible ${mine ? "bg-[#e7dec3]/90 text-[#1c1c1c]" : "bg-[#2b2b2b]/70 text-[#f7f3e8]"}`} style={{ wordBreak: "break-word", overflowWrap: "anywhere" }}>
                            {m.reply_to && (
                              <div className="mb-2 flex items-center gap-2">
                                <button
                                  onClick={() => scrollToMessage(m.reply_to.id)}
                                  className={`flex-1 min-w-0 text-left text-[11px] ${mine ? 'bg-black/10 text-[#1c1c1c]/80' : 'bg-white/10 text-[#f7f3e8]/80'} border border-white/10 rounded-xl px-2 py-1`}
                                >
                                  <span className="font-semibold">{m.reply_to.sender}</span>: <span className="truncate align-top block max-w-[28ch] sm:max-w-[42ch]" title={m.reply_to.text}>{shortenReply(m.reply_to.text)}</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => scrollToMessage(m.reply_to.id)}
                                  title="Go to replied message"
                                  className="shrink-0 p-1 rounded-full text-[#cfc7aa] hover:bg-white/10 transition"
                                >
                                  <CornerDownLeft className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            )}
                            {editingId === m.id ? (
                              <div className="space-y-2">
                                <TextareaAutosize
                                  value={editingText}
                                  onChange={e=>setEditingText(e.target.value)}
                                  onKeyDown={e => {
                                    e.stopPropagation();
                                    if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
                                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(); }
                                  }}
                                  className="w-full bg-transparent border border-white/20 rounded-md px-2 py-1 text-sm text-inherit"
                                />
                                <div className="flex gap-2 justify-end">
                                  <button type="button" onClick={cancelEdit} className="text-xs text-black">Cancel</button>
                                  <button type="button" onClick={saveEdit} className="text-xs text-black px-2 py-0.5 rounded">Save</button>
                                </div>
                              </div>
                            ) : (
                              <>
                                {renderRichText(displayText || "")}
                                {m.edited && (
                                  <span className="ml-1 inline-block align-baseline text-[10px] font-medium opacity-70 select-none">(edited)</span>
                                )}
                              </>
                            )}
                            {/* Desktop (xl+): tray anchored to bubble (DM text) to prevent vertical drift */}
                            <div className={`hidden xl:block absolute z-30 top-1/2 -translate-y-1/2 ${alignRight ? 'right-full mr-2' : 'left-full ml-2'}`}>
                              <div className="msg-tray flex items-center gap-1 bg-black/80 border border-white/15 backdrop-blur-sm shadow-lg px-2 py-1 rounded-2xl opacity-0 pointer-events-none transition-all duration-200 ease-out group-hover/message:opacity-100 group-hover/message:pointer-events-auto">
                                <button type="button" onClick={() => { startReply(m); }} title="Reply" className={`p-1 rounded-full ${mine ? 'text-white/90' : 'text-[#cfc7aa]'} hover:bg-white/10 transition`}><CornerDownLeft className="h-3.5 w-3.5" /></button>
                                <button type="button"
                                  onClick={(e) => {
                                    const keys = m.reactions ? Object.keys(m.reactions) : [];
                                    if (keys.length >= 5) { showAlert('You can only add up to 5 reactions'); return; }
                                    openReactionPicker(e, m.id);
                                  }}
                                  title="React"
                                  className="p-1 rounded-full text-[#cfc7aa] hover:bg-white/10 transition"
                                >
                                  <Smile className="h-3.5 w-3.5" />
                                </button>
                                {mine && m.type === 'message' && (
                                  <button type="button" onClick={() => { beginEdit(m); }} title="Edit" className="p-1 rounded-full text-[#cfc7aa] hover:bg-white/10 transition"><Pencil className="h-3.5 w-3.5" /></button>
                                )}
                                {canDelete && (
                                  <button type="button" onClick={() => { deleteMsg(m.id); }} title="Delete" className="p-1 rounded-full text-red-500 hover:bg-white/10 transition"><Trash2 className="h-3.5 w-3.5" strokeWidth={2.25} /></button>
                                )}
                              </div>
                            </div>
                          </div>
                          {/* Mobile actions toggle + anchored popover (outside bubble to avoid clipping) */}
                          <div className={`xl:hidden absolute top-0 ${alignRight ? 'right-0 translate-x-1' : 'left-0 -translate-x-1'} z-30`}>
                            <button
                              type="button"
                              onClick={() => setShowTrayFor(prev => prev === m.id ? null : m.id)}
                              className="msg-dots group p-0.5 rounded-full bg-black/60 text-[#e7dec3] ring-1 ring-white/10"
                              aria-label={showTrayFor === m.id ? "Close actions" : "Message actions"}
                            >
                              <span className="relative block h-4 w-4">
                                <MoreHorizontal className={`absolute inset-0 h-4 w-4 transition-all duration-150 ease-out ${showTrayFor === m.id ? 'opacity-0 scale-75' : 'opacity-100 scale-100'}`} />
                                <X className={`absolute inset-0 h-4 w-4 transition-all duration-150 ease-out transform ${showTrayFor === m.id ? 'opacity-100 scale-100 group-hover:rotate-90' : 'opacity-0 scale-75'}`} />
                              </span>
                            </button>
                            {showTrayFor === m.id && (
                              <>
                                <div className="fixed inset-0 z-20" onClick={() => setShowTrayFor(null)} />
                                <div className={`absolute top-1/2 -translate-y-1/2 ${alignRight ? 'right-full mr-0' : 'left-full ml-0'} z-30`}>
                                  <div className="msg-tray flex items-center gap-1 bg-black/70 border border-white/10 backdrop-blur-md shadow-lg px-2 py-1 rounded-2xl transition-all duration-150 ease-out">
                                    <button type="button" onClick={() => { startReply(m); setShowTrayFor(null); }} title="Reply" className={`p-1 rounded-full ${mine ? 'text-white/90' : 'text-[#cfc7aa]'} hover:bg-white/10 transition`}><CornerDownLeft className="h-3.5 w-3.5" /></button>
                                    <button type="button"
                                      onClick={(e) => {
                                        const keys = m.reactions ? Object.keys(m.reactions) : [];
                                        if (keys.length >= 5) { showAlert('You can only add up to 5 reactions'); return; }
                                        setShowTrayFor(null);
                                        openReactionPicker(e, m.id);
                                      }}
                                      title="React"
                                      className="p-1 rounded-full text-[#cfc7aa] hover:bg-white/10 transition"
                                    >
                                      <Smile className="h-3.5 w-3.5" />
                                    </button>
                                    {mine && m.type === 'message' && (
                                      <button type="button" onClick={() => { beginEdit(m); setShowTrayFor(null); }} title="Edit" className="p-1 rounded-full text-[#cfc7aa] hover:bg-white/10 transition"><Pencil className="h-3.5 w-3.5" /></button>
                                    )}
                                    {canDelete && (
                                      <button type="button" onClick={() => { deleteMsg(m.id); setShowTrayFor(null); }} title="Delete" className="p-1 rounded-full text-red-500 hover:bg-white/10 transition"><Trash2 className="h-3.5 w-3.5" strokeWidth={2.25} /></button>
                                    )}
                                  </div>
                                </div>
                              </>
                            )}
                          </div>
                          
                          
                          {/* Reactions row */}
                          {m.reactions && Object.values(m.reactions).some((arr: any) => Array.isArray(arr) && arr.length > 0) && (
                            <div className="mt-1.5 flex items-center gap-1">
                              {Object.keys(m.reactions).map((emo: any) => {
                                const users: string[] = m.reactions[emo] || [];
                                if (!users.length) return null;
                                const mineReact = users.includes(me);
                                const title = `${users.join(', ')} reacted`;
                                return (
                                  <button key={emo} title={title} onClick={() => reactTo(m.id, emo)} className={`px-2 py-0.5 rounded-full text-xs border ${mineReact ? 'bg-white/20 border-white/30' : 'bg-white/10 border-white/10'} text-[#e7dec3]`}>{emo} {users.length}</button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}

                      {m.type === "poll" && (
                        <div className="relative">
                          {renderPoll(m, { thread: 'dm', peer: activeDmRef.current })}
                          {canDelete && (
                            <button
                              onClick={() => deleteMsg(m.id)}
                              title="Delete"
                              className={`absolute -top-2 -right-2 opacity-0 group-hover:opacity-100 hover:opacity-100 focus:opacity-100 transition p-1 rounded-full bg-black text-red-500 shadow-md z-30 ring-1 ring-white/15 pointer-events-auto`}
                            >
                              <Trash2 className="h-3 w-3" strokeWidth={2.25} />
                            </button>
                          )}
                        </div>
                      )}

                      {/* Spotify Preview */}
                      {m.spotify_preview_html && <SpotifyPreview htmlContent={m.spotify_preview_html} />}

                      {/* YouTube Preview */}
                      {m.youtube_preview_html && <YouTubePreview htmlContent={m.youtube_preview_html} />}

                      {/* URL preview bubble for pure links */}
                      {m.type === "message" && (showUrlImg || showUrlVid) && (
                        <div className="relative inline-block">
                          {showUrlImg ? (
                            <img src={firstUrl!} className="max-w-[70vw] sm:max-w-[80ch] rounded-xl" />
                          ) : (
                            <video src={firstUrl!} controls className="max-w-[70vw] sm:max-w-[80ch] rounded-xl" />
                          )}
                          {canDelete && (
                            <button
                              onClick={() => deleteMsg(m.id)}
                              title="Delete"
                              className="absolute -top-2 -right-2 opacity-0 group-hover:opacity-100 hover:opacity-100 focus:opacity-100 transition p-1 rounded-full bg-black text-red-500 shadow-md z-30 ring-1 ring-white/15 pointer-events-auto"
                            >
                              <Trash2 className="h-3 w-3" strokeWidth={2.25} />
                            </button>
                          )}
                        </div>
                      )}

                      {/* Media message (image/video/audio) with actions + reactions */}
                      {m.type === "media" && (
                        <div className="relative inline-block">
                          {isImage ? (
                            <img src={full(m.url)} className="max-w-[70vw] sm:max-w-[80ch] rounded-xl" />
                          ) : isVideo ? (
                            <video src={full(m.url)} controls className="max-w-[70vw] sm:max-w-[80ch] rounded-xl" />
                          ) : isAudio ? (
                            <audio src={full(m.url)} controls className="w-[85vw] max-w-[80ch]" />
                          ) : (
                            <a href={full(m.url)} target="_blank" className={`block rounded-2xl px-4 py-3 ${mine ? "bg-[#e7dec3]/90 text-[#1c1c1c]" : "bg-[#2b2b2b]/70 text-[#f7f3e8]"} underline`}>Download file ({m.mime || "file"})</a>
                          )}
                          {/* Mobile actions toggle + anchored popover; desktop shows on hover via separate tray below */}
                          <div className={`xl:hidden absolute top-0 ${alignRight ? 'right-0 translate-x-1' : 'left-0 -translate-x-1'} z-30`}>
                            <button
                              type="button"
                              onClick={() => setShowTrayFor(prev => prev === m.id ? null : m.id)}
                              className="msg-dots group p-0.5 rounded-full bg-black/60 text-[#e7dec3] ring-1 ring-white/10"
                              aria-label={showTrayFor === m.id ? "Close actions" : "Message actions"}
                            >
                              <span className="relative block h-4 w-4">
                                <MoreHorizontal className={`absolute inset-0 h-4 w-4 transition-all duration-150 ease-out ${showTrayFor === m.id ? 'opacity-0 scale-75' : 'opacity-100 scale-100'}`} />
                                <X className={`absolute inset-0 h-4 w-4 transition-all duration-150 ease-out transform ${showTrayFor === m.id ? 'opacity-100 scale-100 group-hover:rotate-90' : 'opacity-0 scale-75'}`} />
                              </span>
                            </button>
                            {showTrayFor === m.id && (
                              <>
                                <div className="fixed inset-0 z-20" onClick={() => setShowTrayFor(null)} />
                                <div className={`absolute top-1/2 -translate-y-1/2 ${alignRight ? 'right-full mr-0' : 'left-full ml-0'} z-30`}>
                                  <div className="msg-tray flex items-center gap-1 bg-black/70 border border-white/10 backdrop-blur-md shadow-lg px-2 py-1 rounded-2xl transition-all duration-150 ease-out">
                                    <button onClick={() => { startReply(m); setShowTrayFor(null); }} title="Reply" className={`p-1 rounded-full ${mine ? 'text-white/90' : 'text-[#cfc7aa]'} hover:bg-white/10 transition`}><CornerDownLeft className="h-3 w-3" /></button>
                                    <button
                                      onClick={(e) => {
                                        const keys = m.reactions ? Object.keys(m.reactions) : [];
                                        if (keys.length >= 5) { showAlert('You can only add up to 5 reactions'); return; }
                                        setShowTrayFor(null);
                                        openReactionPicker(e, m.id);
                                      }}
                                      title="React"
                                      className="p-1 rounded-full text-[#cfc7aa] hover:bg-white/10 transition"
                                    >
                                      <Smile className="h-3 w-3" />
                                    </button>
                                    {canDelete && (
                                      <button onClick={() => { deleteMsg(m.id); setShowTrayFor(null); }} title="Delete" className="p-1 rounded-full text-red-500 hover:bg-white/10 transition"><Trash2 className="h-3 w-3" strokeWidth={2.25} /></button>
                                    )}
                                  </div>
                                </div>
                              </>
                            )}
                          </div>
                          {/* Reactions row */}
                          {m.reactions && Object.values(m.reactions).some((arr: any) => Array.isArray(arr) && arr.length > 0) && (
                            <div className="mt-1.5 flex items-center gap-1">
                              {Object.keys(m.reactions).map((emo: any) => {
                                const users: string[] = m.reactions[emo] || [];
                                if (!users.length) return null;
                                const mineReact = users.includes(me);
                                const title = `${users.join(', ')} reacted`;
                                return (
                                  <button key={emo} title={title} onClick={() => reactTo(m.id, emo)} className={`px-2 py-0.5 rounded-full text-xs border ${mineReact ? 'bg-white/20 border-white/30' : 'bg-white/10 border-white/10'} text-[#e7dec3]`}>{emo} {users.length}</button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              {typingUser && (
                <div
                  className={`mt-1 mb-2 text-m text-[#cfc7aa]/70 italic transition-all duration-250 ease-out ${typingVisible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-0.5"}`}
                  style={{ willChange: "opacity, transform" }}
                >
                  {typingUser} is typing
                  <span className="inline-flex w-6 ml-1">
                    <span style={{ animation: "typing-dot 1.1s infinite ease-in-out", animationDelay: "0ms" }}>.</span>
                    <span style={{ animation: "typing-dot 1.1s infinite ease-in-out", animationDelay: "200ms" }}>.</span>
                    <span style={{ animation: "typing-dot 1.1s infinite ease-in-out", animationDelay: "300ms" }}>.</span>
                  </span>
                </div>
              )}
              <div ref={bottomRef} />
            </>
          ) : (
            <>
              {messages.map((m, i) => {
                if (m.sender === "SYSTEM") {
                  return (
                    <div key={m.id} className="flex justify-center mb-2">
                      <div className="text-xs text-[#cfc7aa]/90 italic">{m.text || ""}</div>
                    </div>
                  );
                }
                const mine = m.sender === me;
                const first = i === 0 || messages[i - 1].sender !== m.sender;
                // Only show delete if it's my own message or I'm admin/dev (Main)
                const canDelete = mine || isAdminEffective;
                const mime = m.mime || "";
                const isImage = typeof mime === "string" && mime.startsWith("image");
                const isVideo = typeof mime === "string" && mime.startsWith("video");
                const isAudio = typeof mime === "string" && mime.startsWith("audio");
                const firstUrl = m.type === "message" ? extractFirstUrl(m.text) : null;
                const onlyLinkOnly = !!firstUrl && (m.text || "").trim() === firstUrl;
                const showUrlImg = !!firstUrl && onlyLinkOnly && isImgUrl(firstUrl);
                const showUrlVid = !!firstUrl && onlyLinkOnly && isVidUrl(firstUrl);
                const displayText = m.type === "message" ? (m.text || "").replace(/^\/ai\b/i, "@ai") : m.text;
                const mentionedCurrentUser = (m.type === "message" || m.type === "media") && mentionsMe(m.text || "");
                const shouldFlash = !mine && mentionedCurrentUser && !!flashMap[m.id];
                const alignRight = mine; // keep AI spinner on the left
                const tagVal = (tagsMap as any)[m.sender];
                const tagObj = typeof tagVal === 'string' ? { text: tagVal, color: 'white' } : (tagVal || null);
                return (
                  <div
                    key={m.id}
                    className={`flex w-full group/message ${alignRight ? "justify-end" : "justify-start"} ${first && i !== 0 ? "mt-3" : ""} mb-2`}
                    onMouseDownCapture={(e) => {
                      if (showTrayFor === m.id) {
                        const t = e.target as HTMLElement;
                        if (!t.closest('.msg-tray') && !t.closest('.msg-dots')) {
                          setShowTrayFor(null);
                        }
                      }
                    }}
                  >
                    <div
                      ref={(el) => {
                        animateIn(el);
                        if (el) {
                          (el as any).dataset.mid = m.id;
                          messageRefs.current[m.id] = el;
                        }
                      }}
                      onMouseEnter={() => stopFlashing(m.id)}
                      onClick={() => stopFlashing(m.id)}
                      className={`relative max-w-[95%] inline-flex flex-col ${alignRight ? "items-end" : "items-start"} ${shouldFlash ? "border-2 rounded-2xl" : ""}`}
                      style={shouldFlash ? { animation: "flash-red 1.6s ease-in-out infinite", borderColor: "rgba(239,68,68,0.85)", padding: "0.16rem" } : undefined}
                    >
                      {first && (
                        <div className="flex items-baseline gap-2 mb-0.5">
                          <span className={`text-sm font-semibold ${m.sender === "AI" ? "text-blue-400" : (mine ? "text-[#e7dec3]" : "text-[#cfc7aa]")}`}>
                            {m.sender === "AI" && m.model ? `AI (${m.model})` : (
                              <>
                                {m.sender}
                                {(() => { const tv = (tagsMap as any)[m.sender]; const tobj = typeof tv === 'string' ? { text: tv, color: 'white' } : (tv || null); const isDevSender = !!(tobj && (tobj as any).special === 'dev'); return (
                                  <>
                                    {isDevSender && <span className="dev-rainbow font-semibold"> (DEV)</span>}
                                    {admins.includes(m.sender) && <span className="text-red-500 font-semibold"> (ADMIN)</span>}
                                  </>
                                ); })()}
                                {tagObj && (() => {
                                  const c = (tagObj as any).color as string | undefined;
                                  const label = String((tagObj as any).text || "");
                                  if (!label || label.toUpperCase() === 'DEV') return null;
                                  const isHex = !!(c && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(c));
                                  if ((c || '').toLowerCase() === 'rainbow') return <span className="dev-rainbow font-semibold"> ({label})</span>;
                                  if (isHex) return <span className={`font-semibold`} style={{ color: c! }}> ({label})</span>;
                                  return <span className={`${colorClass(c)} font-semibold`}> ({label})</span>;
                                })()}
                              </>
                            )}
                          </span>
                          <span className="text-xs text-[#b5ad94]">{fmtTime(m.timestamp)}{m.edited ? ' · edited' : ''}</span>
                        </div>
                      )}

                      {/* AI spinner when text is empty */}
                      {m.type === "message" && m.sender === "AI" && !(m.text && m.text.trim()) && (
                        <div className={`relative inline-block rounded-2xl px-4 py-3 break-words whitespace-pre-wrap max-w-[70vw] sm:max-w-[80ch] ${mine ? "bg-[#e7dec3]/90 text-[#1c1c1c]" : "bg-[#2b2b2b]/70 text-[#f7f3e8]"}`} style={{ wordBreak: "break-word", overflowWrap: "anywhere" }}>
                           <span className="inline-flex items-center gap-2 text-[#cfc7aa]">
                             Generating Response <Loader2 className="h-4 w-4 animate-spin" />
                           </span>
                         </div>
                       )}
                      {m.type === "message" && !(showUrlImg || showUrlVid) && !(m.sender === "AI" && !(m.text && m.text.trim())) && (
                        <div className="relative inline-block max-w-[70vw] sm:max-w-[80ch] pt-2 -mt-2">
                          <div className={`relative rounded-2xl px-4 sm:pt-3 pt-6 pb-3 break-words whitespace-pre-wrap overflow-visible ${mine ? "bg-[#e7dec3]/90 text-[#1c1c1c]" : "bg-[#2b2b2b]/70 text-[#f7f3e8]"}`} style={{ wordBreak: "break-word", overflowWrap: "anywhere" }}>
                            {m.reply_to && (
                              <div className="mb-2 flex items-center gap-2">
                                <button
                                  onClick={() => scrollToMessage(m.reply_to.id)}
                                  className={`flex-1 min-w-0 text-left text-[11px] ${mine ? 'bg-black/10 text-[#1c1c1c]/80' : 'bg-white/10 text-[#f7f3e8]/80'} border border-white/10 rounded-xl px-2 py-1`}
                                >
                                  <span className="font-semibold">{m.reply_to.sender}</span>: <span className="truncate align-top block max-w-[28ch] sm:max-w-[42ch]" title={m.reply_to.text}>{shortenReply(m.reply_to.text)}</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => scrollToMessage(m.reply_to.id)}
                                  title="Go to replied message"
                                  className="shrink-0 p-1 rounded-full text-[#cfc7aa] hover:bg-white/10 transition"
                                >
                                  <CornerDownLeft className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            )}
                            {editingId === m.id ? (
                              <div className="space-y-2">
                                <TextareaAutosize
                                  value={editingText}
                                  onChange={e=>setEditingText(e.target.value)}
                                  onKeyDown={e => {
                                    e.stopPropagation();
                                    if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
                                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(); }
                                  }}
                                  className="w-full bg-transparent border border-white/20 rounded-md px-2 py-1 text-sm text-inherit"
                                />
                                <div className="flex gap-2 justify-end">
                                  <button type="button" onClick={cancelEdit} className="text-xs text-black">Cancel</button>
                                  <button type="button" onClick={saveEdit} className="text-xs text-black px-2 py-0.5 rounded">Save</button>
                                </div>
                              </div>
                            ) : (
                              <>
                                {renderRichText(displayText || "")}
                                {m.edited && (
                                  <span className="ml-1 inline-block align-baseline text-[10px] font-medium opacity-70 select-none">(edited)</span>
                                )}
                              </>
                            )}
                            {/* Desktop (xl+): tray anchored to bubble (Main text) */}
                            <div className={`hidden xl:block absolute z-30 top-1/2 -translate-y-1/2 ${alignRight ? 'right-full mr-2' : 'left-full ml-2'}`}>
                              <div className="msg-tray flex items-center gap-1 bg-black/80 border border-white/15 backdrop-blur-sm shadow-lg px-2 py-1 rounded-2xl opacity-0 pointer-events-none transition-all duration-200 ease-out group-hover/message:opacity-100 group-hover/message:pointer-events-auto">
                                <button onClick={() => { startReply(m); }} title="Reply" className={`p-1 rounded-full ${mine ? 'text-white/90' : 'text-[#cfc7aa]'} hover:bg-white/10 transition`}><CornerDownLeft className="h-3.5 w-3.5" /></button>
                                {mine && m.type === 'message' && (
                                  <button onClick={() => { beginEdit(m); }} title="Edit" className="p-1 rounded-full text-[#cfc7aa] hover:bg-white/10 transition"><Pencil className="h-3.5 w-3.5" /></button>
                                )}
                                <button
                                  onClick={(e) => {
                                    const keys = m.reactions ? Object.keys(m.reactions) : [];
                                    if (keys.length >= 5) { showAlert('You can only add up to 5 reactions'); return; }
                                    openReactionPicker(e, m.id);
                                  }}
                                  title="React"
                                  className="p-1 rounded-full text-[#cfc7aa] hover:bg-white/10 transition"
                                >
                                  <Smile className="h-3.5 w-3.5" />
                                </button>
                                {canDelete && (
                                  <button onClick={() => { deleteMsg(m.id); }} title="Delete" className="p-1 rounded-full text-red-500 hover:bg-white/10 transition"><Trash2 className="h-3.5 w-3.5" strokeWidth={2.25} /></button>
                                )}
                              </div>
                            </div>
                          </div>
                          {/* Mobile actions toggle + anchored popover (outside bubble to avoid clipping) */}
                          <div className={`xl:hidden absolute top-0 ${alignRight ? 'right-0 translate-x-1' : 'left-0 -translate-x-1'} z-30`}>
                            <button
                              type="button"
                              onClick={() => setShowTrayFor(prev => prev === m.id ? null : m.id)}
                              className="msg-dots group p-0.5 rounded-full bg-black/60 text-[#e7dec3] ring-1 ring-white/10"
                              aria-label={showTrayFor === m.id ? "Close actions" : "Message actions"}
                            >
                              <span className="relative block h-4 w-4">
                                <MoreHorizontal className={`absolute inset-0 h-4 w-4 transition-all duration-150 ease-out ${showTrayFor === m.id ? 'opacity-0 scale-75' : 'opacity-100 scale-100'}`} />
                                <X className={`absolute inset-0 h-4 w-4 transition-all duration-150 ease-out transform ${showTrayFor === m.id ? 'opacity-100 scale-100 group-hover:rotate-90' : 'opacity-0 scale-75'}`} />
                              </span>
                            </button>
                            {showTrayFor === m.id && (
                              <>
                                <div className="fixed inset-0 z-20" onClick={() => setShowTrayFor(null)} />
                                <div className={`absolute top-1/2 -translate-y-1/2 ${alignRight ? 'right-full mr-0' : 'left-full ml-0'} z-30`}>
                                  <div className="msg-tray flex items-center gap-1 bg-black/70 border border-white/10 backdrop-blur-md shadow-lg px-2 py-1 rounded-2xl transition-all duration-150 ease-out">
                                    <button onClick={() => { startReply(m); setShowTrayFor(null); }} title="Reply" className={`p-1 rounded-full ${mine ? 'text-white/90' : 'text-[#cfc7aa]'} hover:bg-white/10 transition`}><CornerDownLeft className="h-3.5 w-3.5" /></button>
                                    {mine && m.type === 'message' && (
                                      <button onClick={() => { beginEdit(m); setShowTrayFor(null); }} title="Edit" className="p-1 rounded-full text-[#cfc7aa] hover:bg-white/10 transition"><Pencil className="h-3.5 w-3.5" /></button>
                                    )}
                                    <button
                                      onClick={(e) => {
                                        const keys = m.reactions ? Object.keys(m.reactions) : [];
                                        if (keys.length >= 5) { showAlert('You can only add up to 5 reactions'); return; }
                                        setShowTrayFor(null);
                                        openReactionPicker(e, m.id);
                                      }}
                                      title="React"
                                      className="p-1 rounded-full text-[#cfc7aa] hover:bg-white/10 transition"
                                    >
                                      <Smile className="h-3.5 w-3.5" />
                                    </button>
                                    {canDelete && (
                                      <button onClick={() => { deleteMsg(m.id); setShowTrayFor(null); }} title="Delete" className="p-1 rounded-full text-red-500 hover:bg-white/10 transition"><Trash2 className="h-3.5 w-3.5" strokeWidth={2.25} /></button>
                                    )}
                                  </div>
                                </div>
                              </>
                            )}
                          </div>
                          
                          
                          {/* Reactions row */}
                          {m.reactions && Object.values(m.reactions).some((arr: any) => Array.isArray(arr) && arr.length > 0) && (
                            <div className="mt-1.5 flex items-center gap-1">
                              {Object.keys(m.reactions).map((emo: any) => {
                                const users: string[] = m.reactions[emo] || [];
                                if (!users.length) return null;
                                const mineReact = users.includes(me);
                                const title = `${users.join(', ')} reacted`;
                                return (
                                  <button key={emo} title={title} onClick={() => reactTo(m.id, emo)} className={`px-2 py-0.5 rounded-full text-xs border ${mineReact ? 'bg-white/20 border-white/30' : 'bg-white/10 border-white/10'} text-[#e7dec3]`}>{emo} {users.length}</button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}

                      {m.type === "poll" && (
                        <div className="relative">
                          {renderPoll(m, { thread: 'main' })}
                          {canDelete && (
                            <button
                              onClick={() => deleteMsg(m.id)}
                              title="Delete"
                              className={`absolute -top-2 -right-2 opacity-0 group-hover:opacity-100 hover:opacity-100 focus:opacity-100 transition p-1 rounded-full bg-black text-red-500 shadow-md z-30 ring-1 ring-white/15 pointer-events-auto`}
                            >
                              <Trash2 className="h-3 w-3" strokeWidth={2.25} />
                            </button>
                          )}
                        </div>
                      )}

                      {/* Spotify Preview */}
                      {m.spotify_preview_html && <SpotifyPreview htmlContent={m.spotify_preview_html} />}

                      {/* YouTube Preview */}
                      {m.youtube_preview_html && <YouTubePreview htmlContent={m.youtube_preview_html} />}

                      {/* URL preview bubble for pure links */}
                      {m.type === "message" && (showUrlImg || showUrlVid) && (
                        <div className="relative inline-block">
                          {showUrlImg ? (
                            <img src={firstUrl!} className="max-w-[70vw] sm:max-w-[80ch] rounded-xl" />
                          ) : (
                            <video src={firstUrl!} controls className="max-w-[70vw] sm:max-w-[80ch] rounded-xl" />
                          )}
                          {canDelete && (
                            <button
                              onClick={() => deleteMsg(m.id)}
                              title="Delete"
                              className="absolute -top-2 -right-2 opacity-0 group-hover:opacity-100 hover:opacity-100 focus:opacity-100 transition p-1 rounded-full bg-black text-red-500 shadow-md z-30 ring-1 ring-white/15 pointer-events-auto"
                            >
                              <Trash2 className="h-3 w-3" strokeWidth={2.25} />
                            </button>
                          )}
                        </div>
                      )}

                      {/* Media message (image/video/audio) with actions + reactions */}
                      {m.type === "media" && (
                        <div className="relative inline-block">
                          {isImage ? (
                            <img src={full(m.url)} className="max-w-[70vw] sm:max-w-[80ch] rounded-xl" />
                          ) : isVideo ? (
                            <video src={full(m.url)} controls className="max-w-[70vw] sm:max-w-[80ch] rounded-xl" />
                          ) : isAudio ? (
                            <audio src={full(m.url)} controls className="w-[85vw] max-w-[80ch]" />
                          ) : (
                            <a href={full(m.url)} target="_blank" className={`block rounded-2xl px-4 py-3 ${mine ? "bg-[#e7dec3]/90 text-[#1c1c1c]" : "bg-[#2b2b2b]/70 text-[#f7f3e8]"} underline`}>Download file ({m.mime || "file"})</a>
                          )}
                          {/* Mobile actions toggle + anchored popover */}
                          <div className={`xl:hidden absolute top-0 ${alignRight ? 'right-0 translate-x-1' : 'left-0 -translate-x-1'} z-30`}>
                            <button
                              type="button"
                              onClick={() => setShowTrayFor(prev => prev === m.id ? null : m.id)}
                              className="msg-dots group p-0.5 rounded-full bg-black/60 text-[#e7dec3] ring-1 ring-white/10"
                              aria-label={showTrayFor === m.id ? "Close actions" : "Message actions"}
                            >
                              <span className="relative block h-4 w-4">
                                <MoreHorizontal className={`absolute inset-0 h-4 w-4 transition-all duration-150 ease-out ${showTrayFor === m.id ? 'opacity-0 scale-75' : 'opacity-100 scale-100'}`} />
                                <X className={`absolute inset-0 h-4 w-4 transition-all duration-150 ease-out transform ${showTrayFor === m.id ? 'opacity-100 scale-100 group-hover:rotate-90' : 'opacity-0 scale-75'}`} />
                              </span>
                            </button>
                            {showTrayFor === m.id && (
                              <>
                                <div className="fixed inset-0 z-20" onClick={() => setShowTrayFor(null)} />
                                <div className={`absolute top-1/2 -translate-y-1/2 ${alignRight ? 'right-full mr-0' : 'left-full ml-0'} z-30`}>
                                  <div className="msg-tray flex items-center gap-1 bg-black/70 border border-white/10 backdrop-blur-md shadow-lg px-2 py-1 rounded-2xl transition-all duration-150 ease-out">
                                    <button type="button" onClick={() => { startReply(m); setShowTrayFor(null); }} title="Reply" className={`p-1 rounded-full ${mine ? 'text-white/90' : 'text-[#cfc7aa]'} hover:bg-white/10 transition`}><CornerDownLeft className="h-3.5 w-3.5" /></button>
                                    <button type="button"
                                      onClick={(e) => {
                                        const keys = m.reactions ? Object.keys(m.reactions) : [];
                                        if (keys.length >= 5) { showAlert('You can only add up to 5 reactions'); return; }
                                        setShowTrayFor(null);
                                        openReactionPicker(e, m.id);
                                      }}
                                      title="React"
                                      className="p-1 rounded-full text-[#cfc7aa] hover:bg-white/10 transition"
                                    >
                                      <Smile className="h-3.5 w-3.5" />
                                    </button>
                                    {canDelete && (
                                      <button type="button"
                                        onClick={() => { deleteMsg(m.id); setShowTrayFor(null); }}
                                        title="Delete"
                                        className="p-1 rounded-full text-red-500 hover:bg-white/10 transition"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" strokeWidth={2.25} />
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </>
                            )}
                          </div>
                          {/* Desktop (xl+): side action tray on hover (Main media) */}
                          <div className={`hidden xl:block absolute z-30 top-1/2 -translate-y-1/2 ${alignRight ? 'right-full mr-2' : 'left-full ml-2'}`}>
                            <div className="msg-tray flex items-center gap-1 bg-black/80 border border-white/15 backdrop-blur-sm shadow-lg px-2 py-1 rounded-2xl opacity-0 pointer-events-none transition-all duration-200 ease-out group-hover/message:opacity-100 group-hover/message:pointer-events-auto">
                              <button type="button" onClick={() => { startReply(m); }} title="Reply" className={`p-1 rounded-full ${mine ? 'text-white/90' : 'text-[#cfc7aa]'} hover:bg-white/10 transition`}><CornerDownLeft className="h-3.5 w-3.5" /></button>
                              <button type="button"
                                onClick={(e) => {
                                  const keys = m.reactions ? Object.keys(m.reactions) : [];
                                  if (keys.length >= 5) { showAlert('You can only add up to 5 reactions'); return; }
                                  openReactionPicker(e, m.id);
                                }}
                                title="React"
                                className="p-1 rounded-full text-[#cfc7aa] hover:bg-white/10 transition"
                              >
                                <Smile className="h-3.5 w-3.5" />
                              </button>
                              {canDelete && (
                                <button type="button"
                                  onClick={() => { deleteMsg(m.id); }}
                                  title="Delete"
                                  className="p-1 rounded-full text-red-500 hover:bg-white/10 transition"
                                >
                                  <Trash2 className="h-3.5 w-3.5" strokeWidth={2.25} />
                                </button>
                              )}
                            </div>
                          </div>
                          {/* Reactions row */}
                          {m.reactions && Object.values(m.reactions).some((arr: any) => Array.isArray(arr) && arr.length > 0) && (
                            <div className="mt-1.5 flex items-center gap-1">
                              {Object.keys(m.reactions).map((emo: any) => {
                                const users: string[] = m.reactions[emo] || [];
                                if (!users.length) return null;
                                const mineReact = users.includes(me);
                                const title = `${users.join(', ')} reacted`;
                                return (
                                  <button key={emo} title={title} onClick={() => reactTo(m.id, emo)} className={`px-2 py-0.5 rounded-full text-xs border ${mineReact ? 'bg-white/20 border-white/30' : 'bg-white/10 border-white/10'} text-[#e7dec3]`}>{emo} {users.length}</button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              {typingUser && (
                <div
                  className={`mt-1 mb-2 text-m text-[#cfc7aa]/70 italic transition-all duration-250 ease-out ${typingVisible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-0.5"}`}
                  style={{ willChange: "opacity, transform" }}
                >
                  {typingUser} is typing
                  <span className="inline-flex w-6 ml-1">
                    <span style={{ animation: "typing-dot 1.1s infinite ease-in-out", animationDelay: "0ms" }}>.</span>
                    <span style={{ animation: "typing-dot 1.1s infinite ease-in-out", animationDelay: "200ms" }}>.</span>
                    <span style={{ animation: "typing-dot 1.1s infinite ease-in-out", animationDelay: "300ms" }}>.</span>
                  </span>
                </div>
              )}
              <div ref={bottomRef} />
            </>
          )}
          </div>
        </div>

        {/* DM toast when collapsed */}
        {dmToast && !sidebar && (
          <button
            onClick={() => setSidebar(true)}
            className="group absolute left-1/2 -translate-x-1/2 bottom-40 md:bottom-40 bg-black/55 hover:bg-black/65 active:bg-black/70 text-white border border-red-500/70 shadow-[0_0_14px_rgba(255,0,0,0.45)] ring-2 ring-red-500/60 rounded-full px-5 py-2 backdrop-blur-md flex items-center gap-3 animate-pulse z-30 transition cursor-pointer focus:outline-none focus:ring-4 focus:ring-red-500/40"
            aria-label={`Open new DM from ${dmToast.user}`}
          >
            <span className="flex items-center justify-center h-7 w-7 rounded-full bg-red-500 text-[12px] font-extrabold leading-none tracking-tight shadow-inner shadow-red-900/40">
              {Math.min(99, (unreadDm[dmToast.user]||0))}
            </span>
            <span className="text-sm font-semibold leading-none select-none">New DM from {dmToast.user}</span>
          </button>
        )}

        {/* Mention toast when collapsed (red attention style) */}
        {mentionToast && !sidebar && (
          <button
            onClick={() => {
              setSidebar(true);
              if (mentionToast.where === 'gc' && mentionToast.gcid) {
                setActiveDm(null);
                setActiveGc(mentionToast.gcid);
              } else {
                setActiveDm(null);
                setActiveGc(null);
              }
            }}
            className="group absolute left-1/2 -translate-x-1/2 bottom-56 md:bottom-56 bg-black/55 hover:bg-black/65 active:bg-black/70 text-white border border-red-500/70 shadow-[0_0_14px_rgba(255,0,0,0.45)] ring-2 ring-red-500/60 rounded-full px-5 py-2 backdrop-blur-md flex items-center gap-3 animate-pulse z-30 transition cursor-pointer focus:outline-none focus:ring-4 focus:ring-red-500/40"
            aria-label={`Open mention in ${mentionToast.where === 'gc' ? mentionToast.label : 'Main Chat'}`}
          >
            <span className="flex items-center justify-center h-7 w-7 rounded-full bg-red-500 text-[12px] font-extrabold leading-none tracking-tight shadow-inner shadow-red-900/40">
              @
            </span>
            <span className="text-sm font-semibold leading-none select-none">Mention in {mentionToast.where === 'gc' ? mentionToast.label : 'Main Chat'}</span>
          </button>
        )}

        {/* GC invite toast when collapsed (red attention style) */}
        {gcInviteToast && !sidebar && (
          <button
            onClick={() => {
              setSidebar(true);
              setActiveDm(null);
              setActiveGc(gcInviteToast.gcid);
            }}
            className="group absolute left-1/2 -translate-x-1/2 bottom-72 md:bottom-72 bg-black/55 hover:bg-black/65 active:bg-black/70 text-white border border-red-500/70 shadow-[0_0_14px_rgba(255,0,0,0.45)] ring-2 ring-red-500/60 rounded-full px-5 py-2 backdrop-blur-md flex items-center gap-3 animate-pulse z-30 transition cursor-pointer focus:outline-none focus:ring-4 focus:ring-red-500/40"
            aria-label={`Open invite to ${gcInviteToast.label}`}
          >
            <span className="flex items-center justify-center h-7 w-7 rounded-full bg-red-500 text-[12px] font-extrabold leading-none tracking-tight shadow-inner shadow-red-900/40">
              +
            </span>
            <span className="text-sm font-semibold leading-none select-none">Invited to {gcInviteToast.label}</span>
          </button>
        )}

        {/* Scroll-to-bottom FAB shown when scrolled up */}
        {!isAtBottom && (
          <button
            onClick={() => {
              forceScrollRef.current = true;
              bottomRef.current?.scrollIntoView({ behavior: "smooth" });
            }}
            title="Scroll to bottom"
            className="absolute left-1/2 -translate-x-1/2 transform bottom-28 md:bottom-32 bg-[#2b2b2b]/90 hover:bg-[#3a3a3a] text-[#f7f3e8] border border-white/15 rounded-full shadow-lg px-4 py-2 transition z-20"
          >
            <span className="sr-only">Scroll to bottom</span>
            <ChevronDown className="h-5 w-5" strokeWidth={3} />
          </button>
        )}

        {/* INPUT */}
  <div className={`relative p-4 pb-6 ${isMobile ? 'chat-composer-mobile' : ''}`}> 
          {/* Decorative glass/fade backdrop behind composer with softer opacity and fade-up animation */}
          <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-36 -z-10">
            <div className="mx-3 h-full rounded-3xl border border-white/10 bg-gradient-to-t from-white/8 to-transparent backdrop-blur-xl shadow-[0_-10px_40px_rgba(255,255,255,0.06)]" style={{ opacity: 0.35, animation: "fade-rise 300ms ease-out" }} />
          </div>

          {files.length > 0 && (
            <AttachmentPreview files={files} onRemove={(idx: number) => setFiles(files.filter((_, x) => x !== idx))} />
          )}

          {/* Emoji picker */}
          <EmojiPanel
            open={showPicker}
            onPick={(emoji: string) => { setInput(prev => prev + emoji); txtRef.current?.focus(); }}
          />

          <form
            className="relative z-10 flex items-center space-x-2 rounded-2xl bg-black/30 border border-white/15 backdrop-blur-xl shadow-[0_0_8px_rgba(255,255,255,0.05)] px-4 py-3"
            onSubmit={e => {
              e.preventDefault();
              send();
            }}
          >
            <input
              type="file"
              hidden
              multiple
              ref={fileRef}
              onChange={e => {
                const selected = Array.from(e.target.files || []);
                const isAi = isAiAnywhere(input.trim());
                if (isAi) {
                  // allow exactly one image for @ai image mode
                  const images = selected.filter(f => f.type && f.type.startsWith("image"));
                  if (images.length === 0) {
                    showAlert("attach a single image for @ai image mode");
                    if (fileRef.current) fileRef.current.value = "";
                    return;
                  }
                  if (images.length > 1) {
                    showAlert("@ai supports only one image at a time");
                    if (fileRef.current) fileRef.current.value = "";
                    return;
                  }
                  if (images[0].type === "image/gif") {
                    showAlert("@ai only supports static images (png/jpg/webp)");
                    if (fileRef.current) fileRef.current.value = "";
                    return;
                  }
                  setFiles([images[0]]);
                  fileRef.current!.value = "";
                  return;
                }
                setFiles([...files, ...selected]);
                fileRef.current!.value = "";
              }}
            />
            <Button variant="ghost" type="button" onClick={() => fileRef.current?.click()}>
              <Paperclip className="h-5 w-5 text-[#cfc7aa]" />
            </Button>
            {/* Input highlight overlay wrapper */}
            <div className="relative flex-1 min-w-0">
              {!isMobile && (
                // Overlay that highlights @mentions in the input (desktop/tablet only)
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 whitespace-pre-wrap break-words text-[#f7f3e8] overflow-hidden pr-16 sm:pr-12 z-0"
                  style={{ lineHeight: 1.5 }}
                >
                  {input ? (
                    <>{renderInputHighlight(input)}</>
                  ) : (
                    <>
                      <span className="text-[#b5ad94] hidden sm:inline">Type Message...</span>
                      <span className="text-[#b5ad94] inline sm:hidden">Message...</span>
                    </>
                  )}
                </div>
              )}
              <TextareaAutosize
                ref={txtRef}
                value={input}
                onChange={e => {
                  let v = e.target.value;
                  try { v = emoji.replace_colons(v); } catch {}
                  setInput(v);
                  pingTyping(v);
                  if (isMobile) {
                    // Keep caret/text visible inside the textarea on mobile as it grows
                    try { setTimeout(() => { if (txtRef.current) txtRef.current.scrollTop = txtRef.current.scrollHeight; }, 0); } catch {}
                  } else if (isAtBottomRef.current) {
                    bottomRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
                  }
                }}
                onFocus={() => pingTyping(input)}
                onBlur={() => {}}
                onHeightChange={() => {
                  if (isMobile) {
                    try { if (txtRef.current) txtRef.current.scrollTop = txtRef.current.scrollHeight; } catch {}
                  } else if (isAtBottomRef.current) {
                    bottomRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
                  }
                }}
                onPaste={e => {
                  const items = e.clipboardData?.items;
                  if (!items) return;
                  const pasted: File[] = [];
                  for (const it of items as any) {
                    if (it.kind === "file") {
                      const f = it.getAsFile();
                      if (f) pasted.push(f);
                    }
                  }
                  if (pasted.length) {
                    const isAi = isAiAnywhere(input.trim());
                    if (isAi) {
                      const images = pasted.filter(f => f.type && f.type.startsWith("image"));
                      if (images.length === 0) {
                        setAlertText("attach a single image for @ai image mode");
                        setAlertButton("OK");
                        alertActionRef.current = null;
                        setAlertOpen(true);
                        return;
                      }
                      if (images.length > 1) {
                        setAlertText("@ai supports only one image at a time");
                        setAlertButton("OK");
                        alertActionRef.current = null;
                        setAlertOpen(true);
                        return;
                      }
                      if (images[0].type === "image/gif") {
                        setAlertText("@ai only supports static images (png/jpg/webp)");
                        setAlertButton("OK");
                        alertActionRef.current = null;
                        setAlertOpen(true);
                        return;
                      }
                      e.preventDefault();
                      setFiles([images[0]]);
                      return;
                    }
                    e.preventDefault();
                    setFiles(prev => [...prev, ...pasted]);
                  }
                }}
                onKeyDown={e => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                // On mobile, keep a single-line input with horizontal scroll and no phantom newlines
                wrap={isMobile ? ("off" as any) : undefined}
                className={`relative z-10 w-full bg-transparent border-none resize-none focus:outline-none ${isMobile ? 'text-[#f7f3e8] overflow-y-hidden overflow-x-auto whitespace-nowrap no-scrollbar' : 'text-transparent overflow-y-auto no-scrollbar'} caret-[#f7f3e8] pr-16 sm:pr-12 pointer-events-auto`}
                style={isMobile ? undefined : undefined}
                minRows={1}
                maxRows={isMobile ? 1 : 5}
              />
            </div>
            <Button variant="ghost" type="button" onClick={() => setShowPicker(v => !v)}>
              <Smile className="h-5 w-5 text-[#e7dec3]" />
            </Button>
            <Button variant="ghost" type="submit" disabled={sending}>
              {sending ? (
                               <Loader2 className="h-5 w-5 text-[#e7dec3] animate-spin" />
              ) : (
                <Send className="h-5 w-5 text-[#e7dec3]" />
              )}
            </Button>
          </form>
          {/* Reply banner */}
          {replyTo && (
            <div className="mt-2 mx-1 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-[#e7dec3] flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs text-[#cfc7aa]/80">Replying to {replyTo.sender}</div>
                <div className="truncate">{replyTo.text}</div>
              </div>
              <button onClick={() => setReplyTo(null)} className="text-[#cfc7aa] hover:text-white text-xs ml-2 shrink-0">Cancel</button>
            </div>
          )}

          {/* Global emoji picker overlay (fixed) */}
          {reactionPickerFor && (
            <>
              <div className="fixed inset-0 z-[60]" onClick={closeReactionPicker} />
              <div className="fixed z-[61]" style={{ top: reactionPickerPos?.top || 80, left: reactionPickerPos?.left || 80 }}>
                <EmojiPicker
                  theme={EmojiTheme.DARK}
                  onEmojiClick={(e: any) => { const id = reactionPickerFor; closeReactionPicker(); if (id) reactTo(id, e.emoji || ''); }}
                  lazyLoadEmojis
                  width={280}
                  height={380}
                />
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

export default ChatInterface;
