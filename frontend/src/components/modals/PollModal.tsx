import { useEffect, useRef, useState } from "react";

export default function PollModal({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (question: string, options: string[]) => void;
}) {
  const [q, setQ] = useState("");
  const [opts, setOpts] = useState<string[]>(["", ""]);
  const [err, setErr] = useState("");
  const primaryRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (open) {
      setErr("");
      setQ("");
      setOpts(["", ""]);
      setTimeout(() => primaryRef.current?.focus(), 0);
    }
  }, [open]);

  // Escape to close (hook must precede early return)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const addOpt = () => {
    if (opts.length >= 10) return;
    setOpts([...opts, ""]);
  };
  const rmOpt = (idx: number) => {
    if (opts.length <= 2) return;
    setOpts(opts.filter((_, i) => i !== idx));
  };
  const setOpt = (idx: number, v: string) => {
    setOpts(opts.map((o, i) => (i === idx ? v : o)));
  };

  const submit = () => {
    const qq = (q || "").trim();
    const oo = opts.map(o => (o || "").trim()).filter(Boolean);
    if (!qq) { setErr("Enter a question"); return; }
    if (oo.length < 2) { setErr("At least 2 options required"); return; }
    onCreate(qq, oo.slice(0, 10));
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[160] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <style>{`@keyframes modal-in{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}`}</style>
      <form
        onSubmit={(e) => { e.preventDefault(); submit(); }}
        className="relative w-[min(92vw,560px)] max-h-[88vh] overflow-hidden bg-black/90 border border-white/30 rounded-3xl shadow-2xl text-[#f7f3e8] p-0 flex flex-col animate-[modal-in_140ms_ease-out]"
      >
  <button aria-label="Close" onClick={onClose} className="absolute right-3 top-3 inline-flex items-center justify-center h-8 w-8 rounded-full bg-white/5 hover:bg-white/10 text-[#cfc7aa] hover:text-white border border-white/10 focus:outline-none focus:ring-2 focus:ring-white/30">✕</button>
        <div className="text-center text-white text-lg font-semibold py-4">Create Poll</div>
        <hr className="border-white/10" />
        <div className="p-4 space-y-4">
          <div>
            <label className="block text-xs text-white/70 mb-1">Question</label>
            <input value={q} onChange={(e) => setQ(e.target.value)}
              className="w-full px-4 py-2.5 rounded-2xl bg-white/10 border border-white/15 text-white outline-none focus:border-white/30 transition" />
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-white/70">Options (2–10)</span>
              <button type="button" onClick={addOpt} disabled={opts.length>=10} className="px-3 py-1.5 rounded-xl bg-white/10 border border-white/15 text-white text-xs disabled:opacity-60">Add</button>
            </div>
            {opts.map((o, i) => (
              <div key={i} className="flex items-center gap-2">
                <input value={o} onChange={(e) => setOpt(i, e.target.value)} placeholder={`Option ${i+1}`}
                  className="flex-1 px-4 py-2.5 rounded-2xl bg-white/10 border border-white/15 text-white outline-none focus:border-white/30 transition" />
                <button type="button" onClick={() => rmOpt(i)} disabled={opts.length<=2} className="px-3 py-2 rounded-xl bg-red-600/80 hover:bg-red-700 text-white text-xs disabled:opacity-60">Remove</button>
              </div>
            ))}
          </div>
          {err && <p className="text-red-400 text-sm text-center">{err}</p>}
        </div>
        <hr className="border-white/10" />
        <div className="p-4 flex items-center justify-end gap-3">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-2xl border border-white/20 text-white/90 hover:bg-white/10">Cancel</button>
          <button ref={primaryRef} type="submit" className="px-4 py-2 rounded-2xl bg-white text-black font-medium hover:brightness-95 active:scale-[0.99] transition">Create</button>
        </div>
      </form>
    </div>
  );
}
