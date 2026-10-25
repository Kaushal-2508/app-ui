import { useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Download,
  Loader2,
  MessageSquare,
  RefreshCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { saveBlob } from "@/lib/native";
import {
  useHybridEvaluationData,
  useFlatHybridQuestions,
} from "@/hooks/useHybridEvaluation";
import { HybridPaperViewer } from "@/components/hybrid/HybridPaperViewer";
import { ResultClassComparison } from "@/components/student/ResultClassComparison";

/** Matches the section labels on the standard result page so the two read as one product. */
function SectionHeading({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </h2>
      {hint && <span className="text-[11px] text-muted-foreground/70">{hint}</span>}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}

export default function HybridResultViewPage() {
  const navigate = useNavigate();
  const { attemptId } = useParams<{ attemptId: string }>();
  // Student result view: sanitized paper (no answer key, no direct exam_questions read).
  const data = useHybridEvaluationData(attemptId, { sanitized: true });
  const flatQuestions = useFlatHybridQuestions(data.exam);
  const printableRef = useRef<HTMLDivElement | null>(null);

  const handleDownloadPdf = async () => {
    if (!printableRef.current) return;
    try {
      const mod = await import("html2pdf.js");
      const html2pdf = (mod as unknown as { default: (el: HTMLElement) => { set: (opts: Record<string, unknown>) => unknown } }).default;
      const filename =
        `${(data.exam?.title ?? "hybrid-exam").replace(/[^a-z0-9-_]+/gi, "_")}_result.pdf`;
      const builder = html2pdf(printableRef.current);
      const opts = {
        margin: 10,
        filename,
        image: { type: "jpeg", quality: 0.95 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      };
      // html2pdf chains: .set(opts).outputPdf("blob"); delivery goes through
      // saveBlob so the native shell can swap in a share sheet in one place.
      const chain = (builder.set(opts) as unknown as {
        outputPdf: (type: "blob") => Promise<Blob>;
      });
      const blob = await chain.outputPdf("blob");
      saveBlob(blob, filename);
    } catch {
      toast.error("Couldn't generate the PDF. Try again in a moment.");
    }
  };

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
            <h2 className="mb-2 text-lg font-semibold">Couldn't load the result</h2>
            <p className="mb-4 text-sm text-muted-foreground">
              The hybrid attempt you're looking for doesn't exist or isn't ready yet.
            </p>
            <Button onClick={() => navigate("/student/results")}>Back to results</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (data.attempt.status !== "evaluated") {
    return (
      <div className="flex min-h-dvh items-center justify-center p-4">
        <Card className="max-w-md">
          <CardContent className="p-6 text-center">
            <Loader2 className="mx-auto mb-3 h-10 w-10 animate-spin text-primary" />
            <h2 className="mb-2 text-lg font-semibold">Still being marked</h2>
            <p className="mb-4 text-sm text-muted-foreground">
              Your teacher hasn't finished marking this attempt yet. Check back shortly.
            </p>
            <Button onClick={() => navigate("/student/results")}>Back to results</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const gradeable = flatQuestions.filter((q) => q.marks > 0);
  const marksByQuestion = new Map(data.marks.map((m) => [m.question_id, m]));
  // Teacher feedback per question → the ⓘ tooltip on marks stamps on the sheet.
  const questionNotes: Record<string, string> = {};
  data.marks.forEach((m) => {
    if (m.teacher_comment && m.teacher_comment.trim() !== "") {
      questionNotes[m.question_id] = m.teacher_comment.trim();
    }
  });
  const totalAwarded = data.attempt.total_marks_awarded ?? 0;
  const totalMax = data.attempt.total_max_marks ?? 0;
  const percent = totalMax > 0 ? (Number(totalAwarded) / Number(totalMax)) * 100 : 0;

  const gradedCount = gradeable.length;
  const fullMarksCount = gradeable.filter((q) => {
    const awarded = marksByQuestion.get(q.id)?.marks_awarded;
    return awarded != null && q.marks > 0 && Number(awarded) >= q.marks;
  }).length;

  return (
    <div className="min-h-dvh bg-background">
      {/* Header mirrors the standard result page: identity on the left, and the
          recheck action in the top-right corner. */}
      <header className="border-b border-border bg-card px-4 py-3 md:px-6">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="Back to results"
              onClick={() => navigate("/student/results")}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-foreground md:text-base">
                {data.exam.title}
              </div>
              <div className="text-[11px] text-muted-foreground">Hybrid exam</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="outline" onClick={handleDownloadPdf}>
              <Download className="mr-1.5 h-3.5 w-3.5" />
              Download PDF
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => navigate("/student/rechecks")}
            >
              <RefreshCcw className="mr-1.5 h-3.5 w-3.5" />
              Request recheck
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
        {/* Section 1 — Exam details */}
        <section className="space-y-3">
          <SectionHeading label="Exam details" />
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm md:p-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Your score
                </p>
                <p className="mt-1 text-4xl font-bold leading-none tabular-nums text-foreground">
                  {percent.toFixed(1)}%
                </p>
              </div>
              <p className="text-sm tabular-nums text-muted-foreground">
                {Number(totalAwarded).toFixed(2)} / {Number(totalMax).toFixed(2)} marks
              </p>
            </div>
            <Progress value={percent} className="mt-4 h-2" />

            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Fact label="Delivery" value="Hybrid (written on paper)" />
              <Fact label="Questions" value={String(gradedCount)} />
              <Fact
                label="Marked on"
                value={
                  data.attempt.evaluated_at
                    ? new Date(data.attempt.evaluated_at).toLocaleDateString()
                    : "N/A"
                }
              />
              <Fact label="Full marks" value={`${fullMarksCount}/${gradedCount}`} />
            </div>
          </div>
        </section>

        {/* Section 2 — Performance. The class sits this exam too, so the same
            comparison the other exam types get applies here; it just reads from
            the hybrid plane's own aggregate RPC. */}
        <section className="space-y-3">
          <SectionHeading label="Performance" hint="Compared with your class" />
          <ResultClassComparison attemptId={attemptId} source="hybrid" />
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm md:p-5">
            <p className="text-sm text-muted-foreground">
              Your teacher marked {gradedCount} question{gradedCount === 1 ? "" : "s"} on this
              paper, awarding full marks on {fullMarksCount}. Open the marked sheet below to see
              the annotations and any comments in place.
            </p>
          </div>
        </section>

        <SectionHeading label="Marked sheet" hint="Your paper as your teacher marked it" />
      </div>

      <div
        ref={printableRef}
        className="mx-auto grid max-w-7xl gap-4 px-4 pb-6 md:grid-cols-[1fr_360px] md:px-6"
      >
        {/* Marked sheet */}
        <main className="rounded-xl border border-border bg-card overflow-hidden" style={{ minHeight: 600 }}>
          <HybridPaperViewer
            pages={data.pages}
            annotations={data.annotations}
            activeQuestionId={null}
            activeTool={null}
            activeColor="#000000"
            isLocked={true}
            questionNotes={questionNotes}
            onCreateAnnotation={() => {}}
            onDeleteAnnotation={() => {}}
          />
        </main>

        {/* Per-question marks + teacher comments */}
        <aside className="space-y-3">
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Overall
            </div>
            <div className="flex items-center justify-between">
              <div className="text-2xl font-bold text-foreground tabular-nums">
                {Number(totalAwarded).toFixed(2)} / {Number(totalMax).toFixed(2)}
              </div>
              <div className="rounded-full bg-primary/10 px-3 py-1 text-sm font-semibold text-primary tabular-nums">
                {percent.toFixed(1)}%
              </div>
            </div>
          </div>

          <ul className="space-y-2">
            {gradeable.map((q) => {
              const mark = marksByQuestion.get(q.id);
              const awarded = mark?.marks_awarded ?? null;
              const comment = mark?.teacher_comment ?? null;
              const ratio =
                awarded !== null && q.marks > 0
                  ? Math.max(0, Math.min(1, Number(awarded) / q.marks))
                  : 0;
              const pillColor =
                awarded === null
                  ? "bg-muted text-muted-foreground"
                  : ratio >= 1
                    ? "bg-emerald-500/10 text-emerald-700"
                    : ratio >= 0.5
                      ? "bg-amber-500/10 text-amber-700"
                      : "bg-rose-500/10 text-rose-700";
              return (
                <li
                  key={q.id}
                  className="rounded-lg border border-border bg-card p-3 shadow-sm"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="text-sm font-semibold text-foreground">
                      {q.questionNumber}
                    </div>
                    <div
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${pillColor}`}
                    >
                      {awarded === null ? "N/A" : `${Number(awarded).toFixed(2)} / ${q.marks}`}
                    </div>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                    {q.questionText}
                  </p>
                  {comment && (
                    <div className="mt-2 rounded-md border border-border bg-muted/30 p-2 text-[11px] text-foreground">
                      <div className="mb-1 flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        <MessageSquare className="h-3 w-3" />
                        Teacher comment
                      </div>
                      {comment}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
            <CheckCircle2 className="mb-1 h-4 w-4" />
            This attempt was marked on{" "}
            {data.attempt.evaluated_at
              ? new Date(data.attempt.evaluated_at).toLocaleDateString()
              : "N/A"}
            .
          </div>
        </aside>
      </div>
    </div>
  );
}
