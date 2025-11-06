import { useEffect, useRef, useState } from "react";

type Props = {
  open: boolean;
  users: string[];
  onClose: () => void;
  onSubmit: (selected: string[]) => void;
  mode?: "remove" | "pick";
  onPick?: (username: string) => void;
};

export default function UsersModal({ open, users, onClose, onSubmit, mode = "remove", onPick }: Props) {
  const [selected, setSelected] = useState<string[]>([]);
  const primaryRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (open) {
      setSelected([]);
      if (mode === "remove") {
        setTimeout(() => primaryRef.current?.focus(), 0);
      }
    }
  }, [open, mode]);

  // Escape to close (ensure hook runs before conditional return)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const toggle = (u: string) => {
    setSelected((prev) => (prev.includes(u) ? prev.filter((x) => x !== u) : [...prev, u]));
  };

  const submit = () => {
    if (selected.length === 0) return;
    onSubmit(selected);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[160] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <style>{`@keyframes modal-in{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}`}</style>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (mode === "remove") submit();
        }}
        className="relative w-[min(92vw,560px)] max-h-[88vh] overflow-hidden bg-black/90 border border-white/30 rounded-3xl shadow-2xl text-[#f7f3e8] p-0 flex flex-col animate-[modal-in_140ms_ease-out]"
      >
  <button aria-label="Close" onClick={onClose} className="absolute right-3 top-3 inline-flex items-center justify-center h-8 w-8 rounded-full bg-white/5 hover:bg-white/10 text-[#cfc7aa] hover:text-white border border-white/10 focus:outline-none focus:ring-2 focus:ring-white/30">✕</button>
        <div className="text-center text-white text-lg font-semibold py-4">{mode === "pick" ? "Select a user" : "Users Registry"}</div>
        <hr className="border-white/10" />
        <div className="p-4">
          {mode === "remove" ? (
            <div className="text-sm text-white/70 mb-2">Select usernames to remove</div>
          ) : (
            <div className="text-sm text-white/70 mb-2">Click a user to manage their account</div>
          )}
          <div className="max-h-[50vh] overflow-y-auto">
            <ul className="space-y-2">
              {users.map((u) => (
                <li key={u}>
                  {mode === "pick" ? (
                    <button
                      type="button"
                      onClick={() => { onPick?.(u); onClose(); }}
                      className="w-full text-left flex items-center gap-3 cursor-pointer select-none px-2 py-2 rounded-xl hover:bg-white/5 transition"
                    >
                      <span className="inline-flex items-center justify-center h-7 w-7 rounded-xl border-2 border-white/25 bg-transparent">👤</span>
                      <span className="text-[16px] leading-tight">{u}</span>
                    </button>
                  ) : (
                    <label className="flex items-center gap-4 cursor-pointer select-none px-2 py-2 rounded-xl hover:bg-white/5 transition">
                      <input
                        type="checkbox"
                        className="peer sr-only"
                        checked={selected.includes(u)}
                        onChange={() => toggle(u)}
                      />
                      <span className="inline-flex items-center justify-center h-7 w-7 rounded-xl border-2 border-white/25 bg-transparent transition-all duration-100 peer-checked:bg-white peer-checked:border-white">
                        <svg
                          className="h-3.5 w-3.5 text-black opacity-0 peer-checked:opacity-100 transition-opacity duration-100"
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="3.5"
                        >
                          <path d="M20 6 9 17l-5-5" />
                        </svg>
                      </span>
                      <span className="text-[16px] leading-tight">{u}</span>
                    </label>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <hr className="border-white/10" />
        {mode === "remove" ? (
          <div className="p-4 flex items-center justify-end gap-3">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-2xl border border-white/20 text-white/90 hover:bg-white/10">
              Cancel
            </button>
            <button
              ref={primaryRef}
              type="submit"
              className="px-4 py-2 rounded-2xl bg-white text-black font-medium hover:brightness-95 active:scale-[0.99] transition"
            >
              Remove Selected
            </button>
          </div>
        ) : (
          <div className="p-4 flex items-center justify-end gap-3">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-2xl border border-white/20 text-white/90 hover:bg-white/10">
              Close
            </button>
          </div>
        )}
      </form>
    </div>
  );
}
