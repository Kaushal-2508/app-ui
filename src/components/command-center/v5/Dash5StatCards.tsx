import { useRosterCounts } from "@/hooks/dashboard/useAdminDashboardData";
import { useDash5Tree } from "@/hooks/dashboard/useDash5";

import { V5Error, V5Loading } from "./primitives";

/**
 * The four cards across the top of the reference. Today's two come from
 * dash_admin_roster_counts, which already reads the register the canonical way;
 * the year's two come from the same dash5_tree total that the table underneath
 * prints, so the header and the table can never quote different figures.
 */

interface Card {
  label: string;
  value: string;
  of?: string;
  pct: number | null;
  caption: string;
  good: boolean;
}

function StatCard({ c }: { c: Card }) {
  const tone = c.good ? "var(--dash-exc)" : "var(--dash-warning)";
  return (
    <div className="surface-card frosted-shadow rounded-[13px] border border-surface-stroke px-4 py-3">
      <p className="m-0 text-[11px] font-bold uppercase tracking-[0.05em] text-ink-400">{c.label}</p>
      <p className="m-0 mt-1 text-[28px] font-extrabold leading-[1.1] tracking-[-0.035em] text-ink-900 tabular-nums">
        {c.value}
        {c.of && <span className="text-[15px] font-bold text-ink-400">/{c.of}</span>}
      </p>
      <div className="mb-2 mt-0.5 flex items-baseline gap-2">
        {c.pct != null && (
          <span className="text-[13px] font-extrabold tabular-nums" style={{ color: `hsl(${tone})` }}>
            {c.pct.toFixed(1)}%
          </span>
        )}
        <span className="text-[11.5px] font-medium text-ink-500">{c.caption}</span>
      </div>
      <div className="h-[5px] overflow-hidden rounded-[3px] bg-surface-stroke">
        <span
          className="block h-full rounded-[3px]"
          style={{ width: `${Math.min(100, Math.max(0, c.pct ?? 0))}%`, background: `hsl(${tone})` }}
        />
      </div>
    </div>
  );
}

export function Dash5StatCards() {
  const roster = useRosterCounts();
  const tree = useDash5Tree("wings", null, null);

  if (roster.isLoading || tree.isLoading) return <V5Loading label="Loading today's numbers…" />;
  // Error before empty, always: a failed read must never render as zeros.
  if (roster.isError || tree.isError) {
    return (
      <V5Error
        label="Couldn't load the headline numbers."
        onRetry={() => { void roster.refetch(); void tree.refetch(); }}
      />
    );
  }

  const r = roster.data;
  const t = tree.data?.total;
  if (!r || !t) return <V5Error label="Couldn't load the headline numbers." />;

  const sPresent = r.students_present.present;
  const sTotal = r.students.count;
  const tPresent = r.staff_present.present;
  const tStaff = r.staff.count;
  const lessonPct = t.lessons_planned > 0 ? (t.lessons_taught / t.lessons_planned) * 100 : null;

  const cards: Card[] = [
    {
      label: "Students present today",
      // The register drives this, so an unmarked day says so rather than
      // printing a zero that reads as an empty school.
      value: r.students_present.marked ? sPresent.toLocaleString() : "N/A",
      of: r.students_present.marked ? sTotal.toLocaleString() : undefined,
      pct: r.students_present.marked && sTotal > 0 ? (sPresent / sTotal) * 100 : null,
      caption: r.students_present.marked
        ? `${Math.max(0, sTotal - sPresent).toLocaleString()} not present`
        : "Register not taken yet today",
      good: sTotal > 0 && sPresent / sTotal >= 0.9,
    },
    {
      label: "Teachers present today",
      value: tPresent.toLocaleString(),
      of: tStaff.toLocaleString(),
      pct: tStaff > 0 ? (tPresent / tStaff) * 100 : null,
      caption: `${Math.max(0, tStaff - tPresent).toLocaleString()} not checked in`,
      good: tStaff > 0 && tPresent / tStaff >= 0.9,
    },
    {
      label: "School average score",
      value: t.accuracy == null ? "N/A" : `${t.accuracy.toFixed(1)}%`,
      pct: t.accuracy,
      caption: `across ${t.papers.toLocaleString()} papers this year`,
      good: (t.accuracy ?? 0) >= 75,
    },
    {
      label: "Lesson plans covered",
      value: lessonPct == null ? "N/A" : `${Math.round(lessonPct)}%`,
      pct: lessonPct,
      caption: `${t.lessons_taught.toLocaleString()} of ${t.lessons_planned.toLocaleString()} planned`,
      good: (lessonPct ?? 0) >= 75,
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((c) => <StatCard key={c.label} c={c} />)}
    </div>
  );
}
