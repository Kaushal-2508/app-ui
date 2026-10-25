import { useMemo, useState } from "react";
import { UserX } from "lucide-react";

import { WidgetCard } from "@/components/command-center/WidgetCard";
import { cn } from "@/lib/utils";
import { useStudentPortalAdoption } from "@/hooks/dashboard/useCoordinatorDashboardData";

/** Bar fill by adoption band, via tokens so it flips in dark mode. */
function barTone(pct: number | null) {
  if (pct == null) return "bg-[hsl(var(--surface-stroke))]";
  if (pct >= 60) return "bg-emerald-500";
  if (pct >= 40) return "bg-brand-primary";
  if (pct >= 20) return "bg-amber-500";
  return "bg-rose-500";
}

function initials(name: string | null | undefined) {
  return (name ?? "")
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/** Fetched sample — wide enough that the class tabs have something to filter. */
const LIST_LIMIT = 24;
/** Rendered per tab. The card is one panel among fifteen; 24 name rows turned it
 *  into the page. The Students table below is where you go for the full list. */
const VISIBLE_ROWS = 6;

/**
 * "Are the students in my wing actually using SALCI?"
 *
 * Follows the reference mockup's adoption card: the never-logged-in alert, a
 * four-across stat row, per-class adoption bars weakest-first, and a
 * class-filtered list of the students who have never opened the portal.
 *
 * Logins only, deliberately. Submission and attempt counts belong to the
 * homework and exam surfaces, and blending them here would soften the blunt
 * fact a coordinator needs: how many pupils have never signed in at all.
 */
export function StudentAdoptionWidget() {
  const { data, isLoading, isError, refetch } = useStudentPortalAdoption(LIST_LIMIT);
  const [classFilter, setClassFilter] = useState<string>("all");

  const total = data?.total ?? 0;
  const never = data?.never_signed_in ?? 0;
  const neverPct = total > 0 ? Math.round((never * 100) / total) : 0;
  const worst = (data?.by_class ?? []).slice(0, 5);
  const neverList = useMemo(() => data?.never_list ?? [], [data]);

  // Tabs come from the sample actually returned, so a tab can never show zero.
  const tabs = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of neverList) {
      const key = s.class ?? "Unassigned";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  }, [neverList]);

  const filtered = useMemo(
    () =>
      classFilter === "all"
        ? neverList
        : neverList.filter((s) => (s.class ?? "Unassigned") === classFilter),
    [neverList, classFilter],
  );

  return (
    <WidgetCard
      title="Student portal adoption"
      caption="Share of your wing's students who have signed in. Weakest classes first, so you know which register to walk into."
      isLoading={isLoading}
      isError={isError}
      onRetry={() => void refetch()}
      isEmpty={!isLoading && !isError && total === 0}
      emptyTitle="No students in your wing yet"
      emptyDescription="Once classes are populated their portal use will show up here."
      className="scroll-mt-24"
    >
      <div id="dash-student-adoption">
        {never > 0 && (
          <div className="mb-4 flex items-start gap-3 rounded-xl border border-rose-500/25 bg-rose-500/[0.07] px-3.5 py-3">
            <UserX className="mt-0.5 h-[18px] w-[18px] shrink-0 text-rose-600" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-[13.5px] font-bold text-rose-600">
                {never} of {total} students have never signed in
              </p>
              <p className="mt-0.5 text-[12.5px] leading-[18px] text-ink-600">
                That is {neverPct}% of the wing holding accounts they have never opened.
              </p>
            </div>
          </div>
        )}

        <dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {[
            { label: "Signed in today", value: data?.active_1d ?? 0 },
            { label: "Last 7 days", value: data?.active_7d ?? 0 },
            { label: "Last 30 days", value: data?.active_30d ?? 0 },
            { label: "Never", value: never, danger: true },
          ].map((s) => (
            <div
              key={s.label}
              className="rounded-xl border border-[hsl(var(--surface-stroke))] bg-[hsl(var(--ink-400)/0.04)] px-3 py-2.5"
            >
              <dt className="text-[11.5px] font-medium text-ink-500">{s.label}</dt>
              <dd
                className={cn(
                  "mt-1 text-[21px] font-bold leading-none tabular-nums",
                  s.danger && s.value > 0 ? "text-rose-600" : "text-ink-900",
                )}
              >
                {s.value}
                <span className="ml-1 text-[12px] font-semibold text-ink-400">/ {total}</span>
              </dd>
            </div>
          ))}
        </dl>

        {worst.length > 0 && (
          <div className="mt-5 border-t border-[hsl(var(--surface-stroke))] pt-4">
            <p className="mb-3 text-[12.5px] font-semibold text-ink-700">
              Adoption by class · active in the last 30 days · weakest {worst.length} of{" "}
              {data?.by_class.length ?? 0}
            </p>
            <ul className="space-y-2.5">
              {worst.map((c) => (
                <li
                  key={c.class_id}
                  className="grid grid-cols-[minmax(0,7.5rem)_1fr_auto] items-center gap-3"
                >
                  <span className="truncate text-[12.5px] font-medium text-ink-700">
                    {c.class_name}
                  </span>
                  <span className="h-2.5 w-full overflow-hidden rounded-full bg-[hsl(var(--surface-stroke))]">
                    <span
                      className={cn("block h-full rounded-full", barTone(c.pct))}
                      style={{ width: `${Math.min(Math.max(c.pct ?? 0, 0), 100)}%` }}
                    />
                  </span>
                  <span className="shrink-0 text-right text-[12.5px] font-bold tabular-nums text-ink-700">
                    {c.pct ?? 0}%
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {neverList.length > 0 && (
          <div className="mt-5 border-t border-[hsl(var(--surface-stroke))] pt-4">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-[12.5px] font-semibold text-ink-700">Never opened the portal</p>
              <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-rose-600">
                {never} flagged
              </span>
            </div>

            <div className="scrollbar-hide -mx-1 mb-3 flex gap-1.5 overflow-x-auto px-1">
              {[
                { key: "all", label: `All (${neverList.length})` },
                ...tabs.map(([cls, n]) => ({ key: cls, label: `${cls} (${n})` })),
              ].map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setClassFilter(t.key)}
                  className={cn(
                    "whitespace-nowrap rounded-full px-3 py-1 text-[11.5px] font-bold transition-colors",
                    classFilter === t.key
                      ? "bg-ink-900 text-[hsl(var(--surface-card))]"
                      : "bg-[hsl(var(--ink-400)/0.08)] text-ink-500 hover:text-ink-900",
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <ul className="divide-y divide-[hsl(var(--surface-stroke))]">
              {filtered.slice(0, VISIBLE_ROWS).map((s) => (
                <li key={s.student_id} className="flex items-center gap-3 py-2.5 first:pt-0">
                  <span
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-secondary/15 text-[11px] font-bold text-brand-secondary"
                    aria-hidden="true"
                  >
                    {initials(s.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold text-ink-900">
                      {s.name || "Unnamed student"}
                    </p>
                    <p className="truncate text-[11.5px] text-ink-500">{s.class ?? "No class"}</p>
                  </div>
                </li>
              ))}
            </ul>

            <p className="mt-3 text-[11.5px] text-ink-500">
              Showing {Math.min(filtered.length, VISIBLE_ROWS)} of {never} who have never signed in.
              The Students table below lists the rest.
            </p>
          </div>
        )}
      </div>
    </WidgetCard>
  );
}
