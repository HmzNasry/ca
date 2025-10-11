import React from "react";
import EmojiPicker, { Theme } from "emoji-picker-react";

export default function EmojiPanel({ open, onPick }: { open: boolean; onPick: (emoji: string) => void }) {
  if (!open) return null;
  return (
    <div className="absolute bottom-24 right-6 z-10">
      <EmojiPicker
        theme={Theme.DARK}
        onEmojiClick={(e) => onPick(e.emoji || "")}
        lazyLoadEmojis
      />
    </div>
  );
}
