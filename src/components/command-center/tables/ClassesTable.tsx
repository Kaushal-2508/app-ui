import * as React from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useUserRole } from "@/hooks/useUserRole";
import { useClassesTable, type DashboardFilters } from "@/hooks/dashboard/useDashboardData";
import { useDashboardScope } from "@/hooks/dashboard/DashboardScope";
import { DashboardTable } from "@/components/command-center/DashboardTable";
import { ListRow } from "@/components/shared/surfaces";
import { FilterRow, FilterChip } from "@/components/shared/nav";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const DESCRIPTION =
  "All your classes, with the ones needing most attention at the top.";

const ALL_WINGS = "__all__";

interface WingOption {
  id: string;
  name: string;
}

/**
 * Classes drill-down. Rows are server-ranked (most attention first). Filters:
 * a wing Select + an "Only classes with flags" chip. Click → class detail.
 */
export function ClassesTable() {
  const navigate = useNavigate();
  const institutionId = useUserRole().data?.institutionId ?? null;
  const scope = useDashboardScope();
  // Coordinators/teachers are already wing/taught-scoped — a wing filter is
  // meaningless for them, so it's hidden (and its query skipped) when scoped.
  const showWingFilter = scope === "institution";

  const [showAll, setShowAll] = React.useState(false);
  const [wingId, setWingId] = React.useState<string>(ALL_WINGS);
  const [onlyFlagged, setOnlyFlagged] = React.useState(false);

  const wingsQuery = useQuery({
    queryKey: ["dash", "classesTable", "wings", institutionId],
    staleTime: 60_000,
    enabled: !!institutionId && showWingFilter,
    queryFn: async (): Promise<WingOption[]> => {
      const { data, error } = await supabase
        .from("wings")
        .select("id, name")
        .eq("institution_id", institutionId as string)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const filters: DashboardFilters = React.useMemo(() => {
    const f: DashboardFilters = {};
    if (wingId !== ALL_WINGS) f.wing_id = wingId;
    if (onlyFlagged) f.only_flagged = true;
    return f;
  }, [wingId, onlyFlagged]);

  const limit = showAll ? 100 : 10;
  const { data, isLoading, isError, refetch } = useClassesTable(filters, limit, 0);

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const wings = wingsQuery.data ?? [];

  const activeCount =
    (showWingFilter && wingId !== ALL_WINGS ? 1 : 0) + (onlyFlagged ? 1 : 0);

  const filterSlot = (
    <FilterRow
      activeCount={activeCount}
      onClear={() => {
        setWingId(ALL_WINGS);
        setOnlyFlagged(false);
      }}
    >
      {showWingFilter && wings.length > 0 && (
        <Select value={wingId} onValueChange={setWingId}>
          <SelectTrigger className="h-10 w-auto min-w-36 rounded-full">
            <SelectValue placeholder="All wings" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_WINGS}>All wings</SelectItem>
            {wings.map((w) => (
              <SelectItem key={w.id} value={w.id}>
                {w.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <FilterChip
        label="Only classes with flags"
        active={onlyFlagged}
        trailing={<span aria-hidden />}
        onClick={() => setOnlyFlagged((v) => !v)}
      />
    </FilterRow>
  );

  return (
    <DashboardTable
      title="Classes"
      description={DESCRIPTION}
      filterSlot={filterSlot}
      isLoading={isLoading}
      isError={isError}
      onRetry={() => refetch()}
      isEmpty={!isLoading && !isError && rows.length === 0}
      emptyTitle="No classes to show"
      emptyDescription={
        onlyFlagged
          ? "No classes have flags right now."
          : "Classes will appear here once they're set up."
      }
      total={total}
      shown={rows.length}
      showingAll={showAll}
      onToggleShowAll={() => setShowAll((v) => !v)}
    >
      <div className="space-y-2">
        {rows.map((row) => (
          <ListRow
            key={row.class_id}
            title={row.name}
            subtitle={`${row.students} students · ${row.attendance_30d != null ? `${row.attendance_30d}%` : "N/A"} attendance`}
            /* /school/class/:id is barred to teachers by ProtectedRoute, so for
               them this row navigated straight to /dashboard. No teacher-facing
               class-detail page exists yet, so the row is inert rather than a
               link that silently throws the user off the page. */
            onClick={
              scope === "teacher" ? undefined : () => navigate(`/school/class/${row.class_id}`)
            }
            trailing={
              <div className="flex items-center gap-2">
                <span className="text-[15px] font-semibold text-ink-900">
                  {row.recent_avg != null ? `${row.recent_avg}%` : "N/A"}
                </span>
                {row.active_flags > 0 && (
                  <Badge variant="destructive" className="px-1.5">
                    {row.active_flags}
                  </Badge>
                )}
              </div>
            }
          />
        ))}
      </div>
    </DashboardTable>
  );
}
