-- ============================================
-- COMPREHENSIVE RLS FIX FOR EXAMS, SUBJECTS, TOPICS, STUDY MATERIALS
-- ============================================

-- Drop existing restrictive policies on exams
DROP POLICY IF EXISTS "Anyone can insert exams" ON public.exams;
DROP POLICY IF EXISTS "Users can create exams" ON public.exams;
DROP POLICY IF EXISTS "Teachers can create exams" ON public.exams;

-- ============================================
-- EXAMS TABLE POLICIES
-- ============================================

-- Policy: Teachers, Coordinators, School Admins can create exams in their institution
CREATE POLICY "Teachers can create exams in their institution"
ON public.exams
FOR INSERT
TO authenticated
WITH CHECK (
  institution_id = public.get_user_institution(auth.uid())
  AND (
    public.has_role(auth.uid(), 'teacher')
    OR public.has_role(auth.uid(), 'coordinator')
    OR public.has_role(auth.uid(), 'school_admin')
    OR public.has_super_admin_access(auth.uid())
  )
);

-- Policy: Teachers can update their own exams or exams in their institution
DROP POLICY IF EXISTS "Teachers can update their own exams" ON public.exams;
CREATE POLICY "Teachers can update exams"
ON public.exams
FOR UPDATE
TO authenticated
USING (
  (created_by = auth.uid())
  OR (
    institution_id = public.get_user_institution(auth.uid())
    AND (
      public.has_role(auth.uid(), 'coordinator')
      OR public.has_role(auth.uid(), 'school_admin')
      OR public.has_super_admin_access(auth.uid())
    )
  )
)
WITH CHECK (
  institution_id = public.get_user_institution(auth.uid())
  OR public.has_super_admin_access(auth.uid())
);

-- Policy: Super admins can manage all exams
DROP POLICY IF EXISTS "Super admins can manage all exams" ON public.exams;
CREATE POLICY "Super admins full access to exams"
ON public.exams
FOR ALL
TO authenticated
USING (public.has_super_admin_access(auth.uid()))
WITH CHECK (public.has_super_admin_access(auth.uid()));

-- ============================================
-- SUBJECTS TABLE POLICIES
-- ============================================

-- Drop existing policies
DROP POLICY IF EXISTS "Anyone can view subjects" ON public.subjects;
DROP POLICY IF EXISTS "Teachers can create local subjects" ON public.subjects;
DROP POLICY IF EXISTS "Teachers and coordinators can create local subjects" ON public.subjects;

-- Policy: View subjects in own institution or universal subjects
CREATE POLICY "View subjects in own institution"
ON public.subjects
FOR SELECT
TO authenticated
USING (
  institution_id = public.get_user_institution(auth.uid())
  OR is_universal = true
  OR public.has_super_admin_access(auth.uid())
);

-- Policy: Teachers can create subjects in their institution
CREATE POLICY "Teachers can create subjects"
ON public.subjects
FOR INSERT
TO authenticated
WITH CHECK (
  institution_id = public.get_user_institution(auth.uid())
  AND is_universal = false
  AND (
    public.has_role(auth.uid(), 'teacher')
    OR public.has_role(auth.uid(), 'coordinator')
    OR public.has_role(auth.uid(), 'school_admin')
    OR public.has_super_admin_access(auth.uid())
  )
);

-- Policy: Teachers can update subjects in their institution
CREATE POLICY "Teachers can update subjects"
ON public.subjects
FOR UPDATE
TO authenticated
USING (
  institution_id = public.get_user_institution(auth.uid())
  AND (
    public.has_role(auth.uid(), 'teacher')
    OR public.has_role(auth.uid(), 'coordinator')
    OR public.has_role(auth.uid(), 'school_admin')
    OR public.has_super_admin_access(auth.uid())
  )
);

-- ============================================
-- SYLLABUS_TOPICS TABLE POLICIES  
-- ============================================

-- Drop existing policies
DROP POLICY IF EXISTS "Anyone can view topics" ON public.syllabus_topics;
DROP POLICY IF EXISTS "Super admins can manage topics" ON public.syllabus_topics;

-- Policy: Anyone can view universal topics
CREATE POLICY "View universal topics"
ON public.syllabus_topics
FOR SELECT
TO authenticated
USING (true);

-- Policy: Super admins and teachers can create topics
CREATE POLICY "Authorized users can create topics"
ON public.syllabus_topics
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'teacher')
  OR public.has_role(auth.uid(), 'coordinator')
  OR public.has_role(auth.uid(), 'school_admin')
  OR public.has_super_admin_access(auth.uid())
);

-- Policy: Super admins and teachers can update topics
CREATE POLICY "Authorized users can update topics"
ON public.syllabus_topics
FOR UPDATE
TO authenticated
USING (
  public.has_role(auth.uid(), 'teacher')
  OR public.has_role(auth.uid(), 'coordinator')
  OR public.has_role(auth.uid(), 'school_admin')
  OR public.has_super_admin_access(auth.uid())
);

-- ============================================
-- SCHOOL_CUSTOM_TOPICS TABLE POLICIES
-- ============================================

-- Drop existing policies
DROP POLICY IF EXISTS "View school custom topics" ON public.school_custom_topics;
DROP POLICY IF EXISTS "Teachers can create custom topics" ON public.school_custom_topics;

-- Policy: View custom topics in own institution
CREATE POLICY "View custom topics in own institution"
ON public.school_custom_topics
FOR SELECT
TO authenticated
USING (
  institution_id = public.get_user_institution(auth.uid())
  OR public.has_super_admin_access(auth.uid())
);

-- Policy: Teachers can create custom topics in their institution
CREATE POLICY "Teachers can create custom topics"
ON public.school_custom_topics
FOR INSERT
TO authenticated
WITH CHECK (
  institution_id = public.get_user_institution(auth.uid())
  AND (
    public.has_role(auth.uid(), 'teacher')
    OR public.has_role(auth.uid(), 'coordinator')
    OR public.has_role(auth.uid(), 'school_admin')
    OR public.has_super_admin_access(auth.uid())
  )
);

-- Policy: Teachers can update custom topics in their institution
CREATE POLICY "Teachers can update custom topics"
ON public.school_custom_topics
FOR UPDATE
TO authenticated
USING (
  institution_id = public.get_user_institution(auth.uid())
  AND (
    public.has_role(auth.uid(), 'teacher')
    OR public.has_role(auth.uid(), 'coordinator')
    OR public.has_role(auth.uid(), 'school_admin')
    OR public.has_super_admin_access(auth.uid())
  )
);

-- ============================================
-- EXAM_CLASSES TABLE POLICIES
-- ============================================

-- Drop existing policies
DROP POLICY IF EXISTS "View exam classes" ON public.exam_classes;
DROP POLICY IF EXISTS "Manage exam classes" ON public.exam_classes;

-- Policy: View exam classes if assigned to exam or class
CREATE POLICY "View exam classes"
ON public.exam_classes
FOR SELECT
TO authenticated
USING (
  public.is_assigned_to_exam_class(auth.uid(), exam_id)
  OR public.is_exam_creator(exam_id, auth.uid())
  OR public.has_super_admin_access(auth.uid())
);

-- Policy: Teachers can manage exam classes for their exams
CREATE POLICY "Teachers can manage exam classes"
ON public.exam_classes
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_exam_creator(exam_id, auth.uid())
  OR (
    public.get_exam_institution(exam_id) = public.get_user_institution(auth.uid())
    AND (
      public.has_role(auth.uid(), 'teacher')
      OR public.has_role(auth.uid(), 'coordinator')
      OR public.has_role(auth.uid(), 'school_admin')
    )
  )
  OR public.has_super_admin_access(auth.uid())
);

-- Policy: Delete exam classes
CREATE POLICY "Teachers can delete exam classes"
ON public.exam_classes
FOR DELETE
TO authenticated
USING (
  public.is_exam_creator(exam_id, auth.uid())
  OR public.has_super_admin_access(auth.uid())
);

-- ============================================
-- STUDY_MATERIALS TABLE POLICIES (DATA ISOLATION)
-- ============================================

-- Drop existing policies
DROP POLICY IF EXISTS "View study materials" ON public.study_materials;
DROP POLICY IF EXISTS "Anyone can view study materials" ON public.study_materials;

-- Policy: View study materials in own institution or global materials
CREATE POLICY "View study materials in own institution"
ON public.study_materials
FOR SELECT
TO authenticated
USING (
  institution_id IS NULL  -- Global materials visible to all
  OR institution_id = public.get_user_institution(auth.uid())
  OR public.has_super_admin_access(auth.uid())
);

-- Policy: Create study materials in own institution
DROP POLICY IF EXISTS "Create study materials" ON public.study_materials;
CREATE POLICY "Create study materials in own institution"
ON public.study_materials
FOR INSERT
TO authenticated
WITH CHECK (
  (
    institution_id = public.get_user_institution(auth.uid())
    OR institution_id IS NULL
  )
  AND (
    public.has_role(auth.uid(), 'teacher')
    OR public.has_role(auth.uid(), 'coordinator')
    OR public.has_role(auth.uid(), 'school_admin')
    OR public.has_super_admin_access(auth.uid())
  )
);

-- Policy: Update study materials in own institution
DROP POLICY IF EXISTS "Update study materials" ON public.study_materials;
CREATE POLICY "Update study materials in own institution"
ON public.study_materials
FOR UPDATE
TO authenticated
USING (
  institution_id = public.get_user_institution(auth.uid())
  OR public.has_super_admin_access(auth.uid())
);

-- Policy: Delete study materials in own institution
DROP POLICY IF EXISTS "Delete study materials" ON public.study_materials;
CREATE POLICY "Delete study materials in own institution"
ON public.study_materials
FOR DELETE
TO authenticated
USING (
  institution_id = public.get_user_institution(auth.uid())
  OR public.has_super_admin_access(auth.uid())
);

-- ============================================
-- EXAM_SECTIONS TABLE POLICIES
-- ============================================

DROP POLICY IF EXISTS "View exam sections" ON public.exam_sections;
DROP POLICY IF EXISTS "Manage exam sections" ON public.exam_sections;

-- Policy: View exam sections
CREATE POLICY "View exam sections"
ON public.exam_sections
FOR SELECT
TO authenticated
USING (
  public.is_assigned_to_exam_class(auth.uid(), exam_id)
  OR public.is_exam_creator(exam_id, auth.uid())
  OR public.has_super_admin_access(auth.uid())
);

-- Policy: Create exam sections
CREATE POLICY "Create exam sections"
ON public.exam_sections
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_exam_creator(exam_id, auth.uid())
  OR public.has_super_admin_access(auth.uid())
  OR (
    public.get_exam_institution(exam_id) = public.get_user_institution(auth.uid())
    AND public.has_role(auth.uid(), 'teacher')
  )
);

-- Policy: Update exam sections
CREATE POLICY "Update exam sections"
ON public.exam_sections
FOR UPDATE
TO authenticated
USING (
  public.is_exam_creator(exam_id, auth.uid())
  OR public.has_super_admin_access(auth.uid())
);

-- ============================================
-- EXAM_QUESTIONS TABLE POLICIES
-- ============================================

DROP POLICY IF EXISTS "View exam questions" ON public.exam_questions;
DROP POLICY IF EXISTS "Manage exam questions" ON public.exam_questions;

-- Policy: View exam questions
CREATE POLICY "View exam questions"
ON public.exam_questions
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.exam_sections es
    WHERE es.id = section_id
    AND (
      public.is_assigned_to_exam_class(auth.uid(), es.exam_id)
      OR public.is_exam_creator(es.exam_id, auth.uid())
      OR public.has_super_admin_access(auth.uid())
    )
  )
);

-- Policy: Create exam questions
CREATE POLICY "Create exam questions"
ON public.exam_questions
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.exam_sections es
    WHERE es.id = section_id
    AND (
      public.is_exam_creator(es.exam_id, auth.uid())
      OR public.has_super_admin_access(auth.uid())
      OR (
        public.get_exam_institution(es.exam_id) = public.get_user_institution(auth.uid())
        AND public.has_role(auth.uid(), 'teacher')
      )
    )
  )
);

-- Policy: Update exam questions
CREATE POLICY "Update exam questions"
ON public.exam_questions
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.exam_sections es
    WHERE es.id = section_id
    AND (
      public.is_exam_creator(es.exam_id, auth.uid())
      OR public.has_super_admin_access(auth.uid())
    )
  )
);

-- ============================================
-- EVALUATION_BLUEPRINTS TABLE POLICIES
-- ============================================

DROP POLICY IF EXISTS "View blueprints" ON public.evaluation_blueprints;
DROP POLICY IF EXISTS "Manage blueprints" ON public.evaluation_blueprints;

-- Policy: View blueprints
CREATE POLICY "View evaluation blueprints"
ON public.evaluation_blueprints
FOR SELECT
TO authenticated
USING (
  public.is_exam_creator(exam_id, auth.uid())
  OR public.is_assigned_to_exam_class(auth.uid(), exam_id)
  OR public.has_super_admin_access(auth.uid())
);

-- Policy: Create blueprints
CREATE POLICY "Create evaluation blueprints"
ON public.evaluation_blueprints
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_exam_creator(exam_id, auth.uid())
  OR public.has_super_admin_access(auth.uid())
  OR (
    public.get_exam_institution(exam_id) = public.get_user_institution(auth.uid())
    AND public.has_role(auth.uid(), 'teacher')
  )
);

-- Policy: Update blueprints
CREATE POLICY "Update evaluation blueprints"
ON public.evaluation_blueprints
FOR UPDATE
TO authenticated
USING (
  public.is_exam_creator(exam_id, auth.uid())
  OR public.has_super_admin_access(auth.uid())
);