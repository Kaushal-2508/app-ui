import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  Loader2,
  Lock,
  Send,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
import { MathText } from "@/components/ui/math-text";
import {
  useHybridEvaluationData,
  useFlatHybridQuestions,
  useUpsertHybridMark,
  useInsertHybridAnnotation,
  useDeleteHybridAnnotation,
  useClearAnnotationsForQuestion,
  usePublishHybridMarks,
  useRotateHybridPage,
  type AnnotationType,
  type AnnotationCoordinates,
} from "@/hooks/useHybridEvaluation";
import {
  HybridPaperViewer,
  type ArmedStamp,
  type StampQuestion,
} from "@/components/hybrid/HybridPaperViewer";
import { FeedbackDictationField } from "@/components/hybrid/FeedbackDictationField";
import { MobileSheet } from "@/components/shared/sheets";
import { useHybridSnapshots } from "@/hooks/useHybridSnapshots";
import { buildMarkSteps, maxSelectableForActive } from "@/lib/hybridMarks";
import { cn } from "@/lib/utils";

// Default pen color — classic red teacher pen (swappable from the toolbar).
const DEFAULT_PEN_COLOR = "#DC2626";

interface MarkDraft {
  marks: string;
  comment: string;
}

/**
 * Guided one-question-at-a-time marking. Left: the answer sheet with three
 * pen tools. Right: the current question, its marks buttons, feedback, and
 * Previous/Next — ending in an explicit review-and-publish dialog.
 */
export default function HybridEvaluatePage() {
  const navigate = useNavigate();
  const { attemptId } = useParams<{ attemptId: string }>();

  const data = useHybridEvaluationData(attemptId);
  const snapshots = useHybridSnapshots(attemptId);
  const flatQuestions = useFlatHybridQuestions(data.exam);

  const upsertMark = useUpsertHybridMark();
  const insertAnnotation = useInsertHybridAnnotation();
  const deleteAnnotation = useDeleteHybridAnnotation();
  const clearAnnotations = useClearAnnotationsForQuestion();
  const publishMarks = usePublishHybridMarks();
  const rotatePage = useRotateHybridPage();

  // Student identity for the header. profiles has ONLY full_name — never
  // select first_name/last_name (those columns don't exist; the select errors).
  const studentQuery = useQuery({
    queryKey: ["hybrid-eval-student", data.attempt?.student_id],
    enabled: !!data.attempt?.student_id,
    staleTime: 300_000,
    retry: 1,
    queryFn: async (): Promise<{
      full_name: string | null;
      roll_number: string | null;
      admission_number: string | null;
    } | null> => {
      const { data: row, error } = await supabase
        .from("profiles")
        .select("full_name, roll_number, admission_number")
        .eq("id", data.attempt!.student_id)
        .maybeSingle();
      if (error) throw error;
      return row ?? null;
    },
  });
  const studentName = studentQuery.data?.full_name ?? "Student";
  // Roll + admission alongside the name so the marker can tie the sheet in
  // front of them to the right student. Either may legitimately be unset.
  const studentIdLine = [
    studentQuery.data?.roll_number ? `Roll ${studentQuery.data.roll_number}` : null,
    studentQuery.data?.admission_number
      ? `Adm ${studentQuery.data.admission_number}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  // ── Question steps ───────────────────────────────────────────────────
  const gradeableQuestions = useMemo(
    () => flatQuestions.filter((q) => q.marks > 0),
    [flatQuestions],
  );

  // Accordion: the expanded question is the active one (pen tools + stamps
  // bind to it). Expand the first question once the list loads — a ref, not
  // a null-check effect, so collapsing everything stays collapsed.
  const [expandedQuestionId, setExpandedQuestionId] = useState<string | null>(null);
  const didInitExpand = useRef(false);
  useEffect(() => {
    if (!didInitExpand.current && gradeableQuestions.length > 0) {
      didInitExpand.current = true;
      setExpandedQuestionId(gradeableQuestions[0].id);
    }
  }, [gradeableQuestions]);
  const activeQuestionId = expandedQuestionId;

  const [activeTool, setActiveTool] = useState<AnnotationType | null>(null);
  const [activeColor, setActiveColor] = useState<string>(DEFAULT_PEN_COLOR);
  // Marks-stamp tool: armed = the question+marks waiting to be clicked onto
  // the sheet. Arming clears the pen tool and vice versa.
  const [armedStamp, setArmedStamp] = useState<ArmedStamp | null>(null);
  const handleToolChange = (tool: AnnotationType | null) => {
    setActiveTool(tool);
    if (tool) setArmedStamp(null);
  };
  const handleArmStamp = (stamp: ArmedStamp | null) => {
    setArmedStamp(stamp);
    if (stamp) setActiveTool(null);
  };

  // ── Per-question mark draft (uncommitted edits) with debounced upsert ─
  const [drafts, setDrafts] = useState<Record<string, MarkDraft>>({});

  // Latest drafts, read inside the debounced save below (the timer must not
  // close over a stale `drafts` — updateDraft schedules it synchronously before
  // the re-render, so the closure value is one edit behind / empty on a fresh attempt).
  const draftsRef = useRef<Record<string, MarkDraft>>(drafts);
  draftsRef.current = drafts;

  useEffect(() => {
    // Nothing persisted yet — also avoids the new-[]-each-render loop while the
    // marks query is loading (data.marks is a fresh [] on every render then).
    if (data.marks.length === 0) return;
    setDrafts((prev) => {
      let changed = false;
      const next = { ...prev };
      data.marks.forEach((m) => {
        if (!next[m.question_id]) {
          next[m.question_id] = {
            marks:
              m.marks_awarded === null || m.marks_awarded === undefined
                ? ""
                : String(m.marks_awarded),
            comment: m.teacher_comment ?? "",
          };
          changed = true;
        }
      });
      // Return the SAME ref when nothing was added so setDrafts bails and can't
      // drive a re-render → effect → setDrafts loop.
      return changed ? next : prev;
    });
  }, [data.marks]);

  const debounceTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  useEffect(() => {
    const timers = debounceTimers.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, []);

  const scheduleSave = useCallback(
    (questionId: string) => {
      const existing = debounceTimers.current.get(questionId);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        if (!data.attempt) return;
        const draft = draftsRef.current[questionId];
        if (!draft) return;
        const meta = flatQuestions.find((q) => q.id === questionId);
        if (!meta) return;
        const marksAwarded = draft.marks.trim() === "" ? null : Number(draft.marks);
        if (marksAwarded !== null && !Number.isFinite(marksAwarded)) return;
        if (marksAwarded !== null && (marksAwarded < 0 || marksAwarded > meta.marks)) return;
        upsertMark.mutate({
          attemptId: data.attempt.id,
          questionId,
          marksAwarded,
          maxMarks: meta.marks,
          institutionId: data.attempt.institution_id,
          teacherComment: draft.comment.trim() ? draft.comment.trim() : null,
        });
      }, 500);
      debounceTimers.current.set(questionId, timer);
    },
    [flatQuestions, data.attempt, upsertMark],
  );

  const updateDraft = (questionId: string, patch: Partial<MarkDraft>) => {
    setDrafts((prev) => ({
      ...prev,
      [questionId]: {
        marks: patch.marks ?? prev[questionId]?.marks ?? "",
        comment: patch.comment ?? prev[questionId]?.comment ?? "",
      },
    }));
    scheduleSave(questionId);
  };

  // ── Annotation handlers ──────────────────────────────────────────────
  const handleCreateAnnotation = (args: {
    pageNumber: number;
    pageId: string | null;
    annotationType: AnnotationType;
    coordinates: AnnotationCoordinates;
    color: string;
    textContent?: string | null;
  }) => {
    if (!data.attempt || !activeQuestionId) return;
    insertAnnotation.mutate({
      attemptId: data.attempt.id,
      institutionId: data.attempt.institution_id,
      questionId: activeQuestionId,
      pageId: args.pageId,
      pageNumber: args.pageNumber,
      annotationType: args.annotationType,
      coordinates: args.coordinates,
      color: args.color,
      textContent: args.textContent ?? null,
    });
  };

  const handleDeleteAnnotation = (id: string) => {
    if (!data.attempt) return;
    deleteAnnotation.mutate({ id, attemptId: data.attempt.id });
  };

  const handleClearForQuestion = () => {
    if (!data.attempt || !activeQuestionId) return;
    clearAnnotations.mutate({
      attemptId: data.attempt.id,
      questionId: activeQuestionId,
    });
  };

  // ── Totals + readiness ────────────────────────────────────────────────
  const totals = useMemo(() => {
    let awarded = 0;
    let max = 0;
    let marked = 0;
    gradeableQuestions.forEach((q) => {
      const draft = drafts[q.id];
      max += q.marks;
      if (draft && draft.marks.trim() !== "" && Number.isFinite(Number(draft.marks))) {
        awarded += Number(draft.marks);
        marked += 1;
      }
    });
    return { awarded, max, marked, total: gradeableQuestions.length };
  }, [gradeableQuestions, drafts]);

  const examTotal = data.exam?.total_marks || totals.max;

  // Per-question data for the Marks stamp picker (steps + total-cap per
  // question, and the current mark so the picker mirrors the panel).
  const stampQuestions = useMemo<StampQuestion[]>(
    () =>
      gradeableQuestions.map((q) => {
        const d = drafts[q.id];
        const current =
          d && d.marks.trim() !== "" && Number.isFinite(Number(d.marks))
            ? Number(d.marks)
            : null;
        const awardedExcluding = Math.max(0, totals.awarded - (current ?? 0));
        return {
          id: q.id,
          number: q.questionNumber,
          max: q.marks,
          current,
          steps: buildMarkSteps(q.marks),
          cap: maxSelectableForActive(q.marks, examTotal, awardedExcluding),
        };
      }),
    [gradeableQuestions, drafts, totals.awarded, examTotal],
  );

  // Per-question feedback (live, from drafts) → the ⓘ tooltip on marks stamps.
  const questionNotes = useMemo<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    Object.entries(drafts).forEach(([qid, d]) => {
      if (d.comment.trim() !== "") out[qid] = d.comment.trim();
    });
    return out;
  }, [drafts]);

  const handlePlaceStamp = (args: {
    pageNumber: number;
    pageId: string | null;
    x: number;
    y: number;
  }) => {
    if (!data.attempt || !armedStamp || isLocked) return;
    const { questionId, marks, label } = armedStamp;
    // One marks stamp per question — placing a new one replaces the old.
    data.annotations
      .filter(
        (a) => a.annotation_type === "marks_stamp" && a.question_id === questionId,
      )
      .forEach((a) =>
        deleteAnnotation.mutate({ id: a.id, attemptId: data.attempt!.id }),
      );
    insertAnnotation.mutate({
      attemptId: data.attempt.id,
      institutionId: data.attempt.institution_id,
      questionId,
      pageId: args.pageId,
      pageNumber: args.pageNumber,
      annotationType: "marks_stamp",
      coordinates: { x: args.x, y: args.y },
      color: activeColor,
      textContent: label,
    });
    // Stamping IS grading: record the mark and sync the panel to that question.
    updateDraft(questionId, { marks: String(marks) });
    setExpandedQuestionId(questionId);
    setArmedStamp(null);
  };

  const canPublish =
    totals.total > 0 &&
    totals.marked === totals.total &&
    data.attempt?.status !== "evaluated";

  const isLocked = data.attempt?.status === "evaluated";
  const [publishOpen, setPublishOpen] = useState(false);
  // Phone only: the marking panel lives in a bottom sheet so the answer sheet
  // itself can use the full screen.
  const [markingSheetOpen, setMarkingSheetOpen] = useState(false);
  const handleConfirmPublish = async () => {
    if (!attemptId) return;
    setPublishOpen(false);
    try {
      await publishMarks.mutateAsync({ attemptId });
    } catch {
      /* toastError handled inside */
    }
  };

  const markedPct =
    totals.total > 0 ? Math.round((totals.marked / totals.total) * 100) : 0;

  const isMarked = (questionId: string) => {
    const d = drafts[questionId];
    return !!d && d.marks.trim() !== "" && Number.isFinite(Number(d.marks));
  };

  // ── Render ───────────────────────────────────────────────────────────
  if (data.isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (data.isError || !data.attempt || !data.exam) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-4">
        <Card className="max-w-md">
          <CardContent className="p-6 text-center">
            <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-destructive" />
            <h2 className="mb-2 text-lg font-semibold">Couldn't load the attempt</h2>
            <p className="mb-4 text-sm text-muted-foreground">
              The hybrid attempt you're looking for doesn't exist or you don't have access.
            </p>
            <Button onClick={() => navigate(-1)}>Go back</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  /**
   * The question list with its marks buttons and feedback field.
   *
   * Built once and rendered in TWO places: the desktop right-hand column, and
   * the phone bottom sheet. Marking is the same job on both, so it must not be
   * two implementations that drift apart.
   */
  // A render FUNCTION, not a stored element: the panel is mounted twice on a
  // phone (the desktop aside is display:none but still in the DOM, and the
  // sheet renders it again), so element ids must differ per copy or the
  // feedback <label htmlFor> binds to the hidden aside's textarea and tapping
  // the label on a phone focuses nothing.
  const renderMarkingPanel = (idPrefix: string) => (
    <>
      {isLocked && (
        <div className="mb-5 flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-500/10 p-3 text-xs text-emerald-700">
          <Lock className="h-4 w-4 shrink-0" />
          Marks are published. This attempt is read-only.
        </div>
      )}

      {gradeableQuestions.length === 0 ? (
        <div className="rounded-lg border border-border bg-background p-4 text-center text-sm text-muted-foreground">
          This exam has no markable questions.
        </div>
      ) : (
        <div className="space-y-2.5">
          {gradeableQuestions.map((q, i) => {
            const sq = stampQuestions[i];
            const draft = drafts[q.id] ?? { marks: "", comment: "" };
            const marked = isMarked(q.id);
            const isExpanded = q.id === expandedQuestionId;
            return (
              <div
                key={q.id}
                className={cn(
                  "overflow-hidden rounded-xl border bg-background transition-colors",
                  isExpanded ? "border-primary/50" : "border-border",
                )}
              >
                {/* Card header — click to expand/collapse */}
                <button
                  type="button"
                  onClick={() =>
                    setExpandedQuestionId(isExpanded ? null : q.id)
                  }
                  className="flex w-full items-center gap-2.5 px-3.5 py-3 text-left hover:bg-muted/40"
                >
                  <span
                    className={cn(
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
                      marked
                        ? "bg-emerald-500/15 text-emerald-600"
                        : "border border-border text-transparent",
                    )}
                  >
                    <Check className="h-3 w-3" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                    {q.questionNumber}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums",
                      marked
                        ? "bg-emerald-500/10 text-emerald-700"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {marked
                      ? `${draft.marks} / ${q.marks}`
                      : `${q.marks} mark${q.marks === 1 ? "" : "s"}`}
                  </span>
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                      isExpanded && "rotate-180",
                    )}
                  />
                </button>

                {/* Expanded body */}
                {isExpanded && (
                  <div className="border-t border-border/60 px-3.5 py-3.5">
                    <MathText
                      as="p"
                      text={q.questionText}
                      className="block text-sm leading-relaxed text-muted-foreground"
                    />

                    <div className="mt-4 flex items-baseline justify-between gap-2">
                      <span className="text-sm font-semibold text-foreground">
                        Marks
                      </span>
                      {marked && !isLocked && (
                        <button
                          type="button"
                          onClick={() => updateDraft(q.id, { marks: "" })}
                          className="text-[11px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                        >
                          Remove mark
                        </button>
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(sq?.steps ?? []).map((s) => {
                        const isSelected =
                          sq?.current !== null &&
                          sq !== undefined &&
                          Math.abs((sq.current as number) - s) < 1e-9;
                        const isBlocked = sq ? s > sq.cap + 1e-9 : false;
                        return (
                          <button
                            key={s}
                            type="button"
                            disabled={isLocked || (isBlocked && !isSelected)}
                            onClick={() =>
                              updateDraft(q.id, { marks: String(s) })
                            }
                            title={
                              isBlocked && !isSelected
                                ? "This would push the total past the exam's maximum"
                                : `Give ${s} mark${s === 1 ? "" : "s"}`
                            }
                            className={cn(
                              "h-11 min-w-[52px] rounded-lg border px-3 text-sm font-bold tabular-nums transition-colors",
                              isSelected
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border bg-card text-foreground hover:border-primary/50",
                              "disabled:cursor-not-allowed disabled:opacity-40",
                            )}
                          >
                            {s}
                          </button>
                        );
                      })}
                    </div>
                    <p className="mt-1.5 text-[11px] text-muted-foreground">
                      Tap a number. It saves on its own.
                    </p>

                    <FeedbackDictationField
                      id={`${idPrefix}-${q.id}`}
                      value={draft.comment}
                      onChange={(next) =>
                        updateDraft(q.id, { comment: next })
                      }
                      disabled={isLocked}
                      placeholder="A note the student will see with their result"
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {(snapshots.data?.length ?? 0) > 0 && (
        <div className="mt-4 border-t border-border/60 pt-3">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs text-muted-foreground"
              >
                <Camera className="mr-1.5 h-3.5 w-3.5" />
                Proctoring photos ({snapshots.data!.length})
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80" align="start">
              <div className="mb-2 text-xs font-semibold text-foreground">
                Webcam photos taken during the exam
              </div>
              <div className="grid max-h-64 grid-cols-3 gap-2 overflow-y-auto">
                {snapshots.data!.map((s) => (
                  <img
                    key={s.id}
                    src={s.signed_url}
                    alt={`Snapshot ${new Date(s.captured_at).toLocaleTimeString()}`}
                    title={new Date(s.captured_at).toLocaleTimeString()}
                    className="aspect-[4/3] w-full rounded border border-border object-cover"
                  />
                ))}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      )}
    </>
  );

  const unmarkedCount = gradeableQuestions.filter((q) => !isMarked(q.id)).length;

  // The pen tools and the marks stamp are bound to the EXPANDED question
  // (activeQuestionId === expandedQuestionId). On desktop the accordion is
  // always on screen so the teacher can see which one that is. On a phone the
  // panel is closed while they draw, so the bar has to say it, and has to say
  // when nothing is selected: with no active question every pen tool is
  // disabled and the sheet shows every question's ink at once.
  const activeQuestion = gradeableQuestions.find((q) => q.id === activeQuestionId);
  const activeQuestionMark = activeQuestion
    ? drafts[activeQuestion.id]?.marks
    : undefined;

  return (
    <>
      {/* One layout for every width. Phones get the sheet full-bleed with the
          marking panel in a bottom sheet; from lg up the panel is a permanent
          column. This page used to refuse to render below 1024px at all, which
          meant a teacher with only a phone could not mark anything. */}
      {/* Height must be the viewport MINUS the chrome this page sits inside.
          ProtectedRoute wraps every page in AppLayout, which has a 61px sticky
          app bar and a <main className="flex-1 p-3 sm:p-4 md:p-6">. A plain
          h-screen therefore overflowed by the bar plus the padding, which on a
          phone pushed the marking bar below the fold. dvh, not vh, so the
          mobile browser's collapsing address bar doesn't clip it either. */}
      <div className="flex min-h-0 flex-col bg-background h-[calc(100dvh-var(--app-bar-height)-1.5rem)] sm:h-[calc(100dvh-var(--app-bar-height)-2rem)] md:h-[calc(100dvh-var(--app-bar-height)-3rem)]">
        {/* ── Header ─────────────────────────────────────────────────── */}
        <header className="border-b border-border bg-card">
          {/* ONE row, even at 375px. Every pixel here is taken from the answer
              sheet, which is the thing the teacher actually has to read. The
              exam title is dropped on phones (they arrived from that exam and
              the paper is on screen) and the score pill shrinks, which buys
              enough width to keep the name and Publish side by side. */}
          <div className="flex items-center gap-2 px-2 py-1.5 sm:gap-3 sm:px-4 sm:py-2.5">
            <div className="flex min-w-0 flex-1 items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => navigate(-1)}
                title="Back"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold leading-tight text-foreground">
                  {studentName}
                  {studentIdLine && (
                    <span className="ml-1.5 font-normal text-muted-foreground">
                      {studentIdLine}
                    </span>
                  )}
                </div>
                <div className="hidden truncate text-[11px] leading-tight text-muted-foreground sm:block">
                  {data.exam.title}
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2 sm:gap-3">
              <span
                className="rounded-md border border-border bg-background px-1.5 py-0.5 text-xs font-bold tabular-nums text-foreground sm:rounded-lg sm:px-2.5 sm:py-1 sm:text-sm"
                title={`Marks given so far: ${totals.awarded} out of ${examTotal}`}
              >
                {totals.awarded} / {examTotal}
              </span>
              {isLocked ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-700">
                  <Lock className="h-3 w-3" />
                  Published
                </span>
              ) : (
                <Button
                  size="sm"
                  disabled={!canPublish || publishMarks.isPending}
                  onClick={() => setPublishOpen(true)}
                  title={
                    canPublish
                      ? "Check the marks and send them to the student"
                      : "Mark every question first"
                  }
                >
                  <Send className="mr-1.5 h-3.5 w-3.5" />
                  {publishMarks.isPending ? "Publishing…" : "Publish"}
                </Button>
              )}
            </div>
          </div>
          <div className="h-0.5 w-full bg-muted">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${markedPct}%` }}
            />
          </div>
        </header>

        {/* ── Body ───────────────────────────────────────────────────── */}
        {/* Single column on a phone (sheet only, marking lives in the bottom
            sheet); the permanent 380px marking column appears from lg up. */}
        <div className="grid flex-1 min-h-0 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px]">
          {/* LEFT — the answer sheet */}
          <main className="flex min-h-0 flex-col border-r border-border bg-background">
            {data.pages.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
                <AlertTriangle className="h-8 w-8 text-amber-500" />
                <p className="max-w-md">
                  No sheets have been uploaded for this attempt yet. The student
                  needs to finish their phone upload before you can mark.
                </p>
              </div>
            ) : (
              <HybridPaperViewer
                pages={data.pages}
                annotations={data.annotations}
                activeQuestionId={activeQuestionId}
                activeTool={activeTool}
                activeColor={activeColor}
                isLocked={isLocked}
                onToolChange={handleToolChange}
                onColorChange={setActiveColor}
                onClearQuestion={handleClearForQuestion}
                marksTool={{
                  questions: stampQuestions,
                  armed: armedStamp,
                  onArm: handleArmStamp,
                  onPlace: handlePlaceStamp,
                }}
                questionNotes={questionNotes}
                onCreateAnnotation={handleCreateAnnotation}
                onDeleteAnnotation={handleDeleteAnnotation}
                onRotatePage={
                  data.attempt
                    ? ({ pageId, nextRotation }) =>
                        rotatePage.mutate({
                          pageId,
                          nextRotation,
                          attemptId: data.attempt!.id,
                        })
                    : undefined
                }
              />
            )}
          </main>

          {/* RIGHT - the marking panel, a permanent column from lg up. On a
              phone the same panel is rendered inside the bottom sheet below. */}
          <aside className="hidden min-h-0 flex-col bg-card lg:flex">
            <div className="flex-1 overflow-y-auto px-6 py-5">{renderMarkingPanel("hybrid-feedback")}</div>
          </aside>
        </div>

        {/* Phone marking bar. The sheet needs the whole screen to be readable,
            so the marking panel is one tap away instead of squeezed beside it.
            data-sticky-bottom keeps MobileFab clear of it. */}
        {gradeableQuestions.length > 0 && (
          <div
            data-sticky-bottom
            className="shrink-0 border-t border-border bg-card px-3 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] lg:hidden"
          >
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-foreground">
                  {activeQuestion ? (
                    <>
                      {activeQuestion.questionNumber}
                      <span className="ml-1.5 font-normal tabular-nums text-muted-foreground">
                        {activeQuestionMark ? `${activeQuestionMark} / ` : ""}
                        {activeQuestion.marks}
                      </span>
                    </>
                  ) : (
                    <span className="text-amber-600">No question selected</span>
                  )}
                </div>
                <div className="truncate text-[11px] text-muted-foreground">
                  {!activeQuestion
                    ? "Pick a question to turn the pen tools on"
                    : `${totals.awarded} / ${examTotal} · ${
                        unmarkedCount === 0
                          ? isLocked
                            ? "published"
                            : "ready to publish"
                          : `${unmarkedCount} left`
                      }`}
                </div>
              </div>
              <Button
                size="sm"
                variant={unmarkedCount === 0 ? "outline" : "default"}
                className="h-10 shrink-0"
                onClick={() => setMarkingSheetOpen(true)}
              >
                {isLocked ? "View marks" : "Mark questions"}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Phone marking sheet: the SAME panel the desktop column renders. */}
      <MobileSheet
        open={markingSheetOpen}
        onOpenChange={setMarkingSheetOpen}
        title={isLocked ? "Marks" : "Mark questions"}
        subtitle={`${studentName} · ${totals.awarded} / ${examTotal}`}
        secondaryAction={{ label: "Done", onClick: () => setMarkingSheetOpen(false) }}
      >
        {renderMarkingPanel("hybrid-feedback-sheet")}
      </MobileSheet>

      {/* Review & publish */}
      <AlertDialog open={publishOpen} onOpenChange={setPublishOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Publish marks to {studentName}?</AlertDialogTitle>
            <AlertDialogDescription>
              Check the marks one last time. The student will be notified and
              can see the marked sheet on their results page. You can re-open
              and re-publish later if needed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="max-h-48 overflow-y-auto rounded-lg border border-border">
            {gradeableQuestions.map((q) => (
              <div
                key={q.id}
                className="flex items-center justify-between border-b border-border/50 px-3 py-1.5 text-sm last:border-b-0"
              >
                <span className="font-medium text-foreground">
                  {q.questionNumber}
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {drafts[q.id]?.marks ?? "N/A"} / {q.marks}
                </span>
              </div>
            ))}
            <div className="flex items-center justify-between bg-muted/40 px-3 py-2 text-sm font-bold">
              <span>Total</span>
              <span className="tabular-nums">
                {totals.awarded} / {examTotal}
              </span>
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep marking</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmPublish}>
              <CheckCircle2 className="mr-1.5 h-4 w-4" />
              Publish marks
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
