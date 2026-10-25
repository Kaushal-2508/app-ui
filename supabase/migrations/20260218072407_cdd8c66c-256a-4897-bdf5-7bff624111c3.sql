
-- Create helper function to check if teacher is assigned to exam's class+subject
CREATE OR REPLACE FUNCTION public.is_teacher_for_exam_class_subject(_user_id uuid, _exam_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM class_assignments ca
    JOIN exam_classes ec ON ec.class_id = ca.class_id
    JOIN exam_subjects es ON es.exam_id = ec.exam_id
    WHERE ca.user_id = _user_id
      AND ec.exam_id = _exam_id
      AND ca.subject_id = es.subject_id
      AND ca.role = 'teacher'
  )
$$;

-- Update RLS UPDATE policy on exams to allow assigned teachers
DROP POLICY IF EXISTS "Teachers can update exams" ON public.exams;
CREATE POLICY "Teachers can update exams" ON public.exams
FOR UPDATE USING (
  (created_by = auth.uid())
  OR is_teacher_for_exam_class_subject(auth.uid(), id)
  OR (institution_id = get_user_institution(auth.uid()) AND (
    has_role(auth.uid(), 'coordinator') OR
    has_role(auth.uid(), 'school_admin') OR
    has_super_admin_access(auth.uid())
  ))
)
WITH CHECK (
  institution_id = get_user_institution(auth.uid()) OR has_super_admin_access(auth.uid())
);
