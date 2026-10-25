-- =============================================================
-- TIMETABLE + ACADEMIC CALENDAR REBUILD — PHASE 1
-- -------------------------------------------------------------
-- Stands up the new tt_* and cal_* schema alongside the existing
-- tables (period_structures, timetable_slots, lesson_plans,
-- academic_calendar, etc.). No data is moved here — Phase 2
-- handles backfill. No old tables are altered or dropped.
-- After this migration runs:
--   * All new tables exist, empty.
--   * All RLS policies, triggers, indexes are in place.
--   * Old tables and their consumers are unchanged.
-- =============================================================

-- -------------------------------------------------------------
-- tt_period_structures — weekly grid template (admin-owned)
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tt_period_structures (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id  UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  working_days    TEXT[] NOT NULL,
  created_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tt_period_structures_working_days_chk
    CHECK (working_days <@ ARRAY['monday','tuesday','wednesday','thursday','friday','saturday','sunday'])
);

CREATE INDEX IF NOT EXISTS idx_tt_period_structures_institution
  ON public.tt_period_structures(institution_id);

DROP TRIGGER IF EXISTS update_tt_period_structures_updated_at ON public.tt_period_structures;
CREATE TRIGGER update_tt_period_structures_updated_at
  BEFORE UPDATE ON public.tt_period_structures
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- -------------------------------------------------------------
-- tt_period_slots — periods + breaks within a structure
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tt_period_slots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  structure_id    UUID NOT NULL REFERENCES public.tt_period_structures(id) ON DELETE CASCADE,
  period_number   INTEGER NOT NULL,
  label           TEXT NOT NULL,
  start_time      TIME NOT NULL,
  end_time        TIME NOT NULL,
  kind            TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tt_period_slots_kind_chk CHECK (kind IN ('period','break')),
  CONSTRAINT tt_period_slots_time_chk CHECK (end_time > start_time),
  CONSTRAINT tt_period_slots_unique_number UNIQUE (structure_id, period_number)
);

CREATE INDEX IF NOT EXISTS idx_tt_period_slots_structure
  ON public.tt_period_slots(structure_id);

-- -------------------------------------------------------------
-- Overlap guard: reject a new/updated slot whose [start_time,
-- end_time) tsrange overlaps another slot in the same structure.
-- Uses exclusive-end so back-to-back slots (09:00-09:40 and
-- 09:40-10:20) do NOT falsely conflict.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tt_prevent_overlapping_period_slots()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.tt_period_slots s
    WHERE s.structure_id = NEW.structure_id
      AND s.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND tsrange(
            ('2000-01-01 ' || s.start_time)::timestamp,
            ('2000-01-01 ' || s.end_time)::timestamp,
            '()'
          )
       && tsrange(
            ('2000-01-01 ' || NEW.start_time)::timestamp,
            ('2000-01-01 ' || NEW.end_time)::timestamp,
            '()'
          )
  ) THEN
    RAISE EXCEPTION 'Period slot times overlap with an existing slot in the same structure'
      USING ERRCODE = '23P01';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tt_prevent_overlapping_period_slots_tr ON public.tt_period_slots;
CREATE TRIGGER tt_prevent_overlapping_period_slots_tr
  BEFORE INSERT OR UPDATE ON public.tt_period_slots
  FOR EACH ROW
  EXECUTE FUNCTION public.tt_prevent_overlapping_period_slots();

-- -------------------------------------------------------------
-- tt_class_structure — which structure each class uses for an AY,
-- plus the per-class publish state (Q5: per-class draft scope).
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tt_class_structure (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id  UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  class_id        UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  structure_id    UUID NOT NULL REFERENCES public.tt_period_structures(id) ON DELETE RESTRICT,
  academic_year   TEXT NOT NULL,
  publish_status  TEXT NOT NULL DEFAULT 'draft',
  published_at    TIMESTAMPTZ,
  published_by    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tt_class_structure_publish_status_chk CHECK (publish_status IN ('draft','published')),
  CONSTRAINT tt_class_structure_unique_class_year UNIQUE (class_id, academic_year)
);

CREATE INDEX IF NOT EXISTS idx_tt_class_structure_structure
  ON public.tt_class_structure(structure_id);
CREATE INDEX IF NOT EXISTS idx_tt_class_structure_institution_year
  ON public.tt_class_structure(institution_id, academic_year);

DROP TRIGGER IF EXISTS update_tt_class_structure_updated_at ON public.tt_class_structure;
CREATE TRIGGER update_tt_class_structure_updated_at
  BEFORE UPDATE ON public.tt_class_structure
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- -------------------------------------------------------------
-- tt_resources — school-wide pool (lab, library, room, etc.)
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tt_resources (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id  UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  kind            TEXT NOT NULL,
  capacity        INTEGER NOT NULL DEFAULT 1,
  description     TEXT,
  created_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tt_resources_kind_chk CHECK (kind IN ('lab','library','computer_room','sports_facility','other')),
  CONSTRAINT tt_resources_capacity_chk CHECK (capacity >= 1),
  CONSTRAINT tt_resources_unique_name UNIQUE (institution_id, name)
);

CREATE INDEX IF NOT EXISTS idx_tt_resources_institution
  ON public.tt_resources(institution_id);

DROP TRIGGER IF EXISTS update_tt_resources_updated_at ON public.tt_resources;
CREATE TRIGGER update_tt_resources_updated_at
  BEFORE UPDATE ON public.tt_resources
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- -------------------------------------------------------------
-- tt_slots — the cells. One row per (class, day, period, AY).
-- Visibility controlled by tt_class_structure.publish_status.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tt_slots (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id   UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  class_id         UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  period_slot_id   UUID NOT NULL REFERENCES public.tt_period_slots(id) ON DELETE CASCADE,
  day              TEXT NOT NULL,
  academic_year    TEXT NOT NULL,
  slot_type        TEXT NOT NULL,
  subject_id       UUID REFERENCES public.universal_subjects(id) ON DELETE SET NULL,
  teacher_id       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  resource_id      UUID REFERENCES public.tt_resources(id) ON DELETE SET NULL,
  notes            TEXT,
  created_by       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tt_slots_day_chk CHECK (day IN ('monday','tuesday','wednesday','thursday','friday','saturday','sunday')),
  CONSTRAINT tt_slots_type_chk CHECK (slot_type IN ('theory','practical','library','sports','arts','assembly','free','break')),
  CONSTRAINT tt_slots_unique_cell UNIQUE (class_id, period_slot_id, day, academic_year)
);

CREATE INDEX IF NOT EXISTS idx_tt_slots_class_year ON public.tt_slots(class_id, academic_year);
CREATE INDEX IF NOT EXISTS idx_tt_slots_teacher_year ON public.tt_slots(teacher_id, academic_year)
  WHERE teacher_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tt_slots_subject_class ON public.tt_slots(subject_id, class_id)
  WHERE subject_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tt_slots_resource_period ON public.tt_slots(resource_id, period_slot_id, day)
  WHERE resource_id IS NOT NULL;

DROP TRIGGER IF EXISTS update_tt_slots_updated_at ON public.tt_slots;
CREATE TRIGGER update_tt_slots_updated_at
  BEFORE UPDATE ON public.tt_slots
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- -------------------------------------------------------------
-- tt_substitutions — one-off date overrides for an absent teacher.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tt_substitutions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id                UUID NOT NULL REFERENCES public.tt_slots(id) ON DELETE CASCADE,
  date                   DATE NOT NULL,
  substitute_teacher_id  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reason                 TEXT,
  created_by             UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tt_substitutions_unique_slot_date UNIQUE (slot_id, date)
);

CREATE INDEX IF NOT EXISTS idx_tt_substitutions_substitute_date
  ON public.tt_substitutions(substitute_teacher_id, date);
CREATE INDEX IF NOT EXISTS idx_tt_substitutions_date
  ON public.tt_substitutions(date);

-- -------------------------------------------------------------
-- tt_lesson_plans — per-date instance of a slot. Owned by the
-- original teacher (not substitute). Denormalizes class_id /
-- subject_id / owner_teacher_id / session_type from tt_slots so
-- existing index-backed queries stay fast (matches current
-- lesson_plans pattern that useSyllabusCoverage relies on).
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tt_lesson_plans (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id       UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  slot_id              UUID NOT NULL REFERENCES public.tt_slots(id) ON DELETE CASCADE,
  class_id             UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  subject_id           UUID REFERENCES public.universal_subjects(id) ON DELETE SET NULL,
  owner_teacher_id     UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  date                 DATE NOT NULL,
  session_type         TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'planned',
  topic_id             UUID REFERENCES public.syllabus_topics(id) ON DELETE SET NULL,
  chapter_topic_id     UUID REFERENCES public.chapter_topics(id) ON DELETE SET NULL,
  addressed_topic_ids  UUID[] DEFAULT ARRAY[]::UUID[],
  note                 TEXT,
  planned_at           TIMESTAMPTZ,
  done_at              TIMESTAMPTZ,
  updated_by           UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by           UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tt_lesson_plans_session_type_chk CHECK (session_type IN ('teaching','test','doubt_session','other')),
  CONSTRAINT tt_lesson_plans_status_chk CHECK (status IN ('planned','done','pending','skipped')),
  CONSTRAINT tt_lesson_plans_unique_slot_date UNIQUE (slot_id, date)
);

CREATE INDEX IF NOT EXISTS idx_tt_lesson_plans_owner_date
  ON public.tt_lesson_plans(owner_teacher_id, date)
  WHERE owner_teacher_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tt_lesson_plans_class_subject
  ON public.tt_lesson_plans(class_id, subject_id)
  WHERE subject_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tt_lesson_plans_topic_status
  ON public.tt_lesson_plans(topic_id, status)
  WHERE topic_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tt_lesson_plans_slot_date
  ON public.tt_lesson_plans(slot_id, date);

DROP TRIGGER IF EXISTS update_tt_lesson_plans_updated_at ON public.tt_lesson_plans;
CREATE TRIGGER update_tt_lesson_plans_updated_at
  BEFORE UPDATE ON public.tt_lesson_plans
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Status-aware timestamp stamping (mirrors current lesson_plans_stamp_status).
CREATE OR REPLACE FUNCTION public.tt_lesson_plans_stamp_status()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'planned' AND NEW.planned_at IS NULL THEN
    NEW.planned_at := now();
  END IF;
  IF NEW.status = 'done' AND NEW.done_at IS NULL THEN
    NEW.done_at := now();
    -- Preserve legacy behavior: also stamp planned_at on a direct
    -- transition to 'done' (e.g. teacher logs a past lesson). Avoids
    -- ever leaving a 'done' row with NULL planned_at.
    IF NEW.planned_at IS NULL THEN
      NEW.planned_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tt_lesson_plans_stamp_status_tr ON public.tt_lesson_plans;
CREATE TRIGGER tt_lesson_plans_stamp_status_tr
  BEFORE INSERT OR UPDATE ON public.tt_lesson_plans
  FOR EACH ROW
  EXECUTE FUNCTION public.tt_lesson_plans_stamp_status();

-- -------------------------------------------------------------
-- cal_academic_years — explicit AY records (replaces ad-hoc string
-- typing scattered across the app). Exactly one is_active per
-- institution at any time.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cal_academic_years (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id  UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  code            TEXT NOT NULL,
  starts_on       DATE NOT NULL,
  ends_on         DATE NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cal_academic_years_date_chk CHECK (ends_on > starts_on),
  CONSTRAINT cal_academic_years_unique_code UNIQUE (institution_id, code)
);

CREATE UNIQUE INDEX IF NOT EXISTS one_active_year_per_institution
  ON public.cal_academic_years(institution_id)
  WHERE is_active;

CREATE INDEX IF NOT EXISTS idx_cal_academic_years_institution
  ON public.cal_academic_years(institution_id);

DROP TRIGGER IF EXISTS update_cal_academic_years_updated_at ON public.cal_academic_years;
CREATE TRIGGER update_cal_academic_years_updated_at
  BEFORE UPDATE ON public.cal_academic_years
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- -------------------------------------------------------------
-- cal_events — holidays, exam blocks, and informational events.
-- Replaces academic_calendar table. Terms intentionally excluded.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cal_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id  UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  academic_year   TEXT NOT NULL,
  title           TEXT NOT NULL,
  kind            TEXT NOT NULL,
  starts_on       DATE NOT NULL,
  ends_on         DATE NOT NULL,
  color           TEXT,
  notes           TEXT,
  created_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cal_events_kind_chk CHECK (kind IN ('holiday','exam_block','event')),
  CONSTRAINT cal_events_date_chk CHECK (ends_on >= starts_on)
);

CREATE INDEX IF NOT EXISTS idx_cal_events_institution_year
  ON public.cal_events(institution_id, academic_year);
CREATE INDEX IF NOT EXISTS idx_cal_events_dates
  ON public.cal_events(institution_id, starts_on, ends_on);

DROP TRIGGER IF EXISTS update_cal_events_updated_at ON public.cal_events;
CREATE TRIGGER update_cal_events_updated_at
  BEFORE UPDATE ON public.cal_events
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Exam-block overlap guard (port of prevent_overlapping_exam_blocks).
-- Holidays vs exam_blocks remain a soft confirm at UI layer.
CREATE OR REPLACE FUNCTION public.cal_prevent_overlapping_exam_blocks()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.kind = 'exam_block' THEN
    IF EXISTS (
      SELECT 1
      FROM public.cal_events e
      WHERE e.institution_id = NEW.institution_id
        AND e.academic_year  = NEW.academic_year
        AND e.kind           = 'exam_block'
        AND e.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
        AND daterange(e.starts_on, e.ends_on, '[]')
         && daterange(NEW.starts_on, NEW.ends_on, '[]')
    ) THEN
      RAISE EXCEPTION 'Exam block dates overlap with an existing exam block in this academic year'
        USING ERRCODE = '23P01';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cal_prevent_overlapping_exam_blocks_tr ON public.cal_events;
CREATE TRIGGER cal_prevent_overlapping_exam_blocks_tr
  BEFORE INSERT OR UPDATE ON public.cal_events
  FOR EACH ROW
  EXECUTE FUNCTION public.cal_prevent_overlapping_exam_blocks();

-- =============================================================
-- ROW LEVEL SECURITY — enable on every new table
-- =============================================================
ALTER TABLE public.tt_period_structures  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tt_period_slots       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tt_class_structure    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tt_resources          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tt_slots              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tt_substitutions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tt_lesson_plans       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cal_academic_years    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cal_events            ENABLE ROW LEVEL SECURITY;

-- -------------------------------------------------------------
-- tt_period_structures policies
-- -------------------------------------------------------------
CREATE POLICY tt_period_structures_select_in_institution
  ON public.tt_period_structures FOR SELECT
  USING (institution_id = public.get_user_institution(auth.uid()));

CREATE POLICY tt_period_structures_admin_write
  ON public.tt_period_structures FOR ALL
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

CREATE POLICY tt_period_structures_super_admin_all
  ON public.tt_period_structures FOR ALL
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

-- -------------------------------------------------------------
-- tt_period_slots policies (scope via parent structure)
-- -------------------------------------------------------------
CREATE POLICY tt_period_slots_select_in_institution
  ON public.tt_period_slots FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.tt_period_structures s
      WHERE s.id = tt_period_slots.structure_id
        AND s.institution_id = public.get_user_institution(auth.uid())
    )
  );

CREATE POLICY tt_period_slots_admin_write
  ON public.tt_period_slots FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.tt_period_structures s
      WHERE s.id = tt_period_slots.structure_id
        AND s.institution_id = public.get_user_institution(auth.uid())
    )
    AND (
      public.has_role(auth.uid(), 'school_admin')
      OR public.has_role(auth.uid(), 'super_school_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tt_period_structures s
      WHERE s.id = tt_period_slots.structure_id
        AND s.institution_id = public.get_user_institution(auth.uid())
    )
    AND (
      public.has_role(auth.uid(), 'school_admin')
      OR public.has_role(auth.uid(), 'super_school_admin')
    )
  );

CREATE POLICY tt_period_slots_super_admin_all
  ON public.tt_period_slots FOR ALL
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

-- -------------------------------------------------------------
-- tt_resources policies (mirror period_structures)
-- -------------------------------------------------------------
CREATE POLICY tt_resources_select_in_institution
  ON public.tt_resources FOR SELECT
  USING (institution_id = public.get_user_institution(auth.uid()));

CREATE POLICY tt_resources_admin_write
  ON public.tt_resources FOR ALL
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

CREATE POLICY tt_resources_super_admin_all
  ON public.tt_resources FOR ALL
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

-- -------------------------------------------------------------
-- tt_class_structure policies — admin-only writes per spec.
-- Coordinators read so they can see which classes have structures
-- attached. publish_status updates: admin OR coordinator-in-wing
-- (handled in Plan 2 RLS for tt_slots; tt_class_structure publish
-- toggle goes through a SECURITY DEFINER helper in Plan 2).
-- -------------------------------------------------------------
CREATE POLICY tt_class_structure_select_in_institution
  ON public.tt_class_structure FOR SELECT
  USING (institution_id = public.get_user_institution(auth.uid()));

CREATE POLICY tt_class_structure_admin_write
  ON public.tt_class_structure FOR ALL
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

CREATE POLICY tt_class_structure_super_admin_all
  ON public.tt_class_structure FOR ALL
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

-- -------------------------------------------------------------
-- Helper: is the calling user a coordinator whose wing assignment
-- includes the given class? Wrapping in SECURITY DEFINER avoids
-- RLS-recursion traps (per CLAUDE.md §22 RLS recursion note).
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tt_user_can_edit_class_slots(p_user UUID, p_class UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    public.has_role(p_user, 'super_admin')
    OR (
      (
        public.has_role(p_user, 'school_admin')
        OR public.has_role(p_user, 'super_school_admin')
      )
      AND EXISTS (
        SELECT 1 FROM public.classes c
        WHERE c.id = p_class
          AND c.institution_id = public.get_user_institution(p_user)
      )
    )
    OR (
      public.has_role(p_user, 'coordinator')
      AND EXISTS (
        SELECT 1
        FROM public.wing_class_mappings wcm
        JOIN public.wing_assignments  wa ON wa.wing_id = wcm.wing_id
        WHERE wcm.class_id = p_class
          AND wa.user_id = p_user
      )
    );
$$;

-- -------------------------------------------------------------
-- tt_slots policies
-- Read: admin & coordinator see all in scope; teacher sees their
-- own slots OR any slot in a published class their student/teacher
-- profile maps to. (Student visibility lives on tt_lesson_plans
-- read filtering — students don't query tt_slots directly in the
-- typical UI.)
-- Write: admin school-wide; coordinator wing-only via the helper.
-- -------------------------------------------------------------
CREATE POLICY tt_slots_select_admin_or_coord
  ON public.tt_slots FOR SELECT
  USING (
    institution_id = public.get_user_institution(auth.uid())
    AND (
      public.has_role(auth.uid(), 'school_admin')
      OR public.has_role(auth.uid(), 'super_school_admin')
      OR public.has_role(auth.uid(), 'coordinator')
      OR public.has_role(auth.uid(), 'super_admin')
    )
  );

CREATE POLICY tt_slots_select_teacher_own
  ON public.tt_slots FOR SELECT
  USING (
    teacher_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.tt_substitutions sub
      WHERE sub.slot_id = tt_slots.id
        AND sub.substitute_teacher_id = auth.uid()
    )
  );

CREATE POLICY tt_slots_select_published_for_class
  ON public.tt_slots FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.tt_class_structure cs
      WHERE cs.class_id = tt_slots.class_id
        AND cs.academic_year = tt_slots.academic_year
        AND cs.publish_status = 'published'
    )
  );

CREATE POLICY tt_slots_admin_or_coord_write
  ON public.tt_slots FOR ALL
  USING (
    institution_id = public.get_user_institution(auth.uid())
    AND public.tt_user_can_edit_class_slots(auth.uid(), class_id)
  )
  WITH CHECK (
    institution_id = public.get_user_institution(auth.uid())
    AND public.tt_user_can_edit_class_slots(auth.uid(), class_id)
  );

-- -------------------------------------------------------------
-- tt_substitutions policies — read for everyone whose slot they
-- can see; write for admin or coordinator-of-wing for the slot's
-- class.
-- -------------------------------------------------------------
CREATE POLICY tt_substitutions_select
  ON public.tt_substitutions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.tt_slots s
      WHERE s.id = tt_substitutions.slot_id
        AND s.institution_id = public.get_user_institution(auth.uid())
    )
    OR substitute_teacher_id = auth.uid()
  );

CREATE POLICY tt_substitutions_admin_or_coord_write
  ON public.tt_substitutions FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.tt_slots s
      WHERE s.id = tt_substitutions.slot_id
        AND public.tt_user_can_edit_class_slots(auth.uid(), s.class_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tt_slots s
      WHERE s.id = tt_substitutions.slot_id
        AND public.tt_user_can_edit_class_slots(auth.uid(), s.class_id)
    )
  );

-- -------------------------------------------------------------
-- tt_lesson_plans policies
-- Read:
--   - admin & coordinator (wing-scoped via helper)
--   - owner_teacher reads their own
--   - student reads only when slot's class is published AND
--     status IN ('planned','done')
-- Write:
--   - admin full
--   - coordinator wing-scoped (via helper)
--   - teacher writes their own (owner_teacher_id = auth.uid())
-- -------------------------------------------------------------
CREATE POLICY tt_lesson_plans_select_admin_or_coord
  ON public.tt_lesson_plans FOR SELECT
  USING (
    institution_id = public.get_user_institution(auth.uid())
    AND public.tt_user_can_edit_class_slots(auth.uid(), class_id)
  );

CREATE POLICY tt_lesson_plans_select_owner_teacher
  ON public.tt_lesson_plans FOR SELECT
  USING (owner_teacher_id = auth.uid());

CREATE POLICY tt_lesson_plans_select_student_published
  ON public.tt_lesson_plans FOR SELECT
  USING (
    public.has_role(auth.uid(), 'student')
    AND status IN ('planned','done')
    AND EXISTS (
      SELECT 1
      FROM public.tt_class_structure cs
      JOIN public.class_assignments  ca ON ca.class_id = cs.class_id
      WHERE cs.class_id = tt_lesson_plans.class_id
        AND cs.publish_status = 'published'
        AND ca.user_id = auth.uid()
        AND ca.role    = 'student'
    )
  );

CREATE POLICY tt_lesson_plans_admin_or_coord_write
  ON public.tt_lesson_plans FOR ALL
  USING (
    institution_id = public.get_user_institution(auth.uid())
    AND public.tt_user_can_edit_class_slots(auth.uid(), class_id)
  )
  WITH CHECK (
    institution_id = public.get_user_institution(auth.uid())
    AND public.tt_user_can_edit_class_slots(auth.uid(), class_id)
  );

CREATE POLICY tt_lesson_plans_owner_teacher_write
  ON public.tt_lesson_plans FOR ALL
  USING (owner_teacher_id = auth.uid())
  WITH CHECK (owner_teacher_id = auth.uid());

-- -------------------------------------------------------------
-- cal_academic_years — admin write, everyone in institution reads.
-- -------------------------------------------------------------
CREATE POLICY cal_academic_years_select_in_institution
  ON public.cal_academic_years FOR SELECT
  USING (institution_id = public.get_user_institution(auth.uid()));

CREATE POLICY cal_academic_years_admin_write
  ON public.cal_academic_years FOR ALL
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

CREATE POLICY cal_academic_years_super_admin_all
  ON public.cal_academic_years FOR ALL
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

-- -------------------------------------------------------------
-- cal_events — admin write, everyone in institution reads.
-- (Q4.i: only admin can edit; teachers/students/coordinators read.)
-- -------------------------------------------------------------
CREATE POLICY cal_events_select_in_institution
  ON public.cal_events FOR SELECT
  USING (institution_id = public.get_user_institution(auth.uid()));

CREATE POLICY cal_events_admin_write
  ON public.cal_events FOR ALL
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

CREATE POLICY cal_events_super_admin_all
  ON public.cal_events FOR ALL
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

-- -------------------------------------------------------------
-- The helper function is SECURITY DEFINER but must be callable
-- from anon/authenticated to be useful inside RLS policies.
-- -------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.tt_user_can_edit_class_slots(UUID, UUID) TO anon, authenticated;
