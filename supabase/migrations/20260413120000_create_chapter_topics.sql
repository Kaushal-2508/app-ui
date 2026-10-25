-- =============================================
-- chapter_topics — fine-grained topics within a syllabus chapter
-- Used by AI question generation and question bank filtering.
-- Does NOT affect the Syllabus tab or analytics (those stay chapter-level).
-- =============================================

CREATE TABLE IF NOT EXISTS public.chapter_topics (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id  UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  class_id        UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  subject_id      UUID NOT NULL REFERENCES public.universal_subjects(id) ON DELETE CASCADE,
  chapter_id      UUID NOT NULL REFERENCES public.syllabus_topics(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chapter_topics_unique
    UNIQUE (institution_id, class_id, subject_id, chapter_id, name)
);

-- -----------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------
ALTER TABLE public.chapter_topics ENABLE ROW LEVEL SECURITY;

-- Super admins: full access
CREATE POLICY "Super admins have full access to chapter_topics"
  ON public.chapter_topics FOR ALL
  USING (public.has_role(auth.uid(), 'super_admin'));

-- Institution members can read their institution's topics
CREATE POLICY "Institution members can read chapter_topics"
  ON public.chapter_topics FOR SELECT
  USING (
    institution_id = public.get_user_institution(auth.uid())
  );

-- Teachers, coordinators, and school admins can insert
CREATE POLICY "Teachers can insert chapter_topics"
  ON public.chapter_topics FOR INSERT
  WITH CHECK (
    institution_id = public.get_user_institution(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
        AND role IN ('teacher', 'coordinator', 'school_admin', 'super_school_admin')
    )
  );

-- Teachers, coordinators, and school admins can update their institution's topics
CREATE POLICY "Staff can update chapter_topics"
  ON public.chapter_topics FOR UPDATE
  USING (
    institution_id = public.get_user_institution(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
        AND role IN ('teacher', 'coordinator', 'school_admin', 'super_school_admin')
    )
  );

-- School admins can delete
CREATE POLICY "School admins can delete chapter_topics"
  ON public.chapter_topics FOR DELETE
  USING (
    institution_id = public.get_user_institution(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
        AND role IN ('school_admin', 'super_school_admin')
    )
  );

-- -----------------------------------------------------------------
-- Indexes
-- -----------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_chapter_topics_institution
  ON public.chapter_topics(institution_id);

CREATE INDEX IF NOT EXISTS idx_chapter_topics_chapter
  ON public.chapter_topics(chapter_id);

-- Composite index for the primary lookup pattern:
-- "give me all topics for this institution + class + subject + chapter"
CREATE INDEX IF NOT EXISTS idx_chapter_topics_lookup
  ON public.chapter_topics(institution_id, class_id, subject_id, chapter_id);
