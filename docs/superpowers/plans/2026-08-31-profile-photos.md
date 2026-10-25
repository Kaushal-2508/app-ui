# Profile Photos Implementation Plan (Release 1: mechanism)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship role-scoped profile photographs stored in a private bucket with no shareable URL, and remove students' ability to edit their own profile, without breaking teachers, employees, or the forced-password-reset flow.

**Architecture:** One private `user-avatars` bucket. Photos are never signed and never public: the client downloads them through the authenticated endpoint (RLS evaluated per request), caches the bytes on-device in Cache Storage keyed by an immutable path, and renders a tab-local `blob:` URL. Write authority is `can_set_user_photo()`, enforced both at a SECURITY DEFINER RPC and again at a `BEFORE UPDATE OF avatar_path` trigger, because four existing policies already grant broad `profiles` UPDATE and would otherwise bypass it. Student self-edit is removed by *replacing* the role-blind self-update policy and moving two legitimate self-writes to narrow RPCs.

**Tech Stack:** React 18 + TypeScript + Vite, TanStack Query v5, Supabase (Postgres + Storage), shadcn/ui + Tailwind, compressorjs, heic2any.

**Spec:** [docs/superpowers/specs/2026-08-31-profile-photos-design.md](../specs/2026-08-31-profile-photos-design.md)

## Global Constraints

- **No test framework exists in this repo.** Zero `*.test.*` files, no vitest/jest/playwright, no `test` script. Do not invent one. The verification cycle is: SQL assertion scripts for DB tasks, and `npm run typecheck` + `npx eslint <changed-paths>` + `npx vite build` for frontend tasks, plus the explicit manual browser check written into each task.
- **Migrations are applied via the Supabase Management API SQL endpoint, never `supabase db push`.** `supabase_migrations.schema_migrations` is not maintained in this project. Use `scripts/run-sql.ps1`.
- **Every new SECURITY DEFINER function gets `REVOKE ALL ... FROM PUBLIC; REVOKE ALL ... FROM anon; GRANT EXECUTE ... TO authenticated;`** by name. Supabase's `ALTER DEFAULT PRIVILEGES` grants `anon` EXECUTE on every new public function and `REVOKE ... FROM PUBLIC` does not strip it.
- **`prefer-const` and `@typescript-eslint/no-explicit-any` are HARD errors.** Never use `as any`, never add `// eslint-disable-next-line`, never edit `eslint.config.*`.
- **All error toasts go through `toastError(err, { fallback, context })` from `@/lib/toast`.** `toast.success` / `toast.info` from `sonner` for the happy path. Never `toast.error(error.message)`.
- **All Supabase selects use explicit column lists.** No `select("*")`.
- **Every new `useQuery` sets an explicit `staleTime` of at least `60_000`.**
- **RLS policies wrap `auth.uid()` as `(SELECT auth.uid())`** and call SECURITY DEFINER helpers rather than inlining cross-table EXISTS.
- **No em-dash (`—`) in any user-facing string.** Use a comma, a colon, or "to" for ranges.
- Bucket id is exactly `user-avatars`. Cache Storage key is exactly `user-avatars-v1` and **must not** begin with `salci-`, because `src/main.tsx:72` deletes every cache with that prefix.
- Avatar object path is exactly `{user_id}/{uuid}.webp`. One rendition, 256x256 WebP, quality 0.8.

---

## File Structure

**Create:**
- `supabase/migrations/20260831120000_user_avatars.sql` — column, index, bucket, path parser, view/set predicates, RPCs, trigger, storage policies
- `supabase/migrations/20260831120100_profile_self_write_rpcs.sql` — the two carve-out RPCs (additive, safe to deploy early)
- `supabase/migrations/20260831120200_student_profile_lockdown.sql` — replaces the role-blind self-edit policy (breaking; deploy only after the frontend adopts the RPCs)
- `scripts/verify-photo-authority.sql` — seeded, self-asserting, rolls back
- `src/lib/initials.ts` — one initials algorithm for the whole app
- `src/lib/avatarStore.ts` — download, on-device cache, concurrency cap, blob URLs
- `src/lib/avatarImage.ts` — HEIC-aware validate and resize pipeline
- `src/hooks/useSetUserAvatar.ts` — permission query, set and clear mutations
- `src/components/shared/UserAvatar.tsx` — the one avatar component
- `src/components/shared/UserPhotoSheet.tsx` — take photo / upload / remove

**Modify:**
- `src/utils/imageResize.ts` — add an optional `mimeType` that suppresses JPEG auto-conversion
- `src/components/shared/index.ts` — barrel exports
- `src/components/offline-scan/CameraCapture.tsx` — `facingMode` and `filePrefix` props
- `src/components/admin/ViewUserSheet.tsx` — select `avatar_path`, render `UserAvatar`, mount the photo sheet
- `src/pages/ProfilePage.tsx` — render `UserAvatar`, mount the photo sheet, make the form read-only for students
- `src/hooks/useProfileData.ts` — add `avatar_path` to the interface and select, add missing `staleTime`
- `src/pages/PasswordResetRequired.tsx` — call `clear_password_reset_flag()`
- `src/components/onboarding/GuidedTourProvider.tsx` — call `mark_onboarding_complete()`
- `src/integrations/supabase/types.ts` — regenerated
- `src/components/settings/SystemArchitectureDocument.tsx`, `ExpansionPlanDocument.tsx`, `ERPRoadmapDocument.tsx` — correct the false "built" claims

**Deployment ordering hazard (do not reorder Tasks 11 to 13).** Migration `...120200` narrows RLS in prod the moment it is applied, while the frontend deploys separately. If the policy lands before the frontend adopts the carve-out RPCs, every student on a forced password reset is locked out. Order is: create the RPCs (additive) → ship the frontend that uses them → then narrow the policy.

---

## Task 1: Photo database layer

**Files:**
- Create: `supabase/migrations/20260831120000_user_avatars.sql`
- Create: `scripts/verify-photo-authority.sql`

**Interfaces:**
- Consumes: existing `has_role`, `is_super_admin`, `get_user_institution`, `is_coordinator_for_class`, `teacher_controls_student`
- Produces:
  - `public.avatar_owner_from_path(_name text) RETURNS uuid`
  - `public.can_view_user_photo(_target uuid, _viewer uuid) RETURNS boolean`
  - `public.can_set_user_photo(_actor uuid, _target uuid) RETURNS boolean`
  - `public.can_i_set_user_photo(_target uuid) RETURNS boolean`
  - `public.set_user_avatar(_target uuid, _path text) RETURNS text` (returns the previous path)
  - `public.clear_user_avatar(_target uuid) RETURNS text` (returns the previous path)
  - `public.profiles.avatar_path TEXT`
  - bucket `user-avatars`

- [ ] **Step 1: Confirm the drop of `avatar_url` is safe**

Run via `scripts/run-sql.ps1`:

```sql
SELECT count(*) AS non_null_avatar_url FROM public.profiles WHERE avatar_url IS NOT NULL;
SELECT id, public, file_size_limit FROM storage.buckets WHERE id = 'user-avatars';
```

Expected: `non_null_avatar_url = 0`, and zero rows for the bucket.

**If `non_null_avatar_url > 0`, STOP.** Do not drop the column. Report the count and ask before continuing; the plan assumes the column has never been written.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/20260831120000_user_avatars.sql`:

```sql
-- Profile photographs: private storage, role-scoped writes.
--
-- profiles.avatar_url has existed since 20260104113057 and has NEVER been
-- written by anything. It is replaced by avatar_path, which holds a STORAGE
-- PATH, not a URL: photos are never signed and never public. Clients download
-- them through the authenticated endpoint so RLS is evaluated on every fetch.

-- 1. Column ------------------------------------------------------------------

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_path TEXT;

COMMENT ON COLUMN public.profiles.avatar_path IS
  'Immutable object path in the PRIVATE user-avatars bucket: {user_id}/{uuid}.webp. '
  'NOT a URL and never signed. Fetched via the authenticated download endpoint and '
  'cached on-device (src/lib/avatarStore.ts). Writes are gated by can_set_user_photo() '
  'at BOTH set_user_avatar() and the trg_enforce_avatar_path_authority trigger.';

ALTER TABLE public.profiles DROP COLUMN IF EXISTS avatar_url;

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

-- Client-facing wrapper: takes auth.uid() itself so the browser cannot probe
-- another actor's permissions.
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
-- row through.

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
  END IF;
  RETURN NEW;
END $$;

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
```

- [ ] **Step 3: Write the authority assertion suite**

Create `scripts/verify-photo-authority.sql`. It seeds fixtures, asserts every
permission cell, and rolls back, so it leaves no data behind and can be re-run.

```sql
-- Authority matrix for can_set_user_photo(). Seeds fixtures, asserts, rolls back.
-- Run via scripts/run-sql.ps1. Any failed cell raises and aborts.
BEGIN;

DO $suite$
DECLARE
  v_inst      uuid := gen_random_uuid();
  v_wing      uuid := gen_random_uuid();
  v_cls_in    uuid := gen_random_uuid();   -- class inside the coordinator's wing
  v_cls_out   uuid := gen_random_uuid();   -- class outside it
  v_subj      uuid := gen_random_uuid();
  v_sadmin    uuid := gen_random_uuid();
  v_coord     uuid := gen_random_uuid();
  v_coord2    uuid := gen_random_uuid();
  v_teach     uuid := gen_random_uuid();   -- teaches v_subj in v_cls_in
  v_teach2    uuid := gen_random_uuid();   -- teaches v_cls_out only
  v_stu_in    uuid := gen_random_uuid();   -- student of v_cls_in
  v_stu_out   uuid := gen_random_uuid();   -- student of v_cls_out
  v_fails     int  := 0;
  r           record;
BEGIN
  -- ---- fixtures ----
  INSERT INTO public.institutions (id, name, code) VALUES (v_inst, 'ZZ Test Inst', 'ZZTEST');

  INSERT INTO public.profiles (id, full_name, email, institution_id) VALUES
    (v_sadmin, 'ZZ Admin',   'zz.admin@test.invalid',  v_inst),
    (v_coord,  'ZZ Coord',   'zz.coord@test.invalid',  v_inst),
    (v_coord2, 'ZZ Coord 2', 'zz.coord2@test.invalid', v_inst),
    (v_teach,  'ZZ Teacher', 'zz.teach@test.invalid',  v_inst),
    (v_teach2, 'ZZ Teach 2', 'zz.teach2@test.invalid', v_inst),
    (v_stu_in, 'ZZ Stu In',  'zz.stuin@test.invalid',  v_inst),
    (v_stu_out,'ZZ Stu Out', 'zz.stuout@test.invalid', v_inst);

  INSERT INTO public.user_roles (user_id, role, institution_id) VALUES
    (v_sadmin, 'school_admin', v_inst),
    (v_coord,  'coordinator',  v_inst),
    (v_coord2, 'coordinator',  v_inst),
    (v_teach,  'teacher',      v_inst),
    (v_teach2, 'teacher',      v_inst),
    (v_stu_in, 'student',      v_inst),
    (v_stu_out,'student',      v_inst);

  INSERT INTO public.classes (id, institution_id, name, section, academic_year)
  VALUES (v_cls_in,  v_inst, 'ZZ Class A', 'A', '2026-27'),
         (v_cls_out, v_inst, 'ZZ Class B', 'B', '2026-27');

  INSERT INTO public.subjects (id, institution_id, name)
  VALUES (v_subj, v_inst, 'ZZ Subject');

  INSERT INTO public.subject_class_mappings (subject_id, class_id, is_optional)
  VALUES (v_subj, v_cls_in, false);

  INSERT INTO public.wings (id, institution_id, name) VALUES (v_wing, v_inst, 'ZZ Wing');
  INSERT INTO public.wing_assignments (wing_id, user_id) VALUES (v_wing, v_coord);
  INSERT INTO public.wing_class_mappings (wing_id, class_id) VALUES (v_wing, v_cls_in);

  INSERT INTO public.class_assignments (user_id, class_id, subject_id, role) VALUES
    (v_stu_in,  v_cls_in,  NULL,   'student'),
    (v_stu_out, v_cls_out, NULL,   'student'),
    (v_teach,   v_cls_in,  v_subj, 'teacher'),
    (v_teach2,  v_cls_out, v_subj, 'teacher');

  -- ---- assertions ----
  -- Each row: actor, target, expected. Every mismatch is counted and reported.
  FOR r IN
      SELECT * FROM (VALUES
        -- school admin reaches everyone in the institution
        (v_sadmin,  v_stu_in,  true,  'school_admin -> student in wing'),
        (v_sadmin,  v_stu_out, true,  'school_admin -> student out of wing'),
        (v_sadmin,  v_coord,   true,  'school_admin -> coordinator'),
        (v_sadmin,  v_sadmin,  true,  'school_admin -> self'),
        -- coordinator is wing-scoped, and never touches peers or admins
        (v_coord,   v_stu_in,  true,  'coordinator -> student IN wing'),
        (v_coord,   v_stu_out, false, 'coordinator -> student OUT of wing'),
        (v_coord,   v_teach,   true,  'coordinator -> teacher of wing class'),
        (v_coord,   v_teach2,  false, 'coordinator -> teacher outside wing'),
        (v_coord,   v_coord2,  false, 'coordinator -> PEER coordinator'),
        (v_coord,   v_sadmin,  false, 'coordinator -> school admin'),
        (v_coord,   v_coord,   true,  'coordinator -> self'),
        -- teacher reaches only their own subject students
        (v_teach,   v_stu_in,  true,  'teacher -> own subject student'),
        (v_teach,   v_stu_out, false, 'teacher -> student they do not teach'),
        (v_teach,   v_teach2,  false, 'teacher -> another teacher'),
        (v_teach,   v_coord,   false, 'teacher -> coordinator'),
        (v_teach,   v_teach,   true,  'teacher -> self'),
        -- students reach nobody, INCLUDING themselves
        (v_stu_in,  v_stu_in,  false, 'student -> SELF'),
        (v_stu_in,  v_stu_out, false, 'student -> another student'),
        (v_stu_in,  v_teach,   false, 'student -> teacher')
      ) AS t(actor uuid, target uuid, expected boolean, label text)
  LOOP
    IF public.can_set_user_photo(r.actor, r.target) IS DISTINCT FROM r.expected THEN
      v_fails := v_fails + 1;
      RAISE WARNING 'FAIL: % (expected %)', r.label, r.expected;
    ELSE
      RAISE NOTICE 'ok: %', r.label;
    END IF;
  END LOOP;

  -- ---- the trigger, not just the predicate ----
  -- This is the control that closes the FOUR broad profiles-UPDATE policies.
  -- The RPC being correct proves nothing about a direct PostgREST write, so
  -- impersonate a caller (auth.uid() reads request.jwt.claims->>'sub') and
  -- attempt the update the RPC is meant to make impossible.

  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', v_stu_in::text, 'role', 'authenticated')::text,
                     true);
  BEGIN
    UPDATE public.profiles SET avatar_path = v_stu_in::text || '/x.webp' WHERE id = v_stu_in;
    v_fails := v_fails + 1;
    RAISE WARNING 'FAIL: trigger allowed a STUDENT to set their own photo directly';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok: trigger blocked direct student self-write';
  END;

  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', v_coord::text, 'role', 'authenticated')::text,
                     true);
  BEGIN
    UPDATE public.profiles SET avatar_path = v_stu_out::text || '/x.webp' WHERE id = v_stu_out;
    v_fails := v_fails + 1;
    RAISE WARNING 'FAIL: trigger allowed a COORDINATOR to reach outside their wing';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok: trigger blocked out-of-wing coordinator write';
  END;

  -- ...and confirm the happy path still passes the trigger.
  BEGIN
    UPDATE public.profiles SET avatar_path = v_stu_in::text || '/y.webp' WHERE id = v_stu_in;
    RAISE NOTICE 'ok: trigger allowed in-wing coordinator write';
  EXCEPTION WHEN insufficient_privilege THEN
    v_fails := v_fails + 1;
    RAISE WARNING 'FAIL: trigger blocked a LEGITIMATE in-wing coordinator write';
  END;

  PERFORM set_config('request.jwt.claims', NULL, true);

  -- path parser
  IF public.avatar_owner_from_path(v_stu_in::text || '/abc.webp') IS DISTINCT FROM v_stu_in THEN
    v_fails := v_fails + 1; RAISE WARNING 'FAIL: avatar_owner_from_path happy path';
  END IF;
  IF public.avatar_owner_from_path('not-a-uuid/x.webp') IS NOT NULL THEN
    v_fails := v_fails + 1; RAISE WARNING 'FAIL: avatar_owner_from_path should return NULL on garbage';
  END IF;
  IF public.avatar_owner_from_path(NULL) IS NOT NULL THEN
    v_fails := v_fails + 1; RAISE WARNING 'FAIL: avatar_owner_from_path should return NULL on NULL';
  END IF;

  -- view gate
  IF NOT public.can_view_user_photo(v_stu_in, v_teach) THEN
    v_fails := v_fails + 1; RAISE WARNING 'FAIL: same-institution view should be allowed';
  END IF;

  IF v_fails > 0 THEN
    RAISE EXCEPTION '% assertion(s) FAILED', v_fails;
  END IF;
  RAISE NOTICE 'ALL PHOTO AUTHORITY ASSERTIONS PASSED';
END $suite$;

ROLLBACK;
```

If the fixture INSERTs fail because `institutions`, `classes` or `subjects` have
NOT NULL columns not listed here, add the missing columns with dummy values.
Read the table definitions first rather than guessing.

- [ ] **Step 4: Run the assertion suite BEFORE applying the migration**

Run: `pwsh scripts/run-sql.ps1 -File scripts/verify-photo-authority.sql`
Expected: **FAILS** with `function public.can_set_user_photo(uuid, uuid) does not exist`.

This proves the suite is actually exercising the new code and not silently passing.

- [ ] **Step 5: Apply the migration**

Run: `pwsh scripts/run-sql.ps1 -File supabase/migrations/20260831120000_user_avatars.sql`
Expected: success, no error body.

- [ ] **Step 6: Run the assertion suite again**

Run: `pwsh scripts/run-sql.ps1 -File scripts/verify-photo-authority.sql`
Expected: `ALL PHOTO AUTHORITY ASSERTIONS PASSED`, and every cell printed as `ok:`.

If any cell fails, fix `can_set_user_photo` and re-run. Do not proceed with a failing cell.

- [ ] **Step 7: Verify anon holds no EXECUTE**

```sql
SELECT routine_name, grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
  AND routine_name IN ('avatar_owner_from_path','can_view_user_photo','can_set_user_photo',
                       'can_i_set_user_photo','set_user_avatar','clear_user_avatar',
                       'enforce_avatar_path_authority')
ORDER BY routine_name, grantee;
```

Expected: no row where `grantee = 'anon'`.

- [ ] **Step 8: Verify the bucket and its policies**

```sql
SELECT id, public, file_size_limit, allowed_mime_types FROM storage.buckets WHERE id = 'user-avatars';
SELECT policyname, cmd FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'user_avatars%'
ORDER BY policyname;
```

Expected: bucket `public = false`, limit `2097152`; four policies, one each for SELECT, INSERT, UPDATE, DELETE.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/20260831120000_user_avatars.sql scripts/verify-photo-authority.sql
git commit -m "feat(photos): private user-avatars bucket, can_set_user_photo, write RPCs and trigger"
```

---

## Task 2: Regenerate types and add the shared initials helper

**Files:**
- Modify: `src/integrations/supabase/types.ts` (regenerated)
- Create: `src/lib/initials.ts`

**Interfaces:**
- Consumes: Task 1's `avatar_path` column and RPC signatures
- Produces: `getInitials(name?: string | null, email?: string | null): string`

- [ ] **Step 1: Regenerate Supabase types**

Run: `npx supabase gen types typescript --project-id gyymkgohcijeksmrzuyw > src/integrations/supabase/types.ts`

- [ ] **Step 2: Confirm the new surface landed**

Run: `npx tsc -p tsconfig.app.json --noEmit`
Then confirm by grep that `avatar_path`, `can_i_set_user_photo`, `set_user_avatar` and `clear_user_avatar` all appear in `src/integrations/supabase/types.ts`, and that `avatar_url` no longer appears in the `profiles` Row block.

Expected: typecheck reports errors **only** in the three files that still read `avatar_url` (`src/hooks/useBadgeLeaderboard.ts`, `src/hooks/useStaffHR.ts`, `src/hooks/useComprehensiveStudentAnalytics.ts`). Those are fixed in Step 3.

- [ ] **Step 3: Repoint the three existing readers**

In `src/hooks/useStaffHR.ts` lines 17 and 35, and `src/hooks/useComprehensiveStudentAnalytics.ts` line 129, replace `avatar_url` with `avatar_path` in the select strings. At `useComprehensiveStudentAnalytics.ts:207` change `photo: profile.avatar_url || undefined` to `photo: profile.avatar_path || undefined`.

`src/hooks/useBadgeLeaderboard.ts` reads the `badge_leaderboard` RPC's output, so it cannot be fixed here. Apply this migration to keep it compiling:

```sql
-- badge_leaderboard projected profiles.avatar_url, which no longer exists.
CREATE OR REPLACE FUNCTION public.badge_leaderboard(/* keep the existing arg list verbatim */)
-- ... keep the existing body, changing ONLY `p.avatar_url` to `p.avatar_path`
-- and the RETURNS TABLE column name from avatar_url to avatar_path.
```

Read `supabase/migrations/20260727120000_badge_leaderboard_rpc.sql` first and copy its
signature and body exactly, changing only those two references. Save it as
`supabase/migrations/20260831120010_badge_leaderboard_avatar_path.sql` and apply it,
then regenerate types again and update `useBadgeLeaderboard.ts:49,71` to read `avatarPath`.

- [ ] **Step 4: Create the initials helper**

Create `src/lib/initials.ts`:

```ts
/**
 * The single initials algorithm for the whole app.
 *
 * Before this existed the logic was reimplemented ~14 times with three
 * different behaviours, so "Chetan Sharma" rendered as "CS" in AppSidebar but
 * "CH" in ViewUserSheet. Every avatar surface must call this.
 */
export function getInitials(name?: string | null, email?: string | null): string {
  const trimmed = (name ?? "").trim();
  if (trimmed) {
    const words = trimmed.split(/\s+/).filter(Boolean);
    if (words.length >= 2) {
      return (words[0].charAt(0) + words[words.length - 1].charAt(0)).toUpperCase();
    }
    return words[0].slice(0, 2).toUpperCase();
  }
  const mail = (email ?? "").trim();
  if (mail) return mail.slice(0, 2).toUpperCase();
  return "?";
}
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck`
Expected: exit 0.

Run: `npx eslint src/lib/initials.ts src/hooks/useStaffHR.ts src/hooks/useComprehensiveStudentAnalytics.ts src/hooks/useBadgeLeaderboard.ts`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/integrations/supabase/types.ts src/lib/initials.ts src/hooks/useStaffHR.ts src/hooks/useComprehensiveStudentAnalytics.ts src/hooks/useBadgeLeaderboard.ts supabase/migrations/20260831120010_badge_leaderboard_avatar_path.sql
git commit -m "feat(photos): regen types for avatar_path, add shared getInitials"
```

---

## Task 3: The on-device photo store

**Files:**
- Create: `src/lib/avatarStore.ts`

**Interfaces:**
- Consumes: `supabase` client
- Produces:
  - `getAvatarObjectUrl(path: string): Promise<string | null>`
  - `forgetAvatar(path: string): Promise<void>`

- [ ] **Step 1: Create the store**

Create `src/lib/avatarStore.ts`:

```ts
import { supabase } from "@/integrations/supabase/client";

const BUCKET = "user-avatars";

/**
 * MUST NOT start with "salci-": src/main.tsx:72 deletes every Cache Storage key
 * with that prefix on dev boot, which would wipe the photo cache constantly.
 */
const CACHE_NAME = "user-avatars-v1";

/**
 * Photo fetches must never compete with the page's own data queries. Object
 * paths are immutable, so a cached entry is never stale and a cache hit costs
 * no slot at all.
 */
const MAX_IN_FLIGHT = 6;

const objectUrls = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();
const waiting: Array<() => void> = [];
let active = 0;

function acquire(): Promise<void> {
  if (active < MAX_IN_FLIGHT) {
    active += 1;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => { waiting.push(resolve); });
}

function release(): void {
  const next = waiting.shift();
  // Hand the slot straight on rather than decrementing and re-incrementing.
  if (next) { next(); return; }
  active -= 1;
}

function cacheKeyFor(path: string): string {
  return `/__avatar/${path}`;
}

async function readFromCache(path: string): Promise<Blob | null> {
  if (typeof caches === "undefined") return null;
  try {
    const cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(cacheKeyFor(path));
    return hit ? await hit.blob() : null;
  } catch {
    return null;
  }
}

async function writeToCache(path: string, blob: Blob): Promise<void> {
  if (typeof caches === "undefined") return;
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(cacheKeyFor(path), new Response(blob));
  } catch {
    // Quota exceeded or private mode. The in-memory map still serves this session.
  }
}

async function load(path: string): Promise<string | null> {
  let blob = await readFromCache(path);

  if (!blob) {
    await acquire();
    try {
      // The authenticated endpoint: RLS is evaluated on every single fetch and
      // no shareable URL is ever produced.
      const { data, error } = await supabase.storage.from(BUCKET).download(path);
      if (error || !data) return null;
      blob = data;
      void writeToCache(path, blob);
    } finally {
      release();
    }
  }

  const url = URL.createObjectURL(blob);
  objectUrls.set(path, url);
  return url;
}

/**
 * Resolve a photo to a tab-local blob: URL. A blob: URL cannot be shared: paste
 * it anywhere else and it resolves to nothing, and it dies on reload.
 *
 * Returns null on any failure so the caller falls back to initials. Never throws.
 */
export function getAvatarObjectUrl(path: string): Promise<string | null> {
  const existing = objectUrls.get(path);
  if (existing) return Promise.resolve(existing);

  const pending = inflight.get(path);
  if (pending) return pending;

  const promise = load(path)
    .catch(() => null)
    .finally(() => { inflight.delete(path); });

  inflight.set(path, promise);
  return promise;
}

/** Drop a photo from every layer. Call after replacing or removing one. */
export async function forgetAvatar(path: string): Promise<void> {
  const url = objectUrls.get(path);
  if (url) {
    URL.revokeObjectURL(url);
    objectUrls.delete(path);
  }
  inflight.delete(path);
  if (typeof caches === "undefined") return;
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.delete(cacheKeyFor(path));
  } catch {
    // Nothing to clean up.
  }
}
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck`
Expected: exit 0.

Run: `npx eslint src/lib/avatarStore.ts`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/avatarStore.ts
git commit -m "feat(photos): on-device avatar store with authenticated fetch and 6-slot cap"
```

---

## Task 4: The UserAvatar component

**Files:**
- Create: `src/components/shared/UserAvatar.tsx`
- Modify: `src/components/shared/index.ts`

**Interfaces:**
- Consumes: `getAvatarObjectUrl` (Task 3), `getInitials` (Task 2)
- Produces: `UserAvatar` and `UserAvatarProps` with fields `name`, `email`, `avatarPath`, `className`, `fallbackClassName`

- [ ] **Step 1: Create the component**

Create `src/components/shared/UserAvatar.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getAvatarObjectUrl } from "@/lib/avatarStore";
import { getInitials } from "@/lib/initials";
import { cn } from "@/lib/utils";

export interface UserAvatarProps {
  name?: string | null;
  email?: string | null;
  /** profiles.avatar_path. Null or unresolved renders initials, exactly as before photos existed. */
  avatarPath?: string | null;
  className?: string;
  fallbackClassName?: string;
}

/**
 * The one avatar component. Fetches the photo only once it is on screen, so a
 * 40-row page costs the ~10 visible rows rather than 40, and degrades to
 * initials on any failure.
 */
export function UserAvatar({
  name,
  email,
  avatarPath,
  className,
  fallbackClassName,
}: UserAvatarProps) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (visible) return;
    const el = rootRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
      },
      { rootMargin: "100px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    setUrl(null);
    if (!visible || !avatarPath) return;
    let cancelled = false;
    void getAvatarObjectUrl(avatarPath).then((resolved) => {
      if (!cancelled) setUrl(resolved);
    });
    return () => { cancelled = true; };
  }, [visible, avatarPath]);

  return (
    <Avatar ref={rootRef} className={className}>
      {url ? <AvatarImage src={url} alt={name ?? ""} /> : null}
      <AvatarFallback className={cn(fallbackClassName)}>
        {getInitials(name, email)}
      </AvatarFallback>
    </Avatar>
  );
}
```

- [ ] **Step 2: Export from the barrel**

In `src/components/shared/index.ts`, add alongside the other exports:

```ts
export { UserAvatar } from "./UserAvatar";
export type { UserAvatarProps } from "./UserAvatar";
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck`
Expected: exit 0.

Run: `npx eslint src/components/shared/UserAvatar.tsx src/components/shared/index.ts`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/components/shared/UserAvatar.tsx src/components/shared/index.ts
git commit -m "feat(photos): UserAvatar with viewport-gated fetch and shared initials"
```

---

## Task 5: WebP output and the avatar image pipeline

**Files:**
- Modify: `src/utils/imageResize.ts`
- Create: `src/lib/avatarImage.ts`

**Interfaces:**
- Consumes: `resizeImageForUpload` (extended here)
- Produces:
  - `resizeImageForUpload(file, { maxWidth?, maxHeight?, quality?, mimeType? })`
  - `prepareAvatarFile(file: File): Promise<File>`
  - `AvatarValidationError`

- [ ] **Step 1: Add the mimeType option**

The helper currently cannot emit WebP. Its hardcoded
`convertTypes: ["image/png", "image/webp"]` plus `convertSize: 100000` transcode
WebP input **to JPEG**, the opposite of what avatars need.

In `src/utils/imageResize.ts`, replace the body of `resizeImageForUpload` with:

```ts
export const resizeImageForUpload = (
  file: File,
  options?: {
    maxWidth?: number;
    maxHeight?: number;
    quality?: number;
    /**
     * Force an output format, e.g. "image/webp". When set, the JPEG
     * auto-conversion is suppressed so the requested type survives.
     */
    mimeType?: string;
  }
): Promise<File> => {
  const { maxWidth = 300, maxHeight = 300, quality = 0.8, mimeType } = options || {};

  return new Promise((resolve, reject) => {
    const format: Compressor.Options = mimeType
      ? { mimeType }
      : { convertTypes: ["image/png", "image/webp"], convertSize: 100000 };

    new Compressor(file, {
      width: maxWidth,
      height: maxHeight,
      quality,
      resize: "cover", // Ensures the image fills the box and crops excess
      ...format,
      success(result) {
        const resizedFile = new File([result], file.name, {
          type: result.type,
          lastModified: Date.now(),
        });
        resolve(resizedFile);
      },
      error(err) {
        console.error("Image compression error:", err);
        reject(err);
      },
    });
  });
};
```

If `Compressor.Options` is not exported by the package's types, type `format` as
`Partial<Compressor.Options>`; if that also fails, declare a local
`type CompressorFormat = { mimeType: string } | { convertTypes: string[]; convertSize: number };`
and use that. **Do not** reach for `any`.

- [ ] **Step 2: Create the avatar pipeline**

Create `src/lib/avatarImage.ts`:

```ts
import { resizeImageForUpload } from "@/utils/imageResize";

/** Rejected before any upload, so a huge file never leaves the device. */
export const AVATAR_MAX_INPUT_BYTES = 10 * 1024 * 1024;

const AVATAR_EDGE = 256;
const HEIC_MIME = ["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"];

/** Validation failures the user can fix. Short and non-technical, so
 *  isLikelyUserFriendly() in errorMessages.ts passes them straight through. */
export class AvatarValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AvatarValidationError";
  }
}

/**
 * iOS routinely reports an EMPTY mime type for HEIC photos, so a plain
 * `type.startsWith("image/")` guard rejects genuine iPhone pictures. Fall back
 * to the filename, exactly as src/lib/hybridImage.ts already does.
 */
function isHeic(file: File): boolean {
  const type = (file.type ?? "").toLowerCase();
  if (HEIC_MIME.includes(type)) return true;
  const name = (file.name ?? "").toLowerCase();
  return name.endsWith(".heic") || name.endsWith(".heif");
}

function looksLikeImage(file: File): boolean {
  return isHeic(file) || (file.type ?? "").toLowerCase().startsWith("image/");
}

/**
 * Validate, convert HEIC, and resize to a 256x256 WebP of roughly 10 KB.
 * compressorjs draws to a canvas and cannot decode HEIC in most browsers, so
 * the conversion must happen first.
 */
export async function prepareAvatarFile(file: File): Promise<File> {
  if (!looksLikeImage(file)) {
    throw new AvatarValidationError("That file isn't a picture. Choose a JPG, PNG, WebP or HEIC image.");
  }
  if (file.size > AVATAR_MAX_INPUT_BYTES) {
    throw new AvatarValidationError("That picture is too large. Choose one under 10 MB.");
  }

  let source = file;
  if (isHeic(file)) {
    // heic2any is roughly 1.5 MB. Keep it out of the main bundle.
    const { default: heic2any } = await import("heic2any");
    const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.92 });
    const blob = Array.isArray(converted) ? converted[0] : converted;
    source = new File([blob], "photo.jpg", { type: "image/jpeg" });
  }

  return resizeImageForUpload(source, {
    maxWidth: AVATAR_EDGE,
    maxHeight: AVATAR_EDGE,
    quality: 0.8,
    mimeType: "image/webp",
  });
}
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck`
Expected: exit 0.

Run: `npx eslint src/utils/imageResize.ts src/lib/avatarImage.ts src/components/ui/question-image-upload.tsx`
Expected: exit 0. `question-image-upload.tsx` omits `mimeType` and must be unaffected.

Run: `npx vite build`
Expected: exit 0, and `heic2any` appears as its **own** chunk, not inside the entry bundle.

- [ ] **Step 4: Commit**

```bash
git add src/utils/imageResize.ts src/lib/avatarImage.ts
git commit -m "feat(photos): WebP output option and HEIC-aware avatar image pipeline"
```

---

## Task 6: The photo mutation hooks

**Files:**
- Create: `src/hooks/useSetUserAvatar.ts`

**Interfaces:**
- Consumes: `prepareAvatarFile` (Task 5), `forgetAvatar` (Task 3), Task 1's RPCs
- Produces:
  - `useCanSetUserPhoto(targetId?: string | null)` returning a `UseQueryResult<boolean>`
  - `useSetUserAvatar()` taking `{ targetId, targetName?, institutionId?, file }`
  - `useClearUserAvatar()` taking `{ targetId, targetName?, institutionId? }`

- [ ] **Step 1: Create the hooks**

Create `src/hooks/useSetUserAvatar.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/toast";
import { logActivityEvent } from "@/lib/activityLog";
import { forgetAvatar } from "@/lib/avatarStore";
import { prepareAvatarFile } from "@/lib/avatarImage";

const BUCKET = "user-avatars";

interface AvatarTarget {
  targetId: string;
  targetName?: string | null;
  institutionId?: string | null;
}

interface SetAvatarInput extends AvatarTarget {
  file: File;
}

/** Server-authoritative. The client flag is only a UX affordance; the RPC and
 *  the trg_enforce_avatar_path_authority trigger are the real gates. */
export function useCanSetUserPhoto(targetId?: string | null) {
  return useQuery({
    queryKey: ["can-set-user-photo", targetId],
    enabled: !!targetId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase.rpc("can_i_set_user_photo", {
        _target: targetId as string,
      });
      if (error) throw error;
      return data === true;
    },
  });
}

async function removeQuietly(path: string): Promise<void> {
  try {
    await supabase.storage.from(BUCKET).remove([path]);
  } catch {
    // Best effort. An orphaned object costs ~10 KB and nothing else.
  }
}

function invalidateAvatarQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  targetId: string,
): void {
  queryClient.invalidateQueries({ queryKey: ["user-details", targetId] });
  queryClient.invalidateQueries({ queryKey: ["profile-data"] });
  queryClient.invalidateQueries({ queryKey: ["school-students"] });
  queryClient.invalidateQueries({ queryKey: ["can-set-user-photo", targetId] });
}

export function useSetUserAvatar() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ targetId, file }: SetAvatarInput) => {
      const prepared = await prepareAvatarFile(file);

      // A fresh uuid per upload keeps every object immutable, which is what lets
      // the on-device cache never go stale and needs no cache-busting.
      const path = `${targetId}/${crypto.randomUUID()}.webp`;

      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(path, prepared, {
          contentType: "image/webp",
          cacheControl: "31536000",
          upsert: false,
        });
      if (uploadError) throw uploadError;

      const { data: previousPath, error: rpcError } = await supabase.rpc("set_user_avatar", {
        _target: targetId,
        _path: path,
      });

      if (rpcError) {
        // Never leave an orphan behind a failed write.
        await removeQuietly(path);
        throw rpcError;
      }

      return { path, previousPath: (previousPath as string | null) ?? null };
    },

    onSuccess: async (result, input) => {
      if (result.previousPath) {
        await forgetAvatar(result.previousPath);
        await removeQuietly(result.previousPath);
      }
      invalidateAvatarQueries(queryClient, input.targetId);
      toast.success("Photo updated");
      void logActivityEvent({
        action: "user_photo_updated",
        entityType: "User",
        entityId: input.targetId,
        entityName: input.targetName ?? null,
        // School admins read system_audit_logs by metadata->>'institution_id',
        // so omitting this hides the row from every admin who is not the actor.
        metadata: { institution_id: input.institutionId ?? null },
      });
    },

    onError: (e: Error) =>
      toastError(e, { fallback: "Couldn't update the photo.", context: "setUserAvatar" }),
  });
}

export function useClearUserAvatar() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ targetId }: AvatarTarget) => {
      const { data: previousPath, error } = await supabase.rpc("clear_user_avatar", {
        _target: targetId,
      });
      if (error) throw error;
      return { previousPath: (previousPath as string | null) ?? null };
    },

    onSuccess: async (result, input) => {
      if (result.previousPath) {
        await forgetAvatar(result.previousPath);
        await removeQuietly(result.previousPath);
      }
      invalidateAvatarQueries(queryClient, input.targetId);
      toast.success("Photo removed");
      void logActivityEvent({
        action: "user_photo_removed",
        entityType: "User",
        entityId: input.targetId,
        entityName: input.targetName ?? null,
        metadata: { institution_id: input.institutionId ?? null },
      });
    },

    onError: (e: Error) =>
      toastError(e, { fallback: "Couldn't remove the photo.", context: "clearUserAvatar" }),
  });
}
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck`
Expected: exit 0.

Run: `npx eslint src/hooks/useSetUserAvatar.ts`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useSetUserAvatar.ts
git commit -m "feat(photos): set, clear and permission hooks with orphan cleanup"
```

---

## Task 7: Make CameraCapture reusable for selfies

**Files:**
- Modify: `src/components/offline-scan/CameraCapture.tsx`

**Interfaces:**
- Produces: `CameraCaptureProps` gains `facingMode?: "user" | "environment"` and `filePrefix?: string`

- [ ] **Step 1: Add the props**

`CameraCapture` was written for photographing answer sheets: it hardcodes
`facingMode: "environment"` at line 19 and names files `sheet_${Date.now()}.jpg`
at line 97. Both defaults must be preserved for existing consumers.

In `src/components/offline-scan/CameraCapture.tsx`, change the props interface to:

```ts
interface CameraCaptureProps {
  onCapture: (file: File) => void;
  onClose: () => void;
  /** Which camera to open first. Defaults to the rear camera, which is what the
   *  answer-sheet consumers want. Pass "user" for a selfie. */
  facingMode?: "user" | "environment";
  /** Filename prefix for the produced File. Defaults to "sheet". */
  filePrefix?: string;
}
```

Change the component signature to destructure them with those defaults:

```tsx
export function CameraCapture({
  onCapture,
  onClose,
  facingMode: initialFacingMode = "environment",
  filePrefix = "sheet",
}: CameraCaptureProps) {
```

Change the state initialiser at line 19 from the hardcoded literal to
`useState<"user" | "environment">(initialFacingMode)`, and the filename at line 97
from `` `sheet_${Date.now()}.jpg` `` to `` `${filePrefix}_${Date.now()}.jpg` ``.

- [ ] **Step 2: Add the insecure-context guard**

`getUserMedia` is undefined on `http://` hosts and throws an opaque error.
`HybridCameraGate.tsx:46-50` already guards this. Add the same check at the top
of `startCamera`, before the `getUserMedia` call:

```ts
const media = navigator.mediaDevices;
if (!media?.getUserMedia) {
  setHasPermission(false);
  setIsLoading(false);
  toast.error("This browser can't open the camera here. Try uploading a picture instead.");
  return;
}
```

- [ ] **Step 3: Verify existing consumers still compile**

Run: `npm run typecheck`
Expected: exit 0. `HybridUploadPage.tsx:262` and any other consumer pass neither
new prop and must keep the rear camera and the `sheet_` prefix.

Run: `npx eslint src/components/offline-scan/CameraCapture.tsx`
Expected: exit 0.

- [ ] **Step 4: Manual check**

Run `npm run dev`, open the offline scan flow, and confirm the camera still opens
on the **rear** camera and the captured file is still named `sheet_<timestamp>.jpg`.

- [ ] **Step 5: Commit**

```bash
git add src/components/offline-scan/CameraCapture.tsx
git commit -m "feat(photos): parameterise CameraCapture facing mode and filename prefix"
```

---

## Task 8: The photo sheet

**Files:**
- Create: `src/components/shared/UserPhotoSheet.tsx`
- Modify: `src/components/shared/index.ts`

**Interfaces:**
- Consumes: `useSetUserAvatar`, `useClearUserAvatar` (Task 6), `CameraCapture` (Task 7), `UserAvatar` (Task 4), `MobileSheet`
- Produces: `UserPhotoSheet` with props `open`, `onOpenChange`, `targetId`, `targetName`, `targetEmail`, `institutionId`, `currentPath`

- [ ] **Step 1: Create the sheet**

Create `src/components/shared/UserPhotoSheet.tsx`:

```tsx
import { useRef, useState } from "react";
import { Camera, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MobileSheet } from "@/components/shared/sheets/MobileSheet";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { CameraCapture } from "@/components/offline-scan/CameraCapture";
import { useClearUserAvatar, useSetUserAvatar } from "@/hooks/useSetUserAvatar";

export interface UserPhotoSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetId: string;
  targetName?: string | null;
  targetEmail?: string | null;
  institutionId?: string | null;
  currentPath?: string | null;
}

/**
 * placement="center" is required, not cosmetic: MobileSheet's bottom placement
 * is hardcoded bg-white and does not flip in dark mode (a documented
 * pre-existing bug shared by 20+ consumers).
 */
export function UserPhotoSheet({
  open,
  onOpenChange,
  targetId,
  targetName,
  targetEmail,
  institutionId,
  currentPath,
}: UserPhotoSheetProps) {
  const [showCamera, setShowCamera] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const setAvatar = useSetUserAvatar();
  const clearAvatar = useClearUserAvatar();
  const busy = setAvatar.isPending || clearAvatar.isPending;

  const handleFile = (file: File) => {
    setShowCamera(false);
    setAvatar.mutate(
      { targetId, targetName, institutionId, file },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // so picking the same file again still fires
    if (file) handleFile(file);
  };

  return (
    <MobileSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Profile photo"
      subtitle={targetName ?? undefined}
      placement="center"
    >
      <div className="flex flex-col gap-6 py-2">
        {showCamera ? (
          <CameraCapture
            onCapture={handleFile}
            onClose={() => setShowCamera(false)}
            facingMode="user"
            filePrefix="avatar"
          />
        ) : (
          <>
            <div className="flex justify-center">
              <UserAvatar
                name={targetName}
                email={targetEmail}
                avatarPath={currentPath}
                className="h-24 w-24"
                fallbackClassName="text-2xl"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Button
                type="button"
                className="h-16"
                disabled={busy}
                onClick={() => setShowCamera(true)}
              >
                <Camera className="mr-2 h-5 w-5" />
                Take photo
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-16"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
              >
                <Upload className="mr-2 h-5 w-5" />
                Upload image
              </Button>
            </div>

            {currentPath ? (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive"
                disabled={busy}
                onClick={() =>
                  clearAvatar.mutate(
                    { targetId, targetName, institutionId },
                    { onSuccess: () => onOpenChange(false) },
                  )
                }
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Remove photo
              </Button>
            ) : null}

            <p className="text-center text-xs text-ink-500">
              JPG, PNG, WebP or HEIC, up to 10 MB. The picture is cropped to a square.
            </p>
          </>
        )}

        <input
          ref={fileRef}
          type="file"
          accept="image/*,.heic,.heif"
          className="hidden"
          onChange={handleInput}
        />
      </div>
    </MobileSheet>
  );
}
```

The ink scale in this project is numeric: `text-ink-900` (strongest) through
`text-ink-400` (dimmest), defined in both `:root` and `.dark` in `src/index.css`
lines 121 to 125 and 337 to 341. `text-ink-500` is the helper-text weight. There
is no `text-ink-muted`, and raw Tailwind greys are forbidden.

- [ ] **Step 2: Export from the barrel**

In `src/components/shared/index.ts`:

```ts
export { UserPhotoSheet } from "./UserPhotoSheet";
export type { UserPhotoSheetProps } from "./UserPhotoSheet";
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck`
Expected: exit 0.

Run: `npx eslint src/components/shared/UserPhotoSheet.tsx src/components/shared/index.ts`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/components/shared/UserPhotoSheet.tsx src/components/shared/index.ts
git commit -m "feat(photos): UserPhotoSheet with camera, upload and remove"
```

---

## Task 9: Wire ViewUserSheet

**Files:**
- Modify: `src/components/admin/ViewUserSheet.tsx`

**Interfaces:**
- Consumes: `UserAvatar`, `UserPhotoSheet`, `useCanSetUserPhoto`

- [ ] **Step 1: Add `avatar_path` to the query**

In `src/components/admin/ViewUserSheet.tsx`, the profile query's select at lines
55 to 64 currently omits it. Change the select string to:

```ts
        .select(`
          id, full_name, email, phone, is_active, created_at, updated_at,
          roll_number, admission_number, avatar_path,
          institution_id,
          institutions (id, name, code)
        `)
```

- [ ] **Step 2: Replace the header avatar**

Replace the `<Avatar>` block at lines 351 to 355 with a button wrapping
`UserAvatar`, so the circle itself is the affordance:

```tsx
              {canSetPhoto ? (
                <button
                  type="button"
                  onClick={() => setPhotoOpen(true)}
                  className="rounded-full ring-offset-2 transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
                  aria-label="Change profile photo"
                >
                  <UserAvatar
                    name={user.full_name}
                    email={user.email}
                    avatarPath={user.avatar_path}
                    className="h-16 w-16"
                    fallbackClassName="text-xl"
                  />
                </button>
              ) : (
                <UserAvatar
                  name={user.full_name}
                  email={user.email}
                  avatarPath={user.avatar_path}
                  className="h-16 w-16"
                  fallbackClassName="text-xl"
                />
              )}
```

Update the import at line 3 to drop the now-unused avatar primitives, and add:

```ts
import { UserAvatar, UserPhotoSheet } from "@/components/shared";
import { useCanSetUserPhoto } from "@/hooks/useSetUserAvatar";
```

- [ ] **Step 3: Add the state and mount the sheet**

Near the existing `canManageStudent` at lines 46 to 48, add:

```ts
  const [photoOpen, setPhotoOpen] = useState(false);
  const { data: canSetPhoto } = useCanSetUserPhoto(userId);
```

Mount the sheet as the last child inside `<SheetContent>`:

```tsx
        {user && userId ? (
          <UserPhotoSheet
            open={photoOpen}
            onOpenChange={setPhotoOpen}
            targetId={userId}
            targetName={user.full_name}
            targetEmail={user.email}
            institutionId={user.institution_id ?? null}
            currentPath={user.avatar_path}
          />
        ) : null}
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck`
Expected: exit 0.

Run: `npx eslint src/components/admin/ViewUserSheet.tsx`
Expected: exit 0.

- [ ] **Step 5: Manual check, all four authority cases**

Run `npm run dev`. Open a user from `/admin/users` or `/school/users` and confirm:

1. As a **school admin**: the avatar is clickable for a student, a teacher and a coordinator. Upload a photo; it appears immediately, and the Activity tab shows `user_photo_updated`.
2. As a **coordinator**: clickable for a student in your wing, **not** clickable for a student outside it, and **not** clickable for another coordinator.
3. As a **teacher**: clickable only for a student who takes your subject.
4. As a **student**: log in and confirm no avatar anywhere is clickable.

This nests a Radix dialog inside a Radix dialog. Explicitly confirm: Escape closes
only the photo sheet, the page behind does not scroll, and focus returns to the
avatar button on close.

- [ ] **Step 6: Commit**

```bash
git add src/components/admin/ViewUserSheet.tsx
git commit -m "feat(photos): photo affordance on the ViewUserSheet header avatar"
```

---

## Task 10: Wire ProfilePage and useProfileData

**Files:**
- Modify: `src/hooks/useProfileData.ts`
- Modify: `src/pages/ProfilePage.tsx`

**Interfaces:**
- Produces: `ProfileData` gains `avatar_path: string | null`

- [ ] **Step 1: Extend ProfileData**

In `src/hooks/useProfileData.ts`, add to the `ProfileData` interface (lines 7 to 42):

```ts
  avatar_path: string | null;
```

Add `avatar_path` to the explicit select at lines 57 to 61, and add the missing
`staleTime` to the `useQuery` (a pre-existing Scale Gate item 3 gap):

```ts
    staleTime: 60_000,
```

- [ ] **Step 2: Replace the ProfilePage avatar**

In `src/pages/ProfilePage.tsx`, add these imports:

```ts
import { UserAvatar, UserPhotoSheet } from "@/components/shared";
import { useCanSetUserPhoto } from "@/hooks/useSetUserAvatar";
```

Add the state near the top of the component body:

```ts
  const [photoOpen, setPhotoOpen] = useState(false);
  const { data: canSetPhoto } = useCanSetUserPhoto(profile?.id);
```

Replace the `<Avatar>` block at lines 102 to 106 with:

```tsx
              {canSetPhoto ? (
                <button
                  type="button"
                  onClick={() => setPhotoOpen(true)}
                  className="rounded-full ring-offset-2 transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
                  aria-label="Change your profile photo"
                >
                  <UserAvatar
                    name={profile?.full_name}
                    email={profile?.email}
                    avatarPath={profile?.avatar_path}
                    className="h-20 w-20"
                    fallbackClassName="bg-primary text-primary-foreground text-2xl"
                  />
                </button>
              ) : (
                <UserAvatar
                  name={profile?.full_name}
                  email={profile?.email}
                  avatarPath={profile?.avatar_path}
                  className="h-20 w-20"
                  fallbackClassName="bg-primary text-primary-foreground text-2xl"
                />
              )}
```

Mount the sheet as the last element inside the page's root `<div>`:

```tsx
      {profile?.id ? (
        <UserPhotoSheet
          open={photoOpen}
          onOpenChange={setPhotoOpen}
          targetId={profile.id}
          targetName={profile.full_name}
          targetEmail={profile.email}
          institutionId={profile.institution_id ?? null}
          currentPath={profile.avatar_path}
        />
      ) : null}
```

Delete the now-unused local `getUserInitials` at lines 31 to 35 and drop
`Avatar` / `AvatarFallback` from the import at line 5, since `UserAvatar` derives
initials itself. Note this page does **not** use `PageShell`; do not restructure
it here, that is out of scope.

- [ ] **Step 3: Verify**

Run: `npm run typecheck`
Expected: exit 0.

Run: `npx eslint src/hooks/useProfileData.ts src/pages/ProfilePage.tsx`
Expected: exit 0.

- [ ] **Step 4: Manual check**

Run `npm run dev`, sign in as a **teacher**, open `/profile`, and set your own
photo. Confirm it appears on the page and, after a refresh, in the ViewUserSheet
when an admin opens you.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useProfileData.ts src/pages/ProfilePage.tsx
git commit -m "feat(photos): own-photo affordance on ProfilePage, thread avatar_path through useProfileData"
```

---

## Task 11: Create the profile self-write carve-out RPCs

**Files:**
- Create: `supabase/migrations/20260831120100_profile_self_write_rpcs.sql`

**Interfaces:**
- Produces: `public.clear_password_reset_flag()`, `public.mark_onboarding_complete(_steps jsonb)`

This migration is **purely additive** and safe to apply immediately. It must land,
and the frontend in Task 12 must be deployed, **before** Task 13 narrows the policy.

- [ ] **Step 1: Write the migration**

```sql
-- Column-scoped self-writes, ahead of narrowing the profiles self-update policy.
--
-- Postgres RLS has no column granularity within a single policy, so the two
-- legitimate self-writes that must survive a student lockdown move to narrow
-- SECURITY DEFINER RPCs:
--
--   * PasswordResetRequired.tsx writes must_reset_password and THROWS on
--     failure. Without this, every student on a forced reset is trapped in an
--     infinite loop.
--   * GuidedTourProvider.tsx writes onboarding_completed and swallows failure,
--     so the tour would silently replay forever.

CREATE OR REPLACE FUNCTION public.clear_password_reset_flag()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  UPDATE public.profiles
     SET must_reset_password = false,
         last_password_change = now(),
         password_expires_at  = NULL,
         updated_at           = now()
   WHERE id = auth.uid();
END $$;

REVOKE ALL ON FUNCTION public.clear_password_reset_flag() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.clear_password_reset_flag() FROM anon;
GRANT EXECUTE ON FUNCTION public.clear_password_reset_flag() TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_onboarding_complete(_steps jsonb DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  UPDATE public.profiles
     SET onboarding_completed = true,
         tour_steps_completed = COALESCE(_steps, tour_steps_completed),
         updated_at           = now()
   WHERE id = auth.uid();
END $$;

REVOKE ALL ON FUNCTION public.mark_onboarding_complete(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_onboarding_complete(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.mark_onboarding_complete(jsonb) TO authenticated;
```

- [ ] **Step 2: Apply and verify**

Run: `pwsh scripts/run-sql.ps1 -File supabase/migrations/20260831120100_profile_self_write_rpcs.sql`

Then:

```sql
SELECT routine_name, grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
  AND routine_name IN ('clear_password_reset_flag','mark_onboarding_complete')
ORDER BY routine_name, grantee;
```

Expected: no row where `grantee = 'anon'`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260831120100_profile_self_write_rpcs.sql
git commit -m "feat(profiles): add column-scoped self-write RPCs ahead of the student lockdown"
```

---

## Task 12: Move the two trapped writes onto the RPCs

**Files:**
- Modify: `src/pages/PasswordResetRequired.tsx`
- Modify: `src/components/onboarding/GuidedTourProvider.tsx`

**Interfaces:**
- Consumes: Task 11's RPCs

This must be **deployed to production** before Task 13 is applied.

- [ ] **Step 1: Rewrite the password-reset write**

In `src/pages/PasswordResetRequired.tsx`, replace the block at lines 53 to 63:

```ts
        const { error: profileError } = await supabase.rpc("clear_password_reset_flag");
        if (profileError) throw profileError;
```

- [ ] **Step 2: Rewrite the guided-tour write**

In `src/components/onboarding/GuidedTourProvider.tsx`, replace the block at lines
112 to 119:

```ts
      await supabase.rpc("mark_onboarding_complete", {
        _steps: steps.map((s, i) => ({ step: i, target: String(s.target) })) as unknown as Json,
      });
```

Import `Json` from `@/integrations/supabase/types` if it is not already imported.
Keep the existing `console.error` catch at line 125: this write is genuinely
best-effort and must not break the page.

- [ ] **Step 3: Verify**

Run: `npm run typecheck`
Expected: exit 0.

Run: `npx eslint src/pages/PasswordResetRequired.tsx src/components/onboarding/GuidedTourProvider.tsx`
Expected: exit 0.

- [ ] **Step 4: Manual check, the highest-risk path in this plan**

With the policy **not yet narrowed**, prove the new code path works under the old
policy so the deployment order is safe:

1. Pick a test student and set `must_reset_password = true` on their row via SQL.
2. Sign in as that student. The forced-reset screen appears.
3. Complete the reset. Confirm it succeeds and does not loop.
4. Confirm by SQL that `must_reset_password` is now `false` and `last_password_change` is set.

Repeat step 1 to 4 as a **teacher** as well.

- [ ] **Step 5: Commit**

```bash
git add src/pages/PasswordResetRequired.tsx src/components/onboarding/GuidedTourProvider.tsx
git commit -m "refactor(profiles): route self-writes through RPCs so the lockdown cannot trap users"
```

---

## Task 13: Narrow the self-edit policy and lock the student form

**Files:**
- Create: `supabase/migrations/20260831120200_student_profile_lockdown.sql`
- Modify: `src/pages/ProfilePage.tsx`

**STOP.** Do not start this task until Task 12's code is deployed to production.
Applying this migration first traps every student on a forced password reset.

- [ ] **Step 1: Write the migration**

```sql
-- Students may no longer edit their own profile.
--
-- "Users can update own profile" (20260112130740) is ROLE-BLIND:
-- USING (id = auth.uid()) with no role predicate. DROPPING it to block students
-- would also strip self-edit from TEACHERS and EMPLOYEES, who are covered by no
-- other profiles UPDATE policy. School admins, coordinators, super admins and
-- override-grant holders survive via their own policies. So this REPLACES it.
--
-- The two legitimate self-writes that this policy used to carry now go through
-- clear_password_reset_flag() and mark_onboarding_complete() (20260831120100).
-- Those must already be deployed in the frontend before this is applied.
--
-- Also note: MascotSetupDialog.tsx and SalciBuddy.tsx write the caller's own
-- profiles row but are mounted NOWHERE today. They will not break now; they
-- will the day someone remounts them.

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

CREATE POLICY "Users can update own profile"
ON public.profiles FOR UPDATE TO authenticated
USING (
  id = (SELECT auth.uid())
  AND NOT public.has_role((SELECT auth.uid()), 'student')
)
WITH CHECK (
  id = (SELECT auth.uid())
  AND NOT public.has_role((SELECT auth.uid()), 'student')
);
```

- [ ] **Step 2: Make the student form read-only**

A PostgREST UPDATE blocked by RLS returns success-shaped output, so leaving the
form mounted would give students a green "Profile updated successfully" toast over
a write that never happened. Hiding the form is **not** optional hardening.

In `src/pages/ProfilePage.tsx`, `isStudent` is already computed at line 65 and is
in scope above the form. Add `disabled={isStudent}` to the full-name input at
lines 133 to 139 and the phone input at lines 147 to 153, wrap the Save button at
lines 172 to 175 in `{!isStudent && ( ... )}`, and change the card description at
line 125 from "Update your personal details" to:

```tsx
                <CardDescription>
                  {isStudent ? "Managed by your school" : "Update your personal details"}
                </CardDescription>
```

Also gate the photo affordance added in Task 10 so students never see a clickable
avatar. `useCanSetUserPhoto` already returns false for them, so this is automatic;
confirm it rather than adding a second check.

- [ ] **Step 3: Apply the migration**

Run: `pwsh scripts/run-sql.ps1 -File supabase/migrations/20260831120200_student_profile_lockdown.sql`

Then confirm the replacement landed:

```sql
SELECT polname, pg_get_expr(polqual, polrelid) AS using_expr
FROM pg_policy
WHERE polrelid = 'public.profiles'::regclass AND polname = 'Users can update own profile';
```

Expected: the expression contains both `auth.uid()` and `has_role`.

- [ ] **Step 4: Verify**

Run: `npm run typecheck`
Expected: exit 0.

Run: `npx eslint src/pages/ProfilePage.tsx`
Expected: exit 0.

Run: `npx vite build`
Expected: exit 0.

- [ ] **Step 5: Manual check, the full regression matrix**

Sign in as each role and confirm:

| Role | `/profile` name and phone | Save button | Own photo | Forced password reset |
|---|---|---|---|---|
| Student | disabled | hidden | not clickable | **completes, no loop** |
| Teacher | editable | present, saves | clickable | completes |
| Employee | editable | present, saves | clickable | completes |
| Coordinator | editable, saves | present | clickable | completes |
| School admin | editable, saves | present | clickable | completes |

The student forced-reset row is the highest-risk cell in this plan. Test it with a
real student account before considering this task done.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260831120200_student_profile_lockdown.sql src/pages/ProfilePage.tsx
git commit -m "feat(profiles): students can no longer edit their own profile"
```

---

## Task 14: Correct the stale in-app documentation

**Files:**
- Modify: `src/components/settings/SystemArchitectureDocument.tsx:239`
- Modify: `src/components/settings/ExpansionPlanDocument.tsx:38`
- Modify: `src/components/settings/ERPRoadmapDocument.tsx:98`
- Modify: `src/components/settings/SystemMapsDocument.tsx:37-38`

- [ ] **Step 1: Fix the bucket table**

`SystemArchitectureDocument.tsx:239` claims a `profile-photos` bucket with
"Public read, owner write". That bucket has never existed. Change the row to
`user-avatars`, "User photos", "Private, per-request permission check".

- [ ] **Step 2: Fix the two "built" claims**

`ExpansionPlanDocument.tsx:38` and `ERPRoadmapDocument.tsx:98` both mark photo
upload as `built`, which was false until this release and is now true only for the
surfaces in Release 1. Leave them marked `built` but change the copy to name the
actual scope: "Photo upload on profile and user sheets".

- [ ] **Step 3: Fix the route table**

`SystemMapsDocument.tsx:37-38` lists `/profile` as "All authenticated". Change the
note to "All authenticated, read-only for students".

- [ ] **Step 4: Verify**

Run: `npm run typecheck`
Expected: exit 0.

Run: `npx eslint src/components/settings/SystemArchitectureDocument.tsx src/components/settings/ExpansionPlanDocument.tsx src/components/settings/ERPRoadmapDocument.tsx src/components/settings/SystemMapsDocument.tsx`
Expected: exit 0.

Run: `npx vite build`
Expected: exit 0.

- [ ] **Step 5: Confirm no em-dash reached a user-facing string**

Grep the files created or modified in this plan for the `—` character. Expected:
no hits in any string that renders on screen.

- [ ] **Step 6: Commit**

```bash
git add src/components/settings/
git commit -m "docs(settings): correct the storage and profile claims in the in-app docs"
```

---

## Release 2 (separate plan)

The sweep of the remaining ~28 avatar surfaces is **not** in this plan. It is
mechanical but wide, and several surfaces are fed by `dash_*` and olympiad RPCs
that do not return avatar data and must be extended. It gets its own plan once
Release 1 is verified in production.

It is safe to defer because `UserAvatar` with no path renders exactly today's
initials, so nothing looks half-finished in between. The surface inventory is in
the spec, §10.
