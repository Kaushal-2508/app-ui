import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Users, CheckCircle2, Gauge, Trophy, Info, BarChart3, Layers, Crown, BookOpen, LayoutGrid } from "lucide-react";
import { StatTile, StatTileGrid } from "@/components/shared/surfaces";
import { EmptyState } from "@/components/shared/surfaces/EmptyState";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useOlympiadMySchool } from "@/hooks/olympiad/useOlympiadMySchool";
import { useOlympiadSchoolReport } from "@/hooks/olympiad/useOlympiadSchoolReport";
import { useOlympiadSubjectTopicStats } from "@/hooks/olympiad/useOlympiadSubjectTopicStats";
import { useOlympiadClasses } from "@/hooks/olympiad/useOlympiadClasses";
import { useOlympiadSubjects } from "@/hooks/olympiad/useOlympiadSubjects";
import { useOlympiadGradeSubjects } from "@/hooks/olympiad/useOlympiadGradeSubjects";
import { useOlympiadSchoolStudents, type RosterStudent } from "@/hooks/olympiad/useOlympiadClassRoster";
import { useOlympiadStudentResults } from "@/hooks/olympiad/useOlympiadStudentResults";
import { StudentDetailSheet } from "@/components/olympiad/school/StudentDetailSheet";
import { useOlympiadClassSubjectMatrix, type ClassSubjectCell } from "@/hooks/olympiad/useOlympiadClassSubjectMatrix";
import { useOlympiadScoreDistribution } from "@/hooks/olympiad/useOlympiadScoreDistribution";
import { ReportBarChart, ReportDonut, ReportLollipop } from "@/components/olympiad/school/report/ReportCharts";
import { ClassSubjectMatrix } from "@/components/olympiad/school/report/ClassSubjectMatrix";
import { CellStudentsSheet } from "@/components/olympiad/school/report/CellStudentsSheet";

const pct = (n: number) => `${n ?? 0}%`;

function Section({
  eyebrow,
  title,
  subtitle,
  action,
  children,
  className,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  /** Right-aligned header slot — e.g. the card's filter controls. */
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`surface-card frosted-shadow rounded-card p-4 sm:p-5 space-y-3 ${className ?? ""}`}>
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          {eyebrow && <p className="eyebrow">{eyebrow}</p>}
          <h3 className="text-base font-semibold text-ink-900">{title}</h3>
          {subtitle && <p className="text-xs text-ink-600 mt-0.5">{subtitle}</p>}
        </div>
        {action && <div className="flex items-center gap-2 shrink-0">{action}</div>}
      </header>
      {children}
    </section>
  );
}

export default function OlympiadSchoolReportPage() {
  const navigate = useNavigate();
  const { data: school } = useOlympiadMySchool();
  const { data: report, isLoading } = useOlympiadSchoolReport(school?.id);
  const { data: olyClasses = [] } = useOlympiadClasses();
  const { data: subjects = [] } = useOlympiadSubjects();

  // Per-card filters. "all" renders the unfiltered numbers already present in
  // the report RPC; anything else fetches via oly_school_subject_topic_stats.
  const [subjClassFilter, setSubjClassFilter] = useState("all");
  const [weakClassFilter, setWeakClassFilter] = useState("all");
  const [weakSubjectFilter, setWeakSubjectFilter] = useState("all");
  const [spreadClassFilter, setSpreadClassFilter] = useState("all");
  // Awards + Leaderboard filter client-side over the roster/results already
  // loaded for this page, so their values are class LABELS, not grade ids.
  const [awardsClassFilter, setAwardsClassFilter] = useState("all");
  const [leaderClassFilter, setLeaderClassFilter] = useState("all");

  const subjStats = useOlympiadSubjectTopicStats(
    school?.id,
    subjClassFilter === "all" ? null : subjClassFilter,
    null,
  );
  const weakStats = useOlympiadSubjectTopicStats(
    school?.id,
    weakClassFilter === "all" ? null : weakClassFilter,
    weakSubjectFilter === "all" ? null : weakSubjectFilter,
  );
  const spreadStats = useOlympiadScoreDistribution(
    school?.id,
    spreadClassFilter === "all" ? null : spreadClassFilter,
  );
  // Class × subject heatmap — only meaningful once answers exist.
  const matrixQ = useOlympiadClassSubjectMatrix(school?.id, !!report?.results_available);

  const participatingClasses = useMemo(() => {
    const allowed = new Set(school?.participating_grade_level_ids ?? []);
    return olyClasses
      .filter((c) => allowed.has(c.grade_level_id))
      .map((c) => ({
        gradeLevelId: c.grade_level_id,
        classLabel: c.grade_number != null ? `Class ${c.grade_number}` : c.grade_name,
      }));
  }, [olyClasses, school?.participating_grade_level_ids]);

  // Subject options: only subjects that actually have answer data — and when
  // a class is picked, only subjects offered for THAT grade (Computer Science
  // is Class-10-only, so it must vanish while Class 9 is selected).
  const { data: weakGradeSubjects, isSuccess: weakGradeSubjectsReady } = useOlympiadGradeSubjects(
    weakClassFilter === "all" ? undefined : weakClassFilter,
  );
  const subjectOptions = useMemo(() => {
    const withData = new Set((report?.subject_performance ?? []).map((s) => s.subject_name));
    let options = (subjects ?? []).filter((s) => withData.has(s.name));
    if (weakClassFilter !== "all" && weakGradeSubjectsReady) {
      const offered = new Set((weakGradeSubjects ?? []).map((s) => s.id));
      options = options.filter((s) => offered.has(s.id));
    }
    return options;
  }, [subjects, report?.subject_performance, weakClassFilter, weakGradeSubjects, weakGradeSubjectsReady]);

  // If the chosen subject stops being valid for the chosen class, fall back.
  useEffect(() => {
    if (
      weakSubjectFilter !== "all" &&
      weakClassFilter !== "all" &&
      weakGradeSubjectsReady &&
      !(weakGradeSubjects ?? []).some((s) => s.id === weakSubjectFilter)
    ) {
      setWeakSubjectFilter("all");
    }
  }, [weakSubjectFilter, weakClassFilter, weakGradeSubjects, weakGradeSubjectsReady]);

  // Every card / bar / row deep-links into the matching detail view.
  const toStudents = (state?: {
    classFilter?: string;
    search?: string;
    appearedFilter?: string;
    tierFilter?: string;
    view?: "list" | "report";
  }) => navigate("/school/olympiad/students", state ? { state } : undefined);
  const toStudyMaterial = (subjectName: string) =>
    navigate("/school/olympiad/study-material", { state: { subjectName } });

  // Leaderboard rows open the full student profile sheet (result strip +
  // dashboard CTA). Toppers carry only name + class, so resolve against the
  // roster; if the lookup ever misses, fall back to the searched list.
  const { data: rosterStudents = [] } = useOlympiadSchoolStudents(school?.id);
  const { data: studentResults } = useOlympiadStudentResults(school?.id);
  const [selectedStudent, setSelectedStudent] = useState<RosterStudent | null>(null);
  // Heatmap chip drill-down: which class × subject cell is open.
  const [matrixCell, setMatrixCell] = useState<ClassSubjectCell | null>(null);
  const subjectNameById = useMemo(
    () => Object.fromEntries((subjects ?? []).map((s) => [s.id, s.name])),
    [subjects],
  );
  const openTopper = (fullName: string, classLabel: string) => {
    const match = rosterStudents.find(
      (s) => s.status === "active" && s.full_name === fullName && s.class_label === classLabel,
    );
    if (match) setSelectedStudent(match);
    else toStudents({ search: fullName });
  };

  if (isLoading || !report) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-ink-500" />
      </div>
    );
  }

  const hasResults = report.results_available;
  const appearedPct = report.enrolled > 0 ? Math.round((report.appeared / report.enrolled) * 100) : 0;
  const td = report.tier_distribution;

  // "All classes" keeps the server-aggregated numbers; a picked class is
  // counted client-side from roster + published results (already loaded here).
  const tierCounts =
    awardsClassFilter === "all"
      ? {
          gold: td?.gold ?? 0,
          silver: td?.silver ?? 0,
          bronze: td?.bronze ?? 0,
          participation: td?.participation ?? 0,
          absent: td?.absent ?? 0,
        }
      : rosterStudents.reduce(
          (acc, s) => {
            if (s.status !== "active" || s.class_label !== awardsClassFilter) return acc;
            const tier = studentResults?.[s.id]?.certificate_tier;
            if (tier) acc[tier] += 1;
            return acc;
          },
          { gold: 0, silver: 0, bronze: 0, participation: 0, absent: 0 },
        );
  const donutData = [
    { key: "gold", name: "Gold", value: tierCounts.gold },
    { key: "silver", name: "Silver", value: tierCounts.silver },
    { key: "bronze", name: "Bronze", value: tierCounts.bronze },
    { key: "participation", name: "Participation", value: tierCounts.participation },
    { key: "absent", name: "Absent", value: tierCounts.absent },
  ].filter((d) => d.value > 0);
  // Card visibility follows the SCHOOL-WIDE numbers — a filtered class with no
  // published results shows an in-card empty state instead of hiding the card.
  const hasTiers =
    report.results_published &&
    [td?.gold, td?.silver, td?.bronze, td?.participation, td?.absent].some((v) => (v ?? 0) > 0);

  const toppers =
    leaderClassFilter === "all"
      ? report.toppers
      : rosterStudents
          .flatMap((s) => {
            if (s.status !== "active" || s.class_label !== leaderClassFilter) return [];
            const r = studentResults?.[s.id];
            if (!r || r.certificate_tier === "absent") return [];
            return [
              {
                full_name: s.full_name,
                class_label: s.class_label,
                percentage: Math.round(r.percentage * 10) / 10,
              },
            ];
          })
          .sort((a, b) => b.percentage - a.percentage || a.full_name.localeCompare(b.full_name))
          .slice(0, 5);

  // Card data: unfiltered straight from the report, filtered from the stats RPC.
  const subjectPerf =
    subjClassFilter === "all" ? report.subject_performance : subjStats.data?.subject_performance ?? [];
  const subjLoading = subjClassFilter !== "all" && subjStats.isLoading;
  const weakFiltered = weakClassFilter !== "all" || weakSubjectFilter !== "all";
  const weakTopics = weakFiltered ? weakStats.data?.weak_topics ?? [] : report.weak_topics;
  const weakLoading = weakFiltered && weakStats.isLoading;

  return (
    <div className="space-y-5 py-4">
      {/* KPI row — single row of 4 on md+ */}
      <StatTileGrid cols={2} mdCols={4}>
        <StatTile label="Enrolled" value={String(report.enrolled)} icon={<Users className="h-4 w-4" />} tone="teal"
          onClick={() => toStudents()} />
        <StatTile
          label="Appeared"
          value={hasResults ? `${report.appeared} · ${appearedPct}%` : "N/A"}
          icon={<CheckCircle2 className="h-4 w-4" />}
          tone="mint"
          onClick={() => toStudents()}
        />
        <StatTile
          label="Average score"
          value={hasResults ? pct(report.avg_percentage) : "N/A"}
          icon={<Gauge className="h-4 w-4" />}
          tone="violet"
        />
        <StatTile
          label="Highest score"
          value={hasResults ? pct(report.max_percentage) : "N/A"}
          icon={<Trophy className="h-4 w-4" />}
          tone="sky"
          onClick={() => {
            if (report.toppers[0]) openTopper(report.toppers[0].full_name, report.toppers[0].class_label);
            else toStudents();
          }}
        />
      </StatTileGrid>

      {!hasResults && (
        <div className="surface-card frosted-shadow rounded-card p-4 flex items-start gap-2.5 text-sm text-ink-600">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-secondary" />
          <span>
            Performance analytics, subject &amp; concept insights, score distribution, medals and
            toppers, will appear here once students sit the exam. Enrolment is shown below in the
            meantime.
          </span>
        </div>
      )}

      {/* Enrolment overview — always available */}
      <Section eyebrow="Participation (via bar chart)" title="Enrolment by class">
        {report.enrollment_by_class.length === 0 ? (
          <EmptyState icon={<Users className="h-7 w-7" />} title="No students yet" description="Enrol students to see the breakdown." reason="noData" />
        ) : (
          <>
            <ReportBarChart data={report.enrollment_by_class.map((c) => ({ label: c.class_label, value: c.count }))} height={200}
              onBarClick={(classLabel) => toStudents({ classFilter: classLabel })} />
            <div className="flex flex-wrap gap-x-6 gap-y-1 pt-1 text-xs text-ink-600">
              <span>Online: <span className="font-semibold text-ink-900">{report.channel.online}</span></span>
              <span>Cash: <span className="font-semibold text-ink-900">{report.channel.cash}</span></span>
              <span>Absent (not appeared): <span className="font-semibold text-ink-900">{hasResults ? report.absent : "N/A"}</span></span>
            </div>
          </>
        )}
      </Section>

      {hasResults && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Section
              eyebrow="Where students do well / lag (via bar chart)"
              title="Subject performance"
              subtitle="Average % correct per subject"
              action={
                <Select value={subjClassFilter} onValueChange={setSubjClassFilter}>
                  <SelectTrigger className="h-8 w-[120px] text-xs">
                    <SelectValue placeholder="Class" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All classes</SelectItem>
                    {participatingClasses.map((c) => (
                      <SelectItem key={c.gradeLevelId} value={c.gradeLevelId}>{c.classLabel}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              }
            >
              {subjLoading ? (
                <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-ink-500" /></div>
              ) : subjectPerf.length === 0 ? (
                <EmptyState icon={<BookOpen className="h-7 w-7" />} title="No subject data" description={subjClassFilter !== "all" ? "No answers recorded for this class." : undefined} reason="noData" />
              ) : (
                <ReportBarChart
                  horizontal
                  domainMax={100}
                  data={subjectPerf.map((s) => ({ label: s.subject_name, value: s.pct_correct }))}
                  onBarClick={(subjectName) => toStudyMaterial(subjectName)}
                />
              )}
            </Section>

            <Section
              eyebrow="Where students lag"
              title="Weakest concepts"
              subtitle="Lowest % correct by topic"
              action={
                <>
                  <Select value={weakClassFilter} onValueChange={setWeakClassFilter}>
                    <SelectTrigger className="h-8 w-[120px] text-xs">
                      <SelectValue placeholder="Class" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All classes</SelectItem>
                      {participatingClasses.map((c) => (
                        <SelectItem key={c.gradeLevelId} value={c.gradeLevelId}>{c.classLabel}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={weakSubjectFilter} onValueChange={setWeakSubjectFilter}>
                    <SelectTrigger className="h-8 w-[140px] text-xs">
                      <SelectValue placeholder="Subject" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All subjects</SelectItem>
                      {subjectOptions.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </>
              }
            >
              {weakLoading ? (
                <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-ink-500" /></div>
              ) : weakTopics.length === 0 ? (
                <EmptyState icon={<Layers className="h-7 w-7" />} title="No topic data" description={weakFiltered ? "No answers recorded for this selection." : undefined} reason="noData" />
              ) : (
                <ul className="divide-y divide-surface-stroke">
                  {weakTopics.map((t) => (
                    <li
                      key={`${t.subject_name}-${t.topic_name}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => toStudyMaterial(t.subject_name)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          toStudyMaterial(t.subject_name);
                        }
                      }}
                      className="flex cursor-pointer items-center justify-between gap-3 py-2 transition-colors hover:bg-ink-400/5 rounded-md px-1 -mx-1"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-ink-900">{t.topic_name}</p>
                        <p className="text-[11px] text-ink-500">{t.subject_name} · {t.questions} question{t.questions === 1 ? "" : "s"}</p>
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${t.pct_correct < 40 ? "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300" : t.pct_correct < 60 ? "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"}`}>
                        {t.pct_correct}%
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Section eyebrow="Comparison (via dot plot)" title="Class performance" subtitle="Average % by class">
              {report.class_performance.length === 0 ? (
                <EmptyState icon={<BarChart3 className="h-7 w-7" />} title="No class data" reason="noData" />
              ) : (
                <ReportLollipop
                  data={report.class_performance
                    .map((c) => ({ label: c.class_label, value: c.avg_percentage }))
                    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))}
                  onRowClick={(classLabel) => toStudents({ classFilter: classLabel })}
                />
              )}
            </Section>

            <Section
              eyebrow="Spread (via bar chart)"
              title="Score distribution"
              subtitle="Students by score band (%)"
              action={
                <Select value={spreadClassFilter} onValueChange={setSpreadClassFilter}>
                  <SelectTrigger className="h-8 w-[120px] text-xs">
                    <SelectValue placeholder="Class" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All classes</SelectItem>
                    {participatingClasses.map((c) => (
                      <SelectItem key={c.gradeLevelId} value={c.gradeLevelId}>{c.classLabel}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              }
            >
              {spreadClassFilter !== "all" && spreadStats.isLoading ? (
                <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-ink-500" /></div>
              ) : (
                <ReportBarChart
                  data={(spreadClassFilter === "all"
                    ? report.score_distribution
                    : spreadStats.data ?? []
                  ).map((b) => ({ label: b.bucket, value: b.count }))}
                  color="hsl(var(--brand-secondary))"
                  height={200}
                  onBarClick={() =>
                    toStudents(
                      spreadClassFilter !== "all"
                        ? {
                            classFilter: participatingClasses.find((c) => c.gradeLevelId === spreadClassFilter)
                              ?.classLabel,
                          }
                        : undefined,
                    )
                  }
                />
              )}
            </Section>
          </div>

          <Section
            eyebrow="Cross analysis (via heatmap)"
            title="Subjects vs Class"
            subtitle="Average % correct per subject in each class · tap a chip to see each student's score in it"
          >
            {matrixQ.isLoading ? (
              <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-ink-500" /></div>
            ) : matrixQ.isError ? (
              // Error BEFORE empty — an RPC failure must never read as "no data".
              <div className="space-y-3 py-6 text-center">
                <p className="text-sm text-ink-600">Couldn't load the cross analysis. Please try again.</p>
                <Button variant="outline" size="sm" onClick={() => matrixQ.refetch()}>Retry</Button>
              </div>
            ) : (matrixQ.data ?? []).length === 0 ? (
              <EmptyState icon={<LayoutGrid className="h-7 w-7" />} title="No answer data yet" reason="noData" />
            ) : (
              <ClassSubjectMatrix
                cells={matrixQ.data ?? []}
                onCellClick={setMatrixCell}
                onClassClick={(classLabel) => toStudents({ classFilter: classLabel })}
              />
            )}
          </Section>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {hasTiers && (
              <Section
                eyebrow="Awards (via donut)"
                title="Medal mix"
                subtitle="Certificate tiers awarded · tap a slice to see those students"
                action={
                  <Select value={awardsClassFilter} onValueChange={setAwardsClassFilter}>
                    <SelectTrigger className="h-8 w-[120px] text-xs">
                      <SelectValue placeholder="Class" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All classes</SelectItem>
                      {participatingClasses.map((c) => (
                        <SelectItem key={c.gradeLevelId} value={c.classLabel}>{c.classLabel}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                }
              >
                {donutData.length === 0 ? (
                  <EmptyState
                    icon={<Trophy className="h-7 w-7" />}
                    title="No published results for this class yet"
                    reason="noData"
                  />
                ) : (
                  /* Tier slices open the Report view filtered to that award;
                     the Absent slice opens the roster on the Absent filter. */
                  <ReportDonut
                    data={donutData}
                    onSliceClick={(key) => {
                      const classFilter = awardsClassFilter === "all" ? undefined : awardsClassFilter;
                      if (key === "absent") toStudents({ appearedFilter: "absent", classFilter });
                      else toStudents({ tierFilter: key, view: "report", classFilter });
                    }}
                  />
                )}
              </Section>
            )}

            <Section
              eyebrow="Leaderboard"
              title="Top performers"
              subtitle={
                leaderClassFilter === "all"
                  ? "Highest scorers in the school"
                  : `Highest scorers in ${leaderClassFilter}`
              }
              action={
                <Select value={leaderClassFilter} onValueChange={setLeaderClassFilter}>
                  <SelectTrigger className="h-8 w-[120px] text-xs">
                    <SelectValue placeholder="Class" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All classes</SelectItem>
                    {participatingClasses.map((c) => (
                      <SelectItem key={c.gradeLevelId} value={c.classLabel}>{c.classLabel}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              }
            >
              {toppers.length === 0 ? (
                <EmptyState
                  icon={<Crown className="h-7 w-7" />}
                  title="No results yet"
                  description={
                    leaderClassFilter !== "all" ? "No published results for this class." : undefined
                  }
                  reason="noData"
                />
              ) : (
                <ol className="space-y-1.5">
                  {toppers.map((t, i) => (
                    <li
                      key={`${t.full_name}-${i}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => openTopper(t.full_name, t.class_label)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openTopper(t.full_name, t.class_label);
                        }
                      }}
                      className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 odd:bg-muted/40 transition-colors hover:bg-ink-400/10"
                    >
                      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${i === 0 ? "bg-amber-400 text-amber-950" : i === 1 ? "bg-slate-300 text-slate-800" : i === 2 ? "bg-orange-300 text-orange-950" : "bg-muted text-ink-600"}`}>
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink-900">{t.full_name}</p>
                        <p className="text-[11px] text-ink-500">{t.class_label}</p>
                      </div>
                      <span className="shrink-0 text-sm font-semibold text-ink-900 tabular-nums">{t.percentage}%</span>
                    </li>
                  ))}
                </ol>
              )}
            </Section>
          </div>
        </>
      )}

      <CellStudentsSheet
        cell={matrixCell}
        onOpenChange={(open) => {
          if (!open) setMatrixCell(null);
        }}
        students={rosterStudents}
        results={studentResults}
        onSelectStudent={(s) => {
          setMatrixCell(null);
          setSelectedStudent(s);
        }}
        onOpenStudyMaterial={toStudyMaterial}
      />

      <StudentDetailSheet
        student={selectedStudent}
        onOpenChange={(open) => {
          if (!open) setSelectedStudent(null);
        }}
        subjectNameById={subjectNameById}
        result={selectedStudent ? studentResults?.[selectedStudent.id] ?? null : null}
      />
    </div>
  );
}
