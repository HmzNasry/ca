import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import * as api from "@/services/api";

interface Props { onLoginSuccess: (t: string) => void; }

export function LoginScreen({ onLoginSuccess }: Props) {
  const [tab, setTab] = useState<"signin" | "signup">("signin");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    // If a previous session set a duplicate-username error, show it
    const storedErr = localStorage.getItem("chat-login-error");
    if (storedErr) {
      setErr(storedErr);
      try { localStorage.removeItem("chat-login-error"); } catch {}
    }
    const u = localStorage.getItem("chat-username");
    if (u) setUsername(u);
  }, []);

  const onSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    const name = (username || "").trim();
    if (!name) { setErr("Enter a username"); return; }
    if (!password) { setErr("Enter your password"); return; }
    setPending(true);
    try {
      const t = await api.signInUser(name, password);
      try { localStorage.setItem("chat-username", name); } catch {}
      onLoginSuccess(t);
    } catch (e: any) {
      setErr(e?.message || "Sign in failed");
    } finally { setPending(false); }
  };

  const onSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    const name = (username || "").trim();
    const disp = (displayName || "").trim();
    if (!name) { setErr("Pick a username"); return; }
    // No minimum length constraints for username or display name
    if (!password || password.length < 4) { setErr("Password must be at least 4 chars"); return; }
    setPending(true);
    try {
      // Optional pre-check (fail-open)
      try {
        const ok = await api.isAccountAvailable(name);
        if (!ok) { setErr("Username already exists"); setPending(false); return; }
      } catch {}
      const t = await api.signUpUser(name, disp, password);
      try { localStorage.setItem("chat-username", name); } catch {}
      onLoginSuccess(t);
    } catch (e: any) {
      setErr(e?.message || "Sign up failed");
    } finally { setPending(false); }
  };

  return (
    <div className="flex items-center justify-center h-full">
      <div className="w-full max-w-xs p-6 bg-black/50 backdrop-blur-lg rounded-xl border border-white/10">
        <div className="flex mb-4 rounded-2xl overflow-hidden border border-white/10 bg-white/10">
          <button
            className={`flex-1 py-2 text-sm transition ${tab === 'signin' ? 'bg-white text-black' : 'bg-transparent text-white/80 hover:text-white'}`}
            onClick={() => { setErr(""); setTab("signin"); }}
          >Sign In</button>
          <button
            className={`flex-1 py-2 text-sm transition ${tab === 'signup' ? 'bg-white text-black' : 'bg-transparent text-white/80 hover:text-white'}`}
            onClick={() => { setErr(""); setTab("signup"); }}
          >Sign Up</button>
        </div>

        {tab === "signin" ? (
          <form onSubmit={onSignIn} className="space-y-4">
            <div>
              <label className="text-xs text-white/70">Username</label>
              <Input value={username} onChange={e => setUsername(e.target.value)} autoFocus
                className="mt-1 bg-slate-800/50 border-slate-700 h-10 text-white" />
            </div>
            <div>
              <label className="text-xs text-white/70">Password</label>
              <Input type="password" value={password} onChange={e => setPassword(e.target.value)}
                className="mt-1 bg-slate-800/50 border-slate-700 h-10 text-white" />
            </div>
            {err && <p className="text-red-400 text-center text-sm">{err}</p>}
            <Button type="submit" disabled={pending}
              className="w-full h-10 rounded-xl bg-neutral-100 text-black hover:bg-neutral-200 transition-colors">
              {pending ? "Signing in..." : "Sign In"}
            </Button>
          </form>
        ) : (
          <form onSubmit={onSignUp} className="space-y-4">
            <div>
              <label className="text-xs text-white/70">Username</label>
              <Input value={username} onChange={e => setUsername(e.target.value)} autoFocus
                className="mt-1 bg-slate-800/50 border-slate-700 h-10 text-white" />
            </div>
            <div>
              <label className="text-xs text-white/70">Display Name</label>
              <Input value={displayName} onChange={e => setDisplayName(e.target.value)}
                className="mt-1 bg-slate-800/50 border-slate-700 h-10 text-white" />
            </div>
            <div>
              <label className="text-xs text-white/70">Password</label>
              <Input type="password" value={password} onChange={e => setPassword(e.target.value)}
                className="mt-1 bg-slate-800/50 border-slate-700 h-10 text-white" />
            </div>
            {err && <p className="text-red-400 text-center text-sm">{err}</p>}
            <Button type="submit" disabled={pending}
              className="w-full h-10 rounded-xl bg-neutral-100 text-black hover:bg-neutral-200 transition-colors">
              {pending ? "Creating..." : "Create Account"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}

export default LoginScreen;

