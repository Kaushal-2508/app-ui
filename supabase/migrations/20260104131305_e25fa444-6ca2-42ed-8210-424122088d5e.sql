-- =====================================================
-- STUDENT TELEMETRY SYSTEM
-- =====================================================

-- Question-level telemetry (time spent, interactions per question)
CREATE TABLE public.attempt_question_telemetry (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  attempt_id UUID NOT NULL REFERENCES public.student_exam_attempts(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES public.exam_questions(id) ON DELETE CASCADE,
  
  -- Timing metrics
  first_viewed_at TIMESTAMP WITH TIME ZONE,
  last_viewed_at TIMESTAMP WITH TIME ZONE,
  total_time_seconds INTEGER DEFAULT 0,
  view_count INTEGER DEFAULT 1,
  
  -- Interaction metrics
  answer_change_count INTEGER DEFAULT 0,
  is_skipped BOOLEAN DEFAULT true,
  is_answered BOOLEAN DEFAULT false,
  is_flagged_for_review BOOLEAN DEFAULT false,
  
  -- Response analysis
  time_to_first_answer_seconds INTEGER,
  final_answer_at TIMESTAMP WITH TIME ZONE,
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  UNIQUE(attempt_id, question_id)
);

-- Section-level telemetry (aggregate per section)
CREATE TABLE public.attempt_section_telemetry (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  attempt_id UUID NOT NULL REFERENCES public.student_exam_attempts(id) ON DELETE CASCADE,
  section_id UUID NOT NULL REFERENCES public.exam_sections(id) ON DELETE CASCADE,
  
  -- Timing
  first_entered_at TIMESTAMP WITH TIME ZONE,
  last_exited_at TIMESTAMP WITH TIME ZONE,
  total_time_seconds INTEGER DEFAULT 0,
  
  -- Question stats
  questions_attempted INTEGER DEFAULT 0,
  questions_skipped INTEGER DEFAULT 0,
  questions_flagged INTEGER DEFAULT 0,
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  UNIQUE(attempt_id, section_id)
);

-- Topic/tag performance tracking (derived after evaluation)
CREATE TABLE public.student_topic_performance (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  exam_id UUID NOT NULL REFERENCES public.exams(id) ON DELETE CASCADE,
  topic_tag TEXT NOT NULL,
  
  -- Performance metrics
  questions_attempted INTEGER DEFAULT 0,
  questions_correct INTEGER DEFAULT 0,
  total_marks_possible NUMERIC DEFAULT 0,
  total_marks_obtained NUMERIC DEFAULT 0,
  accuracy_percentage NUMERIC,
  
  -- Time analysis
  avg_time_per_question_seconds INTEGER,
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  UNIQUE(student_id, exam_id, topic_tag)
);

-- =====================================================
-- AI PROCTORING SYSTEM (Online exams only)
-- =====================================================

-- Proctoring session - one per attempt for online exams
CREATE TABLE public.proctoring_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  attempt_id UUID NOT NULL REFERENCES public.student_exam_attempts(id) ON DELETE CASCADE UNIQUE,
  
  -- Session state
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  ended_at TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN DEFAULT true,
  
  -- Device/environment info
  browser_info JSONB DEFAULT '{}',
  camera_enabled BOOLEAN DEFAULT false,
  microphone_enabled BOOLEAN DEFAULT false,
  screen_share_enabled BOOLEAN DEFAULT false,
  
  -- Aggregate suspicion metrics
  total_events INTEGER DEFAULT 0,
  high_severity_events INTEGER DEFAULT 0,
  medium_severity_events INTEGER DEFAULT 0,
  low_severity_events INTEGER DEFAULT 0,
  
  -- Review status
  requires_review BOOLEAN DEFAULT false,
  review_status TEXT DEFAULT 'pending' CHECK (review_status IN ('pending', 'reviewed', 'cleared', 'flagged')),
  reviewed_by UUID REFERENCES public.profiles(id),
  reviewed_at TIMESTAMP WITH TIME ZONE,
  review_notes TEXT,
  
  -- Recording references (encrypted storage paths)
  video_recording_url TEXT,
  audio_recording_url TEXT,
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Proctoring events - individual suspicious signals
CREATE TABLE public.proctoring_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES public.proctoring_sessions(id) ON DELETE CASCADE,
  
  -- Event classification
  event_type TEXT NOT NULL CHECK (event_type IN (
    'face_not_detected',
    'multiple_faces',
    'head_movement_left',
    'head_movement_right',
    'head_movement_up',
    'head_movement_down',
    'tab_switch',
    'window_blur',
    'camera_blocked',
    'camera_disconnected',
    'audio_anomaly',
    'screen_share_stopped',
    'copy_paste_attempt',
    'right_click_attempt',
    'keyboard_shortcut_blocked',
    'browser_devtools_opened',
    'fullscreen_exited',
    'other'
  )),
  
  -- Severity: low = minor, medium = concerning, high = serious
  severity TEXT NOT NULL DEFAULT 'low' CHECK (severity IN ('low', 'medium', 'high')),
  
  -- Event details
  occurred_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  duration_seconds INTEGER, -- For sustained events
  question_id UUID REFERENCES public.exam_questions(id), -- Which question they were on
  
  -- Evidence
  screenshot_url TEXT, -- Encrypted reference
  event_metadata JSONB DEFAULT '{}',
  
  -- Auto-generated description
  description TEXT,
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Proctoring review decisions
CREATE TABLE public.proctoring_review_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES public.proctoring_sessions(id) ON DELETE CASCADE,
  
  reviewed_by UUID NOT NULL REFERENCES public.profiles(id),
  reviewed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  previous_status TEXT,
  new_status TEXT NOT NULL,
  
  decision TEXT CHECK (decision IN ('no_action', 'warning_issued', 'marks_deducted', 'attempt_invalidated')),
  decision_reason TEXT,
  
  -- If marks affected
  marks_deducted NUMERIC,
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- =====================================================
-- ENABLE RLS
-- =====================================================

ALTER TABLE public.attempt_question_telemetry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attempt_section_telemetry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_topic_performance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proctoring_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proctoring_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proctoring_review_logs ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- RLS POLICIES - TELEMETRY
-- =====================================================

-- Question telemetry - system can insert/update during exam
CREATE POLICY "System can manage question telemetry"
ON public.attempt_question_telemetry FOR ALL
USING (get_attempt_student_id(attempt_id) = auth.uid() AND NOT is_attempt_finalized(attempt_id));

CREATE POLICY "Teachers can view question telemetry"
ON public.attempt_question_telemetry FOR SELECT
USING (can_evaluate_attempt(auth.uid(), attempt_id));

CREATE POLICY "School admins can view question telemetry"
ON public.attempt_question_telemetry FOR SELECT
USING (has_role_at_institution(auth.uid(), 'school_admin', get_exam_institution(get_attempt_exam_id(attempt_id))));

-- Section telemetry
CREATE POLICY "System can manage section telemetry"
ON public.attempt_section_telemetry FOR ALL
USING (get_attempt_student_id(attempt_id) = auth.uid() AND NOT is_attempt_finalized(attempt_id));

CREATE POLICY "Teachers can view section telemetry"
ON public.attempt_section_telemetry FOR SELECT
USING (can_evaluate_attempt(auth.uid(), attempt_id));

CREATE POLICY "School admins can view section telemetry"
ON public.attempt_section_telemetry FOR SELECT
USING (has_role_at_institution(auth.uid(), 'school_admin', get_exam_institution(get_attempt_exam_id(attempt_id))));

-- Topic performance - students can't see raw data, only derived insights
CREATE POLICY "Teachers can view topic performance"
ON public.student_topic_performance FOR SELECT
USING (can_evaluate_attempt(auth.uid(), (
  SELECT sea.id FROM student_exam_attempts sea 
  WHERE sea.student_id = student_topic_performance.student_id 
  AND sea.exam_id = student_topic_performance.exam_id LIMIT 1
)));

CREATE POLICY "School admins can manage topic performance"
ON public.student_topic_performance FOR ALL
USING (has_role_at_institution(auth.uid(), 'school_admin', get_exam_institution(exam_id)));

-- =====================================================
-- RLS POLICIES - PROCTORING
-- =====================================================

-- Proctoring sessions
CREATE POLICY "Students can insert own proctoring session"
ON public.proctoring_sessions FOR INSERT
WITH CHECK (get_attempt_student_id(attempt_id) = auth.uid());

CREATE POLICY "Students can update own active session"
ON public.proctoring_sessions FOR UPDATE
USING (get_attempt_student_id(attempt_id) = auth.uid() AND is_active = true);

CREATE POLICY "Teachers can view proctoring sessions"
ON public.proctoring_sessions FOR SELECT
USING (can_evaluate_attempt(auth.uid(), attempt_id));

CREATE POLICY "Teachers can review proctoring sessions"
ON public.proctoring_sessions FOR UPDATE
USING (can_evaluate_attempt(auth.uid(), attempt_id));

CREATE POLICY "School admins can manage proctoring sessions"
ON public.proctoring_sessions FOR ALL
USING (has_role_at_institution(auth.uid(), 'school_admin', get_exam_institution(get_attempt_exam_id(attempt_id))));

CREATE POLICY "Super admins can view all proctoring sessions"
ON public.proctoring_sessions FOR SELECT
USING (has_role(auth.uid(), 'super_admin'));

-- Proctoring events
CREATE POLICY "Students can insert own proctoring events"
ON public.proctoring_events FOR INSERT
WITH CHECK (EXISTS (
  SELECT 1 FROM proctoring_sessions ps
  WHERE ps.id = session_id 
  AND get_attempt_student_id(ps.attempt_id) = auth.uid()
  AND ps.is_active = true
));

CREATE POLICY "Teachers can view proctoring events"
ON public.proctoring_events FOR SELECT
USING (EXISTS (
  SELECT 1 FROM proctoring_sessions ps
  WHERE ps.id = session_id 
  AND can_evaluate_attempt(auth.uid(), ps.attempt_id)
));

CREATE POLICY "School admins can view proctoring events"
ON public.proctoring_events FOR SELECT
USING (EXISTS (
  SELECT 1 FROM proctoring_sessions ps
  WHERE ps.id = session_id 
  AND has_role_at_institution(auth.uid(), 'school_admin', get_exam_institution(get_attempt_exam_id(ps.attempt_id)))
));

-- Proctoring review logs - immutable audit trail
CREATE POLICY "Reviewers can insert review logs"
ON public.proctoring_review_logs FOR INSERT
WITH CHECK (reviewed_by = auth.uid() AND EXISTS (
  SELECT 1 FROM proctoring_sessions ps
  WHERE ps.id = session_id 
  AND can_evaluate_attempt(auth.uid(), ps.attempt_id)
));

CREATE POLICY "Users can view review logs"
ON public.proctoring_review_logs FOR SELECT
USING (EXISTS (
  SELECT 1 FROM proctoring_sessions ps
  WHERE ps.id = session_id 
  AND (can_evaluate_attempt(auth.uid(), ps.attempt_id) 
    OR has_role_at_institution(auth.uid(), 'school_admin', get_exam_institution(get_attempt_exam_id(ps.attempt_id))))
));

-- =====================================================
-- TRIGGERS
-- =====================================================

-- Update proctoring session aggregates when events are added
CREATE OR REPLACE FUNCTION public.update_proctoring_session_metrics()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  UPDATE proctoring_sessions
  SET 
    total_events = total_events + 1,
    high_severity_events = high_severity_events + CASE WHEN NEW.severity = 'high' THEN 1 ELSE 0 END,
    medium_severity_events = medium_severity_events + CASE WHEN NEW.severity = 'medium' THEN 1 ELSE 0 END,
    low_severity_events = low_severity_events + CASE WHEN NEW.severity = 'low' THEN 1 ELSE 0 END,
    requires_review = CASE 
      WHEN NEW.severity = 'high' THEN true 
      WHEN (total_events + 1) >= 10 THEN true
      ELSE requires_review 
    END,
    updated_at = now()
  WHERE id = NEW.session_id;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_update_proctoring_metrics
AFTER INSERT ON public.proctoring_events
FOR EACH ROW
EXECUTE FUNCTION public.update_proctoring_session_metrics();

-- Auto-update telemetry timestamps
CREATE TRIGGER update_question_telemetry_updated_at
BEFORE UPDATE ON public.attempt_question_telemetry
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_section_telemetry_updated_at
BEFORE UPDATE ON public.attempt_section_telemetry
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_proctoring_session_updated_at
BEFORE UPDATE ON public.proctoring_sessions
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Log proctoring review decisions
CREATE OR REPLACE FUNCTION public.log_proctoring_review()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  IF OLD.review_status IS DISTINCT FROM NEW.review_status THEN
    INSERT INTO proctoring_review_logs (
      session_id,
      reviewed_by,
      previous_status,
      new_status
    ) VALUES (
      NEW.id,
      auth.uid(),
      OLD.review_status,
      NEW.review_status
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_log_proctoring_review
AFTER UPDATE ON public.proctoring_sessions
FOR EACH ROW
WHEN (OLD.review_status IS DISTINCT FROM NEW.review_status)
EXECUTE FUNCTION public.log_proctoring_review();

-- =====================================================
-- INDEXES
-- =====================================================

CREATE INDEX idx_question_telemetry_attempt ON public.attempt_question_telemetry(attempt_id);
CREATE INDEX idx_section_telemetry_attempt ON public.attempt_section_telemetry(attempt_id);
CREATE INDEX idx_topic_performance_student ON public.student_topic_performance(student_id);
CREATE INDEX idx_proctoring_sessions_attempt ON public.proctoring_sessions(attempt_id);
CREATE INDEX idx_proctoring_sessions_review ON public.proctoring_sessions(requires_review, review_status);
CREATE INDEX idx_proctoring_events_session ON public.proctoring_events(session_id);
CREATE INDEX idx_proctoring_events_severity ON public.proctoring_events(severity);