import { useEffect, useState } from "react";
import { Progress } from "@/components/ui/progress";

export function LoadingSplash() {
  const [p, setP] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setP(x => (x >= 95 ? 100 : x + 10)), 150);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex flex-col items-center justify-center h-screen bg-black">
      <h1 className="text-4xl font-bold text-white mb-8">Made with ❤️ by Haz</h1>
      <div className="w-1/3 max-w-sm">
        <Progress value={p} className="h-2 [&>*]:bg-white" />
      </div>
    </div>
  );
}

