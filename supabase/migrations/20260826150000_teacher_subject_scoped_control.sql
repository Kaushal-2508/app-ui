-- =============================================================
-- Teachers control ONLY their subject students - everywhere but attendance
-- -------------------------------------------------------------
-- Policy decision (user, 2026-08-26): a teacher's authority extends exactly to
-- the students taking that teacher's subject(s), per (class, subject)
-- assignment row. Three explicit rulings:
--   * subject-less ("class teacher" / pastoral) assignment rows grant NO
--     student access at all - 9 teachers platform-wide hold only such rows
--     and will now see empty student surfaces until given subject rows;
--   * student-details editing (roll number, name, guardian info) narrows the
--     same way;
--   * teacher dashboard cards narrow too, including the previously-deliberate
--     whole-class "pastoral" rosters (adoption / laggards / attention).
-- THE ONE EXCEPTION: attendance. Marking and viewing class attendance stays
-- whole-class - none of the attendance surfaces read the helpers below, and
-- the attendance parts of dash_teacher_kpi_summary are deliberately left
-- class-based in this migration.
--
-- The optional-subject dormancy rule (20260825150000) is unchanged: an
-- optional subject with no recorded choices in a section still behaves as
-- compulsory, so this cannot re-create the AIS zero-roster blackout.
--
-- Canonical predicate: teacher_controls_student(_teacher, _student). Every
-- teacher-authority gate must compose it rather than testing
-- class_assignments directly - class-sharing is NOT authority any more.
-- =============================================================

-- -------------------------------------------------------------
-- 1. The canonical per-student predicate.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.teacher_controls_student(_teacher uuid, _student uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.class_assignments ca_t
    JOIN public.class_assignments ca_s
      ON ca_s.class_id = ca_t.class_id
     AND ca_s.role = 'student'
     AND ca_s.user_id = _student
    LEFT JOIN public.subject_class_mappings scm
      ON scm.class_id = ca_t.class_id AND scm.subject_id = ca_t.subject_id
    WHERE ca_t.user_id = _teacher
      AND ca_t.role = 'teacher'
      AND ca_t.subject_id IS NOT NULL      -- pastoral rows grant nothing
      AND (
        scm.is_optional IS NOT TRUE        -- compulsory / unmapped -> whole class
        OR NOT public.optional_choices_recorded(ca_t.subject_id, ca_t.class_id)
                                           -- optional but dormant -> whole class
        OR EXISTS (                        -- optional + in use -> enrolled only
          SELECT 1 FROM public.student_optional_enrollments soe
          WHERE soe.student_id = _student
            AND soe.subject_id = ca_t.subject_id
            AND soe.is_active = true
        )
      )
  )
  OR EXISTS (                              -- legacy optional-batch teaching
    SELECT 1 FROM public.optional_batches ob
    JOIN public.optional_batch_students obs
      ON obs.batch_id = ob.id AND obs.student_id = _student
    WHERE ob.teacher_id = _teacher
  );
$$;

REVOKE ALL ON FUNCTION public.teacher_controls_student(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.teacher_controls_student(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.teacher_controls_student(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.teacher_controls_student(uuid, uuid) IS
  'TRUE when the student takes one of the teacher''s subjects (dormancy-aware). Subject-less assignment rows grant nothing. The canonical teacher-authority predicate - compose this, never test class-sharing.';

-- -------------------------------------------------------------
-- 2. Roster function: drop the subject-less whole-class branch.
--    (Feeds TeacherStudentsPage + every dash_teacher_* roster.)
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.teacher_roster_student_ids(_teacher uuid, _class_ids uuid[])
 RETURNS TABLE(student_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Only the teacher themselves, or an admin/coordinator, may query.
  -- auth.uid() IS NULL must fail closed here (it used to fall through:
  -- NULL <> _teacher is NULL, and IF NULL skips the block).
  IF auth.uid() IS NULL
     OR (auth.uid() <> _teacher
         AND NOT public.is_super_admin(auth.uid())
         AND NOT public.has_role(auth.uid(), 'school_admin')
         AND NOT public.has_role(auth.uid(), 'super_school_admin')
         AND NOT public.has_role(auth.uid(), 'coordinator')) THEN
    RETURN;
  END IF;

  RETURN QUERY
  -- Class-subject teaching: whole class for compulsory, for unmapped, and for
  -- optional subjects whose section has no recorded choices yet (dormant);
  -- enrolled-only once the section has real choices.
  SELECT DISTINCT ca_stu.user_id
  FROM public.class_assignments ca_tea
  JOIN public.class_assignments ca_stu
    ON ca_stu.class_id = ca_tea.class_id AND ca_stu.role = 'student'
  LEFT JOIN public.subject_class_mappings scm
    ON scm.class_id = ca_tea.class_id AND scm.subject_id = ca_tea.subject_id
  WHERE ca_tea.user_id = _teacher
    AND ca_tea.role = 'teacher'
    AND ca_tea.class_id = ANY (_class_ids)
    -- Subject-less (class-teacher) rows grant NO roster (policy 2026-08-26);
    -- attendance surfaces never read this function, so class-level marking
    -- is untouched.
    AND ca_tea.subject_id IS NOT NULL
    AND (
      scm.is_optional IS NOT TRUE        -- compulsory / unmapped -> whole class
      OR NOT public.optional_choices_recorded(ca_tea.subject_id, ca_tea.class_id)
                                         -- optional but dormant -> whole class
      OR EXISTS (                        -- optional + in use -> enrolled only
        SELECT 1 FROM public.student_optional_enrollments soe
        WHERE soe.student_id = ca_stu.user_id
          AND soe.subject_id = ca_tea.subject_id
          AND soe.is_active = true
      )
    )

  UNION

  -- Optional-batch teaching: the teacher's batch roster, scoped to the classes.
  SELECT obs.student_id
  FROM public.optional_batches ob
  JOIN public.optional_batch_students obs ON obs.batch_id = ob.id
  JOIN public.class_assignments ca_stu2
    ON ca_stu2.user_id = obs.student_id
   AND ca_stu2.role = 'student'
   AND ca_stu2.class_id = ANY (_class_ids)
  WHERE ob.teacher_id = _teacher;
END;
$function$;

-- -------------------------------------------------------------
-- 3. Student-details editing: teacher branch now requires subject
--    control, not mere class-sharing. Also gates the staff view of
--    the student dashboard and update_student_details.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_edit_student_details(_actor uuid, _student uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    public.can_manage_student_subjects(_actor, _student)   -- admins + wing-coordinators
    OR (
      public.has_role(_actor, 'teacher')
      AND EXISTS (
        SELECT 1 FROM public.profiles stu
        WHERE stu.id = _student
          AND stu.institution_id = public.get_user_institution(_actor)
      )
      AND public.teacher_controls_student(_actor, _student)
    );
$$;

REVOKE ALL ON FUNCTION public.can_edit_student_details(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_edit_student_details(uuid, uuid) TO authenticated;

-- -------------------------------------------------------------
-- 4. Optional-choice READ gate: teachers see choices only for
--    their subject students (writes were already admin-only).
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_view_student_optional_choices(_actor uuid, _student uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    public.can_manage_student_subjects(_actor, _student)
    OR (
      public.has_role(_actor, 'teacher')
      AND public.teacher_controls_student(_actor, _student)
    );
$$;

REVOKE ALL ON FUNCTION public.can_view_student_optional_choices(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_view_student_optional_choices(uuid, uuid) TO authenticated;

-- -------------------------------------------------------------
-- 5. Task assignment: a teacher may assign tasks to staff and to
--    their subject students only. Admin / student-manager / wing
--    coordinator authority is unchanged.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_assign_task_to(_assigner uuid, _assignee uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    NOT public.has_role(_assignee, 'student')              -- staff targets unchanged
    OR public.can_manage_student_subjects(_assigner, _assignee)
    OR public.teacher_controls_student(_assigner, _assignee);
$$;

REVOKE ALL ON FUNCTION public.can_assign_task_to(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_assign_task_to(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_assign_task_to(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS "Authorized users can create task assignments" ON public.task_assignments;
CREATE POLICY "Authorized users can create task assignments"
  ON public.task_assignments FOR INSERT TO authenticated
  WITH CHECK (
    (assigner_id = (select auth.uid()))
    AND (assigner_id <> assignee_id)
    AND public.can_assign_task_to((select auth.uid()), assignee_id)
  );

-- -------------------------------------------------------------
-- 6. Group tasks go through this SECURITY DEFINER RPC (bypasses
--    RLS), so it needs the same per-assignee check inline.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_task_group(p_institution_id uuid, p_title text, p_description text, p_task_type task_type, p_priority integer, p_due_date timestamp with time zone, p_assignees jsonb, p_supervisor_id uuid DEFAULT NULL::uuid, p_supervisor_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor        UUID := auth.uid();
  v_group_id     UUID;
  v_count        INTEGER;
  v_distinct     INTEGER;
  v_item         JSONB;
  v_assignee     UUID;
  v_title        TEXT;
  v_description  TEXT;
  v_new_task_id  UUID;
  v_first_task   UUID;
  v_task_ids     UUID[] := ARRAY[]::UUID[];
  v_assignee_ids UUID[] := ARRAY[]::UUID[];
  v_sups         UUID[];
  v_primary_sup  UUID;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'You need to be signed in to assign a task';
  END IF;

  IF p_institution_id IS NULL
     OR p_institution_id IS DISTINCT FROM public.get_user_institution(v_actor) THEN
    RAISE EXCEPTION 'You can only assign tasks inside your own institution';
  END IF;

  IF NOT (
    public.has_role(v_actor, 'school_admin')
    OR public.has_role(v_actor, 'coordinator')
    OR public.has_role(v_actor, 'teacher')
  ) THEN
    RAISE EXCEPTION 'You are not allowed to assign tasks';
  END IF;

  IF p_title IS NULL OR btrim(p_title) = '' THEN
    RAISE EXCEPTION 'The task needs a title';
  END IF;

  v_count := jsonb_array_length(COALESCE(p_assignees, '[]'::jsonb));

  IF v_count = 0 THEN
    RAISE EXCEPTION 'Select at least one person to assign this task to';
  END IF;

  IF v_count > 200 THEN
    RAISE EXCEPTION 'You can assign a task to at most 200 people at once';
  END IF;

  SELECT COUNT(DISTINCT elem ->> 'assignee_id')
    INTO v_distinct
    FROM jsonb_array_elements(p_assignees) AS elem;

  IF v_distinct <> v_count THEN
    RAISE EXCEPTION 'The same person is selected more than once';
  END IF;

  -- Teachers may only assign tasks to students of their own subjects
  -- (2026-08-26). This RPC is SECURITY DEFINER, so the task_assignments
  -- RLS policy cannot enforce it here - check explicitly.
  PERFORM 1
    FROM jsonb_array_elements(p_assignees) AS elem
   WHERE NOT public.can_assign_task_to(v_actor, (elem ->> 'assignee_id')::uuid)
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'You can only assign tasks to students who take your subject';
  END IF;

  -- Merge the legacy single supervisor with the new list, de-duplicated and
  -- with NULLs stripped.
  SELECT array_agg(DISTINCT s) INTO v_sups
    FROM unnest(
      COALESCE(p_supervisor_ids, ARRAY[]::UUID[]) ||
      CASE WHEN p_supervisor_id IS NULL THEN ARRAY[]::UUID[] ELSE ARRAY[p_supervisor_id] END
    ) AS s
   WHERE s IS NOT NULL;

  v_sups := COALESCE(v_sups, ARRAY[]::UUID[]);

  IF array_length(v_sups, 1) > 50 THEN
    RAISE EXCEPTION 'You can tag at most 50 supervisors on one task';
  END IF;

  IF v_actor = ANY(v_sups) THEN
    RAISE EXCEPTION 'You cannot supervise a task you assigned yourself';
  END IF;

  -- Collect assignees up front so the supervisor overlap check can see all of
  -- them, not just the ones processed so far.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_assignees)
  LOOP
    v_assignee := NULLIF(v_item ->> 'assignee_id', '')::UUID;
    IF v_assignee IS NULL THEN
      RAISE EXCEPTION 'Every assignee row needs a person selected';
    END IF;
    IF v_assignee = v_actor THEN
      RAISE EXCEPTION 'You cannot assign a task to yourself';
    END IF;
    IF v_assignee = ANY(v_sups) THEN
      RAISE EXCEPTION 'The same person cannot be both an assignee and a supervisor on this task';
    END IF;
    v_assignee_ids := v_assignee_ids || v_assignee;
  END LOOP;

  -- Retained for backward compatibility with anything still reading the column.
  v_primary_sup := CASE WHEN array_length(v_sups, 1) > 0 THEN v_sups[1] ELSE NULL END;

  IF v_count > 1 THEN
    v_group_id := gen_random_uuid();
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_assignees)
  LOOP
    v_assignee    := NULLIF(v_item ->> 'assignee_id', '')::UUID;
    v_title       := COALESCE(NULLIF(btrim(COALESCE(v_item ->> 'title', '')), ''), p_title);
    v_description := COALESCE(NULLIF(btrim(COALESCE(v_item ->> 'description', '')), ''), p_description);

    INSERT INTO public.tasks (
      institution_id, title, description, task_type, priority, due_date, status, task_group_id
    )
    VALUES (
      p_institution_id, v_title, v_description, p_task_type,
      COALESCE(p_priority, 2), p_due_date, 'open', v_group_id
    )
    RETURNING id INTO v_new_task_id;

    INSERT INTO public.task_assignments (task_id, assigner_id, assignee_id, supervisor_id)
    VALUES (v_new_task_id, v_actor, v_assignee, v_primary_sup);

    IF array_length(v_sups, 1) > 0 THEN
      INSERT INTO public.task_supervisors (task_id, supervisor_id)
      SELECT v_new_task_id, s FROM unnest(v_sups) AS s
      ON CONFLICT (task_id, supervisor_id) DO NOTHING;
    END IF;

    INSERT INTO public.notifications (user_id, type, title, message, link, metadata)
    VALUES (
      v_assignee,
      'task_assigned',
      'New Task Assigned',
      'You have been assigned a new task: "' || v_title || '"',
      '/tasks',
      jsonb_build_object('task_id', v_new_task_id)
    );

    v_task_ids := v_task_ids || v_new_task_id;
    IF v_first_task IS NULL THEN
      v_first_task := v_new_task_id;
    END IF;
  END LOOP;

  -- One notification per supervisor for the whole group, not one per assignee.
  IF array_length(v_sups, 1) > 0 THEN
    INSERT INTO public.notifications (user_id, type, title, message, link, metadata)
    SELECT s,
           'task_assigned',
           'New Task to Supervise',
           CASE
             WHEN v_count > 1
               THEN 'You are supervising a new task assigned to ' || v_count || ' people: "' || p_title || '"'
             ELSE 'You are supervising a new task: "' || p_title || '"'
           END,
           '/tasks',
           jsonb_build_object('task_id', v_first_task, 'task_group_id', v_group_id)
      FROM unnest(v_sups) AS s;
  END IF;

  RETURN jsonb_build_object(
    'task_group_id', v_group_id,
    'task_ids', to_jsonb(v_task_ids),
    'assignee_count', v_count,
    'supervisor_count', COALESCE(array_length(v_sups, 1), 0)
  );
END;
$function$;

-- -------------------------------------------------------------
-- 7. Portal adoption: roster narrows to the teacher's students.
-- -------------------------------------------------------------
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
    FROM public.dash_resolve_scoped_pairs() p;
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
END $function$;

-- -------------------------------------------------------------
-- 8. Portal laggards: same narrowing.
-- -------------------------------------------------------------
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
    FROM public.dash_resolve_scoped_pairs() p;
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
END $function$;

-- -------------------------------------------------------------
-- 9. Students-who-need-attention: same narrowing.
-- -------------------------------------------------------------
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
    INTO v_pc, v_ps FROM public.dash_resolve_scoped_pairs() p;
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
END $function$;

-- -------------------------------------------------------------
-- 10. KPI strip: "students who need help" narrows; attendance
--     tiles stay whole-class (the sanctioned exception).
-- -------------------------------------------------------------
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
END $function$;

-- -------------------------------------------------------------
-- 11. Student distribution: both the scored set and the total.
-- -------------------------------------------------------------
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
    FROM public.dash_resolve_scoped_pairs() p;
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
END $function$;
