import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import TextareaAutosize from "react-textarea-autosize";
import { Paperclip, Send, Loader2, Smile, Trash2, ChevronDown, Ban } from "lucide-react";
import EmojiConvertor from "emoji-js";
import AlertModal from "@/components/AlertModal";

import * as api from "@/services/api";
import Sidebar from "./Sidebar";
import EmojiPanel from "./EmojiPanel";
import AttachmentPreview from "./AttachmentPreview";

export function ChatInterface({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [me, setMe] = useState("");
  const [role, setRole] = useState("");
  const [users, setUsers] = useState<string[]>([]);
  const [admins, setAdmins] = useState<string[]>([]);
  const [tagsMap, setTagsMap] = useState<Record<string, any>>({});
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [sidebar, setSidebar] = useState(true);
  const [showPicker, setShowPicker] = useState(false);
  // DM/thread prep state
  const [activeDm, setActiveDm] = useState<string | null>(null); // null = Main Chat, otherwise username
  const [unreadMain, setUnreadMain] = useState(0); // mention pings in Main when not viewing it
  const [unreadDm, setUnreadDm] = useState<Record<string, number>>({}); // future DM pings per user
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

  const ws = useRef<WebSocket | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const txtRef = useRef<HTMLTextAreaElement | null>(null);
  const seen = useRef<Set<string>>(new Set());
  // track active thread in a ref for event handlers
  const activeDmRef = useRef<string | null>(null);
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

  // Track message DOM nodes and flashing state for mention alerts
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const observerRef = useRef<IntersectionObserver | null>(null);
  const timeoutRefs = useRef<Record<string, number>>({});
  const flashedRef = useRef<Set<string>>(new Set());
  const [flashMap, setFlashMap] = useState<Record<string, boolean>>({});
  const fallbackFlashRefs = useRef<Record<string, number>>({});
  // Chat scroll container (use as IntersectionObserver root)
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll management
  const [isAtBottom, setIsAtBottom] = useState(true);
  const isAtBottomRef = useRef(true);
  const forceScrollRef = useRef(false);

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
  // DEV (localhost) is superior: detect my DEV tag and treat as admin-equivalent on client
  const myTagVal = (tagsMap as any)[me];
  const myTagObj = typeof myTagVal === 'string' ? { text: myTagVal, color: 'orange' } : (myTagVal || null);
  const isDevMe = !!(myTagObj && ((myTagObj as any).special === 'dev' || (myTagObj as any).color === 'rainbow' || String((myTagObj as any).text || '').toUpperCase() === 'DEV'));
  const isAdminEffective = isAdmin || isDevMe;
  const full = (url: string) => (url.startsWith("/") ? location.origin + url : url);

  // Ask for notification permission on mount
  useEffect(() => {
    try {
      if (typeof Notification !== "undefined" && Notification.permission === "default") {
        Notification.requestPermission().catch(() => {});
      }
    } catch {}
  }, []);

  const fmtTime = (iso?: string) => {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    } catch { return ""; }
  };

  useEffect(() => {
    typingUserRef.current = typingUser;
  }, [typingUser]);

  // Helpers to detect mentions of current user
  const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const mentionsMe = useCallback((text: string) => {
    if (!me || !text) return false;
    const meEsc = escapeRegex(me);
    // Match @me (word-bounded) or @"me" (quoted)
    const rePlain = new RegExp(`(^|\\s|[^\\w])@${meEsc}(?![\\w])`, "i");
    const reQuoted = new RegExp(`@\"\s*${meEsc}\s*\"`, "i");
    const everyone = /(^|\s|[^\w])@everyone(?![\w])/i.test(text) || /@"\s*everyone\s*"/i.test(text);
    return everyone || rePlain.test(text) || reQuoted.test(text);
  }, [me]);

  // Helper: map color name to Tailwind class
  const colorClass = useCallback((c?: string) => {
    switch ((c || "orange").toLowerCase()) {
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
      default: return "text-orange-400";
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

  // Auto-collapse sidebar on small screens and keep it in sync on resize
  useEffect(() => {
    const sync = () => setSidebar(window.innerWidth >= 768);
    sync();
    const onResize = () => {
      const shouldOpen = window.innerWidth >= 768;
      setSidebar(prev => (prev === shouldOpen ? prev : shouldOpen));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
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
          showAlert("User blocked from dm");
          return;
        }
        if (code === "DM_UNBLOCKED") {
          setBlockedDm(prev => ({ ...prev, [activeDmRef.current || ""]: false }));
          showAlert("User unblocked from dm");
          return;
        }
  const textRaw2 = d.text || "";
  const t2 = (textRaw2 || "").trim().replace(/[.]+$/, "");
  const text = t2 ? t2[0].toUpperCase() + t2.slice(1) : t2;
        const shouldLogout = code === "KICKED" || code === "BANNED" || code === "BANNED_CONNECT" || code === "DUPLICATE";
        if (code === "DUPLICATE") {
          try {
            localStorage.removeItem("chat-username");
            localStorage.setItem("chat-login-error", "Username already online. Pick a different name.");
          } catch {}
        }
        showAlert(text, shouldLogout ? () => onLogout() : undefined);
        return;
      }

      // Presence events (join/leave): notify and append as SYSTEM message in timeline
      if (d.type === "presence" && typeof d.user === "string" && typeof d.action === "string") {
        const user = String(d.user || ""); // keep original casing for names
        const actionRaw = String(d.action || "");
        const action = actionRaw.toLowerCase() === "join" ? "has joined chat" : actionRaw.toLowerCase() === "leave" ? "has left chat" : actionRaw;
        const text = `${user} ${action}`;
        // Notify with title=user, body=message
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

      // Handle delete events (main and DM)
      if (d.type === "delete" && d.id) {
        if (d.thread === "dm") {
          if (activeDmRef.current === d.peer) {
            setMessages(prev => prev.filter(m => m.id !== d.id));
          }
        } else {
          if (activeDmRef.current === null) {
            setMessages(prev => prev.filter(m => m.id !== d.id));
          }
        }
        return;
      }

      // Handle clear events (main and DM)
      if (d.type === "clear") {
        if (d.thread === "dm") {
          // For DM, keep a small inline system line
          if (activeDmRef.current === d.peer) {
            const sys = {
              id: `clear-${Date.now()}-${Math.random()}`,
              type: "system",
              sender: "SYSTEM",
              text: "dm cleared",
              timestamp: new Date().toISOString(),
            } as any;
            setMessages([sys]);
          }
        } else {
          // For Main, just clear timeline and wait for server 'system' message
          if (activeDmRef.current === null) {
            setMessages([]);
          }
        }
        return;
      }

      // Histories
      if (d.type === "history" && Array.isArray(d.items)) {
        seen.current.clear();
        d.items.forEach((x: any) => x?.id && seen.current.add(x.id));
        historyIdsRef.current = new Set((d.items || []).map((x: any) => x && x.id).filter(Boolean));
        forceScrollRef.current = true; // scroll to latest after loading history
        return setMessages(d.items);
      }
      if (d.type === "dm_history" && Array.isArray(d.items)) {
        seen.current.clear();
        d.items.forEach((x: any) => x?.id && seen.current.add(x.id));
        historyIdsRef.current = new Set((d.items || []).map((x: any) => x && x.id).filter(Boolean));
        forceScrollRef.current = true; // scroll to latest after loading dm history
        return setMessages(d.items);
      }

      // Throttled AI streaming updates
      if (d.type === "update" && d.id) {
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

      // AI streaming via repeated 'message' events with the same id: append chunks
      if (d.type === "message" && d.sender === "AI" && d.id) {
        // Respect DM routing and notify when off-thread or tab hidden
        const isHidden = typeof document !== "undefined" && document.hidden;
        if (d.thread === "dm") {
          if (activeDmRef.current !== d.peer) {
            setUnreadDm(prev => ({ ...prev, [d.peer as string]: (prev[d.peer as string] || 0) + 1 }));
            const title = `AI replied in DM with ${d.peer}`;
            const body = typeof d.text === "string" && d.text ? d.text : "AI is responding";
            notify(title, body);
            return;
          } else if (isHidden) {
            const title = `AI replied in DM with ${d.peer}`;
            const body = typeof d.text === "string" && d.text ? d.text : "AI is responding";
            notify(title, body);
          }
        } else if (activeDmRef.current !== null) {
          // If viewing a DM, ignore main AI chunks
          const title = `AI (Main)`;
          const body = typeof d.text === "string" && d.text ? d.text : "AI is responding";
          notify(title, body);
          return;
        } else if (isHidden) {
          const title = `AI (Main)`;
          const body = typeof d.text === "string" && d.text ? d.text : "AI is responding";
          notify(title, body);
        }

        setMessages(prev => {
          const idx = prev.findIndex(m => m.id === d.id);
          if (idx !== -1) {
            const copy = [...prev];
            const old = copy[idx];
            copy[idx] = { ...old, text: (old.text || "") + (d.text || "") };
            return copy;
          }
          // First packet for this AI id. If text is empty, it will show spinner
          return [...prev, d];
        });
        return;
      }

      if (d.type === "typing") {
        if (d.user === currentUser) return;
        // Only show typing for the active thread
        if (d.thread === "dm") {
          if (activeDmRef.current !== d.peer) return;
        } else {
          if (activeDmRef.current !== null) return;
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

      // Route DM events and update unread counters + toast when sidebar collapsed
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

      // Main thread notifications / unread when off main OR mention OR tab hidden
      if ((d.type === "message" || d.type === "media") && (!d.thread || d.thread === "main") && d.sender) {
        const isHidden = typeof document !== "undefined" && document.hidden;
        const notOnMain = activeDmRef.current !== null; // user is in a DM
        const isMention = typeof d.text === "string" && d.sender !== me && mentionsMe(d.text || "");
        // Increment unread counter only for mentions when off main or hidden
        if ((notOnMain || isHidden) && isMention) setUnreadMain(c => c + 1);
        // Notify if off main (any message not from me) OR hidden and mention
        if ((notOnMain && d.sender !== me) || (isHidden && (isMention || d.sender !== me))) {
          const title = `${d.sender} (Main)`;
          const body = typeof d.text === "string" && d.text ? d.text : (d.mime || "media");
          notify(title, body);
        }
        if (activeDmRef.current !== null) return; // don't render main messages while viewing DM
      }

      if (d.type === "user_list") {
        setUsers(d.users);
        if (Array.isArray(d.admins)) setAdmins(d.admins);
        if (d.tags && typeof d.tags === "object") setTagsMap(d.tags);
        return;
      }

      // System events notifications and handle clear wording
      if (d.type === "system") {
        const txt = String(d.text || "");
        const cap = txt ? txt[0].toUpperCase() + txt.slice(1) : txt;
        if (activeDmRef.current === null && /cleared the chat/i.test(txt)) {
          notify("SYSTEM", cap);
          return setMessages([{ ...d, sender: "SYSTEM", text: cap }]);
        }
        notify("SYSTEM", cap);
        return setMessages(p => [...p, { ...d, text: cap }]);
      }

      if (d.id && seen.current.has(d.id)) return;
      if (d.id) seen.current.add(d.id);
      setMessages(p => [...p, d]);
    };

    return () => {
      ws.current?.close();
      if (typingStopTimer.current) window.clearTimeout(typingStopTimer.current);
      if (typingHideTimer.current) window.clearTimeout(typingHideTimer.current);
      if (aiUpdateTimer.current) window.clearTimeout(aiUpdateTimer.current);
      if (muteIntervalRef.current) { window.clearInterval(muteIntervalRef.current); muteIntervalRef.current = null; }
    };
  }, [token]);

  // Reset unread counts and request history when switching threads
  useEffect(() => {
    if (!ws.current || ws.current.readyState !== WebSocket.OPEN) return;
    if (activeDm === null) {
      try { ws.current.send(JSON.stringify({ type: "history_request" })); } catch {}
      setUnreadMain(0);
    } else {
      try { ws.current.send(JSON.stringify({ type: "dm_history", peer: activeDm })); } catch {}
      setUnreadDm(prev => ({ ...prev, [activeDm]: 0 }));
    }
  }, [activeDm]);

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
    const threadPayload = activeDmRef.current ? { thread: "dm", peer: activeDmRef.current } : { thread: "main" } as any;
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

  const isAiAnywhere = (t: string) => /^\s*@ai\b/i.test(t); // revert to only at start
  const extractAiPrompt = (t: string) => {
    const m = t.match(/^\s*@ai\b(.*)$/i);
    return (m ? m[1] : "").trim();
  };

  const send = async () => {
    if (sending) return;
    let txt = input.trim();
    if (!txt && files.length === 0) return;

    // Intercept admin-only commands for non-admins and show modal instead of sending
    if (!isAdminEffective) {
      const adminOnly = /^(\/kick|\/ban|\/unban|\/clear|\/pass|\/mute|\/unmute|\/kickA|\/mkadmin|\/rmadmin|\/locktag|\/unlocktag|\/purgeadmin|\/muteA|\/psa)\b/i;
      // allow /clear in DM (scoped)
      if (/^\s*\/clear\s*$/i.test(txt) && activeDm) {
        // let it through
      } else if (adminOnly.test(txt)) {
        if (/^\s*\/tag\b/i.test(txt)) {
          showAlert('You can only tag yourself. Use: /tag "myself" "tag" [color]');
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
      if(/^\s*\/muteA/i.test(txt) && !/^\s*\/muteA\s+\d+\s*$/i.test(txt)) {
        showAlert('Usage: /muteA minutes');
        return;
      }
      if (/^\s*\/tag/i.test(txt) && !/^\s*\/tag\s+"[^"]+"\s+"[^"]+"(?:\s+\-\w+)?\s*$/i.test(txt)) {
        showAlert('Usage: /tag "username" "tag" [-r|-g|-b|-p|-y|-w|-c|-purple|-violet|-indigo|-teal|-lime|-amber|-emerald|-fuchsia|-sky|-gray]');
        return;
      }
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
      if (/^\s*\/unban/i.test(txt) && !/^\s*\/unban\s+"[^"]+"\s*$/i.test(txt)) {
        showAlert('Usage: /unban "username"');
        return;
      }
      if (/^\s*\/mkadmin/i.test(txt) && !/^\s*\/mkadmin\s+"[^"]+"\s+\S+\s*$/i.test(txt)) {
        showAlert('Usage: /mkadmin "username" superpass');
        return;
      }
      if (/^\s*\/rmadmin/i.test(txt) && !/^\s*\/rmadmin\s+"[^"]+"\s+\S+\s*$/i.test(txt)) {
        showAlert('Usage: /rmadmin "username" superpass');
        return;
      }
      if (/^\s*\/locktag/i.test(txt) && !/^\s*\/locktag\s+(?:"[^"]+"|\S+)\s*$/i.test(txt)) {
        showAlert('Usage: /locktag "username"');
        return;
      }
      if (/^\s*\/unlocktag/i.test(txt) && !/^\s*\/unlocktag\s+(?:"[^"]+"|\S+)\s*$/i.test(txt)) {
        showAlert('Usage: /unlocktag "username"');
        return;
      }
      if (/^\s*\/unmute/i.test(txt) && !/^\s*\/unmute\s+(?:"[^"]+"|\S+)\s*$/i.test(txt)) {
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
        const threadPayload = activeDm ? { thread: "dm", peer: activeDm } : {};
        // If an image is attached, upload it and include as `image` for llava
        const imgFile = files.find(f => f.type && f.type.startsWith("image"));
        if (imgFile) {
          const up = await api.uploadFile(imgFile, activeDm ? { thread: "dm", peer: activeDm, user: me } : { thread: "main", user: me });
          if (!up?.url) throw new Error("upload failed");
          ws.current?.send(JSON.stringify({ text: input, image: up.url, image_mime: up.mime, ...threadPayload }));
        } else {
          // Send full message; backend will parse @ai anywhere and echo it
          ws.current?.send(JSON.stringify({ text: input, ...threadPayload }));
        }
        setInput("");
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

    // Normal send flow (supports Main and DM)
    setSending(true);
    const threadPayload = activeDm ? { thread: "dm", peer: activeDm } : {};
    try {
      if (txt && files.length > 0) {
        if (ws.current && ws.current.readyState === WebSocket.OPEN) {
          ws.current.send(JSON.stringify({ text: txt, ...threadPayload }));
        } else {
          throw new Error("socket not connected");
        }
        for (const f of files) {
          const up = await api.uploadFile(f, activeDm ? { thread: "dm", peer: activeDm, user: me } : { thread: "main", user: me });
          if (!up?.url) throw new Error("upload failed");
          ws.current?.send(JSON.stringify({ url: up.url, mime: up.mime, ...threadPayload }));
        }
      } else if (txt) {
        if (ws.current && ws.current.readyState === WebSocket.OPEN) {
          ws.current.send(JSON.stringify({ text: txt, ...threadPayload }));
        } else {
          throw new Error("socket not connected");
        }
      } else {
        for (const f of files) {
          const up = await api.uploadFile(f, activeDm ? { thread: "dm", peer: activeDm, user: me } : { thread: "main", user: me });
          if (!up?.url) throw new Error("upload failed");
          ws.current?.send(JSON.stringify({ url: up.url, mime: up.mime, ...threadPayload }));
        }
      }
    } catch (e) {
      showAlert("Failed to send message or upload file(s)");
    } finally {
      setInput("");
      setFiles([]);
      setShowPicker(false);
      if (fileRef.current) fileRef.current.value = "";
      setSending(false);
      txtRef.current?.focus();
    }
  };

  const deleteMsg = (id: string) => {
    const threadPayload = activeDm ? { thread: "dm", peer: activeDm } : {} as any;
    ws.current?.send(JSON.stringify({ text: `/delete ${id}`, ...threadPayload }));
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
      const o = (ctx as any).createOscillator();
      const g = (ctx as any).createGain();
      o.type = "sine";
      o.frequency.value = 880; // A5
      o.connect(g);
      g.connect((ctx as any).destination);
      const now = (ctx as any).currentTime;
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.08, now + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
      o.start(now);
      o.stop(now + 0.15);
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

  // Track last DM toast visibility
  const [dmToast, setDmToast] = useState<{ user: string; id: number } | null>(null);
  const sidebarRef = useRef(true);
  useEffect(() => { sidebarRef.current = sidebar; }, [sidebar]);
  const scheduleDmToast = useCallback((user: string) => {
    if (sidebarRef.current) return; // only when collapsed
    setDmToast({ user, id: Date.now() });
    window.setTimeout(() => {
      setDmToast(t => (t && Date.now() - t.id >= 4800 ? null : t));
    }, 5000);
  }, []);

  // totalUnreadDm removed (was used only by removed mobile button); unread counts still available individually
  const [isMobile, setIsMobile] = useState<boolean>(typeof window !== 'undefined' ? window.innerWidth < 768 : false);
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return (
    <div className="flex h-screen bg-black text-[#f7f3e8] overflow-hidden relative">
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
  <div className={isMobile ? 'fixed inset-y-0 left-0 z-40' : `relative z-20 h-full transition-all duration-300 ${sidebar ? 'w-64' : 'w-12'}`}>
        <Sidebar
          users={users}
          me={me}
          activeDm={activeDm}
          unreadDm={unreadDm}
          unreadMain={unreadMain}
          sidebar={sidebar}
          setSidebar={setSidebar}
          onSelectDm={(u) => { setActiveDm(u); if (isMobile) setSidebar(false); }}
          onLogout={onLogout}
          admins={admins}
          tags={tagsMap}
          isMobile={isMobile}
        />
      </div>

      {/* Mobile open button removed per revised requirements (chevron only). */}

      {/* (mobile floating toggle removed per updated design) */}

      {/* CHAT */}
  <main className={`flex-1 flex flex-col bg-black relative transition-[padding] duration-300 ${isMobile && !sidebar ? 'pl-10' : 'pl-0'}`}>
        {/* Removed top notch banner when sidebar is collapsed */}
        {/* previously showed: DM/Main label floating at top when sidebar hidden */}

        <div ref={chatScrollRef} className="flex-1 p-6 overflow-y-auto overflow-x-hidden no-scrollbar">
          <div className="mb-2">
            <h3 className="text-sm text-white tracking-wide flex items-center justify-between">
              <span>{activeDm ? `DM with ${activeDm}` : "Main Chat"}</span>
              {activeDm && (
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

          {activeDm ? (
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
                const isImage = mime.startswith ? mime.startswith("image") : mime.startsWith("image");
                const isVideo = mime.startswith ? mime.startsWith("video") : mime.startsWith("video");
                const isAudio = mime.startswith ? mime.startsWith("audio") : mime.startsWith("audio");
                const firstUrl = m.type === "message" ? extractFirstUrl(m.text) : null;
                const onlyLinkOnly = !!firstUrl && m.text.trim() === firstUrl;
                const showUrlImg = !!firstUrl && onlyLinkOnly && isImgUrl(firstUrl);
                const showUrlVid = !!firstUrl && onlyLinkOnly && isVidUrl(firstUrl);
                const displayText = m.type === "message" ? m.text.replace(/^\/ai\b/i, "@ai") : m.text;
                const mentionedCurrentUser = (m.type === "message" || m.type === "media") && mentionsMe(m.text || "");
                const shouldFlash = !mine && mentionedCurrentUser && !!flashMap[m.id];
                const alignRight = mine; // keep AI spinner on the left
                // resolve tag for sender
                const tagVal = (tagsMap as any)[m.sender];
                const tagObj = typeof tagVal === 'string' ? { text: tagVal, color: 'orange' } : (tagVal || null);
                return (
                  <div key={m.id} className={`flex ${alignRight ? "justify-end" : "justify-start"} ${first ? "mt-3" : ""} mb-2`}>
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
                      className={`relative max-w-[80%] inline-flex flex-col group ${alignRight ? "items-end" : "items-start"} ${shouldFlash ? "border-2 rounded-2xl" : ""}`}
                      style={shouldFlash ? { animation: "flash-red 1.6s ease-in-out infinite", borderColor: "rgba(239,68,68,0.85)", padding: "0.16rem" } : undefined}
                    >
                      {first && (
                        <div className="flex items-baseline gap-2 mb-0.5">
                          <span className={`text-sm font-semibold ${m.sender === "AI" ? "text-blue-400" : (mine ? "text-[#e7dec3]" : "text-[#cfc7aa]")}`}>
                            {m.sender === "AI" && m.model ? `AI (${m.model})` : (
                              <>
                                {m.sender}
                                {(() => { const tv = (tagsMap as any)[m.sender]; const tobj = typeof tv === 'string' ? { text: tv, color: 'orange' } : (tv || null); const isDevSender = !!(tobj && ((tobj as any).special === 'dev' || (tobj as any).color === 'rainbow' || String((tobj as any).text || '').toUpperCase() === 'DEV')); return (admins.includes(m.sender) && !isDevSender) ? <span className="text-red-500 font-semibold"> (ADMIN)</span> : null; })()}
                                {tagObj && (
                                  <span className={`${(tagObj as any).special === 'dev' || (tagObj as any).color === 'rainbow' ? 'dev-rainbow' : colorClass((tagObj as any).color)} font-semibold`}> ({tagObj.text})</span>
                                )}
                              </>
                            )}
                          </span>
                          <span className="text-xs text-[#b5ad94]">{fmtTime(m.timestamp)}</span>
                        </div>
                      )}

                      {/* AI spinner when text is empty */}
                      {m.type === "message" && m.sender === "AI" && !(m.text && m.text.trim()) && (
                        <div className={`relative inline-block rounded-2xl px-4 py-3 break-words whitespace-pre-wrap max-w-[85vw] sm:max-w-[70ch] ${mine ? "bg-[#e7dec3]/90 text-[#1c1c1c]" : "bg-[#2b2b2b]/70 text-[#f7f3e8]"}`} style={{ wordBreak: "break-word", overflowWrap: "anywhere" }}>
                           <span className="inline-flex items-center gap-2 text-[#cfc7aa]">
                             Generating Response <Loader2 className="h-4 w-4 animate-spin" />
                           </span>
                         </div>
                       )}
                      {m.type === "message" && !(showUrlImg || showUrlVid) && !(m.sender === "AI" && !(m.text && m.text.trim())) && (
                        <div className="relative inline-block max-w-[85vw] sm:max-w-[70ch]">
                          <div className={`rounded-2xl px-4 py-3 break-words whitespace-pre-wrap overflow-hidden ${mine ? "bg-[#e7dec3]/90 text-[#1c1c1c]" : "bg-[#2b2b2b]/70 text-[#f7f3e8]"}`} style={{ wordBreak: "break-word", overflowWrap: "anywhere" }}>
                            {renderRichText(displayText || "")}
                          </div>
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

                      {/* URL preview bubble for pure links */}
                      {m.type === "message" && (showUrlImg || showUrlVid) && (
                        <div className="relative">
                          {showUrlImg ? (
                            <img src={firstUrl!} className="max-w-[75vw] sm:max-w-[60ch] rounded-xl" />
                          ) : (
                            <video src={firstUrl!} controls className="max-w-[75vw] sm:max-w-[60ch] rounded-xl" />
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

                      {/* Media message (image/video/audio) */}
                      {m.type === "media" && (
                        <div className="relative">
                          {isImage ? (
                            <img src={full(m.url)} className="max-w-[75vw] sm:max-w-[60ch] rounded-xl" />
                          ) : isVideo ? (
                            <video src={full(m.url)} controls className="max-w-[75vw] sm:max-w-[60ch] rounded-xl" />
                          ) : isAudio ? (
                            <audio src={full(m.url)} controls className="w-[75vw] max-w-[60ch]" />
                          ) : (
                            <a href={full(m.url)} target="_blank" className={`block rounded-2xl px-4 py-3 ${mine ? "bg-[#e7dec3]/90 text-[#1c1c1c]" : "bg-[#2b2b2b]/70 text-[#f7f3e8]"} underline`}>Download file ({m.mime || "file"})</a>
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
                const tagObj = typeof tagVal === 'string' ? { text: tagVal, color: 'orange' } : (tagVal || null);
                return (
                  <div key={m.id} className={`flex ${alignRight ? "justify-end" : "justify-start"} ${first ? "mt-3" : ""} mb-2`}>
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
                      className={`relative max-w-[80%] inline-flex flex-col group ${alignRight ? "items-end" : "items-start"} ${shouldFlash ? "border-2 rounded-2xl" : ""}`}
                      style={shouldFlash ? { animation: "flash-red 1.6s ease-in-out infinite", borderColor: "rgba(239,68,68,0.85)", padding: "0.16rem" } : undefined}
                    >
                      {first && (
                        <div className="flex items-baseline gap-2 mb-0.5">
                          <span className={`text-sm font-semibold ${m.sender === "AI" ? "text-blue-400" : (mine ? "text-[#e7dec3]" : "text-[#cfc7aa]")}`}>
                            {m.sender === "AI" && m.model ? `AI (${m.model})` : (
                              <>
                                {m.sender}
                                {(() => { const tv = (tagsMap as any)[m.sender]; const tobj = typeof tv === 'string' ? { text: tv, color: 'orange' } : (tv || null); const isDevSender = !!(tobj && ((tobj as any).special === 'dev' || (tobj as any).color === 'rainbow' || String((tobj as any).text || '').toUpperCase() === 'DEV')); return (admins.includes(m.sender) && !isDevSender) ? <span className="text-red-500 font-semibold"> (ADMIN)</span> : null; })()}
                                {tagObj && (
                                  <span className={`${(tagObj as any).special === 'dev' || (tagObj as any).color === 'rainbow' ? 'dev-rainbow' : colorClass((tagObj as any).color)} font-semibold`}> ({tagObj.text})</span>
                                )}
                              </>
                            )}
                          </span>
                          <span className="text-xs text-[#b5ad94]">{fmtTime(m.timestamp)}</span>
                        </div>
                      )}

                      {/* AI spinner when text is empty */}
                      {m.type === "message" && m.sender === "AI" && !(m.text && m.text.trim()) && (
                        <div className={`relative inline-block rounded-2xl px-4 py-3 break-words whitespace-pre-wrap max-w-[85vw] sm:max-w-[70ch] ${mine ? "bg-[#e7dec3]/90 text-[#1c1c1c]" : "bg-[#2b2b2b]/70 text-[#f7f3e8]"}`} style={{ wordBreak: "break-word", overflowWrap: "anywhere" }}>
                           <span className="inline-flex items-center gap-2 text-[#cfc7aa]">
                             Generating Response <Loader2 className="h-4 w-4 animate-spin" />
                           </span>
                         </div>
                       )}
                      {m.type === "message" && !(showUrlImg || showUrlVid) && !(m.sender === "AI" && !(m.text && m.text.trim())) && (
                        <div className="relative inline-block max-w-[85vw] sm:max-w-[70ch]">
                          <div className={`rounded-2xl px-4 py-3 break-words whitespace-pre-wrap overflow-hidden ${mine ? "bg-[#e7dec3]/90 text-[#1c1c1c]" : "bg-[#2b2b2b]/70 text-[#f7f3e8]"}`} style={{ wordBreak: "break-word", overflowWrap: "anywhere" }}>
                            {renderRichText(displayText || "")}
                          </div>
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

                      {/* URL preview bubble for pure links */}
                      {m.type === "message" && (showUrlImg || showUrlVid) && (
                        <div className="relative">
                          {showUrlImg ? (
                            <img src={firstUrl!} className="max-w-[75vw] sm:max-w-[60ch] rounded-xl" />
                          ) : (
                            <video src={firstUrl!} controls className="max-w-[75vw] sm:max-w-[60ch] rounded-xl" />
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

                      {/* Media message (image/video/audio) */}
                      {m.type === "media" && (
                        <div className="relative">
                          {isImage ? (
                            <img src={full(m.url)} className="max-w-[75vw] sm:max-w-[60ch] rounded-xl" />
                          ) : isVideo ? (
                            <video src={full(m.url)} controls className="max-w-[75vw] sm:max-w-[60ch] rounded-xl" />
                          ) : isAudio ? (
                            <audio src={full(m.url)} controls className="w-[75vw] max-w-[60ch]" />
                          ) : (
                            <a href={full(m.url)} target="_blank" className={`block rounded-2xl px-4 py-3 ${mine ? "bg-[#e7dec3]/90 text-[#1c1c1c]" : "bg-[#2b2b2b]/70 text-[#f7f3e8]"} underline`}>Download file ({m.mime || "file"})</a>
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
        <div className="relative p-4 pb-6">
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
              {/* Overlay that highlights @mentions in the input */}
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
              <TextareaAutosize
                ref={txtRef}
                value={input}
                onChange={e => {
                  let v = e.target.value;
                  try { v = emoji.replace_colons(v); } catch {}
                  setInput(v);
                  pingTyping(v);
                }}
                onFocus={() => pingTyping(input)}
                onBlur={() => {}}
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
                className="relative z-10 w-full bg-transparent border-none resize-none focus:outline-none text-transparent caret-[#f7f3e8] pr-16 sm:pr-12"
                maxRows={5}
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
        </div>
      </main>
    </div>
  );
}
