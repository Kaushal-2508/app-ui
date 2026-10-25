import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, FileImage, Upload, Clock, Camera, ImagePlus, Smartphone, Monitor, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { HybridPairingCard } from "./HybridPairingCard";
import { CameraCapture } from "@/components/offline-scan/CameraCapture";
import { detectDeviceKind, type DeviceKind } from "@/lib/deviceKind";
import { useUploadHybridSheetAuthed } from "@/hooks/useUploadHybridSheetAuthed";
import {
  useHybridPairingToken,
  useHybridUploadedPages,
  useFinalizeHybridUpload,
  type HybridAttempt,
  type HybridUploadedPage,
} from "@/hooks/useHybridAttempt";

interface HybridWaitingForUploadProps {
  attempt: HybridAttempt;
  graceWindowMinutes: number;
  maxPages: number;
  onDone: () => void;
}

function useGraceCountdown(startedAt: string, windowMinutes: number) {
  const expiresAt = useMemo(
    () => new Date(new Date(startedAt).getTime() + windowMinutes * 60 * 1000).getTime(),
    [startedAt, windowMinutes],
  );
  // Seed from real time synchronously — seeding to 0 made the very first render
  // look "expired" and unmount the upload UI before the first tick could land.
  const [remaining, setRemaining] = useState<number>(() =>
    Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)),
  );
  useEffect(() => {
    const tick = () => setRemaining(Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  return remaining;
}

function PageThumbnail({ page }: { page: HybridUploadedPage }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    supabase.storage
      .from("hybrid-answer-sheets")
      .createSignedUrl(page.storage_path, 60 * 10)
      .then(({ data }) => {
        if (!cancelled && data?.signedUrl) setUrl(data.signedUrl);
      });
    return () => {
      cancelled = true;
    };
  }, [page.storage_path]);

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="aspect-[3/4] w-full bg-muted">
        {url ? (
          <img
            src={url}
            alt={`Page ${page.page_number}`}
            className="h-full w-full object-cover"
            style={{ transform: `rotate(${page.rotation_degrees}deg)` }}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <FileImage className="h-6 w-6 opacity-50" />
          </div>
        )}
      </div>
      <div className="px-2 py-1 text-center text-xs font-medium text-foreground">
        Page {page.page_number}
      </div>
    </div>
  );
}

export function HybridWaitingForUpload({
  attempt,
  graceWindowMinutes,
  maxPages,
  onDone,
}: HybridWaitingForUploadProps) {
  const submittedAt = attempt.submitted_at ?? new Date().toISOString();
  const remaining = useGraceCountdown(submittedAt, graceWindowMinutes);

  const [deviceKind, setDeviceKind] = useState<DeviceKind>(() => detectDeviceKind());
  const [showCamera, setShowCamera] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const pairing = useHybridPairingToken(attempt.id, { enabled: deviceKind === "computer" });
  const pagesQuery = useHybridUploadedPages(attempt.id, { enabled: true, pollMs: 5000 });
  const finalize = useFinalizeHybridUpload(attempt.id);
  const uploadAuthed = useUploadHybridSheetAuthed();

  const pages = useMemo<HybridUploadedPage[]>(() => pagesQuery.data ?? [], [pagesQuery.data]);
  // The countdown is DISPLAY ONLY — the `upload-hybrid-sheet` edge function is
  // the single authority on whether the window is still open (it checks the
  // server clock and returns 410 if closed). Never gate the upload UI or the
  // upload calls on this client-clock value: a phone clock running a few
  // minutes fast used to silently hide the buttons / drop the upload with no
  // request and no error, stranding the student until the window auto-closed.
  const windowClosing = remaining <= 0;
  const atCap = pages.length >= maxPages;
  const uploading = uploadAuthed.isPending;

  const nextPageNumber = useMemo(() => {
    const used = new Set(pages.map((p) => p.page_number));
    for (let i = 1; i <= maxPages; i++) {
      if (!used.has(i)) return i;
    }
    return maxPages + 1;
  }, [pages, maxPages]);

  // Auto-finalize once the client countdown elapses with pages present, so the
  // student's screen advances promptly (the cron is the server-side backstop).
  // Skip while an upload is mid-flight so we don't cut off the last page.
  const autoFinalizedRef = useRef(false);
  useEffect(() => {
    if (
      windowClosing &&
      pages.length > 0 &&
      !autoFinalizedRef.current &&
      !finalize.isPending &&
      !uploading
    ) {
      autoFinalizedRef.current = true;
      finalize.mutateAsync().then(onDone).catch(() => {});
    }
  }, [windowClosing, pages.length, finalize, onDone, uploading]);

  const uploadFile = async (file: File, pageNumber: number) => {
    setUploadError(null);
    try {
      await uploadAuthed.mutateAsync({
        attemptId: attempt.id,
        pageNumber,
        file,
      });
      pagesQuery.refetch();
    } catch (err) {
      const e = err instanceof Error ? err : new Error("Upload failed");
      setUploadError(e.message);
      toastError(e, { fallback: "Couldn't upload that page.", context: "hybridUploadSheet" });
    }
  };

  const handleCameraCapture = (file: File) => {
    setShowCamera(false);
    if (atCap) return;
    void uploadFile(file, nextPageNumber);
  };

  const handleFilesChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    // Compute distinct page numbers up front from the current pages so a
    // multi-file selection can't assign the same number twice before the
    // refetch lands (the server upserts on (attempt_id, page_number), which
    // would otherwise silently overwrite pages).
    const used = new Set(pages.map((p) => p.page_number));
    let n = 1;
    for (const file of files) {
      while (used.has(n)) n += 1;
      if (n > maxPages) break;
      used.add(n);
      await uploadFile(file, n);
    }
  };

  const handleDone = async () => {
    try {
      await finalize.mutateAsync();
      onDone();
    } catch {
      /* toastError handled inside the hook */
    }
  };

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-8">
      <header className="text-center">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Upload className="h-7 w-7" />
        </div>
        <h1 className="text-xl font-bold text-foreground md:text-2xl">
          Submitted. Now upload your sheets
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Photograph every answer sheet and upload them before the timer runs out.
        </p>
        <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-foreground">
          <Clock className="h-3.5 w-3.5 text-primary" />
          {windowClosing ? (
            <span className="text-amber-700">Window closing. Upload your last pages now</span>
          ) : (
            <span>
              Time left to upload:{" "}
              <strong>
                {minutes}:{seconds.toString().padStart(2, "0")}
              </strong>
            </span>
          )}
        </div>
      </header>

      {/* Device toggle */}
      <div className="flex items-center justify-center gap-2">
        <Button
          type="button"
          size="sm"
          variant={deviceKind === "phone" ? "default" : "outline"}
          onClick={() => setDeviceKind("phone")}
        >
          <Smartphone className="mr-1.5 h-4 w-4" />
          I'm on a phone
        </Button>
        <Button
          type="button"
          size="sm"
          variant={deviceKind === "computer" ? "default" : "outline"}
          onClick={() => setDeviceKind("computer")}
        >
          <Monitor className="mr-1.5 h-4 w-4" />
          I'm on a computer
        </Button>
      </div>

      {deviceKind === "phone" && (
        <section className="space-y-3">
          {showCamera ? (
            <CameraCapture onCapture={handleCameraCapture} onClose={() => setShowCamera(false)} />
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Button
                type="button"
                size="lg"
                className="h-16"
                disabled={atCap || uploading}
                onClick={() => setShowCamera(true)}
              >
                <Camera className="mr-2 h-5 w-5" />
                Open camera
              </Button>
              <Button
                type="button"
                size="lg"
                variant="outline"
                className="h-16"
                disabled={atCap || uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? (
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                ) : (
                  <ImagePlus className="mr-2 h-5 w-5" />
                )}
                {uploading ? "Uploading…" : "Choose photo"}
              </Button>
            </div>
          )}
          {uploading && (
            <p className="text-center text-xs text-muted-foreground">
              Compressing and uploading your photo…
            </p>
          )}
        </section>
      )}

      {deviceKind === "computer" && (
        <section className="space-y-3">
          <HybridPairingCard
            token={pairing.data}
            isLoading={pairing.isLoading}
            isFetching={pairing.isFetching}
            isError={pairing.isError}
            onRegenerate={pairing.regenerate}
          />
          <div className="rounded-xl border border-border bg-card p-4 text-center">
            <p className="mb-3 text-xs text-muted-foreground">
              Already took photos on another device and copied them here? Upload them straight
              from this computer.
            </p>
            <Button
              type="button"
              variant="outline"
              disabled={atCap || uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <ImagePlus className="mr-2 h-4 w-4" />
              )}
              {uploading ? "Uploading…" : "Upload from this computer"}
            </Button>
          </div>
        </section>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.heic,.heif"
        multiple
        className="hidden"
        onChange={handleFilesChosen}
      />

      {uploadError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          {uploadError}
        </div>
      )}
      {atCap && (
        <p className="text-center text-[11px] text-muted-foreground">
          You've reached the {maxPages}-page cap.
        </p>
      )}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">
            Pages uploaded ({pages.length})
          </h2>
        </div>
        {pages.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
            No pages yet. Capture or upload your sheets and they'll appear here.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {pages.map((p) => (
              <PageThumbnail key={p.id} page={p} />
            ))}
          </div>
        )}
      </section>

      <div className="sticky bottom-0 -mx-4 border-t border-border bg-card/95 p-4 backdrop-blur md:-mx-8">
        <Button
          className="w-full"
          size="lg"
          disabled={pages.length === 0 || finalize.isPending}
          onClick={handleDone}
        >
          <CheckCircle2 className="mr-2 h-5 w-5" />
          {finalize.isPending ? "Finalizing…" : "Done uploading"}
        </Button>
        {pages.length === 0 && (
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            Upload at least one page before you can finish.
          </p>
        )}
      </div>
    </div>
  );
}
