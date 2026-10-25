import { useState } from "react";
import { NavLink, useParams } from "react-router-dom";
import { ArrowLeft, Award, Download, Loader2, Medal, Star, Trophy } from "lucide-react";
import { PageShell } from "@/components/shared/page/PageShell";
import { PageHeader } from "@/components/shared/page/PageHeader";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { openExternal } from "@/lib/native";
import { useOlympiadPublishedResult } from "@/hooks/olympiad/useOlympiadPublishedResult";
import { useOlympiadPublishedResultUrl } from "@/hooks/olympiad/useOlympiadPublishedResultUrl";
import { StudentPerformanceAnalysis } from "@/components/olympiad/student/StudentPerformanceAnalysis";

const TIER_CHIP: Record<string, { label: string; icon: typeof Trophy; cls: string }> = {
  gold: { label: "Gold", icon: Trophy, cls: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" },
  silver: { label: "Silver", icon: Award, cls: "bg-slate-200 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300" },
  bronze: { label: "Bronze", icon: Medal, cls: "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300" },
  participation: { label: "Participation", icon: Star, cls: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300" },
};

/**
 * School-admin view of one student's Olympiad dashboard: published result
 * hero (score, ranks, tier, PDF downloads) plus the same performance
 * intelligence the student sees. Opened from the roster detail sheet; both
 * RPCs gate access via oly_student_can_read.
 */
export default function OlympiadSchoolStudentDashboardPage() {
  const { studentId } = useParams<{ studentId: string }>();
  const { data: result, isLoading } = useOlympiadPublishedResult(studentId);
  const getUrl = useOlympiadPublishedResultUrl();
  const [busy, setBusy] = useState<"result" | "certificate" | null>(null);

  const downloadPdf = async (resultId: string, kind: "result" | "certificate") => {
    setBusy(kind);
    try {
      const url = await getUrl.mutateAsync({ resultId, kind });
      openExternal(url);
    } finally {
      setBusy(null);
    }
  };

  if (isLoading) {
    return <PageShell><div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-ink-500" /></div></PageShell>;
  }

  const back = (
    <NavLink to="/school/olympiad/students" className="inline-flex items-center gap-1 text-sm text-ink-600 hover:text-ink-900 mb-2">
      <ArrowLeft className="h-4 w-4" /> Students
    </NavLink>
  );

  if (!result?.ok) {
    return (
      <PageShell>
        {back}
        <PageHeader title="Student dashboard" />
        <div className="surface-card frosted-shadow rounded-card p-6 text-center text-sm text-ink-600">
          This student's result hasn't been published yet.
        </div>
      </PageShell>
    );
  }

  const isAbsent = result.certificate_tier === "absent";
  const tier = TIER_CHIP[result.certificate_tier];
  const TierIcon = tier?.icon ?? Star;

  return (
    <PageShell>
      {back}
      <PageHeader
        title={result.full_name}
        subtitle={`${result.roll_number} · ${result.class_label}${result.section_label ? ` · Section ${result.section_label}` : ""}`}
      />
      <div className="space-y-4 py-4">
        {/* Result hero */}
        <section className="surface-card frosted-shadow rounded-card p-5 sm:p-6">
          {isAbsent ? (
            <p className="text-center text-sm text-ink-600">
              This student did not appear for the exam.
            </p>
          ) : (
            <div className="flex flex-col items-center gap-5 sm:flex-row sm:justify-between">
              <div className="flex items-center gap-4">
                <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-primary/10 text-brand-primary">
                  <TierIcon className="h-7 w-7" />
                </span>
                <div>
                  <p className="text-3xl font-bold tabular-nums text-ink-900">
                    {Number(result.percentage).toFixed(1)}%
                  </p>
                  <p className="text-sm text-ink-600">
                    {Number(result.total_marks_obtained).toFixed(0)}/{Number(result.total_max_marks).toFixed(0)} marks
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-6 text-center">
                <div>
                  <p className="eyebrow">Class rank</p>
                  <p className="mt-0.5 text-lg font-bold tabular-nums text-ink-900">
                    {result.class_rank != null ? (
                      <>
                        {result.class_rank}
                        {result.class_total != null && <span className="text-sm font-normal text-ink-500"> / {result.class_total}</span>}
                      </>
                    ) : "N/A"}
                  </p>
                </div>
                <span className="hidden h-8 w-px bg-surface-stroke sm:block" aria-hidden />
                <div>
                  <p className="eyebrow">Award</p>
                  {tier ? (
                    <span className={cn("mt-1 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold", tier.cls)}>
                      <TierIcon className="h-3.5 w-3.5" />
                      {tier.label}
                    </span>
                  ) : (
                    <p className="mt-0.5 text-lg font-bold text-ink-900">N/A</p>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy !== null || !result.result_pdf_path}
                  onClick={() => downloadPdf(result.result_id, "result")}
                >
                  {busy === "result" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Download className="mr-1.5 h-4 w-4" />}
                  Report
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy !== null || !result.certificate_pdf_path}
                  onClick={() => downloadPdf(result.result_id, "certificate")}
                >
                  {busy === "certificate" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Download className="mr-1.5 h-4 w-4" />}
                  Certificate
                </Button>
              </div>
            </div>
          )}
        </section>

        {!isAbsent && <StudentPerformanceAnalysis studentId={studentId} />}
      </div>
    </PageShell>
  );
}
