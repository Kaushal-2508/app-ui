import * as React from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useUserRole } from "@/hooks/useUserRole";
import {
  useRecentExams,
  useDashboardClassList,
  type DashboardFilters,
} from "@/hooks/dashboard/useDashboardData";
import { DashboardTable } from "@/components/command-center/DashboardTable";
import { ListRow } from "@/components/shared/surfaces";
import { FilterRow, FilterSheet } from "@/components/shared/nav";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const DESCRIPTION = "Recent exams across the school. Tap any row to see results.";

const ALL = "__all__";

const STATUS_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "ready", label: "Ready" },
  { value: "active", label: "In progress" },
  { value: "completed", label: "Completed" },
  { value: "published", label: "Results published" },
  { value: "archived", label: "Archived" },
] as const;

/** Humanize a raw exam status into a plain-language label. */
function statusLabel(status: string): string {
  switch (status) {
    case "draft":
      return "Draft";
    case "ready":
      return "Ready";
    case "published":
      return "Results published";
    case "active":
      return "In progress";
    case "completed":
      return "Completed";
    case "archived":
      return "Archived";
    default:
      return status;
  }
}

interface Option {
  id: string;
  label: string;
}

/**
 * Recent-exams drill-down. Three filters (status / class / subject) → FilterSheet.
 * Click → that exam's results page.
 */
export function RecentExamsTable() {
  const navigate = useNavigate();
  const institutionId = useUserRole().data?.institutionId ?? null;

  const [showAll, setShowAll] = React.useState(false);

  // Applied (live) filter state.
  const [status, setStatus] = React.useState<string>(ALL);
  const [classId, setClassId] = React.useState<string>(ALL);
  const [subjectId, setSubjectId] = React.useState<string>(ALL);

  // Pending state inside the sheet — committed to live state on Apply.
  const [pendingStatus, setPendingStatus] = React.useState<string>(ALL);
  const [pendingClassId, setPendingClassId] = React.useState<string>(ALL);
  const [pendingSubjectId, setPendingSubjectId] = React.useState<string>(ALL);

  // Scope-aware class list — institution-wide or the caller's scoped classes.
  const classListQuery = useDashboardClassList();
  const classes: Option[] = React.useMemo(
    () =>
      (classListQuery.data ?? []).map((c) => ({
        id: c.id,
        label: c.section ? `${c.name} ${c.section}` : c.name,
      })),
    [classListQuery.data],
  );

  const subjectsQuery = useQuery({
    queryKey: ["dash", "recentExams", "subjects", institutionId],
    staleTime: 60_000,
    enabled: !!institutionId,
    queryFn: async (): Promise<Option[]> => {
      const { data, error } = await supabase
        .from("subjects")
        .select("id, name")
        .eq("institution_id", institutionId as string)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []).map((s) => ({ id: s.id, label: s.name }));
    },
  });

  const filters: DashboardFilters = React.useMemo(() => {
    const f: DashboardFilters = {};
    if (status !== ALL) f.status = status;
    if (classId !== ALL) f.class_id = classId;
    if (subjectId !== ALL) f.subject_id = subjectId;
    return f;
  }, [status, classId, subjectId]);

  const limit = showAll ? 100 : 10;
  const { data, isLoading, isError, refetch } = useRecentExams(filters, limit, 0);

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const subjects = subjectsQuery.data ?? [];

  const activeCount =
    (status !== ALL ? 1 : 0) + (classId !== ALL ? 1 : 0) + (subjectId !== ALL ? 1 : 0);

  const syncPending = () => {
    setPendingStatus(status);
    setPendingClassId(classId);
    setPendingSubjectId(subjectId);
  };

  const apply = () => {
    setStatus(pendingStatus);
    setClassId(pendingClassId);
    setSubjectId(pendingSubjectId);
  };

  const reset = () => {
    setPendingStatus(ALL);
    setPendingClassId(ALL);
    setPendingSubjectId(ALL);
    setStatus(ALL);
    setClassId(ALL);
    setSubjectId(ALL);
  };

  // Keep the sheet's pending state aligned with applied state each render so a
  // re-open reflects the live filters before the user changes anything.
  React.useEffect(syncPending, [status, classId, subjectId]);

  const filterSlot = (
    <FilterRow>
      <FilterSheet activeCount={activeCount} onApply={apply} onReset={reset}>
        <div className="space-y-1">
          <label className="text-sm font-medium text-ink-700">Status</label>
          <Select value={pendingStatus} onValueChange={setPendingStatus}>
            <SelectTrigger className="h-10 w-full rounded-xl">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All statuses</SelectItem>
              {STATUS_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium text-ink-700">Class</label>
          <Select value={pendingClassId} onValueChange={setPendingClassId}>
            <SelectTrigger className="h-10 w-full rounded-xl">
              <SelectValue placeholder="All classes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All classes</SelectItem>
              {classes.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium text-ink-700">Subject</label>
          <Select value={pendingSubjectId} onValueChange={setPendingSubjectId}>
            <SelectTrigger className="h-10 w-full rounded-xl">
              <SelectValue placeholder="All subjects" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All subjects</SelectItem>
              {subjects.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </FilterSheet>
    </FilterRow>
  );

  return (
    <DashboardTable
      title="Recent exams"
      description={DESCRIPTION}
      filterSlot={filterSlot}
      isLoading={isLoading}
      isError={isError}
      onRetry={() => refetch()}
      isEmpty={!isLoading && !isError && rows.length === 0}
      emptyTitle="No exams to show"
      emptyDescription="Recent exams across the school will appear here."
      total={total}
      shown={rows.length}
      showingAll={showAll}
      onToggleShowAll={() => setShowAll((v) => !v)}
    >
      <div className="space-y-2">
        {rows.map((row) => (
          <ListRow
            key={row.exam_id}
            title={row.title}
            subtitle={`${row.classes ?? ""}${row.subjects ? ` · ${row.subjects}` : ""}`}
            onClick={() => navigate(`/exams/${row.exam_id}/results`)}
            trailing={
              <div className="flex flex-col items-end gap-0.5 text-right">
                <span className="text-[13px] font-medium text-ink-700">
                  {statusLabel(row.status)}
                </span>
                <span className="text-xs text-ink-500">
                  {row.attempted} of {row.assigned} attempted
                </span>
                <span className="text-xs font-semibold text-ink-900">
                  {row.avg_pct != null ? `${row.avg_pct}%` : "Not graded yet"}
                </span>
              </div>
            }
          />
        ))}
      </div>
    </DashboardTable>
  );
}
