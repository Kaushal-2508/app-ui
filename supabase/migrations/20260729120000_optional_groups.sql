-- =============================================================
-- OPTIONAL GROUPS — "Optional 1 / Optional 2" elective baskets
-- -------------------------------------------------------------
-- A group = a named basket of subjects attached to a class_group.
-- All subjects of a group run in parallel in the same timetable
-- period; each student picks AT MOST ONE subject per group.
--
-- Load-bearing decision: student choices write into the EXISTING
-- student_optional_enrollments table (soft is_active toggle), and
-- group subjects are auto-marked is_optional=true on
-- subject_class_group_mappings (existing fanout trigger mirrors to
-- sections). All P3/P4 exam+homework filtering therefore keeps
-- working with zero new filtering code, and teachers get rights via
-- normal class_assignments — this model has no "batch teacher" hole.
--
-- Supersedes the P5/P6 batches+band scheduling (tables left in
-- place, no new writes). Spec:
-- docs/superpowers/specs/2026-07-29-optional-groups-design.md
--
-- §23 compliance: FK indexes in-migration, RLS through SECURITY
-- DEFINER helpers only, policies wrap (select auth.uid()), multi-
-- step writes are single RPCs.
-- =============================================================

-- -------------------------------------------------------------
-- 1. Tables
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.optional_groups (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id  uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  class_group_id  uuid NOT NULL REFERENCES public.class_groups(id) ON DELETE CASCADE,
  name            text NOT NULL,
  position        integer NOT NULL DEFAULT 1,
  created_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_optional_groups_cg_name UNIQUE (class_group_id, name)
);

CREATE INDEX IF NOT EXISTS idx_og2_institution ON public.optional_groups(institution_id);
CREATE INDEX IF NOT EXISTS idx_og2_class_group ON public.optional_groups(class_group_id);
CREATE INDEX IF NOT EXISTS idx_og2_created_by  ON public.optional_groups(created_by) WHERE created_by IS NOT NULL;

DROP TRIGGER IF EXISTS og2_set_updated_at ON public.optional_groups;
CREATE TRIGGER og2_set_updated_at
  BEFORE UPDATE ON public.optional_groups
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.optional_groups IS
  'Named elective basket ("Optional 1") per class_group. Subjects in a group run in parallel; a student picks at most one per group (choice stored in student_optional_enrollments).';

CREATE TABLE IF NOT EXISTS public.optional_group_subjects (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    uuid NOT NULL REFERENCES public.optional_groups(id) ON DELETE CASCADE,
  subject_id  uuid NOT NULL REFERENCES public.universal_subjects(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_ogs2_group_subject UNIQUE (group_id, subject_id)
);

CREATE INDEX IF NOT EXISTS idx_ogs2_group   ON public.optional_group_subjects(group_id);
CREATE INDEX IF NOT EXISTS idx_ogs2_subject ON public.optional_group_subjects(subject_id);

-- Timetable linkage — a slot that hosts a whole group in parallel.
ALTER TABLE public.tt_slots
  ADD COLUMN IF NOT EXISTS optional_group_id uuid REFERENCES public.optional_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tt_slots_optional_group
  ON public.tt_slots(optional_group_id) WHERE optional_group_id IS NOT NULL;

COMMENT ON COLUMN public.tt_slots.optional_group_id IS
  'When set, this cell hosts the optional group''s subjects in parallel (slot_type stays ''free'' to satisfy the academic-type CHECK; subject_id/teacher_id stay NULL). Students/teachers resolve their own subject via my_optional_slot_choices / my_teacher_optional_week.';

-- -------------------------------------------------------------
-- 2. Authorization helpers (SECURITY DEFINER)
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_manage_optional_groups(_actor uuid, _institution uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    public.is_super_admin(_actor)
    OR (
      _institution = public.get_user_institution(_actor)
      AND (
        public.has_role(_actor, 'school_admin')
        OR public.has_role(_actor, 'super_school_admin')
        OR public.has_role(_actor, 'coordinator')
        OR public.is_syllabus_manager(_actor)
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.can_view_optional_group(_actor uuid, _group uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.optional_groups og
    WHERE og.id = _group
      AND (og.institution_id = public.get_user_institution(_actor)
           OR public.is_super_admin(_actor))
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_optional_group(_actor uuid, _group uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.optional_groups og
    WHERE og.id = _group
      AND public.can_manage_optional_groups(_actor, og.institution_id)
  );
$$;

GRANT EXECUTE ON FUNCTION public.can_manage_optional_groups(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_optional_group(uuid, uuid)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_optional_group(uuid, uuid)  TO authenticated;

-- -------------------------------------------------------------
-- 3. RLS
-- -------------------------------------------------------------
ALTER TABLE public.optional_groups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS og2_select ON public.optional_groups;
DROP POLICY IF EXISTS og2_manage ON public.optional_groups;

-- Subject offerings aren't sensitive; students need the embedded
-- join in week views, teachers in the slot drawer.
CREATE POLICY og2_select ON public.optional_groups
  FOR SELECT TO authenticated
  USING (
    institution_id = public.get_user_institution((select auth.uid()))
    OR public.is_super_admin((select auth.uid()))
  );

CREATE POLICY og2_manage ON public.optional_groups
  FOR ALL TO authenticated
  USING (public.can_manage_optional_groups((select auth.uid()), institution_id))
  WITH CHECK (public.can_manage_optional_groups((select auth.uid()), institution_id));

ALTER TABLE public.optional_group_subjects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ogs2_select ON public.optional_group_subjects;
DROP POLICY IF EXISTS ogs2_manage ON public.optional_group_subjects;

CREATE POLICY ogs2_select ON public.optional_group_subjects
  FOR SELECT TO authenticated
  USING (public.can_view_optional_group((select auth.uid()), group_id));

CREATE POLICY ogs2_manage ON public.optional_group_subjects
  FOR ALL TO authenticated
  USING (public.can_manage_optional_group((select auth.uid()), group_id))
  WITH CHECK (public.can_manage_optional_group((select auth.uid()), group_id));

-- -------------------------------------------------------------
-- 4. Group management RPCs
-- -------------------------------------------------------------
-- Lazy-create (or return) the group row for (class_group, name).
CREATE OR REPLACE FUNCTION public.upsert_optional_group(_class_group_id uuid, _name text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_inst uuid;
  v_id   uuid;
  v_name text := btrim(coalesce(_name, ''));
BEGIN
  IF v_name = '' OR length(v_name) > 60 THEN
    RAISE EXCEPTION 'Give the optional group a name (max 60 characters).' USING ERRCODE = '22023';
  END IF;

  SELECT cg.institution_id INTO v_inst FROM public.class_groups cg WHERE cg.id = _class_group_id;
  IF v_inst IS NULL THEN
    RAISE EXCEPTION 'Class group not found.' USING ERRCODE = '22023';
  END IF;
  IF NOT public.can_manage_optional_groups(auth.uid(), v_inst) THEN
    RAISE EXCEPTION 'Not authorized to manage optional groups.' USING ERRCODE = '42501';
  END IF;

  SELECT og.id INTO v_id
  FROM public.optional_groups og
  WHERE og.class_group_id = _class_group_id AND og.name = v_name;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  INSERT INTO public.optional_groups (institution_id, class_group_id, name, position, created_by)
  VALUES (
    v_inst,
    _class_group_id,
    v_name,
    COALESCE((SELECT max(og2.position) + 1 FROM public.optional_groups og2 WHERE og2.class_group_id = _class_group_id), 1),
    auth.uid()
  )
  ON CONFLICT (class_group_id, name) DO UPDATE SET updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.upsert_optional_group(uuid, text) TO authenticated;

-- Add/remove a subject. Adding validates the subject is mapped to the
-- group's class_group, blocks membership in a second group of the same
-- class_group, and auto-marks the mapping optional (fanout trigger
-- mirrors to sections). Removing leaves is_optional as-is.
CREATE OR REPLACE FUNCTION public.set_optional_group_subject(_group_id uuid, _subject_id uuid, _member boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_cg    uuid;
  v_other text;
BEGIN
  IF NOT public.can_manage_optional_group(auth.uid(), _group_id) THEN
    RAISE EXCEPTION 'Not authorized to manage optional groups.' USING ERRCODE = '42501';
  END IF;

  SELECT og.class_group_id INTO v_cg FROM public.optional_groups og WHERE og.id = _group_id;

  IF NOT _member THEN
    DELETE FROM public.optional_group_subjects
    WHERE group_id = _group_id AND subject_id = _subject_id;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.subject_class_group_mappings scgm
    WHERE scgm.class_group_id = v_cg AND scgm.subject_id = _subject_id
  ) THEN
    RAISE EXCEPTION 'This subject is not assigned to that class.' USING ERRCODE = '22023';
  END IF;

  SELECT og.name INTO v_other
  FROM public.optional_group_subjects ogs
  JOIN public.optional_groups og ON og.id = ogs.group_id
  WHERE ogs.subject_id = _subject_id
    AND og.class_group_id = v_cg
    AND og.id <> _group_id
  LIMIT 1;
  IF v_other IS NOT NULL THEN
    RAISE EXCEPTION 'This subject is already in "%" for this class. Remove it there first.', v_other
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.optional_group_subjects (group_id, subject_id)
  VALUES (_group_id, _subject_id)
  ON CONFLICT (group_id, subject_id) DO NOTHING;

  -- Group membership implies the subject is optional for this class
  -- group. The P0 fanout trigger mirrors the flip to section rows.
  UPDATE public.subject_class_group_mappings
  SET is_optional = true
  WHERE class_group_id = v_cg AND subject_id = _subject_id AND is_optional = false;
END;
$$;
GRANT EXECUTE ON FUNCTION public.set_optional_group_subject(uuid, uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_optional_group(_group_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.can_manage_optional_group(auth.uid(), _group_id) THEN
    RAISE EXCEPTION 'Not authorized to manage optional groups.' USING ERRCODE = '42501';
  END IF;
  -- Memberships cascade; tt_slots.optional_group_id is ON DELETE SET
  -- NULL, so any timetable cell hosting this group degrades to Free.
  DELETE FROM public.optional_groups WHERE id = _group_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.delete_optional_group(uuid) TO authenticated;

-- -------------------------------------------------------------
-- 5. Student assignment RPCs (Subjects tab)
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_student_optional_group_assignment(_student uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.can_view_student_subjects(auth.uid(), _student) THEN
    RAISE EXCEPTION 'Not authorized to view this student''s subjects' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'can_manage', public.can_manage_student_subjects(auth.uid(), _student),
    'groups', COALESCE((
      SELECT jsonb_agg(g ORDER BY (g->>'position')::int, g->>'name')
      FROM (
        SELECT DISTINCT ON (og.id) jsonb_build_object(
          'group_id', og.id,
          'name',     og.name,
          'position', og.position,
          'subjects', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object('subject_id', us.id, 'name', us.name) ORDER BY us.name), '[]'::jsonb)
            FROM public.optional_group_subjects ogs
            JOIN public.universal_subjects us ON us.id = ogs.subject_id
            WHERE ogs.group_id = og.id
          ),
          'chosen_subject_id', (
            SELECT soe.subject_id
            FROM public.student_optional_enrollments soe
            JOIN public.optional_group_subjects ogs2
              ON ogs2.group_id = og.id AND ogs2.subject_id = soe.subject_id
            WHERE soe.student_id = _student AND soe.is_active = true
            ORDER BY soe.updated_at DESC
            LIMIT 1
          ),
          'chosen_classification', (
            SELECT COALESCE(soe.classification, 'optional')
            FROM public.student_optional_enrollments soe
            JOIN public.optional_group_subjects ogs3
              ON ogs3.group_id = og.id AND ogs3.subject_id = soe.subject_id
            WHERE soe.student_id = _student AND soe.is_active = true
            ORDER BY soe.updated_at DESC
            LIMIT 1
          )
        ) AS g
        FROM public.class_assignments ca
        JOIN public.classes c ON c.id = ca.class_id
        JOIN public.optional_groups og ON og.class_group_id = c.class_group_id
        WHERE ca.user_id = _student AND ca.role = 'student'
      ) grouped
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_student_optional_group_assignment(uuid) TO authenticated;

-- One transaction for the whole Save: per {group_id, subject_id|null},
-- deactivate the student's other enrollments inside that group and
-- upsert the chosen subject active.
CREATE OR REPLACE FUNCTION public.set_student_optional_group_choices(_student uuid, _choices jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_inst    uuid;
  v_choice  jsonb;
  v_group   uuid;
  v_subject uuid;
BEGIN
  IF NOT public.can_manage_student_subjects(auth.uid(), _student) THEN
    RAISE EXCEPTION 'Not authorized to change this student''s subjects' USING ERRCODE = '42501';
  END IF;
  IF _choices IS NULL OR jsonb_typeof(_choices) <> 'array' OR jsonb_array_length(_choices) > 20 THEN
    RAISE EXCEPTION 'Invalid choices payload.' USING ERRCODE = '22023';
  END IF;

  SELECT p.institution_id INTO v_inst FROM public.profiles p WHERE p.id = _student;
  IF v_inst IS NULL THEN
    RAISE EXCEPTION 'Student has no institution.' USING ERRCODE = '22023';
  END IF;

  FOR v_choice IN SELECT * FROM jsonb_array_elements(_choices) LOOP
    v_group   := (v_choice->>'group_id')::uuid;
    v_subject := NULLIF(v_choice->>'subject_id', '')::uuid;

    -- The group must belong to the student's institution.
    IF NOT EXISTS (
      SELECT 1 FROM public.optional_groups og
      WHERE og.id = v_group AND og.institution_id = v_inst
    ) THEN
      RAISE EXCEPTION 'Optional group not found for this student.' USING ERRCODE = '22023';
    END IF;

    -- The chosen subject must be in the group.
    IF v_subject IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.optional_group_subjects ogs
      WHERE ogs.group_id = v_group AND ogs.subject_id = v_subject
    ) THEN
      RAISE EXCEPTION 'That subject is not part of this optional group.' USING ERRCODE = '22023';
    END IF;

    -- Deactivate every other subject of this group for the student.
    UPDATE public.student_optional_enrollments soe
    SET is_active = false, assigned_by = auth.uid()
    WHERE soe.student_id = _student
      AND soe.is_active = true
      AND soe.subject_id IN (
        SELECT ogs.subject_id FROM public.optional_group_subjects ogs WHERE ogs.group_id = v_group
      )
      AND (v_subject IS NULL OR soe.subject_id <> v_subject);

    IF v_subject IS NOT NULL THEN
      INSERT INTO public.student_optional_enrollments (student_id, subject_id, institution_id, is_active, assigned_by)
      VALUES (_student, v_subject, v_inst, true, auth.uid())
      ON CONFLICT (student_id, subject_id)
      DO UPDATE SET is_active = true, assigned_by = EXCLUDED.assigned_by;
    END IF;
  END LOOP;
END;
$$;
GRANT EXECUTE ON FUNCTION public.set_student_optional_group_choices(uuid, jsonb) TO authenticated;

-- -------------------------------------------------------------
-- 6. Week-view resolution RPCs — auth.uid()-derived, never a
--    caller-supplied identity (fixes the S-1 anti-pattern).
-- -------------------------------------------------------------
-- Student: for each group slot of the class, the caller's chosen
-- subject (if any) + that subject's teacher for the class.
CREATE OR REPLACE FUNCTION public.my_optional_slot_choices(_class_id uuid, _academic_year text)
RETURNS TABLE(slot_id uuid, subject_id uuid, subject_name text, teacher_id uuid, teacher_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    s.id AS slot_id,
    us.id AS subject_id,
    us.name::text AS subject_name,
    t.user_id AS teacher_id,
    tp.full_name::text AS teacher_name
  FROM public.tt_slots s
  JOIN public.optional_group_subjects ogs ON ogs.group_id = s.optional_group_id
  JOIN public.student_optional_enrollments soe
    ON soe.subject_id = ogs.subject_id
   AND soe.student_id = (select auth.uid())
   AND soe.is_active = true
  JOIN public.universal_subjects us ON us.id = ogs.subject_id
  LEFT JOIN LATERAL (
    SELECT ca.user_id FROM public.class_assignments ca
    WHERE ca.class_id = s.class_id AND ca.subject_id = ogs.subject_id AND ca.role = 'teacher'
    ORDER BY ca.assigned_at
    LIMIT 1
  ) t ON true
  LEFT JOIN public.profiles tp ON tp.id = t.user_id
  WHERE s.class_id = _class_id
    AND s.academic_year = _academic_year
    AND s.optional_group_id IS NOT NULL;
$$;
GRANT EXECUTE ON FUNCTION public.my_optional_slot_choices(uuid, text) TO authenticated;

-- Teacher: group slots where the caller teaches one of the group's
-- subjects in that class (normal class_assignments teaching rights).
CREATE OR REPLACE FUNCTION public.my_teacher_optional_week(_academic_year text)
RETURNS TABLE(
  slot_id uuid, day text, period_slot_id uuid, period_label text,
  start_time time, end_time time, period_kind text,
  class_id uuid, class_name text, class_section text,
  subject_id uuid, subject_name text, group_name text, notes text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT DISTINCT ON (s.id)
    s.id AS slot_id,
    s.day::text AS day,
    s.period_slot_id,
    ps.label::text AS period_label,
    ps.start_time,
    ps.end_time,
    ps.kind::text AS period_kind,
    c.id AS class_id,
    c.name::text AS class_name,
    c.section::text AS class_section,
    us.id AS subject_id,
    us.name::text AS subject_name,
    og.name::text AS group_name,
    s.notes::text AS notes
  FROM public.tt_slots s
  JOIN public.optional_groups og ON og.id = s.optional_group_id
  JOIN public.optional_group_subjects ogs ON ogs.group_id = og.id
  JOIN public.class_assignments ca
    ON ca.class_id = s.class_id
   AND ca.subject_id = ogs.subject_id
   AND ca.user_id = (select auth.uid())
   AND ca.role = 'teacher'
  JOIN public.tt_period_slots ps ON ps.id = s.period_slot_id
  JOIN public.classes c ON c.id = s.class_id
  JOIN public.universal_subjects us ON us.id = ogs.subject_id
  WHERE s.academic_year = _academic_year
  ORDER BY s.id, us.name;
$$;
GRANT EXECUTE ON FUNCTION public.my_teacher_optional_week(text) TO authenticated;

-- -------------------------------------------------------------
-- 7. Security hardening of the legacy P6 band RPCs (audit S-1).
--    Behaviour unchanged for legitimate callers (the only frontend
--    consumer passes the caller's own id); any other identity now
--    requires manage/view rights instead of leaking data.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.student_band_resolution(_student uuid, _class_id uuid, _academic_year text)
RETURNS TABLE(band_slot_id uuid, batch_id uuid, subject_id uuid, subject_name text, teacher_id uuid, teacher_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF _student <> auth.uid() AND NOT public.can_view_student_subjects(auth.uid(), _student) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT
    ts.id AS band_slot_id,
    ob.id AS batch_id,
    ob.subject_id,
    us.name::text AS subject_name,
    ob.teacher_id,
    tp.full_name::text AS teacher_name
  FROM public.tt_slots ts
  JOIN public.optional_band_slots obsl ON obsl.band_slot_id = ts.id
  JOIN public.optional_batches ob ON ob.id = obsl.batch_id
  JOIN public.optional_batch_students obst ON obst.batch_id = ob.id AND obst.student_id = _student
  JOIN public.universal_subjects us ON us.id = ob.subject_id
  LEFT JOIN public.profiles tp ON tp.id = ob.teacher_id
  WHERE ts.class_id = _class_id
    AND ts.academic_year = _academic_year
    AND ts.is_optional_band = true;
END;
$$;

CREATE OR REPLACE FUNCTION public.band_slot_batches(_band_slot uuid)
RETURNS TABLE(batch_id uuid, label text, subject_name text, teacher_name text, roster_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    ob.id,
    ob.label::text,
    us.name::text,
    tp.full_name::text,
    (SELECT count(*) FROM public.optional_batch_students obs WHERE obs.batch_id = ob.id)
  FROM public.optional_band_slots obsl
  JOIN public.optional_batches ob ON ob.id = obsl.batch_id
  JOIN public.universal_subjects us ON us.id = ob.subject_id
  LEFT JOIN public.profiles tp ON tp.id = ob.teacher_id
  WHERE obsl.band_slot_id = _band_slot
    AND public.can_view_band_slot((select auth.uid()), _band_slot);
$$;
