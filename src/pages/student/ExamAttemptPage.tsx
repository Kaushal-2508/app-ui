import { useState, useEffect, useRef, useMemo } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogPortal,
  AlertDialogOverlay,
} from "@/components/ui/alert-dialog";
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import {
  Clock,
  Flag,
  ChevronLeft,
  ChevronRight,
  Send,
  Camera,
  Shield,
  AlertTriangle,
  CheckCircle2,
  Circle,
  Maximize,
  Loader2,
  Minimize,
  Eye,
  EyeOff,
  Mic,
  Monitor,
  BookOpen,
  XCircle,
  HelpCircle,
} from "lucide-react";
import { useExamAttempt } from "@/hooks/useExamAttempt";
import { useTelemetry } from "@/hooks/useTelemetry";
import { useProctoring } from "@/hooks/useProctoring";
import { StudentCameraPreview } from "@/components/proctoring/StudentCameraPreview";
import { toast } from "sonner";
import { normalizeText } from "@/lib/textNormalization";
import { MathPreview } from "@/components/ui/math-preview";
import { MathText } from "@/components/ui/math-text";
import { OptionChoiceGrid } from "@/components/exam/OptionChoiceGrid";
import { QuestionDiagram } from "@/components/exam/QuestionDiagram";
import { hasOptionImages, type DisplayOption } from "@/components/exam/optionDisplay";
import {
  requestFullscreen,
  exitFullscreen,
  getFullscreenElement,
  isFullscreenSupported,
  isApplePlatform,
  onFullscreenChange,
} from "@/lib/fullscreen";
import { onAppStateChange } from "@/lib/native";
import { PageShell } from "@/components/shared/page";
import { MobileSheet } from "@/components/shared/sheets";
import { normalizeProctoringConfig, type ProctoringConfig } from "@/types/exam";

// Violation ladder thresholds, shared by tab-switch and fullscreen-exit paths.
const MAX_VIOLATIONS = 4;
const PAUSE_SECONDS = 15;

export default function ExamAttemptPage() {
  const { examId } = useParams();
  const [searchParams] = useSearchParams();
  const classId = searchParams.get("classId") || "";
  const navigate = useNavigate();

  const {
    exam,
    state,
    currentSection,
    currentQuestion,
    isLoading,
    isStarting,
    isSubmitting,
    startAttempt,
    saveAnswer,
    submitAttempt,
    submitAttemptAsync,
    resetSubmit,
    goToQuestion,
    nextQuestion,
    prevQuestion,
    toggleFlag,
  } = useExamAttempt(examId!, classId);

  const telemetry = useTelemetry(state.attemptId);
  const proctoring = useProctoring(state.attemptId, exam?.exam_mode || "");

  const [showConsentDialog, setShowConsentDialog] = useState(false);
  const [showSubmitDialog, setShowSubmitDialog] = useState(false);
  const [submissionComplete, setSubmissionComplete] = useState(false);
  const [showNavigator, setShowNavigator] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showCameraPreview, setShowCameraPreview] = useState(true);
  const [visitedQuestions, setVisitedQuestions] = useState<Set<string>>(new Set());
  const [showSubmittingOverlay, setShowSubmittingOverlay] = useState(false);

  // Unified violation ladder (tab switches + fullscreen exits, all platforms):
  // 1st-2nd violation → blocking warning with a mandatory acknowledgement,
  // 3rd → 15-second pause with a final warning, 4th → auto-submit.
  const [violationCount, setViolationCount] = useState(0);
  const [activeViolation, setActiveViolation] = useState<number | null>(null);
  const [violationAckChecked, setViolationAckChecked] = useState(false);
  const [pauseRemaining, setPauseRemaining] = useState<number | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const isSubmittingRef = useRef(false);
  const violationCountRef = useRef(0);
  const lastViolationAtRef = useRef(0);

  // Determine if this is an active online exam attempt
  const isActiveOnlineAttempt = !!state.attemptId && exam?.exam_mode === "online";

  // Per-exam proctoring switches set by the teacher on the Review & publish
  // screen. Until now nothing on this page read them, so all four toggles were
  // inert and every online exam got the full lockdown regardless.
  const proctoringCfg = useMemo(
    () => normalizeProctoringConfig(exam?.proctoring_config),
    [exam?.proctoring_config]
  );

  const webcamRequired = isActiveOnlineAttempt && proctoringCfg.webcam;

  // Fullscreen needs BOTH the teacher's switch and a platform that supports it.
  // Apple devices are exempt: iPhone Safari has no Fullscreen API and the
  // macOS/iPadOS implementation blocked students from taking exams.
  const fullscreenEnforced = useMemo(
    () => proctoringCfg.fullscreenLock && isFullscreenSupported() && !isApplePlatform(),
    [proctoringCfg.fullscreenLock]
  );

  // Track visited questions
  useEffect(() => {
    if (currentQuestion?.id) {
      setVisitedQuestions(prev => new Set(prev).add(currentQuestion.id));
    }
  }, [currentQuestion?.id]);

  // Calculate question stats for submission dialog
  const questionStats = useMemo(() => {
    if (!exam?.sections) return { total: 0, answered: 0, notVisited: 0, flagged: 0 };
    
    const allQuestionIds = exam.sections.flatMap((s: any) => 
      s.questions.map((q: any) => q.id)
    );
    const total = allQuestionIds.length;
    const answered = Object.keys(state.answers).length;
    const notVisited = allQuestionIds.filter((id: string) => !visitedQuestions.has(id)).length;
    const flagged = state.flaggedQuestions.size;
    
    return { total, answered, notVisited, flagged };
  }, [exam?.sections, state.answers, visitedQuestions, state.flaggedQuestions]);

  // Compute isLastQuestion
  const isLastQuestion = useMemo(() => {
    if (!exam?.sections) return false;
    const sections = exam.sections;
    const lastSectionIdx = sections.length - 1;
    const lastQuestionIdx = sections[lastSectionIdx]?.questions?.length - 1;
    return state.currentSectionIndex === lastSectionIdx && state.currentQuestionIndex === lastQuestionIdx;
  }, [exam?.sections, state.currentSectionIndex, state.currentQuestionIndex]);

  /**
   * Trap the Back button (and the Android/iOS back gesture) during a live
   * attempt.
   *
   * Back used to leave the exam outright, dropping the student on the exam
   * list where they could walk straight back in. Combined with the timer bug
   * that reseeded the clock on re-entry, that was an unlimited-time cheat.
   * The clock is now server-anchored, so re-entry no longer grants time — but
   * a student should still not be able to wander out of a live paper, so Back
   * now asks them to submit instead.
   *
   * BrowserRouter is not a data router, so react-router's useBlocker is
   * unavailable here; this is the history-sentinel approach. One extra entry is
   * pushed so the first Back pops that instead of the exam route, and every
   * pop re-pushes it and surfaces the submit dialog.
   */
  useEffect(() => {
    if (!isActiveOnlineAttempt || submissionComplete) return;

    window.history.pushState({ salciExamGuard: true }, "");

    const handlePopState = () => {
      // Put the sentinel back before anything else, or a second Back would
      // escape the page.
      window.history.pushState({ salciExamGuard: true }, "");
      setShowSubmitDialog(true);
      toast.warning("Submit your exam to leave this screen.");
      proctoring.recordEvent("navigation_attempt", "medium");
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [isActiveOnlineAttempt, submissionComplete, proctoring]);

  /**
   * Reload / tab-close confirmation. The Back trap above cannot cover these,
   * and an unsubmitted reload used to be the other way out of a live paper.
   * Browsers show their own generic wording; the text is ignored.
   */
  useEffect(() => {
    if (!isActiveOnlineAttempt || submissionComplete) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
      return "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isActiveOnlineAttempt, submissionComplete]);

  // Disable right-click during exam + record proctoring event
  useEffect(() => {
    if (!state.attemptId) return;

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      toast.warning("Right-click is disabled during the exam");
      proctoring.recordEvent("right_click_attempt", "low");
    };

    document.addEventListener("contextmenu", handleContextMenu);
    return () => document.removeEventListener("contextmenu", handleContextMenu);
  }, [state.attemptId, proctoring]);

  // Disable keyboard shortcuts during exam + record proctoring event
  useEffect(() => {
    if (!state.attemptId) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        const key = e.key.toLowerCase();
        const isClipboard = key === "c" || key === "v" || key === "x";
        // Clipboard keys obey the teacher's "Disable copy / paste" switch.
        // View-source / save / print stay blocked either way: they are not
        // clipboard operations and that switch never claimed to cover them.
        const blocked = isClipboard
          ? proctoringCfg.copyPasteDisable
          : ["u", "s", "p"].includes(key);
        if (blocked) {
          e.preventDefault();
          toast.warning("Keyboard shortcuts are disabled during the exam");
          if (isClipboard) {
            proctoring.recordEvent("copy_paste_attempt", "medium");
          } else {
            proctoring.recordEvent("keyboard_shortcut_blocked", "low");
          }
        }
      }
      // Prevent F12, F5 refresh
      if (e.key === "F12" || e.key === "F5") {
        e.preventDefault();
        toast.warning("This action is disabled during the exam");
        if (e.key === "F12") {
          proctoring.recordEvent("browser_devtools_opened", "high");
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [state.attemptId, proctoring, proctoringCfg.copyPasteDisable]);

  // Block the clipboard events themselves, not just the shortcuts — right-click
  // menus, mobile long-press and edit-menu copy never fire a keydown.
  useEffect(() => {
    if (!state.attemptId || !proctoringCfg.copyPasteDisable) return;

    const block = (e: ClipboardEvent) => {
      e.preventDefault();
      toast.warning("Copy and paste are disabled during the exam");
      proctoring.recordEvent("copy_paste_attempt", "medium");
    };

    document.addEventListener("copy", block);
    document.addEventListener("cut", block);
    document.addEventListener("paste", block);
    return () => {
      document.removeEventListener("copy", block);
      document.removeEventListener("cut", block);
      document.removeEventListener("paste", block);
    };
  }, [state.attemptId, proctoring, proctoringCfg.copyPasteDisable]);

  // Track question view when it changes
  useEffect(() => {
    if (currentQuestion?.id && state.attemptId) {
      telemetry.trackQuestionView(currentQuestion.id);
      proctoring.setCurrentQuestion(currentQuestion.id);
    }
  }, [currentQuestion?.id, state.attemptId]);

  // Track section view
  useEffect(() => {
    if (currentSection?.id && state.attemptId) {
      telemetry.trackSectionView(currentSection.id);
    }
  }, [currentSection?.id, state.attemptId]);

  // Show consent dialog for online exams
  useEffect(() => {
    if (exam && exam.exam_mode === "online" && !proctoring.consentGiven) {
      setShowConsentDialog(true);
    }
  }, [exam?.exam_mode, proctoring.consentGiven]);

  // Shared submit routine — used by the manual Submit dialog AND the
  // auto-submit on the 4th violation. Idempotent via isSubmittingRef.
  const performSubmit = async (opts: { auto?: boolean } = {}) => {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setShowSubmitDialog(false);
    setActiveViolation(null);
    setPauseRemaining(null);
    setShowSubmittingOverlay(true);

    try { telemetry.flushTelemetry(); } catch (te) { console.warn("Telemetry flush error:", te); }

    const timeoutId = setTimeout(() => {
      console.error("Submit timeout reached (30s)");
      isSubmittingRef.current = false;
      setShowSubmittingOverlay(false);
      resetSubmit();
      toast.error("Submission is taking too long. Please try again.", { duration: 8000 });
    }, 30000);

    try {
      await submitAttemptAsync(false);
      clearTimeout(timeoutId);
      // Deliberately NOT resetting isSubmittingRef here: submission is terminal
      // and the guard must stay latched. The exitFullscreen() below fires a
      // fullscreenchange, and the listeners are still attached during the 3s
      // redirect delay — an unlatched guard would record a bogus violation and,
      // if it were the 4th, re-enter performSubmit and submit twice.
      setSubmissionComplete(true);
      setShowSubmittingOverlay(false);
      if (opts.auto) {
        toast.error("Exam submitted automatically after repeated violations.", { duration: 8000 });
      }
      setTimeout(() => navigate("/student/exams"), 3000);
      proctoring.endSession().catch(e2 => console.error("Proctoring cleanup error:", e2));
      if (getFullscreenElement()) {
        exitFullscreen().catch(e3 => console.error("Fullscreen exit error:", e3));
      }
    } catch (error: any) {
      clearTimeout(timeoutId);
      console.error("Submit failed:", error);
      isSubmittingRef.current = false;
      setShowSubmittingOverlay(false);
      resetSubmit();
      if (error?.message === "SESSION_EXPIRED") {
        toast.error("Your session expired. Please log in again. Your answers are saved locally.", { duration: 10000 });
      } else {
        toast.error("Failed to submit exam. Please try again.");
      }
    }
  };

  // One violation ladder for tab switches AND fullscreen exits. A tab switch
  // while in fullscreen fires both events, so violations within a short window
  // are counted once.
  const recordViolation = () => {
    if (isSubmittingRef.current || submissionComplete) return;
    const now = Date.now();
    if (now - lastViolationAtRef.current < 3000) return;
    lastViolationAtRef.current = now;

    const next = violationCountRef.current + 1;
    violationCountRef.current = next;
    setViolationCount(next);

    if (next >= MAX_VIOLATIONS) {
      performSubmit({ auto: true });
      return;
    }
    setViolationAckChecked(false);
    setActiveViolation(next);
    if (next === MAX_VIOLATIONS - 1) {
      setPauseRemaining(PAUSE_SECONDS);
    }
  };

  const resumeFromViolation = async () => {
    setActiveViolation(null);
    setPauseRemaining(null);
    setViolationAckChecked(false);
    // Re-entering fullscreen needs a user gesture — this click is one.
    if (fullscreenEnforced && isActiveOnlineAttempt && !getFullscreenElement()) {
      try {
        await requestFullscreen(containerRef.current);
      } catch (err) {
        console.error("Re-enter fullscreen failed:", err);
      }
    }
  };

  // 15-second pause countdown for the 3rd violation
  useEffect(() => {
    if (pauseRemaining === null || pauseRemaining <= 0) return;
    const t = setTimeout(
      () => setPauseRemaining((p) => (p === null ? null : p - 1)),
      1000
    );
    return () => clearTimeout(t);
  }, [pauseRemaining]);

  // Tab switch detection → violation ladder + refocus
  useEffect(() => {
    if (!state.attemptId) return;

    // One subscription through the native adapter: on the web this is the
    // same visibilitychange + blur pair as before; inside the app shell it
    // becomes the OS app-state event, so a notification shade or a phone call
    // is not booked as cheating (native-app plan, Phase 0).
    const off = onAppStateChange((active, source) => {
      if (source === "focus") {
        if (active) return;
        // Window blur - try to refocus
        proctoring.recordEvent("window_blur", "medium");
        setTimeout(() => window.focus(), 100);
        return;
      }
      if (!active) {
        // The event is always logged for the teacher's record; only the
        // student-facing warning ladder obeys the "Lock on tab switch" switch.
        proctoring.recordEvent("tab_switch", "high");
        if (isActiveOnlineAttempt && proctoringCfg.tabSwitchLock) recordViolation();
      } else if (
        // User returned - try to re-enter fullscreen (enforced platforms only)
        fullscreenEnforced &&
        isActiveOnlineAttempt &&
        !getFullscreenElement() &&
        containerRef.current
      ) {
        requestFullscreen(containerRef.current).catch(() => {});
      }
    });
    return off;
    // recordViolation intentionally omitted — ref-based guards handle re-entry
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.attemptId, isActiveOnlineAttempt, fullscreenEnforced, proctoring, proctoringCfg.tabSwitchLock]);

  // Fullscreen handling - enforced for online exams on Android/desktop only.
  // Exits feed the same 4-strike violation ladder as tab switches. On Apple
  // devices (fullscreenEnforced=false) exits are logged but never penalized.
  useEffect(() => {
    if (!isFullscreenSupported()) return;
    const handleFullscreenChange = () => {
      const isInFullscreen = !!getFullscreenElement();
      setIsFullscreen(isInFullscreen);

      if (!isInFullscreen && isActiveOnlineAttempt && !isSubmittingRef.current) {
        proctoring.recordEvent("fullscreen_exited", "high");
        if (fullscreenEnforced) recordViolation();
      }
    };

    return onFullscreenChange(handleFullscreenChange);
    // recordViolation intentionally omitted — ref-based guards handle re-entry
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActiveOnlineAttempt, fullscreenEnforced, proctoring]);

  // Toggle fullscreen function
  const toggleFullscreen = async () => {
    try {
      if (!getFullscreenElement()) {
        await requestFullscreen(containerRef.current);
      } else {
        if (fullscreenEnforced && isActiveOnlineAttempt) {
          toast.warning("Fullscreen mode is required for this exam");
          return;
        }
        await exitFullscreen();
      }
    } catch (error) {
      console.error("Fullscreen error:", error);
    }
  };

  // Auto-enter fullscreen after attempt starts (backup) — enforced platforms only
  useEffect(() => {
    if (fullscreenEnforced && isActiveOnlineAttempt && !getFullscreenElement() && containerRef.current) {
      requestFullscreen(containerRef.current).catch(err => {
        console.error("Auto-fullscreen after start failed:", err);
      });
    }
  }, [isActiveOnlineAttempt, fullscreenEnforced]);

  // Keyboard Lock API — suppresses ESC (and other system keys) while fullscreen
  // is active on Chromium browsers. Browser hard-codes ESC to exit fullscreen,
  // so preventDefault on keydown does NOT work; this is the only supported path.
  // Firefox/Safari don't implement this API — the blocking overlay is the
  // fallback there. Lock is released when the exam finishes or the page unloads.
  useEffect(() => {
    if (!isActiveOnlineAttempt || !fullscreenEnforced) return;
    const kb = (navigator as any).keyboard;
    if (!kb?.lock) return;

    let locked = false;
    const acquire = () => {
      if (locked || !getFullscreenElement()) return;
      kb.lock(["Escape", "F11"])
        .then(() => {
          locked = true;
        })
        .catch((err: unknown) => console.error("Keyboard lock failed:", err));
    };

    acquire();
    const unsubscribe = onFullscreenChange(acquire);
    return () => {
      unsubscribe();
      if (locked) {
        try { kb.unlock(); } catch (err) { console.error("Keyboard unlock failed:", err); }
      }
    };
  }, [isActiveOnlineAttempt, fullscreenEnforced]);

  // Submission success screen
  if (submissionComplete) {
    return (
      <div className="fixed inset-0 z-[9999] bg-background flex items-center justify-center">
        <div className="text-center space-y-6 animate-in fade-in zoom-in duration-500">
          <div className="relative mx-auto w-24 h-24">
            <CheckCircle2 className="h-24 w-24 text-green-500 mx-auto animate-bounce" />
          </div>
          <h1 className="text-3xl font-bold text-foreground">Exam Submitted Successfully!</h1>
          <p className="text-muted-foreground text-lg">
            Your answers have been saved. Redirecting to your exams...
          </p>
          <Progress value={100} className="w-64 mx-auto h-2" />
          <Button
            variant="outline"
            onClick={() => navigate("/student/exams")}
            className="mt-4"
          >
            Go to Exams Now
          </Button>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return <LoadingSkeleton />;
  }

  if (!exam) {
    return (
      <div className="flex items-center justify-center min-h-dvh">
        <Card className="max-w-md">
          <CardContent className="p-6 text-center">
            <AlertTriangle className="h-12 w-12 mx-auto text-destructive mb-4" />
            <h2 className="text-lg font-semibold mb-2">Exam Not Found</h2>
            <p className="text-muted-foreground mb-4">
              The exam you're looking for doesn't exist or you don't have access.
            </p>
            <Button onClick={() => navigate("/student/exams")}>Go Back</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Defensive — hybrid exams live at /student/hybrid-exam/:attemptId, not here.
  // If a stale link sends them through this route, bounce them back so they use
  // the proper Start button in their exam list.
  if (exam.exam_mode === "hybrid") {
    return (
      <div className="flex items-center justify-center min-h-dvh p-4">
        <Card className="max-w-md">
          <CardContent className="p-6 text-center">
            <AlertTriangle className="h-12 w-12 mx-auto text-amber-500 mb-4" />
            <h2 className="text-lg font-semibold mb-2">Open this from your exams list</h2>
            <p className="text-muted-foreground mb-4">
              This is a hybrid exam. Please go back to your exams list and tap{" "}
              <strong>Start hybrid exam</strong> there so we can prepare the pairing.
            </p>
            <Button onClick={() => navigate("/student/exams")}>Back to exams</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Pre-exam view (consent + start)
  if (!state.attemptId) {
    return (
      <div ref={containerRef}>
        <PreExamView
          exam={exam}
          fullscreenEnforced={fullscreenEnforced}
          proctoringCfg={proctoringCfg}
          isStarting={isStarting}
          onStart={async () => {
            // Request camera FIRST (while user gesture is still active).
            // Only when the teacher left "Webcam monitoring" on — otherwise the
            // exam must start without ever touching the camera.
            if (exam.exam_mode === "online" && proctoringCfg.webcam) {
              const granted = await proctoring.requestPermissions();
              if (!granted) {
                toast.error("Camera access is required for online exams. Please allow camera and try again.");
                return;
              }
            }

            // Don't request fullscreen here — the pre-exam container will unmount
            // The useEffect watching isActiveOnlineAttempt will enter fullscreen on the exam container
            startAttempt();
          }}
          proctoring={proctoring}
        />
        <ConsentDialog
          open={showConsentDialog}
          webcamEnabled={proctoringCfg.webcam}
          onClose={() => setShowConsentDialog(false)}
          onConsent={() => {
            proctoring.giveConsent();
            setShowConsentDialog(false);
          }}
        />
      </div>
    );
  }

  const formatTime = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hrs > 0) {
      return `${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    }
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const answeredCount = Object.keys(state.answers).length;
  const totalQuestions = exam.sections?.reduce(
    (acc: number, s: any) => acc + s.questions.length,
    0
  ) || 0;

  // Header pieces, hoisted so the phone (two rows) and desktop (one row)
  // layouts below share the exact same controls instead of two copies that
  // drift apart. Only one layout is ever displayed — Tailwind `hidden` is
  // display:none, so the other is out of the accessibility tree too.
  const sectionBadge = currentSection?.title ? (
    <Badge variant="outline" className="shrink-0">{currentSection.title}</Badge>
  ) : null;

  const statusBadges = (
    <>
      {state.flaggedQuestions.size > 0 && (
        <Badge variant="secondary" className="shrink-0 gap-1">
          <Flag className="h-3 w-3 text-amber-500" />
          {state.flaggedQuestions.size}
          <span className="hidden sm:inline">flagged</span>
        </Badge>
      )}
      {violationCount > 0 && (
        <Badge variant="destructive" className="shrink-0 gap-1">
          <AlertTriangle className="h-3 w-3" />
          {violationCount} / {MAX_VIOLATIONS}
          <span className="hidden sm:inline">violations</span>
        </Badge>
      )}
    </>
  );

  const controlButtons = (
    <>
      {proctoring.isOnlineExam && proctoring.cameraStream && (
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0"
          onClick={() => setShowCameraPreview(!showCameraPreview)}
          title={showCameraPreview ? "Hide camera preview" : "Show camera preview"}
        >
          {showCameraPreview ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </Button>
      )}

      {webcamRequired && !proctoring.cameraStream && (
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 gap-1 border-destructive/50 text-destructive"
          onClick={() => proctoring.retryCamera()}
        >
          <Camera className="h-3 w-3" />
          <span className="hidden sm:inline">Retry Camera</span>
        </Button>
      )}

      {/* Manual fullscreen control stays available whenever fullscreen
          isn't being enforced, including online exams whose teacher
          turned "Fullscreen only" off. */}
      {!fullscreenEnforced && (
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0"
          onClick={toggleFullscreen}
          title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
        >
          {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
        </Button>
      )}

      {proctoring.isOnlineExam && proctoring.cameraStream && (
        <div className="flex shrink-0 items-center gap-1 text-green-600">
          <Camera className="h-4 w-4" />
          <span className="hidden text-xs sm:inline">Recording</span>
        </div>
      )}
    </>
  );

  const timerPill = (
    <div
      className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 ${
        state.remainingSeconds < 300
          ? "bg-red-100 text-red-700 dark:bg-red-950"
          : "bg-muted"
      }`}
    >
      <Clock className="h-4 w-4" />
      <span className="font-mono font-medium tabular-nums">
        {formatTime(state.remainingSeconds)}
      </span>
    </div>
  );

  const submitButton = (
    <Button
      variant="destructive"
      size="sm"
      className="shrink-0"
      onClick={() => setShowSubmitDialog(true)}
    >
      {/* Moving the title to its own row freed enough width to keep the word
          "Submit" on a phone. A red icon-only button is too ambiguous for the
          one irreversible action on this screen. */}
      <Send className="mr-2 h-4 w-4" />
      Submit
    </Button>
  );

  return (
    <div
      ref={containerRef}
      className={
        isActiveOnlineAttempt
          ? "fixed inset-0 z-[9999] bg-background overflow-auto"
          : "min-h-dvh bg-background"
      }
    >
      {/* Service-worker contract (CLAUDE.md §17): main.tsx auto-reloads on
          `controllerchange` only when no form[data-dirty="true"] exists. Without
          this marker a deploy landing mid-exam hard-reloads the student out of
          their live paper. */}
      {isActiveOnlineAttempt && !submissionComplete && (
        <form data-dirty="true" className="hidden" aria-hidden="true" />
      )}

      {/* Header with Timer */}
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        {/* Phone: TWO rows. One row could not hold the title, the section, the
            proctoring controls, the clock and Submit at 375px — the title
            collapsed to "Deerer…" and Submit clipped off the right edge.
            Row 1 carries the two things a student always needs in view (which
            exam, how long is left); row 2 carries the controls with Submit
            pinned right, under the thumb. */}
        <div className="container space-y-2 py-2 sm:hidden">
          <div className="flex items-center gap-2">
            <h1 className="min-w-0 flex-1 truncate text-base font-semibold">
              {exam.title}
            </h1>
            {timerPill}
          </div>
          <div className="flex items-center gap-2">
            {sectionBadge}
            {statusBadges}
            {controlButtons}
            <div className="ml-auto">{submitButton}</div>
          </div>
        </div>

        {/* Desktop: one row, which has always fit here. */}
        <div className="container hidden h-14 items-center justify-between gap-4 sm:flex">
          <div className="flex min-w-0 items-center gap-4">
            <h1 className="truncate font-semibold">{exam.title}</h1>
            {sectionBadge}
          </div>

          <div className="flex shrink-0 items-center gap-3">
            {statusBadges}
            {controlButtons}
            {timerPill}
            {submitButton}
          </div>
        </div>
      </header>

      <div className="container py-6">
        <div className="grid lg:grid-cols-[1fr_280px] gap-6">
          {/* Main Question Area */}
          <div className="space-y-6">
            {/* Progress Bar */}
            <div className="space-y-2">
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>Progress</span>
                <span>
                  {answeredCount} / {totalQuestions} answered
                </span>
              </div>
              <Progress value={(answeredCount / totalQuestions) * 100} />
            </div>

            {/* Question Card */}
            <Card>
              <CardHeader className="pb-4">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <span>
                        Question {(() => {
                          const questionsBeforeCurrentSection = exam.sections
                            ?.slice(0, state.currentSectionIndex)
                            .reduce((sum: number, s: any) => sum + s.questions.length, 0) || 0;
                          return questionsBeforeCurrentSection + state.currentQuestionIndex + 1;
                        })()} of {totalQuestions}
                      </span>
                      <Badge variant="secondary">
                        {currentQuestion?.marks} marks
                      </Badge>
                      {(currentQuestion?.question_type === "comprehension" || currentQuestion?.question_type === "case_study") && (
                        <Badge variant="outline">
                          {currentQuestion.question_type === "comprehension" ? "Comprehension" : "Case Study"}
                        </Badge>
                      )}
                      {currentQuestion?.question_type === "matching" && (
                        <Badge variant="outline">Match the Following</Badge>
                      )}
                    </div>
                    <CardTitle className="text-lg">
                      <MathText
                        as="div"
                        text={normalizeText(currentQuestion?.question_text || '')}
                      />
                    </CardTitle>
                    {currentQuestion?.image_url && (
                      <QuestionDiagram
                        url={currentQuestion.image_url}
                        className="mt-3"
                        lightboxContainer={containerRef.current}
                      />
                    )}
                  </div>
                  <Button
                    variant={
                      state.flaggedQuestions.has(currentQuestion?.id || "")
                        ? "default"
                        : "ghost"
                    }
                    size="icon"
                    onClick={() => {
                      if (currentQuestion) {
                        toggleFlag(currentQuestion.id);
                        telemetry.trackQuestionFlag(
                          currentQuestion.id,
                          !state.flaggedQuestions.has(currentQuestion.id)
                        );
                      }
                    }}
                  >
                    <Flag className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {/* Comprehension / Case Study */}
                {(currentQuestion?.question_type === "comprehension" || currentQuestion?.question_type === "case_study") && currentQuestion?.subQuestions?.length > 0 ? (
                  <div className="space-y-6">
                    <div className="bg-muted/50 border rounded-lg p-4">
                      <p className="text-sm font-medium text-muted-foreground mb-2">
                        {currentQuestion.question_type === "comprehension" ? "📖 Reading Passage" : "📋 Case Study"}
                      </p>
                      <MathText
                        as="div"
                        className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap"
                        text={currentQuestion.question_text}
                      />
                    </div>
                    
                    {currentQuestion.subQuestions.map((subQ: any, idx: number) => {
                      const globalQNum = (() => {
                        const questionsBeforeCurrentSection = exam.sections
                          ?.slice(0, state.currentSectionIndex)
                          .reduce((sum: number, s: any) => sum + s.questions.length, 0) || 0;
                        return questionsBeforeCurrentSection + state.currentQuestionIndex + 1;
                      })();
                      const subLabel = String.fromCharCode(97 + idx);
                      
                      return (
                        <div key={subQ.id} className="border rounded-lg p-4 space-y-3">
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary" className="text-xs">
                              Q{globalQNum}{subLabel}
                            </Badge>
                            <Badge variant="outline" className="text-xs">
                              {subQ.marks} marks
                            </Badge>
                          </div>
                          <MathText as="p" className="font-medium" text={subQ.question_text} />
                          {subQ.image_url && (
                            <QuestionDiagram
                              url={subQ.image_url}
                              label="Sub-question diagram"
                              lightboxContainer={containerRef.current}
                            />
                          )}
                          <QuestionInput
                            question={subQ}
                            answer={state.answers[subQ.id]}
                            onAnswer={(answer) => {
                              const isFirst = !state.answers[subQ.id];
                              saveAnswer(subQ.id, answer);
                              telemetry.trackAnswerChange(subQ.id, isFirst);
                            }}
                            lightboxContainer={containerRef.current}
                          />
                        </div>
                      );
                    })}
                  </div>
                ) : currentQuestion?.question_type === "matching" ? (
                  <MatchingQuestionInput
                    question={currentQuestion}
                    answer={state.answers[currentQuestion?.id || ""]}
                    onAnswer={(answer) => {
                      if (currentQuestion) {
                        const isFirst = !state.answers[currentQuestion.id];
                        saveAnswer(currentQuestion.id, answer);
                        telemetry.trackAnswerChange(currentQuestion.id, isFirst);
                      }
                    }}
                  />
                ) : (
                  <QuestionInput
                    question={currentQuestion}
                    answer={state.answers[currentQuestion?.id || ""]}
                    onAnswer={(answer) => {
                      if (currentQuestion) {
                        const isFirst = !state.answers[currentQuestion.id];
                        saveAnswer(currentQuestion.id, answer);
                        telemetry.trackAnswerChange(currentQuestion.id, isFirst);
                      }
                    }}
                    lightboxContainer={containerRef.current}
                  />
                )}
              </CardContent>
            </Card>

            {/* Navigation Buttons */}
            <div className="flex justify-between">
              <Button
                variant="outline"
                onClick={prevQuestion}
                disabled={
                  state.currentSectionIndex === 0 &&
                  state.currentQuestionIndex === 0
                }
              >
                <ChevronLeft className="h-4 w-4 mr-2" />
                Previous
              </Button>
              {isLastQuestion ? (
                <Button
                  variant="destructive"
                  onClick={() => setShowSubmitDialog(true)}
                >
                  <Send className="h-4 w-4 mr-2" />
                  Submit Exam
                </Button>
              ) : (
                <Button onClick={nextQuestion}>
                  Next
                  <ChevronRight className="h-4 w-4 ml-2" />
                </Button>
              )}
            </div>
          </div>

          {/* Question Navigator Sidebar */}
          {showNavigator && (
            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Question Navigator</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {exam.sections?.map((section: any, sIdx: number) => {
                    const questionsBeforeThisSection = exam.sections
                      ?.slice(0, sIdx)
                      .reduce((sum: number, s: any) => sum + s.questions.length, 0) || 0;
                    
                    return (
                      <div key={section.id}>
                        <p className="text-xs font-medium text-muted-foreground mb-2">
                          {section.title}
                        </p>
                        <div className="grid grid-cols-5 gap-2">
                          {section.questions.map((q: any, qIdx: number) => {
                            const globalQNumber = questionsBeforeThisSection + qIdx + 1;
                            const isAnswered = !!state.answers[q.id];
                            const isFlagged = state.flaggedQuestions.has(q.id);
                            const isCurrent =
                              sIdx === state.currentSectionIndex &&
                              qIdx === state.currentQuestionIndex;

                            return (
                              <Button
                                key={q.id}
                                variant={isCurrent ? "default" : "outline"}
                                size="sm"
                                className={`h-8 w-8 p-0 relative ${
                                  isAnswered && !isCurrent
                                    ? "bg-green-100 border-green-300 text-green-700 dark:bg-green-950 dark:border-green-800"
                                    : ""
                                }`}
                                onClick={() => goToQuestion(sIdx, qIdx)}
                              >
                                {globalQNumber}
                                {isFlagged && (
                                  <Flag className="h-2 w-2 absolute -top-1 -right-1 text-amber-500" />
                                )}
                              </Button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-center gap-2 text-sm">
                    <div className="h-4 w-4 rounded bg-green-100 border border-green-300" />
                    <span className="text-muted-foreground">Answered</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <div className="h-4 w-4 rounded bg-primary" />
                    <span className="text-muted-foreground">Current</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <div className="h-4 w-4 rounded border relative">
                      <Flag className="h-2 w-2 absolute -top-0.5 -right-0.5 text-amber-500" />
                    </div>
                    <span className="text-muted-foreground">Flagged</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Floating Camera Preview */}
          {webcamRequired && (
            <StudentCameraPreview
              cameraStream={proctoring.cameraStream}
              isOnlineExam={proctoring.isOnlineExam}
              sessionId={proctoring.session?.id || null}
              onFlag={proctoring.recordEvent}
              showPreview={showCameraPreview}
              onTogglePreview={setShowCameraPreview}
              onRetryCamera={() => proctoring.retryCamera()}
              floating
            />
          )}
        </div>
      </div>

      {/* Submit Dialog - portaled into containerRef for fullscreen visibility */}
      <AlertDialog open={showSubmitDialog} onOpenChange={setShowSubmitDialog}>
        <AlertDialogPortal container={containerRef.current ?? undefined}>
          <AlertDialogOverlay className="z-[10000]" />
          <AlertDialogPrimitive.Content
            className="fixed left-[50%] top-[50%] z-[10000] grid w-full max-w-md translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-2xl"
          >
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <Send className="h-5 w-5" />
                Submit Exam?
              </AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-4">
                  <p>Are you sure you want to submit your exam?</p>
                  
                  <div className="bg-muted p-4 rounded-lg space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-2 text-sm">
                        <CheckCircle2 className="h-4 w-4 text-green-600" />
                        Questions Attempted
                      </span>
                      <span className="font-semibold text-green-600">
                        {questionStats.answered} / {questionStats.total}
                      </span>
                    </div>
                    
                    <Separator />
                    
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-2 text-sm">
                        <XCircle className="h-4 w-4 text-muted-foreground" />
                        Not Visited
                      </span>
                      <span className="font-semibold text-muted-foreground">
                        {questionStats.notVisited}
                      </span>
                    </div>
                    
                    <Separator />
                    
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-2 text-sm">
                        <Flag className="h-4 w-4 text-amber-500" />
                        Marked for Review
                      </span>
                      <span className="font-semibold text-amber-600">
                        {questionStats.flagged}
                      </span>
                    </div>
                    
                    <Separator />
                    
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-2 text-sm">
                        <Clock className="h-4 w-4" />
                        Time Remaining
                      </span>
                      <span className={`font-mono font-semibold ${state.remainingSeconds < 300 ? 'text-red-600' : ''}`}>
                        {formatTime(state.remainingSeconds)}
                      </span>
                    </div>
                    
                    {violationCount > 0 && (
                      <>
                        <Separator />
                        <div className="flex items-center justify-between">
                          <span className="flex items-center gap-2 text-sm text-amber-600">
                            <AlertTriangle className="h-4 w-4" />
                            Violations
                          </span>
                          <span className="font-semibold text-amber-600">
                            {violationCount} / {MAX_VIOLATIONS}
                          </span>
                        </div>
                      </>
                    )}
                  </div>

                  {questionStats.answered < questionStats.total && (
                    <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 p-3 rounded-lg text-sm text-amber-800 dark:text-amber-200">
                      <strong>Warning:</strong> You have {questionStats.total - questionStats.answered} unanswered question(s).
                    </div>
                  )}

                  <p className="text-destructive text-sm">
                    This action cannot be undone. You will not be able to modify
                    your answers after submission.
                  </p>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="gap-2 sm:gap-0">
              <AlertDialogCancel>Continue Exam</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  performSubmit();
                }}
                disabled={isSubmitting}
                className="bg-destructive hover:bg-destructive/90"
              >
                {isSubmitting ? "Submitting..." : "Submit Exam"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogPrimitive.Content>
        </AlertDialogPortal>
      </AlertDialog>

      {/* Submitting overlay */}
      {showSubmittingOverlay && (
        <div className="fixed inset-0 z-[10000] bg-background/80 backdrop-blur-sm flex items-center justify-center">
          <div className="text-center space-y-4 animate-in fade-in duration-300">
            <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
            <h2 className="text-xl font-semibold text-foreground">Submitting Your Exam...</h2>
            <p className="text-muted-foreground text-sm">Saving your answers. Please do not close this window.</p>
          </div>
        </div>
      )}

      {/* Fullscreen-required overlay — blocks the exam until the student re-enters
          fullscreen via a user gesture. Browsers disallow silent re-entry.
          Skipped on Apple devices (fullscreen is not enforced there) and while a
          violation warning is on screen (its Continue button re-enters fullscreen). */}
      {fullscreenEnforced &&
        isActiveOnlineAttempt &&
        !isFullscreen &&
        activeViolation === null &&
        !showSubmittingOverlay &&
        !submissionComplete && (
          <div className="fixed inset-0 z-[10002] bg-background/95 backdrop-blur-md flex items-center justify-center p-6">
            <Card className="max-w-md w-full">
              <CardContent className="p-6 text-center space-y-4">
                <AlertTriangle className="h-12 w-12 mx-auto text-destructive" />
                <h2 className="text-xl font-semibold">Fullscreen Mode Required</h2>
                <p className="text-sm text-muted-foreground">
                  You must remain in fullscreen throughout the exam. Click below to resume.
                </p>
                <Button
                  size="lg"
                  className="w-full"
                  onClick={async () => {
                    try {
                      await requestFullscreen(containerRef.current);
                    } catch (err) {
                      console.error("Re-enter fullscreen failed:", err);
                      toast.error("Please allow fullscreen mode to continue the exam");
                    }
                  }}
                >
                  <Maximize className="h-4 w-4 mr-2" />
                  Return to Fullscreen
                </Button>
              </CardContent>
            </Card>
          </div>
        )}

      {/* Violation overlay — blocks the exam after a tab switch or fullscreen
          exit. Violations 1-2: warning that must be acknowledged. Violation 3:
          15-second pause with a final warning. Violation 4 auto-submits before
          this overlay is reached. */}
      {activeViolation !== null &&
        !showSubmittingOverlay &&
        !submissionComplete && (
          <div className="fixed inset-0 z-[10003] bg-background/95 backdrop-blur-md flex items-center justify-center p-6">
            <Card className="max-w-md w-full border-destructive/50">
              <CardContent className="p-6 space-y-4">
                <AlertTriangle className="h-12 w-12 mx-auto text-destructive" />

                {activeViolation < MAX_VIOLATIONS - 1 ? (
                  <>
                    <h2 className="text-xl font-semibold text-center">
                      Warning: Violation {activeViolation} of {MAX_VIOLATIONS}
                    </h2>
                    <p className="text-sm text-muted-foreground text-center">
                      You switched away from the exam. This activity has been
                      logged for review. After {MAX_VIOLATIONS} violations your
                      exam will be submitted automatically.
                    </p>
                    <div className="flex items-start gap-3 bg-muted p-4 rounded-lg">
                      <Checkbox
                        id="violation-ack"
                        checked={violationAckChecked}
                        onCheckedChange={(v) => setViolationAckChecked(v === true)}
                        className="mt-0.5"
                      />
                      <Label
                        htmlFor="violation-ack"
                        className="text-sm cursor-pointer leading-snug"
                      >
                        I understand. I will not do it next time.
                      </Label>
                    </div>
                    <Button
                      size="lg"
                      className="w-full"
                      disabled={!violationAckChecked}
                      onClick={resumeFromViolation}
                    >
                      Continue Exam
                    </Button>
                  </>
                ) : (
                  <>
                    <h2 className="text-xl font-semibold text-center">Exam Paused</h2>
                    <div className="bg-red-50 dark:bg-red-950/40 border border-red-300 dark:border-red-800 p-4 rounded-lg space-y-2">
                      <p className="text-sm font-semibold text-red-700 dark:text-red-300 flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 shrink-0" />
                        Final warning: Violation {activeViolation} of {MAX_VIOLATIONS}
                      </p>
                      <p className="text-sm text-red-600 dark:text-red-400">
                        If you switch tabs or leave the exam one more time, your
                        exam will be <strong>submitted automatically</strong> with
                        the answers you have saved so far.
                      </p>
                    </div>
                    {pauseRemaining !== null && pauseRemaining > 0 ? (
                      <p className="text-center text-3xl font-mono font-bold text-destructive">
                        {pauseRemaining}
                      </p>
                    ) : (
                      <Button size="lg" className="w-full" onClick={resumeFromViolation}>
                        Resume Exam
                      </Button>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        )}
    </div>
  );
}

// Pre-exam view component with enhanced permission checks
function PreExamView({
  exam,
  fullscreenEnforced,
  proctoringCfg,
  isStarting,
  onStart,
  proctoring,
}: {
  exam: any;
  fullscreenEnforced: boolean;
  proctoringCfg: ProctoringConfig;
  isStarting: boolean;
  onStart: () => void;
  proctoring: ReturnType<typeof useProctoring>;
}) {
  const [showStudyMaterial, setShowStudyMaterial] = useState(false);

  const handleStartExam = async () => {
    onStart();
  };

  return (
    <PageShell>
      <div className="flex items-center justify-center min-h-[calc(100dvh-2rem)] py-4">
      <Card className="max-w-2xl w-full surface-card frosted-shadow rounded-2xl border-0">
        <CardHeader className="text-center border-b">
          <CardTitle className="text-2xl">{exam.title}</CardTitle>
          <p className="text-muted-foreground">{exam.description}</p>
        </CardHeader>
        <CardContent className="p-6 space-y-6">
          <div className="grid sm:grid-cols-3 gap-4 text-center">
            <div className="p-4 bg-muted rounded-lg">
              <p className="text-2xl font-bold">{exam.total_marks}</p>
              <p className="text-sm text-muted-foreground">Total Marks</p>
            </div>
            <div className="p-4 bg-muted rounded-lg">
              <p className="text-2xl font-bold">{exam.duration_minutes}</p>
              <p className="text-sm text-muted-foreground">Minutes</p>
            </div>
            <div className="p-4 bg-muted rounded-lg">
              <p className="text-2xl font-bold">
                {exam.sections?.reduce(
                  (acc: number, s: any) => acc + s.questions.length,
                  0
                )}
              </p>
              <p className="text-sm text-muted-foreground">Questions</p>
            </div>
          </div>

          {exam.study_materials?.length > 0 && (
            <div className="border border-green-200 bg-green-50 dark:bg-green-950/30 p-4 rounded-lg">
              <div className="flex items-start gap-3">
                <BookOpen className="h-5 w-5 text-green-600 mt-0.5" />
                <div className="flex-1">
                  <h4 className="font-medium text-green-900 dark:text-green-100">
                    Study Material Available
                  </h4>
                  <p className="text-sm text-green-700 dark:text-green-300 mt-1">
                    Review the linked study material before starting the exam.
                  </p>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="mt-2"
                    onClick={() => setShowStudyMaterial(!showStudyMaterial)}
                  >
                    {showStudyMaterial ? "Hide" : "View"} Study Material
                  </Button>
                  {showStudyMaterial && (
                    <div className="mt-3 space-y-2">
                      {exam.study_materials.map((material: any) => (
                        <a 
                          key={material.id}
                          href={material.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block text-sm text-primary hover:underline"
                        >
                          {material.title}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {exam.instructions && (
            <div className="space-y-2">
              <h3 className="font-semibold">Instructions</h3>
              <div className="prose prose-sm dark:prose-invert max-w-none bg-muted p-4 rounded-lg">
                {exam.instructions}
              </div>
            </div>
          )}

          {exam.exam_mode === "online" && (
            <div className="border border-blue-200 bg-blue-50 dark:bg-blue-950/30 p-4 rounded-lg">
              <div className="flex items-start gap-3">
                <Shield className="h-5 w-5 text-blue-600 mt-0.5" />
                <div className="flex-1">
                  <h4 className="font-medium text-blue-900 dark:text-blue-100">
                    Proctoring Enabled - Permission Required
                  </h4>
                  <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
                    This is a proctored online exam. Please ensure you grant the required permissions.
                  </p>
                  
                  <div className="mt-3 space-y-2">
                    {proctoringCfg.webcam && (
                      <>
                        <div className="flex items-center gap-2 text-sm">
                          <Camera className="h-4 w-4 text-blue-600" />
                          <span className="text-blue-700">
                            Camera Access (granted on start)
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-sm">
                          <Mic className="h-4 w-4 text-blue-600" />
                          <span className="text-blue-700">
                            Microphone Access (granted on start)
                          </span>
                        </div>
                      </>
                    )}
                    {fullscreenEnforced && (
                      <div className="flex items-center gap-2 text-sm">
                        <Monitor className="h-4 w-4 text-blue-600" />
                        <span className="text-blue-700">Fullscreen Mode (Auto-enabled)</span>
                      </div>
                    )}
                  </div>

                  <div className="mt-3 pt-3 border-t border-blue-200">
                    <p className="text-xs text-blue-600 font-medium mb-1">During the exam:</p>
                    <ul className="text-xs text-blue-600 space-y-0.5">
                      <li>• Right-click is disabled</li>
                      <li>• Tab switching is monitored</li>
                      {proctoringCfg.webcam && (
                        <li>• Your live camera preview will be visible</li>
                      )}
                      {proctoringCfg.copyPasteDisable && (
                        <li>• Copy and paste are disabled</li>
                      )}
                      {proctoringCfg.tabSwitchLock && (
                        <li className="text-red-600 font-medium">
                          • Switching tabs or leaving the exam is a violation: 2
                          warnings, then a 15-second pause, then your exam is
                          submitted automatically on the 4th violation
                        </li>
                      )}
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          )}

          <Button
            size="lg"
            className="w-full"
            onClick={handleStartExam}
            disabled={isStarting}
          >
            {isStarting ? "Starting..." : "Start Exam"}
          </Button>
        </CardContent>
      </Card>
      </div>
    </PageShell>
  );
}

function ConsentDialog({
  open,
  webcamEnabled,
  onClose,
  onConsent,
}: {
  open: boolean;
  webcamEnabled: boolean;
  onClose: () => void;
  onConsent: () => void;
}) {
  return (
    <MobileSheet
      open={open}
      onOpenChange={(o) => { if (!o) onClose(); }}
      title="Proctoring Consent Required"
      subtitle="This online exam requires proctoring for academic integrity."
      icon={<Shield className="h-5 w-5" />}
      primaryAction={{ label: "I Consent", onClick: onConsent }}
      secondaryAction={{ label: "Cancel", onClick: onClose }}
    >
      <div className="space-y-4">
        <p className="text-sm">By proceeding, you consent to:</p>
        <ul className="text-sm space-y-2">
          {webcamEnabled && (
            <li className="flex items-start gap-2">
              <Camera className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
              <span>Camera access for identity verification</span>
            </li>
          )}
          <li className="flex items-start gap-2">
            <Circle className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
            <span>Monitoring of tab switches and window focus</span>
          </li>
          <li className="flex items-start gap-2">
            <Circle className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
            <span>Recording of suspicious activities for review</span>
          </li>
        </ul>
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 p-3 rounded-lg">
          <p className="text-sm text-amber-800 dark:text-amber-200">
            <strong>Note:</strong> Suspicious activities are flagged for teacher
            review. Repeatedly switching tabs or leaving the exam will submit
            your exam automatically after 4 violations.
          </p>
        </div>
      </div>
    </MobileSheet>
  );
}

function QuestionInput({
  question,
  answer,
  onAnswer,
  lightboxContainer,
}: {
  question: any;
  answer?: { text?: string; options?: any };
  onAnswer: (answer: { text?: string; options?: any }) => void;
  /**
   * The attempt's fullscreen container. An active online attempt is
   * `fixed inset-0 z-[9999]` (and the real fullscreen element on Android), so
   * any modal must portal INTO it, as the Submit dialog does; a body-level
   * dialog opens behind the exam and freezes the page.
   */
  lightboxContainer?: HTMLElement | null;
}) {
  if (!question) return null;

  switch (question.question_type) {
    case "mcq": {
      const mcqOptions = (question.options as DisplayOption[] | null) ?? [];

      // When the options carry pictures, the picture is usually the answer
      // ("Which is the similar image?" with options A/B/C/D). That cannot be
      // answered from thumbnails, so it gets the large image-choice grid.
      if (hasOptionImages(mcqOptions)) {
        return (
          <div role="radiogroup" aria-label="Answer options">
            <OptionChoiceGrid
              options={mcqOptions}
              value={answer?.options?.selected ?? null}
              onSelect={(optionId) => onAnswer({ options: { selected: optionId } })}
              lightboxContainer={lightboxContainer}
            />
          </div>
        );
      }

      return (
        <RadioGroup
          value={answer?.options?.selected || ""}
          onValueChange={(value) => onAnswer({ options: { selected: value } })}
          className="space-y-3"
        >
          {mcqOptions.map((opt, idx) => (
            <div key={opt.id ?? idx} className="flex items-center gap-3">
              <RadioGroupItem value={opt.id || opt.text || String(idx)} id={`opt-${idx}`} />
              <Label htmlFor={`opt-${idx}`} className="min-w-0 flex-1 cursor-pointer">
                <MathText text={opt.text ?? ""} />
              </Label>
            </div>
          ))}
        </RadioGroup>
      );
    }

    case "true_false":
      return (
        <RadioGroup
          value={answer?.options?.selected || ""}
          onValueChange={(value) => onAnswer({ options: { selected: value } })}
          className="space-y-3"
        >
          <div className="flex items-center space-x-3">
            <RadioGroupItem value="true" id="true" />
            <Label htmlFor="true" className="cursor-pointer">
              True
            </Label>
          </div>
          <div className="flex items-center space-x-3">
            <RadioGroupItem value="false" id="false" />
            <Label htmlFor="false" className="cursor-pointer">
              False
            </Label>
          </div>
        </RadioGroup>
      );

    case "short_answer":
      return (
        <Textarea
          placeholder="Type your answer here..."
          value={answer?.text || ""}
          onChange={(e) => onAnswer({ text: e.target.value })}
          className="min-h-[100px]"
        />
      );

    case "long_answer":
      return (
        <Textarea
          placeholder="Type your detailed answer here..."
          value={answer?.text || ""}
          onChange={(e) => onAnswer({ text: e.target.value })}
          className="min-h-[200px]"
        />
      );

    case "fill_blank":
      return (
        <Textarea
          placeholder="Fill in the blank..."
          value={answer?.text || ""}
          onChange={(e) => onAnswer({ text: e.target.value })}
          className="min-h-[60px]"
        />
      );

    default:
      return (
        <Textarea
          placeholder="Type your answer here..."
          value={answer?.text || ""}
          onChange={(e) => onAnswer({ text: e.target.value })}
          className="min-h-[100px]"
        />
      );
  }
}

function MatchingQuestionInput({
  question,
  answer,
  onAnswer,
}: {
  question: any;
  answer?: { text?: string; options?: any };
  onAnswer: (answer: { text?: string; options?: any }) => void;
}) {
  const matchingData = question?.options;
  const columnA = matchingData?.columnA || [];
  const columnB = matchingData?.columnB || [];
  
  const currentMatches = answer?.options?.matches || {};
  
  const handleMatch = (colAItem: string, colBItem: string) => {
    const newMatches = { ...currentMatches, [colAItem]: colBItem };
    onAnswer({ options: { matches: newMatches } });
  };
  
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground font-medium">Match items from Column A with Column B:</p>
      <div className="grid grid-cols-1 gap-3">
        {columnA.map((itemA: string, idx: number) => (
          <div key={idx} className="flex items-center gap-4 p-3 border rounded-lg bg-muted/30">
            <div className="flex-1 font-medium text-sm">
              <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs mr-2">
                {idx + 1}
              </span>
              <MathText text={itemA} />
            </div>
            <Select
              value={currentMatches[itemA] || ""}
              onValueChange={(v) => handleMatch(itemA, v)}
            >
              <SelectTrigger className="w-48 h-9">
                <SelectValue placeholder="-- Select --" />
              </SelectTrigger>
              <SelectContent>
                {columnB.map((itemB: string, bIdx: number) => (
                  <SelectItem key={bIdx} value={itemB}>
                    <span className="inline-flex items-center gap-1">
                      {String.fromCharCode(65 + bIdx)}.
                      <MathText as="span" text={itemB} />
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>
      
      <div className="border rounded-lg p-3 bg-muted/20">
        <p className="text-xs font-medium text-muted-foreground mb-2">Column B Options:</p>
        <div className="flex flex-wrap gap-2">
          {columnB.map((itemB: string, idx: number) => (
            <Badge key={idx} variant="outline" className="text-xs">
              {String.fromCharCode(65 + idx)}. <MathText text={itemB} />
            </Badge>
          ))}
        </div>
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="min-h-dvh bg-background p-6">
      <div className="container">
        <Skeleton className="h-14 w-full mb-6" />
        <div className="grid lg:grid-cols-[1fr_280px] gap-6">
          <div className="space-y-6">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
          <Skeleton className="h-96" />
        </div>
      </div>
    </div>
  );
}
