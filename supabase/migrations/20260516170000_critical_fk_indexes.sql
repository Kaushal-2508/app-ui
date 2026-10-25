-- Critical FK indexes — Tier 1 from the 2026-05-16 scaling audit.
-- Every FK column flagged as unindexed by the RLS / migration auditor.
-- All `IF NOT EXISTS` so the migration is safe to re-run and won't conflict
-- with anything created out-of-band.

-- institution_features.institution_id — `useInstitutionFeatures` runs on
-- virtually every authenticated route; was sequence-scanning before this.
CREATE INDEX IF NOT EXISTS institution_features_institution_id_idx
  ON public.institution_features(institution_id);

-- task_links FK columns (4 unindexed FKs from migration 20260104113057).
CREATE INDEX IF NOT EXISTS task_links_class_id_idx
  ON public.task_links(class_id);
CREATE INDEX IF NOT EXISTS task_links_subject_id_idx
  ON public.task_links(subject_id);
CREATE INDEX IF NOT EXISTS task_links_student_group_id_idx
  ON public.task_links(student_group_id);
-- task_links.exam_id is a text "soft FK" per audit; index still helps joins.
CREATE INDEX IF NOT EXISTS task_links_exam_id_idx
  ON public.task_links(exam_id);

-- task_evidence FK columns.
CREATE INDEX IF NOT EXISTS task_evidence_task_id_idx
  ON public.task_evidence(task_id);
CREATE INDEX IF NOT EXISTS task_evidence_uploaded_by_idx
  ON public.task_evidence(uploaded_by);

-- task_audit_logs actor lookup.
CREATE INDEX IF NOT EXISTS task_audit_logs_actor_id_idx
  ON public.task_audit_logs(actor_id);

-- tt_lesson_plans FK columns (5 unindexed FKs).
CREATE INDEX IF NOT EXISTS tt_lesson_plans_institution_id_idx
  ON public.tt_lesson_plans(institution_id);
CREATE INDEX IF NOT EXISTS tt_lesson_plans_class_id_idx
  ON public.tt_lesson_plans(class_id);
CREATE INDEX IF NOT EXISTS tt_lesson_plans_chapter_topic_id_idx
  ON public.tt_lesson_plans(chapter_topic_id);
CREATE INDEX IF NOT EXISTS tt_lesson_plans_updated_by_idx
  ON public.tt_lesson_plans(updated_by);
CREATE INDEX IF NOT EXISTS tt_lesson_plans_created_by_idx
  ON public.tt_lesson_plans(created_by);

-- tt_slots FK columns.
CREATE INDEX IF NOT EXISTS tt_slots_institution_id_idx
  ON public.tt_slots(institution_id);
CREATE INDEX IF NOT EXISTS tt_slots_created_by_idx
  ON public.tt_slots(created_by);

-- hybrid_* FKs to profiles (delete-cascade fastpath) + question_id lookup.
CREATE INDEX IF NOT EXISTS hybrid_pairing_tokens_institution_id_idx
  ON public.hybrid_pairing_tokens(institution_id);
CREATE INDEX IF NOT EXISTS hybrid_exam_attempts_evaluated_by_idx
  ON public.hybrid_exam_attempts(evaluated_by);
CREATE INDEX IF NOT EXISTS hybrid_question_marks_marked_by_idx
  ON public.hybrid_question_marks(marked_by);
CREATE INDEX IF NOT EXISTS hybrid_question_marks_question_id_idx
  ON public.hybrid_question_marks(question_id);
CREATE INDEX IF NOT EXISTS hybrid_sheet_annotations_created_by_idx
  ON public.hybrid_sheet_annotations(created_by);
CREATE INDEX IF NOT EXISTS hybrid_exam_attempt_logs_actor_id_idx
  ON public.hybrid_exam_attempt_logs(actor_id);
