import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { format, parseISO } from "date-fns";
import {
  Search,
  ChevronRight,
  Users,
  GraduationCap,
  UserCog,
  MoreVertical,
  Check,
  Clock,
  X,
  CalendarOff,
  Eraser,
} from "lucide-react";

import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ListRow, EmptyState } from "@/components/shared/surfaces";
import {
  useScopedStaffAttendance,
  useScopedStudentsAttendance,
  useAttendanceCounts,
  type StaffListRow,
  type StudentListRow,
} from "@/hooks/useAttendanceLists";
import {
  useUpsertStaffAttendance,
  type StaffAttendanceStatus,
} from "@/hooks/useStaffAttendance";
import { useUserRole } from "@/hooks/useUserRole";
import { useEffectiveInstitutionId } from "@/contexts/InstitutionContext";
import { cn } from "@/lib/utils";

type Kind = "teachers" | "students" | "coordinators";

// Superset maps — this panel serves teachers/coordinators (staff plane:
// `late`, `on_leave`) AND students (`leave`, `sick`, `casual`).
const STATUS_TONE: Record<string, string> = {
  present:  "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
  late:     "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
  absent:   "bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300",
  on_leave: "bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-300",
  leave:    "bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-300",
  sick:     "bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-300",
  casual:   "bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-300",
  holiday:  "bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300",
};

const STATUS_LABEL: Record<string, string> = {
  present:  "Present",
  late:     "Late",
  absent:   "Absent",
  on_leave: "On leave",
  leave:    "On leave",
  sick:     "Sick",
  casual:   "Casual",
  holiday:  "Holiday",
};

function StatusPill({ status, derived }: { status: string | null; derived?: boolean }) {
  if (!status) {
    return (
      <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide bg-ink-400/15 text-ink-600 dark:text-ink-300">
        Not marked
      </span>
    );
  }
  if (derived) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide",
          STATUS_TONE.absent,
        )}
        title="Cutoff has passed, syncing with server"
      >
        Absent
        <span className="text-[9px] font-normal opacity-70 normal-case">· syncing</span>
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide",
        STATUS_TONE[status] ?? "bg-ink-400/15 text-ink-600",
      )}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

const STATUS_ACTIONS: {
  label: string;
  status: StaffAttendanceStatus | null;
  icon: React.ReactNode;
}[] = [
  { label: "Mark Present",  status: "present",  icon: <Check className="h-3.5 w-3.5 mr-2" /> },
  { label: "Mark Late",     status: "late",     icon: <Clock className="h-3.5 w-3.5 mr-2" /> },
  { label: "Mark Absent",   status: "absent",   icon: <X className="h-3.5 w-3.5 mr-2" /> },
  { label: "Mark On Leave", status: "on_leave", icon: <CalendarOff className="h-3.5 w-3.5 mr-2" /> },
  { label: "Clear status",  status: null,       icon: <Eraser className="h-3.5 w-3.5 mr-2" /> },
];

function RowActions({
  staffId,
  institutionId,
}: {
  staffId: string;
  institutionId: string;
}) {
  const upsert = useUpsertStaffAttendance();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-full"
          onClick={(e) => e.stopPropagation()}
          aria-label="Attendance actions"
          disabled={upsert.isPending}
        >
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuLabel>Set today's status</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {STATUS_ACTIONS.map((a) => (
          <DropdownMenuItem
            key={a.label}
            onSelect={() =>
              upsert.mutate({ institutionId, staffId, status: a.status })
            }
          >
            {a.icon}
            {a.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CountChip({ label, count, tone }: { label: string; count: number; tone: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums", tone)}>
      {count} {label}
    </span>
  );
}

function HeaderStats({
  loading,
  total,
  counts,
}: {
  loading: boolean;
  total: number;
  counts: { present: number; late: number; absent: number; leave: number; none: number; other: number };
}) {
  if (loading) {
    return <Skeleton className="h-6 w-72" />;
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-ink-600">
      <span className="font-semibold tabular-nums">{total}</span>
      <span className="text-ink-400">total</span>
      <span className="text-ink-300">·</span>
      <CountChip
        label="Present"
        count={counts.present}
        tone="bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300"
      />
      <CountChip
        label="Late"
        count={counts.late}
        tone="bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300"
      />
      <CountChip
        label="Absent"
        count={counts.absent}
        tone="bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300"
      />
      {counts.leave > 0 && (
        <CountChip
          label="On leave"
          count={counts.leave}
          tone="bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-300"
        />
      )}
      {counts.none > 0 && (
        <CountChip
          label="No record"
          count={counts.none}
          tone="bg-ink-400/15 text-ink-600 dark:text-ink-300"
        />
      )}
      {counts.other > 0 && (
        <CountChip
          label="Other"
          count={counts.other}
          tone="bg-ink-400/15 text-ink-600 dark:text-ink-300"
        />
      )}
    </div>
  );
}

function initials(fullName: string) {
  return fullName.split(" ").map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

interface BaseRow {
  id: string;
  fullName: string;
  email: string;
  status: string | null;
  derived: boolean;
  autoMarkedAbsent: boolean;
  overridden: boolean;
  primary: string;
  secondary: string;
}

function buildBaseRow(
  kind: Kind,
  row: StaffListRow | StudentListRow,
): BaseRow {
  if (kind === "students") {
    const r = row as StudentListRow;
    return {
      id: r.id,
      fullName: r.fullName,
      email: r.email,
      status: r.status,
      derived: false,
      autoMarkedAbsent: false,
      overridden: false,
      primary: r.fullName,
      secondary: `${r.rollNumber ? `Roll #${r.rollNumber} · ` : ""}${r.className}`,
    };
  }
  const r = row as StaffListRow;
  const checkInBit = r.checkInAt ? ` · in ${format(parseISO(r.checkInAt), "h:mm a")}` : "";
  return {
    id: r.id,
    fullName: r.fullName,
    email: r.email,
    status: r.status,
    derived: r.derived,
    autoMarkedAbsent: r.autoMarkedAbsent,
    overridden: r.overridden,
    primary: r.fullName,
    secondary: `${r.classCount} class${r.classCount === 1 ? "" : "es"}${checkInBit}`,
  };
}

function emptyConfig(kind: Kind) {
  if (kind === "students") {
    return {
      icon: <GraduationCap className="h-7 w-7" />,
      title: "No students in scope",
      description: "Once students are added, today's attendance will show up here.",
    };
  }
  if (kind === "coordinators") {
    return {
      icon: <UserCog className="h-7 w-7" />,
      title: "No coordinators in this institution",
      description: "Add a coordinator from Manage Users → Coordinators.",
    };
  }
  return {
    icon: <Users className="h-7 w-7" />,
    title: "No teachers in scope",
    description: "Coordinators see only teachers in their wing's classes.",
  };
}

/**
 * Single source for the three list panels (Teachers / Students /
 * Coordinators). Renders a search box, header stats, and tappable
 * rows that navigate to the user-detail page (`/school/attendance/user/:id?kind=...`).
 */
export function AttendanceListPanel({ kind }: { kind: Kind }) {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");

  const { data: roleInfo } = useUserRole();
  const institutionId = useEffectiveInstitutionId(roleInfo?.institutionId ?? null);
  const canManage =
    (roleInfo?.isSchoolAdmin || roleInfo?.isSuperAdmin || roleInfo?.isCoordinator) ?? false;
  const showActions =
    canManage && (kind === "teachers" || kind === "coordinators") && !!institutionId;

  const teachersQuery = useScopedStaffAttendance("teacher");
  const coordsQuery   = useScopedStaffAttendance("coordinator");
  const studentsQuery = useScopedStudentsAttendance(null);

  const rows: BaseRow[] = useMemo(() => {
    if (kind === "students") return (studentsQuery.data ?? []).map((r) => buildBaseRow(kind, r));
    if (kind === "coordinators") return (coordsQuery.data ?? []).map((r) => buildBaseRow(kind, r));
    return (teachersQuery.data ?? []).map((r) => buildBaseRow(kind, r));
  }, [kind, teachersQuery.data, coordsQuery.data, studentsQuery.data]);

  const isLoading =
    kind === "students"
      ? studentsQuery.isLoading
      : kind === "coordinators"
        ? coordsQuery.isLoading
        : teachersQuery.isLoading;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) => r.primary.toLowerCase().includes(q) || r.email.toLowerCase().includes(q),
    );
  }, [rows, search]);

  // For the header chips, treat derived "syncing" rows as absent so the
  // count does not lie during the brief RPC roundtrip.
  const countableRows = useMemo(
    () => filtered.map((r) => (r.derived ? { ...r, status: "absent" } : r)),
    [filtered],
  );
  const counts = useAttendanceCounts(countableRows);

  const detailKind: "staff" | "student" = kind === "students" ? "student" : "staff";

  return (
    <div className="space-y-4">
      <div className="surface-card frosted-shadow rounded-card p-4 sm:p-5 space-y-3">
        <p className="eyebrow">Today · {format(new Date(), "EEE, d MMM")}</p>
        <HeaderStats loading={isLoading} total={filtered.length} counts={counts} />
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400" />
          <Input
            placeholder={`Search ${kind}…`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-10 rounded-xl pl-9"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-14 rounded-2xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        (() => {
          const e = emptyConfig(kind);
          return <EmptyState icon={e.icon} title={e.title} description={e.description} />;
        })()
      ) : (
        <ul className="surface-card frosted-shadow rounded-card divide-y divide-[hsl(var(--surface-stroke))] overflow-hidden list-none p-0">
          {filtered.map((r) => (
            <ListRow
              key={r.id}
              as="li"
              leading={
                <Avatar className="h-10 w-10">
                  <AvatarFallback className="text-xs">{initials(r.fullName)}</AvatarFallback>
                </Avatar>
              }
              title={r.primary}
              subtitle={r.secondary}
              onClick={() => navigate(`/school/attendance/user/${r.id}?kind=${detailKind}`)}
              trailing={
                <div className="flex items-center gap-1.5">
                  <StatusPill status={r.status} derived={r.derived} />
                  {r.overridden && (
                    <span
                      className="hidden sm:inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide bg-ink-400/10 text-ink-500"
                      title="Admin override"
                    >
                      Overridden
                    </span>
                  )}
                  {showActions && (
                    <RowActions staffId={r.id} institutionId={institutionId!} />
                  )}
                  <ChevronRight className="h-4 w-4 text-ink-400 shrink-0" />
                </div>
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}
