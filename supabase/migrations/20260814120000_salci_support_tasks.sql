-- ============================================================================
-- Salci Support as a task
--
-- Design: docs/superpowers/specs/2026-08-14-salci-support-task-design.md
--
-- The "Salci Support" button creates a real `tasks` row assigned to a
-- configured SALCI support owner. Three requirements, three independent
-- mechanisms:
--
--   1. reporter sees it            -> reporter is the ASSIGNER, so the row
--                                     shows under "Assigned BY Me"
--   2. colleagues do NOT see it    -> the row lives in a SALCI-owned
--                                     institution, so the three
--                                     institution-wide SELECT policies on
--                                     `tasks` never match it
--   3. only SALCI can complete it  -> a RESTRICTIVE UPDATE policy scoped to
--                                     that institution
--
-- Nothing shared is edited: task_assignments' UNIQUE(task_id),
-- get_task_assignee/get_task_assigner, validate_task_state_transition,
-- create_task_group and can_create_tasks are all untouched.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The SALCI Support institution
--
-- Doubles as the privacy boundary AND an unforgeable authority marker: the
-- `tasks` INSERT policy pins institution_id to the author's own institution,
-- so no client can ever create a row here. That makes "is this a support
-- ticket?" a property the client cannot fake, which is what resolve_support_task
-- checks instead of a client-writable boolean.
--
-- is_active = false keeps it out of school-facing institution pickers.
-- NOBODY may ever hold a school role at this institution: has_role_at_institution()
-- treats a NULL user_roles.institution_id as matching EVERY institution.
-- ---------------------------------------------------------------------------
INSERT INTO public.institutions (name, code, is_active, timezone)
SELECT 'SALCI Support', 'SALCI-SUPPORT', false, 'Asia/Kolkata'
WHERE NOT EXISTS (SELECT 1 FROM public.institutions WHERE code = 'SALCI-SUPPORT');

CREATE OR REPLACE FUNCTION public.get_support_institution_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.institutions WHERE code = 'SALCI-SUPPORT' LIMIT 1
$$;

COMMENT ON FUNCTION public.get_support_institution_id() IS
  'Id of the SALCI Support institution. Used by the support RPCs and by the RESTRICTIVE update policy on tasks.';

-- ---------------------------------------------------------------------------
-- 2. Support owner configuration
--
-- Single-row table (the boolean PK + CHECK makes a second row impossible).
-- Changing who handles support is one UPDATE, no deploy.
--
-- owner_id is ON DELETE RESTRICT on purpose: task_assignments.assignee_id is
-- ON DELETE CASCADE to profiles, so without RESTRICT, deleting the support
-- owner's profile would silently wipe every support assignment and leave
-- orphaned task rows with no assignee.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.support_settings (
  id          boolean     PRIMARY KEY DEFAULT true CHECK (id),
  owner_id    uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid        REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_support_settings_owner
  ON public.support_settings(owner_id);

CREATE INDEX IF NOT EXISTS idx_support_settings_updated_by
  ON public.support_settings(updated_by);

ALTER TABLE public.support_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read support settings" ON public.support_settings;
CREATE POLICY "Authenticated users can read support settings"
  ON public.support_settings FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Super admins manage support settings" ON public.support_settings;
CREATE POLICY "Super admins manage support settings"
  ON public.support_settings FOR ALL TO authenticated
  USING (public.is_super_admin((SELECT auth.uid())))
  WITH CHECK (public.is_super_admin((SELECT auth.uid())));

-- Seed the current owner by email so this migration is not uuid-brittle.
INSERT INTO public.support_settings (id, owner_id)
SELECT true, p.id
FROM public.profiles p
WHERE p.email = 'bhanu@salci.in'
  AND NOT EXISTS (SELECT 1 FROM public.support_settings)
LIMIT 1;

CREATE OR REPLACE FUNCTION public.get_support_owner_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT owner_id FROM public.support_settings WHERE id
$$;

COMMENT ON FUNCTION public.get_support_owner_id() IS
  'The profile that receives Salci Support tickets. Change via support_settings, not code.';

-- ---------------------------------------------------------------------------
-- 3. reported_issues keeps working as the intake record
--
-- task_id is an authorship-style reference (CLAUDE.md section 21): deleting
-- the task must leave the reporter's intake record standing.
-- The (reporter_id, created_at) index backs the per-caller throttle below;
-- this table had only its primary key before.
-- ---------------------------------------------------------------------------
ALTER TABLE public.reported_issues
  ADD COLUMN IF NOT EXISTS task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_reported_issues_task_id
  ON public.reported_issues(task_id);

CREATE INDEX IF NOT EXISTS idx_reported_issues_reporter_created
  ON public.reported_issues(reporter_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 4. Only SALCI may change the status of a support task
--
-- PostgreSQL ORs the permissive policies, then ANDs the restrictive ones. The
-- existing permissive UPDATE policy is
--   USING (get_task_assignee(id) = auth.uid() OR get_task_assigner(id) = auth.uid())
-- which the reporter satisfies as assigner. This clamps that down.
--
-- Normal task  -> first disjunct true  -> passes -> behaviour unchanged.
-- Support task -> requires is_super_admin.
--
-- `IS DISTINCT FROM` rather than `<>` is LOAD-BEARING. If the SALCI-SUPPORT
-- institution row ever goes missing the helper returns NULL; with `<>` the
-- expression would be NULL (not true) for every row and UPDATE would be denied
-- on EVERY task platform-wide. With IS DISTINCT FROM the failure mode is
-- "support tickets become writable" instead of "the tasks module bricks".
--
-- No TO clause, so this applies to PUBLIC: a restrictive guard should have the
-- widest possible reach. service_role has BYPASSRLS and is unaffected.
--
-- USING doubles as the WITH CHECK here (Postgres reuses it when WITH CHECK is
-- omitted), which also stops anyone moving an ordinary task INTO the support
-- institution.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Only SALCI may update support tasks" ON public.tasks;
CREATE POLICY "Only SALCI may update support tasks"
  ON public.tasks AS RESTRICTIVE FOR UPDATE
  USING (
    institution_id IS DISTINCT FROM public.get_support_institution_id()
    OR public.is_super_admin((SELECT auth.uid()))
  );

-- ---------------------------------------------------------------------------
-- 5. Intake RPC
--
-- SECURITY DEFINER because:
--   * can_create_tasks() excludes students (the majority of real reporters)
--     and super_admins, and
--   * the tasks INSERT policy pins institution_id to the caller's own school,
--     so the row could never land in SALCI Support from the client.
--
-- That makes this an authenticated-callable task-creation surface open to
-- thousands of students, so the per-caller throttle is not optional.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_support_task(
  p_subject     text,
  p_description text,
  p_category    text    DEFAULT NULL,
  p_priority    integer DEFAULT 2,
  p_page_url    text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_owner     uuid;
  v_inst      uuid;
  v_recent    integer;
  v_task      uuid;
  v_ticket    uuid;
  v_priority  integer;
  v_subject   text;
  v_body      text;
  v_desc      text;
  v_role      text;
  v_classes   text;
  v_name      text;
  v_email     text;
  v_rep_inst  uuid;
  v_school    text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to contact support.';
  END IF;

  v_subject := nullif(btrim(coalesce(p_subject, '')), '');
  IF v_subject IS NULL THEN
    RAISE EXCEPTION 'Please add a subject so we know what this is about.';
  END IF;

  v_body := nullif(btrim(coalesce(p_description, '')), '');
  IF v_body IS NULL THEN
    RAISE EXCEPTION 'Please describe the issue so we can help.';
  END IF;

  -- Urgency arrives as 1..3; clamp rather than trust the client.
  v_priority := least(greatest(coalesce(p_priority, 2), 1), 3);

  SELECT count(*) INTO v_recent
  FROM public.reported_issues
  WHERE reporter_id = v_uid
    AND created_at > now() - interval '1 hour';

  IF v_recent >= 5 THEN
    RAISE EXCEPTION 'You have already sent 5 support requests in the last hour. Please wait a little before sending another.';
  END IF;

  v_inst := public.get_support_institution_id();
  IF v_inst IS NULL THEN
    RAISE EXCEPTION 'Support is not set up yet. Please contact SALCI directly.';
  END IF;

  v_owner := public.get_support_owner_id();
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'No support owner is configured. Please contact SALCI directly.';
  END IF;

  -- Reporter snapshot. Baked into the task description as TEXT so rendering a
  -- ticket never needs a cross-tenant profiles read (profiles RLS hides the
  -- reporter from the SALCI admin and vice versa).
  SELECT p.full_name, p.email, p.institution_id, i.name
    INTO v_name, v_email, v_rep_inst, v_school
  FROM public.profiles p
  LEFT JOIN public.institutions i ON i.id = p.institution_id
  WHERE p.id = v_uid;

  SELECT string_agg(DISTINCT ur.role::text, ', ')
    INTO v_role
  FROM public.user_roles ur
  WHERE ur.user_id = v_uid;

  SELECT string_agg(DISTINCT btrim(c.name || ' ' || coalesce(c.section, '')), ', ')
    INTO v_classes
  FROM public.class_assignments ca
  JOIN public.classes c ON c.id = ca.class_id
  WHERE ca.user_id = v_uid;

  v_desc := v_body
    || E'\n\n----------------------------------------\n'
    || 'Reported by: ' || coalesce(v_name, 'Unknown')
    || ' (' || coalesce(v_email, 'no email on file') || ')' || E'\n'
    || 'Role: '   || coalesce(v_role, 'unknown') || E'\n'
    || 'School: ' || coalesce(v_school, 'None')  || E'\n'
    || coalesce('Classes: '  || v_classes   || E'\n', '')
    || coalesce('Category: ' || p_category  || E'\n', '')
    || coalesce('Page: '     || p_page_url  || E'\n', '');

  INSERT INTO public.tasks (institution_id, title, description, task_type, status, priority)
  VALUES (
    v_inst,
    left(v_subject, 200),
    v_desc,
    'general'::public.task_type,
    'open'::public.task_status,
    v_priority
  )
  RETURNING id INTO v_task;

  -- Reporter is the assigner, which is what puts the ticket in their
  -- "Assigned BY Me" tab. The RESTRICTIVE policy above is what stops them
  -- acting on it.
  --
  -- Edge case: when the support owner files a ticket themselves, the
  -- no_self_assignment CHECK (assigner_id <> assignee_id) would reject the
  -- row, so fall back to the established NULL-assigner "SALCI System" shape.
  INSERT INTO public.task_assignments (task_id, assignee_id, assigner_id)
  VALUES (v_task, v_owner, CASE WHEN v_uid = v_owner THEN NULL ELSE v_uid END);

  INSERT INTO public.reported_issues (
    reporter_id, reporter_name, reporter_email, reporter_role,
    institution_name, institution_id, classes_assigned,
    subject, description, status, task_id
  ) VALUES (
    v_uid, v_name, v_email, v_role,
    v_school, v_rep_inst, v_classes,
    v_subject, v_body, 'open', v_task
  )
  RETURNING id INTO v_ticket;

  INSERT INTO public.notifications (user_id, type, title, message, link, metadata)
  VALUES (
    v_owner,
    'task_assigned',
    'New support request',
    coalesce(v_name, 'A user')
      || coalesce(' from ' || v_school, '')
      || ': ' || v_subject,
    '/tasks',
    jsonb_build_object('task_id', v_task, 'ticket_id', v_ticket, 'category', p_category)
  );

  RETURN jsonb_build_object('ticket_id', v_ticket, 'task_id', v_task);
END;
$$;

COMMENT ON FUNCTION public.create_support_task(text, text, text, integer, text) IS
  'Salci Support intake. Creates a task in the SALCI Support institution assigned to the configured support owner, with the reporter as assigner. Throttled to 5 per caller per hour.';

-- ---------------------------------------------------------------------------
-- 6. Resolution RPC
--
-- Deliberately skips the done_pending_approval ladder. With the reporter as
-- assigner, `done_pending_approval -> completed` requires the ASSIGNER and
-- raises 'Self-approval is not allowed' for the assignee, which would seat the
-- reporter as approver. Going straight to completed/rejected works because
-- validate_task_state_transition() is a check-list with no rule for
-- (open|in_progress) -> completed or open -> rejected, and no trailing ELSE.
--
-- DEPENDENCY: if that trigger is ever hardened with a final ELSE RAISE, add
-- those pairs to its allow-list or support resolution breaks.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_support_task(
  p_task_id uuid,
  p_outcome text,
  p_note    text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_inst      uuid;
  v_task_inst uuid;
  v_status    public.task_status;
  v_new       public.task_status;
  v_note      text;
BEGIN
  IF v_uid IS NULL OR NOT public.is_super_admin(v_uid) THEN
    RAISE EXCEPTION 'Only SALCI support can resolve a support request.';
  END IF;

  IF p_outcome IS NULL OR p_outcome NOT IN ('completed', 'rejected') THEN
    RAISE EXCEPTION 'Unknown outcome for a support request.';
  END IF;
  v_new := p_outcome::public.task_status;

  v_inst := public.get_support_institution_id();

  SELECT institution_id, status
    INTO v_task_inst, v_status
  FROM public.tasks
  WHERE id = p_task_id;

  IF v_task_inst IS NULL THEN
    RAISE EXCEPTION 'That support request no longer exists.';
  END IF;

  -- Authority check on the unforgeable marker, not on a client-writable flag.
  IF v_inst IS NULL OR v_task_inst <> v_inst THEN
    RAISE EXCEPTION 'That task is not a support request.';
  END IF;

  -- Idempotent: a double-click must not raise 'Completed tasks cannot be modified'.
  IF v_status = 'completed' THEN
    RETURN;
  END IF;

  v_note := nullif(btrim(coalesce(p_note, '')), '');

  IF v_note IS NOT NULL THEN
    INSERT INTO public.task_comments (task_id, user_id, content)
    VALUES (p_task_id, v_uid, v_note);
  END IF;

  UPDATE public.tasks
  SET status = v_new
  WHERE id = p_task_id
    AND status IN ('open', 'in_progress', 'rejected');

  UPDATE public.reported_issues
  SET status = CASE WHEN v_new = 'completed' THEN 'resolved' ELSE 'closed' END,
      admin_notes = coalesce(v_note, admin_notes),
      updated_at = now()
  WHERE task_id = p_task_id;
END;
$$;

COMMENT ON FUNCTION public.resolve_support_task(uuid, text, text) IS
  'Resolve a Salci Support ticket. Super admins only; asserts the task belongs to the SALCI Support institution.';

-- ---------------------------------------------------------------------------
-- 7. Revoke anon BY NAME
--
-- Supabase ALTER DEFAULT PRIVILEGES grants EXECUTE to anon on every new public
-- function, and REVOKE ... FROM PUBLIC does NOT strip it (CLAUDE.md section 11).
-- Verify with:
--   SELECT grantee, privilege_type FROM information_schema.routine_privileges
--   WHERE routine_name IN ('create_support_task','resolve_support_task',
--                          'get_support_owner_id','get_support_institution_id');
--
-- `authenticated` MUST keep EXECUTE on get_support_institution_id(): the
-- RESTRICTIVE policy above calls it as the querying user.
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.create_support_task(text, text, text, integer, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.resolve_support_task(uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_support_owner_id() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_support_institution_id() FROM anon;