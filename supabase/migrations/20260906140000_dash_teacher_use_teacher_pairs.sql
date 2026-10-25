-- Repoint the dash_teacher_* family off the admin-first ladder.
--
-- Each body below was dumped from PROD with pg_get_functiondef on 2026-09-05
-- and re-issued with exactly ONE substitution:
--   public.dash_resolve_scoped_pairs()  ->  public.dash_resolve_teacher_pairs()
-- Nothing else is changed. Bodies come from prod, not the repo, because the
-- migration ledger is not maintained (CLAUDE.md 26) and several of these were
-- re-issued by later migrations.
--
-- Verified before generating: all 15 had exactly one reference each, and none
-- referenced dash_resolve_scoped_classes. Zero users held school_admin+teacher
-- at the time of this change, so no live dashboard shifts.

-- ---------- dash_teacher_action_queue() ----------
CREATE OR REPLACE FUNCTION public.dash_teacher_action_queue()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_inst uuid;
  v_pc uuid[]; v_ps uuid[]; v_classes uuid[];
  v_tz text; v_today date; v_week_start date;
  v_grade_n int; v_grade_ctx text; v_grade_exam uuid;
  v_hw_n int; v_hw_ctx text; v_hw_id uuid;
  v_att_n int; v_att_ctx text;
  v_plan_n int; v_plan_ctx text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'dashboard: not authenticated'; END IF;
  v_inst := public.get_user_institution(v_uid);

  SELECT array_agg(p.class_id), array_agg(p.subject_id)
    INTO v_pc, v_ps FROM public.dash_resolve_teacher_pairs() p;
  IF v_pc IS NULL THEN v_pc := ARRAY[]::uuid[]; v_ps := ARRAY[]::uuid[]; END IF;
  SELECT array_agg(DISTINCT x) INTO v_classes FROM unnest(v_pc) AS x;
  v_classes := COALESCE(v_classes, ARRAY[]::uuid[]);

  SELECT i.timezone INTO v_tz FROM institutions i WHERE i.id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;   -- Â§24
  v_week_start := v_today - ((EXTRACT(ISODOW FROM v_today)::int) - 1);

  -- (1) Answer sheets awaiting this teacher on exams THEY created.
  --     'pending' = never touched; 'ai_evaluated' = AI done, needs sign-off.
  SELECT count(*) INTO v_grade_n
    FROM student_exam_attempts a
    JOIN exams e ON e.id = a.exam_id AND e.created_by = v_uid
   WHERE a.is_submitted AND a.evaluation_status IN ('pending','ai_evaluated');

  SELECT e.title, e.id INTO v_grade_ctx, v_grade_exam
    FROM student_exam_attempts a
    JOIN exams e ON e.id = a.exam_id AND e.created_by = v_uid
   WHERE a.is_submitted AND a.evaluation_status IN ('pending','ai_evaluated')
   GROUP BY e.id, e.title, e.created_at
   ORDER BY count(*) DESC, e.created_at DESC
   LIMIT 1;

  -- (2) Homework submitted against THIS teacher's assignments with no result row.
  SELECT count(*) INTO v_hw_n
    FROM homework_submissions s
    JOIN homework_assignments h ON h.id = s.homework_assignment_id AND h.created_by = v_uid
    LEFT JOIN homework_results r ON r.submission_id = s.id
   WHERE r.id IS NULL;

  SELECT h.title, h.id INTO v_hw_ctx, v_hw_id
    FROM homework_submissions s
    JOIN homework_assignments h ON h.id = s.homework_assignment_id AND h.created_by = v_uid
    LEFT JOIN homework_results r ON r.submission_id = s.id
   WHERE r.id IS NULL
   GROUP BY h.id, h.title, h.due_at
   ORDER BY count(*) DESC, h.due_at NULLS LAST
   LIMIT 1;

  -- (3) Classes in scope with no attendance row at all for today.
  SELECT count(*), string_agg(c.name || COALESCE(' ' || c.section, ''), ', ' ORDER BY c.name)
    INTO v_att_n, v_att_ctx
    FROM classes c
   WHERE c.id = ANY(v_classes)
     AND NOT EXISTS (SELECT 1 FROM attendance_records ar
                      WHERE ar.class_id = c.id AND ar.date = v_today);

  -- (4) Timetable slots owned by this teacher earlier in the current week that
  --     still have no lesson-plan row. tt_slots recur by weekday, so expand the
  --     week to dates and match on (slot_id, date).
  SELECT count(*) INTO v_plan_n
    FROM tt_slots s
    CROSS JOIN LATERAL generate_series(v_week_start, v_today, INTERVAL '1 day') AS d(day)
   WHERE s.teacher_id = v_uid
     AND lower(s.day) = lower(to_char(d.day, 'FMday'))
     AND NOT EXISTS (SELECT 1 FROM tt_lesson_plans lp
                      WHERE lp.slot_id = s.id AND lp.date = d.day::date);

  v_plan_ctx := CASE WHEN v_plan_n > 0
                     THEN v_plan_n || ' slot' || CASE WHEN v_plan_n = 1 THEN '' ELSE 's' END || ' unlogged this week'
                END;

  RETURN jsonb_build_object(
    'total', COALESCE(v_grade_n,0) + COALESCE(v_hw_n,0) + COALESCE(v_att_n,0) + COALESCE(v_plan_n,0),
    'items', jsonb_build_array(
      jsonb_build_object('key','grading','count',COALESCE(v_grade_n,0),
        'label','Submissions awaiting grading','context',v_grade_ctx,
        'href', CASE WHEN v_grade_exam IS NOT NULL THEN '/exams/' || v_grade_exam || '/results' END,
        'action','Grade'),
      jsonb_build_object('key','homework','count',COALESCE(v_hw_n,0),
        'label','Homework awaiting marking','context',v_hw_ctx,
        'href', CASE WHEN v_hw_id IS NOT NULL THEN '/homework/' || v_hw_id END,
        'action','Mark'),
      jsonb_build_object('key','attendance','count',COALESCE(v_att_n,0),
        'label','Attendance not marked today','context',v_att_ctx,
        'href','/school/attendance','action','Mark'),
      jsonb_build_object('key','planning','count',COALESCE(v_plan_n,0),
        'label','Lesson plan gaps this week','context',v_plan_ctx,
        'href','/teacher/my-week','action','Log')
    ));
END $function$
;

-- ---------- dash_teacher_attendance_trend(p_days integer, p_class_id uuid) ----------
CREATE OR REPLACE FUNCTION public.dash_teacher_attendance_trend(p_days integer DEFAULT 30, p_class_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_inst uuid; v_classes uuid[]; v_tz text; v_today date; v_points jsonb; v_all numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'dashboard: not authenticated'; END IF;
  v_inst := public.get_user_institution(auth.uid());

  SELECT array_agg(DISTINCT p.class_id) INTO v_classes
    FROM public.dash_resolve_teacher_pairs() p;
  IF v_classes IS NULL THEN
    RETURN jsonb_build_object('points', '[]'::jsonb, 'all_time_avg', NULL);
  END IF;

  IF p_class_id IS NOT NULL THEN
    IF NOT (p_class_id = ANY(v_classes)) THEN
      RAISE EXCEPTION 'dashboard: class not in scope';
    END IF;
    v_classes := ARRAY[p_class_id];
  END IF;

  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'date', d.date, 'present', d.present, 'total', d.total,
           'pct', CASE WHEN d.total > 0 THEN round(d.present * 100.0 / d.total, 1) END)
         ORDER BY d.date), '[]'::jsonb)
    INTO v_points
    FROM (
      SELECT date,
             count(*) FILTER (WHERE status IN ('present','late')) AS present,
             count(*) AS total
        FROM attendance_records
       WHERE institution_id = v_inst AND class_id = ANY(v_classes)
         AND date > v_today - p_days AND date <= v_today
       GROUP BY date) d;

  SELECT round((count(*) FILTER (WHERE status IN ('present','late'))) * 100.0 / NULLIF(count(*), 0), 1)
    INTO v_all
    FROM attendance_records
   WHERE institution_id = v_inst AND class_id = ANY(v_classes);

  RETURN jsonb_build_object('points', v_points, 'all_time_avg', v_all);
END $function$
;

-- ---------- dash_teacher_class_subjects() ----------
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
    SELECT p.class_id, p.subject_id FROM public.dash_resolve_teacher_pairs() p
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
END $function$
;

-- ---------- dash_teacher_exam_trend(p_limit integer, p_class_id uuid, p_subject_id uuid) ----------
CREATE OR REPLACE FUNCTION public.dash_teacher_exam_trend(p_limit integer DEFAULT 8, p_class_id uuid DEFAULT NULL::uuid, p_subject_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_inst uuid; v_pc uuid[]; v_ps uuid[]; v_rows jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'dashboard: not authenticated'; END IF;
  v_inst := public.get_user_institution(auth.uid());
  p_limit := LEAST(GREATEST(COALESCE(p_limit, 8), 1), 24);

  SELECT array_agg(p.class_id), array_agg(p.subject_id)
    INTO v_pc, v_ps FROM public.dash_resolve_teacher_pairs() p;
  IF v_pc IS NULL THEN RETURN '[]'::jsonb; END IF;

  -- Both filters are validated against the caller's own pairs and raise
  -- otherwise, so neither parameter can ever widen scope â they only narrow it.
  IF p_class_id IS NOT NULL AND NOT (p_class_id = ANY(v_pc)) THEN
    RAISE EXCEPTION 'dashboard: class not in scope';
  END IF;
  IF p_subject_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM unnest(v_ps) AS s(sid) WHERE s.sid = p_subject_id) THEN
    RAISE EXCEPTION 'dashboard: subject not in scope';
  END IF;

  WITH pairs AS (
    SELECT pr.cid, pr.sid
      FROM unnest(v_pc, v_ps) AS pr(cid, sid)
     WHERE (p_class_id IS NULL OR pr.cid = p_class_id)
       AND (p_subject_id IS NULL OR pr.sid IS NULL OR pr.sid = p_subject_id)
  ),
  recent AS (
    SELECT DISTINCT e.id, e.title, e.exam_type,
           COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date) AS exam_date
      FROM exams e
      JOIN exam_subjects esx ON esx.exam_id = e.id
     WHERE e.institution_id = v_inst
       AND e.status IN ('published','active','completed')
       AND (p_subject_id IS NULL OR esx.subject_id = p_subject_id)
       -- Only exams that produced a result inside the (possibly filtered) scope:
       -- the widget discards null-average rows, so anything else wastes the window.
       AND EXISTS (
         SELECT 1
           FROM student_exam_attempts a
           JOIN final_results fr ON fr.attempt_id = a.id
          WHERE a.exam_id = e.id
            AND EXISTS (SELECT 1 FROM pairs p
                         WHERE p.cid = a.class_id
                           AND (p.sid IS NULL OR p.sid = esx.subject_id))
       )
     ORDER BY exam_date DESC NULLS LAST
     LIMIT p_limit
  ),
  agg AS (
    SELECT r.id, r.title, r.exam_type, r.exam_date,
           round(avg(fr.percentage), 1) AS avg_pct,
           count(fr.id)                 AS participation
      FROM recent r
      JOIN exam_subjects esx2 ON esx2.exam_id = r.id
      LEFT JOIN student_exam_attempts a
             ON a.exam_id = r.id
            AND EXISTS (SELECT 1 FROM pairs p
                         WHERE p.cid = a.class_id
                           AND (p.sid IS NULL OR p.sid = esx2.subject_id))
      LEFT JOIN final_results fr ON fr.attempt_id = a.id
     GROUP BY r.id, r.title, r.exam_type, r.exam_date
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'exam_id', id, 'title', title, 'exam_type', exam_type,
           'avg_pct', avg_pct, 'participation', participation, 'exam_date', exam_date)
         ORDER BY exam_date ASC), '[]'::jsonb)
    INTO v_rows FROM agg;

  RETURN v_rows;
END $function$
;

-- ---------- dash_teacher_header() ----------
CREATE OR REPLACE FUNCTION public.dash_teacher_header()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid(); v_inst uuid; v_classes uuid[];
  v_wing text; v_wing_n int; v_ay text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'dashboard: not authenticated'; END IF;
  v_inst := public.get_user_institution(v_uid);

  SELECT array_agg(DISTINCT p.class_id) INTO v_classes
    FROM public.dash_resolve_teacher_pairs() p;
  v_classes := COALESCE(v_classes, ARRAY[]::uuid[]);

  -- 1. explicit assignment
  SELECT w.name INTO v_wing
    FROM wing_assignments wa
    JOIN wings w ON w.id = wa.wing_id AND w.institution_id = v_inst
   WHERE wa.user_id = v_uid
   ORDER BY w.display_order NULLS LAST, w.name
   LIMIT 1;

  -- 2. derived, only when unambiguous
  IF v_wing IS NULL AND array_length(v_classes, 1) > 0 THEN
    SELECT count(DISTINCT w.id), min(w.name) INTO v_wing_n, v_wing
      FROM wing_class_mappings m
      JOIN wings w ON w.id = m.wing_id AND w.institution_id = v_inst
     WHERE m.class_id = ANY(v_classes);
    IF COALESCE(v_wing_n, 0) <> 1 THEN v_wing := NULL; END IF;   -- 0 or many: say nothing
  END IF;

  SELECT ay.code INTO v_ay
    FROM cal_academic_years ay
   WHERE ay.institution_id = v_inst AND COALESCE(ay.is_active, false)
   ORDER BY ay.starts_on DESC
   LIMIT 1;

  RETURN jsonb_build_object('wing_name', v_wing, 'academic_year', v_ay);
END $function$
;

-- ---------- dash_teacher_kpi_summary() ----------
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
    FROM public.dash_resolve_teacher_pairs() p;

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
    FROM public.dash_score_students_scoped(v_inst, v_classes, NULL)
   WHERE score >= 20
     -- Subject-scoped (policy 2026-08-26). Attendance KPIs above stay
     -- class-based on purpose - attendance is the one whole-class surface.
     AND student_id IN (SELECT r.student_id
                          FROM public.teacher_roster_student_ids(auth.uid(), v_classes) r);

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
END $function$
;

-- ---------- dash_teacher_portal_adoption(p_class_id uuid) ----------
CREATE OR REPLACE FUNCTION public.dash_teacher_portal_adoption(p_class_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid(); v_inst uuid; v_classes uuid[]; v_roster uuid[];
  v_tz text; v_today date; v_total int;
  v_never int; v_never_names text[];
  v_today_n int; v_yday_n int; v_7 int; v_30 int;
  v_spark jsonb; v_hw_pct numeric; v_ex_pct numeric;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'dashboard: not authenticated'; END IF;
  v_inst := public.get_user_institution(v_uid);

  SELECT array_agg(DISTINCT p.class_id) INTO v_classes
    FROM public.dash_resolve_teacher_pairs() p;
  IF v_classes IS NULL THEN RETURN jsonb_build_object('has_data', false); END IF;

  IF p_class_id IS NOT NULL THEN
    IF NOT (p_class_id = ANY(v_classes)) THEN
      RAISE EXCEPTION 'dashboard: class not in scope';
    END IF;
    v_classes := ARRAY[p_class_id];
  END IF;

  -- The teacher's OWN students (policy 2026-08-26): subject-scoped via
  -- teacher_roster_student_ids. The zero-collapse that once forced a
  -- whole-class roster here is gone - dormant optional subjects fall back
  -- to the whole class inside the function itself.
  SELECT array_agg(DISTINCT r.student_id) INTO v_roster
    FROM public.teacher_roster_student_ids(v_uid, v_classes) r;
  v_roster := COALESCE(v_roster, ARRAY[]::uuid[]);
  v_total := COALESCE(array_length(v_roster, 1), 0);
  IF v_total = 0 THEN RETURN jsonb_build_object('has_data', false); END IF;

  SELECT i.timezone INTO v_tz FROM institutions i WHERE i.id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;

  SELECT count(*) INTO v_never
    FROM auth.users u WHERE u.id = ANY(v_roster) AND u.last_sign_in_at IS NULL;

  SELECT array_agg(nm) INTO v_never_names FROM (
    SELECT (SELECT pf.full_name FROM profiles pf WHERE pf.id = u.id) AS nm
      FROM auth.users u
     WHERE u.id = ANY(v_roster) AND u.last_sign_in_at IS NULL
     ORDER BY 1 LIMIT 3) s;

  -- DISTINCT people, not student-days averaged over the window.
  SELECT count(DISTINCT d.student_id) INTO v_today_n FROM student_activity_daily d
   WHERE d.student_id = ANY(v_roster) AND d.activity_date = v_today;
  SELECT count(DISTINCT d.student_id) INTO v_yday_n FROM student_activity_daily d
   WHERE d.student_id = ANY(v_roster) AND d.activity_date = v_today - 1;
  SELECT count(DISTINCT d.student_id) INTO v_7 FROM student_activity_daily d
   WHERE d.student_id = ANY(v_roster)
     AND d.activity_date > v_today - 7 AND d.activity_date <= v_today;
  SELECT count(DISTINCT d.student_id) INTO v_30 FROM student_activity_daily d
   WHERE d.student_id = ANY(v_roster)
     AND d.activity_date > v_today - 30 AND d.activity_date <= v_today;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('d', g.day, 'n', COALESCE(c.n, 0)) ORDER BY g.day), '[]'::jsonb)
    INTO v_spark
    FROM generate_series(v_today - 13, v_today, INTERVAL '1 day') AS g(day)
    LEFT JOIN (
      SELECT d.activity_date, count(DISTINCT d.student_id) AS n
        FROM student_activity_daily d
       WHERE d.student_id = ANY(v_roster) AND d.activity_date > v_today - 14
       GROUP BY d.activity_date) c ON c.activity_date = g.day::date;

  SELECT round(count(*) FILTER (WHERE s.id IS NOT NULL) * 100.0 / NULLIF(count(*), 0), 0)
    INTO v_hw_pct
    FROM homework_assignments h
    JOIN homework_assignment_classes hac ON hac.homework_assignment_id = h.id
                                        AND hac.class_id = ANY(v_classes)
    CROSS JOIN LATERAL unnest(v_roster) AS t(student_id)
    LEFT JOIN homework_submissions s ON s.homework_assignment_id = h.id AND s.student_id = t.student_id
   WHERE h.created_by = v_uid;

  SELECT round(count(*) FILTER (WHERE a.id IS NOT NULL) * 100.0 / NULLIF(count(*), 0), 0)
    INTO v_ex_pct
    FROM exams e
    JOIN exam_classes ec ON ec.exam_id = e.id AND ec.class_id = ANY(v_classes)
    CROSS JOIN LATERAL unnest(v_roster) AS t(student_id)
    LEFT JOIN student_exam_attempts a ON a.exam_id = e.id AND a.student_id = t.student_id
   WHERE e.created_by = v_uid AND e.status IN ('published','active','completed');

  RETURN jsonb_build_object(
    'has_data', true,
    'total_students', v_total,
    'never_logged_in', jsonb_build_object('count', COALESCE(v_never,0),
                                          'names', COALESCE(to_jsonb(v_never_names), '[]'::jsonb)),
    'today',     jsonb_build_object('n', v_today_n, 'pct', round(v_today_n * 100.0 / v_total, 0)),
    'yesterday', jsonb_build_object('n', v_yday_n,  'pct', round(v_yday_n  * 100.0 / v_total, 0)),
    'avg_7',     jsonb_build_object('n', v_7,  'pct', round(v_7  * 100.0 / v_total, 0)),
    'avg_30',    jsonb_build_object('n', v_30, 'pct', round(v_30 * 100.0 / v_total, 0)),
    'sparkline', v_spark,
    'engagement', jsonb_build_object('homework_pct', v_hw_pct, 'tests_pct', v_ex_pct));
END $function$
;

-- ---------- dash_teacher_portal_laggards(p_limit integer) ----------
CREATE OR REPLACE FUNCTION public.dash_teacher_portal_laggards(p_limit integer DEFAULT 15)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid(); v_inst uuid;
  v_classes uuid[]; v_rows jsonb; v_tz text; v_today date;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'dashboard: not authenticated'; END IF;
  p_limit := LEAST(GREATEST(COALESCE(p_limit, 15), 1), 50);
  v_inst := public.get_user_institution(v_uid);

  SELECT array_agg(DISTINCT p.class_id) INTO v_classes
    FROM public.dash_resolve_teacher_pairs() p;
  IF v_classes IS NULL THEN
    RETURN jsonb_build_object('has_data', false, 'students', '[]'::jsonb);
  END IF;

  SELECT i.timezone INTO v_tz FROM institutions i WHERE i.id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;

  WITH roster AS (
    -- One representative class per student. NOT min(class_id): Postgres has no
    -- min() aggregate for uuid, which is what broke this function in review.
    SELECT ca.user_id AS student_id,
           (array_agg(ca.class_id ORDER BY ca.class_id))[1] AS class_id
      FROM class_assignments ca
     WHERE ca.role = 'student' AND ca.class_id = ANY(v_classes)
       -- Subject-scoped (policy 2026-08-26): only the teacher's own students.
       AND ca.user_id IN (SELECT r.student_id
                            FROM public.teacher_roster_student_ids(v_uid, v_classes) r)
     GROUP BY ca.user_id
  ),
  seen AS (
    SELECT r.student_id,
           GREATEST(
             (SELECT max(d.activity_date) FROM student_activity_daily d
               WHERE d.student_id = r.student_id),
             (SELECT (u.last_sign_in_at)::date FROM auth.users u WHERE u.id = r.student_id)
           ) AS last_seen,
           (SELECT u.last_sign_in_at IS NULL FROM auth.users u WHERE u.id = r.student_id)
             AS never_signed_in
      FROM roster r
  ),
  hw_recent AS (
    SELECT h.id, hac.class_id,
           row_number() OVER (PARTITION BY hac.class_id
                              ORDER BY h.due_at DESC NULLS LAST, h.created_at DESC) AS rn
      FROM homework_assignments h
      JOIN homework_assignment_classes hac ON hac.homework_assignment_id = h.id
     WHERE h.created_by = v_uid AND hac.class_id = ANY(v_classes)
  ),
  hw AS (
    SELECT r.student_id,
           count(*) FILTER (WHERE s.id IS NOT NULL) AS submitted, count(*) AS expected
      FROM roster r
      JOIN hw_recent hr ON hr.class_id = r.class_id AND hr.rn <= 5
      LEFT JOIN homework_submissions s
             ON s.homework_assignment_id = hr.id AND s.student_id = r.student_id
     GROUP BY r.student_id
  ),
  ex_recent AS (
    SELECT e.id, ec.class_id,
           row_number() OVER (PARTITION BY ec.class_id
                              ORDER BY COALESCE(e.scheduled_date, e.created_at::date) DESC) AS rn
      FROM exams e
      JOIN exam_classes ec ON ec.exam_id = e.id
     WHERE e.created_by = v_uid AND ec.class_id = ANY(v_classes)
       AND e.status IN ('published','active','completed')
  ),
  ex AS (
    SELECT r.student_id,
           count(*) FILTER (WHERE a.id IS NOT NULL) AS attempted, count(*) AS expected
      FROM roster r
      JOIN ex_recent er ON er.class_id = r.class_id AND er.rn <= 3
      LEFT JOIN student_exam_attempts a
             ON a.exam_id = er.id AND a.student_id = r.student_id
     GROUP BY r.student_id
  ),
  scored AS (
    SELECT r.student_id, r.class_id, s.last_seen, s.never_signed_in,
           CASE WHEN s.last_seen IS NULL THEN NULL ELSE v_today - s.last_seen END AS days_since,
           COALESCE(hw.submitted,0) AS hw_submitted, COALESCE(hw.expected,0) AS hw_expected,
           COALESCE(ex.attempted,0) AS ex_attempted, COALESCE(ex.expected,0) AS ex_expected,
           COALESCE(CASE WHEN hw.expected > 0 THEN hw.submitted::numeric / hw.expected END, 1)
         + COALESCE(CASE WHEN ex.expected > 0 THEN ex.attempted::numeric / ex.expected END, 1)
             AS work_score
      FROM roster r
      LEFT JOIN seen s ON s.student_id = r.student_id
      LEFT JOIN hw ON hw.student_id = r.student_id
      LEFT JOIN ex ON ex.student_id = r.student_id
  ),
  ranked AS (
    SELECT sc.*, COALESCE(sc.days_since, 9999) AS stale,
           CASE
             WHEN COALESCE(sc.days_since, 9999) >= 7 AND sc.work_score < 0.8 THEN 'high'
             WHEN COALESCE(sc.days_since, 9999) >= 5 AND sc.work_score < 1.4 THEN 'medium'
             ELSE 'watch'
           END AS severity
      FROM scored sc
     WHERE COALESCE(sc.days_since, 9999) >= 3
  )
  SELECT COALESCE(jsonb_agg(x ORDER BY sev_rank, stale DESC), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT jsonb_build_object(
             'student_id',   rk.student_id,
             'student_name', (SELECT pf.full_name FROM profiles pf WHERE pf.id = rk.student_id),
             'class_id',     rk.class_id,
             'class_name',   c.name,
             'section',      c.section,
             'days_since',   rk.days_since,
             'never_seen',   COALESCE(rk.never_signed_in, false),
             'hw_submitted', rk.hw_submitted,
             'hw_expected',  rk.hw_expected,
             'ex_attempted', rk.ex_attempted,
             'ex_expected',  rk.ex_expected,
             'severity',     rk.severity,
             'note',         CASE WHEN rk.severity = 'watch' AND rk.work_score >= 1.6
                                  THEN 'Logs in rarely, work is otherwise fine' END
           ) AS x,
           CASE rk.severity WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END AS sev_rank,
           rk.stale
      FROM ranked rk
      JOIN classes c ON c.id = rk.class_id
     ORDER BY CASE rk.severity WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, rk.stale DESC
     LIMIT p_limit
  ) q;

  RETURN jsonb_build_object('has_data', jsonb_array_length(v_rows) > 0, 'students', v_rows);
END $function$
;

-- ---------- dash_teacher_roster_gap() ----------
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
    FROM public.dash_resolve_teacher_pairs() p;
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
END $function$
;

-- ---------- dash_teacher_student_distribution(p_class_id uuid) ----------
CREATE OR REPLACE FUNCTION public.dash_teacher_student_distribution(p_class_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_classes uuid[];
  v_dw int; v_cu int; v_nh int; v_total int; v_eval int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'dashboard: not authenticated'; END IF;
  v_inst := public.get_user_institution(auth.uid());

  SELECT array_agg(DISTINCT p.class_id) INTO v_classes
    FROM public.dash_resolve_teacher_pairs() p;
  IF v_classes IS NULL THEN
    RETURN jsonb_build_object('doing_well', 0, 'catching_up', 0, 'needs_help', 0,
                              'total', 0, 'evaluated', 0);
  END IF;

  -- A caller-supplied class must be one of mine; otherwise the parameter could
  -- widen scope, which is the one thing this family must never allow.
  IF p_class_id IS NOT NULL THEN
    IF NOT (p_class_id = ANY(v_classes)) THEN
      RAISE EXCEPTION 'dashboard: class not in scope';
    END IF;
    v_classes := ARRAY[p_class_id];
  END IF;

  WITH latest AS (
    SELECT DISTINCT ON (a.student_id) a.student_id, fr.percentage
      FROM final_results fr
      JOIN student_exam_attempts a ON a.id = fr.attempt_id AND a.class_id = ANY(v_classes)
                                  -- Subject-scoped (policy 2026-08-26)
                                  AND a.student_id IN (SELECT r.student_id
                                       FROM public.teacher_roster_student_ids(auth.uid(), v_classes) r)
      JOIN exams e ON e.id = a.exam_id
                  AND e.institution_id = v_inst
                  AND e.status IN ('published','active','completed')
     ORDER BY a.student_id, coalesce(fr.finalized_at, fr.created_at) DESC
  )
  SELECT count(*) FILTER (WHERE percentage > 70),
         count(*) FILTER (WHERE percentage BETWEEN 50 AND 70),
         count(*) FILTER (WHERE percentage < 50),
         count(*)
    INTO v_dw, v_cu, v_nh, v_eval
    FROM latest;

  SELECT count(DISTINCT r.student_id) INTO v_total
    FROM public.teacher_roster_student_ids(auth.uid(), v_classes) r;

  RETURN jsonb_build_object('doing_well', v_dw, 'catching_up', v_cu, 'needs_help', v_nh,
                            'total', v_total, 'evaluated', v_eval);
END $function$
;

-- ---------- dash_teacher_students_attention(p_limit integer) ----------
CREATE OR REPLACE FUNCTION public.dash_teacher_students_attention(p_limit integer DEFAULT 25)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid(); v_inst uuid;
  v_pc uuid[]; v_ps uuid[]; v_classes uuid[]; v_rows jsonb;
  v_tz text; v_today date;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'dashboard: not authenticated'; END IF;
  p_limit := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);
  v_inst := public.get_user_institution(v_uid);

  SELECT array_agg(p.class_id), array_agg(p.subject_id)
    INTO v_pc, v_ps FROM public.dash_resolve_teacher_pairs() p;
  IF v_pc IS NULL THEN
    RETURN jsonb_build_object('has_data', false, 'students', '[]'::jsonb);
  END IF;
  SELECT array_agg(DISTINCT x) INTO v_classes FROM unnest(v_pc) AS x;

  SELECT i.timezone INTO v_tz FROM institutions i WHERE i.id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;

  WITH roster AS (
    -- The teacher's OWN students (policy 2026-08-26): subject-scoped.
    -- Dormant optional subjects still yield the whole class inside
    -- teacher_roster_student_ids, so this cannot collapse to one pupil.
    SELECT ca.user_id AS student_id,
           (array_agg(ca.class_id ORDER BY ca.class_id))[1] AS class_id
      FROM class_assignments ca
     WHERE ca.role = 'student' AND ca.class_id = ANY(v_classes)
       AND ca.user_id IN (SELECT r.student_id
                            FROM public.teacher_roster_student_ids(v_uid, v_classes) r)
     GROUP BY ca.user_id
  ),
  perf AS (
    SELECT a.student_id, round(avg(fr.percentage), 1) AS pct
      FROM student_exam_attempts a
      JOIN final_results fr ON fr.attempt_id = a.id
      JOIN exams e  ON e.id = a.exam_id AND e.institution_id = v_inst
      JOIN exam_subjects es ON es.exam_id = e.id
     WHERE EXISTS (SELECT 1 FROM unnest(v_pc, v_ps) AS pr(cid, sid)
                    WHERE pr.cid = a.class_id AND (pr.sid IS NULL OR pr.sid = es.subject_id))
     GROUP BY a.student_id
  ),
  att AS (
    SELECT ar.student_id,
           round(count(*) FILTER (WHERE ar.status IN ('present','late')) * 100.0
                 / NULLIF(count(*), 0), 0) AS pct
      FROM attendance_records ar
     WHERE ar.class_id = ANY(v_classes) AND ar.date > v_today - 30
     GROUP BY ar.student_id
  ),
  hw_recent AS (
    SELECT h.id, hac.class_id,
           row_number() OVER (PARTITION BY hac.class_id
                              ORDER BY h.due_at DESC NULLS LAST, h.created_at DESC) AS rn
      FROM homework_assignments h
      JOIN homework_assignment_classes hac ON hac.homework_assignment_id = h.id
     WHERE h.created_by = v_uid AND hac.class_id = ANY(v_classes)
  ),
  hw AS (
    SELECT r.student_id,
           count(*) FILTER (WHERE s.id IS NULL) AS missed, count(*) AS expected
      FROM roster r
      JOIN hw_recent hr ON hr.class_id = r.class_id AND hr.rn <= 5
      LEFT JOIN homework_submissions s
             ON s.homework_assignment_id = hr.id AND s.student_id = r.student_id
     GROUP BY r.student_id
  ),
  ex_recent AS (
    SELECT e.id, ec.class_id,
           row_number() OVER (PARTITION BY ec.class_id
                              ORDER BY COALESCE(e.scheduled_date, e.created_at::date) DESC) AS rn
      FROM exams e
      JOIN exam_classes ec ON ec.exam_id = e.id
     WHERE e.created_by = v_uid AND ec.class_id = ANY(v_classes)
       AND e.status IN ('published','active','completed')
  ),
  ex AS (
    SELECT r.student_id,
           count(*) FILTER (WHERE a.id IS NULL) AS skipped, count(*) AS expected
      FROM roster r
      JOIN ex_recent er ON er.class_id = r.class_id AND er.rn <= 3
      LEFT JOIN student_exam_attempts a
             ON a.exam_id = er.id AND a.student_id = r.student_id
     GROUP BY r.student_id
  ),
  scored AS (
    SELECT r.student_id, r.class_id,
           (perf.pct IS NOT NULL AND perf.pct < 50)     AS s_perf,
           (att.pct  IS NOT NULL AND att.pct  < 75)     AS s_att,
           (COALESCE(hw.missed, 0) >= 2)                AS s_hw,
           (COALESCE(ex.skipped, 0) >= 1)               AS s_ex,
           perf.pct AS perf_pct, att.pct AS att_pct,
           hw.missed, hw.expected AS hw_expected,
           ex.skipped, ex.expected AS ex_expected
      FROM roster r
      LEFT JOIN perf ON perf.student_id = r.student_id
      LEFT JOIN att  ON att.student_id  = r.student_id
      LEFT JOIN hw   ON hw.student_id   = r.student_id
      LEFT JOIN ex   ON ex.student_id   = r.student_id
  ),
  ranked AS (
    SELECT s.*, (s_perf::int + s_att::int + s_hw::int + s_ex::int) AS signals
      FROM scored s
  )
  SELECT COALESCE(jsonb_agg(x ORDER BY signals DESC, COALESCE(perf_pct, 100) ASC), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT jsonb_build_object(
             'student_id',   rk.student_id,
             'student_name', (SELECT pf.full_name FROM profiles pf WHERE pf.id = rk.student_id),
             'class_id',     rk.class_id,
             'class_name',   c.name,
             'section',      c.section,
             'severity',     CASE WHEN rk.signals >= 3 THEN 'high'
                                  WHEN rk.signals = 2  THEN 'medium'
                                  ELSE 'watch' END,
             'reasons',      (
               SELECT jsonb_agg(z) FROM (
                 SELECT 'Scoring ' || rk.perf_pct || '% in your subject' AS z WHERE rk.s_perf
                 UNION ALL
                 SELECT 'Attendance ' || rk.att_pct || '% in your classes' WHERE rk.s_att
                 UNION ALL
                 SELECT 'Missed ' || rk.missed || ' of ' || rk.hw_expected || ' homework' WHERE rk.s_hw
                 UNION ALL
                 SELECT 'Skipped ' || rk.skipped || ' of ' || rk.ex_expected || ' tests' WHERE rk.s_ex
               ) r2(z))
           ) AS x, rk.signals, rk.perf_pct
      FROM ranked rk
      JOIN classes c ON c.id = rk.class_id
     WHERE rk.signals > 0
     ORDER BY rk.signals DESC, COALESCE(rk.perf_pct, 100) ASC
     LIMIT p_limit
  ) q;

  RETURN jsonb_build_object('has_data', jsonb_array_length(v_rows) > 0, 'students', v_rows);
END $function$
;

-- ---------- dash_teacher_subject_performance(p_class_id uuid) ----------
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
    FROM public.dash_resolve_teacher_pairs() p;

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
END $function$
;

-- ---------- dash_teacher_syllabus_chapters(p_class_id uuid, p_subject_id uuid) ----------
CREATE OR REPLACE FUNCTION public.dash_teacher_syllabus_chapters(p_class_id uuid DEFAULT NULL::uuid, p_subject_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid(); v_inst uuid;
  v_pc uuid[]; v_ps uuid[]; v_tz text; v_today date; v_rows jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'dashboard: not authenticated'; END IF;
  v_inst := public.get_user_institution(v_uid);

  SELECT array_agg(p.class_id), array_agg(p.subject_id)
    INTO v_pc, v_ps FROM public.dash_resolve_teacher_pairs() p;
  IF v_pc IS NULL THEN
    RETURN jsonb_build_object('has_data', false, 'subjects', '[]'::jsonb);
  END IF;

  -- Filters may only narrow: anything outside the caller's own pairs raises.
  IF p_class_id IS NOT NULL AND NOT (p_class_id = ANY(v_pc)) THEN
    RAISE EXCEPTION 'dashboard: class not in scope';
  END IF;
  IF p_subject_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM unnest(v_ps) AS s(sid) WHERE s.sid = p_subject_id) THEN
    RAISE EXCEPTION 'dashboard: subject not in scope';
  END IF;

  SELECT i.timezone INTO v_tz FROM institutions i WHERE i.id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;

  WITH pairs AS (
    SELECT DISTINCT pr.cid AS class_id, pr.sid AS subject_id
      FROM unnest(v_pc, v_ps) AS pr(cid, sid)
     WHERE pr.sid IS NOT NULL
       AND (p_class_id IS NULL OR pr.cid = p_class_id)
       AND (p_subject_id IS NULL OR pr.sid = p_subject_id)
  ),
  chapters AS (
    SELECT p.class_id, p.subject_id, st.id AS topic_id, st.topic_name,
           st.chapter_number, st.display_order
      FROM pairs p
      JOIN syllabus_topics st ON st.subject_id = p.subject_id
                             AND COALESCE(st.is_active, true)
  ),
  progress AS (
    SELECT spe.class_id, spe.subject_id, spe.topic_id,
           bool_or(spe.action = 'completed') AS is_done,
           bool_or(spe.action = 'partial')   AS is_partial,
           max(spe.date)                     AS last_logged_on
      FROM syllabus_progress_events spe
     WHERE spe.institution_id = v_inst
     GROUP BY spe.class_id, spe.subject_id, spe.topic_id
  ),
  planned AS (
    SELECT lp.class_id, lp.subject_id, lp.topic_id, min(lp.date) AS next_planned_on
      FROM tt_lesson_plans lp
     WHERE lp.institution_id = v_inst AND lp.topic_id IS NOT NULL
       AND lp.date >= v_today
     GROUP BY lp.class_id, lp.subject_id, lp.topic_id
  ),
  exams AS (
    -- The teacher's OWN exams that name this chapter, in this class.
    SELECT et.topic_id, ec.class_id, count(DISTINCT e.id) AS exams_count
      FROM exam_topics et
      JOIN exams e ON e.id = et.exam_id AND e.created_by = v_uid
      JOIN exam_classes ec ON ec.exam_id = e.id
     WHERE e.status IN ('published','active','completed')
     GROUP BY et.topic_id, ec.class_id
  ),
  rows AS (
    SELECT c.class_id, c.subject_id,
           cl.name AS class_name, cl.section, us.name AS subject_name,
           c.topic_id, c.topic_name, c.chapter_number,
           CASE
             WHEN pg.is_done                THEN 'completed'
             WHEN pg.is_partial             THEN 'partial'
             WHEN pl.next_planned_on IS NOT NULL THEN 'scheduled'
             ELSE 'not_started'
           END AS status,
           pg.last_logged_on,
           pl.next_planned_on,
           COALESCE(ex.exams_count, 0) AS exams_count,
           COALESCE(c.display_order, 9999) AS ord
      FROM chapters c
      JOIN classes cl ON cl.id = c.class_id
      JOIN universal_subjects us ON us.id = c.subject_id
      LEFT JOIN progress pg ON pg.class_id = c.class_id
                           AND pg.subject_id = c.subject_id
                           AND pg.topic_id = c.topic_id
      LEFT JOIN planned pl ON pl.class_id = c.class_id
                          AND pl.subject_id = c.subject_id
                          AND pl.topic_id = c.topic_id
      LEFT JOIN exams ex ON ex.topic_id = c.topic_id AND ex.class_id = c.class_id
  )
  SELECT COALESCE(jsonb_agg(sub ORDER BY subject_name, class_name), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT r.subject_name, r.class_name,
           jsonb_build_object(
             'class_id',     r.class_id,
             'class_name',   r.class_name,
             'section',      r.section,
             'subject_id',   r.subject_id,
             'subject_name', r.subject_name,
             'total',        count(*),
             'completed',    count(*) FILTER (WHERE r.status = 'completed'),
             'partial',      count(*) FILTER (WHERE r.status = 'partial'),
             'scheduled',    count(*) FILTER (WHERE r.status = 'scheduled'),
             'not_started',  count(*) FILTER (WHERE r.status = 'not_started'),
             'exams_total',  sum(r.exams_count),
             'chapters', jsonb_agg(jsonb_build_object(
                'topic_id',        r.topic_id,
                'name',            r.topic_name,
                'chapter_number',  r.chapter_number,
                'status',          r.status,
                'last_logged_on',  r.last_logged_on,
                'next_planned_on', r.next_planned_on,
                'exams_count',     r.exams_count
             ) ORDER BY r.ord, r.chapter_number NULLS LAST, r.topic_name)
           ) AS sub
      FROM rows r
     GROUP BY r.class_id, r.class_name, r.section, r.subject_id, r.subject_name
  ) q;

  RETURN jsonb_build_object('has_data', jsonb_array_length(v_rows) > 0, 'subjects', v_rows);
END $function$
;

-- ---------- dash_teacher_syllabus_coverage() ----------
CREATE OR REPLACE FUNCTION public.dash_teacher_syllabus_coverage()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_inst uuid; v_rows jsonb; v_tz text; v_today date;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'dashboard: not authenticated'; END IF;
  v_inst := public.get_user_institution(v_uid);
  SELECT i.timezone INTO v_tz FROM institutions i WHERE i.id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;

  WITH pairs AS (
    SELECT DISTINCT p.class_id, p.subject_id
      FROM public.dash_resolve_teacher_pairs() p WHERE p.subject_id IS NOT NULL
  ),
  totals AS (
    SELECT pr.class_id, pr.subject_id,
           (SELECT count(*) FROM syllabus_topics st
             WHERE st.subject_id = pr.subject_id AND COALESCE(st.is_active, true)) AS total_chapters
      FROM pairs pr
  ),
  done AS (
    SELECT spe.class_id, spe.subject_id,
           count(DISTINCT spe.topic_id) FILTER (WHERE spe.action = 'completed') AS done_chapters,
           max(spe.date) AS last_logged_on
      FROM syllabus_progress_events spe
     WHERE spe.institution_id = v_inst
     GROUP BY spe.class_id, spe.subject_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'class_id',       t.class_id,
           'class_name',     c.name,
           'section',        c.section,
           'subject_id',     t.subject_id,
           'subject_name',   us.name,
           'total_chapters', t.total_chapters,
           'done_chapters',  COALESCE(d.done_chapters, 0),
           'coverage_pct',   CASE WHEN t.total_chapters > 0
                                  THEN round(COALESCE(d.done_chapters,0) * 100.0 / t.total_chapters, 0)
                             END,
           'last_logged_on', d.last_logged_on,
           -- Recency, NOT pacing: there is no per-chapter due date to judge against.
           'days_since_log', CASE WHEN d.last_logged_on IS NOT NULL
                                  THEN (v_today - d.last_logged_on) END
         ) ORDER BY us.name, c.name), '[]'::jsonb) INTO v_rows
    FROM totals t
    JOIN classes c ON c.id = t.class_id
    JOIN universal_subjects us ON us.id = t.subject_id
    LEFT JOIN done d ON d.class_id = t.class_id AND d.subject_id = t.subject_id;

  RETURN jsonb_build_object('has_data', jsonb_array_length(v_rows) > 0, 'subjects', v_rows);
END $function$
;

-- ---------- dash_teacher_weak_chapters(p_limit integer) ----------
CREATE OR REPLACE FUNCTION public.dash_teacher_weak_chapters(p_limit integer DEFAULT 8)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_rows jsonb; v_pc uuid[]; v_ps uuid[];
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'dashboard: not authenticated'; END IF;
  p_limit := LEAST(GREATEST(COALESCE(p_limit, 8), 1), 25);

  SELECT array_agg(p.class_id), array_agg(p.subject_id)
    INTO v_pc, v_ps
    FROM public.dash_resolve_teacher_pairs() p;

  IF v_pc IS NULL THEN
    RETURN jsonb_build_object('has_data', false, 'chapters', '[]'::jsonb);
  END IF;

  WITH scored AS (
    SELECT st.topic_name          AS chapter,
           us.name                AS subject_name,
           a.student_id,
           fr.percentage::numeric AS pct
      FROM exams e
      JOIN exam_topics et          ON et.exam_id = e.id
      JOIN syllabus_topics st      ON st.id = et.topic_id
      JOIN exam_subjects esx       ON esx.exam_id = e.id
      JOIN universal_subjects us   ON us.id = esx.subject_id
      JOIN student_exam_attempts a ON a.exam_id = e.id
      JOIN final_results fr        ON fr.attempt_id = a.id
     WHERE e.created_by = v_uid
       AND e.status IN ('published','active','completed')
       AND COALESCE(btrim(st.topic_name), '') <> ''
       -- The exam's class AND subject must both be mine.
       AND EXISTS (
         SELECT 1 FROM unnest(v_pc, v_ps) AS pr(cid, sid)
          WHERE pr.cid = a.class_id
            AND (pr.sid IS NULL OR pr.sid = esx.subject_id)
       )
  ),
  per_student AS (
    -- One figure per pupil per chapter, so a pupil who sat three papers on the
    -- same chapter counts once rather than three times.
    SELECT chapter, subject_name, student_id, avg(pct) AS pct
      FROM scored GROUP BY chapter, subject_name, student_id
  ),
  per_chapter AS (
    SELECT chapter, subject_name,
           round(avg(pct), 1)               AS mastery_pct,
           count(*)                         AS students,
           count(*) FILTER (WHERE pct < 50) AS below_50
      FROM per_student GROUP BY chapter, subject_name
  )
  SELECT COALESCE(jsonb_agg(x ORDER BY mastery_pct ASC), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT jsonb_build_object(
             'tag',          chapter,          -- key kept as `tag` so the UI is unchanged
             'subject_name', subject_name,
             'mastery_pct',  mastery_pct,
             'students',     students,
             'below_50',     below_50
           ) AS x, mastery_pct
      FROM per_chapter
     -- Minimum evidence: 3 pupils, not 5. Five was borrowed from advice written
     -- for large cohorts and hid every genuine result in a 9-pupil class.
     WHERE students >= 3 AND mastery_pct < 70
     ORDER BY mastery_pct ASC
     LIMIT p_limit
  ) q;

  RETURN jsonb_build_object('has_data', jsonb_array_length(v_rows) > 0, 'chapters', v_rows);
END $function$
;

