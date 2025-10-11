import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import TextareaAutosize from "react-textarea-autosize";
import { Paperclip, Send, Loader2, X, Smile, Trash2 } from "lucide-react";
import EmojiPicker, { Theme } from "emoji-picker-react";
import EmojiConvertor from "emoji-js";
import AlertModal from "@/components/AlertModal";

import * as api from "@/services/api";

export function ChatInterface({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [me, setMe] = useState("");
  const [role, setRole] = useState("");
  const [users, setUsers] = useState<string[]>([]);
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
  // typing indicator state
  const [typingUser, setTypingUser] = useState("");
  const [typingVisible, setTypingVisible] = useState(false);
  // alert modal state
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertText, setAlertText] = useState("");
  const [alertButton, setAlertButton] = useState<string | undefined>("OK");
  const alertActionRef = useRef<(() => void) | null>(null);

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

  // Active mention targets: online users + 'ai'
  const activeMentions = useMemo(() => {
    const s = new Set<string>(["ai"]);
    users.forEach(u => s.add(u.toLowerCase()));
    return s;
  }, [users]);

  // emoji conversion for :shortcodes:
  const emoji = new EmojiConvertor();
  emoji.replace_mode = "unified";
  emoji.allow_native = true;

  const isAdmin = role === "admin";
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
    const re = new RegExp(`(^|\\s|[^\\w])@${escapeRegex(me)}(?![\\w])`, "i");
    return re.test(text);
  }, [me]);

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

  // Disconnect observer and clear timers on unmount
  useEffect(() => () => {
    Object.values(timeoutRefs.current).forEach(t => window.clearTimeout(t));
    Object.values(fallbackFlashRefs.current).forEach(t => window.clearTimeout(t));
    try { observerRef.current?.disconnect(); } catch {}
  }, []);

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
      // central alerts
      if (d.type === "alert") {
        const text = (d.text || "").toUpperCase().replace(/\.$/, "");
        const code = (d.code || "").toUpperCase();
        // Also show OS notification for critical alerts
        if (code === "KICKED" || code === "BANNED" || code === "BANNED_CONNECT") {
          notify("Alert", text);
        }
        const shouldLogout = code === "KICKED" || code === "BANNED" || code === "BANNED_CONNECT";
        showAlert(text, shouldLogout ? () => onLogout() : undefined);
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
          if (activeDmRef.current === d.peer) setMessages([]);
        } else {
          if (activeDmRef.current === null) setMessages([]);
        }
        return;
      }

      // Histories
      if (d.type === "history" && Array.isArray(d.items)) {
        seen.current.clear();
        d.items.forEach((x: any) => x?.id && seen.current.add(x.id));
        historyIdsRef.current = new Set((d.items || []).map((x: any) => x && x.id).filter(Boolean));
        return setMessages(d.items);
      }
      if (d.type === "dm_history" && Array.isArray(d.items)) {
        seen.current.clear();
        d.items.forEach((x: any) => x?.id && seen.current.add(x.id));
        historyIdsRef.current = new Set((d.items || []).map((x: any) => x && x.id).filter(Boolean));
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

      // Route DM events and update unread counters
      if ((d.type === "message" || d.type === "media") && d.thread === "dm" && typeof d.peer === "string") {
        const isHidden = typeof document !== "undefined" && document.hidden;
        // If not on that DM thread, raise unread and do not render here
        if (activeDmRef.current !== d.peer) {
          setUnreadDm(prev => ({ ...prev, [d.peer]: (prev[d.peer] || 0) + 1 }));
          const title = `${d.sender} sent you a message (DM)`;
          const body = typeof d.text === "string" && d.text ? d.text : (d.mime || "media");
          if (d.sender !== me) notify(title, body);
          return;
        } else if (isHidden && d.sender !== me) {
          const title = `${d.sender} sent you a message (DM)`;
          const body = typeof d.text === "string" && d.text ? d.text : (d.mime || "media");
          notify(title, body);
        }
      }

      // Main thread unread counter when off Main and mentioned
      if ((d.type === "message" || d.type === "media") && (!d.thread || d.thread === "main") && d.sender) {
        const isHidden = typeof document !== "undefined" && document.hidden;
        const notOnMain = activeDmRef.current !== null;
        if (notOnMain && typeof d.text === "string" && d.sender !== me && mentionsMe(d.text)) {
          setUnreadMain(c => c + 1);
        }
        const shouldNotify = (notOnMain || isHidden) && d.sender !== me;
        if (shouldNotify) {
          const title = `${d.sender} (Main)`;
          const body = typeof d.text === "string" && d.text ? d.text : (d.mime || "media");
          notify(title, body);
        }
        // If currently viewing a DM, don't append main messages to the DM timeline
        if (activeDmRef.current !== null) return;
      }

      if (d.type === "user_list") return setUsers(d.users);

      // System events notifications and handle clear wording
      if (d.type === "system") {
        const txt = d.text || "";
        // If admin cleared the chat, also clear main timeline before appending
        if (activeDmRef.current === null && /CLEARED THE CHAT/i.test(txt)) {
          setMessages([]);
        }
        notify("System", txt);
        return setMessages(p => [...p, d]);
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

  useEffect(() => {
    if (messages.length) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Small mount animation for each message (fast + smooth) — run only once per element
  const animateIn = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    if (el.dataset.animated === "true") return; // prevent re-animating on re-renders
    el.dataset.animated = "true";
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
    const t = (text || "").toUpperCase().replace(/\.$/, "");
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

  const send = async () => {
    if (sending) return;
    const txt = input.trim();
    if (!txt && files.length === 0) return;

    // Intercept admin-only commands for non-admins and show modal instead of sending
    if (!isAdmin && /^(\/kick|\/ban|\/unban|\/clear)\b/i.test(txt)) {
      showAlert("only admin can use that command");
      return;
    }

    // Block attachments when using @ai
    if (/^@ai\b/i.test(txt) && files.length > 0) {
      showAlert("@ai does not accept attachments for now");
      return; // keep state so user can remove files
    }

    // @ai mention triggers AI (text-only)
    if (/^@ai\b/i.test(txt)) {
      const promptOnly = txt.replace(/^@ai\s*/i, "").trim();
      if (!promptOnly) {
        showAlert("usage: @ai <prompt>");
        return;
      }

      try {
        const threadPayload = activeDm ? { thread: "dm", peer: activeDm } : {};
        // Send only the @ai command; backend will echo the user's @ai message visibly
        ws.current?.send(JSON.stringify({ text: `@ai ${promptOnly}`, ...threadPayload }));
        setInput("");
        setFiles([]);
        setShowPicker(false);
      } catch {
        showAlert("failed to send ai request");
      } finally {
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
      showAlert("failed to send message or upload file(s)");
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
    const m = t.match(/(https?:\/\/[^^\s]+|data:[^\s]+)/i);
    return m ? m[1] : null;
  };
  const isImgUrl = (u: string) => /^data:image\//i.test(u) || /\.(png|jpe?g|gif|webp|avif)$/i.test(u);
  const isVidUrl = (u: string) => /^data:video\//i.test(u) || /\.(mp4|webm|ogg)$/i.test(u);

  // Helper: render URLs and @mentions in message text (no background; blue only for active targets)
  const renderRichText = (text: string) => {
    const parts = text.split(/(@[A-Za-z0-9_]+|https?:\/\/[^^\s]+|data:[^\s]+)/g);
    return parts.map((p, i) => {
      if (!p) return null;
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
        // Show a compact placeholder to avoid flooding the layout
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

  // Browser notifications
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  const notify = useCallback((title: string, body?: string) => {
    try {
      if (!("Notification" in window)) return;
      if (Notification.permission !== "granted") return;
      const n = new Notification(title, { body });
      // auto-close after a few seconds
      setTimeout(() => n.close(), 5000);
    } catch {}
  }, []);

  return (
    <div className="flex h-screen bg-black text-[#f7f3e8] overflow-hidden">
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
      `}</style>
      {/* Global alert modal */}
      <AlertModal
        open={alertOpen}
        text={alertText}
        buttonLabel={alertButton}
        onButton={() => { setAlertOpen(false); alertActionRef.current?.(); }}
        onClose={() => setAlertOpen(false)}
      />
      {/* SIDEBAR */}
      <aside
        onClick={() => !sidebar && setSidebar(true)}
        className={`transition-[width] duration-300 ease-out ${
          sidebar ? "w-64 opacity-100" : "w-8 opacity-80"
        } flex flex-col bg-[#0a0a0a] border-r border-white/10 rounded-tr-3xl rounded-br-3xl cursor-pointer relative overflow-visible z-20`}
      >
        <button
          onClick={e => {
            e.stopPropagation();
            setSidebar(!sidebar);
          }}
          className={`absolute right-0 top-1/2 translate-x-1/2 -translate-y-1/2 bg-[#0a0a0a] border border-white/10 text-[#e7dec3] text-[34px] font-bold rounded-full px-[7px] pb-[3px] hover:scale-110 transition-transform z-50`}
        >
          {sidebar ? "‹" : "›"}
        </button>

        <div className={`flex flex-col h-full overflow-hidden ${sidebar ? "transition-[opacity,transform] duration-200 ease-out opacity-100 translate-x-0" : "hidden"}`}>
          <h2 className="text-lg font-semibold text-center mt-3 mb-2">
            Online Users
          </h2>
          <hr className="border-white/10 mb-3 mx-3" />
          <ul className="space-y-3 px-4 overflow-y-auto no-scrollbar py-2">
            {users.map(u => {
              const isAdminUser =
                u.trim().toLowerCase() === "haz" ||
                u.trim().toLowerCase() === "haznas";
              const isMeUser = u === me;
              const selected = activeDm === u;
              const dmCount = unreadDm[u] || 0;
              return (
                <li key={u} className="">
                  <button
                    disabled={isMeUser}
                    onClick={() => !isMeUser && setActiveDm(u)}
                    className={`w-full text-left px-3 py-2 rounded-xl border transition flex items-center justify-between select-none ${
                      selected ? "bg-[#f5f3ef] text-black border-white/20" : "border-transparent hover:bg-white/10 hover:border-white/10 text-white"
                    } ${isMeUser ? "cursor-not-allowed" : "cursor-pointer"}`}
                  >
                    <span className={selected ? "text-black" : (isMeUser ? "text-blue-500 font-semibold" : "text-white")}>
                      {u}
                       {isAdminUser && <span className="text-red-500 font-semibold"> (ADMIN)</span>}
                     </span>
                    {dmCount > 0 && (
                      <span className="ml-2 inline-flex items-center justify-center w-6 h-6 rounded-full bg-red-500/80 text-white text-xs font-bold">
                        {dmCount}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          <hr className="border-white/10 mt-6 mb-4 mx-3" />
          <div className="px-4 pb-3">
            <button
              onClick={() => setActiveDm(null)}
              className={`w-full text-left px-3 py-2 rounded-xl border transition flex items-center justify-between select-none ${
                activeDm === null ? "bg-[#f5f3ef] text-black border-white/20" : "border-transparent hover:bg-white/10 hover:border-white/10 text-white"
              }`}
            >
              <span className={activeDm === null ? "text-black" : "text-white"}>Main Chat</span>
              {unreadMain > 0 && (
                <span className="ml-2 inline-flex items-center justify-center w-6 h-6 rounded-full bg-red-500/80 text-white text-xs font-bold">
                  {unreadMain}
                </span>
              )}
            </button>
          </div>

          <div className="mt-auto pt-2 pb-4 border-t border-white/10 mx-2">
            <Button
              onClick={onLogout}
              className="w-full bg-red-600/90 hover:bg-red-700 text-white rounded-xl shadow-[0_0_10px_rgba(255,0,0,0.3)] transition-all"
            >
              Logout
            </Button>
          </div>
        </div>
      </aside>

      {/* CHAT */}
      <main className="flex-1 flex flex-col bg-black relative">
        {/* Removed top notch banner when sidebar is collapsed */}
        {/* previously showed: DM/Main label floating at top when sidebar hidden */}

        <div ref={chatScrollRef} className="flex-1 p-6 overflow-y-auto overflow-x-hidden no-scrollbar">
          <div className="mb-2">
            <h3 className="text-sm text-white tracking-wide flex items-center justify-between">
              <span>{activeDm ? `DM with ${activeDm}` : "Main Chat"}</span>
              {activeDm && (
                <button
                  onClick={() => ws.current?.send(JSON.stringify({ text: "/clear", thread: "dm", peer: activeDm }))}
                  className="ml-3 inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl bg-red-600/90 hover:bg-red-700 text-white shadow-[0_0_10px_rgba(255,0,0,0.3)] transition-all"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Clear DM
                </button>
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
                      <div className="text-xs text-[#cfc7aa]/90 italic">{m.text}</div>
                    </div>
                  );
                }
                const mine = m.sender === me;
                const first = i === 0 || messages[i - 1].sender !== m.sender;
                const canDelete = mine || isAdmin;
                const mime = m.mime || "";
                const isImage = mime.startswith ? mime.startswith("image") : mime.startsWith("image");
                const isVideo = mime.startswith ? mime.startswith("video") : mime.startsWith("video");
                const isAudio = mime.startswith ? mime.startsWith("audio") : mime.startsWith("audio");
                const firstUrl = m.type === "message" ? extractFirstUrl(m.text) : null;
                const onlyLinkOnly = !!firstUrl && m.text.trim() === firstUrl;
                const showUrlImg = !!firstUrl && onlyLinkOnly && isImgUrl(firstUrl);
                const showUrlVid = !!firstUrl && onlyLinkOnly && isVidUrl(firstUrl);
                const displayText = m.type === "message" ? m.text.replace(/^\/ai\b/i, "@ai") : m.text;
                const mentionedCurrentUser = (m.type === "message" || m.type === "media") && mentionsMe(m.text || "");
                const shouldFlash = !mine && mentionedCurrentUser && !!flashMap[m.id];
                const alignRight = mine; // keep AI spinner on the left
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
                            {m.sender}
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
                        </div>
                      )}

                      {/* Media message (image/video/audio) */}
                      {(isImage || isVideo || isAudio) && (
                        <div className="relative">
                          {isImage ? (
                            <img src={full(m.url)} className="max-w-[75vw] sm:max-w-[60ch] rounded-xl" />
                          ) : isVideo ? (
                            <video src={full(m.url)} controls className="max-w-[75vw] sm:max-w-[60ch] rounded-xl" />
                          ) : (
                            <audio src={full(m.url)} controls className="w-[75vw] max-w-[60ch]" />
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
                      <div className="text-xs text-[#cfc7aa]/90 italic">{m.text}</div>
                    </div>
                  );
                }
                const mine = m.sender === me;
                const first = i === 0 || messages[i - 1].sender !== m.sender;
                const canDelete = mine || isAdmin; // allow author or admin to delete in Main
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
                            {m.sender}
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
                        </div>
                      )}

                      {/* Media message (image/video/audio) */}
                      {(isImage || isVideo || isAudio) && (
                        <div className="relative">
                          {isImage ? (
                            <img src={full(m.url)} className="max-w-[75vw] sm:max-w-[60ch] rounded-xl" />
                          ) : isVideo ? (
                            <video src={full(m.url)} controls className="max-w-[75vw] sm:max-w-[60ch] rounded-xl" />
                          ) : (
                            <audio src={full(m.url)} controls className="w-[75vw] max-w-[60ch]" />
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

        {/* INPUT */}
        <div className="relative p-4 pb-6">
          {/* Decorative glass/fade backdrop behind composer with softer opacity and fade-up animation */}
          <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-36 -z-10">
            <div className="mx-3 h-full rounded-3xl border border-white/10 bg-gradient-to-t from-white/8 to-transparent backdrop-blur-xl shadow-[0_-10px_40px_rgba(255,255,255,0.06)]" style={{ opacity: 0.35, animation: "fade-rise 300ms ease-out" }} />
          </div>

          {files.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {files.map((f, i) => (
                <div key={i} className="relative">
                  <img src={URL.createObjectURL(f)} className="h-16 w-16 rounded-lg object-cover" />
                  <button onClick={() => setFiles(files.filter((_, x) => x !== i))} className="absolute -top-1 -right-1 bg-red-600 rounded-full text-white text-[10px] leading-none px-[3px]">
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Emoji picker */}
          {showPicker && (
            <div className="absolute bottom-24 right-6 z-10">
              <EmojiPicker
                theme={Theme.DARK}
                onEmojiClick={(e) => {
                  setInput(prev => prev + (e.emoji || ""));
                  txtRef.current?.focus();
                }}
                lazyLoadEmojis
              />
            </div>
          )}

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
                // Prevent attaching files when composing an @ai message
                if (/^@ai\b/i.test(input.trim())) {
                  showAlert("@ai does not accept attachments for now");
                  if (fileRef.current) fileRef.current.value = "";
                  return;
                }
                setFiles([...files, ...Array.from(e.target.files || [])]);
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
                  const v = emoji.replace_colons(e.target.value);
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
                    if (/^@ai\b/i.test(input.trim())) {
                      setAlertText("@ai does not accept attachments for now");
                      setAlertButton("OK");
                      alertActionRef.current = null;
                      setAlertOpen(true);
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
