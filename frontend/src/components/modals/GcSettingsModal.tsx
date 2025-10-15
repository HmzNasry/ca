import { useEffect, useMemo, useState } from "react";

type GC = { id: string; name: string; creator: string; members: string[] };

type Props = {
  open: boolean;
  me: string;
  users: string[];
  gc: GC | null;
  onClose: () => void;
  onSave: (name: string, members: string[]) => void;
  onDelete: () => void;
};

export default function GcSettingsModal({ open, me, users, gc, onClose, onSave, onDelete }: Props) {
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!open || !gc) return;
    setName(gc.name || "Group Chat");
    const sel: Record<string, boolean> = {};
    (gc.members || []).forEach(u => { if (u !== me) sel[u] = true; });
    setSelected(sel);
  }, [open, gc, me]);

  const others = useMemo(() => users.filter(u => u !== me), [users, me]);
  const toggle = (u: string) => setSelected(prev => ({ ...prev, [u]: !prev[u] }));
  const submit = () => {
    const members = others.filter(u => selected[u]);
    onSave((name || "Group Chat").trim(), members);
    onClose();
  };

  if (!open || !gc) return null;
  const isCreator = gc.creator === me;

  return (
    <div className="fixed inset-0 z-[160] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <style>{`@keyframes modal-in{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}`}</style>
      <div className="relative w-[min(90vw,520px)] max-h-[86vh] overflow-hidden bg-black/90 border border-white/30 rounded-3xl shadow-2xl text-[#f7f3e8] p-0 flex flex-col animate-[modal-in_140ms_ease-out]">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="text-white text-lg font-semibold">Group Settings</div>
          <button onClick={onClose} className="text-[#cfc7aa] hover:text-white">✕</button>
        </div>
        <hr className="border-white/10" />
        <div className="p-4 space-y-4">
          <div>
            <label className="block text-sm text-[#b5ad94] mb-1">Group name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 20))}
              placeholder="Group name"
              disabled={!isCreator}
              className="w-full px-4 py-2.5 rounded-2xl bg-white/10 border border-white/15 text-white outline-none disabled:opacity-60 focus:border-white/30 transition"
            />
          </div>
          <div>
            <label className="block text-sm text-[#b5ad94] mb-2">Members</label>
            <ul className="space-y-2 max-h-[42vh] overflow-y-auto pr-1">
              {others.map(u => (
                <li key={u}>
                  <label className="flex items-center gap-4 cursor-pointer select-none px-2 py-2 rounded-xl hover:bg-white/5 transition">
                    <input
                      type="checkbox"
                      checked={!!selected[u]}
                      onChange={() => toggle(u)}
                      disabled={!isCreator}
                      className="peer sr-only"
                    />
                    <span className="inline-flex items-center justify-center h-7 w-7 rounded-2xl border border-white/25 bg-black/30 transition-all peer-checked:bg-blue-500 peer-checked:border-blue-400">
                      <span className="text-white text-base leading-none opacity-0 peer-checked:opacity-100 transition-opacity duration-150">✓</span>
                    </span>
                    <span className="text-[16px] leading-tight">{u}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <hr className="border-white/10" />
        <div className="p-4 flex items-center justify-between gap-3">
          {isCreator ? (
            <button onClick={onDelete} className="px-4 py-2.5 rounded-2xl bg-red-600/90 hover:bg-red-700 text-white shadow-[0_0_10px_rgba(255,0,0,0.3)]">
              Delete Group
            </button>
          ) : <div />}
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-4 py-2.5 rounded-2xl bg-white/10 hover:bg-white/20 text-white border border-white/15">Cancel</button>
            <button onClick={submit} disabled={!isCreator} className="px-4 py-2.5 rounded-2xl bg-white text-black disabled:opacity-60 hover:brightness-95 active:scale-[0.99] transition">Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}
