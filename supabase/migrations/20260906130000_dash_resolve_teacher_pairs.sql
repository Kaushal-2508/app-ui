-- The teacher dashboard scope, with no role ladder.
--
-- Every dash_teacher_* RPC derives its entire scope from
-- dash_resolve_scoped_pairs(), which is an IF/ELSIF ladder that checks admin
-- FIRST and whose admin branch returns (class_id, NULL). Downstream predicates
-- read that NULL subject as a wildcard, e.g. in dash_teacher_kpi_summary:
--
--   EXISTS (SELECT 1 FROM unnest(v_pc, v_ps) AS pr(cid, sid)
--           WHERE pr.cid = a.class_id AND (pr.sid IS NULL OR pr.sid = es.subject_id))
--
-- So a user holding BOTH school_admin and teacher would get every class in the
-- institution, every subject, on a page whose own footer promises "only your
-- own assigned classes". That is wrong regardless of the admin+teacher feature:
-- a function named dash_teacher_* must never return institution-wide rows.
--
-- dash_resolve_scoped_pairs and dash_resolve_scoped_classes keep their ladder
-- untouched: the admin Command Center and the coordinator snapshot depend on it.

CREATE OR REPLACE FUNCTION public.dash_resolve_teacher_pairs()
RETURNS TABLE(class_id uuid, subject_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_inst uuid;
BEGIN
  -- Fail CLOSED. The 2026-08-26 roster bug was a guard that fell through on a
  -- NULL auth.uid() because `NULL <> _teacher` is NULL and `IF NULL` skips the
  -- block, so this branch is explicit.
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  v_inst := public.get_user_institution(v_uid);
  IF v_inst IS NULL THEN
    RAISE EXCEPTION 'dashboard: no institution context';
  END IF;

  RETURN QUERY
  SELECT DISTINCT ca.class_id, ca.subject_id
  FROM public.class_assignments ca
  JOIN public.classes c ON c.id = ca.class_id
  WHERE ca.user_id = v_uid
    AND ca.role = 'teacher'
    AND c.institution_id = v_inst
    AND COALESCE(c.is_active, true);
END;
$$;

REVOKE ALL ON FUNCTION public.dash_resolve_teacher_pairs() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dash_resolve_teacher_pairs() FROM anon;
GRANT EXECUTE ON FUNCTION public.dash_resolve_teacher_pairs() TO authenticated;

-- NEXT STEP, applied as a separate generated migration:
-- every dash_teacher_* function must be re-created with the single line
--   FROM public.dash_resolve_scoped_pairs() p
-- changed to
--   FROM public.dash_resolve_teacher_pairs() p
-- and nothing else. The bodies are generated from prod rather than hand-copied
-- from the repo, because the migration ledger is not maintained (CLAUDE.md §26)
-- and several of these functions were re-issued by later migrations:
--
--   SELECT pg_get_functiondef(p.oid)
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.proname LIKE 'dash_teacher_%'
--   ORDER BY p.proname;
--
-- Verify afterwards that none is left on the ladder:
--
--   SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.proname LIKE 'dash_teacher_%'
--     AND p.prosrc LIKE '%dash_resolve_scoped_pairs%';
--   -- expected: zero rows
