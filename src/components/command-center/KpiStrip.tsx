import { Skeleton } from "@/components/ui/skeleton";
import { useDashboardKpis } from "@/hooks/dashboard/useDashboardData";
import { useDashboardScope } from "@/hooks/dashboard/DashboardScope";
import type { KpiSummary } from "@/hooks/dashboard/types";

import { KpiTile } from "./KpiTile";

/** Today's attendance — value + interpretation sentence (Task 3 verbatim). */
function attendanceTile(a: KpiSummary["attendance_today"]): { value: string; sentence: string } {
  if (!a.marked || a.pct == null) {
    return { value: "N/A", sentence: "Mark attendance to see this" };
  }
  const value = `${a.pct}%`;
  if (a.week_pct == null || a.prev_week_pct == null) {
    return { value, sentence: `${a.pct}% today` };
  }
  const diff = Math.round(a.week_pct - a.prev_week_pct);
  if (Math.abs(a.week_pct - a.prev_week_pct) <= 1) {
    return { value, sentence: `${a.pct}%, same as last week` };
  }
  return { value, sentence: `${a.pct}%, ${diff > 0 ? "higher" : "lower"} than last week` };
}

/** School average this year — value + interpretation sentence (Task 3 verbatim).
 *  Every kpi_summary variant windows school_avg on the academic year, which is
 *  what the sentences below already said even while the label said "term". */
function schoolAvgTile(s: KpiSummary["school_avg"]): { value: string; sentence: string } {
  if (s.pct == null) {
    return { value: "N/A", sentence: "Publish an exam to see this" };
  }
  const value = `${s.pct}%`;
  if (s.prev_pct == null) {
    return { value, sentence: `${s.pct}% this year` };
  }
  if (Math.abs(s.pct - s.prev_pct) <= 1) {
    return { value, sentence: `${s.pct}%, about the same as last year` };
  }
  return {
    value,
    sentence: `${s.pct}%, ${s.pct > s.prev_pct ? "slightly better" : "lower"} than last year`,
  };
}

/** Students who need help — value + interpretation sentence (Task 3 verbatim). */
function needHelpTile(n: KpiSummary["students_need_help"]): { value: string; sentence: string } {
  const value = String(n.count);
  if (n.count === 0) {
    return { value, sentence: "No students flagged right now" };
  }
  if (n.prev_count == null) {
    return { value, sentence: `${n.count} students need help` };
  }
  const delta = Math.abs(n.count - n.prev_count);
  return {
    value,
    sentence: `${n.count} students, ${delta} ${n.count > n.prev_count ? "more" : "fewer"} than last week`,
  };
}

/** Decisions waiting for you — value + interpretation sentence (Task 3 verbatim). */
function decisionsTile(d: KpiSummary["decisions_waiting"]): { value: string; sentence: string } {
  const value = String(d.count);
  return {
    value,
    sentence: d.count === 0 ? "Nothing waiting right now." : `${d.count} things. Tap to see the list.`,
  };
}

/**
 * Four calm KPI tiles at the top of the dashboard. Each tile turns a raw number
 * into a plain-language interpretation sentence (verbatim Phase-2 wording). The
 * "Decisions waiting" tile scrolls down to the flags feed on tap.
 */
export function KpiStrip() {
  const { data, isLoading } = useDashboardKpis();
  const scope = useDashboardScope();

  if (isLoading || !data) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-card" />
        ))}
      </div>
    );
  }

  const attendance = attendanceTile(data.attendance_today);
  const schoolAvg = schoolAvgTile(data.school_avg);
  const needHelp = needHelpTile(data.students_need_help);
  const decisions = decisionsTile(data.decisions_waiting);

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
      <KpiTile eyebrow="Today's attendance" value={attendance.value} sentence={attendance.sentence} />
      {/* Teachers must never be shown a school-wide average as a headline: this
          tile is fed by dash_teacher_kpi_summary and covers only the subjects
          they actually teach, so the admin label would be doubly wrong. */}
      <KpiTile
        eyebrow={scope === "teacher" ? "Your subject average this year" : "School average this year"}
        value={schoolAvg.value}
        sentence={schoolAvg.sentence}
      />
      <KpiTile eyebrow="Students who need help" value={needHelp.value} sentence={needHelp.sentence} />
      <KpiTile
        eyebrow="Decisions waiting for you"
        value={decisions.value}
        sentence={decisions.sentence}
        onClick={() =>
          document.getElementById("dash-flags")?.scrollIntoView({ behavior: "smooth" })
        }
      />
    </div>
  );
}
