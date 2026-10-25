import { FileText, ClipboardList } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { TeacherTargetRow, TargetPeriodRow } from "@/hooks/useTeacherTargets";
import { parseDateOnly } from "@/lib/targetPeriods";

/**
 * Small display helpers shared by every Teacher Targets surface (the
 * admin/coordinator overview and the teacher's own page), so a metric name,
 * a status badge and "days left" read identically everywhere a target shows
 * up.
 */

export function metricLabel(metric: TeacherTargetRow["metric"]): string {
  return metric === "exams_published" ? "Exams published" : "Homework published";
}

/**
 * The target as an instruction a teacher can act on, rather than a column name.
 * "Exams published · Target of 2" told the reader nothing about what to do;
 * "Publish 2 exams" does. Used as the headline on every teacher-facing card.
 */
export function goalSentence(metric: TeacherTargetRow["metric"], value: number): string {
  if (metric === "exams_published") {
    return `Publish ${value} ${value === 1 ? "exam" : "exams"}`;
  }
  return `Set ${value} ${value === 1 ? "homework assignment" : "homework assignments"}`;
}

/** The past-tense verb for a progress line: "1 of 2 published". */
export function metricVerb(metric: TeacherTargetRow["metric"]): string {
  return metric === "exams_published" ? "published" : "set";
}

export function metricIcon(metric: TeacherTargetRow["metric"]) {
  return metric === "exams_published" ? (
    <FileText className="h-4 w-4" />
  ) : (
    <ClipboardList className="h-4 w-4" />
  );
}

export function targetStatusBadge(status: TeacherTargetRow["status"]) {
  if (status === "stopped") {
    return (
      <Badge variant="outline" className="border-ink-400/30 text-ink-500">
        Stopped
      </Badge>
    );
  }
  if (status === "completed") {
    return (
      <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
        Completed
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-brand-primary/30 bg-brand-primary/10 text-brand-primary">
      Active
    </Badge>
  );
}

export function periodStatusBadge(status: TargetPeriodRow["status"]) {
  if (status === "met") {
    return (
      <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
        Met
      </Badge>
    );
  }
  if (status === "missed") {
    return (
      <Badge variant="outline" className="border-rose-200 bg-rose-50 text-rose-700">
        Missed
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-brand-primary/30 bg-brand-primary/10 text-brand-primary">
      Open
    </Badge>
  );
}

/** "Met" / "Missed" for a closed period, or "N days left" / "Last day" /
 *  "Awaiting close" for the still-open one. */
export function periodStatusText(period: TargetPeriodRow): string {
  if (period.status === "met") return "Met";
  if (period.status === "missed") return "Missed";
  const end = parseDateOnly(period.period_end);
  const today = new Date();
  const today0 = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  const daysLeft = Math.round((end.getTime() - today0.getTime()) / 86_400_000);
  if (daysLeft < 0) return "Awaiting close";
  if (daysLeft === 0) return "Last day";
  return `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`;
}
