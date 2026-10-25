# SALCI Olympiad Phase 4a — Student Auth + Portal + PIN Entry Design

**Status:** Draft v1
**Date:** 2026-05-27
**Parent doc:** [2026-05-26-olympiad-master-decomposition-design.md](./2026-05-26-olympiad-master-decomposition-design.md)
**Source:** SALCI_Olympiad_Build_Prompt2.docx (Phase 4, pre-exam-UI portion)
**Depends on:** Phase 1, 2, 3a, 3b
**Followed by:** Phase 4b (exam UI + submit + session resume)

This phase delivers everything between "credentials distributed" and "exam clock starts": auto-creation of `auth.users` for Olympiad students, login resolver, student dashboard with countdown + study materials, PIN entry validation, and the instructions screen. The actual exam-taking interface lands in Phase 4b.

---

## 1. Scope

In:

- DB: synthetic `auth.users` creation via trigger on `oly_students`; backfill RPC for existing students; `oly_pin_attempt_log` for PIN entry audit
- Edge functions: `oly-student-login-resolve` (roll → synthetic email), `oly-validate-pin` (PIN check + strict batch binding)
- Student-side routes: `/olympiad/login` (public roll-number+DOB form), `/student/olympiad` (dashboard), `/student/olympiad/pin-entry` (PIN screen + instructions), `/student/olympiad/study/:subjectId` (study material list)
- Login UX: a "Continue with roll number" button on the existing `/login` that opens the Olympiad sign-in. Non-SALCI Olympiad students use this; existing-SALCI students can use either their regular SALCI login OR the roll-number flow (same result).
- Trigger that sets `oly_batches.pin_first_used_at = now()` on the first successful PIN entry within a batch's expiry window (this starts the 2-hour countdown server-side)
- Validation rules in `oly-validate-pin`:
  - PIN must match an `oly_batches` row whose `oly_school_id` matches the student's school
  - The student must be in `oly_batch_assignments` for THAT batch (strict batch binding)
  - PIN must not be expired (`pin_first_used_at IS NULL` OR `pin_first_used_at + pin_expiry_minutes` is still in the future)
  - Student must not have an active or completed attempt (Phase 4b will mark attempts; 4a writes a `pin_attempt_log` row)
- Audit log entries for every PIN attempt (success + failure)

Out (deferred to Phase 4b):

- `oly_attempts` / `oly_answers` / `oly_attempt_events` schema (Phase 4b)
- Exam UI itself (Phase 4b)
- Server-side timer state (Phase 4b — the validation in 4a just confirms eligibility)
- Session resume (Phase 4b)
- Fullscreen activation (Phase 4b)
- Submit + auto-submit triggers (Phase 4b)

---

## 2. Database schema (additive migration)

### 2.1 Auto-create `auth.users` for Olympiad students

The trigger fires AFTER INSERT on `oly_students`. It uses Supabase's admin functions via a SECURITY DEFINER function. Because Supabase's `auth.users` table is owned by `supabase_auth_admin`, direct `INSERT INTO auth.users` from a regular trigger function fails. The clean path is:

**Option A**: Fire the trigger and have it CALL an edge function (`oly-create-student-auth`) via `pg_net`.
**Option B**: Use the trigger to populate a queue table; an edge function drains it.
**Option C**: Skip the trigger; do it inline in `oly-cash-enroll` and the Phase 2 promotion trigger via service-role client.

**Decision: Option C** — extend `oly_cash-enroll` and add a fire-and-forget step to the promotion trigger flow that creates the auth.user. Cleanest. Specifically:

For Phase 2's online enrollment: when `oly_enrollment_pending.status` flips to `paid`, the existing promotion trigger creates `oly_students` row. Add a step in `oly-payment-webhook` (after the UPDATE) that ALSO calls `supabase.auth.admin.createUser({...})` with the synthetic email.

For Phase 3a's cash enrollment: `oly-cash-enroll` already runs as service-role and can create the auth.user inline.

But we ALSO need to **backfill existing students**. A one-off RPC `oly_backfill_student_auth()` (super-admin only) iterates `oly_students` where `profile_id IS NULL` and creates auth users for them, then writes their `profile_id` back.

Phase 4a ships:
1. A schema change: add `oly_students.auth_user_id uuid references auth.users(id) on delete set null` (different from `profile_id` because Olympiad-only students have no profile)
2. Edit the existing `oly-payment-webhook` to call the auth-create step
3. Edit the existing `oly-cash-enroll` to call the auth-create step
4. A new edge function `oly-backfill-student-auth` for existing students

### 2.2 `oly_pin_attempt_log`

```sql
create table public.oly_pin_attempt_log (
  id uuid primary key default gen_random_uuid(),
  oly_school_id uuid references public.oly_schools(id) on delete cascade,
  oly_student_id uuid references public.oly_students(id) on delete set null,
  attempted_pin text not null,
  ip_address text,
  user_agent text,
  outcome text not null check (outcome in (
    'success', 'wrong_pin', 'expired_pin', 'wrong_batch',
    'already_attempted', 'student_not_found', 'enrollment_closed'
  )),
  resolved_batch_id uuid references public.oly_batches(id) on delete set null,
  attempted_at timestamptz not null default now()
);
create index idx_opal_school on public.oly_pin_attempt_log(oly_school_id);
create index idx_opal_student on public.oly_pin_attempt_log(oly_student_id);
create index idx_opal_outcome on public.oly_pin_attempt_log(outcome);
create index idx_opal_attempted_at on public.oly_pin_attempt_log(attempted_at);
```

RLS: super_admin all + school_admin SELECT own school.

### 2.3 `oly_students.auth_user_id` addition

```sql
alter table public.oly_students
  add column auth_user_id uuid references auth.users(id) on delete set null;
create index idx_oly_students_auth_user on public.oly_students(auth_user_id);
```

This is separate from `profile_id` because:
- `profile_id` is set when the Olympiad student IS an existing SALCI student (they have a regular `profiles` row)
- `auth_user_id` is set when we create a dedicated Olympiad auth user (for non-SALCI students OR as a parallel ID for SALCI students who use the roll-number login)

For SALCI students who use their existing SALCI login, both columns are populated and point to the same underlying user (the SALCI auth user, and `profile_id` points to their existing profile).

For non-SALCI students, `profile_id` is NULL and `auth_user_id` is the synthetic Olympiad auth user.

### 2.4 RLS extension

Add to `oly_students`:
```sql
create policy "student SELECT self via auth_user_id" on public.oly_students for select
  using (auth_user_id = auth.uid());
```

(The Phase 3a `student SELECT self` policy uses `profile_id`. Add this additional policy so non-SALCI students with no `profile_id` can still see themselves.)

Similarly extend `oly_student_can_read` helper:
```sql
create or replace function public.oly_student_can_read(p_uid uuid, p_oly_student_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from public.oly_students s
     where s.id = p_oly_student_id
       and (
         s.profile_id = p_uid
         or s.auth_user_id = p_uid
         or public.oly_is_school_admin_for(p_uid, s.oly_school_id)
         or public.oly_is_teacher_for_class(p_uid, s.oly_school_id, s.grade_level_id)
       )
  );
$$;
```

### 2.5 PIN-first-use trigger

When `oly-validate-pin` succeeds and records a `success` outcome in `oly_pin_attempt_log`, set `oly_batches.pin_first_used_at = now()` if it's still NULL:

```sql
create or replace function public.oly_set_pin_first_used()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.outcome = 'success' and new.resolved_batch_id is not null then
    update public.oly_batches
       set pin_first_used_at = now()
     where id = new.resolved_batch_id
       and pin_first_used_at is null;
  end if;
  return new;
end;
$$;

create trigger oly_pin_attempt_log_first_use_trg
  after insert on public.oly_pin_attempt_log
  for each row execute function public.oly_set_pin_first_used();
```

The trigger is idempotent — only sets `pin_first_used_at` if it's NULL.

---

## 3. Edge functions

### 3.1 `oly-student-login-resolve`

Public POST endpoint. Input: `{ identifier: string, dob: string }` where `identifier` is either a roll number or an admission number.

1. Try to resolve `identifier` as a roll number: SELECT `oly_students` WHERE `roll_number = identifier`. If found, get `auth_user_id`.
2. If not found, try admission number: SELECT `oly_students` WHERE `admission_number = identifier`. If found, get `auth_user_id` (or `profile_id` for SALCI students).
3. If still not found, return 404.
4. Validate DOB: `date_of_birth` must match the supplied DOB.
5. Return the synthetic email for client-side `signInWithPassword`: `{ email, hint: "Use your DOB in ddmmyy format as the password" }`.

The frontend then calls `supabase.auth.signInWithPassword({ email, password: dobDdMmYy })` directly. This keeps auth state managed by Supabase, no custom JWT to maintain.

### 3.2 `oly-validate-pin`

Authenticated POST endpoint. Input: `{ pin: string }`. Returns: `{ ok: true, batch_id, instructions_visible: true } | { ok: false, reason: "wrong_pin" | "expired_pin" | "wrong_batch" | ... }`.

Algorithm:
1. Resolve current user → `oly_students` row. If not found, log `student_not_found` and return failure.
2. Get the student's `oly_school_id` + `oly_batch_assignments` row.
3. If student has no batch assignment, log `wrong_batch` and return failure.
4. Look up the batch by `pin = supplied_pin AND oly_school_id = student's school`.
5. If no batch found → log `wrong_pin`.
6. If `batch.id !== student.assigned_batch_id` → log `wrong_batch` (strict binding).
7. If `pin_first_used_at IS NOT NULL AND now() > pin_first_used_at + pin_expiry_minutes * interval '1 minute'` → log `expired_pin`.
8. If student already has an `oly_attempts` row with status NOT in (NULL, 'not_started') — log `already_attempted`. (Phase 4a: there's no `oly_attempts` table yet, so this check is no-op; Phase 4b adds it.)
9. Verify `oly_schools.status` is `batches_scheduled` OR `exam_in_progress`. If `enrollment_closed`, log `enrollment_closed` (means lock-schedule never ran for this school).
10. On success: insert `oly_pin_attempt_log` with outcome=`success`, resolved_batch_id. The trigger sets `pin_first_used_at`.
11. Return `{ ok: true, batch_id, exam_duration_minutes (from campaign), subjects: [...] }`.

### 3.3 `oly-backfill-student-auth` (super-admin only)

Iterates `oly_students` where `auth_user_id IS NULL AND profile_id IS NULL` (i.e. non-SALCI students with no auth account yet). For each:
1. Compute synthetic email: `{roll_number_lowercase}@olympiad.salci.org`
2. Compute DOB password: ddmmyy from `date_of_birth`
3. `supabase.auth.admin.createUser({ email, password, email_confirm: true })`
4. Update `oly_students.auth_user_id = new_user.id`

Idempotent — skips students that already have `auth_user_id` set. Returns count of users created.

### 3.4 Edit existing edge functions

- `supabase/functions/oly-payment-webhook/index.ts` (Phase 2): after successful UPDATE that flips status to 'paid', read back `oly_enrollment_pending.promoted_student_id`, then call the synthetic-auth-user creation inline before invoking receipt-generate.
- `supabase/functions/oly-cash-enroll/index.ts` (Phase 3a): same — after inserting `oly_students`, create the synthetic auth user.

Both edits add a small helper inline:

```ts
async function createOlympiadAuthUser(supabase: SupabaseClient, oly_student_id: string): Promise<string | null> {
  const { data: student } = await supabase
    .from("oly_students")
    .select("roll_number, date_of_birth, profile_id, auth_user_id")
    .eq("id", oly_student_id)
    .single();
  if (!student || student.auth_user_id || student.profile_id) return student?.auth_user_id ?? null;

  const dob = new Date(student.date_of_birth);
  const password = `${String(dob.getDate()).padStart(2, "0")}${String(dob.getMonth() + 1).padStart(2, "0")}${String(dob.getFullYear()).slice(-2)}`;
  const email = `${student.roll_number.toLowerCase()}@olympiad.salci.org`;

  const { data: newUser, error } = await supabase.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (error) {
    console.error("Failed to create Olympiad auth user", error);
    return null;
  }

  await supabase
    .from("oly_students")
    .update({ auth_user_id: newUser.user.id })
    .eq("id", oly_student_id);

  return newUser.user.id;
}
```

---

## 4. Student-side pages

### 4.1 `/olympiad/login` — public dedicated login

Mounted OUTSIDE `ProtectedRoute`, same shell pattern as Phase 2's `/olympiad/:schoolCode` page.

Fields:
- "Roll number or admission number" (text input)
- "Date of birth" (date picker — converts to ddmmyy password client-side)
- "Sign in" button

On submit:
1. Compute DOB in ddmmyy format
2. Call `oly-student-login-resolve` with identifier + dob → get synthetic email
3. Call `supabase.auth.signInWithPassword({ email, password: ddmmyy })`
4. On success, redirect to `/student/olympiad`
5. On failure (wrong identifier OR wrong DOB), generic error: "Roll number or date of birth is incorrect. Please check the credentials provided by your school."

### 4.2 `/student/olympiad` — Olympiad dashboard

For SALCI students: this page is also exposed via the existing student sidebar (which gets an Olympiad entry gated by `olympiad` feature flag + checking `oly_students.profile_id = auth.uid()` exists).

For non-SALCI students: this is their entire portal. No regular `/student/dashboard` because they have no role beyond Olympiad.

Layout:
- `PageHeader` with eyebrow "Olympiad", title "Welcome, {full_name}", subtitle "{school_name} · Roll {roll_number}"
- `StatTileGrid` (mobile-friendly):
  - "Your batch" — date + time, color-coded by proximity (red if today, amber if tomorrow, neutral otherwise)
  - "Countdown" — live ticking "3 days, 5 hours"
  - "Subjects" — 3 subject names as badges
- Study material section: lazy-loaded `useOlympiadStudentStudyMaterials()` query that fetches PDFs the student's chosen subjects have available. Each item is a `ListRow` with title + download (signed URL, 5 min TTL).
- "Start exam" button: visible always but enabled only on batch day. Tap → `/student/olympiad/pin-entry`.
- For SALCI students post-Day-30 (handled by Phase 5): this page is dormant. The dormancy job hides it from the sidebar.

### 4.3 `/student/olympiad/pin-entry` — PIN entry + instructions

Two-step:

**Step 1: PIN**
- Single 6-character monospace input
- "Enter PIN" submit button
- On submit: call `oly-validate-pin` → handle result
- Failure messages by outcome:
  - `wrong_pin` / `wrong_batch`: "Incorrect PIN. Please check the PIN your supervisor has shared."
  - `expired_pin`: "This batch's entry window has closed. Please contact your school."
  - `already_attempted`: "You have already submitted this exam. Contact your school if this is an error."
  - `student_not_found`: "We can't find your enrollment. Please contact your school."
  - `enrollment_closed`: "This exam is not yet scheduled. Please contact your school."

**Step 2: Instructions** (only on successful PIN)
- List of rules:
  - "The exam is {duration} minutes long"
  - "It contains questions from 3 subjects shown as tabs"
  - "You can switch between sections freely"
  - "You can mark questions for review"
  - "The exam will go into fullscreen — do not leave fullscreen mode"
  - "Tab-switching counts as a proctoring violation; 3 violations auto-submit your exam"
- "I'm ready" button — Phase 4a navigates to `/student/olympiad/exam-pending` (placeholder that says "Exam UI ships in Phase 4b"); Phase 4b will navigate to `/student/olympiad/exam` for the actual exam.

### 4.4 `/student/olympiad/study/:subjectId`

List of study material PDFs for a specific subject (filtered to the student's chosen subjects + their grade level). Each item opens via a signed URL (5 min TTL — generated server-side via an RPC).

The RPC `oly_get_student_study_material_url(student_id, material_id)`:
1. Verifies the student owns the request via auth.uid()
2. Verifies the student's `subject_ids` include this material's subject
3. Verifies the material's grade_level_id matches the student's grade_level_id
4. Generates a signed URL
5. Returns it

This prevents a student from poking at other students' study material.

---

## 5. Sidebar wiring

- SALCI student sidebar: add "Olympiad" entry gated by `useOlympiadStudentEnrollment()` returning true (student has an active `oly_students` row in current campaign)
- Non-SALCI student sidebar: only "Olympiad" + "Sign out" (no other features)
- The hook caches with `staleTime: 60_000`

---

## 6. Hooks

- `useOlympiadStudentEnrollment()` — current student's `oly_students` row for active campaign (null if none)
- `useOlympiadStudentBatch(olyStudentId)` — student's batch assignment via `oly_batches_no_pin` (no PIN visible)
- `useOlympiadStudentStudyMaterials(subjectIds, gradeLevelId)` — material list filtered to student's chosen subjects + grade
- `useOlympiadStudyMaterialUrl()` — mutation hook generating signed URL via RPC
- `useOlympiadPinValidate()` — mutation calling `oly-validate-pin`, returns the result

All hooks use explicit `staleTime`, all errors route through `toastError`.

---

## 7. Routing

```
/olympiad/login                            → OlympiadStudentLoginPage (PUBLIC)
/student/olympiad                          → OlympiadStudentDashboardPage (student role)
/student/olympiad/pin-entry                → OlympiadStudentPinEntryPage (student role)
/student/olympiad/study/:subjectId         → OlympiadStudentStudyPage (student role)
/student/olympiad/exam-pending             → placeholder until Phase 4b
```

---

## 8. Acceptance criteria

- A new non-SALCI student created via Phase 2 online flow OR Phase 3a cash flow ends up with an `auth.users` row + `auth_user_id` set on `oly_students`
- Backfill RPC creates auth users for any existing students without them
- `/olympiad/login` resolves a roll-number+DOB to a sign-in, lands on `/student/olympiad`
- Dashboard shows batch date, countdown, study materials
- Study material PDFs open via signed URLs that respect student scoping
- PIN entry validates against assigned batch + expiry window + duplicate attempt
- Successful PIN entry sets `oly_batches.pin_first_used_at` (first-student case) starting the 2-hour clock
- All PIN attempts logged with outcome
- Failure paths show appropriate user-friendly messages
- SALCI students can ALSO log in via their regular `/login` and see the Olympiad tab if enrolled
- No PIN ever appears in student-facing UI
- §5a contract passes

---

## 9. Risks and open items

- **Synthetic email collisions**: roll numbers are globally unique by design. Synthetic emails inherit that uniqueness. The `@olympiad.salci.org` subdomain doesn't need to exist publicly — these emails never receive mail.
- **Existing SALCI student double-auth**: a SALCI student with an existing `profiles` row can choose to log in either via regular SALCI auth (sees full SALCI portal + Olympiad tab) or via roll-number Olympiad-only login (sees only Olympiad). Both work because the `oly_students` row has both `profile_id` (from SALCI auth) and we DON'T create a duplicate `auth_user_id` for SALCI students. The hook `useOlympiadStudentEnrollment()` resolves via `OR (s.profile_id = auth.uid()) OR (s.auth_user_id = auth.uid())`.
- **DOB password security**: weak by design (6 digits). The exam is short-lived (90 minutes) and physically supervised. Accepted risk per docx.
- **Student auth user cleanup**: Day-60 dormancy job (Phase 5) deletes `auth.users` for non-SALCI students. The existing CASCADE chain handles `oly_students.auth_user_id → SET NULL` (since the column is `ON DELETE SET NULL`).
- **Trigger vs inline auth-create**: chose inline to avoid pg_net round-trips. Trade-off: the `oly-payment-webhook` and `oly-cash-enroll` functions get slightly larger. Acceptable.
- **Backfill RPC must run before first student logs in**: deployment note — after this migration applies, super_admin invokes `oly-backfill-student-auth` once to backfill all existing students. Document this in commit message.
- **Email confirmation**: `email_confirm: true` on createUser bypasses the email verification flow (which would fail on synthetic emails anyway). This is intentional and safe — the synthetic emails are not user-facing.
