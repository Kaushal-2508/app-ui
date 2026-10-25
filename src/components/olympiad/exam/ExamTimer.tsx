import { useEffect, useState } from "react";
import { Clock } from "lucide-react";

type Props = {
  // Server-authoritative remaining seconds, refreshed every 30s by parent
  serverRemainingSeconds: number;
  lastSyncAt: number; // Date.now() when serverRemainingSeconds was set
  onExpired: () => void;
};

export function ExamTimer({ serverRemainingSeconds, lastSyncAt, onExpired }: Props) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const elapsedSinceSync = Math.floor((now - lastSyncAt) / 1000);
  const remaining = Math.max(0, serverRemainingSeconds - elapsedSinceSync);

  useEffect(() => {
    if (remaining === 0) onExpired();
  }, [remaining, onExpired]);

  const mm = Math.floor(remaining / 60).toString().padStart(2, "0");
  const ss = (remaining % 60).toString().padStart(2, "0");
  const isLowRed = remaining < 300;
  const isLowAmber = remaining < 900;

  return (
    <div
      className={`flex items-center gap-2 font-mono text-lg font-semibold ${
        isLowRed ? "text-red-600" : isLowAmber ? "text-amber-600" : "text-ink-900"
      }`}
      role="timer"
      aria-live="off"
    >
      <Clock className="h-5 w-5" />
      {mm}:{ss}
    </div>
  );
}
