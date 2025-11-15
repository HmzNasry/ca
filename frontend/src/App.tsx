import { useState, useEffect } from "react";
import { LoginScreen } from "@/components/auth/LoginScreen";
import { ChatInterface } from "@/components/chat/ChatInterface";
import { LoadingSplash } from "@/components/shell/LoadingSplash";

export default function App() {
  const [loading, setLoading] = useState(true);
  const [tok, setTok] = useState<string | null>(() => localStorage.getItem("chat-token"));

  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 2000);
    return () => clearTimeout(t);
  }, []);

  const onLogin = (t: string) => { localStorage.setItem("chat-token", t); setTok(t); };
  const logout = () => { localStorage.removeItem("chat-token"); setTok(null); };

  if (loading) return <LoadingSplash />;
  return (
    <>
      {tok ? <ChatInterface token={tok} onLogout={logout} /> : <LoginScreen onLoginSuccess={onLogin} />}
    </>
  );
}