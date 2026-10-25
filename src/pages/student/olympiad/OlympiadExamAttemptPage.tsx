import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/shared/page/PageShell";
import {
  requestFullscreen,
  exitFullscreen,
  getFullscreenElement,
  onFullscreenChange,
  isFullscreenSupported,
} from "@/lib/fullscreen";
import { onAppStateChange, useIsOnline } from "@/lib/native";
import { useOlympiadStudentDashboard } from "@/hooks/olympiad/useOlympiadStudentDashboard";
import { useOlympiadStartAttempt } from "@/hooks/olympiad/useOlympiadStartAttempt";
import { useOlympiadAttemptState } from "@/hooks/olympiad/useOlympiadAttemptState";
import { useOlympiadAttemptQuestions, type AttemptQuestion } from "@/hooks/olympiad/useOlympiadAttemptQuestions";
import { useOlympiadSaveAnswer } from "@/hooks/olympiad/useOlympiadSaveAnswer";
import { useOlympiadSubmitAttempt, type SubmitReason } from "@/hooks/olympiad/useOlympiadSubmitAttempt";
import { useOlympiadRecordEvent } from "@/hooks/olympiad/useOlympiadRecordEvent";
import { ExamSubjectTabs } from "@/components/olympiad/exam/ExamSubjectTabs";
import { QuestionNavGrid } from "@/components/olympiad/exam/QuestionNavGrid";
import { QuestionDisplay } from "@/components/olympiad/exam/QuestionDisplay";
import { ExamTimer } from "@/components/olympiad/exam/ExamTimer";
import { SubmitConfirmDialog } from "@/components/olympiad/exam/SubmitConfirmDialog";
import { ProctoringWarningDialog } from "@/components/olympiad/exam/ProctoringWarningDialog";
import { DisconnectBanner } from "@/components/olympiad/exam/DisconnectBanner";

export default function OlympiadExamAttemptPage() {
  const navigate = useNavigate();
  const { data: dashboardCtx } = useOlympiadStudentDashboard();
  const startAttempt = useOlympiadStartAttempt();
  const saveAnswer = useOlympiadSaveAnswer();
  const submitAttempt = useOlympiadSubmitAttempt();
  const recordEvent = useOlympiadRecordEvent();

  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [activeSubjectId, setActiveSubjectId] = useState<string | null>(null);
  const [activePosition, setActivePosition] = useState(1);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [violationWarning, setViolationWarning] = useState<number | null>(null);
  // Connectivity through the native adapter: a WebView's navigator.onLine is
  // unreliable, so the app shell substitutes the OS network plugin.
  const online = useIsOnline();
  const offline = !online;

  // Local question state (mirrors server, updated optimistically + saved via debounced RPC)
  const [localQuestions, setLocalQuestions] = useState<AttemptQuestion[]>([]);
  const saveTimers = useRef<Map<string, number>>(new Map());

  const submittedRef = useRef(false);
  const lastSyncAt = useRef(Date.now());

  // 1. Start or resume attempt on mount
  useEffect(() => {
    if (!dashboardCtx?.ok) return;
    if (attemptId) return;
    startAttempt.mutate(undefined, {
      onSuccess: (data) => {
        setAttemptId(data.attempt_id);
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboardCtx, attemptId]);

  const { data: attemptState } = useOlympiadAttemptState(attemptId ?? undefined);
  const { data: serverQuestions, isLoading: questionsLoading } = useOlympiadAttemptQuestions(attemptId ?? undefined);

  // Sync questions from server into local state once
  useEffect(() => {
    if (serverQuestions && serverQuestions.length > 0 && localQuestions.length === 0) {
      setLocalQuestions(serverQuestions);
      // Default to first subject
      if (!activeSubjectId) setActiveSubjectId(serverQuestions[0].subject_id);
    }
  }, [serverQuestions, localQuestions.length, activeSubjectId]);

  // Sync the lastSyncAt ref on state refresh
  useEffect(() => {
    if (attemptState) {
      lastSyncAt.current = Date.now();
    }
  }, [attemptState]);

  const subjects = useMemo(() => {
    if (!dashboardCtx?.ok) return [];
    return dashboardCtx.subjects;
  }, [dashboardCtx]);

  const currentSubjectQuestions = useMemo(() => {
    if (!activeSubjectId) return [];
    return localQuestions.filter((q) => q.subject_id === activeSubjectId);
  }, [localQuestions, activeSubjectId]);

  const currentQuestion = useMemo(() => {
    return currentSubjectQuestions.find((q) => q.position === activePosition) ?? null;
  }, [currentSubjectQuestions, activePosition]);

  // 2. Redirect on completed attempt
  useEffect(() => {
    if (attemptState && attemptState.status !== "in_progress") {
      navigate("/student/olympiad/exam/submitted", { replace: true });
    }
  }, [attemptState, navigate]);

  // 3. Activate fullscreen on entry (silent fallback on iOS)
  useEffect(() => {
    if (!isFullscreenSupported()) return;
    requestFullscreen(document.documentElement);
    return () => {
      exitFullscreen();
    };
  }, []);

  // 4. Proctoring: fullscreen change
  useEffect(() => {
    if (!isFullscreenSupported() || !attemptId) return;
    const off = onFullscreenChange(() => {
      if (!getFullscreenElement() && !submittedRef.current) {
        recordEvent.mutate(
          { attempt_id: attemptId, event_type: "proctoring_violation_fullscreen" },
          {
            onSuccess: (data) => {
              if (data.total_violations && data.total_violations >= 3) {
                doAutoSubmit("violations_exceeded");
              } else if (data.total_violations) {
                setViolationWarning(data.total_violations);
              }
            },
          }
        );
      }
    });
    return () => off?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptId]);

  // 5. Proctoring: tab switch
  useEffect(() => {
    if (!attemptId) return;
    const handler = () => {
      if (!submittedRef.current) {
        recordEvent.mutate(
          { attempt_id: attemptId, event_type: "proctoring_violation_tab_switch" },
          {
            onSuccess: (data) => {
              if (data.total_violations && data.total_violations >= 3) {
                doAutoSubmit("violations_exceeded");
              } else if (data.total_violations) {
                setViolationWarning(data.total_violations);
              }
            },
          }
        );
      }
    };
    // Through the native adapter (web: visibilitychange; app shell: the OS
    // app-state event). Focus changes were never a violation here.
    return onAppStateChange((active, source) => {
      if (source === "focus" || active) return;
      handler();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptId]);

  // 6. Online / offline tracking: record each transition, not the initial
  // state (the first render is not a reconnect).
  const wasOnlineRef = useRef(online);
  useEffect(() => {
    if (wasOnlineRef.current === online) return;
    wasOnlineRef.current = online;
    if (attemptId) {
      recordEvent.mutate({ attempt_id: attemptId, event_type: online ? "reconnect" : "disconnect" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, attemptId]);

  // 7. Auto-submit on timer expiry or proctoring violation
  const doAutoSubmit = (reason: SubmitReason) => {
    if (submittedRef.current || !attemptId) return;
    submittedRef.current = true;
    submitAttempt.mutate(
      { attempt_id: attemptId, reason },
      { onSuccess: () => navigate("/student/olympiad/exam/submitted", { replace: true }) }
    );
  };

  // 8. Answer save with debounce
  const saveAnswerDebounced = (
    snapshotId: string,
    payload: { selected: "A" | "B" | "C" | "D" | null; marked: boolean; time_spent: number }
  ) => {
    if (!attemptId) return;
    const existing = saveTimers.current.get(snapshotId);
    if (existing) window.clearTimeout(existing);
    const t = window.setTimeout(() => {
      saveAnswer.mutate({
        attempt_id: attemptId,
        snapshot_id: snapshotId,
        ...payload,
      });
      saveTimers.current.delete(snapshotId);
    }, 500);
    saveTimers.current.set(snapshotId, t);
  };

  const onAnswerChange = (
    snapshotId: string,
    selected: "A" | "B" | "C" | "D" | null,
    marked: boolean
  ) => {
    setLocalQuestions((prev) =>
      prev.map((q) =>
        q.snapshot_id === snapshotId ? { ...q, selected_answer: selected, marked_for_review: marked } : q
      )
    );
    const q = localQuestions.find((x) => x.snapshot_id === snapshotId);
    if (!q) return;
    saveAnswerDebounced(snapshotId, {
      selected,
      marked,
      time_spent: q.time_spent_seconds + 5, // crude — increments per save
    });
  };

  // Cleanup save timers on unmount
  useEffect(() => {
    const timers = saveTimers.current;
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, []);

  const onSubjectChange = (subjectId: string) => {
    if (subjectId === activeSubjectId) return;
    setActiveSubjectId(subjectId);
    setActivePosition(1);
    if (attemptId) {
      recordEvent.mutate({ attempt_id: attemptId, event_type: "section_switch", payload: { to_subject: subjectId } });
    }
  };

  if (!dashboardCtx?.ok || !attemptId || questionsLoading || !currentQuestion || !attemptState) {
    return (
      <PageShell>
        <div className="flex flex-col items-center justify-center py-24 gap-3">
          <Loader2 className="h-6 w-6 animate-spin text-brand-primary" />
          <p className="text-sm text-ink-600">Loading exam&hellip;</p>
        </div>
      </PageShell>
    );
  }

  const totalAnswered = localQuestions.filter((q) => q.selected_answer !== null).length;

  return (
    <div data-dirty="true" className="min-h-dvh surface-gradient">
      <DisconnectBanner offline={offline} />
      <header className="sticky top-0 z-10 surface-card frosted-shadow px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0 overflow-hidden">
          <ExamSubjectTabs
            subjects={subjects}
            questions={localQuestions}
            activeSubjectId={activeSubjectId ?? subjects[0].id}
            onSubjectChange={onSubjectChange}
          />
        </div>
        <ExamTimer
          serverRemainingSeconds={attemptState.remaining_seconds}
          lastSyncAt={lastSyncAt.current}
          onExpired={() => doAutoSubmit("timer_zero")}
        />
        <Button onClick={() => setSubmitOpen(true)} className="flex-shrink-0">
          <Send className="h-4 w-4 mr-1" />
          Submit
        </Button>
      </header>

      <main className="max-w-6xl mx-auto p-4 sm:p-6 grid lg:grid-cols-[1fr,300px] gap-6">
        <section>
          <QuestionDisplay
            key={currentQuestion.snapshot_id}
            question={currentQuestion}
            onAnswerChange={(selected, marked) =>
              onAnswerChange(currentQuestion.snapshot_id, selected, marked)
            }
            onPrev={activePosition > 1 ? () => setActivePosition(activePosition - 1) : undefined}
            onNext={activePosition < currentSubjectQuestions.length ? () => setActivePosition(activePosition + 1) : undefined}
            onSubmit={() => setSubmitOpen(true)}
          />
        </section>

        <aside className="lg:sticky lg:top-24 lg:self-start surface-card frosted-shadow rounded-card p-4">
          <p className="eyebrow mb-3">Questions</p>
          <QuestionNavGrid
            questions={currentSubjectQuestions}
            activePosition={activePosition}
            onSelect={setActivePosition}
          />
        </aside>
      </main>

      <SubmitConfirmDialog
        open={submitOpen}
        onOpenChange={setSubmitOpen}
        answeredCount={totalAnswered}
        totalCount={localQuestions.length}
        onConfirm={async () => {
          if (submittedRef.current) return;
          submittedRef.current = true;
          await submitAttempt.mutateAsync({ attempt_id: attemptId, reason: "manual" });
          navigate("/student/olympiad/exam/submitted", { replace: true });
        }}
      />

      <ProctoringWarningDialog
        open={violationWarning !== null && violationWarning < 3}
        violations={violationWarning ?? 0}
        onAcknowledge={() => setViolationWarning(null)}
      />
    </div>
  );
}
