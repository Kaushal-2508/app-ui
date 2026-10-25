import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  useUploadHybridPage,
  useValidatePairingToken,
} from "@/hooks/useHybridUpload";
import { CameraCapture } from "@/components/offline-scan/CameraCapture";

interface PendingPage {
  pageNumber: number;
  file: File;
  previewUrl: string;
}

interface UploadedPage {
  pageNumber: number;
  pageId: string;
  storagePath: string;
}

function ErrorScreen({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
        <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-amber-500" />
        <h1 className="mb-1 text-lg font-semibold text-foreground">{title}</h1>
        <p className="text-sm text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}

export default function HybridUploadPage() {
  const { token } = useParams<{ token: string }>();
  const validate = useValidatePairingToken(token);
  const uploadMutation = useUploadHybridPage();

  const pairing = validate.data;
  const captureInputRef = useRef<HTMLInputElement | null>(null);

  const [pending, setPending] = useState<PendingPage[]>([]);
  const [uploaded, setUploaded] = useState<UploadedPage[]>([]);
  const [uploading, setUploading] = useState<number | null>(null);
  const [errorByPage, setErrorByPage] = useState<Record<number, string>>({});
  const [confirmFinishOpen, setConfirmFinishOpen] = useState(false);
  const [finished, setFinished] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);

  // Tear down object URLs on unmount.
  const pendingRef = useRef<PendingPage[]>([]);
  pendingRef.current = pending;
  useEffect(() => {
    return () => {
      pendingRef.current.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    };
  }, []);

  const allPagesCount = uploaded.length + pending.length;
  const maxPages = pairing?.max_pages ?? 10;
  const atCap = allPagesCount >= maxPages;
  const nextPageNumber = useMemo(() => {
    const used = new Set([
      ...uploaded.map((p) => p.pageNumber),
      ...pending.map((p) => p.pageNumber),
    ]);
    for (let i = 1; i <= maxPages; i++) {
      if (!used.has(i)) return i;
    }
    return maxPages + 1;
  }, [uploaded, pending, maxPages]);

  const handleFileChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset so picking the same file again triggers
    if (!file) return;
    if (atCap) return;
    const pageNumber = nextPageNumber;
    setPending((prev) => [
      ...prev,
      {
        pageNumber,
        file,
        previewUrl: URL.createObjectURL(file),
      },
    ]);
  };

  const handleCameraCapture = (file: File) => {
    setShowCamera(false);
    if (atCap) return;
    const pageNumber = nextPageNumber;
    setPending((prev) => [
      ...prev,
      { pageNumber, file, previewUrl: URL.createObjectURL(file) },
    ]);
  };

  const removePending = (pageNumber: number) => {
    setPending((prev) => {
      const target = prev.find((p) => p.pageNumber === pageNumber);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.pageNumber !== pageNumber);
    });
    setErrorByPage((prev) => {
      const next = { ...prev };
      delete next[pageNumber];
      return next;
    });
  };

  const uploadOnePage = async (page: PendingPage) => {
    if (!token) return;
    setUploading(page.pageNumber);
    setErrorByPage((prev) => {
      const next = { ...prev };
      delete next[page.pageNumber];
      return next;
    });
    try {
      const result = await uploadMutation.mutateAsync({
        token,
        pageNumber: page.pageNumber,
        file: page.file,
      });
      setUploaded((prev) => [
        ...prev.filter((p) => p.pageNumber !== result.page_number),
        {
          pageNumber: result.page_number,
          pageId: result.page_id,
          storagePath: result.storage_path,
        },
      ].sort((a, b) => a.pageNumber - b.pageNumber));
      URL.revokeObjectURL(page.previewUrl);
      setPending((prev) => prev.filter((p) => p.pageNumber !== page.pageNumber));
    } catch (err) {
      setErrorByPage((prev) => ({
        ...prev,
        [page.pageNumber]: err instanceof Error ? err.message : "Upload failed",
      }));
    } finally {
      setUploading(null);
    }
  };

  const handleUploadAll = async () => {
    for (const page of pending) {
      await uploadOnePage(page);
    }
  };

  const handleFinish = () => {
    setConfirmFinishOpen(false);
    setFinished(true);
  };

  // ── Render ────────────────────────────────────────────────────────────

  if (validate.isLoading) return <LoadingScreen />;
  if (validate.isError || !pairing) {
    const msg = validate.error instanceof Error
      ? validate.error.message
      : "We couldn't validate this pairing code.";
    return (
      <ErrorScreen
        title="Pairing not valid"
        body={`${msg}. Ask your teacher (or look at the laptop) to regenerate the QR code.`}
      />
    );
  }

  if (
    pairing.attempt_status === "evaluated" ||
    pairing.attempt_status === "cancelled_no_upload" ||
    pairing.attempt_status === "pending_evaluation"
  ) {
    return (
      <ErrorScreen
        title="Upload window closed"
        body="Your teacher has either already received the sheets or the upload window has expired."
      />
    );
  }

  if (finished) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background p-4">
        <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
            <CheckCircle2 className="h-7 w-7" />
          </div>
          <h1 className="mb-1 text-lg font-semibold text-foreground">
            Sheets uploaded
          </h1>
          <p className="text-sm text-muted-foreground">
            Go back to your laptop and tap <strong>"Done uploading"</strong> to finish.
          </p>
          <div className="mt-4 text-xs text-muted-foreground">
            {uploaded.length} page{uploaded.length === 1 ? "" : "s"} sent
          </div>
        </div>
      </div>
    );
  }

  const remainingPending = pending.length;
  const canFinish = uploaded.length >= 1 && remainingPending === 0;

  return (
    <div className="min-h-dvh bg-background pb-32">
      {/* Header */}
      <header className="border-b border-border bg-card px-4 py-3">
        <div className="text-sm font-semibold text-foreground">{pairing.exam_title}</div>
        <div className="text-xs text-muted-foreground">{pairing.student_name}</div>
        <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>
            Page {allPagesCount} of {maxPages} max
          </span>
          <span className="font-medium text-foreground">
            {uploaded.length} uploaded
          </span>
        </div>
      </header>

      <main className="space-y-4 px-4 py-4">
        {/* Capture options */}
        {showCamera ? (
          <CameraCapture onCapture={handleCameraCapture} onClose={() => setShowCamera(false)} />
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Button
              onClick={() => !atCap && setShowCamera(true)}
              size="lg"
              className="h-16 text-base"
              disabled={atCap}
            >
              <Camera className="mr-2 h-5 w-5" />
              Open camera
            </Button>
            <Button
              onClick={() => !atCap && galleryInputRef.current?.click()}
              size="lg"
              variant="outline"
              className="h-16 text-base"
              disabled={atCap}
            >
              <Upload className="mr-2 h-5 w-5" />
              Choose file
            </Button>
          </div>
        )}
        {/* Native camera input (kept for the OS quick-capture path) */}
        <input
          ref={captureInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handleFileChosen}
        />
        {/* Gallery / file input (no capture attr → picks an existing image) */}
        <input
          ref={galleryInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChosen}
        />

        <p className="text-center text-xs text-muted-foreground">
          {atCap
            ? `Reached the ${maxPages}-page cap.`
            : "Open the camera for a fresh photo, or choose an existing image. Full sheet in frame, no glare. We'll compress automatically."}
        </p>

        {/* Pending (not yet uploaded) */}
        {pending.length > 0 && (
          <section className="space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Ready to upload ({pending.length})
            </div>
            <ul className="grid grid-cols-2 gap-3">
              {pending.map((p) => {
                const isUploading = uploading === p.pageNumber;
                const error = errorByPage[p.pageNumber];
                return (
                  <li
                    key={p.pageNumber}
                    className="overflow-hidden rounded-xl border border-border bg-card"
                  >
                    <div className="relative aspect-[3/4] w-full bg-muted">
                      <img
                        src={p.previewUrl}
                        alt={`Page ${p.pageNumber}`}
                        className="h-full w-full object-cover"
                      />
                      {isUploading && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-white">
                          <Loader2 className="h-6 w-6 animate-spin" />
                        </div>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2 px-2 py-1.5">
                      <span className="text-xs font-medium text-foreground">
                        Page {p.pageNumber}
                      </span>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2"
                          disabled={isUploading}
                          onClick={() => uploadOnePage(p)}
                        >
                          <Upload className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-destructive hover:text-destructive"
                          disabled={isUploading}
                          onClick={() => removePending(p.pageNumber)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                    {error && (
                      <div className="px-2 pb-2">
                        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-[11px] text-destructive">
                          {error}
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="mt-1 h-6 px-2 text-[11px]"
                            disabled={isUploading}
                            onClick={() => uploadOnePage(p)}
                          >
                            <RefreshCw className="mr-1 h-3 w-3" />
                            Retry
                          </Button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* Uploaded */}
        {uploaded.length > 0 && (
          <section className="space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Uploaded ({uploaded.length})
            </div>
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {uploaded.map((u) => (
                <li
                  key={u.pageId}
                  className="flex flex-col items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-center"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-700">
                    <CheckCircle2 className="h-5 w-5" />
                  </div>
                  <div className="text-[11px] font-medium text-emerald-900">
                    Page {u.pageNumber}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>

      {/* Sticky bottom action bar */}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-card/95 backdrop-blur">
        <div className="mx-auto max-w-screen-sm space-y-2 px-4 py-3">
          {pending.length > 0 && (
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="w-full"
              onClick={handleUploadAll}
              disabled={uploading !== null}
            >
              <Upload className="mr-2 h-4 w-4" />
              {uploading !== null ? `Uploading page ${uploading}…` : `Upload ${pending.length} pending`}
            </Button>
          )}
          <Button
            type="button"
            size="lg"
            className="w-full"
            disabled={!canFinish}
            onClick={() => setConfirmFinishOpen(true)}
          >
            <CheckCircle2 className="mr-2 h-4 w-4" />
            Upload all &amp; finish
          </Button>
          {!canFinish && (
            <p className="text-center text-[11px] text-muted-foreground">
              {uploaded.length === 0
                ? "Capture and upload at least one page."
                : "Upload your pending pages first."}
            </p>
          )}
        </div>
      </div>

      <AlertDialog open={confirmFinishOpen} onOpenChange={setConfirmFinishOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Finish uploading?</AlertDialogTitle>
            <AlertDialogDescription>
              You've uploaded {uploaded.length} page{uploaded.length === 1 ? "" : "s"}. Once
              you finish here, go back to your laptop and tap "Done uploading" to send the
              attempt for marking.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep adding</AlertDialogCancel>
            <AlertDialogAction onClick={handleFinish}>I'm done</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
