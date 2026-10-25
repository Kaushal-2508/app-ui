import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { RosterStudent } from "@/hooks/olympiad/useOlympiadClassRoster";
import type { StudentResultRow } from "@/hooks/olympiad/useOlympiadStudentResults";

export type StudentPerformanceRow = {
  student: RosterStudent;
  /** Null until this student's results are published. */
  result: StudentResultRow | null;
};

const headCell =
  "text-[11px] uppercase tracking-[0.06em] text-ink-500 font-medium whitespace-nowrap h-11";

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

const TIER_CHIP: Record<StudentResultRow["certificate_tier"], { label: string; className: string }> = {
  gold: { label: "Gold", className: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" },
  silver: { label: "Silver", className: "bg-slate-200 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300" },
  bronze: { label: "Bronze", className: "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300" },
  participation: { label: "Participation", className: "bg-ink-400/10 text-ink-600" },
  absent: { label: "Absent", className: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300" },
};

/**
 * Report view of the Students page: one row per student with per-subject
 * percentages, overall score, class rank and medal tier from the published
 * results. Rows open the same student detail sheet as the card list.
 * Horizontally scrollable on small screens.
 */
export function StudentPerformanceTable({
  rows,
  onSelect,
}: {
  rows: StudentPerformanceRow[];
  onSelect: (student: RosterStudent) => void;
}) {
  return (
    <div className="surface-card frosted-shadow rounded-card overflow-x-auto">
      <Table className="min-w-[820px]">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className={headCell}>Student</TableHead>
            <TableHead className={headCell}>Class</TableHead>
            <TableHead className={headCell}>Subject-wise score</TableHead>
            <TableHead className={cn(headCell, "text-right")}>Overall</TableHead>
            <TableHead className={cn(headCell, "text-right")}>Class rank</TableHead>
            <TableHead className={cn(headCell, "text-right")}>Award</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ student, result }) => {
            const absent = result?.certificate_tier === "absent";
            const tier = result ? TIER_CHIP[result.certificate_tier] : null;
            return (
              <TableRow
                key={student.id}
                className="cursor-pointer hover:bg-muted/40"
                onClick={() => onSelect(student)}
              >
                <TableCell className="py-3.5 align-middle">
                  <div className="flex items-center gap-3">
                    <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-primary/10 text-xs font-semibold text-brand-primary">
                      {initialsOf(student.full_name)}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink-900">{student.full_name}</p>
                      <p className="truncate text-[11px] text-ink-500">{student.roll_number}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="py-3.5 align-middle">
                  <Badge variant="secondary" className="text-[10px]">{student.class_label}</Badge>
                </TableCell>
                <TableCell className="py-3.5 align-middle">
                  {!result || absent || result.subject_scores.length === 0 ? (
                    <span className="text-sm text-ink-400">N/A</span>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {result.subject_scores.map((s) => (
                        <span
                          key={s.subject_id}
                          title={`${s.subject_name}: ${s.correct}/${s.total} correct`}
                          className="inline-flex items-center gap-1 rounded-full bg-ink-400/10 px-2 py-0.5 text-[11px] text-ink-700"
                        >
                          {s.subject_name}
                          <span className="font-semibold tabular-nums text-ink-900">
                            {Math.round(s.percentage)}%
                          </span>
                        </span>
                      ))}
                    </div>
                  )}
                </TableCell>
                <TableCell className="py-3.5 text-right align-middle">
                  {!result ? (
                    <span className="text-[11px] text-ink-400">Not published</span>
                  ) : absent ? (
                    <span className="text-sm text-ink-400">N/A</span>
                  ) : (
                    <div>
                      <p className="text-sm font-semibold tabular-nums text-ink-900">
                        {Math.round(result.percentage * 10) / 10}%
                      </p>
                      <p className="text-[11px] tabular-nums text-ink-500">
                        {result.total_marks_obtained}/{result.total_max_marks} marks
                      </p>
                    </div>
                  )}
                </TableCell>
                <TableCell className="py-3.5 text-right align-middle">
                  {result && !absent && result.class_rank != null ? (
                    <span className="text-sm font-medium tabular-nums text-ink-900">
                      #{result.class_rank}
                      <span className="text-ink-500"> of {result.class_total}</span>
                    </span>
                  ) : (
                    <span className="text-sm text-ink-400">N/A</span>
                  )}
                </TableCell>
                <TableCell className="py-3.5 text-right align-middle">
                  {tier ? (
                    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold", tier.className)}>
                      {tier.label}
                    </span>
                  ) : (
                    <span className="text-sm text-ink-400">N/A</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
