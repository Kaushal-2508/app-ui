-- Fix RLS policies for proper visibility and permissions

-- ========================================
-- 1. Fix user_roles SELECT policy - ensure users can view their own roles
-- ========================================
DROP POLICY IF EXISTS "Users can view roles in same institution" ON public.user_roles;
DROP POLICY IF EXISTS "Users can view their own roles" ON public.user_roles;

-- Users can ALWAYS view their own roles
CREATE POLICY "Users can view their own roles"
ON public.user_roles FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- Users can view roles in same institution (for coordinators/admins to see teachers)
CREATE POLICY "Users can view institution roles"
ON public.user_roles FOR SELECT
TO authenticated
USING (
  institution_id = public.get_user_institution(auth.uid())
  OR public.has_super_admin_access(auth.uid())
);

-- ========================================
-- 2. Fix profiles SELECT policy - ensure users can always see their own profile
-- ========================================
DROP POLICY IF EXISTS "Users can view profiles in same institution" ON public.profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;

-- Users can ALWAYS view their own profile
CREATE POLICY "Users can view own profile"
ON public.profiles FOR SELECT
TO authenticated
USING (id = auth.uid());

-- Users can view profiles in same institution
CREATE POLICY "Users can view profiles in same institution"
ON public.profiles FOR SELECT
TO authenticated
USING (
  institution_id = public.get_user_institution(auth.uid())
  OR public.has_super_admin_access(auth.uid())
);

-- Users can update their own profile
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
ON public.profiles FOR UPDATE
TO authenticated
USING (id = auth.uid())
WITH CHECK (id = auth.uid());

-- ========================================
-- 3. Fix subjects policies - Only school_admin can create subjects
-- Teachers/coordinators should NOT create subjects (only topics)
-- ========================================
DROP POLICY IF EXISTS "Teachers can create subjects" ON public.subjects;
DROP POLICY IF EXISTS "Teachers can update subjects" ON public.subjects;

-- Only school_admin and super_admin can create subjects
CREATE POLICY "School admins can create subjects"
ON public.subjects FOR INSERT
TO authenticated
WITH CHECK (
  institution_id = public.get_user_institution(auth.uid())
  AND (
    public.has_role(auth.uid(), 'school_admin')
    OR public.has_super_admin_access(auth.uid())
  )
);

-- Only school_admin and super_admin can update subjects
CREATE POLICY "School admins can update subjects"
ON public.subjects FOR UPDATE
TO authenticated
USING (
  institution_id = public.get_user_institution(auth.uid())
  AND (
    public.has_role(auth.uid(), 'school_admin')
    OR public.has_super_admin_access(auth.uid())
  )
);

-- ========================================
-- 4. Ensure syllabus_topics policies are correct for teachers/coordinators
-- ========================================
-- Already correct: Teachers, coordinators, school_admin can create/update topics

-- ========================================
-- 5. Fix school_custom_topics - remove duplicate policies, keep clean ones
-- ========================================
DROP POLICY IF EXISTS "Teachers and above can create custom topics" ON public.school_custom_topics;
DROP POLICY IF EXISTS "Teachers and above can update their institution's custom topics" ON public.school_custom_topics;
DROP POLICY IF EXISTS "Teachers and coordinators can create topics" ON public.school_custom_topics;

-- Keep clean policies for custom topics (teachers, coordinators, school_admin can manage)
-- Already have: "Teachers can create custom topics" and "Teachers can update custom topics"