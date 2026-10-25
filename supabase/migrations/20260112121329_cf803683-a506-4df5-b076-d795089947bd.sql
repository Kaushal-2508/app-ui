-- Add RLS policies for subject_class_mappings to enable role-based management

-- School Admin can manage all subject-class mappings for their institution
CREATE POLICY "school_admin_manage_subject_mappings"
ON public.subject_class_mappings FOR ALL
USING (
  institution_id = public.get_user_institution(auth.uid())
  AND public.has_role(auth.uid(), 'school_admin')
)
WITH CHECK (
  institution_id = public.get_user_institution(auth.uid())
  AND public.has_role(auth.uid(), 'school_admin')
);

-- Coordinator can manage subject-class mappings for their institution
CREATE POLICY "coordinator_manage_subject_mappings"
ON public.subject_class_mappings FOR ALL
USING (
  institution_id = public.get_user_institution(auth.uid())
  AND public.has_role(auth.uid(), 'coordinator')
)
WITH CHECK (
  institution_id = public.get_user_institution(auth.uid())
  AND public.has_role(auth.uid(), 'coordinator')
);

-- Teacher can view subject-class mappings for their institution
CREATE POLICY "teacher_view_subject_mappings"
ON public.subject_class_mappings FOR SELECT
USING (
  institution_id = public.get_user_institution(auth.uid())
  AND public.has_role(auth.uid(), 'teacher')
);

-- Teacher can add subject-class mappings for classes they're assigned to
CREATE POLICY "teacher_add_subject_mappings"
ON public.subject_class_mappings FOR INSERT
WITH CHECK (
  institution_id = public.get_user_institution(auth.uid())
  AND public.has_role(auth.uid(), 'teacher')
  AND public.is_assigned_to_class(auth.uid(), class_id)
);