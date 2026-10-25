import { useEffect, useState } from "react";

/**
 * The current time, re-read every `intervalMs` and whenever the tab comes
 * back into view, so a "Join meeting" button flips from "Opens at 3:50 PM"
 * to live without a reload. One timer per caller; the listener is removed
 * on unmount.
 */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => setNow(new Date());
    const id = window.setInterval(tick, intervalMs);
    const onVisibility = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs]);
  return now;
}
