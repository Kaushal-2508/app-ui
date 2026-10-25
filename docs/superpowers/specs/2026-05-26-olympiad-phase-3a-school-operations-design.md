# SALCI Olympiad Phase 3a — School Operations Design

**Status:** Draft v1
**Date:** 2026-05-26
**Parent doc:** [2026-05-26-olympiad-master-decomposition-design.md](./2026-05-26-olympiad-master-decomposition-design.md)
**Source:** SALCI_Olympiad_Build_Prompt2.docx (Phase 3, partial)
**Depends on:** Phase 1 (catalog), Phase 2 (schools + students + enrollment)
**Followed by:** Phase 3b (batching + PIN custody + credentials)

This phase delivers the school admin + teacher portals up to (but not including) batch scheduling. After Phase 3a, a school admin can land in their workspace post-onboarding, manage teachers (or assign existing SALCI teachers), share the public URL via QR / WhatsApp / email, close enrollment with one switch, and let teachers cash-enroll students and edit/remove students with audit. Batching, PIN custody, and credentials are Phase 3b.

---

## 1. Scope

In:

- DB schema for `oly_audit_log` and `oly_teacher_class_assignments` + SECURITY DEFINER helpers + extended RLS on all existing `oly_*` tables
- 6 edge functions: `oly-create-teacher`, `oly-assign-existing-teachers`, `oly-close-enrollment`, `oly-cash-enroll`, `oly-student-edit`, `oly-student-remove`
- School admin pages: `/school/olympiad` (dashboard), `/school/olympiad/teachers`, `/school/olympiad/share`
- Teacher pages: `/teacher/olympiad` (dashboard), `/teacher/olympiad/classes/:olySchoolId/:gradeLevelId` (roster)
- Cash enrollment sheet (teacher-side) — reuses Phase 2 enrollment form shape but inserts directly via edge function (no payment gateway)
- Student edit + remove sheets with audit logging
- Sidebar "Olympiad" entry shown for school_admin, coordinator, teacher (already in `FEATURE_URL_MAP` from Phase 1 — just enabled when flag is on)
- Phase indicator on dashboard (Enrollment Open / Closed; later states shown as text but no action buttons in 3a — those land in 3b/5)

Out (deferred):

- Batching kanban, PIN custody, absentees pool, pre-exam reminders (Phase 3b)
- Print credentials PDF (Phase 3b)
- Exam delivery (Phase 4)
- Results publish (Phase 5)
- Student portal Olympiad tab (Phase 4)

---

## 2. Database schema (additive migration)

One migration: `supabase/migrations/<ts>_oly_phase_3a_operations.sql`.

### 2.1 `oly_teacher_class_assignments`

```sql
create table public.oly_teacher_class_assignments (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.oly_campaigns(id) on delete restrict,
  oly_school_id uuid not null references public.oly_schools(id) on delete cascade,
  teacher_profile_id uuid not null references public.profiles(id) on delete cascade,
  grade_level_id uuid not null references public.grade_levels(id) on delete restrict,
  assigned_by uuid references public.profiles(id) on delete set null,
  assigned_at timestamptz not null default now(),
  unique(campaign_id, oly_school_id, teacher_profile_id, grade_level_id)
);
create index idx_otca_school on public.oly_teacher_class_assignments(oly_school_id);
create index idx_otca_teacher on public.oly_teacher_class_assignments(teacher_profile_id);
create index idx_otca_grade on public.oly_teacher_class_assignments(grade_level_id);
create index idx_otca_campaign on public.oly_teacher_class_assignments(campaign_id);
create index idx_otca_assigned_by on public.oly_teacher_class_assignments(assigned_by);
```

Separate from SALCI's existing `class_assignments` to keep Olympiad-specific assignments isolated (different grain — per class_label / grade_level_id, campaign-scoped, dormancy-purged cleanly). For an existing-SALCI school, this table is populated by `oly-assign-existing-teachers`; for a non-SALCI school, by `oly-create-teacher`.

### 2.2 `oly_audit_log`

```sql
create table public.oly_audit_log (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.oly_campaigns(id) on delete restrict,
  oly_school_id uuid references public.oly_schools(id) on delete cascade,
  oly_student_id uuid references public.oly_students(id) on delete set null,
  actor_id uuid references public.profiles(id) on delete set null,
  actor_role text not null check (actor_role in ('super_admin','school_admin','coordinator','teacher')),
  action text not null check (action in (
    'student_enrolled_cash','student_edited','student_removed',
    'enrollment_closed','teacher_created','teacher_assigned','teacher_unassigned'
  )),
  before_json jsonb,
  after_json jsonb,
  reason text,
  created_at timestamptz not null default now()
);
create index idx_oal_campaign on public.oly_audit_log(campaign_id);
create index idx_oal_school on public.oly_audit_log(oly_school_id);
create index idx_oal_student on public.oly_audit_log(oly_student_id);
create index idx_oal_actor on public.oly_audit_log(actor_id);
create index idx_oal_action on public.oly_audit_log(action);
create index idx_oal_created_at on public.oly_audit_log(created_at);
```

Every mutating edge function writes to this table inside its own transaction. The `oly_student_id` is nullable because some audit events (e.g. `enrollment_closed`) don't target a specific student.

### 2.3 SECURITY DEFINER helpers

```sql
create or replace function public.oly_get_user_oly_school(p_uid uuid, p_oly_school_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  -- Returns oly_school_id if user has a school_admin/coordinator role at the institution that owns this oly_school, else NULL.
  select sc.id from public.oly_schools sc
    join public.user_roles ur on ur.institution_id = sc.institution_id
   where sc.id = p_oly_school_id
     and ur.user_id = p_uid
     and ur.role in ('school_admin','coordinator','super_school_admin')
   limit 1;
$$;

create or replace function public.oly_is_school_admin_for(p_uid uuid, p_oly_school_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from public.oly_schools sc
      join public.user_roles ur on ur.institution_id = sc.institution_id
     where sc.id = p_oly_school_id
       and ur.user_id = p_uid
       and ur.role in ('school_admin','coordinator','super_school_admin')
  );
$$;

create or replace function public.oly_is_teacher_for_class(p_uid uuid, p_oly_school_id uuid, p_grade_level_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from public.oly_teacher_class_assignments
     where oly_school_id = p_oly_school_id
       and grade_level_id = p_grade_level_id
       and teacher_profile_id = p_uid
  );
$$;

create or replace function public.oly_student_can_read(p_uid uuid, p_oly_student_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from public.oly_students s
     where s.id = p_oly_student_id
       and (
         s.profile_id = p_uid                                              -- the student themselves
         or public.oly_is_school_admin_for(p_uid, s.oly_school_id)         -- any school admin
         or public.oly_is_teacher_for_class(p_uid, s.oly_school_id, s.grade_level_id)  -- their assigned teacher
       )
  );
$$;
```

### 2.4 RLS extensions

**`oly_schools`** — add SELECT for school_admin viewing own school, UPDATE for school_admin changing limited fields (the close-enrollment edge function uses service role so school-admin UPDATE policy can stay narrow):

```sql
create policy "school_admin SELECT own school" on public.oly_schools for select
  using (public.oly_is_school_admin_for(auth.uid(), id));

create policy "teacher SELECT own school" on public.oly_schools for select
  using (exists(
    select 1 from public.oly_teacher_class_assignments
     where oly_school_id = id and teacher_profile_id = auth.uid()
  ));
```

**`oly_students`** — school_admin SELECT/UPDATE/DELETE own school; teacher SELECT/INSERT/UPDATE/DELETE for assigned-class students (edge function gates the actual writes; RLS is a defense-in-depth layer):

```sql
create policy "school_admin all own school" on public.oly_students for all
  using (public.oly_is_school_admin_for(auth.uid(), oly_school_id))
  with check (public.oly_is_school_admin_for(auth.uid(), oly_school_id));

create policy "teacher SELECT assigned class" on public.oly_students for select
  using (public.oly_is_teacher_for_class(auth.uid(), oly_school_id, grade_level_id));

create policy "student SELECT self" on public.oly_students for select
  using (profile_id = auth.uid());
```

**`oly_enrollment_pending`** — school_admin SELECT only (sensitive in-flight data):

```sql
create policy "school_admin SELECT own school" on public.oly_enrollment_pending for select
  using (public.oly_is_school_admin_for(auth.uid(), oly_school_id));
```

**`oly_receipts`** — student SELECT own; school_admin SELECT own school's:

```sql
create policy "student SELECT own receipt" on public.oly_receipts for select
  using (public.oly_student_can_read(auth.uid(), oly_student_id));

create policy "school_admin SELECT school receipts" on public.oly_receipts for select
  using (exists(
    select 1 from public.oly_students s
     where s.id = oly_student_id
       and public.oly_is_school_admin_for(auth.uid(), s.oly_school_id)
  ));
```

**`oly_refunds`** — school_admin SELECT own school's (read-only — refunds are super-admin only at Phase 2; Phase 3a leaves that gate in place):

```sql
create policy "school_admin SELECT school refunds" on public.oly_refunds for select
  using (exists(
    select 1 from public.oly_students s
     where s.id = oly_student_id
       and public.oly_is_school_admin_for(auth.uid(), s.oly_school_id)
  ));
```

**`oly_teacher_class_assignments`** — school_admin manages; teacher SELECT own:

```sql
alter table public.oly_teacher_class_assignments enable row level security;
create policy "super_admin all" on public.oly_teacher_class_assignments for all
  using (public.is_super_admin(auth.uid())) with check (public.is_super_admin(auth.uid()));
create policy "school_admin all own school" on public.oly_teacher_class_assignments for all
  using (public.oly_is_school_admin_for(auth.uid(), oly_school_id))
  with check (public.oly_is_school_admin_for(auth.uid(), oly_school_id));
create policy "teacher SELECT own" on public.oly_teacher_class_assignments for select
  using (teacher_profile_id = auth.uid());
```

**`oly_audit_log`** — super_admin all; school_admin SELECT own school:

```sql
alter table public.oly_audit_log enable row level security;
create policy "super_admin all" on public.oly_audit_log for all
  using (public.is_super_admin(auth.uid())) with check (public.is_super_admin(auth.uid()));
create policy "school_admin SELECT own school" on public.oly_audit_log for select
  using (oly_school_id is not null and public.oly_is_school_admin_for(auth.uid(), oly_school_id));
```

All edge functions write to `oly_audit_log` via the service-role client, so the policy above does not need INSERT for non-super_admins.

### 2.5 Read-only campaign settings access for non-super-admin

The dashboard needs to read `oly_campaigns.default_price_paise`, `gst_percent` etc. to show fee context. Add:

```sql
create policy "authenticated SELECT active campaigns" on public.oly_campaigns for select
  using (status in ('active','closed') and auth.uid() is not null);
```

Same for `oly_subjects`, `oly_subject_classes` (cash enrollment dropdown needs them):

```sql
create policy "authenticated SELECT active subjects" on public.oly_subjects for select
  using (status = 'active' and auth.uid() is not null);
create policy "authenticated SELECT subject_classes" on public.oly_subject_classes for select
  using (auth.uid() is not null);
```

These are minimally permissive: any authenticated user can read campaign/subject/subject_classes metadata. That's already exposed via the public RPC; granting direct SELECT to authenticated keeps the school-side hooks straightforward without going through a wrapper RPC.

---

## 3. Edge functions

All edge functions verify the caller's role inline. All mutating functions write an `oly_audit_log` row inside the same transaction (where possible — Supabase Edge Functions don't expose explicit transaction boundaries, so multi-statement sequences run as best-effort with retry-safe ordering).

### 3.1 `oly-create-teacher`

Inputs: `{ oly_school_id, full_name, email, phone, grade_level_ids }`.

For new (non-SALCI) schools only — verifies the school is `is_existing_salci_school = false`. Verifies caller is `school_admin` for that institution OR `super_admin`. Creates auth user (random password, `email_confirm: true`), profile, `user_roles` row (`role: 'teacher'`, `institution_id`), inserts one `oly_teacher_class_assignments` row per `grade_level_id`. Sends Resend welcome email with password-set link. Audit log row.

### 3.2 `oly-assign-existing-teachers`

Inputs: `{ oly_school_id, assignments: [{ teacher_profile_id, grade_level_ids }] }`.

For existing-SALCI schools only — verifies the school is `is_existing_salci_school = true`. Verifies caller. For each entry: deletes existing assignments for that (teacher, school, campaign), inserts new ones. Audit log row per teacher.

### 3.3 `oly-close-enrollment`

Inputs: `{ oly_school_id }`.

Verifies caller is `school_admin`/`super_school_admin` for the institution. Updates `oly_schools.status = 'enrollment_closed'`. Audit log row.

Side effect: future calls to `oly_get_public_school_payment_context(school_code)` return `{ found: false }` because that RPC filters on `status = 'enrollment_open'`. Existing in-flight `oly_enrollment_pending` rows are not affected — they can still complete via webhook (intentional — parents who initiated payment shouldn't be cut off mid-flow).

### 3.4 `oly-cash-enroll`

Inputs: `{ oly_school_id, form_data: <same shape as Phase 2 enrollment, plus a payment_method: 'cash' marker, plus a fee_collected: boolean = true>` }`.

Verifies caller is `teacher` assigned to the form's grade_level_id at this school, OR `school_admin`/`super_school_admin` for the institution.

Inserts directly into `oly_students` (bypasses `oly_enrollment_pending` entirely — no payment gateway involved). Generates roll number via existing `oly_generate_roll_number` RPC. Sets `enrollment_channel = 'teacher_cash'`, `status = 'active'`. Triggers `oly-receipt-generate` (which now branches on `enrollment_channel` to label the receipt as "Cash" with the teacher's name). Audit log row.

Duplicate detection: same logic as Phase 2 `oly-payment-create-order` — 24h window for non-SALCI by name+DOB+class, per-campaign by admission_number for SALCI.

### 3.5 `oly-student-edit`

Inputs: `{ oly_student_id, updates: { full_name?, section_label?, parent_name?, parent_phone?, parent_email? } }`.

Verifies caller is `school_admin`/`super_school_admin` for the institution OR `teacher` assigned to the student's grade_level_id at the student's school.

**Locked fields** (cannot be edited per docx Phase 3 §3): `roll_number`, `payment_method`/`enrollment_channel`, `class_label` / `grade_level_id`, `admission_number`, `subject_ids`, `date_of_birth` (since DOB is the exam password). The edge function rejects any update payload containing these.

For SALCI students with `profile_id` set, certain fields (name, parent contact) ALSO write back to `profiles` if the school admin authorized that — Phase 3a keeps it simple and only updates `oly_students`. Phase 4 can add the profile-sync flow.

Audit log row with `before_json` and `after_json` snapshots.

### 3.6 `oly-student-remove`

Inputs: `{ oly_student_id, reason }`.

Verifies caller. Sets `oly_students.status = 'removed'`, `removed_at = now()`, `removed_by = caller_id`, `removed_reason = reason`. If `enrollment_channel = 'parent_online'` AND a paid `oly_enrollment_pending` row exists, immediately invokes `oly-refund-issue` for that student with scope `per_student` and reason "Removed by school: {reason}". If `enrollment_channel = 'teacher_cash'`, just inserts an `oly_refunds` row with `status = 'offline'` (no gateway call — school handles physical cash return).

Audit log row.

---

## 4. School admin pages

### 4.1 `/school/olympiad` — Dashboard

Layout:
- `PageShell` + `PageHeader` "SALCI Olympiad" + subtitle "{Campaign year} campaign"
- Phase pill (Enrollment Open / Closed / Batches Scheduled / Exam in Progress / Results Published)
- `StatTileGrid`:
  - Total enrolled (sum of active oly_students)
  - By class (mini list inside the tile, "Class 8: 42 · Class 9: 38")
  - Revenue collected: Online (₹X) + Cash (₹Y) = Total (₹Z)
  - Subjects coverage (subjects offered count)
- Action buttons (conditional on phase):
  - `Enrollment Open` → "Close Enrollment" button (opens confirmation AlertDialog with mandatory "ARE YOU SURE" typed confirmation)
  - `Enrollment Closed` → "Schedule Batches" button (disabled with tooltip "Coming in Phase 3b") + "View Roster" button
  - `Batches Scheduled` → "View Schedule" + (Phase 5) "Publish Results"
- Roster summary section: collapsible per-class breakdown showing latest 5 enrollments per class with link to teacher portal "View all"

### 4.2 `/school/olympiad/teachers`

Two modes based on `is_existing_salci_school`:

**Non-SALCI school**:
- `ListRow` per teacher (name, email, phone, classes assigned)
- "+ Add Teacher" button → `MobileSheet` with name/email/phone/classes-multiselect → calls `oly-create-teacher` → sends password-set email
- Per-row actions: edit classes, deactivate (sets all `oly_teacher_class_assignments` removed but keeps auth user)

**Existing SALCI school**:
- Section labeled "Assign Olympiad Teachers"
- Per class card: shows currently-assigned teacher(s) from `oly_teacher_class_assignments`, with "Assign" button
- Assign sheet: dropdown of existing SALCI teachers at this institution → multiselect of classes → calls `oly-assign-existing-teachers`
- Default suggestion shown: existing class teachers from `class_assignments` (read-only hint, not auto-applied)

### 4.3 `/school/olympiad/share`

Three sections:
1. **Public URL + QR** — reuses Phase 2's `PublicPaymentLink` component
2. **WhatsApp template** — copy-to-clipboard pre-formatted message:
   `Pay for your child's SALCI Olympiad enrollment at {School Name}: {url}. Enrollment closes soon.`
3. **Parent email template** — copy-to-clipboard subject + body:
   - Subject: `SALCI Olympiad enrollment for {School Name}`
   - Body: paragraph explaining the Olympiad + link to public URL

All copies use a "Copy" button with a toast confirmation. No actual sending happens from this page — admin uses their own WhatsApp/email client.

---

## 5. Teacher portal pages

### 5.1 `/teacher/olympiad` — Dashboard

- `PageHeader` "Welcome, {teacher name}"
- One `FeatureTile` per assigned (oly_school_id, grade_level_id) showing class name + enrolled count + batch date (when 3b ships) + Open button
- Two quick action buttons in the header kebab: "Enroll cash student" (opens picker for class first), "Print credentials" (Phase 3b only, disabled)

### 5.2 `/teacher/olympiad/classes/:olySchoolId/:gradeLevelId`

- `PageHeader` with class name + subtitle "X enrolled"
- `FilterRow` chips: Payment method (Online/Cash), Status (Active/Removed)
- `ListRow` per student showing: name, roll number, DOB, subjects (3 badges), enrolled_at relative
- Per-row trailing action: kebab → Edit, Remove
- Floating "+ Enroll cash student" button (`MobileFab`) → opens the cash-enrollment sheet

### 5.3 Cash enrollment sheet

Form: same field shape as Phase 2 public form (full name, DOB, optional section, 3-subject picker, parent name+phone+email) plus a hardcoded `payment_method = cash` + a mandatory checkbox **"Fee collected from parent"** (legally meaningful — teacher attesting they have the cash).

On submit → calls `oly-cash-enroll` → on success: toast "Student enrolled. Roll number: SO26-XXX-08-0042" → option modal "Print receipt" (opens generated PDF in new tab via signed URL) / "Email receipt to parent" (uses parent_email from form, calls receipt-generate which already sends email if email present).

### 5.4 Edit student sheet

Pre-filled with current values. Locked fields shown as disabled inputs with lock icons. Editable fields: name, section, parent name/phone/email.

On submit → calls `oly-student-edit` → toast success → roster refetches.

### 5.5 Remove student dialog

`AlertDialog` (not Sheet — it's a destructive confirm). Mandatory `reason` textarea. Shows what will happen depending on payment method:
- "Online student — refund will be issued automatically via the payment gateway"
- "Cash student — flag as 'refund offline' so you can physically return the cash to the parent"

On confirm → calls `oly-student-remove` → toast → roster refetches.

---

## 6. Hooks (new in 3a)

- `useOlympiadSchoolDashboard(olySchoolId)` — KPI roll-ups (enrolled count, by-class, by-channel, revenue)
- `useOlympiadTeachers(olySchoolId)` — list of teachers + their assigned classes for this school
- `useOlympiadAssignedClasses()` — current teacher's `oly_teacher_class_assignments` (drives teacher dashboard)
- `useOlympiadClassRoster(olySchoolId, gradeLevelId, filters)` — student list with filters
- `useOlympiadAuditLog(filter)` — for super admin / school admin to view audit history (Phase 3a ships read-only)
- `useCreateOlympiadTeacher()`, `useAssignOlympiadTeachers()`, `useCloseEnrollment()`, `useCashEnroll()`, `useEditStudent()`, `useRemoveStudent()` — mutation hooks routing through their edge functions via `invokeEdgeFunction`

---

## 7. Routing

```
/school/olympiad                                                → OlympiadSchoolDashboardPage
/school/olympiad/teachers                                       → OlympiadSchoolTeachersPage
/school/olympiad/share                                          → OlympiadSchoolSharePage
/teacher/olympiad                                               → OlympiadTeacherDashboardPage
/teacher/olympiad/classes/:olySchoolId/:gradeLevelId            → OlympiadTeacherClassPage
```

All inside `<ProtectedRoute>`. `/school/olympiad/*` allowed for `school_admin`, `super_school_admin`, `coordinator`. `/teacher/olympiad/*` allowed for `teacher`. Both gated by the `olympiad` feature flag (already in `FEATURE_URL_MAP`).

Sidebar entry "Olympiad" — `AppSidebar.tsx` already has the super-admin entry from Phase 1. Add school-admin + teacher entries pointing to their respective dashboards.

---

## 8. Acceptance criteria

- School admin can land at `/school/olympiad` post-onboarding and see live KPIs
- School admin can manage teachers in both modes (create for non-SALCI, assign for existing-SALCI)
- School admin can close enrollment with a one-click confirm — public URL flips to "Enrollment closed" within seconds
- School admin can copy + share the public URL + QR + WhatsApp/email templates
- Teacher can land at `/teacher/olympiad` and see their assigned classes
- Teacher can enroll a cash student end-to-end (form → submit → roll number → receipt PDF)
- Teacher can edit non-locked student fields with audit logging
- Teacher can remove a student → auto-refund for online / offline-flag for cash
- Every mutating edge function writes to `oly_audit_log`
- All new RLS policies use SECURITY DEFINER helpers (no inline cross-table EXISTS)
- Every new FK indexed in same migration
- Every new `useQuery` has explicit `staleTime`
- All money rendered as `₹X + 18% GST = ₹Y`
- All `onError` via `toastError`
- §5a zero-error contract passes

---

## 9. Risks and open items

- **`profiles.full_name` / `profiles.email` / `profiles.phone` columns** — `oly-create-teacher` assumes these exist. Verified via Supabase types in Phase 2.
- **Existing-SALCI teacher dropdown** — query must filter `user_roles.role = 'teacher'` at the institution. If a teacher is also a class teacher (existing SALCI assignment), surface that as a hint. Open: should we exclude teachers who are NOT yet class teachers? Decision: include all institution teachers, show class-teacher hint inline.
- **Cash enrollment receipt** — receipt PDF currently says "Online (ref: pay_XXX)" or "Cash". The Phase 2 receipt edge function already branches on `enrollment_channel` — verify by reading the existing function.
- **Audit-log retention** — Phase 5 dormancy purges PII from `oly_students`; should audit log entries with that student be purged too? Decision: purge `before_json`/`after_json` fields that contain PII, keep the audit row + action + actor for compliance. Implement in Phase 5.
- **Teacher deactivation** — Phase 3a only deletes the `oly_teacher_class_assignments`. The teacher auth user persists. If admin wants to fully deactivate the auth user, they should use the existing SALCI user-management tools.
- **Coordinator role** — granted same access as school_admin for Olympiad purposes. Already established in the master spec.
- **Cash enrollment by NON-assigned teacher** — edge function rejects. School admins can override by enrolling directly from their portal (school admin has full access to all students in their school).
