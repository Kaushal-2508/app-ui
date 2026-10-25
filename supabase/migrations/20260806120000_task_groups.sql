-- =====================================================================
-- Multi-assignee tasks — fan-out model with a shared group key
-- =====================================================================
-- One instruction assigned to N people becomes N `tasks` rows (one per
-- assignee) sharing a `task_group_id`. This is deliberate:
--
--   * task_assignments.task_id is NOT NULL UNIQUE, so one task can only
--     ever carry one assignment.
--   * get_task_assignee(task_id) returns a single UUID and is referenced
--     by six RLS policies plus enforce_task_status_transition.
--   * tasks.status is a single column and cannot express per-person
--     progress.
--
-- Fanning out keeps every one of those invariants intact: each row is an
-- ordinary task with its own status, evidence, comments and approval, and
-- existing RLS already stops an assignee reading a sibling's row.
--
-- task_group_id IS NULL  => single-assignee task (everything before today)
-- task_group_id NOT NULL => one member of a multi-assignee group
-- =====================================================================

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS task_group_id UUID;

COMMENT ON COLUMN public.tasks.task_group_id IS
  'Groups sibling tasks created by one multi-assignee assignment. NULL means a single-assignee task. Stamped only when there is more than one assignee.';

-- Partial index: only grouped rows are ever looked up by this key, and
-- they are a small minority of the table.
CREATE INDEX IF NOT EXISTS idx_tasks_task_group_id
  ON public.tasks (task_group_id)
  WHERE task_group_id IS NOT NULL;


-- =====================================================================
-- create_task_group — every write for one assignment, in one transaction
-- =====================================================================
-- Replaces a client-side loop that would have issued 3N round trips for N
-- assignees (CLAUDE.md §23 / enterprise rule 6: two or more dependent
-- writes are ONE RPC, never sequential client calls). It also makes the
-- assignment all-or-nothing, so a failure can never leave 2 of 3 people
-- assigned.
--
-- SECURITY DEFINER bypasses RLS, so this re-checks exactly what the
-- "Authorized users can create tasks in their institution" INSERT policy
-- checks, plus the no_self_assignment CHECK on task_assignments.
--
-- p_assignees shape:
--   [{ "assignee_id": uuid, "title": text|null, "description": text|null }]
-- A null/blank per-person title or description inherits the group's.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.create_task_group(
  p_institution_id UUID,
  p_title          TEXT,
  p_description    TEXT,
  p_task_type      public.task_type,
  p_priority       INTEGER,
  p_due_date       TIMESTAMPTZ,
  p_supervisor_id  UUID,
  p_assignees      JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'You need to be signed in to assign a task';
  END IF;

  -- Mirror of the INSERT policy on public.tasks
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

  -- Upper bound so one call cannot fan out unboundedly. Sized for "assign to
  -- everyone": the largest institution on prod has 94 assignable members
  -- (Alliance, 2026-08-06), so 200 leaves real headroom while still being a
  -- guard rather than a limit anyone meets in practice.
  IF v_count > 200 THEN
    RAISE EXCEPTION 'You can assign a task to at most 200 people at once';
  END IF;

  SELECT COUNT(DISTINCT elem ->> 'assignee_id')
    INTO v_distinct
    FROM jsonb_array_elements(p_assignees) AS elem;

  IF v_distinct <> v_count THEN
    RAISE EXCEPTION 'The same person is selected more than once';
  END IF;

  IF p_supervisor_id IS NOT NULL AND p_supervisor_id = v_actor THEN
    RAISE EXCEPTION 'You cannot supervise a task you assigned yourself';
  END IF;

  -- Only stamp a group id when the assignment is genuinely shared, so a
  -- one-person assignment keeps the exact shape it has today.
  IF v_count > 1 THEN
    v_group_id := gen_random_uuid();
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_assignees)
  LOOP
    v_assignee := NULLIF(v_item ->> 'assignee_id', '')::UUID;

    IF v_assignee IS NULL THEN
      RAISE EXCEPTION 'Every assignee row needs a person selected';
    END IF;

    IF v_assignee = v_actor THEN
      RAISE EXCEPTION 'You cannot assign a task to yourself';
    END IF;

    IF p_supervisor_id IS NOT NULL AND p_supervisor_id = v_assignee THEN
      RAISE EXCEPTION 'The supervisor cannot also be an assignee on the same task';
    END IF;

    -- Blank override inherits the group title / description.
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
    VALUES (v_new_task_id, v_actor, v_assignee, p_supervisor_id);

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

  -- One notification for the whole group, not one per assignee.
  IF p_supervisor_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, message, link, metadata)
    VALUES (
      p_supervisor_id,
      'task_assigned',
      'New Task to Supervise',
      CASE
        WHEN v_count > 1
          THEN 'You are supervising a new task assigned to ' || v_count || ' people: "' || p_title || '"'
        ELSE 'You are supervising a new task: "' || p_title || '"'
      END,
      '/tasks',
      jsonb_build_object('task_id', v_first_task, 'task_group_id', v_group_id)
    );
  END IF;

  RETURN jsonb_build_object(
    'task_group_id', v_group_id,
    'task_ids', to_jsonb(v_task_ids),
    'assignee_count', v_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_task_group(
  UUID, TEXT, TEXT, public.task_type, INTEGER, TIMESTAMPTZ, UUID, JSONB
) FROM PUBLIC;

-- Supabase's ALTER DEFAULT PRIVILEGES grants EXECUTE to anon on every new
-- function in `public`, and REVOKE ... FROM PUBLIC does NOT remove that
-- explicit role grant. A SECURITY DEFINER function must never stay reachable
-- unauthenticated, so revoke it by name.
REVOKE ALL ON FUNCTION public.create_task_group(
  UUID, TEXT, TEXT, public.task_type, INTEGER, TIMESTAMPTZ, UUID, JSONB
) FROM anon;

GRANT EXECUTE ON FUNCTION public.create_task_group(
  UUID, TEXT, TEXT, public.task_type, INTEGER, TIMESTAMPTZ, UUID, JSONB
) TO authenticated;

COMMENT ON FUNCTION public.create_task_group(
  UUID, TEXT, TEXT, public.task_type, INTEGER, TIMESTAMPTZ, UUID, JSONB
) IS
  'Creates one task + assignment + notification per assignee in a single transaction. More than one assignee shares a generated task_group_id. Re-checks the tasks INSERT policy because SECURITY DEFINER bypasses RLS.';
