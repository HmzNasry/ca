import React from "react";

export default function TypingIndicator({ typingUser, visible }: { typingUser: string; visible: boolean }) {
  if (!typingUser) return null;
  return (
    <div
      className={`mt-1 mb-2 text-m text-[#cfc7aa]/70 italic transition-all duration-250 ease-out ${visible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-0.5"}`}
      style={{ willChange: "opacity, transform" }}
    >
      {typingUser} is typing
      <span className="inline-flex w-6 ml-1">
        <span style={{ animation: "typing-dot 1.1s infinite ease-in-out", animationDelay: "0ms" }}>.</span>
        <span style={{ animation: "typing-dot 1.1s infinite ease-in-out", animationDelay: "200ms" }}>.</span>
        <span style={{ animation: "typing-dot 1.1s infinite ease-in-out", animationDelay: "300ms" }}>.</span>
      </span>
    </div>
  );
}
