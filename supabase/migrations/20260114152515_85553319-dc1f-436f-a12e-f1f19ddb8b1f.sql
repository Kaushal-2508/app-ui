-- ============================================
-- Fix RLS Infinite Recursion for classes/class_assignments
-- ============================================

-- 1. Create SECURITY DEFINER helper function to check class assignment (bypasses RLS)
CREATE OR REPLACE FUNCTION public.is_user_assigned_to_class(_user_id UUID, _class_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM class_assignments
    WHERE user_id = _user_id AND class_id = _class_id
  );
$$;

-- 2. Create SECURITY DEFINER helper to get institution_id from class (bypasses RLS)
CREATE OR REPLACE FUNCTION public.get_class_institution(_class_id UUID)
RETURNS UUID
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT institution_id FROM classes WHERE id = _class_id;
$$;

-- 3. Drop all problematic policies on classes table
DROP POLICY IF EXISTS "Teachers can view assigned classes" ON classes;
DROP POLICY IF EXISTS "Users can view classes in their institution" ON classes;
DROP POLICY IF EXISTS "School admins can manage classes in their institution" ON classes;
DROP POLICY IF EXISTS "Coordinators can view classes in their institution" ON classes;

-- 4. Recreate classes policies using SECURITY DEFINER helpers
CREATE POLICY "School admins can manage classes in their institution" ON classes
  FOR ALL USING (
    public.has_role_at_institution(auth.uid(), 'school_admin', institution_id)
  );

CREATE POLICY "Teachers can view assigned classes" ON classes
  FOR SELECT USING (
    public.has_role(auth.uid(), 'teacher') AND 
    public.is_user_assigned_to_class(auth.uid(), id)
  );

CREATE POLICY "Coordinators can view classes in their institution" ON classes
  FOR SELECT USING (
    public.has_role(auth.uid(), 'coordinator') AND 
    institution_id = public.get_user_institution(auth.uid())
  );

-- 5. Drop problematic policies on class_assignments table
DROP POLICY IF EXISTS "School admins can manage assignments in their institution" ON class_assignments;
DROP POLICY IF EXISTS "Teachers can view assignments in their institution" ON class_assignments;
DROP POLICY IF EXISTS "Coordinators can view assignments in their institution" ON class_assignments;
DROP POLICY IF EXISTS "Users can view their own assignments" ON class_assignments;
DROP POLICY IF EXISTS "Users can view assignments in their institution" ON class_assignments;

-- 6. Recreate class_assignments policies using SECURITY DEFINER helpers
CREATE POLICY "School admins can manage assignments in their institution" ON class_assignments
  FOR ALL USING (
    public.has_role_at_institution(auth.uid(), 'school_admin', public.get_class_institution(class_id))
  );

CREATE POLICY "Users can view their own assignments" ON class_assignments
  FOR SELECT USING (
    user_id = auth.uid()
  );

CREATE POLICY "Teachers can view assignments in their classes" ON class_assignments
  FOR SELECT USING (
    public.has_role(auth.uid(), 'teacher') AND 
    public.get_class_institution(class_id) = public.get_user_institution(auth.uid())
  );

CREATE POLICY "Coordinators can view assignments in their institution" ON class_assignments
  FOR SELECT USING (
    public.has_role(auth.uid(), 'coordinator') AND 
    public.get_class_institution(class_id) = public.get_user_institution(auth.uid())
  );