-- =====================================================================
-- Manager delete for homework of ANY status.
--
-- The hw_assignments RLS DELETE policy only allows deleting drafts
-- (status='draft'), so a published/checked assignment cannot be removed via a
-- direct PostgREST delete (and an RLS-blocked DELETE looks like success, per
-- CLAUDE.md section 6). This SECURITY DEFINER RPC gates on can_manage_homework
-- and deletes the row; every child table FKs to homework_assignments with
-- ON DELETE CASCADE (classes, subjects, submissions, submission_files,
-- results, mark_audit, notifications_sent), so the cascade removes all related
-- rows in one statement. Returns the deleted id (NULL if already gone).
--
-- NOTE: submitted files in the homework-files storage bucket are NOT FKed and
-- are left orphaned (owner-only bucket; physical cleanup would need a
-- service-role pass). Harmless private-bucket disk only; tracked as follow-up.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.homework_delete(_homework_id uuid)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_deleted uuid;
BEGIN
  IF NOT public.can_manage_homework(auth.uid(), _homework_id) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  DELETE FROM public.homework_assignments
  WHERE id = _homework_id
  RETURNING id INTO v_deleted;

  RETURN v_deleted;
END;
$fn$;
REVOKE ALL ON FUNCTION public.homework_delete(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.homework_delete(uuid) TO authenticated;
