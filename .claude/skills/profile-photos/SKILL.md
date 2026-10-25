---
name: profile-photos
description: Profile photos and avatars — the private user-avatars bucket, profiles.avatar_path, can_set_user_photo/can_view_user_photo authority, the enforce_avatar_path_authority trigger, the no-URL on-device avatar store, and the student profile lockdown with its column-scoped self-write RPCs. Use when touching profiles.avatar_path or avatar_url, the user-avatars bucket, UserAvatar, UserPhotoSheet, src/lib/avatarStore.ts, src/lib/avatarImage.ts, useSetUserAvatar, CameraCapture, ProfilePage, the "Users can update own profile" RLS policy, clear_password_reset_flag, or mark_onboarding_complete.
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# Profile Photos & Avatars

Shipped as Release 1 on 2026-09-02 (merged, pushed `e52bc49`; all three migrations applied to prod). Design: [docs/superpowers/specs/2026-08-31-profile-photos-design.md](../../../docs/superpowers/specs/2026-08-31-profile-photos-design.md). Plan: `docs/superpowers/plans/2026-08-31-profile-photos.md`.

Built in an EXTERNAL git worktree (`salci-photos-wt`), so its per-commit history is not visible from the main checkout — read the design doc, not `git log -p`.

## 1. NO URLs, ever — the load-bearing decision

The bucket is **private** and there is **no URL of any kind**: not public, not signed. Bytes are downloaded through the authenticated endpoint, cached on the device, and handed to `<img>` as a `blob:` URL.

Why, so nobody "optimises" it back: a signed URL puts the token in the query string, so the token is part of the cache key. Every re-sign is a new URL and forces a full re-download of every visible avatar — at the repo's standard 300s TTL that is roughly **300 GB/month at 5K DAU**, overrunning the Supabase Pro 250 GB allowance. Authenticated download instead gives the strongest privacy (RLS evaluated on every single fetch, no leakable token) and the lowest cost (~1 GB/month, each photo fetched once per device ever).

## 2. Data model and storage

* **`profiles.avatar_path TEXT`** holds a storage path. **Do not reuse `profiles.avatar_url`** — it is named for a URL, holding a path there is a trap. `avatar_url` predates this work, is read by `useBadgeLeaderboard`, `useStaffHR`, `useComprehensiveStudentAnalytics` and the `badge_leaderboard` RPC, and is **written by nothing**.
* Bucket `user-avatars`: **private**, 2 MB cap, MIME allowlist `image/webp|jpeg|png` — enforced on the bucket, not just client-side.
* Path shape is `<user_id>/<uuid>.webp`. Paths are **immutable and unique**, which is what lets the cache never go stale and makes `upsert` unnecessary.
* `avatar_owner_from_path(text)` parses segment 1 to a uuid and returns NULL on any parse failure (modelled on `notice_id_from_path`). The `EXCEPTION WHEN others THEN RETURN NULL` is required — a bare `::uuid` cast raises `22P02` as a hard storage failure rather than a denial.
* Storage policies (`user_avatars_select/insert/update/delete`) gate on `avatar_owner_from_path(name)` plus the authority helpers below.

## 3. Authority: two predicates, not one

**Read: `can_view_user_photo(_target, _viewer)`** — super admin, or same non-NULL `institution_id`. Same-institution is the right model: these people already appear by name and class in every list the viewer can open.

**Write: `can_set_user_photo(_actor, _target)`** — modelled on `can_edit_student_details`:

| Actor | May set the photo of |
|---|---|
| super admin | anyone |
| **self** | own photo, **EXCEPT students** (`_actor = _target AND NOT has_role(_actor,'student')`) |
| school admin (incl. super_school_admin) | anyone in their institution |
| coordinator | students and teachers of classes mapped to their wing — **never a peer coordinator, never an admin** |
| teacher | only their own subject students, via `teacher_controls_student()`. **Class-sharing is NOT authority** (see `teacher-authority-scope` skill) |

Details that matter if you edit it:
* **The institution guard is repeated per branch on purpose** — `teacher_controls_student` and `is_coordinator_for_class` are NOT institution-scoped by themselves.
* `is_coordinator_for_class` does not check the `coordinator` role either, hence the explicit `has_role` in that branch.
* Users holding both teacher and coordinator roles get the union here, which is correct (this is the one place a union is right — see the dual-role trap in `teacher-authority-scope`).
* The `is_staff_manager` / `is_student_manager` override grants are **deliberately excluded**. Add an OR branch only if asked.
* The coordinator branch is **deliberately narrower than a coordinator's existing authority** (`20260502120000` gave them institution-wide staff management). Photos of children are held to a higher bar.

`can_i_set_user_photo(_target)` is the thin caller-side wrapper the frontend uses to decide whether to show the affordance.

## 4. The trigger is not optional

`avatar_path` lives on `profiles`, and **four** existing policies grant broad `profiles` UPDATE (school admin institution-wide, coordinator institution-wide, the staff/student manager override, and self). Any of those actors could bypass `can_set_user_photo` with a direct PostgREST update — both manager-override migrations even warn that their policy is safe only because "the app only ever sends full_name + is_active from this surface".

So the predicate is **also** enforced by `enforce_avatar_path_authority()`, a `BEFORE UPDATE OF avatar_path ON profiles` trigger, which holds no matter which policy let the row through. Two rules:
* **`NEW.avatar_path IS DISTINCT FROM OLD.avatar_path` is required** — `BEFORE UPDATE OF col` fires whenever the column is merely *mentioned*, so without the guard it rejects unrelated saves.
* **`auth.uid() IS NULL` returns NEW** so service-role and migration contexts still work.

Write RPCs: `set_user_avatar(_target, _path)` and `clear_user_avatar(_target)`. Both check `can_set_user_photo`, and `set_user_avatar` also verifies the path actually belongs to `_target` ("That photo does not belong to this user."). Both carry the `REVOKE FROM PUBLIC` + `REVOKE FROM anon` + `GRANT TO authenticated` block (`prod-operations` skill).

## 5. Student profile lockdown — the trap that nearly shipped

Students may not edit their own profile at all (name, phone, photo). `/settings` password change is untouched.

**Do NOT drop `"Users can update own profile"`.** It is `USING (id = auth.uid())` with **no role predicate**, so dropping it also breaks:
* **Teachers and employees** — covered by no other `profiles` UPDATE policy, they would lose self-edit entirely (admins and coordinators survive via institution-wide policies).
* **`PasswordResetRequired.tsx`**, which writes `must_reset_password: false` to the student's own row and `throw`s on failure. Every student on a forced reset would be trapped in an infinite loop. This was the highest-severity item in the design.
* **`GuidedTourProvider.tsx`**, whose failure is swallowed by `console.error`, so the tour would silently replay forever.

**Replace it instead**, adding the role predicate to both `USING` and `WITH CHECK`:

```sql
USING      (id = (SELECT auth.uid()) AND NOT public.has_role((SELECT auth.uid()), 'student'))
WITH CHECK (id = (SELECT auth.uid()) AND NOT public.has_role((SELECT auth.uid()), 'student'))
```

Postgres RLS has no column granularity within one policy, so the two legitimate student self-writes moved to narrow SECURITY DEFINER RPCs on `auth.uid()`'s own row: **`clear_password_reset_flag()`** (`must_reset_password`, `last_password_change`, `password_expires_at`) and **`mark_onboarding_complete(_steps jsonb)`** (`onboarding_completed`, `tour_steps_completed`). Any future student self-write gets the same treatment — a column-scoped RPC, never a widened policy.

**Frontend is mandatory, not optional hardening.** `ProfilePage` renders name/phone read-only and hides Save when `isStudent`. A PostgREST UPDATE blocked by RLS returns success-shaped output, so leaving the form mounted gives students a green "Profile updated successfully" toast over a write that never happened (CLAUDE.md §6).

## 6. Client architecture

**[src/lib/avatarStore.ts](../../../src/lib/avatarStore.ts)** — `getAvatarObjectUrl(path)`, plus `forgetAvatar(path)` and `purgeAvatarCache()`.
* **`CACHE_NAME = "user-avatars-v1"` must NOT start with `salci-`** — `main.tsx` purges that prefix on every dev boot (CLAUDE.md §17).
* Memory layer: `Map<path, objectUrl>` plus `Map<path, Promise>` for in-flight dedupe, so N components requesting one path make one request.
* Persistent layer: Cache Storage keyed by a synthetic `/__avatar/{path}` request. Immutable paths mean an entry is never stale.
* Miss path: `supabase.storage.from("user-avatars").download(path)` — the authenticated endpoint, RLS per request.
* **Concurrency cap of 6 in flight** (`MAX_IN_FLIGHT`). Explicit requirement: photo loading must never compete with the page's own queries.
* **A global generation counter, bumped by `purgeAvatarCache()`, is required — a per-path generation is not enough.** Without it a load that started before a purge can repopulate the cache after the purge returned, silently undoing a sign-out on a shared device. `forgetAvatar()` has the same hazard for the removal case.
* Every failure returns `null` and degrades to initials. Guard `typeof caches !== "undefined"` for Safari private mode and insecure contexts.
* **`purgeAvatarCache()` runs on sign-out.** Do not remove it.

**[src/components/shared/UserAvatar.tsx](../../../src/components/shared/UserAvatar.tsx)** — `{ name, email, avatarPath, className, fallbackClassName }`.
* An `IntersectionObserver` on the root; **`getAvatarObjectUrl` is called only once the element is on screen**, so a 40-row page costs the ~10 visible rows, not 40.
* With `avatarPath` null or unresolved it renders exactly today's initials (shared `getInitials` in `src/lib/initials.ts`). That degradation is what made the two-release rollout safe.
* The Avatar root is fixed-size, so there is no layout shift on arrival.

**[src/hooks/useSetUserAvatar.ts](../../../src/hooks/useSetUserAvatar.ts)** — failure ordering copied from `useUploadInstitutionLogo`:
1. **Validate, HEIC first.** iOS reports an **empty** MIME type for HEIC, so `file.type.startsWith("image/")` rejects genuine iPhone photos. Use the extension fallback from `src/lib/hybridImage.ts` and the **lazy** `heic2any` import (~1.5 MB, must stay out of the main bundle).
2. Resize to **256x256 WebP** (~10 KB). `resizeImageForUpload` needed an optional `mimeType` for this: its hardcoded `convertTypes` + `convertSize: 100000` otherwise transcode WebP input *to JPEG*. Existing callers omit it and are unaffected.
3. Upload to `${targetId}/${crypto.randomUUID()}.webp` with `{ contentType: "image/webp", cacheControl: "31536000", upsert: false }`.
4. `rpc("set_user_avatar", ...)`. **On failure, remove the just-uploaded object and throw** so a failed write never leaves an orphan.
5. On success, best-effort remove the returned old path, invalidate queries, `logActivityEvent`.

**Derive the extension from the RESIZED blob's type, never the original filename** — `convertSize: 100000` can transcode PNG/WebP over 100 KB to JPEG, so name and bytes disagree.

**`CameraCapture`** gained an optional `facingMode` prop (default `"environment"`, so existing offline-scan consumers are unchanged) and a filename prefix — the photo sheet passes `"user"` for the selfie camera.

**`UserPhotoSheet`** is the camera/upload/remove surface; the affordance appears on `ProfilePage` (own photo) and the `ViewUserSheet` header avatar, gated by `can_i_set_user_photo`.

## 7. Testing pattern worth reusing

The assertion suite (`e52bc49`) tests RLS by impersonating a real role inside a transaction:

```sql
BEGIN;
  SET LOCAL ROLE authenticated;
  SET LOCAL request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}';
  -- assert the write is rejected / accepted
ROLLBACK;
```

This is the reliable way to prove an RLS or trigger change actually bites, rather than testing as `postgres` (which bypasses everything). Use it for cross-tenant and negative cases too.