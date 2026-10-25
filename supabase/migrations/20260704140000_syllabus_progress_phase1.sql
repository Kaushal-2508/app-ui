-- 20260704140000_syllabus_progress_phase1.sql
-- Two-timeline syllabus, Phase 1 (spec 2026-07-04 §3, §9):
--   * syllabus_progress_events — the "jar": one row per (class, subject,
--     chapter, teaching-date) with action completed|partial. Chapter state and
--     day-resolution are DERIVED from this table (no status columns elsewhere).
--   * syllabus_sequence — teacher-controlled chapter order (default = syllabus
--     display order when no rows). Written by Phase 2 UI; created now so the
--     state RPC reads one shape from day one.
--   * Backfill completed events from historical tt_lesson_plans done rows so
--     dropdowns never re-offer already-taught chapters.

CREATE TABLE IF NOT EXISTS public.syllabus_progress_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id  UUID NOT NULL REFERENCES public.institutions(id)       ON DELETE CASCADE,
  class_id        UUID NOT NULL REFERENCES public.classes(id)            ON DELETE CASCADE,
  subject_id      UUID NOT NULL REFERENCES public.universal_subjects(id) ON DELETE CASCADE,
  topic_id        UUID NOT NULL REFERENCES public.syllabus_topics(id)    ON DELETE CASCADE,
  date            DATE NOT NULL,
  action          TEXT NOT NULL CHECK (action IN ('completed','partial')),
  source          TEXT NOT NULL CHECK (source IN ('checkout','checkin','correction')),
  recorded_by     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT spe_unique UNIQUE (class_id, subject_id, topic_id, date)
);

CREATE INDEX IF NOT EXISTS spe_inst_idx        ON public.syllabus_progress_events (institution_id);
CREATE INDEX IF NOT EXISTS spe_subject_idx     ON public.syllabus_progress_events (subject_id);
CREATE INDEX IF NOT EXISTS spe_topic_idx       ON public.syllabus_progress_events (topic_id);
CREATE INDEX IF NOT EXISTS spe_recorded_by_idx ON public.syllabus_progress_events (recorded_by);
-- Day-resolution lookups: (class, subject, date). The UNIQUE covers
-- (class, subject, topic, date) but date-last doesn't serve this shape.
CREATE INDEX IF NOT EXISTS spe_class_subject_date_idx
  ON public.syllabus_progress_events (class_id, subject_id, date);

CREATE TABLE IF NOT EXISTS public.syllabus_sequence (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id  UUID NOT NULL REFERENCES public.institutions(id)       ON DELETE CASCADE,
  class_id        UUID NOT NULL REFERENCES public.classes(id)            ON DELETE CASCADE,
  subject_id      UUID NOT NULL REFERENCES public.universal_subjects(id) ON DELETE CASCADE,
  topic_id        UUID NOT NULL REFERENCES public.syllabus_topics(id)    ON DELETE CASCADE,
  position        INTEGER NOT NULL,
  updated_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sseq_unique UNIQUE (class_id, subject_id, topic_id)
);

CREATE INDEX IF NOT EXISTS sseq_inst_idx       ON public.syllabus_sequence (institution_id);
CREATE INDEX IF NOT EXISTS sseq_subject_idx    ON public.syllabus_sequence (subject_id);
CREATE INDEX IF NOT EXISTS sseq_topic_idx      ON public.syllabus_sequence (topic_id);
CREATE INDEX IF NOT EXISTS sseq_updated_by_idx ON public.syllabus_sequence (updated_by);

ALTER TABLE public.syllabus_progress_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.syllabus_sequence        ENABLE ROW LEVEL SECURITY;

-- Read: any institution member (staff surfaces; students only ever read via
-- the SECURITY DEFINER projection RPC in Phase 2).
DROP POLICY IF EXISTS "Members read syllabus progress" ON public.syllabus_progress_events;
CREATE POLICY "Members read syllabus progress" ON public.syllabus_progress_events
  FOR SELECT TO authenticated
  USING (institution_id = public.get_user_institution(auth.uid()));

DROP POLICY IF EXISTS "Members read syllabus sequence" ON public.syllabus_sequence;
CREATE POLICY "Members read syllabus sequence" ON public.syllabus_sequence
  FOR SELECT TO authenticated
  USING (institution_id = public.get_user_institution(auth.uid()));

-- Write: the proven tri-clause (admins/coords helper OR class_assignments
-- teacher OR timetable-scheduled teacher for the class+subject) — same shape
-- as the 20260704130000 tt_chapter_pacing fix.
DROP POLICY IF EXISTS "Staff write syllabus progress" ON public.syllabus_progress_events;
CREATE POLICY "Staff write syllabus progress" ON public.syllabus_progress_events
  FOR ALL TO authenticated
  USING (
    institution_id = public.get_user_institution(auth.uid())
    AND (
      public.tt_user_can_edit_class_slots(auth.uid(), class_id)
      OR EXISTS (
        SELECT 1 FROM public.class_assignments ca
        WHERE ca.user_id = auth.uid() AND ca.role = 'teacher' AND ca.class_id = syllabus_progress_events.class_id
      )
      OR EXISTS (
        SELECT 1 FROM public.tt_slots s
        WHERE s.teacher_id = auth.uid()
          AND s.class_id = syllabus_progress_events.class_id
          AND s.subject_id = syllabus_progress_events.subject_id
      )
    )
  )
  WITH CHECK (
    institution_id = public.get_user_institution(auth.uid())
    AND (
      public.tt_user_can_edit_class_slots(auth.uid(), class_id)
      OR EXISTS (
        SELECT 1 FROM public.class_assignments ca
        WHERE ca.user_id = auth.uid() AND ca.role = 'teacher' AND ca.class_id = syllabus_progress_events.class_id
      )
      OR EXISTS (
        SELECT 1 FROM public.tt_slots s
        WHERE s.teacher_id = auth.uid()
          AND s.class_id = syllabus_progress_events.class_id
          AND s.subject_id = syllabus_progress_events.subject_id
      )
    )
  );

DROP POLICY IF EXISTS "Staff write syllabus sequence" ON public.syllabus_sequence;
CREATE POLICY "Staff write syllabus sequence" ON public.syllabus_sequence
  FOR ALL TO authenticated
  USING (
    institution_id = public.get_user_institution(auth.uid())
    AND (
      public.tt_user_can_edit_class_slots(auth.uid(), class_id)
      OR EXISTS (
        SELECT 1 FROM public.class_assignments ca
        WHERE ca.user_id = auth.uid() AND ca.role = 'teacher' AND ca.class_id = syllabus_sequence.class_id
      )
      OR EXISTS (
        SELECT 1 FROM public.tt_slots s
        WHERE s.teacher_id = auth.uid()
          AND s.class_id = syllabus_sequence.class_id
          AND s.subject_id = syllabus_sequence.subject_id
      )
    )
  )
  WITH CHECK (
    institution_id = public.get_user_institution(auth.uid())
    AND (
      public.tt_user_can_edit_class_slots(auth.uid(), class_id)
      OR EXISTS (
        SELECT 1 FROM public.class_assignments ca
        WHERE ca.user_id = auth.uid() AND ca.role = 'teacher' AND ca.class_id = syllabus_sequence.class_id
      )
      OR EXISTS (
        SELECT 1 FROM public.tt_slots s
        WHERE s.teacher_id = auth.uid()
          AND s.class_id = syllabus_sequence.class_id
          AND s.subject_id = syllabus_sequence.subject_id
      )
    )
  );

-- Backfill: every historical done teaching row with a chapter becomes a
-- completed event, so day-one dropdowns reflect reality. Re-runnable.
-- EXISTS guards: tolerate historical rows whose topic/subject no longer
-- resolves (would otherwise FK-abort the whole migration).
INSERT INTO public.syllabus_progress_events
  (institution_id, class_id, subject_id, topic_id, date, action, source, recorded_by)
SELECT lp.institution_id, lp.class_id, lp.subject_id, lp.topic_id, lp.date,
       'completed', 'correction', lp.owner_teacher_id
FROM public.tt_lesson_plans lp
WHERE lp.status = 'done'
  AND lp.session_type = 'teaching'
  AND lp.topic_id IS NOT NULL
  AND lp.subject_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.syllabus_topics st WHERE st.id = lp.topic_id)
  AND EXISTS (SELECT 1 FROM public.universal_subjects us WHERE us.id = lp.subject_id)
ON CONFLICT (class_id, subject_id, topic_id, date) DO NOTHING;
