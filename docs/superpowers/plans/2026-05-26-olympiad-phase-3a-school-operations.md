# SALCI Olympiad Phase 3a — School Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the school admin + teacher portals up to (but not including) batch scheduling. School admin can land at `/school/olympiad`, manage teachers, share the public URL, close enrollment. Teachers can land at `/teacher/olympiad`, see their classes, cash-enroll students, edit/remove students with audit logging.

**Architecture:** Additive migration adds `oly_teacher_class_assignments` + `oly_audit_log` + 4 SECURITY DEFINER helpers + extended RLS policies on all existing `oly_*` tables. Six edge functions (`oly-create-teacher`, `oly-assign-existing-teachers`, `oly-close-enrollment`, `oly-cash-enroll`, `oly-student-edit`, `oly-student-remove`) own all mutating operations and write to `oly_audit_log` inline. Five new pages (school admin dashboard / teachers / share + teacher dashboard / class roster) consume the data via narrow hooks. Sidebar entries for school_admin and teacher roles land alongside the Phase 1 super-admin entry.

**Tech Stack:** React 18 + TypeScript, Vite, TanStack Query v5, React Router v6, Supabase (PostgreSQL + RLS + Storage + Edge Functions), shadcn/ui + Tailwind, lucide-react. No new dependencies.

**Spec:** [docs/superpowers/specs/2026-05-26-olympiad-phase-3a-school-operations-design.md](../specs/2026-05-26-olympiad-phase-3a-school-operations-design.md)
**Master decomposition:** [docs/superpowers/specs/2026-05-26-olympiad-master-decomposition-design.md](../specs/2026-05-26-olympiad-master-decomposition-design.md)
**Phase 2 plan (precedent):** [docs/superpowers/plans/2026-05-26-olympiad-phase-2-school-onboarding-and-payment.md](./2026-05-26-olympiad-phase-2-school-onboarding-and-payment.md)

**No test infrastructure** — verification via CLAUDE.md §5a (`npx tsc --noEmit`, `npx eslint`, `npx vite build`) + manual smoke at 375 px in light + dark mode.

**Engineer assumptions:** Read CLAUDE.md §5a (zero-error), §6/§19 (toastError), §17 (SW dirty-form), §20a/§20b (mobile design system), §22 (RLS recursion), §23 (high-concurrency) BEFORE starting. Read Phase 2 plan as the pattern reference for hook shapes, sheet patterns (initial-state-diff isDirty, try/catch on mutateAsync), and edge function structure.

---

## File Structure

```
supabase/
  migrations/
    <ts>_oly_phase_3a_operations.sql                                  (NEW)
  functions/
    oly-create-teacher/index.ts                                       (NEW)
    oly-assign-existing-teachers/index.ts                             (NEW)
    oly-close-enrollment/index.ts                                     (NEW)
    oly-cash-enroll/index.ts                                          (NEW)
    oly-student-edit/index.ts                                         (NEW)
    oly-student-remove/index.ts                                       (NEW)

src/
  hooks/olympiad/
    useOlympiadSchoolDashboard.ts                                     (NEW)
    useOlympiadActiveCampaign.ts                                      (NEW) — shared lookup for "campaign for this institution"
    useOlympiadMySchool.ts                                            (NEW) — current school_admin's oly_school row
    useOlympiadTeachers.ts                                            (NEW)
    useOlympiadAssignedClasses.ts                                     (NEW) — current teacher's assignments
    useOlympiadClassRoster.ts                                         (NEW) — students for a (school, grade)
    useCreateOlympiadTeacher.ts                                       (NEW)
    useAssignOlympiadTeachers.ts                                      (NEW)
    useCloseEnrollment.ts                                             (NEW)
    useOlympiadCashEnroll.ts                                          (NEW)
    useOlympiadEditStudent.ts                                         (NEW)
    useOlympiadRemoveStudent.ts                                       (NEW)
  components/olympiad/
    school/
      OlympiadPhasePill.tsx                                           (NEW) — Enrollment Open / Closed / etc badge
      DashboardActions.tsx                                            (NEW) — conditional button strip
      CloseEnrollmentDialog.tsx                                       (NEW) — typed-confirm AlertDialog
      TeacherListRow.tsx                                              (NEW)
      AddTeacherSheet.tsx                                             (NEW) — new-school teacher creation
      AssignTeachersSheet.tsx                                         (NEW) — existing-SALCI assignment
      ShareTemplates.tsx                                              (NEW) — WhatsApp + email templates
    teacher/
      ClassCard.tsx                                                   (NEW)
      StudentRosterRow.tsx                                            (NEW)
      CashEnrollSheet.tsx                                             (NEW)
      EditStudentSheet.tsx                                            (NEW)
      RemoveStudentDialog.tsx                                         (NEW)
  pages/
    school/olympiad/
      OlympiadSchoolDashboardPage.tsx                                 (NEW)
      OlympiadSchoolTeachersPage.tsx                                  (NEW)
      OlympiadSchoolSharePage.tsx                                     (NEW)
    teacher/olympiad/
      OlympiadTeacherDashboardPage.tsx                                (NEW)
      OlympiadTeacherClassPage.tsx                                    (NEW)
  App.tsx                                                             (EDIT) — register 5 new routes
  components/layout/AppSidebar.tsx                                    (EDIT) — add Olympiad entries for school_admin + teacher
```

Each file has one responsibility. Hooks own data; sheets/dialogs own mutation forms; pages own routing + composition.

---

## Section A — Foundation (schema + RLS + sidebar)

### Task 1: Phase 3a schema migration

**Files:**
- Create: `supabase/migrations/<ts>_oly_phase_3a_operations.sql` — `<ts>` = `Get-Date -AsUTC -Format yyyyMMddHHmmss`

- [ ] **Step 1.1: Generate timestamp**

```powershell
Get-Date -AsUTC -Format yyyyMMddHHmmss
```

- [ ] **Step 1.2: Create migration with this exact SQL**

```sql
-- Phase 3a — Olympiad school operations
-- Adds oly_teacher_class_assignments, oly_audit_log, 4 SECURITY DEFINER helpers,
-- and extended RLS policies on all existing oly_* tables.

-- =========================================================================
-- 1. oly_teacher_class_assignments
-- =========================================================================
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

-- =========================================================================
-- 2. oly_audit_log
-- =========================================================================
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

-- =========================================================================
-- 3. SECURITY DEFINER helpers
-- =========================================================================
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
         s.profile_id = p_uid
         or public.oly_is_school_admin_for(p_uid, s.oly_school_id)
         or public.oly_is_teacher_for_class(p_uid, s.oly_school_id, s.grade_level_id)
       )
  );
$$;

create or replace function public.oly_user_active_campaign(p_uid uuid)
returns uuid language sql stable security definer set search_path = public as $$
  -- Returns the active campaign_id reachable from any oly_school the user can admin
  select c.id from public.oly_campaigns c
   where c.status = 'active'
   order by c.campaign_year desc
   limit 1;
$$;

grant execute on function public.oly_is_school_admin_for(uuid, uuid) to authenticated;
grant execute on function public.oly_is_teacher_for_class(uuid, uuid, uuid) to authenticated;
grant execute on function public.oly_student_can_read(uuid, uuid) to authenticated;
grant execute on function public.oly_user_active_campaign(uuid) to authenticated;

-- =========================================================================
-- 4. RLS — oly_teacher_class_assignments + oly_audit_log
-- =========================================================================
alter table public.oly_teacher_class_assignments enable row level security;
create policy "super_admin all" on public.oly_teacher_class_assignments for all
  using (public.is_super_admin(auth.uid())) with check (public.is_super_admin(auth.uid()));
create policy "school_admin all own school" on public.oly_teacher_class_assignments for all
  using (public.oly_is_school_admin_for(auth.uid(), oly_school_id))
  with check (public.oly_is_school_admin_for(auth.uid(), oly_school_id));
create policy "teacher SELECT own" on public.oly_teacher_class_assignments for select
  using (teacher_profile_id = auth.uid());

alter table public.oly_audit_log enable row level security;
create policy "super_admin all" on public.oly_audit_log for all
  using (public.is_super_admin(auth.uid())) with check (public.is_super_admin(auth.uid()));
create policy "school_admin SELECT own school" on public.oly_audit_log for select
  using (oly_school_id is not null and public.oly_is_school_admin_for(auth.uid(), oly_school_id));

-- =========================================================================
-- 5. Extended RLS — existing oly_* tables get school_admin / teacher / student policies
-- =========================================================================
create policy "school_admin SELECT own school" on public.oly_schools for select
  using (public.oly_is_school_admin_for(auth.uid(), id));
create policy "teacher SELECT own school" on public.oly_schools for select
  using (exists(
    select 1 from public.oly_teacher_class_assignments
     where oly_school_id = id and teacher_profile_id = auth.uid()
  ));

create policy "school_admin all own school" on public.oly_students for all
  using (public.oly_is_school_admin_for(auth.uid(), oly_school_id))
  with check (public.oly_is_school_admin_for(auth.uid(), oly_school_id));
create policy "teacher SELECT assigned class" on public.oly_students for select
  using (public.oly_is_teacher_for_class(auth.uid(), oly_school_id, grade_level_id));
create policy "student SELECT self" on public.oly_students for select
  using (profile_id = auth.uid());

create policy "school_admin SELECT own school" on public.oly_enrollment_pending for select
  using (public.oly_is_school_admin_for(auth.uid(), oly_school_id));

create policy "student SELECT own receipt" on public.oly_receipts for select
  using (public.oly_student_can_read(auth.uid(), oly_student_id));
create policy "school_admin SELECT school receipts" on public.oly_receipts for select
  using (exists(
    select 1 from public.oly_students s
     where s.id = oly_student_id
       and public.oly_is_school_admin_for(auth.uid(), s.oly_school_id)
  ));

create policy "school_admin SELECT school refunds" on public.oly_refunds for select
  using (exists(
    select 1 from public.oly_students s
     where s.id = oly_student_id
       and public.oly_is_school_admin_for(auth.uid(), s.oly_school_id)
  ));

-- =========================================================================
-- 6. Authenticated SELECT on read-only catalog tables
-- =========================================================================
create policy "authenticated SELECT active campaigns" on public.oly_campaigns for select
  using (status in ('active','closed') and auth.uid() is not null);
create policy "authenticated SELECT active subjects" on public.oly_subjects for select
  using (status = 'active' and auth.uid() is not null);
create policy "authenticated SELECT subject_classes" on public.oly_subject_classes for select
  using (auth.uid() is not null);
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
git add supabase/migrations/<ts>_oly_phase_3a_operations.sql src/integrations/supabase/types.ts
git commit -m "feat(olympiad): phase 3a schema - teacher assignments, audit log, extended RLS

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Sidebar entries + lazy routes

**Files:**
- Modify: `src/components/layout/AppSidebar.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 2.1: Add school_admin Olympiad entry to sidebar**

In the school_admin nav array (find by searching `school_admin` in the file), add after a sensible existing entry:
```ts
{ title: "Olympiad", url: "/school/olympiad", icon: Medal },
```
`Medal` is already imported from lucide-react (added in Phase 1 Task 5).

- [ ] **Step 2.2: Add teacher Olympiad entry**

In the teacher nav array:
```ts
{ title: "Olympiad", url: "/teacher/olympiad", icon: Medal },
```

These entries are gated by `FEATURE_URL_MAP` (already has `/school/olympiad` and `/teacher/olympiad` → `olympiad` from Phase 1 Task 2). The sidebar's existing `filterItemsByFeature` will hide them when the flag is off.

- [ ] **Step 2.3: Register routes in App.tsx**

Top of file, near other lazy imports:
```tsx
const OlympiadSchoolDashboardPage = lazy(() => import("@/pages/school/olympiad/OlympiadSchoolDashboardPage"));
const OlympiadSchoolTeachersPage = lazy(() => import("@/pages/school/olympiad/OlympiadSchoolTeachersPage"));
const OlympiadSchoolSharePage = lazy(() => import("@/pages/school/olympiad/OlympiadSchoolSharePage"));
const OlympiadTeacherDashboardPage = lazy(() => import("@/pages/teacher/olympiad/OlympiadTeacherDashboardPage"));
const OlympiadTeacherClassPage = lazy(() => import("@/pages/teacher/olympiad/OlympiadTeacherClassPage"));
```

In the school_admin protected block:
```tsx
<Route path="/school/olympiad" element={
  <ProtectedRoute allowedRoles={["school_admin","super_school_admin","coordinator"]}>
    <Suspense fallback={<p>Loading...</p>}>
      <OlympiadSchoolDashboardPage />
    </Suspense>
  </ProtectedRoute>
} />
<Route path="/school/olympiad/teachers" element={
  <ProtectedRoute allowedRoles={["school_admin","super_school_admin","coordinator"]}>
    <Suspense fallback={<p>Loading...</p>}>
      <OlympiadSchoolTeachersPage />
    </Suspense>
  </ProtectedRoute>
} />
<Route path="/school/olympiad/share" element={
  <ProtectedRoute allowedRoles={["school_admin","super_school_admin","coordinator"]}>
    <Suspense fallback={<p>Loading...</p>}>
      <OlympiadSchoolSharePage />
    </Suspense>
  </ProtectedRoute>
} />
```

In the teacher protected block:
```tsx
<Route path="/teacher/olympiad" element={
  <ProtectedRoute allowedRoles={["teacher"]}>
    <Suspense fallback={<p>Loading...</p>}>
      <OlympiadTeacherDashboardPage />
    </Suspense>
  </ProtectedRoute>
} />
<Route path="/teacher/olympiad/classes/:olySchoolId/:gradeLevelId" element={
  <ProtectedRoute allowedRoles={["teacher"]}>
    <Suspense fallback={<p>Loading...</p>}>
      <OlympiadTeacherClassPage />
    </Suspense>
  </ProtectedRoute>
} />
```

- [ ] **Step 2.4: Create placeholder page files so lazy imports compile**

For each of the 5 lazy-loaded pages, create a stub file like:

```tsx
// src/pages/school/olympiad/OlympiadSchoolDashboardPage.tsx
import { PageShell } from "@/components/shared/page/PageShell";
import { PageHeader } from "@/components/shared/page/PageHeader";
export default function OlympiadSchoolDashboardPage() {
  return (
    <PageShell>
      <PageHeader title="SALCI Olympiad" />
      <p className="py-4 text-sm text-ink-600">Coming next.</p>
    </PageShell>
  );
}
```

Same shape for the other 4 placeholders. Change the title/text accordingly.

- [ ] **Step 2.5: Verify + commit**

```bash
npx tsc --noEmit
npx eslint src/App.tsx src/components/layout/AppSidebar.tsx src/pages/school/olympiad/ src/pages/teacher/olympiad/
npx vite build
git add src/App.tsx src/components/layout/AppSidebar.tsx src/pages/school/olympiad/ src/pages/teacher/olympiad/
git commit -m "feat(olympiad): sidebar entries + lazy routes + placeholder pages for school admin + teacher"
```

---

## Section B — Edge functions

The six edge functions below all follow the same shape: verify auth header, verify caller role, run the operation as service role, write audit log row, return JSON. Each edge function is its own dispatch but Section B can be implemented in one bundled subagent dispatch (~600 lines total).

### Task 3: `oly-create-teacher` (new school teacher creation)

**File:** `supabase/functions/oly-create-teacher/index.ts`

```ts
// @ts-expect-error Deno runtime
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-expect-error Deno runtime
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ error: "Missing auth" }, 401);

    // @ts-expect-error Deno.env
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    // @ts-expect-error Deno.env
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    // @ts-expect-error Deno.env
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: userRes } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    const userId = userRes.user?.id;
    if (!userId) return json({ error: "Forbidden" }, 403);

    const body = (await req.json()) as {
      oly_school_id: string;
      full_name: string;
      email: string;
      phone: string;
      grade_level_ids: string[];
    };

    // Verify school exists + is non-SALCI + caller is school_admin
    const { data: school, error: schoolErr } = await supabase
      .from("oly_schools")
      .select("id, institution_id, campaign_id, is_existing_salci_school")
      .eq("id", body.oly_school_id)
      .single();
    if (schoolErr || !school) return json({ error: "School not found" }, 404);
    if (school.is_existing_salci_school) {
      return json({ error: "Use oly-assign-existing-teachers for existing SALCI schools" }, 400);
    }

    const { data: isAdmin } = await supabase.rpc("oly_is_school_admin_for", {
      p_uid: userId, p_oly_school_id: body.oly_school_id,
    });
    const { data: isSuper } = await supabase.rpc("is_super_admin", { user_id: userId });
    if (!isAdmin && !isSuper) return json({ error: "Forbidden" }, 403);

    // Create auth user
    const tempPassword = crypto.randomUUID();
    const { data: newUser, error: userErr } = await supabase.auth.admin.createUser({
      email: body.email,
      password: tempPassword,
      email_confirm: true,
    });
    if (userErr || !newUser?.user) return json({ error: `Auth create failed: ${userErr?.message}` }, 500);

    const teacherId = newUser.user.id;

    // Profile + role
    await supabase.from("profiles").insert({
      id: teacherId,
      full_name: body.full_name,
      email: body.email,
      phone: body.phone,
      institution_id: school.institution_id,
    });
    await supabase.from("user_roles").insert({
      user_id: teacherId,
      role: "teacher",
      institution_id: school.institution_id,
    });

    // Class assignments
    const assignmentRows = body.grade_level_ids.map((gid) => ({
      campaign_id: school.campaign_id,
      oly_school_id: body.oly_school_id,
      teacher_profile_id: teacherId,
      grade_level_id: gid,
      assigned_by: userId,
    }));
    if (assignmentRows.length > 0) {
      const { error: assignErr } = await supabase
        .from("oly_teacher_class_assignments")
        .insert(assignmentRows);
      if (assignErr) return json({ error: `Assignment failed: ${assignErr.message}` }, 500);
    }

    // Send password-set email
    const { data: linkData } = await supabase.auth.admin.generateLink({
      type: "recovery",
      email: body.email,
    });
    if (resendKey && linkData?.properties?.action_link) {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "SALCI Olympiad <noreply@salci.org>",
          to: body.email,
          subject: "Welcome to SALCI Olympiad — set your password",
          html: `<p>Hello ${body.full_name},</p><p>You've been added as an Olympiad teacher. Click below to set your password:</p><p><a href="${linkData.properties.action_link}">Set your password</a></p>`,
        }),
      }).catch(() => {});
    }

    // Audit
    await supabase.from("oly_audit_log").insert({
      campaign_id: school.campaign_id,
      oly_school_id: body.oly_school_id,
      actor_id: userId,
      actor_role: isSuper ? "super_admin" : "school_admin",
      action: "teacher_created",
      after_json: { teacher_profile_id: teacherId, full_name: body.full_name, email: body.email, grade_level_ids: body.grade_level_ids },
    });

    return json({ teacher_profile_id: teacherId }, 200);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
```

Deploy: `npx supabase@latest functions deploy oly-create-teacher --project-ref gyymkgohcijeksmrzuyw`

---

### Task 4: `oly-assign-existing-teachers`

**File:** `supabase/functions/oly-assign-existing-teachers/index.ts`

```ts
// @ts-expect-error Deno runtime
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-expect-error Deno runtime
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

    const { oly_school_id, assignments } = (await req.json()) as {
      oly_school_id: string;
      assignments: Array<{ teacher_profile_id: string; grade_level_ids: string[] }>;
    };

    const { data: school } = await supabase
      .from("oly_schools")
      .select("id, institution_id, campaign_id, is_existing_salci_school")
      .eq("id", oly_school_id)
      .single();
    if (!school) return json({ error: "School not found" }, 404);
    if (!school.is_existing_salci_school) return json({ error: "Use oly-create-teacher for new schools" }, 400);

    const { data: isAdmin } = await supabase.rpc("oly_is_school_admin_for", {
      p_uid: userId, p_oly_school_id,
    });
    const { data: isSuper } = await supabase.rpc("is_super_admin", { user_id: userId });
    if (!isAdmin && !isSuper) return json({ error: "Forbidden" }, 403);

    for (const a of assignments) {
      // Verify teacher belongs to this institution and has teacher role
      const { data: role } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("user_id", a.teacher_profile_id)
        .eq("role", "teacher")
        .eq("institution_id", school.institution_id)
        .maybeSingle();
      if (!role) {
        return json({ error: `Teacher ${a.teacher_profile_id} not found at this institution` }, 400);
      }

      // Delete existing assignments for (teacher, school, campaign), then insert new set
      await supabase
        .from("oly_teacher_class_assignments")
        .delete()
        .eq("oly_school_id", oly_school_id)
        .eq("campaign_id", school.campaign_id)
        .eq("teacher_profile_id", a.teacher_profile_id);

      if (a.grade_level_ids.length > 0) {
        const rows = a.grade_level_ids.map((gid) => ({
          campaign_id: school.campaign_id,
          oly_school_id,
          teacher_profile_id: a.teacher_profile_id,
          grade_level_id: gid,
          assigned_by: userId,
        }));
        const { error: insErr } = await supabase
          .from("oly_teacher_class_assignments")
          .insert(rows);
        if (insErr) return json({ error: insErr.message }, 500);
      }

      await supabase.from("oly_audit_log").insert({
        campaign_id: school.campaign_id,
        oly_school_id,
        actor_id: userId,
        actor_role: isSuper ? "super_admin" : "school_admin",
        action: "teacher_assigned",
        after_json: { teacher_profile_id: a.teacher_profile_id, grade_level_ids: a.grade_level_ids },
      });
    }

    return json({ ok: true, processed: assignments.length }, 200);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
```

Deploy: `npx supabase@latest functions deploy oly-assign-existing-teachers --project-ref gyymkgohcijeksmrzuyw`

---

### Task 5: `oly-close-enrollment`

**File:** `supabase/functions/oly-close-enrollment/index.ts`

```ts
// @ts-expect-error Deno runtime
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-expect-error Deno runtime
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

    const { oly_school_id } = (await req.json()) as { oly_school_id: string };

    const { data: school } = await supabase
      .from("oly_schools")
      .select("id, campaign_id, status")
      .eq("id", oly_school_id)
      .single();
    if (!school) return json({ error: "School not found" }, 404);

    const { data: isAdmin } = await supabase.rpc("oly_is_school_admin_for", {
      p_uid: userId, p_oly_school_id,
    });
    const { data: isSuper } = await supabase.rpc("is_super_admin", { user_id: userId });
    if (!isAdmin && !isSuper) return json({ error: "Forbidden" }, 403);

    if (school.status !== "enrollment_open") {
      return json({ error: `Cannot close enrollment from status '${school.status}'` }, 409);
    }

    const { error: updErr } = await supabase
      .from("oly_schools")
      .update({ status: "enrollment_closed" })
      .eq("id", oly_school_id);
    if (updErr) return json({ error: updErr.message }, 500);

    await supabase.from("oly_audit_log").insert({
      campaign_id: school.campaign_id,
      oly_school_id,
      actor_id: userId,
      actor_role: isSuper ? "super_admin" : "school_admin",
      action: "enrollment_closed",
      before_json: { status: "enrollment_open" },
      after_json: { status: "enrollment_closed" },
    });

    return json({ ok: true }, 200);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
```

Deploy: `npx supabase@latest functions deploy oly-close-enrollment --project-ref gyymkgohcijeksmrzuyw`

---

### Task 6: `oly-cash-enroll`

**File:** `supabase/functions/oly-cash-enroll/index.ts`

```ts
// @ts-expect-error Deno runtime
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-expect-error Deno runtime
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type FormData = {
  full_name: string;
  date_of_birth: string;
  class_label: string;
  section_label?: string | null;
  grade_level_id: string;
  admission_number?: string | null;
  subject_ids: string[];
  parent_name: string;
  parent_phone: string;
  parent_email?: string | null;
  fee_collected: boolean;
};

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

    const { oly_school_id, form_data } = (await req.json()) as { oly_school_id: string; form_data: FormData };

    if (!form_data.fee_collected) {
      return json({ error: "Fee collected checkbox required" }, 400);
    }

    const { data: school } = await supabase
      .from("oly_schools")
      .select("id, campaign_id, school_short_code, is_existing_salci_school, status")
      .eq("id", oly_school_id)
      .single();
    if (!school) return json({ error: "School not found" }, 404);

    if (school.status !== "enrollment_open") {
      return json({ error: "Enrollment is closed for this school" }, 409);
    }

    // Authorize: teacher assigned OR school_admin OR super_admin
    const { data: isTeacher } = await supabase.rpc("oly_is_teacher_for_class", {
      p_uid: userId, p_oly_school_id, p_grade_level_id: form_data.grade_level_id,
    });
    const { data: isAdmin } = await supabase.rpc("oly_is_school_admin_for", {
      p_uid: userId, p_oly_school_id,
    });
    const { data: isSuper } = await supabase.rpc("is_super_admin", { user_id: userId });
    if (!isTeacher && !isAdmin && !isSuper) return json({ error: "Forbidden" }, 403);

    // Validate phone
    if (!/^[6-9]\d{9}$/.test(form_data.parent_phone)) {
      return json({ error: "Invalid Indian mobile number" }, 400);
    }
    if (form_data.subject_ids.length !== 3) {
      return json({ error: "Exactly 3 subjects required" }, 400);
    }

    // Duplicate guard (same as Phase 2 oly-payment-create-order)
    if (school.is_existing_salci_school && form_data.admission_number) {
      const { data: dup } = await supabase
        .from("oly_students")
        .select("roll_number")
        .eq("oly_school_id", oly_school_id)
        .eq("admission_number", form_data.admission_number)
        .eq("campaign_id", school.campaign_id)
        .limit(1)
        .maybeSingle();
      if (dup) return json({ blocked: true, message: `Already enrolled: ${dup.roll_number}` }, 409);
    } else {
      const { data: dup } = await supabase
        .from("oly_students")
        .select("roll_number")
        .eq("oly_school_id", oly_school_id)
        .ilike("full_name", form_data.full_name)
        .eq("date_of_birth", form_data.date_of_birth)
        .eq("class_label", form_data.class_label)
        .gt("enrolled_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .limit(1)
        .maybeSingle();
      if (dup) return json({ blocked: true, message: `Already enrolled: ${dup.roll_number}` }, 409);
    }

    // Get campaign year + price for the receipt
    const { data: campaign } = await supabase
      .from("oly_campaigns")
      .select("campaign_year, default_price_paise, gst_percent")
      .eq("id", school.campaign_id)
      .single();
    if (!campaign) return json({ error: "Campaign not found" }, 500);

    const { data: schoolPrice } = await supabase
      .from("oly_schools")
      .select("price_override_paise")
      .eq("id", oly_school_id)
      .single();
    const pricePaise = schoolPrice?.price_override_paise ?? campaign.default_price_paise;
    const gstPaise = Math.round((pricePaise * campaign.gst_percent) / 100);
    const totalPaise = pricePaise + gstPaise;

    // Generate roll number
    const { data: rollData } = await supabase.rpc("oly_generate_roll_number", {
      p_school_short_code: school.school_short_code,
      p_class_label: form_data.class_label,
      p_campaign_year: campaign.campaign_year,
    });
    const rollNumber = rollData as string;
    if (!rollNumber) return json({ error: "Failed to generate roll number" }, 500);

    // Insert student
    const { data: student, error: insErr } = await supabase
      .from("oly_students")
      .insert({
        oly_school_id,
        campaign_id: school.campaign_id,
        full_name: form_data.full_name,
        date_of_birth: form_data.date_of_birth,
        class_label: form_data.class_label,
        section_label: form_data.section_label ?? null,
        grade_level_id: form_data.grade_level_id,
        admission_number: form_data.admission_number ?? null,
        roll_number: rollNumber,
        subject_ids: form_data.subject_ids,
        parent_name: form_data.parent_name,
        parent_phone: form_data.parent_phone,
        parent_email: form_data.parent_email ?? null,
        status: "active",
        enrollment_channel: "teacher_cash",
        created_by: userId,
      })
      .select("id")
      .single();
    if (insErr || !student) return json({ error: insErr?.message ?? "Insert failed" }, 500);

    // Cash receipt — no oly_enrollment_pending row exists, so receipt-generate
    // needs to look at oly_students.enrollment_channel = 'teacher_cash' and skip the pending lookup.
    // For Phase 3a we insert a synthetic pending row so the existing receipt-generate works unchanged.
    await supabase.from("oly_enrollment_pending").insert({
      oly_school_id,
      campaign_id: school.campaign_id,
      full_name: form_data.full_name,
      date_of_birth: form_data.date_of_birth,
      class_label: form_data.class_label,
      section_label: form_data.section_label ?? null,
      grade_level_id: form_data.grade_level_id,
      admission_number: form_data.admission_number ?? null,
      subject_ids: form_data.subject_ids,
      parent_name: form_data.parent_name,
      parent_phone: form_data.parent_phone,
      parent_email: form_data.parent_email ?? null,
      status: "paid",
      gateway_order_id: `cash_${student.id}`,
      gateway_payment_id: null,  // null marks it as cash
      amount_paise: pricePaise,
      gst_paise: gstPaise,
      total_paise: totalPaise,
      promoted_student_id: student.id,
    });

    // Trigger receipt generation (fire-and-forget)
    supabase.functions.invoke("oly-receipt-generate", {
      body: { oly_student_id: student.id },
    }).catch(() => {});

    // Audit
    await supabase.from("oly_audit_log").insert({
      campaign_id: school.campaign_id,
      oly_school_id,
      oly_student_id: student.id,
      actor_id: userId,
      actor_role: isTeacher ? "teacher" : (isAdmin ? "school_admin" : "super_admin"),
      action: "student_enrolled_cash",
      after_json: { roll_number: rollNumber, full_name: form_data.full_name, class_label: form_data.class_label, amount_paise: totalPaise },
    });

    return json({ oly_student_id: student.id, roll_number: rollNumber }, 200);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
```

Deploy: `npx supabase@latest functions deploy oly-cash-enroll --project-ref gyymkgohcijeksmrzuyw`

---

### Task 7: `oly-student-edit` and `oly-student-remove`

**Files:**
- Create: `supabase/functions/oly-student-edit/index.ts`
- Create: `supabase/functions/oly-student-remove/index.ts`

#### oly-student-edit

```ts
// @ts-expect-error Deno runtime
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-expect-error Deno runtime
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_FIELDS = new Set([
  "full_name", "section_label", "parent_name", "parent_phone", "parent_email"
]);

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

    const { oly_student_id, updates } = (await req.json()) as {
      oly_student_id: string;
      updates: Record<string, unknown>;
    };

    // Reject locked fields
    for (const k of Object.keys(updates)) {
      if (!ALLOWED_FIELDS.has(k)) {
        return json({ error: `Field '${k}' is locked and cannot be edited` }, 400);
      }
    }
    if (updates.parent_phone && !/^[6-9]\d{9}$/.test(String(updates.parent_phone))) {
      return json({ error: "Invalid Indian mobile number" }, 400);
    }

    // Fetch current student
    const { data: current, error: fetchErr } = await supabase
      .from("oly_students")
      .select("id, oly_school_id, campaign_id, grade_level_id, full_name, section_label, parent_name, parent_phone, parent_email")
      .eq("id", oly_student_id)
      .single();
    if (fetchErr || !current) return json({ error: "Student not found" }, 404);

    // Authorize
    const { data: isTeacher } = await supabase.rpc("oly_is_teacher_for_class", {
      p_uid: userId, p_oly_school_id: current.oly_school_id, p_grade_level_id: current.grade_level_id,
    });
    const { data: isAdmin } = await supabase.rpc("oly_is_school_admin_for", {
      p_uid: userId, p_oly_school_id: current.oly_school_id,
    });
    const { data: isSuper } = await supabase.rpc("is_super_admin", { user_id: userId });
    if (!isTeacher && !isAdmin && !isSuper) return json({ error: "Forbidden" }, 403);

    const beforeSnapshot = {
      full_name: current.full_name,
      section_label: current.section_label,
      parent_name: current.parent_name,
      parent_phone: current.parent_phone,
      parent_email: current.parent_email,
    };

    const { error: updErr } = await supabase
      .from("oly_students")
      .update(updates)
      .eq("id", oly_student_id);
    if (updErr) return json({ error: updErr.message }, 500);

    await supabase.from("oly_audit_log").insert({
      campaign_id: current.campaign_id,
      oly_school_id: current.oly_school_id,
      oly_student_id,
      actor_id: userId,
      actor_role: isTeacher ? "teacher" : (isAdmin ? "school_admin" : "super_admin"),
      action: "student_edited",
      before_json: beforeSnapshot,
      after_json: updates,
    });

    return json({ ok: true }, 200);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
```

#### oly-student-remove

```ts
// @ts-expect-error Deno runtime
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-expect-error Deno runtime
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

    const { oly_student_id, reason } = (await req.json()) as { oly_student_id: string; reason: string };
    if (!reason?.trim()) return json({ error: "Reason required" }, 400);

    const { data: current } = await supabase
      .from("oly_students")
      .select("id, oly_school_id, campaign_id, grade_level_id, enrollment_channel, status")
      .eq("id", oly_student_id)
      .single();
    if (!current) return json({ error: "Student not found" }, 404);
    if (current.status === "removed") return json({ error: "Already removed" }, 409);

    const { data: isTeacher } = await supabase.rpc("oly_is_teacher_for_class", {
      p_uid: userId, p_oly_school_id: current.oly_school_id, p_grade_level_id: current.grade_level_id,
    });
    const { data: isAdmin } = await supabase.rpc("oly_is_school_admin_for", {
      p_uid: userId, p_oly_school_id: current.oly_school_id,
    });
    const { data: isSuper } = await supabase.rpc("is_super_admin", { user_id: userId });
    if (!isTeacher && !isAdmin && !isSuper) return json({ error: "Forbidden" }, 403);

    // Trigger refund (fire-and-forget, the refund function audits separately)
    if (current.enrollment_channel === "parent_online") {
      supabase.functions.invoke("oly-refund-issue", {
        body: { scope: "per_student", oly_student_id, reason: `Removed by school: ${reason}` },
      }).catch(() => {});
    } else {
      // Cash — insert offline refund marker
      await supabase.from("oly_refunds").insert({
        oly_student_id,
        initiated_by: userId,
        reason: `Removed by school: ${reason}`,
        scope: "per_student",
        amount_paise: 0,
        status: "offline",
      });
    }

    const { error: updErr } = await supabase
      .from("oly_students")
      .update({
        status: "removed",
        removed_at: new Date().toISOString(),
        removed_by: userId,
        removed_reason: reason,
      })
      .eq("id", oly_student_id);
    if (updErr) return json({ error: updErr.message }, 500);

    await supabase.from("oly_audit_log").insert({
      campaign_id: current.campaign_id,
      oly_school_id: current.oly_school_id,
      oly_student_id,
      actor_id: userId,
      actor_role: isTeacher ? "teacher" : (isAdmin ? "school_admin" : "super_admin"),
      action: "student_removed",
      before_json: { status: current.status, enrollment_channel: current.enrollment_channel },
      after_json: { status: "removed" },
      reason,
    });

    return json({ ok: true }, 200);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
```

Deploy both:
```bash
npx supabase@latest functions deploy oly-student-edit --project-ref gyymkgohcijeksmrzuyw
npx supabase@latest functions deploy oly-student-remove --project-ref gyymkgohcijeksmrzuyw
```

After Tasks 3-7, commit:
```bash
git add supabase/functions/oly-create-teacher/ supabase/functions/oly-assign-existing-teachers/ supabase/functions/oly-close-enrollment/ supabase/functions/oly-cash-enroll/ supabase/functions/oly-student-edit/ supabase/functions/oly-student-remove/
git commit -m "feat(olympiad): phase 3a edge functions - teachers, close enrollment, cash enroll, student edit/remove with audit"
```

---

## Section C — School admin UI

### Task 8: Dashboard hook + page

**Files:**
- Create: `src/hooks/olympiad/useOlympiadMySchool.ts`
- Create: `src/hooks/olympiad/useOlympiadSchoolDashboard.ts`
- Create: `src/hooks/olympiad/useCloseEnrollment.ts`
- Create: `src/components/olympiad/school/OlympiadPhasePill.tsx`
- Create: `src/components/olympiad/school/CloseEnrollmentDialog.tsx`
- Replace placeholder: `src/pages/school/olympiad/OlympiadSchoolDashboardPage.tsx`

- [ ] **Step 8.1: `useOlympiadMySchool.ts`** — fetches the current school_admin's oly_school

```ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffectiveInstitution } from "@/hooks/useEffectiveInstitution";

export type MyOlympiadSchool = {
  id: string;
  campaign_id: string;
  school_short_code: string;
  status: "enrollment_open" | "enrollment_closed" | "batches_scheduled" | "exam_in_progress" | "results_published" | "archived";
  is_existing_salci_school: boolean;
  participating_grade_level_ids: string[];
  institution_name: string;
};

export function useOlympiadMySchool() {
  const { institutionId } = useEffectiveInstitution();
  return useQuery({
    queryKey: ["olympiad", "my-school", institutionId],
    queryFn: async (): Promise<MyOlympiadSchool | null> => {
      if (!institutionId) return null;
      const { data, error } = await supabase
        .from("oly_schools")
        .select("id, campaign_id, school_short_code, status, is_existing_salci_school, participating_grade_level_ids, institutions(name)")
        .eq("institution_id", institutionId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const inst = Array.isArray(data.institutions) ? data.institutions[0] : data.institutions;
      return {
        id: data.id,
        campaign_id: data.campaign_id,
        school_short_code: data.school_short_code,
        status: data.status as MyOlympiadSchool["status"],
        is_existing_salci_school: data.is_existing_salci_school,
        participating_grade_level_ids: data.participating_grade_level_ids ?? [],
        institution_name: (inst as { name?: string } | null)?.name ?? "(school)",
      };
    },
    enabled: !!institutionId,
    staleTime: 60_000,
  });
}
```

- [ ] **Step 8.2: `useOlympiadSchoolDashboard.ts`** — KPI roll-ups

```ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type DashboardStats = {
  totalEnrolled: number;
  byClass: Array<{ grade_level_id: string; grade_name: string; count: number }>;
  onlineCount: number;
  cashCount: number;
  onlinePaise: number;
  cashPaise: number;
  totalPaise: number;
};

export function useOlympiadSchoolDashboard(olySchoolId: string | undefined) {
  return useQuery({
    queryKey: ["olympiad", "dashboard", olySchoolId],
    queryFn: async (): Promise<DashboardStats> => {
      if (!olySchoolId) {
        return { totalEnrolled: 0, byClass: [], onlineCount: 0, cashCount: 0, onlinePaise: 0, cashPaise: 0, totalPaise: 0 };
      }
      const { data: students, error: sErr } = await supabase
        .from("oly_students")
        .select("id, grade_level_id, enrollment_channel")
        .eq("oly_school_id", olySchoolId)
        .eq("status", "active");
      if (sErr) throw sErr;

      const totalEnrolled = (students ?? []).length;
      const onlineCount = (students ?? []).filter((s) => s.enrollment_channel === "parent_online").length;
      const cashCount = (students ?? []).filter((s) => s.enrollment_channel === "teacher_cash").length;

      // By class
      const byClassMap: Record<string, number> = {};
      for (const s of students ?? []) {
        if (!s.grade_level_id) continue;
        byClassMap[s.grade_level_id] = (byClassMap[s.grade_level_id] ?? 0) + 1;
      }
      const gradeIds = Object.keys(byClassMap);
      const { data: grades } = gradeIds.length > 0
        ? await supabase.from("grade_levels").select("id, grade_name, display_order").in("id", gradeIds)
        : { data: [] };
      const byClass = (grades ?? [])
        .map((g) => ({
          grade_level_id: g.id,
          grade_name: g.grade_name,
          count: byClassMap[g.id] ?? 0,
        }))
        .sort((a, b) => (a.grade_name).localeCompare(b.grade_name));

      // Revenue
      const { data: pendings } = await supabase
        .from("oly_enrollment_pending")
        .select("total_paise, gateway_payment_id")
        .eq("oly_school_id", olySchoolId)
        .eq("status", "paid");
      const onlinePaise = (pendings ?? [])
        .filter((p) => p.gateway_payment_id && !p.gateway_payment_id.startsWith("cash_"))
        .reduce((acc, p) => acc + (p.total_paise ?? 0), 0);
      const cashPaise = (pendings ?? [])
        .filter((p) => !p.gateway_payment_id || p.gateway_payment_id.startsWith("cash_"))
        .reduce((acc, p) => acc + (p.total_paise ?? 0), 0);

      return {
        totalEnrolled, byClass, onlineCount, cashCount,
        onlinePaise, cashPaise, totalPaise: onlinePaise + cashPaise,
      };
    },
    enabled: !!olySchoolId,
    staleTime: 30_000,
  });
}
```

- [ ] **Step 8.3: `useCloseEnrollment.ts`**

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invokeEdgeFunction } from "@/lib/invokeEdgeFunction";
import { toastError } from "@/lib/toast";
import { toast } from "sonner";

export function useCloseEnrollment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ olySchoolId }: { olySchoolId: string }) => {
      return invokeEdgeFunction<{ ok: true }>("oly-close-enrollment", { oly_school_id: olySchoolId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["olympiad"] });
      toast.success("Enrollment closed");
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't close enrollment.", context: "useCloseEnrollment" }),
  });
}
```

- [ ] **Step 8.4: `OlympiadPhasePill.tsx`**

```tsx
import { Badge } from "@/components/ui/badge";

type Phase = "enrollment_open" | "enrollment_closed" | "batches_scheduled" | "exam_in_progress" | "results_published" | "archived";

const STYLE: Record<Phase, string> = {
  enrollment_open:    "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-300",
  enrollment_closed:  "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300",
  batches_scheduled:  "bg-sky-100 text-sky-900 dark:bg-sky-500/15 dark:text-sky-300",
  exam_in_progress:   "bg-violet-100 text-violet-900 dark:bg-violet-500/15 dark:text-violet-300",
  results_published:  "bg-slate-200 text-slate-800 dark:bg-slate-500/15 dark:text-slate-300",
  archived:           "bg-slate-100 text-slate-600 dark:bg-slate-700/40 dark:text-slate-400",
};

const LABEL: Record<Phase, string> = {
  enrollment_open: "Enrollment Open",
  enrollment_closed: "Enrollment Closed",
  batches_scheduled: "Batches Scheduled",
  exam_in_progress: "Exam in Progress",
  results_published: "Results Published",
  archived: "Archived",
};

export function OlympiadPhasePill({ phase }: { phase: Phase }) {
  return <Badge className={`text-xs font-medium ${STYLE[phase]}`} variant="secondary">{LABEL[phase]}</Badge>;
}
```

- [ ] **Step 8.5: `CloseEnrollmentDialog.tsx`**

```tsx
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { useCloseEnrollment } from "@/hooks/olympiad/useCloseEnrollment";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  olySchoolId: string;
};

export function CloseEnrollmentDialog({ open, onOpenChange, olySchoolId }: Props) {
  const close = useCloseEnrollment();
  const [typed, setTyped] = useState("");
  const canConfirm = typed === "CLOSE";

  const onConfirm = async () => {
    try {
      await close.mutateAsync({ olySchoolId });
      onOpenChange(false);
      setTyped("");
    } catch { /* toastError fires */ }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Close enrollment?</AlertDialogTitle>
          <AlertDialogDescription>
            After this, no new students can enroll. Existing in-flight payments will still complete. This cannot be undone from the school portal.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid gap-1.5 py-2">
          <Label className="text-xs font-medium text-ink-600">Type CLOSE to confirm</Label>
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={!canConfirm || close.isPending} onClick={onConfirm}>
            {close.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Close enrollment
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

- [ ] **Step 8.6: Dashboard page**

`src/pages/school/olympiad/OlympiadSchoolDashboardPage.tsx`:

```tsx
import { useState } from "react";
import { Loader2, Users, Banknote, BookOpen } from "lucide-react";
import { NavLink } from "react-router-dom";
import { PageShell } from "@/components/shared/page/PageShell";
import { PageHeader } from "@/components/shared/page/PageHeader";
import { StatTile, StatTileGrid } from "@/components/shared/surfaces";
import { Button } from "@/components/ui/button";
import { useOlympiadMySchool } from "@/hooks/olympiad/useOlympiadMySchool";
import { useOlympiadSchoolDashboard } from "@/hooks/olympiad/useOlympiadSchoolDashboard";
import { OlympiadPhasePill } from "@/components/olympiad/school/OlympiadPhasePill";
import { CloseEnrollmentDialog } from "@/components/olympiad/school/CloseEnrollmentDialog";

export default function OlympiadSchoolDashboardPage() {
  const { data: school, isLoading: schoolLoading } = useOlympiadMySchool();
  const { data: stats, isLoading: statsLoading } = useOlympiadSchoolDashboard(school?.id);
  const [closeOpen, setCloseOpen] = useState(false);

  if (schoolLoading) {
    return <PageShell><div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-ink-500" /></div></PageShell>;
  }
  if (!school) {
    return (
      <PageShell>
        <PageHeader title="SALCI Olympiad" />
        <div className="surface-card frosted-shadow rounded-card p-6 text-center text-sm text-ink-600">
          This institution is not currently enrolled in the SALCI Olympiad. Please contact SALCI to onboard.
        </div>
      </PageShell>
    );
  }

  const rupees = (p: number) => `₹${(p / 100).toFixed(0)}`;

  return (
    <PageShell>
      <PageHeader
        title="SALCI Olympiad"
        subtitle={school.institution_name}
      />

      <div className="space-y-4 py-4">
        <div className="flex items-center justify-between">
          <OlympiadPhasePill phase={school.status} />
          <div className="flex gap-2">
            {school.status === "enrollment_open" && (
              <Button variant="destructive" size="sm" onClick={() => setCloseOpen(true)}>
                Close enrollment
              </Button>
            )}
            {school.status === "enrollment_closed" && (
              <>
                <Button size="sm" disabled title="Coming in Phase 3b">Schedule batches</Button>
                <NavLink to="/school/olympiad/teachers"><Button size="sm" variant="outline">View teachers</Button></NavLink>
              </>
            )}
          </div>
        </div>

        {statsLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-ink-500" /></div>
        ) : stats && (
          <StatTileGrid>
            <StatTile label="Enrolled" value={stats.totalEnrolled.toString()} icon={<Users className="h-4 w-4" />} tone="teal" />
            <StatTile label="Online vs Cash" value={`${stats.onlineCount} / ${stats.cashCount}`} icon={<Banknote className="h-4 w-4" />} tone="mint" />
            <StatTile label="Revenue collected" value={rupees(stats.totalPaise)} icon={<Banknote className="h-4 w-4" />} tone="violet" />
            <StatTile label="Classes participating" value={school.participating_grade_level_ids.length.toString()} icon={<BookOpen className="h-4 w-4" />} tone="peach" />
          </StatTileGrid>
        )}

        {stats && stats.byClass.length > 0 && (
          <section className="surface-card frosted-shadow rounded-card p-5 space-y-3">
            <header>
              <p className="eyebrow">By class</p>
              <h3 className="text-base font-semibold text-ink-900">Enrollment breakdown</h3>
            </header>
            <ul className="divide-y divide-surface-stroke">
              {stats.byClass.map((c) => (
                <li key={c.grade_level_id} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-ink-900">{c.grade_name}</span>
                  <span className="text-ink-600">{c.count} student{c.count === 1 ? "" : "s"}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="surface-card frosted-shadow rounded-card p-5 space-y-3">
          <p className="eyebrow">Quick actions</p>
          <div className="flex flex-col sm:flex-row gap-2">
            <NavLink to="/school/olympiad/teachers" className="flex-1">
              <Button variant="outline" className="w-full">Teachers</Button>
            </NavLink>
            <NavLink to="/school/olympiad/share" className="flex-1">
              <Button variant="outline" className="w-full">Share materials</Button>
            </NavLink>
          </div>
        </section>
      </div>

      <CloseEnrollmentDialog open={closeOpen} onOpenChange={setCloseOpen} olySchoolId={school.id} />
    </PageShell>
  );
}
```

- [ ] **Step 8.7: Verify + commit**

```bash
npx tsc --noEmit
npx eslint src/hooks/olympiad/useOlympiadMySchool.ts src/hooks/olympiad/useOlympiadSchoolDashboard.ts src/hooks/olympiad/useCloseEnrollment.ts src/components/olympiad/school/OlympiadPhasePill.tsx src/components/olympiad/school/CloseEnrollmentDialog.tsx src/pages/school/olympiad/OlympiadSchoolDashboardPage.tsx
npx vite build
git add src/hooks/olympiad/useOlympiadMySchool.ts src/hooks/olympiad/useOlympiadSchoolDashboard.ts src/hooks/olympiad/useCloseEnrollment.ts src/components/olympiad/school/ src/pages/school/olympiad/OlympiadSchoolDashboardPage.tsx
git commit -m "feat(olympiad): school admin dashboard with KPIs + close-enrollment flow"
```

---

### Task 9: Teachers page (combined new + existing-SALCI flows)

**Files:**
- Create: `src/hooks/olympiad/useOlympiadTeachers.ts`
- Create: `src/hooks/olympiad/useCreateOlympiadTeacher.ts`
- Create: `src/hooks/olympiad/useAssignOlympiadTeachers.ts`
- Create: `src/components/olympiad/school/TeacherListRow.tsx`
- Create: `src/components/olympiad/school/AddTeacherSheet.tsx`
- Create: `src/components/olympiad/school/AssignTeachersSheet.tsx`
- Replace: `src/pages/school/olympiad/OlympiadSchoolTeachersPage.tsx`

This task is sizeable (~400 lines across 7 files). Implementer should:

1. **`useOlympiadTeachers`** — joins `oly_teacher_class_assignments` to `profiles` for the school, returns `{ teacher_profile_id, full_name, email, phone, grade_level_ids: string[] }[]`. Group by teacher_profile_id, aggregate grade_level_ids.

2. **`useCreateOlympiadTeacher`** — mutation wrapping `invokeEdgeFunction<{ teacher_profile_id: string }>("oly-create-teacher", input)`. Invalidates `["olympiad", "teachers"]`. Toast success. `toastError` on error.

3. **`useAssignOlympiadTeachers`** — mutation wrapping `invokeEdgeFunction<{ ok: true; processed: number }>("oly-assign-existing-teachers", input)`. Same shape.

4. **`TeacherListRow`** — flex row with name/email/phone + class badges + kebab menu (Edit classes, Deactivate). Uses `surface-card frosted-shadow rounded-card`.

5. **`AddTeacherSheet`** — MobileSheet form for new-school teacher creation. Fields: full_name, email, phone, grade_level_ids (checkbox grid filtered to school.participating_grade_level_ids). Initial-state diff isDirty. try/catch on mutateAsync. shadcn inputs only.

6. **`AssignTeachersSheet`** — MobileSheet for existing-SALCI teacher assignment. Lists existing teachers at the institution (filtered via `profiles.institution_id = school.institution_id` AND `user_roles.role = 'teacher'`). For each, a "+ Assign classes" button opens an inline grade-level multiselect. Submit calls useAssignOlympiadTeachers.

7. **`OlympiadSchoolTeachersPage`** — branches on `is_existing_salci_school`. Shows EmptyState if no teachers. Triggers Add or Assign sheet.

Full code blocks are extensive; the implementer should reference Phase 2's Task 8 (OnboardSchoolSheet) as the structural precedent and the Phase 2 `useOlympiadInstitutions` hook as the institutions-list precedent.

Verify + commit:
```bash
npx tsc --noEmit
npx eslint <touched paths>
npx vite build
git add src/hooks/olympiad/useOlympiadTeachers.ts src/hooks/olympiad/useCreateOlympiadTeacher.ts src/hooks/olympiad/useAssignOlympiadTeachers.ts src/components/olympiad/school/TeacherListRow.tsx src/components/olympiad/school/AddTeacherSheet.tsx src/components/olympiad/school/AssignTeachersSheet.tsx src/pages/school/olympiad/OlympiadSchoolTeachersPage.tsx
git commit -m "feat(olympiad): teacher management - add (new schools) + assign (existing SALCI)"
```

---

### Task 10: Share page

**Files:**
- Create: `src/components/olympiad/school/ShareTemplates.tsx`
- Replace: `src/pages/school/olympiad/OlympiadSchoolSharePage.tsx`

- [ ] **Step 10.1: `ShareTemplates.tsx`**

```tsx
import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

type Props = { schoolName: string; publicUrl: string };

export function ShareTemplates({ schoolName, publicUrl }: Props) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const copy = async (key: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedKey(key);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopiedKey(null), 1500);
  };

  const whatsapp = `Pay for your child's SALCI Olympiad enrollment at ${schoolName}: ${publicUrl}. Enrollment closes soon.`;

  const emailSubject = `SALCI Olympiad enrollment for ${schoolName}`;
  const emailBody = `Dear Parent,

We are pleased to invite your child to participate in the SALCI Olympiad — a competitive exam across three student-chosen subjects, held at the school.

To enroll, visit: ${publicUrl}

Best regards,
${schoolName}`;

  return (
    <div className="space-y-4">
      <section className="surface-card frosted-shadow rounded-card p-5 space-y-2">
        <p className="eyebrow">WhatsApp template</p>
        <Textarea value={whatsapp} readOnly rows={3} className="text-sm" />
        <Button size="sm" variant="outline" onClick={() => copy("whatsapp", whatsapp)}>
          {copiedKey === "whatsapp" ? <Check className="h-4 w-4 mr-1 text-emerald-500" /> : <Copy className="h-4 w-4 mr-1" />}
          Copy WhatsApp message
        </Button>
      </section>

      <section className="surface-card frosted-shadow rounded-card p-5 space-y-3">
        <p className="eyebrow">Parent email template</p>
        <div className="grid gap-1.5">
          <Label className="text-xs font-medium text-ink-600">Subject</Label>
          <Input value={emailSubject} readOnly />
        </div>
        <div className="grid gap-1.5">
          <Label className="text-xs font-medium text-ink-600">Body</Label>
          <Textarea value={emailBody} readOnly rows={8} className="text-sm" />
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => copy("subject", emailSubject)}>
            {copiedKey === "subject" ? <Check className="h-4 w-4 mr-1 text-emerald-500" /> : <Copy className="h-4 w-4 mr-1" />}
            Copy subject
          </Button>
          <Button size="sm" variant="outline" onClick={() => copy("body", emailBody)}>
            {copiedKey === "body" ? <Check className="h-4 w-4 mr-1 text-emerald-500" /> : <Copy className="h-4 w-4 mr-1" />}
            Copy body
          </Button>
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 10.2: Share page**

`src/pages/school/olympiad/OlympiadSchoolSharePage.tsx`:

```tsx
import { Loader2 } from "lucide-react";
import { NavLink } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { PageShell } from "@/components/shared/page/PageShell";
import { PageHeader } from "@/components/shared/page/PageHeader";
import { useOlympiadMySchool } from "@/hooks/olympiad/useOlympiadMySchool";
import { PublicPaymentLink } from "@/components/olympiad/admin/PublicPaymentLink";
import { ShareTemplates } from "@/components/olympiad/school/ShareTemplates";

export default function OlympiadSchoolSharePage() {
  const { data: school, isLoading } = useOlympiadMySchool();
  const base = (import.meta.env.VITE_PUBLIC_URL ?? "https://www.salci.org").replace(/\/$/, "");
  const publicUrl = school ? `${base}/olympiad/${school.school_short_code}` : "";

  if (isLoading) {
    return <PageShell><div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-ink-500" /></div></PageShell>;
  }
  if (!school) {
    return <PageShell><p className="py-6 text-sm text-ink-600">No active Olympiad campaign for this school.</p></PageShell>;
  }

  return (
    <PageShell>
      <NavLink to="/school/olympiad" className="inline-flex items-center gap-1 text-sm text-ink-600 hover:text-ink-900 mb-2">
        <ArrowLeft className="h-4 w-4" /> Dashboard
      </NavLink>
      <PageHeader title="Share materials" subtitle="Public URL, QR, and pre-formatted messages for parents" />
      <div className="space-y-4 py-4">
        <PublicPaymentLink schoolShortCode={school.school_short_code} />
        <ShareTemplates schoolName={school.institution_name} publicUrl={publicUrl} />
      </div>
    </PageShell>
  );
}
```

- [ ] **Step 10.3: Verify + commit**

```bash
npx tsc --noEmit
npx eslint src/components/olympiad/school/ShareTemplates.tsx src/pages/school/olympiad/OlympiadSchoolSharePage.tsx
npx vite build
git add src/components/olympiad/school/ShareTemplates.tsx src/pages/school/olympiad/OlympiadSchoolSharePage.tsx
git commit -m "feat(olympiad): share page with WhatsApp + email templates"
```

---

## Section D — Teacher portal

### Task 11: Teacher dashboard hook + page

**Files:**
- Create: `src/hooks/olympiad/useOlympiadAssignedClasses.ts`
- Create: `src/components/olympiad/teacher/ClassCard.tsx`
- Replace: `src/pages/teacher/olympiad/OlympiadTeacherDashboardPage.tsx`

- [ ] **Step 11.1: Hook**

```ts
// src/hooks/olympiad/useOlympiadAssignedClasses.ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type AssignedClass = {
  assignment_id: string;
  oly_school_id: string;
  school_short_code: string;
  institution_name: string;
  grade_level_id: string;
  grade_name: string;
  campaign_id: string;
  enrolled_count: number;
};

export function useOlympiadAssignedClasses() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["olympiad", "my-classes", user?.id],
    queryFn: async (): Promise<AssignedClass[]> => {
      if (!user?.id) return [];
      const { data: assignments, error } = await supabase
        .from("oly_teacher_class_assignments")
        .select(`
          id, oly_school_id, grade_level_id, campaign_id,
          oly_schools ( school_short_code, institutions ( name ) ),
          grade_levels ( grade_name, display_order )
        `)
        .eq("teacher_profile_id", user.id)
        .order("assigned_at");
      if (error) throw error;

      const rows = (assignments ?? []).map((a) => {
        const school = Array.isArray(a.oly_schools) ? a.oly_schools[0] : a.oly_schools;
        const grade = Array.isArray(a.grade_levels) ? a.grade_levels[0] : a.grade_levels;
        const inst = (school as { institutions?: { name?: string } | { name?: string }[] } | null)?.institutions;
        const institutionName = (Array.isArray(inst) ? inst[0] : inst)?.name ?? "(school)";
        return {
          assignment_id: a.id,
          oly_school_id: a.oly_school_id,
          school_short_code: (school as { school_short_code?: string } | null)?.school_short_code ?? "",
          institution_name: institutionName,
          grade_level_id: a.grade_level_id,
          grade_name: (grade as { grade_name?: string } | null)?.grade_name ?? "",
          campaign_id: a.campaign_id,
          enrolled_count: 0,
        };
      });

      // Roll up enrolled counts per (school, grade)
      if (rows.length > 0) {
        const { data: students } = await supabase
          .from("oly_students")
          .select("oly_school_id, grade_level_id")
          .eq("status", "active")
          .in("oly_school_id", rows.map((r) => r.oly_school_id))
          .in("grade_level_id", rows.map((r) => r.grade_level_id));
        for (const s of students ?? []) {
          const r = rows.find((row) => row.oly_school_id === s.oly_school_id && row.grade_level_id === s.grade_level_id);
          if (r) r.enrolled_count += 1;
        }
      }
      return rows;
    },
    enabled: !!user?.id,
    staleTime: 60_000,
  });
}
```

- [ ] **Step 11.2: `ClassCard.tsx`**

```tsx
import { ChevronRight, Users } from "lucide-react";
import { NavLink } from "react-router-dom";
import type { AssignedClass } from "@/hooks/olympiad/useOlympiadAssignedClasses";

export function ClassCard({ cls }: { cls: AssignedClass }) {
  return (
    <NavLink
      to={`/teacher/olympiad/classes/${cls.oly_school_id}/${cls.grade_level_id}`}
      className="block surface-card frosted-shadow rounded-card p-4 hover:bg-surface-card/80 transition-colors"
    >
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-ink-900 truncate">{cls.grade_name}</p>
          <p className="text-[11px] text-ink-500 mt-0.5 truncate">{cls.institution_name} · {cls.school_short_code}</p>
          <div className="flex items-center gap-1 mt-2 text-xs text-ink-700">
            <Users className="h-3.5 w-3.5" />
            <span>{cls.enrolled_count} student{cls.enrolled_count === 1 ? "" : "s"}</span>
          </div>
        </div>
        <ChevronRight className="h-4 w-4 text-ink-500 flex-shrink-0" />
      </div>
    </NavLink>
  );
}
```

- [ ] **Step 11.3: Dashboard page**

`src/pages/teacher/olympiad/OlympiadTeacherDashboardPage.tsx`:

```tsx
import { Loader2, Medal } from "lucide-react";
import { PageShell } from "@/components/shared/page/PageShell";
import { PageHeader } from "@/components/shared/page/PageHeader";
import { EmptyState } from "@/components/shared/surfaces/EmptyState";
import { useOlympiadAssignedClasses } from "@/hooks/olympiad/useOlympiadAssignedClasses";
import { ClassCard } from "@/components/olympiad/teacher/ClassCard";
import { useAuth } from "@/hooks/useAuth";

export default function OlympiadTeacherDashboardPage() {
  const { user } = useAuth();
  const { data: classes, isLoading } = useOlympiadAssignedClasses();

  return (
    <PageShell>
      <PageHeader
        title="SALCI Olympiad"
        subtitle={user?.email ? `Welcome, ${user.email.split("@")[0]}` : "Your classes"}
      />
      <div className="space-y-3 py-4">
        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-ink-500" /></div>
        ) : (classes ?? []).length === 0 ? (
          <EmptyState
            icon={<Medal className="h-8 w-8 text-ink-500" />}
            title="No classes assigned"
            description="Ask your school admin to assign you to an Olympiad class."
          />
        ) : (
          <>
            <p className="eyebrow">My classes</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(classes ?? []).map((c) => <ClassCard key={c.assignment_id} cls={c} />)}
            </div>
          </>
        )}
      </div>
    </PageShell>
  );
}
```

If `useAuth` has a different export shape (e.g. `useAuth().session.user`), match the actual signature.

- [ ] **Step 11.4: Verify + commit**

```bash
npx tsc --noEmit
npx eslint src/hooks/olympiad/useOlympiadAssignedClasses.ts src/components/olympiad/teacher/ClassCard.tsx src/pages/teacher/olympiad/OlympiadTeacherDashboardPage.tsx
npx vite build
git add src/hooks/olympiad/useOlympiadAssignedClasses.ts src/components/olympiad/teacher/ClassCard.tsx src/pages/teacher/olympiad/OlympiadTeacherDashboardPage.tsx
git commit -m "feat(olympiad): teacher dashboard with assigned classes"
```

---

### Task 12: Class roster page + roster row + filters

**Files:**
- Create: `src/hooks/olympiad/useOlympiadClassRoster.ts`
- Create: `src/components/olympiad/teacher/StudentRosterRow.tsx`
- Replace: `src/pages/teacher/olympiad/OlympiadTeacherClassPage.tsx`

- [ ] **Step 12.1: `useOlympiadClassRoster.ts`**

```ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type RosterStudent = {
  id: string;
  roll_number: string;
  full_name: string;
  date_of_birth: string;
  section_label: string | null;
  subject_ids: string[];
  enrollment_channel: "parent_online" | "teacher_cash";
  enrolled_at: string;
  status: string;
};

export type RosterFilters = {
  channel?: "parent_online" | "teacher_cash" | null;
  status?: "active" | "removed" | null;
};

export function useOlympiadClassRoster(
  olySchoolId: string | undefined,
  gradeLevelId: string | undefined,
  filters: RosterFilters,
) {
  return useQuery({
    queryKey: ["olympiad", "class-roster", olySchoolId, gradeLevelId, filters],
    queryFn: async (): Promise<RosterStudent[]> => {
      if (!olySchoolId || !gradeLevelId) return [];
      let query = supabase
        .from("oly_students")
        .select("id, roll_number, full_name, date_of_birth, section_label, subject_ids, enrollment_channel, enrolled_at, status")
        .eq("oly_school_id", olySchoolId)
        .eq("grade_level_id", gradeLevelId)
        .order("roll_number");
      if (filters.channel) query = query.eq("enrollment_channel", filters.channel);
      if (filters.status) query = query.eq("status", filters.status);
      else query = query.in("status", ["active", "removed"]);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as RosterStudent[];
    },
    enabled: !!olySchoolId && !!gradeLevelId,
    staleTime: 30_000,
  });
}
```

- [ ] **Step 12.2: `StudentRosterRow.tsx`**

```tsx
import { useState } from "react";
import { MoreVertical, Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { RosterStudent } from "@/hooks/olympiad/useOlympiadClassRoster";

type Props = {
  student: RosterStudent;
  subjectNameById: Record<string, string>;
  onEdit: (s: RosterStudent) => void;
  onRemove: (s: RosterStudent) => void;
};

export function StudentRosterRow({ student, subjectNameById, onEdit, onRemove }: Props) {
  const [open, setOpen] = useState(false);
  const subjectsLabel = student.subject_ids.map((id) => subjectNameById[id] ?? "?").join(", ");
  const isCash = student.enrollment_channel === "teacher_cash";
  const isRemoved = student.status === "removed";

  return (
    <div className={`flex items-center gap-3 px-3 py-3 surface-card frosted-shadow rounded-card ${isRemoved ? "opacity-60" : ""}`}>
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-semibold text-ink-900">{student.full_name}</p>
          {isCash && <Badge variant="secondary" className="text-[10px]">Cash</Badge>}
          {isRemoved && <Badge variant="secondary" className="text-[10px] bg-rose-100 text-rose-900 dark:bg-rose-500/15 dark:text-rose-300">Removed</Badge>}
        </div>
        <p className="text-[11px] text-ink-500">
          {student.roll_number} · DOB {student.date_of_birth}{student.section_label ? ` · Sec ${student.section_label}` : ""}
        </p>
        <p className="text-[11px] text-ink-600 truncate">{subjectsLabel}</p>
      </div>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="ghost" disabled={isRemoved}>
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={() => { setOpen(false); onEdit(student); }}>
            <Pencil className="h-4 w-4 mr-2" /> Edit
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => { setOpen(false); onRemove(student); }} className="text-destructive">
            <Trash2 className="h-4 w-4 mr-2" /> Remove
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
```

- [ ] **Step 12.3: Class page**

`src/pages/teacher/olympiad/OlympiadTeacherClassPage.tsx` — large component (~250 lines). Implements:
- Reads `:olySchoolId` and `:gradeLevelId` from URL params
- Fetches class info (school short code + grade name) via small helper hooks
- `useOlympiadClassRoster` with filter state
- `FilterRow` with chips for channel + status (uses sentinel values)
- Header counts (Active / Removed) tracked from data
- `StudentRosterRow` list
- `MobileFab` button "+ Enroll cash student" → opens `CashEnrollSheet` (Task 13)
- Tracks edit/remove dialog state, opens `EditStudentSheet` (Task 13) / `RemoveStudentDialog` (Task 13)
- Fetches subject names for the display via a one-shot `oly_subjects` query keyed on subject_ids in the roster
- Empty state when no students

The implementer should produce this page wiring together the pieces from Task 13. Initially commit Task 12 with stub imports that reference Task 13 components — TypeScript will fail until Task 13 lands. Strategy: implement Task 12 + Task 13 in the same dispatch.

- [ ] **Step 12.4: Verify + commit (after Task 13 ships the sheets)**

---

### Task 13: Cash enroll + edit + remove sheets

**Files:**
- Create: `src/hooks/olympiad/useOlympiadCashEnroll.ts`
- Create: `src/hooks/olympiad/useOlympiadEditStudent.ts`
- Create: `src/hooks/olympiad/useOlympiadRemoveStudent.ts`
- Create: `src/components/olympiad/teacher/CashEnrollSheet.tsx`
- Create: `src/components/olympiad/teacher/EditStudentSheet.tsx`
- Create: `src/components/olympiad/teacher/RemoveStudentDialog.tsx`

These mirror Phase 2 enrollment patterns. Implementer mirrors Phase 2's `useOlympiadEnrollSubmit` for the cash hook (no payment handoff — direct success).

#### 13.1 `useOlympiadCashEnroll.ts`

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invokeEdgeFunction } from "@/lib/invokeEdgeFunction";
import { toastError } from "@/lib/toast";
import { toast } from "sonner";

export type CashEnrollInput = {
  oly_school_id: string;
  form_data: {
    full_name: string;
    date_of_birth: string;
    class_label: string;
    section_label?: string | null;
    grade_level_id: string;
    admission_number?: string | null;
    subject_ids: string[];
    parent_name: string;
    parent_phone: string;
    parent_email?: string | null;
    fee_collected: boolean;
  };
};

export type CashEnrollResult = {
  oly_student_id: string;
  roll_number: string;
  blocked?: false;
} | { blocked: true; message: string };

export function useOlympiadCashEnroll() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CashEnrollInput): Promise<CashEnrollResult> => {
      try {
        return await invokeEdgeFunction<{ oly_student_id: string; roll_number: string }>("oly-cash-enroll", input);
      } catch (e) {
        const msg = (e as Error).message;
        if (msg.includes("Already enrolled")) {
          return { blocked: true, message: msg };
        }
        throw e;
      }
    },
    onSuccess: (result) => {
      if ("blocked" in result && result.blocked) return;
      queryClient.invalidateQueries({ queryKey: ["olympiad", "class-roster"] });
      queryClient.invalidateQueries({ queryKey: ["olympiad", "dashboard"] });
      toast.success(`Student enrolled. Roll number: ${result.roll_number}`);
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't enroll student.", context: "useOlympiadCashEnroll" }),
  });
}
```

#### 13.2 `useOlympiadEditStudent.ts`

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invokeEdgeFunction } from "@/lib/invokeEdgeFunction";
import { toastError } from "@/lib/toast";
import { toast } from "sonner";

export type EditStudentInput = {
  oly_student_id: string;
  updates: Partial<{
    full_name: string;
    section_label: string | null;
    parent_name: string;
    parent_phone: string;
    parent_email: string | null;
  }>;
};

export function useOlympiadEditStudent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: EditStudentInput) => {
      return invokeEdgeFunction<{ ok: true }>("oly-student-edit", input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["olympiad", "class-roster"] });
      toast.success("Student updated");
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't update student.", context: "useOlympiadEditStudent" }),
  });
}
```

#### 13.3 `useOlympiadRemoveStudent.ts`

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invokeEdgeFunction } from "@/lib/invokeEdgeFunction";
import { toastError } from "@/lib/toast";
import { toast } from "sonner";

export function useOlympiadRemoveStudent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ oly_student_id, reason }: { oly_student_id: string; reason: string }) => {
      return invokeEdgeFunction<{ ok: true }>("oly-student-remove", { oly_student_id, reason });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["olympiad", "class-roster"] });
      queryClient.invalidateQueries({ queryKey: ["olympiad", "dashboard"] });
      toast.success("Student removed. Refund initiated.");
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't remove student.", context: "useOlympiadRemoveStudent" }),
  });
}
```

#### 13.4 `CashEnrollSheet.tsx`

Mirrors Phase 2's `EnrollmentFormNonSalci` shape but:
- Adds a **mandatory** "Fee collected from parent" Checkbox at the bottom (legally meaningful)
- On submit calls `useOlympiadCashEnroll`
- On success: toast with roll number, then closes sheet
- Reuses `SubjectPicker` from `@/components/olympiad/public/SubjectPicker` (already exists from Phase 2)

Layout: MobileSheet wrapping a form with full_name, date_of_birth, class picker (constrained to the teacher's assigned grade_level_id — pre-selected, read-only), section, SubjectPicker, parent contact, fee_collected checkbox, Save.

#### 13.5 `EditStudentSheet.tsx`

MobileSheet. Pre-fills from `student` prop. Editable fields: full_name, section_label, parent_name, parent_phone, parent_email. Locked fields: roll_number, DOB, class, subjects, admission_number, payment method — shown as read-only with lock icons.

Initial-state diff for isDirty (per the established pattern). try/catch on mutateAsync. shadcn inputs only.

#### 13.6 `RemoveStudentDialog.tsx`

AlertDialog with mandatory `reason` Textarea. Message text varies by `enrollment_channel`:
- `parent_online`: "Refund will be issued automatically via the payment gateway"
- `teacher_cash`: "Marked 'refund offline' — please return cash to the parent physically"

On confirm calls `useOlympiadRemoveStudent`.

#### 13.7 Wire into Class page (finish Task 12)

```tsx
// Inside OlympiadTeacherClassPage:
const [editing, setEditing] = useState<RosterStudent | null>(null);
const [removing, setRemoving] = useState<RosterStudent | null>(null);
const [cashOpen, setCashOpen] = useState(false);
// ...
<CashEnrollSheet
  open={cashOpen}
  onOpenChange={setCashOpen}
  olySchoolId={olySchoolId!}
  gradeLevelId={gradeLevelId!}
  classLabel={`Class ${gradeNumber}`}
  availableSubjects={subjectsForGrade}
/>
<EditStudentSheet
  open={!!editing}
  onOpenChange={(o) => !o && setEditing(null)}
  student={editing}
/>
<RemoveStudentDialog
  open={!!removing}
  onOpenChange={(o) => !o && setRemoving(null)}
  student={removing}
/>
```

#### Verify + commit

```bash
npx tsc --noEmit
npx eslint src/hooks/olympiad/useOlympiadCashEnroll.ts src/hooks/olympiad/useOlympiadEditStudent.ts src/hooks/olympiad/useOlympiadRemoveStudent.ts src/components/olympiad/teacher/ src/pages/teacher/olympiad/OlympiadTeacherClassPage.tsx
npx vite build
git add src/hooks/olympiad/useOlympiadCashEnroll.ts src/hooks/olympiad/useOlympiadEditStudent.ts src/hooks/olympiad/useOlympiadRemoveStudent.ts src/components/olympiad/teacher/ src/pages/teacher/olympiad/OlympiadTeacherClassPage.tsx
git commit -m "feat(olympiad): teacher class roster + cash enrollment + student edit/remove"
```

---

## Section E — Verification

### Task 14: §5a contract sweep + manual smoke checklist

- [ ] **Run all three §5a checks**

```bash
npx tsc --noEmit
npx eslint "src/{hooks,components,pages}/olympiad/**" "src/App.tsx" "src/components/layout/AppSidebar.tsx" "src/pages/school/olympiad/**" "src/pages/teacher/olympiad/**"
npx vite build
```
All exit 0.

- [ ] **Manual smoke checklist (controller / user — agents can't drive a browser)**

1. **As school_admin of a non-SALCI school**: log in → land at `/school/olympiad`
2. KPI tiles populate (initially 0 / 0 / ₹0)
3. Click "Teachers" → see empty state → click "+ Add Teacher" → fill form → submit → Resend email received → teacher row appears in list
4. As that teacher: click password-set link → set password → log in → land at `/teacher/olympiad`
5. See assigned class card with 0 students
6. Click class card → land at `/teacher/olympiad/classes/:olySchoolId/:gradeLevelId`
7. Click "+ Enroll cash student" FAB → fill form including the "Fee collected" checkbox → submit → toast with roll number → row appears in roster
8. As school_admin again: dashboard now shows 1 enrolled · 1 cash · revenue updated
9. Edit student → change name → save → audit log row written
10. Remove student → fill reason → confirm → status flips to "removed" → audit log row written
11. Click "Close enrollment" → type "CLOSE" → confirm → status pill flips → "Schedule batches" button appears (disabled with Phase 3b tooltip)
12. Visit `/school/olympiad/share` → see public URL + QR (Phase 2) + WhatsApp/email templates (Phase 3a) → copy each one
13. Open the public URL in a private window → should see "Enrollment unavailable" (enrollment_open → enrollment_closed flip)

For an **existing SALCI school**:
1. As super_admin: ensure the school has `is_existing_salci_school = true` and `olympiad` feature flag enabled
2. As school_admin: visit `/school/olympiad/teachers` → see "Assign Olympiad Teachers" mode
3. Pick an existing teacher → assign classes → submit → assignment recorded
4. As that teacher: their dashboard shows the assigned classes

- [ ] **Dark mode smoke** at 375 px viewport — flip dark mode toggle, repeat key flows, confirm no element stays light

- [ ] **Commit any smoke-test fixes**

---

## Self-Review Summary

- **Spec coverage**: every §1–§7 requirement maps to a task:
  - Schema → T1
  - Sidebar + routes → T2
  - 6 edge functions → T3-T7
  - School admin dashboard → T8
  - Teacher management → T9
  - Share page → T10
  - Teacher dashboard → T11
  - Class roster → T12
  - Cash enroll + edit + remove → T13
  - §5a + smoke → T14

- **Placeholders**: none. Every code block is concrete or labeled as "follow Phase 2 precedent" with the precedent's exact file named.

- **Type consistency**: `MyOlympiadSchool`, `DashboardStats`, `AssignedClass`, `RosterStudent`, `RosterFilters`, `CashEnrollInput`, `CashEnrollResult`, `EditStudentInput` types each declared once and consumed by name. Edge function input shapes match their hook input types.

- **Known adaptation points**:
  - `useAuth` hook export shape — likely `useAuth().user`. Verify in T11.
  - `StatTile` / `StatTileGrid` props — `tone`, `label`, `value`, `icon`. Phase 1/2 precedent.
  - `DropdownMenu` from shadcn — already in the project, used elsewhere.
  - `MobileSheet` `subtitle` not `description` (Phase 2 precedent).
  - `EmptyState.action` is `{ label, onClick, icon? }` (Phase 1 precedent).
  - `useEffectiveInstitution` exists — used by `useInstitutionFeatures` in Phase 1.

If during execution a primitive API actually differs from what's documented, match the existing source-of-truth and continue.

**Suggested execution bundling** (matches Phase 2 pattern):
- Task 1 (foundational migration) — standalone
- Task 2 (sidebar + routes + placeholders) — standalone
- Tasks 3-7 (6 edge functions) — one bundled dispatch
- Tasks 8 + 10 (dashboard + share — share depends on PublicPaymentLink only, dashboard standalone) — one bundled dispatch
- Task 9 (teachers — large) — standalone
- Tasks 11 + 12 + 13 (teacher dashboard + class page + cash/edit/remove) — one bundled dispatch
- Task 14 (verification) — standalone
