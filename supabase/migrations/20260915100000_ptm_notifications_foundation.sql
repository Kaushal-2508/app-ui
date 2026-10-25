-- =====================================================================
-- PTM notifications, part 1 of 3: the shared foundation.
-- Spec: docs/superpowers/specs/2026-09-15-ptm-notifications-design.md
-- In-app only. Deliberately no web push: see the spec's "Deliberately
-- excluded" section before adding any outbound call here.
-- =====================================================================

-- ── Idempotency ledger ───────────────────────────────────────────────
-- Mirrors homework_notifications_sent. Every writer claims through this
-- table, so a re-run, a double-click or a repeated cron pass is a no-op.
CREATE TABLE IF NOT EXISTS public.ptm_notifications_sent (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ptm_id            uuid NOT NULL REFERENCES public.ptm_schedules(id) ON DELETE CASCADE,
  recipient_id      uuid NOT NULL REFERENCES public.profiles(id)      ON DELETE CASCADE,
  notification_type text NOT NULL,
  sent_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ptm_notifications_sent_uniq UNIQUE (ptm_id, recipient_id, notification_type)
);

-- The UNIQUE already covers ptm_id as its leading column; recipient_id
-- needs its own so a profile delete cascade does not seq-scan.
CREATE INDEX IF NOT EXISTS idx_ptm_notifications_sent_recipient
  ON public.ptm_notifications_sent(recipient_id);

-- RLS on with NO policies: deny-by-default. Only the SECURITY DEFINER
-- functions below ever touch this table; no client reads it.
ALTER TABLE public.ptm_notifications_sent ENABLE ROW LEVEL SECURITY;

-- Supabase grants table-level DML to anon/authenticated by default even
-- with RLS on, so deny-by-default has to be enforced at both layers.
REVOKE ALL ON TABLE public.ptm_notifications_sent FROM anon, authenticated;

COMMENT ON TABLE public.ptm_notifications_sent IS
  'Claim ledger for PTM notifications. Writers INSERT ... ON CONFLICT DO NOTHING RETURNING, then notify only what they actually claimed. ptm_rescheduled rows are deleted by the update trigger before re-claiming so a SECOND reschedule still notifies.';

-- ── Audience resolver ────────────────────────────────────────────────
-- THE definition of "who cares about this PTM". Called by all three
-- triggers and the reminder cron, so the rule lives in exactly one place.
--   class-scoped -> students + teachers of that one class
--   school-wide  -> institution_student_ids() + every teacher of the school
-- A teacher has one class_assignments row PER SUBJECT they teach in the
-- class, so the DISTINCT is load-bearing: without it a teacher of three
-- subjects gets three notifications.
-- The class-scoped branch joins through classes (not class_id directly) so
-- a class belonging to another institution can never resolve here, even if
-- a row ever got institution_id and class_id out of sync.
-- UNION dedupes whole rows, not people: a user who is both a teacher and a
-- student of the same PTM would otherwise come back twice with different
-- is_teacher values. The outer GROUP BY collapses every branch to one row
-- per user_id so the is_teacher contract is honest for Task 3.
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
  )
  SELECT a.user_id, bool_or(a.is_teacher) AS is_teacher
    FROM (
      SELECT DISTINCT ca.user_id, (ca.role = 'teacher') AS is_teacher
        FROM ptm
        JOIN public.classes c            ON c.id = ptm.class_id
                                        AND c.institution_id = ptm.institution_id
        JOIN public.class_assignments ca ON ca.class_id = c.id
        JOIN public.profiles p           ON p.id = ca.user_id
       WHERE ptm.class_id IS NOT NULL
         AND ca.role IN ('teacher', 'student')
         AND p.is_active IS NOT FALSE
         AND EXISTS (SELECT 1 FROM public.user_roles ur
                      WHERE ur.user_id = ca.user_id AND ur.role = ca.role)

      UNION

      SELECT s.student_id, false
        FROM ptm
       CROSS JOIN LATERAL public.institution_student_ids(ptm.institution_id) s
       WHERE ptm.class_id IS NULL

      UNION

      SELECT DISTINCT ca.user_id, true
        FROM ptm
        JOIN public.classes c            ON c.institution_id = ptm.institution_id
        JOIN public.class_assignments ca ON ca.class_id = c.id
        JOIN public.profiles p           ON p.id = ca.user_id
       WHERE ptm.class_id IS NULL
         AND ca.role = 'teacher'
         AND p.is_active IS NOT FALSE
         AND c.is_active IS NOT FALSE
         AND EXISTS (SELECT 1 FROM public.user_roles ur
                      WHERE ur.user_id = ca.user_id AND ur.role = 'teacher')
    ) a
   GROUP BY a.user_id
$function$;

-- NOT callable by clients: this function has no authorization check of its
-- own, so any signed-in user who held a PTM id could enumerate its whole
-- audience. The triggers that call it are SECURITY DEFINER (run as owner)
-- and the reminder cron runs as postgres, so authenticated is revoked too,
-- not just anon.
REVOKE ALL ON FUNCTION public.ptm_audience(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ptm_audience(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.ptm_audience(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ptm_audience(uuid) TO service_role;

-- ── Claim-then-write helper ──────────────────────────────────────────
-- ONE statement: claim the recipients that have not had this (ptm, type)
-- yet, then write a notifications row for exactly those. Returns how many
-- were written, so callers can be logged/triaged.
-- NOT callable by clients: it writes arbitrary notification text to
-- arbitrary users, so authenticated is revoked too, not just anon.
-- Task 2 builds recipient arrays by hand (e.g. ARRAY[NEW.teacher_id]), so a
-- NULL element is filtered out before the claim insert instead of raising
-- 23502 and aborting the whole call.
CREATE OR REPLACE FUNCTION public._ptm_fanout(
  _ptm_id     uuid,
  _type       text,
  _title      text,
  _message    text,
  _recipients uuid[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_written integer := 0;
BEGIN
  IF _recipients IS NULL OR array_length(_recipients, 1) IS NULL THEN
    RETURN 0;
  END IF;

  WITH claimed AS (
    INSERT INTO public.ptm_notifications_sent (ptm_id, recipient_id, notification_type)
    SELECT _ptm_id, r, _type FROM unnest(_recipients) AS r WHERE r IS NOT NULL
    ON CONFLICT (ptm_id, recipient_id, notification_type) DO NOTHING
    RETURNING recipient_id
  ), written AS (
    INSERT INTO public.notifications (user_id, type, title, message, link, metadata)
    SELECT c.recipient_id, _type, _title, _message,
           '/school/communication?tab=ptm',
           jsonb_build_object('ptm_id', _ptm_id)
      FROM claimed c
    RETURNING 1
  )
  SELECT count(*) INTO v_written FROM written;

  RETURN v_written;
END;
$function$;

REVOKE ALL ON FUNCTION public._ptm_fanout(uuid, text, text, text, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._ptm_fanout(uuid, text, text, text, uuid[]) FROM anon;
REVOKE ALL ON FUNCTION public._ptm_fanout(uuid, text, text, text, uuid[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public._ptm_fanout(uuid, text, text, text, uuid[]) TO service_role;

-- ── RLS: give ptm_update an explicit WITH CHECK ──────────────────────
-- Task 6 makes this the first real UPDATE writer. Postgres falls back to
-- USING when WITH CHECK is absent, so this is not broken today, but
-- CLAUDE.md 26 requires both halves to be explicit: a missing WITH CHECK
-- silently rejected 100% of teachers' offline-marks saves for two days.
DROP POLICY IF EXISTS "ptm_update" ON public.ptm_schedules;
CREATE POLICY "ptm_update" ON public.ptm_schedules FOR UPDATE
  USING      (public.is_institution_admin((select auth.uid()), institution_id))
  WITH CHECK (public.is_institution_admin((select auth.uid()), institution_id));
