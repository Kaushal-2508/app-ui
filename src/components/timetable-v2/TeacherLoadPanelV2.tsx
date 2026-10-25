import { Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  useTeacherLoadV2,
  type TeacherLoadRow,
  type Weekday,
} from "@/hooks/useTimetableV2";

// --------------------------------------------------------------
// TeacherLoadPanelV2 — side panel next to the class grid. Lists
// every teacher who has slots in scope, with per-day counts + a
// running weekly total. Helps coordinators spot when a teacher
// is already heavily loaded elsewhere before they assign them
// another period in the current cell.
// --------------------------------------------------------------

const DAYS: { key: Weekday; label: string }[] = [
  { key: "monday", label: "M" },
  { key: "tuesday", label: "T" },
  { key: "wednesday", label: "W" },
  { key: "thursday", label: "Th" },
  { key: "friday", label: "F" },
  { key: "saturday", label: "S" },
  { key: "sunday", label: "Su" },
];

interface Props {
  academicYear: string;
  wingId: string | null;
  /**
   * Highlight the row matching this teacher id (e.g. the teacher
   * currently selected in the slot drawer). Null / undefined means
   * no highlight.
   */
  highlightedTeacherId?: string | null;
  /** Optional peak hint — total non-break cells per week for the
   * user's current class. Renders "N / <capacity>" on each row. */
  weeklyCapacity?: number | null;
  workingDays?: Weekday[] | null;
}

export default function TeacherLoadPanelV2({
  academicYear,
  wingId,
  highlightedTeacherId,
  weeklyCapacity,
  workingDays,
}: Props) {
  const q = useTeacherLoadV2(academicYear, wingId);
  const shownDays = workingDays && workingDays.length > 0 ? workingDays : DAYS.map((d) => d.key);

  return (
    <details
      className="surface-card frosted-shadow rounded-card group"
      open
    >
      <summary
        className={cn(
          "flex items-center gap-2 p-3 sm:p-4 cursor-pointer list-none",
          "[&::-webkit-details-marker]:hidden",
          "lg:cursor-default", // panel stays open on desktop, no toggle ux
        )}
      >
        <Users className="h-4 w-4 text-ink-500" />
        <h3 className="font-semibold text-sm text-ink-900">Teacher load</h3>
        {weeklyCapacity ? (
          <Badge variant="outline" className="text-[10px] ml-auto">
            {weeklyCapacity}/week
          </Badge>
        ) : null}
        {/* Chevron toggle (mobile/tablet only) */}
        <span
          aria-hidden
          className="ml-auto lg:hidden text-ink-500 group-open:rotate-180 transition-transform"
        >
          ▾
        </span>
      </summary>

      <div className="px-3 pb-3 sm:px-4 sm:pb-4 space-y-2">
        {q.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : (q.data ?? []).length === 0 ? (
          <p className="text-xs text-ink-500">
            No teachers assigned to any slot yet in this scope.
          </p>
        ) : (
          <ul className="space-y-2 overflow-y-auto max-h-[300px] lg:max-h-[500px] pr-1">
            {(q.data ?? []).map((row) => (
              <TeacherRow
                key={row.teacherId}
                row={row}
                days={shownDays}
                highlighted={highlightedTeacherId === row.teacherId}
                weeklyCapacity={weeklyCapacity ?? null}
              />
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

function TeacherRow({
  row,
  days,
  highlighted,
  weeklyCapacity,
}: {
  row: TeacherLoadRow;
  days: Weekday[];
  highlighted: boolean;
  weeklyCapacity: number | null;
}) {
  const free = weeklyCapacity !== null ? Math.max(0, weeklyCapacity - row.total) : null;
  return (
    <li
      className={cn(
        "rounded-md border p-2 transition-colors",
        highlighted ? "bg-teal-50 border-teal-300" : "bg-background",
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium truncate">{row.teacherName}</span>
        <Badge variant="outline" className="text-[10px] shrink-0">
          {row.total}
        </Badge>
      </div>
      <div className="grid grid-cols-7 gap-1 mt-1.5">
        {days.map((d) => {
          const n = row.dayCounts[d] ?? 0;
          const label = DAYS.find((x) => x.key === d)?.label ?? d.slice(0, 2);
          return (
            <div key={d} className="flex flex-col items-center text-[10px]">
              <span className="text-muted-foreground leading-none">{label}</span>
              <span
                className={cn(
                  "leading-none font-medium",
                  n === 0 ? "text-muted-foreground/60" : "text-teal-700",
                )}
              >
                {n}
              </span>
            </div>
          );
        })}
      </div>
      {free !== null && (
        <div className="text-[10px] text-muted-foreground mt-1.5 pt-1.5 border-t border-dashed">
          {free} free / {weeklyCapacity} week
        </div>
      )}
    </li>
  );
}
