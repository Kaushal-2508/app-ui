-- =====================================================================
-- HYBRID EXAM MODE — Proctoring snapshots (flow correction, Phase 2)
-- =====================================================================
-- Periodic webcam snapshots captured while the student writes on paper.
-- Lives on the hybrid_* plane. Images go to the existing private bucket
-- hybrid-answer-sheets under the snapshots/ prefix (authenticated student
-- write is already permitted by hybrid_sheets_authenticated_insert).
-- =====================================================================

CREATE TABLE public.hybrid_proctoring_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id UUID NOT NULL REFERENCES public.hybrid_exam_attempts(id) ON DELETE CASCADE,
  institution_id UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  flagged BOOLEAN NOT NULL DEFAULT false,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_hybrid_snapshots_attempt ON public.hybrid_proctoring_snapshots(attempt_id);
CREATE INDEX idx_hybrid_snapshots_institution ON public.hybrid_proctoring_snapshots(institution_id);

ALTER TABLE public.hybrid_proctoring_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins full access hybrid_snapshots"
  ON public.hybrid_proctoring_snapshots FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "Institution admins full access hybrid_snapshots"
  ON public.hybrid_proctoring_snapshots FOR ALL TO authenticated
  USING (public.is_institution_admin(auth.uid(), institution_id))
  WITH CHECK (public.is_institution_admin(auth.uid(), institution_id));

CREATE POLICY "Students insert own hybrid_snapshots"
  ON public.hybrid_proctoring_snapshots FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.hybrid_exam_attempts a
      WHERE a.id = hybrid_proctoring_snapshots.attempt_id
        AND a.student_id = auth.uid()
    )
  );

CREATE POLICY "Teachers select hybrid_snapshots for assigned classes"
  ON public.hybrid_proctoring_snapshots FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.hybrid_exam_attempts a
      WHERE a.id = hybrid_proctoring_snapshots.attempt_id
        AND public.is_teacher_for_class(auth.uid(), a.class_id)
    )
  );

CREATE POLICY "Coordinators select hybrid_snapshots own institution"
  ON public.hybrid_proctoring_snapshots FOR SELECT TO authenticated
  USING (
    institution_id = public.get_user_institution(auth.uid())
    AND public.has_role(auth.uid(), 'coordinator')
  );

COMMENT ON TABLE public.hybrid_proctoring_snapshots IS
  'Periodic webcam snapshots during the hybrid writing phase. Integrity evidence only; never crosses into the online proctoring plane.';