import { supabase } from "@/integrations/supabase/client";

export interface DeleteSubjectResult {
  subject_id: string;
  subject_name: string;
  /** Teacher assignments removed alongside the subject. */
  assignments_removed: number;
}

export interface UnassignSubjectResult {
  subject_id: string;
  subject_name: string;
  sections_affected: number;
  assignments_removed: number;
}

// Both RPCs postdate the generated Supabase types; narrow structural casts
// instead of a wholesale regen (§5a).
type SubjectRpc = (
  fn: "delete_institution_subject" | "unassign_subject_from_class",
  args: Record<string, string | null>,
) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

function rpc(): SubjectRpc {
  return supabase.rpc.bind(supabase) as unknown as SubjectRpc;
}

/**
 * Hard-deletes an institution-owned subject in ONE transaction: names every
 * blocker (homework, optional batches, student remarks, locked exams) BEFORE
 * touching anything, removes the subject's teacher assignments (the FK is
 * ON DELETE SET NULL, which would otherwise strand subject-less rows), and
 * writes the audit row. A blocked delete changes nothing at all.
 * Never valid for global subjects — the RPC refuses them.
 */
export async function deleteInstitutionSubject(
  subjectId: string,
  className?: string | null,
): Promise<DeleteSubjectResult> {
  const { data, error } = await rpc()("delete_institution_subject", {
    _subject_id: subjectId,
    _class_name: className ?? null,
  });
  if (error) throw new Error(error.message);
  return data as DeleteSubjectResult;
}

/**
 * Removes a subject from a class group (every section) without deleting the
 * shared subject row: clears the group mapping, residual legacy section
 * mappings, and the teacher assignments for it — all in one transaction.
 * Leaving the assignments behind is what blanks out a teacher's portal while
 * still looking assigned in the admin UI.
 */
export async function unassignSubjectFromClass(
  subjectId: string,
  classId: string,
): Promise<UnassignSubjectResult> {
  const { data, error } = await rpc()("unassign_subject_from_class", {
    _subject_id: subjectId,
    _class_id: classId,
  });
  if (error) throw new Error(error.message);
  return data as UnassignSubjectResult;
}
