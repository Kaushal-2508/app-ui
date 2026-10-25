-- Staff-scoped variants of every RPC the student dashboard reads.
--
-- WHY: /school/student/:studentId must show the SAME dashboard the student
-- sees, but every one of these RPCs derives its subject from auth.uid(), so a
-- staff caller got their own (empty) data. This gives each one an authorised
-- on-behalf-of entry point, following the shape already established by
-- 20260824120000 for the year report.
--
-- SHAPE, per function:
--     _X_impl(p_uid, ...)   the original body, subject passed in explicitly
--     X(...)                self-serve wrapper, unchanged signature/behaviour
--     X_for(p_student_id, ...)  staff wrapper, authorised before it runs
-- Both public entry points share ONE implementation, so the student's dashboard
-- and their teacher's view of it cannot drift.
--
-- AUTHORISATION is can_edit_student_details(actor, student), the house
-- scope-strict staff predicate: super_admin; school/super_school_admin and
-- student_manager within their own institution; coordinators additionally
-- wing-scoped to one of the student's classes; teachers who actually teach one.
-- Deliberately NOT can_view_student_details, which would let any teacher in the
-- institution read any child's full record.
--
-- THE SUBTLE ONE: student_overall_class_standing and
-- student_subject_class_comparison call student_resolve_classes() internally,
-- and that helper reads auth.uid() itself. Swapping only the outer auth.uid()
-- would have left the comparison cohort resolving to the STAFF member's classes
-- - not an error, just quietly wrong class averages. Inner calls are rewritten
-- to _student_resolve_classes_impl(p_uid).
--
-- Every _impl is SECURITY DEFINER but revoked from all client roles, so it is
-- reachable only through the wrappers, which run as the definer.

CREATE OR REPLACE FUNCTION public._student_resolve_classes_impl(p_uid uuid)
 RETURNS uuid[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(array_agg(DISTINCT ca.class_id), '{}'::uuid[])
  FROM class_assignments ca
  WHERE ca.user_id = p_uid AND ca.role = 'student';
$function$;

CREATE OR REPLACE FUNCTION public.student_resolve_classes()
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public._student_resolve_classes_impl(auth.uid());
$$;

-- ---------------------------------------------------------------- student_overall_class_standing
CREATE OR REPLACE FUNCTION public._student_overall_class_standing_impl(p_uid uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := p_uid;
  v_classes uuid[];
  v_cd numeric; v_n int; v_my_avg numeric; v_class_avg numeric;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  v_classes := public._student_resolve_classes_impl(p_uid);

  WITH per_student AS (
    SELECT a.student_id, avg(fr.percentage) AS avg_pct
    FROM final_results fr
    JOIN student_exam_attempts a ON a.id = fr.attempt_id
    JOIN exams e ON e.id = a.exam_id AND e.status IN ('published','active','completed')
    WHERE fr.is_published = true AND a.class_id = ANY(v_classes)
    GROUP BY a.student_id
  ),
  ranked AS (
    SELECT student_id, avg_pct, cume_dist() OVER (ORDER BY avg_pct) AS cd
    FROM per_student
  )
  SELECT (SELECT cd FROM ranked WHERE student_id = v_uid LIMIT 1),
         count(*),
         (SELECT avg_pct FROM per_student WHERE student_id = v_uid LIMIT 1),
         round(avg(avg_pct), 1)
    INTO v_cd, v_n, v_my_avg, v_class_avg
  FROM per_student;

  IF v_my_avg IS NULL THEN
    RETURN jsonb_build_object('has_data', false);
  END IF;

  RETURN jsonb_build_object(
    'has_data', true,
    'student_percentile', CASE WHEN v_cd IS NULL THEN NULL ELSE round(v_cd * 100)::int END,
    'cohort_size', v_n,
    'student_avg', round(v_my_avg, 1),
    'class_avg', v_class_avg
  );
END $function$;

CREATE OR REPLACE FUNCTION public.student_overall_class_standing()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  RETURN public._student_overall_class_standing_impl(auth.uid());
END $$;

CREATE OR REPLACE FUNCTION public.student_overall_class_standing_for(p_student_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_student_id IS NULL THEN RAISE EXCEPTION 'no student specified'; END IF;
  IF NOT public.can_edit_student_details(v_actor, p_student_id) THEN
    RAISE EXCEPTION 'not authorized for this student';
  END IF;
  RETURN public._student_overall_class_standing_impl(p_student_id);
END $$;

-- ---------------------------------------------------------------- student_score_trend
CREATE OR REPLACE FUNCTION public._student_score_trend_impl(p_uid uuid, p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := p_uid; v_rows jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  WITH mine AS (
    SELECT e.id AS exam_id, e.title, e.exam_type,
           COALESCE(e.published_at::date, e.scheduled_date::date, a.submitted_at::date, fr.created_at::date) AS exam_date,
           fr.percentage,
           COALESCE(fr.published_at, fr.finalized_at, fr.created_at) AS ord
    FROM final_results fr
    JOIN student_exam_attempts a ON a.id = fr.attempt_id
    JOIN exams e ON e.id = a.exam_id AND e.status IN ('published','active','completed')
    WHERE a.student_id = v_uid AND fr.is_published = true
    ORDER BY ord DESC
    LIMIT GREATEST(p_limit, 1)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'exam_id', exam_id, 'title', title, 'exam_type', exam_type,
           'exam_date', exam_date, 'percentage', percentage
         ) ORDER BY ord ASC), '[]'::jsonb)
    INTO v_rows FROM mine;
  RETURN v_rows;
END $function$;

CREATE OR REPLACE FUNCTION public.student_score_trend(p_limit integer DEFAULT 8)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  RETURN public._student_score_trend_impl(auth.uid(), p_limit);
END $$;

CREATE OR REPLACE FUNCTION public.student_score_trend_for(p_student_id uuid, p_limit integer DEFAULT 8)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_student_id IS NULL THEN RAISE EXCEPTION 'no student specified'; END IF;
  IF NOT public.can_edit_student_details(v_actor, p_student_id) THEN
    RAISE EXCEPTION 'not authorized for this student';
  END IF;
  RETURN public._student_score_trend_impl(p_student_id, p_limit);
END $$;

-- ---------------------------------------------------------------- student_achievements
CREATE OR REPLACE FUNCTION public._student_achievements_impl(p_uid uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := p_uid;
  v_points int;
  v_streak jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  -- Points are summed over EARNED rows, including badges since deactivated, so a
  -- student never loses points because the catalog was reorganised under them.
  SELECT COALESCE(sum(bd.points), 0) INTO v_points
  FROM user_badges ub
  JOIN badge_definitions bd ON bd.id = ub.badge_id
  WHERE ub.user_id = v_uid;

  v_streak := public.student_streak(v_uid);

  RETURN jsonb_build_object(
    'points', v_points,
    'rank', public.badge_rank_for_points(v_points),
    'next_rank_at', CASE
                      WHEN v_points >= 1000 THEN NULL
                      WHEN v_points >= 600  THEN 1000
                      WHEN v_points >= 300  THEN 600
                      WHEN v_points >= 100  THEN 300
                      ELSE 100 END,
    'streak', v_streak,
    'catalog', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', bd.id, 'name', bd.name, 'description', bd.description,
               'icon_name', bd.icon_name, 'category', bd.category, 'tier', bd.tier,
               'points', bd.points, 'criteria_type', bd.criteria_type,
               'criteria_metric', bd.criteria_metric, 'criteria_value', bd.criteria_value,
               'display_order', bd.display_order)
             ORDER BY bd.display_order, bd.name)
      FROM badge_definitions bd
      WHERE bd.is_active AND bd.badge_type = 'student'), '[]'::jsonb),
    -- Earned is an ARRAY, not a map: Player of the Month can be held many times
    -- over a year, one row per period_key, and a map would silently collapse them.
    'earned', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'badge_id', ub.badge_id, 'earned_at', ub.earned_at,
               'period_key', ub.period_key)
             ORDER BY ub.earned_at DESC)
      FROM user_badges ub WHERE ub.user_id = v_uid), '[]'::jsonb),
    'progress', COALESCE((
      SELECT jsonb_object_agg(bp.badge_id, jsonb_build_object(
               'current', bp.current_value, 'target', bp.target_value))
      FROM badge_progress bp WHERE bp.user_id = v_uid), '{}'::jsonb)
  );
END $function$;

CREATE OR REPLACE FUNCTION public.student_achievements()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  RETURN public._student_achievements_impl(auth.uid());
END $$;

CREATE OR REPLACE FUNCTION public.student_achievements_for(p_student_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_student_id IS NULL THEN RAISE EXCEPTION 'no student specified'; END IF;
  IF NOT public.can_edit_student_details(v_actor, p_student_id) THEN
    RAISE EXCEPTION 'not authorized for this student';
  END IF;
  RETURN public._student_achievements_impl(p_student_id);
END $$;

-- ---------------------------------------------------------------- student_attendance_summary
CREATE OR REPLACE FUNCTION public._student_attendance_summary_impl(p_uid uuid, p_range text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := p_uid;
  v_inst uuid;
  v_tz text;
  v_today date;
  v_range text;
  v_from date;
  v_to date;
  v_ay_code text; v_ay_start date; v_ay_end date;
  v_present int; v_absent int; v_excused int; v_holiday int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  v_range := CASE WHEN p_range IN ('tm','1m','3m','6m','ay') THEN p_range ELSE '1m' END;

  v_inst := public.get_user_institution(v_uid);
  SELECT i.timezone INTO v_tz FROM institutions i WHERE i.id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;

  IF v_range = 'ay' THEN
    SELECT ay.code, ay.starts_on, ay.ends_on
      INTO v_ay_code, v_ay_start, v_ay_end
    FROM cal_academic_years ay
    WHERE ay.institution_id = v_inst
    ORDER BY (v_today BETWEEN ay.starts_on AND ay.ends_on) DESC, ay.is_active DESC, ay.starts_on DESC
    LIMIT 1;
    v_from := COALESCE(v_ay_start, (v_today - INTERVAL '1 year')::date);
    v_to   := LEAST(COALESCE(v_ay_end, v_today), v_today);
  ELSIF v_range = 'tm' THEN
    -- Calendar month to date: the same window the status-strip tile counts.
    v_from := date_trunc('month', v_today)::date;
    v_to   := v_today;
  ELSE
    v_from := (v_today - (CASE v_range
                            WHEN '3m' THEN INTERVAL '3 months'
                            WHEN '6m' THEN INTERVAL '6 months'
                            ELSE INTERVAL '1 month' END))::date;
    v_to := v_today;
  END IF;

  WITH hol AS (
    -- Every holiday DAY inside the window (multi-day holidays expanded).
    SELECT DISTINCT d::date AS day
    FROM cal_events ce
    CROSS JOIN LATERAL generate_series(ce.starts_on::date, ce.ends_on::date, INTERVAL '1 day') d
    WHERE ce.institution_id = v_inst
      AND ce.kind = 'holiday'
      AND ce.starts_on::date <= v_to
      AND ce.ends_on::date >= v_from
      AND d::date BETWEEN v_from AND v_to
  ),
  eff AS (
    SELECT CASE WHEN h.day IS NOT NULL THEN 'holiday' ELSE ar.status END AS status
    FROM attendance_records ar
    LEFT JOIN hol h ON h.day = ar.date
    WHERE ar.student_id = v_uid
      AND ar.date BETWEEN v_from AND v_to
  )
  SELECT count(*) FILTER (WHERE status = 'present'),
         count(*) FILTER (WHERE status = 'absent'),
         count(*) FILTER (WHERE status IN ('sick','casual')),
         (SELECT count(*) FROM hol)
    INTO v_present, v_absent, v_excused, v_holiday
  FROM eff;

  v_present := COALESCE(v_present, 0);
  v_absent  := COALESCE(v_absent, 0);
  v_excused := COALESCE(v_excused, 0);
  v_holiday := COALESCE(v_holiday, 0);

  RETURN jsonb_build_object(
    'range', v_range,
    'from', to_char(v_from, 'YYYY-MM-DD'),
    'to', to_char(v_to, 'YYYY-MM-DD'),
    'academic_year', v_ay_code,
    'present', v_present,
    'absent', v_absent,
    'excused', v_excused,
    'holiday', v_holiday,
    'graded_days', v_present + v_absent,
    'percentage', CASE WHEN (v_present + v_absent) > 0
                       THEN round(v_present * 100.0 / (v_present + v_absent), 1) END
  );
END $function$;

CREATE OR REPLACE FUNCTION public.student_attendance_summary(p_range text DEFAULT '1m')
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  RETURN public._student_attendance_summary_impl(auth.uid(), p_range);
END $$;

CREATE OR REPLACE FUNCTION public.student_attendance_summary_for(p_student_id uuid, p_range text DEFAULT '1m')
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_student_id IS NULL THEN RAISE EXCEPTION 'no student specified'; END IF;
  IF NOT public.can_edit_student_details(v_actor, p_student_id) THEN
    RAISE EXCEPTION 'not authorized for this student';
  END IF;
  RETURN public._student_attendance_summary_impl(p_student_id, p_range);
END $$;

-- ---------------------------------------------------------------- student_performance_trend
CREATE OR REPLACE FUNCTION public._student_performance_trend_impl(p_uid uuid, p_subject text, p_range text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := p_uid;
  v_inst uuid;
  v_tz text;
  v_today date;
  v_range text;
  v_subject text;
  v_from date;
  v_to date;                            -- NULL = open-ended (relative windows)
  v_ay_code text; v_ay_start date; v_ay_end date;
  v_subjects jsonb;
  v_points jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  v_range := CASE WHEN p_range IN ('1m','3m','6m','ay') THEN p_range ELSE '3m' END;
  v_subject := NULLIF(btrim(COALESCE(p_subject, '')), '');
  IF v_subject IS NOT NULL THEN
    v_subject := initcap(lower(v_subject));
  END IF;

  v_inst := public.get_user_institution(v_uid);
  SELECT i.timezone INTO v_tz FROM institutions i WHERE i.id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;

  IF v_range = 'ay' THEN
    SELECT ay.code, ay.starts_on, ay.ends_on
      INTO v_ay_code, v_ay_start, v_ay_end
    FROM cal_academic_years ay
    WHERE ay.institution_id = v_inst
    ORDER BY (v_today BETWEEN ay.starts_on AND ay.ends_on) DESC, ay.is_active DESC, ay.starts_on DESC
    LIMIT 1;
    v_from := COALESCE(v_ay_start, (v_today - INTERVAL '1 year')::date);
    v_to   := COALESCE(v_ay_end, v_today);
  ELSE
    v_from := (v_today - (CASE v_range
                            WHEN '1m' THEN INTERVAL '1 month'
                            WHEN '6m' THEN INTERVAL '6 months'
                            ELSE INTERVAL '3 months' END))::date;
    v_to := NULL;
  END IF;

  SELECT COALESCE(jsonb_agg(t.s ORDER BY t.s), '[]'::jsonb)
    INTO v_subjects
  FROM (
    SELECT DISTINCT initcap(lower(btrim(us.name))) AS s
    FROM final_results fr
    JOIN student_exam_attempts a ON a.id = fr.attempt_id
    JOIN exams e ON e.id = a.exam_id AND e.status IN ('published','active','completed')
    JOIN exam_subjects es ON es.exam_id = e.id
    JOIN universal_subjects us ON us.id = es.subject_id
    WHERE a.student_id = v_uid AND fr.is_published = true
      AND btrim(COALESCE(us.name, '')) <> ''
  ) t;

  WITH mine AS (
    SELECT e.id AS exam_id,
           fr.id AS result_id,          -- NEW: the deep-link target
           e.title, e.exam_type,
           COALESCE(e.published_at::date, e.scheduled_date::date,
                    a.submitted_at::date, fr.created_at::date) AS exam_date,
           fr.percentage,
           COALESCE(fr.published_at, fr.finalized_at, fr.created_at) AS ord
    FROM final_results fr
    JOIN student_exam_attempts a ON a.id = fr.attempt_id
    JOIN exams e ON e.id = a.exam_id AND e.status IN ('published','active','completed')
    WHERE a.student_id = v_uid AND fr.is_published = true
  ),
  filtered AS (
    SELECT m.*
    FROM mine m
    WHERE m.exam_date >= v_from
      AND (v_to IS NULL OR m.exam_date <= v_to)
      AND (v_subject IS NULL OR EXISTS (
             SELECT 1
             FROM exam_subjects es
             JOIN universal_subjects us ON us.id = es.subject_id
             WHERE es.exam_id = m.exam_id
               AND initcap(lower(btrim(us.name))) = v_subject))
    ORDER BY m.ord DESC
    LIMIT 100                            -- bounded (Â§23)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'exam_id', f.exam_id,
           'result_id', f.result_id,
           'title', f.title,
           'exam_type', f.exam_type,
           'exam_date', f.exam_date,
           'percentage', f.percentage
         ) ORDER BY f.ord ASC), '[]'::jsonb)
    INTO v_points
  FROM filtered f;

  RETURN jsonb_build_object(
    'has_data', jsonb_array_length(v_points) > 0,
    'range', v_range,
    'subject', v_subject,
    'academic_year', v_ay_code,
    'from', to_char(v_from, 'YYYY-MM-DD'),
    'to', CASE WHEN v_to IS NULL THEN NULL ELSE to_char(v_to, 'YYYY-MM-DD') END,
    'subjects', v_subjects,
    'points', v_points
  );
END $function$;

CREATE OR REPLACE FUNCTION public.student_performance_trend(p_subject text DEFAULT NULL, p_range text DEFAULT '3m')
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  RETURN public._student_performance_trend_impl(auth.uid(), p_subject, p_range);
END $$;

CREATE OR REPLACE FUNCTION public.student_performance_trend_for(p_student_id uuid, p_subject text DEFAULT NULL, p_range text DEFAULT '3m')
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_student_id IS NULL THEN RAISE EXCEPTION 'no student specified'; END IF;
  IF NOT public.can_edit_student_details(v_actor, p_student_id) THEN
    RAISE EXCEPTION 'not authorized for this student';
  END IF;
  RETURN public._student_performance_trend_impl(p_student_id, p_subject, p_range);
END $$;

-- ---------------------------------------------------------------- student_subject_class_comparison
CREATE OR REPLACE FUNCTION public._student_subject_class_comparison_impl(p_uid uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := p_uid; v_classes uuid[]; v_rows jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  v_classes := public._student_resolve_classes_impl(p_uid);

  WITH res AS (
    SELECT a.student_id,
           initcap(lower(btrim(us.name))) AS subject_name,
           fr.percentage
    FROM final_results fr
    JOIN student_exam_attempts a ON a.id = fr.attempt_id
    JOIN exams e ON e.id = a.exam_id AND e.status IN ('published','active','completed')
    JOIN exam_subjects es ON es.exam_id = e.id
    JOIN universal_subjects us ON us.id = es.subject_id
    WHERE fr.is_published = true
      AND a.class_id = ANY(v_classes)
  ),
  mine AS (
    SELECT subject_name, round(avg(percentage),1) AS student_avg, count(*) AS n_tests
    FROM res WHERE student_id = v_uid
    GROUP BY subject_name
  ),
  cls AS (
    SELECT subject_name, round(avg(percentage),1) AS class_avg,
           count(DISTINCT student_id) AS n_students
    FROM res
    GROUP BY subject_name
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'subject', m.subject_name,
           'student_avg', m.student_avg,
           'class_avg', c.class_avg,
           'n_tests', m.n_tests,
           'n_students', c.n_students
         ) ORDER BY m.student_avg ASC), '[]'::jsonb)
    INTO v_rows
  FROM mine m LEFT JOIN cls c USING (subject_name);

  RETURN jsonb_build_object('has_data', jsonb_array_length(v_rows) > 0, 'subjects', v_rows);
END $function$;

CREATE OR REPLACE FUNCTION public.student_subject_class_comparison()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  RETURN public._student_subject_class_comparison_impl(auth.uid());
END $$;

CREATE OR REPLACE FUNCTION public.student_subject_class_comparison_for(p_student_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_student_id IS NULL THEN RAISE EXCEPTION 'no student specified'; END IF;
  IF NOT public.can_edit_student_details(v_actor, p_student_id) THEN
    RAISE EXCEPTION 'not authorized for this student';
  END IF;
  RETURN public._student_subject_class_comparison_impl(p_student_id);
END $$;

-- ---------------------------------------------------------------- student_chapter_performance
CREATE OR REPLACE FUNCTION public._student_chapter_performance_impl(p_uid uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := p_uid;
  v_rows jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  WITH mine AS (
    SELECT DISTINCT
           e.id AS exam_id,
           fr.percentage,
           st.id AS chapter_id,
           st.topic_name AS chapter,
           initcap(lower(btrim(us.name))) AS subject
    FROM final_results fr
    JOIN student_exam_attempts a ON a.id = fr.attempt_id
    JOIN exams e ON e.id = a.exam_id AND e.status IN ('published','active','completed')
    JOIN exam_topics et ON et.exam_id = e.id
    JOIN syllabus_topics st ON st.id = et.topic_id AND st.is_active
    JOIN universal_subjects us ON us.id = st.subject_id
    WHERE a.student_id = v_uid
      AND fr.is_published = true
      AND btrim(COALESCE(us.name, '')) <> ''
      AND btrim(COALESCE(st.topic_name, '')) <> ''
  ),
  agg AS (
    SELECT subject, chapter,
           round(avg(percentage), 1) AS avg_pct,
           count(DISTINCT exam_id) AS n_tests
    FROM mine
    GROUP BY subject, chapter
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'subject', subject,
           'chapter', chapter,
           'avg_pct', avg_pct,
           'n_tests', n_tests
         ) ORDER BY avg_pct ASC, chapter), '[]'::jsonb)
    INTO v_rows
  FROM agg;

  RETURN v_rows;
END $function$;

CREATE OR REPLACE FUNCTION public.student_chapter_performance()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  RETURN public._student_chapter_performance_impl(auth.uid());
END $$;

CREATE OR REPLACE FUNCTION public.student_chapter_performance_for(p_student_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_student_id IS NULL THEN RAISE EXCEPTION 'no student specified'; END IF;
  IF NOT public.can_edit_student_details(v_actor, p_student_id) THEN
    RAISE EXCEPTION 'not authorized for this student';
  END IF;
  RETURN public._student_chapter_performance_impl(p_student_id);
END $$;

-- ---------------------------------------------------------------- homework_student_feed
CREATE OR REPLACE FUNCTION public._homework_student_feed_impl(p_uid uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := p_uid;
  v_blocked uuid[];
  v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  v_blocked := public.student_blocked_subject_ids(v_uid);

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
      -- Optional-subject filtering: hide only when every linked subject is
      -- blocked (optional + unenrolled). No-linkage / compulsory / unmapped
      -- subjects keep the homework visible.
      AND (
        ( h.subject_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM public.homework_assignment_subjects hs
                          WHERE hs.homework_assignment_id = h.id) )
        OR ( h.subject_id IS NOT NULL AND h.subject_id <> ALL (v_blocked) )
        OR EXISTS (
          SELECT 1 FROM public.homework_assignment_subjects hs
          WHERE hs.homework_assignment_id = h.id
            AND hs.subject_id <> ALL (v_blocked)
        )
      )
  ) t;

  RETURN v_out;
END;
$function$;

CREATE OR REPLACE FUNCTION public.homework_student_feed()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  RETURN public._homework_student_feed_impl(auth.uid());
END $$;

CREATE OR REPLACE FUNCTION public.homework_student_feed_for(p_student_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_student_id IS NULL THEN RAISE EXCEPTION 'no student specified'; END IF;
  IF NOT public.can_edit_student_details(v_actor, p_student_id) THEN
    RAISE EXCEPTION 'not authorized for this student';
  END IF;
  RETURN public._homework_student_feed_impl(p_student_id);
END $$;

-- ---------------------------------------------------------------- student_streak
CREATE OR REPLACE FUNCTION public._student_streak_impl(p_uid uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := p_uid;
  v_inst uuid;
  v_today date;
  v_cursor date;
  v_streak int := 0;
  v_active boolean;
  v_holiday boolean;
  v_guard int := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;


  SELECT p.institution_id INTO v_inst FROM profiles p WHERE p.id = v_uid;
  v_today := public.student_local_date(v_uid);
  IF v_today IS NULL THEN
    RETURN jsonb_build_object('current', 0, 'as_of', NULL, 'active_today', false);
  END IF;

  v_cursor := v_today;
  -- Grace for today: an unfinished today is not a broken streak.
  IF NOT EXISTS (SELECT 1 FROM user_activity_log ual
                 WHERE ual.user_id = v_uid AND ual.activity_date = v_today) THEN
    v_cursor := v_today - 1;
  END IF;

  -- Bounded walk: a streak cannot exceed one academic year, and the guard stops
  -- any pathological loop from running away inside a request.
  WHILE v_guard < 400 LOOP
    v_guard := v_guard + 1;

    -- A declared holiday is neutral: it neither breaks nor extends the streak.
    SELECT EXISTS (
      SELECT 1 FROM cal_events ce
      WHERE ce.institution_id = v_inst
        AND ce.kind = 'holiday'
        AND v_cursor BETWEEN ce.starts_on::date AND ce.ends_on::date
    ) INTO v_holiday;

    IF v_holiday THEN
      v_cursor := v_cursor - 1;
      CONTINUE;
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM user_activity_log ual
      WHERE ual.user_id = v_uid AND ual.activity_date = v_cursor
    ) INTO v_active;

    EXIT WHEN NOT v_active;

    v_streak := v_streak + 1;
    v_cursor := v_cursor - 1;
  END LOOP;

  RETURN jsonb_build_object(
    'current', v_streak,
    'as_of', to_char(v_today, 'YYYY-MM-DD'),
    'active_today', EXISTS (SELECT 1 FROM user_activity_log ual
                            WHERE ual.user_id = v_uid AND ual.activity_date = v_today)
  );
END $function$;

-- Signature and semantics preserved EXACTLY, including the no-session path used
-- by the evaluator and cron, which may ask about anyone.
CREATE OR REPLACE FUNCTION public.student_streak(_user_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_uid uuid := COALESCE(_user_id, v_caller);
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF v_caller IS NOT NULL AND v_uid <> v_caller THEN
    RAISE EXCEPTION 'not authorised to read another user''s streak';
  END IF;
  RETURN public._student_streak_impl(v_uid);
END $$;

CREATE OR REPLACE FUNCTION public.student_streak_for(p_student_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_student_id IS NULL THEN RAISE EXCEPTION 'no student specified'; END IF;
  IF NOT public.can_edit_student_details(v_actor, p_student_id) THEN
    RAISE EXCEPTION 'not authorized for this student';
  END IF;
  RETURN public._student_streak_impl(p_student_id);
END $$;

-- Grants (CLAUDE.md §11: BOTH revokes are required; PUBLIC includes anon).
REVOKE ALL ON FUNCTION public._student_resolve_classes_impl(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._student_resolve_classes_impl(uuid) FROM anon;
REVOKE ALL ON FUNCTION public._student_resolve_classes_impl(uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public._student_streak_impl(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._student_streak_impl(uuid) FROM anon;
REVOKE ALL ON FUNCTION public._student_streak_impl(uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public._student_overall_class_standing_impl(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._student_overall_class_standing_impl(uuid) FROM anon;
REVOKE ALL ON FUNCTION public._student_overall_class_standing_impl(uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public._student_score_trend_impl(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._student_score_trend_impl(uuid, integer) FROM anon;
REVOKE ALL ON FUNCTION public._student_score_trend_impl(uuid, integer) FROM authenticated;
REVOKE ALL ON FUNCTION public._student_achievements_impl(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._student_achievements_impl(uuid) FROM anon;
REVOKE ALL ON FUNCTION public._student_achievements_impl(uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public._student_attendance_summary_impl(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._student_attendance_summary_impl(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public._student_attendance_summary_impl(uuid, text) FROM authenticated;
REVOKE ALL ON FUNCTION public._student_performance_trend_impl(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._student_performance_trend_impl(uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION public._student_performance_trend_impl(uuid, text, text) FROM authenticated;
REVOKE ALL ON FUNCTION public._student_subject_class_comparison_impl(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._student_subject_class_comparison_impl(uuid) FROM anon;
REVOKE ALL ON FUNCTION public._student_subject_class_comparison_impl(uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public._student_chapter_performance_impl(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._student_chapter_performance_impl(uuid) FROM anon;
REVOKE ALL ON FUNCTION public._student_chapter_performance_impl(uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public._homework_student_feed_impl(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._homework_student_feed_impl(uuid) FROM anon;
REVOKE ALL ON FUNCTION public._homework_student_feed_impl(uuid) FROM authenticated;

REVOKE ALL ON FUNCTION public.student_resolve_classes() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.student_resolve_classes() FROM anon;
GRANT EXECUTE ON FUNCTION public.student_resolve_classes() TO authenticated;
REVOKE ALL ON FUNCTION public.student_streak(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.student_streak(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.student_streak(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.student_streak_for(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.student_streak_for(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.student_streak_for(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.student_overall_class_standing() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.student_overall_class_standing() FROM anon;
GRANT EXECUTE ON FUNCTION public.student_overall_class_standing() TO authenticated;
REVOKE ALL ON FUNCTION public.student_overall_class_standing_for(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.student_overall_class_standing_for(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.student_overall_class_standing_for(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.student_score_trend(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.student_score_trend(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.student_score_trend(integer) TO authenticated;
REVOKE ALL ON FUNCTION public.student_score_trend_for(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.student_score_trend_for(uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.student_score_trend_for(uuid, integer) TO authenticated;
REVOKE ALL ON FUNCTION public.student_achievements() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.student_achievements() FROM anon;
GRANT EXECUTE ON FUNCTION public.student_achievements() TO authenticated;
REVOKE ALL ON FUNCTION public.student_achievements_for(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.student_achievements_for(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.student_achievements_for(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.student_attendance_summary(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.student_attendance_summary(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.student_attendance_summary(text) TO authenticated;
REVOKE ALL ON FUNCTION public.student_attendance_summary_for(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.student_attendance_summary_for(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.student_attendance_summary_for(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.student_performance_trend(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.student_performance_trend(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.student_performance_trend(text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.student_performance_trend_for(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.student_performance_trend_for(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.student_performance_trend_for(uuid, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.student_subject_class_comparison() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.student_subject_class_comparison() FROM anon;
GRANT EXECUTE ON FUNCTION public.student_subject_class_comparison() TO authenticated;
REVOKE ALL ON FUNCTION public.student_subject_class_comparison_for(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.student_subject_class_comparison_for(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.student_subject_class_comparison_for(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.student_chapter_performance() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.student_chapter_performance() FROM anon;
GRANT EXECUTE ON FUNCTION public.student_chapter_performance() TO authenticated;
REVOKE ALL ON FUNCTION public.student_chapter_performance_for(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.student_chapter_performance_for(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.student_chapter_performance_for(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.homework_student_feed() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.homework_student_feed() FROM anon;
GRANT EXECUTE ON FUNCTION public.homework_student_feed() TO authenticated;
REVOKE ALL ON FUNCTION public.homework_student_feed_for(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.homework_student_feed_for(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.homework_student_feed_for(uuid) TO authenticated;
