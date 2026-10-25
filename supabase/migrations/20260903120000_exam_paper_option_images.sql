-- Per-option diagrams never reached the student.
--
-- get_exam_paper whitelists every option down to {id, text} so the answer key
-- (options[].isCorrect) can never ship to a student's browser mid-exam. That
-- whitelist is the right design and stays a whitelist. But it also silently
-- dropped `imageUrl` once options gained per-option diagrams, so a question
-- like "Which is the similar image?" rendered four bare letters with nothing
-- to choose between. The teacher's upload was stored correctly all along;
-- the server was removing it on the way out.
--
-- imageUrl is option CONTENT, not key material: it is the thing the student
-- has to look at in order to answer. Adding it to the whitelist is the whole
-- fix. isCorrect and explanation remain excluded.

CREATE OR REPLACE FUNCTION public.get_exam_paper(_exam_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
              -- WHITELIST each option, preserving array order.
              -- Whitelist, not blacklist: prod data stores the key flag as
              -- camelCase "isCorrect" (the original schema comment claimed
              -- snake_case "is_correct"), so subtracting known-bad keys is one
              -- spelling away from leaking the answer.
              -- Permitted keys are exactly what the student must SEE:
              --   id       - the value the radio submits
              --   text     - the option label
              --   imageUrl - the option's own diagram (added 2026-09-03; an
              --              image-choice MCQ is unanswerable without it)
              -- Anything else on the option (isCorrect, explanation, future
              -- authoring metadata) is dropped by construction.
              'options', CASE
                WHEN q.options IS NULL THEN NULL
                WHEN jsonb_typeof(q.options) <> 'array' THEN q.options
                ELSE (
                  SELECT COALESCE(
                    jsonb_agg(
                      CASE
                        WHEN jsonb_typeof(o.opt) = 'object'
                          THEN jsonb_strip_nulls(
                                 jsonb_build_object(
                                   'id',       o.opt->'id',
                                   'text',     o.opt->'text',
                                   'imageUrl', o.opt->'imageUrl'
                                 )
                               )
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
$function$;

-- CREATE OR REPLACE does not reset grants, but assert the anon exclusion
-- anyway: Supabase's ALTER DEFAULT PRIVILEGES grants EXECUTE to anon on every
-- new public function, and REVOKE FROM PUBLIC does not strip it (CLAUDE.md 11).
REVOKE ALL ON FUNCTION public.get_exam_paper(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_exam_paper(uuid) TO authenticated;
