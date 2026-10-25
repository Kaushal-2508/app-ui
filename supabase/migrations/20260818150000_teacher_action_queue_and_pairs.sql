-- Teacher dashboard — Phase 2: action queue (spec 2.3) + my classes & subjects (spec 2.4)
--
-- Both aggregate SERVER-SIDE and return one small JSONB payload each; nothing
-- here ships rows to the client to be counted (CLAUDE.md §23 / Scale Gate 2).
-- Both resolve scope through dash_resolve_scoped_pairs() from Phase 1, so the
-- (class_id, subject_id) boundary is the same one the KPI tiles use.
--
-- DELIBERATE SOURCE CHANGE vs the written spec
-- -------------------------------------------
-- The spec named class_aggregates for 2.4's score and delta. In prod that table
-- holds 13 rows, all written 2026-02-17, and its subject_id FK points at the
-- legacy 6-row `subjects` table while every live table uses universal_subjects.
-- Built on it, 2.4 would render zeroes. These functions compute from
-- final_results -> student_exam_attempts -> exams -> exam_subjects instead,
-- which is current (9,891 results, latest 2026-08-12) and subject-exact.
--
-- Syllabus coverage % is deliberately NOT in the 2.4 payload: syllabus_progress_events
-- holds 82 rows from 8 recorders lifetime, so the column would read 0% for
-- essentially every teacher. It belongs to spec 2.8, gated on real adoption.

-- ---------------------------------------------------------------------------
-- 1. Action queue — four counts, each with context and a destination
-- ---------------------------------------------------------------------------
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
    INTO v_pc, v_ps FROM public.dash_resolve_scoped_pairs() p;
  IF v_pc IS NULL THEN v_pc := ARRAY[]::uuid[]; v_ps := ARRAY[]::uuid[]; END IF;
  SELECT array_agg(DISTINCT x) INTO v_classes FROM unnest(v_pc) AS x;
  v_classes := COALESCE(v_classes, ARRAY[]::uuid[]);

  SELECT i.timezone INTO v_tz FROM institutions i WHERE i.id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;   -- §24
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
END $function$;

-- ---------------------------------------------------------------------------
-- 2. My classes & subjects — one row per (class, subject), weakest first
--
-- Bands are the PRD §12.3 four: <50 Needs Attention, 50-<65 Developing,
-- 65-<85 Stable, >=85 Excellent. No shipped surface implemented them before, so
-- this function is the reference implementation — keep the boundaries here.
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
             'students',     (SELECT count(*) FROM public.teacher_roster_student_ids(v_uid, ARRAY[s.class_id])),
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

-- ---------------------------------------------------------------------------
-- 3. Grants — anon must be revoked BY NAME (CLAUDE.md §11)
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.dash_teacher_action_queue()   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dash_teacher_class_subjects() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.dash_teacher_action_queue()   TO authenticated;
GRANT EXECUTE ON FUNCTION public.dash_teacher_class_subjects() TO authenticated;
