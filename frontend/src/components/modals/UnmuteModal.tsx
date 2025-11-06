import { useEffect, useMemo, useRef, useState } from "react";

type Props = {
  open: boolean;
  muted: string[];
  onClose: () => void;
  onSubmit: (selected: string[]) => void;
};

export default function UnmuteModal({ open, muted, onClose, onSubmit }: Props) {
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const primaryRef = useRef<HTMLButtonElement | null>(null);

  const candidates = useMemo(() => (Array.isArray(muted) ? muted : []), [muted]);

  useEffect(() => {
    if (open) {
      setSelected({});
      setTimeout(() => primaryRef.current?.focus(), 0);
    }
  }, [open]);

  if (!open) return null;

  const toggle = (u: string) => setSelected(prev => ({ ...prev, [u]: !prev[u] }));
  const submit = () => {
    const sel = candidates.filter(u => selected[u]);
    if (sel.length === 0) return;
    onSubmit(sel);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[160] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <style>{`@keyframes modal-in{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}`}</style>
      <form onKeyDown={(e)=>{ if (e.key==='Escape'){ e.preventDefault(); onClose(); } }} onSubmit={(e)=>{e.preventDefault(); submit();}} className="relative w-[min(92vw,560px)] max-h-[88vh] overflow-hidden bg-black/90 border border-white/30 rounded-3xl shadow-2xl text-[#f7f3e8] p-0 flex flex-col animate-[modal-in_140ms_ease-out]">
  <button aria-label="Close" onClick={onClose} className="absolute right-3 top-3 inline-flex items-center justify-center h-8 w-8 rounded-full bg-white/5 hover:bg-white/10 text-[#cfc7aa] hover:text-white border border-white/10 focus:outline-none focus:ring-2 focus:ring-white/30">✕</button>
        <div className="text-center text-white text-lg font-semibold py-4">Unmute Users</div>
        <hr className="border-white/10" />
        <div className="p-4 overflow-y-auto max-h-[60vh]">
          {candidates.length === 0 ? (
            <div className="text-sm text-white/70 text-center py-6">No users are currently muted.</div>
          ) : (
            <ul className="space-y-2">
              {candidates.map(u => (
                <li key={u}>
                  <label className="flex items-center gap-4 cursor-pointer select-none px-2 py-2 rounded-xl hover:bg-white/5 transition">
                    <input type="checkbox" checked={!!selected[u]} onChange={()=>toggle(u)} className="peer sr-only" />
                    <span className="inline-flex items-center justify-center h-7 w-7 rounded-xl border-2 border-white/25 bg-transparent transition-all duration-100 peer-checked:bg-white peer-checked:border-white">
                      <svg className="h-4 w-4 text-black opacity-0 peer-checked:opacity-100 transition-opacity duration-100" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5"><path d="M20 6 9 17l-5-5"/></svg>
                    </span>
                    <span className="text-[16px] leading-tight">{u}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
        <hr className="border-white/10" />
        <div className="p-4">
          <button ref={primaryRef} type="submit" disabled={candidates.length === 0} className="w-full bg-white text-black rounded-2xl py-2.5 font-medium hover:brightness-95 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.99] transition">
            Unmute
          </button>
        </div>
      </form>
    </div>
  );
}
