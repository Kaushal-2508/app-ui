-- =====================================================================
-- Attendance Phase 1 schema
-- =====================================================================
-- Lays the groundwork for the unified attendance + substitution flow:
--
--   1. Extends `attendance_settings` with the staff check-in window,
--      late policy, substitution policy, and student-attendance edit
--      window. All columns ship with sensible defaults so flipping the
--      Attendance feature ON yields a working setup with zero clicks.
--
--   2. Adds `staff_attendance_records` — one row per (staff, date)
--      capturing check-in / check-out / status. Used by both the
--      teacher self-check-in card and the admin "auto-mark absent"
--      cron at the daily cutoff.
--
--   3. Extends the existing `tt_substitutions` table for the new
--      auto-flow: nullable substitute (pending state), original
--      teacher denorm, status / source enums, assigned_at, and
--      updated_at. The legacy manual write pattern in
--      `useTimetableV2.useUpsertSubstitution` keeps working — defaults
--      pick up `status='assigned'` / `source='manual'` and a BEFORE
--      INSERT trigger backfills `original_teacher_id` from `tt_slots`.
--
--   4. Adds `attendance_records.substitution_id` so a class taken by
--      a substitute is traceable back to the substitution record.
--
--   5. Adds `attendance_pins` — per-user class shortcuts for the
--      teacher attendance tab.
--
-- Additive only. No existing column types or constraints change in a
-- breaking way; existing RLS on `attendance_records` and
-- `tt_substitutions` keeps applying.

-- ---------------------------------------------------------------------
-- 1. attendance_settings — staff window + sub policy + edit window
-- ---------------------------------------------------------------------
ALTER TABLE public.attendance_settings
  ADD COLUMN IF NOT EXISTS staff_check_in_time           TIME    NOT NULL DEFAULT '08:00:00',
  ADD COLUMN IF NOT EXISTS staff_check_out_time          TIME    NOT NULL DEFAULT '16:00:00',
  ADD COLUMN IF NOT EXISTS staff_late_check_in_allowed   BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS staff_late_grace_minutes      INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS staff_substitution_enabled    BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS max_subs_per_teacher_per_day  INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS coordinators_in_sub_pool      BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS student_attendance_edit_window_hours INTEGER NOT NULL DEFAULT 12;

ALTER TABLE public.attendance_settings
  DROP CONSTRAINT IF EXISTS attendance_settings_grace_chk;
ALTER TABLE public.attendance_settings
  ADD CONSTRAINT attendance_settings_grace_chk
  CHECK (staff_late_grace_minutes BETWEEN 0 AND 240);

ALTER TABLE public.attendance_settings
  DROP CONSTRAINT IF EXISTS attendance_settings_max_subs_chk;
ALTER TABLE public.attendance_settings
  ADD CONSTRAINT attendance_settings_max_subs_chk
  CHECK (max_subs_per_teacher_per_day BETWEEN 0 AND 10);

ALTER TABLE public.attendance_settings
  DROP CONSTRAINT IF EXISTS attendance_settings_edit_window_chk;
ALTER TABLE public.attendance_settings
  ADD CONSTRAINT attendance_settings_edit_window_chk
  CHECK (student_attendance_edit_window_hours BETWEEN 0 AND 168);

ALTER TABLE public.attendance_settings
  DROP CONSTRAINT IF EXISTS attendance_settings_check_window_chk;
ALTER TABLE public.attendance_settings
  ADD CONSTRAINT attendance_settings_check_window_chk
  CHECK (staff_check_out_time > staff_check_in_time);

-- ---------------------------------------------------------------------
-- 2. staff_attendance_records — teacher / coordinator daily check-in
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.staff_attendance_records (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id      UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  staff_id            UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  date                DATE NOT NULL,
  check_in_at         TIMESTAMPTZ,
  check_out_at        TIMESTAMPTZ,
  status              TEXT NOT NULL CHECK (status IN ('present','late','absent','on_leave','holiday')),
  auto_marked_absent  BOOLEAN NOT NULL DEFAULT FALSE,
  remarks             TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT staff_attendance_records_unique UNIQUE (staff_id, date),
  CONSTRAINT staff_attendance_records_checkout_after_checkin
    CHECK (check_out_at IS NULL OR check_in_at IS NULL OR check_out_at >= check_in_at)
);

CREATE INDEX IF NOT EXISTS idx_staff_attendance_records_inst_date
  ON public.staff_attendance_records (institution_id, date);
CREATE INDEX IF NOT EXISTS idx_staff_attendance_records_staff_date
  ON public.staff_attendance_records (staff_id, date);

ALTER TABLE public.staff_attendance_records ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS update_staff_attendance_records_updated_at
  ON public.staff_attendance_records;
CREATE TRIGGER update_staff_attendance_records_updated_at
  BEFORE UPDATE ON public.staff_attendance_records
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- super_admin: full access
DROP POLICY IF EXISTS "super_admin full access staff_attendance"
  ON public.staff_attendance_records;
CREATE POLICY "super_admin full access staff_attendance"
  ON public.staff_attendance_records FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

-- school_admin: full access for their institution
DROP POLICY IF EXISTS "school_admin full access staff_attendance"
  ON public.staff_attendance_records;
CREATE POLICY "school_admin full access staff_attendance"
  ON public.staff_attendance_records FOR ALL TO authenticated
  USING (public.is_institution_admin(auth.uid(), institution_id))
  WITH CHECK (public.is_institution_admin(auth.uid(), institution_id));

-- coordinator: SELECT for staff who teach a class the coordinator coordinates.
-- (Multi-wing teachers visible to every coordinator whose wing they teach in —
-- read-only, so no conflict.)
DROP POLICY IF EXISTS "coordinator select staff_attendance own wing"
  ON public.staff_attendance_records;
CREATE POLICY "coordinator select staff_attendance own wing"
  ON public.staff_attendance_records FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'coordinator')
    AND institution_id = public.get_user_institution(auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.class_assignments ca_t
      WHERE ca_t.user_id = staff_attendance_records.staff_id
        AND ca_t.role = 'teacher'
        AND EXISTS (
          SELECT 1
          FROM public.class_assignments ca_c
          WHERE ca_c.user_id = auth.uid()
            AND ca_c.role = 'coordinator'
            AND ca_c.class_id = ca_t.class_id
        )
    )
  );

-- staff: SELECT own row
DROP POLICY IF EXISTS "staff select own staff_attendance"
  ON public.staff_attendance_records;
CREATE POLICY "staff select own staff_attendance"
  ON public.staff_attendance_records FOR SELECT TO authenticated
  USING (staff_id = auth.uid());

-- staff: INSERT own row (self check-in)
DROP POLICY IF EXISTS "staff insert own staff_attendance"
  ON public.staff_attendance_records;
CREATE POLICY "staff insert own staff_attendance"
  ON public.staff_attendance_records FOR INSERT TO authenticated
  WITH CHECK (
    staff_id = auth.uid()
    AND institution_id = public.get_user_institution(auth.uid())
  );

-- staff: UPDATE own row (self check-out, remarks edit)
DROP POLICY IF EXISTS "staff update own staff_attendance"
  ON public.staff_attendance_records;
CREATE POLICY "staff update own staff_attendance"
  ON public.staff_attendance_records FOR UPDATE TO authenticated
  USING (staff_id = auth.uid())
  WITH CHECK (staff_id = auth.uid());

-- ---------------------------------------------------------------------
-- 3. tt_substitutions — pending/auto flow extension
-- ---------------------------------------------------------------------
ALTER TABLE public.tt_substitutions
  ADD COLUMN IF NOT EXISTS original_teacher_id  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status               TEXT NOT NULL DEFAULT 'assigned',
  ADD COLUMN IF NOT EXISTS source               TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS assigned_by          UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_reason     TEXT,
  ADD COLUMN IF NOT EXISTS updated_at           TIMESTAMPTZ NOT NULL DEFAULT now();

-- Allow pending rows with no substitute yet (auto flow inserts these).
ALTER TABLE public.tt_substitutions
  ALTER COLUMN substitute_teacher_id DROP NOT NULL;

ALTER TABLE public.tt_substitutions
  DROP CONSTRAINT IF EXISTS tt_substitutions_status_chk;
ALTER TABLE public.tt_substitutions
  ADD CONSTRAINT tt_substitutions_status_chk
  CHECK (status IN ('pending','assigned','completed','cancelled','no_teacher_available'));

ALTER TABLE public.tt_substitutions
  DROP CONSTRAINT IF EXISTS tt_substitutions_source_chk;
ALTER TABLE public.tt_substitutions
  ADD CONSTRAINT tt_substitutions_source_chk
  CHECK (source IN ('manual','auto'));

-- An assigned/completed row must have a substitute; pending /
-- cancelled / no_teacher_available may not.
ALTER TABLE public.tt_substitutions
  DROP CONSTRAINT IF EXISTS tt_substitutions_assigned_has_sub_chk;
ALTER TABLE public.tt_substitutions
  ADD CONSTRAINT tt_substitutions_assigned_has_sub_chk
  CHECK (
    status IN ('pending','cancelled','no_teacher_available')
    OR substitute_teacher_id IS NOT NULL
  );

-- Backfill original_teacher_id for legacy rows.
UPDATE public.tt_substitutions ts
SET original_teacher_id = s.teacher_id
FROM public.tt_slots s
WHERE ts.slot_id = s.id
  AND ts.original_teacher_id IS NULL;

-- BEFORE INSERT trigger: auto-populate original_teacher_id when caller
-- (e.g. legacy useUpsertSubstitution) does not provide one. Keeps the
-- existing manual flow source-compatible.
CREATE OR REPLACE FUNCTION public.tt_substitutions_set_original_teacher()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.original_teacher_id IS NULL THEN
    SELECT s.teacher_id INTO NEW.original_teacher_id
    FROM public.tt_slots s
    WHERE s.id = NEW.slot_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tt_substitutions_set_original_teacher_trg
  ON public.tt_substitutions;
CREATE TRIGGER tt_substitutions_set_original_teacher_trg
  BEFORE INSERT ON public.tt_substitutions
  FOR EACH ROW
  EXECUTE FUNCTION public.tt_substitutions_set_original_teacher();

-- updated_at trigger.
DROP TRIGGER IF EXISTS update_tt_substitutions_updated_at
  ON public.tt_substitutions;
CREATE TRIGGER update_tt_substitutions_updated_at
  BEFORE UPDATE ON public.tt_substitutions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_tt_substitutions_original_date
  ON public.tt_substitutions (original_teacher_id, date)
  WHERE original_teacher_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tt_substitutions_status_date
  ON public.tt_substitutions (status, date);

-- ---------------------------------------------------------------------
-- 4. attendance_records.substitution_id — back-reference for traceability
-- ---------------------------------------------------------------------
ALTER TABLE public.attendance_records
  ADD COLUMN IF NOT EXISTS substitution_id UUID
    REFERENCES public.tt_substitutions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_attendance_records_substitution
  ON public.attendance_records (substitution_id)
  WHERE substitution_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- 5. attendance_pins — per-user class shortcuts (DB-side so they
--    follow the user across devices)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.attendance_pins (
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  class_id   UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  pinned_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, class_id)
);

CREATE INDEX IF NOT EXISTS idx_attendance_pins_user
  ON public.attendance_pins (user_id, pinned_at DESC);

ALTER TABLE public.attendance_pins ENABLE ROW LEVEL SECURITY;

-- Users manage their own pins only.
DROP POLICY IF EXISTS "users manage own attendance_pins"
  ON public.attendance_pins;
CREATE POLICY "users manage own attendance_pins"
  ON public.attendance_pins FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
