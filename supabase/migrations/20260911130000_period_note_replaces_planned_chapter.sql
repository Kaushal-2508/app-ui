-- A planned chapter must not block a note-only log.
--
-- The bug (2026-09-11, Salci National, Class 12 Sci Non-Med A / English Core):
-- the teacher had PLANNED a chapter on today's only period from the timetable
-- dialog (tt_lesson_plans row: status 'planned', topic_id set, is_note_only
-- false). Nothing was delivered, so no syllabus_progress_events row existed and
-- the check-out sheet listed the group as unfilled. "Something else happened
-- this period" then failed with
--   P0001 Every period for this class today already has a lesson logged.
-- because the gate path of tt_record_period_note refused ANY chapter-tagged row
-- on the chosen period, planned or delivered. The teacher's only way out was to
-- claim the chapter they had not taught, the exact trap note-only exists to
-- close. delete_syllabus_progress reaches the same state from the other side:
-- it reverts the coverage mirror to 'planned' but keeps topic_id.
--
-- The refusal exists to protect a DELIVERED chapter (the coverage mirror that
-- record_syllabus_progress writes as status 'done'). A planned/pending/skipped
-- row is an intention, not a record of what happened, and the dialog path
-- already replaces one (behind the "Replace chapter entry" alert). So:
--   * the refusal now fires only for a status = 'done' chapter row;
--   * candidate ordering prefers an empty period, then an existing note-only
--     row, then a not-yet-delivered chapter row, and a delivered chapter last,
--     so a delivered chapter is only ever "chosen" when nothing else exists.
-- Body otherwise preserved verbatim from 20260910160000; the changed lines are
-- marked CHANGED. Cells 17-18 of scripts/verify-note-only-day.sql pin this.

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
    -- A basket period carries no subject and no teacher of its own, so it is
    -- matched through its group and authorised through the caller's own
    -- class+subject teaching assignment.
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
    -- period), then one holding a chapter that was only PLANNED (an intention
    -- the note supersedes). A period holding a DELIVERED chapter sorts last
    -- and is refused below.
    -- Basket periods are candidates as well, matched by group and by the
    -- caller's own teaching assignment; and the lesson-plan join is scoped to
    -- this subject so a colleague's row is not mistaken for ours.
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
              (lp.status IS DISTINCT FROM 'done') DESC,   -- CHANGED: undelivered before delivered
              (s.subject_id IS NOT DISTINCT FROM p_subject_id) DESC, s.id
     LIMIT 1;
    IF v_slot IS NULL THEN
      RAISE EXCEPTION 'You have no period for this class on that day.';
    END IF;
    -- Every period already carries a DELIVERED chapter: refuse rather than
    -- destroy one. A planned chapter is not a delivery and does not count.
    IF EXISTS (
      SELECT 1 FROM public.tt_lesson_plans lp
       WHERE lp.slot_id = v_slot AND lp.date = p_date
         AND lp.subject_id IS NOT DISTINCT FROM p_subject_id
         AND NOT lp.is_note_only AND lp.topic_id IS NOT NULL
         AND lp.status = 'done'   -- CHANGED: only a delivered chapter blocks
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
  ON CONFLICT (slot_id, date, subject_id) DO UPDATE SET
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

-- CREATE OR REPLACE keeps the existing grants, but re-assert them so this file
-- stands on its own (CLAUDE.md section 26: revoke from anon BY NAME).
REVOKE ALL ON FUNCTION public.tt_record_period_note(uuid, uuid, date, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tt_record_period_note(uuid, uuid, date, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.tt_record_period_note(uuid, uuid, date, text, uuid) TO authenticated;
