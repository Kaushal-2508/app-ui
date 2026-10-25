-- Dashboard rebuild Phase 3 — Task 2
-- dash_evaluate_flags: detect conditions -> idempotent merge into dashboard_flags
-- -> Red/Amber/Blue lifecycle + Critical auto-task. Re-runnable (no duplicates).
--
-- Phase 3 ships the EXAM family (E1-E7) + the adoption flags that can fire on real
-- data (AD1 no-teacher, AD2 no-students, AD3 stale-login). Attendance flags (A1-A7)
-- and soft-adoption (AD4-AD6) are a follow-up: no institution has attendance/usage
-- data yet to validate them, and shipping unvalidated detections to prod violates the
-- spec §16 trust gate. They slot into the same merge by adding INSERTs + codes here.

CREATE OR REPLACE FUNCTION public.dash_evaluate_flags(p_institution_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inst uuid; v_tz text; v_today date; v_ay_start date; v_ay_end date;
  v_adopt boolean; v_age_days int; v_codes text[]; v_rec record;
  v_detected int := 0; v_resolved int := 0; v_tasks int := 0;
  v_assignee uuid; v_task uuid; v_ttype task_type;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  SELECT timezone, (CURRENT_DATE - created_at::date), dashboard_adoption_flags_enabled
    INTO v_tz, v_age_days, v_adopt FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz,'Asia/Kolkata'))::date;
  SELECT start_date, end_date INTO v_ay_start, v_ay_end FROM public.dash_current_academic_year(v_inst);
  v_ay_start := COALESCE(v_ay_start, v_today - INTERVAL '12 months')::date;
  v_ay_end   := COALESCE(v_ay_end, v_today)::date;

  DROP TABLE IF EXISTS _detected;  -- defensive: allow >1 call per transaction
  CREATE TEMP TABLE _detected (
    flag_code text, category text, severity text, subject_type text, subject_key text,
    title text, description text, metric_value numeric, link_url text
  ) ON COMMIT DROP;

  -- ===================== EXAM FAMILY =====================

  -- E1: >=5 drafts older than 7 days
  INSERT INTO _detected SELECT 'E1','exams','warning','school','school',
    'Exams are still in draft', s.n||' exams have been in draft for over a week.', s.n, '/school/exams'
  FROM (SELECT count(*) n FROM exams WHERE institution_id=v_inst AND status='draft'
        AND created_at < now()-INTERVAL '7 days') s WHERE s.n >= 5;

  -- E2: exam completed but results not published > 5 days (Critical)
  INSERT INTO _detected
  SELECT 'E2','exams','critical','exam', e.id::text,
    'Results are overdue', 'Results for "'||e.title||'" still aren''t published.', NULL, '/exams/'||e.id||'/results'
  FROM exams e
  WHERE e.institution_id=v_inst AND e.status='completed'
    AND COALESCE(e.scheduled_date::date, e.created_at::date) < v_today-5
    AND NOT EXISTS (SELECT 1 FROM student_exam_attempts a JOIN final_results fr ON fr.attempt_id=a.id
                    WHERE a.exam_id=e.id AND fr.is_published);

  -- E3: published/active exam past availability_end with attempt rate < 60%
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
      AND e.availability_end::timestamptz > now() - INTERVAL '30 days'  -- recently-ended only (actionable, not ancient)
  ) x WHERE x.rate IS NOT NULL AND x.rate < 60;

  -- E4: class avg on a <=30d published exam < 40% (Critical)
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

  -- E5: subject school-wide avg this academic year < 50% across >=2 exams
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

  -- E6: >=3 recheck requests open > 7 days
  INSERT INTO _detected SELECT 'E6','exams','warning','school','school',
    'Recheck requests are piling up', s.n||' recheck requests have been open for over a week.', s.n, '/school/rechecks'
  FROM (
    SELECT count(*) n FROM recheck_requests rr
    JOIN final_results fr ON fr.id=rr.result_id
    JOIN student_exam_attempts a ON a.id=fr.attempt_id
    JOIN exams e ON e.id=a.exam_id
    WHERE e.institution_id=v_inst AND rr.status IN ('pending','in_review') AND rr.requested_at < now()-INTERVAL '7 days'
  ) s WHERE s.n >= 3;

  -- E7: a class that HAS had published exams but none in the last 30 days (Info)
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

  -- ===================== ADOPTION (kill-switch + onboarding grace gated) =====================
  IF v_adopt AND v_age_days > 14 THEN
    -- AD1: classes with no teacher assigned (Critical, school-scoped count)
    INSERT INTO _detected SELECT 'AD1','adoption','critical','school','school',
      'Some classes have no teacher assigned', s.n||' classes don''t have a teacher assigned yet.', s.n, '/school/users?tab=teachers'
    FROM (SELECT count(*) n FROM classes c WHERE c.institution_id=v_inst AND coalesce(c.is_active,true)
          AND NOT EXISTS (SELECT 1 FROM class_assignments ca WHERE ca.class_id=c.id AND ca.role='teacher')) s
    WHERE s.n > 0;

    -- AD2: classes with no students (Warning)
    INSERT INTO _detected SELECT 'AD2','adoption','warning','school','school',
      'Some classes have no students yet', s.n||' classes don''t have any students yet.', s.n, '/school/users?tab=students'
    FROM (SELECT count(*) n FROM classes c WHERE c.institution_id=v_inst AND coalesce(c.is_active,true)
          AND NOT EXISTS (SELECT 1 FROM class_assignments ca WHERE ca.class_id=c.id AND ca.role='student')) s
    WHERE s.n > 0;

    -- AD3: teachers who haven't logged in for > 7 days (Warning)
    INSERT INTO _detected SELECT 'AD3','adoption','warning','school','school',
      'Some teachers haven''t logged in recently', s.n||' teachers haven''t logged in this week.', s.n, '/school/users?tab=teachers'
    FROM (SELECT count(*) n FROM user_roles ur JOIN auth.users u ON u.id=ur.user_id
          WHERE ur.institution_id=v_inst AND ur.role='teacher'
            AND (u.last_sign_in_at IS NULL OR u.last_sign_in_at < now()-INTERVAL '7 days')) s
    WHERE s.n > 0;
  END IF;

  -- which codes this run evaluated (so resolve only touches them)
  v_codes := ARRAY['E1','E2','E3','E4','E5','E6','E7'];
  IF v_adopt AND v_age_days > 14 THEN v_codes := v_codes || ARRAY['AD1','AD2','AD3']; END IF;

  SELECT count(*) INTO v_detected FROM _detected;

  -- (1) UPSERT (dedup within batch by identity; for class-low pick the worst metric)
  INSERT INTO dashboard_flags (institution_id,flag_code,category,severity,subject_type,subject_key,
                               title,description,metric_value,link_url,status,first_detected_at,last_evaluated_at)
  SELECT v_inst,flag_code,category,severity,subject_type,subject_key,title,description,metric_value,link_url,
         'red', now(), now()
  FROM (SELECT DISTINCT ON (flag_code, subject_key) * FROM _detected
        ORDER BY flag_code, subject_key, metric_value ASC NULLS LAST) d
  ON CONFLICT (institution_id,flag_code,subject_key) WHERE resolved_at IS NULL
  DO UPDATE SET last_evaluated_at=now(), metric_value=EXCLUDED.metric_value,
                title=EXCLUDED.title, description=EXCLUDED.description;

  -- (2) RESOLVE vanished conditions
  UPDATE dashboard_flags df SET resolved_at=now()
  WHERE df.institution_id=v_inst AND df.resolved_at IS NULL
    AND df.flag_code = ANY(v_codes)
    AND NOT EXISTS (SELECT 1 FROM _detected d WHERE d.flag_code=df.flag_code AND d.subject_key=df.subject_key);
  GET DIAGNOSTICS v_resolved = ROW_COUNT;

  -- (3) AUTO-TASK critical reds lacking a task
  FOR v_rec IN SELECT * FROM dashboard_flags
    WHERE institution_id=v_inst AND resolved_at IS NULL AND severity='critical'
      AND status='red' AND task_id IS NULL
  LOOP
    v_assignee := public.resolve_flag_assignee(v_inst, v_rec.subject_type, v_rec.subject_key);
    v_ttype := CASE WHEN v_rec.category='exams' THEN 'exam_related'::task_type
                    WHEN v_rec.category='attendance' THEN 'student_support'::task_type
                    ELSE 'administrative'::task_type END;
    INSERT INTO tasks (institution_id,title,description,task_type,priority,status,due_date)
      VALUES (v_inst, v_rec.title, v_rec.description, v_ttype, 1, 'open', (v_today+2)::timestamptz)
      RETURNING id INTO v_task;
    IF v_assignee IS NOT NULL THEN
      -- assigner_id NULL = system/auto-created (task_assignments has a no_self_assignment CHECK)
      INSERT INTO task_assignments (task_id,assignee_id,assigner_id) VALUES (v_task, v_assignee, NULL);
      INSERT INTO notifications (user_id,title,message,type,link,metadata)
        VALUES (v_assignee,'New task from dashboard', v_rec.title, 'task_assigned','/tasks',
                jsonb_build_object('task_id',v_task,'flag_id',v_rec.id));
    END IF;
    UPDATE dashboard_flags SET status='amber', task_id=v_task, assignee_id=v_assignee, auto_created=true
      WHERE id=v_rec.id;
    v_tasks := v_tasks + 1;
  END LOOP;

  -- (4) BLUE: task closed but condition still present
  UPDATE dashboard_flags df SET status='blue'
  WHERE df.institution_id=v_inst AND df.resolved_at IS NULL AND df.task_id IS NOT NULL
    AND df.status='amber'
    AND EXISTS (SELECT 1 FROM tasks t WHERE t.id=df.task_id AND t.status IN ('completed','rejected'));

  RETURN jsonb_build_object('detected', v_detected, 'resolved', v_resolved, 'auto_tasks', v_tasks);
END $$;

GRANT EXECUTE ON FUNCTION public.dash_evaluate_flags(uuid) TO authenticated;
