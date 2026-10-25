-- Teacher Targets: resolve a wing to the teachers who actually teach in it.
-- RENAMED from 20260916120000 on the day it was written: feat/admin-dashboard-v5
-- independently claimed that slot with 20260916120000_dash5_performance_tree.sql.
-- Different filenames so git never conflicted, but the two sorted identically and
-- both were already applied to prod, which is the ambiguity you do not want when
-- the branches meet. APPLIED TO PROD under the old name: re-running this file is a
-- harmless no-op (CREATE OR REPLACE plus guarded grants), not a pending change.
--
--
-- THE BUG THIS FIXES. SplitPoolSheet and CreateTargetSheet sourced their
-- candidate list from useWingMembers, which reads wing_assignments. That table
-- is the wing-to-PERSON edge and in practice holds only the coordinators
-- promoted through PromoteToCoordinatorDialog, so a coordinator opening "share
-- out this pool" saw a list containing nobody but themselves. Worse, RLS on
-- wing_assignments grants a coordinator SELECT only on their OWN row
-- (20260105153748), so even a correctly populated table would have returned a
-- list of one.
--
-- WHY THIS IS AN RPC. The real membership is the CLASS path:
--   wings -> wing_class_mappings -> classes -> class_assignments(role='teacher')
-- which is the same definition WingsPage, dash_scoped_wing_standing and
-- coordinator_covers_task already use. A coordinator cannot read that chain
-- unaided, so it has to come from SECURITY DEFINER. Do NOT reintroduce a
-- client-side join here.
--
-- classes.is_active IS NOT FALSE is load bearing. wing_class_mappings is never
-- pruned: the academic-year rollover mirrors every (wing, class) pair forward
-- without deleting the old one, so at Alliance 113 mapped classes stand against
-- 53 active ones. Without this filter a pool would be shared out to teachers of
-- dead sections.

CREATE OR REPLACE FUNCTION public.tgt_wing_teachers(_wing_id uuid)
RETURNS TABLE (id uuid, full_name text, email text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_actor uuid := auth.uid();
  v_inst  uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'targets: not authenticated';
  END IF;

  SELECT w.institution_id INTO v_inst FROM public.wings w WHERE w.id = _wing_id;

  -- One message for "no such wing" and "not yours", so this cannot be used to
  -- probe which wing ids exist in other schools.
  IF v_inst IS NULL
     OR NOT (
       public.tgt_can_manage(v_actor, v_inst)
       OR EXISTS (SELECT 1 FROM public.wing_assignments wa
                   WHERE wa.wing_id = _wing_id AND wa.user_id = v_actor)
     )
  THEN
    RAISE EXCEPTION 'targets: that wing does not exist, or you cannot see it';
  END IF;

  RETURN QUERY
  SELECT DISTINCT p.id, p.full_name, p.email
  FROM public.wing_class_mappings m
  JOIN public.classes c
    ON c.id = m.class_id
   AND COALESCE(c.is_active, true)
   AND c.institution_id = v_inst
  JOIN public.class_assignments ca
    ON ca.class_id = c.id
   AND ca.role = 'teacher'
  JOIN public.profiles p
    ON p.id = ca.user_id
   AND p.institution_id = v_inst
   AND p.is_active IS NOT FALSE          -- leaving is a deactivation, not a delete
  WHERE m.wing_id = _wing_id
    AND public.tgt_eligible(p.id, v_inst)  -- teacher or coordinator role
  ORDER BY p.full_name;
END $fn$;

COMMENT ON FUNCTION public.tgt_wing_teachers(uuid) IS
  'The teachers of a wing, resolved through wing_class_mappings -> active classes -> class_assignments(role=teacher), filtered to active eligible profiles. Callable by an administrator of the wing''s institution or by anyone assigned to the wing. Never source a wing''s teachers from wing_assignments: that table holds the wing''s coordinators, and its RLS shows a coordinator only their own row.';

REVOKE ALL ON FUNCTION public.tgt_wing_teachers(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tgt_wing_teachers(uuid) TO authenticated;
