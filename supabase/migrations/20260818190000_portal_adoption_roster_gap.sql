-- Surface the roster-vs-class gap on the portal adoption card.
--
-- WHY: teacher_roster_student_ids narrows an OPTIONAL subject to the students
-- actually enrolled in it. That is correct and must not change — widening it
-- would show an optional-subject teacher pupils who never chose their subject.
--
-- But when a subject is flagged is_optional with ZERO enrolments, the roster
-- collapses to (almost) nobody while the class is full, and every percentage on
-- the page is then computed over a denominator of ~1. Measured in prod: English
-- Core / Class 12 Science Non-Medical A is is_optional = true with 0 rows in
-- student_optional_enrollments, so a 9-student class produced a roster of 1 and
-- the dashboard read "0% of your students".
--
-- The number was technically right and completely misleading. The card now
-- returns the class headcount alongside the roster so the UI can say why it is
-- reporting on so few pupils, and the school can fix the enrolment data.
CREATE OR REPLACE FUNCTION public.dash_teacher_roster_gap()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_classes uuid[]; v_roster int; v_class_total int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'dashboard: not authenticated'; END IF;

  SELECT array_agg(DISTINCT p.class_id) INTO v_classes
    FROM public.dash_resolve_scoped_pairs() p;
  IF v_classes IS NULL THEN
    RETURN jsonb_build_object('roster', 0, 'class_total', 0, 'gap', false);
  END IF;

  SELECT count(*) INTO v_roster
    FROM public.teacher_roster_student_ids(v_uid, v_classes);

  SELECT count(DISTINCT ca.user_id) INTO v_class_total
    FROM class_assignments ca
   WHERE ca.role = 'student' AND ca.class_id = ANY(v_classes);

  RETURN jsonb_build_object(
    'roster',      COALESCE(v_roster, 0),
    'class_total', COALESCE(v_class_total, 0),
    -- Flag only a material gap: a roster under half the class is a setup
    -- problem worth naming, not ordinary optional-subject selection.
    'gap',         COALESCE(v_class_total, 0) > 0
                   AND COALESCE(v_roster, 0) * 2 < COALESCE(v_class_total, 0));
END $function$;

REVOKE ALL ON FUNCTION public.dash_teacher_roster_gap() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dash_teacher_roster_gap() TO authenticated;
