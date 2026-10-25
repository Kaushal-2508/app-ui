-- =============================================================
-- Coordinators see the people on their wing's tasks, and only their wing's tasks
-- -------------------------------------------------------------
-- Spec: docs/superpowers/specs/2026-09-09-coordinator-task-assignment-visibility.md
-- (frontend half shipped on naman-erp 2026-09-09, merged b4283d32: the detail
-- panel prints "Not visible to you" while the task_assignments row is hidden).
--
-- Problem. tasks carried a coordinator SELECT policy for the WHOLE institution,
-- while task_assignments stayed participant / supervisor / school-admin only. A
-- coordinator therefore saw every task in the school with "Assigned By / To"
-- blanked, and the "Wing" tile on /coordinator/tasks counted institution rows.
--
-- Scope rule, reused from dash_scoped_task_queue / dash_resolve_scoped_classes
-- rather than invented: a task belongs to a coordinator's wing when its assignee
-- OR its assigner is a non-student staff member (class_assignments.role <>
-- 'student') on a class mapped to one of the coordinator's wings
-- (wing_assignments x wing_class_mappings x active classes of the task's
-- institution). tasks.wing_id is honoured as well when set (NULL on every prod
-- row on 2026-09-09). The wing must belong to the task's institution and the
-- caller must hold the coordinator role there. Fails closed on NULL.
--
-- 1. coordinator_covers_task(_user_id, _task_id): STABLE SECURITY DEFINER helper,
--    the only thing the policies call (CLAUDE.md 23: no inline cross-table EXISTS
--    in a policy; auth.uid() hoisted as (select auth.uid())).
-- 2. task_assignments: SELECT for coordinators through the helper.
-- 3. tasks: the whole-institution coordinator policy is REPLACED by the wing
--    policy. "Users can view tasks they are assigned to", the school-admin and
--    the super-admin policies are untouched, so a coordinator still sees tasks
--    they personally assigned or received outside the wing.
-- 4. tasks: a supervisor SELECT policy. There was none: supervisors saw the tasks
--    they supervise only through the broad role policies, so a pure coordinator
--    narrowed to the wing would have lost every supervised task outside it.
--    task_assignments and task_comments already had the supervisor policy.
-- 5. task_comments / task_evidence: SELECT for coordinators on wing tasks, so the
--    detail sheet stops printing "No comments yet" for RLS reasons. Row metadata
--    only; a storage object behind task_evidence.file_url keeps its bucket policy.
-- 6. Teachers are deliberately left alone (spec item 4). They keep the
--    institution-wide tasks policy, which also means a teacher+coordinator still
--    sees institution-wide tasks through the teacher hat, with wing tasks now
--    carrying names and the rest still "Not visible to you". Narrowing teachers
--    would change the multi-assignee sibling view and is a separate decision.
--
-- Grants per CLAUDE.md 26: REVOKE FROM PUBLIC and FROM anon by name.
-- Prod: applied 2026-09-09 via scripts/run-sql.ps1 (the ledger is not maintained;
-- verify with the block at the end).
-- =============================================================

-- 1. The helper ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.coordinator_covers_task(_user_id uuid, _task_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _user_id IS NOT NULL
     AND _task_id IS NOT NULL
     AND EXISTS (
       SELECT 1
         FROM public.tasks t
         JOIN public.user_roles ur
           ON ur.user_id = _user_id
          AND ur.role = 'coordinator'
          AND (ur.institution_id = t.institution_id OR ur.institution_id IS NULL)
         JOIN public.wing_assignments wa
           ON wa.user_id = _user_id
         JOIN public.wings w
           ON w.id = wa.wing_id
          AND w.institution_id = t.institution_id
        WHERE t.id = _task_id
          AND (
            t.wing_id = wa.wing_id
            OR EXISTS (
              SELECT 1
                FROM public.task_assignments ta
                JOIN public.class_assignments ca
                  ON ca.user_id IN (ta.assignee_id, ta.assigner_id)
                 AND ca.role <> 'student'
                JOIN public.wing_class_mappings wcm
                  ON wcm.class_id = ca.class_id
                 AND wcm.wing_id  = wa.wing_id
                JOIN public.classes c
                  ON c.id = ca.class_id
                 AND c.institution_id = t.institution_id
                 AND coalesce(c.is_active, true)
               WHERE ta.task_id = t.id
            )
          )
     );
$$;

REVOKE ALL ON FUNCTION public.coordinator_covers_task(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.coordinator_covers_task(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.coordinator_covers_task(uuid, uuid) TO authenticated, service_role;

-- 2. task_assignments ------------------------------------------------------------
DROP POLICY IF EXISTS "Coordinators can view wing task assignments" ON public.task_assignments;
CREATE POLICY "Coordinators can view wing task assignments"
  ON public.task_assignments
  FOR SELECT TO authenticated
  USING (public.coordinator_covers_task((select auth.uid()), task_id));

-- 3. tasks: institution-wide -> wing ---------------------------------------------
DROP POLICY IF EXISTS "Coordinators can view all tasks in their institution" ON public.tasks;
DROP POLICY IF EXISTS "Coordinators can view wing tasks" ON public.tasks;
CREATE POLICY "Coordinators can view wing tasks"
  ON public.tasks
  FOR SELECT TO authenticated
  USING (public.coordinator_covers_task((select auth.uid()), id));

-- 4. tasks: supervisors ----------------------------------------------------------
DROP POLICY IF EXISTS "Supervisors can view tasks they supervise" ON public.tasks;
CREATE POLICY "Supervisors can view tasks they supervise"
  ON public.tasks
  FOR SELECT TO authenticated
  USING (public.is_task_supervisor((select auth.uid()), id));

-- 5. comments and evidence -------------------------------------------------------
DROP POLICY IF EXISTS "Coordinators can view wing task comments" ON public.task_comments;
CREATE POLICY "Coordinators can view wing task comments"
  ON public.task_comments
  FOR SELECT TO authenticated
  USING (public.coordinator_covers_task((select auth.uid()), task_id));

DROP POLICY IF EXISTS "Coordinators can view wing task evidence" ON public.task_evidence;
CREATE POLICY "Coordinators can view wing task evidence"
  ON public.task_evidence
  FOR SELECT TO authenticated
  USING (public.coordinator_covers_task((select auth.uid()), task_id));

-- Verify after applying:
--   SELECT proname, prosecdef, proacl::text FROM pg_proc
--    WHERE proname = 'coordinator_covers_task';           -- no '=X/' and no 'anon=' element
--   SELECT tablename, policyname FROM pg_policies
--    WHERE schemaname = 'public' AND tablename IN ('tasks','task_assignments','task_comments','task_evidence')
--      AND (policyname LIKE 'Coordinators can view wing%' OR policyname = 'Supervisors can view tasks they supervise');
--   -- 5 rows; "Coordinators can view all tasks in their institution" gone.
-- Functional (SET LOCAL ROLE authenticated + request.jwt.claims for a pure
-- coordinator): count(tasks) drops from the institution total to wing + own +
-- supervised, and every visible task has a visible task_assignments row.
