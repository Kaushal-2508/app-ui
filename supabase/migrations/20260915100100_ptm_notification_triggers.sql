-- =====================================================================
-- PTM notifications, part 2 of 3: the triggers.
-- Every function body is exception-wrapped. A notification failure must
-- NEVER abort the PTM write: a PTM that cannot be created because a
-- notification hit a constraint is a worse bug than a missing bell row.
-- =====================================================================

-- ── 1. PTM scheduled ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_ptm_notify_scheduled()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  -- The actor never notifies themselves. auth.uid() is NULL for a
  -- service-role or script write, hence the created_by fallback. This
  -- also covers the dual-role case (CLAUDE.md 25): an admin who also
  -- teaches the class would otherwise land in their own audience.
  v_actor uuid;
  v_class text;
BEGIN
  -- Assigned here, not in DECLARE: a DECLARE initializer runs before this
  -- block's own EXCEPTION handler is established, so an error raised while
  -- evaluating it would abort the PTM write instead of being caught below.
  v_actor := COALESCE(auth.uid(), NEW.created_by);

  SELECT ' for ' || c.name || COALESCE(' ' || c.section, '')
    INTO v_class
    FROM public.classes c
   WHERE c.id = NEW.class_id;

  PERFORM public._ptm_fanout(
    NEW.id,
    'ptm_scheduled',
    'PTM scheduled',
    '"' || NEW.title || '"' || COALESCE(v_class, '') || ' on '
      || to_char(NEW.scheduled_date, 'DD Mon YYYY') || ', '
      || to_char(NEW.start_time, 'HH24:MI') || ' to '
      || to_char(NEW.end_time,   'HH24:MI') || '.',
    ARRAY(SELECT a.user_id FROM public.ptm_audience(NEW.id) a
           WHERE a.user_id IS DISTINCT FROM v_actor)
  );
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'ptm notify failed for ptm %: % (%)', NEW.id, SQLERRM, SQLSTATE;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS tg_ptm_notify_scheduled ON public.ptm_schedules;
CREATE TRIGGER tg_ptm_notify_scheduled
AFTER INSERT ON public.ptm_schedules
FOR EACH ROW EXECUTE FUNCTION public.tg_ptm_notify_scheduled();

-- ── 2. PTM cancelled or rescheduled ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_ptm_notify_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid;
  v_audience uuid[];
BEGIN
  -- Assigned here, not in DECLARE: see tg_ptm_notify_scheduled above.
  v_actor := COALESCE(auth.uid(), NEW.created_by);

  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    v_audience := ARRAY(SELECT a.user_id FROM public.ptm_audience(NEW.id) a
                         WHERE a.user_id IS DISTINCT FROM v_actor);

    -- Symmetric with the reschedule claim-delete below: without it, a
    -- cancel, un-cancel, cancel cycle would claim nothing and notify
    -- nobody the second time, silently.
    DELETE FROM public.ptm_notifications_sent
     WHERE ptm_id = NEW.id AND notification_type = 'ptm_cancelled';

    PERFORM public._ptm_fanout(
      NEW.id, 'ptm_cancelled', 'PTM cancelled',
      '"' || NEW.title || '" on '
        || to_char(NEW.scheduled_date, 'DD Mon YYYY') || ' has been cancelled.',
      v_audience
    );

  ELSIF (NEW.scheduled_date IS DISTINCT FROM OLD.scheduled_date
      OR NEW.start_time     IS DISTINCT FROM OLD.start_time
      OR NEW.end_time       IS DISTINCT FROM OLD.end_time)
     AND NEW.status IS DISTINCT FROM 'cancelled' THEN

    v_audience := ARRAY(SELECT a.user_id FROM public.ptm_audience(NEW.id) a
                         WHERE a.user_id IS DISTINCT FROM v_actor);

    -- LOAD-BEARING: the claim key is (ptm, recipient, type), so without
    -- clearing the previous reschedule claims a SECOND reschedule would
    -- claim nothing and notify nobody, silently. See the spec's Risks.
    DELETE FROM public.ptm_notifications_sent
     WHERE ptm_id = NEW.id AND notification_type = 'ptm_rescheduled';

    PERFORM public._ptm_fanout(
      NEW.id, 'ptm_rescheduled', 'PTM rescheduled',
      '"' || NEW.title || '" has moved to '
        || to_char(NEW.scheduled_date, 'DD Mon YYYY') || ', '
        || to_char(NEW.start_time, 'HH24:MI') || ' to '
        || to_char(NEW.end_time,   'HH24:MI') || '.',
      v_audience
    );
  END IF;

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'ptm notify failed for ptm %: % (%)', NEW.id, SQLERRM, SQLSTATE;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS tg_ptm_notify_changed ON public.ptm_schedules;
CREATE TRIGGER tg_ptm_notify_changed
AFTER UPDATE ON public.ptm_schedules
FOR EACH ROW EXECUTE FUNCTION public.tg_ptm_notify_changed();

-- ── 3. Slot booked ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_ptm_notify_booking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_teacher uuid;
  v_student text;
  v_title   text;
BEGIN
  -- ptmb_insert does not constrain teacher_id, so the client can name any
  -- profile. Resolve it through the PTM's own institution, the same guarantee
  -- ptm_audience enforces for every other event.
  SELECT ca.user_id INTO v_teacher
    FROM public.ptm_schedules ps
    JOIN public.classes c            ON c.institution_id = ps.institution_id
    JOIN public.class_assignments ca ON ca.class_id = c.id
   WHERE ps.id = NEW.ptm_id
     AND ca.user_id = NEW.teacher_id
     AND ca.role = 'teacher'
   LIMIT 1;

  IF v_teacher IS NULL THEN
    RETURN NULL;
  END IF;

  -- parent_id holds the STUDENT's profiles.id: SALCI has no parent role,
  -- students book their own slots. Never render the word "parent" here.
  SELECT p.full_name INTO v_student
    FROM public.profiles p WHERE p.id = NEW.parent_id;

  SELECT ps.title INTO v_title
    FROM public.ptm_schedules ps WHERE ps.id = NEW.ptm_id;

  -- Only the booked teacher. Not the audience, not the admin.
  PERFORM public._ptm_fanout(
    NEW.ptm_id, 'ptm_slot_booked', 'PTM slot booked',
    COALESCE(v_student, 'A student') || ' booked '
      || to_char(NEW.slot_time, 'HH24:MI')
      || ' for "' || COALESCE(v_title, 'PTM') || '".',
    ARRAY[v_teacher]
  );
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'ptm notify failed for ptm %: % (%)', NEW.ptm_id, SQLERRM, SQLSTATE;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS tg_ptm_notify_booking ON public.ptm_bookings;
CREATE TRIGGER tg_ptm_notify_booking
AFTER INSERT ON public.ptm_bookings
FOR EACH ROW EXECUTE FUNCTION public.tg_ptm_notify_booking();
