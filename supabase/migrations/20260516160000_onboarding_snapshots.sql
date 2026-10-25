-- =============================================================
-- onboarding_snapshots — per-institution daily snapshot of teacher
-- + coordinator onboarding-journey progress. Powers the in-app
-- Onboarding Progress Dashboard delta + trend views.
--
-- Writes happen ONLY via ensure_onboarding_snapshot() below
-- (SECURITY DEFINER, first-of-day wins). Reads are scoped to
-- school admins / coordinators at that institution + super_admin.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.onboarding_snapshots (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id           UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  snapshot_date            DATE NOT NULL,
  total_users              INT  NOT NULL,
  fully_complete_count     INT  NOT NULL,
  avg_completion_percent   NUMERIC(5,2) NOT NULL,
  milestone_counts         JSONB NOT NULL,
  per_user_data            JSONB NOT NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by               UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  UNIQUE (institution_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS onboarding_snapshots_institution_date_idx
  ON public.onboarding_snapshots (institution_id, snapshot_date DESC);

ALTER TABLE public.onboarding_snapshots ENABLE ROW LEVEL SECURITY;

-- Read-only access for school admins, coordinators at the same institution,
-- and super_admins. Writes always go through ensure_onboarding_snapshot().
DROP POLICY IF EXISTS "Onboarding snapshots readable by institution staff"
  ON public.onboarding_snapshots;

CREATE POLICY "Onboarding snapshots readable by institution staff"
ON public.onboarding_snapshots
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'super_admin'::public.app_role)
  OR institution_id IN (
    SELECT p.institution_id
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND (
        public.has_role(p.id, 'school_admin'::public.app_role)
        OR public.has_role(p.id, 'super_school_admin'::public.app_role)
        OR public.has_role(p.id, 'coordinator'::public.app_role)
      )
  )
);

-- =============================================================
-- ensure_onboarding_snapshot — idempotent "today's snapshot exists"
-- guarantee. Computes counts from get_institution_onboarding_progress
-- and INSERTs only if today's row is missing (first-of-day wins).
-- Returns today's snapshot row (newly inserted OR pre-existing).
-- =============================================================

CREATE OR REPLACE FUNCTION public.ensure_onboarding_snapshot(_institution_id UUID)
RETURNS public.onboarding_snapshots
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller          UUID := auth.uid();
  v_today           DATE := current_date;
  v_existing        public.onboarding_snapshots;
  v_rows            JSONB;
  v_total           INT;
  v_complete        INT;
  v_avg             NUMERIC(5,2);
  v_milestone_cnt   JSONB;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Authorisation: super_admin OR school_admin/super_school_admin at this institution.
  IF NOT public.has_role(v_caller, 'super_admin'::public.app_role)
     AND NOT EXISTS (
       SELECT 1 FROM public.profiles p
       WHERE p.id = v_caller
         AND p.institution_id = _institution_id
         AND (
           public.has_role(p.id, 'school_admin'::public.app_role)
           OR public.has_role(p.id, 'super_school_admin'::public.app_role)
         )
     )
  THEN
    RAISE EXCEPTION 'Not authorised for institution %', _institution_id
      USING ERRCODE = '42501';
  END IF;

  -- Fast path: today's snapshot already exists.
  SELECT * INTO v_existing
  FROM public.onboarding_snapshots
  WHERE institution_id = _institution_id
    AND snapshot_date = v_today
  LIMIT 1;

  IF FOUND THEN
    RETURN v_existing;
  END IF;

  -- Compute fresh aggregates from the existing per-user RPC.
  WITH rows AS (
    SELECT *
    FROM public.get_institution_onboarding_progress(_institution_id)
  )
  SELECT
    COALESCE(jsonb_agg(to_jsonb(rows)), '[]'::jsonb),
    COUNT(*)::int,
    COUNT(*) FILTER (WHERE is_journey_completed)::int,
    COALESCE(ROUND(AVG(completion_percent)::numeric, 2), 0)::numeric(5,2),
    jsonb_build_object(
      'first_task_assigned',            COUNT(*) FILTER (WHERE first_task_assigned)::int,
      'first_task_completed',           COUNT(*) FILTER (WHERE first_task_completed)::int,
      'first_study_material_uploaded',  COUNT(*) FILTER (WHERE first_study_material_uploaded)::int,
      'first_exam_published',           COUNT(*) FILTER (WHERE first_exam_published)::int,
      'first_result_validated',         COUNT(*) FILTER (WHERE first_result_validated)::int
    )
  INTO v_rows, v_total, v_complete, v_avg, v_milestone_cnt
  FROM rows;

  -- First-of-day insert; if a concurrent caller already inserted, return that row.
  INSERT INTO public.onboarding_snapshots (
    institution_id, snapshot_date, total_users, fully_complete_count,
    avg_completion_percent, milestone_counts, per_user_data, created_by
  )
  VALUES (
    _institution_id, v_today, v_total, v_complete,
    v_avg, v_milestone_cnt, v_rows, v_caller
  )
  ON CONFLICT (institution_id, snapshot_date) DO NOTHING
  RETURNING * INTO v_existing;

  IF v_existing.id IS NULL THEN
    SELECT * INTO v_existing
    FROM public.onboarding_snapshots
    WHERE institution_id = _institution_id AND snapshot_date = v_today;
  END IF;

  RETURN v_existing;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_onboarding_snapshot(UUID) TO authenticated;
