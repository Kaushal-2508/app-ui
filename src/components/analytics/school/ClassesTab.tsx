import * as React from "react";
import { useNavigate } from "react-router-dom";
import { School } from "lucide-react";

import { DashboardTable } from "@/components/command-center/DashboardTable";
import { ListRow } from "@/components/shared/surfaces";
import { Badge } from "@/components/ui/badge";
import { FilterChip, FilterRow } from "@/components/shared/nav";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAnalyticsClasses, type AnalyticsRange } from "@/hooks/useSchoolAnalytics";
import { getDisplaySection } from "@/lib/sectionDisplay";

import { num, pct, pct0 } from "./chartTokens";

const PAGE = 25;

const SORTS = [
  { value: "avg_asc", label: "Weakest first" },
  { value: "avg_desc", label: "Strongest first" },
  { value: "results_desc", label: "Most results" },
  { value: "name", label: "Class name" },
] as const;

interface Props {
  institutionId: string;
  range: AnalyticsRange;
  classId: string | null;
}

export function ClassesTab({ institutionId, range, classId }: Props) {
  const navigate = useNavigate();
  const [sort, setSort] = React.useState<string>("avg_asc");
  const [assessedOnly, setAssessedOnly] = React.useState(true);
  const [page, setPage] = React.useState(0);

  // Any filter change invalidates the current page number.
  React.useEffect(() => {
    setPage(0);
  }, [institutionId, range, classId, sort, assessedOnly]);

  const query = useAnalyticsClasses(institutionId, range, classId, {
    assessedOnly,
    sort,
    limit: PAGE,
    offset: page * PAGE,
  });

  const rows = query.data?.rows ?? [];
  const total = query.data?.total ?? 0;
  const shown = page * PAGE + rows.length;

  return (
    <DashboardTable
      title="Classes"
      description={
        assessedOnly
          ? "Every class with at least one result in this period, including any since deactivated. Select a row to open the class."
          : "Every active class plus any deactivated one that still holds results. Select a row to open the class."
      }
      filterSlot={
        <FilterRow>
          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger aria-label="Sort classes" className="h-10 w-[168px] shrink-0 rounded-full text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {SORTS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <FilterChip
            label={assessedOnly ? "With results only" : "All active classes"}
            active={assessedOnly}
            onClick={() => setAssessedOnly((v) => !v)}
            trailing={<span aria-hidden className="hidden" />}
          />
        </FilterRow>
      }
      isLoading={query.isLoading && !query.data}
      isError={query.isError}
      onRetry={() => void query.refetch()}
      isEmpty={!query.isLoading && !query.isError && rows.length === 0}
      emptyTitle={assessedOnly ? "No class has results in this period" : "No active classes"}
      emptyDescription={
        assessedOnly
          ? "Widen the period, or switch to all active classes to see who has nothing recorded."
          : "Add a class to start tracking performance."
      }
      total={total}
      shown={shown}
    >
      <ul className="flex flex-col gap-2">
        {rows.map((row) => {
          const section = getDisplaySection(row.name, row.section);
          const title = section ? `${row.name} ${section}` : row.name;
          return (
            <ListRow
              key={row.class_id}
              as="li"
              leading={
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-brand-primary/10 text-brand-primary">
                  <School className="h-5 w-5" />
                </span>
              }
              title={
                <span className="flex items-center gap-2">
                  <span className="truncate">{title}</span>
                  {!row.is_active && (
                    <Badge variant="outline" className="shrink-0 text-[10px] font-medium">
                      Inactive
                    </Badge>
                  )}
                </span>
              }
              subtitle={
                <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 whitespace-normal">
                  {/* A deactivated class keeps its results but loses its
                      class_assignments, so roster can be 0 while seven students
                      have marks. "7 of 0" reads as a bug, so the denominator is
                      dropped whenever it cannot contain the numerator. */}
                  <span>
                    {row.roster >= row.students_assessed && row.roster > 0
                      ? `${num(row.students_assessed)} of ${num(row.roster)} students assessed`
                      : `${num(row.students_assessed)} ${row.students_assessed === 1 ? "student" : "students"} assessed`}
                  </span>
                  <span aria-hidden>·</span>
                  <span>{num(row.results)} results</span>
                  {row.awaiting_results > 0 && (
                    <>
                      <span aria-hidden>·</span>
                      <span className="text-signal-warn">
                        {num(row.awaiting_results)} awaiting a result
                      </span>
                    </>
                  )}
                  {row.flagged_sessions > 0 && (
                    <>
                      <span aria-hidden>·</span>
                      <span className="text-signal-alert">
                        {num(row.flagged_sessions)} flagged for review
                      </span>
                    </>
                  )}
                </span>
              }
              trailing={
                <div className="text-right">
                  <p className="text-[17px] font-semibold tabular-nums text-ink-900">
                    {pct(row.avg_pct)}
                  </p>
                  <p className="text-xs tabular-nums text-ink-500">{pct0(row.pass_rate)} pass</p>
                </div>
              }
              onClick={() => navigate(`/school/class/${row.class_id}`)}
            />
          );
        })}
      </ul>

      {total > PAGE && (
        <nav
          aria-label="Class pages"
          className="mt-4 flex items-center justify-between gap-3 border-t border-surface-stroke pt-3"
        >
          <p className="text-xs text-ink-500">
            Showing {num(page * PAGE + 1)} to {num(shown)} of {num(total)}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="rounded-lg border border-surface-stroke px-3 py-1.5 text-xs font-medium text-ink-700 transition-colors duration-200 hover:bg-ink-400/5 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={shown >= total}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-lg border border-surface-stroke px-3 py-1.5 text-xs font-medium text-ink-700 transition-colors duration-200 hover:bg-ink-400/5 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40"
            >
              Next
            </button>
          </div>
        </nav>
      )}
    </DashboardTable>
  );
}
