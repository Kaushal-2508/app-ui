-- =============================================
-- OCR PROCESSING PIPELINE SCHEMA
-- =============================================

-- Table: OCR Uploads (scanned answer sheet batches)
CREATE TABLE public.ocr_uploads (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  exam_id UUID NOT NULL REFERENCES public.exams(id) ON DELETE RESTRICT,
  class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE RESTRICT,
  uploaded_by UUID NOT NULL REFERENCES public.profiles(id),
  file_url TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size_bytes INTEGER,
  page_count INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'partial')),
  processing_started_at TIMESTAMP WITH TIME ZONE,
  processing_completed_at TIMESTAMP WITH TIME ZONE,
  error_message TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Table: OCR Extractions (per-answer extracted text)
CREATE TABLE public.ocr_extractions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  upload_id UUID NOT NULL REFERENCES public.ocr_uploads(id) ON DELETE CASCADE,
  attempt_id UUID NOT NULL REFERENCES public.student_exam_attempts(id) ON DELETE RESTRICT,
  question_id UUID NOT NULL REFERENCES public.exam_questions(id) ON DELETE RESTRICT,
  answer_id UUID REFERENCES public.student_answers(id) ON DELETE SET NULL,
  page_number INTEGER,
  bounding_box JSONB, -- {x, y, width, height} for answer region
  raw_extracted_text TEXT,
  cleaned_text TEXT,
  confidence_score NUMERIC(5,4) CHECK (confidence_score >= 0 AND confidence_score <= 1),
  extraction_metadata JSONB DEFAULT '{}'::jsonb, -- OCR engine details
  status TEXT NOT NULL DEFAULT 'extracted' CHECK (status IN ('extracted', 'reviewed', 'approved', 'rejected')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(attempt_id, question_id)
);

-- Table: OCR Review Logs (teacher review audit trail)
CREATE TABLE public.ocr_review_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  extraction_id UUID NOT NULL REFERENCES public.ocr_extractions(id) ON DELETE CASCADE,
  reviewed_by UUID NOT NULL REFERENCES public.profiles(id),
  previous_text TEXT,
  corrected_text TEXT,
  previous_status TEXT,
  new_status TEXT NOT NULL,
  review_notes TEXT,
  action TEXT NOT NULL CHECK (action IN ('approved', 'corrected', 'rejected', 'flagged')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX idx_ocr_uploads_exam_id ON public.ocr_uploads(exam_id);
CREATE INDEX idx_ocr_uploads_status ON public.ocr_uploads(status);
CREATE INDEX idx_ocr_uploads_uploaded_by ON public.ocr_uploads(uploaded_by);
CREATE INDEX idx_ocr_extractions_upload_id ON public.ocr_extractions(upload_id);
CREATE INDEX idx_ocr_extractions_attempt_id ON public.ocr_extractions(attempt_id);
CREATE INDEX idx_ocr_extractions_confidence ON public.ocr_extractions(confidence_score);
CREATE INDEX idx_ocr_extractions_status ON public.ocr_extractions(status);
CREATE INDEX idx_ocr_review_logs_extraction_id ON public.ocr_review_logs(extraction_id);

-- Triggers for updated_at
CREATE TRIGGER update_ocr_uploads_updated_at
  BEFORE UPDATE ON public.ocr_uploads
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_ocr_extractions_updated_at
  BEFORE UPDATE ON public.ocr_extractions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================
-- HELPER FUNCTIONS
-- =============================================

-- Get upload's exam institution
CREATE OR REPLACE FUNCTION public.get_upload_institution(_upload_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.institution_id 
  FROM public.ocr_uploads ou
  JOIN public.exams e ON e.id = ou.exam_id
  WHERE ou.id = _upload_id
$$;

-- Get upload's class
CREATE OR REPLACE FUNCTION public.get_upload_class(_upload_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT class_id FROM public.ocr_uploads WHERE id = _upload_id
$$;

-- Check if user can upload OCR for a class
CREATE OR REPLACE FUNCTION public.can_upload_ocr(_user_id UUID, _exam_id UUID, _class_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 
    FROM public.class_assignments ca
    JOIN public.exam_classes ec ON ec.class_id = ca.class_id
    WHERE ca.user_id = _user_id
      AND ca.class_id = _class_id
      AND ec.exam_id = _exam_id
      AND ca.role IN ('teacher', 'coordinator')
  )
$$;

-- Get extraction's upload ID
CREATE OR REPLACE FUNCTION public.get_extraction_upload_id(_extraction_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT upload_id FROM public.ocr_extractions WHERE id = _extraction_id
$$;

-- =============================================
-- RLS POLICIES - OCR Uploads
-- =============================================

ALTER TABLE public.ocr_uploads ENABLE ROW LEVEL SECURITY;

-- Super admins can view all uploads
CREATE POLICY "Super admins can view all OCR uploads"
  ON public.ocr_uploads FOR SELECT
  USING (has_role(auth.uid(), 'super_admin'::app_role));

-- School admins can manage uploads in their institution
CREATE POLICY "School admins can manage OCR uploads"
  ON public.ocr_uploads FOR ALL
  USING (has_role_at_institution(auth.uid(), 'school_admin'::app_role, get_exam_institution(exam_id)));

-- Teachers can upload for assigned classes
CREATE POLICY "Teachers can create OCR uploads"
  ON public.ocr_uploads FOR INSERT
  WITH CHECK (
    can_upload_ocr(auth.uid(), exam_id, class_id)
    AND uploaded_by = auth.uid()
  );

-- Teachers can view their uploads
CREATE POLICY "Teachers can view own OCR uploads"
  ON public.ocr_uploads FOR SELECT
  USING (
    uploaded_by = auth.uid()
    OR is_assigned_to_class(auth.uid(), class_id)
  );

-- Teachers can update their uploads (status tracking)
CREATE POLICY "Teachers can update own OCR uploads"
  ON public.ocr_uploads FOR UPDATE
  USING (uploaded_by = auth.uid());

-- =============================================
-- RLS POLICIES - OCR Extractions
-- =============================================

ALTER TABLE public.ocr_extractions ENABLE ROW LEVEL SECURITY;

-- Super admins can view all extractions
CREATE POLICY "Super admins can view all OCR extractions"
  ON public.ocr_extractions FOR SELECT
  USING (has_role(auth.uid(), 'super_admin'::app_role));

-- School admins can manage extractions
CREATE POLICY "School admins can manage OCR extractions"
  ON public.ocr_extractions FOR ALL
  USING (has_role_at_institution(auth.uid(), 'school_admin'::app_role, get_upload_institution(upload_id)));

-- Teachers can view extractions for their classes
CREATE POLICY "Teachers can view OCR extractions"
  ON public.ocr_extractions FOR SELECT
  USING (is_assigned_to_class(auth.uid(), get_upload_class(upload_id)));

-- Teachers can update extractions (review workflow)
CREATE POLICY "Teachers can update OCR extractions"
  ON public.ocr_extractions FOR UPDATE
  USING (
    is_assigned_to_class(auth.uid(), get_upload_class(upload_id))
    AND (has_role(auth.uid(), 'teacher'::app_role) OR has_role(auth.uid(), 'coordinator'::app_role))
  );

-- System/backend can insert extractions
CREATE POLICY "System can insert OCR extractions"
  ON public.ocr_extractions FOR INSERT
  WITH CHECK (
    has_role_at_institution(auth.uid(), 'school_admin'::app_role, get_upload_institution(upload_id))
    OR is_assigned_to_class(auth.uid(), get_upload_class(upload_id))
  );

-- =============================================
-- RLS POLICIES - OCR Review Logs
-- =============================================

ALTER TABLE public.ocr_review_logs ENABLE ROW LEVEL SECURITY;

-- Super admins can view all review logs
CREATE POLICY "Super admins can view all OCR review logs"
  ON public.ocr_review_logs FOR SELECT
  USING (has_role(auth.uid(), 'super_admin'::app_role));

-- School admins can view review logs in their institution
CREATE POLICY "School admins can view OCR review logs"
  ON public.ocr_review_logs FOR SELECT
  USING (has_role_at_institution(auth.uid(), 'school_admin'::app_role, get_upload_institution(get_extraction_upload_id(extraction_id))));

-- Teachers can create review logs
CREATE POLICY "Teachers can create OCR review logs"
  ON public.ocr_review_logs FOR INSERT
  WITH CHECK (
    reviewed_by = auth.uid()
    AND is_assigned_to_class(auth.uid(), get_upload_class(get_extraction_upload_id(extraction_id)))
  );

-- Teachers can view review logs for their extractions
CREATE POLICY "Teachers can view own class OCR review logs"
  ON public.ocr_review_logs FOR SELECT
  USING (is_assigned_to_class(auth.uid(), get_upload_class(get_extraction_upload_id(extraction_id))));

-- =============================================
-- TRIGGER: Log OCR reviews automatically
-- =============================================

CREATE OR REPLACE FUNCTION public.log_ocr_review()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status OR OLD.cleaned_text IS DISTINCT FROM NEW.cleaned_text THEN
    INSERT INTO public.ocr_review_logs (
      extraction_id,
      reviewed_by,
      previous_text,
      corrected_text,
      previous_status,
      new_status,
      action
    ) VALUES (
      NEW.id,
      auth.uid(),
      OLD.cleaned_text,
      NEW.cleaned_text,
      OLD.status,
      NEW.status,
      CASE 
        WHEN NEW.status = 'approved' AND OLD.cleaned_text = NEW.cleaned_text THEN 'approved'
        WHEN NEW.status = 'approved' AND OLD.cleaned_text != NEW.cleaned_text THEN 'corrected'
        WHEN NEW.status = 'rejected' THEN 'rejected'
        ELSE 'flagged'
      END
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_log_ocr_review
  AFTER UPDATE ON public.ocr_extractions
  FOR EACH ROW
  EXECUTE FUNCTION public.log_ocr_review();

-- =============================================
-- TRIGGER: Sync approved OCR to student_answers
-- =============================================

CREATE OR REPLACE FUNCTION public.sync_ocr_to_answer()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- When OCR extraction is approved, update the student answer
  IF NEW.status = 'approved' AND OLD.status != 'approved' THEN
    -- Update existing answer or create new one
    INSERT INTO public.student_answers (
      attempt_id,
      question_id,
      answer_source,
      answer_text,
      ocr_extracted_text,
      ocr_confidence,
      ocr_needs_review,
      answered_at
    ) VALUES (
      NEW.attempt_id,
      NEW.question_id,
      'offline_ocr',
      NEW.cleaned_text,
      NEW.raw_extracted_text,
      NEW.confidence_score,
      false, -- No longer needs review
      now()
    )
    ON CONFLICT (attempt_id, question_id)
    DO UPDATE SET
      answer_text = EXCLUDED.answer_text,
      ocr_extracted_text = EXCLUDED.ocr_extracted_text,
      ocr_confidence = EXCLUDED.ocr_confidence,
      ocr_needs_review = false,
      updated_at = now();
    
    -- Link extraction to answer
    UPDATE public.ocr_extractions
    SET answer_id = (
      SELECT id FROM public.student_answers
      WHERE attempt_id = NEW.attempt_id AND question_id = NEW.question_id
    )
    WHERE id = NEW.id;
  END IF;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_sync_ocr_to_answer
  AFTER UPDATE ON public.ocr_extractions
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_ocr_to_answer();

-- =============================================
-- Add confidence threshold to exams table
-- =============================================

ALTER TABLE public.exams
ADD COLUMN IF NOT EXISTS ocr_confidence_threshold NUMERIC(5,4) DEFAULT 0.70;

COMMENT ON COLUMN public.exams.ocr_confidence_threshold IS 'OCR confidence below this blocks auto-evaluation and requires manual review';