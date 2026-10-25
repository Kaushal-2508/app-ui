-- =============================================================================
-- Optional Subject Classification (main / optional) — additive, display-only.
--
-- Adds a per-assignment "classification" to student_optional_enrollments and
-- surfaces it on the Subjects-tab read RPC. Purely additive and zero data loss:
-- existing rows backfill to 'optional' via the column default.
--
-- Scope guardrails (do NOT cross):
--   * Compulsory subjects are untouched — they have no rows in this table.
--   * classification is DISPLAY-ONLY. It is never read by any visibility,
--     filtering, count, results, report-card, or eligibility path. The only
--     places that read it are the Subjects tab and the student badge.
--   * No existing column is altered; no existing pattern changes beyond adding
--     this one field and reading it.
-- =============================================================================

-- 1. Additive column. NOT NULL + DEFAULT 'optional' backfills every existing
--    row to 'optional' (zero data loss). CHECK limits values to main/optional.
ALTER TABLE public.student_optional_enrollments
  ADD COLUMN IF NOT EXISTS classification text NOT NULL DEFAULT 'optional';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'soe_classification_check'
  ) THEN
    ALTER TABLE public.student_optional_enrollments
      ADD CONSTRAINT soe_classification_check
      CHECK (classification IN ('main', 'optional'));
  END IF;
END $$;

COMMENT ON COLUMN public.student_optional_enrollments.classification IS
  'Display-only label for an assigned optional subject: main or optional (default optional). Never feeds visibility, counts, results, or any downstream computation.';

-- 2. Surface classification on the Subjects-tab read RPC. This is the "reading
--    it" step: one additive field per optional_offered entry. The offered-list
--    logic (core-wins, permission gate, compulsory block) is byte-for-byte the
--    same as migration 20260617110000; only the extra field is new.
CREATE OR REPLACE FUNCTION public.get_student_subject_assignment(_student uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.can_view_student_subjects(auth.uid(), _student) THEN
    RAISE EXCEPTION 'Not authorized to view this student''s subjects' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'can_manage', public.can_manage_student_subjects(auth.uid(), _student),
    'compulsory', COALESCE((
      SELECT jsonb_agg(DISTINCT jsonb_build_object('subject_id', us.id, 'name', us.name))
      FROM public.class_assignments ca
      JOIN public.subject_class_mappings scm
        ON scm.class_id = ca.class_id AND scm.is_optional = false
      JOIN public.universal_subjects us ON us.id = scm.subject_id
      WHERE ca.user_id = _student AND ca.role = 'student'
    ), '[]'::jsonb),
    'optional_offered', COALESCE((
      SELECT jsonb_agg(DISTINCT jsonb_build_object(
        'subject_id',     us.id,
        'name',           us.name,
        'enrolled',       (soe.id IS NOT NULL AND soe.is_active),
        'enrollment_id',  soe.id,
        'classification', COALESCE(soe.classification, 'optional')
      ))
      FROM public.class_assignments ca
      JOIN public.subject_class_mappings scm
        ON scm.class_id = ca.class_id AND scm.is_optional = true
      JOIN public.universal_subjects us ON us.id = scm.subject_id
      LEFT JOIN public.student_optional_enrollments soe
        ON soe.student_id = _student AND soe.subject_id = scm.subject_id
      WHERE ca.user_id = _student AND ca.role = 'student'
        -- "core wins": don't offer a subject that is compulsory in any of the student's sections
        AND NOT EXISTS (
          SELECT 1 FROM public.class_assignments ca2
          JOIN public.subject_class_mappings scm2
            ON scm2.class_id = ca2.class_id
           AND scm2.subject_id = scm.subject_id
           AND scm2.is_optional = false
          WHERE ca2.user_id = _student AND ca2.role = 'student'
        )
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_student_subject_assignment(uuid) TO authenticated;
