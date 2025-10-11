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

  useEffect(() => {
    const u = localStorage.getItem("chat-username");
    if (u) { setUsername(u); setStep("PASS"); }
  }, []);

  const next = (e: React.FormEvent) => {
    e.preventDefault();
    localStorage.setItem("chat-username", username);
    setStep("PASS");
  };

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    try {
      const t = await api.loginUser(username, password);
      onLoginSuccess(t);
    } catch { setErr("wrong server password"); }
  };

  return (
    <div className="flex items-center justify-center h-full">
      <div className="w-full max-w-xs p-8 bg-black/50 backdrop-blur-lg rounded-xl border border-white/10 space-y-6">
        {step === "USER" && (
          <form onSubmit={next} className="space-y-6">
            <h2 className="text-2xl text-white text-center font-bold">Username</h2>
            <Input value={username} onChange={e => setUsername(e.target.value)} autoFocus
              className="bg-slate-800/50 border-slate-700 h-10 text-white" />
            <Button
              type="submit"
              className="w-full h-10 rounded-xl bg-neutral-100 text-black
                         hover:bg-neutral-200 transition-colors">
              Next
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
              className="w-full h-10 rounded-xl bg-neutral-100 text-black
                         hover:bg-neutral-200 transition-colors">
              Connect
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}

