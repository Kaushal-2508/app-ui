-- =============================================================
-- Optional-subject eligibility: the exam PAPER and the HYBRID plane
-- -------------------------------------------------------------
-- Reported by a live school (2026-09-03): a French teacher's published exams
-- were visible to pupils who do not take French, and the marks screen listed
-- the whole class. Root cause was split between the client (several rosters
-- read class_assignments with no eligibility filter - fixed in the same commit)
-- and the two server-side holes closed here.
--
-- Established before writing this: the predicates themselves are CORRECT.
-- exam_marking_eligible_students returned 13 of 104 / 37 of 81 / 9 of 91 on the
-- real exams, and student_eligible_exams.subject_visible resolves per pupil.
-- Nothing below changes how eligibility is COMPUTED; it only makes two paths
-- that never asked, ask.
--
-- 1. get_exam_paper gated on class membership alone, so a classmate who does
--    not take the subject could pull the entire sanitised question paper by
--    calling the RPC directly, even though the exam list correctly hid it.
-- 2. The hybrid exam plane had NO enrollment guard of any kind: no client
--    check, an INSERT policy of just (student_id = auth.uid()), and none of the
--    three triggers on hybrid_exam_attempts was the P3 attempt guard. The
--    online plane has had that guard since 20260617120000; hybrid never got it.
--
-- The dormancy rule (20260825150000) is untouched: a section that has recorded
-- no optional choices still resolves to the whole class, so this cannot black
-- out a school that has not entered its choices.
-- =============================================================

-- -------------------------------------------------------------
-- 1. get_exam_paper - body identical to the live definition
--    except the authorisation gate.
-- -------------------------------------------------------------
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
  -- Staff first, then the student branch WITH optional-subject eligibility.
  -- is_assigned_to_exam_class matches ANY class_assignments row (any role), so
  -- on its own it handed the full question paper to every classmate of an
  -- optional-subject exam - the student exam LIST already hid that exam, but a
  -- direct RPC call still returned the paper. exam_visible_to_student is a
  -- no-op for staff (their blocked set is empty, they hold no student rows)
  -- and for compulsory exams, and it honours the dormancy fallback.
  IF _uid IS NULL OR NOT (
    public.is_exam_creator(_exam_id, _uid)
    OR public.has_super_admin_access(_uid)
    OR (
      public.is_assigned_to_exam_class(_uid, _exam_id)
      AND public.exam_visible_to_student(_exam_id, _uid)
    )
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

REVOKE ALL ON FUNCTION public.get_exam_paper(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_exam_paper(uuid) TO authenticated;

-- -------------------------------------------------------------
-- 2. Hybrid attempts get the same attempt-start guard the online
--    plane has had since P3. enforce_exam_subject_enrollment()
--    reads NEW.exam_id / NEW.student_id, both present here.
-- -------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_enforce_exam_subject_enrollment ON public.hybrid_exam_attempts;
CREATE TRIGGER trg_enforce_exam_subject_enrollment
  BEFORE INSERT ON public.hybrid_exam_attempts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_exam_subject_enrollment();

-- -------------------------------------------------------------
-- 3. Hybrid INSERT policy: own row AND actually in one of the
--    exam's classes AND eligible for its subject. The previous
--    policy checked only that the row was the caller's own, so any
--    student could open an attempt on any exam id in any school.
-- -------------------------------------------------------------
DROP POLICY IF EXISTS "Students insert own hybrid_exam_attempts" ON public.hybrid_exam_attempts;
CREATE POLICY "Students insert own hybrid_exam_attempts"
  ON public.hybrid_exam_attempts FOR INSERT TO authenticated
  WITH CHECK (
    student_id = (select auth.uid())
    AND public.is_assigned_to_exam_class((select auth.uid()), exam_id)
    AND public.exam_visible_to_student(exam_id, (select auth.uid()))
  );

-- -------------------------------------------------------------
-- 4. Grant hygiene. exam_marking_eligible_students still carries
--    EXECUTE for anon from Supabase's default privileges (REVOKE
--    FROM PUBLIC does not strip it) and it returns pupil ids.
-- -------------------------------------------------------------
REVOKE ALL ON FUNCTION public.exam_marking_eligible_students(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.exam_marking_eligible_students(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.exam_marking_eligible_students(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.exam_visible_to_student(uuid, uuid) FROM anon;
