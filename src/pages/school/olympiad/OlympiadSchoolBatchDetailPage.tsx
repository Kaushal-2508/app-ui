import { useMemo, useState } from "react";
import { NavLink, useParams } from "react-router-dom";
import {
  ArrowLeft,
  BarChart3,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  FileText,
  Gauge,
  Loader2,
  Lock,
  Trophy,
  Users,
} from "lucide-react";
import { PageShell } from "@/components/shared/page/PageShell";
import { PageHeader } from "@/components/shared/page/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MathText } from "@/components/ui/math-text";
import { MobileTabs } from "@/components/shared/nav/MobileTabs";
import { EmptyState } from "@/components/shared/surfaces/EmptyState";
import { StatTile, StatTileGrid } from "@/components/shared/surfaces";
import { ReportBarChart, ReportDonut } from "@/components/olympiad/school/report/ReportCharts";
import { StudentDetailSheet } from "@/components/olympiad/school/StudentDetailSheet";
import { useOlympiadMySchool } from "@/hooks/olympiad/useOlympiadMySchool";
import { useOlympiadBatches } from "@/hooks/olympiad/useOlympiadBatches";
import { useOlympiadSchoolStudents, type RosterStudent } from "@/hooks/olympiad/useOlympiadClassRoster";
import { useOlympiadSubjects } from "@/hooks/olympiad/useOlympiadSubjects";
import { useOlympiadResultsIndex } from "@/hooks/olympiad/useOlympiadResultsIndex";
import { useOlympiadStudentResults } from "@/hooks/olympiad/useOlympiadStudentResults";
import { useOlympiadBatchAssignmentMap } from "@/hooks/olympiad/useOlympiadBatchAssignmentMap";
import { useOlympiadExamPaper, type ExamPaperQuestion } from "@/hooks/olympiad/useOlympiadExamPaper";
import { useOlympiadBatchReport } from "@/hooks/olympiad/useOlympiadBatchReport";
import { cn } from "@/lib/utils";

type View = "menu" | "exam" | "result" | "analysis";

const TIER_CHIP: Record<string, { label: string; cls: string }> = {
  gold: { label: "Gold", cls: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" },
  silver: { label: "Silver", cls: "bg-slate-200 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300" },
  bronze: { label: "Bronze", cls: "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300" },
  participation: { label: "Participation", cls: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300" },
  absent: { label: "Absent", cls: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300" },
};

const pctChipCls = (pct: number) =>
  pct < 40
    ? "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
    : pct < 60
      ? "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
      : "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300";

function fmtIST(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

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
        {q.topic_name && <Badge variant="secondary" className="text-[10px]">{q.topic_name}</Badge>}
      </header>
      <MathText text={q.question_text} />
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

function AnalysisCard({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <section className="surface-card frosted-shadow rounded-card p-4 sm:p-5 space-y-3">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h3 className="text-base font-semibold text-ink-900">{title}</h3>
      </div>
      {children}
    </section>
  );
}

/**
 * Full-page detail for one batch on the Batch Schedule page (route
 * /school/olympiad/batches/:batchId). The overview shows the three batch
 * actions (View Exam / View Result / Exam Analysis) above the appeared/absent
 * roster; each action swaps the page to its scoped view with a contextual
 * back link. Result + Analysis unlock only once THIS batch's results are
 * published. Student rows open the shared StudentDetailSheet.
 */
export default function OlympiadSchoolBatchDetailPage() {
  const { batchId } = useParams<{ batchId: string }>();

  const { data: school, isLoading: schoolLoading } = useOlympiadMySchool();
  const { data: batches, isLoading: batchesLoading } = useOlympiadBatches(school?.id);
  const { data: students = [] } = useOlympiadSchoolStudents(school?.id);
  const { data: subjects } = useOlympiadSubjects();
  const { data: resultsIndex } = useOlympiadResultsIndex(school?.id);
  const { data: studentResults } = useOlympiadStudentResults(school?.id);
  const { data: assignMap } = useOlympiadBatchAssignmentMap(batchId ? [batchId] : undefined);

  const [view, setView] = useState<View>("menu");
  const [examGrade, setExamGrade] = useState<string | undefined>(undefined);
  const [examSubject, setExamSubject] = useState("all");
  const [selectedStudent, setSelectedStudent] = useState<RosterStudent | null>(null);

  const batch = useMemo(() => (batches ?? []).find((b) => b.id === batchId) ?? null, [batches, batchId]);

  const subjectNameById = useMemo(
    () => Object.fromEntries((subjects ?? []).map((s) => [s.id, s.name])),
    [subjects],
  );

  const batchStudents = useMemo(
    () => students.filter((s) => s.status === "active" && assignMap?.[s.id] === batchId),
    [students, assignMap, batchId],
  );

  const published = useMemo(
    () => batchStudents.some((s) => studentResults?.[s.id]),
    [batchStudents, studentResults],
  );

  const grades = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of batchStudents) if (!m.has(s.grade_level_id)) m.set(s.grade_level_id, s.class_label);
    return Array.from(m, ([id, label]) => ({ id, label }));
  }, [batchStudents]);
  const effectiveGrade = examGrade ?? grades[0]?.id;

  const paper = useOlympiadExamPaper(school?.id, view === "exam" ? effectiveGrade : undefined);
  const paperQuestions = useMemo(() => (paper.data?.pages ?? []).flat(), [paper.data]);
  const paperSubjects = useMemo(() => {
    const seen = new Map<string, string>();
    for (const q of paperQuestions) if (!seen.has(q.subject_id)) seen.set(q.subject_id, q.subject_name);
    return Array.from(seen, ([id, name]) => ({ id, name }));
  }, [paperQuestions]);
  const visibleQuestions =
    examSubject === "all" ? paperQuestions : paperQuestions.filter((q) => q.subject_id === examSubject);

  const reportQ = useOlympiadBatchReport(batchId, view === "analysis");
  const report = reportQ.data;

  const roster = useMemo(
    () =>
      batchStudents.slice().sort((a, b) => {
        const sa = resultsIndex?.[a.id] === "appeared" ? 0 : 1;
        const sb = resultsIndex?.[b.id] === "appeared" ? 0 : 1;
        return sa - sb || a.roll_number.localeCompare(b.roll_number, undefined, { numeric: true });
      }),
    [batchStudents, resultsIndex],
  );

  const resultRows = useMemo(
    () =>
      batchStudents
        .map((s) => ({ s, r: studentResults?.[s.id] }))
        .sort((a, b) => {
          const pa = a.r && a.r.certificate_tier !== "absent" ? a.r.percentage : -1;
          const pb = b.r && b.r.certificate_tier !== "absent" ? b.r.percentage : -1;
          return pb - pa || a.s.roll_number.localeCompare(b.s.roll_number, undefined, { numeric: true });
        }),
    [batchStudents, studentResults],
  );

  const subjectsLabel = (s: RosterStudent) => s.subject_ids.map((id) => subjectNameById[id] ?? "?").join(", ");
  const hasAttendance = !!resultsIndex && Object.keys(resultsIndex).length > 0;

  const appearedPct = report && report.enrolled > 0 ? Math.round((report.appeared / report.enrolled) * 100) : 0;
  const donutData = report
    ? [
        { key: "gold", name: "Gold", value: report.tier_distribution?.gold ?? 0 },
        { key: "silver", name: "Silver", value: report.tier_distribution?.silver ?? 0 },
        { key: "bronze", name: "Bronze", value: report.tier_distribution?.bronze ?? 0 },
        { key: "participation", name: "Participation", value: report.tier_distribution?.participation ?? 0 },
        { key: "absent", name: "Absent", value: report.tier_distribution?.absent ?? 0 },
      ].filter((d) => d.value > 0)
    : [];

  const openTopper = (fullName: string, classLabel: string) => {
    const match = batchStudents.find((s) => s.full_name === fullName && s.class_label === classLabel);
    if (match) setSelectedStudent(match);
  };

  if (schoolLoading || batchesLoading) {
    return <PageShell><div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-ink-500" /></div></PageShell>;
  }
  if (!school || !batch) {
    return (
      <PageShell>
        <NavLink to="/school/olympiad/batches" className="mb-2 inline-flex items-center gap-1 text-sm text-ink-600 hover:text-ink-900">
          <ArrowLeft className="h-4 w-4" /> Batch Schedule
        </NavLink>
        <div className="surface-card frosted-shadow rounded-card p-6 text-center text-sm text-ink-600">
          This batch could not be found.
        </div>
      </PageShell>
    );
  }

  const RosterRow = ({ s }: { s: RosterStudent }) => {
    const appeared = resultsIndex?.[s.id] === "appeared";
    return (
      <button
        type="button"
        onClick={() => setSelectedStudent(s)}
        className="w-full flex items-center gap-3 surface-card frosted-shadow rounded-card px-3 py-2.5 text-left transition-shadow hover:shadow-card-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40"
      >
        <div className="flex-1 min-w-0 space-y-0.5">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-ink-900">{s.full_name}</p>
            <Badge variant="outline" className="text-[10px]">{s.class_label}</Badge>
          </div>
          <p className="text-[11px] text-ink-500 truncate">{s.roll_number} · {subjectsLabel(s)}</p>
        </div>
        {hasAttendance && (
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold",
              appeared
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                : "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
            )}
          >
            {appeared ? "Appeared" : "Absent"}
          </span>
        )}
      </button>
    );
  };

  // Top-of-page back is contextual: from a sub-view it returns to the overview;
  // from the overview it returns to the batch list.
  const back =
    view === "menu" ? (
      <NavLink to="/school/olympiad/batches" className="mb-2 inline-flex items-center gap-1 text-sm text-ink-600 hover:text-ink-900">
        <ArrowLeft className="h-4 w-4" /> Batch Schedule
      </NavLink>
    ) : (
      <button
        type="button"
        onClick={() => setView("menu")}
        className="mb-2 inline-flex items-center gap-1 text-sm text-ink-600 hover:text-ink-900"
      >
        <ArrowLeft className="h-4 w-4" /> {batch.batch_label}
      </button>
    );

  const headerTitle =
    view === "exam" ? "Exam paper" : view === "result" ? "Batch results" : view === "analysis" ? "Exam analysis" : batch.batch_label;
  const headerSubtitle = view === "menu" ? fmtIST(batch.scheduled_at) : batch.batch_label;

  return (
    <PageShell>
      {back}
      <PageHeader title={headerTitle} subtitle={headerSubtitle} icon={<CalendarDays className="h-6 w-6" />} />

      <div className="space-y-4 py-4">
        {view === "menu" && (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Button variant="outline" className="h-auto justify-start gap-2.5 py-4" onClick={() => setView("exam")}>
                <FileText className="h-5 w-5 text-brand-primary" />
                <span className="text-sm font-semibold">View Exam</span>
              </Button>
              <Button variant="outline" className="h-auto justify-start gap-2.5 py-4" disabled={!published} onClick={() => setView("result")}>
                {published ? <Trophy className="h-5 w-5 text-brand-primary" /> : <Lock className="h-5 w-5 text-ink-400" />}
                <span className="text-sm font-semibold">View Result</span>
              </Button>
              <Button variant="outline" className="h-auto justify-start gap-2.5 py-4" disabled={!published} onClick={() => setView("analysis")}>
                {published ? <BarChart3 className="h-5 w-5 text-brand-primary" /> : <Lock className="h-5 w-5 text-ink-400" />}
                <span className="text-sm font-semibold">Exam Analysis</span>
              </Button>
            </div>
            {!published && (
              <p className="flex items-start gap-2 text-[12px] text-ink-500">
                <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-secondary" />
                Results and analysis unlock once this batch's results are published.
              </p>
            )}

            <section className="space-y-2">
              <h3 className="text-base font-semibold text-ink-900">
                Students <span className="font-normal text-ink-500">({batchStudents.length})</span>
              </h3>
              {batchStudents.length === 0 ? (
                <EmptyState icon={<Users className="h-7 w-7" />} title="No students assigned" reason="noData" />
              ) : (
                <div className="space-y-2">{roster.map((s) => <RosterRow key={s.id} s={s} />)}</div>
              )}
            </section>
          </>
        )}

        {view === "exam" && (
          <>
            {grades.length > 1 && (
              <MobileTabs
                variant="segmented"
                value={effectiveGrade ?? ""}
                onValueChange={(g) => { setExamGrade(g); setExamSubject("all"); }}
                options={grades.map((g) => ({ value: g.id, label: g.label }))}
              />
            )}
            {paperSubjects.length > 1 && (
              <MobileTabs
                variant="segmented"
                value={examSubject}
                onValueChange={setExamSubject}
                options={[{ value: "all", label: "All subjects" }, ...paperSubjects.map((s) => ({ value: s.id, label: s.name }))]}
              />
            )}
            {paper.isLoading ? (
              <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-ink-500" /></div>
            ) : paper.isError ? (
              <div className="surface-card frosted-shadow rounded-card space-y-3 p-6 text-center">
                <p className="text-sm text-ink-600">Couldn't load the question paper. Please try again.</p>
                <Button variant="outline" size="sm" onClick={() => paper.refetch()}>Retry</Button>
              </div>
            ) : visibleQuestions.length === 0 ? (
              <EmptyState icon={<BookOpen className="h-7 w-7" />} title="No questions yet" reason="noData" />
            ) : (
              <>
                <p className="text-[12px] tabular-nums text-ink-500">
                  {visibleQuestions.length} question{visibleQuestions.length === 1 ? "" : "s"}
                </p>
                <div className="space-y-3">
                  {visibleQuestions.map((q, i) => <QuestionCard key={q.id} q={q} index={i} />)}
                </div>
                {paper.hasNextPage && (
                  <Button variant="outline" className="w-full" disabled={paper.isFetchingNextPage} onClick={() => paper.fetchNextPage()}>
                    {paper.isFetchingNextPage && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Load more
                  </Button>
                )}
              </>
            )}
          </>
        )}

        {view === "result" && (
          resultRows.length === 0 ? (
            <EmptyState icon={<Users className="h-7 w-7" />} title="No students in this batch" reason="noData" />
          ) : (
            <div className="space-y-2">
              {resultRows.map(({ s, r }) => {
                const isAbsent = !r || r.certificate_tier === "absent";
                const tier = r ? TIER_CHIP[r.certificate_tier] : null;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSelectedStudent(s)}
                    className="w-full flex items-center gap-3 surface-card frosted-shadow rounded-card px-3 py-2.5 text-left transition-shadow hover:shadow-card-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40"
                  >
                    <div className="flex-1 min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-ink-900">{s.full_name}</p>
                        <Badge variant="outline" className="text-[10px]">{s.class_label}</Badge>
                      </div>
                      <p className="text-[11px] text-ink-500 truncate">
                        {isAbsent || !r
                          ? s.roll_number
                          : `${Number(r.total_marks_obtained).toFixed(0)}/${Number(r.total_max_marks).toFixed(0)} marks${
                              r.class_rank != null ? ` · Class rank #${r.class_rank}` : ""
                            }`}
                      </p>
                    </div>
                    {isAbsent || !r ? (
                      <span className="shrink-0 rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
                        Absent
                      </span>
                    ) : (
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="text-sm font-semibold tabular-nums text-ink-900">{Math.round(r.percentage * 10) / 10}%</span>
                        {tier && <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", tier.cls)}>{tier.label}</span>}
                      </div>
                    )}
                    <ChevronRight className="h-4 w-4 shrink-0 text-ink-400" />
                  </button>
                );
              })}
            </div>
          )
        )}

        {view === "analysis" && (
          reportQ.isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-ink-500" /></div>
          ) : reportQ.isError ? (
            <div className="surface-card frosted-shadow rounded-card space-y-3 p-6 text-center">
              <p className="text-sm text-ink-600">Couldn't load the analysis. Please try again.</p>
              <Button variant="outline" size="sm" onClick={() => reportQ.refetch()}>Retry</Button>
            </div>
          ) : !report || !report.results_available ? (
            <EmptyState icon={<BarChart3 className="h-7 w-7" />} title="No results yet" reason="noData" />
          ) : (
            <>
              <StatTileGrid cols={2} mdCols={4}>
                <StatTile label="Enrolled" value={String(report.enrolled)} icon={<Users className="h-4 w-4" />} tone="teal" />
                <StatTile label="Appeared" value={`${report.appeared} · ${appearedPct}%`} icon={<CheckCircle2 className="h-4 w-4" />} tone="mint" />
                <StatTile label="Average score" value={`${report.avg_percentage ?? 0}%`} icon={<Gauge className="h-4 w-4" />} tone="violet" />
                <StatTile label="Highest score" value={`${report.max_percentage ?? 0}%`} icon={<Trophy className="h-4 w-4" />} tone="sky" />
              </StatTileGrid>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {report.subject_performance.length > 0 && (
                  <AnalysisCard eyebrow="Performance" title="Subject performance">
                    <ReportBarChart horizontal domainMax={100} data={report.subject_performance.map((s) => ({ label: s.subject_name, value: s.pct_correct }))} />
                  </AnalysisCard>
                )}
                {report.weak_topics.length > 0 && (
                  <AnalysisCard eyebrow="Where students lag" title="Weakest concepts">
                    <ul className="divide-y divide-surface-stroke">
                      {report.weak_topics.map((t) => (
                        <li key={`${t.subject_name}-${t.topic_name}`} className="flex items-center justify-between gap-3 py-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-ink-900">{t.topic_name}</p>
                            <p className="text-[11px] text-ink-500">{t.subject_name} · {t.questions} question{t.questions === 1 ? "" : "s"}</p>
                          </div>
                          <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold", pctChipCls(t.pct_correct))}>{t.pct_correct}%</span>
                        </li>
                      ))}
                    </ul>
                  </AnalysisCard>
                )}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <AnalysisCard eyebrow="Spread" title="Score distribution">
                  <ReportBarChart data={report.score_distribution.map((b) => ({ label: b.bucket, value: b.count }))} color="hsl(var(--brand-secondary))" height={200} />
                </AnalysisCard>
                {report.results_published && donutData.length > 0 && (
                  <AnalysisCard eyebrow="Awards" title="Medal mix">
                    <ReportDonut data={donutData} />
                  </AnalysisCard>
                )}
              </div>

              {report.toppers.length > 0 && (
                <AnalysisCard eyebrow="Leaderboard" title="Top performers">
                  <ol className="space-y-1.5">
                    {report.toppers.map((t, i) => (
                      <li key={`${t.full_name}-${i}`}>
                        <button
                          type="button"
                          onClick={() => openTopper(t.full_name, t.class_label)}
                          className="w-full flex items-center gap-3 rounded-md px-2 py-1.5 text-left odd:bg-muted/40 transition-colors hover:bg-ink-400/10"
                        >
                          <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold", i === 0 ? "bg-amber-400 text-amber-950" : i === 1 ? "bg-slate-300 text-slate-800" : i === 2 ? "bg-orange-300 text-orange-950" : "bg-muted text-ink-600")}>
                            {i + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-ink-900">{t.full_name}</p>
                            <p className="text-[11px] text-ink-500">{t.class_label}</p>
                          </div>
                          <span className="shrink-0 text-sm font-semibold tabular-nums text-ink-900">{t.percentage}%</span>
                        </button>
                      </li>
                    ))}
                  </ol>
                </AnalysisCard>
              )}
            </>
          )
        )}
      </div>

      <StudentDetailSheet
        student={selectedStudent}
        onOpenChange={(open) => { if (!open) setSelectedStudent(null); }}
        subjectNameById={subjectNameById}
        result={selectedStudent ? studentResults?.[selectedStudent.id] ?? null : null}
      />
    </PageShell>
  );
}
