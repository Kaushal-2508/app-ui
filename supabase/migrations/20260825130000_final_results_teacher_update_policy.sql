-- Teachers could not save offline marks: every batch reported "Saved 0 of N"
-- (Alliance + others, 307× "new row violates row-level security policy for
-- table final_results" in 48h of pg logs).
--
-- ROOT CAUSE — the teacher UPDATE policy on final_results:
--
--   "Teachers can update unpublished results"
--     USING (can_evaluate_attempt(auth.uid(), attempt_id) AND is_published = false)
--     (no WITH CHECK)
--
-- With no WITH CHECK, Postgres re-uses the USING expression against the NEW
-- row. The marks-entry save is an UPSERT on attempt_id; for any student whose
-- result row already exists it takes the UPDATE arm, and the client now writes
-- is_published = true whenever the "Publish results now" toggle is on OR the
-- row was already published (one-way publish, added ~2026-08-20). A new row
-- with is_published = true can never satisfy the implicit CHECK
-- `is_published = false`, so every such save died with 42501 — while the
-- attempt + offline_section_marks writes before it succeeded, which is why
-- "saved students keep their marks". School admins were unaffected (separate
-- ALL policy), so this hit exactly the teacher marking flow.
--
-- FIX: teachers may update results for attempts they can evaluate, including
-- publishing them (the publish toggle in the marking UI is an intended teacher
-- action) and correcting marks after publish (also intended — corrections must
-- never revoke a visible result; the client enforces one-way publish).
DROP POLICY IF EXISTS "Teachers can update unpublished results" ON public.final_results;

CREATE POLICY "Teachers can update results for assigned classes"
  ON public.final_results
  FOR UPDATE
  USING (can_evaluate_attempt(auth.uid(), attempt_id))
  WITH CHECK (can_evaluate_attempt(auth.uid(), attempt_id));
