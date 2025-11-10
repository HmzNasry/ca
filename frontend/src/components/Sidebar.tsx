import { Button } from "@/components/ui/button";
import { Users } from "lucide-react";

export interface SidebarProps {
  users: string[];
  me: string;
  activeDm: string | null;
  unreadDm: Record<string, number>;
  unreadMain: number;
  sidebar: boolean;
  setSidebar: (v: boolean) => void;
  onSelectDm: (user: string | null) => void;
  gcs?: { id: string; name: string; creator: string; members: string[] }[];
  activeGcId?: string | null;
  onSelectGc?: (gid: string | null) => void;
  onLogout: () => void;
  admins?: string[];
  tags?: Record<string, { text: string; color?: string } | string>;
  isMobile?: boolean; // mobile overlay mode
  unreadGc?: Record<string, number>;
  userActivity?: Record<string, boolean>; // NEW: user activity map
}

function colorClass(c?: string) {
  switch ((c || "white").toLowerCase()) {
    case "red": return "text-red-500";
    case "green": return "text-green-500";
    case "blue": return "text-blue-400";
    case "pink": return "text-pink-400";
    case "yellow": return "text-yellow-400";
    case "white": return "text-white";
    case "cyan": return "text-cyan-400";
    case "purple": return "text-purple-400";
    case "violet": return "text-violet-400";
    case "indigo": return "text-indigo-400";
    case "teal": return "text-teal-400";
    case "lime": return "text-lime-400";
    case "amber": return "text-amber-400";
    case "emerald": return "text-emerald-400";
    case "fuchsia": return "text-fuchsia-400";
    case "sky": return "text-sky-400";
    case "gray": return "text-gray-400";
    default: return "text-white";
  }
}



export default function Sidebar({ users, me, activeDm, unreadDm, unreadMain, sidebar, setSidebar, onSelectDm, onLogout, admins = [], tags = {}, isMobile = false, gcs = [], activeGcId = null, onSelectGc, unreadGc = {}, userActivity = {} }: SidebarProps) {
  // For mobile we slide almost completely off-screen leaving a ~34px handle (chevron pill).
  // For desktop we shrink width to a slim rail.
  const mobileCollapsedTranslate = '-translate-x-[calc(100%-2.15rem)]'; // leaves ~34px (2.15rem) visible (including padding/border)
  return (
    <aside
      onClick={() => { if (!isMobile && !sidebar) setSidebar(true); }}
      className={`h-full flex flex-col bg-[#0a0a0a]/95 backdrop-blur-sm border-r border-white/10 ${isMobile ? (sidebar ? 'rounded-tr-3xl rounded-br-3xl' : 'rounded-tr-3xl rounded-br-3xl') : 'rounded-tr-3xl rounded-br-3xl'} ${isMobile ? 'cursor-default' : 'cursor-pointer'} relative shadow-xl transition-[width,transform] duration-300 ease-out will-change-transform
        ${isMobile ? (sidebar ? 'w-64 translate-x-0' : `w-64 ${mobileCollapsedTranslate}`) : (sidebar ? 'w-64' : 'w-12')} pointer-events-auto
      `}
    >
      <style>{`
        @keyframes rainbow-shift { 0% { background-position: 0% 50%; } 100% { background-position: 100% 50%; } }
        .dev-rainbow { background: linear-gradient(90deg, #ff3b30, #ff9500, #ffcc00, #ffffffff, #34c759, #5ac8fa, #007aff, #af52de, #ff3b30); background-size: 400% 100%; -webkit-background-clip: text; background-clip: text; color: transparent; animation: rainbow-shift 6s linear infinite; }
      `}</style>
      {/* Chevron / handle pill */}
      <button
        onClick={e => { e.stopPropagation(); setSidebar(!sidebar); }}
        className={`absolute top-1/2 -translate-y-1/2 ${
          sidebar
            ? 'right-0 translate-x-1/2'
            : (isMobile
                ? 'right-0 translate-x-1/2' // mobile already slides; keep at edge
                : 'right-0 translate-x-1/2') // desktop collapsed: keep at outer edge, not centered
        } bg-[#0a0a0a] border border-white/15 text-[#e7dec3] text-[30px] leading-[1] font-bold rounded-full px-2.5 py-2 flex items-center justify-center hover:scale-110 active:scale-95 transition-transform z-50 shadow-md pointer-events-auto`}
        style={{ borderRadius: '9999px', minWidth: '36px', minHeight: '48px' }}
        aria-label={sidebar ? 'Collapse sidebar' : 'Expand sidebar'}
      >
        {sidebar ? '‹' : '›'}
      </button>

  <div className={`flex flex-col h-full overflow-hidden ${sidebar ? 'opacity-100' : 'opacity-0 pointer-events-none'} transition-opacity duration-200 ease-out` }>
        <h2 className="text-lg font-semibold text-center mt-3 mb-2">
          Online Users
        </h2>
        <hr className="border-white/10 mb-3 mx-3" />
        <ul className="space-y-3 px-4 overflow-y-auto no-scrollbar py-2">
          {users.map(u => {
            const isAdminUser = Array.isArray(admins) && admins.includes(u);
            const isMeUser = u === me;
            const selected = activeDm === u;
            const dmCount = unreadDm[u] || 0;
            const tagVal = (tags as any)[u];
            const tagObj = typeof tagVal === 'string' ? { text: tagVal, color: 'white' } : (tagVal || null);
            // DEV badge only for explicit special==='dev'; rainbow color alone should not imply DEV
            const isDev = !!(tagObj && (tagObj as any).special === 'dev');
            // NEW: activity indicator
            const isActive = userActivity && userActivity[u];
            return (
              <li key={u} className="">
                <button
                  disabled={isMeUser}
                  onClick={() => { if (!isMeUser) { onSelectDm(u); if (isMobile) setSidebar(false); } }}
                  className={`relative w-full px-3 py-2 rounded-xl border transition flex items-center justify-center text-center select-none ${
                    selected ? "bg-[#f5f3ef] text-black border-white/20" : "border-transparent hover:bg-white/10 hover:border-white/10 text-white"
                  } ${isMeUser ? "cursor-not-allowed" : "cursor-pointer"}`}
                >
                  <div className="flex items-center justify-center w-full">
                    {/* Activity circle indicator */}
                    <span className="inline-flex items-center mr-2">
                      <span className={`inline-block w-3 h-3 rounded-full border border-white/20 ${isActive ? 'bg-green-500' : 'bg-gray-500'}`}></span>
                    </span>
                    <span className={selected ? "text-black" : (isMeUser ? "text-blue-500 font-semibold" : "text-white")}>
                      {u}
                      {isDev && <span className="dev-rainbow font-semibold"> (DEV)</span>}
                      {isAdminUser && <span className="text-red-500 font-semibold"> (ADMIN)</span>}
                      {tagObj && (() => {
                        const c = (tagObj as any).color as string | undefined;
                        const label = String((tagObj as any).text || "");
                        if (!label || label.toUpperCase() === 'DEV') return null; // base DEV badge is shown separately
                        const isHex = !!(c && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(c));
                        if ((c || '').toLowerCase() === 'rainbow') return <span className={`dev-rainbow font-semibold`}> ({label})</span>;
                        if (isHex) return <span className={`font-semibold`} style={{ color: c! }}> ({label})</span>;
                        return <span className={`${colorClass(c)} font-semibold`}> ({label})</span>;
                      })()}
                    </span>
                    <div className="absolute right-2 top-1/2 -translate-y-1/2">
                      {dmCount > 0 && (
                        <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-red-500 text-white text-[11px] font-extrabold leading-none shadow-inner shadow-red-900/40">
                          {Math.min(99, dmCount)}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
        <hr className="border-white/10 mt-6 mb-4 mx-3" />
        <div className="px-4 pb-3">
          <button
            onClick={() => { onSelectDm(null); if (isMobile) setSidebar(false); }}
            className={`relative w-full px-3 py-2 rounded-xl border transition flex items-center justify-center text-center select-none ${
              (activeDm === null && !activeGcId) ? "bg-[#f5f3ef] text-black border-white/20" : "border-transparent hover:bg-white/10 hover:border-white/10 text-white"
            }`}
          >
            <span className={(activeDm === null && !activeGcId) ? "text-black" : "text-white"}>Main Chat</span>
            {unreadMain > 0 && (
              <span className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center justify-center h-6 w-6 rounded-full bg-red-500 text-white text-[11px] font-extrabold leading-none shadow-inner shadow-red-900/40">
                {Math.min(99, unreadMain)}
              </span>
            )}
          </button>
        </div>

        {/* Group Chats section */}
        <div className="px-3">
          <hr className="border-white/10 my-2" />
          <div className="text-center text-sm text-white/80 mb-2">Group Chats</div>
          <ul className="space-y-2 px-1 overflow-y-auto no-scrollbar pb-2">
            {gcs.map(gc => (
              <li key={gc.id}>
                <button
                  onClick={() => { if (onSelectGc) { onSelectGc(gc.id); if (isMobile) setSidebar(false); } }}
                  className={`relative w-full px-10 py-2 rounded-xl border transition flex items-center justify-center ${activeGcId === gc.id ? 'bg-[#f5f3ef] text-black border-white/20' : 'border-transparent hover:bg-white/10 hover:border-white/10 text-white'}`}
                >
                  {/* Left: member count with icon (absolute) */}
                  <span className={`absolute left-3 top-1/2 -translate-y-1/2 flex items-center gap-1 text-xs ${activeGcId === gc.id ? 'text-black/70' : 'text-white/70'}`}>
                    <Users className="h-3.5 w-3.5" />
                    {gc.members.length}
                  </span>
                  {/* Center: name (truly centered) */}
                  <span
                    className={`${activeGcId === gc.id ? 'text-black' : 'text-white'} block max-w-[10.5rem] truncate text-center`}
                    title={gc.name || 'Group Chat'}
                  >
                    {gc.name || 'Group Chat'}
                  </span>
                  {/* Right: unread badge (absolute) */}
                  {unreadGc[gc.id] > 0 && (
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center justify-center h-5 w-5 rounded-full bg-red-500 text-white text-[10px] font-extrabold leading-none shadow-inner shadow-red-900/40">
                      {Math.min(99, unreadGc[gc.id])}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-auto pt-2 pb-4 border-t border-white/10 mx-2">
          <Button
            onClick={onLogout}
            className="w-full bg-red-600/90 hover:bg-red-700 text-white rounded-xl shadow-[0_0_10px_rgba(255,0,0,0.3)] transition-all"
          >
            Logout
          </Button>
        </div>
      </div>
    </aside>
  );
}
