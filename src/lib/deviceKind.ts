export type DeviceKind = "phone" | "computer";

/**
 * Best-effort phone-vs-computer detection. Used to choose the hybrid upload UX
 * (phone → direct camera capture; computer → QR + upload-from-storage). The UI
 * always offers a manual override, so a wrong guess is recoverable.
 */
export function detectDeviceKind(): DeviceKind {
  if (typeof navigator === "undefined" || typeof window === "undefined") return "computer";
  const ua = navigator.userAgent || "";
  const isMobileUa = /Android|iPhone|iPod|Windows Phone|Mobile/i.test(ua);
  const isTabletUa = /iPad|Tablet/i.test(ua);
  const coarse =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches;
  const narrow = window.innerWidth < 768;
  // Treat phones AND tablets as "phone" (touch capture device); everything else
  // is "computer". A coarse pointer on a narrow viewport is the tiebreaker.
  if (isMobileUa || isTabletUa) return "phone";
  return coarse && narrow ? "phone" : "computer";
}