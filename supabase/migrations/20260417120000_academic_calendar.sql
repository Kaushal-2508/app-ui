-- =============================================================
-- ACADEMIC CALENDAR
-- -------------------------------------------------------------
-- Authoritative source of working days / holidays / exam blocks /
-- PTMs / term boundaries / special events for each institution &
-- academic year. Consumed by the timetable module (only working
-- days get timetable slots; holidays + exam blocks auto-grey the
-- grid). Weekends are computed client-side and NOT persisted.
-- =============================================================

-- Enum for the kind of event on a given date
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'academic_event_type') THEN
    CREATE TYPE public.academic_event_type AS ENUM (
      'working_day',
      'holiday',
      'exam_block',
      'term_start',
      'term_end',
      'ptm',
      'special_event'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.academic_calendar (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id  UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  academic_year   TEXT NOT NULL,                         -- e.g. "2025-26"
  title           TEXT NOT NULL,
  date            DATE NOT NULL,
  end_date        DATE,                                  -- optional, for multi-day events
  event_type      public.academic_event_type NOT NULL,
  description     TEXT,
  created_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT academic_calendar_date_range_chk
    CHECK (end_date IS NULL OR end_date >= date)
);

CREATE INDEX IF NOT EXISTS idx_academic_calendar_institution_year
  ON public.academic_calendar(institution_id, academic_year);

CREATE INDEX IF NOT EXISTS idx_academic_calendar_date
  ON public.academic_calendar(institution_id, date);

CREATE INDEX IF NOT EXISTS idx_academic_calendar_event_type
  ON public.academic_calendar(institution_id, event_type);

DROP TRIGGER IF EXISTS update_academic_calendar_updated_at ON public.academic_calendar;
CREATE TRIGGER update_academic_calendar_updated_at
  BEFORE UPDATE ON public.academic_calendar
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ------------------------------------------------------------------
-- Overlap guard: reject a new exam_block that overlaps an existing
-- exam_block within the same institution. Holidays vs. exam_blocks
-- are a soft "confirm" on the UI and are intentionally NOT blocked
-- here. Use COALESCE(end_date, date) to treat single-day events as
-- a one-day span.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_overlapping_exam_blocks()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.event_type = 'exam_block' THEN
    IF EXISTS (
      SELECT 1
      FROM public.academic_calendar ac
      WHERE ac.institution_id = NEW.institution_id
        AND ac.academic_year  = NEW.academic_year
        AND ac.event_type     = 'exam_block'
        AND ac.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
        AND daterange(ac.date, COALESCE(ac.end_date, ac.date), '[]')
         && daterange(NEW.date, COALESCE(NEW.end_date, NEW.date), '[]')
    ) THEN
      RAISE EXCEPTION 'Overlapping exam block exists for this institution and academic year';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_overlapping_exam_blocks_trg ON public.academic_calendar;
CREATE TRIGGER prevent_overlapping_exam_blocks_trg
  BEFORE INSERT OR UPDATE ON public.academic_calendar
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_overlapping_exam_blocks();

-- ------------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------------
ALTER TABLE public.academic_calendar ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super admins manage all academic_calendar" ON public.academic_calendar;
DROP POLICY IF EXISTS "Institution members read academic_calendar" ON public.academic_calendar;
DROP POLICY IF EXISTS "School admins insert academic_calendar"    ON public.academic_calendar;
DROP POLICY IF EXISTS "School admins update academic_calendar"    ON public.academic_calendar;
DROP POLICY IF EXISTS "School admins delete academic_calendar"    ON public.academic_calendar;

-- Super admin: full access across institutions
CREATE POLICY "Super admins manage all academic_calendar"
  ON public.academic_calendar FOR ALL
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

-- All authenticated members of the institution can READ
CREATE POLICY "Institution members read academic_calendar"
  ON public.academic_calendar FOR SELECT
  USING (institution_id = public.get_user_institution(auth.uid()));

-- Only school_admin / super_school_admin can INSERT
CREATE POLICY "School admins insert academic_calendar"
  ON public.academic_calendar FOR INSERT
  WITH CHECK (
    institution_id = public.get_user_institution(auth.uid())
    AND (
      public.has_role(auth.uid(), 'school_admin')
      OR public.has_role(auth.uid(), 'super_school_admin')
    )
  );

-- Only school_admin / super_school_admin can UPDATE
CREATE POLICY "School admins update academic_calendar"
  ON public.academic_calendar FOR UPDATE
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

-- Only school_admin / super_school_admin can DELETE
CREATE POLICY "School admins delete academic_calendar"
  ON public.academic_calendar FOR DELETE
  USING (
    institution_id = public.get_user_institution(auth.uid())
    AND (
      public.has_role(auth.uid(), 'school_admin')
      OR public.has_role(auth.uid(), 'super_school_admin')
    )
  );
