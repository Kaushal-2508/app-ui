import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { pctChip } from "@/components/olympiad/school/report/pctChip";
import type { ClassSubjectCell } from "@/hooks/olympiad/useOlympiadClassSubjectMatrix";

const headCell =
  "px-3 py-2 text-[11px] uppercase tracking-[0.06em] text-ink-500 font-medium whitespace-nowrap";

/**
 * Heatmap matrix for the Analytics tab's "Subjects vs Class" cross analysis:
 * rows = classes (with students appeared), columns = subjects, cells =
 * average % correct color-graded like the Weakest-concepts chips.
 * Cells open the per-student drill-down for that class × subject; class
 * labels go to the filtered student roster. Horizontally scrollable when
 * subjects overflow.
 */
export function ClassSubjectMatrix({
  cells,
  onCellClick,
  onClassClick,
}: {
  cells: ClassSubjectCell[];
  onCellClick: (cell: ClassSubjectCell) => void;
  onClassClick: (classLabel: string) => void;
}) {
  const { classes, subjects, lookup } = useMemo(() => {
    const classes: { id: string; label: string; students: number }[] = [];
    const subjects: { id: string; name: string }[] = [];
    const lookup = new Map<string, ClassSubjectCell>();
    for (const c of cells) {
      if (!classes.some((x) => x.id === c.grade_level_id)) {
        classes.push({ id: c.grade_level_id, label: c.class_label, students: c.students });
      } else {
        const entry = classes.find((x) => x.id === c.grade_level_id)!;
        entry.students = Math.max(entry.students, c.students);
      }
      if (!subjects.some((x) => x.id === c.subject_id)) {
        subjects.push({ id: c.subject_id, name: c.subject_name });
      }
      lookup.set(`${c.grade_level_id}:${c.subject_id}`, c);
    }
    return { classes, subjects, lookup };
  }, [cells]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px] border-collapse">
        <thead>
          <tr className="border-b border-surface-stroke">
            <th className={cn(headCell, "text-left")}>Class</th>
            {subjects.map((s) => (
              <th key={s.id} className={cn(headCell, "text-center")}>{s.name}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-surface-stroke">
          {classes.map((c) => (
            <tr key={c.id}>
              <td className="px-3 py-2.5">
                <button
                  type="button"
                  onClick={() => onClassClick(c.label)}
                  className="text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40 rounded-sm"
                >
                  <p className="text-sm font-medium text-ink-900">{c.label}</p>
                  <p className="text-[11px] text-ink-500">
                    {c.students} student{c.students === 1 ? "" : "s"} appeared
                  </p>
                </button>
              </td>
              {subjects.map((s) => {
                const cell = lookup.get(`${c.id}:${s.id}`);
                return (
                  <td key={s.id} className="px-3 py-2.5 text-center">
                    {cell ? (
                      <button
                        type="button"
                        onClick={() => onCellClick(cell)}
                        title={`${c.label} · ${s.name} · ${cell.students} student${cell.students === 1 ? "" : "s"}`}
                        className={cn(
                          "inline-flex min-w-[52px] items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums",
                          "transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40",
                          pctChip(cell.pct_correct),
                        )}
                      >
                        {cell.pct_correct}%
                      </button>
                    ) : (
                      <span className="text-sm text-ink-400">N/A</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
