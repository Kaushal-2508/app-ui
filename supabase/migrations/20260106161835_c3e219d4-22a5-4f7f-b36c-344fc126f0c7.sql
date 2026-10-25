-- 1. exam_sections: Allow creators to manage
CREATE POLICY "Creators can manage exam_sections"
ON public.exam_sections
FOR ALL
TO authenticated
USING (is_exam_creator(exam_id, auth.uid()))
WITH CHECK (is_exam_creator(exam_id, auth.uid()));

-- 2. exam_questions: Allow creators to manage
CREATE POLICY "Creators can manage exam_questions"
ON public.exam_questions
FOR ALL
TO authenticated
USING (is_exam_creator(get_section_exam_id(section_id), auth.uid()))
WITH CHECK (is_exam_creator(get_section_exam_id(section_id), auth.uid()));

-- 3. exam_classes: Replace INSERT-only policy with full access
DROP POLICY IF EXISTS "Exam creators can add class links" ON public.exam_classes;

CREATE POLICY "Creators can manage exam_classes"
ON public.exam_classes
FOR ALL
TO authenticated
USING (is_exam_creator(exam_id, auth.uid()))
WITH CHECK (is_exam_creator(exam_id, auth.uid()) AND is_assigned_to_class(auth.uid(), class_id));

-- 4. exam_subjects: Replace INSERT-only policy with full access
DROP POLICY IF EXISTS "Exam creators can add subject links" ON public.exam_subjects;

CREATE POLICY "Creators can manage exam_subjects"
ON public.exam_subjects
FOR ALL
TO authenticated
USING (is_exam_creator(exam_id, auth.uid()))
WITH CHECK (is_exam_creator(exam_id, auth.uid()));

-- 5. evaluation_blueprints: Allow creators to manage
CREATE POLICY "Creators can manage blueprints"
ON public.evaluation_blueprints
FOR ALL
TO authenticated
USING (is_exam_creator(exam_id, auth.uid()))
WITH CHECK (is_exam_creator(exam_id, auth.uid()));