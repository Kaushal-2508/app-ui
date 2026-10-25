-- Re-enable Row Level Security on all public tables
-- This will activate all 113 existing RLS policies

-- Core tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.institutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.institution_subscriptions ENABLE ROW LEVEL SECURITY;

-- Class and assignment tables
ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_groups ENABLE ROW LEVEL SECURITY;

-- Exam tables
ALTER TABLE public.exams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evaluation_blueprints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_publication_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_attempt_logs ENABLE ROW LEVEL SECURITY;

-- Student attempt and answer tables
ALTER TABLE public.student_exam_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.final_results ENABLE ROW LEVEL SECURITY;

-- Evaluation tables
ALTER TABLE public.ai_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teacher_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recheck_requests ENABLE ROW LEVEL SECURITY;

-- OCR and offline exam tables
ALTER TABLE public.ocr_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ocr_extractions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ocr_review_logs ENABLE ROW LEVEL SECURITY;

-- Proctoring tables
ALTER TABLE public.proctoring_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proctoring_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proctoring_review_logs ENABLE ROW LEVEL SECURITY;

-- Analytics and telemetry tables
ALTER TABLE public.attempt_question_telemetry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attempt_section_telemetry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_performance_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_topic_performance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.concept_mastery ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.concept_mastery_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_aggregates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teacher_aggregates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_aggregates ENABLE ROW LEVEL SECURITY;

-- AI and quota tables
ALTER TABLE public.global_ai_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_config_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_usage_quotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_usage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_daily_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_monthly_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teacher_ai_quotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_question_limits ENABLE ROW LEVEL SECURITY;

-- Task management tables
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_audit_logs ENABLE ROW LEVEL SECURITY;

-- Learning and syllabus tables
ALTER TABLE public.learning_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.universal_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.syllabus_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_custom_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grade_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.question_bank ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_materials ENABLE ROW LEVEL SECURITY;

-- User and preference tables
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parent_student_links ENABLE ROW LEVEL SECURITY;

-- Organization tables
ALTER TABLE public.wings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wing_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_levels ENABLE ROW LEVEL SECURITY;

-- Payment and billing tables
ALTER TABLE public.payment_records ENABLE ROW LEVEL SECURITY;

-- Audit and logging tables
ALTER TABLE public.system_audit_logs ENABLE ROW LEVEL SECURITY;

-- Public/lead tables
ALTER TABLE public.contact_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.demo_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_queue ENABLE ROW LEVEL SECURITY;