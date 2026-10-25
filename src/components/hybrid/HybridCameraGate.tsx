import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CameraOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface HybridCameraGateProps {
  /** Called once with the live stream when the student grants the camera. */
  onGranted: (stream: MediaStream) => void;
}

type GateStatus = "requesting" | "denied" | "busy" | "error";

const MESSAGES: Record<Exclude<GateStatus, "requesting">, { title: string; body: string }> = {
  denied: {
    title: "Camera access blocked",
    body: "You (or the browser) blocked the camera. Enable camera access for this site in your browser settings, then tap Retry.",
  },
  busy: {
    title: "Camera is in use",
    body: "Your camera is being used by another app. Close Teams, Zoom, or any other browser tab using the camera, then tap Retry.",
  },
  error: {
    title: "No camera found",
    body: "We couldn't find a working camera on this device. Connect a camera, or take this proctored exam on a device that has one (like your phone).",
  },
};

/**
 * Blocking gate shown BEFORE the question paper. The student cannot reach the
 * paper without granting camera access. Auto-requests on mount; offers a retry
 * with a specific reason when the camera can't be acquired.
 */
export function HybridCameraGate({ onGranted }: HybridCameraGateProps) {
  const [status, setStatus] = useState<GateStatus>("requesting");
  const requestedRef = useRef(false);
  const cancelledRef = useRef(false);

  // Hold the latest onGranted in a ref so `request` stays referentially stable
  // (a parent re-render must not re-run the request effect — see the hang
  // regression fixed earlier).
  const onGrantedRef = useRef(onGranted);
  onGrantedRef.current = onGranted;

  const request = useCallback(async () => {
    setStatus("requesting");
    try {
      const md = navigator.mediaDevices;
      if (!md?.getUserMedia) {
        // Unsupported, or an insecure context (plain http on a LAN IP — only
        // https/localhost expose getUserMedia).
        console.error("[HybridCameraGate] navigator.mediaDevices.getUserMedia unavailable (insecure context?)");
        setStatus("error");
        return;
      }
      let stream: MediaStream;
      try {
        // Prefer the front camera (for proctoring) but only as a hint, so a
        // desktop webcam that reports no facingMode still works.
        stream = await md.getUserMedia({ video: { facingMode: { ideal: "user" } }, audio: false });
      } catch (err) {
        // A few setups still reject an over-specific facingMode — fall back to any camera.
        if ((err as DOMException)?.name === "OverconstrainedError") {
          stream = await md.getUserMedia({ video: true, audio: false });
        } else {
          throw err;
        }
      }
      if (cancelledRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      onGrantedRef.current(stream);
    } catch (err) {
      if (cancelledRef.current) return;
      const name = (err as DOMException)?.name ?? "";
      console.error("[HybridCameraGate] getUserMedia failed:", name, err);
      if (name === "NotAllowedError" || name === "SecurityError") {
        setStatus("denied");
      } else if (name === "NotReadableError" || name === "AbortError" || name === "TrackStartError") {
        setStatus("busy");
      } else {
        // NotFoundError / OverconstrainedError / unknown
        setStatus("error");
      }
    }
  }, []);

  // Auto-request once on mount. `request` is stable (empty deps), so a parent
  // re-render can't re-run this effect.
  useEffect(() => {
    if (requestedRef.current) return;
    requestedRef.current = true;
    void request();
  }, [request]);

  // Mark cancelled ONLY on a real unmount so a parent re-render can't trip it
  // mid-request.
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const msg = status === "requesting" ? null : MESSAGES[status];

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
        {status === "requesting" || !msg ? (
          <>
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Camera className="h-7 w-7" />
            </div>
            <h1 className="mb-1 text-lg font-semibold text-foreground">
              Allow camera to start
            </h1>
            <p className="mb-4 text-sm text-muted-foreground">
              This exam is proctored. Please allow camera access in the browser prompt. The
              question paper opens as soon as you do.
            </p>
            <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" />
          </>
        ) : (
          <>
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <CameraOff className="h-7 w-7" />
            </div>
            <h1 className="mb-1 text-lg font-semibold text-foreground">{msg.title}</h1>
            <p className="mb-4 text-sm text-muted-foreground">{msg.body}</p>
            <Button onClick={() => void request()} className="w-full">
              <Camera className="mr-2 h-4 w-4" />
              Retry camera
            </Button>
          </>
        )}
      </div>
    </div>
  );
}