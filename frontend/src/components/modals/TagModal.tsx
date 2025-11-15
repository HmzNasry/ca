import { useEffect, useMemo, useRef, useState } from "react";
import EmojiConvertor from "emoji-js";

type Props = {
  open: boolean;
  me: string;
  users: string[];
  tagsMap: Record<string, any>;
  tagLocks: string[];
  isAdminEffective: boolean;
  onClose: () => void;
  onSubmit: (target: string, label: string, hex: string) => void;
  onClear?: (target: string) => void; // optional quick clear action
};

const MAX_LEN = 60;

export default function TagModal({ open, me, users, tagsMap, tagLocks, isAdminEffective, onClose, onSubmit, onClear }: Props) {
  const [label, setLabel] = useState("");
  const [target, setTarget] = useState<string>(me);
  const [hex, setHex] = useState<string>("#ffffff");
  const firstButtonRef = useRef<HTMLButtonElement | null>(null);

  // Emoji shortcode support (:smile: -> 😄)
  const emoji = useMemo(() => {
    const e = new (EmojiConvertor as any)();
    try { (e as any).replace_mode = "unified"; (e as any).allow_native = true; } catch {}
    return e as any;
  }, []);

  // Determine DEV users to exclude (only explicit special==='dev')
  const isDevUser = (u: string) => {
    const tag = (tagsMap as any)[u];
    if (!tag) return false;
    const obj = typeof tag === 'string' ? { text: tag, color: 'white' } : tag;
    return obj?.special === 'dev';
  };

  const candidates = useMemo(() => {
    const lockSet = new Set(tagLocks || []);
    const devMe = isDevUser(me);
    if (!isAdminEffective) {
      // Normal users can only tag themselves
      return [me];
    }
    if (devMe) {
      // DEV sees everyone regardless of lock status
      return [...users];
    }
    // Admin (non-DEV): cannot tag DEV users; exclude locked users except allow self to appear
    return users.filter(u => {
      if (isDevUser(u)) return false;
      if (u !== me && lockSet.has(u)) return false;
      return true; // include self even if locked; backend will enforce lock on submit
    });
  }, [users, me, isAdminEffective, tagsMap, tagLocks]);

  useEffect(() => {
    if (open) {
      setLabel("");
      setHex("#ffffff");
      setTarget(me);
      // focus primary action
      setTimeout(() => firstButtonRef.current?.focus(), 0);
    }
  }, [open, me]);
  // Escape to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const submit = () => {
    const trimmed = label.trim().slice(0, MAX_LEN);
    if (!trimmed) return;
    onSubmit(target, trimmed, hex);
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
  <div className="text-center text-white text-lg font-semibold py-4">Tag User</div>
        <hr className="border-white/10" />
        {/* Tag input */}
        <div className="p-4">
          <input
            value={label}
            onChange={(e) => {
              let v = e.target.value;
              try { v = (emoji as any).replace_colons(v); } catch {}
              setLabel(v.slice(0, MAX_LEN));
            }}
            placeholder="Tag text (max 60 chars)"
            className="w-full px-4 py-2.5 rounded-2xl bg-white/10 border border-white/15 text-white outline-none focus:border-white/30 transition"
          />
          <div className="mt-1 text-xs text-white/60">Tip: Use :shortcode: to insert emojis (e.g., :sparkles:, :fire:)</div>
        </div>
        <hr className="border-white/10" />
        {/* User list */}
        <div className="p-4 overflow-y-auto max-h-[46vh]">
          <div className="text-sm text-white/70 mb-2">Choose user</div>
          <ul className="space-y-2">
            {candidates.map(u => (
              <li key={u}>
                <label className="flex items-center gap-4 cursor-pointer select-none px-2 py-2 rounded-xl hover:bg-white/5 transition">
                  <input
                    type="radio"
                    name="tag-target"
                    className="peer sr-only"
                    checked={target === u}
                    onChange={() => setTarget(u)}
                  />
                  <span className="inline-flex items-center justify-center h-7 w-7 rounded-full border-2 border-white/25 bg-transparent transition-all duration-100 peer-checked:bg-white peer-checked:border-white">
                    <svg className="h-3.5 w-3.5 text-black opacity-0 peer-checked:opacity-100 transition-opacity duration-100" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5"><path d="M20 6 9 17l-5-5"/></svg>
                  </span>
                  <span className="text-[16px] leading-tight">{u === me ? `${u} (me)` : u}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
        <hr className="border-white/10" />
        {/* Color picker */}
        <div className="p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm text-white/70">Color</div>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={hex}
                onChange={(e) => setHex(e.target.value)}
                className="h-9 w-12 rounded-md border border-white/20 bg-transparent p-0 cursor-pointer"
                title="Pick tag color"
              />
              <input
                value={hex}
                onChange={(e) => {
                  const v = e.target.value.trim();
                  if (/^#?[0-9a-fA-F]{3,8}$/.test(v)) {
                    setHex(v.startsWith('#') ? v : `#${v}`);
                  } else {
                    setHex('#ffffff');
                  }
                }}
                className="w-28 px-3 py-2 rounded-xl bg-white/10 border border-white/15 text-white outline-none focus:border-white/30 transition"
                placeholder="#RRGGBB"
              />
            </div>
          </div>
          <div className="text-xs text-white/60 mt-2">Will send as -#HEX to backend</div>
        </div>
        <hr className="border-white/10" />
        <div className="p-4 space-y-3">
          <button ref={firstButtonRef} type="submit" className="w-full bg-white text-black rounded-2xl py-2.5 font-medium hover:brightness-95 active:scale-[0.99] transition">
            Apply
          </button>
          {/* Quick Clear: available for admins (selected user) and for self even if not admin */}
          <button
            type="button"
            onClick={() => { onClear?.(isAdminEffective ? target : me); onClose(); }}
            className="w-full rounded-2xl py-2.5 font-medium border border-white/20 text-white hover:bg-white/10 active:scale-[0.99] transition"
          >
            {isAdminEffective ? (target === me ? "Clear My Tag" : `Clear ${target}'s Tag`) : "Clear My Tag"}
          </button>
        </div>
      </form>
    </div>
  );
}
