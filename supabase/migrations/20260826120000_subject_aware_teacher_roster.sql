-- =============================================================
-- Subject-aware teacher roster + the last of the 2026-08-25 audit findings
-- -------------------------------------------------------------
-- Follow-up to 20260825150000_optional_dormant_until_chosen.sql.
--
-- FINDING: dash_teacher_class_subjects emits ONE ROW PER (class, subject) but
-- counts its students with teacher_roster_student_ids(v_uid, ARRAY[class_id]),
-- which has no subject parameter. A teacher holding a compulsory subject AND
-- an optional subject in the SAME class gets the whole-class headcount printed
-- on BOTH rows, so the optional row silently claims students who never chose
-- it. This is a fail-OPEN over-count (it can never hide a student), but it
-- makes "My classes & subjects" disagree with the Students page with nothing
-- on screen to explain the difference.
--
-- FIX: a three-argument overload that narrows to one subject, reusing the same
-- dormancy rule (an optional subject whose section has recorded no choices
-- still behaves as compulsory). The two-argument version is UNCHANGED, so
-- every existing caller keeps its current behaviour.
-- =============================================================

CREATE OR REPLACE FUNCTION public.teacher_roster_student_ids(
  _teacher   uuid,
  _class_ids uuid[],
  _subject   uuid
)
RETURNS TABLE(student_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- Same caller guard as the 2-arg version, including the NULL-auth fail-close.
  IF auth.uid() IS NULL
     OR (auth.uid() <> _teacher
         AND NOT public.is_super_admin(auth.uid())
         AND NOT public.has_role(auth.uid(), 'school_admin')
         AND NOT public.has_role(auth.uid(), 'super_school_admin')
         AND NOT public.has_role(auth.uid(), 'coordinator')) THEN
    RETURN;
  END IF;

  -- No subject named => defer to the class-wide roster.
  IF _subject IS NULL THEN
    RETURN QUERY SELECT r.student_id
                 FROM public.teacher_roster_student_ids(_teacher, _class_ids) r;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT DISTINCT ca_stu.user_id
  FROM public.class_assignments ca_tea
  JOIN public.class_assignments ca_stu
    ON ca_stu.class_id = ca_tea.class_id AND ca_stu.role = 'student'
  LEFT JOIN public.subject_class_mappings scm
    ON scm.class_id = ca_tea.class_id AND scm.subject_id = ca_tea.subject_id
  WHERE ca_tea.user_id = _teacher
    AND ca_tea.role = 'teacher'
    AND ca_tea.class_id = ANY (_class_ids)
    AND ca_tea.subject_id = _subject          -- the axis the 2-arg version lacks
    AND (
      scm.is_optional IS NOT TRUE             -- compulsory / unmapped -> whole class
      OR NOT public.optional_choices_recorded(ca_tea.subject_id, ca_tea.class_id)
                                              -- optional but dormant -> whole class
      OR EXISTS (                             -- optional + in use -> enrolled only
        SELECT 1 FROM public.student_optional_enrollments soe
        WHERE soe.student_id = ca_stu.user_id
          AND soe.subject_id = ca_tea.subject_id
          AND soe.is_active = true
      )
    )

  UNION

  -- Optional-batch teaching, narrowed to batches for THIS subject.
  SELECT obs.student_id
  FROM public.optional_batches ob
  JOIN public.optional_batch_students obs ON obs.batch_id = ob.id
  JOIN public.class_assignments ca_stu2
    ON ca_stu2.user_id = obs.student_id
   AND ca_stu2.role = 'student'
   AND ca_stu2.class_id = ANY (_class_ids)
  WHERE ob.teacher_id = _teacher
    AND ob.subject_id = _subject;
END;
$$;

REVOKE ALL ON FUNCTION public.teacher_roster_student_ids(uuid, uuid[], uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.teacher_roster_student_ids(uuid, uuid[], uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.teacher_roster_student_ids(uuid, uuid[], uuid) TO authenticated;

COMMENT ON FUNCTION public.teacher_roster_student_ids(uuid, uuid[], uuid) IS
  'Subject-scoped teacher roster. Same dormancy rule as the 2-arg version: an optional subject narrows to enrolled students only once its section has recorded choices.';

-- ---------------------------------------------------------------------------
-- Point the (class, subject) widget at the subject-aware count.
-- Body identical to 20260818150000 except the single 'students' expression.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dash_teacher_class_subjects()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_inst uuid; v_rows jsonb;
  v_ay_start date; v_ay_end date; v_tz text; v_today date;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'dashboard: not authenticated'; END IF;
  v_inst := public.get_user_institution(v_uid);

  SELECT i.timezone INTO v_tz FROM institutions i WHERE i.id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;
  SELECT start_date, end_date INTO v_ay_start, v_ay_end
    FROM public.dash_current_academic_year(v_inst);
  v_ay_start := COALESCE(v_ay_start, v_today - INTERVAL '12 months')::date;
  v_ay_end   := COALESCE(v_ay_end, v_today)::date;

  WITH pairs AS (
    SELECT p.class_id, p.subject_id FROM public.dash_resolve_scoped_pairs() p
    WHERE p.subject_id IS NOT NULL          -- pastoral (class-teacher) rows have no subject axis
  ),
  scored AS (
    SELECT pr.class_id, pr.subject_id,
           avg(fr.percentage) FILTER (
             WHERE COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date)
                   BETWEEN v_ay_start AND v_ay_end) AS cur_pct,
           avg(fr.percentage) FILTER (
             WHERE COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date)
                   BETWEEN (v_ay_start - INTERVAL '1 year')::date AND (v_ay_start - INTERVAL '1 day')::date) AS prev_pct,
           count(DISTINCT e.id) FILTER (
             WHERE COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date)
                   BETWEEN v_ay_start AND v_ay_end) AS exams_count,
           max(COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date)) AS last_exam_on
    FROM pairs pr
    LEFT JOIN student_exam_attempts a ON a.class_id = pr.class_id
    LEFT JOIN exams e ON e.id = a.exam_id
                     AND e.institution_id = v_inst
                     AND e.status IN ('published','active','completed')
    LEFT JOIN exam_subjects es ON es.exam_id = e.id AND es.subject_id = pr.subject_id
    LEFT JOIN final_results fr ON fr.attempt_id = a.id AND es.id IS NOT NULL
    GROUP BY pr.class_id, pr.subject_id
  )
  SELECT COALESCE(jsonb_agg(x ORDER BY x_sort, class_name) , '[]'::jsonb) INTO v_rows
  FROM (
    SELECT jsonb_build_object(
             'class_id',     s.class_id,
             'class_name',   c.name,
             'section',      c.section,
             'subject_id',   s.subject_id,
             'subject_name', us.name,
             -- subject-scoped: this row is one (class, subject) pair, so the
             -- headcount must carry the subject axis too.
             'students',     (SELECT count(*) FROM public.teacher_roster_student_ids(
                                v_uid, ARRAY[s.class_id], s.subject_id)),
             'score_pct',    round(s.cur_pct, 1),
             'prev_pct',     round(s.prev_pct, 1),
             'delta_pp',     CASE WHEN s.cur_pct IS NOT NULL AND s.prev_pct IS NOT NULL
                                  THEN round(s.cur_pct - s.prev_pct, 1) END,
             'exams_count',  s.exams_count,
             'last_exam_on', s.last_exam_on,
             'band',         CASE WHEN s.cur_pct IS NULL THEN NULL
                                  WHEN s.cur_pct < 50 THEN 'needs_attention'
                                  WHEN s.cur_pct < 65 THEN 'developing'
                                  WHEN s.cur_pct < 85 THEN 'stable'
                                  ELSE 'excellent' END
           ) AS x,
           -- weakest first; pairs with no results sink to the bottom, not to 0%
           COALESCE(s.cur_pct, 1000) AS x_sort,
           c.name AS class_name
    FROM scored s
    JOIN classes c ON c.id = s.class_id
    JOIN universal_subjects us ON us.id = s.subject_id
  ) q;

  RETURN jsonb_build_object('has_data', jsonb_array_length(v_rows) > 0, 'pairs', v_rows);
END $function$;

REVOKE ALL ON FUNCTION public.dash_teacher_class_subjects() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dash_teacher_class_subjects() FROM anon;
GRANT EXECUTE ON FUNCTION public.dash_teacher_class_subjects() TO authenticated;
