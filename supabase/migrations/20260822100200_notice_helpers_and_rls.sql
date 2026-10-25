-- Notice Board phase 3: SECURITY DEFINER helpers + the policy set that finally
-- enforces scope.
--
-- The policy this replaces was:
--   USING (public.get_user_institution(auth.uid()) = institution_id)
-- which ignored scope entirely, so every class- and wing-targeted circular was
-- readable by every user in the school, students included. Reproduced live in
-- scripts/notice-board/verify-03b-rls-live.sql: before this migration an
-- unaddressed same-school student reads a class-scoped notice.
--
-- Helpers are SECURITY DEFINER so the policies never inline a cross-table
-- EXISTS (the 2026-04-26 recursion incident), and every auth.uid() is wrapped
-- as (SELECT auth.uid()) so Postgres evaluates it once per statement instead of
-- once per row (section 23.13).
BEGIN;

CREATE OR REPLACE FUNCTION public.notice_is_recipient(_notice_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.notice_recipients r
     WHERE r.notice_id = _notice_id AND r.user_id = _user_id
  );
$$;

-- Oversight is downward only. A coordinator oversees a notice whose target
-- classes or wings intersect their wing_assignments; they do NOT oversee an
-- institution-scope notice from the principal (it has no targets to intersect),
-- so they receive it in their inbox but get no reach report for it.
CREATE OR REPLACE FUNCTION public.notice_can_oversee(_notice_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.notices n
     WHERE n.id = _notice_id
       AND (
            n.published_by = _user_id
         OR public.is_institution_admin(_user_id, n.institution_id)
         OR EXISTS (
              SELECT 1 FROM public.notice_target_classes tc
                JOIN public.wing_class_mappings wcm ON wcm.class_id = tc.class_id
                JOIN public.wing_assignments   wa   ON wa.wing_id   = wcm.wing_id
               WHERE tc.notice_id = n.id AND wa.user_id = _user_id
            )
         OR EXISTS (
              SELECT 1 FROM public.notice_target_wings tw
                JOIN public.wing_assignments wa ON wa.wing_id = tw.wing_id
               WHERE tw.notice_id = n.id AND wa.user_id = _user_id
            )
       )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_view_notice(_notice_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _notice_id IS NOT NULL
     AND (public.notice_is_recipient(_notice_id, _user_id)
       OR public.notice_can_oversee(_notice_id, _user_id));
$$;

CREATE OR REPLACE FUNCTION public.can_publish_notices(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  -- has_role(x,'school_admin') already covers super_school_admin
  SELECT public.has_role(_user_id, 'school_admin')
      OR public.has_role(_user_id, 'coordinator')
      OR public.has_role(_user_id, 'teacher');
$$;

-- Storage paths are {notice_id}/{file}. A malformed first segment must deny,
-- not raise -- a raising cast inside a policy 500s the whole storage request.
-- Not SECURITY DEFINER: it is pure string parsing and touches no table.
CREATE OR REPLACE FUNCTION public.notice_id_from_path(_name text)
RETURNS uuid LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE _seg text;
BEGIN
  _seg := split_part(coalesce(_name, ''), '/', 1);
  RETURN _seg::uuid;
EXCEPTION WHEN others THEN
  RETURN NULL;
END $$;

REVOKE EXECUTE ON FUNCTION public.notice_is_recipient(uuid, uuid)  FROM anon;
REVOKE EXECUTE ON FUNCTION public.notice_can_oversee(uuid, uuid)   FROM anon;
REVOKE EXECUTE ON FUNCTION public.can_view_notice(uuid, uuid)      FROM anon;
REVOKE EXECUTE ON FUNCTION public.can_publish_notices(uuid)        FROM anon;
REVOKE EXECUTE ON FUNCTION public.notice_id_from_path(text)        FROM anon;

GRANT EXECUTE ON FUNCTION public.notice_is_recipient(uuid, uuid)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.notice_can_oversee(uuid, uuid)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_notice(uuid, uuid)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_publish_notices(uuid)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.notice_id_from_path(text)         TO authenticated;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS circ_select ON public.notices;
DROP POLICY IF EXISTS circ_insert ON public.notices;
DROP POLICY IF EXISTS circ_update ON public.notices;
DROP POLICY IF EXISTS circ_delete ON public.notices;

CREATE POLICY notices_select ON public.notices FOR SELECT TO authenticated
  USING (public.can_view_notice(id, (SELECT auth.uid())));

-- No INSERT policy at all: publishing goes through publish_notice() only, so a
-- client cannot create a notice without its recipient fan-out.

-- Title / content / priority / expiry are editable. The audience is immutable
-- after publish -- recipients are materialised, so changing it would mean
-- re-running fan-out and reconciling reads already recorded. Wrong audience
-- means delete and re-issue.
CREATE POLICY notices_update ON public.notices FOR UPDATE TO authenticated
  USING (published_by = (SELECT auth.uid())
      OR public.is_institution_admin((SELECT auth.uid()), institution_id))
  WITH CHECK (published_by = (SELECT auth.uid())
      OR public.is_institution_admin((SELECT auth.uid()), institution_id));

CREATE POLICY notices_delete ON public.notices FOR DELETE TO authenticated
  USING (public.is_institution_admin((SELECT auth.uid()), institution_id));

-- Recipients read their own row; overseers read the whole roster. No UPDATE
-- policy: mark_notice_read() is the only write path, so nobody can stamp an
-- acknowledgement they did not make or edit their own recipient_role.
CREATE POLICY notice_recipients_select ON public.notice_recipients FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid())
      OR public.notice_can_oversee(notice_id, (SELECT auth.uid())));

CREATE POLICY notice_target_classes_select ON public.notice_target_classes FOR SELECT TO authenticated
  USING (public.can_view_notice(notice_id, (SELECT auth.uid())));

CREATE POLICY notice_target_wings_select ON public.notice_target_wings FOR SELECT TO authenticated
  USING (public.can_view_notice(notice_id, (SELECT auth.uid())));

COMMIT;
