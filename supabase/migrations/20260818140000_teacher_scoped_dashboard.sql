-- Teacher-scoped dashboard — Phase 1 (root-cause scope fix)
--
-- WHY THIS EXISTS
-- ---------------
-- /school/snapshot renders for coordinators AND teachers through the same
-- dash_scoped_* family. Those functions resolve the caller via
-- dash_resolve_scoped_classes(), whose teacher branch returns class_id ONLY —
-- ca.subject_id is selected nowhere. A teacher assigned to one class for ONE
-- subject was therefore shown that class's entire academic life across every
-- subject taught by every colleague.
--
-- Verified in prod before writing this (2026-08-18):
--   * Teacher4 (teaches only "Graphics Designing") and Teacher2 (teaches only
--     "English Core") both got the SAME headline average of 46.8% — the
--     all-subject class average, labelled "School average this term".
--   * dash_scoped_subject_performance returned 9 subjects to a 1-subject teacher.
--   * dash_scoped_teachers_table returned peer teachers' email, last_sign_in_at,
--     staff attendance % and exam counts (worst case: 60 colleagues).
--
-- APPROACH
-- --------
-- NEW functions, not amendments. dash_resolve_scoped_classes() and the
-- dash_scoped_* family are also the coordinator's data path; changing them in
-- place would silently alter coordinator behaviour. Teachers get their own
-- dash_teacher_* family and the frontend routes to it on a new "teacher" scope.
--
-- PAIR SEMANTICS
-- --------------
-- dash_resolve_scoped_pairs() returns (class_id, subject_id). A NULL subject_id
-- means "every subject in that class" and is emitted for:
--   * admins and coordinators (whole class / whole wing), and
--   * class-teacher assignments (class_assignments rows with subject_id IS NULL
--     — 35 of 1,088 teacher rows in prod), which are pastoral, not subject-bound.
-- Consumers filter with: (subject_id IS NULL OR subject_id = <exam subject>).

-- ---------------------------------------------------------------------------
-- 1. The (class, subject) resolver — the entire authorisation boundary
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dash_resolve_scoped_pairs()
RETURNS TABLE(class_id uuid, subject_id uuid)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_inst uuid := public.get_user_institution(auth.uid());
BEGIN
  IF v_inst IS NULL THEN
    RAISE EXCEPTION 'dashboard: no institution context';
  END IF;

  IF EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = auth.uid()
             AND ur.role IN ('school_admin','super_school_admin','super_admin')) THEN
    RETURN QUERY
      SELECT c.id, NULL::uuid
      FROM classes c
      WHERE c.institution_id = v_inst AND COALESCE(c.is_active, true);

  ELSIF EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = auth.uid()
                AND ur.role = 'coordinator') THEN
    RETURN QUERY
      SELECT DISTINCT m.class_id, NULL::uuid
      FROM wing_assignments wa
      JOIN wing_class_mappings m ON m.wing_id = wa.wing_id
      JOIN classes c ON c.id = m.class_id
                    AND c.institution_id = v_inst
                    AND COALESCE(c.is_active, true)
      WHERE wa.user_id = auth.uid();

  ELSIF EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = auth.uid()
                AND ur.role = 'teacher') THEN
    RETURN QUERY
      SELECT DISTINCT ca.class_id, ca.subject_id
      FROM class_assignments ca
      JOIN classes c ON c.id = ca.class_id
                    AND c.institution_id = v_inst
                    AND COALESCE(c.is_active, true)
      WHERE ca.user_id = auth.uid() AND ca.role = 'teacher';

  ELSE
    RAISE EXCEPTION 'dashboard: not authorized for the scoped dashboard';
  END IF;
END $function$;

-- ---------------------------------------------------------------------------
-- 2. Teacher KPI summary
--
-- Same JSONB shape as dash_scoped_kpi_summary so KpiStrip renders unchanged.
-- Three differences, all deliberate:
--   a. the academic average is filtered to the caller's (class, subject) pairs
--      via exam_subjects, so it is THEIR subject average, not the class's;
--   b. decisions_waiting no longer counts flags raised about OTHER teachers who
--      share a class (the shared function matches any teacher-subject flag whose
--      subject_key is any teacher in scope — a cross-teacher leak);
--   c. attendance stays CLASS-level on purpose: attendance is pastoral and is
--      not recorded per subject.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dash_teacher_kpi_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_classes uuid[]; v_ctext text[];
  v_pc uuid[]; v_ps uuid[];
  v_tz text; v_today date; v_ay_start date; v_ay_end date;
  v_present int; v_total int; v_wk_present int; v_wk_total int;
  v_pwk_present int; v_pwk_total int;
  v_avg numeric; v_prev_avg numeric; v_exams int; v_need int; v_flags int;
BEGIN
  v_inst := public.get_user_institution(auth.uid());

  -- Pair arrays are unnested together below; a teacher has tens of pairs at most.
  SELECT array_agg(p.class_id), array_agg(p.subject_id)
    INTO v_pc, v_ps
    FROM public.dash_resolve_scoped_pairs() p;

  IF v_pc IS NULL THEN
    v_pc := ARRAY[]::uuid[]; v_ps := ARRAY[]::uuid[];
  END IF;

  SELECT array_agg(DISTINCT x) INTO v_classes FROM unnest(v_pc) AS x;
  v_classes := COALESCE(v_classes, ARRAY[]::uuid[]);
  v_ctext := ARRAY(SELECT x::text FROM unnest(v_classes) AS x);

  SELECT i.timezone INTO v_tz FROM institutions i WHERE i.id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;
  SELECT start_date, end_date INTO v_ay_start, v_ay_end
    FROM public.dash_current_academic_year(v_inst);
  v_ay_start := COALESCE(v_ay_start, v_today - INTERVAL '12 months')::date;
  v_ay_end   := COALESCE(v_ay_end, v_today)::date;

  -- (c) Attendance: class-level, unchanged.
  SELECT count(*) FILTER (WHERE ar.status IN ('present','late')), count(*)
    INTO v_present, v_total
    FROM attendance_records ar
    WHERE ar.institution_id = v_inst AND ar.class_id = ANY(v_classes) AND ar.date = v_today;
  SELECT count(*) FILTER (WHERE ar.status IN ('present','late')), count(*)
    INTO v_wk_present, v_wk_total
    FROM attendance_records ar
    WHERE ar.institution_id = v_inst AND ar.class_id = ANY(v_classes)
      AND ar.date > v_today - 7 AND ar.date <= v_today;
  SELECT count(*) FILTER (WHERE ar.status IN ('present','late')), count(*)
    INTO v_pwk_present, v_pwk_total
    FROM attendance_records ar
    WHERE ar.institution_id = v_inst AND ar.class_id = ANY(v_classes)
      AND ar.date > v_today - 14 AND ar.date <= v_today - 7;

  -- (a) Academic average, restricted to the caller's own (class, subject) pairs.
  SELECT round(avg(fr.percentage), 1), count(DISTINCT e.id)
    INTO v_avg, v_exams
    FROM final_results fr
    JOIN student_exam_attempts a ON a.id = fr.attempt_id
    JOIN exams e ON e.id = a.exam_id
    JOIN exam_subjects es ON es.exam_id = e.id
    WHERE e.institution_id = v_inst
      AND e.status IN ('published','active','completed')
      AND COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date)
          BETWEEN v_ay_start AND v_ay_end
      AND EXISTS (
        SELECT 1 FROM unnest(v_pc, v_ps) AS pr(cid, sid)
        WHERE pr.cid = a.class_id AND (pr.sid IS NULL OR pr.sid = es.subject_id)
      );

  SELECT round(avg(fr.percentage), 1)
    INTO v_prev_avg
    FROM final_results fr
    JOIN student_exam_attempts a ON a.id = fr.attempt_id
    JOIN exams e ON e.id = a.exam_id
    JOIN exam_subjects es ON es.exam_id = e.id
    WHERE e.institution_id = v_inst
      AND e.status IN ('published','active','completed')
      AND COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date)
          BETWEEN (v_ay_start - INTERVAL '1 year')::date AND (v_ay_start - INTERVAL '1 day')::date
      AND EXISTS (
        SELECT 1 FROM unnest(v_pc, v_ps) AS pr(cid, sid)
        WHERE pr.cid = a.class_id AND (pr.sid IS NULL OR pr.sid = es.subject_id)
      );

  -- Students needing help stays class-level: these are the caller's own pupils,
  -- and the per-subject signal set is Phase 3 (homework / attendance / attempts).
  SELECT count(*) INTO v_need
    FROM public.dash_score_students_scoped(v_inst, v_classes, NULL) WHERE score >= 20;

  -- (b) Flags: teacher-subject flags are restricted to the caller themself.
  SELECT count(*) INTO v_flags
    FROM dashboard_flags df
    WHERE df.institution_id = v_inst AND df.resolved_at IS NULL
      AND (
           (df.subject_type = 'class' AND df.subject_key = ANY(v_ctext))
        OR (df.subject_type = 'exam' AND EXISTS (
              SELECT 1 FROM exam_classes ec
              WHERE ec.exam_id::text = df.subject_key AND ec.class_id = ANY(v_classes)))
        OR (df.subject_type = 'student' AND EXISTS (
              SELECT 1 FROM class_assignments ca
              WHERE ca.user_id::text = df.subject_key AND ca.role = 'student'
                AND ca.class_id = ANY(v_classes)))
        OR (df.subject_type = 'teacher' AND df.subject_key = auth.uid()::text)
      );

  RETURN jsonb_build_object(
    'attendance_today', jsonb_build_object(
      'present', v_present, 'total', v_total, 'marked', v_total > 0,
      'pct', CASE WHEN v_total > 0 THEN round(v_present * 100.0 / v_total, 1) END,
      'week_pct', CASE WHEN v_wk_total > 0 THEN round(v_wk_present * 100.0 / v_wk_total, 1) END,
      'prev_week_pct', CASE WHEN v_pwk_total > 0 THEN round(v_pwk_present * 100.0 / v_pwk_total, 1) END),
    'school_avg', jsonb_build_object('pct', v_avg, 'prev_pct', v_prev_avg, 'exams_count', v_exams),
    'students_need_help', jsonb_build_object('count', v_need, 'prev_count', NULL),
    'decisions_waiting', jsonb_build_object('count', v_flags));
END $function$;

-- ---------------------------------------------------------------------------
-- 3. Teacher subject performance
--
-- Same JSONB shape as dash_scoped_subject_performance. Two differences:
--   a. only the caller's OWN subjects for that class are returned (the shared
--      function joins exam_subjects to LABEL rows but never to FILTER them,
--      which is why a 1-subject teacher saw 9 subjects);
--   b. the comparison series is the same subject across the caller's OWN other
--      classes — the shared function called it "school_avg" while computing it
--      over the caller's classes, which was both mislabelled and a leak. It is
--      NULL when the caller teaches that subject in only one class, so the
--      widget draws no misleading reference tick.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dash_teacher_subject_performance(p_class_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_inst uuid; v_pc uuid[]; v_ps uuid[]; v_rows jsonb;
BEGIN
  v_inst := public.get_user_institution(auth.uid());

  SELECT array_agg(p.class_id), array_agg(p.subject_id)
    INTO v_pc, v_ps
    FROM public.dash_resolve_scoped_pairs() p;

  IF v_pc IS NULL OR NOT (p_class_id = ANY(v_pc)) THEN
    RAISE EXCEPTION 'dashboard: class not in scope';
  END IF;

  WITH res AS (
    SELECT a.class_id, es.subject_id, us.name AS subject_name, fr.percentage
    FROM final_results fr
    JOIN student_exam_attempts a ON a.id = fr.attempt_id
    JOIN exams e ON e.id = a.exam_id
                AND e.institution_id = v_inst
                AND e.status IN ('published','active','completed')
    JOIN exam_subjects es ON es.exam_id = e.id
    JOIN universal_subjects us ON us.id = es.subject_id
    WHERE EXISTS (
      SELECT 1 FROM unnest(v_pc, v_ps) AS pr(cid, sid)
      WHERE pr.cid = a.class_id AND (pr.sid IS NULL OR pr.sid = es.subject_id)
    )
  ),
  class_avg AS (
    SELECT r.subject_id, r.subject_name, round(avg(r.percentage), 1) AS class_avg
    FROM res r WHERE r.class_id = p_class_id
    GROUP BY r.subject_id, r.subject_name
  ),
  mine_avg AS (
    SELECT r.subject_id,
           round(avg(r.percentage), 1) AS mine_avg,
           count(DISTINCT r.class_id)  AS class_count
    FROM res r GROUP BY r.subject_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'subject_id',   c.subject_id,
           'subject_name', c.subject_name,
           'class_avg',    c.class_avg,
           -- NULL for a single-class subject: no honest comparison exists.
           'school_avg',   CASE WHEN m.class_count > 1 THEN m.mine_avg END
         ) ORDER BY c.class_avg ASC), '[]'::jsonb)
    INTO v_rows
    FROM class_avg c LEFT JOIN mine_avg m USING (subject_id);

  RETURN jsonb_build_object('has_data', jsonb_array_length(v_rows) > 0, 'subjects', v_rows);
END $function$;

-- ---------------------------------------------------------------------------
-- 4. Grants. Supabase's ALTER DEFAULT PRIVILEGES grants EXECUTE to anon on every
--    new public function, and REVOKE ... FROM PUBLIC does NOT strip it, so anon
--    must be revoked BY NAME (CLAUDE.md §11). Verify after applying with:
--      SELECT grantee, privilege_type FROM information_schema.routine_privileges
--      WHERE routine_name LIKE 'dash_teacher%' OR routine_name = 'dash_resolve_scoped_pairs';
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.dash_resolve_scoped_pairs()              FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dash_teacher_kpi_summary()               FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dash_teacher_subject_performance(uuid)   FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.dash_resolve_scoped_pairs()            TO authenticated;
GRANT EXECUTE ON FUNCTION public.dash_teacher_kpi_summary()             TO authenticated;
GRANT EXECUTE ON FUNCTION public.dash_teacher_subject_performance(uuid) TO authenticated;
