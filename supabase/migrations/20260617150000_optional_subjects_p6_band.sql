-- =============================================================
-- OPTIONAL SUBJECTS — P6: timetable optional band
-- -------------------------------------------------------------
-- A "band" is a tt_slots cell during which the whole section does
-- optionals in parallel — each student in their own optional batch.
-- The cell is marked is_optional_band=true (slot_type stays 'free',
-- so the academic-type CHECK that requires subject_id for
-- theory/practical is never triggered). Batches are scheduled into
-- band cells via optional_band_slots. The student week substitutes
-- the band cell with the student's enrolled batch (read-side only —
-- tt_slots rows are unchanged, so the publish gate + RLS still apply).
-- =============================================================

ALTER TABLE public.tt_slots
  ADD COLUMN IF NOT EXISTS is_optional_band boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.tt_slots.is_optional_band IS
  'When true this cell is an optional band (slot_type=free, no single subject/teacher). Batches scheduled via optional_band_slots; each student sees their own enrolled optional.';

-- -------------------------------------------------------------
-- Batch ↔ band-cell scheduling (cross-section alignment is manual).
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.optional_band_slots (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  band_slot_id  uuid NOT NULL REFERENCES public.tt_slots(id) ON DELETE CASCADE,
  batch_id      uuid NOT NULL REFERENCES public.optional_batches(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_optional_band_slots UNIQUE (band_slot_id, batch_id)
);
CREATE INDEX IF NOT EXISTS idx_obands_slot  ON public.optional_band_slots(band_slot_id);
CREATE INDEX IF NOT EXISTS idx_obands_batch ON public.optional_band_slots(batch_id);

-- -------------------------------------------------------------
-- RLS helpers + policies
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_manage_band_slot(_actor uuid, _band_slot uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tt_slots ts
    WHERE ts.id = _band_slot
      AND public.tt_user_can_edit_class_slots(_actor, ts.class_id)
  );
$$;

CREATE OR REPLACE FUNCTION public.can_view_band_slot(_actor uuid, _band_slot uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.is_super_admin(_actor)
    OR EXISTS (
      SELECT 1 FROM public.tt_slots ts
      WHERE ts.id = _band_slot
        AND ts.institution_id = public.get_user_institution(_actor)
    );
$$;

GRANT EXECUTE ON FUNCTION public.can_manage_band_slot(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_band_slot(uuid, uuid) TO authenticated;

ALTER TABLE public.optional_band_slots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS obands_select ON public.optional_band_slots;
DROP POLICY IF EXISTS obands_manage ON public.optional_band_slots;

CREATE POLICY obands_select ON public.optional_band_slots
  FOR SELECT TO authenticated
  USING (public.can_view_band_slot(auth.uid(), band_slot_id));

CREATE POLICY obands_manage ON public.optional_band_slots
  FOR ALL TO authenticated
  USING (public.can_manage_band_slot(auth.uid(), band_slot_id))
  WITH CHECK (public.can_manage_band_slot(auth.uid(), band_slot_id));

-- -------------------------------------------------------------
-- Student band resolution — for each band cell of the class, the
-- batch this student is on that's scheduled into it (NULL if none).
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.student_band_resolution(_student uuid, _class_id uuid, _academic_year text)
RETURNS TABLE(band_slot_id uuid, batch_id uuid, subject_id uuid, subject_name text, teacher_id uuid, teacher_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
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
$$;
GRANT EXECUTE ON FUNCTION public.student_band_resolution(uuid, uuid, text) TO authenticated;

-- Batches scheduled into a given band cell (for the workspace UI).
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
  WHERE obsl.band_slot_id = _band_slot;
$$;
GRANT EXECUTE ON FUNCTION public.band_slot_batches(uuid) TO authenticated;
