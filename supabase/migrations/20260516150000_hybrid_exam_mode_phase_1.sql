-- =====================================================================
-- HYBRID EXAM MODE — Phase 1 (Schema + RLS + Storage)
-- =====================================================================
-- Net-new tables only. student_exam_attempts, student_answers,
-- final_results, exam_attempt_logs are deliberately untouched —
-- hybrid mode runs on a fully parallel data plane bound only to
-- the foundation tables (exams, classes, profiles, institutions,
-- exam_questions).
--
-- The 'hybrid' value on exam_mode enum was added in 20260104115119
-- but never wired to the UI. Phase 1 exposes it.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Per-exam hybrid configuration
-- ---------------------------------------------------------------------
CREATE TABLE public.hybrid_exam_settings (
  exam_id UUID PRIMARY KEY REFERENCES public.exams(id) ON DELETE CASCADE,
  institution_id UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  grace_window_minutes INT NOT NULL DEFAULT 30
    CHECK (grace_window_minutes BETWEEN 5 AND 120),
  max_pages INT NOT NULL DEFAULT 10
    CHECK (max_pages BETWEEN 1 AND 50),
  require_face_check BOOLEAN NOT NULL DEFAULT false,
  sheet_numbering_instruction TEXT NOT NULL DEFAULT
    'Write the question number above each answer. Write the sheet number in the top-right corner of every page.',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_hybrid_exam_settings_institution
  ON public.hybrid_exam_settings(institution_id);


-- ---------------------------------------------------------------------
-- 2. Hybrid attempt (parallel to student_exam_attempts)
-- ---------------------------------------------------------------------
CREATE TABLE public.hybrid_exam_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id UUID NOT NULL REFERENCES public.exams(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  institution_id UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN (
    'in_progress',
    'awaiting_upload',
    'upload_in_progress',
    'pending_evaluation',
    'evaluated',
    'cancelled_no_upload'
  )),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at TIMESTAMPTZ,
  upload_completed_at TIMESTAMPTZ,
  evaluated_at TIMESTAMPTZ,
  evaluated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  total_marks_awarded NUMERIC(6, 2),
  total_max_marks NUMERIC(6, 2),
  teacher_general_comment TEXT,
  device_info JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (exam_id, student_id)
);

CREATE INDEX idx_hybrid_attempts_exam ON public.hybrid_exam_attempts(exam_id);
CREATE INDEX idx_hybrid_attempts_student ON public.hybrid_exam_attempts(student_id);
CREATE INDEX idx_hybrid_attempts_class ON public.hybrid_exam_attempts(class_id);
CREATE INDEX idx_hybrid_attempts_institution ON public.hybrid_exam_attempts(institution_id);
CREATE INDEX idx_hybrid_attempts_status ON public.hybrid_exam_attempts(status);


-- ---------------------------------------------------------------------
-- 3. Pages uploaded from the phone
-- ---------------------------------------------------------------------
CREATE TABLE public.hybrid_answer_sheet_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id UUID NOT NULL REFERENCES public.hybrid_exam_attempts(id) ON DELETE CASCADE,
  institution_id UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  page_number INT NOT NULL CHECK (page_number > 0),
  storage_path TEXT NOT NULL,
  file_size_bytes INT,
  device_fingerprint TEXT,
  rotation_degrees INT NOT NULL DEFAULT 0
    CHECK (rotation_degrees IN (0, 90, 180, 270)),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (attempt_id, page_number)
);

CREATE INDEX idx_hybrid_pages_attempt ON public.hybrid_answer_sheet_pages(attempt_id);
CREATE INDEX idx_hybrid_pages_institution ON public.hybrid_answer_sheet_pages(institution_id);


-- ---------------------------------------------------------------------
-- 4. Single-use laptop ↔ phone pairing tokens
-- ---------------------------------------------------------------------
CREATE TABLE public.hybrid_pairing_tokens (
  token TEXT PRIMARY KEY,
  short_code TEXT NOT NULL,
  attempt_id UUID NOT NULL REFERENCES public.hybrid_exam_attempts(id) ON DELETE CASCADE,
  institution_id UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  device_fingerprint TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ
);

CREATE INDEX idx_hybrid_tokens_attempt ON public.hybrid_pairing_tokens(attempt_id);
CREATE INDEX idx_hybrid_tokens_short_code
  ON public.hybrid_pairing_tokens(short_code) WHERE used_at IS NULL;
CREATE INDEX idx_hybrid_tokens_expires
  ON public.hybrid_pairing_tokens(expires_at) WHERE used_at IS NULL;


-- ---------------------------------------------------------------------
-- 5. Per-question teacher marks + comments
--    (separate from student_answers — hybrid has no student-typed answer)
-- ---------------------------------------------------------------------
CREATE TABLE public.hybrid_question_marks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id UUID NOT NULL REFERENCES public.hybrid_exam_attempts(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES public.exam_questions(id) ON DELETE CASCADE,
  institution_id UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  marks_awarded NUMERIC(6, 2),
  max_marks NUMERIC(6, 2) NOT NULL,
  teacher_comment TEXT,
  is_flagged BOOLEAN NOT NULL DEFAULT false,
  marked_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  marked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (attempt_id, question_id)
);

CREATE INDEX idx_hybrid_marks_attempt ON public.hybrid_question_marks(attempt_id);
CREATE INDEX idx_hybrid_marks_institution ON public.hybrid_question_marks(institution_id);


-- ---------------------------------------------------------------------
-- 6. Annotations on uploaded sheets
--    (separate from student_answers.annotations — hybrid stores
--     annotations against attempt + page, not against an answer row)
-- ---------------------------------------------------------------------
CREATE TABLE public.hybrid_sheet_annotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id UUID NOT NULL REFERENCES public.hybrid_exam_attempts(id) ON DELETE CASCADE,
  question_id UUID REFERENCES public.exam_questions(id) ON DELETE SET NULL,
  page_id UUID REFERENCES public.hybrid_answer_sheet_pages(id) ON DELETE CASCADE,
  institution_id UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  page_number INT NOT NULL,
  annotation_type TEXT NOT NULL CHECK (annotation_type IN (
    'highlight', 'tick', 'cross', 'comment', 'freehand'
  )),
  coordinates JSONB NOT NULL,
  color TEXT NOT NULL DEFAULT '#FA9314',
  text_content TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_hybrid_annotations_attempt ON public.hybrid_sheet_annotations(attempt_id);
CREATE INDEX idx_hybrid_annotations_question ON public.hybrid_sheet_annotations(question_id);
CREATE INDEX idx_hybrid_annotations_page ON public.hybrid_sheet_annotations(page_id);


-- ---------------------------------------------------------------------
-- 7. Audit log (separate from exam_attempt_logs)
-- ---------------------------------------------------------------------
CREATE TABLE public.hybrid_exam_attempt_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id UUID NOT NULL REFERENCES public.hybrid_exam_attempts(id) ON DELETE CASCADE,
  institution_id UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  event_payload JSONB,
  actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_hybrid_attempt_logs_attempt ON public.hybrid_exam_attempt_logs(attempt_id);
CREATE INDEX idx_hybrid_attempt_logs_institution ON public.hybrid_exam_attempt_logs(institution_id);
CREATE INDEX idx_hybrid_attempt_logs_created ON public.hybrid_exam_attempt_logs(created_at DESC);


-- =====================================================================
-- updated_at triggers
-- =====================================================================
CREATE TRIGGER update_hybrid_exam_settings_updated_at
  BEFORE UPDATE ON public.hybrid_exam_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_hybrid_exam_attempts_updated_at
  BEFORE UPDATE ON public.hybrid_exam_attempts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_hybrid_question_marks_updated_at
  BEFORE UPDATE ON public.hybrid_question_marks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- =====================================================================
-- Enable RLS
-- =====================================================================
ALTER TABLE public.hybrid_exam_settings        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hybrid_exam_attempts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hybrid_answer_sheet_pages   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hybrid_pairing_tokens       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hybrid_question_marks       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hybrid_sheet_annotations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hybrid_exam_attempt_logs    ENABLE ROW LEVEL SECURITY;


-- =====================================================================
-- RLS — hybrid_exam_settings
-- Read: any member of the institution (students need to know the
--   grace window + page cap before submit).
-- Write: institution admins + the exam creator's classroom teachers.
-- =====================================================================
CREATE POLICY "Super admins full access hybrid_exam_settings"
  ON public.hybrid_exam_settings FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "Institution admins full access hybrid_exam_settings"
  ON public.hybrid_exam_settings FOR ALL TO authenticated
  USING (public.is_institution_admin(auth.uid(), institution_id))
  WITH CHECK (public.is_institution_admin(auth.uid(), institution_id));

CREATE POLICY "Members read hybrid_exam_settings"
  ON public.hybrid_exam_settings FOR SELECT TO authenticated
  USING (institution_id = public.get_user_institution(auth.uid()));

CREATE POLICY "Teachers/coordinators write hybrid_exam_settings"
  ON public.hybrid_exam_settings FOR INSERT TO authenticated
  WITH CHECK (
    institution_id = public.get_user_institution(auth.uid())
    AND (
      public.has_role(auth.uid(), 'teacher')
      OR public.has_role(auth.uid(), 'coordinator')
    )
  );

CREATE POLICY "Teachers/coordinators update hybrid_exam_settings"
  ON public.hybrid_exam_settings FOR UPDATE TO authenticated
  USING (
    institution_id = public.get_user_institution(auth.uid())
    AND (
      public.has_role(auth.uid(), 'teacher')
      OR public.has_role(auth.uid(), 'coordinator')
    )
  )
  WITH CHECK (
    institution_id = public.get_user_institution(auth.uid())
    AND (
      public.has_role(auth.uid(), 'teacher')
      OR public.has_role(auth.uid(), 'coordinator')
    )
  );


-- =====================================================================
-- RLS — hybrid_exam_attempts
-- Student: SELECT/INSERT/UPDATE own attempts.
-- Teacher: SELECT/UPDATE attempts in classes they are assigned to.
-- Admins / coordinators: full read; admins full write.
-- =====================================================================
CREATE POLICY "Super admins full access hybrid_exam_attempts"
  ON public.hybrid_exam_attempts FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "Institution admins full access hybrid_exam_attempts"
  ON public.hybrid_exam_attempts FOR ALL TO authenticated
  USING (public.is_institution_admin(auth.uid(), institution_id))
  WITH CHECK (public.is_institution_admin(auth.uid(), institution_id));

CREATE POLICY "Students select own hybrid_exam_attempts"
  ON public.hybrid_exam_attempts FOR SELECT TO authenticated
  USING (student_id = auth.uid());

CREATE POLICY "Students insert own hybrid_exam_attempts"
  ON public.hybrid_exam_attempts FOR INSERT TO authenticated
  WITH CHECK (student_id = auth.uid());

CREATE POLICY "Students update own hybrid_exam_attempts"
  ON public.hybrid_exam_attempts FOR UPDATE TO authenticated
  USING (student_id = auth.uid())
  WITH CHECK (student_id = auth.uid());

CREATE POLICY "Teachers select hybrid_exam_attempts for assigned classes"
  ON public.hybrid_exam_attempts FOR SELECT TO authenticated
  USING (public.is_teacher_for_class(auth.uid(), class_id));

CREATE POLICY "Teachers update hybrid_exam_attempts for assigned classes"
  ON public.hybrid_exam_attempts FOR UPDATE TO authenticated
  USING (public.is_teacher_for_class(auth.uid(), class_id))
  WITH CHECK (public.is_teacher_for_class(auth.uid(), class_id));

CREATE POLICY "Coordinators select hybrid_exam_attempts own institution"
  ON public.hybrid_exam_attempts FOR SELECT TO authenticated
  USING (
    institution_id = public.get_user_institution(auth.uid())
    AND public.has_role(auth.uid(), 'coordinator')
  );


-- =====================================================================
-- RLS — hybrid_answer_sheet_pages
-- Student owns pages of their own attempt.
-- =====================================================================
CREATE POLICY "Super admins full access hybrid_pages"
  ON public.hybrid_answer_sheet_pages FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "Institution admins full access hybrid_pages"
  ON public.hybrid_answer_sheet_pages FOR ALL TO authenticated
  USING (public.is_institution_admin(auth.uid(), institution_id))
  WITH CHECK (public.is_institution_admin(auth.uid(), institution_id));

CREATE POLICY "Students select own hybrid_pages"
  ON public.hybrid_answer_sheet_pages FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.hybrid_exam_attempts a
      WHERE a.id = hybrid_answer_sheet_pages.attempt_id
        AND a.student_id = auth.uid()
    )
  );

CREATE POLICY "Students insert own hybrid_pages"
  ON public.hybrid_answer_sheet_pages FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.hybrid_exam_attempts a
      WHERE a.id = hybrid_answer_sheet_pages.attempt_id
        AND a.student_id = auth.uid()
    )
  );

CREATE POLICY "Students update own hybrid_pages"
  ON public.hybrid_answer_sheet_pages FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.hybrid_exam_attempts a
      WHERE a.id = hybrid_answer_sheet_pages.attempt_id
        AND a.student_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.hybrid_exam_attempts a
      WHERE a.id = hybrid_answer_sheet_pages.attempt_id
        AND a.student_id = auth.uid()
    )
  );

CREATE POLICY "Teachers select hybrid_pages for assigned classes"
  ON public.hybrid_answer_sheet_pages FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.hybrid_exam_attempts a
      WHERE a.id = hybrid_answer_sheet_pages.attempt_id
        AND public.is_teacher_for_class(auth.uid(), a.class_id)
    )
  );

CREATE POLICY "Teachers update hybrid_pages for assigned classes"
  ON public.hybrid_answer_sheet_pages FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.hybrid_exam_attempts a
      WHERE a.id = hybrid_answer_sheet_pages.attempt_id
        AND public.is_teacher_for_class(auth.uid(), a.class_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.hybrid_exam_attempts a
      WHERE a.id = hybrid_answer_sheet_pages.attempt_id
        AND public.is_teacher_for_class(auth.uid(), a.class_id)
    )
  );

CREATE POLICY "Coordinators select hybrid_pages own institution"
  ON public.hybrid_answer_sheet_pages FOR SELECT TO authenticated
  USING (
    institution_id = public.get_user_institution(auth.uid())
    AND public.has_role(auth.uid(), 'coordinator')
  );


-- =====================================================================
-- RLS — hybrid_pairing_tokens
-- Students own their own tokens. Edge functions act under
-- SECURITY DEFINER (service role) for validation flows from the phone
-- which is not authenticated as the student.
-- =====================================================================
CREATE POLICY "Super admins full access hybrid_pairing_tokens"
  ON public.hybrid_pairing_tokens FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "Students select own hybrid_pairing_tokens"
  ON public.hybrid_pairing_tokens FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.hybrid_exam_attempts a
      WHERE a.id = hybrid_pairing_tokens.attempt_id
        AND a.student_id = auth.uid()
    )
  );

CREATE POLICY "Students insert own hybrid_pairing_tokens"
  ON public.hybrid_pairing_tokens FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.hybrid_exam_attempts a
      WHERE a.id = hybrid_pairing_tokens.attempt_id
        AND a.student_id = auth.uid()
    )
  );


-- =====================================================================
-- RLS — hybrid_question_marks
-- Read: student (own marks), teacher (assigned classes), admins.
-- Write: teachers (assigned classes), admins.
-- =====================================================================
CREATE POLICY "Super admins full access hybrid_question_marks"
  ON public.hybrid_question_marks FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "Institution admins full access hybrid_question_marks"
  ON public.hybrid_question_marks FOR ALL TO authenticated
  USING (public.is_institution_admin(auth.uid(), institution_id))
  WITH CHECK (public.is_institution_admin(auth.uid(), institution_id));

CREATE POLICY "Students select own hybrid_question_marks"
  ON public.hybrid_question_marks FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.hybrid_exam_attempts a
      WHERE a.id = hybrid_question_marks.attempt_id
        AND a.student_id = auth.uid()
        AND a.status = 'evaluated'
    )
  );

CREATE POLICY "Teachers select hybrid_question_marks for assigned classes"
  ON public.hybrid_question_marks FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.hybrid_exam_attempts a
      WHERE a.id = hybrid_question_marks.attempt_id
        AND public.is_teacher_for_class(auth.uid(), a.class_id)
    )
  );

CREATE POLICY "Teachers insert hybrid_question_marks for assigned classes"
  ON public.hybrid_question_marks FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.hybrid_exam_attempts a
      WHERE a.id = hybrid_question_marks.attempt_id
        AND public.is_teacher_for_class(auth.uid(), a.class_id)
    )
  );

CREATE POLICY "Teachers update hybrid_question_marks for assigned classes"
  ON public.hybrid_question_marks FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.hybrid_exam_attempts a
      WHERE a.id = hybrid_question_marks.attempt_id
        AND public.is_teacher_for_class(auth.uid(), a.class_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.hybrid_exam_attempts a
      WHERE a.id = hybrid_question_marks.attempt_id
        AND public.is_teacher_for_class(auth.uid(), a.class_id)
    )
  );

CREATE POLICY "Coordinators select hybrid_question_marks own institution"
  ON public.hybrid_question_marks FOR SELECT TO authenticated
  USING (
    institution_id = public.get_user_institution(auth.uid())
    AND public.has_role(auth.uid(), 'coordinator')
  );


-- =====================================================================
-- RLS — hybrid_sheet_annotations
-- Same shape as hybrid_question_marks: students see only after publish,
-- teachers can CRUD for assigned classes.
-- =====================================================================
CREATE POLICY "Super admins full access hybrid_sheet_annotations"
  ON public.hybrid_sheet_annotations FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "Institution admins full access hybrid_sheet_annotations"
  ON public.hybrid_sheet_annotations FOR ALL TO authenticated
  USING (public.is_institution_admin(auth.uid(), institution_id))
  WITH CHECK (public.is_institution_admin(auth.uid(), institution_id));

CREATE POLICY "Students select own hybrid_sheet_annotations after evaluated"
  ON public.hybrid_sheet_annotations FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.hybrid_exam_attempts a
      WHERE a.id = hybrid_sheet_annotations.attempt_id
        AND a.student_id = auth.uid()
        AND a.status = 'evaluated'
    )
  );

CREATE POLICY "Teachers select hybrid_sheet_annotations for assigned classes"
  ON public.hybrid_sheet_annotations FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.hybrid_exam_attempts a
      WHERE a.id = hybrid_sheet_annotations.attempt_id
        AND public.is_teacher_for_class(auth.uid(), a.class_id)
    )
  );

CREATE POLICY "Teachers insert hybrid_sheet_annotations for assigned classes"
  ON public.hybrid_sheet_annotations FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.hybrid_exam_attempts a
      WHERE a.id = hybrid_sheet_annotations.attempt_id
        AND public.is_teacher_for_class(auth.uid(), a.class_id)
    )
  );

CREATE POLICY "Teachers update hybrid_sheet_annotations for assigned classes"
  ON public.hybrid_sheet_annotations FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.hybrid_exam_attempts a
      WHERE a.id = hybrid_sheet_annotations.attempt_id
        AND public.is_teacher_for_class(auth.uid(), a.class_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.hybrid_exam_attempts a
      WHERE a.id = hybrid_sheet_annotations.attempt_id
        AND public.is_teacher_for_class(auth.uid(), a.class_id)
    )
  );

CREATE POLICY "Teachers delete hybrid_sheet_annotations for assigned classes"
  ON public.hybrid_sheet_annotations FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.hybrid_exam_attempts a
      WHERE a.id = hybrid_sheet_annotations.attempt_id
        AND public.is_teacher_for_class(auth.uid(), a.class_id)
    )
  );

CREATE POLICY "Coordinators select hybrid_sheet_annotations own institution"
  ON public.hybrid_sheet_annotations FOR SELECT TO authenticated
  USING (
    institution_id = public.get_user_institution(auth.uid())
    AND public.has_role(auth.uid(), 'coordinator')
  );


-- =====================================================================
-- RLS — hybrid_exam_attempt_logs
-- Insert by anyone who can write to the attempt (student / teacher /
-- admin). Read by teachers/coordinators/admins; not students.
-- =====================================================================
CREATE POLICY "Super admins full access hybrid_exam_attempt_logs"
  ON public.hybrid_exam_attempt_logs FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "Institution admins full access hybrid_exam_attempt_logs"
  ON public.hybrid_exam_attempt_logs FOR ALL TO authenticated
  USING (public.is_institution_admin(auth.uid(), institution_id))
  WITH CHECK (public.is_institution_admin(auth.uid(), institution_id));

CREATE POLICY "Students insert own hybrid_exam_attempt_logs"
  ON public.hybrid_exam_attempt_logs FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.hybrid_exam_attempts a
      WHERE a.id = hybrid_exam_attempt_logs.attempt_id
        AND a.student_id = auth.uid()
    )
  );

CREATE POLICY "Teachers select hybrid_exam_attempt_logs for assigned classes"
  ON public.hybrid_exam_attempt_logs FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.hybrid_exam_attempts a
      WHERE a.id = hybrid_exam_attempt_logs.attempt_id
        AND public.is_teacher_for_class(auth.uid(), a.class_id)
    )
  );

CREATE POLICY "Teachers insert hybrid_exam_attempt_logs for assigned classes"
  ON public.hybrid_exam_attempt_logs FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.hybrid_exam_attempts a
      WHERE a.id = hybrid_exam_attempt_logs.attempt_id
        AND public.is_teacher_for_class(auth.uid(), a.class_id)
    )
  );

CREATE POLICY "Coordinators select hybrid_exam_attempt_logs own institution"
  ON public.hybrid_exam_attempt_logs FOR SELECT TO authenticated
  USING (
    institution_id = public.get_user_institution(auth.uid())
    AND public.has_role(auth.uid(), 'coordinator')
  );


-- =====================================================================
-- Storage bucket — hybrid-answer-sheets (private)
-- Paths: hybrid-sheets/{institution_id}/{exam_id}/{attempt_id}/page_{n}.jpg
-- Authenticated read/write; phase 3 edge functions will use service
-- role for unauthenticated phone uploads.
-- =====================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('hybrid-answer-sheets', 'hybrid-answer-sheets', false, 524288)  -- 512 KB hard cap per file
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit;

DROP POLICY IF EXISTS "hybrid_sheets_authenticated_read" ON storage.objects;
CREATE POLICY "hybrid_sheets_authenticated_read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'hybrid-answer-sheets');

DROP POLICY IF EXISTS "hybrid_sheets_authenticated_insert" ON storage.objects;
CREATE POLICY "hybrid_sheets_authenticated_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'hybrid-answer-sheets');

DROP POLICY IF EXISTS "hybrid_sheets_owner_update" ON storage.objects;
CREATE POLICY "hybrid_sheets_owner_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'hybrid-answer-sheets' AND auth.uid() = owner)
  WITH CHECK (bucket_id = 'hybrid-answer-sheets' AND auth.uid() = owner);

DROP POLICY IF EXISTS "hybrid_sheets_owner_delete" ON storage.objects;
CREATE POLICY "hybrid_sheets_owner_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'hybrid-answer-sheets' AND auth.uid() = owner);


-- =====================================================================
-- Helpful comments
-- =====================================================================
COMMENT ON TABLE public.hybrid_exam_settings IS
  'Hybrid exam configuration (Phase 1). Per-exam grace window, page cap, sheet instruction, optional face check.';

COMMENT ON TABLE public.hybrid_exam_attempts IS
  'Hybrid exam attempts. Parallel to student_exam_attempts — never reuse that table for hybrid flows.';

COMMENT ON COLUMN public.hybrid_exam_attempts.status IS
  'in_progress → awaiting_upload → upload_in_progress → pending_evaluation → evaluated (terminal). cancelled_no_upload when grace window expires with no pages.';

COMMENT ON TABLE public.hybrid_answer_sheet_pages IS
  'Photographed pages uploaded from the student phone via single-use pairing token.';

COMMENT ON TABLE public.hybrid_pairing_tokens IS
  'Single-use laptop → phone pairing tokens. TTL 15 min, opaque random; no JWT/HMAC.';

COMMENT ON TABLE public.hybrid_question_marks IS
  'Per-question marks awarded by teacher during hybrid evaluation. One row per (attempt, question).';

COMMENT ON TABLE public.hybrid_sheet_annotations IS
  'Annotations drawn on uploaded pages during hybrid evaluation. Coordinates normalized 0–1.';

COMMENT ON TABLE public.hybrid_exam_attempt_logs IS
  'Audit log for hybrid exam attempts. Mirrors exam_attempt_logs but for the hybrid data plane.';
