-- Dashboard rebuild Phase 1 — Task 3
-- dashboard_flags table (scaffold). Read here in Phase 2; written by the evaluator in Phase 3.

CREATE TABLE IF NOT EXISTS public.dashboard_flags (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id    uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  flag_code         text NOT NULL,
  category          text NOT NULL CHECK (category IN ('attendance','exams','adoption')),
  severity          text NOT NULL CHECK (severity IN ('critical','warning','info')),
  status            text NOT NULL DEFAULT 'red' CHECK (status IN ('red','amber','blue')),
  subject_type      text NOT NULL CHECK (subject_type IN ('class','student','exam','subject','teacher','school')),
  subject_key       text NOT NULL,
  title             text NOT NULL,
  description       text NOT NULL,
  metric_value      numeric,
  context           jsonb NOT NULL DEFAULT '{}'::jsonb,
  link_url          text,
  assignee_id       uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  task_id           uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  auto_created      boolean NOT NULL DEFAULT false,
  first_detected_at timestamptz NOT NULL DEFAULT now(),
  last_evaluated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dashboard_flags_inst_open_idx
  ON public.dashboard_flags (institution_id) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS dashboard_flags_subject_idx
  ON public.dashboard_flags (institution_id, subject_type, subject_key);
CREATE INDEX IF NOT EXISTS dashboard_flags_task_idx ON public.dashboard_flags (task_id);
CREATE UNIQUE INDEX IF NOT EXISTS dashboard_flags_identity_uidx
  ON public.dashboard_flags (institution_id, flag_code, subject_key) WHERE resolved_at IS NULL;

ALTER TABLE public.dashboard_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dashboard_flags_admin_select ON public.dashboard_flags;
CREATE POLICY dashboard_flags_admin_select ON public.dashboard_flags
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.role IN ('super_admin','super_school_admin','school_admin')
              AND (ur.role = 'super_admin' OR ur.institution_id = dashboard_flags.institution_id))
  );

DROP POLICY IF EXISTS dashboard_flags_admin_update ON public.dashboard_flags;
CREATE POLICY dashboard_flags_admin_update ON public.dashboard_flags
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.role IN ('super_admin','super_school_admin','school_admin')
              AND (ur.role = 'super_admin' OR ur.institution_id = dashboard_flags.institution_id))
  );

CREATE OR REPLACE FUNCTION public.dashboard_flags_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS dashboard_flags_touch ON public.dashboard_flags;
CREATE TRIGGER dashboard_flags_touch BEFORE UPDATE ON public.dashboard_flags
  FOR EACH ROW EXECUTE FUNCTION public.dashboard_flags_touch_updated_at();
