import { useEffect, useRef, useState } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  onSubmit: (minutes: number) => void;
};

export default function MuteAllModal({ open, onClose, onSubmit }: Props) {
  const [mins, setMins] = useState<string>("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setMins("");
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  if (!open) return null;

  const submit = () => {
    const n = parseInt(mins, 10);
    if (!Number.isFinite(n) || n < 0) return;
    onSubmit(n);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[160] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <style>{`@keyframes modal-in{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}`}</style>
      <form onSubmit={(e)=>{e.preventDefault(); submit();}} className="relative w-[min(92vw,420px)] bg-black/90 border border-white/30 rounded-3xl shadow-2xl text-[#f7f3e8] p-0 flex flex-col animate-[modal-in_140ms_ease-out]">
        <div className="text-center text-white text-lg font-semibold py-4">Mute Everyone</div>
        <hr className="border-white/10" />
        <div className="p-4">
          <input ref={inputRef} value={mins} onChange={e=>setMins(e.target.value)} placeholder="Minutes" inputMode="numeric" pattern="\\d*" className="w-full rounded-xl bg-white/10 border border-white/20 px-3 py-2 outline-none focus:border-white/40" />
        </div>
        <hr className="border-white/10" />
        <div className="p-4">
          <button type="submit" className="w-full bg-white text-black rounded-2xl py-2.5 font-medium hover:brightness-95 active:scale-[0.99] transition">Mute</button>
        </div>
      </form>
    </div>
  );
}
