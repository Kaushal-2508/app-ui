import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, Camera, Loader2, Timer, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
  useHybridAttempt,
  useHybridExamData,
  useHybridPairingToken,
  useSubmitHybridForUpload,
} from "@/hooks/useHybridAttempt";
import { HybridQuestionPaper } from "@/components/hybrid/HybridQuestionPaper";
import { HybridPairingCard } from "@/components/hybrid/HybridPairingCard";
import { HybridWaitingForUpload } from "@/components/hybrid/HybridWaitingForUpload";
import { useHybridIntegrityLogger } from "@/components/hybrid/useHybridIntegrityLogger";
import { HybridCameraGate } from "@/components/hybrid/HybridCameraGate";
import { HybridCameraMonitor } from "@/components/hybrid/HybridCameraMonitor";

function useExamCountdown(startedAt: string | undefined, durationMinutes: number | null) {
  // null = not yet computed. Must NOT default to 0: otherwise `timeUp`
  // (remaining <= 0) reads true on the first in-progress render before this
  // effect runs, which instantly auto-submits the attempt and skips the
  // writing + camera phase.
  const [remaining, setRemaining] = useState<number | null>(null);
  useEffect(() => {
    if (!startedAt || !durationMinutes) {
      setRemaining(null);
      return;
    }
    const endsAt = new Date(startedAt).getTime() + durationMinutes * 60 * 1000;
    const tick = () => setRemaining(Math.max(0, Math.floor((endsAt - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt, durationMinutes]);
  return remaining;
}

function formatHmmSs(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function HybridExamAttemptPage() {
  const navigate = useNavigate();
  const { attemptId } = useParams<{ attemptId: string }>();

  const attemptQuery = useHybridAttempt(attemptId);
  const attempt = attemptQuery.data;

  // Student attempt: sanitized paper (no answer key, no direct exam_questions read).
  const examQuery = useHybridExamData(attempt?.exam_id, { sanitized: true });
  const exam = examQuery.data;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const inProgress = attempt?.status === "in_progress";

  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [violationWarning, setViolationWarning] = useState<string | null>(null);
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopCamera = useCallback(() => {
    setCameraStream((prev) => {
      prev?.getTracks().forEach((t) => t.stop());
      return null;
    });
  }, []);

  const showWarning = useCallback((type: "tab_switch" | "fullscreen_exit") => {
    setViolationWarning(
      type === "tab_switch"
        ? "Stay on this screen until you submit. This was recorded."
        : "Please stay in fullscreen until you submit. This was recorded.",
    );
    if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
    warningTimerRef.current = setTimeout(() => setViolationWarning(null), 6000);
  }, []);

  // ── Integrity logger ──────────────────────────────────────────────────
  useHybridIntegrityLogger({
    enabled: inProgress,
    attemptId: attempt?.id,
    institutionId: attempt?.institution_id,
    studentId: attempt?.student_id,
    onViolation: showWarning,
  });

  // ── Timer ─────────────────────────────────────────────────────────────
  const remainingSeconds = useExamCountdown(
    attempt?.started_at,
    exam?.duration_minutes ?? null,
  );
  const timeUp =
    inProgress &&
    exam?.duration_minutes != null &&
    remainingSeconds !== null &&
    remainingSeconds <= 0;

  // ── Pairing token (only while in progress) ────────────────────────────
  const pairing = useHybridPairingToken(attempt?.id, { enabled: inProgress });

  // ── Submit ────────────────────────────────────────────────────────────
  const submit = useSubmitHybridForUpload(attempt?.id);
  const [submitOpen, setSubmitOpen] = useState(false);
  const handleConfirmSubmit = async () => {
    setSubmitOpen(false);
    try {
      await submit.mutateAsync();
      attemptQuery.refetch();
    } catch {
      /* error already toasted by the hook */
    }
  };

  // Auto-submit when the timer hits 0.
  const autoSubmittedRef = useRef(false);
  useEffect(() => {
    if (timeUp && !autoSubmittedRef.current) {
      autoSubmittedRef.current = true;
      submit.mutateAsync().then(() => attemptQuery.refetch()).catch(() => {});
    }
  }, [timeUp, submit, attemptQuery]);

  // Tear the writing-phase camera down once we leave in-progress (submit / time-up)
  // and on unmount. The upload phase uses a separate (back) camera.
  useEffect(() => {
    if (!inProgress) stopCamera();
  }, [inProgress, stopCamera]);
  useEffect(() => () => stopCamera(), [stopCamera]);

  const isLoading = attemptQuery.isLoading || examQuery.isLoading;
  const errored = attemptQuery.isError || examQuery.isError;
  const navigateBack = () => navigate("/student/exams");

  const sheetInstruction = exam?.settings?.sheet_numbering_instruction;

  // Absent means ON. The column defaults true and every row existing at
  // 2026-09-04 was backfilled true, so a missing value must never be read as
  // "this exam is unproctored".
  const requireCamera = exam?.settings?.require_camera ?? true;

  const graceWindowMinutes = useMemo(
    () => exam?.settings?.grace_window_minutes ?? 5,
    [exam?.settings?.grace_window_minutes],
  );

  // ── Render ────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (errored || !attempt || !exam) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-4">
        <Card className="max-w-md">
          <CardContent className="p-6 text-center">
            <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-destructive" />
            <h2 className="mb-2 text-lg font-semibold">Couldn't load the attempt</h2>
            <p className="mb-4 text-sm text-muted-foreground">
              The hybrid attempt you're looking for doesn't exist or you don't have access.
            </p>
            <Button onClick={navigateBack}>Back to exams</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Terminal states — bounce back.
  if (
    attempt.status === "pending_evaluation" ||
    attempt.status === "evaluated" ||
    attempt.status === "cancelled_no_upload"
  ) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-4">
        <Card className="max-w-md">
          <CardContent className="p-6 text-center">
            <Upload className="mx-auto mb-3 h-10 w-10 text-primary" />
            <h2 className="mb-2 text-lg font-semibold">All done</h2>
            <p className="mb-4 text-sm text-muted-foreground">
              {attempt.status === "evaluated"
                ? "Your teacher has finished marking this attempt."
                : attempt.status === "cancelled_no_upload"
                  ? "This attempt was cancelled because the upload window expired."
                  : "Your sheets are uploaded and waiting for your teacher's marking."}
            </p>
            <Button onClick={navigateBack}>Back to exams</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Awaiting upload — switch to the waiting screen.
  if (
    attempt.status === "awaiting_upload" ||
    attempt.status === "upload_in_progress"
  ) {
    return (
      <HybridWaitingForUpload
        attempt={attempt}
        graceWindowMinutes={graceWindowMinutes}
        maxPages={exam?.settings?.max_pages ?? 10}
        onDone={() => attemptQuery.refetch()}
      />
    );
  }

  // In-progress — when this exam is camera-proctored, permission is the FIRST
  // thing and no paper appears until it is granted. A teacher who switched
  // "Require camera proctoring" off gets an unproctored paper exam instead, so
  // a student with a blocked or missing camera is no longer walled out of it.
  // Defaults to ON when the setting is absent (older rows), so an exam is never
  // silently unproctored by missing data.
  if (requireCamera && inProgress && !cameraStream) {
    return <HybridCameraGate onGranted={(stream) => setCameraStream(stream)} />;
  }

  // In-progress — the laptop side.
  return (
    <div ref={containerRef} className="min-h-dvh bg-background">
      {violationWarning && (
        <div className="fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-2">
          <div className="flex items-center gap-2 rounded-full border border-amber-300 bg-amber-50 px-4 py-2 text-xs font-medium text-amber-900 shadow-md">
            <AlertTriangle className="h-4 w-4" />
            {violationWarning}
          </div>
        </div>
      )}
      {/* Top bar */}
      <header className="sticky top-0 z-20 border-b border-border bg-card/95 px-3 py-2 backdrop-blur md:px-6">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-foreground md:text-base">
              {exam.title}
            </div>
            <div className="text-[11px] text-muted-foreground">
              Hybrid exam · Read on screen, write on paper
            </div>
          </div>
          <div className="flex items-center gap-2">
            {exam.duration_minutes != null && remainingSeconds !== null && (
              <div
                className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold tabular-nums ${
                  remainingSeconds <= 60
                    ? "bg-destructive/10 text-destructive"
                    : remainingSeconds <= 300
                      ? "bg-amber-500/10 text-amber-700"
                      : "bg-primary/10 text-primary"
                }`}
              >
                <Timer className="h-3.5 w-3.5" />
                {formatHmmSs(remainingSeconds)}
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-4 p-3 md:grid-cols-[3fr_2fr] md:p-6">
        {/* Question paper */}
        <main className="rounded-xl border border-border bg-card p-3 md:p-6">
          <HybridQuestionPaper exam={exam} />
        </main>

        {/* Pairing + submit */}
        <aside className="space-y-4">
          {sheetInstruction && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              <strong>Numbering:</strong> {sheetInstruction}
            </div>
          )}

          <HybridPairingCard
            token={pairing.data}
            isLoading={pairing.isLoading}
            isFetching={pairing.isFetching}
            isError={pairing.isError}
            onRegenerate={pairing.regenerate}
          />

          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
              <Camera className="h-4 w-4 text-primary" />
              When you're done writing
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              Click below to submit. You'll then have{" "}
              <strong>{graceWindowMinutes} minutes</strong> to photograph and upload all your
              answer sheets from your phone.
            </p>
            <Button
              className="w-full"
              size="lg"
              onClick={() => setSubmitOpen(true)}
              disabled={submit.isPending}
            >
              <Upload className="mr-2 h-4 w-4" />
              OK, I'm ready to submit
            </Button>
          </div>
        </aside>
      </div>

      {cameraStream && attempt && (
        <HybridCameraMonitor
          stream={cameraStream}
          attemptId={attempt.id}
          examId={attempt.exam_id}
          institutionId={attempt.institution_id}
        />
      )}

      <AlertDialog open={submitOpen} onOpenChange={setSubmitOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Submit and start the upload window?</AlertDialogTitle>
            <AlertDialogDescription>
              After you submit, you'll have <strong>{graceWindowMinutes} minutes</strong> to
              photograph and upload all your answer sheets from your phone. You can't keep
              writing after this point.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep writing</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmSubmit}>
              Submit now
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
