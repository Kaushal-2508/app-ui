
-- Fix inline RLS policies that check for school_admin but miss super_school_admin

-- 1. ai_suggested_tasks
DROP POLICY IF EXISTS "School admins can view institution suggested tasks" ON ai_suggested_tasks;
CREATE POLICY "School admins can view institution suggested tasks" ON ai_suggested_tasks FOR SELECT USING (
  EXISTS (SELECT 1 FROM user_roles WHERE user_roles.user_id = auth.uid() AND user_roles.role IN ('school_admin','super_school_admin') AND user_roles.institution_id = ai_suggested_tasks.institution_id)
);

-- 2. ai_usage_logs
DROP POLICY IF EXISTS "School admins can view institution logs" ON ai_usage_logs;
CREATE POLICY "School admins can view institution logs" ON ai_usage_logs FOR SELECT USING (
  EXISTS (SELECT 1 FROM user_roles WHERE user_roles.user_id = auth.uid() AND user_roles.role IN ('school_admin','super_school_admin') AND user_roles.institution_id = ai_usage_logs.institution_id)
);

-- 3. ai_usage_quotas
DROP POLICY IF EXISTS "School admins can view their institution quotas" ON ai_usage_quotas;
CREATE POLICY "School admins can view their institution quotas" ON ai_usage_quotas FOR SELECT USING (
  EXISTS (SELECT 1 FROM user_roles WHERE user_roles.user_id = auth.uid() AND user_roles.role IN ('school_admin','super_school_admin') AND user_roles.institution_id = ai_usage_quotas.institution_id)
);

-- 4. class_aggregates
DROP POLICY IF EXISTS "School admins can view institution class aggregates" ON class_aggregates;
CREATE POLICY "School admins can view institution class aggregates" ON class_aggregates FOR SELECT USING (
  EXISTS (SELECT 1 FROM classes c JOIN user_roles ur ON ur.institution_id = c.institution_id WHERE c.id = class_aggregates.class_id AND ur.user_id = auth.uid() AND ur.role IN ('school_admin','super_school_admin'))
);

-- 5. concept_mastery
DROP POLICY IF EXISTS "School staff can view institution concept mastery" ON concept_mastery;
CREATE POLICY "School staff can view institution concept mastery" ON concept_mastery FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles p JOIN user_roles ur ON ur.user_id = p.id WHERE p.id = auth.uid() AND p.institution_id = concept_mastery.institution_id AND ur.role IN ('school_admin','super_school_admin','coordinator'))
);

-- 6. evaluation_blueprints (Delete policy)
DROP POLICY IF EXISTS "Delete evaluation blueprints policy" ON evaluation_blueprints;
CREATE POLICY "Delete evaluation blueprints policy" ON evaluation_blueprints FOR DELETE USING (
  is_super_admin(auth.uid()) OR EXISTS (
    SELECT 1 FROM exams WHERE exams.id = evaluation_blueprints.exam_id AND (
      exams.created_by = auth.uid() OR EXISTS (
        SELECT 1 FROM user_roles WHERE user_roles.user_id = auth.uid() AND user_roles.role IN ('school_admin','super_school_admin') AND user_roles.institution_id = exams.institution_id
      )
    )
  )
);

-- 7. exam_classes (Delete policy)
DROP POLICY IF EXISTS "Delete exam classes policy" ON exam_classes;
CREATE POLICY "Delete exam classes policy" ON exam_classes FOR DELETE USING (
  is_super_admin(auth.uid()) OR EXISTS (
    SELECT 1 FROM exams WHERE exams.id = exam_classes.exam_id AND (
      exams.created_by = auth.uid() OR EXISTS (
        SELECT 1 FROM user_roles WHERE user_roles.user_id = auth.uid() AND user_roles.role IN ('school_admin','super_school_admin') AND user_roles.institution_id = exams.institution_id
      )
    )
  )
);

-- 8. exam_questions (Delete policy)
DROP POLICY IF EXISTS "Delete exam questions policy" ON exam_questions;
CREATE POLICY "Delete exam questions policy" ON exam_questions FOR DELETE USING (
  is_super_admin(auth.uid()) OR EXISTS (
    SELECT 1 FROM exam_sections es JOIN exams e ON e.id = es.exam_id WHERE es.id = exam_questions.section_id AND (
      e.created_by = auth.uid() OR EXISTS (
        SELECT 1 FROM user_roles WHERE user_roles.user_id = auth.uid() AND user_roles.role IN ('school_admin','super_school_admin') AND user_roles.institution_id = e.institution_id
      )
    )
  )
);

-- 9. exam_sections (Delete policy)
DROP POLICY IF EXISTS "Delete exam sections policy" ON exam_sections;
CREATE POLICY "Delete exam sections policy" ON exam_sections FOR DELETE USING (
  is_super_admin(auth.uid()) OR EXISTS (
    SELECT 1 FROM exams WHERE exams.id = exam_sections.exam_id AND (
      exams.created_by = auth.uid() OR EXISTS (
        SELECT 1 FROM user_roles WHERE user_roles.user_id = auth.uid() AND user_roles.role IN ('school_admin','super_school_admin') AND user_roles.institution_id = exams.institution_id
      )
    )
  )
);

-- 10. exam_subjects (Delete policy)
DROP POLICY IF EXISTS "Delete exam subjects policy" ON exam_subjects;
CREATE POLICY "Delete exam subjects policy" ON exam_subjects FOR DELETE USING (
  is_super_admin(auth.uid()) OR EXISTS (
    SELECT 1 FROM exams WHERE exams.id = exam_subjects.exam_id AND (
      exams.created_by = auth.uid() OR EXISTS (
        SELECT 1 FROM user_roles WHERE user_roles.user_id = auth.uid() AND user_roles.role IN ('school_admin','super_school_admin') AND user_roles.institution_id = exams.institution_id
      )
    )
  )
);

-- 11. exam_topics (Delete policy)
DROP POLICY IF EXISTS "Delete exam topics policy" ON exam_topics;
CREATE POLICY "Delete exam topics policy" ON exam_topics FOR DELETE USING (
  is_super_admin(auth.uid()) OR EXISTS (
    SELECT 1 FROM exams WHERE exams.id = exam_topics.exam_id AND (
      exams.created_by = auth.uid() OR EXISTS (
        SELECT 1 FROM user_roles WHERE user_roles.user_id = auth.uid() AND user_roles.role IN ('school_admin','super_school_admin') AND user_roles.institution_id = exams.institution_id
      )
    )
  )
);

-- 12. exams (Delete policy)
DROP POLICY IF EXISTS "Delete exams policy" ON exams;
CREATE POLICY "Delete exams policy" ON exams FOR DELETE USING (
  is_super_admin(auth.uid()) OR EXISTS (
    SELECT 1 FROM user_roles WHERE user_roles.user_id = auth.uid() AND user_roles.role IN ('school_admin','super_school_admin') AND user_roles.institution_id = exams.institution_id
  ) OR (created_by = auth.uid() AND status = 'draft') OR created_by = auth.uid()
);

-- 13. exams (Teachers can update - includes school_admin in has_role)
-- This one uses has_role() which is already fixed

-- 14. institution_subscriptions
DROP POLICY IF EXISTS "School admins can view their subscription" ON institution_subscriptions;
CREATE POLICY "School admins can view their subscription" ON institution_subscriptions FOR SELECT USING (
  institution_id = get_user_institution(auth.uid()) AND (has_role(auth.uid(), 'school_admin') OR has_role(auth.uid(), 'super_school_admin'))
);

-- 15. learning_actions (manage)
DROP POLICY IF EXISTS "School admins can manage learning actions" ON learning_actions;
CREATE POLICY "School admins can manage learning actions" ON learning_actions FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles p JOIN user_roles ur ON ur.user_id = p.id WHERE p.id = auth.uid() AND p.institution_id = learning_actions.institution_id AND ur.role IN ('school_admin','super_school_admin'))
);

-- 16. learning_actions (view)
DROP POLICY IF EXISTS "School staff can view institution learning actions" ON learning_actions;
CREATE POLICY "School staff can view institution learning actions" ON learning_actions FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles p JOIN user_roles ur ON ur.user_id = p.id WHERE p.id = auth.uid() AND p.institution_id = learning_actions.institution_id AND ur.role IN ('school_admin','super_school_admin','coordinator'))
);

-- 17-21. Storage objects (add super_school_admin to ARRAY checks)
DROP POLICY IF EXISTS "Staff can view exam sheets" ON storage.objects;
CREATE POLICY "Staff can view exam sheets" ON storage.objects FOR SELECT USING (
  bucket_id = 'exam-sheets' AND EXISTS (SELECT 1 FROM user_roles WHERE user_roles.user_id = auth.uid() AND user_roles.role IN ('teacher','school_admin','super_school_admin','coordinator','super_admin'))
);

DROP POLICY IF EXISTS "Staff can update exam sheets" ON storage.objects;
CREATE POLICY "Staff can update exam sheets" ON storage.objects FOR UPDATE USING (
  bucket_id = 'exam-sheets' AND EXISTS (SELECT 1 FROM user_roles WHERE user_roles.user_id = auth.uid() AND user_roles.role IN ('teacher','school_admin','super_school_admin','coordinator','super_admin'))
);

DROP POLICY IF EXISTS "Staff can delete exam sheets" ON storage.objects;
CREATE POLICY "Staff can delete exam sheets" ON storage.objects FOR DELETE USING (
  bucket_id = 'exam-sheets' AND EXISTS (SELECT 1 FROM user_roles WHERE user_roles.user_id = auth.uid() AND user_roles.role IN ('teacher','school_admin','super_school_admin','coordinator','super_admin'))
);

DROP POLICY IF EXISTS "Authorized users can view proctoring screenshots" ON storage.objects;
CREATE POLICY "Authorized users can view proctoring screenshots" ON storage.objects FOR SELECT USING (
  bucket_id = 'proctoring-screenshots' AND EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('teacher','coordinator','school_admin','super_school_admin','super_admin'))
);

DROP POLICY IF EXISTS "Authorized users can delete proctoring screenshots" ON storage.objects;
CREATE POLICY "Authorized users can delete proctoring screenshots" ON storage.objects FOR DELETE USING (
  bucket_id = 'proctoring-screenshots' AND EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('teacher','coordinator','school_admin','super_school_admin','super_admin'))
);

-- 22. school_aggregates
DROP POLICY IF EXISTS "School admins can view own institution aggregates" ON school_aggregates;
CREATE POLICY "School admins can view own institution aggregates" ON school_aggregates FOR SELECT USING (
  EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('school_admin','super_school_admin') AND ur.institution_id = school_aggregates.institution_id)
);

-- 23. student_performance_snapshots
DROP POLICY IF EXISTS "School admins can view institution snapshots" ON student_performance_snapshots;
CREATE POLICY "School admins can view institution snapshots" ON student_performance_snapshots FOR SELECT USING (
  EXISTS (SELECT 1 FROM classes c JOIN user_roles ur ON ur.institution_id = c.institution_id WHERE c.id = student_performance_snapshots.class_id AND ur.user_id = auth.uid() AND ur.role IN ('school_admin','super_school_admin'))
);

-- 24. student_remarks
DROP POLICY IF EXISTS "Admins view institution remarks" ON student_remarks;
CREATE POLICY "Admins view institution remarks" ON student_remarks FOR SELECT USING (
  institution_id = get_user_institution(auth.uid()) AND (has_role(auth.uid(), 'school_admin') OR has_role(auth.uid(), 'super_school_admin'))
);

-- 25. study_materials (Delete policy - add super_school_admin to array)
DROP POLICY IF EXISTS "Delete study materials policy" ON study_materials;
CREATE POLICY "Delete study materials policy" ON study_materials FOR DELETE USING (
  is_super_admin(auth.uid()) OR (institution_id IS NOT NULL AND institution_id = (SELECT profiles.institution_id FROM profiles WHERE profiles.id = auth.uid())) OR (institution_id IS NULL AND EXISTS (SELECT 1 FROM user_roles WHERE user_roles.user_id = auth.uid() AND user_roles.role IN ('school_admin','super_school_admin','teacher','coordinator')))
);

-- 26. subscription_alerts
DROP POLICY IF EXISTS "School admins can view their alerts" ON subscription_alerts;
CREATE POLICY "School admins can view their alerts" ON subscription_alerts FOR SELECT USING (
  EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('school_admin','super_school_admin') AND ur.institution_id = subscription_alerts.institution_id)
);

-- 27. teacher_aggregates
DROP POLICY IF EXISTS "School admins can view institution teacher aggregates" ON teacher_aggregates;
CREATE POLICY "School admins can view institution teacher aggregates" ON teacher_aggregates FOR SELECT USING (
  EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('school_admin','super_school_admin') AND ur.institution_id = teacher_aggregates.institution_id)
);

-- 28. teacher_effectiveness
DROP POLICY IF EXISTS "Admins view institution effectiveness" ON teacher_effectiveness;
CREATE POLICY "Admins view institution effectiveness" ON teacher_effectiveness FOR SELECT USING (
  EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = auth.uid() AND ur.institution_id = teacher_effectiveness.institution_id AND ur.role IN ('school_admin','super_school_admin','coordinator'))
);

-- 29. student_passport (add super_school_admin to array)
DROP POLICY IF EXISTS "Staff view institution passports" ON student_passport;
CREATE POLICY "Staff view institution passports" ON student_passport FOR SELECT USING (
  EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = auth.uid() AND ur.institution_id = student_passport.institution_id AND ur.role IN ('super_admin','school_admin','super_school_admin','coordinator','teacher'))
);

-- 30. user_badges (add super_school_admin to array)
DROP POLICY IF EXISTS "Staff view institution badges" ON user_badges;
CREATE POLICY "Staff view institution badges" ON user_badges FOR SELECT USING (
  EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = auth.uid() AND ur.institution_id = user_badges.institution_id AND ur.role IN ('super_admin','school_admin','super_school_admin','coordinator','teacher'))
);

-- 31. payment_records
DROP POLICY IF EXISTS "School admins can view their institution payments" ON payment_records;
CREATE POLICY "School admins can view their institution payments" ON payment_records FOR SELECT USING (
  institution_id = get_user_institution(auth.uid()) AND (has_role(auth.uid(), 'school_admin') OR has_role(auth.uid(), 'super_school_admin'))
);

-- 32. school_custom_topics (update - add super_school_admin)
DROP POLICY IF EXISTS "Teachers can update custom topics" ON school_custom_topics;
CREATE POLICY "Teachers can update custom topics" ON school_custom_topics FOR UPDATE USING (
  institution_id = get_user_institution(auth.uid()) AND (has_role(auth.uid(), 'teacher') OR has_role(auth.uid(), 'coordinator') OR has_role(auth.uid(), 'school_admin') OR has_role(auth.uid(), 'super_school_admin') OR has_super_admin_access(auth.uid()))
);

-- 33. syllabus_topics (update)
DROP POLICY IF EXISTS "Authorized users can update topics" ON syllabus_topics;
CREATE POLICY "Authorized users can update topics" ON syllabus_topics FOR UPDATE USING (
  has_role(auth.uid(), 'teacher') OR has_role(auth.uid(), 'coordinator') OR has_role(auth.uid(), 'school_admin') OR has_role(auth.uid(), 'super_school_admin') OR has_super_admin_access(auth.uid())
);

-- 34. syllabus_topics (delete)
DROP POLICY IF EXISTS "School admins can delete institution topics" ON syllabus_topics;
CREATE POLICY "School admins can delete institution topics" ON syllabus_topics FOR DELETE USING (
  institution_id = get_user_institution(auth.uid()) AND (has_role(auth.uid(), 'school_admin') OR has_role(auth.uid(), 'super_school_admin'))
);

-- 35. syllabus_topics (update by school admin)
DROP POLICY IF EXISTS "School admins can update institution topics" ON syllabus_topics;
CREATE POLICY "School admins can update institution topics" ON syllabus_topics FOR UPDATE USING (
  institution_id = get_user_institution(auth.uid()) AND (has_role(auth.uid(), 'school_admin') OR has_role(auth.uid(), 'super_school_admin'))
);

-- 36. system_audit_logs
DROP POLICY IF EXISTS "School admins can view their institution audit logs" ON system_audit_logs;
CREATE POLICY "School admins can view their institution audit logs" ON system_audit_logs FOR SELECT USING (
  (has_role(auth.uid(), 'school_admin') OR has_role(auth.uid(), 'super_school_admin')) AND ((metadata->>'institution_id') = get_user_institution(auth.uid())::text OR actor_id = auth.uid())
);

-- 37. universal_subjects (delete)
DROP POLICY IF EXISTS "School admins can delete institution subjects" ON universal_subjects;
CREATE POLICY "School admins can delete institution subjects" ON universal_subjects FOR DELETE USING (
  institution_id = get_user_institution(auth.uid()) AND (has_role(auth.uid(), 'school_admin') OR has_role(auth.uid(), 'super_school_admin'))
);

-- 38. universal_subjects (update)
DROP POLICY IF EXISTS "School admins can update institution subjects" ON universal_subjects;
CREATE POLICY "School admins can update institution subjects" ON universal_subjects FOR UPDATE USING (
  institution_id = get_user_institution(auth.uid()) AND (has_role(auth.uid(), 'school_admin') OR has_role(auth.uid(), 'super_school_admin'))
);

-- 39. subject_class_mappings (manage)
DROP POLICY IF EXISTS "Admins can manage subject-class mappings" ON subject_class_mappings;
CREATE POLICY "Admins can manage subject-class mappings" ON subject_class_mappings FOR ALL USING (
  (institution_id = get_user_institution(auth.uid()) AND (has_role(auth.uid(), 'school_admin') OR has_role(auth.uid(), 'super_school_admin'))) OR has_role(auth.uid(), 'super_admin')
);

DROP POLICY IF EXISTS "school_admin_manage_subject_mappings" ON subject_class_mappings;
CREATE POLICY "school_admin_manage_subject_mappings" ON subject_class_mappings FOR ALL USING (
  institution_id = get_user_institution(auth.uid()) AND (has_role(auth.uid(), 'school_admin') OR has_role(auth.uid(), 'super_school_admin'))
);

-- 40. subjects (update)
DROP POLICY IF EXISTS "School admins can update subjects" ON subjects;
CREATE POLICY "School admins can update subjects" ON subjects FOR UPDATE USING (
  institution_id = get_user_institution(auth.uid()) AND (has_role(auth.uid(), 'school_admin') OR has_role(auth.uid(), 'super_school_admin') OR has_super_admin_access(auth.uid()))
);

-- 41. user_question_limits (update)
DROP POLICY IF EXISTS "Admins can update user limits" ON user_question_limits;
CREATE POLICY "Admins can update user limits" ON user_question_limits FOR UPDATE USING (
  (institution_id = get_user_institution(auth.uid()) AND (has_role(auth.uid(), 'school_admin') OR has_role(auth.uid(), 'super_school_admin'))) OR has_role(auth.uid(), 'super_admin') OR has_super_admin_access(auth.uid())
);

-- 42. parent_student_links
DROP POLICY IF EXISTS "School admins can manage parent student links" ON parent_student_links;
CREATE POLICY "School admins can manage parent student links" ON parent_student_links FOR ALL USING (
  has_role(auth.uid(), 'school_admin') OR has_role(auth.uid(), 'super_school_admin') OR has_role(auth.uid(), 'super_admin')
);

-- 43. topic_class_mappings
DROP POLICY IF EXISTS "School admins can manage topic mappings" ON topic_class_mappings;
CREATE POLICY "School admins can manage topic mappings" ON topic_class_mappings FOR ALL USING (
  (has_role(auth.uid(), 'school_admin') OR has_role(auth.uid(), 'super_school_admin')) AND EXISTS (SELECT 1 FROM classes c WHERE c.id = topic_class_mappings.class_id AND c.institution_id = get_user_institution(auth.uid()))
);

-- 44. wing_class_mappings
DROP POLICY IF EXISTS "School admins can manage wing-class mappings" ON wing_class_mappings;
CREATE POLICY "School admins can manage wing-class mappings" ON wing_class_mappings FOR ALL USING (
  EXISTS (SELECT 1 FROM wings w WHERE w.id = wing_class_mappings.wing_id AND w.institution_id = get_user_institution(auth.uid()) AND (has_role(auth.uid(), 'school_admin') OR has_role(auth.uid(), 'super_school_admin') OR has_role(auth.uid(), 'super_admin')))
);

-- 45. classes (view + update with inline checks)
DROP POLICY IF EXISTS "School admins can view institution classes" ON classes;
CREATE POLICY "School admins can view institution classes" ON classes FOR SELECT USING (
  institution_id = get_user_institution(auth.uid()) AND (has_role(auth.uid(), 'school_admin') OR has_role(auth.uid(), 'super_school_admin'))
);

DROP POLICY IF EXISTS "School admins can update institution classes" ON classes;
CREATE POLICY "School admins can update institution classes" ON classes FOR UPDATE USING (
  institution_id = get_user_institution(auth.uid()) AND (has_role(auth.uid(), 'school_admin') OR has_role(auth.uid(), 'super_school_admin'))
);
