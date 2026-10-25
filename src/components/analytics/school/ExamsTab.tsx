import * as React from "react";
import { useNavigate } from "react-router-dom";
import { FileText } from "lucide-react";

import { DashboardTable } from "@/components/command-center/DashboardTable";
import { ListRow } from "@/components/shared/surfaces";
import { Badge } from "@/components/ui/badge";
import { FilterRow } from "@/components/shared/nav";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAnalyticsExams, type AnalyticsRange, type ExamRow } from "@/hooks/useSchoolAnalytics";

import { longDate, num, pct, pct0 } from "./chartTokens";

const PAGE = 25;
const ALL = "__all__";

/** Exactly the values the exam_status enum allows, in lifecycle order. */
const STATUSES = [
  { value: "draft", label: "Draft" },
  { value: "ready", label: "Ready" },
  { value: "published", label: "Published" },
  { value: "active", label: "In progress" },
  { value: "completed", label: "Completed" },
  { value: "archived", label: "Archived" },
] as const;

/** exams.exam_type CHECK values. */
const TYPES = [
  { value: "term", label: "Term" },
  { value: "unit", label: "Unit" },
  { value: "weekly", label: "Weekly" },
  { value: "unspecified", label: "Unspecified" },
] as const;

function statusLabel(status: string): string {
  return STATUSES.find((s) => s.value === status)?.label ?? status;
}

/**
 * Where a row leads. Hybrid exams live on a separate evaluation plane and
 * results-only exams have no attempt screen, so neither can use the standard
 * results route.
 */
function examHref(row: ExamRow): string {
  if (row.mode === "hybrid") return `/evaluations/hybrid?examId=${row.exam_id}`;
  if (row.is_results_only) return `/exams/${row.exam_id}/offline-marks`;
  if (row.status === "draft") return `/exams/edit/${row.exam_id}`;
  return `/exams/${row.exam_id}/results`;
}

interface Props {
  institutionId: string;
  range: AnalyticsRange;
  classId: string | null;
}

export function ExamsTab({ institutionId, range, classId }: Props) {
  const navigate = useNavigate();
  const [status, setStatus] = React.useState<string>(ALL);
  const [examType, setExamType] = React.useState<string>(ALL);
  const [page, setPage] = React.useState(0);

  React.useEffect(() => {
    setPage(0);
  }, [institutionId, range, classId, status, examType]);

  const filters = React.useMemo(
    () => ({
      ...(status !== ALL ? { status } : {}),
      ...(examType !== ALL ? { exam_type: examType } : {}),
      ...(classId ? { class_id: classId } : {}),
    }),
    [status, examType, classId],
  );

  const query = useAnalyticsExams(institutionId, range, filters, {
    limit: PAGE,
    offset: page * PAGE,
  });

  const rows = query.data?.rows ?? [];
  const total = query.data?.total ?? 0;
  const shown = page * PAGE + rows.length;

  return (
    <DashboardTable
      title="Exams"
      description="Every exam dated inside this period, with how many students it actually reached. Select a row to open it."
      filterSlot={
        <FilterRow>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger aria-label="Exam status" className="h-10 w-[150px] shrink-0 rounded-full text-sm">
              <SelectValue placeholder="Any status" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value={ALL}>Any status</SelectItem>
                {STATUSES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Select value={examType} onValueChange={setExamType}>
            <SelectTrigger aria-label="Exam type" className="h-10 w-[140px] shrink-0 rounded-full text-sm">
              <SelectValue placeholder="Any type" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value={ALL}>Any type</SelectItem>
                {TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </FilterRow>
      }
      isLoading={query.isLoading && !query.data}
      isError={query.isError}
      onRetry={() => void query.refetch()}
      isEmpty={!query.isLoading && !query.isError && rows.length === 0}
      emptyTitle="No exams in this period"
      emptyDescription="Widen the period or clear the filters above."
      emptyAction={{ label: "Create an exam", onClick: () => navigate("/exams/create") }}
      total={total}
      shown={shown}
    >
      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <ListRow
            key={row.exam_id}
            as="li"
            leading={
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-brand-primary/10 text-brand-primary">
                <FileText className="h-5 w-5" />
              </span>
            }
            /* The status badge lived beside the title and ate most of the row at
               375px, truncating "Voice Check (copy)" to "Voice Ch...". It reads
               just as well as the first item of the detail line. */
            title={row.title}
            subtitle={
              <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 whitespace-normal">
                <Badge variant="outline" className="shrink-0 text-[10px] font-medium">
                  {statusLabel(row.status)}
                </Badge>
                <span>{longDate(row.exam_date)}</span>
                {row.subjects && (
                  <>
                    <span aria-hidden>·</span>
                    <span>{row.subjects}</span>
                  </>
                )}
                <span aria-hidden>·</span>
                {/* `sat` excludes absentees; `attempted` includes them, which is
                    why "9 of 9 sat it, 2 absent" used to appear on one line. */}
                <span>
                  {num(row.sat)} of {num(row.assigned)} sat it
                </span>
                {row.absent > 0 && (
                  <>
                    <span aria-hidden>·</span>
                    <span>{num(row.absent)} absent</span>
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
                {/* "No results yet" here squeezed the title column on a phone,
                    and the N/A above already says it. */}
                {row.results > 0 && (
                  <p className="text-xs tabular-nums text-ink-500">{pct0(row.pass_rate)} pass</p>
                )}
              </div>
            }
            onClick={() => navigate(examHref(row))}
          />
        ))}
      </ul>

      {total > PAGE && (
        <nav
          aria-label="Exam pages"
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
