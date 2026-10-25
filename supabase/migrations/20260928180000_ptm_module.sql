-- PTM module: scheduling by hat, slot booking, family feedback with voice
-- notes, dashboard. Contract: docs/superpowers/specs/2026-09-28-ptm-module-design.md
-- (Naman's frontend on naman-erp, a23e0878, calls exactly these names).
--
-- This migration is ADDITIVE so the PTM screens that are live today keep
-- working until the new frontend deploys: the legacy booking dialog inserts
-- into ptm_bookings directly and the legacy panel updates ptm_schedules
-- directly. The tightening (ptm_bookings.class_id NOT NULL, no direct writes,
-- ptm_update on can_manage_ptm) is 20260928183000, applied after the deploy
-- (CLAUDE.md §2 ship order).
--
-- Differences from the spec's draft, all deliberate:
--   * ptm_bookings.parent_id was already ON DELETE CASCADE and teacher_id
--     CASCADE (the spec thought both were NO ACTION); teacher_id becomes SET
--     NULL (authorship column, §21).
--   * create_ptm_schedule keeps the 8 legacy parameters FIRST and gives the 7
--     new ones defaults, so the live dialog's 8-argument call still resolves.
--   * ptm_classes_for_hat is internal (not granted to authenticated): it takes
--     a user id, and the frontend never calls it; ptm_manageable_scope is the
--     public face.
--   * Ratings are passed as integer (PostgREST resolves JSON numbers more
--     predictably than smallint) and stored as smallint.
--   * A coordinator must hold the coordinator ROLE in the school, not only a
--     wing_assignments row (is_coordinator_for_class checks neither).

-- ═════════════════════════════════════════════════════════════════════════
-- 1. ptm_schedules: new columns
-- ═════════════════════════════════════════════════════════════════════════
ALTER TABLE public.ptm_schedules
  ADD COLUMN IF NOT EXISTS created_as_role text NOT NULL DEFAULT 'admin',
  ADD COLUMN IF NOT EXISTS venue text,
  ADD COLUMN IF NOT EXISTS scope_type text NOT NULL DEFAULT 'school',
  ADD COLUMN IF NOT EXISTS scope_wing_id uuid REFERENCES public.wings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS slot_booking_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS booking_cutoff_minutes integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS feedback_edit_days integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS feedback_token text NOT NULL DEFAULT encode(extensions.gen_random_bytes(16), 'hex'),
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancel_reason text;

-- Legacy rows: class-scoped when they name classes, school-wide otherwise.
UPDATE public.ptm_schedules s
   SET scope_type = 'class'
 WHERE s.class_id IS NOT NULL
    OR EXISTS (SELECT 1 FROM public.ptm_schedule_classes c WHERE c.ptm_id = s.id);

ALTER TABLE public.ptm_schedules
  ADD CONSTRAINT ptm_schedules_created_as_role_check CHECK (created_as_role IN ('admin', 'coordinator', 'teacher')),
  ADD CONSTRAINT ptm_schedules_scope_type_check CHECK (scope_type IN ('school', 'wing', 'class')),
  ADD CONSTRAINT ptm_schedules_booking_cutoff_check CHECK (booking_cutoff_minutes BETWEEN 0 AND 1440),
  ADD CONSTRAINT ptm_schedules_feedback_edit_days_check CHECK (feedback_edit_days BETWEEN 0 AND 30),
  ADD CONSTRAINT ptm_schedules_cancel_reason_check CHECK (cancel_reason IS NULL OR char_length(cancel_reason) <= 300),
  ADD CONSTRAINT ptm_schedules_status_check CHECK (status IN ('scheduled', 'cancelled')),
  ADD CONSTRAINT ptm_schedules_feedback_token_key UNIQUE (feedback_token);

CREATE INDEX IF NOT EXISTS ptm_schedules_scope_wing_idx ON public.ptm_schedules (scope_wing_id);
CREATE INDEX IF NOT EXISTS ptm_schedules_cancelled_by_idx ON public.ptm_schedules (cancelled_by);
CREATE INDEX IF NOT EXISTS ptm_schedules_created_by_idx ON public.ptm_schedules (created_by);
CREATE INDEX IF NOT EXISTS ptm_schedules_class_id_idx ON public.ptm_schedules (class_id);

-- ═════════════════════════════════════════════════════════════════════════
-- 2. ptm_bookings: class, attendance, soft cancel, one-per rules
-- ═════════════════════════════════════════════════════════════════════════
ALTER TABLE public.ptm_bookings
  ADD COLUMN IF NOT EXISTS class_id uuid REFERENCES public.classes(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS attended boolean,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

-- Backfill the class from the student's single class row, else the PTM's
-- single class. NOT NULL is set in the follow-up once the legacy dialog
-- (which inserts without a class) is gone.
UPDATE public.ptm_bookings b
   SET class_id = sub.class_id
  FROM (
    SELECT b2.id,
           COALESCE(
             (SELECT min(ca.class_id::text)::uuid FROM public.class_assignments ca
               WHERE ca.user_id = b2.parent_id AND ca.role = 'student'
              HAVING count(*) = 1),
             (SELECT min(sc.class_id::text)::uuid FROM public.ptm_schedule_classes sc
               WHERE sc.ptm_id = b2.ptm_id HAVING count(*) = 1)
           ) AS class_id
      FROM public.ptm_bookings b2
     WHERE b2.class_id IS NULL
  ) sub
 WHERE sub.id = b.id AND sub.class_id IS NOT NULL;

-- One active booking per student per PTM: a legacy student held two for one
-- PTM. Keep the newest, soft-cancel the rest, before the unique index.
UPDATE public.ptm_bookings b
   SET cancelled_at = now(), status = 'cancelled'
 WHERE b.cancelled_at IS NULL
   AND EXISTS (SELECT 1 FROM public.ptm_bookings n
                WHERE n.ptm_id = b.ptm_id AND n.parent_id = b.parent_id
                  AND n.cancelled_at IS NULL
                  AND (n.created_at, n.id) > (b.created_at, b.id));

CREATE UNIQUE INDEX IF NOT EXISTS ptm_bookings_one_per_student
  ON public.ptm_bookings (ptm_id, parent_id) WHERE cancelled_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ptm_bookings_one_per_class_slot
  ON public.ptm_bookings (ptm_id, class_id, slot_time) WHERE cancelled_at IS NULL;
CREATE INDEX IF NOT EXISTS ptm_bookings_class_idx ON public.ptm_bookings (class_id);
CREATE INDEX IF NOT EXISTS ptm_bookings_parent_idx ON public.ptm_bookings (parent_id);
CREATE INDEX IF NOT EXISTS ptm_bookings_teacher_idx ON public.ptm_bookings (teacher_id);

-- teacher_id is authorship, not ownership (§21): deleting a teacher must not
-- delete a family's booking.
ALTER TABLE public.ptm_bookings DROP CONSTRAINT IF EXISTS ptm_bookings_teacher_id_fkey;
ALTER TABLE public.ptm_bookings
  ADD CONSTRAINT ptm_bookings_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- ═════════════════════════════════════════════════════════════════════════
-- 3. ptm_feedback (new)
-- ═════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.ptm_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ptm_id uuid NOT NULL REFERENCES public.ptm_schedules(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  submitted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  text_message text CHECK (text_message IS NULL OR char_length(text_message) <= 1000),
  audio_path text,
  audio_duration_seconds integer CHECK (audio_duration_seconds IS NULL OR audio_duration_seconds BETWEEN 1 AND 120),
  audio_format text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ptm_feedback_one_per_student UNIQUE (ptm_id, student_id),
  CONSTRAINT ptm_feedback_audio_path_prefix CHECK (
    audio_path IS NULL OR audio_path LIKE ptm_id::text || '/' || student_id::text || '/%')
);
CREATE INDEX IF NOT EXISTS ptm_feedback_student_idx ON public.ptm_feedback (student_id);
CREATE INDEX IF NOT EXISTS ptm_feedback_class_idx ON public.ptm_feedback (class_id);
CREATE INDEX IF NOT EXISTS ptm_feedback_submitted_by_idx ON public.ptm_feedback (submitted_by);
ALTER TABLE public.ptm_feedback ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ptm_feedback FROM anon;

-- Activity audit (CLAUDE.md §11): every user-facing table gets the trigger.
DROP TRIGGER IF EXISTS zzz_audit_ins ON public.ptm_feedback;
DROP TRIGGER IF EXISTS zzz_audit_del ON public.ptm_feedback;
CREATE TRIGGER zzz_audit_ins AFTER INSERT ON public.ptm_feedback
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_row('PTM feedback', '');
CREATE TRIGGER zzz_audit_del AFTER DELETE ON public.ptm_feedback
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_row('PTM feedback', '');
DROP TRIGGER IF EXISTS zzz_audit_ins ON public.ptm_schedules;
DROP TRIGGER IF EXISTS zzz_audit_del ON public.ptm_schedules;
CREATE TRIGGER zzz_audit_ins AFTER INSERT ON public.ptm_schedules
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_row('PTM', 'title');
CREATE TRIGGER zzz_audit_del AFTER DELETE ON public.ptm_schedules
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_row('PTM', 'title');

-- ═════════════════════════════════════════════════════════════════════════
-- 4. Helpers
-- ═════════════════════════════════════════════════════════════════════════

-- The classes a PTM is for: junction rows plus the legacy single class_id;
-- none means school-wide, i.e. every active class of the institution. Always
-- joined through classes so another school's class can never resolve.
CREATE OR REPLACE FUNCTION public.ptm_effective_class_ids(_ptm_id uuid)
RETURNS TABLE(class_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH p AS (SELECT s.id, s.institution_id, s.class_id FROM public.ptm_schedules s WHERE s.id = _ptm_id),
  named AS (
    SELECT sc.class_id FROM public.ptm_schedule_classes sc JOIN p ON p.id = sc.ptm_id
    UNION
    SELECT p.class_id FROM p WHERE p.class_id IS NOT NULL
  )
  SELECT c.id FROM p JOIN public.classes c ON c.institution_id = p.institution_id
   WHERE c.id IN (SELECT n.class_id FROM named n)
  UNION
  SELECT c.id FROM p JOIN public.classes c ON c.institution_id = p.institution_id AND c.is_active IS NOT FALSE
   WHERE NOT EXISTS (SELECT 1 FROM named);
$$;

-- A class teacher: a subject-less teacher row on the class, the teacher role,
-- an active profile (the definition the coordinator desk already uses).
CREATE OR REPLACE FUNCTION public.is_class_teacher_of(_user uuid, _class uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT _user IS NOT NULL AND _class IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.class_assignments ca
                   JOIN public.profiles p ON p.id = ca.user_id
                  WHERE ca.user_id = _user AND ca.class_id = _class
                    AND ca.role = 'teacher' AND ca.subject_id IS NULL
                    AND p.is_active IS NOT FALSE)
     AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = _user AND r.role = 'teacher');
$$;

-- Does _user wear _hat in _institution? admin = is_institution_admin;
-- coordinator / teacher = that role row in that school and a profile there.
CREATE OR REPLACE FUNCTION public._ptm_has_hat(_user uuid, _institution uuid, _hat text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT _user IS NOT NULL AND _institution IS NOT NULL AND CASE _hat
    WHEN 'admin' THEN public.is_institution_admin(_user, _institution)
    WHEN 'coordinator' THEN EXISTS (
      SELECT 1 FROM public.user_roles r JOIN public.profiles p ON p.id = r.user_id
       WHERE r.user_id = _user AND r.role = 'coordinator'
         AND r.institution_id = _institution AND p.institution_id = _institution)
    WHEN 'teacher' THEN EXISTS (
      SELECT 1 FROM public.user_roles r JOIN public.profiles p ON p.id = r.user_id
       WHERE r.user_id = _user AND r.role = 'teacher'
         AND r.institution_id = _institution AND p.institution_id = _institution)
    ELSE false END;
$$;

-- The student's one class (exactly one student row), else NULL.
CREATE OR REPLACE FUNCTION public._ptm_student_class(_user uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE WHEN count(*) = 1 THEN min(ca.class_id::text)::uuid END
    FROM public.class_assignments ca
   WHERE ca.user_id = _user AND ca.role = 'student';
$$;

-- The classes a hat may act on. Raises when the caller does not wear it.
CREATE OR REPLACE FUNCTION public.ptm_classes_for_hat(_user uuid, _hat text)
RETURNS TABLE(class_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_inst uuid := public.get_user_institution(_user);
BEGIN
  IF NOT public._ptm_has_hat(_user, v_inst, _hat) THEN
    RAISE EXCEPTION 'You don''t hold that role at this school.' USING ERRCODE = '42501';
  END IF;
  IF _hat = 'admin' THEN
    RETURN QUERY SELECT c.id FROM public.classes c
                  WHERE c.institution_id = v_inst AND c.is_active IS NOT FALSE;
  ELSIF _hat = 'coordinator' THEN
    RETURN QUERY SELECT DISTINCT c.id
      FROM public.wing_assignments wa
      JOIN public.wings w ON w.id = wa.wing_id AND w.institution_id = v_inst AND w.is_active IS NOT FALSE
      JOIN public.wing_class_mappings wcm ON wcm.wing_id = wa.wing_id
      JOIN public.classes c ON c.id = wcm.class_id AND c.institution_id = v_inst AND c.is_active IS NOT FALSE
     WHERE wa.user_id = _user;
  ELSE
    RETURN QUERY SELECT DISTINCT c.id
      FROM public.class_assignments ca
      JOIN public.classes c ON c.id = ca.class_id AND c.institution_id = v_inst AND c.is_active IS NOT FALSE
     WHERE ca.user_id = _user AND ca.role = 'teacher' AND ca.subject_id IS NULL
       AND public.is_class_teacher_of(_user, ca.class_id);
  END IF;
END;
$$;

-- Who may edit or cancel: "the creator, and anyone with higher rights over
-- that scope". Never for a cancelled PTM.
CREATE OR REPLACE FUNCTION public.can_manage_ptm(_user uuid, _ptm uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.ptm_schedules p
     WHERE p.id = _ptm AND _user IS NOT NULL AND p.status <> 'cancelled'
       AND (
         public.is_institution_admin(_user, p.institution_id)
         OR (
           public._ptm_has_hat(_user, p.institution_id, 'coordinator')
           AND p.scope_type IN ('wing', 'class')
           AND EXISTS (SELECT 1 FROM public.ptm_effective_class_ids(p.id))
           AND NOT EXISTS (SELECT 1 FROM public.ptm_effective_class_ids(p.id) e
                            WHERE NOT public.is_coordinator_for_class(_user, e.class_id))
           AND (p.created_as_role = 'teacher'
                OR (p.created_as_role = 'coordinator' AND p.created_by = _user))
         )
         OR (
           public._ptm_has_hat(_user, p.institution_id, 'teacher')
           AND p.scope_type = 'class' AND p.created_as_role = 'teacher' AND p.created_by = _user
           AND EXISTS (SELECT 1 FROM public.ptm_effective_class_ids(p.id))
           AND NOT EXISTS (SELECT 1 FROM public.ptm_effective_class_ids(p.id) e
                            WHERE NOT public.is_class_teacher_of(_user, e.class_id))
         )
       )
  );
$$;

-- Who may see a class's feedback, grid names and attendance for a PTM.
CREATE OR REPLACE FUNCTION public.can_view_ptm_feedback(_user uuid, _ptm uuid, _class uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.ptm_schedules p
     WHERE p.id = _ptm AND _user IS NOT NULL AND _class IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.ptm_effective_class_ids(p.id) e WHERE e.class_id = _class)
       AND (
         public.is_institution_admin(_user, p.institution_id)
         OR (public._ptm_has_hat(_user, p.institution_id, 'coordinator')
             AND public.is_coordinator_for_class(_user, _class))
         OR public.is_class_teacher_of(_user, _class)
       )
  );
$$;

-- Storage: object names are <ptm_id>/<student_id>/<file>. A malformed name
-- yields NULL, never an error (the avatar_owner_from_path pattern).
CREATE OR REPLACE FUNCTION public._ptm_audio_segment(_name text, _n integer)
RETURNS uuid
LANGUAGE plpgsql IMMUTABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN split_part(coalesce(_name, ''), '/', _n)::uuid;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.ptm_audio_writable(_user uuid, _name text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT _user IS NOT NULL
     AND public._ptm_audio_segment(_name, 2) = _user
     AND public.has_role(_user, 'student')
     AND EXISTS (SELECT 1 FROM public.ptm_schedules p
                  WHERE p.id = public._ptm_audio_segment(_name, 1)
                    AND p.institution_id = public.get_user_institution(_user))
     AND public.ptm_includes_user_class(public._ptm_audio_segment(_name, 1), _user);
$$;

CREATE OR REPLACE FUNCTION public.ptm_audio_readable(_user uuid, _name text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT _user IS NOT NULL AND (
    public._ptm_audio_segment(_name, 2) = _user
    OR EXISTS (
      SELECT 1 FROM public.ptm_feedback f
       WHERE f.ptm_id = public._ptm_audio_segment(_name, 1)
         AND f.student_id = public._ptm_audio_segment(_name, 2)
         AND public.can_view_ptm_feedback(_user, f.ptm_id, f.class_id))
  );
$$;

-- Feedback window and context for one PTM as a given caller.
CREATE OR REPLACE FUNCTION public._ptm_window(_ptm_id uuid)
RETURNS TABLE(opens_at timestamptz, closes_at timestamptz, window_state text, booking_closes_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT (p.scheduled_date + p.start_time) AT TIME ZONE COALESCE(i.timezone, 'Asia/Kolkata'),
         ((p.scheduled_date + p.end_time) + make_interval(days => p.feedback_edit_days))
           AT TIME ZONE COALESCE(i.timezone, 'Asia/Kolkata'),
         CASE
           WHEN p.status = 'cancelled' THEN 'cancelled'
           WHEN now() < (p.scheduled_date + p.start_time) AT TIME ZONE COALESCE(i.timezone, 'Asia/Kolkata') THEN 'not_open'
           WHEN now() > ((p.scheduled_date + p.end_time) + make_interval(days => p.feedback_edit_days))
                          AT TIME ZONE COALESCE(i.timezone, 'Asia/Kolkata') THEN 'closed'
           ELSE 'open'
         END,
         ((p.scheduled_date + p.start_time) - make_interval(mins => p.booking_cutoff_minutes))
           AT TIME ZONE COALESCE(i.timezone, 'Asia/Kolkata')
    FROM public.ptm_schedules p JOIN public.institutions i ON i.id = p.institution_id
   WHERE p.id = _ptm_id;
$$;

CREATE OR REPLACE FUNCTION public._ptm_class_teacher_names(_class uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT string_agg(DISTINCT pr.full_name, ', ')
    FROM public.class_assignments ca
    JOIN public.profiles pr ON pr.id = ca.user_id
   WHERE ca.class_id = _class AND ca.role = 'teacher' AND ca.subject_id IS NULL
     AND pr.is_active IS NOT FALSE
     AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = ca.user_id AND r.role = 'teacher');
$$;

CREATE OR REPLACE FUNCTION public._ptm_feedback_context(_user uuid, _ptm_id uuid)
RETURNS TABLE(ptm_id uuid, title text, description text, venue text, scheduled_date date,
              start_time time, end_time time, status text, scope_type text, feedback_token text,
              feedback_edit_days integer, my_class_id uuid, my_class_name text, my_class_section text,
              class_teachers text, window_state text, opens_at timestamptz, closes_at timestamptz,
              my_feedback jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_student boolean := public.has_role(_user, 'student');
  v_class uuid;
BEGIN
  IF v_is_student THEN
    v_class := public._ptm_student_class(_user);
    IF v_class IS NULL OR NOT EXISTS (SELECT 1 FROM public.ptm_effective_class_ids(_ptm_id) e WHERE e.class_id = v_class) THEN
      RETURN;  -- not in scope: indistinguishable from "no such meeting"
    END IF;
  END IF;

  RETURN QUERY
  SELECT p.id, p.title, p.description, p.venue, p.scheduled_date, p.start_time, p.end_time,
         p.status, p.scope_type, p.feedback_token, p.feedback_edit_days,
         CASE WHEN v_is_student THEN c.id END,
         CASE WHEN v_is_student THEN c.name END,
         CASE WHEN v_is_student THEN c.section END,
         CASE WHEN v_is_student THEN public._ptm_class_teacher_names(v_class) END,
         w.window_state, w.opens_at, w.closes_at,
         CASE WHEN v_is_student THEN (
           SELECT jsonb_build_object('id', f.id, 'rating', f.rating, 'text_message', f.text_message,
                    'audio_path', f.audio_path, 'audio_duration_seconds', f.audio_duration_seconds,
                    'audio_format', f.audio_format, 'submitted_at', f.submitted_at, 'updated_at', f.updated_at)
             FROM public.ptm_feedback f WHERE f.ptm_id = p.id AND f.student_id = _user) END
    FROM public.ptm_schedules p
    CROSS JOIN LATERAL public._ptm_window(p.id) w
    LEFT JOIN public.classes c ON c.id = v_class
   WHERE p.id = _ptm_id
     AND p.institution_id = public.get_user_institution(_user);
END;
$$;

-- The scope a hat has for one PTM's dashboard: the PTM's classes the hat may
-- act on. A school-wide PTM keeps only classes with at least one student.
CREATE OR REPLACE FUNCTION public._ptm_dashboard_classes(_user uuid, _ptm_id uuid, _hat text)
RETURNS TABLE(class_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_scope text;
BEGIN
  SELECT p.scope_type INTO v_scope FROM public.ptm_schedules p
   WHERE p.id = _ptm_id AND p.institution_id = public.get_user_institution(_user);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Meeting not found.' USING ERRCODE = 'P0002';
  END IF;
  RETURN QUERY
  SELECT e.class_id FROM public.ptm_effective_class_ids(_ptm_id) e
   WHERE e.class_id IN (SELECT h.class_id FROM public.ptm_classes_for_hat(_user, _hat) h)
     AND (v_scope <> 'school' OR EXISTS (
           SELECT 1 FROM public.class_assignments ca JOIN public.profiles pr ON pr.id = ca.user_id
            WHERE ca.class_id = e.class_id AND ca.role = 'student' AND pr.is_active IS NOT FALSE));
END;
$$;

-- ═════════════════════════════════════════════════════════════════════════
-- 5. RPCs
-- ═════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.ptm_manageable_scope(_as_role text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_inst uuid := public.get_user_institution(auth.uid());
  v_classes jsonb;
  v_wings jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in.' USING ERRCODE = '42501'; END IF;
  IF _as_role NOT IN ('admin', 'coordinator', 'teacher') THEN
    RAISE EXCEPTION 'Unknown role.' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'section', c.section,
                   'wing_id', (SELECT min(wcm.wing_id::text)::uuid FROM public.wing_class_mappings wcm WHERE wcm.class_id = c.id))
                   ORDER BY c.name, c.section), '[]'::jsonb)
    INTO v_classes
    FROM public.classes c
   WHERE c.id IN (SELECT h.class_id FROM public.ptm_classes_for_hat(v_uid, _as_role) h);

  IF _as_role = 'teacher' THEN
    v_wings := '[]'::jsonb;
  ELSE
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', w.id, 'name', w.name,
             'class_ids', (SELECT COALESCE(jsonb_agg(wcm.class_id), '[]'::jsonb)
                             FROM public.wing_class_mappings wcm
                             JOIN public.classes c ON c.id = wcm.class_id AND c.is_active IS NOT FALSE
                            WHERE wcm.wing_id = w.id))
             ORDER BY w.display_order NULLS LAST, w.name), '[]'::jsonb)
      INTO v_wings
      FROM public.wings w
     WHERE w.institution_id = v_inst AND w.is_active IS NOT FALSE
       AND (_as_role = 'admin'
            OR EXISTS (SELECT 1 FROM public.wing_assignments wa WHERE wa.wing_id = w.id AND wa.user_id = v_uid));
  END IF;

  RETURN jsonb_build_object('can_school', _as_role = 'admin', 'wings', v_wings, 'classes', v_classes);
END;
$$;

-- Replaces the 2026-09-15 admin-only version. The 8 legacy parameters stay
-- first and the 7 new ones have defaults, so the live dialog's call resolves.
DROP FUNCTION IF EXISTS public.create_ptm_schedule(uuid, text, text, date, time, time, integer, uuid[]);
CREATE OR REPLACE FUNCTION public.create_ptm_schedule(
  _institution_id uuid, _title text, _description text, _scheduled_date date,
  _start_time time, _end_time time, _slot_duration_minutes integer, _class_ids uuid[],
  _as_role text DEFAULT 'admin', _scope_type text DEFAULT NULL, _scope_wing_id uuid DEFAULT NULL,
  _venue text DEFAULT NULL, _slot_booking_enabled boolean DEFAULT false,
  _booking_cutoff_minutes integer DEFAULT 60, _feedback_edit_days integer DEFAULT 3)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_scope text;
  v_classes uuid[];
  v_ptm uuid;
  v_duration integer := COALESCE(_slot_duration_minutes, 15);
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in.' USING ERRCODE = '42501'; END IF;
  IF _as_role IS NULL OR _as_role NOT IN ('admin', 'coordinator', 'teacher') THEN
    RAISE EXCEPTION 'Unknown role.' USING ERRCODE = '22023';
  END IF;
  IF NOT public._ptm_has_hat(v_uid, _institution_id, _as_role) THEN
    RAISE EXCEPTION 'You can''t schedule a PTM with that role at this school.' USING ERRCODE = '42501';
  END IF;

  v_scope := COALESCE(_scope_type,
                      CASE WHEN _class_ids IS NOT NULL AND array_length(_class_ids, 1) IS NOT NULL
                           THEN 'class' ELSE 'school' END);
  IF v_scope NOT IN ('school', 'wing', 'class') THEN
    RAISE EXCEPTION 'Unknown scope.' USING ERRCODE = '22023';
  END IF;
  IF _title IS NULL OR btrim(_title) = '' THEN
    RAISE EXCEPTION 'Give the PTM a title.' USING ERRCODE = '22023';
  END IF;
  IF _start_time IS NULL OR _end_time IS NULL OR _end_time <= _start_time THEN
    RAISE EXCEPTION 'The end time must be after the start time.' USING ERRCODE = '22023';
  END IF;
  IF v_duration NOT BETWEEN 5 AND 60 THEN
    RAISE EXCEPTION 'A slot must be 5 to 60 minutes long.' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(_booking_cutoff_minutes, 60) NOT BETWEEN 0 AND 1440 THEN
    RAISE EXCEPTION 'The booking cutoff must be 0 to 1440 minutes.' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(_feedback_edit_days, 3) NOT BETWEEN 0 AND 30 THEN
    RAISE EXCEPTION 'The feedback window must be 0 to 30 days.' USING ERRCODE = '22023';
  END IF;

  IF v_scope = 'school' THEN
    IF _as_role <> 'admin' THEN
      RAISE EXCEPTION 'Only a school admin can schedule a school-wide PTM.' USING ERRCODE = '42501';
    END IF;
    v_classes := ARRAY[]::uuid[];
  ELSIF v_scope = 'wing' THEN
    IF _scope_wing_id IS NULL
       OR NOT EXISTS (SELECT 1 FROM public.wings w WHERE w.id = _scope_wing_id
                         AND w.institution_id = _institution_id AND w.is_active IS NOT FALSE) THEN
      RAISE EXCEPTION 'Pick a wing of this school.' USING ERRCODE = '22023';
    END IF;
    IF _as_role = 'teacher'
       OR (_as_role = 'coordinator' AND NOT EXISTS (SELECT 1 FROM public.wing_assignments wa
                                                     WHERE wa.wing_id = _scope_wing_id AND wa.user_id = v_uid)) THEN
      RAISE EXCEPTION 'You can only schedule a PTM for a wing you coordinate.' USING ERRCODE = '42501';
    END IF;
    SELECT COALESCE(array_agg(DISTINCT c.id), ARRAY[]::uuid[]) INTO v_classes
      FROM public.wing_class_mappings wcm
      JOIN public.classes c ON c.id = wcm.class_id AND c.institution_id = _institution_id AND c.is_active IS NOT FALSE
     WHERE wcm.wing_id = _scope_wing_id;
    IF array_length(v_classes, 1) IS NULL THEN
      RAISE EXCEPTION 'This wing has no classes yet.' USING ERRCODE = '22023';
    END IF;
  ELSE
    IF _class_ids IS NULL OR array_length(_class_ids, 1) IS NULL THEN
      RAISE EXCEPTION 'Pick at least one class.' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(_class_ids) cid
                WHERE NOT EXISTS (SELECT 1 FROM public.classes c
                                   WHERE c.id = cid AND c.institution_id = _institution_id)) THEN
      RAISE EXCEPTION 'One of the selected classes does not belong to this school.' USING ERRCODE = '42501';
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(_class_ids) cid
                WHERE cid NOT IN (SELECT h.class_id FROM public.ptm_classes_for_hat(v_uid, _as_role) h)) THEN
      RAISE EXCEPTION 'You can only schedule a PTM for your own classes.' USING ERRCODE = '42501';
    END IF;
    SELECT array_agg(DISTINCT cid) INTO v_classes FROM unnest(_class_ids) cid;
  END IF;

  INSERT INTO public.ptm_schedules
    (institution_id, title, description, scheduled_date, start_time, end_time, slot_duration_minutes,
     created_by, created_as_role, venue, scope_type, scope_wing_id, slot_booking_enabled,
     booking_cutoff_minutes, feedback_edit_days)
  VALUES (_institution_id, btrim(_title), NULLIF(btrim(COALESCE(_description, '')), ''), _scheduled_date,
          _start_time, _end_time, v_duration, v_uid, _as_role, NULLIF(btrim(COALESCE(_venue, '')), ''),
          v_scope, CASE WHEN v_scope = 'wing' THEN _scope_wing_id END,
          COALESCE(_slot_booking_enabled, false), COALESCE(_booking_cutoff_minutes, 60),
          COALESCE(_feedback_edit_days, 3))
  RETURNING id INTO v_ptm;

  IF array_length(v_classes, 1) IS NOT NULL THEN
    INSERT INTO public.ptm_schedule_classes (ptm_id, class_id)
    SELECT v_ptm, cid FROM unnest(v_classes) cid
    ON CONFLICT (ptm_id, class_id) DO NOTHING;
  END IF;

  RETURN v_ptm;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_ptm_schedule(
  _ptm_id uuid, _title text, _description text, _venue text, _scheduled_date date,
  _start_time time, _end_time time, _slot_booking_enabled boolean, _slot_duration_minutes integer,
  _booking_cutoff_minutes integer, _feedback_edit_days integer)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_p public.ptm_schedules%ROWTYPE;
  v_booked integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_p FROM public.ptm_schedules WHERE id = _ptm_id FOR UPDATE;
  IF NOT FOUND OR v_p.institution_id IS DISTINCT FROM public.get_user_institution(v_uid) THEN
    RAISE EXCEPTION 'Meeting not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_p.status = 'cancelled' THEN
    RAISE EXCEPTION 'This PTM has been cancelled.' USING ERRCODE = '22023';
  END IF;
  IF NOT public.can_manage_ptm(v_uid, _ptm_id) THEN
    RAISE EXCEPTION 'You can''t change this PTM.' USING ERRCODE = '42501';
  END IF;
  IF _title IS NULL OR btrim(_title) = '' THEN
    RAISE EXCEPTION 'Give the PTM a title.' USING ERRCODE = '22023';
  END IF;
  IF _start_time IS NULL OR _end_time IS NULL OR _end_time <= _start_time THEN
    RAISE EXCEPTION 'The end time must be after the start time.' USING ERRCODE = '22023';
  END IF;
  -- A legacy PTM may carry a duration outside 5..60 (one test row has 2);
  -- keeping it unchanged must not block every other edit.
  IF _slot_duration_minutes IS NULL
     OR (_slot_duration_minutes <> v_p.slot_duration_minutes AND _slot_duration_minutes NOT BETWEEN 5 AND 60) THEN
    RAISE EXCEPTION 'A slot must be 5 to 60 minutes long.' USING ERRCODE = '22023';
  END IF;
  IF _booking_cutoff_minutes NOT BETWEEN 0 AND 1440 THEN
    RAISE EXCEPTION 'The booking cutoff must be 0 to 1440 minutes.' USING ERRCODE = '22023';
  END IF;
  IF _feedback_edit_days NOT BETWEEN 0 AND 30 THEN
    RAISE EXCEPTION 'The feedback window must be 0 to 30 days.' USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_booked FROM public.ptm_bookings b
   WHERE b.ptm_id = _ptm_id AND b.cancelled_at IS NULL;
  IF v_booked > 0 AND (_slot_duration_minutes <> v_p.slot_duration_minutes
                       OR (v_p.slot_booking_enabled AND NOT _slot_booking_enabled)) THEN
    RAISE EXCEPTION '% booked. Cancel their slots first.',
      CASE WHEN v_booked = 1 THEN '1 family has' ELSE v_booked || ' families have' END
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.ptm_schedules
     SET title = btrim(_title),
         description = NULLIF(btrim(COALESCE(_description, '')), ''),
         venue = NULLIF(btrim(COALESCE(_venue, '')), ''),
         scheduled_date = _scheduled_date,
         start_time = _start_time,
         end_time = _end_time,
         slot_booking_enabled = COALESCE(_slot_booking_enabled, false),
         slot_duration_minutes = _slot_duration_minutes,
         booking_cutoff_minutes = _booking_cutoff_minutes,
         feedback_edit_days = _feedback_edit_days,
         updated_at = now()
   WHERE id = _ptm_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_ptm_schedule(_ptm_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_p public.ptm_schedules%ROWTYPE;
  v_reason text := NULLIF(btrim(COALESCE(_reason, '')), '');
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_p FROM public.ptm_schedules WHERE id = _ptm_id FOR UPDATE;
  IF NOT FOUND OR v_p.institution_id IS DISTINCT FROM public.get_user_institution(v_uid) THEN
    RAISE EXCEPTION 'Meeting not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_p.status = 'cancelled' THEN
    RAISE EXCEPTION 'This PTM is already cancelled.' USING ERRCODE = '22023';
  END IF;
  IF NOT public.can_manage_ptm(v_uid, _ptm_id) THEN
    RAISE EXCEPTION 'You can''t cancel this PTM.' USING ERRCODE = '42501';
  END IF;
  IF now() > (SELECT (v_p.scheduled_date + v_p.end_time) AT TIME ZONE COALESCE(i.timezone, 'Asia/Kolkata')
                FROM public.institutions i WHERE i.id = v_p.institution_id) THEN
    RAISE EXCEPTION 'This meeting has already happened.' USING ERRCODE = '22023';
  END IF;
  IF v_reason IS NOT NULL AND char_length(v_reason) > 300 THEN
    RAISE EXCEPTION 'Keep the reason under 300 characters.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.ptm_schedules
     SET status = 'cancelled', cancelled_at = now(), cancelled_by = v_uid,
         cancel_reason = v_reason, updated_at = now()
   WHERE id = _ptm_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.ptm_booking_grid(_ptm_id uuid, _class_id uuid)
RETURNS TABLE(slot_time time, booking_id uuid, student_id uuid, student_name text,
              attended boolean, is_mine boolean, off_grid boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_p public.ptm_schedules%ROWTYPE;
  v_class uuid;
  v_student boolean := false;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_p FROM public.ptm_schedules WHERE id = _ptm_id;
  IF NOT FOUND OR v_p.institution_id IS DISTINCT FROM public.get_user_institution(v_uid) THEN
    RAISE EXCEPTION 'Meeting not found.' USING ERRCODE = 'P0002';
  END IF;

  IF _class_id IS NULL THEN
    IF NOT public.has_role(v_uid, 'student') THEN
      RAISE EXCEPTION 'Pick a class.' USING ERRCODE = '22023';
    END IF;
    v_class := public._ptm_student_class(v_uid);
    IF v_class IS NULL THEN
      RAISE EXCEPTION 'Your class is not set up. Ask your school.' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.ptm_effective_class_ids(_ptm_id) e WHERE e.class_id = v_class) THEN
      RAISE EXCEPTION 'This meeting is not for your class.' USING ERRCODE = '42501';
    END IF;
    v_student := true;
  ELSE
    IF NOT public.can_view_ptm_feedback(v_uid, _ptm_id, _class_id) THEN
      RAISE EXCEPTION 'You can''t see bookings for this class.' USING ERRCODE = '42501';
    END IF;
    v_class := _class_id;
  END IF;

  IF NOT v_p.slot_booking_enabled THEN
    RAISE EXCEPTION 'Slot booking is off for this meeting.' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH slots AS (
    SELECT (v_p.start_time + make_interval(mins => k * v_p.slot_duration_minutes))::time AS t
      FROM generate_series(0, (floor(extract(epoch FROM (v_p.end_time - v_p.start_time)) / 60
                                     / v_p.slot_duration_minutes))::int - 1) k
  ),
  bk AS (
    SELECT b.id, b.parent_id, b.slot_time, b.attended
      FROM public.ptm_bookings b
     WHERE b.ptm_id = _ptm_id AND b.class_id = v_class AND b.cancelled_at IS NULL
  )
  SELECT s.t, bk.id,
         CASE WHEN v_student THEN NULL ELSE bk.parent_id END,
         CASE WHEN v_student THEN NULL ELSE pr.full_name END,
         CASE WHEN v_student THEN NULL ELSE bk.attended END,
         COALESCE(bk.parent_id = v_uid, false),
         false
    FROM slots s
    LEFT JOIN bk ON bk.slot_time = s.t
    LEFT JOIN public.profiles pr ON pr.id = bk.parent_id
  UNION ALL
  SELECT bk.slot_time, bk.id,
         CASE WHEN v_student THEN NULL ELSE bk.parent_id END,
         CASE WHEN v_student THEN NULL ELSE pr.full_name END,
         CASE WHEN v_student THEN NULL ELSE bk.attended END,
         bk.parent_id = v_uid,
         true
    FROM bk LEFT JOIN public.profiles pr ON pr.id = bk.parent_id
   WHERE bk.slot_time NOT IN (SELECT s.t FROM slots s)
  ORDER BY 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.ptm_class_teachers(_ptm_ids uuid[])
RETURNS TABLE(ptm_id uuid, class_id uuid, class_name text, class_section text, teacher_names text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_inst uuid := public.get_user_institution(auth.uid());
  v_student boolean := public.has_role(auth.uid(), 'student');
  v_class uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in.' USING ERRCODE = '42501'; END IF;
  IF _ptm_ids IS NULL OR array_length(_ptm_ids, 1) IS NULL THEN RETURN; END IF;
  IF array_length(_ptm_ids, 1) > 100 THEN
    RAISE EXCEPTION 'Ask for at most 100 meetings at once.' USING ERRCODE = '22023';
  END IF;
  IF v_student THEN v_class := public._ptm_student_class(v_uid); END IF;

  RETURN QUERY
  SELECT p.id, c.id, c.name, c.section, public._ptm_class_teacher_names(c.id)
    FROM public.ptm_schedules p
    CROSS JOIN LATERAL public.ptm_effective_class_ids(p.id) e
    JOIN public.classes c ON c.id = e.class_id
   WHERE p.id = ANY (_ptm_ids)
     AND p.institution_id = v_inst
     AND (NOT v_student OR c.id = v_class)
   ORDER BY p.id, c.name, c.section;
END;
$$;

CREATE OR REPLACE FUNCTION public.ptm_my_bookings()
RETURNS TABLE(ptm_id uuid, booking_id uuid, slot_time time, class_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT b.ptm_id, b.id, b.slot_time, b.class_id
    FROM public.ptm_bookings b
    JOIN public.ptm_schedules p ON p.id = b.ptm_id
   WHERE b.parent_id = auth.uid() AND b.cancelled_at IS NULL
   ORDER BY p.scheduled_date DESC, p.start_time DESC
   LIMIT 100;
$$;

CREATE OR REPLACE FUNCTION public.book_ptm_slot(_ptm_id uuid, _slot_time time, _replace boolean DEFAULT false)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_p public.ptm_schedules%ROWTYPE;
  v_class uuid;
  v_id uuid;
  v_con text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in.' USING ERRCODE = '42501'; END IF;
  IF NOT public.has_role(v_uid, 'student') THEN
    RAISE EXCEPTION 'Only a student account can book a slot.' USING ERRCODE = '42501';
  END IF;
  v_class := public._ptm_student_class(v_uid);
  IF v_class IS NULL THEN
    RAISE EXCEPTION 'Your class is not set up. Ask your school.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_p FROM public.ptm_schedules WHERE id = _ptm_id;
  IF NOT FOUND OR v_p.institution_id IS DISTINCT FROM public.get_user_institution(v_uid) THEN
    RAISE EXCEPTION 'Meeting not found.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ptm_effective_class_ids(_ptm_id) e WHERE e.class_id = v_class) THEN
    RAISE EXCEPTION 'This meeting is not for your class.' USING ERRCODE = '42501';
  END IF;
  IF v_p.status = 'cancelled' THEN
    RAISE EXCEPTION 'This meeting has been cancelled.' USING ERRCODE = '22023';
  END IF;
  IF NOT v_p.slot_booking_enabled THEN
    RAISE EXCEPTION 'Slot booking is off for this meeting.' USING ERRCODE = '22023';
  END IF;
  IF now() >= (SELECT w.booking_closes_at FROM public._ptm_window(_ptm_id) w) THEN
    RAISE EXCEPTION 'Booking has closed for this meeting.' USING ERRCODE = '22023';
  END IF;
  -- Interval arithmetic, not time + interval: a time wraps past midnight.
  IF _slot_time IS NULL OR _slot_time < v_p.start_time
     OR (_slot_time - v_p.start_time) + make_interval(mins => v_p.slot_duration_minutes)
        > (v_p.end_time - v_p.start_time)
     OR (extract(epoch FROM (_slot_time - v_p.start_time))::int / 60) % v_p.slot_duration_minutes <> 0
     OR extract(epoch FROM (_slot_time - v_p.start_time))::int % 60 <> 0 THEN
    RAISE EXCEPTION 'That time is not one of the meeting''s slots.' USING ERRCODE = '22023';
  END IF;

  IF COALESCE(_replace, false) THEN
    UPDATE public.ptm_bookings
       SET cancelled_at = now(), status = 'cancelled'
     WHERE ptm_id = _ptm_id AND parent_id = v_uid AND cancelled_at IS NULL;
  END IF;

  BEGIN
    INSERT INTO public.ptm_bookings (ptm_id, parent_id, class_id, slot_time, status)
    VALUES (_ptm_id, v_uid, v_class, _slot_time, 'booked')
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
    IF v_con = 'ptm_bookings_one_per_student' THEN
      RAISE EXCEPTION 'You already have a slot. Cancel it first.' USING ERRCODE = '23505';
    END IF;
    RAISE EXCEPTION 'That slot was just taken. Pick another.' USING ERRCODE = '23505';
  END;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_ptm_booking(_booking_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_b public.ptm_bookings%ROWTYPE;
  v_open boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_b FROM public.ptm_bookings WHERE id = _booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found.' USING ERRCODE = 'P0002'; END IF;
  IF v_b.cancelled_at IS NOT NULL THEN RETURN; END IF;  -- already cancelled: idempotent

  v_open := now() < (SELECT w.booking_closes_at FROM public._ptm_window(v_b.ptm_id) w);
  IF NOT (
       (v_b.parent_id = v_uid AND v_open)
       OR public.can_manage_ptm(v_uid, v_b.ptm_id)
       OR public.is_class_teacher_of(v_uid, v_b.class_id)
     ) THEN
    IF v_b.parent_id = v_uid THEN
      RAISE EXCEPTION 'Booking changes have closed for this meeting.' USING ERRCODE = '22023';
    END IF;
    RAISE EXCEPTION 'You can''t cancel this booking.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.ptm_bookings SET cancelled_at = now(), status = 'cancelled' WHERE id = _booking_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_ptm_booking_attended(_booking_id uuid, _attended boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_b public.ptm_bookings%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_b FROM public.ptm_bookings WHERE id = _booking_id FOR UPDATE;
  IF NOT FOUND OR v_b.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Booking not found.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.can_view_ptm_feedback(v_uid, v_b.ptm_id, v_b.class_id) THEN
    RAISE EXCEPTION 'You can''t mark attendance for this class.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.ptm_bookings SET attended = _attended WHERE id = _booking_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.ptm_resolve_feedback_token(_token text)
RETURNS TABLE(ptm_id uuid, title text, description text, venue text, scheduled_date date,
              start_time time, end_time time, status text, scope_type text, feedback_token text,
              feedback_edit_days integer, my_class_id uuid, my_class_name text, my_class_section text,
              class_teachers text, window_state text, opens_at timestamptz, closes_at timestamptz,
              my_feedback jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ptm uuid;
BEGIN
  IF v_uid IS NULL OR _token IS NULL OR char_length(_token) > 128 THEN RETURN; END IF;
  SELECT s.id INTO v_ptm FROM public.ptm_schedules s
   WHERE s.feedback_token = _token AND s.institution_id = public.get_user_institution(v_uid);
  IF v_ptm IS NULL THEN RETURN; END IF;  -- unknown token and "not yours" look the same
  RETURN QUERY SELECT * FROM public._ptm_feedback_context(v_uid, v_ptm);
END;
$$;

CREATE OR REPLACE FUNCTION public.ptm_open_for_feedback()
RETURNS TABLE(ptm_id uuid, title text, description text, venue text, scheduled_date date,
              start_time time, end_time time, status text, scope_type text, feedback_token text,
              feedback_edit_days integer, my_class_id uuid, my_class_name text, my_class_section text,
              class_teachers text, window_state text, opens_at timestamptz, closes_at timestamptz,
              my_feedback jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_class uuid;
  r record;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'student') THEN RETURN; END IF;
  v_class := public._ptm_student_class(v_uid);
  IF v_class IS NULL THEN RETURN; END IF;
  FOR r IN
    SELECT s.id FROM public.ptm_schedules s
     WHERE s.institution_id = public.get_user_institution(v_uid)
       AND s.status = 'scheduled'
       AND EXISTS (SELECT 1 FROM public.ptm_effective_class_ids(s.id) e WHERE e.class_id = v_class)
       AND (SELECT w.window_state FROM public._ptm_window(s.id) w) = 'open'
     ORDER BY s.scheduled_date DESC, s.start_time DESC
     LIMIT 20
  LOOP
    RETURN QUERY SELECT * FROM public._ptm_feedback_context(v_uid, r.id);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_ptm_feedback(
  _ptm_id uuid, _rating integer, _text text, _audio_path text,
  _audio_duration_seconds integer, _audio_format text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_class uuid;
  v_state text;
  v_text text := NULLIF(btrim(COALESCE(_text, '')), '');
  v_prev text;
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in.' USING ERRCODE = '42501'; END IF;
  IF NOT public.has_role(v_uid, 'student') THEN
    RAISE EXCEPTION 'Feedback is given from the student''s account.' USING ERRCODE = '42501';
  END IF;
  v_class := public._ptm_student_class(v_uid);
  IF v_class IS NULL THEN
    RAISE EXCEPTION 'Your class is not set up. Ask your school.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ptm_schedules s
                  WHERE s.id = _ptm_id AND s.institution_id = public.get_user_institution(v_uid)) THEN
    RAISE EXCEPTION 'Meeting not found.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ptm_effective_class_ids(_ptm_id) e WHERE e.class_id = v_class) THEN
    RAISE EXCEPTION 'This meeting is not for your class.' USING ERRCODE = '42501';
  END IF;
  SELECT w.window_state INTO v_state FROM public._ptm_window(_ptm_id) w;
  IF v_state = 'cancelled' THEN
    RAISE EXCEPTION 'This meeting was cancelled.' USING ERRCODE = '22023';
  ELSIF v_state = 'not_open' THEN
    RAISE EXCEPTION 'Feedback opens when the meeting starts.' USING ERRCODE = '22023';
  ELSIF v_state = 'closed' THEN
    RAISE EXCEPTION 'Feedback for this meeting has closed.' USING ERRCODE = '22023';
  END IF;
  IF _rating IS NULL OR _rating NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'Pick a rating from 1 to 5.' USING ERRCODE = '22023';
  END IF;
  IF v_text IS NOT NULL AND char_length(v_text) > 1000 THEN
    RAISE EXCEPTION 'Keep the message under 1000 characters.' USING ERRCODE = '22023';
  END IF;
  IF _audio_path IS NOT NULL THEN
    IF _audio_path NOT LIKE _ptm_id::text || '/' || v_uid::text || '/%' THEN
      RAISE EXCEPTION 'That recording does not belong to you.' USING ERRCODE = '42501';
    END IF;
    IF _audio_duration_seconds IS NULL OR _audio_duration_seconds NOT BETWEEN 1 AND 120 THEN
      RAISE EXCEPTION 'A voice note can be up to 2 minutes long.' USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT f.audio_path INTO v_prev FROM public.ptm_feedback f
   WHERE f.ptm_id = _ptm_id AND f.student_id = v_uid;

  INSERT INTO public.ptm_feedback (ptm_id, student_id, class_id, submitted_by, rating, text_message,
                                   audio_path, audio_duration_seconds, audio_format)
  VALUES (_ptm_id, v_uid, v_class, v_uid, _rating, v_text, _audio_path,
          CASE WHEN _audio_path IS NOT NULL THEN _audio_duration_seconds END,
          CASE WHEN _audio_path IS NOT NULL THEN _audio_format END)
  ON CONFLICT (ptm_id, student_id) DO UPDATE
     SET class_id = EXCLUDED.class_id, submitted_by = EXCLUDED.submitted_by,
         rating = EXCLUDED.rating, text_message = EXCLUDED.text_message,
         audio_path = EXCLUDED.audio_path, audio_duration_seconds = EXCLUDED.audio_duration_seconds,
         audio_format = EXCLUDED.audio_format, updated_at = now()
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('feedback_id', v_id,
                            'previous_audio_path', CASE WHEN v_prev IS DISTINCT FROM _audio_path THEN v_prev END);
END;
$$;

CREATE OR REPLACE FUNCTION public.ptm_feedback_summary(_ptm_id uuid, _as_role text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_p public.ptm_schedules%ROWTYPE;
  v_classes uuid[];
  v_slots integer;
  v_res jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_p FROM public.ptm_schedules WHERE id = _ptm_id;
  SELECT COALESCE(array_agg(d.class_id), ARRAY[]::uuid[]) INTO v_classes
    FROM public._ptm_dashboard_classes(v_uid, _ptm_id, _as_role) d;
  v_slots := CASE WHEN v_p.slot_booking_enabled
                  THEN floor(extract(epoch FROM (v_p.end_time - v_p.start_time)) / 60 / v_p.slot_duration_minutes)::int
                  ELSE 0 END;

  WITH cls AS (
    SELECT c.id, c.name, c.section FROM public.classes c WHERE c.id = ANY (v_classes)
  ),
  stu AS (
    SELECT ca.class_id, count(DISTINCT ca.user_id)::int AS n
      FROM public.class_assignments ca
      JOIN public.profiles pr ON pr.id = ca.user_id AND pr.is_active IS NOT FALSE
     WHERE ca.class_id = ANY (v_classes) AND ca.role = 'student'
       AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = ca.user_id AND r.role = 'student')
     GROUP BY ca.class_id
  ),
  fb AS (
    SELECT f.class_id, f.rating FROM public.ptm_feedback f
     WHERE f.ptm_id = _ptm_id AND f.class_id = ANY (v_classes)
  ),
  bk AS (
    SELECT b.class_id, count(*)::int AS booked, count(*) FILTER (WHERE b.attended)::int AS attended
      FROM public.ptm_bookings b
     WHERE b.ptm_id = _ptm_id AND b.class_id = ANY (v_classes) AND b.cancelled_at IS NULL
     GROUP BY b.class_id
  ),
  per_class AS (
    SELECT c.id, c.name, c.section, COALESCE(s.n, 0) AS students,
           (SELECT count(*)::int FROM fb WHERE fb.class_id = c.id) AS responses,
           (SELECT round(avg(fb.rating)::numeric, 1) FROM fb WHERE fb.class_id = c.id) AS avg_rating,
           COALESCE(b.booked, 0) AS booked, COALESCE(b.attended, 0) AS attended
      FROM cls c LEFT JOIN stu s ON s.class_id = c.id LEFT JOIN bk b ON b.class_id = c.id
  )
  SELECT jsonb_build_object(
    'students_in_scope', COALESCE((SELECT sum(students) FROM per_class), 0)::int,
    'responses', (SELECT count(*)::int FROM fb),
    'response_rate', CASE WHEN COALESCE((SELECT sum(students) FROM per_class), 0) = 0 THEN 0
                          ELSE round((SELECT count(*) FROM fb) * 100.0 / (SELECT sum(students) FROM per_class), 1) END,
    'avg_rating', (SELECT round(avg(rating)::numeric, 1) FROM fb),
    'distribution', jsonb_build_object(
       '1', (SELECT count(*) FROM fb WHERE rating = 1), '2', (SELECT count(*) FROM fb WHERE rating = 2),
       '3', (SELECT count(*) FROM fb WHERE rating = 3), '4', (SELECT count(*) FROM fb WHERE rating = 4),
       '5', (SELECT count(*) FROM fb WHERE rating = 5)),
    'per_class', COALESCE((SELECT jsonb_agg(jsonb_build_object(
         'class_id', pc.id, 'class_name', pc.name, 'class_section', pc.section,
         'class_teachers', public._ptm_class_teacher_names(pc.id),
         'students', pc.students, 'responses', pc.responses, 'avg_rating', pc.avg_rating)
         ORDER BY pc.name, pc.section) FROM per_class pc), '[]'::jsonb),
    'bookings', jsonb_build_object(
       'enabled', v_p.slot_booking_enabled,
       'total_slots', v_slots * (SELECT count(*) FROM per_class)::int,
       'booked', COALESCE((SELECT sum(booked) FROM per_class), 0)::int,
       'attended', COALESCE((SELECT sum(attended) FROM per_class), 0)::int,
       'per_class', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'class_id', pc.id, 'total_slots', v_slots, 'booked', pc.booked, 'attended', pc.attended)
            ORDER BY pc.name, pc.section) FROM per_class pc), '[]'::jsonb))
  ) INTO v_res;
  RETURN v_res;
END;
$$;

CREATE OR REPLACE FUNCTION public.ptm_feedback_list(
  _ptm_id uuid, _as_role text, _class_id uuid, _rating integer, _has_audio boolean,
  _has_text boolean, _sort text, _limit integer, _offset integer)
RETURNS TABLE(feedback_id uuid, student_id uuid, student_name text, guardian_name text,
              class_id uuid, class_name text, class_section text, rating integer,
              text_message text, audio_path text, audio_duration_seconds integer,
              submitted_at timestamptz, updated_at timestamptz, total_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_classes uuid[];
  v_limit integer := LEAST(GREATEST(COALESCE(_limit, 20), 1), 100);
  v_offset integer := GREATEST(COALESCE(_offset, 0), 0);
  v_sort text := COALESCE(_sort, 'newest');
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in.' USING ERRCODE = '42501'; END IF;
  IF v_sort NOT IN ('newest', 'oldest', 'rating_desc', 'rating_asc') THEN
    RAISE EXCEPTION 'Unknown sort.' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(array_agg(d.class_id), ARRAY[]::uuid[]) INTO v_classes
    FROM public._ptm_dashboard_classes(v_uid, _ptm_id, _as_role) d;

  RETURN QUERY
  SELECT f.id, f.student_id, pr.full_name, spd.guardian_name, f.class_id, c.name, c.section,
         f.rating::integer, f.text_message, f.audio_path, f.audio_duration_seconds,
         f.submitted_at, f.updated_at, count(*) OVER ()
    FROM public.ptm_feedback f
    JOIN public.classes c ON c.id = f.class_id
    LEFT JOIN public.profiles pr ON pr.id = f.student_id
    LEFT JOIN public.student_personal_details spd ON spd.profile_id = f.student_id
   WHERE f.ptm_id = _ptm_id
     AND f.class_id = ANY (v_classes)
     AND (_class_id IS NULL OR f.class_id = _class_id)
     AND (_rating IS NULL OR f.rating = _rating)
     AND (_has_audio IS NULL OR (f.audio_path IS NOT NULL) = _has_audio)
     AND (_has_text IS NULL OR (f.text_message IS NOT NULL) = _has_text)
   ORDER BY
     CASE WHEN v_sort = 'rating_desc' THEN f.rating END DESC NULLS LAST,
     CASE WHEN v_sort = 'rating_asc' THEN f.rating END ASC NULLS LAST,
     CASE WHEN v_sort = 'oldest' THEN f.submitted_at END ASC NULLS LAST,
     f.submitted_at DESC, f.id
   LIMIT v_limit OFFSET v_offset;
END;
$$;

-- ═════════════════════════════════════════════════════════════════════════
-- 6. Policies
-- ═════════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "ptm_feedback_select" ON public.ptm_feedback;
CREATE POLICY "ptm_feedback_select" ON public.ptm_feedback
  FOR SELECT TO authenticated
  USING (student_id = (select auth.uid())
         OR public.can_view_ptm_feedback((select auth.uid()), ptm_id, class_id));
-- No INSERT / UPDATE / DELETE policy: writes go through submit_ptm_feedback.

-- ═════════════════════════════════════════════════════════════════════════
-- 7. Storage: private voice-note bucket
-- ═════════════════════════════════════════════════════════════════════════
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('ptm-feedback-audio', 'ptm-feedback-audio', false, 5242880,
        ARRAY['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg', 'audio/wav', 'audio/aac', 'audio/x-m4a'])
ON CONFLICT (id) DO UPDATE
  SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "ptm_audio_insert" ON storage.objects;
DROP POLICY IF EXISTS "ptm_audio_update" ON storage.objects;
DROP POLICY IF EXISTS "ptm_audio_delete" ON storage.objects;
DROP POLICY IF EXISTS "ptm_audio_select" ON storage.objects;
CREATE POLICY "ptm_audio_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'ptm-feedback-audio' AND public.ptm_audio_writable((select auth.uid()), name));
CREATE POLICY "ptm_audio_update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'ptm-feedback-audio' AND public.ptm_audio_writable((select auth.uid()), name))
  WITH CHECK (bucket_id = 'ptm-feedback-audio' AND public.ptm_audio_writable((select auth.uid()), name));
CREATE POLICY "ptm_audio_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'ptm-feedback-audio' AND public._ptm_audio_segment(name, 2) = (select auth.uid()));
CREATE POLICY "ptm_audio_select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'ptm-feedback-audio' AND public.ptm_audio_readable((select auth.uid()), name));

-- ═════════════════════════════════════════════════════════════════════════
-- 8. Grants (default privileges grant anon EXECUTE; revoke by name)
-- ═════════════════════════════════════════════════════════════════════════
DO $grants$
DECLARE
  f text;
  internal text[] := ARRAY[
    'public.ptm_effective_class_ids(uuid)', 'public.is_class_teacher_of(uuid,uuid)',
    'public._ptm_has_hat(uuid,uuid,text)', 'public._ptm_student_class(uuid)',
    'public.ptm_classes_for_hat(uuid,text)',
    'public._ptm_window(uuid)', 'public._ptm_class_teacher_names(uuid)',
    'public._ptm_feedback_context(uuid,uuid)', 'public._ptm_dashboard_classes(uuid,uuid,text)'];
  policy_helpers text[] := ARRAY[
    'public.can_manage_ptm(uuid,uuid)', 'public.can_view_ptm_feedback(uuid,uuid,uuid)',
    'public.ptm_audio_writable(uuid,text)', 'public.ptm_audio_readable(uuid,text)',
    -- used directly by the ptm_audio_delete storage policy; a pure parser
    'public._ptm_audio_segment(text,integer)'];
  rpcs text[] := ARRAY[
    'public.ptm_manageable_scope(text)',
    'public.create_ptm_schedule(uuid,text,text,date,time,time,integer,uuid[],text,text,uuid,text,boolean,integer,integer)',
    'public.update_ptm_schedule(uuid,text,text,text,date,time,time,boolean,integer,integer,integer)',
    'public.cancel_ptm_schedule(uuid,text)', 'public.ptm_booking_grid(uuid,uuid)',
    'public.ptm_class_teachers(uuid[])', 'public.ptm_my_bookings()',
    'public.book_ptm_slot(uuid,time,boolean)', 'public.cancel_ptm_booking(uuid)',
    'public.set_ptm_booking_attended(uuid,boolean)', 'public.ptm_resolve_feedback_token(text)',
    'public.ptm_open_for_feedback()',
    'public.submit_ptm_feedback(uuid,integer,text,text,integer,text)',
    'public.ptm_feedback_summary(uuid,text)',
    'public.ptm_feedback_list(uuid,text,uuid,integer,boolean,boolean,text,integer,integer)'];
BEGIN
  FOREACH f IN ARRAY internal || policy_helpers || rpcs LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f);
  END LOOP;
  FOREACH f IN ARRAY internal LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
  -- Policies run as the querying role, so their helpers need authenticated.
  FOREACH f IN ARRAY policy_helpers || rpcs LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
  END LOOP;
  -- Hygiene on the 2026-09-15 notification triggers: they still carried the
  -- default PUBLIC / anon / authenticated EXECUTE. Trigger functions cannot
  -- be called directly and the privilege is checked only at CREATE TRIGGER,
  -- so revoking changes nothing about when they fire.
  FOREACH f IN ARRAY ARRAY['public.tg_ptm_notify_scheduled()', 'public.tg_ptm_notify_changed()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', f);
  END LOOP;
END
$grants$;
