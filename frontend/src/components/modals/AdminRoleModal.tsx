import { useEffect, useMemo, useRef, useState } from "react";

type Props = {
  open: boolean;
  me: string;
  users: string[];
  admins: string[];
  tagsMap: Record<string, any>;
  mode: "mkadmin" | "rmadmin";
  showPurge: boolean; // show Purge Admins button (DEV only)
  onClose: () => void;
  onSubmit: (user: string, superpass: string) => void;
  onPurgeAdmins: () => void;
};

export default function AdminRoleModal({ open, me, users, admins, tagsMap, mode, showPurge, onClose, onSubmit, onPurgeAdmins }: Props) {
  const [target, setTarget] = useState<string>("");
  const [superpass, setSuperpass] = useState<string>("");
  const primaryRef = useRef<HTMLButtonElement | null>(null);

  const isDevUser = (u: string) => {
    const tag = (tagsMap as any)[u];
    if (!tag) return false;
    const obj = typeof tag === 'string' ? { text: tag, color: 'white' } : tag;
    return obj?.special === 'dev';
  };

  const candidates = useMemo(() => {
    // Exclude DEV always; also exclude self to avoid self-promotion/demotion surprises
    const base = users.filter(u => u !== me && !isDevUser(u));
    if (mode === 'rmadmin') {
      // Only list current admins for removal
      const adminSet = new Set(admins);
      return base.filter(u => adminSet.has(u));
    } else {
      // mkadmin: only non-admins are eligible
      const adminSet = new Set(admins);
      return base.filter(u => !adminSet.has(u));
    }
  }, [users, me, tagsMap, mode, admins]);

  useEffect(() => {
    if (open) {
      setTarget("");
      setSuperpass("");
      setTimeout(() => primaryRef.current?.focus(), 0);
    }
  }, [open]);

  // Escape to close (keep hook order stable)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const title = mode === 'mkadmin' ? 'Promote to Admin' : 'Remove Admin';

  const submit = () => {
    if (!target || !superpass) return;
    onSubmit(target, superpass);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[160] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <style>{`@keyframes modal-in{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}`}</style>
      <form onSubmit={(e)=>{e.preventDefault(); submit();}} className="relative w-[min(92vw,560px)] max-h-[88vh] overflow-hidden bg-black/90 border border-white/30 rounded-3xl shadow-2xl text-[#f7f3e8] p-0 flex flex-col animate-[modal-in_140ms_ease-out]">
  <button aria-label="Close" onClick={onClose} className="absolute right-3 top-3 inline-flex items-center justify-center h-8 w-8 rounded-full bg-white/5 hover:bg-white/10 text-[#cfc7aa] hover:text-white border border-white/10 focus:outline-none focus:ring-2 focus:ring-white/30">✕</button>
        <div className="text-center text-white text-lg font-semibold py-4">{title}</div>
        <hr className="border-white/10" />
        <div className="p-4">
          <div className="text-sm text-white/70 mb-2">Choose user</div>
          <div className="max-h-[40vh] overflow-y-auto">
            <ul className="space-y-2">
              {candidates.map(u => (
                <li key={u}>
                  <label className="flex items-center gap-4 cursor-pointer select-none px-2 py-2 rounded-xl hover:bg-white/5 transition">
                    <input type="radio" name="admin-target" className="peer sr-only" checked={target === u} onChange={() => setTarget(u)} />
                    <span className="inline-flex items-center justify-center h-7 w-7 rounded-full border-2 border-white/25 bg-transparent transition-all duration-100 peer-checked:bg-white peer-checked:border-white">
                      <svg className="h-3.5 w-3.5 text-black opacity-0 peer-checked:opacity-100 transition-opacity duration-100" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5"><path d="M20 6 9 17l-5-5"/></svg>
                    </span>
                    <span className="text-[16px] leading-tight">{u}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <hr className="border-white/10" />
        <div className="p-4">
          <div className="text-sm text-white/70 mb-1">Superpass</div>
          <input value={superpass} onChange={(e)=>setSuperpass(e.target.value)} className="w-full px-4 py-2.5 rounded-2xl bg-white/10 border border-white/15 text-white outline-none focus:border-white/30 transition" placeholder="Enter superpass" />
        </div>
        <hr className="border-white/10" />
        <div className="p-4 flex items-center justify-between gap-3">
          {showPurge ? (
            <button type="button" onClick={() => { onClose(); onPurgeAdmins(); }} className="px-4 py-2 rounded-xl bg-red-600/90 hover:bg-red-700 text-white border border-red-400/50">
              Purge Admins
            </button>
          ) : <div />}
          <button ref={primaryRef} type="submit" className="px-4 py-2 rounded-2xl bg-white text-black font-medium hover:brightness-95 active:scale-[0.99] transition">
            OK
          </button>
        </div>
      </form>
    </div>
  );
}
