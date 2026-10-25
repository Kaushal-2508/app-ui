import { createContext, useContext, useMemo } from "react";

/**
 * Whose dashboard is being rendered.
 *
 * The student dashboard components all read auth.uid()-scoped hooks, which is
 * correct when a student views their own page and useless when a teacher opens
 * /school/student/:studentId. Rather than thread a studentId prop through eight
 * components and every hook signature, the subject is ambient: a null scope
 * means "the signed-in user" and every hook keeps its existing behaviour.
 *
 * When a scope IS set, the hooks call the `_for(p_student_id, ...)` variant of
 * their RPC (migration 20260824130000). Those variants are authorised
 * server-side by can_edit_student_details, so setting this context is a request,
 * never a permission: an unauthorised id returns an error, not data.
 */
interface StudentScope {
  /** null = the signed-in user. */
  studentId: string | null;
  /** True when viewing someone else, for copy that must not say "you". */
  isViewingOther: boolean;
}

const Ctx = createContext<StudentScope>({ studentId: null, isViewingOther: false });

export function StudentScopeProvider({
  studentId,
  children,
}: {
  studentId: string | null;
  children: React.ReactNode;
}) {
  const value = useMemo<StudentScope>(
    () => ({ studentId: studentId ?? null, isViewingOther: !!studentId }),
    [studentId],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Hooks call this to decide between the self RPC and the `_for` variant. */
export function useStudentScope(): StudentScope {
  return useContext(Ctx);
}

/**
 * Convenience for the common hook shape: returns the id to send to a `_for`
 * RPC, or null when the self RPC should be used instead.
 */
export function useScopedStudentId(): string | null {
  return useContext(Ctx).studentId;
}
