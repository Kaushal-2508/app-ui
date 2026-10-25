-- Server-side, group-collapsed task counters for the Tasks page stat row.
--
-- WHY THIS EXISTS
-- TasksPage computed every tile client-side by .length-ing the array returned
-- by useInstitutionTasks(), which is bounded at .range(0, 999). Alliance has
-- 1,548 task rows, so 548 were never fetched and every tile understated the
-- school: Completed read 338 against 778 real (57% missing), Open 83 against
-- 128, the "All Tasks" tile 134 against 233 active. CLAUDE.md section 23
-- forbids fetching rows to count them; this aggregate is the replacement.
--
-- BUCKETING mirrors groupTasks() / STATUS_RANK in src/hooks/useTasks.ts so the
-- tiles reconcile with the lists underneath them:
--   * a multi-assignee fan-out group (CLAUDE.md section 11) is ONE work item,
--     so counts are over distinct coalesce(task_group_id, id)
--   * a group takes its LEAST-ADVANCED live member's status
--     (rejected 0 < open 1 < in_progress 2 < done_pending_approval 3
--      < completed 4), matching rollupStatus on the client: a group is not
--     done until every member is
--   * cancelled_at outranks status, matching isLive() on the client. A group
--     counts as cancelled only when EVERY member is cancelled; a partly
--     cancelled group is bucketed by its least-advanced surviving member.
--
-- The six buckets are disjoint and exhaustive, so they sum to `total`. That is
-- the whole point: the old row mixed a status partition (Open / In Progress)
-- with a cross-cutting slice (Supervising) and a fused bucket (Pending =
-- awaiting approval + cancelled), so the numbers could never reconcile.
--
-- DATE WINDOW matches the client's per-bucket date field: completed and
-- cancelled rows date on updated_at (when they reached that state), everything
-- else on created_at (when it entered visibility).

CREATE OR REPLACE FUNCTION public.task_status_counts(
  p_scope text DEFAULT 'mine',
  p_from  timestamptz DEFAULT NULL,
  p_to    timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid := (SELECT auth.uid());
  v_inst  uuid;
  v_admin boolean;
  v_coord boolean;
  v_scope text;
  v_out   jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object(
      'scope', 'none', 'to_do', 0, 'in_progress', 0, 'needs_rework', 0,
      'awaiting_approval', 0, 'completed', 0, 'cancelled', 0, 'total', 0);
  END IF;

  v_inst  := public.get_user_institution(v_uid);
  v_admin := public.has_role(v_uid, 'school_admin')
          OR public.has_role(v_uid, 'super_school_admin');
  v_coord := public.has_role(v_uid, 'coordinator');

  -- p_scope is a REQUEST, never authority. A teacher asking for 'institution'
  -- is silently downgraded to 'mine' rather than refused, and the EFFECTIVE
  -- scope is returned so the caller labels the row honestly instead of
  -- guessing. (Arg-trust is the open S-1 finding in the optional-subjects
  -- audit; do not repeat it here.)
  v_scope := CASE
    WHEN p_scope = 'institution' AND v_admin AND v_inst IS NOT NULL THEN 'institution'
    WHEN p_scope = 'wing'        AND v_coord AND v_inst IS NOT NULL THEN 'wing'
    ELSE 'mine'
  END;

  WITH my_wings AS (
    SELECT wa.wing_id
      FROM public.wing_assignments wa
      JOIN public.wings w
        ON w.id = wa.wing_id
       AND w.institution_id = v_inst
     WHERE wa.user_id = v_uid
  ),
  -- Set-based rewrite of coordinator_covers_task()'s second arm. That helper is
  -- per-task; calling it across ~1,500 rows inside an aggregate is a per-row
  -- EXISTS chain, and prod's authenticated statement_timeout is 8s. Same
  -- predicate, evaluated once.
  wing_staff AS (
    SELECT DISTINCT ca.user_id
      FROM public.class_assignments ca
      JOIN public.wing_class_mappings wcm
        ON wcm.class_id = ca.class_id
       AND wcm.wing_id IN (SELECT wing_id FROM my_wings)
      JOIN public.classes c
        ON c.id = ca.class_id
       AND c.institution_id = v_inst
       AND COALESCE(c.is_active, true)
     WHERE ca.role::text <> 'student'
  ),
  scoped AS (
    SELECT t.id, t.task_group_id, t.status, t.cancelled_at
      FROM public.tasks t
     WHERE CASE v_scope
             WHEN 'institution' THEN t.institution_id = v_inst
             WHEN 'wing' THEN
               t.institution_id = v_inst
               AND (
                 t.wing_id IN (SELECT wing_id FROM my_wings)
                 OR EXISTS (
                   SELECT 1
                     FROM public.task_assignments ta
                    WHERE ta.task_id = t.id
                      AND (ta.assignee_id IN (SELECT user_id FROM wing_staff)
                        OR ta.assigner_id IN (SELECT user_id FROM wing_staff))
                 )
               )
             ELSE
               EXISTS (
                 SELECT 1
                   FROM public.task_assignments ta
                  WHERE ta.task_id = t.id
                    AND v_uid IN (ta.assignee_id, ta.assigner_id, ta.supervisor_id)
               )
           END
       AND (p_from IS NULL OR
            CASE WHEN t.status::text = 'completed' OR t.cancelled_at IS NOT NULL
                 THEN t.updated_at ELSE t.created_at END >= p_from)
       -- Inclusive upper bound: resolveDateRange() builds `to` with endOfDay()
       -- and the client compares with isWithinInterval, which is inclusive at
       -- both ends. A strict `<` here would silently drop the final
       -- millisecond of the window and disagree with the list below it.
       AND (p_to IS NULL OR
            CASE WHEN t.status::text = 'completed' OR t.cancelled_at IS NOT NULL
                 THEN t.updated_at ELSE t.created_at END <= p_to)
  ),
  items AS (
    SELECT
      COALESCE(s.task_group_id::text, s.id::text) AS grp,
      bool_and(s.cancelled_at IS NOT NULL)        AS all_cancelled,
      min(CASE s.status::text
            WHEN 'rejected'             THEN 0
            WHEN 'open'                 THEN 1
            WHEN 'in_progress'          THEN 2
            WHEN 'done_pending_approval' THEN 3
            ELSE 4
          END) FILTER (WHERE s.cancelled_at IS NULL) AS live_rank
      FROM scoped s
     GROUP BY 1
  )
  SELECT jsonb_build_object(
    'scope',             v_scope,
    'to_do',             count(*) FILTER (WHERE NOT all_cancelled AND live_rank = 1),
    'in_progress',       count(*) FILTER (WHERE NOT all_cancelled AND live_rank = 2),
    'needs_rework',      count(*) FILTER (WHERE NOT all_cancelled AND live_rank = 0),
    'awaiting_approval', count(*) FILTER (WHERE NOT all_cancelled AND live_rank = 3),
    'completed',         count(*) FILTER (WHERE NOT all_cancelled AND live_rank = 4),
    'cancelled',         count(*) FILTER (WHERE all_cancelled),
    'total',             count(*)
  )
  INTO v_out
  FROM items;

  RETURN COALESCE(v_out, jsonb_build_object(
    'scope', v_scope, 'to_do', 0, 'in_progress', 0, 'needs_rework', 0,
    'awaiting_approval', 0, 'completed', 0, 'cancelled', 0, 'total', 0));
END
$function$;

COMMENT ON FUNCTION public.task_status_counts(text, timestamptz, timestamptz) IS
  'Disjoint, group-collapsed task counters for the Tasks page stat row. p_scope is a request, not authority: it is downgraded to the widest scope the caller actually holds, and the effective scope is returned in the payload.';

-- Supabase default privileges grant EXECUTE to anon on every new function, and
-- REVOKE FROM PUBLIC does NOT strip that (CLAUDE.md section 26). Revoke by name.
REVOKE ALL ON FUNCTION public.task_status_counts(text, timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.task_status_counts(text, timestamptz, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.task_status_counts(text, timestamptz, timestamptz) TO authenticated;

-- The institution and wing arms both filter tasks by institution_id first
-- (idx_tasks_institution), then group by task_group_id (idx_tasks_task_group_id).
-- The 'mine' arm probes task_assignments by assignee/assigner/supervisor, all
-- three of which are already indexed (idx_task_assignments_assignee,
-- idx_task_assignments_assigner, idx_task_assignments_supervisor). No new index
-- is needed; verified against pg_indexes, not the migration ledger.
