import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import * as api from "@/services/api";

interface Props { onLoginSuccess: (t: string) => void; }

export function LoginScreen({ onLoginSuccess }: Props) {
  const [step, setStep] = useState<"USER" | "PASS">("USER");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    // If a previous session set a duplicate-username error, show it and stay on USER step
    const storedErr = localStorage.getItem("chat-login-error");
    if (storedErr) {
      setErr(storedErr);
      try { localStorage.removeItem("chat-login-error"); } catch {}
      setStep("USER");
      return;
    }
    // Otherwise, resume to PASS if a username was previously chosen
    const u = localStorage.getItem("chat-username");
    if (u) { setUsername(u); setStep("PASS"); }
  }, []);

  const next = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    const name = (username || "").trim();
    if (!name) { setErr("Enter a username"); return; }
    setChecking(true);
    try {
      const ok = await api.isUsernameAvailable(name);
      if (!ok) { setErr("Username already online. Pick a different name."); return; }
      localStorage.setItem("chat-username", name);
      setStep("PASS");
    } finally { setChecking(false); }
  };

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    try {
      const t = await api.loginUser(username, password);
      onLoginSuccess(t);
    } catch { setErr("Wrong server password"); }
  };

  return (
    <div className="flex items-center justify-center h-full">
      <div className="w-full max-w-xs p-8 bg-black/50 backdrop-blur-lg rounded-xl border border-white/10 space-y-6">
        {step === "USER" && (
          <form onSubmit={next} className="space-y-6">
            <h2 className="text-2xl text-white text-center font-bold">Username</h2>
            <Input value={username} onChange={e => setUsername(e.target.value)} autoFocus
              className="bg-slate-800/50 border-slate-700 h-10 text-white" />
            {err && <p className="text-red-400 text-center text-sm">{err}</p>}
            <Button
              type="submit"
              disabled={checking}
              className="w-full h-10 rounded-xl bg-neutral-100 text-black hover:bg-neutral-200 transition-colors">
              {checking ? "Checking..." : "Next"}
            </Button>
          </form>
        )}

        {step === "PASS" && (
          <form onSubmit={login} className="space-y-6">
            <h2 className="text-2xl text-white text-center font-bold">Server Password</h2>
            <Input type="password" value={password} onChange={e => setPassword(e.target.value)} autoFocus
              className="bg-slate-800/50 border-slate-700 h-10 text-white" />
            {err && <p className="text-red-400 text-center text-sm">{err}</p>}
            <Button
              type="submit"
              className="w-full h-10 rounded-xl bg-neutral-100 text-black hover:bg-neutral-200 transition-colors">
              Connect
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}

export default LoginScreen;

