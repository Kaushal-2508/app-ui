import { supabase } from "@/integrations/supabase/client";

/**
 * The students who may actually sit / be marked for an exam.
 *
 * `exam_marking_eligible_students` composes `exam_visible_to_student`, which
 * composes `student_blocked_subject_ids` — so an exam covering only an OPTIONAL
 * subject resolves to the students enrolled in it, while a compulsory exam (or
 * one whose section has recorded no choices yet, the dormancy fallback) resolves
 * to the whole class. Callers therefore need no optional-subject logic of their
 * own: intersect the class roster with this set and the right thing happens in
 * every case.
 *
 * PAGED on purpose. Rosters in this repo page in 500/1000-row batches because
 * PostgREST truncates at 1000 silently. An UNPAGED eligibility set intersected
 * with a paged roster is the worse failure: past the cap the filter starts
 * deleting students who are genuinely eligible, which reads as "the exam lost
 * my class" rather than as an error.
 */
const PAGE = 1000;

export async function fetchExamEligibleStudentIds(examId: string): Promise<Set<string>> {
  const out = new Set<string>();

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .rpc("exam_marking_eligible_students", { _exam: examId })
      .range(from, from + PAGE - 1);
    if (error) throw error;

    const rows = (data as Array<{ student_id: string }> | null) ?? [];
    for (const r of rows) if (r.student_id) out.add(r.student_id);
    if (rows.length < PAGE) break;
  }

  return out;
}

/**
 * Filter a roster to the exam's eligible students, never dropping anyone who
 * already has data recorded against the exam.
 *
 * The `keepIds` escape hatch exists because eligibility is computed from
 * CURRENT enrollment: if a student's optional choice is later changed, a
 * strict filter would hide marks that are already saved, and the next save
 * would write the grid back without them. Whoever already has an attempt or a
 * mark stays visible; eligibility governs who may be ADDED.
 */
export function filterToEligible<T>(
  rows: T[],
  studentIdOf: (row: T) => string,
  eligible: Set<string>,
  keepIds?: Set<string>,
): { kept: T[]; removed: number } {
  const kept = rows.filter((r) => {
    const id = studentIdOf(r);
    return eligible.has(id) || (keepIds ? keepIds.has(id) : false);
  });
  return { kept, removed: rows.length - kept.length };
}
