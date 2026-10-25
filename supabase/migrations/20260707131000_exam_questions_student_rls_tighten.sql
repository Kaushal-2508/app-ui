-- ============================================================================
-- !!! DO NOT APPLY UNTIL THE get_exam_paper FRONTEND IS DEPLOYED !!!
--
-- Tightens the student leg of exam_questions SELECT. Live prod has THREE
-- permissive SELECT policies, and RLS ORs them together — so the effective
-- read grant is the UNION. Two of them leak the answer key
-- (options[].isCorrect, correct_answer, explanation):
--
--   * "Users can view exam_questions" (20260104115119) — the WIDER leak:
--       get_exam_institution(...) = get_user_institution(auth.uid())
--     grants EVERY user in the institution read on EVERY exam's questions at
--     ANY time, with no class-assignment or attempt check at all. Tightening
--     only "View exam questions" while this stays is a no-op — this is why
--     the first cut of this migration was incomplete.
--   * "View exam questions" (20260112124908) — narrower but still open:
--       any user assigned to the exam's class, any time (before/during exam).
--   * "Super admins can view all exam_questions" — super_admin only; KEPT.
--
-- After this migration the ONLY SELECT grants are:
--   * exam creators / super admins / staff-of-the-class (full, any time);
--   * students: direct row read ONLY once they have a SUBMITTED attempt for
--     the exam (post-exam results review legitimately shows the key);
--   * during a live attempt the paper comes EXCLUSIVELY through the sanitized
--     SECURITY DEFINER get_exam_paper RPC (20260707130000), which bypasses
--     RLS and strips every option down to {id, text}.
--
-- SEQUENCING (hard requirement):
--   1. Apply 20260707130000 (RPC) — done separately, additive.
--   2. Deploy the frontend that uses supabase.rpc("get_exam_paper").
--   3. Smoke-test one live exam attempt AND one results review on prod.
--   4. Only then apply this file. Applying earlier breaks the deployed
--      attempt page (its exam_sections embed of exam_questions returns
--      empty question lists for students who haven't submitted yet).
-- ============================================================================

-- Helper: does the caller have a SUBMITTED attempt for this exam?
-- SECURITY DEFINER per §23 (RLS policies must call helpers, never inline
-- cross-table EXISTS). STABLE: one evaluation per statement via initplan
-- when called as (select ...).
CREATE OR REPLACE FUNCTION public.has_submitted_attempt_for_exam(_user_id uuid, _exam_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.student_exam_attempts sea
    WHERE sea.exam_id = _exam_id
      AND sea.student_id = _user_id
      AND sea.is_submitted = true
  );
$$;

REVOKE ALL ON FUNCTION public.has_submitted_attempt_for_exam(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_submitted_attempt_for_exam(uuid, uuid) TO authenticated;

-- Helper: is the caller a teacher/coordinator/school admin assigned to (or
-- scoped over) one of the exam's classes? Students also live in
-- class_assignments, so the tightened policy must distinguish staff from
-- students without inline joins.
CREATE OR REPLACE FUNCTION public.is_staff_for_exam_class(_user_id uuid, _exam_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.exam_classes ec
    JOIN public.class_assignments ca
      ON ca.class_id = ec.class_id
     AND ca.user_id = _user_id
     AND ca.role <> 'student'
    WHERE ec.exam_id = _exam_id
  ) OR EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = _user_id
      AND ur.role IN ('school_admin', 'super_school_admin', 'coordinator')
      AND ur.institution_id = public.get_exam_institution(_exam_id)
  );
$$;

REVOKE ALL ON FUNCTION public.is_staff_for_exam_class(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_staff_for_exam_class(uuid, uuid) TO authenticated;

-- Drop BOTH leaking SELECT policies. RLS ORs permissive policies, so the
-- institution-wide one below must go too — otherwise the tightened policy
-- underneath is dead weight.
DROP POLICY IF EXISTS "Users can view exam_questions" ON public.exam_questions;
DROP POLICY IF EXISTS "View exam questions" ON public.exam_questions;

-- Replace with a single tightened SELECT policy.
CREATE POLICY "View exam questions"
ON public.exam_questions
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.exam_sections es
    WHERE es.id = section_id
    AND (
      public.is_exam_creator(es.exam_id, (SELECT auth.uid()))
      OR public.has_super_admin_access((SELECT auth.uid()))
      OR public.is_staff_for_exam_class((SELECT auth.uid()), es.exam_id)
      -- Students: direct row access only AFTER submitting (results review).
      OR public.has_submitted_attempt_for_exam((SELECT auth.uid()), es.exam_id)
    )
  )
);
