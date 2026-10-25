-- =============================================================
-- institution_hidden_topics — per-institution opt-out for globally
-- seeded NCERT chapters that a school doesn't want cluttering its
-- syllabus view.
--
-- Why a hide-list (not a real delete): globally-seeded rows in
-- syllabus_topics live in `institution_id IS NULL` and are shared
-- across every school on the platform. Letting one school delete
-- them outright would nuke them for everyone (and the DELETE
-- policy correctly forbids this). The hide-list lets a school
-- declutter its own view without affecting any other tenant.
--
-- Reverse op (unhide) is a simple row delete, scoped to the same
-- institution via the policy below.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.institution_hidden_topics (
  institution_id UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  topic_id       UUID NOT NULL REFERENCES public.syllabus_topics(id) ON DELETE CASCADE,
  hidden_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  hidden_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  PRIMARY KEY (institution_id, topic_id)
);

CREATE INDEX IF NOT EXISTS institution_hidden_topics_inst_idx
  ON public.institution_hidden_topics (institution_id);

ALTER TABLE public.institution_hidden_topics ENABLE ROW LEVEL SECURITY;

-- ---------------- SELECT --------------------------------------
-- Any member of the institution can see which chapters their school
-- has hidden (the syllabus tree consumes this list to filter rows).

DROP POLICY IF EXISTS "Members read institution_hidden_topics"
  ON public.institution_hidden_topics;

CREATE POLICY "Members read institution_hidden_topics"
ON public.institution_hidden_topics
FOR SELECT
TO authenticated
USING (institution_id = public.get_user_institution(auth.uid()));

-- ---------------- INSERT / DELETE -----------------------------
-- Hiding and unhiding are administrative actions: school_admin,
-- super_school_admin, or coordinator of the SAME institution.

DROP POLICY IF EXISTS "Staff hide institution topics"
  ON public.institution_hidden_topics;

CREATE POLICY "Staff hide institution topics"
ON public.institution_hidden_topics
FOR INSERT
TO authenticated
WITH CHECK (
  institution_id = public.get_user_institution(auth.uid())
  AND EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role = ANY (ARRAY[
        'school_admin'::public.app_role,
        'super_school_admin'::public.app_role,
        'coordinator'::public.app_role
      ])
  )
);

DROP POLICY IF EXISTS "Staff unhide institution topics"
  ON public.institution_hidden_topics;

CREATE POLICY "Staff unhide institution topics"
ON public.institution_hidden_topics
FOR DELETE
TO authenticated
USING (
  institution_id = public.get_user_institution(auth.uid())
  AND EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role = ANY (ARRAY[
        'school_admin'::public.app_role,
        'super_school_admin'::public.app_role,
        'coordinator'::public.app_role
      ])
  )
);
