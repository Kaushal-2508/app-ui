-- =====================================================================
-- Homework: multiple subjects per assignment.
--
-- Each assignment KEEPS homework_assignments.subject_id as the PRIMARY
-- subject (= the first one picked). Every existing reader (marking header,
-- analytics, notifications, duplicate) keeps working unchanged. The new
-- join table homework_assignment_subjects holds the FULL set (including the
-- primary). Mirrors the homework_assignment_classes pattern exactly: RLS via
-- the same SECURITY DEFINER helpers, FK indexes in this migration (per §23).
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.homework_assignment_subjects (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  homework_assignment_id uuid NOT NULL REFERENCES public.homework_assignments(id) ON DELETE CASCADE,
  subject_id             uuid NOT NULL REFERENCES public.universal_subjects(id)   ON DELETE CASCADE,
  created_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (homework_assignment_id, subject_id)
);

CREATE INDEX IF NOT EXISTS idx_homework_assignment_subjects_homework
  ON public.homework_assignment_subjects(homework_assignment_id);
CREATE INDEX IF NOT EXISTS idx_homework_assignment_subjects_subject
  ON public.homework_assignment_subjects(subject_id);

-- Backfill: one row per existing assignment's current primary subject.
INSERT INTO public.homework_assignment_subjects (homework_assignment_id, subject_id)
SELECT id, subject_id
FROM public.homework_assignments
WHERE subject_id IS NOT NULL
ON CONFLICT (homework_assignment_id, subject_id) DO NOTHING;

ALTER TABLE public.homework_assignment_subjects ENABLE ROW LEVEL SECURITY;

-- RLS mirrors homework_assignment_classes (managers manage; students/managers
-- can read for assignments visible to them). Students actually read via the
-- SECURITY DEFINER homework_student_feed RPC below, but these keep direct
-- reads consistent and safe.
CREATE POLICY "hw_subjects select" ON public.homework_assignment_subjects
  FOR SELECT TO authenticated
  USING (
    public.can_manage_homework(auth.uid(), homework_assignment_id)
    OR public.homework_visible_to_student(auth.uid(), homework_assignment_id)
  );

CREATE POLICY "hw_subjects insert" ON public.homework_assignment_subjects
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_homework(auth.uid(), homework_assignment_id));

CREATE POLICY "hw_subjects delete" ON public.homework_assignment_subjects
  FOR DELETE TO authenticated
  USING (public.can_manage_homework(auth.uid(), homework_assignment_id));

-- ---------------------------------------------------------------------
-- Extend the student feed RPC: add a `subjects` array alongside the
-- existing primary `subject`. Returns jsonb (no RETURNS TABLE type trap).
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
        'subjects', (
          SELECT COALESCE(
                   jsonb_agg(jsonb_build_object('id', us.id, 'name', us.name) ORDER BY us.name),
                   '[]'::jsonb)
          FROM public.homework_assignment_subjects has2
          JOIN public.universal_subjects us ON us.id = has2.subject_id
          WHERE has2.homework_assignment_id = h.id
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
