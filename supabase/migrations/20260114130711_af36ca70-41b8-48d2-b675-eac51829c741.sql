-- Add institution_id to universal_subjects for institution-specific subjects
ALTER TABLE universal_subjects ADD COLUMN IF NOT EXISTS institution_id uuid REFERENCES institutions(id);

-- Add institution_id to syllabus_topics for institution-specific topics
ALTER TABLE syllabus_topics ADD COLUMN IF NOT EXISTS institution_id uuid REFERENCES institutions(id);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_universal_subjects_institution ON universal_subjects(institution_id);
CREATE INDEX IF NOT EXISTS idx_syllabus_topics_institution ON syllabus_topics(institution_id);

-- Create topic_class_mappings table for class-level filtering
CREATE TABLE IF NOT EXISTS topic_class_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id uuid NOT NULL REFERENCES syllabus_topics(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(topic_id, class_id)
);

-- Enable RLS on topic_class_mappings
ALTER TABLE topic_class_mappings ENABLE ROW LEVEL SECURITY;

-- Create helper function to get user's institution
CREATE OR REPLACE FUNCTION public.get_user_institution(_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT institution_id FROM public.profiles WHERE id = _user_id
$$;

-- Create helper function to check if user is coordinator for a wing containing a class
CREATE OR REPLACE FUNCTION public.is_coordinator_for_class(_user_id uuid, _class_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM wing_assignments wa
    JOIN wing_class_mappings wcm ON wcm.wing_id = wa.wing_id
    WHERE wa.user_id = _user_id
      AND wcm.class_id = _class_id
  )
$$;

-- Create helper function to check if teacher is assigned to a class
CREATE OR REPLACE FUNCTION public.is_teacher_for_class(_user_id uuid, _class_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM class_assignments ca
    WHERE ca.user_id = _user_id
      AND ca.class_id = _class_id
      AND ca.role = 'teacher'
  )
$$;

-- Drop existing permissive policies on universal_subjects
DROP POLICY IF EXISTS "Everyone can view universal subjects" ON universal_subjects;
DROP POLICY IF EXISTS "Authenticated users can view subjects" ON universal_subjects;
DROP POLICY IF EXISTS "Super admins can manage subjects" ON universal_subjects;

-- Create new RLS policies for universal_subjects
CREATE POLICY "Super admins have full access to subjects"
  ON universal_subjects FOR ALL
  USING (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Users can view relevant subjects"
  ON universal_subjects FOR SELECT
  USING (
    institution_id IS NULL 
    OR institution_id = public.get_user_institution(auth.uid())
  );

CREATE POLICY "School admins can manage institution subjects"
  ON universal_subjects FOR INSERT
  WITH CHECK (
    institution_id = public.get_user_institution(auth.uid())
    AND public.has_role(auth.uid(), 'school_admin')
  );

CREATE POLICY "School admins can update institution subjects"
  ON universal_subjects FOR UPDATE
  USING (
    institution_id = public.get_user_institution(auth.uid())
    AND public.has_role(auth.uid(), 'school_admin')
  );

CREATE POLICY "School admins can delete institution subjects"
  ON universal_subjects FOR DELETE
  USING (
    institution_id = public.get_user_institution(auth.uid())
    AND public.has_role(auth.uid(), 'school_admin')
  );

-- Drop existing permissive policies on syllabus_topics
DROP POLICY IF EXISTS "Everyone can view syllabus topics" ON syllabus_topics;
DROP POLICY IF EXISTS "View universal topics" ON syllabus_topics;
DROP POLICY IF EXISTS "Authenticated users can view topics" ON syllabus_topics;
DROP POLICY IF EXISTS "Super admins can manage topics" ON syllabus_topics;
DROP POLICY IF EXISTS "Teachers can manage topics" ON syllabus_topics;

-- Create new RLS policies for syllabus_topics
CREATE POLICY "Super admins have full access to topics"
  ON syllabus_topics FOR ALL
  USING (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Users can view relevant topics"
  ON syllabus_topics FOR SELECT
  USING (
    institution_id IS NULL 
    OR institution_id = public.get_user_institution(auth.uid())
  );

CREATE POLICY "School admins can insert institution topics"
  ON syllabus_topics FOR INSERT
  WITH CHECK (
    institution_id = public.get_user_institution(auth.uid())
    AND public.has_role(auth.uid(), 'school_admin')
  );

CREATE POLICY "School admins can update institution topics"
  ON syllabus_topics FOR UPDATE
  USING (
    institution_id = public.get_user_institution(auth.uid())
    AND public.has_role(auth.uid(), 'school_admin')
  );

CREATE POLICY "School admins can delete institution topics"
  ON syllabus_topics FOR DELETE
  USING (
    institution_id = public.get_user_institution(auth.uid())
    AND public.has_role(auth.uid(), 'school_admin')
  );

-- Coordinator policies for syllabus_topics (via topic_class_mappings)
CREATE POLICY "Coordinators can insert topics for wing classes"
  ON syllabus_topics FOR INSERT
  WITH CHECK (
    institution_id = public.get_user_institution(auth.uid())
    AND public.has_role(auth.uid(), 'coordinator')
  );

CREATE POLICY "Coordinators can update topics for wing classes"
  ON syllabus_topics FOR UPDATE
  USING (
    institution_id = public.get_user_institution(auth.uid())
    AND public.has_role(auth.uid(), 'coordinator')
    AND EXISTS (
      SELECT 1 FROM topic_class_mappings tcm
      WHERE tcm.topic_id = syllabus_topics.id
        AND public.is_coordinator_for_class(auth.uid(), tcm.class_id)
    )
  );

-- Teacher policies for syllabus_topics (via topic_class_mappings)
CREATE POLICY "Teachers can insert topics for assigned classes"
  ON syllabus_topics FOR INSERT
  WITH CHECK (
    institution_id = public.get_user_institution(auth.uid())
    AND public.has_role(auth.uid(), 'teacher')
  );

CREATE POLICY "Teachers can update topics for assigned classes"
  ON syllabus_topics FOR UPDATE
  USING (
    institution_id = public.get_user_institution(auth.uid())
    AND public.has_role(auth.uid(), 'teacher')
    AND EXISTS (
      SELECT 1 FROM topic_class_mappings tcm
      WHERE tcm.topic_id = syllabus_topics.id
        AND public.is_teacher_for_class(auth.uid(), tcm.class_id)
    )
  );

-- RLS policies for topic_class_mappings
CREATE POLICY "Super admins have full access to topic mappings"
  ON topic_class_mappings FOR ALL
  USING (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Users can view topic mappings for their institution"
  ON topic_class_mappings FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM classes c
      WHERE c.id = topic_class_mappings.class_id
        AND c.institution_id = public.get_user_institution(auth.uid())
    )
  );

CREATE POLICY "School admins can manage topic mappings"
  ON topic_class_mappings FOR ALL
  USING (
    public.has_role(auth.uid(), 'school_admin')
    AND EXISTS (
      SELECT 1 FROM classes c
      WHERE c.id = topic_class_mappings.class_id
        AND c.institution_id = public.get_user_institution(auth.uid())
    )
  );

CREATE POLICY "Coordinators can manage topic mappings for wing classes"
  ON topic_class_mappings FOR ALL
  USING (
    public.has_role(auth.uid(), 'coordinator')
    AND public.is_coordinator_for_class(auth.uid(), topic_class_mappings.class_id)
  );

CREATE POLICY "Teachers can manage topic mappings for assigned classes"
  ON topic_class_mappings FOR ALL
  USING (
    public.has_role(auth.uid(), 'teacher')
    AND public.is_teacher_for_class(auth.uid(), topic_class_mappings.class_id)
  );

-- Update classes RLS: Only super_admin can create classes
DROP POLICY IF EXISTS "School admins can manage classes" ON classes;
DROP POLICY IF EXISTS "School admins can manage classes in their institution" ON classes;

CREATE POLICY "Super admins can manage all classes"
  ON classes FOR ALL
  USING (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "School admins can view institution classes"
  ON classes FOR SELECT
  USING (
    institution_id = public.get_user_institution(auth.uid())
    AND public.has_role(auth.uid(), 'school_admin')
  );

CREATE POLICY "School admins can update institution classes"
  ON classes FOR UPDATE
  USING (
    institution_id = public.get_user_institution(auth.uid())
    AND public.has_role(auth.uid(), 'school_admin')
  );

CREATE POLICY "Coordinators can view wing classes"
  ON classes FOR SELECT
  USING (
    public.has_role(auth.uid(), 'coordinator')
    AND EXISTS (
      SELECT 1 FROM wing_class_mappings wcm
      JOIN wing_assignments wa ON wa.wing_id = wcm.wing_id
      WHERE wcm.class_id = classes.id
        AND wa.user_id = auth.uid()
    )
  );

CREATE POLICY "Teachers can view assigned classes"
  ON classes FOR SELECT
  USING (
    public.has_role(auth.uid(), 'teacher')
    AND EXISTS (
      SELECT 1 FROM class_assignments ca
      WHERE ca.class_id = classes.id
        AND ca.user_id = auth.uid()
    )
  );

-- Add comment for documentation
COMMENT ON COLUMN universal_subjects.institution_id IS 'NULL for universal/global subjects, set for institution-specific subjects';
COMMENT ON COLUMN syllabus_topics.institution_id IS 'NULL for universal/global topics, set for institution-specific topics';