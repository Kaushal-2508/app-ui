import { Users } from "lucide-react";

import {
  useStudentExamComparison,
  useStudentHybridExamComparison,
} from "@/hooks/useStudentClassComparison";
import {
  compareToClassAverage,
  percentileToBand,
} from "@/lib/performanceLabels";
import { TONES, type Tone } from "@/components/shared/design-system";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

interface ResultClassComparisonProps {
  /** final_results rows carry attempt_id — pass it straight through. */
  attemptId: string | undefined;
  /**
   * Which data plane the attempt lives on. Hybrid attempts are a separate table
   * with their own aggregate RPC, but the returned shape (and therefore this UI)
   * is identical.
   */
  source?: "exam" | "hybrid";
}

/** Small label pill tinted by a label-engine tone. */
function ToneChip({ label, tone }: { label: string; tone: Tone }) {
  const t = TONES[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium",
        t.bg,
        t.fg,
      )}
    >
      {label}
    </span>
  );
}

/**
 * Per-test class comparison sourced from the REAL student-facing RPC
 * (useStudentExamComparison), replacing the old class_aggregates lookup that
 * returned NULL for students. Shows the student's own marks ALONGSIDE the class
 * average, the class high, and a calm percentile BAND (never an exact rank).
 *
 * Only renders meaningful content for published/finalised results; the caller
 * already filters to those.
 */
export function ResultClassComparison({
  attemptId,
  source = "exam",
}: ResultClassComparisonProps) {
  // Both hooks are always called (rules of hooks); the one that doesn't apply is
  // disabled by passing an undefined id, so only a single request is ever made.
  const examQuery = useStudentExamComparison(source === "exam" ? attemptId : undefined);
  const hybridQuery = useStudentHybridExamComparison(
    source === "hybrid" ? attemptId : undefined,
  );
  const { data, isLoading } = source === "hybrid" ? hybridQuery : examQuery;

  if (isLoading) {
    return <Skeleton className="h-28 w-full rounded-card" />;
  }

  if (!data?.has_data) {
    return null;
  }

  const studentPct = data.student_percentage ?? null;
  const classAvg = data.class_average ?? null;
  const classHigh = data.class_high ?? null;

  const vsClass = compareToClassAverage(studentPct, classAvg);
  const band = percentileToBand(data.student_percentile, data.cohort_size);

  return (
    <div className="surface-card frosted-shadow rounded-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Users className="h-4 w-4 text-ink-600" />
        <h3 className="text-sm font-semibold text-ink-900">How this test compares</h3>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-0.5">
          <p className="eyebrow">You</p>
          <p className="text-lg font-semibold tabular-nums text-ink-900">
            {studentPct != null ? `${studentPct.toFixed(1)}%` : "N/A"}
          </p>
        </div>
        <div className="space-y-0.5">
          <p className="eyebrow">Class average</p>
          <p className="text-lg font-semibold tabular-nums text-ink-700">
            {classAvg != null ? `${classAvg.toFixed(1)}%` : "N/A"}
          </p>
        </div>
        <div className="space-y-0.5">
          <p className="eyebrow">Class high</p>
          <p className="text-lg font-semibold tabular-nums text-ink-700">
            {classHigh != null ? `${classHigh.toFixed(1)}%` : "N/A"}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <ToneChip label={vsClass.label} tone={vsClass.tone} />
        {band.band !== "unknown" && <ToneChip label={band.label} tone={band.tone} />}
      </div>
    </div>
  );
}
