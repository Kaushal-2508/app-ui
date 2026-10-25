import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAutoBadgeAward } from "./useAutoBadgeAward";
import { useAuth } from "./useAuth";

interface ExamQuestion {
  id: string;
  question_text: string;
  question_type: string;
  marks: number;
  options: any;
  section_id: string;
  parent_question_id?: string | null;
  image_url?: string | null;
  subQuestions?: ExamQuestion[];
}

interface ExamSection {
  id: string;
  title: string;
  description: string | null;
  instructions: string | null;
  section_order: number;
  questions: ExamQuestion[];
}

interface AttemptState {
  attemptId: string | null;
  currentSectionIndex: number;
  currentQuestionIndex: number;
  answers: Record<string, { text?: string; options?: any }>;
  flaggedQuestions: Set<string>;
  startedAt: Date | null;
  remainingSeconds: number;
}

const AUTOSAVE_DEBOUNCE_MS = 1500;

export function useExamAttempt(examId: string, classId: string) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { checkAndAwardBadges } = useAutoBadgeAward();

  const [state, setState] = useState<AttemptState>({
    attemptId: null,
    currentSectionIndex: 0,
    currentQuestionIndex: 0,
    answers: {},
    flaggedQuestions: new Set(),
    startedAt: null,
    remainingSeconds: 0,
  });

  // ── Autosave infrastructure ──────────────────────────────────────────
  // Track which question IDs have unsaved (dirty) answers
  const dirtyQuestions = useRef<Set<string>>(new Set());
  // Debounce timer for autosave
  const autosaveTimer = useRef<NodeJS.Timeout | null>(null);
  // Promise that resolves when the current autosave batch finishes
  const activeSavePromise = useRef<Promise<void> | null>(null);
  // Stable ref for attemptId so callbacks always see the latest value
  const attemptIdRef = useRef<string | null>(null);
  // Stable ref for answers
  const answersRef = useRef<Record<string, { text?: string; options?: any }>>({});

  // Keep refs in sync
  useEffect(() => { attemptIdRef.current = state.attemptId; }, [state.attemptId]);
  useEffect(() => { answersRef.current = state.answers; }, [state.answers]);

  // Fetch exam details
  const { data: exam, isLoading: examLoading } = useQuery({
    queryKey: ["exam-attempt", examId],
    queryFn: async () => {
      const { data: examData, error: examError } = await supabase
        .from("exams")
        .select("*, duration_minutes, total_marks, instructions")
        .eq("id", examId)
        .single();

      if (examError) throw examError;

      // Sanitized paper via RPC — exam_questions carries the ANSWER KEY
      // (options[].is_correct, correct_answer, explanation). The previous
      // exam_sections.select("*, exam_questions(*)") shipped that key to
      // every student's browser during a live exam (readable in DevTools).
      // get_exam_paper (migration 20260707130000) returns the paper with
      // key material stripped, in one round trip instead of two.
      const { data: paper, error: sectionsError } = await supabase.rpc("get_exam_paper", {
        _exam_id: examId,
      });

      if (sectionsError) throw sectionsError;

      type PaperQuestion = ExamQuestion & {
        question_order: number;
        parent_question_id: string | null;
      };
      type PaperSection = {
        id: string;
        exam_id: string;
        title: string;
        description: string | null;
        instructions: string | null;
        section_order: number;
        total_marks: number | null;
        exam_questions: PaperQuestion[];
      };
      const sections = (paper ?? []) as unknown as PaperSection[];

      return {
        ...examData,
        sections: sections.map((s) => {
          const allQuestions = [...(s.exam_questions ?? [])].sort(
            (a, b) => a.question_order - b.question_order
          );

          const parentQuestions: ExamQuestion[] = [];
          const childMap = new Map<string, ExamQuestion[]>();

          for (const q of allQuestions) {
            if (q.parent_question_id) {
              const children = childMap.get(q.parent_question_id) || [];
              children.push(q);
              childMap.set(q.parent_question_id, children);
            } else {
              parentQuestions.push(q);
            }
          }

          for (const parent of parentQuestions) {
            const children = childMap.get(parent.id);
            if (children) {
              parent.subQuestions = children;
            }
          }

          return { ...s, questions: parentQuestions };
        }),
      };
    },
  });

  // ── Core save function (saves one question, returns success boolean) ─
  const saveOneAnswer = useCallback(async (questionId: string, answer: { text?: string; options?: any }): Promise<boolean> => {
    const aId = attemptIdRef.current;
    if (!aId) return false;
    try {
      const { error } = await supabase.rpc("save_exam_answer", {
        _attempt_id: aId,
        _question_id: questionId,
        _answer_text: answer.text || null,
        _answer_options: answer.options || null,
      });
      if (error) {
        console.error(`[Autosave] Failed ${questionId}:`, error.message);
        return false;
      }
      return true;
    } catch (e: any) {
      console.error(`[Autosave] Exception ${questionId}:`, e?.message);
      return false;
    }
  }, []);

  // ── Flush dirty answers (batched, sequential 3-at-a-time) ────────────
  const flushDirtyAnswers = useCallback(async () => {
    const ids = Array.from(dirtyQuestions.current);
    if (ids.length === 0) return;
    // Clear the dirty set immediately so new edits during flush get re-queued
    dirtyQuestions.current = new Set();
    const answers = answersRef.current;

    console.log(`[Autosave] Flushing ${ids.length} dirty answers`);
    const BATCH = 3;
    let saved = 0;
    const failedIds: string[] = [];
    for (let i = 0; i < ids.length; i += BATCH) {
      const batch = ids.slice(i, i + BATCH);
      const results = await Promise.all(
        batch.map((qId) => saveOneAnswer(qId, answers[qId] || {}))
      );
      results.forEach((ok, idx) => {
        if (ok) saved++;
        else failedIds.push(batch[idx]);
      });
    }
    if (failedIds.length > 0) {
      // Re-queue failures so the next flush (or submit's final pass) retries
      // them. Without this, a transient save failure was silently dropped
      // from tracking — which is why submit used to blind-resave EVERY answer.
      for (const qId of failedIds) dirtyQuestions.current.add(qId);
      console.warn(`[Autosave] ${failedIds.length}/${ids.length} saves failed; re-queued`);
    } else {
      console.log(`[Autosave] All ${saved} answers saved`);
    }
  }, [saveOneAnswer]);

  // ── Schedule debounced autosave ──────────────────────────────────────
  const scheduleAutosave = useCallback(() => {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      const p = flushDirtyAnswers();
      activeSavePromise.current = p;
      p.finally(() => {
        if (activeSavePromise.current === p) activeSavePromise.current = null;
      });
    }, AUTOSAVE_DEBOUNCE_MS);
  }, [flushDirtyAnswers]);

  /**
   * Seconds left, straight from the server.
   *
   * NEVER reseed the timer from `duration_minutes` on the client. That is what
   * let a student press Back, re-enter, and receive a fresh full-length clock
   * on the same attempt — unlimited time on a timed exam. start_exam_attempt
   * returns the existing attempt and leaves `started_at` alone, so the elapsed
   * time is always recoverable; the client just has to ask for it.
   *
   * Server-side arithmetic also means winding the device clock back gains
   * nothing.
   */
  const fetchRemainingSeconds = useCallback(async (attemptId: string): Promise<number> => {
    const { data, error } = await supabase.rpc("exam_attempt_remaining_seconds", {
      _attempt_id: attemptId,
    });
    if (error) throw error;
    return Math.max(0, Number(data ?? 0));
  }, []);

  // Start attempt mutation
  const startAttempt = useMutation({
    mutationFn: async () => {
      console.log("Starting exam attempt for exam:", examId, "class:", classId);
      const { data, error } = await supabase.rpc("start_exam_attempt", {
        _exam_id: examId,
        _class_id: classId,
      });
      if (error) {
        console.error("Failed to start exam attempt:", error);
        throw error;
      }
      const attemptId = data as unknown as string;
      console.log("Exam attempt started successfully, attemptId:", attemptId);

      // Resolve the clock before the attempt UI mounts, so the student never
      // sees a full-duration timer flash on a resumed attempt.
      const remainingSeconds = await fetchRemainingSeconds(attemptId);
      return { attemptId, remainingSeconds };
    },
    onSuccess: ({ attemptId, remainingSeconds }) => {
      setState((prev) => ({
        ...prev,
        attemptId,
        startedAt: new Date(),
        remainingSeconds,
      }));
      // A resumed attempt is not a fresh start; say so rather than claiming the
      // exam just began with a clock that is already part-spent.
      const resumed = remainingSeconds < (exam?.duration_minutes || 60) * 60 - 5;
      toast.success(resumed ? "Resuming your exam" : "Exam started successfully!");
    },
    onError: (error: any) => {
      console.error("Start attempt error:", error);
      toast.error(error.message || "Failed to start exam");
    },
  });

  // ── Submit attempt mutation ──────────────────────────────────────────
  const submitAttempt = useMutation({
    mutationFn: async (autoSubmit: boolean = false) => {
      if (!state.attemptId) throw new Error("No active attempt");

      // Phase 1: Refresh auth session
      console.log("[Submit] Phase 1: Refreshing auth session...");
      const { error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError) {
        console.warn("[Submit] Session refresh failed, trying getSession:", refreshError);
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError || !sessionData.session) {
          throw new Error("SESSION_EXPIRED");
        }
      }
      console.log("[Submit] Auth session valid");

      // Phase 2: Cancel pending debounced autosave and drain active save
      console.log("[Submit] Phase 2: Draining in-flight autosaves...");
      if (autosaveTimer.current) {
        clearTimeout(autosaveTimer.current);
        autosaveTimer.current = null;
      }
      // Wait for any in-flight save batch to complete
      if (activeSavePromise.current) {
        try { await activeSavePromise.current; } catch { /* ignore */ }
      }
      console.log("[Submit] In-flight autosaves drained");

      // Phase 3: Final save pass — ONLY answers still marked dirty. Autosave
      // already persisted everything else (failed saves are re-queued into
      // dirtyQuestions by flushDirtyAnswers). The previous code blind-resaved
      // EVERY answer here: a 100-question exam fired ~100 RPCs per student at
      // submit — at an exam-window close with 2-3K concurrent students that's
      // a 200-300K RPC thundering herd on the DB (§23).
      const answersNow = answersRef.current;
      const dirtyIds = Array.from(dirtyQuestions.current).filter((qId) => answersNow[qId]);
      console.log(`[Submit] Phase 3: Final save of ${dirtyIds.length} unsaved answers`);
      const BATCH = 3;
      let saved = 0;
      const failedIds: string[] = [];
      for (let i = 0; i < dirtyIds.length; i += BATCH) {
        const batch = dirtyIds.slice(i, i + BATCH);
        const results = await Promise.all(
          batch.map((qId) => saveOneAnswer(qId, answersNow[qId] || {}))
        );
        results.forEach((ok, idx) => {
          if (ok) {
            saved++;
            dirtyQuestions.current.delete(batch[idx]);
          } else {
            failedIds.push(batch[idx]);
          }
        });
      }
      console.log(`[Submit] Final save complete: ${saved} saved, ${failedIds.length} failed out of ${dirtyIds.length}`);

      // A manual submit with unsaved answers must not silently proceed — the
      // student can retry while their answers are still held locally. Timer
      // auto-submit stays best-effort: blocking it would strand the attempt.
      if (failedIds.length > 0 && !autoSubmit) {
        throw new Error(
          "Some answers could not be saved. Check your connection and press Submit again."
        );
      }

      // Phase 4: Submit the attempt
      console.log("[Submit] Phase 4: Calling submit_exam_attempt RPC...");
      const { data, error } = await supabase.rpc("submit_exam_attempt", {
        _attempt_id: state.attemptId,
        _auto_submit: autoSubmit,
      });

      if (error) {
        console.error("[Submit] RPC error:", error);
        throw error;
      }
      console.log("[Submit] RPC success:", data);
      return data as boolean;
    },
    onSuccess: () => {
      toast.success("Exam submitted successfully!");
      queryClient.invalidateQueries({ queryKey: ["student-exams"] });

      // Fire-and-forget badge awarding
      if (user?.id && exam?.institution_id) {
        checkAndAwardBadges(
          user.id,
          exam.institution_id,
          "exam_completed",
          { examId, attemptId: state.attemptId }
        ).catch((error) => console.error("Error checking badges:", error));
      }
    },
    onError: (error: any) => {
      console.error("[Submit] Mutation error:", error);
      toast.error("Failed to submit exam: " + error.message);
    },
  });

  // Navigation helpers
  const goToQuestion = useCallback((sectionIndex: number, questionIndex: number) => {
    setState((prev) => ({
      ...prev,
      currentSectionIndex: sectionIndex,
      currentQuestionIndex: questionIndex,
    }));
  }, []);

  const nextQuestion = useCallback(() => {
    if (!exam) return;

    const currentSection = exam.sections[state.currentSectionIndex];
    if (state.currentQuestionIndex < currentSection.questions.length - 1) {
      setState((prev) => ({
        ...prev,
        currentQuestionIndex: prev.currentQuestionIndex + 1,
      }));
    } else if (state.currentSectionIndex < exam.sections.length - 1) {
      setState((prev) => ({
        ...prev,
        currentSectionIndex: prev.currentSectionIndex + 1,
        currentQuestionIndex: 0,
      }));
    }
  }, [exam, state.currentSectionIndex, state.currentQuestionIndex]);

  const prevQuestion = useCallback(() => {
    if (!exam) return;

    if (state.currentQuestionIndex > 0) {
      setState((prev) => ({
        ...prev,
        currentQuestionIndex: prev.currentQuestionIndex - 1,
      }));
    } else if (state.currentSectionIndex > 0) {
      const prevSection = exam.sections[state.currentSectionIndex - 1];
      setState((prev) => ({
        ...prev,
        currentSectionIndex: prev.currentSectionIndex - 1,
        currentQuestionIndex: prevSection.questions.length - 1,
      }));
    }
  }, [exam, state.currentSectionIndex, state.currentQuestionIndex]);

  const toggleFlag = useCallback((questionId: string) => {
    setState((prev) => {
      const newFlagged = new Set(prev.flaggedQuestions);
      if (newFlagged.has(questionId)) {
        newFlagged.delete(questionId);
      } else {
        newFlagged.add(questionId);
      }
      return { ...prev, flaggedQuestions: newFlagged };
    });
  }, []);

  // ── updateAnswer: update local state + mark dirty + schedule autosave ─
  const updateAnswer = useCallback(
    (questionId: string, answer: { text?: string; options?: any }) => {
      setState((prev) => ({
        ...prev,
        answers: { ...prev.answers, [questionId]: answer },
      }));
      dirtyQuestions.current.add(questionId);
      scheduleAutosave();
    },
    [scheduleAutosave]
  );

  // ── Immediate save for non-text answers (MCQ, radio, checkbox) ───────
  const saveAnswerImmediate = useCallback(
    (questionId: string, answer: { text?: string; options?: any }) => {
      setState((prev) => ({
        ...prev,
        answers: { ...prev.answers, [questionId]: answer },
      }));
      // For option-based answers, save immediately (no debounce)
      if (answer.options) {
        dirtyQuestions.current.delete(questionId);
        saveOneAnswer(questionId, answer);
      } else {
        dirtyQuestions.current.add(questionId);
        scheduleAutosave();
      }
    },
    [saveOneAnswer, scheduleAutosave]
  );

  // Session keep-alive during exam (refresh every 10 minutes)
  useEffect(() => {
    if (!state.attemptId) return;
    const interval = setInterval(async () => {
      console.log("Session keep-alive: refreshing auth session...");
      const { error } = await supabase.auth.refreshSession();
      if (error) console.warn("Session keep-alive refresh failed:", error);
      else console.log("Session keep-alive: refreshed successfully");
    }, 10 * 60 * 1000);
    return () => clearInterval(interval);
  }, [state.attemptId]);

  // Latest auto-submit, held in a ref so the clock re-sync effect below can
  // fire it without depending on the mutation object.
  const autoSubmitRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    autoSubmitRef.current = () => submitAttempt.mutate(true);
  }, [submitAttempt]);

  // Timer countdown. Local ticking only for smoothness — the server is the
  // authority and re-syncs below.
  useEffect(() => {
    if (!state.attemptId || state.remainingSeconds <= 0) return;

    const timer = setInterval(() => {
      setState((prev) => {
        const newRemaining = prev.remainingSeconds - 1;
        if (newRemaining <= 0) {
          submitAttempt.mutate(true);
          clearInterval(timer);
        }
        return { ...prev, remainingSeconds: newRemaining };
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [state.attemptId]);

  /**
   * Re-anchor the clock on the server periodically, and whenever the tab is
   * brought back to the foreground.
   *
   * The 1s interval above is not trustworthy on its own: browsers throttle
   * timers in background tabs (so a backgrounded exam would UNDER-count and
   * hand back time), and the device clock can be changed mid-exam. Re-reading
   * the server value keeps the displayed timer honest either way.
   *
   * 60s poll — justified per CLAUDE.md §23: this is one lightweight scalar read
   * per student per minute, and it is the mechanism that stops a timed exam
   * from being extended indefinitely.
   */
  useEffect(() => {
    const attemptId = state.attemptId;
    if (!attemptId) return;

    let cancelled = false;

    const resync = async () => {
      try {
        const remaining = await fetchRemainingSeconds(attemptId);
        if (cancelled) return;
        setState((prev) => {
          // Only correct a meaningful divergence, so the visible countdown
          // doesn't stutter every minute on normal clock drift.
          if (Math.abs(prev.remainingSeconds - remaining) < 3) return prev;
          return { ...prev, remainingSeconds: remaining };
        });
        // Via a ref, so this effect does not have to depend on the mutation
        // object and re-create its interval on every render.
        if (!cancelled && remaining <= 0) autoSubmitRef.current?.();
      } catch (e) {
        // A failed re-sync must never grant time or submit the paper; keep
        // counting locally and try again next tick.
        console.warn("[examAttempt] clock re-sync failed:", e);
      }
    };

    const interval = setInterval(resync, 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") resync();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [state.attemptId, fetchRemainingSeconds]);

  // Current question data
  const currentSection = exam?.sections?.[state.currentSectionIndex];
  const currentQuestion = currentSection?.questions?.[state.currentQuestionIndex];

  return {
    exam,
    state,
    currentSection,
    currentQuestion,
    isLoading: examLoading,
    isStarting: startAttempt.isPending,
    isSubmitting: submitAttempt.isPending,
    startAttempt: () => startAttempt.mutate(),
    saveAnswer: saveAnswerImmediate,
    submitAttempt: (autoSubmit = false) => submitAttempt.mutate(autoSubmit),
    submitAttemptAsync: (autoSubmit = false) => submitAttempt.mutateAsync(autoSubmit),
    resetSubmit: () => submitAttempt.reset(),
    goToQuestion,
    nextQuestion,
    prevQuestion,
    toggleFlag,
  };
}
