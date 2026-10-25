-- Online PTM Meet rooms (migration 5 of the online PTM design, section 5.5;
-- NEEDS EDGE FN in naman-erp 2f337875).
--
-- The edge function ptm-meet-create makes one Google Meet space per booked
-- online slot, as the Workspace user in GOOGLE_MEET_IMPERSONATE_USER (service
-- account with domain-wide delegation), config { accessType OPEN,
-- entryPointAccess ALL, moderation ON }. Teachers and families join as guests.
-- After the slot (slot end + gap + 15 minutes), or once the booking or the PTM
-- is cancelled, it switches the space to accessType RESTRICTED, so the link no
-- longer lets anyone in. Rooms live in ptm_booking_meet, one row per booking.
--
-- Cron ptm-meet-rooms-1min runs ptm_meet_create_kick() every minute; it posts
-- to the edge function (Vault webhook_secret as Bearer) only when a room is due
-- to be made or locked. A room is made for an active online booking whose slot
-- starts between 30 minutes ago and 60 minutes from now and is not yet due to
-- be locked; at most 5 attempts;
-- a claim left unfinished is retried after 10 minutes, a failed one after 2.
--
-- service_role only: ptm_meet_claim_due(_limit), ptm_meet_record(_booking_id,
-- _space_id, _meet_uri, _cohost_set), ptm_meet_fail(_booking_id, _error),
-- ptm_meet_close_due(_limit), ptm_meet_closed(_booking_id, _ok),
-- ptm_meet_create_kick(), ptm_send_15m_reminders().
--
-- Cron ptm-15m-reminders-5min: ptm_reminder_15m to the family about 15 minutes
-- before its slot (once per booking), and to the teacher before their first
-- booked slot of the PTM (once per PTM). No Meet link in any message.
--
-- swap_ptm_online_teacher no longer drops the booking's room: rooms belong to
-- the Workspace user, not to a teacher, so a moved booking keeps its link.

-- ── 1. room state ──────────────────────────────────────────────────────────
ALTER TABLE public.ptm_booking_meet
  ADD COLUMN IF NOT EXISTS meet_closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS meet_close_claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS meet_close_attempts smallint NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS ptm_booking_meet_open_rooms_idx ON public.ptm_booking_meet (meet_created_at)
  WHERE meet_space_id IS NOT NULL AND meet_closed_at IS NULL;

-- ── 2. which bookings need a room, and which rooms need locking ────────────
-- One definition each, shared by the kick (is there work?) and the claims.
CREATE OR REPLACE FUNCTION public._ptm_meet_create_due(_now timestamptz)
RETURNS TABLE(booking_id uuid, slot_starts_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT b.id, (p.scheduled_date + b.slot_time) AT TIME ZONE COALESCE(i.timezone, 'Asia/Kolkata')
    FROM public.ptm_schedules p
    JOIN public.institutions i ON i.id = p.institution_id
    JOIN public.ptm_bookings b ON b.ptm_id = p.id
    LEFT JOIN public.ptm_booking_meet m ON m.booking_id = b.id
   WHERE p.mode = 'online' AND p.status = 'scheduled'
     -- indexed pre-filter (ptm_schedules_online_date_idx); the exact window follows
     AND p.scheduled_date BETWEEN (_now AT TIME ZONE 'UTC')::date - 1 AND (_now AT TIME ZONE 'UTC')::date + 1
     AND b.mode = 'online' AND b.cancelled_at IS NULL AND b.teacher_id IS NOT NULL
     AND (p.scheduled_date + b.slot_time) AT TIME ZONE COALESCE(i.timezone, 'Asia/Kolkata')
         BETWEEN _now - interval '30 minutes' AND _now + interval '60 minutes'
     -- never a room that would already be due to lock (see _ptm_meet_close_due)
     AND ((p.scheduled_date + b.slot_time)
           + make_interval(mins => p.slot_duration_minutes + p.slot_buffer_minutes + 15))
         AT TIME ZONE COALESCE(i.timezone, 'Asia/Kolkata') >= _now
     AND (m.booking_id IS NULL
          OR (m.meet_uri IS NULL AND m.meet_attempts < 5
              AND (m.meet_claimed_at IS NULL
                   OR m.meet_claimed_at < _now - interval '10 minutes'
                   OR (m.meet_error IS NOT NULL AND m.meet_claimed_at < _now - interval '2 minutes'))));
$$;
REVOKE ALL ON FUNCTION public._ptm_meet_create_due(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._ptm_meet_create_due(timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public._ptm_meet_close_due(_now timestamptz)
RETURNS TABLE(booking_id uuid, meet_created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT m.booking_id, m.meet_created_at
    FROM public.ptm_booking_meet m
    JOIN public.ptm_bookings b ON b.id = m.booking_id
    JOIN public.ptm_schedules p ON p.id = b.ptm_id
    JOIN public.institutions i ON i.id = p.institution_id
   WHERE m.meet_space_id IS NOT NULL AND m.meet_closed_at IS NULL
     AND m.meet_created_at > _now - interval '14 days'
     AND m.meet_close_attempts < 3
     AND (m.meet_close_claimed_at IS NULL OR m.meet_close_claimed_at < _now - interval '10 minutes')
     AND (b.cancelled_at IS NOT NULL OR p.status = 'cancelled'
          OR ((p.scheduled_date + b.slot_time)
               + make_interval(mins => p.slot_duration_minutes + p.slot_buffer_minutes + 15))
             AT TIME ZONE COALESCE(i.timezone, 'Asia/Kolkata') < _now);
$$;
REVOKE ALL ON FUNCTION public._ptm_meet_close_due(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._ptm_meet_close_due(timestamptz) TO service_role;

-- ── 3. the edge function's RPCs ────────────────────────────────────────────
-- Claims up to _limit bookings (max 50). The booking row lock (SKIP LOCKED)
-- plus the claim time keep overlapping passes from making two rooms.
CREATE OR REPLACE FUNCTION public.ptm_meet_claim_due(_limit integer DEFAULT 20)
RETURNS TABLE(booking_id uuid, ptm_id uuid, ptm_title text, slot_starts_at timestamptz, slot_ends_at timestamptz,
              teacher_id uuid, teacher_name text, teacher_google_email text, student_name text, attempt integer)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH due AS (
    SELECT b.id, d.slot_starts_at
      FROM public._ptm_meet_create_due(now()) d
      JOIN public.ptm_bookings b ON b.id = d.booking_id
     ORDER BY d.slot_starts_at, b.id
     LIMIT LEAST(GREATEST(COALESCE(_limit, 20), 1), 50)
     FOR UPDATE OF b SKIP LOCKED
  ), claimed AS (
    INSERT INTO public.ptm_booking_meet AS bm (booking_id, meet_claimed_at, meet_attempts, meet_error, updated_at)
    SELECT d.id, now(), 1, NULL, now() FROM due d
    ON CONFLICT ON CONSTRAINT ptm_booking_meet_pkey DO UPDATE
       SET meet_claimed_at = now(), meet_attempts = bm.meet_attempts + 1, meet_error = NULL, updated_at = now()
     WHERE bm.meet_uri IS NULL AND bm.meet_attempts < 5
    RETURNING bm.booking_id, bm.meet_attempts
  )
  SELECT c.booking_id, b.ptm_id, p.title, d.slot_starts_at,
         d.slot_starts_at + make_interval(mins => p.slot_duration_minutes),
         b.teacher_id, tp.full_name, public._ptm_google_email(b.teacher_id), sp.full_name, c.meet_attempts::int
    FROM claimed c
    JOIN due d ON d.id = c.booking_id
    JOIN public.ptm_bookings b ON b.id = c.booking_id
    JOIN public.ptm_schedules p ON p.id = b.ptm_id
    LEFT JOIN public.profiles tp ON tp.id = b.teacher_id
    LEFT JOIN public.profiles sp ON sp.id = b.parent_id
   ORDER BY d.slot_starts_at;
$$;
REVOKE ALL ON FUNCTION public.ptm_meet_claim_due(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ptm_meet_claim_due(integer) TO service_role;

-- Saves the room. False when there is nothing to save it on (it already has a
-- room, or the row is gone); the edge function then locks the spare space.
CREATE OR REPLACE FUNCTION public.ptm_meet_record(_booking_id uuid, _space_id text, _meet_uri text, _cohost_set boolean DEFAULT false)
RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH u AS (
    UPDATE public.ptm_booking_meet
       SET meet_uri = _meet_uri, meet_space_id = _space_id, meet_created_at = now(),
           meet_error = NULL, meet_cohost_set = COALESCE(_cohost_set, false), updated_at = now()
     WHERE booking_id = _booking_id AND meet_uri IS NULL
    RETURNING 1)
  SELECT EXISTS (SELECT 1 FROM u);
$$;
REVOKE ALL ON FUNCTION public.ptm_meet_record(uuid, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ptm_meet_record(uuid, text, text, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.ptm_meet_fail(_booking_id uuid, _error text)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE public.ptm_booking_meet
     SET meet_error = left(COALESCE(NULLIF(btrim(_error), ''), 'unknown error'), 500), updated_at = now()
   WHERE booking_id = _booking_id AND meet_uri IS NULL;
$$;
REVOKE ALL ON FUNCTION public.ptm_meet_fail(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ptm_meet_fail(uuid, text) TO service_role;

-- Rooms to lock (at most 3 tries each, 10 minutes apart).
CREATE OR REPLACE FUNCTION public.ptm_meet_close_due(_limit integer DEFAULT 20)
RETURNS TABLE(booking_id uuid, space_id text)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH due AS (
    SELECT m.booking_id
      FROM public._ptm_meet_close_due(now()) d
      JOIN public.ptm_booking_meet m ON m.booking_id = d.booking_id
     ORDER BY d.meet_created_at, m.booking_id
     LIMIT LEAST(GREATEST(COALESCE(_limit, 20), 1), 50)
     FOR UPDATE OF m SKIP LOCKED
  )
  UPDATE public.ptm_booking_meet bm
     SET meet_close_claimed_at = now(), meet_close_attempts = bm.meet_close_attempts + 1, updated_at = now()
    FROM due
   WHERE bm.booking_id = due.booking_id
  RETURNING bm.booking_id, bm.meet_space_id;
$$;
REVOKE ALL ON FUNCTION public.ptm_meet_close_due(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ptm_meet_close_due(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.ptm_meet_closed(_booking_id uuid, _ok boolean)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE public.ptm_booking_meet SET meet_closed_at = now(), updated_at = now()
   WHERE booking_id = _booking_id AND meet_closed_at IS NULL AND COALESCE(_ok, false);
$$;
REVOKE ALL ON FUNCTION public.ptm_meet_closed(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ptm_meet_closed(uuid, boolean) TO service_role;

-- ── 4. the kick ────────────────────────────────────────────────────────────
-- Posts to ptm-meet-create only when there is work. The bearer secret is read
-- from Vault at call time (as tg_send_native_push), never stored in the job.
CREATE OR REPLACE FUNCTION public.ptm_meet_create_kick()
RETURNS bigint
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_secret text;
  v_id bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public._ptm_meet_create_due(now()))
     AND NOT EXISTS (SELECT 1 FROM public._ptm_meet_close_due(now())) THEN
    RETURN NULL;
  END IF;
  SELECT s.decrypted_secret INTO v_secret FROM vault.decrypted_secrets s WHERE s.name = 'webhook_secret';
  IF v_secret IS NULL THEN
    RAISE WARNING 'ptm_meet_create_kick: Vault secret "webhook_secret" is missing; no Meet rooms made.';
    RETURN NULL;
  END IF;
  SELECT net.http_post(
           url := 'https://gyymkgohcijeksmrzuyw.supabase.co/functions/v1/ptm-meet-create',
           body := '{}'::jsonb,
           headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret),
           timeout_milliseconds := 20000)
    INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.ptm_meet_create_kick() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ptm_meet_create_kick() TO service_role;

-- ── 5. 15-minute reminders ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ptm_send_15m_reminders()
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r record;
  v_total integer := 0;
BEGIN
  FOR r IN
    SELECT b.id, b.ptm_id, b.parent_id, b.teacher_id, b.slot_time, p.title, tp.full_name AS teacher_name,
           b.slot_time = (SELECT min(b2.slot_time) FROM public.ptm_bookings b2
                           WHERE b2.ptm_id = b.ptm_id AND b2.teacher_id = b.teacher_id
                             AND b2.cancelled_at IS NULL) AS teacher_first
      FROM public.ptm_schedules p
      JOIN public.institutions i ON i.id = p.institution_id
      JOIN public.ptm_bookings b ON b.ptm_id = p.id
      LEFT JOIN public.profiles tp ON tp.id = b.teacher_id
     WHERE p.mode = 'online' AND p.status = 'scheduled'
       AND p.scheduled_date BETWEEN (now() AT TIME ZONE 'UTC')::date - 1 AND (now() AT TIME ZONE 'UTC')::date + 1
       AND b.mode = 'online' AND b.cancelled_at IS NULL
       -- CLAUDE.md 24: the slot is wall-clock time in the school's timezone.
       AND (p.scheduled_date + b.slot_time) AT TIME ZONE COALESCE(i.timezone, 'Asia/Kolkata')
           BETWEEN now() AND now() + interval '15 minutes'
     ORDER BY b.ptm_id, b.slot_time
  LOOP
    v_total := v_total + public._ptm_fanout(r.ptm_id, 'ptm_reminder_15m', 'Online PTM soon',
      '"' || left(r.title, 60) || '" with ' || COALESCE(left(r.teacher_name, 60), 'your teacher')
        || ' starts at ' || to_char(r.slot_time, 'HH24:MI') || '. Join from the app.',
      ARRAY[r.parent_id], r.id::text, NULL, jsonb_build_object('booking_id', r.id));
    IF r.teacher_first AND r.teacher_id IS NOT NULL THEN
      v_total := v_total + public._ptm_fanout(r.ptm_id, 'ptm_reminder_15m', 'Online PTM soon',
        'Your first online meeting in "' || left(r.title, 60) || '" starts at ' || to_char(r.slot_time, 'HH24:MI') || '.',
        ARRAY[r.teacher_id]);
    END IF;
  END LOOP;
  RETURN v_total;
END;
$$;
REVOKE ALL ON FUNCTION public.ptm_send_15m_reminders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ptm_send_15m_reminders() TO service_role;

-- ── 6. a swapped booking keeps its room ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.swap_ptm_online_teacher(_ptm_id uuid, _from_teacher uuid, _to_teacher uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_p public.ptm_schedules%ROWTYPE;
  v_to_name text;
  v_moved_bookings integer := 0;
  v_moved_students integer := 0;
  v_out integer := 0;
  v_families uuid[];
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_p FROM public.ptm_schedules WHERE id = _ptm_id FOR UPDATE;
  IF NOT FOUND OR v_p.institution_id IS DISTINCT FROM public.get_user_institution(v_uid) OR v_p.mode <> 'online' THEN
    RAISE EXCEPTION 'Meeting not found.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.is_institution_admin(v_uid, v_p.institution_id) THEN
    RAISE EXCEPTION 'Only a school admin can hand a session to another teacher.' USING ERRCODE = '42501';
  END IF;
  IF v_p.status = 'cancelled' THEN
    RAISE EXCEPTION 'This PTM has been cancelled.' USING ERRCODE = '22023';
  END IF;
  IF public._ptm_has_ended(_ptm_id) THEN
    RAISE EXCEPTION 'This meeting has already happened.' USING ERRCODE = '22023';
  END IF;
  IF _from_teacher IS NULL OR _to_teacher IS NULL OR _from_teacher = _to_teacher THEN
    RAISE EXCEPTION 'Pick a different teacher to hand the session to.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ptm_online_teachers WHERE ptm_id = _ptm_id AND teacher_id = _from_teacher) THEN
    RAISE EXCEPTION 'That teacher is not in this PTM.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ptm_online_teachers WHERE ptm_id = _ptm_id AND teacher_id = _to_teacher) THEN
    RAISE EXCEPTION 'That teacher already has a session in this PTM.' USING ERRCODE = '22023';
  END IF;
  SELECT pr.full_name INTO v_to_name FROM public.profiles pr WHERE pr.id = _to_teacher;
  IF NOT public._ptm_has_hat(_to_teacher, v_p.institution_id, 'teacher')
     OR EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = _to_teacher AND pr.is_active IS FALSE) THEN
    RAISE EXCEPTION '% is not an active teacher at this school.', COALESCE(left(v_to_name, 60), 'That person')
      USING ERRCODE = 'P0001';
  END IF;

  -- One UPDATE: the roster follows by ON UPDATE CASCADE; the busy trigger checks _to.
  UPDATE public.ptm_online_teachers SET teacher_id = _to_teacher, added_by = v_uid
   WHERE ptm_id = _ptm_id AND teacher_id = _from_teacher;
  -- Their bookings move too, and keep their rooms: a room belongs to the
  -- Workspace user, not to a teacher.
  WITH m AS (
    UPDATE public.ptm_bookings SET teacher_id = _to_teacher
     WHERE ptm_id = _ptm_id AND teacher_id = _from_teacher AND cancelled_at IS NULL
    RETURNING id)
  SELECT count(*)::int INTO v_moved_bookings FROM m;

  SELECT count(*)::int, array_agg(op.student_id),
         count(*) FILTER (WHERE op.class_id NOT IN (SELECT h.class_id FROM public.ptm_classes_for_hat(_to_teacher, 'teacher') h))::int
    INTO v_moved_students, v_families, v_out
    FROM public.ptm_online_participants op
   WHERE op.ptm_id = _ptm_id AND op.teacher_id = _to_teacher;

  DELETE FROM public.ptm_notifications_sent
   WHERE ptm_id = _ptm_id AND notification_type = 'ptm_teacher_swapped' AND recipient_id = ANY (COALESCE(v_families, ARRAY[]::uuid[]));
  PERFORM public._ptm_fanout(_ptm_id, 'ptm_teacher_swapped', 'Online PTM teacher changed',
    'Your online meeting "' || v_p.title || '" is now with ' || COALESCE(left(v_to_name, 60), 'another teacher')
      || '. Your slot stays the same.', v_families);
  DELETE FROM public.ptm_notifications_sent
   WHERE ptm_id = _ptm_id AND recipient_id IN (_from_teacher, _to_teacher) AND notification_type LIKE 'ptm_online_%assigned';
  PERFORM public._ptm_fanout(_ptm_id, 'ptm_online_assigned', 'Online PTM: a session for you',
    'You now run a session in "' || v_p.title || '" on ' || to_char(v_p.scheduled_date, 'DD Mon') || '.',
    ARRAY[_to_teacher]);
  PERFORM public._ptm_fanout(_ptm_id, 'ptm_online_unassigned', 'Online PTM changed',
    'Your session in "' || v_p.title || '" was handed to ' || COALESCE(left(v_to_name, 60), 'another teacher') || '.',
    ARRAY[_from_teacher]);

  RETURN jsonb_build_object('moved_students', v_moved_students, 'moved_bookings', v_moved_bookings,
                            'out_of_scope_students', v_out);
END;
$function$;

-- ── 7. crons ───────────────────────────────────────────────────────────────
DO $$ BEGIN PERFORM cron.unschedule('ptm-meet-rooms-1min'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('ptm-meet-rooms-1min', '* * * * *', $job$ SELECT public.ptm_meet_create_kick(); $job$);

DO $$ BEGIN PERFORM cron.unschedule('ptm-15m-reminders-5min'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('ptm-15m-reminders-5min', '*/5 * * * *', $job$ SELECT public.ptm_send_15m_reminders(); $job$);
