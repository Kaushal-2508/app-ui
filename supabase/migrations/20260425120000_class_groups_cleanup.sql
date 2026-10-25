-- Phase 4 — Class Groups refactor cleanup.
--
-- Runs AFTER Phase 1–3 have been monitored in production. By this point every
-- read path prefers class_group_id with a class_id fallback (useChapterTopics,
-- useChaptersForExam, useClassSubjects, etc.), and every write path attaches
-- class_group_id on new rows. This migration:
--
-- 1. Enforces classes.class_group_id NOT NULL (the Phase 1 trigger already
--    guarantees every new section gets one; this promotion just makes the
--    invariant visible to the schema).
-- 2. Drops chapter_topics.class_id — reads now go through class_group_id.
-- 3. Drops topic_class_mappings.class_id — same rationale.
-- 4. Keeps subject_class_mappings intact — still the per-section materialized
--    form consumed by teacher-subject RLS joins.
-- 5. Keeps question_bank.class_group_id nullable — legacy rows (pre-Phase 3)
--    retain institution-wide visibility via the RLS branch.
--
-- Preconditions are enforced defensively with RAISE EXCEPTION so an
-- institution that hasn't finished the rollover sees a clear error instead
-- of a partial structural change.

-- ─── Preconditions ─────────────────────────────────────────────────────────

DO $$
DECLARE
  ungrouped_classes INTEGER;
  ungrouped_chapter_topics INTEGER;
  ungrouped_topic_mappings INTEGER;
BEGIN
  SELECT COUNT(*) INTO ungrouped_classes FROM classes WHERE class_group_id IS NULL;
  IF ungrouped_classes > 0 THEN
    RAISE EXCEPTION 'Phase 4 blocked: % classes still have NULL class_group_id. Rerun the Phase 1 backfill before cleaning up.',
      ungrouped_classes;
  END IF;

  SELECT COUNT(*) INTO ungrouped_chapter_topics
  FROM chapter_topics
  WHERE class_group_id IS NULL AND class_id IS NOT NULL;
  IF ungrouped_chapter_topics > 0 THEN
    RAISE EXCEPTION 'Phase 4 blocked: % chapter_topics rows lack class_group_id. Rerun the Phase 3 backfill.',
      ungrouped_chapter_topics;
  END IF;

  SELECT COUNT(*) INTO ungrouped_topic_mappings
  FROM topic_class_mappings
  WHERE class_group_id IS NULL AND class_id IS NOT NULL;
  IF ungrouped_topic_mappings > 0 THEN
    RAISE EXCEPTION 'Phase 4 blocked: % topic_class_mappings rows lack class_group_id. Rerun the Phase 3 backfill.',
      ungrouped_topic_mappings;
  END IF;
END $$;

-- ─── 1. classes.class_group_id becomes NOT NULL ───────────────────────────

ALTER TABLE classes ALTER COLUMN class_group_id SET NOT NULL;

-- ─── 2. Drop chapter_topics.class_id ───────────────────────────────────────
-- Drop the matching unique constraint first if it still references class_id.

DO $$
DECLARE
  con_name TEXT;
BEGIN
  SELECT conname INTO con_name
  FROM pg_constraint
  WHERE conrelid = 'public.chapter_topics'::regclass
    AND contype = 'u'
    AND (
      SELECT array_agg(attname ORDER BY attnum)
      FROM pg_attribute
      WHERE attrelid = conrelid AND attnum = ANY(conkey)
    ) @> ARRAY['class_id']::name[];

  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE chapter_topics DROP CONSTRAINT %I', con_name);
  END IF;
END $$;

ALTER TABLE chapter_topics DROP COLUMN IF EXISTS class_id;

-- Replacement uniqueness at the class-group level, if not already present.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.chapter_topics'::regclass
      AND contype = 'u'
      AND (
        SELECT array_agg(attname ORDER BY attnum)
        FROM pg_attribute
        WHERE attrelid = conrelid AND attnum = ANY(conkey)
      ) @> ARRAY['class_group_id', 'subject_id', 'chapter_id', 'name']::name[]
  ) THEN
    ALTER TABLE chapter_topics
      ADD CONSTRAINT chapter_topics_group_subject_chapter_name_key
      UNIQUE (institution_id, class_group_id, subject_id, chapter_id, name);
  END IF;
END $$;

-- ─── 3. Drop topic_class_mappings.class_id ─────────────────────────────────

-- 3a. Drop the unique constraint still keyed on class_id, if any.
DO $$
DECLARE
  con_name TEXT;
BEGIN
  SELECT conname INTO con_name
  FROM pg_constraint
  WHERE conrelid = 'public.topic_class_mappings'::regclass
    AND contype = 'u'
    AND (
      SELECT array_agg(attname ORDER BY attnum)
      FROM pg_attribute
      WHERE attrelid = conrelid AND attnum = ANY(conkey)
    ) @> ARRAY['class_id']::name[];

  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE topic_class_mappings DROP CONSTRAINT %I', con_name);
  END IF;
END $$;

-- 3b. Drop RLS policies that reference class_id, recreate them on class_group_id.
--     Policies live on two tables:
--       - topic_class_mappings (direct `class_id` predicate)
--       - syllabus_topics (joins topic_class_mappings tcm ON tcm.class_id)

DROP POLICY IF EXISTS "Users can view topic mappings for their institution" ON topic_class_mappings;
CREATE POLICY "Users can view topic mappings for their institution"
  ON topic_class_mappings FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM class_groups cg
      WHERE cg.id = topic_class_mappings.class_group_id
        AND cg.institution_id = public.get_user_institution(auth.uid())
    )
  );

DROP POLICY IF EXISTS "School admins can manage topic mappings" ON topic_class_mappings;
CREATE POLICY "School admins can manage topic mappings"
  ON topic_class_mappings FOR ALL
  USING (
    (public.has_role(auth.uid(), 'school_admin') OR public.has_role(auth.uid(), 'super_school_admin'))
    AND EXISTS (
      SELECT 1 FROM class_groups cg
      WHERE cg.id = topic_class_mappings.class_group_id
        AND cg.institution_id = public.get_user_institution(auth.uid())
    )
  );

DROP POLICY IF EXISTS "Coordinators can manage topic mappings for wing classes" ON topic_class_mappings;
CREATE POLICY "Coordinators can manage topic mappings for wing classes"
  ON topic_class_mappings FOR ALL
  USING (
    public.has_role(auth.uid(), 'coordinator')
    AND EXISTS (
      SELECT 1 FROM classes c
      WHERE c.class_group_id = topic_class_mappings.class_group_id
        AND public.is_coordinator_for_class(auth.uid(), c.id)
    )
  );

DROP POLICY IF EXISTS "Teachers can manage topic mappings for assigned classes" ON topic_class_mappings;
CREATE POLICY "Teachers can manage topic mappings for assigned classes"
  ON topic_class_mappings FOR ALL
  USING (
    public.has_role(auth.uid(), 'teacher')
    AND EXISTS (
      SELECT 1 FROM classes c
      WHERE c.class_group_id = topic_class_mappings.class_group_id
        AND public.is_teacher_for_class(auth.uid(), c.id)
    )
  );

DROP POLICY IF EXISTS "Coordinators can update topics for wing classes" ON syllabus_topics;
CREATE POLICY "Coordinators can update topics for wing classes"
  ON syllabus_topics FOR UPDATE
  USING (
    institution_id = public.get_user_institution(auth.uid())
    AND public.has_role(auth.uid(), 'coordinator')
    AND EXISTS (
      SELECT 1
      FROM topic_class_mappings tcm
      JOIN classes c ON c.class_group_id = tcm.class_group_id
      WHERE tcm.topic_id = syllabus_topics.id
        AND public.is_coordinator_for_class(auth.uid(), c.id)
    )
  );

DROP POLICY IF EXISTS "Teachers can update topics for assigned classes" ON syllabus_topics;
CREATE POLICY "Teachers can update topics for assigned classes"
  ON syllabus_topics FOR UPDATE
  USING (
    institution_id = public.get_user_institution(auth.uid())
    AND public.has_role(auth.uid(), 'teacher')
    AND EXISTS (
      SELECT 1
      FROM topic_class_mappings tcm
      JOIN classes c ON c.class_group_id = tcm.class_group_id
      WHERE tcm.topic_id = syllabus_topics.id
        AND public.is_teacher_for_class(auth.uid(), c.id)
    )
  );

-- 3c. Now the column has no dependents — drop it.
ALTER TABLE topic_class_mappings DROP COLUMN IF EXISTS class_id;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.topic_class_mappings'::regclass
      AND contype = 'u'
      AND (
        SELECT array_agg(attname ORDER BY attnum)
        FROM pg_attribute
        WHERE attrelid = conrelid AND attnum = ANY(conkey)
      ) @> ARRAY['class_group_id', 'topic_id']::name[]
  ) THEN
    ALTER TABLE topic_class_mappings
      ADD CONSTRAINT topic_class_mappings_group_topic_key
      UNIQUE (class_group_id, topic_id);
  END IF;
END $$;

-- ─── 4. subject_class_mappings kept as-is ──────────────────────────────────
-- No action — the Phase 2 trigger keeps it in sync with
-- subject_class_group_mappings and the per-section RLS on teacher reads
-- depends on it.

-- ─── 5. question_bank.class_group_id kept nullable ─────────────────────────
-- Legacy rows (pre-Phase 3 uploads) still rely on the RLS branch that
-- treats class_group_id IS NULL as institution-wide visibility.
-- Teachers can backfill by editing the row through the normal UI.

COMMENT ON COLUMN classes.class_group_id IS
  'Parent class_groups row. NOT NULL post Phase 4. Auto-populated on insert via trigger; legacy rows backfilled in Phase 1.';

COMMENT ON COLUMN chapter_topics.class_group_id IS
  'Class_groups scope. Replaces the legacy class_id column dropped in Phase 4.';

COMMENT ON COLUMN topic_class_mappings.class_group_id IS
  'Class_groups scope. Replaces the legacy class_id column dropped in Phase 4.';
