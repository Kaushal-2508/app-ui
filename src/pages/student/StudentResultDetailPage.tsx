import { useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { format } from "date-fns";
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  RefreshCcw,
  FileText,
  ListChecks,
  Trophy,
  MessageSquare,
  Download,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

import { PageShell } from "@/components/shared/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { MathText } from "@/components/ui/math-text";
import { OptionImage } from "@/components/exam/OptionImage";
import { OptionChoiceGrid } from "@/components/exam/OptionChoiceGrid";
import { hasOptionImages } from "@/components/exam/optionDisplay";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { EmptyState } from "@/components/shared/surfaces";
import { ResultClassComparison } from "@/components/student/ResultClassComparison";
import {
  useStudentExamResultDetail,
  type ResultQuestion,
} from "@/hooks/useStudentExamResultDetail";
import { useExamRemarks } from "@/hooks/useStudentRemarks";
import { useAuth } from "@/hooks/useAuth";
import { getExamPaperUrl } from "@/lib/examPaperStorage";
import { saveBlob } from "@/lib/native";
import { normalizeText } from "@/lib/textNormalization";
import { cn } from "@/lib/utils";

const TEST_TYPE_LABELS: Record<string, string> = {
  term: "Term exam",
  unit: "Unit test",
  weekly: "Weekly test",
  unspecified: "Other",
};

/** Small uppercase section label, matching the rest of the student surfaces. */
function SectionHeading({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-600">{label}</h2>
      {hint && <span className="text-[11px] text-ink-400">{hint}</span>}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-surface-stroke p-3">
      <p className="text-[11px] uppercase tracking-wide text-ink-500">{label}</p>
      <p className="mt-1 text-sm font-semibold tabular-nums text-ink-900">{value}</p>
    </div>
  );
}

function formatDuration(seconds: number) {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.round((seconds % 3600) / 60);
  return hrs > 0 ? `${hrs}h ${mins}m` : `${mins} min`;
}

/**
 * One exam, in full. Replaces the old "View report / Details / Request recheck"
 * kebab on the results list: those were three separate surfaces for one exam, so
 * they are now sections of a single page.
 *
 * The shell is identical for every exam; only the expandable section at the
 * bottom changes with how the exam was delivered (see useStudentExamResultDetail).
 */
export default function StudentResultDetailPage() {
  const navigate = useNavigate();
  const { resultId } = useParams<{ resultId: string }>();
  const { user } = useAuth();
  const { data, isLoading, isError } = useStudentExamResultDetail(resultId);
  const { data: remarks } = useExamRemarks(data?.exam.id ?? null, user?.id ?? null);

  const printableRef = useRef<HTMLDivElement>(null);
  const [isExporting, setIsExporting] = useState(false);

  const handleDownloadPdf = async () => {
    if (!printableRef.current) return;
    setIsExporting(true);
    try {
      const html2pdf = (await import("html2pdf.js")).default;
      const filename = `${(data?.exam.title ?? "exam").replace(/[^a-z0-9-_]+/gi, "_")}_result.pdf`;
      const blob: Blob = await html2pdf()
        .set({
          margin: 10,
          filename,
          image: { type: "jpeg", quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true },
          jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
        })
        .from(printableRef.current)
        .outputPdf("blob");
      saveBlob(blob, filename);
    } catch {
      toast.error("Couldn't generate the PDF. Try again in a moment.");
    } finally {
      setIsExporting(false);
    }
  };

  if (isLoading) {
    return (
      <PageShell>
        <Skeleton className="h-9 w-40" />
        <Skeleton className="mt-4 h-36 w-full rounded-card" />
        <Skeleton className="mt-4 h-48 w-full rounded-card" />
      </PageShell>
    );
  }

  if (isError || !data) {
    return (
      <PageShell>
        <EmptyState
          icon={<Trophy className="h-7 w-7" />}
          title="Result not found"
          description="This result may have been unpublished, or the link is no longer valid."
          action={{ label: "Back to results", onClick: () => navigate("/student/results") }}
        />
      </PageShell>
    );
  }

  const { result, exam, variant, questions, time_spent_seconds } = data;
  const percentage = result.percentage ?? 0;
  const marked = questions.filter((q) => q.is_correct !== null);
  const correctCount = marked.filter((q) => q.is_correct).length;

  return (
    <PageShell>
      {/* Header — back, identity, and the recheck action in the top right. */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="-ml-2 shrink-0"
            aria-label="Back to results"
            onClick={() => navigate("/student/results")}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold text-ink-900 sm:text-2xl">{exam.title}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
              {result.is_absent ? (
                // An absentee has no score to pass or fail. Showing "Failed"
                // here would misreport why they have no marks.
                <Badge className="border border-amber-200 bg-amber-500/10 text-xs text-amber-700">
                  <XCircle className="mr-1 h-3 w-3" />
                  Absent
                </Badge>
              ) : result.is_pass ? (
                <Badge className="border border-emerald-200 bg-emerald-500/10 text-xs text-emerald-700">
                  <CheckCircle2 className="mr-1 h-3 w-3" />
                  Passed
                </Badge>
              ) : (
                <Badge className="border border-rose-200 bg-rose-500/10 text-xs text-rose-700">
                  <XCircle className="mr-1 h-3 w-3" />
                  Failed
                </Badge>
              )}
              <Badge variant="outline" className="text-xs">
                {TEST_TYPE_LABELS[exam.exam_type] ?? exam.exam_type}
              </Badge>
              {result.grade && (
                <Badge variant="outline" className="text-xs">
                  Grade {result.grade}
                </Badge>
              )}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button variant="outline" onClick={handleDownloadPdf} disabled={isExporting}>
            {isExporting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Preparing…
              </>
            ) : (
              <>
                <Download className="mr-2 h-4 w-4" />
                Download PDF
              </>
            )}
          </Button>
          <Button variant="outline" onClick={() => navigate("/student/rechecks")}>
            <RefreshCcw className="mr-2 h-4 w-4" />
            Request recheck
          </Button>
        </div>
      </div>

      {/* Everything below is what the PDF captures. */}
      <div ref={printableRef}>

      {/* Section 1 — Exam details */}
      <section className="mt-5 space-y-3">
        <SectionHeading label="Exam details" />
        <div className="surface-card frosted-shadow rounded-card p-4 ring-1 ring-ink-400/10 sm:p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-wide text-ink-500">Your score</p>
              {result.is_absent ? (
                <p className="mt-1 text-4xl font-bold leading-none text-ink-900">Absent</p>
              ) : (
                <p className="mt-1 text-4xl font-bold leading-none tabular-nums text-ink-900">
                  {percentage.toFixed(1)}%
                </p>
              )}
            </div>
            <p className="text-sm tabular-nums text-ink-600">
              {result.is_absent
                ? "Did not sit this exam"
                : `${result.total_marks_obtained}/${result.total_max_marks} marks`}
            </p>
          </div>
          {!result.is_absent && <Progress value={percentage} className="mt-4 h-2" />}

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {exam.subjects.length > 0 && (
              <Fact label="Subject" value={exam.subjects.join(", ")} />
            )}
            <Fact
              label="Exam date"
              value={
                exam.scheduled_date
                  ? format(new Date(exam.scheduled_date), "d MMM yyyy")
                  : result.published_at
                    ? format(new Date(result.published_at), "d MMM yyyy")
                    : "N/A"
              }
            />
            {exam.pass_marks != null && (
              <Fact label="Pass marks" value={String(exam.pass_marks)} />
            )}
            {result.rank_in_class != null && (
              <Fact label="Class rank" value={`#${result.rank_in_class}`} />
            )}
            {time_spent_seconds != null && (
              <Fact label="Time spent" value={formatDuration(time_spent_seconds)} />
            )}
            {exam.duration_minutes != null && (
              <Fact label="Allowed time" value={`${exam.duration_minutes} min`} />
            )}
            {result.published_at && (
              <Fact label="Published" value={format(new Date(result.published_at), "d MMM yyyy")} />
            )}
          </div>
        </div>
      </section>

      {/* Section 2 — How this compares with the class */}
      <section className="mt-6 space-y-3">
        <SectionHeading label="Performance" hint="Compared with your class" />
        <ResultClassComparison attemptId={result.attempt_id} />
      </section>

      {/* Marks per section, when the paper was built with sections. */}
      {data.section_scores.length > 0 && (
        <section className="mt-6 space-y-3">
          <SectionHeading label="Section breakdown" />
          <ul className="surface-card frosted-shadow divide-y divide-surface-stroke rounded-card px-4 ring-1 ring-ink-400/10">
            {data.section_scores.map((s) => (
              <li key={s.section} className="flex items-center justify-between gap-3 py-3">
                <span className="truncate text-sm text-ink-900">{s.section}</span>
                <span className="shrink-0 text-sm font-semibold tabular-nums text-ink-900">
                  {s.marks} marks
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Anything the teacher wrote about this specific exam. */}
      {remarks && remarks.length > 0 && (
        <section className="mt-6 space-y-3">
          <SectionHeading label="Teacher remarks" />
          <ul className="space-y-3">
            {remarks.map((r) => (
              <li
                key={r.id}
                className="surface-card frosted-shadow rounded-card p-4 ring-1 ring-ink-400/10"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-xs font-medium text-ink-600">
                    <MessageSquare className="h-3.5 w-3.5" />
                    {(r.teacher as { full_name: string | null } | null)?.full_name ?? "Teacher"}
                  </span>
                  <Badge variant="outline" className="text-xs capitalize">
                    {r.category}
                  </Badge>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-ink-900">{r.remark_text}</p>
                <p className="mt-1.5 text-[11px] text-ink-500">
                  {format(new Date(r.created_at), "d MMM yyyy")}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Section 3 — the type-specific expandable */}
      <section className="mt-6 space-y-3">
        {variant === "offline_collected" ? (
          <>
            <SectionHeading label="Question paper" />
            {exam.source_paper_files.length > 0 ? (
              <div className="surface-card frosted-shadow space-y-2 rounded-card p-4 ring-1 ring-ink-400/10">
                {exam.source_paper_files.map((f) => (
                  <a
                    key={f.path}
                    href={getExamPaperUrl(f.path)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 rounded-xl border border-surface-stroke px-3 py-2 text-sm transition-colors hover:border-brand-primary/40"
                  >
                    <FileText className="h-4 w-4 text-ink-500" />
                    <span className="flex-1 truncate text-ink-900">{f.name}</span>
                    <span className="text-xs text-ink-500">View</span>
                  </a>
                ))}
              </div>
            ) : (
              <div className="surface-card frosted-shadow rounded-card p-4 ring-1 ring-ink-400/10">
                <p className="text-sm text-ink-600">
                  Only the marks were uploaded for this exam, so there is no question paper to show.
                </p>
              </div>
            )}
          </>
        ) : questions.length > 0 ? (
          <>
            <SectionHeading
              label={variant === "online" ? "Question breakdown" : "Question paper"}
              hint={
                variant === "online" && marked.length > 0
                  ? `${correctCount}/${marked.length} correct`
                  : `${questions.length} question${questions.length === 1 ? "" : "s"}`
              }
            />
            {/* ONE dropdown for the whole section — inside it every question is
                laid out in full, rather than each question being its own collapsed
                row that has to be opened one at a time. */}
            <div className="surface-card frosted-shadow rounded-card ring-1 ring-ink-400/10">
              <Accordion type="single" collapsible className="w-full">
                <AccordionItem value="questions" className="border-0">
                  <AccordionTrigger className="px-4 py-3.5 text-sm font-medium text-ink-900 hover:no-underline sm:px-5">
                    {variant === "online"
                      ? `Show all ${questions.length} questions with answers`
                      : `Show all ${questions.length} questions`}
                  </AccordionTrigger>
                  <AccordionContent className="px-4 pb-5 sm:px-5">
                    <ul className="space-y-5">
                      {questions.map((q, i) => (
                        <QuestionItem key={q.id} question={q} index={i} variant={variant} />
                      ))}
                    </ul>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>
          </>
        ) : (
          <>
            <SectionHeading label="Questions" />
            <div className="surface-card frosted-shadow rounded-card p-4 ring-1 ring-ink-400/10">
              <p className="text-sm text-ink-600">
                The questions for this exam aren&apos;t available to view.
              </p>
            </div>
          </>
        )}
      </section>
      </div>
    </PageShell>
  );
}

/** One question, laid out in full. Online exams also show what the student picked
 *  and which option was right; offline papers show the question and the answer key.
 *  Text WRAPS — truncating a full exam question made it unreadable and pushed the
 *  marks out of the card. */
function QuestionItem({
  question: q,
  index,
  variant,
}: {
  question: ResultQuestion;
  index: number;
  variant: string;
}) {
  const hasOptions = q.options.length > 0;

  return (
    <li className="border-t border-surface-stroke pt-5 first:border-0 first:pt-0">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          {q.is_correct === true ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          ) : q.is_correct === false ? (
            <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
          ) : (
            <ListChecks className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
              Question {index + 1}
            </p>
            <MathText
              as="div"
              className="mt-1 break-words text-sm leading-relaxed text-ink-900"
              text={normalizeText(q.question_text)}
            />
            {q.image_url && (
              <img
                src={q.image_url}
                alt="Question diagram"
                className="mt-2 max-h-56 rounded-md border border-surface-stroke object-contain"
              />
            )}
          </div>
        </div>
        <span className="shrink-0 whitespace-nowrap text-xs font-medium tabular-nums text-ink-500">
          {q.obtained_marks != null
            ? `${q.obtained_marks}/${q.marks}`
            : `${q.marks} ${q.marks === 1 ? "mark" : "marks"}`}
        </span>
      </div>

      <div className="mt-3 space-y-3 pl-6">

        {/* Image-choice questions get the same large grid the student answered
            on, so reviewing looks like the exam rather than a different page. */}
        {hasOptions && hasOptionImages(q.options) && (
          <OptionChoiceGrid
            options={q.options}
            annotate={(o) => {
              const opt = o as { id?: string | null; isCorrect?: boolean };
              const chosen = q.student_answer != null && q.student_answer === opt.id;
              if (opt.isCorrect) {
                return { tone: "correct", note: chosen ? "Your answer · Correct" : "Correct" };
              }
              return chosen ? { tone: "wrong", note: "Your answer" } : {};
            }}
          />
        )}

        {hasOptions && !hasOptionImages(q.options) && (
          <ul className="space-y-1.5">
            {q.options.map((o, oi) => {
              const chosen = q.student_answer != null && q.student_answer === o.id;
              return (
                <li
                  key={o.id}
                  className={cn(
                    "flex items-start gap-2 rounded-xl border px-3 py-2 text-sm",
                    o.isCorrect
                      ? "border-emerald-500/40 bg-emerald-500/[0.07] text-ink-900"
                      : chosen
                        ? "border-rose-500/40 bg-rose-500/[0.07] text-ink-900"
                        : "border-surface-stroke text-ink-700",
                  )}
                >
                  {o.imageUrl && (
                    <OptionImage
                      url={o.imageUrl}
                      label={`Option ${String.fromCharCode(65 + oi)}`}
                    />
                  )}
                  <MathText
                    as="span"
                    className="min-w-0 flex-1 break-words"
                    text={normalizeText(o.text)}
                  />
                  <span className="flex shrink-0 items-center gap-1.5 text-[11px] font-medium">
                    {chosen && (
                      <span className={o.isCorrect ? "text-emerald-700" : "text-rose-700"}>
                        Your answer
                      </span>
                    )}
                    {o.isCorrect && <span className="text-emerald-700">Correct</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        {/* Written answers have no options to highlight, so show them plainly. */}
        {!hasOptions && q.student_answer && (
          <div className="rounded-xl border border-surface-stroke p-3">
            <p className="text-[11px] uppercase tracking-wide text-ink-500">Your answer</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-ink-900">{q.student_answer}</p>
          </div>
        )}

        {!hasOptions && q.correct_answer && (
          <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/[0.07] p-3">
            <p className="text-[11px] uppercase tracking-wide text-emerald-700">Correct answer</p>
            <MathText
              as="p"
              className="mt-1 text-sm text-ink-900"
              text={normalizeText(q.correct_answer)}
            />
          </div>
        )}

        {variant === "online" && !q.student_answer && (
          <p className="text-xs text-ink-500">You didn&apos;t answer this question.</p>
        )}

        {q.feedback && (
          <div className="flex items-start gap-2 rounded-xl border border-surface-stroke p-3">
            <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-500" />
            <div>
              <p className="text-[11px] uppercase tracking-wide text-ink-500">Teacher feedback</p>
              <p className="mt-0.5 text-sm text-ink-900">{q.feedback}</p>
            </div>
          </div>
        )}
      </div>
    </li>
  );
}
