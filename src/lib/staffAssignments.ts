import { supabase } from "@/integrations/supabase/client";

export interface AssignmentChange {
  class_id: string;
  class: string | null;
  subject_id: string | null;
  subject: string | null;
}

export interface SetStaffAssignmentsResult {
  removed_count: number;
  added_count: number;
  removed: AssignmentChange[];
  added: AssignmentChange[];
}

interface SetStaffAssignmentsParams {
  userId: string;
  pairs: Array<{ class_id: string; subject_id?: string | null }>;
  role: "teacher" | "coordinator";
  /** 'subject' manages only subject-linked rows; 'bare' manages only rows without a subject. */
  kind: "subject" | "bare";
  scopeClassIds?: string[] | null;
}

export interface SetClassTeachersResult {
  removed_count: number;
  added_count: number;
  removed: Array<{ user_id: string; teacher: string | null }>;
}

export interface TeacherRoleGrantResult {
  /** True when a user_roles row was actually created (false = they already had it). */
  granted: boolean;
  added_count: number;
  removed_count: number;
}

// Both RPCs postdate the generated Supabase types; narrow structural casts
// instead of a wholesale regen (§5a).
type SetStaffAssignmentsRpc = (
  fn: "set_staff_class_assignments",
  args: {
    _user_id: string;
    _pairs: Array<{ class_id: string; subject_id: string | null }>;
    _role: "teacher" | "coordinator";
    _scope_class_ids: string[] | null;
    _kind: "subject" | "bare";
  },
) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

type SetClassTeachersRpc = (
  fn: "set_class_teachers",
  args: { _class_id: string; _teacher_ids: string[] },
) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

type GrantTeacherRoleRpc = (
  fn: "grant_teacher_role",
  args: {
    _user_id: string;
    _pairs: Array<{ class_id: string; subject_id: string | null }>;
  },
) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

type RevokeTeacherRoleRpc = (
  fn: "revoke_teacher_role",
  args: { _user_id: string },
) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

/**
 * Atomically replaces a staff member's class assignments (server-side diff in
 * ONE transaction, audit-logged). Rows of the other kind are never touched, so
 * the subject-assignment dialog cannot destroy bare class-teacher links and
 * the class-assignment dialog cannot destroy subject assignments.
 */
export async function setStaffClassAssignments({
  userId,
  pairs,
  role,
  kind,
  scopeClassIds = null,
}: SetStaffAssignmentsParams): Promise<SetStaffAssignmentsResult> {
  const rpc = supabase.rpc.bind(supabase) as unknown as SetStaffAssignmentsRpc;
  const { data, error } = await rpc("set_staff_class_assignments", {
    _user_id: userId,
    _pairs: pairs.map((p) => ({ class_id: p.class_id, subject_id: p.subject_id ?? null })),
    _role: role,
    _scope_class_ids: scopeClassIds && scopeClassIds.length > 0 ? scopeClassIds : null,
    _kind: kind,
  });
  if (error) throw new Error(error.message);
  return data as SetStaffAssignmentsResult;
}

/**
 * Replaces a class's teacher roster in ONE transaction. Teachers who remain
 * keep their existing subject assignments untouched — only unticked teachers
 * are removed, and a teacher with no row at all gets a subject-less
 * placeholder. Audit-logged server-side.
 */
export async function setClassTeachers(
  classId: string,
  teacherIds: string[],
): Promise<SetClassTeachersResult> {
  const call = supabase.rpc.bind(supabase) as unknown as SetClassTeachersRpc;
  const { data, error } = await call("set_class_teachers", {
    _class_id: classId,
    _teacher_ids: teacherIds,
  });
  if (error) throw new Error(error.message);
  return data as SetClassTeachersResult;
}

/**
 * Gives an existing account the teacher role AND its class+subject rows in ONE
 * transaction, attributed and audit-logged.
 *
 * The role row alone would be inert: teacher_controls_student requires a
 * class_assignments row with a non-null subject_id, so a teacher with no pairs
 * has no students, no roster and no exams. The RPC therefore refuses an empty
 * pairs list rather than creating an account that looks broken.
 *
 * Idempotent: the insert is ON CONFLICT DO NOTHING against
 * UNIQUE(user_id, role, institution_id), so re-running is safe.
 */
export async function grantTeacherRole(
  userId: string,
  pairs: Array<{ class_id: string; subject_id?: string | null }>,
): Promise<TeacherRoleGrantResult> {
  const call = supabase.rpc.bind(supabase) as unknown as GrantTeacherRoleRpc;
  const { data, error } = await call("grant_teacher_role", {
    _user_id: userId,
    _pairs: pairs.map((p) => ({ class_id: p.class_id, subject_id: p.subject_id ?? null })),
  });
  if (error) throw new Error(error.message);
  return data as TeacherRoleGrantResult;
}

/**
 * Removes the teacher role and every teaching assignment that came with it, in
 * one transaction. Refuses when it is the account's only role, so nobody is
 * left with an account they cannot use. Deleted assignment rows land in
 * class_assignment_deletions, so the change stays reversible.
 */
export async function revokeTeacherRole(userId: string): Promise<TeacherRoleGrantResult> {
  const call = supabase.rpc.bind(supabase) as unknown as RevokeTeacherRoleRpc;
  const { data, error } = await call("revoke_teacher_role", { _user_id: userId });
  if (error) throw new Error(error.message);
  return data as TeacherRoleGrantResult;
}
