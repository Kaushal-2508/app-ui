-- 20260703120000_lesson_completion_phase1.sql
-- Phase 1 of compulsory-logout lesson capture: per-session completion % on
-- tt_lesson_plans + a teacher-set per-(class,subject,chapter) pacing table.
-- Additive only.

ALTER TABLE public.tt_lesson_plans
  ADD COLUMN IF NOT EXISTS completion_pct NUMERIC(5,2)
    CHECK (completion_pct IS NULL OR (completion_pct >= 0 AND completion_pct <= 100));

CREATE TABLE IF NOT EXISTS public.tt_chapter_pacing (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id   UUID NOT NULL REFERENCES public.institutions(id)       ON DELETE CASCADE,
  class_id         UUID NOT NULL REFERENCES public.classes(id)            ON DELETE CASCADE,
  subject_id       UUID NOT NULL REFERENCES public.universal_subjects(id) ON DELETE CASCADE,
  topic_id         UUID NOT NULL REFERENCES public.syllabus_topics(id)    ON DELETE CASCADE,
  planned_sessions INTEGER NOT NULL CHECK (planned_sessions > 0),
  created_by       UUID REFERENCES public.profiles(id)                    ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tt_chapter_pacing_unique UNIQUE (class_id, subject_id, topic_id)
);

CREATE INDEX IF NOT EXISTS tt_chapter_pacing_inst_idx    ON public.tt_chapter_pacing (institution_id);
CREATE INDEX IF NOT EXISTS tt_chapter_pacing_subject_idx ON public.tt_chapter_pacing (subject_id);
CREATE INDEX IF NOT EXISTS tt_chapter_pacing_topic_idx   ON public.tt_chapter_pacing (topic_id);

ALTER TABLE public.tt_chapter_pacing ENABLE ROW LEVEL SECURITY;

-- Read: any member of the institution (coverage/reporting reads it).
DROP POLICY IF EXISTS "Members read chapter pacing" ON public.tt_chapter_pacing;
CREATE POLICY "Members read chapter pacing" ON public.tt_chapter_pacing
  FOR SELECT TO authenticated
  USING (institution_id = public.get_user_institution(auth.uid()));

-- Write: staff who can edit this class's slots (admins/coord via helper) OR a
-- teacher assigned to teach this class (they set pacing while marking).
DROP POLICY IF EXISTS "Staff write chapter pacing" ON public.tt_chapter_pacing;
CREATE POLICY "Staff write chapter pacing" ON public.tt_chapter_pacing
  FOR ALL TO authenticated
  USING (
    institution_id = public.get_user_institution(auth.uid())
    AND (
      public.tt_user_can_edit_class_slots(auth.uid(), class_id)
      OR EXISTS (
        SELECT 1 FROM public.class_assignments ca
        WHERE ca.user_id = auth.uid() AND ca.role = 'teacher' AND ca.class_id = tt_chapter_pacing.class_id
      )
    )
  )
  WITH CHECK (
    institution_id = public.get_user_institution(auth.uid())
    AND (
      public.tt_user_can_edit_class_slots(auth.uid(), class_id)
      OR EXISTS (
        SELECT 1 FROM public.class_assignments ca
        WHERE ca.user_id = auth.uid() AND ca.role = 'teacher' AND ca.class_id = tt_chapter_pacing.class_id
      )
    )
  );
