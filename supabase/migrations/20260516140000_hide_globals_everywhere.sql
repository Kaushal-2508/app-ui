-- =============================================================
-- "Hide from your school" should mean GONE from your school, not
-- just gone from the syllabus tree. Surfaces like the chapter
-- picker in exam creation, the AI question generator, the study-
-- material dialog, and the question bank all read directly from
-- syllabus_topics — they were ignoring the hidden-list entirely.
--
-- A RESTRICTIVE SELECT policy is AND'd onto every read, so any
-- query of syllabus_topics (or chapter_topics — the fine-grained
-- topics nested under a chapter) automatically drops rows the
-- caller's institution has hidden. No frontend changes needed
-- elsewhere; the filter is at the DB layer.
--
-- Notes:
--   - super_admin's institution is NULL → get_user_institution()
--     returns NULL → the EXISTS subquery never matches → nothing
--     filtered. Platform admins still see every row.
--   - Edge functions run with service_role and bypass RLS, so
--     aggregations / cron jobs are unaffected.
--   - Hide is currently one-way per the simplified delete UX; to
--     restore a hidden chapter for an institution, delete the
--     matching institution_hidden_topics row.
-- =============================================================

-- ------------------ syllabus_topics ---------------------------

DROP POLICY IF EXISTS "Exclude hidden chapters per institution"
  ON public.syllabus_topics;

CREATE POLICY "Exclude hidden chapters per institution"
ON public.syllabus_topics
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (
  NOT EXISTS (
    SELECT 1
    FROM public.institution_hidden_topics iht
    WHERE iht.topic_id = syllabus_topics.id
      AND iht.institution_id = public.get_user_institution(auth.uid())
  )
);

-- ------------------ chapter_topics ----------------------------
-- Fine-grained topics are looked up via their parent chapter; if
-- the parent is hidden, the children should be too (otherwise
-- the topic dropdown in exam blueprint / AI generation surfaces
-- still leaks the inner topics of a hidden chapter).

DROP POLICY IF EXISTS "Exclude topics of hidden chapters per institution"
  ON public.chapter_topics;

CREATE POLICY "Exclude topics of hidden chapters per institution"
ON public.chapter_topics
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (
  NOT EXISTS (
    SELECT 1
    FROM public.institution_hidden_topics iht
    WHERE iht.topic_id = chapter_topics.chapter_id
      AND iht.institution_id = public.get_user_institution(auth.uid())
  )
);
