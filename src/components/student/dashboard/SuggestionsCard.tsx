import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Lightbulb, ChevronRight } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TONES } from "@/components/shared/design-system";
import { useInstitutionFeatures } from "@/hooks/useInstitutionFeatures";
import {
  useStudentSubjectComparison,
  useStudentScoreTrend,
  useStudentClassStanding,
  useStudentChapterPerformance,
} from "@/hooks/useStudentClassComparison";
import { useStudentAttendanceSummary } from "@/hooks/useStudentMonthAttendance";
import { useStudentHomework } from "@/hooks/useStudentHomework";
import { useStudentExams } from "@/hooks/useDashboardData";
import { buildStudentSuggestions } from "@/lib/studentSuggestions";
import { cn } from "@/lib/utils";

const VISIBLE = 4;

/**
 * "What to do next" for this student.
 *
 * Every input here is a query the dashboard ALREADY runs (status strip, subject
 * snapshot, attendance card), so React Query serves them from cache and this
 * section costs no extra requests. The advice itself is computed by the
 * deterministic engine in src/lib/studentSuggestions.ts.
 *
 * Hidden entirely when there's nothing worth saying — an empty advice box is
 * worse than no box.
 */
export function SuggestionsCard() {
  const navigate = useNavigate();
  const { isFeatureEnabled } = useInstitutionFeatures();
  const homeworkOn = isFeatureEnabled("homework");

  const { data: subjectData, isLoading: subjectsLoading } = useStudentSubjectComparison();
  const { data: chapters, isLoading: chaptersLoading } = useStudentChapterPerformance();
  const { data: trend, isLoading: trendLoading } = useStudentScoreTrend(8);
  const { data: attendance, isLoading: attLoading } = useStudentAttendanceSummary("1m");
  const { data: standing, isLoading: standingLoading } = useStudentClassStanding();
  const { data: homework, isLoading: hwLoading } = useStudentHomework();
  const { data: exams, isLoading: examsLoading } = useStudentExams();

  const isLoading =
    subjectsLoading ||
    chaptersLoading ||
    trendLoading ||
    attLoading ||
    standingLoading ||
    examsLoading ||
    (homeworkOn && hwLoading);

  const suggestions = useMemo(() => {
    const now = Date.now();
    const upcoming = (exams ?? [])
      .filter(
        (e) =>
          e.scheduled_date != null &&
          new Date(e.scheduled_date).getTime() > now &&
          (e.attempt_status === "available" || e.attempt_status === "not_started"),
      )
      .sort(
        (a, b) =>
          new Date(a.scheduled_date as string).getTime() -
          new Date(b.scheduled_date as string).getTime(),
      )[0];

    return buildStudentSuggestions({
      subjects: (subjectData?.subjects ?? []).map((s) => ({
        subject: s.subject,
        student_avg: s.student_avg,
        class_avg: s.class_avg,
        n_tests: s.n_tests,
      })),
      chapters: chapters ?? [],
      recentScores: (trend ?? []).map((p) => p.percentage),
      attendancePct: attendance?.percentage ?? null,
      pendingHomework: homeworkOn
        ? (homework ?? []).filter((r) => !r.submission && r.status !== "checked").length
        : 0,
      nextExam:
        upcoming?.scheduled_date != null
          ? { title: upcoming.title ?? "Your next exam", date: upcoming.scheduled_date }
          : null,
      percentile: standing?.student_percentile ?? null,
      cohortSize: standing?.cohort_size ?? null,
    });
  }, [subjectData, chapters, trend, attendance, homework, homeworkOn, exams, standing]);

  if (isLoading) {
    return <Skeleton className="h-40 w-full rounded-card" />;
  }

  // Nothing useful to say — stay out of the way.
  if (suggestions.length === 0) return null;

  const shown = suggestions.slice(0, VISIBLE);

  return (
    <Card className="surface-card frosted-shadow rounded-card ring-1 ring-ink-400/15">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base text-ink-900">
          <Lightbulb className="h-4 w-4 text-brand-primary" />
          Suggestions for you
        </CardTitle>
        <p className="text-xs text-ink-500">
          Based on your marks, attendance and what&apos;s coming up.
        </p>
      </CardHeader>

      <CardContent>
        <ul className="divide-y divide-surface-stroke">
          {shown.map((s) => {
            const tone = TONES[s.tone];
            const row = (
              <>
                <div className="flex items-start gap-3">
                  <span
                    className={cn(
                      "mt-0.5 h-2 w-2 shrink-0 rounded-full",
                      tone.fg.replace("text-", "bg-"),
                    )}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink-900">{s.title}</p>
                    <p className="mt-1 text-[13px] leading-relaxed text-ink-600">{s.detail}</p>
                    {s.pointer && (
                      <p className="mt-1.5 inline-block rounded-lg bg-ink-400/[0.08] px-2 py-1 text-[12px] font-medium text-ink-700">
                        {s.pointer}
                      </p>
                    )}
                    {s.action && (
                      <span className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand-primary">
                        {s.action.label}
                        <ChevronRight className="h-3.5 w-3.5" />
                      </span>
                    )}
                  </div>
                </div>
              </>
            );

            return (
              <li key={s.id} className="py-3 first:pt-0 last:pb-0">
                {s.action ? (
                  <button
                    type="button"
                    onClick={() => navigate(s.action!.to)}
                    className="-mx-2 block w-full rounded-lg px-2 py-1 text-left transition-colors hover:bg-ink-400/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40"
                  >
                    {row}
                  </button>
                ) : (
                  row
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
