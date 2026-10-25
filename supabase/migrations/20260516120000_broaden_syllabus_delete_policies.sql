-- =============================================================
-- Broaden DELETE policies on syllabus_topics + chapter_topics so
-- school_admin / super_school_admin / coordinator can delete
-- chapters and fine-grained topics that belong to their own
-- institution.
--
-- Previously, the only DELETE policy on syllabus_topics was
-- "Super admins can delete syllabus topics" — i.e. ONLY the
-- platform super_admin (Salci internal team) could delete.
-- Even a school_admin who created a chapter could not remove it.
-- The DELETE then silently failed under RLS (`{ error: null,
-- data: [] }`), the success toast fired, and the chapter
-- re-rendered — making the bug feel like "delete just doesn't
-- work".
--
-- Globally-seeded rows (`institution_id IS NULL`) stay protected
-- by the existing wildcard "Super admins can manage..." policy —
-- only super_admin can delete those, because deleting one removes
-- it for every school on the platform.
-- =============================================================

-- ---------------- syllabus_topics (chapters) -----------------

DROP POLICY IF EXISTS "Super admins can delete syllabus topics"
  ON public.syllabus_topics;

CREATE POLICY "Staff can delete institution syllabus topics"
ON public.syllabus_topics
FOR DELETE
TO authenticated
USING (
  institution_id IS NOT NULL
  AND institution_id = public.get_user_institution(auth.uid())
  AND EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role = ANY (ARRAY[
        'school_admin'::public.app_role,
        'super_school_admin'::public.app_role,
        'coordinator'::public.app_role
      ])
  )
);

-- ---------------- chapter_topics (fine topics) ---------------

DROP POLICY IF EXISTS "School admins can delete chapter_topics"
  ON public.chapter_topics;

CREATE POLICY "Staff can delete institution chapter_topics"
ON public.chapter_topics
FOR DELETE
TO authenticated
USING (
  institution_id IS NOT NULL
  AND institution_id = public.get_user_institution(auth.uid())
  AND EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role = ANY (ARRAY[
        'school_admin'::public.app_role,
        'super_school_admin'::public.app_role,
        'coordinator'::public.app_role
      ])
  )
);
