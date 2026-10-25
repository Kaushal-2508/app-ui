-- =============================================================
-- An optional-group period is an ORDINARY period for its teacher
-- -------------------------------------------------------------
-- "Optional" classifies which STUDENTS attend a period. It says nothing
-- about the teacher: a teacher who teaches English Core inside the
-- "Optional 2" basket is simply teaching English Core, and must get the
-- same lesson plan, the same chapter logging and the same status as any
-- other period.
--
-- What blocked that: tt_lesson_plans is keyed UNIQUE (slot_id, date), but a
-- basket period is ONE slot shared by several subjects, each with its own
-- teacher. One plan row per slot means the second teacher to save silently
-- overwrites the first and steals owner_teacher_id. So the teacher-side UI
-- refused to open these periods at all, and in prod 170 basket periods
-- across 17 classes and 25 teachers have never held a single lesson plan.
--
-- The grain is widened to one row per (slot, date, SUBJECT). For every
-- ordinary slot the subject is fixed by the slot, so this is identical to
-- the old key; only a basket period can now hold more than one row.
--
-- Verified in prod before writing: PG 17.6 (NULLS NOT DISTINCT available),
-- 1190 plan rows, 0 with a NULL subject_id, and 0 that would collide on the
-- new key. NULLS NOT DISTINCT keeps exactly one row per (slot, date) for a
-- subject-less slot, which plain UNIQUE would not.
-- =============================================================

-- -------------------------------------------------------------
-- 1. Does this slot deliver this subject?
--    True for an ordinary slot carrying the subject, and for a basket
--    period whose group contains it. Used by both writers below and by any
--    future period-discovery query that must stop excluding baskets.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tt_slot_covers_subject(
  _slot_subject uuid, _slot_group uuid, _subject uuid
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  SELECT _slot_subject IS NOT DISTINCT FROM _subject
     OR (
       _slot_group IS NOT NULL
       AND _subject IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM public.optional_group_subjects ogs
         WHERE ogs.group_id = _slot_group AND ogs.subject_id = _subject
       )
     );
$fn$;

COMMENT ON FUNCTION public.tt_slot_covers_subject(uuid, uuid, uuid) IS
  'True when a tt_slots row delivers the given subject: either it carries the subject directly, or it is an optional-group (basket) period whose group contains it.';

REVOKE ALL ON FUNCTION public.tt_slot_covers_subject(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tt_slot_covers_subject(uuid, uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.tt_slot_covers_subject(uuid, uuid, uuid) TO authenticated;

-- -------------------------------------------------------------
-- 2. Widen the lesson-plan grain to (slot, date, subject).
-- -------------------------------------------------------------
DO $guard$
DECLARE dup integer;
BEGIN
  SELECT count(*) INTO dup FROM (
    SELECT slot_id, date, subject_id FROM public.tt_lesson_plans
    GROUP BY slot_id, date, subject_id HAVING count(*) > 1
  ) x;
  IF dup > 0 THEN
    RAISE EXCEPTION 'Refusing to swap the key: % (slot,date,subject) group(s) already duplicated', dup;
  END IF;
END;
$guard$;

ALTER TABLE public.tt_lesson_plans
  DROP CONSTRAINT IF EXISTS tt_lesson_plans_unique_slot_date;

ALTER TABLE public.tt_lesson_plans
  DROP CONSTRAINT IF EXISTS tt_lesson_plans_unique_slot_date_subject;

ALTER TABLE public.tt_lesson_plans
  ADD CONSTRAINT tt_lesson_plans_unique_slot_date_subject
  UNIQUE NULLS NOT DISTINCT (slot_id, date, subject_id);

COMMENT ON CONSTRAINT tt_lesson_plans_unique_slot_date_subject ON public.tt_lesson_plans IS
  'One plan per period per date PER SUBJECT. Identical to the old (slot_id, date) key for ordinary slots, where the subject is fixed by the slot; a basket period holds one row per subject so parallel teachers cannot overwrite each other. NULLS NOT DISTINCT keeps one row per date for a subject-less slot.';

-- -------------------------------------------------------------
-- 3. record_syllabus_progress: mirror onto basket periods too.
--    Body preserved verbatim except the blocks marked CHANGED.
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

  INSERT INTO public.syllabus_progress_events
    (institution_id, class_id, subject_id, topic_id, date, action, source, recorded_by)
  VALUES (v_inst, p_class_id, p_subject_id, p_topic_id, p_date, p_action, p_source, v_uid)
  ON CONFLICT (class_id, subject_id, topic_id, date)
  DO UPDATE SET action = EXCLUDED.action, source = EXCLUDED.source,
                recorded_by = EXCLUDED.recorded_by, updated_at = now()
  RETURNING id INTO v_event;

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
          -- CHANGED: a basket period delivers this subject too, so an
          -- optional subject can finally receive its coverage mirror.
          AND public.tt_slot_covers_subject(s.subject_id, s.optional_group_id, p_subject_id)
          AND s.academic_year = v_ay
          AND (s.slot_type IN ('theory','practical') OR s.optional_group_id IS NOT NULL)
          AND s.day = public.tt_dow_to_text(p_date)
          -- is_note_only is checked explicitly rather than leaning on
          -- status='done': the teacher's record of what actually happened in a
          -- period is never a candidate to be overwritten, whatever its status.
          -- CHANGED: scoped to THIS subject, so a colleague's row on a shared
          -- basket period no longer blocks this teacher.
          AND NOT EXISTS (SELECT 1 FROM public.tt_lesson_plans lp
                          WHERE lp.slot_id = s.id AND lp.date = p_date
                            AND lp.subject_id IS NOT DISTINCT FROM p_subject_id
                            AND (lp.status = 'done' OR lp.is_note_only))
        -- CHANGED: prefer a dedicated slot over a basket period, so nothing
        -- about ordinary subjects changes.
        ORDER BY (s.subject_id IS NOT DISTINCT FROM p_subject_id) DESC, s.id
        LIMIT 1;

        IF v_slot IS NOT NULL THEN
          INSERT INTO public.tt_lesson_plans
            (slot_id, institution_id, class_id, subject_id, owner_teacher_id, created_by,
             date, session_type, status, topic_id, updated_by, updated_at)
          VALUES (v_slot, v_inst, p_class_id, p_subject_id, v_uid, v_uid,
                  p_date, 'teaching', 'done', p_topic_id, v_uid, now())
          ON CONFLICT (slot_id, date, subject_id)   -- CHANGED: new key
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
-- 4. tt_record_period_note: let a basket period take a note-only log.
--    Body preserved verbatim except the blocks marked CHANGED.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tt_record_period_note(p_class_id uuid, p_subject_id uuid, p_date date, p_note text, p_slot_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_inst  uuid;
  v_ay    text;
  v_note  text := btrim(COALESCE(p_note, ''));
  v_slot  uuid;
  v_owner uuid;
  v_id    uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF v_note = '' THEN RAISE EXCEPTION 'A note is required.'; END IF;
  IF length(v_note) > 2000 THEN
    RAISE EXCEPTION 'That note is too long. Keep it under 2000 characters.';
  END IF;

  SELECT p.institution_id INTO v_inst FROM public.profiles p WHERE p.id = v_uid;
  IF v_inst IS NULL THEN RAISE EXCEPTION 'no institution context'; END IF;

  SELECT ay.code INTO v_ay FROM public.cal_academic_years ay
   WHERE ay.institution_id = v_inst AND ay.is_active = true LIMIT 1;
  IF v_ay IS NULL THEN RAISE EXCEPTION 'no active academic year'; END IF;

  IF p_slot_id IS NOT NULL THEN
    -- Dialog path. Verify BOTH that the period really belongs to this
    -- (class, subject) pair and that the caller may write it, so a crafted
    -- payload cannot log against someone else's class.
    -- CHANGED: a basket period carries no subject and no teacher of its own,
    -- so it is matched through its group and authorised through the caller's
    -- own class+subject teaching assignment.
    SELECT s.id, s.teacher_id INTO v_slot, v_owner
      FROM public.tt_slots s
     WHERE s.id = p_slot_id
       AND s.class_id = p_class_id
       AND public.tt_slot_covers_subject(s.subject_id, s.optional_group_id, p_subject_id)
       AND (
         s.teacher_id = v_uid
         OR public.tt_user_can_edit_class_slots(v_uid, s.class_id)
         OR (s.optional_group_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.class_assignments ca
              WHERE ca.user_id = v_uid AND ca.role = 'teacher'
                AND ca.class_id = s.class_id AND ca.subject_id = p_subject_id))
       );
    IF v_slot IS NULL THEN
      RAISE EXCEPTION 'That period does not match this class, or you cannot edit it.';
    END IF;
  ELSE
    -- Gate path. Prefer a period with nothing logged, then one already
    -- note-only (so re-saving edits it rather than spilling onto a second
    -- period). A period holding a chapter is never a candidate.
    -- CHANGED: basket periods are candidates as well, matched by group and by
    -- the caller's own teaching assignment; and the lesson-plan join is
    -- scoped to this subject so a colleague's row is not mistaken for ours.
    SELECT s.id, s.teacher_id INTO v_slot, v_owner
      FROM public.tt_slots s
      LEFT JOIN public.tt_lesson_plans lp
             ON lp.slot_id = s.id AND lp.date = p_date
            AND lp.subject_id IS NOT DISTINCT FROM p_subject_id
     WHERE s.class_id = p_class_id
       AND public.tt_slot_covers_subject(s.subject_id, s.optional_group_id, p_subject_id)
       AND s.academic_year = v_ay
       AND (s.slot_type IN ('theory','practical') OR s.optional_group_id IS NOT NULL)
       AND s.day = public.tt_dow_to_text(p_date)
       AND (
         s.teacher_id = v_uid
         OR (s.optional_group_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.class_assignments ca
              WHERE ca.user_id = v_uid AND ca.role = 'teacher'
                AND ca.class_id = s.class_id AND ca.subject_id = p_subject_id))
       )
     ORDER BY (lp.id IS NULL) DESC, lp.is_note_only DESC NULLS LAST,
              (s.subject_id IS NOT DISTINCT FROM p_subject_id) DESC, s.id
     LIMIT 1;
    IF v_slot IS NULL THEN
      RAISE EXCEPTION 'You have no period for this class on that day.';
    END IF;
    -- Every period already carries a chapter: refuse rather than destroy one.
    IF EXISTS (
      SELECT 1 FROM public.tt_lesson_plans lp
       WHERE lp.slot_id = v_slot AND lp.date = p_date
         AND lp.subject_id IS NOT DISTINCT FROM p_subject_id
         AND NOT lp.is_note_only AND lp.topic_id IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'Every period for this class today already has a lesson logged.';
    END IF;
  END IF;

  INSERT INTO public.tt_lesson_plans (
    institution_id, slot_id, class_id, subject_id, owner_teacher_id, date,
    session_type, status, topic_id, chapter_topic_id, note, is_note_only,
    created_by, updated_by
  ) VALUES (
    -- owner is the SLOT's teacher, so an admin logging on someone's behalf
    -- does not steal ownership of the period. A basket period has no slot
    -- teacher, so the caller owns their own subject's row.
    v_inst, v_slot, p_class_id, p_subject_id, COALESCE(v_owner, v_uid), p_date,
    'other', 'done', NULL, NULL, v_note, true,
    v_uid, v_uid
  )
  ON CONFLICT (slot_id, date, subject_id) DO UPDATE SET   -- CHANGED: new key
    session_type     = 'other',
    status           = 'done',
    topic_id         = NULL,
    chapter_topic_id = NULL,
    note             = EXCLUDED.note,
    is_note_only     = true,
    updated_by       = EXCLUDED.updated_by,
    updated_at       = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END $function$;
