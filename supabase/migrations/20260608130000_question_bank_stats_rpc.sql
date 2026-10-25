-- =============================================================================
-- get_question_bank_stats — server-side aggregate for the Question Bank KPI tiles
-- =============================================================================
-- The Question Bank page computed "Question Types" and "Average Marks" from the
-- 50-row page slice currently on screen (QuestionBankPage.tsx:454), so the tiles
-- showed page-local values — e.g. "Question Types: 4" when the bank actually
-- holds 8 distinct types. CLAUDE.md §23.1 says aggregate server-side, never pull
-- rows and reduce on the client. This RPC returns bank-wide (filter-aware)
-- counts in one round trip.
--
-- Filter parameters mirror useQuestionBank() exactly so the tiles respond to the
-- same grade/subject/topic/type/search filters as the list and the Total tile.
--
-- SECURITY INVOKER + the question_bank SELECT RLS policy means a caller only
-- aggregates rows they can already see (admins: full institution pool; teachers:
-- their class-scoped pool; etc.). No SECURITY DEFINER — there is no cross-table
-- recursion here, just a single-table scan, so the §23.1 / §22 helper rule that
-- governs RLS *policies* does not apply to this read-only aggregate function.
--
-- "distinct_types" is counted in the SAME collapsed vocabulary the UI filter
-- dropdown uses, so the tile matches what a user can actually pick:
--   * legacy `matching` and `match_column` collapse to ONE type ("Match Column")
--   * a long_answer row WITH sub_question_count is "Case Study", a bare
--     long_answer is "Long Answer" — counted as two distinct types when both
--     shapes are present.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_question_bank_stats(
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
  p_search           text    DEFAULT NULL
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

GRANT EXECUTE ON FUNCTION public.get_question_bank_stats(
  uuid, boolean, uuid, uuid[], uuid, uuid[], text[], boolean, boolean, boolean, text
) TO authenticated;

COMMENT ON FUNCTION public.get_question_bank_stats IS
  'Filter-aware bank-wide aggregate (total / distinct UI types / avg marks) for the Question Bank KPI tiles. SECURITY INVOKER — respects question_bank RLS. Mirrors useQuestionBank() filters.';
