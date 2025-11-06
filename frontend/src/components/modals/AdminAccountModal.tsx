import { useEffect, useRef, useState } from "react";
import * as api from "@/services/api";

type Props = {
  open: boolean;
  token: string;
  username: string; // target account username (acct)
  onClose: () => void;
  onSaved?: (updated: api.AccountInfo) => void;
};

export default function AdminAccountModal({ open, token, username, onClose, onSaved }: Props) {
  const [origUsername, setOrigUsername] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [createdAt, setCreatedAt] = useState<string | undefined>(undefined);
  const [lastIp, setLastIp] = useState<string | undefined>(undefined);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState("");
  const primaryRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (open) {
      setErr(""); setPassword(""); setSaving(false);
      setOrigUsername(username);
      setTimeout(() => primaryRef.current?.focus(), 0);
      setLoading(true);
      api.getAccountAdmin(token, username).then((d) => {
        setNewUsername(d.username || username || "");
        setDisplayName(d.display_name || d.username || username || "");
        setCreatedAt(d.created_at || undefined);
        setLastIp(d.last_seen_ip || undefined);
      }).catch((e) => {
        setErr(e?.message || "Failed to load account");
      }).finally(() => setLoading(false));
    }
  }, [open, token, username]);

  // Escape to close (hook must be declared before conditional return)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const onSubmit = async () => {
    setErr(""); setSaving(true);
    const uname = (newUsername || "").trim();
    const disp = (displayName || "").trim();
    if (!uname) { setErr("Username required"); setSaving(false); return; }
    try {
      const updated = await api.updateAccountAdmin(token, origUsername, { username: uname, display_name: disp, password: password || undefined });
      onSaved?.(updated);
      onClose();
    } catch (e: any) {
      setErr(e?.message || "Update failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[170] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <style>{`@keyframes modal-in{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}`}</style>
      <form
        onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
        className="relative w-[min(92vw,520px)] max-h-[88vh] overflow-hidden bg-black/90 border border-white/30 rounded-3xl shadow-2xl text-[#f7f3e8] p-0 flex flex-col animate-[modal-in_140ms_ease-out]"
      >
  <button aria-label="Close" onClick={onClose} className="absolute right-3 top-3 inline-flex items-center justify-center h-8 w-8 rounded-full bg-white/5 hover:bg-white/10 text-[#cfc7aa] hover:text-white border border-white/10 focus:outline-none focus:ring-2 focus:ring-white/30">✕</button>
        <div className="text-center text-white text-lg font-semibold py-4">Manage Account (Admin)</div>
        <hr className="border-white/10" />
        <div className="p-4 space-y-4">
          {loading ? (
            <div className="text-white/80 text-center">Loading…</div>
          ) : (
            <>
              <div>
                <label className="block text-xs text-white/70 mb-1">Username</label>
                <input value={newUsername} onChange={(e) => setNewUsername(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-2xl bg-white/10 border border-white/15 text-white outline-none focus:border-white/30 transition" />
              </div>
              <div>
                <label className="block text-xs text-white/70 mb-1">Display Name</label>
                <input value={displayName} onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-2xl bg-white/10 border border-white/15 text-white outline-none focus:border-white/30 transition" />
              </div>
              <div>
                <label className="block text-xs text-white/70 mb-1">New Password</label>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="(leave blank to keep)"
                  className="w-full px-4 py-2.5 rounded-2xl bg-white/10 border border-white/15 text-white outline-none focus:border-white/30 transition" />
              </div>
              <div className="text-xs text-white/50">
                <div>Created: {createdAt ? new Date(createdAt).toLocaleString() : "—"}</div>
                <div>Last IP: {lastIp || "—"}</div>
              </div>
              {err && <p className="text-red-400 text-center text-sm">{err}</p>}
            </>
          )}
        </div>
        <hr className="border-white/10" />
        <div className="p-4 flex items-center justify-between gap-3">
          {/* Dangerous: Delete Account */}
          <button
            type="button"
            onClick={async () => {
              if (deleting || loading) return;
              const ok = window.confirm(`Delete account \"${origUsername || username}\"? This cannot be undone.`);
              if (!ok) return;
              try {
                setErr("");
                setDeleting(true);
                await api.deleteAccountAdmin(token, origUsername || username);
                onClose();
              } catch (e: any) {
                setErr(e?.message || "Delete failed");
              } finally {
                setDeleting(false);
              }
            }}
            disabled={deleting || loading}
            className="px-4 py-2 rounded-2xl bg-red-600 hover:bg-red-700 text-white font-medium shadow-[0_0_10px_rgba(255,0,0,0.3)] disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {deleting ? "Deleting…" : "Delete Account"}
          </button>

          <button type="button" onClick={onClose} className="px-4 py-2 rounded-2xl border border-white/20 text-white/90 hover:bg-white/10">Cancel</button>
          <button ref={primaryRef} type="submit" disabled={saving || loading}
            className="px-4 py-2 rounded-2xl bg-white text-black font-medium hover:brightness-95 active:scale-[0.99] transition">
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </form>
    </div>
  );
}
