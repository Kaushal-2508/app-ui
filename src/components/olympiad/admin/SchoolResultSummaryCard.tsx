import { type ResultSummary } from "@/hooks/olympiad/useOlympiadSchoolResultSummary";

const TIERS: { label: string; key: keyof Pick<ResultSummary, "gold_count" | "silver_count" | "bronze_count" | "participation_count" | "absent_count"> }[] = [
  { label: "Gold", key: "gold_count" },
  { label: "Silver", key: "silver_count" },
  { label: "Bronze", key: "bronze_count" },
  { label: "Participation", key: "participation_count" },
  { label: "Absent", key: "absent_count" },
];

export function SchoolResultSummaryCard({ summary }: { summary: ResultSummary }) {
  return (
    <section className="surface-card frosted-shadow rounded-card p-5 space-y-4">
      <header className="flex items-center justify-between gap-2">
        <div>
          <p className="eyebrow">Results</p>
          <h3 className="text-base font-semibold text-ink-900">
            {summary.published ? "Published results" : "Provisional (not yet published)"}
          </h3>
        </div>
        <span className="text-sm text-ink-600">Avg {summary.avg_percentage}%</span>
      </header>

      {summary.published ? (
        <div className="grid grid-cols-3 gap-2 text-center sm:grid-cols-5">
          {TIERS.map(({ label, key }) => (
            <div key={label} className="rounded-md bg-surface-base py-2">
              <p className="text-lg font-bold text-ink-900">{summary[key] ?? 0}</p>
              <p className="text-[11px] text-ink-500">{label}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-ink-600">
          {summary.attempted_count ?? 0} student{(summary.attempted_count ?? 0) === 1 ? "" : "s"} attempted. Publish to finalize tiers and ranks.
        </p>
      )}

      {summary.top_scorers.length > 0 && (
        <div className="space-y-1.5">
          <p className="eyebrow">Top scorers</p>
          {summary.top_scorers.map((t) => (
            <div key={t.roll_number} className="flex items-center justify-between text-sm">
              <span className="text-ink-900">#{t.school_rank} {t.full_name}</span>
              <span className="text-ink-600">{t.percentage}%</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
