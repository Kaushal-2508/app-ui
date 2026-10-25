import * as React from "react";
import { useNavigate } from "react-router-dom";
import { ArrowDown, Minus } from "lucide-react";

import {
  useStudentsAttention,
  useDashboardClassList,
  type DashboardFilters,
} from "@/hooks/dashboard/useDashboardData";
import type { StudentBand } from "@/hooks/dashboard/types";
import { DashboardTable } from "@/components/command-center/DashboardTable";
import { ListRow } from "@/components/shared/surfaces";
import { FilterRow } from "@/components/shared/nav";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const DESCRIPTION =
  "Students who may need extra help, based on attendance, recent marks, and any drop in performance.";

const ALL_CLASSES = "__all__";
type Severity = "all" | "red" | "amber";

/** Distribution-widget band → the severity filter that meaningfully narrows. */
type DistributionBand = "doing_well" | "catching_up" | "needs_help";

interface ClassOption {
  id: string;
  label: string;
}

// Severity dot — tokens only, no raw red/amber hex.
const BAND_DOT: Record<StudentBand, string> = {
  red: "bg-destructive",
  amber: "bg-brand-secondary",
  // "yellow" is the lightest tier — a softened amber via opacity.
  yellow: "bg-brand-secondary/50",
};

const BAND_LABEL: Record<StudentBand, string> = {
  red: "Needs help now",
  amber: "Watch closely",
  yellow: "Keep an eye on",
};

export interface StudentsAttentionTableProps {
  /**
   * Set by the Student Distribution widget when a donut segment is tapped.
   * Only `needs_help` maps to a meaningful server filter (red); the gentler
   * bands deep-link here without narrowing.
   */
  bandFilter?: DistributionBand | null;
}

/**
 * Students-needing-attention drill-down. Server-ranked by severity. The
 * surrounding section carries `id="dash-students"` so the distribution widget
 * can scroll to it. Click → student detail.
 */
export function StudentsAttentionTable({ bandFilter }: StudentsAttentionTableProps) {
  const navigate = useNavigate();

  const [showAll, setShowAll] = React.useState(false);
  const [classId, setClassId] = React.useState<string>(ALL_CLASSES);
  const [severity, setSeverity] = React.useState<Severity>("all");

  // A `needs_help` deep-link from the donut forces the "Only red" view.
  React.useEffect(() => {
    if (bandFilter === "needs_help") setSeverity("red");
  }, [bandFilter]);

  // Scope-aware class list — institution-wide or the caller's scoped classes.
  const classListQuery = useDashboardClassList();
  const classes: ClassOption[] = React.useMemo(
    () =>
      (classListQuery.data ?? []).map((c) => ({
        id: c.id,
        label: c.section ? `${c.name} ${c.section}` : c.name,
      })),
    [classListQuery.data],
  );

  const filters: DashboardFilters = React.useMemo(() => {
    const f: DashboardFilters = {};
    if (classId !== ALL_CLASSES) f.class_id = classId;
    if (severity === "red") f.band = "red";
    else if (severity === "amber") f.band = "amber";
    return f;
  }, [classId, severity]);

  const limit = showAll ? 100 : 10;
  const { data, isLoading, isError, refetch } = useStudentsAttention(filters, limit, 0);

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;

  const activeCount = (classId !== ALL_CLASSES ? 1 : 0) + (severity !== "all" ? 1 : 0);

  const filterSlot = (
    <FilterRow
      activeCount={activeCount}
      onClear={() => {
        setClassId(ALL_CLASSES);
        setSeverity("all");
      }}
    >
      {classes.length > 0 && (
        <Select value={classId} onValueChange={setClassId}>
          <SelectTrigger className="h-10 w-auto min-w-32 rounded-full">
            <SelectValue placeholder="All classes" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_CLASSES}>All classes</SelectItem>
            {classes.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <Select value={severity} onValueChange={(v) => setSeverity(v as Severity)}>
        <SelectTrigger className="h-10 w-auto min-w-44 rounded-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All who need attention</SelectItem>
          <SelectItem value="red">Only red</SelectItem>
          <SelectItem value="amber">Red and amber</SelectItem>
        </SelectContent>
      </Select>
    </FilterRow>
  );

  return (
    <div id="dash-students" className="scroll-mt-24">
      <DashboardTable
        title="Students who may need help"
        description={DESCRIPTION}
        filterSlot={filterSlot}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        isEmpty={!isLoading && !isError && rows.length === 0}
        emptyTitle="No students need attention right now."
        emptyDescription="As attendance and exam data builds up, students who may need extra help will appear here."
        total={total}
        shown={rows.length}
        showingAll={showAll}
        onToggleShowAll={() => setShowAll((v) => !v)}
      >
        <div className="space-y-2">
          {rows.map((row) => (
            <ListRow
              key={row.student_id}
              leading={
                <span
                  className="flex h-10 w-10 items-center justify-center"
                  aria-label={BAND_LABEL[row.band]}
                  title={BAND_LABEL[row.band]}
                >
                  <span className={cn("h-3 w-3 rounded-full", BAND_DOT[row.band])} />
                </span>
              }
              title={row.name}
              subtitle={`${row.reason} · Roll ${row.roll} · ${row.class}`}
              onClick={() => navigate(`/school/student/${row.student_id}`)}
              trailing={
                <div className="flex items-center gap-1.5">
                  <span className="text-[15px] font-semibold text-ink-900">
                    {row.recent_pct != null ? `${row.recent_pct}%` : "N/A"}
                  </span>
                  {row.trend === "down" ? (
                    <ArrowDown className="h-4 w-4 text-destructive" aria-label="Trending down" />
                  ) : (
                    <Minus className="h-4 w-4 text-ink-400" aria-label="Flat trend" />
                  )}
                </div>
              }
            />
          ))}
        </div>
      </DashboardTable>
    </div>
  );
}
