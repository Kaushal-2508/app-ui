-- =====================================================================
-- PTM notifications, part 3 of 3: the day-before reminder.
-- No edge function and no net.http_post: web push is out of scope, so
-- the work never leaves the database (unlike homework-notify-pass).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.ptm_send_day_before_reminders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r       record;
  v_total integer := 0;
BEGIN
  FOR r IN
    SELECT ps.id, ps.title, ps.start_time, ps.end_time
      FROM public.ptm_schedules ps
      JOIN public.institutions  i ON i.id = ps.institution_id
     WHERE ps.status = 'scheduled'
       -- CLAUDE.md 24 (CRITICAL): "tomorrow" is per institution. Using the server
       -- date here, or AT TIME ZONE 'UTC', re-introduces the 2026-05-25 bug that
       -- left attendance auto-mark dead for every IST school until 13:30 IST.
       AND ps.scheduled_date
           = (now() AT TIME ZONE COALESCE(i.timezone, 'Asia/Kolkata'))::date + 1
  LOOP
    v_total := v_total + public._ptm_fanout(
      r.id,
      'ptm_reminder',
      'PTM tomorrow',
      '"' || r.title || '" is tomorrow, '
        || to_char(r.start_time, 'HH24:MI') || ' to '
        || to_char(r.end_time,   'HH24:MI') || '.',
      -- Students in scope, plus ONLY the teachers somebody actually
      -- booked. A teacher with no bookings needs no reminder.
      ARRAY(
        SELECT a.user_id FROM public.ptm_audience(r.id) a WHERE a.is_teacher = false
        UNION
        SELECT b.teacher_id FROM public.ptm_bookings b WHERE b.ptm_id = r.id
      )
    );
  END LOOP;

  RETURN v_total;
END;
$function$;

REVOKE ALL ON FUNCTION public.ptm_send_day_before_reminders() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ptm_send_day_before_reminders() FROM anon;
REVOKE ALL ON FUNCTION public.ptm_send_day_before_reminders() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ptm_send_day_before_reminders() TO service_role;

-- Hourly, not daily: ptm_notifications_sent makes re-runs free, so one
-- job crossing every institution's local evening beats per-tz scheduling.
DO $$
BEGIN
  PERFORM cron.unschedule('ptm-day-before-reminders');
EXCEPTION WHEN OTHERS THEN NULL;
END;
$$;

SELECT cron.schedule(
  'ptm-day-before-reminders',
  '0 * * * *',
  $job$ SELECT public.ptm_send_day_before_reminders(); $job$
);
