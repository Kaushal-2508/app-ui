-- get_question_bank_stats: add p_created_by for the "Your Questions" tab.
--
-- The Question Bank page replaced its Global tab with "Your Questions" (rows
-- the caller created, generated or uploaded). The KPI tiles read this
-- aggregate, which had no author filter, so the tab's tiles would have counted
-- the whole school's pool. p_created_by narrows the scan to one author;
-- NULL (the default) keeps every existing call exactly as it was.
--
-- Changing the argument list needs DROP + CREATE: CREATE OR REPLACE with an
-- extra argument would leave the old 11-argument version beside it, and
-- PostgREST refuses an ambiguous named-argument call (PGRST203). Both run in
-- one transaction, so no caller ever sees the function missing.
--
-- Still SECURITY INVOKER: the question_bank SELECT policy decides which rows
-- are counted, so passing another user's id only counts rows the caller can
-- already read. Served by idx_question_bank_institution_creator_created_at.

BEGIN;

DROP FUNCTION IF EXISTS public.get_question_bank_stats(
  uuid, boolean, uuid, uuid[], uuid, uuid[], text[], boolean, boolean, boolean, text
);

CREATE FUNCTION public.get_question_bank_stats(
  p_institution_id   uuid    DEFAULT NULL,
  p_global_only      boolean DEFAULT false,
  p_subject_id       uuid    DEFAULT NULL,
  p_subject_ids      uuid[]  DEFAULT NULL,
  p_topic_id         uuid    DEFAULT NULL,
  p_class_group_ids  uuid[]  DEFAULT NULL,
  p_question_types   text[]  DEFAULT NULL,
  p_case_study_only  boolean DEFAULT false,
  p_exclude_case_study boolean DEFAULT false,
  p_exclude_sub_questions boolean DEFAULT true,
  p_search           text    DEFAULT NULL,
  p_created_by       uuid    DEFAULT NULL
)
RETURNS TABLE (
  total_questions bigint,
  distinct_types  integer,
  avg_marks       numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH filtered AS (
    SELECT
      qb.marks,
      -- Collapse to the UI's question-type vocabulary so the count matches the
      -- filter dropdown the user sees.
      CASE
        WHEN qb.question_type IN ('matching', 'match_column') THEN 'match_column'
        WHEN qb.question_type = 'long_answer' AND qb.sub_question_count IS NOT NULL THEN 'case_study'
        ELSE qb.question_type::text
      END AS ui_type
    FROM public.question_bank qb
    WHERE
      -- ownership scope
      (
        (p_global_only AND qb.institution_id IS NULL)
        OR (NOT p_global_only AND (p_institution_id IS NULL OR qb.institution_id = p_institution_id))
      )
      -- author ("Your Questions" tab)
      AND (p_created_by IS NULL OR qb.created_by = p_created_by)
      -- subject (single takes precedence over list, matching the hook)
      AND (
        p_subject_id IS NOT NULL AND qb.subject_id = p_subject_id
        OR p_subject_id IS NULL AND (
          p_subject_ids IS NULL OR array_length(p_subject_ids, 1) IS NULL
          OR qb.subject_id = ANY (p_subject_ids)
        )
      )
      AND (p_topic_id IS NULL OR qb.topic_id = p_topic_id)
      AND (
        p_class_group_ids IS NULL OR array_length(p_class_group_ids, 1) IS NULL
        OR qb.class_group_id = ANY (p_class_group_ids)
      )
      AND (NOT p_exclude_sub_questions OR qb.parent_question_id IS NULL)
      -- question-type filter (collapsed list from the chip)
      AND (
        p_question_types IS NULL OR array_length(p_question_types, 1) IS NULL
        OR qb.question_type::text = ANY (p_question_types)
      )
      -- case-study variants
      AND (NOT p_case_study_only OR (qb.question_type = 'long_answer' AND qb.sub_question_count IS NOT NULL))
      AND (NOT p_exclude_case_study OR qb.sub_question_count IS NULL)
      -- text search
      AND (p_search IS NULL OR qb.question_text ILIKE '%' || p_search || '%')
  )
  SELECT
    COUNT(*)::bigint                              AS total_questions,
    COUNT(DISTINCT ui_type)::integer              AS distinct_types,
    COALESCE(ROUND(AVG(marks), 1), 0)::numeric    AS avg_marks
  FROM filtered;
$$;

REVOKE ALL ON FUNCTION public.get_question_bank_stats(
  uuid, boolean, uuid, uuid[], uuid, uuid[], text[], boolean, boolean, boolean, text, uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_question_bank_stats(
  uuid, boolean, uuid, uuid[], uuid, uuid[], text[], boolean, boolean, boolean, text, uuid
) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_question_bank_stats(
  uuid, boolean, uuid, uuid[], uuid, uuid[], text[], boolean, boolean, boolean, text, uuid
) TO authenticated;

COMMENT ON FUNCTION public.get_question_bank_stats IS
  'Filter-aware bank-wide aggregate (total / distinct UI types / avg marks) for the Question Bank KPI tiles. SECURITY INVOKER, respects question_bank RLS. Mirrors useQuestionBank() filters, incl. p_created_by for the Your Questions tab.';

COMMIT;

NOTIFY pgrst, 'reload schema';
