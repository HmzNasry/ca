import { useEffect, useRef, useState } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  onSubmit: (newPass: string) => void;
};

export default function PassModal({ open, onClose, onSubmit }: Props) {
  const [pwd, setPwd] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setPwd("");
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);
  // Escape to close (keep hooks stable)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const submit = () => {
    const t = (pwd || "").trim();
    if (!t) return;
    onSubmit(t);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[160] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <style>{`@keyframes modal-in{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}`}</style>
      <form onSubmit={(e)=>{e.preventDefault(); submit();}} className="relative w-[min(92vw,480px)] bg-black/90 border border-white/30 rounded-3xl shadow-2xl text-[#f7f3e8] p-0 flex flex-col animate-[modal-in_140ms_ease-out]">
  <button aria-label="Close" onClick={onClose} className="absolute right-3 top-3 inline-flex items-center justify-center h-8 w-8 rounded-full bg-white/5 hover:bg-white/10 text-[#cfc7aa] hover:text-white border border-white/10 focus:outline-none focus:ring-2 focus:ring-white/30">✕</button>
        <div className="text-center text-white text-lg font-semibold py-4">Change Server Password</div>
        <hr className="border-white/10" />
        <div className="p-4">
          <input ref={inputRef} type="password" value={pwd} onChange={e=>setPwd(e.target.value)} placeholder="New password" className="w-full rounded-xl bg-white/10 border border-white/20 px-3 py-2 outline-none focus:border-white/40" />
        </div>
        <hr className="border-white/10" />
        <div className="p-4">
          <button type="submit" className="w-full bg-white text-black rounded-2xl py-2.5 font-medium hover:brightness-95 active:scale-[0.99] transition">Update</button>
        </div>
      </form>
    </div>
  );
}
