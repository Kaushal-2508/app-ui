import * as React from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Users } from "lucide-react";

import { MobileSheet } from "@/components/shared/sheets";
import { EmptyState, ListRow } from "@/components/shared/surfaces";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  SCORE_BANDS,
  rangeLabel,
  useAnalyticsStudents,
  type AnalyticsRange,
  type ScoreBand,
} from "@/hooks/useSchoolAnalytics";
import { getDisplaySection } from "@/lib/sectionDisplay";

import { num, pct, pct0 } from "./chartTokens";

const PAGE = 50;

interface Props {
  institutionId: string;
  range: AnalyticsRange;
  classId: string | null;
  band: ScoreBand | null;
  onOpenChange: (open: boolean) => void;
}

/**
 * The distribution chart's drill-down. It calls the same banding the chart was
 * drawn from, so the list length always matches the bar the user selected.
 */
export function StudentBandSheet({ institutionId, range, classId, band, onOpenChange }: Props) {
  const navigate = useNavigate();
  const [page, setPage] = React.useState(0);

  React.useEffect(() => {
    setPage(0);
  }, [band, range, classId]);

  const query = useAnalyticsStudents(institutionId, range, classId, band, {
    limit: PAGE,
    offset: page * PAGE,
    enabled: band !== null,
  });

  const rows = query.data?.rows ?? [];
  const total = query.data?.total ?? 0;
  const shown = page * PAGE + rows.length;
  const bandLabel = SCORE_BANDS.find((b) => b.band === band)?.label ?? "All students";

  return (
    <MobileSheet
      open={band !== null}
      onOpenChange={onOpenChange}
      title={bandLabel}
      subtitle={`Averaging ${bandLabel.toLowerCase()} over ${rangeLabel(range).toLowerCase()}`}
      // The default bottom sheet still paints a literal bg-white that does not
      // flip at night (a documented pre-existing issue across 20+ consumers).
      // These children are all ink tokens, so opt into the constrained variant,
      // which takes --surface-card and behaves in both themes.
      desktopWidth="md"
    >
      <div className="flex flex-col gap-3 pb-6">
        {query.isLoading && !query.data ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-card" />
            ))}
          </div>
        ) : query.isError ? (
          <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
              <AlertTriangle className="h-6 w-6" />
            </span>
            <p className="text-sm text-ink-600">
              Couldn't load these students. Close and reopen to try again.
            </p>
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Users className="h-7 w-7" />}
            title="No students in this band"
            description="Nobody averaged into this range over the selected period."
            tone="teal"
          />
        ) : (
          <>
            <p className="text-xs text-ink-500">
              {num(total)} {total === 1 ? "student" : "students"}. Select anyone to open their
              performance page.
            </p>
            <ul className="flex flex-col gap-2">
              {rows.map((row) => {
                const section = getDisplaySection(row.class_name, row.section);
                const cls = row.class_name
                  ? section
                    ? `${row.class_name} ${section}`
                    : row.class_name
                  : "No class";
                return (
                  <ListRow
                    key={row.student_id}
                    as="li"
                    leading={
                      <UserAvatar
                        name={row.full_name}
                        avatarPath={row.avatar_path}
                        className="h-10 w-10"
                      />
                    }
                    title={row.full_name}
                    subtitle={
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 whitespace-normal">
                        <span>{cls}</span>
                        <span aria-hidden>·</span>
                        <span>
                          {num(row.results)} {row.results === 1 ? "result" : "results"}
                        </span>
                      </span>
                    }
                    trailing={
                      <div className="text-right">
                        <p className="text-[17px] font-semibold tabular-nums text-ink-900">
                          {pct(row.avg_pct)}
                        </p>
                        <p className="text-xs tabular-nums text-ink-500">
                          {pct0(row.pass_rate)} pass
                        </p>
                      </div>
                    }
                    onClick={() => {
                      onOpenChange(false);
                      navigate(`/school/student/${row.student_id}`);
                    }}
                  />
                );
              })}
            </ul>

            {total > PAGE && (
              <nav
                aria-label="Student pages"
                className="flex items-center justify-between gap-3 border-t border-surface-stroke pt-3"
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
          </>
        )}
      </div>
    </MobileSheet>
  );
}
