import { useState } from "react";
import { Award, Download, Loader2, Medal, Star, Trophy } from "lucide-react";
import { MobileSheet } from "@/components/shared/sheets/MobileSheet";
import { EmptyState } from "@/components/shared/surfaces/EmptyState";
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

function accuracyTone(p: number) {
  return p >= 80
    ? "text-emerald-600 dark:text-emerald-400"
    : p >= 60
      ? "text-amber-600 dark:text-amber-400"
      : "text-rose-600 dark:text-rose-400";
}

/**
 * Teacher's per-student Olympiad scorecard — opened from the class Results panel.
 * Reuses the teacher-readable published-result RPC (gated by oly_student_can_read,
 * which includes the assigned-class teacher) for the hero + subject breakdown +
 * PDF downloads, and the shared StudentPerformanceAnalysis for topic/time/benchmark.
 */
export function StudentScorecardSheet({
  studentId,
  onOpenChange,
}: {
  studentId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: result, isLoading } = useOlympiadPublishedResult(studentId ?? undefined);
  const getUrl = useOlympiadPublishedResultUrl();
  const [busy, setBusy] = useState<"result" | "certificate" | null>(null);

  const downloadPdf = async (resultId: string, kind: "result" | "certificate") => {
    setBusy(kind);
    try {
      const url = await getUrl.mutateAsync({ resultId, kind });
      openExternal(url);
    } catch {
      // toastError fires in the mutation's onError
    } finally {
      setBusy(null);
    }
  };

  const ok = result?.ok ? result : null;
  const tier = ok ? TIER_CHIP[ok.certificate_tier] : null;
  const TierIcon = tier?.icon ?? Star;
  const isAbsent = ok?.certificate_tier === "absent";

  return (
    <MobileSheet
      open={!!studentId}
      onOpenChange={onOpenChange}
      title={ok?.full_name ?? "Scorecard"}
      subtitle={ok ? `${ok.roll_number} · ${ok.class_label}` : undefined}
      icon={<TierIcon className="h-4 w-4" />}
    >
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-ink-500" />
        </div>
      ) : !ok ? (
        <EmptyState
          icon={<Star className="h-7 w-7" />}
          title="Not published yet"
          description="This student's result hasn't been published yet."
          reason="noData"
        />
      ) : isAbsent ? (
        <EmptyState
          icon={<Star className="h-7 w-7" />}
          title="Did not appear"
          description="This student did not appear for the exam."
          reason="noData"
        />
      ) : (
        <div className="space-y-4">
          {/* Result hero */}
          <section className="surface-card frosted-shadow rounded-card p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-3xl font-bold tabular-nums text-ink-900">
                  {Number(ok.percentage).toFixed(1)}%
                </p>
                <p className="text-sm text-ink-600">
                  {Number(ok.total_marks_obtained).toFixed(0)}/{Number(ok.total_max_marks).toFixed(0)} marks
                </p>
              </div>
              <div className="flex items-center gap-5 text-center">
                <div>
                  <p className="eyebrow">Class rank</p>
                  <p className="mt-0.5 text-lg font-bold tabular-nums text-ink-900">
                    {ok.class_rank ?? "N/A"}
                    {ok.class_rank != null && ok.class_total != null && (
                      <span className="text-sm font-normal text-ink-500"> / {ok.class_total}</span>
                    )}
                  </p>
                </div>
                {tier && (
                  <div>
                    <p className="eyebrow">Award</p>
                    <span className={cn("mt-1 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold", tier.cls)}>
                      <TierIcon className="h-3.5 w-3.5" />
                      {tier.label}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Downloads — teacher is authorized via oly_student_can_read */}
            <div className="mt-4 flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={busy !== null || !ok.result_pdf_path}
                onClick={() => downloadPdf(ok.result_id, "result")}
              >
                {busy === "result" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Download className="mr-1.5 h-4 w-4" />}
                Report
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busy !== null || !ok.certificate_pdf_path}
                onClick={() => downloadPdf(ok.result_id, "certificate")}
              >
                {busy === "certificate" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Download className="mr-1.5 h-4 w-4" />}
                Certificate
              </Button>
            </div>
          </section>

          {/* Subject-wise breakdown */}
          {ok.subject_scores.length > 0 && (
            <section className="surface-card frosted-shadow rounded-card p-4">
              <p className="eyebrow mb-2">Subject-wise</p>
              <ul className="divide-y divide-surface-stroke">
                {ok.subject_scores.map((s) => {
                  const acc = s.total > 0 ? Math.round((s.correct / s.total) * 100) : 0;
                  return (
                    <li key={s.subject_id} className="flex items-center justify-between gap-3 py-2">
                      <span className="min-w-0 truncate text-sm font-medium text-ink-900">{s.subject_name}</span>
                      <span className="flex shrink-0 items-center gap-3 text-sm tabular-nums">
                        <span className="text-ink-600">{s.correct}/{s.total}</span>
                        <span className={cn("font-semibold", accuracyTone(acc))}>{acc}%</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {/* Topic radar / strengths / benchmark / time intelligence (reused) */}
          <StudentPerformanceAnalysis studentId={studentId ?? undefined} />
        </div>
      )}
    </MobileSheet>
  );
}
