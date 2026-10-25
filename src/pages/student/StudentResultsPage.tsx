import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Trophy,
  CheckCircle2,
  AlertCircle,
  BarChart3,
  Camera,
  ChevronRight,
} from "lucide-react";
import { useStudentResultsDetailed, type DetailedStudentResult } from "@/hooks/useStudentResultsDetailed";
import {
  useStudentHybridResults,
  type StudentHybridResultRow,
} from "@/hooks/useStudentHybridResults";
import { format } from "date-fns";
import { useNavigate, useSearchParams } from "react-router-dom";
import { SubjectTrajectory, type TrajectoryPoint } from "@/components/student/SubjectTrajectory";
import { ChapterAnalysisChart } from "@/components/student/ChapterAnalysisChart";
import { formatNumber } from "@/lib/formatNumber";

import { PageShell, PageHeader } from "@/components/shared/page";
import { StatTile, StatTileGrid, EmptyState } from "@/components/shared/surfaces";
import { FilterRow, FilterSheet } from "@/components/shared/nav";

/** Human labels for the exam_type filter. A quiz and a term exam must never mix. */
const TEST_TYPE_LABELS: Record<string, string> = {
  term: "Term exam",
  unit: "Unit test",
  weekly: "Weekly test",
  unspecified: "Other",
};

type TimeRange = "all" | "last_5" | "last_3_months" | "this_year";

/** One entry in the merged results feed — a graded exam result or a marked
 *  hybrid attempt. Both are "a test the student has been marked on", so they are
 *  sorted together by date rather than split into separate blocks. */
type FeedItem =
  | { kind: "result"; key: string; date: number; result: DetailedStudentResult }
  | { kind: "hybrid"; key: string; date: number; hybrid: StudentHybridResultRow };

const TIME_RANGE_LABELS: Record<TimeRange, string> = {
  all: "All time",
  last_5: "Last 5 tests",
  last_3_months: "Last 3 months",
  this_year: "This year",
};

/** Plural test-type wording for the chapter chart's caption. "Other" has no
 *  sensible plural, so an unspecified type falls back to the neutral phrase. */
const TEST_TYPE_PLURAL: Record<string, string> = {
  term: "term exams",
  unit: "unit tests",
  weekly: "weekly tests",
  unspecified: "your tests",
};

const TIME_RANGE_PHRASE: Record<TimeRange, string> = {
  all: "",
  last_5: ", most recent 5",
  last_3_months: ", last 3 months",
  this_year: ", this year",
};

export default function StudentResultsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { data: results, isLoading } = useStudentResultsDetailed();
  const { data: hybridResults, isLoading: hybridLoading } = useStudentHybridResults();

  // Applied filters (drive the list).
  const [subjectFilter, setSubjectFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [timeRange, setTimeRange] = useState<TimeRange>("all");

  // Pending filters (committed on Apply).
  const [pendingSubject, setPendingSubject] = useState<string>("all");
  const [pendingType, setPendingType] = useState<string>("all");
  const [pendingTimeRange, setPendingTimeRange] = useState<TimeRange>("all");

  const rows = useMemo<DetailedStudentResult[]>(() => results ?? [], [results]);

  // Filter option lists derived from the student's own results.
  const subjectOptions = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => r.subjects.forEach((s) => set.add(s)));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const typeOptions = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => set.add(r.exam_type || "unspecified"));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  /**
   * Deep link support: `/student/results?subject=Art` arrives from the dashboard's
   * Subject snapshot, so the page opens already filtered to that subject (and the
   * subject trajectory renders straight away).
   *
   * Matching is case-insensitive because the snapshot's names are normalised
   * server-side (`initcap(lower(btrim(name)))`) while this page lists the raw
   * `universal_subjects.name`. Applied ONCE — guarded by a ref so changing or
   * clearing the filter afterwards is never undone by the lingering query param.
   */
  const appliedFromUrlRef = useRef(false);
  useEffect(() => {
    if (appliedFromUrlRef.current) return;
    const wanted = searchParams.get("subject");
    if (!wanted || subjectOptions.length === 0) return;

    appliedFromUrlRef.current = true;
    const match = subjectOptions.find(
      (s) => s.trim().toLowerCase() === wanted.trim().toLowerCase(),
    );
    if (match) {
      setSubjectFilter(match);
      setPendingSubject(match);
    }
  }, [searchParams, subjectOptions]);

  const applyPendingFilters = () => {
    setSubjectFilter(pendingSubject);
    setTypeFilter(pendingType);
    setTimeRange(pendingTimeRange);
  };

  const resetPendingFilters = () => {
    setPendingSubject("all");
    setPendingType("all");
    setPendingTimeRange("all");
  };

  const clearAllFilters = () => {
    setSubjectFilter("all");
    setTypeFilter("all");
    setTimeRange("all");
    resetPendingFilters();
  };

  // Apply Subject + Test-type + Time-range filters.
  const filteredRows = useMemo(() => {
    // Sort newest-first by exam date for the list display.
    const byDateDesc = [...rows].sort(
      (a, b) => new Date(b.exam_date).getTime() - new Date(a.exam_date).getTime(),
    );

    const matchesSubject = (r: DetailedStudentResult) =>
      subjectFilter === "all" || r.subjects.includes(subjectFilter);
    const matchesType = (r: DetailedStudentResult) =>
      typeFilter === "all" || (r.exam_type || "unspecified") === typeFilter;

    const subjectAndType = byDateDesc.filter((r) => matchesSubject(r) && matchesType(r));

    if (timeRange === "all") return subjectAndType;

    if (timeRange === "last_5") {
      // "This term-ish": the most recent ~5 matching tests.
      return subjectAndType.slice(0, 5);
    }

    const now = Date.now();
    const cutoff =
      timeRange === "last_3_months"
        ? now - 1000 * 60 * 60 * 24 * 92
        : new Date(new Date().getFullYear(), 0, 1).getTime(); // this_year: Jan 1
    return subjectAndType.filter((r) => new Date(r.exam_date).getTime() >= cutoff);
  }, [rows, subjectFilter, typeFilter, timeRange]);

  const activeFilterCount =
    (subjectFilter !== "all" ? 1 : 0) +
    (typeFilter !== "all" ? 1 : 0) +
    (timeRange !== "all" ? 1 : 0);

  // Stat tiles respect the active filters so a quiz is never mixed into a term average.
  // Exams the student was absent for are excluded throughout: they carry a
  // stored 0, and counting that as a failed attempt or averaging it in would
  // report a performance drop for an exam that was never sat.
  const attemptedRows = filteredRows.filter((r) => !r.is_absent);
  const passCount = attemptedRows.filter((r) => r.is_pass).length;
  const failCount = attemptedRows.filter((r) => !r.is_pass).length;
  const avgPercentage = attemptedRows.length
    ? (
        attemptedRows.reduce((sum, r) => sum + (r.percentage ?? 0), 0) / attemptedRows.length
      ).toFixed(1)
    : "0.0";

  // Subject trajectory (own-data): chronological points across the filtered tests
  // in the selected subject. Only shown when a single subject is selected.
  const trajectoryPoints = useMemo<TrajectoryPoint[]>(() => {
    if (subjectFilter === "all") return [];
    return [...filteredRows]
      // An absentee's stored 0 would draw a cliff in the trajectory for an exam
      // the student never sat.
      .filter((r) => !r.is_absent)
      .sort((a, b) => new Date(a.exam_date).getTime() - new Date(b.exam_date).getTime())
      .map((r) => ({
        id: r.id,
        label: r.exam_title,
        date: r.exam_date,
        percentage: r.percentage ?? 0,
      }));
  }, [filteredRows, subjectFilter]);

  /**
   * The same window the list and the trajectory use, expressed as RPC arguments
   * for the chapter chart. Derived from the identical constants used above so
   * the bar chart can never end up describing a wider set of tests than the line
   * chart sitting right on top of it.
   */
  const chapterWindow = useMemo(() => {
    let from: string | null = null;
    let lastN: number | null = null;
    if (timeRange === "last_5") {
      lastN = 5;
    } else if (timeRange === "last_3_months") {
      from = format(new Date(Date.now() - 1000 * 60 * 60 * 24 * 92), "yyyy-MM-dd");
    } else if (timeRange === "this_year") {
      from = format(new Date(new Date().getFullYear(), 0, 1), "yyyy-MM-dd");
    }
    const typePhrase =
      typeFilter === "all" ? "your tests" : (TEST_TYPE_PLURAL[typeFilter] ?? "your tests");
    return {
      examType: typeFilter === "all" ? null : typeFilter,
      from,
      lastN,
      windowLabel: `${typePhrase}${TIME_RANGE_PHRASE[timeRange]}`,
    };
  }, [typeFilter, timeRange]);

  /**
   * ONE chronological feed of everything the student has been marked on.
   *
   * Hybrid attempts live on a separate data plane, but a student doesn't think in
   * data planes — they think "my results". Listing them as their own block meant a
   * hybrid exam sat by its kind rather than its date, so a paper marked yesterday
   * could be stranded below months of older results. Merging and sorting by date
   * puts the newest test first, whatever way it was delivered.
   *
   * Hybrid rows carry no subject and no exam_type, so they can only honour the
   * time range. When the student filters by subject or test type they're asking a
   * question those rows cannot answer, so they drop out rather than appear to
   * ignore the filter.
   */
  const feed = useMemo<FeedItem[]>(() => {
    const items: FeedItem[] = filteredRows.map((result) => ({
      kind: "result",
      key: result.id,
      date: new Date(result.exam_date).getTime(),
      result,
    }));

    if (subjectFilter === "all" && typeFilter === "all") {
      const now = Date.now();
      const cutoff =
        timeRange === "last_3_months"
          ? now - 1000 * 60 * 60 * 24 * 92
          : timeRange === "this_year"
            ? new Date(new Date().getFullYear(), 0, 1).getTime()
            : null;

      (hybridResults ?? []).forEach((hybrid) => {
        const date = hybrid.evaluated_at ? new Date(hybrid.evaluated_at).getTime() : 0;
        if (cutoff !== null && date < cutoff) return;
        items.push({ kind: "hybrid", key: hybrid.attempt_id, date, hybrid });
      });
    }

    items.sort((a, b) => b.date - a.date);
    // "Last 5 tests" means the five most recent overall, not five per data plane.
    return timeRange === "last_5" ? items.slice(0, 5) : items;
  }, [filteredRows, hybridResults, subjectFilter, typeFilter, timeRange]);

  if (isLoading) {
    return <PageSkeleton />;
  }

  const hybridCount = hybridLoading ? 0 : (hybridResults?.length ?? 0);
  const noResultsAtAll = rows.length === 0 && hybridCount === 0;
  const filteredEmpty = !noResultsAtAll && feed.length === 0;

  return (
    <PageShell>
      <PageHeader
        icon={<Trophy className="h-5 w-5" />}
        title="My Results"
        subtitle="View your exam results and grades"
      />

      <StatTileGrid cols={2} mdCols={4}>
        <StatTile
          label="Total Results"
          value={formatNumber(filteredRows.length)}
          icon={<BarChart3 className="h-5 w-5" />}
          tone="teal"
        />
        <StatTile
          label="Passed"
          value={formatNumber(passCount)}
          icon={<CheckCircle2 className="h-5 w-5" />}
          tone="mint"
        />
        <StatTile
          label="Failed"
          value={formatNumber(failCount)}
          icon={<AlertCircle className="h-5 w-5" />}
          tone="rose"
        />
        <StatTile
          label={typeFilter === "all" ? "Average" : `${TEST_TYPE_LABELS[typeFilter] ?? "Average"} avg`}
          value={`${avgPercentage}%`}
          icon={<Trophy className="h-5 w-5" />}
          tone="violet"
        />
      </StatTileGrid>

      {/* Filters — Subject, Test type, Time range (3 filters => FilterSheet). */}
      {!noResultsAtAll && (
        <FilterRow activeCount={activeFilterCount} onClear={clearAllFilters} className="mt-2">
          <FilterSheet
            activeCount={activeFilterCount}
            onApply={applyPendingFilters}
            onReset={resetPendingFilters}
          >
            <div className="space-y-4">
              <div className="space-y-1.5">
                <p className="text-sm font-medium text-ink-700">Subject</p>
                <Select value={pendingSubject} onValueChange={setPendingSubject}>
                  <SelectTrigger className="h-10 rounded-xl w-full">
                    <SelectValue placeholder="All subjects" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All subjects</SelectItem>
                    {subjectOptions.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <p className="text-sm font-medium text-ink-700">Test type</p>
                <Select value={pendingType} onValueChange={setPendingType}>
                  <SelectTrigger className="h-10 rounded-xl w-full">
                    <SelectValue placeholder="All types" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All types</SelectItem>
                    {typeOptions.map((t) => (
                      <SelectItem key={t} value={t}>
                        {TEST_TYPE_LABELS[t] ?? t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-ink-500">
                  Quizzes and term exams stay separate so averages aren’t mixed.
                </p>
              </div>

              <div className="space-y-1.5">
                <p className="text-sm font-medium text-ink-700">Time range</p>
                <Select
                  value={pendingTimeRange}
                  onValueChange={(v) => setPendingTimeRange(v as TimeRange)}
                >
                  <SelectTrigger className="h-10 rounded-xl w-full">
                    <SelectValue placeholder="All time" />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(TIME_RANGE_LABELS) as TimeRange[]).map((tr) => (
                      <SelectItem key={tr} value={tr}>
                        {TIME_RANGE_LABELS[tr]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </FilterSheet>
        </FilterRow>
      )}

      {/* Subject trajectory (own-data) — only when a single subject is filtered. */}
      {subjectFilter !== "all" && (
        <div className="space-y-4">
          <SubjectTrajectory subject={subjectFilter} points={trajectoryPoints} />
          {/* Chapter-wise breakdown, on the SAME filter window as the line above. */}
          <ChapterAnalysisChart
            subject={subjectFilter}
            examType={chapterWindow.examType}
            from={chapterWindow.from}
            lastN={chapterWindow.lastN}
            windowLabel={chapterWindow.windowLabel}
          />
        </div>
      )}

      {feed.length > 0 ? (
        <section className="mt-4 space-y-2.5">
          <SectionHeading label="Results" count={feed.length} />
          {feed.map((item) => {
            if (item.kind === "hybrid") {
              const hr = item.hybrid;
              const percent = hr.percent ?? 0;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => navigate(`/student/hybrid-result/${hr.attempt_id}`)}
                  aria-label={`View the marked sheet for ${hr.exam_title}`}
                  className="surface-card frosted-shadow block w-full rounded-2xl p-4 text-left ring-1 ring-ink-400/10 transition-colors hover:bg-ink-400/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <h3 className="truncate font-semibold leading-tight text-ink-900">
                          {hr.exam_title}
                        </h3>
                        <Badge className="border border-primary/30 bg-primary/10 text-xs text-primary">
                          <Camera className="mr-1 h-3 w-3" />
                          Hybrid
                        </Badge>
                      </div>
                      <p className="mt-1 truncate text-xs text-ink-500">
                        {hr.evaluated_at
                          ? `Marked on ${format(new Date(hr.evaluated_at), "d MMM yyyy")}`
                          : "Awaiting marking"}
                        {" · View marked sheet"}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      <div className="text-right">
                        <div className="text-2xl font-bold leading-none tabular-nums text-ink-900">
                          {percent.toFixed(1)}%
                        </div>
                        <p className="mt-1 text-xs tabular-nums text-ink-500">
                          {Number(hr.total_marks_awarded ?? 0).toFixed(2)}/
                          {Number(hr.total_max_marks ?? 0).toFixed(2)} marks
                        </p>
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-ink-400" aria-hidden />
                    </div>
                  </div>

                  <Progress value={percent} className="mt-3 h-1.5" />
                </button>
              );
            }

            const result = item.result;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => navigate(`/student/results/${result.id}`)}
                aria-label={`Open ${result.exam_title}`}
                className="surface-card frosted-shadow block w-full rounded-2xl p-4 text-left ring-1 ring-ink-400/10 transition-colors hover:bg-ink-400/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <h3 className="truncate font-semibold leading-tight text-ink-900">
                        {result.exam_title}
                      </h3>
                      {result.is_absent ? (
                        <Badge className="border border-amber-200 bg-amber-500/10 text-xs text-amber-700">
                          <AlertCircle className="mr-1 h-3 w-3" />
                          Absent
                        </Badge>
                      ) : result.is_pass ? (
                        <Badge className="border border-emerald-200 bg-emerald-500/10 text-xs text-emerald-700">
                          <CheckCircle2 className="mr-1 h-3 w-3" />
                          Passed
                        </Badge>
                      ) : (
                        <Badge className="border border-rose-200 bg-rose-500/10 text-xs text-rose-700">
                          <AlertCircle className="mr-1 h-3 w-3" />
                          Failed
                        </Badge>
                      )}
                      {result.exam_type && result.exam_type !== "unspecified" && (
                        <Badge variant="outline" className="text-xs capitalize">
                          {TEST_TYPE_LABELS[result.exam_type] ?? result.exam_type}
                        </Badge>
                      )}
                      {result.grade && (
                        <Badge variant="outline" className="text-xs">
                          Grade {result.grade}
                        </Badge>
                      )}
                    </div>
                    {/* Subject, date and rank collapsed onto ONE muted meta line. */}
                    <p className="mt-1 truncate text-xs text-ink-500">
                      {[
                        result.subjects.join(" · ") || null,
                        format(new Date(result.published_at), "d MMM yyyy"),
                        result.rank_in_class ? `Rank #${result.rank_in_class} in class` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-start gap-1">
                    <div className="text-right">
                      {result.is_absent ? (
                        <>
                          <div className="text-2xl font-bold leading-none text-ink-900">-</div>
                          <p className="mt-1 text-xs text-ink-500">Not sat</p>
                        </>
                      ) : (
                        <>
                          <div className="text-2xl font-bold leading-none tabular-nums text-ink-900">
                            {(result.percentage ?? 0).toFixed(1)}%
                          </div>
                          <p className="mt-1 text-xs tabular-nums text-ink-500">
                            {result.total_marks_obtained}/{result.total_max_marks} marks
                          </p>
                        </>
                      )}
                    </div>
                    <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-ink-400" aria-hidden />
                  </div>
                </div>

                {!result.is_absent && (
                  <Progress value={result.percentage ?? 0} className="mt-3 h-1.5" />
                )}
              </button>
            );
          })}
        </section>
      ) : filteredEmpty ? (
        <EmptyState
          icon={<Trophy className="h-7 w-7" />}
          title="No results match these filters"
          description="Try a different subject, test type, or time range."
          action={{ label: "Clear filters", onClick: clearAllFilters }}
        />
      ) : (
        <EmptyState
          icon={<Trophy className="h-7 w-7" />}
          title="No results yet"
          description="Your exam results will appear here once published."
        />
      )}

    </PageShell>
  );
}

/** Small uppercase section label + count. Matches the dashboard's grouping style
 *  so the two student surfaces read as one product. */
function SectionHeading({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-2">
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-600">
        {label}
      </h2>
      <span className="text-[11px] tabular-nums text-ink-400">{count}</span>
    </div>
  );
}

function PageSkeleton() {
  return (
    <PageShell>
      <PageHeader
        icon={<Trophy className="h-5 w-5" />}
        title="My Results"
        subtitle="View your exam results and grades"
      />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-24 rounded-2xl" />
        ))}
      </div>
      <div className="mt-2 space-y-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-32 rounded-2xl" />
        ))}
      </div>
    </PageShell>
  );
}
