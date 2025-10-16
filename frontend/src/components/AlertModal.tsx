import { AlertTriangle } from "lucide-react";
import { useEffect, useRef } from "react";

type Props = {
  open: boolean;
  text: string;
  buttonLabel?: string;
  onButton?: () => void;
  onClose?: () => void;
};

export default function AlertModal({ open, text, buttonLabel, onButton, onClose }: Props) {
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open && buttonRef.current) {
      buttonRef.current.focus();
    }
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop (click = primary action if provided) */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => (onButton ? onButton() : onClose?.())}
      />

      {/* Dialog */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (onButton) onButton();
        }}
        className="relative w-[min(92vw,560px)] bg-black/90 border border-white/40 rounded-2xl shadow-xl text-[#f7f3e8] p-9"
      >
        <div className="flex flex-col items-center text-center space-y-6">
          <AlertTriangle className="h-12 w-12 text-red-500" />
          <div className="text-base sm:text-lg font-bold whitespace-pre-wrap leading-relaxed">
            {text}
          </div>
          {buttonLabel ? (
            <button
              ref={buttonRef}
              type="submit"
              className="px-4 py-2 rounded-xl bg-white text-black hover:bg-white/90 border border-white/10 shadow-[0_0_10px_rgba(255,255,255,0.3)] transition-all"
            >
              {buttonLabel}
            </button>
          ) : null}
        </div>
        {/* Close button (optional) */}
        {!buttonLabel && (
          <button
            onClick={() => (onButton ? onButton() : onClose?.())}
            className="absolute top-2 right-2 text-[#e7dec3]/70 hover:text-white"
            aria-label="Close"
          >
            ×
          </button>
        )}
      </form>
    </div>
  );
}
