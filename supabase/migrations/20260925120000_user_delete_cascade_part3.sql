-- =============================================================
-- Fix user-delete cascade chain, part 3: guard triggers + attempt children
-- -------------------------------------------------------------
-- 2026-09-25: deleting a teacher (Saganpreet Kaur, Alliance) failed with
-- "Database error deleting user". A rolled-back dry run on prod gave the
-- real error:
--
--   P0001 Cannot modify data for finalized exam attempt
--   PL/pgSQL function prevent_finalized_changes()
--   UPDATE ONLY "public"."teacher_overrides" SET "evaluated_by" = NULL ...
--
-- WHY THIS KEPT COMING BACK. The two earlier sweeps (20260427120000 for
-- FKs on profiles, 20260911120000 for FKs on auth.users) only looked at
-- the ON DELETE rule of FKs that point DIRECTLY at the user. A delete
-- cascades much further than that, and two other things can abort it:
--
--   (a) a guard trigger. ON DELETE SET NULL is executed as an UPDATE, so
--       every BEFORE UPDATE guard on the child table runs against it.
--       teacher_overrides.evaluated_by is correctly SET NULL (authorship,
--       CLAUDE.md §21), but prevent_override_changes_after_finalize
--       (20260104115902) rejects every UPDATE on a finalized attempt.
--   (b) an FK one or more hops down. student -> student_exam_attempts is
--       CASCADE, and ocr_extractions.attempt_id -> student_exam_attempts
--       is RESTRICT, so a student whose paper went through the OCR scanner
--       cannot be deleted.
--
-- Found by a rolled-back sweep of EVERY account on prod (2026-09-25): 47
-- of 276 staff blocked by (a), 3 students blocked by (b). The cascade
-- graph from auth.users was then walked in the catalog to find the latent
-- cases the current data does not hit yet. The repeatable check is
-- scripts/probe-user-deletes.sql; run it after any migration that adds a
-- table, an FK or a guard trigger.
--
-- WHAT THIS MIGRATION DOES
--
-- 1. is_user_delete_cascade_update(rel, old, new): the ONE definition of
--    "this UPDATE is a user-delete cascade, not an edit". True only when
--      * every column that is NOT a SET NULL FK to profiles / auth.users
--        is unchanged,
--      * each such FK column is unchanged or set to NULL,
--      * at least one was set to NULL, and the user it pointed at no
--        longer exists in profiles or auth.users.
--    The FK column must reference an existing user before the delete, so
--    the last condition can only hold during that user's own deletion. A
--    live user clearing evaluated_by by hand is still rejected. FK columns
--    are read from pg_constraint, so a SET NULL user column added to a
--    guarded table later is covered without another migration.
--    VOLATILE (default) on purpose: it must see the parent row the cascade
--    just deleted, so it needs a fresh snapshot.
--
-- 2. prevent_finalized_changes(): lets that one kind of UPDATE through.
--    Marks, feedback, answers: all still frozen. DELETE behaviour is
--    unchanged; a student delete removes the attempt before its answers,
--    so the finalized lookup finds nothing.
--
-- 3. guard_support_task_mutations(): same exemption on the UPDATE branch.
--    A delete runs with no JWT, auth.uid() is NULL, is_super_admin(NULL)
--    is false, so any user who ever cancelled a support-institution task
--    (tasks.cancelled_by, SET NULL) was undeletable. 0 such rows today,
--    and only super admins can cancel them, so this bit a departing SALCI
--    staffer first.
--
-- 4. ocr_extractions.attempt_id: RESTRICT -> CASCADE. One row per
--    (attempt, question), meaningless without the attempt (its review rows
--    already cascade from it).
--    ocr_uploads.attempt_id: NO ACTION -> SET NULL. The scanned file
--    belongs to the exam + class and survives; it just loses its student
--    match. Both columns are already indexed.
--
-- Deliberately NOT changed (verified safe for user deletes 2026-09-25):
--   * support_settings.owner_id RESTRICT (20260911120000): the support
--     owner must be handed over first. team@salci.in is blocked by it,
--     correctly.
--   * student_performance_snapshots.attempt_id and
--     teacher_overrides.ai_evaluation_id (NO ACTION). Both child rows are
--     also deleted through a sibling CASCADE path (student_id / answer_id)
--     in the same statement, and NO ACTION is only checked at the end of
--     the statement, so neither can block. Changing them would also change
--     the exam-delete path, which is out of scope here.
--   * cal_events overlap guard: fires on every UPDATE, but 0 overlapping
--     exam blocks exist and the guard stops new ones, so a SET NULL of
--     created_by can never trip it.
--   * the other BEFORE UPDATE guards the cascade reaches (exams, homework,
--     oly_campaigns, attempts, task status, universal_subjects,
--     attendance) only fire on status/content columns or skip a NULL
--     auth.uid(), so a SET NULL passes them.
--
-- Rollback: re-create prevent_finalized_changes from 20260104115902 and
-- guard_support_task_mutations from 20260814130000, drop the helper, and
-- re-add the two FKs as RESTRICT / NO ACTION.
-- =============================================================

SET LOCAL lock_timeout = '5s';

-- 1. The shared predicate ----------------------------------------------

CREATE OR REPLACE FUNCTION public.is_user_delete_cascade_update(
  _rel regclass,
  _old jsonb,
  _new jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_cols text[];
  v_col text;
  v_ref uuid;
  v_nulled boolean := false;
BEGIN
  SELECT array_agg(a.attname::text) INTO v_user_cols
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
  WHERE c.contype = 'f'
    AND c.conrelid = _rel
    AND c.confdeltype = 'n'
    AND c.confrelid IN ('public.profiles'::regclass, 'auth.users'::regclass);

  IF v_user_cols IS NULL THEN
    RETURN false;
  END IF;

  -- Nothing but the user columns may change.
  IF (_old - v_user_cols) IS DISTINCT FROM (_new - v_user_cols) THEN
    RETURN false;
  END IF;

  FOREACH v_col IN ARRAY v_user_cols LOOP
    CONTINUE WHEN (_new -> v_col) IS NOT DISTINCT FROM (_old -> v_col);

    IF jsonb_typeof(_new -> v_col) IS DISTINCT FROM 'null' THEN
      RETURN false;
    END IF;

    v_ref := (_old ->> v_col)::uuid;
    IF EXISTS (SELECT 1 FROM public.profiles WHERE id = v_ref)
       OR EXISTS (SELECT 1 FROM auth.users WHERE id = v_ref) THEN
      RETURN false;
    END IF;

    v_nulled := true;
  END LOOP;

  RETURN v_nulled;
END;
$$;

COMMENT ON FUNCTION public.is_user_delete_cascade_update(regclass, jsonb, jsonb) IS
  'True only for an UPDATE whose sole change is ON DELETE SET NULL of user FK columns whose user no longer exists, i.e. a user-delete cascade. Guard triggers call it before raising. See 20260925120000.';

-- Only the DEFINER guard triggers (owner postgres) call this. Not an RPC.
REVOKE EXECUTE ON FUNCTION public.is_user_delete_cascade_update(regclass, jsonb, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_user_delete_cascade_update(regclass, jsonb, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_user_delete_cascade_update(regclass, jsonb, jsonb) FROM authenticated;

-- 2. Finalized-attempt guard ---------------------------------------------

CREATE OR REPLACE FUNCTION public.prevent_finalized_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempt_id UUID;
  v_is_finalized BOOLEAN;
BEGIN
  -- Get attempt_id based on table
  IF TG_TABLE_NAME = 'student_answers' THEN
    v_attempt_id := COALESCE(NEW.attempt_id, OLD.attempt_id);
  ELSIF TG_TABLE_NAME = 'teacher_overrides' THEN
    v_attempt_id := public.get_answer_attempt_id(COALESCE(NEW.answer_id, OLD.answer_id));
  ELSIF TG_TABLE_NAME = 'ai_evaluations' THEN
    v_attempt_id := public.get_answer_attempt_id(COALESCE(NEW.answer_id, OLD.answer_id));
  END IF;

  -- Check if finalized
  SELECT is_finalized INTO v_is_finalized
  FROM public.student_exam_attempts WHERE id = v_attempt_id;

  IF v_is_finalized = true THEN
    -- A deleted grader's SET NULL is not an edit (20260925120000).
    IF TG_OP = 'UPDATE'
       AND public.is_user_delete_cascade_update(TG_RELID, to_jsonb(OLD), to_jsonb(NEW)) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Cannot modify data for finalized exam attempt';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

-- 3. Support-task guard (body from 20260814130000 plus the exemption) ----

CREATE OR REPLACE FUNCTION public.guard_support_task_mutations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- AND short-circuits, so is_super_admin() is only evaluated for the
    -- handful of rows that live in the support institution.
    IF OLD.institution_id = public.get_support_institution_id()
       AND NOT public.is_super_admin(auth.uid()) THEN
      RAISE EXCEPTION 'Only SALCI support can remove a support request.';
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE. Catches cancel_task (which writes cancelled_at) and any future
  -- DEFINER path that would otherwise sidestep the RESTRICTIVE policy.
  IF NEW.institution_id = public.get_support_institution_id()
     AND NOT public.is_super_admin(auth.uid()) THEN
    -- Deleting the user in cancelled_by runs with no JWT; its SET NULL is
    -- not a change to the request (20260925120000).
    IF public.is_user_delete_cascade_update(TG_RELID, to_jsonb(OLD), to_jsonb(NEW)) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Only SALCI support can change a support request.';
  END IF;

  RETURN NEW;
END;
$$;

-- 4. Attempt children that blocked the student cascade --------------------

ALTER TABLE public.ocr_extractions
  DROP CONSTRAINT IF EXISTS ocr_extractions_attempt_id_fkey,
  ADD CONSTRAINT ocr_extractions_attempt_id_fkey
    FOREIGN KEY (attempt_id) REFERENCES public.student_exam_attempts(id) ON DELETE CASCADE;

ALTER TABLE public.ocr_uploads
  DROP CONSTRAINT IF EXISTS ocr_uploads_attempt_id_fkey,
  ADD CONSTRAINT ocr_uploads_attempt_id_fkey
    FOREIGN KEY (attempt_id) REFERENCES public.student_exam_attempts(id) ON DELETE SET NULL;

-- Both already indexed (idx_ocr_extractions_attempt_id, idx_ocr_uploads_attempt_id);
-- kept here so the migration stands alone on a fresh database.
CREATE INDEX IF NOT EXISTS idx_ocr_extractions_attempt_id ON public.ocr_extractions (attempt_id);
CREATE INDEX IF NOT EXISTS idx_ocr_uploads_attempt_id ON public.ocr_uploads (attempt_id);
