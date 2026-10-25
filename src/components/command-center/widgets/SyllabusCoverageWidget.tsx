import * as React from "react";
import { BookOpenCheck, CircleCheck, TriangleAlert } from "lucide-react";

import { DashboardTable } from "@/components/command-center/DashboardTable";
import { StatTile, StatTileGrid, ListRow } from "@/components/shared/surfaces";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSyllabusCoverage } from "@/hooks/dashboard/useSyllabusCoverage";
import {
  useDashboardClassList,
  type DashboardClassOption,
} from "@/hooks/dashboard/useDashboardData";
import { coverageBand } from "@/lib/coverageLabels";
import { cn } from "@/lib/utils";

const ALL = "__all__";
const VISIBLE = 6;

const DESCRIPTION =
  "How much of each class's syllabus has been taught, weakest first. Coverage counts the chapters marked done in lesson plans against the total chapters set for that subject. It is shared across every teacher of the subject.";

function classLabel(c: DashboardClassOption) {
  return c.section ? `${c.name} ${c.section}` : c.name;
}

/**
 * Syllabus Coverage panel. One component for all three roles: it reads the ambient
 * DashboardScope through `useSyllabusCoverage`, so the admin Command Center sees the whole
 * institution, the coordinator their wing, and the teacher only the class-subjects they are
 * scheduled for (server-resolved). Gated by the caller behind the `timetable` feature flag.
 */
export function SyllabusCoverageWidget() {
  const classesQuery = useDashboardClassList();
  const classes = React.useMemo(() => classesQuery.data ?? [], [classesQuery.data]);
  const [classId, setClassId] = React.useState<string>(ALL);

  const coverage = useSyllabusCoverage({ classId: classId === ALL ? null : classId });

  const summary = coverage.data?.summary;
  const rows = React.useMemo(() => coverage.data?.rows ?? [], [coverage.data]);

  const [showAll, setShowAll] = React.useState(false);
  const visibleRows = showAll ? rows : rows.slice(0, VISIBLE);

  const isLoading = classesQuery.isLoading || coverage.isLoading;
  const isError = coverage.isError;
  const isEmpty = !isLoading && !isError && (summary?.combos ?? 0) === 0;

  const onTrack = React.useMemo(
    () => rows.filter((r) => r.pct != null && r.pct >= 80).length,
    [rows],
  );
  const behind = React.useMemo(
    () => rows.filter((r) => r.pct != null && r.pct < 50).length,
    [rows],
  );

  const filterSlot =
    classes.length > 0 ? (
      <Select value={classId} onValueChange={setClassId}>
        <SelectTrigger className="h-9 w-[180px] rounded-lg text-sm">
          <SelectValue placeholder="All classes" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All classes</SelectItem>
          {classes.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {classLabel(c)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    ) : undefined;

  return (
    <DashboardTable
      title="Syllabus Coverage"
      description={DESCRIPTION}
      filterSlot={filterSlot}
      isLoading={isLoading}
      isError={isError}
      onRetry={() => coverage.refetch()}
      isEmpty={isEmpty}
      emptyTitle="No lesson plans yet"
      emptyDescription="Once teachers mark chapters done in their lesson plans, syllabus coverage will appear here."
      total={summary?.combos ?? 0}
      shown={visibleRows.length}
      showingAll={showAll}
      onToggleShowAll={() => setShowAll((v) => !v)}
    >
      <div className="space-y-4">
        <StatTileGrid cols={3} mdCols={3}>
          <StatTile
            label="Overall coverage"
            value={summary?.pct != null ? `${summary.pct}%` : "No data"}
            icon={<BookOpenCheck className="h-5 w-5" />}
            tone="teal"
          />
          <StatTile
            label="On track"
            value={onTrack}
            icon={<CircleCheck className="h-5 w-5" />}
            tone="mint"
          />
          <StatTile
            label="Needs attention"
            value={behind}
            icon={<TriangleAlert className="h-5 w-5" />}
            tone="rose"
          />
        </StatTileGrid>

        <div className="space-y-2">
          {visibleRows.map((r) => {
            const band = coverageBand(r.pct);
            return (
              <ListRow
                key={`${r.class_id}:${r.subject_id}`}
                title={`${r.class_label} · ${r.subject_name}`}
                subtitle={
                  <div className="space-y-1.5">
                    <span>
                      {r.total > 0
                        ? `${r.covered} of ${r.total} chapters`
                        : "Syllabus not set up"}
                    </span>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={cn("h-full rounded-full", band.barClass)}
                        style={{ width: `${r.pct ?? 0}%` }}
                      />
                    </div>
                  </div>
                }
                trailing={
                  r.pct == null ? (
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[11px] font-medium",
                        band.chipClass,
                      )}
                    >
                      {band.label}
                    </span>
                  ) : (
                    <div className="flex flex-col items-end gap-1">
                      <span className="text-base font-semibold tabular-nums text-ink-900">
                        {r.pct}%
                      </span>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[11px] font-medium",
                          band.chipClass,
                        )}
                      >
                        {band.label}
                      </span>
                    </div>
                  )
                }
              />
            );
          })}
        </div>
      </div>
    </DashboardTable>
  );
}
