# Profile Photos: role-scoped upload, private storage, student self-edit removal

Status: design approved in chat 2026-08-31, pending written review
Author: Claude (paired with Tushar)
Related: CLAUDE.md §4 (roles), §6 (error handling), §11 (REVOKE FROM anon), §17 (service worker), §19 (toastError), §21 (cascade), §23 (concurrency)

---

## 1. Summary

Add profile photographs to the SALCI portal. Every avatar today renders coloured
initials; `profiles.avatar_url` has existed since day one and has never been
written by anything.

Three things ship together:

1. **A private photo store** with per-request permission checks and no shareable URL.
2. **A role-scoped write path**: admins set anyone's photo, coordinators set their
   wing's students and teachers, teachers set only their own subject students,
   students set nobody's.
3. **Removal of student self-edit** on the shared `/profile` page (name, phone and
   photo), without breaking teachers, employees, or the forced-password-reset flow.

---

## 2. Decisions locked

| Decision | Choice | Decided by |
|---|---|---|
| Coordinator scope | Wing-scoped, for both students and teachers | User, 2026-08-31 |
| Bucket visibility | Private, permission checked on every fetch | User, 2026-08-31 |
| URL strategy | **No URL of any kind.** Authenticated download, bytes cached on device, `blob:` URL for the `<img>` | User, 2026-08-31 |
| Student self-edit | Whole profile form goes read-only (name, phone, photo). Password change on `/settings` is untouched | User, 2026-08-31 |
| Display reach | All avatar surfaces | User, 2026-08-31 |
| Renditions | One, 256x256 WebP | Design, superseded two-rendition plan once caching made size near-irrelevant |
| Rollout | Two releases: mechanism, then sweep | Design |

### Why no signed URLs

A signed URL puts a token in the query string, so the token is part of the cache
key. Every re-sign is a new URL and forces a full re-download of every visible
avatar. At the repo's standard 300s TTL that is roughly 300 GB/month at 5K DAU,
which overruns the Supabase Pro 250 GB allowance.

Downloading through the authenticated endpoint and persisting the bytes locally
gives, simultaneously, the strongest privacy (RLS evaluated on every single
fetch, no token that can leak) and the lowest cost (~1 GB/month, because each
photo is fetched once per device, ever).

---

## 3. Baseline (verified 2026-08-31)

* `profiles.avatar_url TEXT` exists (`20260104113057...sql:92`), read by
  `useBadgeLeaderboard`, `useStaffHR`, `useComprehensiveStudentAnalytics`, and the
  `badge_leaderboard` RPC. **Written by nothing.** Assumed 100% NULL; gated in §14.
* No `avatars` / `profile-photos` / `user-avatars` bucket in any migration.
* `src/utils/imageResize.ts` already defaults to 300x300 `resize: "cover"`. It was
  written for avatars and only ever used at 800x800 by question images.
* `src/components/offline-scan/CameraCapture.tsx` is the reusable camera. It
  hardcodes `facingMode: "environment"` and names files `sheet_${Date.now()}.jpg`.
* `src/lib/hybridImage.ts:8-15` already solves the iOS empty-MIME HEIC problem.
* `main.tsx:72` deletes every Cache Storage key starting with `salci-` (dev only).
* `SchoolStudentsPage` is server-paginated at `PAGE_SIZE = 40`; a separate
  `.range(0, 9999)` query at `:494` backs bulk-select and must not carry avatars.
* Measured TTFB to project `gyymkgohcijeksmrzuyw` from the development machine:
  **~70 ms warm** (18 ms TCP, 25 ms TLS, 26 ms server).

---

## 4. Data model

Add one column. Do **not** reuse `avatar_url`: it is named for a URL and would
hold a storage path, which is a trap.

```sql
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_path TEXT;

COMMENT ON COLUMN public.profiles.avatar_path IS
  'Immutable object path in the PRIVATE user-avatars bucket: {user_id}/{uuid}.webp.
   NOT a URL. Never signed. Fetched via the authenticated download endpoint and
   cached on-device (src/lib/avatarStore.ts). Writes are gated by
   can_set_user_photo() at BOTH the RPC and a BEFORE UPDATE trigger.';
```

`avatar_url` is dropped in the same migration once §14's NULL check passes, and
the `badge_leaderboard` RPC is updated to project `avatar_path`.

Path shape is `{user_id}/{uuid}.webp`. Two properties follow, both load-bearing:

* The first segment is the **owner**, so storage policies can resolve authority
  from the path alone.
* A new upload writes a **new uuid**, so an object is immutable. That means the
  on-device cache can never be stale and needs no cache-busting (unlike
  `useUploadInstitutionLogo`'s `?v=Date.now()`, which exists only because its path
  is deterministic).

---

## 5. Storage bucket and policies

```sql
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('user-avatars', 'user-avatars', false, 2097152,
        ARRAY['image/webp', 'image/jpeg', 'image/png'])
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;
```

Path parser, modelled on `notice_id_from_path` (`20260822100200...sql:70-78`):

```sql
CREATE OR REPLACE FUNCTION public.avatar_owner_from_path(_name text)
RETURNS uuid LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE _seg text;
BEGIN
  _seg := split_part(coalesce(_name, ''), '/', 1);
  RETURN _seg::uuid;
EXCEPTION WHEN others THEN
  RETURN NULL;
END $$;
```

Read gate. Same institution is the right model: these people already appear by
name and class in every list the viewer can open.

```sql
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
```

All four verbs get a policy. `face-photos` and `message-attachments` each shipped
with only INSERT and SELECT, which means nobody but service-role can ever replace
or remove those objects; that mistake is not repeated here.

```sql
CREATE POLICY user_avatars_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'user-avatars'
         AND public.can_view_user_photo(public.avatar_owner_from_path(name),
                                        (SELECT auth.uid())));

CREATE POLICY user_avatars_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'user-avatars'
              AND public.can_set_user_photo((SELECT auth.uid()),
                                            public.avatar_owner_from_path(name)));

CREATE POLICY user_avatars_update ON storage.objects FOR UPDATE TO authenticated
  USING      (bucket_id = 'user-avatars' AND public.can_set_user_photo((SELECT auth.uid()), public.avatar_owner_from_path(name)))
  WITH CHECK (bucket_id = 'user-avatars' AND public.can_set_user_photo((SELECT auth.uid()), public.avatar_owner_from_path(name)));

CREATE POLICY user_avatars_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'user-avatars'
         AND public.can_set_user_photo((SELECT auth.uid()), public.avatar_owner_from_path(name)));
```

`(SELECT auth.uid())` throughout, per §23 and the ~700-bare-`auth.uid()` backlog.
Only `notice-attachments` currently does this; every other storage policy in the
repo uses the bare call.

---

## 6. Authority: `can_set_user_photo`

Modelled on `can_edit_student_details` (`20260826150000...sql:145-160`), which is
the repo's existing "may actor A modify person B's record" predicate.

```sql
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
    -- Never a peer coordinator, never an admin.
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

REVOKE ALL ON FUNCTION public.can_set_user_photo(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_set_user_photo(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_set_user_photo(uuid, uuid) TO authenticated;
```

Notes:

* The institution guard is repeated per branch on purpose. `teacher_controls_student`
  and `is_coordinator_for_class` are **not** institution-scoped by themselves.
* `is_coordinator_for_class` does not check the `coordinator` role either, hence
  the explicit `has_role` in that branch.
* Users holding both teacher and coordinator roles get the union, which is correct.
* Deliberately excluded: `is_staff_manager` / `is_student_manager` override grants.
  Flip by adding an OR branch if that turns out to be wanted.
* The coordinator branch is **narrower than a coordinator's existing authority**.
  `20260502120000_coordinator_full_teacher_management.sql` deliberately gave
  coordinators institution-wide staff management. Photos of children are held to
  the wing instead. This divergence is intentional and should stay documented.

---

## 7. Write path

Teachers have **no** UPDATE policy on `profiles` at all, so a plain
`.update({ avatar_path })` from a teacher is a silent RLS no-op. The write must be
an RPC.

```sql
CREATE OR REPLACE FUNCTION public.set_user_avatar(_target uuid, _path text)
RETURNS text                             -- the previous path, for client cleanup
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _old text;
BEGIN
  IF NOT public.can_set_user_photo(auth.uid(), _target) THEN
    RAISE EXCEPTION 'You do not have permission to change this photo.'
      USING ERRCODE = '42501';
  END IF;

  IF _path IS NULL OR public.avatar_owner_from_path(_path) IS DISTINCT FROM _target THEN
    RAISE EXCEPTION 'That photo does not belong to this user.'
      USING ERRCODE = '22023';
  END IF;

  SELECT avatar_path INTO _old FROM public.profiles WHERE id = _target FOR UPDATE;
  UPDATE public.profiles SET avatar_path = _path, updated_at = now() WHERE id = _target;
  RETURN _old;
END $$;
```

`clear_user_avatar(_target uuid) RETURNS text` is the same shape with
`avatar_path = NULL`. Both get the three-line REVOKE/GRANT block.

The path-ownership check matters: without it an actor authorised over user B could
point B's row at an object inside A's folder.

### The hole the RPC alone does not close

`avatar_path` lives on `profiles`, and **four** existing policies grant broad
`profiles` UPDATE: school admin institution-wide, coordinator institution-wide,
the staff/student manager override, and self. Any of those actors could bypass
`can_set_user_photo` with a direct PostgREST update. Both manager-override
migrations even warn that their policy is safe only because "the app only ever
sends full_name + is_active from this surface".

So the predicate is also enforced by a trigger, which holds no matter which policy
let the row through:

```sql
CREATE OR REPLACE FUNCTION public.enforce_avatar_path_authority()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.avatar_path IS DISTINCT FROM OLD.avatar_path THEN
    IF auth.uid() IS NULL THEN
      RETURN NEW;                        -- service-role / migration context
    END IF;
    IF NOT public.can_set_user_photo(auth.uid(), NEW.id) THEN
      RAISE EXCEPTION 'You do not have permission to change this photo.'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_enforce_avatar_path_authority
  BEFORE UPDATE OF avatar_path ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_avatar_path_authority();
```

`BEFORE UPDATE OF col` fires whenever the column is *mentioned*, so the
`IS DISTINCT FROM` guard is required to avoid rejecting unrelated saves.

---

## 8. Removing student self-edit

### The trap

`"Users can update own profile"` (`20260112130740...sql:46-51`) is
`USING (id = auth.uid())` with **no role predicate**. Dropping it to block students
also breaks:

* **Teachers and employees**, who are covered by no other `profiles` UPDATE policy
  and would lose self-edit entirely. Admins and coordinators survive via their
  institution-wide policies.
* **`PasswordResetRequired.tsx:53-63`**, which writes `must_reset_password: false`
  to the student's own row and `throw`s on failure. Every student on a forced
  reset would be trapped in an infinite loop. Highest-severity item in this design.
* **`GuidedTourProvider.tsx:112-119`**, whose failure is swallowed by
  `console.error`, so the tour would silently replay forever.

### The fix

Replace, do not drop:

```sql
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
ON public.profiles FOR UPDATE TO authenticated
USING      (id = (SELECT auth.uid()) AND NOT public.has_role((SELECT auth.uid()), 'student'))
WITH CHECK (id = (SELECT auth.uid()) AND NOT public.has_role((SELECT auth.uid()), 'student'));
```

Postgres RLS has no column granularity within one policy, so the two legitimate
self-writes move to narrow SECURITY DEFINER RPCs:

* `clear_password_reset_flag()` sets `must_reset_password`, `last_password_change`,
  `password_expires_at` on `auth.uid()`'s own row.
* `mark_onboarding_complete(_steps jsonb)` sets `onboarding_completed` and
  `tour_steps_completed` on `auth.uid()`'s own row.

Both raise on `auth.uid() IS NULL` and carry the REVOKE/GRANT block.

### Frontend

`ProfilePage.tsx` renders the name and phone inputs read-only, and hides Save, when
`isStudent` (already computed at `:65`, in scope above the form).

This is **not** optional hardening. A PostgREST UPDATE blocked by RLS returns
success-shaped output, so leaving the form mounted gives students a green "Profile
updated successfully" toast over a write that never happened, exactly the class of
bug CLAUDE.md §6 documents for DELETE.

### Dead code noted

`MascotSetupDialog.tsx` and `SalciBuddy.tsx` write the caller's own profile row but
are mounted nowhere. They will not break today; they will the day someone remounts
them. Note in the migration comment.

---

## 9. Client architecture

### `src/lib/initials.ts`

One `getInitials(name?, email?)`. Today the logic is reimplemented ~14 times with
three different behaviours, so "Chetan Sharma" is `CS` in the sidebar and `CH` in
ViewUserSheet. Consolidating is a side benefit of the sweep.

### `src/lib/avatarStore.ts`

```
getAvatarObjectUrl(path: string): Promise<string | null>
```

* `const CACHE_NAME = "user-avatars-v1"` **must not** start with `salci-`;
  `main.tsx:72` purges that prefix on every dev boot.
* Memory layer: `Map<path, objectUrl>`, plus `Map<path, Promise>` for in-flight
  dedupe so N components requesting one path make one request.
* Persistent layer: Cache Storage, keyed by a synthetic `/__avatar/{path}` request.
  Immutable paths mean an entry is never stale.
* Miss path: `supabase.storage.from("user-avatars").download(path)`, which hits the
  authenticated endpoint and evaluates RLS per request. Store the blob, mint the
  object URL.
* **Concurrency cap of 6 in flight.** Explicit user requirement: photo loading must
  never compete with the page's own queries.
* Every failure returns `null` and degrades to initials. Guard
  `typeof caches !== "undefined"` for Safari private mode and insecure contexts.

### `src/components/shared/UserAvatar.tsx`

```ts
interface UserAvatarProps {
  name?: string | null;
  email?: string | null;
  avatarPath?: string | null;
  className?: string;
  fallbackClassName?: string;
}
```

* An `IntersectionObserver` on the root; `getAvatarObjectUrl` is called **only once
  the element is on screen**. A 40-row page therefore costs roughly the ~10 visible
  rows, not 40.
* With `avatarPath` null or unresolved it renders exactly today's initials. That is
  what makes the §13 two-release split safe.
* The Avatar root is already fixed-size, so there is no layout shift on arrival.

### `src/hooks/useSetUserAvatar.ts`

Failure ordering copied from `useUploadInstitutionLogo`:

1. Validate. HEIC first: iOS reports an **empty** MIME type for HEIC, so
   `file.type.startsWith("image/")` rejects genuine iPhone photos. Reuse
   `hybridImage.ts:8-15`'s extension fallback and the lazy `heic2any` import
   (~1.5 MB, must stay out of the main bundle).
2. Resize to 256x256 WebP, roughly 10 KB out. **`resizeImageForUpload` cannot do
   this today** and must be extended: its options are only
   `{ maxWidth, maxHeight, quality }`, and its hardcoded
   `convertTypes: ["image/png", "image/webp"]` plus `convertSize: 100000` transcode
   WebP input *to JPEG*, which is the opposite of what we want. Add an optional
   `mimeType` that, when supplied, is passed to Compressor and suppresses
   `convertTypes`/`convertSize`. Existing callers (`question-image-upload.tsx`)
   omit it and are unaffected.
3. Upload to `${targetId}/${crypto.randomUUID()}.webp` with
   `{ contentType: "image/webp", cacheControl: "31536000", upsert: false }`.
   Unique paths mean `upsert` is never needed.
4. `rpc("set_user_avatar", ...)`. On failure, remove the just-uploaded object and
   throw, so a failed write never leaves an orphan.
5. On success, best-effort remove the returned old path, invalidate queries, and
   `logActivityEvent`.

Derive the extension from the **resized** blob's type, never the original filename:
`imageResize.ts:24`'s `convertSize: 100000` transcodes PNG/WebP over 100 KB to
JPEG, so name and bytes can disagree.

### `CameraCapture` changes

Add an optional `facingMode` prop (default `"environment"`, so existing consumers
are untouched) and an optional filename prefix. The photo sheet passes `"user"`.
Copy `HybridCameraGate.tsx:46-50`'s insecure-context guard.

---

## 10. UI surfaces

### The photo sheet

`MobileSheet` with `placement="center"`. Center placement is required, not
cosmetic: MobileSheet's bottom placement is hardcoded `bg-white` and does not flip
in dark mode, a documented pre-existing bug shared by 20+ consumers.

Three actions: Take photo, Upload image, Remove photo. Remove is hidden when there
is no current photo.

Mounted from two places:

* `ViewUserSheet.tsx:349-373`, the header avatar. Note this nests a Radix dialog
  inside a Radix dialog; focus trap, scroll lock and Escape stacking need explicit
  testing.
* `ProfilePage.tsx:102-106`, for one's own photo, for every role except student.

Both surfaces must use `toastError` from `@/lib/toast`. `ViewUserSheet` still uses
the legacy `useToast()` shadcn toaster; do not follow the file's local convention.

### The sweep

`ViewUserSheet`'s query (`:55-64`) and `useProfileData`'s (`:57-61`) both need
`avatar_path` adding to their explicit column lists, and `ProfileData` needs the
field. Every other surface swaps its avatar block for `<UserAvatar>`.

| Group | Surfaces | Data source |
|---|---|---|
| Chrome | AppLayout top bar, AppSidebar footer | needs a cached hook, **not** `useAuth` (see below) |
| Own profile | ProfilePage | `useProfileData` |
| Admin | ViewUserSheet, UsersPage, SchoolStudentsPage, SchoolCoordinatorsPage | plain selects |
| Shared | StudentList, TeacherCard, MobileDataCard | already declare an unused `photoUrl` prop |
| Attendance | AttendanceHistoryView, AttendanceListPanel, ClassAttendanceMarker, TeacherClassAttendanceFlow, UserAttendanceDetailPage | plain selects |
| Tasks / comms | MultiAssigneeTaskDetail, TaskComments, TaskGroupCard, MessageThread | plain selects |
| HR / onboarding | StaffDirectoryTab (`useStaffHR` already selects it), CompletedTeachersList, BulkAssignTeachersDialog | plain selects |
| Hand-rolled spans | `command-center/dash/primitives.tsx:579`, StudentAdoptionWidget, EvaluationsPage, StudentPerformancePage, olympiad Teacher/StudentPerformanceTable | **RPC changes needed** |
| Leaderboard | BadgeLeaderboardPage | `badge_leaderboard` RPC |

Seven surfaces bypass the shadcn Avatar entirely with hand-rolled
`<span className="rounded-full">` initials, so they need real rewrites rather than
a prop change. Several are fed by `dash_*` RPCs that do not return avatar data and
must be extended.

**Do not add `avatar_url`/`avatar_path` to `useAuth`.** It is deliberately not a
context and carries a module-level 5-minute cache added because 56+ call sites each
fired their own `profiles` SELECT and produced a `/rest/v1/profiles` storm at 3-5K
concurrent (`useAuth.ts:12-24`). Extend `useProfileData` or add a dedicated cached
hook.

---

## 11. Audit

```ts
logActivityEvent({
  action: "user_photo_updated",          // or "user_photo_removed"
  entityType: "User",
  entityId: targetId,
  entityName: targetName,
  metadata: { institution_id: institutionId },
});
```

`institution_id` in metadata is mandatory: school admins read `system_audit_logs`
via `metadata->>'institution_id' = get_user_institution(auth.uid())::TEXT OR
actor_id = auth.uid()`, so omitting it hides the row from every school admin who is
not the actor.

This lands in ViewUserSheet's Activity tab for free (query 1 of its 9). Note the
feed is keyed on **actor**, so an admin setting a student's photo appears in the
admin's activity, not the student's, matching how `student_details_updated`
already behaves.

---

## 12. Scale Gate

| # | Item | Verdict |
|---|---|---|
| 1 | Explicit bound on every list query | pass. No new list queries; `avatar_path` joins existing paginated selects. Bulk-select's `.range(0, 9999)` deliberately carries no avatars |
| 2 | Server-side aggregation | n/a. No counts or aggregates |
| 3 | Explicit `staleTime` | pass. No new `useQuery`; `avatarStore` is a plain cache, not React Query. Fix `useProfileData`'s missing `staleTime` in passing (pre-existing gap) |
| 4 | No `select("*")` | pass. `avatar_path` added to explicit column lists only |
| 5 | Idempotent mutations | pass. Unique upload path per attempt; `set_user_avatar` is a single UPDATE. `invokeEdgeFunction` retries once on 401, so idempotence matters and holds |
| 6 | Dependent writes in one transaction | pass. Storage write then one RPC; RPC failure triggers orphan cleanup |
| 7 | FK indexes, DEFINER helpers, `(select auth.uid())` | pass. `idx_profiles_institution_id` added `IF NOT EXISTS`; all policies call DEFINER helpers with wrapped `auth.uid()` |
| 8 | Errors surfaced | pass. `toastError` on every path; avatar fetch failures degrade to initials by design |
| 9 | No JWT-less `getUser()` | pass. None added |
| 10 | No sub-30s polling; subscriptions clean up | pass. No polling, no subscriptions. IntersectionObserver disconnects on unmount |

Measured budget, 50K users at 30% adoption, 10 KB per photo:

| | |
|---|---|
| Storage | ~150 MB, under $0.01/month |
| Egress, ongoing | ~1 GB/month against a 250 GB Pro allowance |
| First-ever load, per user | ~450 KB |
| First screenful of a 40-row page | ~150 to 250 ms, off the critical path |
| Every subsequent view | 0 ms, 0 bytes |

---

## 13. Rollout

**Release 1: mechanism.** Migration, `avatarStore`, `initials`, `UserAvatar`,
`useSetUserAvatar`, the photo sheet, `CameraCapture` props, ViewUserSheet and
ProfilePage wiring, and the student lockdown.

**Release 2: sweep.** The remaining surfaces from §10, including the RPC changes
for the hand-rolled group.

The split is safe because `UserAvatar` without a path renders today's initials, so
nothing is half-finished in between.

---

## 14. Verification gates before applying

Migrations go through the Management API SQL path, never `supabase db push`;
`supabase_migrations.schema_migrations` is not maintained in this project.

1. `SELECT count(*) FROM profiles WHERE avatar_url IS NOT NULL;` **must be 0**
   before dropping the column. If not, keep both and migrate the values instead.
2. `SELECT id, public, file_size_limit FROM storage.buckets WHERE id = 'user-avatars';`
   A dashboard-created bucket would not appear in any migration. `ON CONFLICT DO UPDATE`
   covers it, but confirm.
3. After applying, confirm anon holds no EXECUTE:
   `SELECT grantee, privilege_type FROM information_schema.routine_privileges
    WHERE routine_name IN ('can_set_user_photo','can_view_user_photo','avatar_owner_from_path',
                           'set_user_avatar','clear_user_avatar','clear_password_reset_flag',
                           'mark_onboarding_complete');`
4. `SELECT polname, polcmd, pg_get_expr(polqual, polrelid) FROM pg_policy
    WHERE polrelid = 'public.profiles'::regclass;` to confirm the replaced self-edit policy.
5. Manual matrix, one real user per row: super admin, school admin, coordinator
   in-wing and out-of-wing, teacher with and without the subject, student self,
   student by teacher. Both the RPC path and a raw PostgREST update, to prove the
   trigger holds.
6. Forced-password-reset flow end to end as a student, before and after.
7. `npm run typecheck`, `npx eslint <changed>`, `npx vite build` all clean (§5a).

---

## 15. Out of scope

* Interactive crop and zoom. No cropping library is installed;
  `resizeImageForUpload`'s `resize: "cover"` centre-crops without user control.
  Adding one is a separate, lazy-loaded decision (§23 bundle budget).
* Photo moderation or approval workflow.
* Backfilling photos from `face_enrollments.photo_url`. That is biometric
  attendance data with separate consent semantics and must never be repurposed.
* Removing students' password change on `/settings`. `ProtectedRoute.tsx:122`
  keeps `/settings` reachable on purpose.
* `SystemArchitectureDocument.tsx:239`, `ExpansionPlanDocument.tsx:38` and
  `ERPRoadmapDocument.tsx:98` all currently claim profile photo upload is built.
  Correcting them is a drive-by in Release 1.
