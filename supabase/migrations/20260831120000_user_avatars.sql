-- Profile photographs: private storage, role-scoped writes.
--
-- profiles.avatar_url has existed since 20260104113057 and has NEVER been
-- written by anything. It is kept (not dropped) and profiles gain a NEW
-- column, avatar_path, which holds a STORAGE PATH, not a URL: photos are
-- never signed and never public. Clients download them through the
-- authenticated endpoint so RLS is evaluated on every fetch.

-- 1. Column ------------------------------------------------------------------

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_path TEXT;

COMMENT ON COLUMN public.profiles.avatar_path IS
  'Immutable object path in the PRIVATE user-avatars bucket: {user_id}/{uuid}.webp. '
  'NOT a URL and never signed. Fetched via the authenticated download endpoint and '
  'cached on-device (src/lib/avatarStore.ts). Writes are gated by can_set_user_photo() '
  'at BOTH set_user_avatar() and the trg_enforce_avatar_path_authority trigger.';

CREATE INDEX IF NOT EXISTS idx_profiles_institution_id
  ON public.profiles(institution_id);

-- 2. Bucket ------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('user-avatars', 'user-avatars', false, 2097152,
        ARRAY['image/webp', 'image/jpeg', 'image/png'])
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 3. Path parser -------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.avatar_owner_from_path(_name text)
RETURNS uuid LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE _seg text;
BEGIN
  _seg := split_part(coalesce(_name, ''), '/', 1);
  RETURN _seg::uuid;
EXCEPTION WHEN others THEN
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.avatar_owner_from_path(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.avatar_owner_from_path(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.avatar_owner_from_path(text) TO authenticated;

-- 4. Read gate ---------------------------------------------------------------
-- Same institution. These people already appear by name and class in every list
-- the viewer can open.

CREATE OR REPLACE FUNCTION public.can_view_user_photo(_target uuid, _viewer uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _target IS NOT NULL AND _viewer IS NOT NULL AND (
    public.is_super_admin(_viewer)
    OR EXISTS (
      SELECT 1
      FROM public.profiles t
      JOIN public.profiles v ON v.id = _viewer
      WHERE t.id = _target
        AND t.institution_id IS NOT NULL
        AND t.institution_id = v.institution_id
    )
  );
$$;

COMMENT ON FUNCTION public.can_view_user_photo(uuid, uuid) IS
  'TRUE when _viewer may view _target''s profile photo. Argument order is '
  '(_target, _viewer) -- the OPPOSITE of can_set_user_photo(_actor, _target). '
  'Composed by the user_avatars_select storage policy; do not swap the order '
  'at a call site.';

REVOKE ALL ON FUNCTION public.can_view_user_photo(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_view_user_photo(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_view_user_photo(uuid, uuid) TO authenticated;

-- 5. Write gate --------------------------------------------------------------
-- Modelled on can_edit_student_details (20260826150000). Note that
-- teacher_controls_student() and is_coordinator_for_class() are NOT
-- institution-scoped by themselves, and is_coordinator_for_class() does not
-- check the coordinator role either, so each branch re-adds those guards.

CREATE OR REPLACE FUNCTION public.can_set_user_photo(_actor uuid, _target uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _actor IS NOT NULL AND _target IS NOT NULL AND (

    public.is_super_admin(_actor)

    -- Self-service. Everyone owns their own photo EXCEPT students.
    OR (_actor = _target AND NOT public.has_role(_actor, 'student'))

    -- School admins: anyone in their institution.
    -- has_role(_,'school_admin') already matches super_school_admin.
    OR (
      public.has_role(_actor, 'school_admin')
      AND EXISTS (SELECT 1 FROM public.profiles p
                  WHERE p.id = _target
                    AND p.institution_id = public.get_user_institution(_actor))
    )

    -- Coordinators: students and teachers of classes mapped to their wing.
    -- Never a peer coordinator, never an admin. This is deliberately NARROWER
    -- than 20260502120000, which gave coordinators institution-wide staff
    -- management; photographs of children are held to the wing.
    OR (
      public.has_role(_actor, 'coordinator')
      AND EXISTS (SELECT 1 FROM public.profiles p
                  WHERE p.id = _target
                    AND p.institution_id = public.get_user_institution(_actor))
      AND NOT public.has_role(_target, 'coordinator')
      AND NOT public.has_role(_target, 'school_admin')
      AND NOT public.is_super_admin(_target)
      AND EXISTS (
        SELECT 1 FROM public.class_assignments ca
        WHERE ca.user_id = _target
          AND ca.role IN ('student', 'teacher')
          AND public.is_coordinator_for_class(_actor, ca.class_id)
      )
    )

    -- Teachers: only their own subject students. Class-sharing is NOT authority.
    OR (
      public.has_role(_actor, 'teacher')
      AND EXISTS (SELECT 1 FROM public.profiles p
                  WHERE p.id = _target
                    AND p.institution_id = public.get_user_institution(_actor))
      AND public.teacher_controls_student(_actor, _target)
    )
  );
$$;

COMMENT ON FUNCTION public.can_set_user_photo(uuid, uuid) IS
  'TRUE when _actor may set _target''s profile photo. Students may set NOBODY''S, '
  'including their own. The canonical photo-authority predicate: compose this, '
  'never re-test roles inline.';

REVOKE ALL ON FUNCTION public.can_set_user_photo(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_set_user_photo(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_set_user_photo(uuid, uuid) TO authenticated;

-- Client-facing convenience wrapper: takes auth.uid() itself so callers don't
-- have to pass their own id. This is NOT a containment boundary -- it doesn't
-- stop anything can_set_user_photo(_actor, _target) itself doesn't. That
-- function is GRANTed to authenticated and directly callable as
-- /rest/v1/rpc/can_set_user_photo with any _actor and _target an authenticated
-- client cares to pass; the grant is structurally required because the
-- storage policies below call can_set_user_photo(auth.uid(), ...) directly,
-- not through this wrapper, so it must stay.
CREATE OR REPLACE FUNCTION public.can_i_set_user_photo(_target uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.can_set_user_photo(auth.uid(), _target);
$$;

REVOKE ALL ON FUNCTION public.can_i_set_user_photo(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_i_set_user_photo(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_i_set_user_photo(uuid) TO authenticated;

-- 6. Write RPCs --------------------------------------------------------------
-- Teachers have NO UPDATE policy on profiles at all, so a plain
-- .update({ avatar_path }) is a silent RLS no-op for them. The write must be
-- an RPC.

CREATE OR REPLACE FUNCTION public.set_user_avatar(_target uuid, _path text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _old text;
BEGIN
  IF NOT public.can_set_user_photo(auth.uid(), _target) THEN
    RAISE EXCEPTION 'You do not have permission to change this photo.'
      USING ERRCODE = '42501';
  END IF;

  -- Without this an actor authorised over B could point B's row at an object
  -- inside someone else's folder.
  IF _path IS NULL OR public.avatar_owner_from_path(_path) IS DISTINCT FROM _target THEN
    RAISE EXCEPTION 'That photo does not belong to this user.'
      USING ERRCODE = '22023';
  END IF;

  SELECT avatar_path INTO _old FROM public.profiles WHERE id = _target FOR UPDATE;
  UPDATE public.profiles SET avatar_path = _path, updated_at = now() WHERE id = _target;
  RETURN _old;
END $$;

REVOKE ALL ON FUNCTION public.set_user_avatar(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_user_avatar(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_user_avatar(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.clear_user_avatar(_target uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _old text;
BEGIN
  IF NOT public.can_set_user_photo(auth.uid(), _target) THEN
    RAISE EXCEPTION 'You do not have permission to change this photo.'
      USING ERRCODE = '42501';
  END IF;

  SELECT avatar_path INTO _old FROM public.profiles WHERE id = _target FOR UPDATE;
  UPDATE public.profiles SET avatar_path = NULL, updated_at = now() WHERE id = _target;
  RETURN _old;
END $$;

REVOKE ALL ON FUNCTION public.clear_user_avatar(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.clear_user_avatar(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.clear_user_avatar(uuid) TO authenticated;

-- 7. Trigger -----------------------------------------------------------------
-- FOUR existing policies grant broad profiles UPDATE (school admin
-- institution-wide, coordinator institution-wide, the staff/student manager
-- override, and self). Any of them could bypass can_set_user_photo() with a
-- direct PostgREST update. Both manager-override migrations even warn their
-- policy is safe only because "the app only ever sends full_name + is_active
-- from this surface". This trigger holds regardless of which policy let the
-- row through. It checks BOTH authority (can the actor touch this row at
-- all) AND path ownership (mirroring set_user_avatar()'s own check) --
-- without the second check, an actor with real authority over row B (a
-- school admin or coordinator via one of those four broad policies) could
-- point B's avatar_path at an object inside a DIFFERENT user's storage
-- folder, since only the RPC path, not the direct-UPDATE path, enforced that.

CREATE OR REPLACE FUNCTION public.enforce_avatar_path_authority()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- BEFORE UPDATE OF fires whenever the column is MENTIONED, so compare values.
  IF NEW.avatar_path IS DISTINCT FROM OLD.avatar_path THEN
    IF auth.uid() IS NULL THEN
      RETURN NEW;                      -- service-role / migration context
    END IF;
    IF NOT public.can_set_user_photo(auth.uid(), NEW.id) THEN
      RAISE EXCEPTION 'You do not have permission to change this photo.'
        USING ERRCODE = '42501';
    END IF;

    -- Without this an actor authorised over B could point B's row at an
    -- object inside someone else's folder. Mirrors set_user_avatar().
    IF NEW.avatar_path IS NOT NULL
       AND public.avatar_owner_from_path(NEW.avatar_path) IS DISTINCT FROM NEW.id THEN
      RAISE EXCEPTION 'That photo does not belong to this user.'
        USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.enforce_avatar_path_authority() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_avatar_path_authority() FROM anon;
GRANT EXECUTE ON FUNCTION public.enforce_avatar_path_authority() TO authenticated;

DROP TRIGGER IF EXISTS trg_enforce_avatar_path_authority ON public.profiles;
CREATE TRIGGER trg_enforce_avatar_path_authority
  BEFORE UPDATE OF avatar_path ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_avatar_path_authority();

-- 8. Storage policies --------------------------------------------------------
-- All four verbs. face-photos and message-attachments each shipped with only
-- INSERT + SELECT, which means nobody but service-role can ever replace or
-- remove those objects. Not repeating that.

DROP POLICY IF EXISTS user_avatars_select ON storage.objects;
CREATE POLICY user_avatars_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'user-avatars'
         AND public.can_view_user_photo(public.avatar_owner_from_path(name),
                                        (SELECT auth.uid())));

DROP POLICY IF EXISTS user_avatars_insert ON storage.objects;
CREATE POLICY user_avatars_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'user-avatars'
              AND public.can_set_user_photo((SELECT auth.uid()),
                                            public.avatar_owner_from_path(name)));

DROP POLICY IF EXISTS user_avatars_update ON storage.objects;
CREATE POLICY user_avatars_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'user-avatars'
         AND public.can_set_user_photo((SELECT auth.uid()), public.avatar_owner_from_path(name)))
  WITH CHECK (bucket_id = 'user-avatars'
              AND public.can_set_user_photo((SELECT auth.uid()), public.avatar_owner_from_path(name)));

DROP POLICY IF EXISTS user_avatars_delete ON storage.objects;
CREATE POLICY user_avatars_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'user-avatars'
         AND public.can_set_user_photo((SELECT auth.uid()), public.avatar_owner_from_path(name)));
