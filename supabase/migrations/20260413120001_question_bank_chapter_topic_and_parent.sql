-- =============================================
-- question_bank — add chapter_topic_id and parent-child columns
--
-- chapter_topic_id: optional FK to the new chapter_topics table.
--   Questions without it are chapter-level only.
--   NOTE: the existing topic_id column (→ syllabus_topics) is the *chapter*
--   reference. This new column is the finer-grained *topic-within-chapter*.
--
-- parent_question_id, sub_question_count, sequence_order:
--   Support comprehension / case-study parent-child relationships in the
--   question bank — a passage row (parent) owns N sub-question rows.
-- =============================================

-- 1. Fine-grained topic within a chapter (nullable)
ALTER TABLE public.question_bank
  ADD COLUMN IF NOT EXISTS chapter_topic_id UUID
    REFERENCES public.chapter_topics(id) ON DELETE SET NULL;

-- 2. Self-referencing FK for comprehension/case-study parent questions
ALTER TABLE public.question_bank
  ADD COLUMN IF NOT EXISTS parent_question_id UUID
    REFERENCES public.question_bank(id) ON DELETE CASCADE;

-- 3. How many sub-questions a parent passage contains (set on the parent row)
ALTER TABLE public.question_bank
  ADD COLUMN IF NOT EXISTS sub_question_count INTEGER;

-- 4. Ordering of sub-questions under a parent
ALTER TABLE public.question_bank
  ADD COLUMN IF NOT EXISTS sequence_order INTEGER;

-- -----------------------------------------------------------------
-- Indexes
-- -----------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_question_bank_chapter_topic
  ON public.question_bank(chapter_topic_id);

CREATE INDEX IF NOT EXISTS idx_question_bank_parent
  ON public.question_bank(parent_question_id);
