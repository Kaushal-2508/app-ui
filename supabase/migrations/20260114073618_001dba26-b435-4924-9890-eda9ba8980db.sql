-- Phase 1: Fix Super Admin Delete Access for Subjects, Topics, Study Materials

-- Create helper function for super admin check if not exists
CREATE OR REPLACE FUNCTION public.is_super_admin(user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_roles.user_id = $1
    AND role = 'super_admin'::app_role
  );
$$;

-- Drop existing DELETE policies that may be problematic
DROP POLICY IF EXISTS "Super admins can delete syllabus topics" ON public.syllabus_topics;
DROP POLICY IF EXISTS "Super admins can delete universal subjects" ON public.universal_subjects;
DROP POLICY IF EXISTS "Delete study materials in own institution" ON public.study_materials;
DROP POLICY IF EXISTS "Super admins can delete study materials" ON public.study_materials;
DROP POLICY IF EXISTS "Delete exams policy" ON public.exams;

-- Add DELETE policy for syllabus_topics
CREATE POLICY "Super admins can delete syllabus topics"
ON public.syllabus_topics
FOR DELETE
TO authenticated
USING (public.is_super_admin(auth.uid()));

-- Add DELETE policy for universal_subjects
CREATE POLICY "Super admins can delete universal subjects"
ON public.universal_subjects
FOR DELETE
TO authenticated
USING (public.is_super_admin(auth.uid()));

-- Add DELETE policy for study_materials (handles both super admin and institution users)
CREATE POLICY "Delete study materials policy"
ON public.study_materials
FOR DELETE
TO authenticated
USING (
  public.is_super_admin(auth.uid())
  OR (
    institution_id IS NOT NULL 
    AND institution_id = (SELECT institution_id FROM public.profiles WHERE id = auth.uid())
  )
  OR (
    institution_id IS NULL
    AND EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
      AND role IN ('school_admin', 'teacher', 'coordinator')
    )
  )
);

-- Phase 2: Add Exam Delete Functionality

-- Add DELETE policy for exams
CREATE POLICY "Delete exams policy"
ON public.exams
FOR DELETE
TO authenticated
USING (
  -- Super admins can delete any exam
  public.is_super_admin(auth.uid())
  -- School admins can delete exams in their institution
  OR (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
      AND role = 'school_admin'
      AND institution_id = exams.institution_id
    )
  )
  -- Creators can delete their own draft exams
  OR (created_by = auth.uid() AND status = 'draft'::exam_status)
  -- Teachers can delete their own exams regardless of status
  OR (created_by = auth.uid())
);

-- Add DELETE policies for exam-related tables (for cascading deletes)
DROP POLICY IF EXISTS "Delete exam sections policy" ON public.exam_sections;
CREATE POLICY "Delete exam sections policy"
ON public.exam_sections
FOR DELETE
TO authenticated
USING (
  public.is_super_admin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.exams
    WHERE exams.id = exam_sections.exam_id
    AND (
      exams.created_by = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_id = auth.uid()
        AND role = 'school_admin'
        AND institution_id = exams.institution_id
      )
    )
  )
);

DROP POLICY IF EXISTS "Delete exam questions policy" ON public.exam_questions;
CREATE POLICY "Delete exam questions policy"
ON public.exam_questions
FOR DELETE
TO authenticated
USING (
  public.is_super_admin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.exam_sections es
    JOIN public.exams e ON e.id = es.exam_id
    WHERE es.id = exam_questions.section_id
    AND (
      e.created_by = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_id = auth.uid()
        AND role = 'school_admin'
        AND institution_id = e.institution_id
      )
    )
  )
);

DROP POLICY IF EXISTS "Delete exam classes policy" ON public.exam_classes;
CREATE POLICY "Delete exam classes policy"
ON public.exam_classes
FOR DELETE
TO authenticated
USING (
  public.is_super_admin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.exams
    WHERE exams.id = exam_classes.exam_id
    AND (
      exams.created_by = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_id = auth.uid()
        AND role = 'school_admin'
        AND institution_id = exams.institution_id
      )
    )
  )
);

DROP POLICY IF EXISTS "Delete exam subjects policy" ON public.exam_subjects;
CREATE POLICY "Delete exam subjects policy"
ON public.exam_subjects
FOR DELETE
TO authenticated
USING (
  public.is_super_admin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.exams
    WHERE exams.id = exam_subjects.exam_id
    AND (
      exams.created_by = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_id = auth.uid()
        AND role = 'school_admin'
        AND institution_id = exams.institution_id
      )
    )
  )
);

DROP POLICY IF EXISTS "Delete evaluation blueprints policy" ON public.evaluation_blueprints;
CREATE POLICY "Delete evaluation blueprints policy"
ON public.evaluation_blueprints
FOR DELETE
TO authenticated
USING (
  public.is_super_admin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.exams
    WHERE exams.id = evaluation_blueprints.exam_id
    AND (
      exams.created_by = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_id = auth.uid()
        AND role = 'school_admin'
        AND institution_id = exams.institution_id
      )
    )
  )
);

DROP POLICY IF EXISTS "Delete exam topics policy" ON public.exam_topics;
CREATE POLICY "Delete exam topics policy"
ON public.exam_topics
FOR DELETE
TO authenticated
USING (
  public.is_super_admin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.exams
    WHERE exams.id = exam_topics.exam_id
    AND (
      exams.created_by = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_id = auth.uid()
        AND role = 'school_admin'
        AND institution_id = exams.institution_id
      )
    )
  )
);

-- Phase 3 & 4: Fix SELECT policies for exam-related tables for super admin

-- Ensure super admins can SELECT exam_sections
DROP POLICY IF EXISTS "Super admins can view all exam sections" ON public.exam_sections;
CREATE POLICY "Super admins can view all exam sections"
ON public.exam_sections
FOR SELECT
TO authenticated
USING (
  public.is_super_admin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.exams
    WHERE exams.id = exam_sections.exam_id
    AND (
      exams.created_by = auth.uid()
      OR exams.institution_id = (SELECT institution_id FROM public.profiles WHERE id = auth.uid())
    )
  )
);

-- Ensure super admins can SELECT exam_classes
DROP POLICY IF EXISTS "Super admins can view all exam classes" ON public.exam_classes;
CREATE POLICY "Super admins can view all exam classes"
ON public.exam_classes
FOR SELECT
TO authenticated
USING (
  public.is_super_admin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.exams
    WHERE exams.id = exam_classes.exam_id
    AND (
      exams.created_by = auth.uid()
      OR exams.institution_id = (SELECT institution_id FROM public.profiles WHERE id = auth.uid())
    )
  )
);

-- Ensure super admins can SELECT exam_subjects
DROP POLICY IF EXISTS "Super admins can view all exam subjects" ON public.exam_subjects;
CREATE POLICY "Super admins can view all exam subjects"
ON public.exam_subjects
FOR SELECT
TO authenticated
USING (
  public.is_super_admin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.exams
    WHERE exams.id = exam_subjects.exam_id
    AND (
      exams.created_by = auth.uid()
      OR exams.institution_id = (SELECT institution_id FROM public.profiles WHERE id = auth.uid())
    )
  )
);