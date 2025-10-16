import { useEffect, useState } from 'react';

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
  // Reset fields when modal is opened (do not reset on every render)
  // This ensures typing and checkbox toggling are not interrupted
  // and still resets the form between separate openings.
  useEffect(() => {
    if (open) {
      setName("");
      setSelected({});
    }
  }, [open]);
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
  <div className="relative w-[min(88vw,480px)] max-h-[86vh] overflow-hidden bg-black/90 border border-white/30 rounded-3xl shadow-2xl text-[#f7f3e8] p-0 flex flex-col animate-[modal-in_140ms_ease-out]">
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
                <button
                  onClick={() => toggle(u)}
                  className={`w-full px-4 py-3 rounded-2xl text-left transition-colors ${
                    selected[u] ? 'bg-blue-500 text-white' : 'hover:bg-white/10'
                  }`}
                >
                  <span className="text-[16px] leading-tight">{u}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <hr className="border-white/10" />
        <div className="p-4">
          <button onClick={submit} className="w-full bg-white text-black rounded-2xl py-2.5 font-medium hover:brightness-95 active:scale-[0.99] transition">
            Create GC
          </button>
        </div>
      </div>
    </div>
  );
}
