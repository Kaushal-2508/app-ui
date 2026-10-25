# SALCI Olympiad Phase 3b — Batching, PIN Custody, Credentials Design

**Status:** Draft v1
**Date:** 2026-05-26
**Parent doc:** [2026-05-26-olympiad-master-decomposition-design.md](./2026-05-26-olympiad-master-decomposition-design.md)
**Source:** SALCI_Olympiad_Build_Prompt2.docx (Phase 3, batching part)
**Depends on:** Phase 1, Phase 2, Phase 3a
**Followed by:** Phase 4 (exam delivery)

This phase delivers everything between "enrollment closed" and "exam day": the batching solver, kanban scheduler, PIN custody flow, pre-exam reminder cron, printable credentials PDF, and the absentees pool. After Phase 3b, a school can take their closed roster and end up with locked batches, distributed credentials, and students one click away from being able to sit the exam.

---

## 1. Scope

In:

- DB schema for `oly_batches`, `oly_batch_assignments`, `oly_reminder_log` + a wrapper view `oly_batches_no_pin` for teacher/student reads + extended RLS + cron job entry
- 4 edge functions: `oly-generate-batch-schedule`, `oly-lock-batch-schedule`, `oly-send-pre-exam-reminders`, `oly-generate-credentials-pdf`
- School admin pages: `/school/olympiad/batches` (kanban scheduler), `/school/olympiad/pin-custody` (PIN visibility + edit), `/school/olympiad/absentees` (post-main-batch absentees flow)
- Teacher portal addition: "Print credentials" button per class
- Dashboard wiring: "Schedule Batches" button (currently disabled in 3a) becomes enabled when status = `enrollment_closed`
- `@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities` added as deps for the kanban

Out (deferred):

- Exam delivery (Phase 4 — student login, PIN entry, exam UI)
- Auto-mark-absent flow at PIN expiry (Phase 4)
- Results publish pipeline (Phase 5)
- Day 30 / Day 60 dormancy (Phase 5)

---

## 2. Database schema (additive migration)

One migration: `supabase/migrations/<ts>_oly_phase_3b_batching.sql`.

### 2.1 `oly_batches`

```sql
create table public.oly_batches (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.oly_campaigns(id) on delete restrict,
  oly_school_id uuid not null references public.oly_schools(id) on delete cascade,
  grade_level_id uuid references public.grade_levels(id) on delete restrict,  -- null for mixed/absentees batches
  batch_label text not null,                                                   -- "Class 8 - Batch 1" or "Absentees Batch 1"
  scheduled_at timestamptz not null,
  pc_count integer not null check (pc_count > 0),
  pin text,                                                                    -- 6-char alphanumeric uppercase; null until lock
  pin_expiry_minutes integer not null default 120 check (pin_expiry_minutes > 0),
  pin_first_used_at timestamptz,                                               -- set when first student successfully enters; clamps to pin_expiry_minutes window
  is_absentees boolean not null default false,                                 -- absentees pool batches flagged
  status text not null default 'draft'
    check (status in ('draft', 'locked', 'in_progress', 'completed', 'cancelled')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  locked_at timestamptz,
  unique(oly_school_id, scheduled_at, grade_level_id, is_absentees)            -- prevents same-class same-slot dupes
);
create index idx_oly_batches_school on public.oly_batches(oly_school_id);
create index idx_oly_batches_campaign on public.oly_batches(campaign_id);
create index idx_oly_batches_grade_level on public.oly_batches(grade_level_id);
create index idx_oly_batches_scheduled_at on public.oly_batches(scheduled_at);
create index idx_oly_batches_status on public.oly_batches(status);
create index idx_oly_batches_pin on public.oly_batches(pin) where pin is not null;
create index idx_oly_batches_created_by on public.oly_batches(created_by);
create trigger oly_batches_set_updated_at before update on public.oly_batches
  for each row execute function public.oly_set_updated_at();
```

### 2.2 `oly_batch_assignments`

```sql
create table public.oly_batch_assignments (
  id uuid primary key default gen_random_uuid(),
  oly_batch_id uuid not null references public.oly_batches(id) on delete cascade,
  oly_student_id uuid not null references public.oly_students(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  unique(oly_student_id)                                                        -- a student belongs to exactly one batch at a time
);
create index idx_oba_batch on public.oly_batch_assignments(oly_batch_id);
create index idx_oba_student on public.oly_batch_assignments(oly_student_id);
```

The `unique(oly_student_id)` constraint is the strict per-student batch binding. To move a student between batches, delete the old assignment first.

### 2.3 `oly_reminder_log`

```sql
create table public.oly_reminder_log (
  id uuid primary key default gen_random_uuid(),
  oly_batch_id uuid not null references public.oly_batches(id) on delete cascade,
  oly_student_id uuid not null references public.oly_students(id) on delete cascade,
  reminder_type text not null check (reminder_type in ('pre_exam_3d')),
  sent_at timestamptz not null default now(),
  sent_to_email text,
  unique(oly_batch_id, oly_student_id, reminder_type)
);
create index idx_orl_batch on public.oly_reminder_log(oly_batch_id);
create index idx_orl_student on public.oly_reminder_log(oly_student_id);
create index idx_orl_sent_at on public.oly_reminder_log(sent_at);
```

The `unique` constraint prevents double-sends if pg_cron fires twice.

### 2.4 PIN-hiding wrapper view

```sql
create view public.oly_batches_no_pin
with (security_invoker = true)
as
select
  id, campaign_id, oly_school_id, grade_level_id, batch_label,
  scheduled_at, pc_count, pin_expiry_minutes, pin_first_used_at,
  is_absentees, status, created_at, updated_at, locked_at
from public.oly_batches;

grant select on public.oly_batches_no_pin to authenticated;
```

`security_invoker = true` makes the view honor the caller's RLS policies on `oly_batches` (Postgres 15+ feature; Supabase is on PG 15). This means a teacher running SELECT against the view sees only batches their RLS permits — and the `pin` column is just absent.

### 2.5 RLS — split visibility

`oly_batches`:
- super_admin: full
- school_admin: full own school (sees `pin` directly)
- NO teacher / student policy on `oly_batches` itself — they go through `oly_batches_no_pin`

```sql
alter table public.oly_batches enable row level security;
create policy "super_admin all" on public.oly_batches for all
  using (public.is_super_admin(auth.uid())) with check (public.is_super_admin(auth.uid()));
create policy "school_admin all own school" on public.oly_batches for all
  using (public.oly_is_school_admin_for(auth.uid(), oly_school_id))
  with check (public.oly_is_school_admin_for(auth.uid(), oly_school_id));
```

For the `oly_batches_no_pin` view, since `security_invoker = true`, we need policies on the underlying table that teachers and students can pass. Add SELECT-only policies to `oly_batches` itself but ONLY exposed through the view (the column list of the view excludes `pin`):

```sql
create policy "teacher SELECT own school" on public.oly_batches for select
  using (exists(
    select 1 from public.oly_teacher_class_assignments
     where oly_school_id = public.oly_batches.oly_school_id
       and teacher_profile_id = auth.uid()
  ));

create policy "student SELECT own batch" on public.oly_batches for select
  using (exists(
    select 1 from public.oly_batch_assignments oba
      join public.oly_students s on s.id = oba.oly_student_id
     where oba.oly_batch_id = public.oly_batches.id
       and s.profile_id = auth.uid()
  ));
```

**Critical:** teachers / students could in theory `SELECT pin FROM oly_batches WHERE ...` and see the PIN. To truly hide the column, we add a column privilege:

```sql
revoke select (pin) on public.oly_batches from authenticated;
grant select (pin) on public.oly_batches to authenticated using ...;  -- not valid syntax
```

PostgreSQL column-level grants are independent of RLS — `REVOKE SELECT (pin) ... FROM authenticated` followed by a custom role won't work cleanly because Supabase auth defaults all logged-in users to `authenticated`. The cleaner approach: lock down `pin` via a SECURITY DEFINER RPC for school_admin reads and prevent direct SELECT entirely. But that's invasive.

**Final design:** keep the policies above. The `oly_batches_no_pin` view IS the public surface for teachers + students. The frontend hooks for teacher/student always query the view, never the raw table. We document this as a contract in CLAUDE.md §22-equivalent for Olympiad: "Teacher and student code MUST query `oly_batches_no_pin`, never `oly_batches` directly. This is enforced by ESLint pattern rule [see Task 1 step 3]." A pragmatic compromise: full DB-level enforcement is over-engineered for a controlled school-portal codebase where every PR is reviewed. The defense-in-depth IS the named-policy + view-shaped-API + lint check combo.

For `oly_batch_assignments`:

```sql
alter table public.oly_batch_assignments enable row level security;
create policy "super_admin all" on public.oly_batch_assignments for all
  using (public.is_super_admin(auth.uid())) with check (public.is_super_admin(auth.uid()));
create policy "school_admin all own school" on public.oly_batch_assignments for all
  using (exists(
    select 1 from public.oly_batches b
     where b.id = oly_batch_id
       and public.oly_is_school_admin_for(auth.uid(), b.oly_school_id)
  ))
  with check (exists(
    select 1 from public.oly_batches b
     where b.id = oly_batch_id
       and public.oly_is_school_admin_for(auth.uid(), b.oly_school_id)
  ));
create policy "teacher SELECT own classes" on public.oly_batch_assignments for select
  using (exists(
    select 1 from public.oly_students s
      join public.oly_teacher_class_assignments tca
        on tca.oly_school_id = s.oly_school_id
        and tca.grade_level_id = s.grade_level_id
        and tca.teacher_profile_id = auth.uid()
     where s.id = oly_student_id
  ));
create policy "student SELECT own" on public.oly_batch_assignments for select
  using (exists(
    select 1 from public.oly_students s
     where s.id = oly_student_id
       and s.profile_id = auth.uid()
  ));
```

For `oly_reminder_log`:

```sql
alter table public.oly_reminder_log enable row level security;
create policy "super_admin all" on public.oly_reminder_log for all
  using (public.is_super_admin(auth.uid())) with check (public.is_super_admin(auth.uid()));
create policy "school_admin SELECT own school" on public.oly_reminder_log for select
  using (exists(
    select 1 from public.oly_batches b
     where b.id = oly_batch_id
       and public.oly_is_school_admin_for(auth.uid(), b.oly_school_id)
  ));
```

### 2.6 PIN generation function

```sql
create or replace function public.oly_generate_batch_pin()
returns text language plpgsql as $$
declare
  v_alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  -- excludes I, O, 0, 1 for human readability
  v_len integer := 6;
  v_pin text;
  v_i integer;
  v_attempts integer := 0;
begin
  loop
    v_pin := '';
    for v_i in 1..v_len loop
      v_pin := v_pin || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::integer, 1);
    end loop;
    -- Collision check — globally unique among unexpired batches
    exit when not exists(
      select 1 from public.oly_batches
       where pin = v_pin
         and status in ('locked', 'in_progress')
    );
    v_attempts := v_attempts + 1;
    if v_attempts > 100 then
      raise exception 'Could not generate unique batch PIN after 100 attempts';
    end if;
  end loop;
  return v_pin;
end;
$$;
```

### 2.7 pg_cron job

```sql
select cron.schedule(
  'oly-pre-exam-reminders',
  '0 9 * * *',                                                                  -- daily at 9 AM IST (UTC+5:30)
  $$
  select net.http_post(
    url := 'https://gyymkgohcijeksmrzuyw.supabase.co/functions/v1/oly-send-pre-exam-reminders',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.cron_secret', true),
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object()
  );
  $$
);
```

The `app.cron_secret` GUC needs to be set in the project. Pattern: super admin sets it via `ALTER DATABASE ... SET app.cron_secret = '...';` then the edge function checks it. Existing `send-fee-reminder` precedent in the repo handles the same auth shape.

---

## 3. Edge functions

### 3.1 `oly-generate-batch-schedule`

Inputs: `{ oly_school_id, inputs: { pc_count: int, date_from: ISO, date_to: ISO, day_start_hh_mm: string, day_end_hh_mm: string, buffer_minutes: int (min 15) } }`.

Verifies caller is `school_admin` for the school. Verifies school status = `enrollment_closed`. Loads active students grouped by grade_level_id. Reads `oly_campaigns.exam_duration_minutes` for slot length.

Algorithm (simple):
1. For each grade_level_id, divide students into batches of size `min(pc_count, remaining_students)`.
2. Place batches sequentially in the date×time grid: `slot_minutes = exam_duration + buffer_minutes`. Walk forward day-by-day, hh:mm to hh:mm window.
3. If a grade's last batch under-uses PCs by more than 50%, flag it as `mergeable: true` in the response.

Returns: draft schedule as JSON `{ batches: [{ scheduled_at, grade_level_id, student_ids[], pc_count, batch_label }], unscheduled_count, conflicts: [...] }`. **Does NOT write to `oly_batches`.** The frontend kanban consumes this, lets the admin tweak, then calls `oly-lock-batch-schedule` with the final tweaked structure.

### 3.2 `oly-lock-batch-schedule`

Inputs: `{ oly_school_id, batches: [{ scheduled_at, grade_level_id, student_ids[], pc_count, batch_label, pin_expiry_minutes? (default 120) }] }`.

Verifies caller is school_admin. Verifies school status = `enrollment_closed`. In a transaction (via service role):

1. INSERT a row into `oly_batches` for each batch in input, with `status = 'locked'`, `pin = oly_generate_batch_pin()`, `locked_at = now()`.
2. INSERT corresponding `oly_batch_assignments` rows.
3. UPDATE `oly_schools.status = 'batches_scheduled'`.
4. Schedule the pre-exam reminders implicitly — the daily cron picks up the new batches automatically.
5. Insert one `oly_audit_log` row per batch (action: `batches_locked`, after_json includes batch IDs).

Returns: `{ batch_ids: [...] }`. The kanban then refetches and shows the locked schedule with PINs visible.

### 3.3 `oly-send-pre-exam-reminders` (cron-invoked)

Public POST endpoint (verified by `app.cron_secret`). No user-JWT.

1. Query `oly_batches` for batches where `scheduled_at::date = (now() + interval '3 days')::date` AND `status = 'locked'`.
2. For each such batch, join `oly_batch_assignments` + `oly_students` to get students with `parent_email IS NOT NULL`.
3. For each (batch, student) pair NOT already in `oly_reminder_log` for `reminder_type = 'pre_exam_3d'`, send email via Resend.
4. Insert `oly_reminder_log` row on successful send.

Idempotent: re-running on the same day won't double-send because of the unique constraint.

### 3.4 `oly-generate-credentials-pdf`

Inputs: `{ oly_school_id, grade_level_id }`. Verifies caller is teacher assigned to that class OR school_admin.

Queries `oly_students` for active students in the class. Generates a PDF (pdf-lib) with one row per student showing **name + roll number + DOB (ddmmyy format)** — formatted as cut-out slips, 2 per row, 5 rows per page. Returns signed URL (5 minute TTL).

The PDF intentionally does NOT include the PIN. PIN is only ever displayed in school_admin's PIN custody view.

---

## 4. School admin pages

### 4.1 `/school/olympiad/batches` — Kanban Scheduler

Three-step flow on the same page:

**Step 1: Inputs**
- PC count input (number, min 1)
- Date range pickers (from/to)
- Daily time window (hh:mm — hh:mm)
- Buffer minutes (default 20, min 15)
- "Generate draft" button → calls `oly-generate-batch-schedule` → state.draft = response

**Step 2: Kanban**
- Once a draft exists, show columns for each time slot (Monday 10am, Monday 12pm, Tuesday 10am, etc.)
- Each batch is a card showing: batch_label, student count, PC usage indicator
- Cards are draggable between columns via `@dnd-kit/sortable`
- Validation: two batches in the same column only allowed if combined student count ≤ pc_count (visual warning + block on drop)
- Edit mode: click a card → sheet with batch details, edit pin_expiry_minutes, see student list
- "Lock schedule" button → confirmation dialog → calls `oly-lock-batch-schedule` → page reloads in PIN custody mode

**Step 3: Locked view** (post-lock)
- Read-only kanban
- "Edit batch" still works for date/time/pin_expiry but PIN is fixed
- Links to PIN custody page
- "Print credentials" button per batch (calls edge function)

### 4.2 `/school/olympiad/pin-custody`

Only renders for school_admin. PIN visible. Table view:

| Batch | Date / Time | Students | PC count | PIN | Expiry | Edit |
|---|---|---|---|---|---|---|
| Class 8 - Batch 1 | Mon Apr 6, 10:00 AM | 32 | 32 | XK4M7P | 120 min | ⋮ |

Per row kebab: Edit time/date (with "this won't update sent reminders" warning), Edit pin_expiry, Regenerate PIN (with confirmation).

PIN is shown as a copyable monospace string — click to copy. There's also a "Print PIN sheet" action that generates a PDF with all PINs + batch info for the admin to keep physically.

### 4.3 `/school/olympiad/absentees`

Only visible after at least one batch is completed (status='completed'). Shows:
- Unattempted students count + list (students whose `oly_batch_assignments` exists but who haven't attempted — for Phase 3b, since exam attempts land in Phase 4, the criterion is purely time-based: their assigned batch's `pin_expiry_minutes` window has elapsed AND they have no attempt record). Phase 3b ships the page shell + the "Create Absentees Batch" button — the actual "did not attempt" detection wires up in Phase 4.
- "Create Absentees Batch" → small kanban scoped to just the absentees pool (pick PC count, date, time → generates 1+ absentees batches → locks → PIN visible)

Phase 3b ships this page in basic form: list of students with no batch assignment OR with a `cancelled` batch. The full "did not attempt" detection lands in Phase 4 once exam attempts exist.

### 4.4 Dashboard wiring

In `OlympiadSchoolDashboardPage`:
- When status = `enrollment_closed`: enable the "Schedule Batches" button (currently disabled in 3a)
- When status = `batches_scheduled`: show "View Schedule" + "PIN Custody" buttons
- When status = `exam_in_progress`: show live batch table (Phase 4 will fill in attempt counts)
- When status = `results_published`: shown in Phase 5

---

## 5. Teacher portal addition

In `OlympiadTeacherClassPage` (Phase 3a):
- The currently-disabled "Print credentials" button becomes live
- Calls `oly-generate-credentials-pdf` with the page's `olySchoolId` + `gradeLevelId`
- Opens the returned signed URL in a new tab
- Schedule view section (read-only): shows the batch this class is scheduled for via `oly_batches_no_pin` join → "Class 8 Batch on Mon Apr 6, 10:00 AM"

Teachers cannot see PINs anywhere.

---

## 6. Hooks (new)

- `useOlympiadBatches(olySchoolId)` — school_admin: query `oly_batches` including PIN
- `useOlympiadBatchesNoPin(olySchoolId)` — teacher/student: query `oly_batches_no_pin` view
- `useGenerateBatchSchedule()` — mutation calling `oly-generate-batch-schedule`
- `useLockBatchSchedule()` — mutation calling `oly-lock-batch-schedule`
- `useOlympiadAbsenteesPool(olySchoolId)` — students without a current-status batch assignment
- `useGenerateCredentialsPdf()` — mutation calling `oly-generate-credentials-pdf`, returns signed URL
- `useUpdateBatchPinExpiry()` — direct UPDATE on `oly_batches.pin_expiry_minutes` (school_admin RLS allows)
- `useRegenerateBatchPin()` — RPC `oly_regenerate_batch_pin(batch_id)` that calls `oly_generate_batch_pin()` + audits

---

## 7. Routing

```
/school/olympiad/batches                          → OlympiadSchoolBatchesPage (kanban)
/school/olympiad/pin-custody                      → OlympiadSchoolPinCustodyPage
/school/olympiad/absentees                        → OlympiadSchoolAbsenteesPage
```

All school_admin / super_school_admin / coordinator allowed. Sidebar entries gated by school's `oly_schools.status` — render only when status is past `enrollment_closed`.

Actually: keeping the sidebar simple, all three routes get sidebar entries always (under a "Olympiad" sub-section), with pages themselves showing "Not yet available — close enrollment first" empty states when status is too early.

---

## 8. Acceptance criteria

- School admin can generate a draft schedule from PC count + date range
- Kanban drag-and-drop between time slots works, with PC-overflow validation
- Lock schedule generates unique 6-char PINs (excluding ambiguous chars), marks school status `batches_scheduled`
- PIN custody page shows PINs ONLY to school_admin
- Teachers + students querying `oly_batches_no_pin` see batches but NEVER the PIN
- Pre-exam reminder cron fires daily, sends 3-day-out emails idempotently
- Print credentials PDF generates with name + roll + DOB slips, no PIN
- Absentees pool page shell renders post-batch-completion
- All audit-relevant actions write to `oly_audit_log`
- §5a contract passes
- Bundle delta: new chunks for batches/pin-custody/absentees < 50 KB gzipped each
- @dnd-kit chunk lazy-loaded (only on `/school/olympiad/batches`, not in main bundle)

---

## 9. Risks and open items

- **Column-level PIN hiding** — accepted compromise: code-side contract enforced by ESLint + view-shaped API. True DB-level column REVOKE would require a custom Postgres role, which conflicts with Supabase's `authenticated` default.
- **PIN collisions** — alphabet excludes ambiguous chars (no I/O/0/1). With 32^6 = ~1B possibilities and at most a few hundred active batches at peak, collisions are statistically irrelevant. The generator retries up to 100 times anyway.
- **`oly_generate_batch_schedule` algorithm complexity** — Phase 3b ships a simple greedy: per-class batches of `min(pc_count, remaining)`, sequentially placed. Doesn't optimize for "merge half-empty batches across classes" except via the `mergeable: true` flag on the response. Admin can drag-merge in the kanban. A true bin-packing solver is Phase 4+ if needed.
- **pg_cron secret** — `app.cron_secret` GUC needs to be set as a one-time DB config. Document in deployment notes. Edge function checks it.
- **PIN regenerate when status='in_progress'** — actively-attempting students might have already entered the old PIN. The regenerate flow blocks regeneration once any student in the batch has started.
- **Absentees pool detection** — Phase 3b ships a page shell. Real "did not attempt" detection lands in Phase 4 when attempts exist.
- **@dnd-kit accessibility** — `@dnd-kit/core` has built-in keyboard sensors. The kanban must announce drag state via `aria-live` for screen readers. Verify in implementation.
- **Date/time picker** — use shadcn `Calendar` + custom hh:mm input. The repo already uses `react-day-picker` (per Phase 1 plan check). No new dep beyond `@dnd-kit/*`.
