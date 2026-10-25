import { useEffect, useRef, useState } from "react";
import { Camera, Eye, EyeOff } from "lucide-react";
import Compressor from "compressorjs";
import { Button } from "@/components/ui/button";
import { useUploadHybridSnapshot } from "@/hooks/useHybridSnapshots";
import { cn } from "@/lib/utils";

interface HybridCameraMonitorProps {
  stream: MediaStream;
  attemptId: string;
  examId: string;
  institutionId: string;
  /** Snapshot cadence; default 60s. Must stay >= 30s per CLAUDE.md §23. */
  intervalMs?: number;
}

const SNAPSHOT_MAX_DIM = 480;

function captureFrame(video: HTMLVideoElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    if (!video.videoWidth || !video.videoHeight) {
      resolve(null);
      return;
    }
    const scale = Math.min(1, SNAPSHOT_MAX_DIM / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      resolve(null);
      return;
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          resolve(null);
          return;
        }
        new Compressor(blob, {
          quality: 0.5,
          mimeType: "image/jpeg",
          success: (result) => resolve(result as Blob),
          error: () => resolve(blob),
        });
      },
      "image/jpeg",
      0.6,
    );
  });
}

/**
 * Small pinned self-view + periodic snapshot uploader for the hybrid writing
 * phase. Snapshots are best-effort: a failed upload is swallowed so it never
 * disrupts the student.
 */
export function HybridCameraMonitor({
  stream,
  attemptId,
  examId,
  institutionId,
  intervalMs = 60_000,
}: HybridCameraMonitorProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const upload = useUploadHybridSnapshot();
  const uploadRef = useRef(upload);
  uploadRef.current = upload;

  // The self-view can be tucked away (asked 2026-09-18): a student writing on
  // paper does not need to watch themselves. Only the PREVIEW hides; the
  // header with the live dot stays, the stream keeps running, and the video
  // element stays mounted (clipped to zero height, never unmounted) so the
  // periodic snapshots keep capturing frames exactly as before.
  const [previewHidden, setPreviewHidden] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    video.play().catch(() => {});
  }, [stream]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const video = videoRef.current;
      if (!video) return;
      const blob = await captureFrame(video);
      if (cancelled || !blob) return;
      uploadRef.current.mutate({ attemptId, examId, institutionId, blob });
    };
    const id = setInterval(() => void tick(), intervalMs);
    // First snapshot shortly after mount so there is at least one early frame.
    const warmup = setTimeout(() => void tick(), 5_000);
    return () => {
      cancelled = true;
      clearInterval(id);
      clearTimeout(warmup);
    };
  }, [attemptId, examId, institutionId, intervalMs]);

  return (
    <div className="fixed bottom-4 right-4 z-40 w-40 overflow-hidden rounded-xl border border-border bg-card shadow-lg">
      <div className="flex items-center gap-1.5 py-0.5 pl-2 pr-1 text-[10px] font-medium text-muted-foreground">
        <Camera className="h-3 w-3 text-primary" />
        Proctoring
        <span className="ml-auto h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0"
          onClick={() => setPreviewHidden((v) => !v)}
          aria-pressed={previewHidden}
          aria-label={previewHidden ? "Show camera preview" : "Hide camera preview"}
          title={previewHidden ? "Show camera preview" : "Hide camera preview"}
        >
          {previewHidden ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
        </Button>
      </div>
      <div className={cn("overflow-hidden transition-[height] duration-200", previewHidden && "h-0")}>
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="aspect-video w-full bg-black object-cover"
        />
      </div>
      {previewHidden && (
        <p className="px-2 pb-1 text-[10px] leading-4 text-muted-foreground">
          Camera still on
        </p>
      )}
    </div>
  );
}