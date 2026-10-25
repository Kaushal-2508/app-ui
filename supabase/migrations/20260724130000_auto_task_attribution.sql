-- Attribute flag-evaluator auto-tasks to the admin whose Command Center
-- visit triggered the run, while keeping them identifiable as system tasks.
--
-- 1. tasks.auto_created marks evaluator-generated tasks (display: name +
--    "SALCI auto-task" suffix; NULL assigner still renders "SALCI System").
-- 2. Backfill: every task linked from dashboard_flags or carrying a
--    NULL-assigner assignment predates this change and is system-generated.
-- 3. dash_evaluate_flags stamps assigner_id = auth.uid() (the kicking
--    admin). Cron/service runs have no auth.uid() and stay NULL. The
--    no_self_assignment CHECK (assigner <> assignee) forces NULL when the
--    kicker is also the assignee.

ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS auto_created boolean NOT NULL DEFAULT false;

UPDATE public.tasks t SET auto_created = true
WHERE t.auto_created = false
  AND (EXISTS (SELECT 1 FROM public.dashboard_flags df WHERE df.task_id = t.id)
    OR EXISTS (SELECT 1 FROM public.task_assignments ta WHERE ta.task_id = t.id AND ta.assigner_id IS NULL));

CREATE OR REPLACE FUNCTION public.dash_evaluate_flags(p_institution_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_tz text; v_today date; v_ay_start date; v_ay_end date;
  v_adopt boolean; v_age_days int; v_codes text[]; v_rec record;
  v_detected int := 0; v_resolved int := 0; v_tasks int := 0;
  v_assignee uuid; v_task uuid; v_ttype task_type;
  v_uid uuid := auth.uid();  -- admin whose dashboard-open kicked this run; NULL under cron
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  SELECT timezone, (CURRENT_DATE - created_at::date), dashboard_adoption_flags_enabled
    INTO v_tz, v_age_days, v_adopt FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz,'Asia/Kolkata'))::date;
  SELECT start_date, end_date INTO v_ay_start, v_ay_end FROM public.dash_current_academic_year(v_inst);
  v_ay_start := COALESCE(v_ay_start, v_today - INTERVAL '12 months')::date;
  v_ay_end   := COALESCE(v_ay_end, v_today)::date;

  DROP TABLE IF EXISTS _detected;
  CREATE TEMP TABLE _detected (
    flag_code text, category text, severity text, subject_type text, subject_key text,
    title text, description text, metric_value numeric, link_url text
  ) ON COMMIT DROP;

  -- ===================== EXAM FAMILY (E1-E7) =====================

  INSERT INTO _detected SELECT 'E1','exams','warning','school','school',
    'Exams are still in draft', s.n||' exams have been in draft for over a week.', s.n, '/school/exams'
  FROM (SELECT count(*) n FROM exams WHERE institution_id=v_inst AND status='draft'
        AND created_at < now()-INTERVAL '7 days') s WHERE s.n >= 5;

  INSERT INTO _detected
  SELECT 'E2','exams','critical','exam', e.id::text,
    'Results are overdue', 'Results for "'||e.title||'" still aren''t published.', NULL, '/exams/'||e.id||'/results'
  FROM exams e
  WHERE e.institution_id=v_inst AND e.status='completed'
    AND COALESCE(e.scheduled_date::date, e.created_at::date) < v_today-5
    AND NOT EXISTS (SELECT 1 FROM student_exam_attempts a JOIN final_results fr ON fr.attempt_id=a.id
                    WHERE a.exam_id=e.id AND fr.is_published);

  INSERT INTO _detected
  SELECT 'E3','exams','warning','exam', x.id::text,
    'Few students took an exam', 'Only '||round(x.rate)||'% of students attempted "'||x.title||'".',
    round(x.rate,1), '/exams/'||x.id||'/results'
  FROM (
    SELECT e.id, e.title,
      (SELECT count(*) FROM student_exam_attempts a WHERE a.exam_id=e.id AND a.is_submitted)::numeric
        / NULLIF((SELECT count(*) FROM class_assignments ca WHERE ca.role='student'
                  AND ca.class_id IN (SELECT class_id FROM exam_classes WHERE exam_id=e.id)),0) * 100 AS rate
    FROM exams e
    WHERE e.institution_id=v_inst AND e.status IN ('published','active','completed')
      AND e.availability_end IS NOT NULL
      AND e.availability_end::timestamptz < now()
      AND e.availability_end::timestamptz > now() - INTERVAL '30 days'
  ) x WHERE x.rate IS NOT NULL AND x.rate < 60;

  INSERT INTO _detected
  SELECT 'E4','exams','critical','class', a.class_id::text,
    'A class scored very low in a recent exam',
    c.name||coalesce(' '||c.section,'')||' averaged '||round(avg(fr.percentage))||'% in '||e.title||'.',
    round(avg(fr.percentage),1), '/school/class/'||a.class_id
  FROM final_results fr
  JOIN student_exam_attempts a ON a.id=fr.attempt_id
  JOIN exams e ON e.id=a.exam_id AND e.institution_id=v_inst AND e.status IN ('published','active','completed')
       AND COALESCE(e.published_at::date,e.scheduled_date::date,e.created_at::date) > v_today-30
  JOIN classes c ON c.id=a.class_id
  GROUP BY a.class_id, e.id, e.title, c.name, c.section
  HAVING avg(fr.percentage) < 40;

  INSERT INTO _detected
  SELECT 'E5','exams','warning','subject', es.subject_id::text,
    'A subject is weak across the school',
    us.name||' is averaging '||round(avg(fr.percentage))||'% across the school this year.',
    round(avg(fr.percentage),1), '/school/subject/'||es.subject_id
  FROM final_results fr
  JOIN student_exam_attempts a ON a.id=fr.attempt_id
  JOIN exams e ON e.id=a.exam_id AND e.institution_id=v_inst AND e.status IN ('published','active','completed')
       AND COALESCE(e.published_at::date,e.scheduled_date::date,e.created_at::date) BETWEEN v_ay_start AND v_ay_end
  JOIN exam_subjects es ON es.exam_id=e.id
  JOIN universal_subjects us ON us.id=es.subject_id
  GROUP BY es.subject_id, us.name
  HAVING avg(fr.percentage) < 50 AND count(DISTINCT e.id) >= 2;

  INSERT INTO _detected SELECT 'E6','exams','warning','school','school',
    'Recheck requests are piling up', s.n||' recheck requests have been open for over a week.', s.n, '/school/rechecks'
  FROM (
    SELECT count(*) n FROM recheck_requests rr
    JOIN final_results fr ON fr.id=rr.result_id
    JOIN student_exam_attempts a ON a.id=fr.attempt_id
    JOIN exams e ON e.id=a.exam_id
    WHERE e.institution_id=v_inst AND rr.status IN ('pending','in_review') AND rr.requested_at < now()-INTERVAL '7 days'
  ) s WHERE s.n >= 3;

  INSERT INTO _detected
  SELECT 'E7','exams','info','class', c.id::text,
    'A class hasn''t had a test recently', c.name||coalesce(' '||c.section,'')||' has had no exam in the last 30 days.',
    NULL, '/school/class/'||c.id
  FROM classes c
  WHERE c.institution_id=v_inst AND coalesce(c.is_active,true)
    AND EXISTS (SELECT 1 FROM class_assignments ca WHERE ca.role='student' AND ca.class_id=c.id)
    AND EXISTS (SELECT 1 FROM exam_classes ec JOIN exams e ON e.id=ec.exam_id
                WHERE ec.class_id=c.id AND e.status IN ('published','active','completed'))
    AND NOT EXISTS (SELECT 1 FROM exam_classes ec JOIN exams e ON e.id=ec.exam_id
                WHERE ec.class_id=c.id AND e.status IN ('published','active','completed')
                  AND COALESCE(e.published_at::date,e.scheduled_date::date,e.created_at::date) > v_today-30);

  -- ===================== ATTENDANCE FAMILY (A1-A7) =====================
  -- All self-suppress via cold-start when attendance data is sparse/absent.

  -- A1: class recent (last 5 working days) attendance < 70% AND >=12pp below 30-day school baseline (Critical)
  WITH wd5 AS (SELECT DISTINCT date FROM attendance_records WHERE institution_id=v_inst AND date<=v_today ORDER BY date DESC LIMIT 5),
  last5 AS (SELECT ar.class_id, round((count(*) FILTER (WHERE ar.status IN ('present','late')))*100.0/NULLIF(count(*),0),1) pct
            FROM attendance_records ar WHERE ar.institution_id=v_inst AND ar.date IN (SELECT date FROM wd5) GROUP BY ar.class_id),
  base AS (SELECT round((count(*) FILTER (WHERE status IN ('present','late')))*100.0/NULLIF(count(*),0),1) pct
           FROM attendance_records WHERE institution_id=v_inst AND date>v_today-30 AND date<=v_today),
  cdays AS (SELECT class_id, count(DISTINCT date) d FROM attendance_records WHERE institution_id=v_inst GROUP BY class_id),
  cstud AS (SELECT class_id, count(*) n FROM class_assignments WHERE role='student' GROUP BY class_id)
  INSERT INTO _detected
  SELECT 'A1','attendance','critical','class', l.class_id::text,
    'Class attendance is very low',
    c.name||coalesce(' '||c.section,'')||'''s attendance is '||round(l.pct)||'% recently, well below the school''s '||round(b.pct)||'%.',
    l.pct, '/school/class/'||l.class_id
  FROM last5 l CROSS JOIN base b JOIN classes c ON c.id=l.class_id
  JOIN cdays cd ON cd.class_id=l.class_id JOIN cstud cs ON cs.class_id=l.class_id
  WHERE cd.d>=14 AND cs.n>=10 AND l.pct<70 AND b.pct IS NOT NULL AND (b.pct-l.pct)>=12;

  -- A2: slipping (5-day 70-80% or >=10pp below baseline), not already A1 (Warning)
  WITH wd5 AS (SELECT DISTINCT date FROM attendance_records WHERE institution_id=v_inst AND date<=v_today ORDER BY date DESC LIMIT 5),
  last5 AS (SELECT ar.class_id, round((count(*) FILTER (WHERE ar.status IN ('present','late')))*100.0/NULLIF(count(*),0),1) pct
            FROM attendance_records ar WHERE ar.institution_id=v_inst AND ar.date IN (SELECT date FROM wd5) GROUP BY ar.class_id),
  base AS (SELECT round((count(*) FILTER (WHERE status IN ('present','late')))*100.0/NULLIF(count(*),0),1) pct
           FROM attendance_records WHERE institution_id=v_inst AND date>v_today-30 AND date<=v_today),
  cdays AS (SELECT class_id, count(DISTINCT date) d FROM attendance_records WHERE institution_id=v_inst GROUP BY class_id),
  cstud AS (SELECT class_id, count(*) n FROM class_assignments WHERE role='student' GROUP BY class_id)
  INSERT INTO _detected
  SELECT 'A2','attendance','warning','class', l.class_id::text,
    'Class attendance is slipping',
    c.name||coalesce(' '||c.section,'')||'''s recent attendance is '||round(l.pct)||'%.', l.pct, '/school/class/'||l.class_id
  FROM last5 l CROSS JOIN base b JOIN classes c ON c.id=l.class_id
  JOIN cdays cd ON cd.class_id=l.class_id JOIN cstud cs ON cs.class_id=l.class_id
  WHERE cd.d>=14 AND cs.n>=10
    AND NOT (l.pct<70 AND b.pct IS NOT NULL AND (b.pct-l.pct)>=12)
    AND ( (l.pct>=70 AND l.pct<=80) OR (b.pct IS NOT NULL AND (b.pct-l.pct)>=10) );

  -- A3: school attendance dropped this week vs prior week (Warning)
  WITH wk AS (SELECT round((count(*) FILTER(WHERE status IN('present','late')))*100.0/NULLIF(count(*),0),1) pct
              FROM attendance_records WHERE institution_id=v_inst AND date>v_today-7 AND date<=v_today),
  pwk AS (SELECT round((count(*) FILTER(WHERE status IN('present','late')))*100.0/NULLIF(count(*),0),1) pct
          FROM attendance_records WHERE institution_id=v_inst AND date>v_today-14 AND date<=v_today-7),
  days AS (SELECT count(DISTINCT date) d FROM attendance_records WHERE institution_id=v_inst)
  INSERT INTO _detected SELECT 'A3','attendance','warning','school','school',
    'School attendance dropped this week', 'Attendance is about '||round(pwk.pct-wk.pct)||' points lower than last week.', wk.pct, '/school/attendance'
  FROM wk, pwk, days WHERE days.d>=14 AND wk.pct IS NOT NULL AND pwk.pct IS NOT NULL AND (pwk.pct-wk.pct)>=8;

  -- A4: student missed >=6 of last 20 working days (Warning) â capped to 25 most-absent
  WITH wd20 AS (SELECT DISTINCT date FROM attendance_records WHERE institution_id=v_inst AND date<=v_today ORDER BY date DESC LIMIT 20),
  stu AS (SELECT ar.student_id, count(*) FILTER (WHERE ar.status NOT IN ('present','late')) AS missed, count(*) AS days
          FROM attendance_records ar WHERE ar.institution_id=v_inst AND ar.date IN (SELECT date FROM wd20) GROUP BY ar.student_id)
  INSERT INTO _detected
  SELECT 'A4','attendance','warning','student', s.student_id::text,
    'A student has missed a lot of school', p.full_name||' has missed '||s.missed||' of the last 20 school days.', s.missed, '/school/student/'||s.student_id
  FROM stu s JOIN profiles p ON p.id=s.student_id
  WHERE s.days>=10 AND s.missed>=6
  ORDER BY s.missed DESC LIMIT 25;

  -- A5: a class whose class-teacher is marked absent today (Critical)
  WITH absent_staff AS (SELECT staff_id FROM staff_attendance_records WHERE institution_id=v_inst AND date=v_today AND status='absent')
  INSERT INTO _detected
  SELECT 'A5','attendance','critical','class', ca.class_id::text,
    'A class''s teacher is absent today', c.name||coalesce(' '||c.section,'')||'''s class teacher is marked absent today.', NULL, '/school/class/'||ca.class_id
  FROM class_assignments ca
  JOIN absent_staff a ON a.staff_id=ca.user_id
  JOIN classes c ON c.id=ca.class_id AND c.institution_id=v_inst
  WHERE ca.role='teacher' AND ca.subject_id IS NULL;

  -- A6: a class with prior marking history that missed marking on >=2 of last 3 working days (Warning)
  WITH wd3 AS (SELECT DISTINCT date FROM attendance_records WHERE institution_id=v_inst AND date<=v_today ORDER BY date DESC LIMIT 3),
  marked AS (SELECT class_id, count(DISTINCT date) d FROM attendance_records WHERE institution_id=v_inst AND date IN (SELECT date FROM wd3) GROUP BY class_id),
  hist AS (SELECT DISTINCT class_id FROM attendance_records WHERE institution_id=v_inst)
  INSERT INTO _detected
  SELECT 'A6','attendance','warning','class', c.id::text,
    'Attendance not being marked', c.name||coalesce(' '||c.section,'')||' hasn''t had attendance marked on recent days.', NULL, '/school/attendance'
  FROM classes c
  JOIN hist h ON h.class_id=c.id
  LEFT JOIN marked m ON m.class_id=c.id
  WHERE c.institution_id=v_inst AND coalesce(c.is_active,true)
    AND (SELECT count(*) FROM wd3) = 3 AND coalesce(m.d,0) <= 1;

  -- A7: teacher late >=4 times in last 10 staff working days (Info)
  WITH wd10 AS (SELECT DISTINCT date FROM staff_attendance_records WHERE institution_id=v_inst AND date<=v_today ORDER BY date DESC LIMIT 10),
  late AS (SELECT staff_id, count(*) FILTER (WHERE status='late') AS n, count(*) AS d
           FROM staff_attendance_records WHERE institution_id=v_inst AND date IN (SELECT date FROM wd10) GROUP BY staff_id)
  INSERT INTO _detected
  SELECT 'A7','attendance','info','teacher', l.staff_id::text,
    'A teacher is often late', p.full_name||' has been late '||l.n||' times recently.', l.n, '/school/teacher/'||l.staff_id
  FROM late l JOIN profiles p ON p.id=l.staff_id
  WHERE l.d>=10 AND l.n>=4;

  -- ===================== ADOPTION (kill-switch + onboarding grace gated) =====================
  IF v_adopt AND v_age_days > 14 THEN
    INSERT INTO _detected SELECT 'AD1','adoption','critical','school','school',
      'Some classes have no teacher assigned', s.n||' classes don''t have a teacher assigned yet.', s.n, '/school/users?tab=teachers'
    FROM (SELECT count(*) n FROM classes c WHERE c.institution_id=v_inst AND coalesce(c.is_active,true)
          AND NOT EXISTS (SELECT 1 FROM class_assignments ca WHERE ca.class_id=c.id AND ca.role='teacher')) s WHERE s.n > 0;

    INSERT INTO _detected SELECT 'AD2','adoption','warning','school','school',
      'Some classes have no students yet', s.n||' classes don''t have any students yet.', s.n, '/school/users?tab=students'
    FROM (SELECT count(*) n FROM classes c WHERE c.institution_id=v_inst AND coalesce(c.is_active,true)
          AND NOT EXISTS (SELECT 1 FROM class_assignments ca WHERE ca.class_id=c.id AND ca.role='student')) s WHERE s.n > 0;

    INSERT INTO _detected SELECT 'AD3','adoption','warning','school','school',
      'Some teachers haven''t logged in recently', s.n||' teachers haven''t logged in this week.', s.n, '/school/users?tab=teachers'
    FROM (SELECT count(*) n FROM user_roles ur JOIN auth.users u ON u.id=ur.user_id
          WHERE ur.institution_id=v_inst AND ur.role='teacher'
            AND (u.last_sign_in_at IS NULL OR u.last_sign_in_at < now()-INTERVAL '7 days')) s WHERE s.n > 0;

    -- AD4: a feature is enabled but unused in the last 30 days (one flag per feature, subject_key=feature)
    INSERT INTO _detected SELECT 'AD4','adoption','info','school','attendance',
      'A feature is on but unused','Attendance is enabled but nothing has been recorded in the last 30 days.', NULL, '/school/attendance'
    WHERE EXISTS (SELECT 1 FROM institution_features WHERE institution_id=v_inst AND feature_id='attendance' AND is_enabled)
      AND NOT EXISTS (SELECT 1 FROM attendance_records WHERE institution_id=v_inst AND date > v_today-30);

    INSERT INTO _detected SELECT 'AD4','adoption','info','school','exams',
      'A feature is on but unused','Exams are enabled but none have been created in the last 30 days.', NULL, '/school/exams'
    WHERE EXISTS (SELECT 1 FROM institution_features WHERE institution_id=v_inst AND feature_id='exams' AND is_enabled)
      AND NOT EXISTS (SELECT 1 FROM exams WHERE institution_id=v_inst AND created_at > now()-INTERVAL '30 days');

    -- AD5: active classes with no timetable set up
    INSERT INTO _detected SELECT 'AD5','adoption','info','school','school',
      'Timetable isn''t set up for some classes', s.n||' classes don''t have a timetable yet.', s.n, '/school/timetable'
    FROM (SELECT count(*) n FROM classes c WHERE c.institution_id=v_inst AND coalesce(c.is_active,true)
          AND NOT EXISTS (SELECT 1 FROM tt_slots t WHERE t.class_id=c.id)) s WHERE s.n > 0;
  END IF;

  -- AD6: low 7-day active-user rate (extra grace)
  IF v_adopt AND v_age_days > 30 THEN
    INSERT INTO _detected
    SELECT 'AD6','adoption','info','school','school',
      'Few people are using SALCI yet', round(u.active*100.0/NULLIF(u.total,0))||'% of users logged in this week.',
      round(u.active*100.0/NULLIF(u.total,0)), '/school/users'
    FROM (SELECT count(*) FILTER (WHERE us.last_sign_in_at > now()-INTERVAL '7 days') AS active, count(*) AS total
          FROM user_roles ur JOIN auth.users us ON us.id=ur.user_id
          WHERE ur.institution_id=v_inst AND ur.role IN ('teacher','coordinator','school_admin','student')) u
    WHERE u.total > 0 AND (u.active*100.0/NULLIF(u.total,0)) < 30;
  END IF;

  -- codes this run evaluated (so resolve only touches them)
  v_codes := ARRAY['E1','E2','E3','E4','E5','E6','E7','A1','A2','A3','A4','A5','A6','A7'];
  IF v_adopt AND v_age_days > 14 THEN v_codes := v_codes || ARRAY['AD1','AD2','AD3','AD4','AD5']; END IF;
  IF v_adopt AND v_age_days > 30 THEN v_codes := v_codes || ARRAY['AD6']; END IF;

  SELECT count(*) INTO v_detected FROM _detected;

  -- (1) UPSERT (dedup within batch by identity; worst metric wins for class-low)
  INSERT INTO dashboard_flags (institution_id,flag_code,category,severity,subject_type,subject_key,
                               title,description,metric_value,link_url,status,first_detected_at,last_evaluated_at)
  SELECT v_inst,flag_code,category,severity,subject_type,subject_key,title,description,metric_value,link_url,
         'red', now(), now()
  FROM (SELECT DISTINCT ON (flag_code, subject_key) * FROM _detected
        ORDER BY flag_code, subject_key, metric_value ASC NULLS LAST) d
  ON CONFLICT (institution_id,flag_code,subject_key) WHERE resolved_at IS NULL
  DO UPDATE SET last_evaluated_at=now(), metric_value=EXCLUDED.metric_value,
                title=EXCLUDED.title, description=EXCLUDED.description;

  -- (2) RESOLVE vanished
  UPDATE dashboard_flags df SET resolved_at=now()
  WHERE df.institution_id=v_inst AND df.resolved_at IS NULL
    AND df.flag_code = ANY(v_codes)
    AND NOT EXISTS (SELECT 1 FROM _detected d WHERE d.flag_code=df.flag_code AND d.subject_key=df.subject_key);
  GET DIAGNOSTICS v_resolved = ROW_COUNT;

  -- (3) AUTO-TASK critical reds lacking a task
  FOR v_rec IN SELECT * FROM dashboard_flags
    WHERE institution_id=v_inst AND resolved_at IS NULL AND severity='critical' AND status='red' AND task_id IS NULL
  LOOP
    v_assignee := public.resolve_flag_assignee(v_inst, v_rec.subject_type, v_rec.subject_key);
    v_ttype := CASE WHEN v_rec.category='exams' THEN 'exam_related'::task_type
                    WHEN v_rec.category='attendance' THEN 'student_support'::task_type
                    ELSE 'administrative'::task_type END;
    INSERT INTO tasks (institution_id,title,description,task_type,priority,status,due_date,auto_created)
      VALUES (v_inst, v_rec.title, v_rec.description, v_ttype, 1, 'open', (v_today+2)::timestamptz, true)
      RETURNING id INTO v_task;
    IF v_assignee IS NOT NULL THEN
      -- Attribute the human whose dashboard-open triggered this run (cron runs
      -- have no auth.uid() and stay NULL = pure system). no_self_assignment
      -- CHECK forbids assigner = assignee, so fall back to NULL in that case.
      INSERT INTO task_assignments (task_id,assignee_id,assigner_id)
        VALUES (v_task, v_assignee, CASE WHEN v_uid = v_assignee THEN NULL ELSE v_uid END);
      INSERT INTO notifications (user_id,title,message,type,link,metadata)
        VALUES (v_assignee,'New task from dashboard', v_rec.title,'task_assigned','/tasks',
                jsonb_build_object('task_id',v_task,'flag_id',v_rec.id));
    END IF;
    UPDATE dashboard_flags SET status='amber', task_id=v_task, assignee_id=v_assignee, auto_created=true WHERE id=v_rec.id;
    v_tasks := v_tasks + 1;
  END LOOP;

  -- (4) BLUE: task closed but condition still present
  UPDATE dashboard_flags df SET status='blue'
  WHERE df.institution_id=v_inst AND df.resolved_at IS NULL AND df.task_id IS NOT NULL AND df.status='amber'
    AND EXISTS (SELECT 1 FROM tasks t WHERE t.id=df.task_id AND t.status IN ('completed','rejected'));

  RETURN jsonb_build_object('detected', v_detected, 'resolved', v_resolved, 'auto_tasks', v_tasks);
END $function$
;
