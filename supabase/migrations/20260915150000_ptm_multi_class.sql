-- =====================================================================
-- PTM notifications, Task 7: multi-class PTM + drop the student teacher
-- picker.
-- Spec: .superpowers/sdd/2026-09-15-ptm-notifications/task-7-brief.md
--
-- Product changes:
--   1. Students no longer pick a teacher when booking (frontend-only; the
--      booking notification trigger is retired here so teacher_id can go
--      nullable without a dangling NOT NULL trigger read).
--   2. Admins pick one or more classes when scheduling a PTM, with an
--      "All classes" option meaning the whole school (zero junction rows,
--      exactly mirroring what class_id IS NULL means today).
--   3. Students only see PTMs that include their class (or an all-classes
--      PTM). Admins, coordinators and teachers keep seeing everything.
-- =====================================================================

-- ── 1. Junction table ────────────────────────────────────────────────
-- ZERO rows for a PTM means ALL classes, exactly mirroring what
-- class_id IS NULL means today on ptm_schedules. No sentinel row.
CREATE TABLE IF NOT EXISTS public.ptm_schedule_classes (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ptm_id   uuid NOT NULL REFERENCES public.ptm_schedules(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES public.classes(id)       ON DELETE CASCADE,
  CONSTRAINT ptm_schedule_classes_uniq UNIQUE (ptm_id, class_id)
);

-- New FK (class_id) indexed in the same migration, per CLAUDE.md 23.
CREATE INDEX IF NOT EXISTS idx_ptm_schedule_classes_class
  ON public.ptm_schedule_classes(class_id);

ALTER TABLE public.ptm_schedule_classes ENABLE ROW LEVEL SECURITY;

-- ── 2. Recursion-guard helpers ───────────────────────────────────────
-- The ptm_schedules SELECT policy (step 4) reads ptm_schedule_classes, and
-- ptm_schedule_classes' own policy (step 3) reads ptm_schedules back. Left
-- as inline EXISTS on both sides, Postgres raises 42P17 infinite recursion.
-- Both directions go through SECURITY DEFINER functions instead, which
-- bypass RLS on the tables they touch.

-- Does this PTM reach the given user's class? TRUE when the PTM is
-- all-classes (no junction rows and no legacy class_id).
CREATE OR REPLACE FUNCTION public.ptm_includes_user_class(_ptm_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    CASE
      WHEN NOT EXISTS (SELECT 1 FROM public.ptm_schedule_classes sc WHERE sc.ptm_id = _ptm_id)
       AND (SELECT ps.class_id FROM public.ptm_schedules ps WHERE ps.id = _ptm_id) IS NULL
      THEN true
      ELSE EXISTS (
        SELECT 1
          FROM public.class_assignments ca
         WHERE ca.user_id = _user_id
           AND (
             ca.class_id IN (SELECT sc.class_id FROM public.ptm_schedule_classes sc WHERE sc.ptm_id = _ptm_id)
             OR ca.class_id = (SELECT ps.class_id FROM public.ptm_schedules ps WHERE ps.id = _ptm_id)
           )
      )
    END
$function$;

REVOKE ALL ON FUNCTION public.ptm_includes_user_class(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ptm_includes_user_class(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.ptm_includes_user_class(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ptm_includes_user_class(uuid, uuid) TO service_role;

-- Can the caller read this PTM's class rows at all? Institution scope only.
-- SECURITY DEFINER so reading ptm_schedules here does NOT re-enter its policy.
CREATE OR REPLACE FUNCTION public.ptm_class_rows_readable(_ptm_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.ptm_schedules ps
     WHERE ps.id = _ptm_id
       AND public.get_user_institution((select auth.uid())) = ps.institution_id
  )
$function$;

REVOKE ALL ON FUNCTION public.ptm_class_rows_readable(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ptm_class_rows_readable(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.ptm_class_rows_readable(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ptm_class_rows_readable(uuid) TO service_role;

-- ── 3. Junction RLS ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "ptmsc_select" ON public.ptm_schedule_classes;
CREATE POLICY "ptmsc_select" ON public.ptm_schedule_classes FOR SELECT
  USING (public.ptm_class_rows_readable(ptm_id));

-- Writes go only through create_ptm_schedule (step 7, SECURITY DEFINER), so
-- no INSERT/UPDATE/DELETE policy is needed here. Supabase grants DML on new
-- public tables to anon by default even with RLS on, so that has to be
-- revoked explicitly (matches ptm_notifications_sent's precedent).
REVOKE ALL ON TABLE public.ptm_schedule_classes FROM anon;

-- ── 4. Students see only PTMs that include their class ──────────────
-- A dual-role account holding student alongside another role is treated as
-- a student here on purpose: has_role is true for them, so they get the
-- narrower view. That is the safe direction.
DROP POLICY IF EXISTS "ptm_select" ON public.ptm_schedules;
CREATE POLICY "ptm_select" ON public.ptm_schedules FOR SELECT
  USING (
    public.get_user_institution((select auth.uid())) = institution_id
    AND (
      NOT public.has_role((select auth.uid()), 'student')
      OR public.ptm_includes_user_class(id, (select auth.uid()))
    )
  );

-- ── 5. Retire the booking notification, make teacher_id optional ────
-- Students no longer pick a teacher; a booking now notifies nobody
-- (teachers see bookings via "View Bookings" in the panel). Existing
-- ptm_bookings rows are left alone; the frontend's icon map keeps the
-- ptm_slot_booked entry so already-written rows still render an icon.
DROP TRIGGER IF EXISTS tg_ptm_notify_booking ON public.ptm_bookings;
DROP FUNCTION IF EXISTS public.tg_ptm_notify_booking();

ALTER TABLE public.ptm_bookings ALTER COLUMN teacher_id DROP NOT NULL;

-- ── 6. ptm_audience: resolve the SET of classes, not one class_id ────
-- Same signature, same one-row-per-person bool_or GROUP BY, same
-- profiles.is_active / user_roles checks and the institution guard on
-- every branch. Only the class resolution changes: the PTM's classes are
-- now every class_id in ptm_schedule_classes for it, PLUS the legacy
-- ptm_schedules.class_id when it is not null. An EMPTY set means
-- school-wide, exactly like today, and the existing school-wide branches
-- apply unchanged.
CREATE OR REPLACE FUNCTION public.ptm_audience(_ptm_id uuid)
RETURNS TABLE (user_id uuid, is_teacher boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH ptm AS (
    SELECT id, institution_id, class_id
      FROM public.ptm_schedules
     WHERE id = _ptm_id
  ),
  ptm_classes AS (
    -- Junction rows for this PTM, plus the legacy single class_id column,
    -- deduped. Empty means school-wide.
    SELECT sc.class_id
      FROM public.ptm_schedule_classes sc
      JOIN ptm ON ptm.id = sc.ptm_id

    UNION

    SELECT ptm.class_id
      FROM ptm
     WHERE ptm.class_id IS NOT NULL
  )
  SELECT a.user_id, bool_or(a.is_teacher) AS is_teacher
    FROM (
      -- Class-scoped: students + teachers of every class in ptm_classes.
      -- CROSS JOIN ptm_classes naturally yields zero rows when it is empty,
      -- so no separate guard is needed here (unlike the two branches below,
      -- which have nothing to join against and so guard with NOT EXISTS).
      -- Still joins through classes (not the class ids directly) so a class
      -- belonging to another institution can never resolve here, even if a
      -- row ever got institution_id and class_id out of sync. This is a
      -- previously-fixed cross-tenant bug; the guard must not regress.
      SELECT DISTINCT ca.user_id, (ca.role = 'teacher') AS is_teacher
        FROM ptm
        CROSS JOIN ptm_classes pc
        JOIN public.classes c            ON c.id = pc.class_id
                                        AND c.institution_id = ptm.institution_id
        JOIN public.class_assignments ca ON ca.class_id = c.id
        JOIN public.profiles p           ON p.id = ca.user_id
       WHERE ca.role IN ('teacher', 'student')
         AND p.is_active IS NOT FALSE
         AND EXISTS (SELECT 1 FROM public.user_roles ur
                      WHERE ur.user_id = ca.user_id AND ur.role = ca.role)

      UNION

      -- School-wide (ptm_classes empty): every student in the institution.
      SELECT s.student_id, false
        FROM ptm
       CROSS JOIN LATERAL public.institution_student_ids(ptm.institution_id) s
       WHERE NOT EXISTS (SELECT 1 FROM ptm_classes)

      UNION

      -- School-wide (ptm_classes empty): every active teacher of an active
      -- class in the institution.
      SELECT DISTINCT ca.user_id, true
        FROM ptm
        JOIN public.classes c            ON c.institution_id = ptm.institution_id
        JOIN public.class_assignments ca ON ca.class_id = c.id
        JOIN public.profiles p           ON p.id = ca.user_id
       WHERE NOT EXISTS (SELECT 1 FROM ptm_classes)
         AND ca.role = 'teacher'
         AND p.is_active IS NOT FALSE
         AND c.is_active IS NOT FALSE
         AND EXISTS (SELECT 1 FROM public.user_roles ur
                      WHERE ur.user_id = ca.user_id AND ur.role = 'teacher')
    ) a
   GROUP BY a.user_id
$function$;

-- Re-assert: CREATE OR REPLACE keeps prior grants for an unchanged
-- signature, but this is explicit so the lockdown is provable by reading
-- this migration alone, per CLAUDE.md 26.
REVOKE ALL ON FUNCTION public.ptm_audience(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ptm_audience(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.ptm_audience(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ptm_audience(uuid) TO service_role;

-- ── 7. create_ptm_schedule: one transaction for the PTM + its classes ─
-- Inserting the PTM and its class rows are two dependent writes, so per
-- CLAUDE.md 9a they must be ONE transaction (this RPC), never sequential
-- client calls.
CREATE OR REPLACE FUNCTION public.create_ptm_schedule(
  _institution_id uuid,
  _title text,
  _description text,
  _scheduled_date date,
  _start_time time,
  _end_time time,
  _slot_duration_minutes integer,
  _class_ids uuid[]
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid;
  v_ptm   uuid;
BEGIN
  v_actor := (select auth.uid());
  IF NOT public.is_institution_admin(v_actor, _institution_id) THEN
    RAISE EXCEPTION 'Only a school admin can schedule a PTM.';
  END IF;

  -- Every named class must belong to this institution. Blocks the
  -- cross-tenant shape at the door instead of relying on the audience
  -- resolver to filter it later.
  IF _class_ids IS NOT NULL AND array_length(_class_ids, 1) IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM unnest(_class_ids) AS cid
       WHERE NOT EXISTS (SELECT 1 FROM public.classes c
                          WHERE c.id = cid AND c.institution_id = _institution_id)
    ) THEN
      RAISE EXCEPTION 'One of the selected classes does not belong to this school.';
    END IF;
  END IF;

  INSERT INTO public.ptm_schedules
    (institution_id, title, description, scheduled_date, start_time, end_time,
     slot_duration_minutes, created_by)
  VALUES (_institution_id, _title, nullif(_description, ''), _scheduled_date,
          _start_time, _end_time, COALESCE(_slot_duration_minutes, 15), v_actor)
  RETURNING id INTO v_ptm;

  IF _class_ids IS NOT NULL AND array_length(_class_ids, 1) IS NOT NULL THEN
    INSERT INTO public.ptm_schedule_classes (ptm_id, class_id)
    SELECT v_ptm, cid FROM unnest(_class_ids) AS cid
    ON CONFLICT (ptm_id, class_id) DO NOTHING;
  END IF;

  RETURN v_ptm;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_ptm_schedule(uuid, text, text, date, time, time, integer, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_ptm_schedule(uuid, text, text, date, time, time, integer, uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_ptm_schedule(uuid, text, text, date, time, time, integer, uuid[]) TO authenticated;

-- tg_ptm_notify_scheduled is an AFTER INSERT trigger on ptm_schedules, so it
-- fires BEFORE create_ptm_schedule's second statement (the junction insert)
-- ever runs. At that moment the PTM looks school-wide (zero junction rows)
-- and would notify the ENTIRE SCHOOL for a one-class PTM. Moving the
-- notification onto the junction table instead is NOT a fix: an
-- all-classes PTM legitimately has no junction rows, so it would then never
-- notify anyone.
--
-- The fix: make it a DEFERRABLE INITIALLY DEFERRED constraint trigger. That
-- runs at COMMIT, by which time create_ptm_schedule has written the
-- junction rows in the same transaction, so ptm_audience sees the real
-- class list. The function body is unchanged. tg_ptm_notify_changed stays
-- a normal AFTER UPDATE trigger.
DROP TRIGGER IF EXISTS tg_ptm_notify_scheduled ON public.ptm_schedules;
CREATE CONSTRAINT TRIGGER tg_ptm_notify_scheduled
AFTER INSERT ON public.ptm_schedules
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.tg_ptm_notify_scheduled();
