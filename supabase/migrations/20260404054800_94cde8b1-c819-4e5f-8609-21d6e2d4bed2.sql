-- Force delete remaining 31 AISB students that fail via API
-- Clean all public schema references first, then delete from auth

DO $$
DECLARE
  student_ids uuid[];
  sid uuid;
BEGIN
  -- Get remaining student IDs
  SELECT array_agg(ur.user_id) INTO student_ids
  FROM user_roles ur
  WHERE ur.role = 'student' AND ur.institution_id = '8af718c6-ca11-482b-9d6b-832f2b767928';

  IF student_ids IS NULL OR array_length(student_ids, 1) IS NULL THEN
    RAISE NOTICE 'No students found';
    RETURN;
  END IF;

  RAISE NOTICE 'Deleting % remaining students', array_length(student_ids, 1);

  -- Clean up ALL public schema FK references
  DELETE FROM class_assignments WHERE user_id = ANY(student_ids);
  DELETE FROM badge_progress WHERE user_id = ANY(student_ids);
  DELETE FROM concept_mastery WHERE student_id = ANY(student_ids);
  DELETE FROM attendance_records WHERE student_id = ANY(student_ids);
  DELETE FROM appointments WHERE student_id = ANY(student_ids);
  DELETE FROM conversation_participants WHERE user_id = ANY(student_ids);
  DELETE FROM circular_acknowledgements WHERE user_id = ANY(student_ids);
  DELETE FROM biometric_enrollments WHERE student_id = ANY(student_ids);
  DELETE FROM exam_insights WHERE student_id = ANY(student_ids);
  DELETE FROM notifications WHERE user_id = ANY(student_ids);
  
  -- Clean student exam data
  DELETE FROM student_answers WHERE attempt_id IN (
    SELECT id FROM student_exam_attempts WHERE student_id = ANY(student_ids)
  );
  DELETE FROM attempt_question_telemetry WHERE attempt_id IN (
    SELECT id FROM student_exam_attempts WHERE student_id = ANY(student_ids)
  );
  DELETE FROM attempt_section_telemetry WHERE attempt_id IN (
    SELECT id FROM student_exam_attempts WHERE student_id = ANY(student_ids)
  );
  DELETE FROM exam_attempt_logs WHERE attempt_id IN (
    SELECT id FROM student_exam_attempts WHERE student_id = ANY(student_ids)
  );
  DELETE FROM student_exam_attempts WHERE student_id = ANY(student_ids);
  
  -- Clean class_aggregates referencing these students as toppers
  UPDATE class_aggregates SET topper_student_id = NULL WHERE topper_student_id = ANY(student_ids);
  
  -- Delete user_roles and profiles  
  DELETE FROM user_roles WHERE user_id = ANY(student_ids);
  DELETE FROM profiles WHERE id = ANY(student_ids);
  
  -- Delete from auth schemas
  FOREACH sid IN ARRAY student_ids LOOP
    DELETE FROM auth.refresh_tokens WHERE user_id = sid::text;
    DELETE FROM auth.sessions WHERE user_id = sid;
    DELETE FROM auth.mfa_factors WHERE user_id = sid;
    DELETE FROM auth.identities WHERE user_id = sid;
    DELETE FROM auth.users WHERE id = sid;
  END LOOP;

  RAISE NOTICE 'Done deleting remaining students';
END $$;