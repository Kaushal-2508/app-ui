-- =============================================================
-- LESSON PLANNING
-- -------------------------------------------------------------
-- A lesson_plan is a teacher's intent or record for one actual
-- occurrence of a timetable_slot on a specific date.
--
-- Slot × date × plan relationship:
--   timetable_slots  — weekly recurring template (class, day,
--                      period_slot, academic_year)
--   lesson_plans     — concrete instance on a specific date;
--                      at most one per (slot, date).
--
-- Session types:
--   teaching      — topic-linked lesson (chapter / syllabus_topic)
--   test          — in-period test, no topic needed
--   doubt_session — Q&A; optionally tag any topics addressed
--   other         — free-form (use `note` to describe)
--
-- Status lifecycle:
--   planned → done     (teacher completed the lesson)
--   planned → skipped  (teacher chose to skip this occurrence)
--   done / skipped     (also accepted as first write for
--                       past-date entries)
--
-- Coverage accounting — a chapter is "covered" for a class+
-- subject when at least one lesson_plan exists with:
--   status = 'done'
--   session_type = 'teaching'
--   topic_id = chapter.id
-- Skipped and planned rows do NOT count as covered.
--
-- `addressed_topic_ids` is only meaningful for doubt_session rows
-- and is deliberately a plain UUID[] — we don't need a junction
-- table because the field is read-only metadata that doesn't
-- participate in coverage math.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.lesson_plans (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id       UUID NOT NULL REFERENCES public.institutions(id)     ON DELETE CASCADE,
  timetable_slot_id    UUID NOT NULL REFERENCES public.timetable_slots(id)  ON DELETE CASCADE,
  class_id             UUID NOT NULL REFERENCES public.classes(id)          ON DELETE CASCADE,
  subject_id           UUID          REFERENCES public.universal_subjects(id) ON DELETE SET NULL,
  teacher_id           UUID          REFERENCES public.profiles(id)         ON DELETE SET NULL,
  date                 DATE NOT NULL,
  session_type         TEXT NOT NULL,
  topic_id             UUID          REFERENCES public.syllabus_topics(id)  ON DELETE SET NULL,
  addressed_topic_ids  UUID[],
  note                 TEXT,
  status               TEXT NOT NULL DEFAULT 'planned',
  planned_at           TIMESTAMPTZ,
  done_at              TIMESTAMPTZ,
  created_by           UUID          REFERENCES public.profiles(id)         ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT lesson_plans_session_type_chk CHECK (
    session_type IN ('teaching','test','doubt_session','other')
  ),
  CONSTRAINT lesson_plans_status_chk CHECK (
    status IN ('planned','done','skipped')
  ),
  -- One plan per (slot, date). A slot recurs weekly; each date
  -- has exactly one lesson record.
  CONSTRAINT lesson_plans_unique_slot_date UNIQUE (timetable_slot_id, date)
);

CREATE INDEX IF NOT EXISTS idx_lesson_plans_institution_year
  ON public.lesson_plans(institution_id, date);
CREATE INDEX IF NOT EXISTS idx_lesson_plans_teacher_date
  ON public.lesson_plans(teacher_id, date)
  WHERE teacher_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lesson_plans_class_subject
  ON public.lesson_plans(class_id, subject_id)
  WHERE subject_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lesson_plans_topic_status
  ON public.lesson_plans(topic_id, status)
  WHERE topic_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lesson_plans_slot_date
  ON public.lesson_plans(timetable_slot_id, date);

DROP TRIGGER IF EXISTS update_lesson_plans_updated_at ON public.lesson_plans;
CREATE TRIGGER update_lesson_plans_updated_at
  BEFORE UPDATE ON public.lesson_plans
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- -------------------------------------------------------------
-- Status-aware timestamps. Set planned_at/done_at automatically
-- so the hooks don't have to remember. Re-transitions keep the
-- first timestamp (don't clobber planned_at when a plan flips
-- planned → done → planned).
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lesson_plans_stamp_status()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'planned' AND NEW.planned_at IS NULL THEN
    NEW.planned_at := now();
  END IF;
  IF NEW.status = 'done' AND NEW.done_at IS NULL THEN
    NEW.done_at := now();
    IF NEW.planned_at IS NULL THEN
      NEW.planned_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS lesson_plans_stamp_status_trg ON public.lesson_plans;
CREATE TRIGGER lesson_plans_stamp_status_trg
  BEFORE INSERT OR UPDATE ON public.lesson_plans
  FOR EACH ROW
  EXECUTE FUNCTION public.lesson_plans_stamp_status();

-- -------------------------------------------------------------
-- RLS
--   super_admin                  : FULL
--   school_admin/super_school_  : FULL within institution
--     admin
--   coordinator                  : FULL for classes in their wings
--                                  (wing_assignments × wing_class_mappings)
--   teacher                      : R/W their own plans
--                                  (teacher_id = auth.uid())
--   student                      : READ plans for classes they
--                                  belong to where status IN
--                                  ('planned','done')
-- -------------------------------------------------------------
ALTER TABLE public.lesson_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super admins manage all lesson_plans"     ON public.lesson_plans;
DROP POLICY IF EXISTS "School admins manage lesson_plans"        ON public.lesson_plans;
DROP POLICY IF EXISTS "Coordinators manage wing lesson_plans"    ON public.lesson_plans;
DROP POLICY IF EXISTS "Teachers read own lesson_plans"           ON public.lesson_plans;
DROP POLICY IF EXISTS "Teachers insert own lesson_plans"         ON public.lesson_plans;
DROP POLICY IF EXISTS "Teachers update own lesson_plans"         ON public.lesson_plans;
DROP POLICY IF EXISTS "Teachers delete own lesson_plans"         ON public.lesson_plans;
DROP POLICY IF EXISTS "Students read class lesson_plans"         ON public.lesson_plans;

-- Super admin: full
CREATE POLICY "Super admins manage all lesson_plans"
  ON public.lesson_plans FOR ALL
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

-- School admin / super school admin: full within institution
CREATE POLICY "School admins manage lesson_plans"
  ON public.lesson_plans FOR ALL
  USING (
    institution_id = public.get_user_institution(auth.uid())
    AND (
      public.has_role(auth.uid(), 'school_admin')
      OR public.has_role(auth.uid(), 'super_school_admin')
    )
  )
  WITH CHECK (
    institution_id = public.get_user_institution(auth.uid())
    AND (
      public.has_role(auth.uid(), 'school_admin')
      OR public.has_role(auth.uid(), 'super_school_admin')
    )
  );

-- Coordinator: full for lesson plans whose class lives in a wing
-- they are assigned to. Mirrors the timetable_slots coordinator
-- policy.
CREATE POLICY "Coordinators manage wing lesson_plans"
  ON public.lesson_plans FOR ALL
  USING (
    public.has_role(auth.uid(), 'coordinator')
    AND institution_id = public.get_user_institution(auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.wing_class_mappings wcm
      JOIN public.wing_assignments    wa ON wa.wing_id = wcm.wing_id
      WHERE wcm.class_id = lesson_plans.class_id
        AND wa.user_id  = auth.uid()
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'coordinator')
    AND institution_id = public.get_user_institution(auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.wing_class_mappings wcm
      JOIN public.wing_assignments    wa ON wa.wing_id = wcm.wing_id
      WHERE wcm.class_id = lesson_plans.class_id
        AND wa.user_id  = auth.uid()
    )
  );

-- Teacher: read + write their own rows only
CREATE POLICY "Teachers read own lesson_plans"
  ON public.lesson_plans FOR SELECT
  USING (
    public.has_role(auth.uid(), 'teacher')
    AND teacher_id = auth.uid()
  );

CREATE POLICY "Teachers insert own lesson_plans"
  ON public.lesson_plans FOR INSERT
  WITH CHECK (
    public.has_role(auth.uid(), 'teacher')
    AND teacher_id = auth.uid()
    AND institution_id = public.get_user_institution(auth.uid())
  );

CREATE POLICY "Teachers update own lesson_plans"
  ON public.lesson_plans FOR UPDATE
  USING (
    public.has_role(auth.uid(), 'teacher')
    AND teacher_id = auth.uid()
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'teacher')
    AND teacher_id = auth.uid()
  );

CREATE POLICY "Teachers delete own lesson_plans"
  ON public.lesson_plans FOR DELETE
  USING (
    public.has_role(auth.uid(), 'teacher')
    AND teacher_id = auth.uid()
  );

-- Students: READ rows for the class they belong to, but only
-- rows that have been planned or completed (skip "skipped" to
-- avoid showing noise). Notes stay in the row; clients must not
-- render `note` for students (enforced in query projection).
CREATE POLICY "Students read class lesson_plans"
  ON public.lesson_plans FOR SELECT
  USING (
    public.has_role(auth.uid(), 'student')
    AND status IN ('planned','done')
    AND EXISTS (
      SELECT 1 FROM public.class_assignments ca
      WHERE ca.user_id  = auth.uid()
        AND ca.role     = 'student'
        AND ca.class_id = lesson_plans.class_id
    )
  );
