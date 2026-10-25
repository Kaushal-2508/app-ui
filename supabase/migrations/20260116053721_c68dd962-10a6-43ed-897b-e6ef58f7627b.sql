-- Fix remaining permissive policies that weren't properly dropped

-- 1. badge_progress: Drop old and keep only user-scoped
DROP POLICY IF EXISTS "Manage progress" ON public.badge_progress;

-- 2. concept_mastery: Drop old permissive policies
DROP POLICY IF EXISTS "Authenticated users can insert concept mastery" ON public.concept_mastery;
DROP POLICY IF EXISTS "Authenticated users can update concept mastery" ON public.concept_mastery;

-- 3. concept_mastery_history: Drop old permissive policy
DROP POLICY IF EXISTS "Authenticated users can insert mastery history" ON public.concept_mastery_history;

-- 4. exams: Drop old permissive policy
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON public.exams;

-- 5. grade_subject_assignments: Drop old permissive policy
DROP POLICY IF EXISTS "Allow authenticated write" ON public.grade_subject_assignments;

-- 6. notifications: Drop old permissive policy
DROP POLICY IF EXISTS "System can insert notifications" ON public.notifications;

-- 7. student_passport: Drop old permissive policy
DROP POLICY IF EXISTS "Manage passports" ON public.student_passport;

-- 8. user_activity_log: Drop old permissive policy
DROP POLICY IF EXISTS "Manage activity" ON public.user_activity_log;

-- 9. user_badges: Drop old permissive policy
DROP POLICY IF EXISTS "Insert badges" ON public.user_badges;