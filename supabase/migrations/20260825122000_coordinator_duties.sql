-- Coordinator dashboard, phase 3: the two duties the PRD names as core to the
-- role -- recheck approval and task follow-up -- plus the wing digest.
--
-- Recheck scope path: recheck_requests.result_id -> final_results.id
--   -> final_results.attempt_id -> student_exam_attempts.class_id
-- which must land inside dash_resolve_scoped_classes().
--
-- Task scope: tasks.wing_id is NULL on every row in production, so tasks are
-- scoped through their assignee instead (task_assignments.assignee_id must be
-- a member of staff teaching one of the caller's classes). task_id is NOT NULL
-- UNIQUE on task_assignments, so this join can never fan a task out twice.

-- A status filter is about to become a hot predicate on this table.
CREATE INDEX IF NOT EXISTS idx_recheck_requests_status
  ON public.recheck_requests (status);
CREATE INDEX IF NOT EXISTS idx_recheck_requests_requested_at
  ON public.recheck_requests (requested_at DESC);

-- ---------------------------------------------------------------------------
-- 1. Recheck summary counts.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dash_scoped_recheck_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_class_ids uuid[] := public.dash_resolve_scoped_classes();
  v_inst uuid := public.get_user_institution((SELECT auth.uid()));
  v_tz text; v_today date;
  v_pending int; v_completed int; v_rejected int;
  v_avg numeric; v_oldest int;
BEGIN
  IF array_length(v_class_ids, 1) IS NULL OR v_inst IS NULL THEN
    RETURN jsonb_build_object('pending', 0, 'completed_30d', 0, 'rejected_30d', 0,
                              'avg_resolution_days', NULL, 'oldest_pending_days', NULL);
  END IF;

  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;

  SELECT
    count(*) FILTER (WHERE r.status::text = 'pending')::int,
    count(*) FILTER (WHERE r.status::text = 'completed'
                       AND r.resolved_at >= now() - INTERVAL '30 days')::int,
    count(*) FILTER (WHERE r.status::text = 'rejected'
                       AND r.resolved_at >= now() - INTERVAL '30 days')::int,
    round(avg(EXTRACT(EPOCH FROM (r.resolved_at - r.requested_at)) / 86400.0)
          FILTER (WHERE r.resolved_at IS NOT NULL), 1),
    max(v_today - r.requested_at::date) FILTER (WHERE r.status::text = 'pending')
  INTO v_pending, v_completed, v_rejected, v_avg, v_oldest
  FROM recheck_requests r
  JOIN final_results fr ON fr.id = r.result_id
  JOIN student_exam_attempts a ON a.id = fr.attempt_id
  WHERE a.class_id = ANY(v_class_ids);

  RETURN jsonb_build_object(
    'pending', COALESCE(v_pending, 0),
    'completed_30d', COALESCE(v_completed, 0),
    'rejected_30d', COALESCE(v_rejected, 0),
    'avg_resolution_days', v_avg,
    'oldest_pending_days', v_oldest
  );
END
$function$;

-- ---------------------------------------------------------------------------
-- 2. Pending recheck queue, oldest first. Paginated {rows, total}.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dash_scoped_recheck_queue(
  p_status text DEFAULT 'pending',
  p_limit  integer DEFAULT 10,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_class_ids uuid[] := public.dash_resolve_scoped_classes();
  v_inst uuid := public.get_user_institution((SELECT auth.uid()));
  v_tz text; v_today date;
  v_limit int := LEAST(GREATEST(COALESCE(p_limit, 10), 1), 100);
  v_offset int := GREATEST(COALESCE(p_offset, 0), 0);
  v_status text := COALESCE(NULLIF(p_status, ''), 'pending');
  v_total int; v_rows jsonb;
BEGIN
  IF array_length(v_class_ids, 1) IS NULL OR v_inst IS NULL THEN
    RETURN jsonb_build_object('rows', '[]'::jsonb, 'total', 0);
  END IF;

  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;

  SELECT count(*)::int INTO v_total
    FROM recheck_requests r
    JOIN final_results fr ON fr.id = r.result_id
    JOIN student_exam_attempts a ON a.id = fr.attempt_id
   WHERE a.class_id = ANY(v_class_ids)
     AND (v_status = 'all' OR r.status::text = v_status);

  SELECT COALESCE(jsonb_agg(x ORDER BY requested_at ASC), '[]'::jsonb) INTO v_rows
    FROM (
      SELECT r.requested_at,
             jsonb_build_object(
               'id', r.id,
               'student_name', COALESCE(p.full_name, p.email),
               'class_name', c.name || CASE WHEN COALESCE(c.section,'') <> ''
                                            THEN ' ' || c.section ELSE '' END,
               'exam_title', e.title,
               'question_order', q.question_order,
               'question_text', q.question_text,
               'reason', r.request_reason,
               'status', r.status,
               'previous_marks', r.previous_marks,
               'new_marks', r.new_marks,
               'requested_at', r.requested_at,
               'days_pending', v_today - r.requested_at::date
             ) AS x
        FROM recheck_requests r
        JOIN final_results fr ON fr.id = r.result_id
        JOIN student_exam_attempts a ON a.id = fr.attempt_id
        JOIN classes c ON c.id = a.class_id
        JOIN exams e ON e.id = a.exam_id
        LEFT JOIN profiles p ON p.id = a.student_id
        LEFT JOIN exam_questions q ON q.id = r.question_id
       WHERE a.class_id = ANY(v_class_ids)
         AND (v_status = 'all' OR r.status::text = v_status)
       ORDER BY r.requested_at ASC
       LIMIT v_limit OFFSET v_offset
    ) s;

  RETURN jsonb_build_object('rows', v_rows, 'total', COALESCE(v_total, 0));
END
$function$;

-- ---------------------------------------------------------------------------
-- 3. Resolve a recheck. ONE transaction, idempotent, scope-checked.
--
--    Semantics deliberately match the existing useResolveRecheck path: the
--    decision and the new marks are recorded on recheck_requests and
--    final_results is NOT rewritten. Forking that here would give the same
--    feature two different meanings depending on which screen you used.
--
--    Idempotency: the UPDATE is guarded on status = 'pending', so a double
--    click updates zero rows the second time and returns 'already_resolved'
--    instead of overwriting the first decision.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dash_scoped_resolve_recheck(
  p_id       uuid,
  p_approve  boolean,
  p_new_marks numeric DEFAULT NULL,
  p_notes    text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_class_ids uuid[] := public.dash_resolve_scoped_classes();
  v_prev numeric;
  v_in_scope boolean;
  v_updated int;
BEGIN
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'recheck: no request id';
  END IF;
  IF array_length(v_class_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'recheck: not authorized for this request';
  END IF;

  SELECT (a.class_id = ANY(v_class_ids)), r.previous_marks
    INTO v_in_scope, v_prev
    FROM recheck_requests r
    JOIN final_results fr ON fr.id = r.result_id
    JOIN student_exam_attempts a ON a.id = fr.attempt_id
   WHERE r.id = p_id;

  IF v_in_scope IS NULL THEN
    RAISE EXCEPTION 'recheck: request not found';
  END IF;
  IF NOT v_in_scope THEN
    RAISE EXCEPTION 'recheck: not authorized for this request';
  END IF;

  UPDATE recheck_requests
     SET status          = CASE WHEN p_approve THEN 'completed' ELSE 'rejected' END,
         new_marks       = CASE WHEN p_approve THEN p_new_marks ELSE NULL END,
         resolution_notes = NULLIF(btrim(COALESCE(p_notes, '')), ''),
         resolved_by     = v_uid,
         resolved_at     = now(),
         marks_changed   = (p_approve
                            AND p_new_marks IS NOT NULL
                            AND p_new_marks IS DISTINCT FROM v_prev)
   WHERE id = p_id
     AND status::text = 'pending';

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    RETURN jsonb_build_object('result', 'already_resolved');
  END IF;

  RETURN jsonb_build_object(
    'result', CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
    'marks_changed', (p_approve
                      AND p_new_marks IS NOT NULL
                      AND p_new_marks IS DISTINCT FROM v_prev)
  );
END
$function$;

-- ---------------------------------------------------------------------------
-- 4. Task summary for the staff the coordinator is responsible for.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dash_scoped_task_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_class_ids uuid[] := public.dash_resolve_scoped_classes();
  v_inst uuid := public.get_user_institution((SELECT auth.uid()));
  v_tz text; v_today date;
  v_open int; v_overdue int; v_completed int; v_total int; v_avg numeric;
BEGIN
  IF array_length(v_class_ids, 1) IS NULL OR v_inst IS NULL THEN
    RETURN jsonb_build_object('open', 0, 'overdue', 0, 'completion_rate', NULL,
                              'avg_closure_days', NULL, 'total', 0);
  END IF;

  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;

  WITH staff AS (
    SELECT DISTINCT ca.user_id
      FROM class_assignments ca
     WHERE ca.class_id = ANY(v_class_ids)
       AND ca.role::text <> 'student'
  ),
  scoped_tasks AS (
    SELECT t.*
      FROM tasks t
      JOIN task_assignments ta ON ta.task_id = t.id
      JOIN staff s ON s.user_id = ta.assignee_id
     WHERE t.institution_id = v_inst
       AND t.cancelled_at IS NULL
  )
  SELECT
    count(*) FILTER (WHERE status::text IN ('open', 'in_progress', 'done_pending_approval'))::int,
    count(*) FILTER (WHERE status::text IN ('open', 'in_progress', 'done_pending_approval')
                       AND due_date IS NOT NULL
                       AND due_date::date < v_today)::int,
    count(*) FILTER (WHERE status::text = 'completed')::int,
    count(*)::int,
    round(avg(EXTRACT(EPOCH FROM (updated_at - created_at)) / 86400.0)
          FILTER (WHERE status::text = 'completed'), 1)
  INTO v_open, v_overdue, v_completed, v_total, v_avg
  FROM scoped_tasks;

  RETURN jsonb_build_object(
    'open', COALESCE(v_open, 0),
    'overdue', COALESCE(v_overdue, 0),
    'completed', COALESCE(v_completed, 0),
    'total', COALESCE(v_total, 0),
    'completion_rate', CASE WHEN COALESCE(v_total, 0) > 0
                            THEN round(v_completed * 100.0 / v_total, 1) END,
    'avg_closure_days', v_avg
  );
END
$function$;

-- ---------------------------------------------------------------------------
-- 5. Task queue: overdue first, then due soonest. Paginated {rows, total}.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dash_scoped_task_queue(
  p_limit  integer DEFAULT 10,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_class_ids uuid[] := public.dash_resolve_scoped_classes();
  v_inst uuid := public.get_user_institution((SELECT auth.uid()));
  v_tz text; v_today date;
  v_limit int := LEAST(GREATEST(COALESCE(p_limit, 10), 1), 100);
  v_offset int := GREATEST(COALESCE(p_offset, 0), 0);
  v_total int; v_rows jsonb;
BEGIN
  IF array_length(v_class_ids, 1) IS NULL OR v_inst IS NULL THEN
    RETURN jsonb_build_object('rows', '[]'::jsonb, 'total', 0);
  END IF;

  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;

  SELECT count(*)::int INTO v_total
    FROM tasks t
    JOIN task_assignments ta ON ta.task_id = t.id
   WHERE t.institution_id = v_inst
     AND t.cancelled_at IS NULL
     AND t.status::text IN ('open', 'in_progress', 'done_pending_approval')
     AND ta.assignee_id IN (SELECT DISTINCT ca.user_id FROM class_assignments ca
                             WHERE ca.class_id = ANY(v_class_ids)
                               AND ca.role::text <> 'student');

  SELECT COALESCE(jsonb_agg(x ORDER BY overdue DESC, due_sort ASC NULLS LAST), '[]'::jsonb)
    INTO v_rows
    FROM (
      SELECT (t.due_date IS NOT NULL AND t.due_date::date < v_today) AS overdue,
             t.due_date AS due_sort,
             jsonb_build_object(
               'id', t.id,
               'title', t.title,
               'status', t.status,
               'priority', t.priority,
               'due_date', t.due_date,
               'assignee_name', COALESCE(p.full_name, p.email),
               'assignee_id', ta.assignee_id,
               'days_overdue', CASE WHEN t.due_date IS NOT NULL AND t.due_date::date < v_today
                                    THEN v_today - t.due_date::date END,
               'auto_created', t.auto_created
             ) AS x
        FROM tasks t
        JOIN task_assignments ta ON ta.task_id = t.id
        LEFT JOIN profiles p ON p.id = ta.assignee_id
       WHERE t.institution_id = v_inst
         AND t.cancelled_at IS NULL
         AND t.status::text IN ('open', 'in_progress', 'done_pending_approval')
         AND ta.assignee_id IN (SELECT DISTINCT ca.user_id FROM class_assignments ca
                                 WHERE ca.class_id = ANY(v_class_ids)
                                   AND ca.role::text <> 'student')
       ORDER BY (t.due_date IS NOT NULL AND t.due_date::date < v_today) DESC,
                t.due_date ASC NULLS LAST
       LIMIT v_limit OFFSET v_offset
    ) s;

  RETURN jsonb_build_object('rows', v_rows, 'total', COALESCE(v_total, 0));
END
$function$;

-- Lock down. Supabase grants EXECUTE to both anon (by name) and PUBLIC.
REVOKE EXECUTE ON FUNCTION public.dash_scoped_recheck_stats()                                  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.dash_scoped_recheck_queue(text, integer, integer)            FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.dash_scoped_resolve_recheck(uuid, boolean, numeric, text)    FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.dash_scoped_task_stats()                                     FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.dash_scoped_task_queue(integer, integer)                     FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.dash_scoped_recheck_stats()                               TO authenticated;
GRANT EXECUTE ON FUNCTION public.dash_scoped_recheck_queue(text, integer, integer)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.dash_scoped_resolve_recheck(uuid, boolean, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dash_scoped_task_stats()                                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.dash_scoped_task_queue(integer, integer)                  TO authenticated;
