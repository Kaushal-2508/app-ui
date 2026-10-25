# SALCI Olympiad Phase 5a — Publish + Results + Certificates Design

**Status:** Draft v1
**Date:** 2026-05-27
**Parent doc:** [2026-05-26-olympiad-master-decomposition-design.md](./2026-05-26-olympiad-master-decomposition-design.md)
**Source:** SALCI_Olympiad_Build_Prompt2.docx (Phase 5 — publish pipeline + reports + certificates)
**Depends on:** Phase 1, 2, 3a, 3b, 4a, 4b
**Followed by:** Phase 5b (dormancy + Passport + super-admin polish)

This phase delivers the publish flow: school admin closes the campaign, the system computes ranks, generates result PDFs + certificates for every student, and emails parents. Students who took the exam can then see their score on the dashboard, download their report + certificate, and review their answers.

The pipeline is production-hardened for school-sized batches (200-500 students) running concurrently with other schools also publishing. Per CLAUDE.md §23: async job queue, idempotent generation, retry on failure, server-side rank computation via window function.

---

## 1. Scope

In:

- DB: `oly_results` (per-student aggregate that survives dormancy), `oly_publish_jobs` (job state for the async pipeline), 4 SECURITY DEFINER RPCs
- Edge functions: `oly-publish-school-results` (admin-triggered orchestrator), `oly-generate-result-pdf`, `oly-generate-certificate-pdf`, `oly-send-results-email`, `oly-publish-process-batch` (worker that processes one chunk)
- School admin: "Publish Results & Close Exam" button + confirmation dialog + job-status polling
- Student post-publish dashboard view: result card with score + tier + ranks + download buttons
- Per-question review page (unlocked after publish; shows student answers with correct answers highlighted)
- Parent email with PDFs attached or signed-URL links
- Audit log entries for every publish action

Out (deferred to Phase 5b):

- 30/60-day dormancy
- Passport + Reports tab integration for SALCI students
- Super admin impersonation
- Stuck-attempt cleanup cron
- Final whole-Olympiad code review

---

## 2. Database schema (additive migration)

One migration: `supabase/migrations/<ts>_oly_phase_5a_publish.sql`.

### 2.1 `oly_results`

Per-student published result. Survives the dormancy PII purge because we keep an anonymized archive copy later (Phase 5b) but the row itself stays until Day 60.

```sql
create table public.oly_results (
  id uuid primary key default gen_random_uuid(),
  oly_student_id uuid not null references public.oly_students(id) on delete cascade,
  oly_attempt_id uuid references public.oly_attempts(id) on delete set null,
  campaign_id uuid not null references public.oly_campaigns(id) on delete restrict,
  oly_school_id uuid not null references public.oly_schools(id) on delete cascade,

  -- Aggregate scoring (copied from oly_attempts at publish so it survives even if attempt is purged)
  total_marks_obtained numeric not null default 0,
  total_max_marks numeric not null default 0,
  percentage numeric(5,2) not null default 0,
  subject_scores jsonb not null default '[]'::jsonb,  -- [{subject_id, subject_name, correct, total, marks_obtained, marks_max, percentage}]

  -- Time taken (extracted from attempt for ranking)
  total_time_seconds integer,

  -- Ranks (computed server-side)
  class_rank integer,
  class_total integer,
  school_rank integer,
  school_total integer,

  -- Certificate tier
  certificate_tier text not null check (certificate_tier in ('gold', 'silver', 'bronze', 'participation', 'absent')),
  certificate_id text not null unique,  -- format: CERT-{year}-{seq}

  -- PDFs (stored in olympiad-receipts bucket)
  result_pdf_path text,
  certificate_pdf_path text,
  result_pdf_generated_at timestamptz,
  certificate_pdf_generated_at timestamptz,

  -- Email
  emailed_to text,
  emailed_at timestamptz,

  published_at timestamptz not null default now(),
  unique(oly_student_id)
);
create index idx_oly_results_student on public.oly_results(oly_student_id);
create index idx_oly_results_attempt on public.oly_results(oly_attempt_id);
create index idx_oly_results_school on public.oly_results(oly_school_id);
create index idx_oly_results_campaign on public.oly_results(campaign_id);
create index idx_oly_results_tier on public.oly_results(certificate_tier);
create index idx_oly_results_certificate on public.oly_results(certificate_id);

create policy "super_admin all" on public.oly_results for all
  using (public.is_super_admin(auth.uid())) with check (public.is_super_admin(auth.uid()));
create policy "school_admin SELECT own school" on public.oly_results for select
  using (public.oly_is_school_admin_for(auth.uid(), oly_school_id));
create policy "teacher SELECT assigned class" on public.oly_results for select
  using (exists(
    select 1 from public.oly_students s
     where s.id = oly_student_id
       and public.oly_is_teacher_for_class(auth.uid(), s.oly_school_id, s.grade_level_id)
  ));
create policy "student SELECT own" on public.oly_results for select
  using (public.oly_student_can_read(auth.uid(), oly_student_id));
alter table public.oly_results enable row level security;
```

### 2.2 `oly_publish_jobs`

Tracks the async publish pipeline. Each school gets one job. The job has child rows for per-student work that can be retried independently.

```sql
create table public.oly_publish_jobs (
  id uuid primary key default gen_random_uuid(),
  oly_school_id uuid not null references public.oly_schools(id) on delete cascade,
  campaign_id uuid not null references public.oly_campaigns(id) on delete restrict,
  initiated_by uuid references public.profiles(id) on delete set null,

  status text not null default 'queued'
    check (status in ('queued', 'computing_ranks', 'generating_pdfs', 'sending_emails', 'completed', 'failed')),

  total_students integer not null default 0,
  processed_students integer not null default 0,
  failed_students integer not null default 0,
  failure_details jsonb default '[]'::jsonb,

  started_at timestamptz,
  completed_at timestamptz,
  error text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(oly_school_id)  -- one publish job per school
);
create index idx_opj_school on public.oly_publish_jobs(oly_school_id);
create index idx_opj_status on public.oly_publish_jobs(status);
create index idx_opj_initiated_by on public.oly_publish_jobs(initiated_by);

create trigger oly_publish_jobs_set_updated_at before update on public.oly_publish_jobs
  for each row execute function public.oly_set_updated_at();

alter table public.oly_publish_jobs enable row level security;
create policy "super_admin all" on public.oly_publish_jobs for all
  using (public.is_super_admin(auth.uid())) with check (public.is_super_admin(auth.uid()));
create policy "school_admin SELECT own school" on public.oly_publish_jobs for select
  using (public.oly_is_school_admin_for(auth.uid(), oly_school_id));
```

### 2.3 RPCs

#### `oly_publish_initiate(oly_school_id)`

Called by the school admin. Atomic transition: school status → `results_published`, job row inserted. Returns the job_id. The actual processing happens in `oly-publish-school-results` edge function which the client invokes after this RPC succeeds.

```sql
create or replace function public.oly_publish_initiate(p_oly_school_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_school record;
  v_job_id uuid;
  v_total integer;
begin
  if v_uid is null then raise exception 'forbidden' using errcode = '42501'; end if;

  -- Verify caller is school_admin or super_admin
  if not (public.is_super_admin(v_uid) or public.oly_is_school_admin_for(v_uid, p_oly_school_id)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Lock school row + check status
  select id, campaign_id, status
    into v_school
    from public.oly_schools where id = p_oly_school_id for update;
  if v_school.id is null then raise exception 'School not found'; end if;
  if v_school.status = 'results_published' then
    raise exception 'Results already published';
  end if;
  if v_school.status not in ('batches_scheduled', 'exam_in_progress') then
    raise exception 'Cannot publish from status %', v_school.status;
  end if;

  -- Count students in this school for the job
  select count(*) into v_total
    from public.oly_students s
   where s.oly_school_id = p_oly_school_id
     and s.status = 'active';

  -- Create job row (unique constraint prevents duplicates)
  insert into public.oly_publish_jobs (oly_school_id, campaign_id, initiated_by, total_students, status, started_at)
    values (p_oly_school_id, v_school.campaign_id, v_uid, v_total, 'queued', now())
  on conflict (oly_school_id) do update set
    status = 'queued',
    started_at = now(),
    error = null,
    failed_students = 0,
    failure_details = '[]'::jsonb,
    processed_students = 0,
    total_students = excluded.total_students
  returning id into v_job_id;

  -- Lock the exam window — no further attempts allowed
  update public.oly_schools set status = 'results_published' where id = p_oly_school_id;

  -- Audit
  insert into public.oly_audit_log (campaign_id, oly_school_id, actor_id, actor_role, action, after_json)
    values (
      v_school.campaign_id, p_oly_school_id, v_uid,
      case when public.is_super_admin(v_uid) then 'super_admin' else 'school_admin' end,
      'batches_locked',  -- reuse existing enum value; spec doesn't have 'results_published'
      jsonb_build_object('job_id', v_job_id, 'total_students', v_total)
    );

  return jsonb_build_object('ok', true, 'job_id', v_job_id, 'total_students', v_total);
end;
$$;

grant execute on function public.oly_publish_initiate(uuid) to authenticated;
```

(Audit action enum extension: add `results_published` to the constraint in this migration. Existing rows already use the old enum so we widen the constraint.)

#### `oly_publish_compute_ranks(oly_school_id)`

Called by the edge function. Single RPC that computes class + school ranks for all attempted students in one pass using window functions, and writes the `oly_results` rows.

```sql
create or replace function public.oly_publish_compute_ranks(p_oly_school_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_campaign_id uuid;
  v_campaign_year integer;
  v_gold_threshold numeric;
  v_silver_threshold numeric;
  v_bronze_threshold numeric;
  v_inserted integer;
  v_absent_inserted integer;
begin
  if not public.is_super_admin(auth.uid()) and not public.oly_is_school_admin_for(auth.uid(), p_oly_school_id) then
    -- Allow service-role calls (edge function) — check via has_function role
    if not public.has_role(auth.uid(), 'super_admin') and current_user != 'service_role' then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  end if;

  select campaign_id into v_campaign_id from public.oly_schools where id = p_oly_school_id;
  select campaign_year, gold_threshold_percent, silver_threshold_percent, bronze_threshold_percent
    into v_campaign_year, v_gold_threshold, v_silver_threshold, v_bronze_threshold
    from public.oly_campaigns where id = v_campaign_id;

  -- Insert results for students who attempted (submitted, auto_submitted_timer, auto_submitted_violation, auto_submitted_disconnect)
  with ranked as (
    select
      a.id as attempt_id,
      a.oly_student_id,
      s.oly_school_id,
      s.grade_level_id,
      a.total_marks_obtained,
      a.total_max_marks,
      a.percentage,
      a.subject_scores,
      extract(epoch from (a.submitted_at - a.started_at))::integer as total_time_seconds,
      -- Class rank by (percentage desc, total_time_seconds asc) — faster time wins ties
      rank() over (
        partition by s.grade_level_id
        order by a.percentage desc nulls last, extract(epoch from (a.submitted_at - a.started_at)) asc
      ) as class_rank,
      count(*) over (partition by s.grade_level_id) as class_total,
      rank() over (
        order by a.percentage desc nulls last, extract(epoch from (a.submitted_at - a.started_at)) asc
      ) as school_rank,
      count(*) over () as school_total
    from public.oly_attempts a
    join public.oly_students s on s.id = a.oly_student_id
    where s.oly_school_id = p_oly_school_id
      and s.status = 'active'
      and a.status != 'in_progress'
  )
  insert into public.oly_results (
    oly_student_id, oly_attempt_id, campaign_id, oly_school_id,
    total_marks_obtained, total_max_marks, percentage, subject_scores,
    total_time_seconds,
    class_rank, class_total, school_rank, school_total,
    certificate_tier, certificate_id
  )
  select
    r.oly_student_id, r.attempt_id, v_campaign_id, r.oly_school_id,
    r.total_marks_obtained, r.total_max_marks, r.percentage, r.subject_scores,
    r.total_time_seconds,
    r.class_rank, r.class_total, r.school_rank, r.school_total,
    case
      when r.percentage >= v_gold_threshold then 'gold'
      when r.percentage >= v_silver_threshold then 'silver'
      when r.percentage >= v_bronze_threshold then 'bronze'
      else 'participation'
    end as certificate_tier,
    'CERT-' || v_campaign_year::text || '-' || lpad(nextval('oly_certificate_seq')::text, 7, '0')
  from ranked r
  on conflict (oly_student_id) do nothing
  ;
  get diagnostics v_inserted = row_count;

  -- Insert absent rows for students with no attempt or in_progress attempt
  insert into public.oly_results (
    oly_student_id, oly_attempt_id, campaign_id, oly_school_id,
    total_marks_obtained, total_max_marks, percentage, subject_scores,
    certificate_tier, certificate_id
  )
  select
    s.id, null, v_campaign_id, s.oly_school_id,
    0, 0, 0, '[]'::jsonb,
    'absent',
    'CERT-' || v_campaign_year::text || '-' || lpad(nextval('oly_certificate_seq')::text, 7, '0')
  from public.oly_students s
  left join public.oly_attempts a on a.oly_student_id = s.id and a.status != 'in_progress'
  where s.oly_school_id = p_oly_school_id
    and s.status = 'active'
    and a.id is null
  on conflict (oly_student_id) do nothing
  ;
  get diagnostics v_absent_inserted = row_count;

  return jsonb_build_object('ok', true, 'inserted', v_inserted, 'absent_inserted', v_absent_inserted);
end;
$$;

grant execute on function public.oly_publish_compute_ranks(uuid) to authenticated;
```

(Certificate sequence: `create sequence oly_certificate_seq start 1;` in the migration.)

#### `oly_get_published_result(student_id)`

Returns the published result for a student (or their own self-lookup via auth.uid()). Used by the student dashboard + result detail page.

```sql
create or replace function public.oly_get_published_result(p_student_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_target uuid;
  v_result record;
  v_student record;
begin
  if v_uid is null then raise exception 'forbidden' using errcode = '42501'; end if;

  if p_student_id is null then
    -- Self-lookup
    select id into v_target from public.oly_students
     where (auth_user_id = v_uid or profile_id = v_uid) and status = 'active' limit 1;
  else
    v_target := p_student_id;
    if not public.oly_student_can_read(v_uid, v_target) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  end if;
  if v_target is null then return jsonb_build_object('ok', false, 'reason', 'no_enrollment'); end if;

  select r.*, s.full_name, s.roll_number, s.class_label, s.section_label
    into v_result, v_student
    from public.oly_results r
    join public.oly_students s on s.id = r.oly_student_id
   where r.oly_student_id = v_target;
  if v_result.id is null then return jsonb_build_object('ok', false, 'reason', 'not_published_yet'); end if;

  return jsonb_build_object(
    'ok', true,
    'result_id', v_result.id,
    'full_name', v_student.full_name,
    'roll_number', v_student.roll_number,
    'class_label', v_student.class_label,
    'section_label', v_student.section_label,
    'total_marks_obtained', v_result.total_marks_obtained,
    'total_max_marks', v_result.total_max_marks,
    'percentage', v_result.percentage,
    'subject_scores', v_result.subject_scores,
    'total_time_seconds', v_result.total_time_seconds,
    'class_rank', v_result.class_rank,
    'class_total', v_result.class_total,
    'school_rank', v_result.school_rank,
    'school_total', v_result.school_total,
    'certificate_tier', v_result.certificate_tier,
    'certificate_id', v_result.certificate_id,
    'result_pdf_path', v_result.result_pdf_path,
    'certificate_pdf_path', v_result.certificate_pdf_path,
    'published_at', v_result.published_at
  );
end;
$$;

grant execute on function public.oly_get_published_result(uuid) to authenticated;
```

#### `oly_get_published_signed_url(result_id, kind)`

Returns a signed URL for the result or certificate PDF, with scope check. Same defense-in-depth pattern as Phase 4a study material URLs.

```sql
create or replace function public.oly_get_published_signed_url_path(
  p_result_id uuid, p_kind text
) returns text language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_path text;
  v_owner_student uuid;
  v_owner_school uuid;
begin
  if v_uid is null then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_kind not in ('result', 'certificate') then raise exception 'Invalid kind'; end if;

  select case when p_kind = 'result' then result_pdf_path else certificate_pdf_path end,
         oly_student_id, oly_school_id
    into v_path, v_owner_student, v_owner_school
    from public.oly_results where id = p_result_id;
  if v_path is null then raise exception 'PDF not yet generated' using errcode = 'P0002'; end if;

  -- Scope check
  if not (
    public.is_super_admin(v_uid)
    or public.oly_is_school_admin_for(v_uid, v_owner_school)
    or public.oly_student_can_read(v_uid, v_owner_student)
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return v_path;
end;
$$;

grant execute on function public.oly_get_published_signed_url_path(uuid, text) to authenticated;
```

### 2.4 Audit action enum extension

```sql
alter table public.oly_audit_log drop constraint if exists oly_audit_log_action_check;
alter table public.oly_audit_log add constraint oly_audit_log_action_check
  check (action in (
    'student_enrolled_cash','student_edited','student_removed',
    'enrollment_closed','teacher_created','teacher_assigned','teacher_unassigned',
    'batch_draft_generated','batches_locked','batch_pin_regenerated',
    'batch_rescheduled','credentials_pdf_generated','absentees_batch_created',
    'results_published', 'result_pdf_generated', 'certificate_pdf_generated', 'results_email_sent'
  ));
```

---

## 3. Edge functions

### 3.1 `oly-publish-school-results` (orchestrator)

Triggered by the client after `oly_publish_initiate` succeeds. Runs the publish pipeline in chunks. Returns immediately with the job_id; the client polls job status.

Algorithm:
1. Verify caller is school_admin OR super_admin
2. Update job status: `computing_ranks` → call `oly_publish_compute_ranks(school_id)` → wait for completion
3. Update job status: `generating_pdfs` → for each `oly_results` row in batches of 10, invoke `oly-generate-result-pdf` + `oly-generate-certificate-pdf` in parallel (Promise.allSettled)
4. Update job status: `sending_emails` → for each result with parent_email, invoke `oly-send-results-email`
5. Update job status: `completed`
6. On any error: set status='failed' + error message; let admin retry

For idempotency, each step checks "is this work already done?" before re-doing. E.g. if `result_pdf_path IS NOT NULL`, skip regenerating.

### 3.2 `oly-generate-result-pdf` (per-student)

Inputs: `{ oly_result_id }`. Loads result + attempt + snapshot + answers. Generates multi-page PDF via pdf-lib:

**Page 1 — Identity & Headline:**
- SALCI Olympiad logo + branding
- Student name, roll number, school, class, section, year
- Subjects chosen
- Big bold combined score: "72 / 90 — 80.00%"
- Certificate tier with tier color
- Rank in class (e.g. "3rd of 42") + Rank in school (e.g. "12th of 287")
- Total time taken

**Page 2 — Subject-wise summary:**
- For each of 3 chosen subjects: name + score + percentage + time + topic-wise breakdown (mini bar chart approximation as horizontal bars)

**Pages 3-N — Per-question breakdown:**
- Organized by subject
- For each question: question text (KaTeX rendered as image — use a server-side KaTeX renderer like `katex-cli` or pre-rendered HTML→canvas; or fall back to raw `$...$` text if rendering is too heavy), 4 options, student's selected answer (red if wrong / green if right), correct answer (always green), marks awarded, time spent (skipped if telemetry not granular)

**Final page — Behavioral insights:**
- Pacing summary (e.g. "You completed Math 25% faster than average")
- Subject-specific focus recommendations (e.g. "Math: focus on Geometry — you scored 30% here vs 80% in other Math topics")

Stores at `olympiad-receipts/results/{result_id}.pdf`. Updates `oly_results.result_pdf_path` + `result_pdf_generated_at`.

For KaTeX rendering in PDF: defer to plain-text fallback in Phase 5a (KaTeX→image is heavy). Phase 5b polish can swap to image rendering if needed. Document this as a known limitation.

### 3.3 `oly-generate-certificate-pdf` (per-student)

Inputs: `{ oly_result_id }`. Single-page landscape A4 PDF:
- Large SALCI logo + branded border
- "Certificate of Achievement" (Gold/Silver/Bronze) or "Certificate of Participation"
- "This is to certify that {Student Name}"
- "of {School Name}, Class {X}"
- "has [achieved Gold/Silver/Bronze / participated in] the SALCI Olympiad 2026"
- Combined score
- Rank in school (only on Gold/Silver/Bronze)
- SALCI digital signature/seal (placeholder for v1 — text "Authorized by Team SALCI")
- Date of publish
- "Certificate ID: {unique ID}" small at bottom

Stores at `olympiad-receipts/certificates/{result_id}.pdf`. Updates `oly_results.certificate_pdf_path` + `certificate_pdf_generated_at`.

### 3.4 `oly-send-results-email` (per-student)

Inputs: `{ oly_result_id }`. Sends Resend email to parent with:
- Subject: "SALCI Olympiad 2026 Results — {Student Name}"
- Body: docx-spec template with student name, roll, score, tier, login link
- Attaches both result PDF and certificate PDF (or signed URL links if attachment size becomes an issue — Phase 5a uses links since Resend has 40MB attachment limit and PDFs can be 1-3MB each)

Updates `oly_results.emailed_to` + `emailed_at`.

---

## 4. School admin UI

### 4.1 "Publish Results & Close Exam" button

On the school dashboard (Phase 3a), when `school.status = 'batches_scheduled'`, the existing disabled "Publish Results" button becomes live.

Click → `PublishResultsDialog` opens with verbatim docx confirmation copy:

> You are about to publish results for {School Name}. This action is permanent and cannot be reversed. After publishing: no further attempts can be made by any student; results and certificates will be sent to all parents; you will not be able to conduct additional batches. Have you confirmed with all teachers that every batch is complete?

Two buttons: [Cancel] [Yes, Publish & Close Exam]

On confirm:
1. Call `oly_publish_initiate(oly_school_id)` RPC → get job_id
2. Invoke `oly-publish-school-results` edge function (fire-and-forget)
3. Show toast "Publishing results for {N} students. This may take 5-10 minutes. You'll receive an email when it's complete."
4. Redirect to publish-status page

### 4.2 `/school/olympiad/publish-status` page

Polls `oly_publish_jobs` row every 5 seconds (justified §23.2 — admin-facing waiting page) until status = 'completed' or 'failed'. Shows progress bar (`processed_students / total_students`) and per-step status.

When complete, shows "View results" button → `/school/olympiad/results` (Phase 5b will flesh this out; 5a ships a thin version).

---

## 5. Student post-publish dashboard

`OlympiadStudentDashboardPage` (modify):

When `dashboardContext.attempt` exists AND `oly_get_published_result()` returns ok=true:
- Replace the "Awaiting results" badge with a result card showing:
  - Big score: "72 / 90 — 80.00%"
  - Certificate tier badge (Gold/Silver/Bronze/Participation/Absent)
  - Rank in school: "12th of 287"
  - Rank in class: "3rd of 42"
- Two download buttons: "Download report" + "Download certificate" — each opens the signed URL in a new tab
- "Review your answers" link → `/student/olympiad/review`

### `/student/olympiad/review` page

Renders all 90 questions with student's selected answer + correct answer highlighted. Subject tabs at top (same component as exam). Per-question shows:
- Question text via `MathText` (KaTeX)
- 4 options
- Student's choice (red if wrong, green if right)
- Correct answer (always green, with check mark)
- Marks awarded (1/1 or 0/1)

Read-only — no save buttons.

---

## 6. Hooks

- `usePublishInitiate()` — mutation calling `oly_publish_initiate` RPC, then invoking `oly-publish-school-results` edge function
- `useOlympiadPublishJob(olySchoolId)` — query polling `oly_publish_jobs` row every 5s while status != completed/failed
- `useOlympiadPublishedResult()` — self-lookup via `oly_get_published_result()`; `staleTime: 60_000`
- `useOlympiadPublishedResultUrl()` — mutation to get signed URL for result/certificate PDF
- `useOlympiadReviewQuestions(attempt_id)` — reuses `oly_get_attempt_questions` (now allowed post-submit) + injects correct_answer column from snapshot

---

## 7. Acceptance criteria

- School admin can click "Publish & Close Exam" with mandatory confirmation
- Pipeline runs async, status visible via polling
- Ranks computed correctly (window function over percentage, tied by time)
- Certificate tiers correctly applied per thresholds in campaign settings
- Result PDFs + certificate PDFs generated and stored
- Parent emails sent (idempotent on retry)
- Student dashboard shows post-publish result
- Per-question review page works
- All §23 patterns honored: RPC-only hot paths, FK indexes, SECURITY DEFINER helpers, explicit staleTime, no select("*")
- All audit log rows written for publish actions

---

## 8. Risks and open items

- **KaTeX in PDFs**: deferred to plain-text fallback in 5a; 5b polish or pre-rendering pipeline can upgrade.
- **Email size with attachments**: 5a uses signed-URL links in email body, NOT attachments. PDFs can be 1-3MB each; Resend allows 40MB total but we save bandwidth by linking.
- **Publish idempotency**: each step checks "already done?" via `oly_results.result_pdf_path IS NULL` etc. Re-running the orchestrator picks up where left off.
- **Race on `oly_publish_initiate`**: unique constraint on `(oly_school_id)` in `oly_publish_jobs` prevents two admins triggering simultaneously. The `FOR UPDATE` lock on `oly_schools` prevents status-flip races.
- **Ties in rank computation**: PostgreSQL `RANK()` window assigns same rank to ties, skips next. So 2 students tied at rank 3 → next student is rank 5. Acceptable per docx ("tie-break by total time taken, lower time = higher rank") — we tie-break by time first, so ties should be rare.
- **Per-question review unlocks `oly_get_attempt_questions` post-submit** — Phase 4b's RPC only checks ownership, not status. Already permits post-submit reads. No change needed.
- **Big result PDFs (Page 3+)**: 90 questions × ~5 lines each = 450 lines = 5-7 pages. PDF size ~2MB. Acceptable.
- **Storage RLS**: signed URLs are generated via `createSignedUrl` after the RPC validates ownership. The bucket's existing super_admin-manage policy doesn't allow students to read directly; they go through the path RPC.
