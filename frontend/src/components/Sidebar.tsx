import { Button } from "@/components/ui/button";

export interface SidebarProps {
  users: string[];
  me: string;
  activeDm: string | null;
  unreadDm: Record<string, number>;
  unreadMain: number;
  sidebar: boolean;
  setSidebar: (v: boolean) => void;
  onSelectDm: (user: string | null) => void;
  onLogout: () => void;
  admins?: string[];
  tags?: Record<string, { text: string; color?: string } | string>;
}

function colorClass(c?: string) {
  switch ((c || "orange").toLowerCase()) {
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
    default: return "text-orange-400";
  }
}

export default function Sidebar({ users, me, activeDm, unreadDm, unreadMain, sidebar, setSidebar, onSelectDm, onLogout, admins = [], tags = {} }: SidebarProps) {
  return (
    <aside
      onClick={() => !sidebar && setSidebar(true)}
      className={`transition-[width] duration-300 ease-out ${
        sidebar ? "w-64 opacity-100" : "w-8 opacity-80"
      } flex flex-col bg-[#0a0a0a] border-r border-white/10 rounded-tr-3xl rounded-br-3xl cursor-pointer relative overflow-visible z-20`}
    >
      <style>{`
        @keyframes rainbow-shift { 0% { background-position: 0% 50%; } 100% { background-position: 100% 50%; } }
        .dev-rainbow { background: linear-gradient(90deg, #ff3b30, #ff9500, #ffcc00, #34c759, #5ac8fa, #007aff, #af52de, #ff3b30); background-size: 400% 100%; -webkit-background-clip: text; background-clip: text; color: transparent; animation: rainbow-shift 6s linear infinite; }
      `}</style>

      <button
        onClick={e => {
          e.stopPropagation();
          setSidebar(!sidebar);
        }}
        className={`absolute right-0 top-1/2 translate-x-1/2 -translate-y-1/2 bg-[#0a0a0a] border border-white/10 text-[#e7dec3] text-[34px] font-bold rounded-full px-[7px] pb-[3px] hover:scale-110 transition-transform z-50`}
      >
        {sidebar ? "‹" : "›"}
      </button>

      <div className={`flex flex-col h-full overflow-hidden ${sidebar ? "transition-[opacity,transform] duration-200 ease-out opacity-100 translate-x-0" : "hidden"}`}>
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
            const tagObj = typeof tagVal === 'string' ? { text: tagVal, color: 'orange' } : (tagVal || null);
            const isDev = !!(tagObj && ((tagObj as any).special === 'dev' || (tagObj as any).color === 'rainbow'));
            return (
              <li key={u} className="">
                <button
                  disabled={isMeUser}
                  onClick={() => !isMeUser && onSelectDm(u)}
                  className={`relative w-full px-3 py-2 rounded-xl border transition flex items-center justify-center text-center select-none ${
                    selected ? "bg-[#f5f3ef] text-black border-white/20" : "border-transparent hover:bg-white/10 hover:border-white/10 text-white"
                  } ${isMeUser ? "cursor-not-allowed" : "cursor-pointer"}`}
                >
                  <span className={selected ? "text-black" : (isMeUser ? "text-blue-500 font-semibold" : "text-white")}>
                    {u}
                    {isAdminUser && !isDev && <span className="text-red-500 font-semibold"> (ADMIN)</span>}
                    {tagObj && (
                      <span className={`${isDev ? 'dev-rainbow' : colorClass((tagObj as any).color)} font-semibold`}> ({tagObj.text})</span>
                    )}
                  </span>
                  {dmCount > 0 && (
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center justify-center min-w-6 h-6 px-2 rounded-full bg-red-500/80 text-white text-xs font-bold">
                      {dmCount}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
        <hr className="border-white/10 mt-6 mb-4 mx-3" />
        <div className="px-4 pb-3">
          <button
            onClick={() => onSelectDm(null)}
            className={`relative w-full px-3 py-2 rounded-xl border transition flex items-center justify-center text-center select-none ${
              activeDm === null ? "bg-[#f5f3ef] text-black border-white/20" : "border-transparent hover:bg-white/10 hover:border-white/10 text-white"
            }`}
          >
            <span className={activeDm === null ? "text-black" : "text-white"}>Main Chat</span>
            {unreadMain > 0 && (
              <span className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center justify-center min-w-6 h-6 px-2 rounded-full bg-red-500/80 text-white text-xs font-bold">
                {unreadMain}
              </span>
            )}
          </button>
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
