import { useEffect, useRef, useState } from 'react';

type Props = {
  open: boolean;
  me: string;
  users: string[];
  onClose: () => void;
  onCreate: (name: string, members: string[]) => void;
};

export default function CreateGcModal({ open, me, users, onClose, onCreate }: Props) {
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setSelected({});
      if (buttonRef.current) {
        buttonRef.current.focus();
      }
    }
  }, [open]);
  // Escape to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  const others = users.filter(u => u !== me);
  const toggle = (u: string) => setSelected(prev => ({ ...prev, [u]: !prev[u] }));
  const submit = () => {
    const members = others.filter(u => selected[u]);
    onCreate(name.trim() || "Group Chat", members);
    onClose();
  };
  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <style>{`@keyframes modal-in{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}`}</style>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="relative w-[min(88vw,480px)] max-h-[86vh] overflow-hidden bg-black/90 border border-white/30 rounded-3xl shadow-2xl text-[#f7f3e8] p-0 flex flex-col animate-[modal-in_140ms_ease-out]"
      >
  <button aria-label="Close" onClick={onClose} className="absolute right-3 top-3 inline-flex items-center justify-center h-8 w-8 rounded-full bg-white/5 hover:bg-white/10 text-[#cfc7aa] hover:text-white border border-white/10 focus:outline-none focus:ring-2 focus:ring-white/30">✕</button>
        <div className="text-center text-white text-lg font-semibold py-4">Create GC</div>
        <hr className="border-white/10" />
        <div className="p-4">
          <input
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 20))}
            placeholder="Group name"
            className="w-full px-4 py-2.5 rounded-2xl bg-white/10 border border-white/15 text-white outline-none focus:border-white/30 transition"
          />
        </div>
        <hr className="border-white/10" />
        <div className="p-4 overflow-y-auto">
          <ul className="space-y-2">
            {others.map(u => (
              <li key={u}>
                <label className="flex items-center gap-4 cursor-pointer select-none px-2 py-2 rounded-xl hover:bg-white/5 transition">
                  <input
                    type="checkbox"
                    checked={!!selected[u]}
                    onChange={() => toggle(u)}
                    className="peer sr-only"
                  />
                  <span className="inline-flex items-center justify-center h-7 w-7 rounded-xl border-2 border-white/25 bg-transparent transition-all duration-100 peer-checked:bg-white peer-checked:border-white">
                    <svg className="h-4 w-4 text-black opacity-0 peer-checked:opacity-100 transition-opacity duration-100" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5"><path d="M20 6 9 17l-5-5"/></svg>
                  </span>
                  <span className="text-[16px] leading-tight">{u}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
        <hr className="border-white/10" />
        <div className="p-4">
          <button ref={buttonRef} type="submit" className="w-full bg-white text-black rounded-2xl py-2.5 font-medium hover:brightness-95 active:scale-[0.99] transition">
            Create GC
          </button>
        </div>
      </form>
    </div>
  );
}
