-- =====================================================================
-- Fix: homework_marking_roster RAISEd 42804 "structure of query does not
-- match function result type" at runtime — profiles.roll_number is
-- varchar(50) but the RETURNS TABLE column is declared `text`. The RPC
-- threw on every call, so the teacher marking page showed 0 submissions
-- even when students had submitted. Cast all text-declared columns to
-- ::text so the returned types match the signature exactly (defensive —
-- no-op for columns already text, bulletproofs against any varchar source).
-- Signature is unchanged, so no type regeneration is needed.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.homework_marking_roster(_homework_id uuid)
RETURNS TABLE (
  student_id     uuid,
  full_name      text,
  roll_number    text,
  class_id       uuid,
  class_name     text,
  class_section  text,
  submission_id  uuid,
  submitted_at   timestamptz,
  is_late        boolean,
  result_status  text,
  marks_awarded  numeric,
  feedback       text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.can_manage_homework(auth.uid(), _homework_id) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  RETURN QUERY
  SELECT DISTINCT ON (ca.user_id)
    ca.user_id                         AS student_id,
    p.full_name::text                  AS full_name,
    p.roll_number::text                AS roll_number,
    c.id                               AS class_id,
    c.name::text                       AS class_name,
    c.section::text                    AS class_section,
    s.id                               AS submission_id,
    s.submitted_at                     AS submitted_at,
    COALESCE(s.is_late, false)         AS is_late,
    r.status::text                     AS result_status,
    r.marks_awarded                    AS marks_awarded,
    r.feedback::text                   AS feedback
  FROM public.homework_assignment_classes hac
  JOIN public.class_assignments ca ON ca.class_id = hac.class_id AND ca.role = 'student'
  JOIN public.profiles p ON p.id = ca.user_id
  JOIN public.classes  c ON c.id = hac.class_id
  LEFT JOIN public.homework_submissions s
    ON s.homework_assignment_id = _homework_id AND s.student_id = ca.user_id
  LEFT JOIN public.homework_results r ON r.submission_id = s.id
  WHERE hac.homework_assignment_id = _homework_id
  ORDER BY ca.user_id, s.submitted_at NULLS LAST;
END;
$$;
REVOKE ALL ON FUNCTION public.homework_marking_roster(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.homework_marking_roster(uuid) TO authenticated;
