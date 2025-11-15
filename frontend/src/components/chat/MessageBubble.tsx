import React from "react";
import { Trash2, Loader2 } from "lucide-react";

export type Message = any;

type Props = {
  m: Message;
  i: number;
  messages: Message[];
  me: string;
  admins: string[];
  tagsMap: Record<string, any>;
  isAdminEffective: boolean;
  flashMap: Record<string, boolean>;
  onStopFlashing: (id: string) => void;
  onDelete: (id: string) => void;
  onMountRef: (id: string, el: HTMLDivElement | null) => void;
  // helpers
  fmtTime: (iso?: string) => string;
  colorClass: (c?: string) => string;
  renderRichText: (text: string) => React.ReactNode;
  extractFirstUrl: (t?: string) => string | null;
  isImgUrl: (u: string) => boolean;
  isVidUrl: (u: string) => boolean;
  mentionsMe: (text: string) => boolean;
  animateIn: (el: HTMLDivElement | null) => void;
  full: (u: string) => string;
};

export default function MessageBubble({ m, i, messages, me, admins, tagsMap, isAdminEffective, flashMap, onStopFlashing, onDelete, onMountRef, fmtTime, colorClass, renderRichText, extractFirstUrl, isImgUrl, isVidUrl, mentionsMe, animateIn, full }: Props) {
  if (m.sender === "SYSTEM") {
    return (
      <div className="flex justify-center mb-2">
        <div className="text-xs text-[#cfc7aa]/90 italic">{m.text || ""}</div>
      </div>
    );
  }
  const mine = m.sender === me;
  const first = i === 0 || messages[i - 1].sender !== m.sender;

  const author = m.sender;
  const isAuthorDev = (() => {
    const tag = tagsMap[author];
    if (!tag) return false;
    return tag.special === 'dev'; // Only explicit special==='dev' counts as DEV
  })();
  const isAuthorAdmin = admins.includes(author) && !isAuthorDev;

  const canDelete = (() => {
    if (mine) return true;
    if (isAuthorDev) return false; // Nobody can delete a dev's message except the dev themselves (handled by `mine`)
    if (isAdminEffective) {
        if (isAuthorAdmin) return false; // Admins can't delete other admins' messages
        return true; // Admins can delete non-admin/non-dev messages
    }
    return false;
  })();

  const mime = String(m.mime || "");
  const isImage = mime.startsWith("image");
  const isVideo = mime.startsWith("video");
  const isAudio = mime.startsWith("audio");
  const firstUrl = m.type === "message" ? extractFirstUrl(m.text) : null;
  const onlyLinkOnly = !!firstUrl && String(m.text || "").trim() === firstUrl;
  const showUrlImg = !!firstUrl && onlyLinkOnly && isImgUrl(firstUrl);
  const showUrlVid = !!firstUrl && onlyLinkOnly && isVidUrl(firstUrl);
  const displayText = m.type === "message" ? String(m.text || "").replace(/^\/ai\b/i, "@ai") : m.text;
  const mentionedCurrentUser = (m.type === "message" || m.type === "media") && mentionsMe(String(m.text || ""));
  const shouldFlash = !mine && mentionedCurrentUser && !!flashMap[m.id];
  const alignRight = mine; // keep AI spinner on the left
  const tagVal = (tagsMap as any)[m.sender];
  const tagObj = typeof tagVal === 'string' ? { text: tagVal, color: 'white' } : (tagVal || null);

  return (
    // Full-width row so hovering anywhere across the horizontal line triggers actions.
  <div className={`relative w-full flex group/message ${alignRight ? "justify-end" : "justify-start"} ${first ? "mt-3" : ""} mb-2`}>
      <div
        ref={(el) => {
          animateIn(el);
          if (el) {
            (el as any).dataset.mid = m.id;
          }
          onMountRef(m.id, el);
        }}
        onMouseEnter={() => onStopFlashing(m.id)}
        onClick={() => onStopFlashing(m.id)}
        // Bubble with expanded invisible hover target using pseudo-element.
  className={`relative max-w-[80%] inline-flex flex-col ${alignRight ? "items-end" : "items-start"} ${shouldFlash ? "border-2 rounded-2xl" : ""} before:absolute before:inset-0 before:-inset-x-4 before:-inset-y-1 before:rounded-2xl before:pointer-events-none`}
        style={shouldFlash ? { animation: "flash-red 1.6s ease-in-out infinite", borderColor: "rgba(239,68,68,0.85)", padding: "0.16rem" } : undefined}
      >
        {first && (
          <div className="flex items-baseline gap-2 mb-0.5">
            <span className={`text-sm font-semibold ${m.sender === "AI" ? "text-blue-400" : (mine ? "text-[#e7dec3]" : "text-[#cfc7aa]")}`}>
              {m.sender === "AI" && m.model ? `AI (${m.model})` : (
                <>
                  {m.sender}
                  {(() => {
                    const tv = (tagsMap as any)[m.sender];
                    const tobj = typeof tv === 'string' ? { text: tv, color: 'orange' } : (tv || null);
                    // Only explicit special==='dev' yields DEV badge (rainbow color or 'DEV' text alone ignored)
                    const isDevSender = !!(tobj && (tobj as any).special === 'dev');
                    return (
                      <>
                        {isDevSender && <span className="dev-rainbow font-semibold"> (DEV)</span>}
                        {admins.includes(m.sender) && <span className="text-red-500 font-semibold"> (ADMIN)</span>}
                      </>
                    );
                  })()}
                  {tagObj && (() => {
                    const c = (tagObj as any).color as string | undefined;
                    const label = String((tagObj as any).text || "");
                    if (!label || label.toUpperCase() === 'DEV') return null;
                    const isHex = !!(c && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(c));
                    if ((c || '').toLowerCase() === 'rainbow') return <span className={`dev-rainbow font-semibold`}> ({label})</span>;
                    if (isHex) return <span className={`font-semibold`} style={{ color: c! }}> ({label})</span>;
                    return <span className={`${colorClass(c)} font-semibold`}> ({label})</span>;
                  })()}
                </>
              )}
            </span>
            <span className="text-xs text-[#b5ad94]">{fmtTime(m.timestamp)}</span>
          </div>
        )}

        {/* AI spinner when text is empty */}
        {m.type === "message" && m.sender === "AI" && !(String(m.text || "")).trim() && (
          <div className={`relative inline-block rounded-2xl px-4 py-3 break-words whitespace-pre-wrap max-w-[85vw] sm:max-w-[70ch] ${mine ? "bg-[#e7dec3]/90 text-[#1c1c1c]" : "bg-[#2b2b2b]/70 text-[#f7f3e8]"}`} style={{ wordBreak: "break-word", overflowWrap: "anywhere" }}>
            <span className="inline-flex items-center gap-2 text-[#cfc7aa]">
              Generating Response <Loader2 className="h-4 w-4 animate-spin" />
            </span>
          </div>
        )}

        {m.type === "message" && !(showUrlImg || showUrlVid) && !(m.sender === "AI" && !(String(m.text || "")).trim()) && (
          <div className="relative inline-block max-w-[85vw] sm:max-w-[70ch]">
            <div className={`rounded-2xl px-4 py-3 break-words whitespace-pre-wrap overflow-hidden ${mine ? "bg-[#e7dec3]/90 text-[#1c1c1c]" : "bg-[#2b2b2b]/70 text-[#f7f3e8]"}`} style={{ wordBreak: "break-word", overflowWrap: "anywhere" }}>
              {renderRichText(displayText || "")}
            </div>
            {canDelete && (
              <button
                onClick={() => onDelete(m.id)}
                title="Delete"
                className={`absolute -top-2 -right-2 opacity-0 group-hover:opacity-100 hover:opacity-100 focus:opacity-100 transition p-1 rounded-full bg-black text-red-500 shadow-md z-30 ring-1 ring-white/15 pointer-events-auto`}
              >
                <Trash2 className="h-3 w-3" strokeWidth={2.25} />
              </button>
            )}
          </div>
        )}

        {/* URL preview bubble for pure links */}
        {m.type === "message" && (showUrlImg || showUrlVid) && (
          <div className="relative">
            {showUrlImg ? (
              <img src={firstUrl!} className="max-w-[75vw] sm:max-w-[60ch] rounded-xl" />
            ) : (
              <video src={firstUrl!} controls className="max-w-[75vw] sm:max-w-[60ch] rounded-xl" />
            )}
            {canDelete && (
              <button
                onClick={() => onDelete(m.id)}
                title="Delete"
                className="absolute -top-2 -right-2 opacity-0 group-hover:opacity-100 hover:opacity-100 focus:opacity-100 transition p-1 rounded-full bg-black text-red-500 shadow-md z-30 ring-1 ring-white/15 pointer-events-auto"
              >
                <Trash2 className="h-3 w-3" strokeWidth={2.25} />
              </button>
            )}
          </div>
        )}

        {/* Media message (image/video/audio) */}
        {m.type === "media" && (
          <div className="relative">
            {isImage ? (
              <img src={full(m.url)} className="max-w-[75vw] sm:max-w-[60ch] rounded-xl" />
            ) : isVideo ? (
              <video src={full(m.url)} controls className="max-w-[75vw] sm:max-w-[60ch] rounded-xl" />
            ) : isAudio ? (
              <audio src={full(m.url)} controls className="w-[75vw] max-w-[60ch]" />
            ) : (
              <a href={full(m.url)} target="_blank" className={`block rounded-2xl px-4 py-3 ${mine ? "bg-[#e7dec3]/90 text-[#1c1c1c]" : "bg-[#2b2b2b]/70 text-[#f7f3e8]"} underline`}>Download file ({m.mime || "file"})</a>
            )}
            {canDelete && (
              <button
                onClick={() => onDelete(m.id)}
                title="Delete"
                className="absolute -top-2 -right-2 opacity-0 group-hover:opacity-100 hover:opacity-100 focus:opacity-100 transition p-1 rounded-full bg-black text-red-500 shadow-md z-30 ring-1 ring-white/15 pointer-events-auto"
              >
                <Trash2 className="h-3 w-3" strokeWidth={2.25} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
