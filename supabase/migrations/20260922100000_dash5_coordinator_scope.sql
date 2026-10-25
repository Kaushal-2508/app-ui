-- Coordinator Console, phase 1: let a coordinator reach the v5 data plane.
--
-- Reference: public/report_reference/salci-coordinator-dashboard2.html
--
-- THE BLOCKER THIS REMOVES. Every dash5_* function opens with
--   v_inst := public.dash_resolve_institution(p_institution_id);
-- and that helper RAISES for anything but super_admin / school_admin /
-- super_school_admin. So the whole v5 surface - 33 functions, every chart and
-- every table on /school/command-center - is not merely empty for a
-- coordinator, it errors. None of it could be reused until this lands.
--
-- THE SHAPE OF THE FIX. A coordinator's scope is a WING, and a wing is an
-- attribute of the CALLER, not of the request. So nothing here adds a
-- parameter: each function asks dash5_caller_wing() who is calling and clamps
-- itself. That keeps all 33 signatures, every PostgREST call site and every
-- generated type exactly as they are, and it makes the leak impossible to
-- reintroduce from the client, because there is no argument to forge.
--   admin       -> dash5_caller_wing() returns NULL -> behaviour unchanged.
--   coordinator -> returns their wing -> every row is clamped to it.
--
-- FAIL CLOSED, ALWAYS. A coordinator with no wing assignment RAISES rather
-- than falling through to a NULL wing, because NULL means "the whole school"
-- one line later. That exact confusion shipped on 2026-09-18: a coordinator
-- scope guarded by `classIds.length > 0` showed 5 of 24 prod coordinators the
-- entire institution. The PRESENCE of a scope is the signal, never its size.
--
-- WHAT STAYS ADMIN-ONLY, deliberately, by keeping the old resolver:
--   dash5_coordinators      - ranks every wing's coordinator against the others
--   dash5_school_wide_needs - items that belong to no wing
--   dash5_attendance_by_wing- the cross-wing comparison
--   dash5_report_*          - the whole-school PDF
-- A coordinator calling one of these still gets "not authorized", which is the
-- correct answer, not an oversight.
--
-- Plain ASCII: prod SQL goes through PowerShell, which mangles anything else.

/* ------------------------------------------------------------- helpers ---- */

-- dash_resolve_institution with coordinators added, and NOTHING else changed.
-- A separate function rather than widening the original, because that one is
-- the gate for ~100 admin-only dash_* RPCs; widening it would hand a
-- coordinator the school-wide KPI set in the same stroke.
CREATE OR REPLACE FUNCTION public.dash5_resolve_institution(p_institution_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_inst uuid; v_is_super boolean;
BEGIN
  v_is_super := EXISTS (
    SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'super_admin');
  v_inst := COALESCE(p_institution_id, public.get_user_institution(auth.uid()));
  IF v_inst IS NULL THEN
    RAISE EXCEPTION 'dashboard: no institution context for this user';
  END IF;
  IF v_is_super THEN RETURN v_inst; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM user_roles
     WHERE user_id = auth.uid() AND institution_id = v_inst
       AND role IN ('school_admin','super_school_admin','coordinator')
  ) THEN
    RAISE EXCEPTION 'dashboard: not authorized for this institution';
  END IF;
  RETURN v_inst;
END
$function$;

-- The wing the caller is confined to. NULL is returned ONLY for an admin and
-- means "no confinement"; it is never a coordinator's answer.
--
-- Every coordinator in production holds exactly one wing (verified across all
-- 24 of them, 2026-09-22), and the reference console is written for exactly
-- one. Someone holding two gets the first by display order and the console
-- says so out loud from dash5_coord_scope(); silently merging two wings into
-- figures labelled "your wing" would be worse than naming the limit.
CREATE OR REPLACE FUNCTION public.dash5_caller_wing(p_inst uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_wing uuid;
BEGIN
  IF EXISTS (
    SELECT 1 FROM user_roles ur
     WHERE ur.user_id = auth.uid()
       AND (ur.role = 'super_admin'
            OR (ur.institution_id = p_inst
                AND ur.role IN ('school_admin','super_school_admin')))
  ) THEN
    RETURN NULL;
  END IF;

  SELECT w.id INTO v_wing
    FROM wing_assignments wa
    JOIN wings w ON w.id = wa.wing_id
                AND w.institution_id = p_inst
                AND w.is_active IS NOT FALSE
   WHERE wa.user_id = auth.uid()
   ORDER BY w.display_order NULLS LAST, w.name, w.id
   LIMIT 1;

  IF v_wing IS NULL THEN
    RAISE EXCEPTION 'dashboard: you are not assigned to a wing, so there is nothing to show';
  END IF;
  RETURN v_wing;
END
$function$;

-- Clamp a requested wing to the caller's. An admin keeps whatever they asked
-- for, including NULL for "all wings".
CREATE OR REPLACE FUNCTION public.dash5_scope_wing(p_inst uuid, p_wing_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_locked uuid;
BEGIN
  v_locked := public.dash5_caller_wing(p_inst);
  IF v_locked IS NULL THEN RETURN p_wing_id; END IF;
  IF p_wing_id IS NOT NULL AND p_wing_id <> v_locked THEN
    RAISE EXCEPTION 'dashboard: that wing is outside your scope';
  END IF;
  RETURN v_locked;
END
$function$;

-- Clamp a requested class. p_required is for the functions whose whole subject
-- IS one class (a paper's detail, a subject's roster): there, a NULL class from
-- a coordinator would widen the query to the institution rather than narrow it,
-- so it is refused instead.
CREATE OR REPLACE FUNCTION public.dash5_scope_class(
  p_inst uuid, p_class_id uuid, p_required boolean DEFAULT false
) RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_locked uuid;
BEGIN
  v_locked := public.dash5_caller_wing(p_inst);
  IF v_locked IS NULL THEN RETURN p_class_id; END IF;
  IF p_class_id IS NULL THEN
    IF p_required THEN
      RAISE EXCEPTION 'dashboard: that view needs a class inside your wing';
    END IF;
    RETURN NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM wing_class_mappings m
     WHERE m.class_id = p_class_id AND m.wing_id = v_locked
  ) THEN
    RAISE EXCEPTION 'dashboard: that class is outside your wing';
  END IF;
  RETURN p_class_id;
END
$function$;

-- Clamp a requested student: they must sit in a class mapped to the wing.
CREATE OR REPLACE FUNCTION public.dash5_scope_student(p_inst uuid, p_student_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_locked uuid;
BEGIN
  v_locked := public.dash5_caller_wing(p_inst);
  IF v_locked IS NULL OR p_student_id IS NULL THEN RETURN p_student_id; END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM class_assignments ca
      JOIN wing_class_mappings m ON m.class_id = ca.class_id AND m.wing_id = v_locked
     WHERE ca.user_id = p_student_id AND ca.role::text = 'student'
  ) THEN
    RAISE EXCEPTION 'dashboard: that student is outside your wing';
  END IF;
  RETURN p_student_id;
END
$function$;

-- PUBLIC as well as anon, and in that order. Supabase's default privileges
-- grant EXECUTE to PUBLIC on every new function, and anon inherits it: revoking
-- anon alone leaves the function callable by anon through PUBLIC, which is the
-- exact trap CLAUDE.md 26 records in the other direction. Neither revoke
-- subsumes the other, so both are written by name.
--
-- Nothing leaks through these even unrevoked (each one resolves auth.uid() and
-- raises for a caller with no role), but an unauthenticated caller has no
-- business reaching them at all.
REVOKE EXECUTE ON FUNCTION public.dash5_resolve_institution(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.dash5_caller_wing(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.dash5_scope_wing(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.dash5_scope_class(uuid, uuid, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.dash5_scope_student(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dash5_resolve_institution(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dash5_caller_wing(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dash5_scope_wing(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dash5_scope_class(uuid, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dash5_scope_student(uuid, uuid) TO authenticated;

/* ------------------------------------------------- the mechanical pass ---- */

-- Seventeen functions differ from each other only in which axis they carry, and
-- all seventeen open with the identical resolver line (verified against prod
-- before writing this). Hand-editing seventeen bodies to insert two lines each
-- is how one of them gets missed, and a missed one is a silent cross-wing leak
-- rather than an error. So the edit is done once, from pg_get_functiondef, and
-- it RAISES if any function does not carry the line it expects.
DO $do$
DECLARE
  r record;
  src text;
  ins text;
  -- Clamped on their wing argument, and on their class argument where they
  -- have one. Both, because at subject level dash5_tree filters by class and
  -- ignores the wing entirely: clamping only the wing would still hand over
  -- another wing's class if its id were passed.
  wing_fns text[] := ARRAY[
    'dash5_assign_context','dash5_band_classes','dash5_band_donut','dash5_chronic_absentees',
    'dash5_exam_papers','dash5_exam_pipeline','dash5_never_signed_in','dash5_score_distribution',
    'dash5_student_tree','dash5_students_at_risk','dash5_teacher_activity','dash5_tree',
    'dash5_tree_targets'];
  -- No wing argument; the class IS the request, so it is required.
  class_fns text[] := ARRAY[
    'dash5_paper_detail','dash5_student_subjects','dash5_subject_chapters','dash5_subject_roster'];
  n int := 0;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname,
           pg_get_functiondef(p.oid) AS def,
           pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p
      JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND (p.proname = ANY(wing_fns) OR p.proname = ANY(class_fns))
     ORDER BY p.proname
  LOOP
    src := r.def;
    IF position('v_inst := public.dash_resolve_institution(p_institution_id);' IN src) = 0 THEN
      RAISE EXCEPTION 'dash5 scope: % does not open with the expected resolver line', r.proname;
    END IF;

    ins := 'v_inst := public.dash5_resolve_institution(p_institution_id);';
    IF r.args LIKE '%p_wing_id uuid%' THEN
      ins := ins || E'\n  p_wing_id := public.dash5_scope_wing(v_inst, p_wing_id);';
    END IF;
    IF r.args LIKE '%p_class_id uuid%' THEN
      ins := ins || E'\n  p_class_id := public.dash5_scope_class(v_inst, p_class_id, '
                 || CASE WHEN r.proname = ANY(class_fns) THEN 'true' ELSE 'false' END || ');';
    END IF;

    src := replace(src,
      'v_inst := public.dash_resolve_institution(p_institution_id);', ins);
    EXECUTE src;
    n := n + 1;
  END LOOP;

  IF n <> 17 THEN
    RAISE EXCEPTION 'dash5 scope: expected 17 functions, rewrote %', n;
  END IF;
  RAISE NOTICE 'dash5 scope: rewrote % functions', n;
END
$do$;

-- dash5_student_context carries neither a wing nor a class, only the student.
DO $do$
DECLARE src text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'dash5_student_context';
  IF src IS NULL OR position('v_inst := public.dash_resolve_institution(p_institution_id);' IN src) = 0 THEN
    RAISE EXCEPTION 'dash5 scope: dash5_student_context is not in the expected shape';
  END IF;
  EXECUTE replace(src,
    'v_inst := public.dash_resolve_institution(p_institution_id);',
    'v_inst := public.dash5_resolve_institution(p_institution_id);' || E'\n' ||
    '  p_student_id := public.dash5_scope_student(v_inst, p_student_id);');
END
$do$;
