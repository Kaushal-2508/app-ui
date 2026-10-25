-- =============================================================
-- PHASE 3 — Chapter topics, syllabus, question bank with scope
-- -------------------------------------------------------------
-- Class-group container was added in Phase 1 (20260422120000). In
-- Phase 3 we push the container identifier down into the tables
-- that power syllabus coverage, question bank reads, and AI
-- generation — while introducing per-section visibility for the
-- question bank so teachers can pick one of three scopes at upload
-- time:
--   * "This section only"          → one scope row
--   * "Multiple sections I teach"  → ≥1 scope row
--   * "Class repository (shared)"  → zero scope rows (class-wide)
--
-- This migration is ADDITIVE. New columns are nullable; legacy
-- rows retain today's behavior (institution-wide visibility for
-- approved questions) until the frontend opts them into scope.
-- Rollback: drop the new columns and table.
-- =============================================================

-- -------------------------------------------------------------
-- 1. chapter_topics.class_group_id — fine-grained topic grouping
--    at class-container level. Backfilled from the section's
--    class_group_id so existing rows stay reachable.
-- -------------------------------------------------------------
ALTER TABLE public.chapter_topics
  ADD COLUMN IF NOT EXISTS class_group_id UUID
    REFERENCES public.class_groups(id) ON DELETE SET NULL;

UPDATE public.chapter_topics ct
SET class_group_id = c.class_group_id
FROM public.classes c
WHERE c.id = ct.class_id
  AND ct.class_group_id IS NULL
  AND c.class_group_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_chapter_topics_class_group
  ON public.chapter_topics(class_group_id);

CREATE INDEX IF NOT EXISTS idx_chapter_topics_group_lookup
  ON public.chapter_topics(institution_id, class_group_id, subject_id, chapter_id);

-- -------------------------------------------------------------
-- 2. topic_class_mappings.class_group_id — drives chapter
--    selection for the exam-creation flow and syllabus coverage.
-- -------------------------------------------------------------
ALTER TABLE public.topic_class_mappings
  ADD COLUMN IF NOT EXISTS class_group_id UUID
    REFERENCES public.class_groups(id) ON DELETE SET NULL;

UPDATE public.topic_class_mappings tcm
SET class_group_id = c.class_group_id
FROM public.classes c
WHERE c.id = tcm.class_id
  AND tcm.class_group_id IS NULL
  AND c.class_group_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_topic_class_mappings_class_group
  ON public.topic_class_mappings(class_group_id);

-- -------------------------------------------------------------
-- 3. question_bank.class_group_id — carries the container ref
--    that scope filtering keys off. No historical class column
--    exists on question_bank, so nothing to backfill; legacy
--    rows stay NULL and fall through to the existing RLS.
-- -------------------------------------------------------------
ALTER TABLE public.question_bank
  ADD COLUMN IF NOT EXISTS class_group_id UUID
    REFERENCES public.class_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_question_bank_class_group
  ON public.question_bank(class_group_id);

-- -------------------------------------------------------------
-- 4. question_bank_section_scope — per-section visibility rows
--    Zero rows → class-wide (every teacher of the class_group sees it)
--    ≥1 row   → section-scoped (only teachers of those sections see it)
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.question_bank_section_scope (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID NOT NULL REFERENCES public.question_bank(id) ON DELETE CASCADE,
  class_id    UUID NOT NULL REFERENCES public.classes(id)       ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT question_bank_section_scope_uniq UNIQUE (question_id, class_id)
);

CREATE INDEX IF NOT EXISTS idx_qbss_question ON public.question_bank_section_scope(question_id);
CREATE INDEX IF NOT EXISTS idx_qbss_class    ON public.question_bank_section_scope(class_id);

ALTER TABLE public.question_bank_section_scope ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super admins manage question scope rows"  ON public.question_bank_section_scope;
DROP POLICY IF EXISTS "Institution members read scope rows"       ON public.question_bank_section_scope;
DROP POLICY IF EXISTS "Staff manage scope rows for own institution" ON public.question_bank_section_scope;

CREATE POLICY "Super admins manage question scope rows"
  ON public.question_bank_section_scope FOR ALL
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

-- Institution members (incl. students — never reach here through
-- the app, but RLS shouldn't leak cross-tenant) may read scope rows
-- for questions whose institution matches their own.
CREATE POLICY "Institution members read scope rows"
  ON public.question_bank_section_scope FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.question_bank q
      WHERE q.id = question_bank_section_scope.question_id
        AND q.institution_id = public.get_user_institution(auth.uid())
    )
  );

-- Teachers / coordinators / school admins may insert/update/delete
-- scope rows for questions owned by their institution.
CREATE POLICY "Staff manage scope rows for own institution"
  ON public.question_bank_section_scope FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.question_bank q
      WHERE q.id = question_bank_section_scope.question_id
        AND q.institution_id = public.get_user_institution(auth.uid())
        AND (
          public.has_role(auth.uid(), 'teacher')
          OR public.has_role(auth.uid(), 'coordinator')
          OR public.has_role(auth.uid(), 'school_admin')
          OR public.has_role(auth.uid(), 'super_school_admin')
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.question_bank q
      WHERE q.id = question_bank_section_scope.question_id
        AND q.institution_id = public.get_user_institution(auth.uid())
        AND (
          public.has_role(auth.uid(), 'teacher')
          OR public.has_role(auth.uid(), 'coordinator')
          OR public.has_role(auth.uid(), 'school_admin')
          OR public.has_role(auth.uid(), 'super_school_admin')
        )
    )
  );

-- -------------------------------------------------------------
-- 5. question_bank SELECT RLS update — scope-aware gate.
--    Replaces the old "any approved question in my institution"
--    policy with one that respects class_group_id + scope rows.
--    Legacy rows (class_group_id IS NULL) keep today's behavior
--    so exam flows that haven't opted into scope yet don't break.
--
--    Note: the existing "Teachers can manage their own questions"
--    policy stays in place — creators always see their uploads.
-- -------------------------------------------------------------
DROP POLICY IF EXISTS "Teachers can view approved questions in their institution"
  ON public.question_bank;

CREATE POLICY "Staff view approved questions scoped to their assignments"
  ON public.question_bank FOR SELECT
  USING (
    is_approved = TRUE
    AND institution_id = public.get_user_institution(auth.uid())
    AND (
      -- Admins/coordinators see the full institution pool (coordinators
      -- get natural narrowing via wing-aware UIs; RLS stays lenient here
      -- to match period_structures / class_groups pattern).
      public.has_role(auth.uid(), 'school_admin')
      OR public.has_role(auth.uid(), 'super_school_admin')
      OR public.has_role(auth.uid(), 'coordinator')

      -- Students see approved class-wide questions for their enrolled
      -- class_group. Section-scoped rows stay hidden from students.
      OR (
        public.has_role(auth.uid(), 'student')
        AND class_group_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.question_bank_section_scope
          WHERE question_id = question_bank.id
        )
        AND EXISTS (
          SELECT 1 FROM public.class_assignments ca
          JOIN public.classes c ON c.id = ca.class_id
          WHERE ca.user_id = auth.uid()
            AND ca.role = 'student'
            AND c.class_group_id = question_bank.class_group_id
        )
      )

      -- Teachers: legacy rows (no class_group_id) stay visible
      -- institution-wide, matching pre-refactor behavior.
      OR (
        public.has_role(auth.uid(), 'teacher')
        AND class_group_id IS NULL
      )

      -- Teachers: scoped rows visible iff the teacher has a class_assignment
      -- in the relevant class_group AND either the question is class-wide
      -- (no scope rows) or the teacher is assigned to one of the scoped
      -- sections.
      OR (
        public.has_role(auth.uid(), 'teacher')
        AND class_group_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.class_assignments ca
          JOIN public.classes c ON c.id = ca.class_id
          WHERE ca.user_id = auth.uid()
            AND ca.role = 'teacher'
            AND c.class_group_id = question_bank.class_group_id
        )
        AND (
          NOT EXISTS (
            SELECT 1 FROM public.question_bank_section_scope
            WHERE question_id = question_bank.id
          )
          OR EXISTS (
            SELECT 1
            FROM public.question_bank_section_scope s
            JOIN public.class_assignments ca ON ca.class_id = s.class_id
            WHERE s.question_id = question_bank.id
              AND ca.user_id = auth.uid()
              AND ca.role = 'teacher'
          )
        )
      )
    )
  );

-- -------------------------------------------------------------
-- 6. RPC — atomic question + scope insert. Keeps frontend code
--    simple: one call writes the question row and (optionally)
--    its scope rows inside a single transaction.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.insert_question_with_scope(
  _q              JSONB,
  _scope_class_ids UUID[]
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_question_id UUID;
  v_class_id    UUID;
BEGIN
  -- Insert the question row from the supplied JSON payload. We list
  -- columns explicitly so extra keys in `_q` are ignored (defensive).
  INSERT INTO public.question_bank (
    institution_id,
    class_group_id,
    subject_id,
    topic_id,
    chapter_topic_id,
    grade_level_id,
    question_text,
    question_type,
    options,
    correct_answer,
    explanation,
    marks,
    difficulty_level,
    tags,
    is_approved,
    created_by,
    source,
    parent_question_id,
    sub_question_count,
    sequence_order
  )
  VALUES (
    NULLIF(_q->>'institution_id','')::uuid,
    NULLIF(_q->>'class_group_id','')::uuid,
    NULLIF(_q->>'subject_id','')::uuid,
    NULLIF(_q->>'topic_id','')::uuid,
    NULLIF(_q->>'chapter_topic_id','')::uuid,
    NULLIF(_q->>'grade_level_id','')::uuid,
    _q->>'question_text',
    (_q->>'question_type')::public.question_type,
    CASE WHEN _q ? 'options'         THEN _q->'options'         ELSE NULL END,
    _q->>'correct_answer',
    _q->>'explanation',
    COALESCE((_q->>'marks')::integer, 1),
    COALESCE((_q->>'difficulty_level')::integer, 3),
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(_q->'tags')), ARRAY[]::text[]),
    COALESCE((_q->>'is_approved')::boolean, TRUE),
    COALESCE(NULLIF(_q->>'created_by','')::uuid, auth.uid()),
    COALESCE(_q->>'source', 'manual'),
    NULLIF(_q->>'parent_question_id','')::uuid,
    NULLIF(_q->>'sub_question_count','')::integer,
    NULLIF(_q->>'sequence_order','')::integer
  )
  RETURNING id INTO v_question_id;

  -- Insert scope rows (deduped). Zero rows means class-wide.
  IF _scope_class_ids IS NOT NULL AND array_length(_scope_class_ids, 1) > 0 THEN
    FOREACH v_class_id IN ARRAY _scope_class_ids LOOP
      INSERT INTO public.question_bank_section_scope (question_id, class_id)
      VALUES (v_question_id, v_class_id)
      ON CONFLICT (question_id, class_id) DO NOTHING;
    END LOOP;
  END IF;

  RETURN v_question_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.insert_question_with_scope(JSONB, UUID[]) TO authenticated;

COMMENT ON COLUMN public.question_bank.class_group_id IS
  'Container reference. Legacy rows stay NULL and fall through to institution-wide visibility; new rows set it and combine with question_bank_section_scope for per-section gating.';

COMMENT ON TABLE public.question_bank_section_scope IS
  'Per-question section visibility. Zero rows for a question = class-wide; ≥1 row = only teachers assigned to listed sections can see it.';

COMMENT ON FUNCTION public.insert_question_with_scope(JSONB, UUID[]) IS
  'Inserts a question_bank row from JSON payload and optionally adds question_bank_section_scope rows atomically. Returns the new question id.';
