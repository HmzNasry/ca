type Props = {
  open: boolean;
  title: string;
  body?: string;
  cancelLabel?: string;
  okLabel?: string;
  onCancel: () => void;
  onOk: () => void;
};

export default function ConfirmModal({ open, title, body, cancelLabel = "Cancel", okLabel = "OK", onCancel, onOk }: Props) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[170] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <style>{`@keyframes modal-in{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}`}</style>
      <div className="relative w-[min(92vw,460px)] bg-black/90 border border-white/30 rounded-3xl shadow-2xl text-[#f7f3e8] p-0 flex flex-col animate-[modal-in_140ms_ease-out]">
        <div className="text-center text-white text-lg font-semibold py-4">{title}</div>
        <hr className="border-white/10" />
        {body && <div className="p-4 text-sm text-white/80">{body}</div>}
        <hr className="border-white/10" />
        <div className="p-4 flex items-center justify-end gap-2">
          <button onClick={onCancel} className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white border border-white/10">{cancelLabel}</button>
          <button onClick={onOk} className="px-4 py-2 rounded-xl bg-white text-black">{okLabel}</button>
        </div>
      </div>
    </div>
  );
}
