import { useMemo } from "react";
import { BarChart3, Crown, Layers, Users } from "lucide-react";
import { MobileSheet } from "@/components/shared/sheets/MobileSheet";
import { EmptyState } from "@/components/shared/surfaces/EmptyState";
import { cn } from "@/lib/utils";
import type { RosterStudent } from "@/hooks/olympiad/useOlympiadClassRoster";
import type { StudentResultRow } from "@/hooks/olympiad/useOlympiadStudentResults";

export type ClassMetric = "enrolled" | "appeared" | "average" | "highest" | "absent";

const TIER_PILL: Record<string, string> = {
  gold: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  silver: "bg-slate-200 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300",
  bronze: "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300",
  participation: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
};
const TIER_LABEL: Record<string, string> = { gold: "Gold", silver: "Silver", bronze: "Bronze", participation: "Part." };

type ReportLite = {
  enrolled: number;
  appeared: number;
  absent: number;
  avg_percentage: number;
  max_percentage: number;
  channel: { cash: number; online: number };
};

/**
 * Drill-down sheet behind every class KPI tile. Each metric resolves to the
 * relevant subset of students (+ headline stat); tapping a student hands off to
 * the parent (which opens the student detail sheet).
 */
export function ClassMetricSheet({
  metric,
  onOpenChange,
  roster,
  studentResults,
  report,
  onSelectStudent,
}: {
  metric: ClassMetric | null;
  onOpenChange: (open: boolean) => void;
  roster: RosterStudent[];
  studentResults: Record<string, StudentResultRow> | undefined;
  report: ReportLite | undefined;
  onSelectStudent: (s: RosterStudent) => void;
}) {
  const list = useMemo(() => {
    const tierOf = (s: RosterStudent) => studentResults?.[s.id]?.certificate_tier;
    const pctOf = (s: RosterStudent) => studentResults?.[s.id]?.percentage ?? 0;
    const byRoll = (a: RosterStudent, b: RosterStudent) =>
      a.roll_number.localeCompare(b.roll_number, undefined, { numeric: true });
    const active = roster.filter((s) => s.status === "active");
    const appeared = active.filter((s) => {
      const t = tierOf(s);
      return t != null && t !== "absent";
    });
    const byScore = [...appeared].sort((a, b) => pctOf(b) - pctOf(a));
    switch (metric) {
      case "enrolled":
        return [...active].sort(byRoll);
      case "appeared":
      case "average":
      case "highest":
        return byScore;
      case "absent":
        return active.filter((s) => tierOf(s) === "absent").sort(byRoll);
      default:
        return [];
    }
  }, [metric, roster, studentResults]);

  if (!metric) return null;

  const enrolled = report?.enrolled ?? roster.filter((s) => s.status === "active").length;
  const avg = report?.avg_percentage ?? 0;
  const pct = (s: RosterStudent) => studentResults?.[s.id]?.percentage;
  const tierOf = (s: RosterStudent) => studentResults?.[s.id]?.certificate_tier;

  const HEAD: Record<ClassMetric, { title: string; icon: React.ReactNode; value: string; label: string; sub?: string }> = {
    enrolled: {
      title: "Enrolled students",
      icon: <Users className="h-4 w-4" />,
      value: String(enrolled),
      label: "Students enrolled",
      sub: report ? `${report.channel.cash} cash · ${report.channel.online} online` : undefined,
    },
    appeared: {
      title: "Appeared",
      icon: <Crown className="h-4 w-4" />,
      value: `${report?.appeared ?? list.length}/${enrolled}`,
      label: "Sat the exam",
      sub: report ? `${report.absent} absent` : undefined,
    },
    average: {
      title: "Class average",
      icon: <BarChart3 className="h-4 w-4" />,
      value: `${avg}%`,
      label: "Average score",
      sub: "Across students who appeared · green = at/above average",
    },
    highest: {
      title: "Top performers",
      icon: <Crown className="h-4 w-4" />,
      value: `${report?.max_percentage ?? 0}%`,
      label: "Highest score",
      sub: "Ranked highest first",
    },
    absent: {
      title: "Absent students",
      icon: <Layers className="h-4 w-4" />,
      value: String(report?.absent ?? list.length),
      label: "Did not appear",
    },
  };
  const head = HEAD[metric];
  const showScore = metric === "appeared" || metric === "average" || metric === "highest";
  const showRank = metric === "highest" || metric === "average";

  return (
    <MobileSheet
      open={!!metric}
      onOpenChange={onOpenChange}
      title={head.title}
      subtitle={`${list.length} student${list.length === 1 ? "" : "s"}`}
      icon={head.icon}
    >
      <div className="surface-card frosted-shadow rounded-card mb-3 p-4">
        <p className="eyebrow">{head.label}</p>
        <p className="mt-0.5 text-3xl font-bold tabular-nums text-ink-900">{head.value}</p>
        {head.sub && <p className="mt-1 text-xs text-ink-500">{head.sub}</p>}
      </div>

      {list.length === 0 ? (
        <EmptyState icon={head.icon} title="No students here" reason="noData" />
      ) : (
        <ul className="space-y-1.5 pb-2">
          {list.map((s, i) => {
            const p = pct(s);
            const tier = tierOf(s);
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => onSelectStudent(s)}
                  className="flex w-full items-center gap-3 rounded-xl border border-surface-stroke bg-surface-card px-3 py-2.5 text-left transition-colors hover:border-brand-primary/40 hover:bg-brand-primary/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40"
                >
                  {showRank && (
                    <span
                      className={cn(
                        "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                        i === 0
                          ? "bg-amber-400 text-amber-950"
                          : i === 1
                            ? "bg-slate-300 text-slate-800"
                            : i === 2
                              ? "bg-orange-300 text-orange-950"
                              : "bg-muted text-ink-600",
                      )}
                    >
                      {i + 1}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink-900">{s.full_name}</p>
                    <p className="text-[11px] text-ink-500">{s.roll_number}</p>
                  </div>
                  {showScore && p != null ? (
                    <span className="flex shrink-0 items-center gap-2">
                      {tier && TIER_LABEL[tier] && (
                        <span className={cn("hidden rounded-full px-2 py-0.5 text-[11px] font-semibold sm:inline-flex", TIER_PILL[tier] ?? "")}>
                          {TIER_LABEL[tier]}
                        </span>
                      )}
                      <span
                        className={cn(
                          "text-sm font-semibold tabular-nums",
                          metric === "average"
                            ? p >= avg
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-amber-600 dark:text-amber-400"
                            : "text-ink-900",
                        )}
                      >
                        {p}%
                      </span>
                    </span>
                  ) : metric === "enrolled" ? (
                    <span className="shrink-0 text-[11px] font-medium text-ink-500">
                      {s.enrollment_channel === "teacher_cash" ? "Cash" : "Online"}
                    </span>
                  ) : metric === "absent" ? (
                    <span className="shrink-0 rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
                      Absent
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </MobileSheet>
  );
}
