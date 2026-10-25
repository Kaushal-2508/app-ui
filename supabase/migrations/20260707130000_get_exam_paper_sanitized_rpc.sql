-- ============================================================================
-- get_exam_paper(_exam_id) — sanitized exam paper for the student attempt UI
--
-- WHY: exam_questions carries the ANSWER KEY in three places:
--   * options jsonb  — MCQ options as [{id, text, is_correct}]
--   * correct_answer — for non-MCQ questions
--   * explanation    — model explanation
-- The attempt flow previously ran exam_sections.select("*, exam_questions(*)")
-- via PostgREST, which delivered ALL of that to the student's browser during
-- a live exam (readable in the network tab). The RLS SELECT policy
-- ("View exam questions" → is_assigned_to_exam_class) row-filters but cannot
-- column-filter, so the key rode along with the paper.
--
-- This RPC returns the paper with key material stripped:
--   * options[].is_correct removed (order preserved)
--   * correct_answer / explanation not selected
-- and collapses the fetch to ONE round trip (§23: server-side shaping).
--
-- ADDITIVE-ONLY: safe to apply while the current frontend is deployed.
-- The companion RLS tightening lives in 20260707131000 and MUST NOT be
-- applied until the frontend that calls this RPC is live.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_exam_paper(_exam_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _paper jsonb;
BEGIN
  IF _uid IS NULL OR NOT (
    public.is_assigned_to_exam_class(_uid, _exam_id)
    OR public.is_exam_creator(_exam_id, _uid)
    OR public.has_super_admin_access(_uid)
  ) THEN
    RAISE EXCEPTION 'You are not authorized to view this exam paper';
  END IF;

  SELECT jsonb_agg(section ORDER BY section_order)
  INTO _paper
  FROM (
    SELECT
      es.section_order,
      jsonb_build_object(
        'id', es.id,
        'exam_id', es.exam_id,
        'title', es.title,
        'description', es.description,
        'instructions', es.instructions,
        'section_order', es.section_order,
        'total_marks', es.total_marks,
        'exam_questions', COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', q.id,
              'section_id', q.section_id,
              'question_type', q.question_type,
              'question_text', q.question_text,
              'question_order', q.question_order,
              'marks', q.marks,
              'negative_marks', q.negative_marks,
              'parent_question_id', q.parent_question_id,
              'image_url', q.image_url,
              'difficulty_level', q.difficulty_level,
              'tags', to_jsonb(q.tags),
              -- WHITELIST each option to {id, text}, preserving array order.
              -- Whitelist, not blacklist: prod data stores the key flag as
              -- camelCase "isCorrect" (the original schema comment claimed
              -- snake_case "is_correct") — subtracting known-bad keys is one
              -- spelling away from leaking. The attempt UI renders only
              -- opt.id and opt.text (verified against prod: those are the
              -- only three keys in 20k sampled options).
              'options', CASE
                WHEN q.options IS NULL THEN NULL
                WHEN jsonb_typeof(q.options) <> 'array' THEN q.options
                ELSE (
                  SELECT COALESCE(
                    jsonb_agg(
                      CASE
                        WHEN jsonb_typeof(o.opt) = 'object'
                          THEN jsonb_build_object('id', o.opt->'id', 'text', o.opt->'text')
                        ELSE o.opt
                      END
                      ORDER BY o.ord
                    ),
                    '[]'::jsonb
                  )
                  FROM jsonb_array_elements(q.options) WITH ORDINALITY AS o(opt, ord)
                )
              END
            )
            ORDER BY q.question_order
          )
          FROM public.exam_questions q
          WHERE q.section_id = es.id
        ), '[]'::jsonb)
      ) AS section
    FROM public.exam_sections es
    WHERE es.exam_id = _exam_id
  ) s;

  RETURN COALESCE(_paper, '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.get_exam_paper(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_exam_paper(uuid) TO authenticated;
