-- Institution-scope the exam-sheets storage policies.
--
-- Before this, the four exam-sheets policies gated only on staff role + bucket,
-- with NO institution-path predicate. Now that the bucket is public and holds
-- per-tenant question papers (path = <institution_id>/<uuid>_<name>), any staff
-- member of any tenant could delete/overwrite/read another institution's paper
-- if they knew the path. This scopes every operation to the caller's own
-- institution (super_admin retains global access).

DROP POLICY IF EXISTS "Staff can upload exam sheets" ON storage.objects;
DROP POLICY IF EXISTS "Staff can view exam sheets"   ON storage.objects;
DROP POLICY IF EXISTS "Staff can update exam sheets" ON storage.objects;
DROP POLICY IF EXISTS "Staff can delete exam sheets" ON storage.objects;

CREATE POLICY "Staff can upload exam sheets"
  ON storage.objects FOR INSERT TO public
  WITH CHECK (
    bucket_id = 'exam-sheets' AND (
      public.is_super_admin(auth.uid())
      OR (
        (storage.foldername(name))[1] = (public.get_user_institution(auth.uid()))::text
        AND EXISTS (
          SELECT 1 FROM public.user_roles ur
          WHERE ur.user_id = auth.uid()
            AND ur.role = ANY (ARRAY['teacher','school_admin','super_school_admin','coordinator']::app_role[])
        )
      )
    )
  );

CREATE POLICY "Staff can view exam sheets"
  ON storage.objects FOR SELECT TO public
  USING (
    bucket_id = 'exam-sheets' AND (
      public.is_super_admin(auth.uid())
      OR (
        (storage.foldername(name))[1] = (public.get_user_institution(auth.uid()))::text
        AND EXISTS (
          SELECT 1 FROM public.user_roles ur
          WHERE ur.user_id = auth.uid()
            AND ur.role = ANY (ARRAY['teacher','school_admin','super_school_admin','coordinator']::app_role[])
        )
      )
    )
  );

CREATE POLICY "Staff can update exam sheets"
  ON storage.objects FOR UPDATE TO public
  USING (
    bucket_id = 'exam-sheets' AND (
      public.is_super_admin(auth.uid())
      OR (
        (storage.foldername(name))[1] = (public.get_user_institution(auth.uid()))::text
        AND EXISTS (
          SELECT 1 FROM public.user_roles ur
          WHERE ur.user_id = auth.uid()
            AND ur.role = ANY (ARRAY['teacher','school_admin','super_school_admin','coordinator']::app_role[])
        )
      )
    )
  )
  WITH CHECK (
    bucket_id = 'exam-sheets' AND (
      public.is_super_admin(auth.uid())
      OR (
        (storage.foldername(name))[1] = (public.get_user_institution(auth.uid()))::text
        AND EXISTS (
          SELECT 1 FROM public.user_roles ur
          WHERE ur.user_id = auth.uid()
            AND ur.role = ANY (ARRAY['teacher','school_admin','super_school_admin','coordinator']::app_role[])
        )
      )
    )
  );

CREATE POLICY "Staff can delete exam sheets"
  ON storage.objects FOR DELETE TO public
  USING (
    bucket_id = 'exam-sheets' AND (
      public.is_super_admin(auth.uid())
      OR (
        (storage.foldername(name))[1] = (public.get_user_institution(auth.uid()))::text
        AND EXISTS (
          SELECT 1 FROM public.user_roles ur
          WHERE ur.user_id = auth.uid()
            AND ur.role = ANY (ARRAY['teacher','school_admin','super_school_admin','coordinator']::app_role[])
        )
      )
    )
  );

-- NOTE: exam-sheets remains a PUBLIC bucket, so anonymous READ via the public
-- object URL still works (students view papers via getPublicUrl, bypassing
-- RLS). These policies govern the authenticated storage API + all writes,
-- closing the cross-tenant integrity gap (delete/overwrite/authenticated-read).
