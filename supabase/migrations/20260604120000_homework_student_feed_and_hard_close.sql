-- =====================================================================
-- Homework refined behavior, Phase B: student locked pre-window preview
-- + hard submission close at due_at.
--
-- R1: students must SEE assigned published/checked assignments BEFORE
--     visible_from, shown LOCKED (description + attachment hidden until
--     it opens). The old read path (.lte visible_from + RLS gate) hid
--     pre-window rows entirely. We add a SECURITY DEFINER feed RPC that
--     returns every assigned assignment with a `locked` flag and nulls
--     the sensitive fields server-side while locked. Returns jsonb so
--     there is no RETURNS TABLE column-type trap (cf. the 42804 hotfix).
--
-- R2: submission window HARD-closes at due_at. A new
--     homework_open_for_submission() helper (visible AND now <= due_at)
--     replaces homework_visible_to_student in the student INSERT policy,
--     so a direct API call cannot write a late submission. The read
--     helper homework_visible_to_student is intentionally UNCHANGED (it
--     still has only the lower bound) so past-due assignments stay
--     readable.
-- =====================================================================

-- ---------------------------------------------------------------------
-- R1: student feed (locked-aware), one round trip, server-aggregated.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.homework_student_feed()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT COALESCE(jsonb_agg(t.obj ORDER BY t.due_at), '[]'::jsonb)
    INTO v_out
  FROM (
    SELECT
      h.due_at AS due_at,
      jsonb_build_object(
        'id', h.id,
        'title', h.title,
        'description',     CASE WHEN h.visible_from > now() THEN NULL ELSE h.description END,
        'status', h.status,
        'carries_marks', h.carries_marks,
        'max_marks', h.max_marks,
        'due_at', h.due_at,
        'visible_from', h.visible_from,
        'locked', (h.visible_from > now()),
        'attachment_path', CASE WHEN h.visible_from > now() THEN NULL ELSE h.attachment_path END,
        'attachment_name', CASE WHEN h.visible_from > now() THEN NULL ELSE h.attachment_name END,
        'attachment_mime', CASE WHEN h.visible_from > now() THEN NULL ELSE h.attachment_mime END,
        'checked_at', h.checked_at,
        'subject', (
          SELECT jsonb_build_object('id', us.id, 'name', us.name)
          FROM public.universal_subjects us
          WHERE us.id = h.subject_id
        ),
        'classes', (
          SELECT COALESCE(
                   jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'section', c.section)),
                   '[]'::jsonb)
          FROM public.homework_assignment_classes hac2
          JOIN public.classes c ON c.id = hac2.class_id
          WHERE hac2.homework_assignment_id = h.id
        ),
        'submission', (
          SELECT jsonb_build_object('id', s.id, 'submitted_at', s.submitted_at, 'is_late', s.is_late)
          FROM public.homework_submissions s
          WHERE s.homework_assignment_id = h.id AND s.student_id = v_uid
        ),
        'result', (
          SELECT jsonb_build_object('marks_awarded', r.marks_awarded, 'feedback', r.feedback, 'status', r.status)
          FROM public.homework_results r
          WHERE r.homework_assignment_id = h.id
            AND r.student_id = v_uid
            AND h.status = 'checked'
        )
      ) AS obj
    FROM public.homework_assignments h
    WHERE h.status IN ('published','checked')
      AND EXISTS (
        SELECT 1
        FROM public.homework_assignment_classes hac
        JOIN public.class_assignments ca ON ca.class_id = hac.class_id
        WHERE hac.homework_assignment_id = h.id
          AND ca.user_id = v_uid
          AND ca.role = 'student'
      )
  ) t;

  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.homework_student_feed() FROM public;
GRANT EXECUTE ON FUNCTION public.homework_student_feed() TO authenticated;

-- ---------------------------------------------------------------------
-- R2: hard close. Submission allowed only while visible AND on/before due.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.homework_open_for_submission(_user_id uuid, _homework_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.homework_visible_to_student(_user_id, _homework_id)
     AND EXISTS (
       SELECT 1 FROM public.homework_assignments h
       WHERE h.id = _homework_id AND now() <= h.due_at
     );
$$;
REVOKE ALL ON FUNCTION public.homework_open_for_submission(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.homework_open_for_submission(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS "hw_submissions student insert" ON public.homework_submissions;
CREATE POLICY "hw_submissions student insert" ON public.homework_submissions
  FOR INSERT TO authenticated
  WITH CHECK (
    student_id = auth.uid()
    AND public.homework_open_for_submission(auth.uid(), homework_assignment_id)
  );
