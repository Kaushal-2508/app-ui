-- =====================================================================
-- Multiple supervisors per task
-- =====================================================================
-- `task_assignments.supervisor_id` is a single column, so a task could only
-- ever be observed by one person. Supervisors move to their own table.
--
-- The legacy column is KEPT and kept in sync with the first supervisor.
-- Supervisors are only set at creation (there is no edit surface), so the two
-- cannot drift, and anything still reading the column keeps working. Readers
-- should go through `is_task_supervisor()`, which now consults both.
--
-- This also fixes a pre-existing dead end: `task_assignments` had no SELECT
-- policy for supervisors, so `useSupervisingTasks` joined against rows the
-- supervisor could not read and always returned nothing. That is why the
-- Supervising tab has been showing 0.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.task_supervisors (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id       UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  -- Ownership-style column (§21): the row is meaningless without the person.
  supervisor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  added_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT task_supervisors_task_supervisor_key UNIQUE (task_id, supervisor_id)
);

COMMENT ON TABLE public.task_supervisors IS
  'Observers of a task. Replaces the single task_assignments.supervisor_id, which is retained in sync with the first supervisor for backward compatibility.';

-- §23: every FK gets an index in the same migration.
CREATE INDEX IF NOT EXISTS idx_task_supervisors_task_id
  ON public.task_supervisors (task_id);
CREATE INDEX IF NOT EXISTS idx_task_supervisors_supervisor_id
  ON public.task_supervisors (supervisor_id);

ALTER TABLE public.task_supervisors ENABLE ROW LEVEL SECURITY;


-- Institution of a task, as a SECURITY DEFINER helper so RLS never has to
-- inline a cross-table EXISTS (§23 recursion trap).
CREATE OR REPLACE FUNCTION public.get_task_institution(_task_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT institution_id FROM public.tasks WHERE id = _task_id
$$;


-- Now true for supervisors recorded in EITHER place. Every consumer of this
-- helper becomes multi-supervisor aware without further change.
CREATE OR REPLACE FUNCTION public.is_task_supervisor(_user_id UUID, _task_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.task_supervisors
     WHERE task_id = _task_id AND supervisor_id = _user_id
  ) OR EXISTS (
    -- Legacy fallback: covers any row that predates or escapes the backfill.
    SELECT 1 FROM public.task_assignments
     WHERE task_id = _task_id AND supervisor_id = _user_id
  )
$$;


-- Backfill every existing single supervisor.
INSERT INTO public.task_supervisors (task_id, supervisor_id)
SELECT ta.task_id, ta.supervisor_id
  FROM public.task_assignments ta
 WHERE ta.supervisor_id IS NOT NULL
ON CONFLICT (task_id, supervisor_id) DO NOTHING;


-- Any write path that still sets the legacy column (useCreateTask, used by
-- BulkAssignTaskDialog and AISuggestedTasksCard) mirrors into the new table
-- automatically. Without this, a supervisor tagged that way would never appear
-- in their own Supervising tab, which now reads task_supervisors.
CREATE OR REPLACE FUNCTION public.mirror_assignment_supervisor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.supervisor_id IS NOT NULL THEN
    INSERT INTO public.task_supervisors (task_id, supervisor_id)
    VALUES (NEW.task_id, NEW.supervisor_id)
    ON CONFLICT (task_id, supervisor_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mirror_assignment_supervisor ON public.task_assignments;
CREATE TRIGGER mirror_assignment_supervisor
  AFTER INSERT OR UPDATE OF supervisor_id ON public.task_assignments
  FOR EACH ROW EXECUTE FUNCTION public.mirror_assignment_supervisor();


-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "Task participants can view supervisors" ON public.task_supervisors;
CREATE POLICY "Task participants can view supervisors"
  ON public.task_supervisors FOR SELECT
  TO authenticated
  USING (
    supervisor_id = (SELECT auth.uid())
    OR public.get_task_assignee(task_id) = (SELECT auth.uid())
    OR public.get_task_assigner(task_id) = (SELECT auth.uid())
    OR public.has_role((SELECT auth.uid()), 'super_admin')
    OR public.has_role_at_institution(
         (SELECT auth.uid()), 'school_admin', public.get_task_institution(task_id))
  );

-- Writes go through create_task_group (SECURITY DEFINER) only; no client
-- INSERT/UPDATE/DELETE policy is granted deliberately.

-- Lets a supervisor actually read the assignment row they supervise. Without
-- this the Supervising tab is permanently empty, because its query inner-joins
-- task_assignments.
DROP POLICY IF EXISTS "Supervisors can view assignments they supervise" ON public.task_assignments;
CREATE POLICY "Supervisors can view assignments they supervise"
  ON public.task_assignments FOR SELECT
  TO authenticated
  USING (public.is_task_supervisor((SELECT auth.uid()), task_id));


-- Comment policies: same participants as before, but the supervisor test moves
-- from an inline `ta.supervisor_id` comparison (which saw only the single
-- legacy supervisor, and inlined a cross-table EXISTS against §23) to the
-- helper. Semantics are otherwise preserved exactly.
DROP POLICY IF EXISTS "Task participants can view comments" ON public.task_comments;
CREATE POLICY "Task participants can view comments"
  ON public.task_comments FOR SELECT
  TO authenticated
  USING (
    public.get_task_assignee(task_id) = (SELECT auth.uid())
    OR public.get_task_assigner(task_id) = (SELECT auth.uid())
    OR public.is_task_supervisor((SELECT auth.uid()), task_id)
    OR public.has_role((SELECT auth.uid()), 'super_admin')
  );

DROP POLICY IF EXISTS "Task participants can add comments" ON public.task_comments;
CREATE POLICY "Task participants can add comments"
  ON public.task_comments FOR INSERT
  TO authenticated
  WITH CHECK (
    public.get_task_assignee(task_id) = (SELECT auth.uid())
    OR public.get_task_assigner(task_id) = (SELECT auth.uid())
    OR public.is_task_supervisor((SELECT auth.uid()), task_id)
  );


-- ---------------------------------------------------------------------
-- create_task_group — now takes a LIST of supervisors
-- ---------------------------------------------------------------------
-- Both supervisor parameters are optional and trailing, so the currently
-- deployed frontend (which sends `p_supervisor_id`) keeps working against this
-- same function while the new build rolls out. PostgREST resolves RPCs by
-- parameter name, so the reordering is invisible to callers.
DROP FUNCTION IF EXISTS public.create_task_group(
  UUID, TEXT, TEXT, public.task_type, INTEGER, TIMESTAMPTZ, UUID, JSONB);

CREATE OR REPLACE FUNCTION public.create_task_group(
  p_institution_id UUID,
  p_title          TEXT,
  p_description    TEXT,
  p_task_type      public.task_type,
  p_priority       INTEGER,
  p_due_date       TIMESTAMPTZ,
  p_assignees      JSONB,
  p_supervisor_id  UUID   DEFAULT NULL,
  p_supervisor_ids UUID[] DEFAULT NULL
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
$$;

REVOKE ALL ON FUNCTION public.create_task_group(
  UUID, TEXT, TEXT, public.task_type, INTEGER, TIMESTAMPTZ, JSONB, UUID, UUID[]
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_task_group(
  UUID, TEXT, TEXT, public.task_type, INTEGER, TIMESTAMPTZ, JSONB, UUID, UUID[]
) TO authenticated;

REVOKE ALL ON FUNCTION public.get_task_institution(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_task_institution(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.is_task_supervisor(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_task_supervisor(UUID, UUID) TO authenticated;
