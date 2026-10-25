-- Atomic, audited subject delete + class-unassign.
--
-- Companion to 20260807120000 (set_staff_class_assignments). Same incident
-- class: three client flows (AssignTeacherClassSubjectDialog delete/bulk-delete,
-- InstitutionSubjectsTab full delete, useRemoveSubjectFromClass) deleted the
-- subject's mappings and every teacher assignment referencing it as SEPARATE,
-- unscoped, non-transactional requests, and only then deleted the subject —
-- which can still fail on homework_assignments/optional_batches (RESTRICT),
-- student_remarks/subjects (NO ACTION) or the locked-exam trigger. A failure
-- there left the subject alive but unassigned school-wide with every teacher
-- link destroyed, and the dialog path wrote no audit row at all.
--
-- Both functions below do the whole thing in ONE transaction, verify the
-- delete actually happened, translate every blocker into a user-readable
-- message BEFORE touching anything, and log the delta to system_audit_logs.

-- ---------------------------------------------------------------------------
-- 1. Hard-delete an institution-owned subject.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_institution_subject(
  _subject_id uuid,
  _class_name text DEFAULT NULL   -- context for the audit row only
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_institution uuid;
  v_name text;
  v_blocked int;
  v_titles text;
  v_assignments_removed int := 0;
  v_deleted int := 0;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT us.institution_id, us.name INTO v_institution, v_name
  FROM universal_subjects us WHERE us.id = _subject_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That subject no longer exists.';
  END IF;
  IF v_institution IS NULL THEN
    -- Global subjects are shared by every school on the platform.
    RAISE EXCEPTION 'This is a global subject shared across schools, so it cannot be deleted. Remove it from the class instead.';
  END IF;

  IF NOT (
    has_role(v_caller, 'super_admin'::app_role)
    OR has_role_at_institution(v_caller, 'school_admin'::app_role, v_institution)
    OR has_role_at_institution(v_caller, 'super_school_admin'::app_role, v_institution)
    OR (has_role(v_caller, 'coordinator'::app_role) AND get_user_institution(v_caller) = v_institution)
    OR ((is_staff_manager(v_caller) OR is_syllabus_manager(v_caller))
        AND get_user_institution(v_caller) = v_institution)
  ) THEN
    RAISE EXCEPTION 'You do not have permission to delete this subject.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('subject_delete:' || _subject_id::text, 0));

  -- Blockers first: every one of these would abort the DELETE below, and we
  -- want the reason named rather than a raw FK/trigger error.
  SELECT count(*) INTO v_blocked FROM homework_assignments WHERE subject_id = _subject_id;
  IF v_blocked > 0 THEN
    RAISE EXCEPTION 'Can''t delete "%". It is used by % homework assignment(s). Remove those first.', v_name, v_blocked;
  END IF;

  SELECT count(*) INTO v_blocked FROM optional_batches WHERE subject_id = _subject_id;
  IF v_blocked > 0 THEN
    RAISE EXCEPTION 'Can''t delete "%". It is used by % optional batch(es). Remove those first.', v_name, v_blocked;
  END IF;

  SELECT count(*) INTO v_blocked FROM student_remarks WHERE subject_id = _subject_id;
  IF v_blocked > 0 THEN
    RAISE EXCEPTION 'Can''t delete "%". Teachers have recorded % student remark(s) against it.', v_name, v_blocked;
  END IF;

  SELECT count(*) INTO v_blocked FROM subjects WHERE universal_subject_id = _subject_id;
  IF v_blocked > 0 THEN
    RAISE EXCEPTION 'Can''t delete "%". It is still linked to a legacy subject record.', v_name;
  END IF;

  SELECT string_agg(DISTINCT '"' || e.title || '"', ', ') INTO v_titles
  FROM exam_subjects es
  JOIN exams e ON e.id = es.exam_id
  WHERE es.subject_id = _subject_id AND e.is_locked_for_edits IS TRUE;
  IF v_titles IS NOT NULL THEN
    RAISE EXCEPTION 'Can''t delete "%". It is used in the exam %, which already has student attempts recorded. Delete or unlock that exam first.', v_name, v_titles;
  END IF;

  -- class_assignments.subject_id is ON DELETE SET NULL, so a bare cascade would
  -- leave orphan subject-less teacher rows behind. Remove them explicitly, in
  -- the same transaction as the delete that justifies it.
  WITH del AS (
    DELETE FROM class_assignments ca
    WHERE ca.subject_id = _subject_id
      AND get_class_institution(ca.class_id) = v_institution
    RETURNING 1
  )
  SELECT count(*)::int INTO v_assignments_removed FROM del;

  DELETE FROM universal_subjects WHERE id = _subject_id AND institution_id = v_institution;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted = 0 THEN
    RAISE EXCEPTION 'The subject could not be deleted. Please refresh and try again.';
  END IF;

  PERFORM log_audit_event(
    'subject_deleted', 'Subject', _subject_id, v_name,
    jsonb_build_object('class', _class_name, 'teacher_assignments_removed', v_assignments_removed),
    NULL,
    jsonb_build_object('institution_id', v_institution::text, 'via', 'delete_institution_subject')
  );

  RETURN jsonb_build_object(
    'subject_id', _subject_id,
    'subject_name', v_name,
    'assignments_removed', v_assignments_removed
  );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_institution_subject(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_institution_subject(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_institution_subject(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Unassign a subject from a class (group-wide), keeping the subject row.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.unassign_subject_from_class(
  _subject_id uuid,
  _class_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_institution uuid;
  v_group uuid;
  v_name text;
  v_class_name text;
  v_sections uuid[];
  v_assignments_removed int := 0;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT c.class_group_id, get_class_institution(c.id), trim(c.name || ' ' || COALESCE(c.section, ''))
  INTO v_group, v_institution, v_class_name
  FROM classes c WHERE c.id = _class_id;

  IF v_institution IS NULL THEN
    RAISE EXCEPTION 'That class no longer exists.';
  END IF;

  SELECT us.name INTO v_name FROM universal_subjects us WHERE us.id = _subject_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That subject no longer exists.';
  END IF;

  IF NOT (
    has_role(v_caller, 'super_admin'::app_role)
    OR has_role_at_institution(v_caller, 'school_admin'::app_role, v_institution)
    OR has_role_at_institution(v_caller, 'super_school_admin'::app_role, v_institution)
    OR (has_role(v_caller, 'coordinator'::app_role) AND get_user_institution(v_caller) = v_institution)
    OR ((is_staff_manager(v_caller) OR is_syllabus_manager(v_caller))
        AND get_user_institution(v_caller) = v_institution)
  ) THEN
    RAISE EXCEPTION 'You do not have permission to change this class''s subjects.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('subject_unassign:' || _subject_id::text || ':' || _class_id::text, 0));

  -- Every section of the class group (§22); the lone section when ungrouped.
  IF v_group IS NOT NULL THEN
    SELECT array_agg(c.id) INTO v_sections FROM classes c WHERE c.class_group_id = v_group;
  END IF;
  IF v_sections IS NULL OR array_length(v_sections, 1) IS NULL THEN
    v_sections := ARRAY[_class_id];
  END IF;

  -- Canonical group-level unassign; the trigger fans the delete out to
  -- subject_class_mappings, then we clear any residual legacy section rows.
  IF v_group IS NOT NULL THEN
    DELETE FROM subject_class_group_mappings
    WHERE class_group_id = v_group AND subject_id = _subject_id;
  END IF;

  DELETE FROM subject_class_mappings
  WHERE subject_id = _subject_id AND class_id = ANY(v_sections);

  -- Teacher links must go too: an assignment whose subject is no longer mapped
  -- to the class blanks out that teacher's portal (the "global-subject
  -- blackout" failure) while looking assigned in the admin UI.
  WITH del AS (
    DELETE FROM class_assignments ca
    WHERE ca.subject_id = _subject_id AND ca.class_id = ANY(v_sections)
    RETURNING 1
  )
  SELECT count(*)::int INTO v_assignments_removed FROM del;

  PERFORM log_audit_event(
    'subject_removed_from_class', 'Subject', _subject_id, v_name,
    jsonb_build_object('class', v_class_name, 'teacher_assignments_removed', v_assignments_removed),
    NULL,
    jsonb_build_object('institution_id', v_institution::text, 'via', 'unassign_subject_from_class')
  );

  RETURN jsonb_build_object(
    'subject_id', _subject_id,
    'subject_name', v_name,
    'sections_affected', COALESCE(array_length(v_sections, 1), 0),
    'assignments_removed', v_assignments_removed
  );
END;
$$;

REVOKE ALL ON FUNCTION public.unassign_subject_from_class(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.unassign_subject_from_class(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.unassign_subject_from_class(uuid, uuid) TO authenticated;
