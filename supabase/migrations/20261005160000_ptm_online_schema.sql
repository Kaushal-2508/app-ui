-- Online (residential) PTM mode, part 1 of 4: schema. Contract:
-- docs/superpowers/specs/2026-10-03-ptm-online-residential-design.md section 5.1
-- (naman-erp 61a0087a), with two privacy changes made on review (2026-10-05):
--
--  * Meet links live in ptm_booking_meet, NOT on ptm_bookings. The live
--    ptmb_select policy let every member of a school read every booking, so a
--    link stored there would let a student walk into another family's call.
--    The new table has RLS on and no policy; only SECURITY DEFINER RPCs read it.
--    ptmb_select itself is narrowed below: the booking's own student, or staff
--    who may see that class's bookings. Nothing in src/ reads ptm_bookings
--    directly (checked), and no view or SECURITY INVOKER function does.
--  * Google account emails live in user_google_accounts, NOT on profiles.
--    profiles is readable by the whole school and writable by coordinators and
--    staff managers, so a teacher's personal Gmail would leak to students and
--    could be changed by non-admins. Read through get_google_email(), written
--    only by set_google_email() (part 4).
--
-- Ship parts 1 to 4 together (one transaction): the frontend's schema probe
-- reports "online" as soon as ptm_schedules.mode exists, and the RPCs it then
-- calls arrive in part 4.

-- ── ptm_schedules ──────────────────────────────────────────────────────────
ALTER TABLE public.ptm_schedules
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'in_person',
  ADD COLUMN IF NOT EXISTS slot_buffer_minutes integer NOT NULL DEFAULT 0;

ALTER TABLE public.ptm_schedules
  DROP CONSTRAINT IF EXISTS ptm_schedules_mode_check,
  ADD CONSTRAINT ptm_schedules_mode_check CHECK (mode IN ('in_person', 'online')),
  DROP CONSTRAINT IF EXISTS ptm_schedules_slot_buffer_check,
  ADD CONSTRAINT ptm_schedules_slot_buffer_check CHECK (slot_buffer_minutes BETWEEN 0 AND 30),
  -- An online PTM is always slot-booked, class-scoped by its participants (no
  -- junction rows, no wing, no legacy class) and has no venue.
  DROP CONSTRAINT IF EXISTS ptm_schedules_online_shape,
  ADD CONSTRAINT ptm_schedules_online_shape CHECK (
    mode <> 'online' OR (slot_booking_enabled AND scope_type = 'class' AND scope_wing_id IS NULL
                         AND venue IS NULL AND class_id IS NULL));

CREATE INDEX IF NOT EXISTS ptm_schedules_online_date_idx
  ON public.ptm_schedules (scheduled_date) WHERE mode = 'online' AND status = 'scheduled';

-- An online PTM never has class rows: its reach is its participants.
CREATE OR REPLACE FUNCTION public.tg_ptm_schedule_classes_not_online()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ptm_schedules p WHERE p.id = NEW.ptm_id AND p.mode = 'online') THEN
    RAISE EXCEPTION 'An online PTM has no class rows.' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.tg_ptm_schedule_classes_not_online() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS ptm_schedule_classes_not_online ON public.ptm_schedule_classes;
CREATE TRIGGER ptm_schedule_classes_not_online BEFORE INSERT OR UPDATE OF ptm_id ON public.ptm_schedule_classes
  FOR EACH ROW EXECUTE FUNCTION public.tg_ptm_schedule_classes_not_online();

-- ── ptm_online_teachers: who runs a session in an online PTM ───────────────
CREATE TABLE IF NOT EXISTS public.ptm_online_teachers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ptm_id     uuid NOT NULL REFERENCES public.ptm_schedules(id) ON DELETE CASCADE,
  teacher_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  added_by   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ptm_online_teachers_uniq UNIQUE (ptm_id, teacher_id)
);
CREATE INDEX IF NOT EXISTS ptm_online_teachers_teacher_idx ON public.ptm_online_teachers (teacher_id);
CREATE INDEX IF NOT EXISTS ptm_online_teachers_added_by_idx ON public.ptm_online_teachers (added_by);
ALTER TABLE public.ptm_online_teachers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ptm_online_teachers FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.ptm_online_teachers FROM authenticated;
GRANT SELECT ON public.ptm_online_teachers TO authenticated;
-- The PTM list embeds online_teachers:ptm_online_teachers(teacher_id) for staff.
DROP POLICY IF EXISTS ptm_online_teachers_select ON public.ptm_online_teachers;
CREATE POLICY ptm_online_teachers_select ON public.ptm_online_teachers
  FOR SELECT TO authenticated
  USING (public.ptm_class_rows_readable(ptm_id) AND NOT public.has_role((select auth.uid()), 'student'));

-- ── ptm_online_participants: which students a teacher meets ────────────────
CREATE TABLE IF NOT EXISTS public.ptm_online_participants (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ptm_id     uuid NOT NULL,
  student_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  teacher_id uuid NOT NULL,
  class_id   uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  added_by   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ptm_online_participants_one_teacher UNIQUE (ptm_id, student_id),
  -- A swap is one UPDATE of the teacher row; the roster follows.
  CONSTRAINT ptm_online_participants_teacher_fkey FOREIGN KEY (ptm_id, teacher_id)
    REFERENCES public.ptm_online_teachers (ptm_id, teacher_id) ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ptm_online_participants_session_idx ON public.ptm_online_participants (ptm_id, teacher_id);
CREATE INDEX IF NOT EXISTS ptm_online_participants_student_idx ON public.ptm_online_participants (student_id);
CREATE INDEX IF NOT EXISTS ptm_online_participants_class_idx ON public.ptm_online_participants (class_id);
CREATE INDEX IF NOT EXISTS ptm_online_participants_added_by_idx ON public.ptm_online_participants (added_by);
ALTER TABLE public.ptm_online_participants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ptm_online_participants FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.ptm_online_participants FROM authenticated;
GRANT SELECT ON public.ptm_online_participants TO authenticated;
DROP POLICY IF EXISTS ptm_online_participants_select ON public.ptm_online_participants;
CREATE POLICY ptm_online_participants_select ON public.ptm_online_participants
  FOR SELECT TO authenticated
  USING (student_id = (select auth.uid())
         OR (public.ptm_class_rows_readable(ptm_id) AND NOT public.has_role((select auth.uid()), 'student')));

-- ── ptm_bookings: mode, per-teacher slots, the shape rule ──────────────────
ALTER TABLE public.ptm_bookings ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'in_person';
ALTER TABLE public.ptm_bookings
  DROP CONSTRAINT IF EXISTS ptm_bookings_mode_check,
  ADD CONSTRAINT ptm_bookings_mode_check CHECK (mode IN ('in_person', 'online'));

-- In person a slot is per class; online it is per teacher (several teachers
-- of one class each run their own session).
DROP INDEX IF EXISTS public.ptm_bookings_one_per_class_slot;
CREATE UNIQUE INDEX ptm_bookings_one_per_class_slot
  ON public.ptm_bookings (ptm_id, class_id, slot_time) WHERE cancelled_at IS NULL AND mode = 'in_person';
CREATE UNIQUE INDEX IF NOT EXISTS ptm_bookings_one_per_teacher_slot
  ON public.ptm_bookings (ptm_id, teacher_id, slot_time) WHERE cancelled_at IS NULL AND mode = 'online';

-- No CHECK ties mode to teacher_id: a teacher's account delete sets it NULL
-- (ON DELETE SET NULL), and a CHECK would abort the delete (CLAUDE.md 21).
CREATE OR REPLACE FUNCTION public.tg_ptm_bookings_online_shape()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_mode text;
BEGIN
  IF TG_OP = 'UPDATE' AND public.is_user_delete_cascade_update(TG_RELID::regclass, to_jsonb(OLD), to_jsonb(NEW)) THEN
    RETURN NEW;
  END IF;
  SELECT p.mode INTO v_mode FROM public.ptm_schedules p WHERE p.id = NEW.ptm_id;
  IF TG_OP = 'INSERT' THEN
    NEW.mode := COALESCE(v_mode, 'in_person');
  ELSIF NEW.mode IS DISTINCT FROM OLD.mode OR NEW.ptm_id IS DISTINCT FROM OLD.ptm_id
        OR NEW.parent_id IS DISTINCT FROM OLD.parent_id THEN
    RAISE EXCEPTION 'A booking cannot move to another meeting or family.' USING ERRCODE = '22023';
  END IF;
  IF NEW.mode = 'online' THEN
    IF NEW.cancelled_at IS NULL AND (NEW.teacher_id IS NULL OR NOT EXISTS (
         SELECT 1 FROM public.ptm_online_participants op
          WHERE op.ptm_id = NEW.ptm_id AND op.student_id = NEW.parent_id
            AND op.teacher_id = NEW.teacher_id AND op.class_id = NEW.class_id)) THEN
      RAISE EXCEPTION 'An online booking must be with the student''s own teacher.' USING ERRCODE = '22023';
    END IF;
  ELSIF TG_OP = 'INSERT' AND NEW.teacher_id IS NOT NULL THEN
    RAISE EXCEPTION 'An in-person booking has no teacher.' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.tg_ptm_bookings_online_shape() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS tg_ptm_bookings_online_shape ON public.ptm_bookings;
CREATE TRIGGER tg_ptm_bookings_online_shape
  BEFORE INSERT OR UPDATE OF ptm_id, teacher_id, parent_id, class_id, mode, cancelled_at ON public.ptm_bookings
  FOR EACH ROW EXECUTE FUNCTION public.tg_ptm_bookings_online_shape();

-- The booking's own student, or staff who may see that class's bookings
-- (was: every member of the school).
DROP POLICY IF EXISTS ptmb_select ON public.ptm_bookings;
CREATE POLICY ptmb_select ON public.ptm_bookings
  FOR SELECT TO authenticated
  USING (parent_id = (select auth.uid())
         OR public.can_view_ptm_feedback((select auth.uid()), ptm_id, class_id));

-- ── ptm_booking_meet: the Meet room of one online booking (private) ────────
CREATE TABLE IF NOT EXISTS public.ptm_booking_meet (
  booking_id      uuid PRIMARY KEY REFERENCES public.ptm_bookings(id) ON DELETE CASCADE,
  meet_uri        text CHECK (meet_uri IS NULL OR meet_uri ~ '^https://meet\.google\.com/[A-Za-z0-9_-]+$'),
  meet_space_id   text CHECK (meet_space_id IS NULL OR char_length(meet_space_id) <= 200),
  meet_created_at timestamptz,
  meet_claimed_at timestamptz,
  meet_attempts   smallint NOT NULL DEFAULT 0,
  meet_error      text CHECK (meet_error IS NULL OR char_length(meet_error) <= 500),
  meet_cohost_set boolean NOT NULL DEFAULT false,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ptm_booking_meet ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ptm_booking_meet FROM anon, authenticated;

-- ── user_google_accounts: the Google account a staff member joins Meet with ─
CREATE TABLE IF NOT EXISTS public.user_google_accounts (
  user_id      uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  google_email text NOT NULL CHECK (
    google_email = lower(btrim(google_email)) AND char_length(google_email) <= 254
    AND google_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  updated_by   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_google_accounts_updated_by_idx ON public.user_google_accounts (updated_by);
ALTER TABLE public.user_google_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_google_accounts FROM anon, authenticated;

-- ── audit (CLAUDE.md 11) ───────────────────────────────────────────────────
DROP TRIGGER IF EXISTS zzz_audit_ins ON public.ptm_online_teachers;
DROP TRIGGER IF EXISTS zzz_audit_del ON public.ptm_online_teachers;
CREATE TRIGGER zzz_audit_ins AFTER INSERT ON public.ptm_online_teachers
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_row('PTM teacher', '');
CREATE TRIGGER zzz_audit_del AFTER DELETE ON public.ptm_online_teachers
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_row('PTM teacher', '');
DROP TRIGGER IF EXISTS zzz_audit_ins ON public.ptm_online_participants;
DROP TRIGGER IF EXISTS zzz_audit_del ON public.ptm_online_participants;
CREATE TRIGGER zzz_audit_ins AFTER INSERT ON public.ptm_online_participants
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_row('PTM student', '');
CREATE TRIGGER zzz_audit_del AFTER DELETE ON public.ptm_online_participants
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_row('PTM student', '');
DROP TRIGGER IF EXISTS zzz_audit_ins ON public.user_google_accounts;
DROP TRIGGER IF EXISTS zzz_audit_del ON public.user_google_accounts;
CREATE TRIGGER zzz_audit_ins AFTER INSERT ON public.user_google_accounts
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_row('Google account', '');
CREATE TRIGGER zzz_audit_del AFTER DELETE ON public.user_google_accounts
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_row('Google account', '');
