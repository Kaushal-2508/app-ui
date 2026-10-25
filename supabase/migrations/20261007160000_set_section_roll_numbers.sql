-- Save a section's roll numbers in ONE transaction.
--
-- The Update Roll Number sheet used to call update_student_details once per
-- changed student. Each call checks the new number against what is stored at
-- that moment, so any shift (5,6,7 -> 6,7,8) or swap could never save: every
-- row's new number was still held by the next row, which had not been written
-- yet, and only the end of the chain got through. Seen on Alliance Class 9 A,
-- 2026-10-07 ("Saved 1 of 9").
--
-- set_section_roll_numbers checks the FINAL state instead (each changed
-- student's new number against every classmate's number after the whole batch
-- applies), then writes every row in one statement. All or nothing: a refused
-- save changes nothing.
--
-- Rules carried over unchanged from update_student_details:
--   * authority is can_edit_student_details(caller, student), per student
--     (admins, wing coordinators, subject-scoped teachers);
--   * uniqueness is per section: any class the student is a 'student' in;
--   * blank clears the number; values are compared after btrim, exactly.
-- Duplicates already present between two students the save does not touch
-- are left alone, as before.

CREATE OR REPLACE FUNCTION public.set_section_roll_numbers(_class_id uuid, _changes jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor    uuid := auth.uid();
  v_ids      uuid[];
  v_rolls    text[];
  v_name     text;
  v_conflict record;
  v_chg_ids  uuid[];
  v_names    text[];
  v_old      text[];
  v_new      text[];
  v_inst     uuid[];
BEGIN
  -- Fail closed: a NULL caller must never fall through the checks below.
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Please sign in again.' USING ERRCODE = '42501';
  END IF;

  IF _class_id IS NULL OR _changes IS NULL OR jsonb_typeof(_changes) <> 'array' THEN
    RAISE EXCEPTION 'Nothing to save.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(_changes) = 0 THEN
    RETURN 0;
  END IF;
  IF jsonb_array_length(_changes) > 1000 THEN
    RAISE EXCEPTION 'Too many students in one save. Save at most 1000 at a time.' USING ERRCODE = '22023';
  END IF;

  SELECT array_agg((e.value->>'student_id')::uuid ORDER BY e.ord),
         array_agg(NULLIF(btrim(e.value->>'roll_number'), '') ORDER BY e.ord)
  INTO v_ids, v_rolls
  FROM jsonb_array_elements(_changes) WITH ORDINALITY AS e(value, ord);

  IF EXISTS (SELECT 1 FROM unnest(v_ids) s(sid) WHERE s.sid IS NULL)
     OR (SELECT count(DISTINCT s.sid) FROM unnest(v_ids) s(sid)) <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'Each student can appear only once in a save.' USING ERRCODE = '22023';
  END IF;

  -- Every student must still be in this section.
  SELECT coalesce(p.full_name, 'A student') INTO v_name
  FROM unnest(v_ids) s(sid)
  LEFT JOIN public.profiles p ON p.id = s.sid
  WHERE NOT EXISTS (
    SELECT 1 FROM public.class_assignments ca
    WHERE ca.user_id = s.sid AND ca.class_id = _class_id AND ca.role = 'student'
  )
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION '% is no longer in this section. Reload the list and try again.', v_name
      USING ERRCODE = '22023';
  END IF;

  -- Same authority as update_student_details, checked for every student.
  SELECT p.full_name INTO v_name
  FROM unnest(v_ids) s(sid)
  JOIN public.profiles p ON p.id = s.sid
  WHERE NOT public.can_edit_student_details(v_actor, s.sid)
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'You do not have permission to edit %.', v_name USING ERRCODE = '42501';
  END IF;

  -- Serialise saves that touch the same sections, in a fixed order, so two
  -- people saving at once cannot both pass the check below and then collide.
  PERFORM pg_advisory_xact_lock(hashtextextended('set_section_roll_numbers:' || x.class_id::text, 0))
  FROM (
    SELECT DISTINCT ca.class_id
    FROM public.class_assignments ca
    WHERE ca.user_id = ANY (v_ids) AND ca.role = 'student'
    ORDER BY ca.class_id
  ) x;

  -- Final-state uniqueness: a changed student's new number against every
  -- classmate as they will be after this save.
  WITH ch AS (
    SELECT t.sid, t.roll FROM unnest(v_ids, v_rolls) AS t(sid, roll)
  ),
  cls AS (
    SELECT DISTINCT ca.class_id
    FROM public.class_assignments ca
    JOIN ch ON ch.sid = ca.user_id
    WHERE ca.role = 'student'
  ),
  fin AS (
    SELECT DISTINCT ca.class_id, p.id, p.full_name,
           CASE WHEN ch.sid IS NOT NULL THEN ch.roll ELSE p.roll_number END AS roll,
           ch.sid IS NOT NULL AS changed
    FROM public.class_assignments ca
    JOIN cls ON cls.class_id = ca.class_id
    JOIN public.profiles p ON p.id = ca.user_id
    LEFT JOIN ch ON ch.sid = p.id
    WHERE ca.role = 'student'
  )
  SELECT f1.roll, f1.full_name AS first_name, f2.full_name AS second_name
  INTO v_conflict
  FROM fin f1
  JOIN fin f2 ON f2.class_id = f1.class_id AND f2.roll = f1.roll AND f2.id <> f1.id
  WHERE f1.changed AND f1.roll IS NOT NULL
  ORDER BY f1.roll, f1.full_name
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Roll number % would be shared by % and %. Give one of them a different number.',
      v_conflict.roll, v_conflict.first_name, v_conflict.second_name
      USING ERRCODE = '23505';
  END IF;

  -- Only rows whose number really changes are written and audited.
  SELECT array_agg(p.id ORDER BY p.id),
         array_agg(p.full_name ORDER BY p.id),
         array_agg(p.roll_number ORDER BY p.id),
         array_agg(t.roll ORDER BY p.id),
         array_agg(p.institution_id ORDER BY p.id)
  INTO v_chg_ids, v_names, v_old, v_new, v_inst
  FROM unnest(v_ids, v_rolls) AS t(sid, roll)
  JOIN public.profiles p ON p.id = t.sid
  WHERE p.roll_number IS DISTINCT FROM t.roll;

  IF v_chg_ids IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE public.profiles p
  SET roll_number = c.new_roll,
      updated_at  = now()
  FROM unnest(v_chg_ids, v_new) AS c(id, new_roll)
  WHERE p.id = c.id;

  -- Same activity row the browser used to write per student, now with the
  -- before/after numbers. Best effort: an audit failure must never undo the save.
  BEGIN
    INSERT INTO public.system_audit_logs
      (actor_id, action, entity_type, entity_id, entity_name, old_values, new_values, metadata)
    SELECT v_actor, 'student_details_updated', 'Student', a.id, a.full_name,
           jsonb_build_object('roll_number', a.old_roll),
           jsonb_build_object('roll_number', a.new_roll),
           jsonb_build_object('institution_id', a.inst, 'class_id', _class_id,
                              'source', 'set_section_roll_numbers')
    FROM unnest(v_chg_ids, v_names, v_old, v_new, v_inst) AS a(id, full_name, old_roll, new_roll, inst);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'set_section_roll_numbers: audit insert failed: %', SQLERRM;
  END;

  RETURN cardinality(v_chg_ids);
END;
$$;

COMMENT ON FUNCTION public.set_section_roll_numbers(uuid, jsonb) IS
  'Update Roll Number sheet: saves a section''s changed roll numbers in one transaction, checking uniqueness against the final state so shifts and swaps work. _changes = [{student_id, roll_number}]. Returns rows changed.';

REVOKE ALL ON FUNCTION public.set_section_roll_numbers(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_section_roll_numbers(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_section_roll_numbers(uuid, jsonb) TO authenticated, service_role;
