-- Disable RLS and drop all policies on all public tables

-- parent_student_links
ALTER TABLE public.parent_student_links DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Parents can view their own links" ON public.parent_student_links;
DROP POLICY IF EXISTS "Parents can create their own links" ON public.parent_student_links;
DROP POLICY IF EXISTS "School admins can manage parent links" ON public.parent_student_links;

-- notification_queue
ALTER TABLE public.notification_queue DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Super admins can view all notifications" ON public.notification_queue;
DROP POLICY IF EXISTS "Authenticated users can insert notifications" ON public.notification_queue;

-- Drop all policies on other tables (from schema)
-- profiles
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;

-- user_roles
DROP POLICY IF EXISTS "Users can view own roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can manage roles" ON public.user_roles;

-- institutions
DROP POLICY IF EXISTS "Institutions are viewable by members" ON public.institutions;
DROP POLICY IF EXISTS "Super admins can manage institutions" ON public.institutions;

-- classes
DROP POLICY IF EXISTS "Classes are viewable by institution members" ON public.classes;
DROP POLICY IF EXISTS "School admins can manage classes" ON public.classes;

-- class_assignments
DROP POLICY IF EXISTS "Assignments viewable by institution members" ON public.class_assignments;
DROP POLICY IF EXISTS "School admins can manage assignments" ON public.class_assignments;

-- subjects
DROP POLICY IF EXISTS "Subjects are viewable by all" ON public.subjects;
DROP POLICY IF EXISTS "Super admins can manage subjects" ON public.subjects;

-- exams
DROP POLICY IF EXISTS "Exams viewable by assigned users" ON public.exams;
DROP POLICY IF EXISTS "Teachers can create exams" ON public.exams;
DROP POLICY IF EXISTS "Exam creators can update" ON public.exams;

-- exam_sections
DROP POLICY IF EXISTS "Sections viewable with exam access" ON public.exam_sections;
DROP POLICY IF EXISTS "Exam creators can manage sections" ON public.exam_sections;

-- exam_questions
DROP POLICY IF EXISTS "Questions viewable with exam access" ON public.exam_questions;
DROP POLICY IF EXISTS "Exam creators can manage questions" ON public.exam_questions;

-- exam_classes
DROP POLICY IF EXISTS "Exam classes viewable by members" ON public.exam_classes;
DROP POLICY IF EXISTS "Exam creators can manage exam classes" ON public.exam_classes;

-- exam_subjects
DROP POLICY IF EXISTS "Exam subjects viewable by members" ON public.exam_subjects;
DROP POLICY IF EXISTS "Exam creators can manage exam subjects" ON public.exam_subjects;

-- student_exam_attempts
DROP POLICY IF EXISTS "Students can view own attempts" ON public.student_exam_attempts;
DROP POLICY IF EXISTS "Teachers can view class attempts" ON public.student_exam_attempts;
DROP POLICY IF EXISTS "Students can create own attempts" ON public.student_exam_attempts;

-- student_answers
DROP POLICY IF EXISTS "Students can view own answers" ON public.student_answers;
DROP POLICY IF EXISTS "Teachers can view class answers" ON public.student_answers;
DROP POLICY IF EXISTS "Students can manage own answers" ON public.student_answers;

-- teacher_overrides
DROP POLICY IF EXISTS "Teachers can manage overrides" ON public.teacher_overrides;
DROP POLICY IF EXISTS "Students can view own overrides" ON public.teacher_overrides;

-- ai_evaluations
DROP POLICY IF EXISTS "Evaluations viewable by authorized users" ON public.ai_evaluations;
DROP POLICY IF EXISTS "System can create evaluations" ON public.ai_evaluations;

-- evaluation_blueprints
DROP POLICY IF EXISTS "Blueprints viewable with exam access" ON public.evaluation_blueprints;
DROP POLICY IF EXISTS "Exam creators can manage blueprints" ON public.evaluation_blueprints;

-- final_results
DROP POLICY IF EXISTS "Results viewable by authorized users" ON public.final_results;
DROP POLICY IF EXISTS "Teachers can manage results" ON public.final_results;

-- ocr_uploads
DROP POLICY IF EXISTS "Teachers can manage OCR uploads" ON public.ocr_uploads;
DROP POLICY IF EXISTS "Students can view own uploads" ON public.ocr_uploads;

-- ocr_extractions
DROP POLICY IF EXISTS "Teachers can manage extractions" ON public.ocr_extractions;

-- proctoring_sessions
DROP POLICY IF EXISTS "Proctoring sessions viewable by authorized" ON public.proctoring_sessions;

-- proctoring_events
DROP POLICY IF EXISTS "Proctoring events viewable by authorized" ON public.proctoring_events;

-- task_assignments
DROP POLICY IF EXISTS "Task assignments viewable by participants" ON public.task_assignments;
DROP POLICY IF EXISTS "Authorized users can create tasks" ON public.task_assignments;

-- task_evidence
DROP POLICY IF EXISTS "Evidence viewable by task participants" ON public.task_evidence;
DROP POLICY IF EXISTS "Assignees can manage evidence" ON public.task_evidence;

-- user_preferences
DROP POLICY IF EXISTS "Users can manage own preferences" ON public.user_preferences;

-- study_materials
DROP POLICY IF EXISTS "Materials viewable by institution" ON public.study_materials;
DROP POLICY IF EXISTS "Teachers can manage materials" ON public.study_materials;

-- question_bank
DROP POLICY IF EXISTS "Question bank viewable by institution" ON public.question_bank;
DROP POLICY IF EXISTS "Teachers can manage question bank" ON public.question_bank;

-- Disable RLS on all public tables
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
        EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', r.tablename);
    END LOOP;
END $$;