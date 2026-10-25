import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import {
  ArrowLeft,
  Layers,
  ChevronRight,
  Search,
  Users,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ListRow, EmptyState } from "@/components/shared/surfaces";
import { useScopedAttendanceClasses } from "@/hooks/useClassAttendance";
import {
  useScopedStudentsAttendance,
  useAttendanceCounts,
  type StudentListRow,
} from "@/hooks/useAttendanceLists";
import { formatClassName, cn } from "@/lib/utils";

// Read-only STUDENT class attendance. Student rows are never 'late' (removed
// 2026-07), so no late tone/label/count is rendered here.
const STATUS_TONE: Record<string, string> = {
  present:  "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
  absent:   "bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300",
  on_leave: "bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-300",
  leave:    "bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-300",
  sick:     "bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-300",
  casual:   "bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-300",
  holiday:  "bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300",
};
const STATUS_LABEL: Record<string, string> = {
  present: "Present", absent: "Absent",
  on_leave: "On leave", leave: "On leave", sick: "Sick", casual: "Casual", holiday: "Holiday",
};

function StatusPill({ status }: { status: string | null }) {
  if (!status) {
    return (
      <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide bg-ink-400/15 text-ink-600 dark:text-ink-300">
        Not marked
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

function initials(name: string) {
  return name.split(" ").map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

function ClassTilesView({
  onSelect,
  scopeLabel,
}: {
  onSelect: (classId: string) => void;
  scopeLabel: string;
}) {
  const { data: classes, isLoading } = useScopedAttendanceClasses();

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28 rounded-card" />
        ))}
      </div>
    );
  }

  const list = classes ?? [];
  if (list.length === 0) {
    return (
      <EmptyState
        icon={<Layers className="h-7 w-7" />}
        title="No classes in scope"
        description="Classes will appear here once they're available for you to view."
      />
    );
  }

  return (
    <section>
      <p className="eyebrow mb-2">{scopeLabel}</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {list.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onSelect(c.id)}
            className="group relative w-full text-left surface-card frosted-shadow rounded-card p-4 sm:p-5 transition-shadow hover:shadow-card-lg"
          >
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-brand-primary/10 text-brand-primary">
              <Layers className="h-5 w-5" />
            </span>
            <div className="mt-3 flex flex-col">
              <span className="text-base font-semibold text-ink-900 truncate">
                {formatClassName(c.name, c.section)}
              </span>
              <span className="mt-1 text-xs text-ink-500">View attendance</span>
            </div>
            <ChevronRight className="absolute right-4 bottom-4 h-4 w-4 text-ink-400 opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>
        ))}
      </div>
    </section>
  );
}

function ClassRosterView({
  classId,
  className,
  onBack,
}: {
  classId: string;
  className: string;
  onBack: () => void;
}) {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const { data, isLoading } = useScopedStudentsAttendance(classId);

  const filtered = useMemo<StudentListRow[]>(() => {
    const q = search.trim().toLowerCase();
    const list = data ?? [];
    if (!q) return list;
    return list.filter(
      (r) =>
        r.fullName.toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q) ||
        (r.rollNumber ?? "").toLowerCase().includes(q) ||
        (r.admissionNumber ?? "").toLowerCase().includes(q),
    );
  }, [data, search]);

  const counts = useAttendanceCounts(filtered);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={onBack} aria-label="Back to classes">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="min-w-0">
          <p className="eyebrow">Class roster</p>
          <h2 className="text-lg font-semibold text-ink-900 truncate">{className}</h2>
        </div>
      </div>

      <div className="surface-card frosted-shadow rounded-card p-4 sm:p-5 space-y-3">
        <p className="eyebrow">Today · {format(new Date(), "EEE, d MMM")}</p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-600">
          <span className="font-semibold tabular-nums">{filtered.length}</span>
          <span className="text-ink-400">students</span>
          <span className="text-ink-300">·</span>
          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300">
            {counts.present} Present
          </span>
          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300">
            {counts.absent} Absent
          </span>
          {counts.leave > 0 && (
            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-300">
              {counts.leave} On leave
            </span>
          )}
          {counts.none > 0 && (
            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums bg-ink-400/15 text-ink-600 dark:text-ink-300">
              {counts.none} Not marked
            </span>
          )}
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400" />
          <Input
            placeholder="Search students…"
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
        <EmptyState
          icon={<Users className="h-7 w-7" />}
          title="No students in this class"
          description="Once students are assigned to this class, they'll appear here."
        />
      ) : (
        <ul className="surface-card frosted-shadow rounded-card divide-y divide-[hsl(var(--surface-stroke))] overflow-hidden list-none p-0">
          {filtered.map((s) => (
            <ListRow
              key={s.id}
              as="li"
              leading={
                <Avatar className="h-10 w-10">
                  <AvatarFallback className="text-xs">{initials(s.fullName)}</AvatarFallback>
                </Avatar>
              }
              title={s.fullName}
              subtitle={[
                s.rollNumber ? `Roll #${s.rollNumber}` : "No roll number",
                s.admissionNumber,
              ]
                .filter(Boolean)
                .join(" | ")}
              onClick={() => navigate(`/school/attendance/user/${s.id}?kind=student`)}
              trailing={
                <div className="flex items-center gap-2">
                  <StatusPill status={s.status} />
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

/**
 * Read-only "Class Attendance" drill-down. Since 2026-08-11 only
 * coordinators see this tab (their sole class-attendance surface) —
 * teachers/admins use Today's Attendance, which now has date navigation
 * and per-student drill-through. Two-step:
 *   1) tile grid of in-scope classes (see `useScopedAttendanceClasses`)
 *   2) class roster with today's status pill per student;
 *      tap a student → /school/attendance/user/:id?kind=student
 *
 * `scopeLabel` is the eyebrow above the tile grid ("Your wing").
 */
export function ClassAttendanceFlow({ scopeLabel = "Your classes" }: { scopeLabel?: string } = {}) {
  const [selected, setSelected] = useState<{ id: string; label: string } | null>(null);
  const { data: classes } = useScopedAttendanceClasses();

  if (selected) {
    return (
      <ClassRosterView
        classId={selected.id}
        className={selected.label}
        onBack={() => setSelected(null)}
      />
    );
  }

  return (
    <ClassTilesView
      scopeLabel={scopeLabel}
      onSelect={(classId) => {
        const cls = (classes ?? []).find((c) => c.id === classId);
        const label = cls ? formatClassName(cls.name, cls.section) : "Class";
        setSelected({ id: classId, label });
      }}
    />
  );
}

/** Backwards-compatible alias — old import name still works. */
export const TeacherClassAttendanceFlow = ClassAttendanceFlow;
