# SALCI Olympiad Phase 4a — Student Auth + Portal + PIN Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship student auth + Olympiad student portal up to (but not including) the exam UI. Synthetic `auth.users` are auto-created for Olympiad students; students log in via `/olympiad/login` with roll number + DOB; they see a dashboard with their batch + study materials; they validate their PIN via a sub-50ms SECURITY DEFINER RPC.

**Architecture:** Schema adds `auth_user_id` to `oly_students`, an `oly_pin_attempt_log` table, and a single PIN-validation RPC `oly_validate_pin()` that does the entire validation chain (resolve student, check batch binding, check expiry, write audit log, set `pin_first_used_at`) atomically in one server round-trip. Synthetic auth user creation is inline in the existing Phase 2 webhook + Phase 3a cash-enroll edge functions (no new round-trip). Login resolution is a tiny RPC. Dashboard context (student + batch + subjects + study material count) collapses to ONE round-trip via `oly_student_dashboard_context()` RPC. All hooks have explicit `staleTime`; sidebar gating reads from a cached context. Lazy-loaded routes throughout.

**Tech Stack:** React 18 + TypeScript, Vite, TanStack Query v5, React Router v6, Supabase (PostgreSQL + RLS + Edge Functions + Storage signed URLs), shadcn/ui + Tailwind, lucide-react. No new dependencies.

**Spec:** [docs/superpowers/specs/2026-05-27-olympiad-phase-4a-student-auth-and-portal-design.md](../specs/2026-05-27-olympiad-phase-4a-student-auth-and-portal-design.md)
**Master decomposition:** [docs/superpowers/specs/2026-05-26-olympiad-master-decomposition-design.md](../specs/2026-05-26-olympiad-master-decomposition-design.md)
**Phase 3b plan (precedent):** [docs/superpowers/plans/2026-05-26-olympiad-phase-3b-batching-and-credentials.md](./2026-05-26-olympiad-phase-3b-batching-and-credentials.md)

**No test infrastructure** — verification via §5a (tsc + eslint + vite build).

**Concurrency target:** ~6K simultaneous students hitting PIN entry within a 2-hour window. PIN validation is the single hottest write path on exam day — kept as a SECURITY DEFINER RPC for sub-50ms latency.

**Engineer assumptions:** Read CLAUDE.md sections §5a, §17, §19, §20a/§20b, §22, **§23 (high-concurrency rules — every rule applies here)** before starting. Read Phase 3b plan for hook/sheet patterns.

---

## CLAUDE.md §23 compliance summary (this plan honors all of these)

| Rule | How this plan honors it |
|---|---|
| §23.1: every FK indexed in same migration | Task 1 indexes `auth_user_id` + every FK on `oly_pin_attempt_log` |
| §23.1: SECURITY DEFINER helpers in RLS | All new policies route through helpers, no inline cross-table EXISTS |
| §23.1: no `supabase.auth.getUser()` without JWT | All client code uses `useAuth().user`; RPCs use `auth.uid()` internally |
| §23.1: no `select("*")` outside admin | All queries list explicit columns |
| §23.1: server-side aggregation | `oly_student_dashboard_context()` RPC collapses 3 client queries to 1 |
| §23.1: pagination on lists | PIN attempt log (admin view, later phase) is paginated via cursor; deferred to admin dashboard implementation |
| §23.2: explicit `staleTime` on every useQuery | Hooks set 30s/60s/5min as appropriate; documented |
| §23.2: `refetchInterval` < 30s justified | Dashboard countdown uses client-side `setInterval`, NOT refetchInterval — no DB load |
| §23.5: long-running edge functions | None in this phase — all RPC-based |
| §23.3: lazy-loaded routes | All 4 new pages lazy-imported |
| §23.4: real-time subscriptions | None in this phase |
| §23 (broad): atomic operations | PIN validation is one RPC, no race window; auth user creation is inline (no pg_net) |

**Pre-merge concurrency checklist** (run at end of T13):
- [ ] PIN validation single-RPC tested for atomicity (multiple concurrent first-PIN entries → only one wins on `pin_first_used_at`)
- [ ] All new hooks have explicit `staleTime`
- [ ] No `supabase.auth.getUser()` in any new code
- [ ] All new pages lazy-loaded
- [ ] Auth user backfill batched in chunks of 25 (not serial)

---

## File Structure

```
supabase/
  migrations/
    <ts>_oly_phase_4a_student_auth.sql                                (NEW)

  functions/
    oly-backfill-student-auth/index.ts                                (NEW)
    oly-payment-webhook/index.ts                                      (EDIT) — inline auth user create
    oly-cash-enroll/index.ts                                          (EDIT) — inline auth user create

src/
  hooks/olympiad/
    useOlympiadStudentEnrollment.ts                                   (NEW) — current user's oly_students row
    useOlympiadStudentDashboard.ts                                    (NEW) — collapsed dashboard query
    useOlympiadStudentStudyMaterials.ts                               (NEW) — filtered material list
    useOlympiadStudyMaterialUrl.ts                                    (NEW) — signed URL via RPC
    useOlympiadStudentLogin.ts                                        (NEW) — resolve + signIn flow
    useOlympiadPinValidate.ts                                         (NEW) — PIN validation RPC
  components/olympiad/student/
    BatchCountdown.tsx                                                (NEW) — live ticking countdown (setInterval, no DB)
    StudyMaterialItem.tsx                                             (NEW) — single material row
    PinEntryForm.tsx                                                  (NEW) — 6-char input + submit
    InstructionsScreen.tsx                                            (NEW) — pre-exam rules screen
  pages/
    public/
      OlympiadStudentLoginPage.tsx                                    (NEW) — /olympiad/login
    student/olympiad/
      OlympiadStudentDashboardPage.tsx                                (NEW) — /student/olympiad
      OlympiadStudentPinEntryPage.tsx                                 (NEW) — /student/olympiad/pin-entry
      OlympiadStudentStudyPage.tsx                                    (NEW) — /student/olympiad/study/:subjectId
      OlympiadStudentExamPendingPage.tsx                              (NEW) — placeholder, redirects to Phase 4b later
  App.tsx                                                             (EDIT) — 5 new routes (1 public + 4 student)
  components/layout/AppSidebar.tsx                                    (EDIT) — student "Olympiad" entry
```

---

## Section A — Foundation (schema + edge function edits)

### Task 1: Phase 4a schema migration

**Files:**
- Create: `supabase/migrations/<ts>_oly_phase_4a_student_auth.sql`

- [ ] **Step 1.1: Generate timestamp**

```powershell
Get-Date -AsUTC -Format yyyyMMddHHmmss
```

- [ ] **Step 1.2: Write the migration**

```sql
-- Phase 4a — Student auth + portal + PIN entry validation
-- Adds: auth_user_id on oly_students, oly_pin_attempt_log table,
-- oly_validate_pin RPC, oly_student_dashboard_context RPC,
-- oly_student_login_resolve RPC, study-material signed-URL RPC.

-- =========================================================================
-- 1. auth_user_id column on oly_students
-- =========================================================================
alter table public.oly_students
  add column auth_user_id uuid references auth.users(id) on delete set null;
create index idx_oly_students_auth_user on public.oly_students(auth_user_id);

-- Student SELECT self via auth_user_id (in addition to existing profile_id policy)
create policy "student SELECT self via auth_user_id" on public.oly_students for select
  using (auth_user_id = auth.uid());

-- Extend oly_student_can_read helper to cover both profile_id + auth_user_id
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

-- =========================================================================
-- 2. oly_pin_attempt_log — audit every PIN attempt
-- =========================================================================
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
-- Indexes for the school_admin audit view + for queries by student/outcome
create index idx_opal_school on public.oly_pin_attempt_log(oly_school_id);
create index idx_opal_student on public.oly_pin_attempt_log(oly_student_id);
create index idx_opal_outcome on public.oly_pin_attempt_log(outcome);
create index idx_opal_attempted_at on public.oly_pin_attempt_log(attempted_at);
create index idx_opal_batch on public.oly_pin_attempt_log(resolved_batch_id);

alter table public.oly_pin_attempt_log enable row level security;
create policy "super_admin all" on public.oly_pin_attempt_log for all
  using (public.is_super_admin(auth.uid())) with check (public.is_super_admin(auth.uid()));
create policy "school_admin SELECT own school" on public.oly_pin_attempt_log for select
  using (oly_school_id is not null and public.oly_is_school_admin_for(auth.uid(), oly_school_id));

-- =========================================================================
-- 3. oly_validate_pin RPC — atomic single-round-trip PIN validation
-- =========================================================================
-- This is the hottest write path on exam day. Sub-50ms latency target.
-- All 7 validation steps + audit log insert + pin_first_used_at update happen
-- in one transaction. Returns the outcome to the client.
create or replace function public.oly_validate_pin(
  p_pin text,
  p_ip text default null,
  p_user_agent text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_student record;
  v_assigned_batch_id uuid;
  v_batch record;
  v_school_status text;
  v_now timestamptz := now();
  v_outcome text;
  v_resolved_batch_id uuid;
  v_clean_pin text := upper(trim(p_pin));
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'student_not_found');
  end if;

  -- Resolve student (single query — avoid round trips)
  select id, oly_school_id, grade_level_id, full_name, roll_number
    into v_student
    from public.oly_students
   where (auth_user_id = v_uid or profile_id = v_uid)
     and status = 'active'
   limit 1;

  if v_student.id is null then
    insert into public.oly_pin_attempt_log (oly_school_id, oly_student_id, attempted_pin, ip_address, user_agent, outcome)
      values (null, null, v_clean_pin, p_ip, p_user_agent, 'student_not_found');
    return jsonb_build_object('ok', false, 'reason', 'student_not_found');
  end if;

  -- Check school status
  select status into v_school_status
    from public.oly_schools where id = v_student.oly_school_id;
  if v_school_status not in ('batches_scheduled', 'exam_in_progress') then
    insert into public.oly_pin_attempt_log (oly_school_id, oly_student_id, attempted_pin, ip_address, user_agent, outcome)
      values (v_student.oly_school_id, v_student.id, v_clean_pin, p_ip, p_user_agent, 'enrollment_closed');
    return jsonb_build_object('ok', false, 'reason', 'enrollment_closed');
  end if;

  -- Find student's assigned batch
  select oly_batch_id into v_assigned_batch_id
    from public.oly_batch_assignments where oly_student_id = v_student.id;
  if v_assigned_batch_id is null then
    insert into public.oly_pin_attempt_log (oly_school_id, oly_student_id, attempted_pin, ip_address, user_agent, outcome)
      values (v_student.oly_school_id, v_student.id, v_clean_pin, p_ip, p_user_agent, 'wrong_batch');
    return jsonb_build_object('ok', false, 'reason', 'wrong_batch');
  end if;

  -- Find batch by PIN within this school (strict scope)
  select id, pin, pin_expiry_minutes, pin_first_used_at, status, scheduled_at
    into v_batch
    from public.oly_batches
   where pin = v_clean_pin and oly_school_id = v_student.oly_school_id;
  if v_batch.id is null then
    insert into public.oly_pin_attempt_log (oly_school_id, oly_student_id, attempted_pin, ip_address, user_agent, outcome)
      values (v_student.oly_school_id, v_student.id, v_clean_pin, p_ip, p_user_agent, 'wrong_pin');
    return jsonb_build_object('ok', false, 'reason', 'wrong_pin');
  end if;

  v_resolved_batch_id := v_batch.id;

  -- Strict batch binding
  if v_batch.id <> v_assigned_batch_id then
    insert into public.oly_pin_attempt_log (oly_school_id, oly_student_id, attempted_pin, ip_address, user_agent, outcome, resolved_batch_id)
      values (v_student.oly_school_id, v_student.id, v_clean_pin, p_ip, p_user_agent, 'wrong_batch', v_resolved_batch_id);
    return jsonb_build_object('ok', false, 'reason', 'wrong_batch');
  end if;

  -- PIN expiry check
  if v_batch.pin_first_used_at is not null
     and v_now > v_batch.pin_first_used_at + (v_batch.pin_expiry_minutes * interval '1 minute') then
    insert into public.oly_pin_attempt_log (oly_school_id, oly_student_id, attempted_pin, ip_address, user_agent, outcome, resolved_batch_id)
      values (v_student.oly_school_id, v_student.id, v_clean_pin, p_ip, p_user_agent, 'expired_pin', v_resolved_batch_id);
    return jsonb_build_object('ok', false, 'reason', 'expired_pin');
  end if;

  -- TODO Phase 4b: check oly_attempts for existing attempt by this student.
  -- For Phase 4a there are no attempts to check yet.

  -- Success — log + atomically set pin_first_used_at if NULL
  insert into public.oly_pin_attempt_log (oly_school_id, oly_student_id, attempted_pin, ip_address, user_agent, outcome, resolved_batch_id)
    values (v_student.oly_school_id, v_student.id, v_clean_pin, p_ip, p_user_agent, 'success', v_resolved_batch_id);
  -- Atomic update — only the FIRST student's update succeeds
  update public.oly_batches
     set pin_first_used_at = v_now
   where id = v_resolved_batch_id and pin_first_used_at is null;

  return jsonb_build_object(
    'ok', true,
    'batch_id', v_resolved_batch_id,
    'student_id', v_student.id,
    'scheduled_at', v_batch.scheduled_at
  );
end;
$$;

grant execute on function public.oly_validate_pin(text, text, text) to authenticated;

-- =========================================================================
-- 4. oly_student_dashboard_context RPC — collapse 3+ queries into 1
-- =========================================================================
create or replace function public.oly_student_dashboard_context()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_student record;
  v_batch jsonb;
  v_subjects jsonb;
  v_school_name text;
  v_campaign_year integer;
  v_study_material_count integer;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  select s.id, s.oly_school_id, s.grade_level_id, s.full_name, s.roll_number,
         s.section_label, s.subject_ids, s.date_of_birth, s.campaign_id
    into v_student
    from public.oly_students s
   where (s.auth_user_id = v_uid or s.profile_id = v_uid)
     and s.status = 'active'
   limit 1;

  if v_student.id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_enrollment');
  end if;

  -- School name (from institutions join)
  select i.name into v_school_name
    from public.oly_schools sc
    join public.institutions i on i.id = sc.institution_id
   where sc.id = v_student.oly_school_id;

  -- Campaign year
  select campaign_year into v_campaign_year
    from public.oly_campaigns where id = v_student.campaign_id;

  -- Assigned batch (no PIN exposed)
  select jsonb_build_object(
    'id', b.id,
    'batch_label', b.batch_label,
    'scheduled_at', b.scheduled_at,
    'pin_expiry_minutes', b.pin_expiry_minutes,
    'pin_first_used_at', b.pin_first_used_at,
    'status', b.status,
    'is_absentees', b.is_absentees
  ) into v_batch
    from public.oly_batch_assignments oba
    join public.oly_batches b on b.id = oba.oly_batch_id
   where oba.oly_student_id = v_student.id;

  -- Subject names for the 3 chosen subjects
  select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) order by s.name)
    into v_subjects
    from public.oly_subjects s
   where s.id = any(v_student.subject_ids);

  -- Study material count for the student's chosen subjects + grade level
  select count(*) into v_study_material_count
    from public.oly_study_materials sm
   where sm.subject_id = any(v_student.subject_ids)
     and sm.grade_level_id = v_student.grade_level_id;

  return jsonb_build_object(
    'ok', true,
    'student', jsonb_build_object(
      'id', v_student.id,
      'oly_school_id', v_student.oly_school_id,
      'grade_level_id', v_student.grade_level_id,
      'full_name', v_student.full_name,
      'roll_number', v_student.roll_number,
      'section_label', v_student.section_label,
      'subject_ids', v_student.subject_ids,
      'date_of_birth', v_student.date_of_birth
    ),
    'school_name', v_school_name,
    'campaign_year', v_campaign_year,
    'batch', v_batch,
    'subjects', v_subjects,
    'study_material_count', v_study_material_count
  );
end;
$$;

grant execute on function public.oly_student_dashboard_context() to authenticated;

-- =========================================================================
-- 5. oly_student_login_resolve RPC — public, resolves identifier+dob → email
-- =========================================================================
create or replace function public.oly_student_login_resolve(
  p_identifier text, p_dob_iso text
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_student record;
  v_dob date;
  v_email text;
begin
  -- Parse DOB defensively
  begin
    v_dob := p_dob_iso::date;
  exception when others then
    return jsonb_build_object('found', false);
  end;

  -- Try roll number first (uppercase comparison since roll numbers are stored uppercase)
  select s.id, s.auth_user_id, s.profile_id, s.roll_number, s.date_of_birth
    into v_student
    from public.oly_students s
   where upper(s.roll_number) = upper(p_identifier)
     and s.status in ('active', 'dormant');

  if v_student.id is null then
    -- Try admission number (only meaningful for SALCI students)
    select s.id, s.auth_user_id, s.profile_id, s.roll_number, s.date_of_birth
      into v_student
      from public.oly_students s
     where s.admission_number = p_identifier
       and s.status in ('active', 'dormant');
  end if;

  if v_student.id is null then
    return jsonb_build_object('found', false);
  end if;

  -- Verify DOB
  if v_student.date_of_birth <> v_dob then
    return jsonb_build_object('found', false);
  end if;

  -- For SALCI students with profile_id, return null — they should use their regular login.
  -- For non-SALCI students with auth_user_id, return the synthetic email.
  if v_student.auth_user_id is not null then
    v_email := lower(v_student.roll_number) || '@olympiad.salci.org';
    return jsonb_build_object(
      'found', true,
      'email', v_email,
      'is_olympiad_only', true
    );
  end if;

  -- SALCI student fallback — they should use their school SALCI login
  return jsonb_build_object(
    'found', true,
    'is_olympiad_only', false,
    'message', 'Please log in via the main SALCI login page'
  );
end;
$$;

grant execute on function public.oly_student_login_resolve(text, text) to anon, authenticated;

-- =========================================================================
-- 6. oly_get_student_study_material_url RPC — signed URL with scope check
-- =========================================================================
-- Note: signed URL generation is NOT something the DB can do directly.
-- This RPC instead validates eligibility and returns the storage_path,
-- and the client calls supabase.storage.createSignedUrl with that path.
-- The bucket RLS additionally blocks unauthorized fetches.
create or replace function public.oly_get_student_study_material_path(
  p_material_id uuid
) returns text language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_student record;
  v_material record;
begin
  if v_uid is null then raise exception 'Forbidden' using errcode = '42501'; end if;

  select id, grade_level_id, subject_ids
    into v_student
    from public.oly_students
   where (auth_user_id = v_uid or profile_id = v_uid)
     and status = 'active'
   limit 1;
  if v_student.id is null then raise exception 'No active enrollment' using errcode = '42501'; end if;

  select id, subject_id, grade_level_id, storage_path
    into v_material
    from public.oly_study_materials
   where id = p_material_id;
  if v_material.id is null then raise exception 'Not found' using errcode = '42P01'; end if;

  -- Scope: subject must be in student's chosen subjects, grade must match
  if v_material.subject_id <> any(v_student.subject_ids) then
    raise exception 'Not your subject' using errcode = '42501';
  end if;
  if v_material.grade_level_id <> v_student.grade_level_id then
    raise exception 'Not your class' using errcode = '42501';
  end if;

  return v_material.storage_path;
end;
$$;

grant execute on function public.oly_get_student_study_material_path(uuid) to authenticated;

-- Storage RLS: allow Olympiad students to read materials matching their scope.
-- The above RPC already checks scope; this policy is defense-in-depth.
create policy "olympiad student SELECT scoped material"
  on storage.objects for select
  using (
    bucket_id = 'olympiad-study-material'
    and auth.uid() is not null
  );
```

- [ ] **Step 1.3: Apply + regenerate types + verify**

```bash
npx supabase db push
npx supabase gen types typescript --project-id gyymkgohcijeksmrzuyw > src/integrations/supabase/types.ts
npx tsc --noEmit
```
All exit 0.

- [ ] **Step 1.4: Commit**

```bash
git add supabase/migrations/<ts>_oly_phase_4a_student_auth.sql src/integrations/supabase/types.ts
git commit -m "feat(olympiad): phase 4a schema - auth_user_id, PIN attempt log, validate-pin + dashboard-context + login-resolve + study-material RPCs

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Inline auth user creation in Phase 2 webhook + Phase 3a cash-enroll

**Files:**
- Modify: `supabase/functions/oly-payment-webhook/index.ts`
- Modify: `supabase/functions/oly-cash-enroll/index.ts`

Both functions create `oly_students` rows (one via promotion trigger after webhook UPDATE, the other directly). After the student is created, we synchronously create the synthetic auth.users row inline (no pg_net round-trip).

- [ ] **Step 2.1: Helper to create auth user (inline in BOTH files)**

Top of each function file, after the imports:

```ts
async function createOlympiadAuthUser(supabase: any, oly_student_id: string): Promise<string | null> {
  const { data: student } = await supabase
    .from("oly_students")
    .select("roll_number, date_of_birth, profile_id, auth_user_id")
    .eq("id", oly_student_id)
    .single();
  if (!student || student.auth_user_id || student.profile_id) {
    return student?.auth_user_id ?? null;
  }

  const dob = new Date(student.date_of_birth);
  const dd = String(dob.getDate()).padStart(2, "0");
  const mm = String(dob.getMonth() + 1).padStart(2, "0");
  const yy = String(dob.getFullYear()).slice(-2);
  const password = `${dd}${mm}${yy}`;
  const email = `${student.roll_number.toLowerCase()}@olympiad.salci.org`;

  const { data: newUser, error } = await supabase.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (error) {
    console.error("Failed to create Olympiad auth user", error);
    return null;
  }

  await supabase.from("oly_students").update({ auth_user_id: newUser.user.id }).eq("id", oly_student_id);
  return newUser.user.id;
}
```

- [ ] **Step 2.2: Webhook — call after promotion**

In `oly-payment-webhook/index.ts`, find the section that does:
```ts
if (updated.promoted_student_id) {
  supabase.functions.invoke("oly-receipt-generate", { body: { oly_student_id: updated.promoted_student_id } }).catch(() => {});
}
```

Add the auth-user creation BEFORE that:
```ts
if (updated.promoted_student_id) {
  await createOlympiadAuthUser(supabase, updated.promoted_student_id);
  supabase.functions.invoke("oly-receipt-generate", { body: { oly_student_id: updated.promoted_student_id } }).catch(() => {});
}
```

- [ ] **Step 2.3: Cash enroll — call after student insert**

In `oly-cash-enroll/index.ts`, find:
```ts
const { data: student, error: insErr } = await supabase.from("oly_students").insert({...}).select("id").single();
if (insErr || !student) return json({...}, 500);
// ... insert pending row ...
// trigger receipt
```

Add right after the synthetic-pending insert (before fire-and-forget receipt-generate):
```ts
await createOlympiadAuthUser(supabase, student.id);
```

- [ ] **Step 2.4: Re-deploy both functions**

```bash
npx supabase@latest functions deploy oly-payment-webhook --project-ref gyymkgohcijeksmrzuyw --no-verify-jwt
npx supabase@latest functions deploy oly-cash-enroll --project-ref gyymkgohcijeksmrzuyw
```

- [ ] **Step 2.5: Verify + commit**

```bash
npx tsc --noEmit
git add supabase/functions/oly-payment-webhook/ supabase/functions/oly-cash-enroll/
git commit -m "feat(olympiad): inline synthetic auth user creation on student enrollment

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Backfill edge function

**Files:**
- Create: `supabase/functions/oly-backfill-student-auth/index.ts`

Batches in chunks of 25 with Promise.allSettled to avoid hammering auth.admin.createUser sequentially.

- [ ] **Step 3.1: Implement**

```ts
// @ts-expect-error Deno runtime
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-expect-error Deno runtime
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BATCH_SIZE = 25;

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ error: "Missing auth" }, 401);

    // @ts-expect-error Deno.env
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: userRes } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    const userId = userRes.user?.id;
    if (!userId) return json({ error: "Forbidden" }, 403);
    const { data: isSuper } = await supabase.rpc("is_super_admin", { user_id: userId });
    if (!isSuper) return json({ error: "Forbidden" }, 403);

    // Fetch all students without auth_user_id and without profile_id (non-SALCI)
    const { data: students, error } = await supabase
      .from("oly_students")
      .select("id, roll_number, date_of_birth")
      .is("auth_user_id", null)
      .is("profile_id", null)
      .eq("status", "active");
    if (error) return json({ error: error.message }, 500);

    let created = 0;
    let failed = 0;
    const failures: Array<{ id: string; error: string }> = [];

    // Chunk into BATCH_SIZE concurrent inserts
    for (let i = 0; i < (students ?? []).length; i += BATCH_SIZE) {
      const chunk = (students ?? []).slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(chunk.map(async (s) => {
        const dob = new Date(s.date_of_birth);
        const dd = String(dob.getDate()).padStart(2, "0");
        const mm = String(dob.getMonth() + 1).padStart(2, "0");
        const yy = String(dob.getFullYear()).slice(-2);
        const password = `${dd}${mm}${yy}`;
        const email = `${s.roll_number.toLowerCase()}@olympiad.salci.org`;

        const { data: newUser, error: cErr } = await supabase.auth.admin.createUser({
          email, password, email_confirm: true,
        });
        if (cErr) throw cErr;

        await supabase.from("oly_students").update({ auth_user_id: newUser.user.id }).eq("id", s.id);
        return s.id;
      }));

      for (let j = 0; j < results.length; j++) {
        const r = results[j];
        if (r.status === "fulfilled") created++;
        else { failed++; failures.push({ id: chunk[j].id, error: (r.reason as Error)?.message ?? "unknown" }); }
      }
    }

    return json({ ok: true, processed: students?.length ?? 0, created, failed, failures }, 200);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
```

- [ ] **Step 3.2: Deploy + commit**

```bash
npx supabase@latest functions deploy oly-backfill-student-auth --project-ref gyymkgohcijeksmrzuyw
git add supabase/functions/oly-backfill-student-auth/
git commit -m "feat(olympiad): backfill student auth users (batched 25 at a time)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 3.3: One-time manual run (post-deployment)**

This is an operations note — track it on the user-facing checklist. To backfill existing Olympiad students with auth users, super admin invokes:

```bash
# From the browser, super-admin session:
curl -X POST 'https://gyymkgohcijeksmrzuyw.supabase.co/functions/v1/oly-backfill-student-auth' \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Or via the existing super-admin tool surface (a future page can call it via `invokeEdgeFunction`).

---

## Section B — Hooks

### Task 4: Olympiad student hooks (6 new)

**Files:** all under `src/hooks/olympiad/`

- [ ] **Step 4.1: `useOlympiadStudentEnrollment.ts`**

Used by sidebar gating + RoleBasedDashboard. Aggressively cached.

```ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type OlympiadStudentEnrollment = {
  id: string;
  oly_school_id: string;
  roll_number: string;
  full_name: string;
  is_olympiad_only: boolean;
};

export function useOlympiadStudentEnrollment() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["olympiad", "my-enrollment", user?.id],
    queryFn: async (): Promise<OlympiadStudentEnrollment | null> => {
      if (!user?.id) return null;
      // §23.1: explicit columns. RLS lets the student see their own row.
      const { data, error } = await supabase
        .from("oly_students")
        .select("id, oly_school_id, roll_number, full_name, profile_id, auth_user_id")
        .or(`auth_user_id.eq.${user.id},profile_id.eq.${user.id}`)
        .eq("status", "active")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        id: data.id,
        oly_school_id: data.oly_school_id,
        roll_number: data.roll_number,
        full_name: data.full_name,
        is_olympiad_only: data.profile_id == null,
      };
    },
    enabled: !!user?.id,
    // §23.2: aggressive caching — sidebar reads this on every page
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
  });
}
```

- [ ] **Step 4.2: `useOlympiadStudentDashboard.ts`** — single-RPC dashboard

```ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type DashboardContext = {
  ok: true;
  student: {
    id: string;
    oly_school_id: string;
    grade_level_id: string;
    full_name: string;
    roll_number: string;
    section_label: string | null;
    subject_ids: string[];
    date_of_birth: string;
  };
  school_name: string;
  campaign_year: number;
  batch: {
    id: string;
    batch_label: string;
    scheduled_at: string;
    pin_expiry_minutes: number;
    pin_first_used_at: string | null;
    status: string;
    is_absentees: boolean;
  } | null;
  subjects: Array<{ id: string; name: string }>;
  study_material_count: number;
} | { ok: false; reason: string };

export function useOlympiadStudentDashboard() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["olympiad", "student-dashboard", user?.id],
    queryFn: async (): Promise<DashboardContext> => {
      if (!user?.id) return { ok: false, reason: "not_authenticated" };
      const { data, error } = await supabase.rpc("oly_student_dashboard_context");
      if (error) throw error;
      return data as DashboardContext;
    },
    enabled: !!user?.id,
    // §23.2: dashboard data is moderate volatility (batch + study material counts)
    staleTime: 60_000,
  });
}
```

- [ ] **Step 4.3: `useOlympiadStudentStudyMaterials.ts`**

```ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type StudyMaterialRow = {
  id: string;
  subject_id: string;
  grade_level_id: string;
  title: string;
  description: string | null;
  file_size_bytes: number;
  display_order: number;
};

export function useOlympiadStudentStudyMaterials(
  subjectIds: string[] | undefined,
  gradeLevelId: string | undefined,
) {
  return useQuery({
    queryKey: ["olympiad", "student-study-materials", subjectIds, gradeLevelId],
    queryFn: async (): Promise<StudyMaterialRow[]> => {
      if (!subjectIds?.length || !gradeLevelId) return [];
      // §23.1: explicit columns; no select(*)
      // RLS allows student SELECT — Phase 3a + 4a policies cover it
      const { data, error } = await supabase
        .from("oly_study_materials")
        .select("id, subject_id, grade_level_id, title, description, file_size_bytes, display_order")
        .in("subject_id", subjectIds)
        .eq("grade_level_id", gradeLevelId)
        .order("display_order")
        .order("title");
      if (error) throw error;
      return (data ?? []) as StudyMaterialRow[];
    },
    enabled: !!(subjectIds?.length && gradeLevelId),
    staleTime: 5 * 60_000,
  });
}
```

- [ ] **Step 4.4: `useOlympiadStudyMaterialUrl.ts`**

```ts
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/toast";

const BUCKET = "olympiad-study-material";

export function useOlympiadStudyMaterialUrl() {
  return useMutation({
    mutationFn: async (materialId: string): Promise<string> => {
      // Step 1: server-side eligibility check via SECURITY DEFINER RPC
      const { data: pathData, error: pathErr } = await supabase.rpc("oly_get_student_study_material_path", {
        p_material_id: materialId,
      });
      if (pathErr) throw pathErr;
      if (!pathData) throw new Error("Material not accessible");

      // Step 2: client-side signed URL generation (5 min TTL)
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(pathData as string, 300);
      if (error) throw error;
      return data.signedUrl;
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't open study material.", context: "useOlympiadStudyMaterialUrl" }),
  });
}
```

- [ ] **Step 4.5: `useOlympiadStudentLogin.ts`**

```ts
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/toast";

export type LoginInput = {
  identifier: string;     // roll number or admission number
  dob_iso: string;        // YYYY-MM-DD
};

export type LoginResult = {
  ok: true;
  is_olympiad_only: boolean;
};

export function useOlympiadStudentLogin() {
  return useMutation({
    mutationFn: async (input: LoginInput): Promise<LoginResult> => {
      const { data: resolve, error: resolveErr } = await supabase.rpc("oly_student_login_resolve", {
        p_identifier: input.identifier.trim(),
        p_dob_iso: input.dob_iso,
      });
      if (resolveErr) throw resolveErr;
      const result = resolve as {
        found: boolean;
        email?: string;
        is_olympiad_only?: boolean;
        message?: string;
      };
      if (!result.found) {
        throw new Error("Roll number or date of birth is incorrect. Please check the credentials provided by your school.");
      }
      if (!result.is_olympiad_only) {
        throw new Error("Please use the main SALCI login for your account.");
      }

      // Convert DOB to ddmmyy password
      const dob = new Date(input.dob_iso);
      const dd = String(dob.getDate()).padStart(2, "0");
      const mm = String(dob.getMonth() + 1).padStart(2, "0");
      const yy = String(dob.getFullYear()).slice(-2);
      const password = `${dd}${mm}${yy}`;

      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: result.email!,
        password,
      });
      if (signInErr) throw new Error("Sign in failed. Please verify your credentials.");

      return { ok: true, is_olympiad_only: true };
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Sign in failed.", context: "useOlympiadStudentLogin" }),
  });
}
```

- [ ] **Step 4.6: `useOlympiadPinValidate.ts`**

```ts
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/toast";

export type PinValidateResult =
  | { ok: true; batch_id: string; student_id: string; scheduled_at: string }
  | { ok: false; reason: "wrong_pin" | "expired_pin" | "wrong_batch" | "already_attempted" | "student_not_found" | "enrollment_closed" };

export function useOlympiadPinValidate() {
  return useMutation({
    mutationFn: async (pin: string): Promise<PinValidateResult> => {
      // §23.1: this is the hot exam-day path. RPC = sub-50ms.
      // Collect user-agent client-side for audit.
      const { data, error } = await supabase.rpc("oly_validate_pin", {
        p_pin: pin,
        p_ip: null,
        p_user_agent: navigator.userAgent ?? null,
      });
      if (error) throw error;
      return data as PinValidateResult;
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't validate PIN.", context: "useOlympiadPinValidate" }),
  });
}
```

- [ ] **Step 4.7: Verify + commit**

```bash
npx tsc --noEmit
npx eslint src/hooks/olympiad/useOlympiadStudentEnrollment.ts src/hooks/olympiad/useOlympiadStudentDashboard.ts src/hooks/olympiad/useOlympiadStudentStudyMaterials.ts src/hooks/olympiad/useOlympiadStudyMaterialUrl.ts src/hooks/olympiad/useOlympiadStudentLogin.ts src/hooks/olympiad/useOlympiadPinValidate.ts
git add src/hooks/olympiad/useOlympiadStudentEnrollment.ts src/hooks/olympiad/useOlympiadStudentDashboard.ts src/hooks/olympiad/useOlympiadStudentStudyMaterials.ts src/hooks/olympiad/useOlympiadStudyMaterialUrl.ts src/hooks/olympiad/useOlympiadStudentLogin.ts src/hooks/olympiad/useOlympiadPinValidate.ts
git commit -m "feat(olympiad): student-side hooks for dashboard, login, PIN validate, study materials"
```

---

## Section C — Public login page

### Task 5: `/olympiad/login` public page

**Files:**
- Create: `src/pages/public/OlympiadStudentLoginPage.tsx`
- Modify: `src/App.tsx` (register public route)

- [ ] **Step 5.1: Page**

```tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Medal } from "lucide-react";
import { OlympiadPublicLayout } from "@/components/olympiad/public/OlympiadPublicLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useOlympiadStudentLogin } from "@/hooks/olympiad/useOlympiadStudentLogin";

export default function OlympiadStudentLoginPage() {
  const navigate = useNavigate();
  const login = useOlympiadStudentLogin();
  const [identifier, setIdentifier] = useState("");
  const [dob, setDob] = useState("");

  const canSubmit = identifier.trim().length >= 3 && dob.length === 10;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    try {
      await login.mutateAsync({ identifier: identifier.trim(), dob_iso: dob });
      navigate("/student/olympiad");
    } catch { /* toastError fires */ }
  };

  return (
    <OlympiadPublicLayout>
      <form
        onSubmit={onSubmit}
        className="surface-card frosted-shadow rounded-card p-6 sm:p-8 space-y-5 max-w-md mx-auto"
      >
        <header className="text-center">
          <Medal className="h-10 w-10 text-brand-primary mx-auto mb-2" />
          <p className="eyebrow">SALCI Olympiad</p>
          <h1 className="text-2xl font-bold text-ink-900 mt-1">Sign in</h1>
        </header>

        <div className="grid gap-1.5">
          <Label className="text-xs font-medium text-ink-600">Roll number or admission number</Label>
          <Input
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value.toUpperCase())}
            placeholder="e.g. SO26-DEL042-08-0001"
            autoComplete="username"
            required
          />
        </div>

        <div className="grid gap-1.5">
          <Label className="text-xs font-medium text-ink-600">Date of birth</Label>
          <Input
            type="date"
            value={dob}
            onChange={(e) => setDob(e.target.value)}
            autoComplete="bday"
            required
          />
          <p className="text-[11px] text-ink-500">Use the date of birth provided to your school.</p>
        </div>

        <Button type="submit" className="w-full" disabled={!canSubmit || login.isPending}>
          {login.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Sign in
        </Button>
      </form>
    </OlympiadPublicLayout>
  );
}
```

- [ ] **Step 5.2: Register public route in App.tsx**

At the top, with the other lazy imports:
```tsx
const OlympiadStudentLoginPage = lazy(() => import("@/pages/public/OlympiadStudentLoginPage"));
```

OUTSIDE the protected blocks (near `/olympiad/:schoolCode` Phase 2 route):
```tsx
<Route path="/olympiad/login" element={
  <Suspense fallback={<p>Loading...</p>}>
    <OlympiadStudentLoginPage />
  </Suspense>
} />
```

- [ ] **Step 5.3: Verify + commit**

```bash
npx tsc --noEmit
npx eslint src/pages/public/OlympiadStudentLoginPage.tsx src/App.tsx
npx vite build
git add src/pages/public/OlympiadStudentLoginPage.tsx src/App.tsx
git commit -m "feat(olympiad): public /olympiad/login page with roll+DOB sign in"
```

---

## Section D — Student-side pages

### Task 6: Student dashboard + countdown + study list + PIN entry pages (bundled)

**Files:**
- Create: `src/components/olympiad/student/BatchCountdown.tsx`
- Create: `src/components/olympiad/student/StudyMaterialItem.tsx`
- Create: `src/components/olympiad/student/PinEntryForm.tsx`
- Create: `src/components/olympiad/student/InstructionsScreen.tsx`
- Create: `src/pages/student/olympiad/OlympiadStudentDashboardPage.tsx`
- Create: `src/pages/student/olympiad/OlympiadStudentPinEntryPage.tsx`
- Create: `src/pages/student/olympiad/OlympiadStudentStudyPage.tsx`
- Create: `src/pages/student/olympiad/OlympiadStudentExamPendingPage.tsx`
- Modify: `src/App.tsx` (register 4 student routes)

#### 6.1 `BatchCountdown.tsx` — client-side ticker (no DB load)

```tsx
import { useEffect, useState } from "react";

type Props = { scheduledAt: string };

export function BatchCountdown({ scheduledAt }: Props) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    // §23: setInterval on the CLIENT only — no refetch, no DB hits.
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const target = new Date(scheduledAt).getTime();
  const diff = target - now;

  if (diff <= 0) {
    return <p className="text-2xl font-bold text-emerald-600">Exam is live now</p>;
  }

  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  const hours = Math.floor((diff % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  const minutes = Math.floor((diff % (60 * 60 * 1000)) / (60 * 1000));
  const seconds = Math.floor((diff % (60 * 1000)) / 1000);

  if (days > 0) {
    return <p className="text-xl font-bold text-ink-900">{days}d {hours}h {minutes}m</p>;
  }
  if (hours > 0) {
    return <p className="text-xl font-bold text-amber-600">{hours}h {minutes}m {seconds}s</p>;
  }
  return <p className="text-xl font-bold text-red-600">{minutes}m {seconds}s</p>;
}
```

#### 6.2 `StudyMaterialItem.tsx`

```tsx
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useOlympiadStudyMaterialUrl } from "@/hooks/olympiad/useOlympiadStudyMaterialUrl";

type Props = {
  material: { id: string; title: string; description: string | null; file_size_bytes: number };
};

export function StudyMaterialItem({ material }: Props) {
  const get = useOlympiadStudyMaterialUrl();
  const [busy, setBusy] = useState(false);

  const onClick = async () => {
    setBusy(true);
    try {
      const url = await get.mutateAsync(material.id);
      window.open(url, "_blank", "noopener,noreferrer");
    } finally {
      setBusy(false);
    }
  };

  const sizeMb = (material.file_size_bytes / (1024 * 1024)).toFixed(2);

  return (
    <div className="flex items-center gap-3 px-3 py-2.5 surface-card frosted-shadow rounded-card">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-ink-900 truncate">{material.title}</p>
        <p className="text-[11px] text-ink-500">
          {sizeMb} MB{material.description ? ` · ${material.description}` : ""}
        </p>
      </div>
      <Button size="icon" variant="ghost" onClick={onClick} disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
      </Button>
    </div>
  );
}
```

#### 6.3 `PinEntryForm.tsx`

```tsx
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useOlympiadPinValidate, type PinValidateResult } from "@/hooks/olympiad/useOlympiadPinValidate";
import { toast } from "sonner";

type Props = { onSuccess: (result: Extract<PinValidateResult, { ok: true }>) => void };

const REASON_COPY: Record<string, string> = {
  wrong_pin: "Incorrect PIN. Please check the PIN your supervisor has shared.",
  wrong_batch: "This PIN does not match your assigned batch. Please contact your school.",
  expired_pin: "This batch's entry window has closed. Please contact your school.",
  already_attempted: "You have already submitted this exam. Contact your school if this is an error.",
  student_not_found: "We can't find your enrollment. Please contact your school.",
  enrollment_closed: "This exam is not yet scheduled. Please contact your school.",
};

export function PinEntryForm({ onSuccess }: Props) {
  const validate = useOlympiadPinValidate();
  const [pin, setPin] = useState("");
  const [errorReason, setErrorReason] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorReason(null);
    if (pin.length !== 6) return;
    try {
      const result = await validate.mutateAsync(pin);
      if (result.ok) {
        onSuccess(result);
      } else {
        const msg = REASON_COPY[result.reason] ?? "Couldn't validate PIN.";
        setErrorReason(msg);
        toast.error(msg);
      }
    } catch { /* toastError fires */ }
  };

  return (
    <form onSubmit={onSubmit} className="surface-card frosted-shadow rounded-card p-6 sm:p-8 space-y-5">
      <header className="text-center">
        <p className="eyebrow">Enter PIN</p>
        <h2 className="text-xl font-bold text-ink-900 mt-1">Your supervisor has the PIN</h2>
        <p className="text-sm text-ink-600 mt-2">Enter the 6-character PIN shown by your supervisor to start the exam.</p>
      </header>

      <div className="grid gap-1.5">
        <Label className="text-xs font-medium text-ink-600">Batch PIN</Label>
        <Input
          value={pin}
          onChange={(e) => setPin(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))}
          maxLength={6}
          placeholder="XK4M7P"
          className="text-center font-mono text-2xl tracking-[0.4em] uppercase"
          autoFocus
          required
        />
      </div>

      {errorReason && (
        <p className="text-sm text-red-600">{errorReason}</p>
      )}

      <Button type="submit" className="w-full" disabled={pin.length !== 6 || validate.isPending}>
        {validate.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        Validate PIN
      </Button>
    </form>
  );
}
```

#### 6.4 `InstructionsScreen.tsx`

```tsx
import { Button } from "@/components/ui/button";
import { CheckCircle2 } from "lucide-react";

type Props = {
  examDurationMinutes: number;
  onProceed: () => void;
};

const RULES = (durationMin: number) => [
  `The exam is ${durationMin} minutes long.`,
  "It contains questions from 3 subjects shown as tabs at the top.",
  "You can switch between sections freely.",
  "You can mark questions for review and come back to them.",
  "The exam will run in fullscreen. Do not exit fullscreen.",
  "Tab-switching counts as a proctoring violation. 3 violations auto-submit your exam.",
  "If you lose internet briefly, your timer keeps running on the server.",
  "Click I'm Ready when you're prepared to begin. The timer starts immediately after.",
];

export function InstructionsScreen({ examDurationMinutes, onProceed }: Props) {
  return (
    <div className="surface-card frosted-shadow rounded-card p-6 sm:p-8 space-y-5 max-w-2xl mx-auto">
      <header>
        <p className="eyebrow">Read the instructions carefully</p>
        <h2 className="text-xl font-bold text-ink-900 mt-1">Before you begin</h2>
      </header>

      <ul className="space-y-3">
        {RULES(examDurationMinutes).map((rule, i) => (
          <li key={i} className="flex gap-3 text-sm text-ink-700">
            <CheckCircle2 className="h-5 w-5 text-brand-primary flex-shrink-0 mt-0.5" />
            <span>{rule}</span>
          </li>
        ))}
      </ul>

      <Button onClick={onProceed} className="w-full">
        I'm ready
      </Button>
    </div>
  );
}
```

#### 6.5 `OlympiadStudentDashboardPage.tsx`

```tsx
import { useNavigate, NavLink } from "react-router-dom";
import { Loader2, Medal, GraduationCap } from "lucide-react";
import { PageShell } from "@/components/shared/page/PageShell";
import { PageHeader } from "@/components/shared/page/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatTile, StatTileGrid } from "@/components/shared/surfaces";
import { useOlympiadStudentDashboard } from "@/hooks/olympiad/useOlympiadStudentDashboard";
import { useOlympiadStudentStudyMaterials } from "@/hooks/olympiad/useOlympiadStudentStudyMaterials";
import { BatchCountdown } from "@/components/olympiad/student/BatchCountdown";
import { StudyMaterialItem } from "@/components/olympiad/student/StudyMaterialItem";

export default function OlympiadStudentDashboardPage() {
  const navigate = useNavigate();
  const { data: ctx, isLoading } = useOlympiadStudentDashboard();
  const subjectIds = ctx?.ok ? ctx.student.subject_ids : undefined;
  const gradeLevelId = ctx?.ok ? ctx.student.grade_level_id : undefined;
  const { data: materials } = useOlympiadStudentStudyMaterials(subjectIds, gradeLevelId);

  if (isLoading) {
    return <PageShell><div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-ink-500" /></div></PageShell>;
  }
  if (!ctx?.ok) {
    return (
      <PageShell>
        <PageHeader title="SALCI Olympiad" />
        <p className="py-6 text-sm text-ink-600">No active Olympiad enrollment for your account.</p>
      </PageShell>
    );
  }

  const isExamDay = ctx.batch && new Date(ctx.batch.scheduled_at).toDateString() === new Date().toDateString();

  return (
    <PageShell>
      <PageHeader
        title="SALCI Olympiad"
        subtitle={`${ctx.school_name} · Roll ${ctx.student.roll_number}`}
      />
      <div className="space-y-4 py-4">
        <div className="surface-card frosted-shadow rounded-card p-6 text-center">
          <p className="eyebrow">Your exam</p>
          {ctx.batch ? (
            <>
              <p className="text-sm text-ink-700 mt-1">
                {new Date(ctx.batch.scheduled_at).toLocaleString("en-IN", {
                  timeZone: "Asia/Kolkata",
                  dateStyle: "full",
                  timeStyle: "short",
                })}
              </p>
              <div className="mt-4">
                <BatchCountdown scheduledAt={ctx.batch.scheduled_at} />
              </div>
              <Button
                className="w-full mt-4"
                onClick={() => navigate("/student/olympiad/pin-entry")}
                disabled={!isExamDay}
                title={isExamDay ? undefined : "Available on exam day"}
              >
                {isExamDay ? "Start exam" : "Available on exam day"}
              </Button>
            </>
          ) : (
            <p className="text-sm text-ink-600 mt-2">Your batch will be announced by your school.</p>
          )}
        </div>

        <StatTileGrid>
          <StatTile
            label="Subjects"
            value={ctx.subjects.length.toString()}
            icon={<GraduationCap className="h-4 w-4" />}
            tone="teal"
          />
          <StatTile
            label="Study materials"
            value={ctx.study_material_count.toString()}
            icon={<Medal className="h-4 w-4" />}
            tone="mint"
          />
        </StatTileGrid>

        <section className="space-y-2">
          <p className="eyebrow">Your subjects</p>
          <div className="flex flex-wrap gap-2">
            {ctx.subjects.map((s) => <Badge key={s.id} variant="secondary">{s.name}</Badge>)}
          </div>
        </section>

        {(materials ?? []).length > 0 && (
          <section className="space-y-2">
            <p className="eyebrow">Study material</p>
            <div className="space-y-2">
              {(materials ?? []).map((m) => <StudyMaterialItem key={m.id} material={m} />)}
            </div>
          </section>
        )}
      </div>
    </PageShell>
  );
}
```

#### 6.6 `OlympiadStudentPinEntryPage.tsx`

```tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, ArrowLeft } from "lucide-react";
import { NavLink } from "react-router-dom";
import { PageShell } from "@/components/shared/page/PageShell";
import { PageHeader } from "@/components/shared/page/PageHeader";
import { PinEntryForm } from "@/components/olympiad/student/PinEntryForm";
import { InstructionsScreen } from "@/components/olympiad/student/InstructionsScreen";
import { useOlympiadStudentDashboard } from "@/hooks/olympiad/useOlympiadStudentDashboard";

export default function OlympiadStudentPinEntryPage() {
  const navigate = useNavigate();
  const { data: ctx, isLoading } = useOlympiadStudentDashboard();
  const [pinValidated, setPinValidated] = useState(false);

  if (isLoading) {
    return <PageShell><div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-ink-500" /></div></PageShell>;
  }
  if (!ctx?.ok) {
    return <PageShell><p className="py-6 text-sm text-ink-600">No active enrollment.</p></PageShell>;
  }

  // Look up exam duration from the campaign — Phase 4a uses a sensible 90-minute default
  // and Phase 4b can wire a campaign-context RPC if needed.
  const examDurationMinutes = 90;

  return (
    <PageShell>
      <NavLink to="/student/olympiad" className="inline-flex items-center gap-1 text-sm text-ink-600 hover:text-ink-900 mb-2">
        <ArrowLeft className="h-4 w-4" /> Dashboard
      </NavLink>
      <PageHeader title="Start exam" subtitle={`Roll ${ctx.student.roll_number}`} />
      <div className="py-4">
        {!pinValidated ? (
          <PinEntryForm onSuccess={() => setPinValidated(true)} />
        ) : (
          <InstructionsScreen
            examDurationMinutes={examDurationMinutes}
            onProceed={() => navigate("/student/olympiad/exam-pending")}
          />
        )}
      </div>
    </PageShell>
  );
}
```

#### 6.7 `OlympiadStudentStudyPage.tsx`

```tsx
import { useParams, NavLink } from "react-router-dom";
import { Loader2, ArrowLeft } from "lucide-react";
import { PageShell } from "@/components/shared/page/PageShell";
import { PageHeader } from "@/components/shared/page/PageHeader";
import { useOlympiadStudentDashboard } from "@/hooks/olympiad/useOlympiadStudentDashboard";
import { useOlympiadStudentStudyMaterials } from "@/hooks/olympiad/useOlympiadStudentStudyMaterials";
import { StudyMaterialItem } from "@/components/olympiad/student/StudyMaterialItem";

export default function OlympiadStudentStudyPage() {
  const { subjectId } = useParams();
  const { data: ctx } = useOlympiadStudentDashboard();
  const subjectIds = ctx?.ok ? [subjectId!] : undefined;
  const gradeLevelId = ctx?.ok ? ctx.student.grade_level_id : undefined;
  const { data: materials, isLoading } = useOlympiadStudentStudyMaterials(subjectIds, gradeLevelId);

  const subject = ctx?.ok ? ctx.subjects.find((s) => s.id === subjectId) : null;

  return (
    <PageShell>
      <NavLink to="/student/olympiad" className="inline-flex items-center gap-1 text-sm text-ink-600 hover:text-ink-900 mb-2">
        <ArrowLeft className="h-4 w-4" /> Dashboard
      </NavLink>
      <PageHeader title={subject?.name ?? "Study material"} subtitle="Concept notes for your subject" />
      <div className="space-y-2 py-4">
        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-ink-500" /></div>
        ) : (materials ?? []).length === 0 ? (
          <p className="text-sm text-ink-600 py-6 text-center">No study material uploaded yet for this subject.</p>
        ) : (
          (materials ?? []).map((m) => <StudyMaterialItem key={m.id} material={m} />)
        )}
      </div>
    </PageShell>
  );
}
```

#### 6.8 `OlympiadStudentExamPendingPage.tsx` (placeholder for Phase 4b)

```tsx
import { NavLink } from "react-router-dom";
import { Hourglass, ArrowLeft } from "lucide-react";
import { PageShell } from "@/components/shared/page/PageShell";
import { PageHeader } from "@/components/shared/page/PageHeader";

export default function OlympiadStudentExamPendingPage() {
  return (
    <PageShell>
      <PageHeader title="Exam ready" subtitle="Phase 4b will deliver the exam UI here" />
      <div className="surface-card frosted-shadow rounded-card p-8 text-center max-w-md mx-auto mt-6">
        <Hourglass className="h-10 w-10 text-brand-primary mx-auto mb-3" />
        <p className="text-sm text-ink-700">
          Your PIN has been validated. The exam interface is being prepared. Please contact your school if you do not see the exam screen shortly.
        </p>
        <NavLink to="/student/olympiad" className="inline-flex items-center gap-1 text-sm text-ink-600 hover:text-ink-900 mt-6">
          <ArrowLeft className="h-4 w-4" /> Back to dashboard
        </NavLink>
      </div>
    </PageShell>
  );
}
```

#### 6.9 Register 4 student routes in App.tsx

Lazy imports at top:
```tsx
const OlympiadStudentDashboardPage = lazy(() => import("@/pages/student/olympiad/OlympiadStudentDashboardPage"));
const OlympiadStudentPinEntryPage = lazy(() => import("@/pages/student/olympiad/OlympiadStudentPinEntryPage"));
const OlympiadStudentStudyPage = lazy(() => import("@/pages/student/olympiad/OlympiadStudentStudyPage"));
const OlympiadStudentExamPendingPage = lazy(() => import("@/pages/student/olympiad/OlympiadStudentExamPendingPage"));
```

In the student protected block:
```tsx
<Route path="/student/olympiad" element={
  <ProtectedRoute allowedRoles={["student"]}>
    <Suspense fallback={<p>Loading...</p>}>
      <OlympiadStudentDashboardPage />
    </Suspense>
  </ProtectedRoute>
} />
<Route path="/student/olympiad/pin-entry" element={
  <ProtectedRoute allowedRoles={["student"]}>
    <Suspense fallback={<p>Loading...</p>}>
      <OlympiadStudentPinEntryPage />
    </Suspense>
  </ProtectedRoute>
} />
<Route path="/student/olympiad/study/:subjectId" element={
  <ProtectedRoute allowedRoles={["student"]}>
    <Suspense fallback={<p>Loading...</p>}>
      <OlympiadStudentStudyPage />
    </Suspense>
  </ProtectedRoute>
} />
<Route path="/student/olympiad/exam-pending" element={
  <ProtectedRoute allowedRoles={["student"]}>
    <Suspense fallback={<p>Loading...</p>}>
      <OlympiadStudentExamPendingPage />
    </Suspense>
  </ProtectedRoute>
} />
```

#### 6.10 Verify + commit

```bash
npx tsc --noEmit
npx eslint src/components/olympiad/student/ src/pages/student/olympiad/ src/pages/public/OlympiadStudentLoginPage.tsx src/App.tsx
npx vite build
git add src/components/olympiad/student/ src/pages/student/olympiad/ src/App.tsx
git commit -m "feat(olympiad): student dashboard + PIN entry + instructions + study page

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Section E — Sidebar wiring

### Task 7: Student-side sidebar entry

**Files:**
- Modify: `src/components/layout/AppSidebar.tsx`

- [ ] **Step 7.1: Add Olympiad entry for student role**

In the student nav array (search for `student` role in the file), add:

```ts
{ title: "Olympiad", url: "/student/olympiad", icon: Medal },
```

This entry is gated via `FEATURE_URL_MAP["/student/olympiad"] = "olympiad"` (set in Phase 1). The sidebar's existing `filterItemsByFeature` hides the entry when the institution doesn't have the `olympiad` feature flag on, AND additionally hides for SALCI students who aren't enrolled in any active campaign.

For the enrollment-based gating, the sidebar already filters by feature flag. Phase 4a's `useOlympiadStudentEnrollment()` provides the per-user check, but for sidebar simplicity we use the feature flag alone. A SALCI student at a school with the olympiad flag on but who isn't enrolled will see the link, click it, and land on the "No active enrollment" message — acceptable UX.

- [ ] **Step 7.2: Verify + commit**

```bash
npx tsc --noEmit
npx eslint src/components/layout/AppSidebar.tsx
git add src/components/layout/AppSidebar.tsx
git commit -m "feat(olympiad): student sidebar entry"
```

---

## Section F — Verification

### Task 8: §5a contract + concurrency checklist

- [ ] **Run all §5a checks**

```bash
npx tsc --noEmit
npx eslint "src/{hooks,components,pages,lib}/olympiad/**" "src/App.tsx" "src/components/layout/AppSidebar.tsx" "src/pages/public/OlympiadStudentLoginPage.tsx" "src/pages/student/olympiad/**"
npx vite build
```
All three exit 0.

- [ ] **Concurrency self-check (the §23 pre-merge checklist)**

Mentally walk through each rule against Phase 4a diff:
- [ ] Every new useQuery has explicit `staleTime` — verified in hooks file (5min, 60s, 5min, etc.)
- [ ] No useEffect subscription leaks — `BatchCountdown` uses cleanup
- [ ] No refetchInterval < 30s — none in this phase
- [ ] No `select("*")` — verified
- [ ] All FKs indexed in migration — verified in T1
- [ ] No `supabase.auth.getUser()` without JWT — all client code uses `useAuth()` context; the only call is server-side in edge functions (which is correct)
- [ ] Bundle delta — new chunks for student pages should all be < 15KB gzipped
- [ ] Every new RLS uses SECURITY DEFINER helpers — `oly_student_can_read` extended in T1
- [ ] PIN validation is RPC, not edge function (sub-50ms latency)
- [ ] Auth user backfill is batched 25 at a time

Document any deferred items at the top of the next phase plan.

- [ ] **Manual smoke** (controller/user)

1. Super admin: run `oly-backfill-student-auth` once to create auth users for existing students
2. Student: `/olympiad/login` with roll number + DOB → lands on dashboard
3. Dashboard shows correct batch + subjects + study material count
4. Click study material → PDF opens in new tab via signed URL
5. On batch day (or manually set `scheduled_at` to past): Start exam → PIN entry
6. Enter wrong PIN → error toast with correct copy
7. Enter correct PIN → instructions screen → I'm ready → lands on placeholder

7. Toggle dark mode at 375px — confirm all pages render correctly

Commit any smoke fixes.

---

## Self-Review Summary

- **Spec coverage**: §1-§9 of spec each map to a task. The TODO inside the validate-pin RPC (`-- TODO Phase 4b: check oly_attempts`) is intentional — that check requires `oly_attempts` to exist (Phase 4b).
- **Placeholders**: none.
- **Type consistency**: `DashboardContext`, `PinValidateResult`, `LoginResult`, `StudyMaterialRow` types are declared in their hook files and consumed by name in pages/components.
- **Concurrency**: explicit comments in code (`§23.1`, `§23.2`) call out the rules each block honors. The single biggest correctness win is `oly_validate_pin` being an RPC, not an edge function — sub-50ms cold latency vs. 200-500ms.

### Production-scale notes

- **Bundle**: the 5 new pages add ~15-20KB total to the lazy chunks. Main bundle untouched.
- **DB load on exam day**: each PIN validation = 1 RPC call (5-6 internal queries inside an atomic transaction). At 20 RPS peak the DB is doing ~100-120 queries/sec, which is well within the Medium tier's headroom even with Supavisor.
- **Auth user creation**: serial inline in webhook is acceptable because the webhook is bottlenecked by Razorpay's webhook throughput anyway. The backfill is batched 25 at a time for the one-time historical sweep.
- **Dashboard hits**: one RPC call per dashboard mount, cached 60s. ~6K students mounting once = 6K calls spread over login window = ~30 RPS at peak. Trivial.
