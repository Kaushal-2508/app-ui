import { useEffect, useState } from "react";

type Props = { scheduledAt: string };

export function BatchCountdown({ scheduledAt }: Props) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    // §23: setInterval on the CLIENT only — no refetch, no DB hits.
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const target = new Date(scheduledAt).getTime();
  const diff = target - now;

  if (diff <= 0) {
    return <p className="text-2xl font-bold text-emerald-600">Exam is live now</p>;
  }

  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  const hours = Math.floor((diff % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  const minutes = Math.floor((diff % (60 * 60 * 1000)) / (60 * 1000));
  const seconds = Math.floor((diff % (60 * 1000)) / 1000);

  if (days > 0) {
    return <p className="text-xl font-bold text-ink-900">{days}d {hours}h {minutes}m</p>;
  }
  if (hours > 0) {
    return <p className="text-xl font-bold text-amber-600">{hours}h {minutes}m {seconds}s</p>;
  }
  return <p className="text-xl font-bold text-red-600">{minutes}m {seconds}s</p>;
}
