import * as React from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useUserRole } from "@/hooks/useUserRole";
import {
  useTeachersTable,
  type DashboardFilters,
} from "@/hooks/dashboard/useDashboardData";
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
import { cn } from "@/lib/utils";

const DESCRIPTION =
  "All teachers and staff, with anyone needing attention at the top.";

const ALL_WINGS = "__all__";
const ROLE_OPTIONS = [
  { value: "teacher", label: "Teachers" },
  { value: "coordinator", label: "Coordinators" },
  { value: "employee", label: "Staff" },
] as const;

interface WingOption {
  id: string;
  name: string;
}

/**
 * Humanize an ISO last-login into a short relative label, with a token colour
 * that escalates: ink (recent) → amber (>3 days) → red (>7 days, or never).
 */
function lastLoginLabel(iso: string | null): { text: string; className: string } {
  if (!iso) return { text: "Never", className: "text-destructive" };

  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return { text: "Never", className: "text-destructive" };

  const days = Math.floor((Date.now() - then) / 86_400_000);
  const text = days <= 0 ? "today" : `${days} days ago`;

  let className = "text-ink-500";
  if (days > 7) className = "text-destructive";
  else if (days > 3) className = "text-brand-secondary";

  return { text, className };
}

/**
 * Teachers + staff drill-down. Server-ranked (anyone needing attention first).
 * Filters: role membership chips + a wing Select. Click → teacher detail.
 */
export function TeachersTable() {
  const navigate = useNavigate();
  const institutionId = useUserRole().data?.institutionId ?? null;
  const scope = useDashboardScope();
  // Coordinators/teachers are already wing/taught-scoped — hide the wing filter
  // (and skip its query) when scoped.
  const showWingFilter = scope === "institution";

  const [showAll, setShowAll] = React.useState(false);
  const [roles, setRoles] = React.useState<string[]>([]);
  const [wingId, setWingId] = React.useState<string>(ALL_WINGS);

  const wingsQuery = useQuery({
    queryKey: ["dash", "teachersTable", "wings", institutionId],
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
    if (roles.length > 0) f.roles = roles;
    if (wingId !== ALL_WINGS) f.wing_id = wingId;
    return f;
  }, [roles, wingId]);

  const limit = showAll ? 100 : 10;
  const { data, isLoading, isError, refetch } = useTeachersTable(filters, limit, 0);

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const wings = wingsQuery.data ?? [];

  const toggleRole = (value: string) =>
    setRoles((prev) =>
      prev.includes(value) ? prev.filter((r) => r !== value) : [...prev, value],
    );

  const activeCount =
    (roles.length > 0 ? 1 : 0) + (showWingFilter && wingId !== ALL_WINGS ? 1 : 0);

  const filterSlot = (
    <FilterRow
      activeCount={activeCount}
      onClear={() => {
        setRoles([]);
        setWingId(ALL_WINGS);
      }}
    >
      {ROLE_OPTIONS.map((opt) => (
        <FilterChip
          key={opt.value}
          label={opt.label}
          active={roles.includes(opt.value)}
          trailing={<span aria-hidden />}
          onClick={() => toggleRole(opt.value)}
        />
      ))}
      {showWingFilter && wings.length > 0 && (
        <Select value={wingId} onValueChange={setWingId}>
          <SelectTrigger className="h-10 w-auto min-w-32 rounded-full">
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
    </FilterRow>
  );

  return (
    <DashboardTable
      title="Teachers & staff"
      description={DESCRIPTION}
      filterSlot={filterSlot}
      isLoading={isLoading}
      isError={isError}
      onRetry={() => refetch()}
      isEmpty={!isLoading && !isError && rows.length === 0}
      emptyTitle="No teachers or staff to show"
      emptyDescription="Anyone matching these filters will appear here."
      total={total}
      shown={rows.length}
      showingAll={showAll}
      onToggleShowAll={() => setShowAll((v) => !v)}
    >
      <div className="space-y-2">
        {rows.map((row) => {
          const login = lastLoginLabel(row.last_login);
          return (
            <ListRow
              key={row.user_id}
              title={row.name}
              subtitle={`${row.role}${row.wing ? ` · ${row.wing}` : ""} · ${row.classes} classes`}
              onClick={() => navigate(`/school/teacher/${row.user_id}`)}
              trailing={
                <div className="flex flex-col items-end gap-1">
                  <span className={cn("text-[13px] font-medium", login.className)}>
                    {login.text}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-ink-500">{row.exams_30d} exams</span>
                    {row.active_flags > 0 && (
                      <Badge variant="destructive" className="px-1.5">
                        {row.active_flags}
                      </Badge>
                    )}
                  </div>
                </div>
              }
            />
          );
        })}
      </div>
    </DashboardTable>
  );
}
