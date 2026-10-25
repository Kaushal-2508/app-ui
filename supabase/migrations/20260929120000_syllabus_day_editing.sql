-- =============================================================
-- Teachers can edit any past day's syllabus log, from anywhere.
-- -------------------------------------------------------------
-- Before this a logged day could only GROW: a chapter entry could be added,
-- or removed from one screen (the lesson-plan dialog); a note could not be
-- removed at all; switching a day from a chapter to a note (or back) meant
-- two separate writes that left the day half-changed between them; and
-- nothing recorded who changed what. Tushar asked (2026-09-29) that teachers
-- can change, remove, and swap chapter entries and notes on any past day.
--
-- 1. edit_syllabus_day: ONE transaction for every edit of one
--    (class, subject, date): remove chapter entries, set (add or change)
--    entries, save or clear the day's note. It calls the existing single
--    write paths (delete_syllabus_progress, record_syllabus_progress,
--    tt_record_period_note) so their rules and permission checks still hold,
--    and orders the steps so a switch always works: removals first (the
--    period a chapter held is freed for the note), then the note is cleared
--    (the period it held is freed for a chapter), then entries, then the note.
-- 2. record_syllabus_progress: changing an entry from Completed to Partial
--    now also un-marks the period that entry had marked done, as a delete
--    already does. Before, coverage (which counts done teaching periods) and
--    the Command Center kept counting the chapter as covered.
-- 3. History: every add, change and removal of a chapter entry or a period
--    note is written to system_audit_logs by trigger, so it shows in
--    Activity Logs with who, when, the chapter, the class and the date.
--    Exception-wrapped like tg_audit_row: an audit failure never blocks the
--    edit. Content, not structure, so deliberately NOT in
--    sec_watched_delete_entity_types (CLAUDE.md section 29).
-- 4. dash_teacher_syllabus_chapters returns each chapter's logged dates, so
--    the My syllabus page can open any of them for editing.
-- 5. delete_syllabus_progress and record_syllabus_progress lose the EXECUTE
--    that Supabase's default privileges gave anon (CLAUDE.md section 26).
-- =============================================================

-- -------------------------------------------------------------
-- 2. record_syllabus_progress: live prod body, with ONLY the blocks marked
--    CHANGED added.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_syllabus_progress(p_class_id uuid, p_subject_id uuid, p_topic_id uuid, p_date date, p_action text, p_source text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_inst  uuid;
  v_ay    text;
  v_slot  uuid;
  v_event uuid;
  v_lp    boolean := false;
  v_prev  text;     -- CHANGED: the entry's action before this write
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'You must be signed in.'; END IF;
  IF p_action NOT IN ('completed','partial') OR p_source NOT IN ('checkout','checkin','correction') THEN
    RAISE EXCEPTION 'Invalid progress entry.';
  END IF;

  SELECT c.institution_id INTO v_inst FROM public.classes c WHERE c.id = p_class_id;
  IF v_inst IS NULL THEN RAISE EXCEPTION 'Class not found.'; END IF;
  IF v_inst IS DISTINCT FROM public.get_user_institution(v_uid) THEN
    RAISE EXCEPTION 'You are not allowed to record syllabus progress for this class.';
  END IF;

  IF NOT (
    public.tt_user_can_edit_class_slots(v_uid, p_class_id)
    OR EXISTS (SELECT 1 FROM public.class_assignments ca
               WHERE ca.user_id = v_uid AND ca.role = 'teacher' AND ca.class_id = p_class_id)
    OR EXISTS (SELECT 1 FROM public.tt_slots s
               WHERE s.teacher_id = v_uid AND s.class_id = p_class_id AND s.subject_id = p_subject_id)
  ) THEN
    RAISE EXCEPTION 'You are not allowed to record syllabus progress for this class.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.syllabus_topics st
                 WHERE st.id = p_topic_id AND st.subject_id = p_subject_id) THEN
    RAISE EXCEPTION 'That chapter does not belong to this subject.';
  END IF;

  -- CHANGED: remember what the entry said before, to undo its coverage mirror
  -- when it is downgraded below.
  SELECT e.action INTO v_prev FROM public.syllabus_progress_events e
   WHERE e.class_id = p_class_id AND e.subject_id = p_subject_id
     AND e.topic_id = p_topic_id AND e.date = p_date;

  INSERT INTO public.syllabus_progress_events
    (institution_id, class_id, subject_id, topic_id, date, action, source, recorded_by)
  VALUES (v_inst, p_class_id, p_subject_id, p_topic_id, p_date, p_action, p_source, v_uid)
  ON CONFLICT (class_id, subject_id, topic_id, date)
  DO UPDATE SET action = EXCLUDED.action, source = EXCLUDED.source,
                recorded_by = EXCLUDED.recorded_by, updated_at = now()
  RETURNING id INTO v_event;

  -- CHANGED: Completed -> Partial takes back the "done" the Completed entry
  -- put on a period, exactly as delete_syllabus_progress does, so coverage and
  -- the Command Center stop counting the chapter as covered on that day.
  IF p_action = 'partial' AND v_prev = 'completed' THEN
    BEGIN
      UPDATE public.tt_lesson_plans lp
         SET status = 'planned', updated_by = v_uid, updated_at = now()
       WHERE lp.class_id = p_class_id AND lp.subject_id = p_subject_id
         AND lp.date = p_date AND lp.topic_id = p_topic_id AND lp.status = 'done'
         AND NOT lp.is_note_only;
    EXCEPTION WHEN OTHERS THEN
      NULL;  -- best-effort, like the mirror write below: the event is the truth
    END;
  END IF;

  -- Coverage dual-write (best-effort, never blocks the event write): upgrade
  -- or create ONE tt_lesson_plans done row on a slot of this class+subject on
  -- p_date's weekday that doesn't already carry a done row for p_date.
  IF p_action = 'completed' THEN
    BEGIN
      SELECT ay.code INTO v_ay FROM public.cal_academic_years ay
      WHERE ay.institution_id = v_inst AND ay.is_active = true LIMIT 1;

      IF v_ay IS NOT NULL THEN
        SELECT s.id INTO v_slot
        FROM public.tt_slots s
        WHERE s.class_id = p_class_id
          -- a basket period delivers this subject too, so an optional subject
          -- can receive its coverage mirror.
          AND public.tt_slot_covers_subject(s.subject_id, s.optional_group_id, p_subject_id)
          AND s.academic_year = v_ay
          AND (s.slot_type IN ('theory','practical') OR s.optional_group_id IS NOT NULL)
          AND s.day = public.tt_dow_to_text(p_date)
          -- is_note_only is checked explicitly rather than leaning on
          -- status='done': the teacher's record of what actually happened in a
          -- period is never a candidate to be overwritten, whatever its status.
          -- Scoped to THIS subject, so a colleague's row on a shared basket
          -- period does not block this teacher.
          AND NOT EXISTS (SELECT 1 FROM public.tt_lesson_plans lp
                          WHERE lp.slot_id = s.id AND lp.date = p_date
                            AND lp.subject_id IS NOT DISTINCT FROM p_subject_id
                            AND (lp.status = 'done' OR lp.is_note_only))
        -- prefer a dedicated slot over a basket period
        ORDER BY (s.subject_id IS NOT DISTINCT FROM p_subject_id) DESC, s.id
        LIMIT 1;

        IF v_slot IS NOT NULL THEN
          INSERT INTO public.tt_lesson_plans
            (slot_id, institution_id, class_id, subject_id, owner_teacher_id, created_by,
             date, session_type, status, topic_id, updated_by, updated_at)
          VALUES (v_slot, v_inst, p_class_id, p_subject_id, v_uid, v_uid,
                  p_date, 'teaching', 'done', p_topic_id, v_uid, now())
          ON CONFLICT (slot_id, date, subject_id)
          DO UPDATE SET status = 'done', session_type = 'teaching',
                        topic_id = EXCLUDED.topic_id, is_note_only = false,
                        updated_by = EXCLUDED.updated_by, updated_at = now();
          v_lp := true;
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_lp := false;  -- swallow: the event row above is the source of truth
    END;
  END IF;

  RETURN jsonb_build_object('event_id', v_event, 'lesson_plan_written', v_lp);
END;
$function$;

-- -------------------------------------------------------------
-- 1. edit_syllabus_day
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.edit_syllabus_day(
  p_class_id         uuid,
  p_subject_id       uuid,
  p_date             date,
  p_remove_topic_ids uuid[]  DEFAULT '{}'::uuid[],
  p_set              jsonb   DEFAULT '[]'::jsonb,
  p_note             text    DEFAULT NULL,
  p_note_slot_id     uuid    DEFAULT NULL,
  p_clear_note       boolean DEFAULT false,
  p_source           text    DEFAULT 'correction'
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid          uuid := auth.uid();
  v_inst         uuid;
  v_tz           text;
  v_today        date;
  v_ay           text;
  v_topic        uuid;
  v_item         jsonb;
  v_removed      int := 0;
  v_set          int := 0;
  v_note_cleared int := 0;
  v_note_id      uuid;
  v_remirrored   int := 0;
  v_slot         uuid;
  r              record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'You must be signed in.'; END IF;
  IF p_source NOT IN ('checkout','checkin','correction') THEN
    RAISE EXCEPTION 'Invalid progress entry.';
  END IF;
  IF p_clear_note AND p_note IS NOT NULL THEN
    RAISE EXCEPTION 'Save the note or remove it, not both at once.';
  END IF;
  IF jsonb_typeof(COALESCE(p_set, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Invalid progress entry.';
  END IF;
  -- One day of one class holds a handful of chapters; this is a sanity bound,
  -- not a product limit.
  IF COALESCE(array_length(p_remove_topic_ids, 1), 0) > 100
     OR jsonb_array_length(COALESCE(p_set, '[]'::jsonb)) > 100 THEN
    RAISE EXCEPTION 'Too many changes in one save.';
  END IF;

  SELECT c.institution_id INTO v_inst FROM public.classes c WHERE c.id = p_class_id;
  IF v_inst IS NULL THEN RAISE EXCEPTION 'Class not found.'; END IF;
  IF v_inst IS DISTINCT FROM public.get_user_institution(v_uid) THEN
    RAISE EXCEPTION 'You are not allowed to edit syllabus progress for this class.';
  END IF;
  -- The same tri-clause as record_ / delete_syllabus_progress. Each step below
  -- re-checks through its own write path; this fails early and plainly.
  IF NOT (
    public.tt_user_can_edit_class_slots(v_uid, p_class_id)
    OR EXISTS (SELECT 1 FROM public.class_assignments ca
               WHERE ca.user_id = v_uid AND ca.role = 'teacher' AND ca.class_id = p_class_id)
    OR EXISTS (SELECT 1 FROM public.tt_slots s
               WHERE s.teacher_id = v_uid AND s.class_id = p_class_id AND s.subject_id = p_subject_id)
  ) THEN
    RAISE EXCEPTION 'You are not allowed to edit syllabus progress for this class.';
  END IF;

  -- Institution-local "today" (CLAUDE.md section 24). A day that has not
  -- happened yet cannot have been taught.
  SELECT COALESCE(i.timezone, 'Asia/Kolkata') INTO v_tz FROM public.institutions i WHERE i.id = v_inst;
  v_today := (now() AT TIME ZONE v_tz)::date;
  IF p_date > v_today THEN
    RAISE EXCEPTION 'You can only log a day that has already happened.';
  END IF;

  -- Step 1: remove chapter entries. The delete path also un-marks the period
  -- each one had marked done, which frees it for a note in step 4.
  FOREACH v_topic IN ARRAY COALESCE(p_remove_topic_ids, '{}'::uuid[]) LOOP
    IF COALESCE((public.delete_syllabus_progress(p_class_id, p_subject_id, v_topic, p_date) ->> 'deleted')::boolean, false) THEN
      v_removed := v_removed + 1;
    END IF;
  END LOOP;

  -- Step 2: clear the day's note (one period's, when the caller names it).
  -- Only a period the caller may write: its own, a basket period of a subject
  -- they teach in the class, or any period for an admin/coordinator.
  IF p_clear_note THEN
    DELETE FROM public.tt_lesson_plans lp
     WHERE lp.class_id = p_class_id AND lp.subject_id = p_subject_id
       AND lp.date = p_date AND lp.is_note_only
       AND (p_note_slot_id IS NULL OR lp.slot_id = p_note_slot_id)
       AND (
         lp.owner_teacher_id = v_uid
         OR public.tt_user_can_edit_class_slots(v_uid, p_class_id)
         OR EXISTS (SELECT 1 FROM public.tt_slots s
                     WHERE s.id = lp.slot_id
                       AND (s.teacher_id = v_uid
                            OR (s.optional_group_id IS NOT NULL AND EXISTS (
                                  SELECT 1 FROM public.class_assignments ca
                                   WHERE ca.user_id = v_uid AND ca.role = 'teacher'
                                     AND ca.class_id = s.class_id AND ca.subject_id = p_subject_id))))
       );
    GET DIAGNOSTICS v_note_cleared = ROW_COUNT;
  END IF;

  -- Step 3: add or change chapter entries through the one write path.
  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_set, '[]'::jsonb)) LOOP
    BEGIN
      v_topic := (v_item ->> 'topic_id')::uuid;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'Invalid progress entry.';
    END;
    IF v_topic IS NULL THEN RAISE EXCEPTION 'Invalid progress entry.'; END IF;
    PERFORM public.record_syllabus_progress(p_class_id, p_subject_id, v_topic, p_date,
                                            v_item ->> 'action', p_source);
    v_set := v_set + 1;
  END LOOP;

  -- Step 4: save the note through the one note path. Runs after the removals,
  -- so a period freed by removing its chapter can take the note.
  IF p_note IS NOT NULL THEN
    BEGIN
      v_note_id := public.tt_record_period_note(p_class_id, p_subject_id, p_date, p_note, p_note_slot_id);
    EXCEPTION WHEN raise_exception THEN
      -- The note path's own wording says "today"; this editor serves any day.
      IF SQLERRM LIKE 'Every period for this class%' THEN
        RAISE EXCEPTION 'Every period that day already has a chapter logged. Replace the chapters with the note, or remove a chapter first.';
      END IF;
      RAISE;
    END;
  END IF;

  -- Step 5: a Completed chapter that could get no period (the note held the
  -- only one) gets its "done" period back once the note is gone, so the
  -- lessons-taught count does not lose that period. Best-effort, like the
  -- mirror write in record_syllabus_progress.
  IF v_note_cleared > 0 THEN
    BEGIN
      SELECT ay.code INTO v_ay FROM public.cal_academic_years ay
       WHERE ay.institution_id = v_inst AND ay.is_active = true LIMIT 1;
      IF v_ay IS NOT NULL THEN
        FOR r IN
          SELECT e.topic_id FROM public.syllabus_progress_events e
           WHERE e.class_id = p_class_id AND e.subject_id = p_subject_id
             AND e.date = p_date AND e.action = 'completed'
             AND NOT EXISTS (SELECT 1 FROM public.tt_lesson_plans lp
                              WHERE lp.class_id = p_class_id AND lp.subject_id = p_subject_id
                                AND lp.date = p_date AND lp.status = 'done'
                                AND lp.topic_id = e.topic_id AND NOT lp.is_note_only)
           ORDER BY e.created_at
        LOOP
          v_slot := NULL;
          SELECT s.id INTO v_slot
            FROM public.tt_slots s
           WHERE s.class_id = p_class_id
             AND public.tt_slot_covers_subject(s.subject_id, s.optional_group_id, p_subject_id)
             AND s.academic_year = v_ay
             AND (s.slot_type IN ('theory','practical') OR s.optional_group_id IS NOT NULL)
             AND s.day = public.tt_dow_to_text(p_date)
             AND NOT EXISTS (SELECT 1 FROM public.tt_lesson_plans lp
                              WHERE lp.slot_id = s.id AND lp.date = p_date
                                AND lp.subject_id IS NOT DISTINCT FROM p_subject_id
                                AND (lp.status = 'done' OR lp.is_note_only))
           ORDER BY (s.subject_id IS NOT DISTINCT FROM p_subject_id) DESC, s.id
           LIMIT 1;
          EXIT WHEN v_slot IS NULL;
          INSERT INTO public.tt_lesson_plans
            (slot_id, institution_id, class_id, subject_id, owner_teacher_id, created_by,
             date, session_type, status, topic_id, updated_by, updated_at)
          VALUES (v_slot, v_inst, p_class_id, p_subject_id, v_uid, v_uid,
                  p_date, 'teaching', 'done', r.topic_id, v_uid, now())
          ON CONFLICT (slot_id, date, subject_id)
          DO UPDATE SET status = 'done', session_type = 'teaching',
                        topic_id = EXCLUDED.topic_id, is_note_only = false,
                        updated_by = EXCLUDED.updated_by, updated_at = now();
          v_remirrored := v_remirrored + 1;
        END LOOP;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;  -- best-effort: the entries and the note change are already made
    END;
  END IF;

  RETURN jsonb_build_object(
    'removed', v_removed, 'set', v_set,
    'note_cleared', v_note_cleared, 'note_id', v_note_id,
    'periods_remarked', v_remirrored);
END
$function$;

-- -------------------------------------------------------------
-- 3. History triggers
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_audit_syllabus_log()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row   public.syllabus_progress_events%ROWTYPE;
  v_actor uuid := (SELECT auth.uid());
  v_name  text;
  v_what  text;
  v_verb  text;
BEGIN
  IF TG_OP = 'DELETE' THEN v_row := OLD; ELSE v_row := NEW; END IF;

  v_what := CASE WHEN TG_OP = 'UPDATE'
                 THEN initcap(OLD.action) || ' to ' || initcap(NEW.action)
                 ELSE initcap(v_row.action) END;
  SELECT st.topic_name || ' · ' || trim(c.name || COALESCE(' ' || NULLIF(c.section, ''), ''))
         || ' · ' || to_char(v_row.date, 'FMDD Mon YYYY') || ' (' || v_what || ')'
    INTO v_name
    FROM public.syllabus_topics st, public.classes c
   WHERE st.id = v_row.topic_id AND c.id = v_row.class_id;

  v_verb := CASE TG_OP WHEN 'INSERT' THEN 'created' WHEN 'UPDATE' THEN 'updated' ELSE 'deleted' END;

  INSERT INTO public.system_audit_logs (
    actor_id, action, entity_type, entity_id, entity_name, old_values, new_values, metadata
  ) VALUES (
    v_actor, 'syllabus_log_' || v_verb, 'Syllabus log', v_row.id, v_name,
    CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END,
    jsonb_build_object('institution_id', v_row.institution_id, 'source', 'trigger', 'table', TG_TABLE_NAME)
      || CASE WHEN v_actor IS NULL THEN jsonb_build_object('via', 'system') ELSE '{}'::jsonb END
  );
  RETURN NULL;
EXCEPTION WHEN others THEN
  -- Never let the audit abort the edit it records (same contract as tg_audit_row).
  RAISE WARNING 'tg_audit_syllabus_log failed (%): %', TG_OP, SQLERRM;
  RETURN NULL;
END
$function$;

CREATE OR REPLACE FUNCTION public.tg_audit_period_note()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row   public.tt_lesson_plans%ROWTYPE;
  v_actor uuid := (SELECT auth.uid());
  v_name  text;
  v_verb  text;
BEGIN
  IF TG_OP = 'DELETE' THEN v_row := OLD; ELSE v_row := NEW; END IF;

  -- A note turned into a chapter row is the note going away; a chapter row
  -- turned into a note is the note arriving.
  v_verb := CASE
              WHEN TG_OP = 'INSERT' THEN 'created'
              WHEN TG_OP = 'DELETE' THEN 'deleted'
              WHEN OLD.is_note_only AND NOT NEW.is_note_only THEN 'deleted'
              WHEN NOT OLD.is_note_only AND NEW.is_note_only THEN 'created'
              ELSE 'updated'
            END;

  SELECT trim(c.name || COALESCE(' ' || NULLIF(c.section, ''), '')) || ' · '
         || COALESCE(us.name, 'Period') || ' · ' || to_char(v_row.date, 'FMDD Mon YYYY')
    INTO v_name
    FROM public.classes c
    LEFT JOIN public.universal_subjects us ON us.id = v_row.subject_id
   WHERE c.id = v_row.class_id;

  INSERT INTO public.system_audit_logs (
    actor_id, action, entity_type, entity_id, entity_name, old_values, new_values, metadata
  ) VALUES (
    v_actor, 'period_note_' || v_verb, 'Period note', v_row.id, v_name,
    CASE WHEN TG_OP <> 'INSERT' THEN jsonb_build_object('note', OLD.note, 'is_note_only', OLD.is_note_only, 'date', OLD.date, 'slot_id', OLD.slot_id) END,
    CASE WHEN TG_OP <> 'DELETE' THEN jsonb_build_object('note', NEW.note, 'is_note_only', NEW.is_note_only, 'date', NEW.date, 'slot_id', NEW.slot_id) END,
    jsonb_build_object('institution_id', v_row.institution_id, 'source', 'trigger', 'table', TG_TABLE_NAME)
      || CASE WHEN v_actor IS NULL THEN jsonb_build_object('via', 'system') ELSE '{}'::jsonb END
  );
  RETURN NULL;
EXCEPTION WHEN others THEN
  RAISE WARNING 'tg_audit_period_note failed (%): %', TG_OP, SQLERRM;
  RETURN NULL;
END
$function$;

DROP TRIGGER IF EXISTS zzz_audit_syllabus_log_ins ON public.syllabus_progress_events;
CREATE TRIGGER zzz_audit_syllabus_log_ins AFTER INSERT ON public.syllabus_progress_events
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_syllabus_log();
-- Only a real change: a re-save of the same action just bumps updated_at.
DROP TRIGGER IF EXISTS zzz_audit_syllabus_log_upd ON public.syllabus_progress_events;
CREATE TRIGGER zzz_audit_syllabus_log_upd AFTER UPDATE ON public.syllabus_progress_events
  FOR EACH ROW WHEN (OLD.action IS DISTINCT FROM NEW.action)
  EXECUTE FUNCTION public.tg_audit_syllabus_log();
DROP TRIGGER IF EXISTS zzz_audit_syllabus_log_del ON public.syllabus_progress_events;
CREATE TRIGGER zzz_audit_syllabus_log_del AFTER DELETE ON public.syllabus_progress_events
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_syllabus_log();

-- Notes only: planning rows and chapter mirrors are not audited here (they
-- are high-volume, and the chapter itself is audited on the events table).
DROP TRIGGER IF EXISTS zzz_audit_period_note_ins ON public.tt_lesson_plans;
CREATE TRIGGER zzz_audit_period_note_ins AFTER INSERT ON public.tt_lesson_plans
  FOR EACH ROW WHEN (NEW.is_note_only)
  EXECUTE FUNCTION public.tg_audit_period_note();
DROP TRIGGER IF EXISTS zzz_audit_period_note_upd ON public.tt_lesson_plans;
CREATE TRIGGER zzz_audit_period_note_upd AFTER UPDATE ON public.tt_lesson_plans
  FOR EACH ROW WHEN ((OLD.is_note_only OR NEW.is_note_only)
                     AND (OLD.is_note_only IS DISTINCT FROM NEW.is_note_only
                          OR OLD.note IS DISTINCT FROM NEW.note))
  EXECUTE FUNCTION public.tg_audit_period_note();
DROP TRIGGER IF EXISTS zzz_audit_period_note_del ON public.tt_lesson_plans;
CREATE TRIGGER zzz_audit_period_note_del AFTER DELETE ON public.tt_lesson_plans
  FOR EACH ROW WHEN (OLD.is_note_only)
  EXECUTE FUNCTION public.tg_audit_period_note();

-- -------------------------------------------------------------
-- 4. dash_teacher_syllabus_chapters: the 20260925150000 body with ONLY the
--    per-chapter `logs` array added (progress CTE, rows, chapter JSON).
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dash_teacher_syllabus_chapters(p_class_id uuid DEFAULT NULL::uuid, p_subject_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid(); v_inst uuid;
  v_pc uuid[]; v_ps uuid[]; v_tz text; v_today date; v_rows jsonb;
  v_ay_start date; v_ay_end date;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'dashboard: not authenticated'; END IF;
  v_inst := public.get_user_institution(v_uid);

  SELECT array_agg(p.class_id), array_agg(p.subject_id)
    INTO v_pc, v_ps FROM public.dash_resolve_teacher_pairs() p;
  IF v_pc IS NULL THEN
    RETURN jsonb_build_object('has_data', false, 'subjects', '[]'::jsonb);
  END IF;

  -- Filters may only narrow: anything outside the caller's own pairs raises.
  IF p_class_id IS NOT NULL AND NOT (p_class_id = ANY(v_pc)) THEN
    RAISE EXCEPTION 'dashboard: class not in scope';
  END IF;
  IF p_subject_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM unnest(v_ps) AS s(sid) WHERE s.sid = p_subject_id) THEN
    RAISE EXCEPTION 'dashboard: subject not in scope';
  END IF;

  SELECT i.timezone INTO v_tz FROM institutions i WHERE i.id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;
  -- The same academic-year window, and the same fallback, as dash5_atom_rows.
  SELECT start_date, end_date INTO v_ay_start, v_ay_end
    FROM public.dash_current_academic_year(v_inst);
  v_ay_start := COALESCE(v_ay_start, v_today - INTERVAL '12 months')::date;
  v_ay_end   := COALESCE(v_ay_end,   v_today)::date;

  WITH pairs AS (
    SELECT DISTINCT pr.cid AS class_id, pr.sid AS subject_id
      FROM unnest(v_pc, v_ps) AS pr(cid, sid)
     WHERE pr.sid IS NOT NULL
       AND (p_class_id IS NULL OR pr.cid = p_class_id)
       AND (p_subject_id IS NULL OR pr.sid = p_subject_id)
  ),
  -- Chapter set: the class group's mapped chapters when the subject has any,
  -- else every active chapter of the subject. Same rule as dash5_atom_rows and
  -- dash_syllabus_coverage_build; keep them identical.
  chapters AS (
    SELECT p.class_id, p.subject_id, st.id AS topic_id, st.topic_name,
           st.chapter_number, st.display_order
      FROM pairs p
      JOIN classes cl ON cl.id = p.class_id
      JOIN syllabus_topics st
        ON st.is_active AND st.subject_id = p.subject_id
       AND (st.institution_id IS NULL OR st.institution_id = v_inst)
       AND ( EXISTS (SELECT 1 FROM topic_class_mappings tcm
                      WHERE tcm.class_group_id = cl.class_group_id AND tcm.topic_id = st.id)
             OR NOT EXISTS (
               SELECT 1 FROM topic_class_mappings t2
                 JOIN syllabus_topics s2 ON s2.id = t2.topic_id
                WHERE t2.class_group_id = cl.class_group_id AND s2.is_active
                  AND s2.subject_id = p.subject_id
                  AND (s2.institution_id IS NULL OR s2.institution_id = v_inst)) )
  ),
  progress AS (
    SELECT spe.class_id, spe.subject_id, spe.topic_id,
           bool_or(spe.action = 'completed') AS is_done,
           bool_or(spe.action = 'partial')   AS is_partial,
           max(spe.date)                     AS last_logged_on,
           min(spe.date) FILTER (WHERE spe.action = 'completed') AS first_completed_on,
           -- 2026-09-29: every logged date, so the My syllabus page can open any
           -- of them for editing. One row per (chapter, date): bounded by the year.
           jsonb_agg(jsonb_build_object('date', spe.date, 'action', spe.action) ORDER BY spe.date) AS logs
      FROM syllabus_progress_events spe
      JOIN pairs p ON p.class_id = spe.class_id AND p.subject_id = spe.subject_id
     GROUP BY spe.class_id, spe.subject_id, spe.topic_id
  ),
  planned AS (
    SELECT lp.class_id, lp.subject_id, lp.topic_id, min(lp.date) AS next_planned_on
      FROM tt_lesson_plans lp
      JOIN pairs p ON p.class_id = lp.class_id AND p.subject_id = lp.subject_id
     WHERE lp.topic_id IS NOT NULL
       AND lp.date >= v_today
     GROUP BY lp.class_id, lp.subject_id, lp.topic_id
  ),
  -- Papers HELD for the caller's classes this academic year, one row per
  -- (paper, class). Whoever set it: a paper is a paper for the class.
  held AS (
    SELECT DISTINCT e.id, e.title, ec.class_id,
           COALESCE(e.scheduled_date::date, e.published_at::date, e.created_at::date) AS held_on,
           COALESCE(e.is_results_only, false) AS results_only
      FROM exams e
      JOIN exam_classes ec ON ec.exam_id = e.id AND ec.class_id = ANY (v_pc)
     WHERE e.institution_id = v_inst
       AND e.status IN ('published','completed')
       AND COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date)
           BETWEEN v_ay_start AND v_ay_end
  ),
  held_pair AS (
    SELECT DISTINCT h.id, h.title, h.class_id, h.held_on, h.results_only, es.subject_id
      FROM held h
      JOIN exam_subjects es ON es.exam_id = h.id
      JOIN pairs p ON p.class_id = h.class_id AND p.subject_id = es.subject_id
  ),
  tagged AS (
    SELECT DISTINCT et.exam_id, et.topic_id
      FROM exam_topics et
     WHERE et.topic_id IS NOT NULL
       AND et.exam_id IN (SELECT h.id FROM held h)
  ),
  chapter_exams AS (
    SELECT c.class_id, c.topic_id,
           count(*) AS n,
           jsonb_agg(jsonb_build_object(
             'id', h.id, 'title', h.title, 'held_on', h.held_on, 'results_only', h.results_only
           ) ORDER BY h.held_on, h.title) AS exams
      FROM chapters c
      JOIN tagged t ON t.topic_id = c.topic_id
      JOIN held h ON h.id = t.exam_id AND h.class_id = c.class_id
     GROUP BY c.class_id, c.topic_id
  ),
  pair_papers AS (
    SELECT hp.class_id, hp.subject_id,
           count(DISTINCT hp.id) AS papers,
           COALESCE(jsonb_agg(jsonb_build_object(
             'id', hp.id, 'title', hp.title, 'held_on', hp.held_on, 'results_only', hp.results_only
           ) ORDER BY hp.held_on, hp.title) FILTER (WHERE NOT EXISTS (
             SELECT 1 FROM tagged t
               JOIN syllabus_topics st ON st.id = t.topic_id
              WHERE t.exam_id = hp.id AND st.subject_id = hp.subject_id)), '[]'::jsonb) AS untagged
      FROM held_pair hp
     GROUP BY hp.class_id, hp.subject_id
  ),
  rows AS (
    SELECT c.class_id, c.subject_id,
           cl.name AS class_name, cl.section, us.name AS subject_name,
           c.topic_id, c.topic_name, c.chapter_number, c.display_order,
           CASE
             WHEN pg.is_done                THEN 'completed'
             WHEN pg.is_partial             THEN 'partial'
             WHEN pl.next_planned_on IS NOT NULL THEN 'scheduled'
             ELSE 'not_started'
           END AS status,
           pg.last_logged_on,
           pg.first_completed_on,
           COALESCE(pg.logs, '[]'::jsonb) AS logs,
           pl.next_planned_on,
           COALESCE(ce.n, 0) AS exams_count,
           COALESCE(ce.exams, '[]'::jsonb) AS exams,
           COALESCE(c.display_order, 9999) AS ord
      FROM chapters c
      JOIN classes cl ON cl.id = c.class_id
      JOIN universal_subjects us ON us.id = c.subject_id
      LEFT JOIN progress pg ON pg.class_id = c.class_id
                           AND pg.subject_id = c.subject_id
                           AND pg.topic_id = c.topic_id
      LEFT JOIN planned pl ON pl.class_id = c.class_id
                          AND pl.subject_id = c.subject_id
                          AND pl.topic_id = c.topic_id
      LEFT JOIN chapter_exams ce ON ce.class_id = c.class_id AND ce.topic_id = c.topic_id
  )
  SELECT COALESCE(jsonb_agg(sub ORDER BY subject_name, class_name), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT r.subject_name, r.class_name,
           jsonb_build_object(
             'class_id',     r.class_id,
             'class_name',   r.class_name,
             'section',      r.section,
             'subject_id',   r.subject_id,
             'subject_name', r.subject_name,
             'total',        count(*),
             'completed',    count(*) FILTER (WHERE r.status = 'completed'),
             'partial',      count(*) FILTER (WHERE r.status = 'partial'),
             'scheduled',    count(*) FILTER (WHERE r.status = 'scheduled'),
             'not_started',  count(*) FILTER (WHERE r.status = 'not_started'),
             'exams_total',  sum(r.exams_count),
             'papers',       COALESCE(max(pp.papers), 0),
             'untagged_exams', COALESCE((array_agg(pp.untagged))[1], '[]'::jsonb),
             'chapters', jsonb_agg(jsonb_build_object(
                'topic_id',           r.topic_id,
                'name',               r.topic_name,
                'chapter_number',     r.chapter_number,
                'display_order',      r.display_order,
                'status',             r.status,
                'last_logged_on',     r.last_logged_on,
                'first_completed_on', r.first_completed_on,
                'next_planned_on',    r.next_planned_on,
                'exams_count',        r.exams_count,
                'exams',              r.exams,
                'logs',               r.logs
             ) ORDER BY r.ord, r.chapter_number NULLS LAST, r.topic_name)
           ) AS sub
      FROM rows r
      LEFT JOIN pair_papers pp ON pp.class_id = r.class_id AND pp.subject_id = r.subject_id
     GROUP BY r.class_id, r.class_name, r.section, r.subject_id, r.subject_name
  ) q;

  RETURN jsonb_build_object('has_data', jsonb_array_length(v_rows) > 0, 'subjects', v_rows);
END
$function$;

-- -------------------------------------------------------------
-- 5. Grants. Supabase's default privileges grant EXECUTE to anon on every
--    function and REVOKE FROM PUBLIC does not strip it (CLAUDE.md section 26),
--    so anon is revoked BY NAME on the new function and on the two older
--    write paths, which held it (verified in pg_proc.proacl 2026-09-29).
-- -------------------------------------------------------------
REVOKE ALL ON FUNCTION public.edit_syllabus_day(uuid, uuid, date, uuid[], jsonb, text, uuid, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.edit_syllabus_day(uuid, uuid, date, uuid[], jsonb, text, uuid, boolean, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.edit_syllabus_day(uuid, uuid, date, uuid[], jsonb, text, uuid, boolean, text) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.record_syllabus_progress(uuid, uuid, uuid, date, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_syllabus_progress(uuid, uuid, uuid, date, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_syllabus_progress(uuid, uuid, uuid, date, text, text) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.delete_syllabus_progress(uuid, uuid, uuid, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_syllabus_progress(uuid, uuid, uuid, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_syllabus_progress(uuid, uuid, uuid, date) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.dash_teacher_syllabus_chapters(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dash_teacher_syllabus_chapters(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.dash_teacher_syllabus_chapters(uuid, uuid) TO authenticated, service_role;

-- Trigger functions cannot be called directly, but keep them off every role.
REVOKE ALL ON FUNCTION public.tg_audit_syllabus_log() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_audit_period_note() FROM PUBLIC, anon, authenticated;
