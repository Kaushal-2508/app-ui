# SALCI Olympiad Phase 5b — Dormancy + Passport + Super Admin Polish Design

**Status:** Draft v1
**Date:** 2026-05-27
**Parent doc:** [2026-05-26-olympiad-master-decomposition-design.md](./2026-05-26-olympiad-master-decomposition-design.md)
**Source:** SALCI_Olympiad_Build_Prompt2.docx (Phase 5 — dormancy + super-admin tail)
**Depends on:** Phase 1, 2, 3a, 3b, 4a, 4b, 5a

This is the final operational phase. After Phase 5b ships, the Olympiad campaign can run end-to-end and tear down cleanly. The piece-by-piece deliverables: daily dormancy cron, anonymized result archive, super-admin impersonation, post-campaign historical view, Passport + Reports tab integration for SALCI students, stuck-attempt cleanup.

---

## 1. Scope

In:

- DB: `oly_results_archive` table (anonymized retention forever); `oly_impersonation_log` (audit trail); 3 RPCs (`oly_dormancy_day30`, `oly_dormancy_day60`, `oly_cleanup_stuck_attempts`); pg_cron schedule
- Edge functions: `oly-dormancy-pass` (cron-invoked daily orchestrator); `oly-impersonate-school-admin` (super admin generates short-lived session for a school admin)
- Super admin UI: "View as Admin" impersonation button + impersonation banner; "Archive campaign" action; historical campaigns drop-down
- Passport + Reports integration: for SALCI students, Phase 5a publish ALSO writes a `passport_academic_records` entry pointing to the Olympiad result
- Sidebar gating: SALCI students lose the `/student/olympiad` sidebar entry on Day 30 (the Passport + Reports row survives)

Out (genuinely deferred — per docx):

- Re-publish capability
- Cross-school national rankings
- Mid-campaign batch reassignment
- Re-export of dormant data

---

## 2. Database schema (additive migration)

One migration: `supabase/migrations/<ts>_oly_phase_5b_dormancy.sql`.

### 2.1 `oly_results_archive`

Long-term anonymized retention. No PII (no name, no parent contact, no DOB). Kept indefinitely for SALCI internal analytics.

```sql
create table public.oly_results_archive (
  id uuid primary key default gen_random_uuid(),
  -- Anonymized identifiers — roll number and school code are operational identifiers, not PII
  roll_number text not null,
  school_short_code text not null,
  class_label text not null,
  campaign_year smallint not null,
  -- Scoring data
  subject_ids uuid[] not null,
  total_marks_obtained numeric not null,
  total_max_marks numeric not null,
  percentage numeric(5,2) not null,
  subject_scores jsonb not null,
  certificate_tier text not null,
  certificate_id text not null,
  class_rank integer,
  school_rank integer,
  total_time_seconds integer,
  archived_at timestamptz not null default now()
);
create index idx_ora_school_year on public.oly_results_archive(school_short_code, campaign_year);
create index idx_ora_tier on public.oly_results_archive(certificate_tier);
create index idx_ora_archived_at on public.oly_results_archive(archived_at);

alter table public.oly_results_archive enable row level security;
create policy "super_admin all" on public.oly_results_archive for all
  using (public.is_super_admin(auth.uid())) with check (public.is_super_admin(auth.uid()));
```

### 2.2 `oly_impersonation_log`

Audit trail for super-admin impersonation sessions.

```sql
create table public.oly_impersonation_log (
  id uuid primary key default gen_random_uuid(),
  super_admin_id uuid not null references public.profiles(id) on delete set null,
  impersonated_user_id uuid references public.profiles(id) on delete set null,
  oly_school_id uuid references public.oly_schools(id) on delete set null,
  reason text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index idx_oil_super on public.oly_impersonation_log(super_admin_id);
create index idx_oil_target on public.oly_impersonation_log(impersonated_user_id);
create index idx_oil_school on public.oly_impersonation_log(oly_school_id);
create index idx_oil_created_at on public.oly_impersonation_log(created_at);

alter table public.oly_impersonation_log enable row level security;
create policy "super_admin all" on public.oly_impersonation_log for all
  using (public.is_super_admin(auth.uid())) with check (public.is_super_admin(auth.uid()));
```

### 2.3 RPCs

#### `oly_dormancy_day30(p_campaign_id)`

For each campaign published more than 30 days ago, mark non-SALCI students as dormant and SALCI students' visibility hidden.

```sql
create or replace function public.oly_dormancy_day30(p_campaign_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_marked_non_salci integer := 0;
  v_hidden_salci integer := 0;
begin
  -- Non-SALCI students: mark dormant + disable login at 30 days post-publish
  update public.oly_students s
     set status = 'dormant', updated_at = now()
    from public.oly_schools sc, public.oly_results r
   where s.oly_school_id = sc.id
     and r.oly_student_id = s.id
     and sc.is_existing_salci_school = false
     and s.status = 'active'
     and s.profile_id is null  -- non-SALCI student
     and r.published_at < now() - interval '30 days'
     and (p_campaign_id is null or s.campaign_id = p_campaign_id);
  get diagnostics v_marked_non_salci = row_count;

  -- SALCI students: keep status='active' but the sidebar gates on a different
  -- "Olympiad visible" check. We add a metadata flag for the sidebar to read.
  -- For simplicity, we use the existing `status` column with a new value 'salci_dormant'
  -- that the dashboard hook treats as "no longer show Olympiad tab"
  update public.oly_students s
     set status = 'archived', updated_at = now()
    from public.oly_schools sc, public.oly_results r
   where s.oly_school_id = sc.id
     and r.oly_student_id = s.id
     and sc.is_existing_salci_school = true
     and s.status = 'active'
     and s.profile_id is not null  -- SALCI student
     and r.published_at < now() - interval '30 days'
     and (p_campaign_id is null or s.campaign_id = p_campaign_id);
  get diagnostics v_hidden_salci = row_count;

  return jsonb_build_object('ok', true, 'non_salci_marked_dormant', v_marked_non_salci, 'salci_archived', v_hidden_salci);
end;
$$;

grant execute on function public.oly_dormancy_day30(uuid) to authenticated;
```

#### `oly_dormancy_day60(p_campaign_id)`

For each non-SALCI student dormant for 30+ days (so 60 days post-publish), copy to archive, delete auth user, purge PII, delete PDFs from storage (handled in edge function — storage requires admin API).

```sql
create or replace function public.oly_dormancy_day60(p_campaign_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_purged integer := 0;
  v_auth_ids uuid[] := '{}';
  v_pdf_paths text[] := '{}';
  v_student record;
begin
  -- Build collection of students to purge (dormant >= 30 days)
  for v_student in
    select s.id, s.auth_user_id, s.roll_number, s.oly_school_id, s.campaign_id, s.class_label, s.subject_ids,
           r.id as result_id, r.total_marks_obtained, r.total_max_marks, r.percentage,
           r.subject_scores, r.certificate_tier, r.certificate_id,
           r.class_rank, r.school_rank, r.total_time_seconds,
           r.result_pdf_path, r.certificate_pdf_path,
           sc.school_short_code, c.campaign_year
      from public.oly_students s
      join public.oly_results r on r.oly_student_id = s.id
      join public.oly_schools sc on sc.id = s.oly_school_id
      join public.oly_campaigns c on c.id = sc.campaign_id
     where s.status = 'dormant'
       and s.profile_id is null
       and s.updated_at < now() - interval '30 days'  -- 30 days dormant = 60 days total
       and (p_campaign_id is null or s.campaign_id = p_campaign_id)
  loop
    -- Insert anonymized archive (idempotent: skip if same roll_number+year exists)
    insert into public.oly_results_archive (
      roll_number, school_short_code, class_label, campaign_year,
      subject_ids, total_marks_obtained, total_max_marks, percentage,
      subject_scores, certificate_tier, certificate_id,
      class_rank, school_rank, total_time_seconds
    ) values (
      v_student.roll_number, v_student.school_short_code, v_student.class_label, v_student.campaign_year,
      v_student.subject_ids, v_student.total_marks_obtained, v_student.total_max_marks, v_student.percentage,
      v_student.subject_scores, v_student.certificate_tier, v_student.certificate_id,
      v_student.class_rank, v_student.school_rank, v_student.total_time_seconds
    )
    on conflict do nothing;

    -- Collect auth user IDs and PDF paths for edge-function cleanup
    if v_student.auth_user_id is not null then
      v_auth_ids := v_auth_ids || v_student.auth_user_id;
    end if;
    if v_student.result_pdf_path is not null then
      v_pdf_paths := v_pdf_paths || v_student.result_pdf_path;
    end if;
    if v_student.certificate_pdf_path is not null then
      v_pdf_paths := v_pdf_paths || v_student.certificate_pdf_path;
    end if;

    -- Purge PII fields. Keep the row so audit log/refunds stay linked.
    update public.oly_students
       set full_name = '[PURGED]',
           parent_name = '[PURGED]',
           parent_phone = '[PURGED]',
           parent_email = null,
           date_of_birth = '1900-01-01'::date,
           status = 'archived',
           updated_at = now()
     where id = v_student.id;

    v_purged := v_purged + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'purged', v_purged,
    'auth_user_ids_to_delete', to_jsonb(v_auth_ids),
    'storage_paths_to_delete', to_jsonb(v_pdf_paths)
  );
end;
$$;

grant execute on function public.oly_dormancy_day60(uuid) to authenticated;
```

The edge function (`oly-dormancy-pass`) reads the returned `auth_user_ids_to_delete` + `storage_paths_to_delete` and performs the actual deletes via `auth.admin.deleteUser` + `storage.from(...).remove([])`.

#### `oly_cleanup_stuck_attempts()`

Phase 4b carryover. Sweeps `oly_attempts` where `started_at + duration < now() - 1 hour` AND `status='in_progress'`, auto-submits with `reason='disconnect_exceeded'`.

```sql
create or replace function public.oly_cleanup_stuck_attempts()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_submitted integer := 0;
  v_attempt record;
begin
  for v_attempt in
    select id from public.oly_attempts
     where status = 'in_progress'
       and started_at + (exam_duration_seconds * interval '1 second') < now() - interval '1 hour'
  loop
    -- Use the existing oly_submit_attempt RPC with disconnect_exceeded reason.
    -- But that RPC uses auth.uid() ownership check. We need a direct call that bypasses.
    -- Inline the submit logic here instead.
    update public.oly_attempts a set
      status = 'auto_submitted_disconnect',
      submitted_at = now(),
      submit_reason = 'disconnect_exceeded',
      -- score compute (single aggregate over snapshot LEFT JOIN answers)
      total_marks_obtained = coalesce((
        select sum(case when ans.selected_answer = snap.correct_answer then snap.marks else 0 end)
          from public.oly_questions_snapshot snap
          left join public.oly_answers ans on ans.oly_question_snapshot_id = snap.id
         where snap.oly_attempt_id = a.id
      ), 0),
      total_max_marks = coalesce((
        select sum(snap.marks)
          from public.oly_questions_snapshot snap
         where snap.oly_attempt_id = a.id
      ), 0)
     where a.id = v_attempt.id;

    update public.oly_attempts set
      percentage = case when total_max_marks > 0 then round((total_marks_obtained / total_max_marks) * 100, 2) else 0 end
     where id = v_attempt.id;

    v_submitted := v_submitted + 1;
  end loop;

  return jsonb_build_object('ok', true, 'auto_submitted', v_submitted);
end;
$$;

grant execute on function public.oly_cleanup_stuck_attempts() to authenticated;
```

### 2.4 pg_cron entry

```sql
do $$
begin
  perform cron.unschedule('oly-dormancy-pass');
exception when others then null;
end;
$$;

select cron.schedule(
  'oly-dormancy-pass',
  '30 22 * * *',  -- 22:30 UTC = 4:00 AM IST (avoids exam-day morning windows)
  $job$
  select net.http_post(
    url := 'https://gyymkgohcijeksmrzuyw.supabase.co/functions/v1/oly-dormancy-pass',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.cron_secret', true),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $job$
);
```

The same `app.cron_secret` GUC + `OLY_CRON_SECRET` env var used by Phase 3b reminders cron applies here.

---

## 3. Edge functions

### 3.1 `oly-dormancy-pass`

Cron-invoked daily. Algorithm:

1. Verify `Authorization: Bearer <OLY_CRON_SECRET>` header
2. Step A: `await supabase.rpc("oly_cleanup_stuck_attempts")` — auto-submit overdue attempts
3. Step B: `await supabase.rpc("oly_dormancy_day30")` — mark dormant
4. Step C: `await supabase.rpc("oly_dormancy_day60")` — purge PII, get list of auth_user_ids + storage_paths
5. For each `auth_user_id` returned: `await supabase.auth.admin.deleteUser(id)` (catch + log failures)
6. Bulk delete storage entries: `await supabase.storage.from("olympiad-receipts").remove(storage_paths)`
7. Return JSON summary

Use service-role client. No CORS (cron-only).

### 3.2 `oly-impersonate-school-admin`

Super admin POST endpoint. Input: `{ oly_school_id, reason }`. Returns a short-lived session token for the school admin.

Algorithm:
1. Verify caller is super_admin
2. Resolve the school's primary contact email + the school_admin user_id (look up via `user_roles` where role='school_admin' AND institution_id matches)
3. Generate a Supabase auth magic link or admin session via `auth.admin.generateLink({ type: 'magiclink', email })`
4. Record `oly_impersonation_log` row with super_admin_id, target user_id, school_id, reason, expires_at = now() + 5 min
5. Return the magic link URL (admin opens in new tab to log in as that user)

NOTE: Supabase magic links are typically email-delivered. For impersonation, the super admin gets the link directly in the response (no email send). The link is single-use and short-lived.

Alternative simpler approach: directly generate an admin-session JWT via `auth.admin.createUser` with a temp token. But that's hacky. The magic link approach is cleaner.

Actually the cleanest impersonation: use Supabase's admin API to generate an OTP / session token. Phase 5b ships the magic-link approach; the super admin opens it in incognito to land in the school admin's session.

---

## 4. Super admin UI

### 4.1 "View as Admin" button

On `/admin/olympiad/schools/:olySchoolId`:
- Button "View as Admin" in the header secondary actions
- Click → `ImpersonateDialog` with reason textarea (required)
- Submit → calls `oly-impersonate-school-admin` → opens returned magic link in new tab
- The super admin's main tab stays logged in as super_admin; the new tab is logged in as the school admin

### 4.2 Impersonation banner

When ANY page detects the current session was created from an impersonation magic link (we set a flag in `localStorage`), render an `ImpersonationBanner` at the top of every page:
- "Impersonating [School Name] — Click to exit"
- Click → clear session + redirect to super-admin

For Phase 5b simplicity, detect impersonation via a query param on the magic link (`?impersonating=1`) which sets the localStorage flag.

### 4.3 "Archive campaign" action

On `/admin/olympiad/schools/:olySchoolId`:
- Button "Archive campaign" (disabled unless status='results_published')
- Click → AlertDialog confirming archival
- Confirm → UPDATE `oly_schools.status = 'archived'`
- Audit log row

### 4.4 Historical campaigns view

On `/admin/olympiad/schools`:
- Dropdown filter by campaign year (defaults to current year)
- Selecting a past year filters `oly_schools` by campaign → super admin can browse archived schools

---

## 5. Passport + Reports integration

### 5.1 Modify Phase 5a's `oly-publish-school-results` orchestrator

After Step 3 (emails), add Step 4: for each `oly_results` row where the student has `profile_id IS NOT NULL` (SALCI student), invoke `oly-create-passport-entry`.

### 5.2 New edge function `oly-create-passport-entry`

Input: `{ oly_result_id }`. Algorithm:
1. Load `oly_results` + `oly_students` + `oly_campaigns`
2. If `profile_id IS NULL`, skip (non-SALCI)
3. Insert into `passport_academic_records` with:
   - `student_id = profile_id`
   - `academic_year = campaign_year::text`
   - `record_type = 'olympiad'`
   - `title = 'SALCI Olympiad {YEAR}'`
   - `score = total_marks_obtained::text || ' / ' || total_max_marks::text`
   - `percentage = percentage`
   - `metadata = jsonb_build_object('certificate_tier', tier, 'school_rank', school_rank, 'result_pdf_path', result_pdf_path)`
4. Audit log

The exact columns depend on the existing `passport_academic_records` schema — the implementer reads it before writing.

### 5.3 SALCI student sidebar gating

`useOlympiadStudentEnrollment` already filters for `status = 'active'`. After Day 30 dormancy archives SALCI students (status='archived'), the hook returns null, the sidebar entry disappears.

The Passport + Reports rows survive (separate tables, not cascaded).

---

## 6. Hooks (new)

- `useOlympiadCampaignsList()` — for the super admin year dropdown
- `useImpersonateSchoolAdmin()` — mutation calling `oly-impersonate-school-admin`
- `useArchiveCampaign()` — direct UPDATE on `oly_schools.status`

---

## 7. Acceptance criteria

- Dormancy cron runs daily at 4 AM IST; logs success/failure
- Day 30: non-SALCI students go dormant; SALCI students lose Olympiad sidebar entry
- Day 60: non-SALCI students get PII purged + anonymized archive + auth user deleted + storage purged
- Super admin can impersonate a school admin (audited)
- Super admin can archive a published campaign
- Super admin can filter schools by campaign year
- SALCI students see their Olympiad result in their Passport + Reports tab permanently
- Stuck attempts auto-submit after 1 hour beyond duration
- All RPCs SECURITY DEFINER with auth checks
- All FKs indexed in migration
- §5a contract passes
- Whole Olympiad final code review passes

---

## 8. Risks and open items

- **Magic link impersonation**: Supabase's `auth.admin.generateLink({ type: 'magiclink' })` returns a URL the super admin opens. Single-use. 5-min TTL. Audit-logged. The "exit impersonation" path is to close the tab (or clear session).
- **`passport_academic_records` schema**: implementer must read the existing table before writing the INSERT. If columns differ, adapt.
- **Day 30 SALCI status change**: I'm using status='archived' for SALCI students at Day 30 because there's no distinct "salci_dormant" enum value. The student's main SALCI account is unaffected; only their `oly_students` row gets status='archived' which removes the Olympiad sidebar tab.
- **Storage purge**: Day 60 deletes both result + certificate PDFs from storage. The `oly_results.result_pdf_path` field stays in DB pointing to a deleted file. Cosmetic but harmless — student is purged anyway.
- **Cron secret reuse**: Phase 3b's `OLY_CRON_SECRET` is reused. No new secret needed.
- **Re-publish capability**: explicitly NOT BUILT per docx — if super admin needs to re-publish, they must manually intervene at DB level.
