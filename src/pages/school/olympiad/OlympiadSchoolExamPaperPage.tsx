import { useMemo, useState } from "react";
import { NavLink } from "react-router-dom";
import { ArrowLeft, BookOpen, CheckCircle2, ChevronRight, FileText, Loader2 } from "lucide-react";
import { PageShell } from "@/components/shared/page/PageShell";
import { PageHeader } from "@/components/shared/page/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/surfaces/EmptyState";
import { MobileTabs } from "@/components/shared/nav/MobileTabs";
import { MathText } from "@/components/ui/math-text";
import { cn } from "@/lib/utils";
import { useOlympiadMySchool } from "@/hooks/olympiad/useOlympiadMySchool";
import { useOlympiadClasses } from "@/hooks/olympiad/useOlympiadClasses";
import { useOlympiadExamPaper, type ExamPaperQuestion } from "@/hooks/olympiad/useOlympiadExamPaper";

const OPTIONS: Array<{ letter: "A" | "B" | "C" | "D"; key: "option_a" | "option_b" | "option_c" | "option_d" }> = [
  { letter: "A", key: "option_a" },
  { letter: "B", key: "option_b" },
  { letter: "C", key: "option_c" },
  { letter: "D", key: "option_d" },
];

function QuestionCard({ q, index }: { q: ExamPaperQuestion; index: number }) {
  return (
    <article className="surface-card frosted-shadow rounded-card space-y-3 p-5">
      <header className="flex items-center justify-between gap-3">
        <p className="eyebrow">Question {index + 1}</p>
        {q.topic_name && (
          <Badge variant="secondary" className="text-[10px]">{q.topic_name}</Badge>
        )}
      </header>
      <MathText text={q.question_text} />
      {q.image_url && (
        <img src={q.image_url} alt="Question illustration" className="max-h-56 rounded-md border border-surface-stroke" />
      )}
      <ul className="space-y-2">
        {OPTIONS.map(({ letter, key }) => {
          const isCorrect = q.correct_answer === letter;
          return (
            <li
              key={letter}
              className={cn(
                "flex items-start gap-2.5 rounded-md border px-3 py-2 text-sm",
                isCorrect
                  ? "border-emerald-300 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10"
                  : "border-surface-stroke",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                  isCorrect ? "bg-emerald-500 text-white" : "bg-ink-400/10 text-ink-600",
                )}
              >
                {letter}
              </span>
              <span className="min-w-0 flex-1 text-ink-900"><MathText text={q[key]} /></span>
              {isCorrect && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />}
            </li>
          );
        })}
      </ul>
    </article>
  );
}

/**
 * "View Exam" — the full class-wise question paper, launched from Exam
 * Planning. Class cards first; opening a class lists every question in its
 * pool with the correct answer highlighted, filterable by subject. Available
 * at every stage of the exam (before, during and after exam day).
 */
export default function OlympiadSchoolExamPaperPage() {
  const { data: school, isLoading: schoolLoading } = useOlympiadMySchool();
  const { data: olyClasses = [] } = useOlympiadClasses();
  const [selected, setSelected] = useState<{ gradeLevelId: string; classLabel: string } | null>(null);
  const [subjectFilter, setSubjectFilter] = useState("all");

  const paper = useOlympiadExamPaper(school?.id, selected?.gradeLevelId);
  const questions = (paper.data?.pages ?? []).flat();

  const participatingClasses = useMemo(() => {
    const allowed = new Set(school?.participating_grade_level_ids ?? []);
    return olyClasses
      .filter((c) => allowed.has(c.grade_level_id))
      .map((c) => ({
        gradeLevelId: c.grade_level_id,
        classLabel: c.grade_number != null ? `Class ${c.grade_number}` : c.grade_name,
      }));
  }, [olyClasses, school?.participating_grade_level_ids]);

  const subjects = useMemo(() => {
    const seen = new Map<string, string>();
    for (const q of questions) if (!seen.has(q.subject_id)) seen.set(q.subject_id, q.subject_name);
    return Array.from(seen, ([id, name]) => ({ id, name }));
  }, [questions]);

  const visible = subjectFilter === "all" ? questions : questions.filter((q) => q.subject_id === subjectFilter);

  if (schoolLoading) {
    return <PageShell><div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-ink-500" /></div></PageShell>;
  }
  if (!school) {
    return <PageShell><p className="py-6 text-sm text-ink-600">No active Olympiad campaign for this school.</p></PageShell>;
  }

  return (
    <PageShell>
      <NavLink to="/school/olympiad/exam-planning" className="mb-2 inline-flex items-center gap-1 text-sm text-ink-600 hover:text-ink-900">
        <ArrowLeft className="h-4 w-4" /> Exam Planning
      </NavLink>
      <PageHeader
        title="View Exam"
        subtitle={selected ? `${selected.classLabel} question paper` : "Question paper, class by class"}
        icon={<FileText className="h-6 w-6" />}
      />

      <div className="space-y-4 py-4">
        {!selected ? (
          participatingClasses.length === 0 ? (
            <EmptyState icon={<BookOpen className="h-7 w-7" />} title="No participating classes" reason="noData" />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
              {participatingClasses.map((c) => (
                <button
                  key={c.gradeLevelId}
                  type="button"
                  onClick={() => { setSelected(c); setSubjectFilter("all"); }}
                  className="surface-card frosted-shadow rounded-card flex items-center gap-4 p-5 text-left transition-transform hover:shadow-md active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40"
                >
                  <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-primary/10 text-brand-primary">
                    <BookOpen className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[18px] font-semibold leading-6 text-ink-900">{c.classLabel}</span>
                    <span className="block text-[13px] leading-[18px] text-ink-500">View all exam questions</span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-ink-400" />
                </button>
              ))}
            </div>
          )
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Button variant="outline" size="sm" onClick={() => setSelected(null)}>
                <ArrowLeft className="mr-1.5 h-4 w-4" /> All classes
              </Button>
              {subjects.length > 1 && (
                <MobileTabs
                  variant="segmented"
                  value={subjectFilter}
                  onValueChange={setSubjectFilter}
                  options={[{ value: "all", label: "All subjects" }, ...subjects.map((s) => ({ value: s.id, label: s.name }))]}
                />
              )}
            </div>

            {paper.isLoading ? (
              <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-ink-500" /></div>
            ) : paper.isError ? (
              // Error BEFORE empty — a failed RPC must never read as "no questions".
              <div className="surface-card frosted-shadow rounded-card space-y-3 p-6 text-center">
                <p className="text-sm text-ink-600">Couldn't load the question paper. Please try again.</p>
                <Button variant="outline" size="sm" onClick={() => paper.refetch()}>Retry</Button>
              </div>
            ) : visible.length === 0 ? (
              <EmptyState
                icon={<BookOpen className="h-7 w-7" />}
                title="No questions yet"
                description="Questions for this class haven't been added to the catalog."
                reason="noData"
              />
            ) : (
              <>
                <p className="text-[12px] tabular-nums text-ink-500">
                  {visible.length} question{visible.length === 1 ? "" : "s"}
                  {subjectFilter !== "all" && subjects.length > 0
                    ? ` · ${subjects.find((s) => s.id === subjectFilter)?.name ?? ""}`
                    : ""}
                </p>
                <div className="space-y-3">
                  {visible.map((q, i) => (
                    <QuestionCard key={q.id} q={q} index={i} />
                  ))}
                </div>
                {paper.hasNextPage && (
                  <Button
                    variant="outline"
                    className="w-full"
                    disabled={paper.isFetchingNextPage}
                    onClick={() => paper.fetchNextPage()}
                  >
                    {paper.isFetchingNextPage && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Load more
                  </Button>
                )}
              </>
            )}
          </>
        )}
      </div>
    </PageShell>
  );
}
