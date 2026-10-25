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
import type { TeacherWithClasses } from "@/hooks/olympiad/useOlympiadTeachers";
import { ResetTeacherPasswordButton } from "@/components/olympiad/school/ResetTeacherPasswordButton";

export type TeacherPerformanceRow = {
  teacher: TeacherWithClasses;
  /** Students enrolled across the teacher's class(es). */
  enrolled: number;
  /** Paid revenue (rupees) across the teacher's class(es), by channel. */
  cashRupees: number;
  onlineRupees: number;
};

const rupees = (amount: number) => `₹${(amount ?? 0).toLocaleString("en-IN")}`;

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

/**
 * Staff-Performance-style table for the Olympiad Teachers page: one row per
 * teacher with the class(es) they're responsible for, students enrolled, and
 * revenue collected. One clean header row — the revenue cell leads with the
 * total and carries the cash/online split as a quiet sub-line, instead of a
 * grouped sub-column header. Horizontally scrollable below ~640px.
 */
export function TeacherPerformanceTable({
  rows,
  valuesLoading,
  olySchoolId,
  canManage,
}: {
  rows: TeacherPerformanceRow[];
  /** True while the enrolled/revenue aggregates are still loading — number
   *  cells render an em dash instead of misleading zeros. */
  valuesLoading: boolean;
  olySchoolId: string;
  canManage: boolean;
}) {
  return (
    <div className="surface-card frosted-shadow rounded-card overflow-x-auto">
      <Table className="min-w-[640px]">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className={headCell}>Teacher</TableHead>
            <TableHead className={headCell}>Class responsible for</TableHead>
            <TableHead className={cn(headCell, "text-right")}>Students enrolled</TableHead>
            <TableHead className={cn(headCell, "text-right")}>Revenue collected</TableHead>
            {canManage && <TableHead className={headCell} />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ teacher, enrolled, cashRupees, onlineRupees }) => (
            <TableRow key={teacher.teacher_profile_id} className="hover:bg-muted/40">
              <TableCell className="py-4 align-middle">
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-primary/10 text-xs font-semibold text-brand-primary">
                    {initialsOf(teacher.full_name)}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink-900">{teacher.full_name}</p>
                    <p className="truncate text-[11px] text-ink-500">
                      {teacher.email}
                      {teacher.phone ? ` · ${teacher.phone}` : ""}
                    </p>
                  </div>
                </div>
              </TableCell>
              <TableCell className="py-4 align-middle">
                {teacher.grade_names.length === 0 ? (
                  <span className="text-sm text-ink-400">N/A</span>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {teacher.grade_names.map((g, i) => (
                      <Badge key={i} variant="secondary" className="text-[10px]">{g}</Badge>
                    ))}
                  </div>
                )}
              </TableCell>
              <TableCell
                className={cn(
                  "py-4 text-right text-sm tabular-nums align-middle",
                  !valuesLoading && enrolled === 0 ? "text-ink-400" : "font-medium text-ink-900",
                )}
              >
                {valuesLoading ? "N/A" : enrolled}
              </TableCell>
              <TableCell className="py-4 text-right align-middle">
                {valuesLoading ? (
                  <span className="text-sm text-ink-400">N/A</span>
                ) : (
                  <>
                    <p className="text-sm font-semibold tabular-nums text-ink-900">
                      {rupees(cashRupees + onlineRupees)}
                    </p>
                    <p className="mt-0.5 text-[11px] tabular-nums text-ink-500">
                      Cash {rupees(cashRupees)} · Online {rupees(onlineRupees)}
                    </p>
                  </>
                )}
              </TableCell>
              {canManage && (
                <TableCell className="py-4 text-right align-middle">
                  <ResetTeacherPasswordButton
                    olySchoolId={olySchoolId}
                    teacherProfileId={teacher.teacher_profile_id}
                    teacherName={teacher.full_name}
                  />
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
