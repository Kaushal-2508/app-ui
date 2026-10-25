-- Diary: one entry for several students of a class, saved together.
-- NEEDS DB from naman-erp 7f6a0427 (the "Addressed to" dropdown), approved by
-- Tushar 2026-10-01. Contract: docs/superpowers/specs/2026-09-07-school-diary-design.md,
-- "Several students at once".
--
-- One copy per student (a diary_entries row each, the multi-person Tasks model),
-- all in ONE transaction: every student gets it or none does (CLAUDE.md 9a).
-- The body loops diary_write_entry, so every rule stays in one place: content
-- checks, diary_can_write_for (teacher_controls_student for a single student,
-- section 25), the school-local entry date (24) and the per-student bell row.
--
-- Before writing anything, every student is checked with diary_can_write_for so
-- a refusal names who was refused (the composer lists the whole class roster,
-- which in a section with recorded optional choices can include a student
-- outside the teacher's subjects). The message stays under 160 characters so
-- toastError shows it as written.
--
-- Idempotent per copy: diary_write_entry returns early on an id that already
-- exists, so a retry after a dropped connection writes and notifies nothing twice.
--
-- Also: notice_class_students lost its stray PUBLIC grant (anon could call it;
-- it returned nothing without a user, but section 26 says no anon EXECUTE).

CREATE OR REPLACE FUNCTION public.diary_write_entries(
  _entry_ids   uuid[],
  _class_id    uuid,
  _student_ids uuid[],
  _kind        text,
  _title       text,
  _body        text,
  _due_date    date DEFAULT NULL
)
RETURNS uuid[]
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid        uuid := (SELECT auth.uid());
  v_n          integer := coalesce(array_length(_student_ids, 1), 0);
  v_refused    text[];
  v_refused_n  integer;
  v_names      text;
  v_msg        text;
  i            integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'You must be signed in.'; END IF;
  IF _class_id IS NULL THEN RAISE EXCEPTION 'This entry is missing its class.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.classes c WHERE c.id = _class_id) THEN
    RAISE EXCEPTION 'That class no longer exists.';
  END IF;
  IF v_n = 0 THEN RAISE EXCEPTION 'Choose at least one student.'; END IF;
  IF v_n > 200 THEN
    RAISE EXCEPTION 'Choose 200 students or fewer, or write for the whole class.';
  END IF;
  IF coalesce(array_length(_entry_ids, 1), 0) <> v_n
     OR EXISTS (SELECT 1 FROM unnest(_entry_ids) e WHERE e IS NULL)
     OR (SELECT count(DISTINCT e) FROM unnest(_entry_ids) e) <> v_n THEN
    RAISE EXCEPTION 'Each student needs its own entry. Close the form and try again.';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(_student_ids) s WHERE s IS NULL)
     OR (SELECT count(DISTINCT s) FROM unnest(_student_ids) s) <> v_n THEN
    RAISE EXCEPTION 'A student is listed twice. Untick the repeat and save again.';
  END IF;

  -- Everyone first, so the message can say who.
  SELECT array_agg(coalesce(nullif(btrim(p.full_name), ''), 'a student') ORDER BY p.full_name),
         count(*)
    INTO v_refused, v_refused_n
    FROM unnest(_student_ids) AS s(id)
    LEFT JOIN public.profiles p ON p.id = s.id
   WHERE NOT public.diary_can_write_for(_class_id, s.id, v_uid);

  IF v_refused_n > 0 THEN
    v_names := array_to_string(v_refused[1:3], ', ')
               || CASE WHEN v_refused_n > 3 THEN ' and ' || (v_refused_n - 3) || ' more' ELSE '' END;
    v_msg := format('You can''t write for %s of these students: %s. Untick them and save again.',
                    v_refused_n, v_names);
    IF length(v_msg) > 155 THEN
      v_msg := format('You can''t write for %s of these students. Untick them and save again.', v_refused_n);
    END IF;
    RAISE EXCEPTION '%', v_msg;
  END IF;

  FOR i IN 1 .. v_n LOOP
    PERFORM public.diary_write_entry(_entry_ids[i], _class_id, _student_ids[i],
                                     _kind, _title, _body, _due_date);
  END LOOP;

  RETURN _entry_ids;
END;
$$;

COMMENT ON FUNCTION public.diary_write_entries(uuid[], uuid, uuid[], text, text, text, date) IS
  'Diary: the same entry for 2..200 students of one class, one copy each, one transaction. Loops diary_write_entry. Since 20261001120000.';

REVOKE ALL ON FUNCTION public.diary_write_entries(uuid[], uuid, uuid[], text, text, text, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.diary_write_entries(uuid[], uuid, uuid[], text, text, text, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.diary_write_entries(uuid[], uuid, uuid[], text, text, text, date) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.notice_class_students(uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notice_class_students(uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.notice_class_students(uuid[]) TO authenticated, service_role;
