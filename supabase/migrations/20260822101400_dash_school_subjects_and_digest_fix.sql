-- Two fixes found by running the digest against real data.
--
-- 1. exam_subjects.subject_id references UNIVERSAL_SUBJECTS, not subjects.
--    dash_admin_digest joined `subjects`, so its weakest-subject rule matched
--    zero rows and silently never fired. Copied from dash_subject_performance,
--    which had the join right all along.
--
-- 2. dash_subject_performance REQUIRES a class: it raises
--    'dashboard: class not in institution' when p_class_id is NULL, because
--    EXISTS(... WHERE id = NULL) is false. The blueprint's "Subjects by
--    performance" card is school-wide and was calling it with NULL, so it would
--    have shown its error state on every load. Adding the school-wide variant
--    the card actually needs rather than feeding it an arbitrary class.
BEGIN;

/*
 * School-wide subject averages, weakest first.
 *
 * The per-class dash_subject_performance stays as it is — the class drill-down
 * still wants it. This is the aggregate the dashboard card and the digest share,
 * so both read one definition of "weakest subject".
 */
CREATE OR REPLACE FUNCTION public.dash_school_subject_performance(
  p_institution_id uuid DEFAULT NULL
) RETURNS TABLE(
  subject_id uuid, subject_name text, school_avg numeric, results integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inst uuid; v_tz text; v_today date; v_ay_start date; v_ay_end date;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;
  SELECT start_date, end_date INTO v_ay_start, v_ay_end
    FROM public.dash_current_academic_year(v_inst);
  v_ay_start := COALESCE(v_ay_start, v_today - INTERVAL '12 months')::date;
  v_ay_end   := COALESCE(v_ay_end,   v_today)::date;

  RETURN QUERY
  SELECT us.id,
         us.name,
         round(avg(fr.percentage), 1),
         count(*)::int
    FROM final_results fr
    JOIN student_exam_attempts a ON a.id = fr.attempt_id
    JOIN exams e ON e.id = a.exam_id
    JOIN exam_subjects es ON es.exam_id = e.id
    JOIN universal_subjects us ON us.id = es.subject_id
   WHERE e.institution_id = v_inst
     AND e.status IN ('published','active','completed')
     AND COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date)
         BETWEEN v_ay_start AND v_ay_end
   GROUP BY us.id, us.name
   ORDER BY 3 ASC, us.name;
END $$;

-- Digest, with the weakest-subject rule now reading the shared definition.
CREATE OR REPLACE FUNCTION public.dash_admin_digest(
  p_institution_id uuid DEFAULT NULL
) RETURNS TABLE(
  code text, severity text, headline text, detail text, link_url text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inst uuid; v_tz text; v_today date; v_ay_start date; v_ay_end date;
  v_students int; v_never int; v_active30 int;
  v_wk numeric; v_pwk numeric;
  v_subj text; v_subj_pct numeric;
  v_class text; v_class_pct numeric;
  v_unmarked int; v_classes int;
  v_low_notices int; v_notices int;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;
  SELECT start_date, end_date INTO v_ay_start, v_ay_end
    FROM public.dash_current_academic_year(v_inst);
  v_ay_start := COALESCE(v_ay_start, v_today - INTERVAL '12 months')::date;
  v_ay_end   := COALESCE(v_ay_end,   v_today)::date;

  -- ---- 1. portal adoption ------------------------------------------------
  SELECT count(*),
         count(*) FILTER (WHERE u.last_sign_in_at IS NULL),
         count(*) FILTER (WHERE u.last_sign_in_at >= now() - INTERVAL '30 days')
    INTO v_students, v_never, v_active30
    FROM profiles p
    JOIN user_roles ur ON ur.user_id = p.id AND ur.role::text = 'student'
    LEFT JOIN auth.users u ON u.id = p.id
   WHERE p.institution_id = v_inst AND p.is_active IS NOT FALSE;

  IF v_students > 0 AND v_never > 0 THEN
    RETURN QUERY SELECT
      'portal_adoption',
      CASE WHEN v_never * 100.0 / v_students >= 50 THEN 'high'
           WHEN v_never * 100.0 / v_students >= 20 THEN 'medium'
           ELSE 'low' END,
      v_never || ' of ' || v_students || ' students have never signed in',
      'They cannot see homework, notices or results, so nothing else on this '
        || 'dashboard reaches them. Only ' || v_active30
        || ' signed in during the last 30 days.',
      '/school/students';
  END IF;

  -- ---- 2. weakest subject (>= 5 results, so one bad paper is not a trend) --
  SELECT subject_name, school_avg INTO v_subj, v_subj_pct
    FROM public.dash_school_subject_performance(v_inst)
   WHERE results >= 5
   ORDER BY school_avg ASC
   LIMIT 1;

  IF v_subj IS NOT NULL THEN
    RETURN QUERY SELECT
      'weakest_subject',
      CASE WHEN v_subj_pct < 50 THEN 'high'
           WHEN v_subj_pct < 65 THEN 'medium' ELSE 'low' END,
      v_subj || ' is your weakest subject school-wide at ' || v_subj_pct || '%',
      'Averaged across every graded exam this academic year.',
      '/school/analytics';
  END IF;

  -- ---- 3. weakest class ---------------------------------------------------
  SELECT c.name || CASE WHEN coalesce(c.section,'') <> '' THEN '-' || c.section ELSE '' END,
         round(avg(fr.percentage), 1)
    INTO v_class, v_class_pct
    FROM classes c
    JOIN class_assignments ca ON ca.class_id = c.id AND ca.role::text = 'student'
    JOIN student_exam_attempts a ON a.student_id = ca.user_id
    JOIN final_results fr ON fr.attempt_id = a.id
    JOIN exams e ON e.id = a.exam_id
   WHERE c.institution_id = v_inst AND c.is_active IS NOT FALSE
     AND e.status IN ('published','active','completed')
     AND COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date)
         BETWEEN v_ay_start AND v_ay_end
   GROUP BY 1
  HAVING count(*) >= 5
   ORDER BY 2 ASC
   LIMIT 1;

  IF v_class IS NOT NULL AND v_class_pct < 65 THEN
    RETURN QUERY SELECT
      'weakest_class',
      CASE WHEN v_class_pct < 50 THEN 'high' ELSE 'medium' END,
      v_class || ' is your lowest-scoring class at ' || v_class_pct || '%',
      'Sitting below the 65% band across recent exams.',
      '/school/classes';
  END IF;

  -- ---- 4. attendance week over week --------------------------------------
  SELECT round(count(*) FILTER (WHERE status IN ('present','late')) * 100.0
               / NULLIF(count(*), 0), 1) INTO v_wk
    FROM attendance_records
   WHERE institution_id = v_inst AND date > v_today - 7 AND date <= v_today;
  SELECT round(count(*) FILTER (WHERE status IN ('present','late')) * 100.0
               / NULLIF(count(*), 0), 1) INTO v_pwk
    FROM attendance_records
   WHERE institution_id = v_inst AND date > v_today - 14 AND date <= v_today - 7;

  IF v_wk IS NOT NULL AND v_pwk IS NOT NULL AND abs(v_wk - v_pwk) >= 1 THEN
    RETURN QUERY SELECT
      'attendance_trend',
      CASE WHEN v_wk - v_pwk <= -3 THEN 'high'
           WHEN v_wk - v_pwk <  0  THEN 'medium' ELSE 'low' END,
      'Attendance ' || CASE WHEN v_wk > v_pwk THEN 'rose ' ELSE 'dipped ' END
        || round(abs(v_wk - v_pwk), 1) || 'pp vs last week',
      'Now ' || v_wk || '%, was ' || v_pwk || '%.',
      '/school/attendance';
  END IF;

  -- ---- 5. classes not marking attendance ---------------------------------
  SELECT count(*) INTO v_classes
    FROM classes WHERE institution_id = v_inst AND is_active IS NOT FALSE;

  SELECT count(*) INTO v_unmarked
    FROM classes c
   WHERE c.institution_id = v_inst AND c.is_active IS NOT FALSE
     AND NOT EXISTS (
       SELECT 1 FROM attendance_records ar
        WHERE ar.class_id = c.id
          AND ar.date > v_today - 14 AND ar.date <= v_today);

  IF v_unmarked > 0 THEN
    RETURN QUERY SELECT
      'attendance_compliance',
      CASE WHEN v_unmarked * 100.0 / GREATEST(v_classes, 1) >= 50 THEN 'high'
           ELSE 'medium' END,
      v_unmarked || ' of ' || v_classes
        || ' classes have not marked attendance in 14 days',
      'Their attendance figures elsewhere on this page are not measuring '
        || 'anything until the register is taken.',
      '/school/attendance';
  END IF;

  -- ---- 6. notices nobody opened ------------------------------------------
  SELECT count(*), count(*) FILTER (
           WHERE n.recipient_count > 0
             AND (SELECT count(*) FROM notice_recipients r
                   WHERE r.notice_id = n.id AND r.read_at IS NOT NULL)
                 * 100.0 / n.recipient_count < 40)
    INTO v_notices, v_low_notices
    FROM notices n
   WHERE n.institution_id = v_inst
     AND n.published_at >= now() - INTERVAL '30 days';

  IF v_low_notices > 0 THEN
    RETURN QUERY SELECT
      'notice_reach',
      'medium',
      v_low_notices || ' of ' || v_notices
        || ' recent notices were read by under 40% of their audience',
      'A notice with low reach did not fail to send, it failed to land.',
      '/school/notices';
  END IF;

  RETURN;
END $$;

REVOKE EXECUTE ON FUNCTION public.dash_school_subject_performance(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.dash_admin_digest(uuid)               FROM anon;
GRANT  EXECUTE ON FUNCTION public.dash_school_subject_performance(uuid) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.dash_admin_digest(uuid)               TO authenticated;

COMMIT;
