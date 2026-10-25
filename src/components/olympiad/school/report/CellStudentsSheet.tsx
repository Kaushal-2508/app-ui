import { useMemo } from "react";
import { LayoutGrid, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { MobileSheet } from "@/components/shared/sheets/MobileSheet";
import { EmptyState } from "@/components/shared/surfaces/EmptyState";
import { pctChip } from "@/components/olympiad/school/report/pctChip";
import type { ClassSubjectCell } from "@/hooks/olympiad/useOlympiadClassSubjectMatrix";
import type { RosterStudent } from "@/hooks/olympiad/useOlympiadClassRoster";
import type { StudentResultRow } from "@/hooks/olympiad/useOlympiadStudentResults";

type Row = {
  student: RosterStudent;
  /** null = enrolled in the subject but no score (absent / not appeared). */
  pct: number | null;
  correct: number | null;
  total: number | null;
};

/**
 * Drill-down behind each percentage chip of the Subjects vs Class heatmap:
 * every active student of that class who took that subject, with their own
 * % correct in it (same color grading as the chip), best score first and
 * absentees at the bottom. Tapping a row opens the full StudentDetailSheet;
 * the footer keeps a path to the subject's study material.
 */
export function CellStudentsSheet({
  cell,
  onOpenChange,
  students,
  results,
  onSelectStudent,
  onOpenStudyMaterial,
}: {
  cell: ClassSubjectCell | null;
  onOpenChange: (open: boolean) => void;
  students: RosterStudent[];
  results: Record<string, StudentResultRow> | undefined;
  onSelectStudent: (student: RosterStudent) => void;
  onOpenStudyMaterial: (subjectName: string) => void;
}) {
  const rows = useMemo<Row[]>(() => {
    if (!cell) return [];
    const out: Row[] = [];
    for (const s of students) {
      if (s.status !== "active") continue;
      if (s.grade_level_id !== cell.grade_level_id) continue;
      if (!s.subject_ids.includes(cell.subject_id)) continue;
      const score = results?.[s.id]?.subject_scores.find(
        (sc) => sc.subject_id === cell.subject_id,
      );
      out.push({
        student: s,
        pct: score ? Math.round(score.percentage) : null,
        correct: score?.correct ?? null,
        total: score?.total ?? null,
      });
    }
    // Scored students first, best score on top; absentees at the bottom A→Z.
    return out.sort((a, b) => {
      if ((a.pct == null) !== (b.pct == null)) return a.pct == null ? 1 : -1;
      if (a.pct != null && b.pct != null && a.pct !== b.pct) return b.pct - a.pct;
      return a.student.full_name.localeCompare(b.student.full_name);
    });
  }, [cell, students, results]);

  const appeared = rows.filter((r) => r.pct != null).length;

  return (
    <MobileSheet
      open={!!cell}
      onOpenChange={onOpenChange}
      title={cell ? `${cell.class_label} · ${cell.subject_name}` : ""}
      subtitle={
        cell
          ? `Class average ${cell.pct_correct}% · ${appeared} of ${rows.length} appeared`
          : undefined
      }
      icon={<LayoutGrid className="h-4 w-4" />}
      secondaryAction={
        cell
          ? { label: "Open study material", onClick: () => onOpenStudyMaterial(cell.subject_name) }
          : undefined
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<Users className="h-7 w-7" />}
          title="No students in this subject"
          description="No active students of this class are enrolled in this subject."
          reason="noData"
        />
      ) : (
        <ul className="divide-y divide-surface-stroke">
          {rows.map((r) => (
            <li
              key={r.student.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelectStudent(r.student)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelectStudent(r.student);
                }
              }}
              className="flex cursor-pointer items-center justify-between gap-3 rounded-md px-1 -mx-1 py-2.5 transition-colors hover:bg-ink-400/5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink-900">{r.student.full_name}</p>
                <p className="text-[11px] text-ink-500">{r.student.roll_number}</p>
              </div>
              {r.pct != null ? (
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-[11px] text-ink-500 tabular-nums">
                    {r.correct}/{r.total} correct
                  </span>
                  <span
                    className={cn(
                      "inline-flex min-w-[52px] items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums",
                      pctChip(r.pct),
                    )}
                  >
                    {r.pct}%
                  </span>
                </div>
              ) : (
                <span className="shrink-0 rounded-full bg-ink-400/10 px-2 py-0.5 text-xs font-medium text-ink-500">
                  Absent
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </MobileSheet>
  );
}
