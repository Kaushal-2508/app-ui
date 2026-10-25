-- Add missing columns to subjects table for better tracking
ALTER TABLE subjects ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id);
ALTER TABLE subjects ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- Ensure syllabus_topics.institution_id is properly indexed
CREATE INDEX IF NOT EXISTS idx_syllabus_topics_institution 
ON syllabus_topics(institution_id) WHERE institution_id IS NOT NULL;

-- Add is_active to syllabus_topics if missing
ALTER TABLE syllabus_topics ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- Comment for clarity
COMMENT ON COLUMN syllabus_topics.institution_id IS 'NULL = global topic (Super Admin), NOT NULL = institute-specific topic';

-- Add unique constraint to prevent duplicate subject names within same institution
CREATE UNIQUE INDEX IF NOT EXISTS idx_subjects_unique_name_per_institution
ON subjects (LOWER(name), institution_id) WHERE is_active = true;

-- Permission helper: Check if user can manage subjects for an institution
CREATE OR REPLACE FUNCTION public.can_manage_subjects(_user_id UUID, _inst_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN profiles p ON p.id = _user_id
    WHERE ur.user_id = _user_id
    AND (
      ur.role = 'super_admin'
      OR (ur.role = 'school_admin' AND p.institution_id = _inst_id)
    )
  )
$$;

-- Permission helper: Check if user can add topics to a class
CREATE OR REPLACE FUNCTION public.can_add_topics_to_class(_user_id UUID, _class_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN profiles p ON p.id = _user_id
    JOIN classes c ON c.id = _class_id
    WHERE ur.user_id = _user_id
    AND (
      ur.role = 'super_admin'
      OR (ur.role = 'school_admin' AND p.institution_id = c.institution_id)
      OR (ur.role = 'coordinator' AND public.is_coordinator_for_class(_user_id, _class_id))
      OR (ur.role = 'teacher' AND EXISTS (
        SELECT 1 FROM class_assignments ca 
        WHERE ca.user_id = _user_id AND ca.class_id = _class_id AND ca.role = 'teacher'
      ))
    )
  )
$$;

-- RLS Policy: Institute subjects visible only to members
DROP POLICY IF EXISTS "Institute subjects visible to members" ON subjects;
CREATE POLICY "Institute subjects visible to members"
ON subjects FOR SELECT
USING (
  institution_id IS NULL
  OR institution_id IN (
    SELECT institution_id FROM profiles WHERE id = auth.uid()
  )
  OR public.is_super_admin(auth.uid())
);

-- RLS Policy: Institute topics visible to members or super admin
DROP POLICY IF EXISTS "Institute topics visible to members" ON syllabus_topics;
CREATE POLICY "Institute topics visible to members"
ON syllabus_topics FOR SELECT
USING (
  institution_id IS NULL
  OR institution_id IN (
    SELECT institution_id FROM profiles WHERE id = auth.uid()
  )
  OR public.is_super_admin(auth.uid())
);

-- RLS Policy: Study materials visible based on institution
DROP POLICY IF EXISTS "Study materials visible to institution members" ON study_materials;
CREATE POLICY "Study materials visible to institution members"
ON study_materials FOR SELECT
USING (
  institution_id IS NULL
  OR institution_id IN (
    SELECT institution_id FROM profiles WHERE id = auth.uid()
  )
  OR public.is_super_admin(auth.uid())
);