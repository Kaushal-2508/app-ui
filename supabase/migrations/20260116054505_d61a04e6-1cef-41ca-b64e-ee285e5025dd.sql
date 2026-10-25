-- Update foreign key constraints to allow proper cascade/nullify on deletion

-- Exams: SET NULL for user references
ALTER TABLE exams DROP CONSTRAINT IF EXISTS exams_created_by_fkey;
ALTER TABLE exams ADD CONSTRAINT exams_created_by_fkey 
  FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE exams DROP CONSTRAINT IF EXISTS exams_published_by_fkey;
ALTER TABLE exams ADD CONSTRAINT exams_published_by_fkey 
  FOREIGN KEY (published_by) REFERENCES profiles(id) ON DELETE SET NULL;

-- Evaluation blueprints: SET NULL for created_by
ALTER TABLE evaluation_blueprints DROP CONSTRAINT IF EXISTS evaluation_blueprints_created_by_fkey;
ALTER TABLE evaluation_blueprints ADD CONSTRAINT evaluation_blueprints_created_by_fkey 
  FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;

-- Exam publication logs: SET NULL for actor
ALTER TABLE exam_publication_logs DROP CONSTRAINT IF EXISTS exam_publication_logs_actor_id_fkey;
ALTER TABLE exam_publication_logs ADD CONSTRAINT exam_publication_logs_actor_id_fkey 
  FOREIGN KEY (actor_id) REFERENCES profiles(id) ON DELETE SET NULL;

-- Final results: SET NULL for finalized_by and published_by
ALTER TABLE final_results DROP CONSTRAINT IF EXISTS final_results_finalized_by_fkey;
ALTER TABLE final_results ADD CONSTRAINT final_results_finalized_by_fkey 
  FOREIGN KEY (finalized_by) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE final_results DROP CONSTRAINT IF EXISTS final_results_published_by_fkey;
ALTER TABLE final_results ADD CONSTRAINT final_results_published_by_fkey 
  FOREIGN KEY (published_by) REFERENCES profiles(id) ON DELETE SET NULL;

-- Class assignments: SET NULL for assigned_by
ALTER TABLE class_assignments DROP CONSTRAINT IF EXISTS class_assignments_assigned_by_fkey;
ALTER TABLE class_assignments ADD CONSTRAINT class_assignments_assigned_by_fkey 
  FOREIGN KEY (assigned_by) REFERENCES profiles(id) ON DELETE SET NULL;

-- Learning actions: SET NULL for approved_by
ALTER TABLE learning_actions DROP CONSTRAINT IF EXISTS learning_actions_approved_by_fkey;
ALTER TABLE learning_actions ADD CONSTRAINT learning_actions_approved_by_fkey 
  FOREIGN KEY (approved_by) REFERENCES profiles(id) ON DELETE SET NULL;

-- School aggregates: CASCADE with institution
ALTER TABLE school_aggregates DROP CONSTRAINT IF EXISTS school_aggregates_institution_id_fkey;
ALTER TABLE school_aggregates ADD CONSTRAINT school_aggregates_institution_id_fkey 
  FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE CASCADE;

-- AI usage logs: CASCADE with institution
ALTER TABLE ai_usage_logs DROP CONSTRAINT IF EXISTS ai_usage_logs_institution_id_fkey;
ALTER TABLE ai_usage_logs ADD CONSTRAINT ai_usage_logs_institution_id_fkey 
  FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE CASCADE;

-- AI daily usage: CASCADE with institution
ALTER TABLE ai_daily_usage DROP CONSTRAINT IF EXISTS ai_daily_usage_institution_id_fkey;
ALTER TABLE ai_daily_usage ADD CONSTRAINT ai_daily_usage_institution_id_fkey 
  FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE CASCADE;

-- AI monthly usage: CASCADE with institution
ALTER TABLE ai_monthly_usage DROP CONSTRAINT IF EXISTS ai_monthly_usage_institution_id_fkey;
ALTER TABLE ai_monthly_usage ADD CONSTRAINT ai_monthly_usage_institution_id_fkey 
  FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE CASCADE;

-- AI usage quotas: CASCADE with institution
ALTER TABLE ai_usage_quotas DROP CONSTRAINT IF EXISTS ai_usage_quotas_institution_id_fkey;
ALTER TABLE ai_usage_quotas ADD CONSTRAINT ai_usage_quotas_institution_id_fkey 
  FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE CASCADE;

-- Institution subscriptions: CASCADE with institution
ALTER TABLE institution_subscriptions DROP CONSTRAINT IF EXISTS institution_subscriptions_institution_id_fkey;
ALTER TABLE institution_subscriptions ADD CONSTRAINT institution_subscriptions_institution_id_fkey 
  FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE CASCADE;

-- System audit logs: SET NULL for actor_id (keep logs but nullify user reference)
ALTER TABLE system_audit_logs DROP CONSTRAINT IF EXISTS system_audit_logs_actor_id_fkey;
ALTER TABLE system_audit_logs ADD CONSTRAINT system_audit_logs_actor_id_fkey 
  FOREIGN KEY (actor_id) REFERENCES profiles(id) ON DELETE SET NULL;

-- Badge progress: CASCADE with user
ALTER TABLE badge_progress DROP CONSTRAINT IF EXISTS badge_progress_user_id_fkey;
ALTER TABLE badge_progress ADD CONSTRAINT badge_progress_user_id_fkey 
  FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- Concept mastery: CASCADE with student
ALTER TABLE concept_mastery DROP CONSTRAINT IF EXISTS concept_mastery_student_id_fkey;
ALTER TABLE concept_mastery ADD CONSTRAINT concept_mastery_student_id_fkey 
  FOREIGN KEY (student_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- User badges: CASCADE with user
ALTER TABLE user_badges DROP CONSTRAINT IF EXISTS user_badges_user_id_fkey;
ALTER TABLE user_badges ADD CONSTRAINT user_badges_user_id_fkey 
  FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- User activity log: CASCADE with user  
ALTER TABLE user_activity_log DROP CONSTRAINT IF EXISTS user_activity_log_user_id_fkey;
ALTER TABLE user_activity_log ADD CONSTRAINT user_activity_log_user_id_fkey 
  FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- Student passport: CASCADE with student
ALTER TABLE student_passport DROP CONSTRAINT IF EXISTS student_passport_student_id_fkey;
ALTER TABLE student_passport ADD CONSTRAINT student_passport_student_id_fkey 
  FOREIGN KEY (student_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- Notifications: CASCADE with user
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_user_id_fkey;
ALTER TABLE notifications ADD CONSTRAINT notifications_user_id_fkey 
  FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- Make created_by nullable on exams table for SET NULL to work
ALTER TABLE exams ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE evaluation_blueprints ALTER COLUMN created_by DROP NOT NULL;