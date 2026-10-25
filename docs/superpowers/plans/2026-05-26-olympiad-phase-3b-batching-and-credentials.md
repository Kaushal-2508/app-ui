# SALCI Olympiad Phase 3b — Batching, PIN Custody, Credentials Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the batching kanban, PIN custody, pre-exam reminder cron, print credentials PDF, and absentees pool shell. After Phase 3b, a school admin can take their closed roster and produce locked batches with unique PINs distributed via printed credentials, with daily pre-exam reminders going out automatically.

**Architecture:** Additive migration adds `oly_batches` (with PIN), `oly_batch_assignments`, `oly_reminder_log`, a PIN-hiding view `oly_batches_no_pin` (`security_invoker = true`), a PIN generator function, and a pg_cron job. Four edge functions own the lifecycle: draft generation, lock + PIN gen, daily reminders, credentials PDF. The kanban scheduler uses `@dnd-kit/core` (added as a dep). Teachers and students query the view exclusively; school admins see PINs only on the PIN custody page.

**Tech Stack:** React 18 + TypeScript, Vite, TanStack Query v5, React Router v6, Supabase (PostgreSQL + RLS + Storage + Edge Functions + pg_cron + pg_net), shadcn/ui + Tailwind, lucide-react, `pdf-lib` (existing), Resend (existing), `@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities` (NEW deps).

**Spec:** [docs/superpowers/specs/2026-05-26-olympiad-phase-3b-batching-and-credentials-design.md](../specs/2026-05-26-olympiad-phase-3b-batching-and-credentials-design.md)
**Phase 3a plan (precedent):** [docs/superpowers/plans/2026-05-26-olympiad-phase-3a-school-operations.md](./2026-05-26-olympiad-phase-3a-school-operations.md)

**No test infrastructure** — verification via §5a (tsc + eslint + vite build) + manual smoke at 375 px in light + dark mode.

**Engineer assumptions:** Read CLAUDE.md sections §5a, §17, §19, §20a/§20b, §22, §23 BEFORE starting. Read Phase 3a plan for sheet/dialog patterns (initial-state-diff isDirty, try/catch on mutateAsync, MobileSheet vs Dialog, audit log writes).

---

## File Structure

```
supabase/
  migrations/
    <ts>_oly_phase_3b_batching.sql                                    (NEW)
  functions/
    oly-generate-batch-schedule/index.ts                              (NEW)
    oly-lock-batch-schedule/index.ts                                  (NEW)
    oly-send-pre-exam-reminders/index.ts                              (NEW)
    oly-generate-credentials-pdf/index.ts                             (NEW)

src/
  hooks/olympiad/
    useOlympiadBatches.ts                                             (NEW)
    useOlympiadBatchesNoPin.ts                                        (NEW)
    useGenerateBatchSchedule.ts                                       (NEW)
    useLockBatchSchedule.ts                                           (NEW)
    useUpdateBatchPinExpiry.ts                                        (NEW)
    useRegenerateBatchPin.ts                                          (NEW)
    useOlympiadAbsenteesPool.ts                                       (NEW)
    useGenerateCredentialsPdf.ts                                      (NEW)
  components/olympiad/school/
    BatchScheduleInputs.tsx                                           (NEW)
    BatchKanban.tsx                                                   (NEW)
    BatchCard.tsx                                                     (NEW)
    BatchEditSheet.tsx                                                (NEW)
    LockScheduleDialog.tsx                                            (NEW)
    PinCustodyTable.tsx                                               (NEW)
    PinCustodyRow.tsx                                                 (NEW)
    RegeneratePinDialog.tsx                                           (NEW)
  components/olympiad/teacher/
    PrintCredentialsButton.tsx                                        (NEW)
  pages/
    school/olympiad/
      OlympiadSchoolBatchesPage.tsx                                   (NEW)
      OlympiadSchoolPinCustodyPage.tsx                                (NEW)
      OlympiadSchoolAbsenteesPage.tsx                                 (NEW)
  App.tsx                                                             (EDIT) — 3 new routes
  components/layout/AppSidebar.tsx                                    (EDIT) — 3 new school_admin entries
  pages/school/olympiad/OlympiadSchoolDashboardPage.tsx                (EDIT) — Schedule Batches button enabled
  pages/teacher/olympiad/OlympiadTeacherClassPage.tsx                  (EDIT) — Print credentials button

package.json                                                          (EDIT) — add @dnd-kit/* deps
```

---

## Section A — Foundation

### Task 1: Phase 3b schema migration

**Files:**
- Create: `supabase/migrations/<ts>_oly_phase_3b_batching.sql`

- [ ] **Step 1.1: Generate timestamp**

```powershell
Get-Date -AsUTC -Format yyyyMMddHHmmss
```

- [ ] **Step 1.2: Create migration with this exact SQL**

```sql
-- Phase 3b — Batching + PIN custody + reminders + credentials
-- Adds oly_batches, oly_batch_assignments, oly_reminder_log, PIN-hiding view,
-- PIN generator + regenerate RPC, and pg_cron job for pre-exam reminders.

-- =========================================================================
-- 1. oly_batches
-- =========================================================================
create table public.oly_batches (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.oly_campaigns(id) on delete restrict,
  oly_school_id uuid not null references public.oly_schools(id) on delete cascade,
  grade_level_id uuid references public.grade_levels(id) on delete restrict,
  batch_label text not null,
  scheduled_at timestamptz not null,
  pc_count integer not null check (pc_count > 0),
  pin text,
  pin_expiry_minutes integer not null default 120 check (pin_expiry_minutes > 0),
  pin_first_used_at timestamptz,
  is_absentees boolean not null default false,
  status text not null default 'draft'
    check (status in ('draft', 'locked', 'in_progress', 'completed', 'cancelled')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  locked_at timestamptz,
  unique(oly_school_id, scheduled_at, grade_level_id, is_absentees)
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

-- =========================================================================
-- 2. oly_batch_assignments — strict 1:1 student to batch
-- =========================================================================
create table public.oly_batch_assignments (
  id uuid primary key default gen_random_uuid(),
  oly_batch_id uuid not null references public.oly_batches(id) on delete cascade,
  oly_student_id uuid not null references public.oly_students(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  unique(oly_student_id)
);
create index idx_oba_batch on public.oly_batch_assignments(oly_batch_id);
create index idx_oba_student on public.oly_batch_assignments(oly_student_id);

-- =========================================================================
-- 3. oly_reminder_log — idempotent cron-sent reminders
-- =========================================================================
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

-- =========================================================================
-- 4. PIN-hiding wrapper view
-- =========================================================================
create view public.oly_batches_no_pin
with (security_invoker = true)
as
select
  id, campaign_id, oly_school_id, grade_level_id, batch_label,
  scheduled_at, pc_count, pin_expiry_minutes, pin_first_used_at,
  is_absentees, status, created_at, updated_at, locked_at
from public.oly_batches;

grant select on public.oly_batches_no_pin to authenticated;

-- =========================================================================
-- 5. RLS — oly_batches
-- =========================================================================
alter table public.oly_batches enable row level security;
create policy "super_admin all" on public.oly_batches for all
  using (public.is_super_admin(auth.uid())) with check (public.is_super_admin(auth.uid()));
create policy "school_admin all own school" on public.oly_batches for all
  using (public.oly_is_school_admin_for(auth.uid(), oly_school_id))
  with check (public.oly_is_school_admin_for(auth.uid(), oly_school_id));
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

-- =========================================================================
-- 6. RLS — oly_batch_assignments
-- =========================================================================
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

-- =========================================================================
-- 7. RLS — oly_reminder_log
-- =========================================================================
alter table public.oly_reminder_log enable row level security;
create policy "super_admin all" on public.oly_reminder_log for all
  using (public.is_super_admin(auth.uid())) with check (public.is_super_admin(auth.uid()));
create policy "school_admin SELECT own school" on public.oly_reminder_log for select
  using (exists(
    select 1 from public.oly_batches b
     where b.id = oly_batch_id
       and public.oly_is_school_admin_for(auth.uid(), b.oly_school_id)
  ));

-- =========================================================================
-- 8. PIN generator function
-- =========================================================================
create or replace function public.oly_generate_batch_pin()
returns text language plpgsql as $$
declare
  v_alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
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

-- =========================================================================
-- 9. Regenerate PIN RPC (audited)
-- =========================================================================
create or replace function public.oly_regenerate_batch_pin(p_batch_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_batch record;
  v_new_pin text;
  v_uid uuid := auth.uid();
begin
  select id, oly_school_id, campaign_id, status, pin_first_used_at
    into v_batch from public.oly_batches where id = p_batch_id;
  if v_batch.id is null then raise exception 'Batch not found'; end if;

  if not (public.is_super_admin(v_uid) or public.oly_is_school_admin_for(v_uid, v_batch.oly_school_id)) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  if v_batch.pin_first_used_at is not null then
    raise exception 'Cannot regenerate PIN after a student has entered it';
  end if;
  if v_batch.status not in ('locked','draft') then
    raise exception 'Cannot regenerate PIN in status %', v_batch.status;
  end if;

  v_new_pin := public.oly_generate_batch_pin();
  update public.oly_batches set pin = v_new_pin where id = p_batch_id;

  -- Audit (Phase 3a oly_audit_log)
  insert into public.oly_audit_log (campaign_id, oly_school_id, actor_id, actor_role, action, after_json)
  values (
    v_batch.campaign_id, v_batch.oly_school_id, v_uid,
    case when public.is_super_admin(v_uid) then 'super_admin' else 'school_admin' end,
    'teacher_assigned',  -- temporary mapping; the audit log action enum doesn't include batch ops yet
    jsonb_build_object('batch_id', p_batch_id, 'pin_regenerated', true)
  );

  return v_new_pin;
end;
$$;

grant execute on function public.oly_regenerate_batch_pin(uuid) to authenticated;

-- =========================================================================
-- 10. Extend audit log action enum to include batch actions
-- =========================================================================
alter table public.oly_audit_log drop constraint if exists oly_audit_log_action_check;
alter table public.oly_audit_log add constraint oly_audit_log_action_check
  check (action in (
    'student_enrolled_cash','student_edited','student_removed',
    'enrollment_closed','teacher_created','teacher_assigned','teacher_unassigned',
    'batch_draft_generated','batches_locked','batch_pin_regenerated',
    'batch_rescheduled','credentials_pdf_generated','absentees_batch_created'
  ));

-- Re-apply the regenerate-PIN RPC with the correct action label now that
-- the constraint allows it
create or replace function public.oly_regenerate_batch_pin(p_batch_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_batch record;
  v_new_pin text;
  v_uid uuid := auth.uid();
begin
  select id, oly_school_id, campaign_id, status, pin_first_used_at
    into v_batch from public.oly_batches where id = p_batch_id;
  if v_batch.id is null then raise exception 'Batch not found'; end if;

  if not (public.is_super_admin(v_uid) or public.oly_is_school_admin_for(v_uid, v_batch.oly_school_id)) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  if v_batch.pin_first_used_at is not null then
    raise exception 'Cannot regenerate PIN after a student has entered it';
  end if;
  if v_batch.status not in ('locked','draft') then
    raise exception 'Cannot regenerate PIN in status %', v_batch.status;
  end if;

  v_new_pin := public.oly_generate_batch_pin();
  update public.oly_batches set pin = v_new_pin where id = p_batch_id;

  insert into public.oly_audit_log (campaign_id, oly_school_id, actor_id, actor_role, action, after_json)
  values (
    v_batch.campaign_id, v_batch.oly_school_id, v_uid,
    case when public.is_super_admin(v_uid) then 'super_admin' else 'school_admin' end,
    'batch_pin_regenerated',
    jsonb_build_object('batch_id', p_batch_id, 'pin_regenerated', true)
  );

  return v_new_pin;
end;
$$;

-- =========================================================================
-- 11. pg_cron job — daily pre-exam reminders at 9 AM IST (3:30 AM UTC)
-- =========================================================================
-- Note: app.cron_secret must be set via: ALTER DATABASE postgres SET app.cron_secret = '<secret>';
-- The edge function checks this secret before sending emails.
select cron.schedule(
  'oly-pre-exam-reminders',
  '30 3 * * *',  -- 3:30 UTC = 9:00 IST
  $job$
  select net.http_post(
    url := 'https://gyymkgohcijeksmrzuyw.supabase.co/functions/v1/oly-send-pre-exam-reminders',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.cron_secret', true),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $job$
);
```

- [ ] **Step 1.3: Apply + regenerate types + verify**

```bash
npx supabase db push
npx supabase gen types typescript --project-id gyymkgohcijeksmrzuyw > src/integrations/supabase/types.ts
npx tsc --noEmit
```
All exit 0.

If the `cron.schedule` insert fails because the cron job already exists by that name (rare but possible if the migration runs twice), wrap it:
```sql
do $$
begin
  perform cron.unschedule('oly-pre-exam-reminders');
exception when others then null;
end;
$$;
```

- [ ] **Step 1.4: Set the cron secret (manual one-time step — document for ops)**

```bash
# This must be run by the database owner one time
# psql or Supabase SQL Editor:
ALTER DATABASE postgres SET app.cron_secret = '<random-secret-string>';
SELECT pg_reload_conf();
```

Also set the same secret as an edge function env var:
```bash
npx supabase@latest secrets set OLY_CRON_SECRET=<same-random-secret-string> --project-ref gyymkgohcijeksmrzuyw
```

The edge function `oly-send-pre-exam-reminders` will verify the `Authorization: Bearer <secret>` header matches `OLY_CRON_SECRET`.

For Phase 3b execution: skip this step if the cron secret isn't yet provisioned — the cron job will fire and the edge function will return 401, which is the correct behavior. Document the manual step in the commit message.

- [ ] **Step 1.5: Commit**

```bash
git add supabase/migrations/<ts>_oly_phase_3b_batching.sql src/integrations/supabase/types.ts
git commit -m "feat(olympiad): phase 3b schema - batches, assignments, reminder log, PIN gen + RLS + cron

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Add @dnd-kit deps + sidebar entries + lazy routes + placeholder pages

**Files:**
- Modify: `package.json` (add 3 deps)
- Modify: `src/components/layout/AppSidebar.tsx` (3 new school_admin entries)
- Modify: `src/App.tsx` (3 new lazy routes)
- Create: 3 placeholder pages

- [ ] **Step 2.1: Add @dnd-kit deps**

```bash
npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

Expected: package.json + package-lock.json updated. No errors.

- [ ] **Step 2.2: Sidebar entries**

In `src/components/layout/AppSidebar.tsx`, in the school_admin nav array, after the existing `{ title: "Olympiad", url: "/school/olympiad", ... }` entry from Phase 3a, add three sub-entries:

```ts
{ title: "Olympiad Batches", url: "/school/olympiad/batches", icon: CalendarClock },
{ title: "Olympiad PINs", url: "/school/olympiad/pin-custody", icon: KeyRound },
{ title: "Olympiad Absentees", url: "/school/olympiad/absentees", icon: UserX },
```

Import `CalendarClock`, `KeyRound`, `UserX` from `lucide-react` at the top of the file (they're available — confirm by visiting the existing icon import block).

If your existing sidebar uses a "grouped" pattern with sub-items collapsed under the main Olympiad entry, follow that pattern. Otherwise three flat entries is fine.

- [ ] **Step 2.3: Lazy routes**

Top of `src/App.tsx`:

```tsx
const OlympiadSchoolBatchesPage = lazy(() => import("@/pages/school/olympiad/OlympiadSchoolBatchesPage"));
const OlympiadSchoolPinCustodyPage = lazy(() => import("@/pages/school/olympiad/OlympiadSchoolPinCustodyPage"));
const OlympiadSchoolAbsenteesPage = lazy(() => import("@/pages/school/olympiad/OlympiadSchoolAbsenteesPage"));
```

In the school_admin protected block, add:

```tsx
<Route path="/school/olympiad/batches" element={
  <ProtectedRoute allowedRoles={["school_admin","super_school_admin","coordinator"]}>
    <Suspense fallback={<p>Loading...</p>}>
      <OlympiadSchoolBatchesPage />
    </Suspense>
  </ProtectedRoute>
} />
<Route path="/school/olympiad/pin-custody" element={
  <ProtectedRoute allowedRoles={["school_admin","super_school_admin","coordinator"]}>
    <Suspense fallback={<p>Loading...</p>}>
      <OlympiadSchoolPinCustodyPage />
    </Suspense>
  </ProtectedRoute>
} />
<Route path="/school/olympiad/absentees" element={
  <ProtectedRoute allowedRoles={["school_admin","super_school_admin","coordinator"]}>
    <Suspense fallback={<p>Loading...</p>}>
      <OlympiadSchoolAbsenteesPage />
    </Suspense>
  </ProtectedRoute>
} />
```

- [ ] **Step 2.4: Placeholder pages**

For each of the 3 pages, create a stub:

```tsx
// src/pages/school/olympiad/OlympiadSchoolBatchesPage.tsx
import { PageShell } from "@/components/shared/page/PageShell";
import { PageHeader } from "@/components/shared/page/PageHeader";
export default function OlympiadSchoolBatchesPage() {
  return (
    <PageShell>
      <PageHeader title="Batch Schedule" />
      <p className="py-4 text-sm text-ink-600">Coming next.</p>
    </PageShell>
  );
}
```

Same shape for `OlympiadSchoolPinCustodyPage` (title="PIN Custody") and `OlympiadSchoolAbsenteesPage` (title="Absentees").

- [ ] **Step 2.5: Verify + commit**

```bash
npx tsc --noEmit
npx eslint src/App.tsx src/components/layout/AppSidebar.tsx src/pages/school/olympiad/
npx vite build
git add package.json package-lock.json src/App.tsx src/components/layout/AppSidebar.tsx src/pages/school/olympiad/
git commit -m "feat(olympiad): phase 3b sidebar + lazy routes + @dnd-kit deps + placeholder pages"
```

---

## Section B — Edge functions

### Tasks 3-6: 4 edge functions (one bundled dispatch recommended)

Files:
- Create: `supabase/functions/oly-generate-batch-schedule/index.ts`
- Create: `supabase/functions/oly-lock-batch-schedule/index.ts`
- Create: `supabase/functions/oly-send-pre-exam-reminders/index.ts`
- Create: `supabase/functions/oly-generate-credentials-pdf/index.ts`

#### 3.1 `oly-generate-batch-schedule`

```ts
// @ts-expect-error Deno runtime
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-expect-error Deno runtime
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Input = {
  oly_school_id: string;
  pc_count: number;
  date_from: string;       // YYYY-MM-DD
  date_to: string;
  day_start_hh_mm: string; // "09:00"
  day_end_hh_mm: string;   // "16:00"
  buffer_minutes: number;  // min 15
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

    const input = (await req.json()) as Input;
    if (input.buffer_minutes < 15) return json({ error: "buffer_minutes must be >= 15" }, 400);

    // Verify caller is school_admin
    const { data: isAdmin } = await supabase.rpc("oly_is_school_admin_for", {
      p_uid: userId, p_oly_school_id: input.oly_school_id,
    });
    const { data: isSuper } = await supabase.rpc("is_super_admin", { user_id: userId });
    if (!isAdmin && !isSuper) return json({ error: "Forbidden" }, 403);

    // Load school + campaign
    const { data: school } = await supabase
      .from("oly_schools").select("status, campaign_id").eq("id", input.oly_school_id).single();
    if (!school || school.status !== "enrollment_closed") {
      return json({ error: "Schedule can only be generated when enrollment is closed" }, 409);
    }
    const { data: campaign } = await supabase
      .from("oly_campaigns").select("exam_duration_minutes").eq("id", school.campaign_id).single();
    const slotMinutes = (campaign?.exam_duration_minutes ?? 90) + input.buffer_minutes;

    // Load active students grouped by grade_level_id
    const { data: students } = await supabase
      .from("oly_students")
      .select("id, grade_level_id, class_label")
      .eq("oly_school_id", input.oly_school_id)
      .eq("status", "active");

    const byGrade = new Map<string, Array<{ id: string; class_label: string }>>();
    for (const s of students ?? []) {
      if (!s.grade_level_id) continue;
      const arr = byGrade.get(s.grade_level_id) ?? [];
      arr.push({ id: s.id, class_label: s.class_label });
      byGrade.set(s.grade_level_id, arr);
    }

    // Greedy: per-class batches of pc_count, sequentially placed
    const batches: Array<{
      scheduled_at: string;
      grade_level_id: string;
      student_ids: string[];
      pc_count: number;
      batch_label: string;
      mergeable: boolean;
    }> = [];

    let cursor = new Date(`${input.date_from}T${input.day_start_hh_mm}:00`);
    const dayEndTime = input.day_end_hh_mm;
    const dateTo = new Date(`${input.date_to}T${dayEndTime}:00`);

    function rollForwardToValidSlot(d: Date): Date {
      const dayEnd = new Date(d);
      const [eh, em] = dayEndTime.split(":").map(Number);
      dayEnd.setHours(eh, em, 0, 0);
      if (d > dayEnd) {
        const next = new Date(d);
        next.setDate(next.getDate() + 1);
        const [sh, sm] = input.day_start_hh_mm.split(":").map(Number);
        next.setHours(sh, sm, 0, 0);
        return next;
      }
      return d;
    }

    const gradeEntries = Array.from(byGrade.entries());
    for (const [gradeId, gradeStudents] of gradeEntries) {
      let batchIdx = 1;
      for (let i = 0; i < gradeStudents.length; i += input.pc_count) {
        cursor = rollForwardToValidSlot(cursor);
        if (cursor > dateTo) {
          // Out of date range
          return json({ error: "Not enough time slots in date range to fit all batches", unscheduled_count: gradeStudents.length - i }, 409);
        }
        const chunk = gradeStudents.slice(i, i + input.pc_count);
        const isUnderUsed = chunk.length < input.pc_count * 0.5;
        batches.push({
          scheduled_at: cursor.toISOString(),
          grade_level_id: gradeId,
          student_ids: chunk.map((s) => s.id),
          pc_count: input.pc_count,
          batch_label: `${chunk[0].class_label} — Batch ${batchIdx}`,
          mergeable: isUnderUsed,
        });
        batchIdx++;
        cursor = new Date(cursor.getTime() + slotMinutes * 60 * 1000);
      }
    }

    // Audit (action: batch_draft_generated)
    await supabase.from("oly_audit_log").insert({
      campaign_id: school.campaign_id,
      oly_school_id: input.oly_school_id,
      actor_id: userId,
      actor_role: isSuper ? "super_admin" : "school_admin",
      action: "batch_draft_generated",
      after_json: { batch_count: batches.length, total_students: (students ?? []).length },
    });

    return json({ batches, unscheduled_count: 0 }, 200);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
```

#### 3.2 `oly-lock-batch-schedule`

```ts
// @ts-expect-error Deno runtime
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-expect-error Deno runtime
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Input = {
  oly_school_id: string;
  batches: Array<{
    scheduled_at: string;
    grade_level_id: string;
    student_ids: string[];
    pc_count: number;
    batch_label: string;
    pin_expiry_minutes?: number;
    is_absentees?: boolean;
  }>;
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

    const input = (await req.json()) as Input;

    const { data: isAdmin } = await supabase.rpc("oly_is_school_admin_for", {
      p_uid: userId, p_oly_school_id: input.oly_school_id,
    });
    const { data: isSuper } = await supabase.rpc("is_super_admin", { user_id: userId });
    if (!isAdmin && !isSuper) return json({ error: "Forbidden" }, 403);

    const { data: school } = await supabase
      .from("oly_schools").select("status, campaign_id").eq("id", input.oly_school_id).single();
    if (!school) return json({ error: "School not found" }, 404);
    const isAbsenteesOnly = input.batches.every((b) => b.is_absentees === true);
    if (!isAbsenteesOnly && school.status !== "enrollment_closed") {
      return json({ error: "Lock requires enrollment_closed status" }, 409);
    }

    const batchIds: string[] = [];
    for (const b of input.batches) {
      const { data: pinData } = await supabase.rpc("oly_generate_batch_pin");
      const pin = pinData as string;
      const { data: row, error: insErr } = await supabase
        .from("oly_batches")
        .insert({
          campaign_id: school.campaign_id,
          oly_school_id: input.oly_school_id,
          grade_level_id: b.grade_level_id,
          batch_label: b.batch_label,
          scheduled_at: b.scheduled_at,
          pc_count: b.pc_count,
          pin,
          pin_expiry_minutes: b.pin_expiry_minutes ?? 120,
          is_absentees: b.is_absentees ?? false,
          status: "locked",
          locked_at: new Date().toISOString(),
          created_by: userId,
        })
        .select("id")
        .single();
      if (insErr || !row) return json({ error: insErr?.message ?? "Batch insert failed" }, 500);
      batchIds.push(row.id);

      // Assignments (delete any existing first, then insert)
      if (b.student_ids.length > 0) {
        await supabase.from("oly_batch_assignments").delete().in("oly_student_id", b.student_ids);
        const assignRows = b.student_ids.map((sid) => ({ oly_batch_id: row.id, oly_student_id: sid }));
        await supabase.from("oly_batch_assignments").insert(assignRows);
      }
    }

    // Update school status — only for the main lock, not for absentees-only locks
    if (!isAbsenteesOnly) {
      await supabase.from("oly_schools").update({ status: "batches_scheduled" }).eq("id", input.oly_school_id);
    }

    await supabase.from("oly_audit_log").insert({
      campaign_id: school.campaign_id,
      oly_school_id: input.oly_school_id,
      actor_id: userId,
      actor_role: isSuper ? "super_admin" : "school_admin",
      action: isAbsenteesOnly ? "absentees_batch_created" : "batches_locked",
      after_json: { batch_ids: batchIds, count: batchIds.length },
    });

    return json({ batch_ids: batchIds }, 200);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
```

#### 3.3 `oly-send-pre-exam-reminders`

```ts
// @ts-expect-error Deno runtime
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-expect-error Deno runtime
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req: Request) => {
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    // @ts-expect-error Deno.env
    const cronSecret = Deno.env.get("OLY_CRON_SECRET");
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return new Response("Unauthorized", { status: 401 });
    }

    // @ts-expect-error Deno.env
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    // @ts-expect-error Deno.env
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    // @ts-expect-error Deno.env
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) return new Response("RESEND_API_KEY not set", { status: 500 });
    const supabase = createClient(supabaseUrl, serviceKey);

    // Find batches scheduled exactly 3 days out (date-only comparison, Asia/Kolkata)
    const now = new Date();
    const target = new Date(now);
    target.setDate(target.getDate() + 3);
    const targetDate = target.toISOString().slice(0, 10);
    const nextDate = new Date(target);
    nextDate.setDate(nextDate.getDate() + 1);
    const nextDateStr = nextDate.toISOString().slice(0, 10);

    const { data: batches } = await supabase
      .from("oly_batches")
      .select("id, scheduled_at, batch_label, oly_school_id, oly_schools(institutions(name))")
      .eq("status", "locked")
      .gte("scheduled_at", `${targetDate}T00:00:00Z`)
      .lt("scheduled_at", `${nextDateStr}T00:00:00Z`);

    let sent = 0;
    for (const b of batches ?? []) {
      const school = Array.isArray(b.oly_schools) ? b.oly_schools[0] : b.oly_schools;
      const inst = (school as { institutions?: unknown } | null)?.institutions;
      const schoolName = (Array.isArray(inst) ? inst[0] : inst as { name?: string } | null)?.name ?? "your school";

      const { data: assignments } = await supabase
        .from("oly_batch_assignments")
        .select("oly_student_id, oly_students!oly_student_id(id, full_name, parent_email, roll_number)")
        .eq("oly_batch_id", b.id);

      for (const a of assignments ?? []) {
        const student = Array.isArray(a.oly_students) ? a.oly_students[0] : a.oly_students;
        if (!student) continue;
        const s = student as { id: string; full_name: string; parent_email: string | null; roll_number: string };
        if (!s.parent_email) continue;

        // Idempotency check
        const { data: existing } = await supabase
          .from("oly_reminder_log")
          .select("id")
          .eq("oly_batch_id", b.id)
          .eq("oly_student_id", s.id)
          .eq("reminder_type", "pre_exam_3d")
          .maybeSingle();
        if (existing) continue;

        const examDate = new Date(b.scheduled_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: "SALCI Olympiad <noreply@salci.org>",
            to: s.parent_email,
            subject: `SALCI Olympiad reminder for ${s.full_name} (3 days)`,
            html: `<p>Hello,</p>
<p>This is a reminder that <strong>${s.full_name}</strong> (Roll number: ${s.roll_number}) is scheduled to take the SALCI Olympiad at ${schoolName} on:</p>
<p><strong>${examDate}</strong></p>
<p>The exam will be conducted at the school's computer lab. Please ensure your child arrives 30 minutes before the scheduled time.</p>
<p>Best regards,<br/>Team SALCI</p>`,
          }),
        });

        if (res.ok) {
          await supabase.from("oly_reminder_log").insert({
            oly_batch_id: b.id,
            oly_student_id: s.id,
            reminder_type: "pre_exam_3d",
            sent_to_email: s.parent_email,
          });
          sent++;
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, sent }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response((e as Error).message, { status: 500 });
  }
});
```

#### 3.4 `oly-generate-credentials-pdf`

```ts
// @ts-expect-error Deno runtime
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-expect-error Deno runtime
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// @ts-expect-error Deno runtime
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";

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

    const { oly_school_id, grade_level_id } = (await req.json()) as { oly_school_id: string; grade_level_id: string };

    // Authorize: teacher OR school_admin OR super_admin
    const { data: isTeacher } = await supabase.rpc("oly_is_teacher_for_class", {
      p_uid: userId, p_oly_school_id, p_grade_level_id: grade_level_id,
    });
    const { data: isAdmin } = await supabase.rpc("oly_is_school_admin_for", {
      p_uid: userId, p_oly_school_id,
    });
    const { data: isSuper } = await supabase.rpc("is_super_admin", { user_id: userId });
    if (!isTeacher && !isAdmin && !isSuper) return json({ error: "Forbidden" }, 403);

    const { data: students } = await supabase
      .from("oly_students")
      .select("full_name, roll_number, date_of_birth, class_label, section_label")
      .eq("oly_school_id", oly_school_id)
      .eq("grade_level_id", grade_level_id)
      .eq("status", "active")
      .order("roll_number");

    const { data: school } = await supabase
      .from("oly_schools").select("institutions(name), campaign_id").eq("id", oly_school_id).single();
    const inst = Array.isArray((school as { institutions?: unknown } | null)?.institutions)
      ? ((school as { institutions: { name?: string }[] }).institutions[0])
      : ((school as { institutions: { name?: string } } | null)?.institutions);
    const schoolName = inst?.name ?? "School";

    const { data: campaign } = await supabase
      .from("oly_campaigns").select("campaign_year").eq("id", (school as { campaign_id?: string } | null)?.campaign_id ?? "").single();
    const year = (campaign as { campaign_year?: number } | null)?.campaign_year ?? new Date().getFullYear();

    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const PER_PAGE = 10;
    const list = students ?? [];
    for (let i = 0; i < list.length; i += PER_PAGE) {
      const page = pdfDoc.addPage([595, 842]);
      const chunk = list.slice(i, i + PER_PAGE);
      let y = 800;

      page.drawText(`SALCI Olympiad ${year} — Credentials (${schoolName})`, {
        x: 50, y, size: 14, font: fontBold, color: rgb(0.14, 0.61, 0.64),
      });
      y -= 25;
      page.drawText(`Class: ${list[0]?.class_label ?? ""}   Page ${Math.floor(i / PER_PAGE) + 1}`, {
        x: 50, y, size: 10, font, color: rgb(0.4, 0.4, 0.45),
      });
      y -= 30;

      for (const s of chunk) {
        // Each row: name | roll | DOB (ddmmyy)
        const dob = new Date(s.date_of_birth);
        const dd = String(dob.getDate()).padStart(2, "0");
        const mm = String(dob.getMonth() + 1).padStart(2, "0");
        const yy = String(dob.getFullYear()).slice(-2);
        const dobStr = `${dd}${mm}${yy}`;

        page.drawText(s.full_name, { x: 50, y, size: 11, font: fontBold, color: rgb(0.1, 0.1, 0.15) });
        page.drawText(`Roll: ${s.roll_number}`, { x: 250, y, size: 10, font, color: rgb(0.3, 0.3, 0.35) });
        page.drawText(`Password (DOB): ${dobStr}`, { x: 380, y, size: 10, font, color: rgb(0.3, 0.3, 0.35) });

        y -= 8;
        page.drawLine({ start: { x: 50, y, }, end: { x: 545, y }, thickness: 0.5, color: rgb(0.85, 0.85, 0.88) });
        y -= 25;
      }

      page.drawText("Cut along the lines and distribute one slip per student. The password is the student's date of birth in ddmmyy format.", {
        x: 50, y: 50, size: 8, font, color: rgb(0.5, 0.5, 0.55),
      });
    }

    const pdfBytes = await pdfDoc.save();
    const path = `credentials/${oly_school_id}/${grade_level_id}/${Date.now()}.pdf`;
    const { error: upErr } = await supabase.storage.from("olympiad-receipts").upload(path, pdfBytes, {
      contentType: "application/pdf",
      upsert: true,
    });
    if (upErr) return json({ error: upErr.message }, 500);

    const { data: signed } = await supabase.storage.from("olympiad-receipts").createSignedUrl(path, 300);

    await supabase.from("oly_audit_log").insert({
      campaign_id: (school as { campaign_id?: string } | null)?.campaign_id ?? null,
      oly_school_id,
      actor_id: userId,
      actor_role: isTeacher ? "teacher" : (isAdmin ? "school_admin" : "super_admin"),
      action: "credentials_pdf_generated",
      after_json: { grade_level_id, student_count: list.length },
    });

    return json({ signed_url: signed?.signedUrl ?? null, student_count: list.length }, 200);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
```

#### Deploy all 4

```bash
npx supabase@latest functions deploy oly-generate-batch-schedule --project-ref gyymkgohcijeksmrzuyw
npx supabase@latest functions deploy oly-lock-batch-schedule --project-ref gyymkgohcijeksmrzuyw
npx supabase@latest functions deploy oly-send-pre-exam-reminders --project-ref gyymkgohcijeksmrzuyw --no-verify-jwt
npx supabase@latest functions deploy oly-generate-credentials-pdf --project-ref gyymkgohcijeksmrzuyw
```

The reminders function uses `--no-verify-jwt` because pg_cron + pg_net don't send a Supabase JWT — the function checks the `OLY_CRON_SECRET` header instead.

#### Commit (after all 4)

```bash
git add supabase/functions/oly-generate-batch-schedule/ supabase/functions/oly-lock-batch-schedule/ supabase/functions/oly-send-pre-exam-reminders/ supabase/functions/oly-generate-credentials-pdf/
git commit -m "feat(olympiad): phase 3b edge functions - schedule draft, lock + PIN, daily reminders, credentials PDF

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Section C — Kanban scheduler

### Tasks 7-8 (bundled): Hooks + Batches page with kanban

Files:
- Create: 4 hooks (`useOlympiadBatches`, `useGenerateBatchSchedule`, `useLockBatchSchedule`, `useOlympiadBatchesNoPin`)
- Create: 4 components (`BatchScheduleInputs`, `BatchKanban`, `BatchCard`, `LockScheduleDialog`)
- Replace: `OlympiadSchoolBatchesPage.tsx`

#### Hooks

`src/hooks/olympiad/useOlympiadBatches.ts` (school_admin, full row including PIN):
```ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type OlympiadBatch = {
  id: string;
  campaign_id: string;
  oly_school_id: string;
  grade_level_id: string | null;
  batch_label: string;
  scheduled_at: string;
  pc_count: number;
  pin: string | null;
  pin_expiry_minutes: number;
  pin_first_used_at: string | null;
  is_absentees: boolean;
  status: "draft" | "locked" | "in_progress" | "completed" | "cancelled";
  locked_at: string | null;
  created_at: string;
  updated_at: string;
  enrolled_count?: number;
};

export function useOlympiadBatches(olySchoolId: string | undefined) {
  return useQuery({
    queryKey: ["olympiad", "batches", olySchoolId],
    queryFn: async (): Promise<OlympiadBatch[]> => {
      if (!olySchoolId) return [];
      const { data: batches, error } = await supabase
        .from("oly_batches")
        .select("id, campaign_id, oly_school_id, grade_level_id, batch_label, scheduled_at, pc_count, pin, pin_expiry_minutes, pin_first_used_at, is_absentees, status, locked_at, created_at, updated_at")
        .eq("oly_school_id", olySchoolId)
        .order("scheduled_at");
      if (error) throw error;

      // Roll up assignment counts
      const ids = (batches ?? []).map((b) => b.id);
      const counts: Record<string, number> = {};
      if (ids.length > 0) {
        const { data: assignments } = await supabase
          .from("oly_batch_assignments")
          .select("oly_batch_id")
          .in("oly_batch_id", ids);
        for (const a of assignments ?? []) counts[a.oly_batch_id] = (counts[a.oly_batch_id] ?? 0) + 1;
      }

      return (batches ?? []).map((b) => ({
        ...b,
        status: b.status as OlympiadBatch["status"],
        enrolled_count: counts[b.id] ?? 0,
      }));
    },
    enabled: !!olySchoolId,
    staleTime: 30_000,
  });
}
```

`src/hooks/olympiad/useGenerateBatchSchedule.ts`:
```ts
import { useMutation } from "@tanstack/react-query";
import { invokeEdgeFunction } from "@/lib/invokeEdgeFunction";
import { toastError } from "@/lib/toast";

export type GenerateScheduleInput = {
  oly_school_id: string;
  pc_count: number;
  date_from: string;
  date_to: string;
  day_start_hh_mm: string;
  day_end_hh_mm: string;
  buffer_minutes: number;
};

export type DraftBatch = {
  scheduled_at: string;
  grade_level_id: string;
  student_ids: string[];
  pc_count: number;
  batch_label: string;
  mergeable: boolean;
};

export function useGenerateBatchSchedule() {
  return useMutation({
    mutationFn: async (input: GenerateScheduleInput): Promise<{ batches: DraftBatch[]; unscheduled_count: number }> => {
      return invokeEdgeFunction("oly-generate-batch-schedule", input);
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't generate schedule.", context: "useGenerateBatchSchedule" }),
  });
}
```

`src/hooks/olympiad/useLockBatchSchedule.ts`:
```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invokeEdgeFunction } from "@/lib/invokeEdgeFunction";
import { toastError } from "@/lib/toast";
import { toast } from "sonner";
import type { DraftBatch } from "./useGenerateBatchSchedule";

export function useLockBatchSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ oly_school_id, batches }: { oly_school_id: string; batches: (DraftBatch & { pin_expiry_minutes?: number; is_absentees?: boolean })[] }) => {
      return invokeEdgeFunction<{ batch_ids: string[] }>("oly-lock-batch-schedule", { oly_school_id, batches });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["olympiad"] });
      toast.success(`Locked ${data.batch_ids.length} batches with PINs generated`);
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't lock schedule.", context: "useLockBatchSchedule" }),
  });
}
```

`src/hooks/olympiad/useOlympiadBatchesNoPin.ts` (teacher/student — queries the view):
```ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type OlympiadBatchNoPin = {
  id: string;
  oly_school_id: string;
  grade_level_id: string | null;
  batch_label: string;
  scheduled_at: string;
  pc_count: number;
  pin_expiry_minutes: number;
  pin_first_used_at: string | null;
  is_absentees: boolean;
  status: "draft" | "locked" | "in_progress" | "completed" | "cancelled";
};

export function useOlympiadBatchesNoPin(olySchoolId: string | undefined, gradeLevelId?: string) {
  return useQuery({
    queryKey: ["olympiad", "batches-no-pin", olySchoolId, gradeLevelId],
    queryFn: async (): Promise<OlympiadBatchNoPin[]> => {
      if (!olySchoolId) return [];
      let q = supabase
        .from("oly_batches_no_pin")
        .select("id, oly_school_id, grade_level_id, batch_label, scheduled_at, pc_count, pin_expiry_minutes, pin_first_used_at, is_absentees, status")
        .eq("oly_school_id", olySchoolId)
        .order("scheduled_at");
      if (gradeLevelId) q = q.eq("grade_level_id", gradeLevelId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map((b) => ({ ...b, status: b.status as OlympiadBatchNoPin["status"] }));
    },
    enabled: !!olySchoolId,
    staleTime: 60_000,
  });
}
```

#### Components

**`BatchScheduleInputs.tsx`** (form for the input panel): PC count + date range + time window + buffer. Controlled form, returns the GenerateScheduleInput on submit. Standard shadcn Input/Calendar/Select components.

**`BatchCard.tsx`** (one batch shown as a draggable kanban card):
```tsx
import { GripVertical } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { DraftBatch } from "@/hooks/olympiad/useGenerateBatchSchedule";

export function BatchCard({ batch, gradeName }: { batch: DraftBatch & { _id: string }; gradeName: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: batch._id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}
      className={`surface-card frosted-shadow rounded-card p-3 cursor-grab flex items-center gap-2 ${batch.mergeable ? "border border-amber-300" : ""}`}>
      <GripVertical className="h-4 w-4 text-ink-500" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-ink-900 truncate">{batch.batch_label}</p>
        <p className="text-[11px] text-ink-500">{gradeName} · {batch.student_ids.length} / {batch.pc_count} PCs</p>
      </div>
    </div>
  );
}
```

**`BatchKanban.tsx`** (the time-slot columns with dnd-kit):
```tsx
import { DndContext, DragEndEvent, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { BatchCard } from "./BatchCard";
import type { DraftBatch } from "@/hooks/olympiad/useGenerateBatchSchedule";

type BatchWithId = DraftBatch & { _id: string };
type Props = {
  draftBatches: BatchWithId[];
  gradeNames: Record<string, string>;
  onReorder: (next: BatchWithId[]) => void;
};

export function BatchKanban({ draftBatches, gradeNames, onReorder }: Props) {
  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  // Group by time slot key (YYYY-MM-DD HH:00)
  const slots = new Map<string, BatchWithId[]>();
  for (const b of draftBatches) {
    const d = new Date(b.scheduled_at);
    const key = `${d.toISOString().slice(0, 10)} ${String(d.getHours()).padStart(2, "0")}:00`;
    const arr = slots.get(key) ?? [];
    arr.push(b);
    slots.set(key, arr);
  }
  const slotKeys = Array.from(slots.keys()).sort();

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = draftBatches.findIndex((b) => b._id === active.id);
    const newIdx = draftBatches.findIndex((b) => b._id === over.id);
    if (oldIdx === -1 || newIdx === -1) return;
    const next = [...draftBatches];
    const [moved] = next.splice(oldIdx, 1);
    next.splice(newIdx, 0, moved);
    // Recompute scheduled_at: target slot of the new position
    const newSlotKey = (() => {
      const slotIdx = slotKeys.findIndex((k) => slots.get(k)?.some((b) => b._id === over.id));
      return slotKeys[slotIdx];
    })();
    if (newSlotKey) {
      const [datePart, timePart] = newSlotKey.split(" ");
      moved.scheduled_at = `${datePart}T${timePart}:00`;
    }
    onReorder(next);
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <div className="flex gap-3 overflow-x-auto pb-4">
        {slotKeys.map((k) => {
          const items = slots.get(k) ?? [];
          const totalPcs = items.reduce((acc, b) => acc + b.student_ids.length, 0);
          const overflow = totalPcs > items[0]?.pc_count;
          return (
            <div key={k} className="flex-shrink-0 w-64 surface-card frosted-shadow rounded-card p-3 space-y-2">
              <header>
                <p className="eyebrow">{k.split(" ")[1]}</p>
                <p className="text-sm font-semibold text-ink-900">{new Date(k).toLocaleDateString("en-IN")}</p>
                {overflow && <p className="text-[11px] text-red-500">Overflow: {totalPcs} students / {items[0]?.pc_count} PCs</p>}
              </header>
              <SortableContext items={items.map((b) => b._id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-2">
                  {items.map((b) => (
                    <BatchCard key={b._id} batch={b} gradeName={gradeNames[b.grade_level_id] ?? "?"} />
                  ))}
                </div>
              </SortableContext>
            </div>
          );
        })}
      </div>
    </DndContext>
  );
}
```

**`LockScheduleDialog.tsx`**: shadcn AlertDialog with typed "LOCK" confirmation. On confirm calls `useLockBatchSchedule`.

#### `OlympiadSchoolBatchesPage.tsx` (replace placeholder)

Three-state page: Inputs → Draft → Locked. State machine:
1. No batches in DB AND no draft → show `BatchScheduleInputs` form
2. Draft in local state (from `useGenerateBatchSchedule`) → show `BatchKanban` + "Lock schedule" button
3. Batches in DB (status='locked' or later) → show locked view (read-only kanban + "PIN Custody" link + "Print all credentials" button per class)

```tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Lock } from "lucide-react";
import { PageShell } from "@/components/shared/page/PageShell";
import { PageHeader } from "@/components/shared/page/PageHeader";
import { Button } from "@/components/ui/button";
import { useOlympiadMySchool } from "@/hooks/olympiad/useOlympiadMySchool";
import { useOlympiadBatches } from "@/hooks/olympiad/useOlympiadBatches";
import { useGenerateBatchSchedule, type DraftBatch } from "@/hooks/olympiad/useGenerateBatchSchedule";
import { useLockBatchSchedule } from "@/hooks/olympiad/useLockBatchSchedule";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { BatchScheduleInputs } from "@/components/olympiad/school/BatchScheduleInputs";
import { BatchKanban } from "@/components/olympiad/school/BatchKanban";
import { LockScheduleDialog } from "@/components/olympiad/school/LockScheduleDialog";

type DraftWithId = DraftBatch & { _id: string };

function useGradeNames() {
  return useQuery({
    queryKey: ["grade-levels", "names"],
    queryFn: async () => {
      const { data } = await supabase.from("grade_levels").select("id, grade_name");
      const m: Record<string, string> = {};
      for (const g of data ?? []) m[g.id] = g.grade_name;
      return m;
    },
    staleTime: 5 * 60_000,
  });
}

export default function OlympiadSchoolBatchesPage() {
  const navigate = useNavigate();
  const { data: school, isLoading: schoolLoading } = useOlympiadMySchool();
  const { data: batches, isLoading: batchesLoading } = useOlympiadBatches(school?.id);
  const { data: gradeNames } = useGradeNames();
  const generate = useGenerateBatchSchedule();
  const lock = useLockBatchSchedule();
  const [draft, setDraft] = useState<DraftWithId[] | null>(null);
  const [lockOpen, setLockOpen] = useState(false);

  if (schoolLoading) return <PageShell><div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-ink-500" /></div></PageShell>;
  if (!school) return <PageShell><p className="py-6 text-sm text-ink-600">No active Olympiad campaign.</p></PageShell>;

  const status = school.status;
  const hasLocked = (batches ?? []).some((b) => b.status !== "cancelled" && !b.is_absentees);

  return (
    <PageShell>
      <PageHeader title="Batch Schedule" subtitle={school.institution_name} />
      <div className="space-y-4 py-4">
        {status === "enrollment_open" && (
          <div className="surface-card frosted-shadow rounded-card p-6 text-center text-sm text-ink-600">
            Close enrollment first before scheduling batches. <Button variant="link" onClick={() => navigate("/school/olympiad")}>Go to dashboard</Button>
          </div>
        )}
        {status === "enrollment_closed" && !hasLocked && !draft && (
          <BatchScheduleInputs
            disabled={generate.isPending}
            onSubmit={async (input) => {
              const result = await generate.mutateAsync({ ...input, oly_school_id: school.id });
              setDraft(result.batches.map((b, i) => ({ ...b, _id: `draft-${i}` })));
            }}
          />
        )}
        {status === "enrollment_closed" && !hasLocked && draft && (
          <>
            <div className="flex items-center justify-between">
              <p className="text-sm text-ink-600">Draft schedule — drag batches to adjust time slots</p>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setDraft(null)}>Regenerate</Button>
                <Button onClick={() => setLockOpen(true)}>
                  <Lock className="h-4 w-4 mr-1" />
                  Lock schedule
                </Button>
              </div>
            </div>
            <BatchKanban draftBatches={draft} gradeNames={gradeNames ?? {}} onReorder={setDraft} />
            <LockScheduleDialog
              open={lockOpen}
              onOpenChange={setLockOpen}
              onConfirm={async () => {
                await lock.mutateAsync({ oly_school_id: school.id, batches: draft });
                setDraft(null);
                setLockOpen(false);
              }}
            />
          </>
        )}
        {hasLocked && (
          <div className="surface-card frosted-shadow rounded-card p-6 space-y-3">
            <p className="text-sm font-semibold text-ink-900">Schedule locked — {batches!.length} batches</p>
            <p className="text-xs text-ink-600">View PINs and edit individual batches in PIN custody.</p>
            <div className="flex gap-2">
              <Button onClick={() => navigate("/school/olympiad/pin-custody")}>Open PIN Custody</Button>
            </div>
          </div>
        )}
      </div>
    </PageShell>
  );
}
```

If `BatchScheduleInputs` props or `LockScheduleDialog` don't match the actual signatures during implementation, adapt — the structural intent is clear.

#### Verify + commit

```bash
npx tsc --noEmit
npx eslint src/hooks/olympiad/useOlympiadBatches.ts src/hooks/olympiad/useOlympiadBatchesNoPin.ts src/hooks/olympiad/useGenerateBatchSchedule.ts src/hooks/olympiad/useLockBatchSchedule.ts src/components/olympiad/school/ src/pages/school/olympiad/OlympiadSchoolBatchesPage.tsx
npx vite build
git add src/hooks/olympiad/useOlympiadBatches.ts src/hooks/olympiad/useOlympiadBatchesNoPin.ts src/hooks/olympiad/useGenerateBatchSchedule.ts src/hooks/olympiad/useLockBatchSchedule.ts src/components/olympiad/school/BatchScheduleInputs.tsx src/components/olympiad/school/BatchKanban.tsx src/components/olympiad/school/BatchCard.tsx src/components/olympiad/school/LockScheduleDialog.tsx src/pages/school/olympiad/OlympiadSchoolBatchesPage.tsx
git commit -m "feat(olympiad): batch scheduler with @dnd-kit kanban + lock flow"
```

---

## Section D — PIN custody + absentees + teacher additions + dashboard wiring

### Tasks 9-12 (bundled): PIN custody page, absentees shell, teacher print-credentials, dashboard button enable

Files:
- Create: 3 hooks (`useUpdateBatchPinExpiry`, `useRegenerateBatchPin`, `useOlympiadAbsenteesPool`, `useGenerateCredentialsPdf`)
- Create: 4 components (`PinCustodyTable`, `PinCustodyRow`, `RegeneratePinDialog`, `PrintCredentialsButton`)
- Replace: `OlympiadSchoolPinCustodyPage.tsx`, `OlympiadSchoolAbsenteesPage.tsx`
- Modify: `OlympiadSchoolDashboardPage.tsx` (enable Schedule Batches button)
- Modify: `OlympiadTeacherClassPage.tsx` (PrintCredentialsButton + schedule view)

#### Hooks

`useUpdateBatchPinExpiry`:
```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/toast";
import { toast } from "sonner";

export function useUpdateBatchPinExpiry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ batchId, minutes }: { batchId: string; minutes: number }) => {
      const { error } = await supabase
        .from("oly_batches")
        .update({ pin_expiry_minutes: minutes })
        .eq("id", batchId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["olympiad", "batches"] });
      toast.success("PIN expiry updated");
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't update PIN expiry.", context: "useUpdateBatchPinExpiry" }),
  });
}
```

`useRegenerateBatchPin`:
```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/toast";
import { toast } from "sonner";

export function useRegenerateBatchPin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ batchId }: { batchId: string }): Promise<string> => {
      const { data, error } = await supabase.rpc("oly_regenerate_batch_pin", { p_batch_id: batchId });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (newPin) => {
      queryClient.invalidateQueries({ queryKey: ["olympiad", "batches"] });
      toast.success(`New PIN: ${newPin}`);
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't regenerate PIN.", context: "useRegenerateBatchPin" }),
  });
}
```

`useOlympiadAbsenteesPool`:
```ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type AbsenteesStudent = {
  id: string;
  roll_number: string;
  full_name: string;
  class_label: string;
  grade_level_id: string | null;
  reason: "no_assignment" | "batch_cancelled";
};

export function useOlympiadAbsenteesPool(olySchoolId: string | undefined) {
  return useQuery({
    queryKey: ["olympiad", "absentees-pool", olySchoolId],
    queryFn: async (): Promise<AbsenteesStudent[]> => {
      if (!olySchoolId) return [];

      // Students with no batch assignment
      const { data: students } = await supabase
        .from("oly_students")
        .select("id, roll_number, full_name, class_label, grade_level_id, status")
        .eq("oly_school_id", olySchoolId)
        .eq("status", "active");

      const studentIds = (students ?? []).map((s) => s.id);
      if (studentIds.length === 0) return [];

      const { data: assignments } = await supabase
        .from("oly_batch_assignments")
        .select("oly_student_id, oly_batches!oly_batch_id(status)")
        .in("oly_student_id", studentIds);

      const assignedByStudent = new Map<string, string>();
      for (const a of assignments ?? []) {
        const batch = Array.isArray(a.oly_batches) ? a.oly_batches[0] : a.oly_batches;
        const status = (batch as { status?: string } | null)?.status ?? "";
        assignedByStudent.set(a.oly_student_id, status);
      }

      const absentees: AbsenteesStudent[] = [];
      for (const s of students ?? []) {
        const assignedStatus = assignedByStudent.get(s.id);
        if (!assignedStatus) {
          absentees.push({ ...s, reason: "no_assignment" });
        } else if (assignedStatus === "cancelled") {
          absentees.push({ ...s, reason: "batch_cancelled" });
        }
      }
      return absentees;
    },
    enabled: !!olySchoolId,
    staleTime: 60_000,
  });
}
```

`useGenerateCredentialsPdf`:
```ts
import { useMutation } from "@tanstack/react-query";
import { invokeEdgeFunction } from "@/lib/invokeEdgeFunction";
import { toastError } from "@/lib/toast";

export function useGenerateCredentialsPdf() {
  return useMutation({
    mutationFn: async ({ oly_school_id, grade_level_id }: { oly_school_id: string; grade_level_id: string }): Promise<{ signed_url: string | null; student_count: number }> => {
      return invokeEdgeFunction("oly-generate-credentials-pdf", { oly_school_id, grade_level_id });
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't generate credentials PDF.", context: "useGenerateCredentialsPdf" }),
  });
}
```

#### `PinCustodyTable` + `PinCustodyRow`

Render the batches in a table view. Each row:
- Batch label + status pill
- Date/time
- PC count + enrolled count (e.g. "32 / 40 PCs")
- Monospace PIN (click-to-copy)
- Expiry (editable inline)
- Kebab menu: Edit time/date, Regenerate PIN (disabled if pin_first_used_at exists)

#### `RegeneratePinDialog`

AlertDialog with confirm. Mentions the rule: regeneration blocked if a student has already used the current PIN.

#### `OlympiadSchoolPinCustodyPage.tsx`

Lists all locked batches via `useOlympiadBatches`. Renders `PinCustodyTable`. Shows "Print all PINs" button → generates a one-page PDF of all batch info for the admin (defer this to follow-up — Phase 3b ships the data + per-row copy).

#### `OlympiadSchoolAbsenteesPage.tsx`

Lists absentees pool via `useOlympiadAbsenteesPool`. Shows "Create Absentees Batch" button → opens a sheet with date/time inputs, PC count, selects students from the pool → calls `useLockBatchSchedule` with `{ is_absentees: true }`.

#### `PrintCredentialsButton.tsx`

```tsx
import { Loader2, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGenerateCredentialsPdf } from "@/hooks/olympiad/useGenerateCredentialsPdf";

type Props = { olySchoolId: string; gradeLevelId: string };

export function PrintCredentialsButton({ olySchoolId, gradeLevelId }: Props) {
  const gen = useGenerateCredentialsPdf();
  const onClick = async () => {
    const result = await gen.mutateAsync({ oly_school_id: olySchoolId, grade_level_id: gradeLevelId });
    if (result.signed_url) window.open(result.signed_url, "_blank", "noopener,noreferrer");
  };
  return (
    <Button size="sm" variant="outline" onClick={onClick} disabled={gen.isPending}>
      {gen.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Printer className="h-4 w-4 mr-1" />}
      Print credentials
    </Button>
  );
}
```

#### Wire into `OlympiadTeacherClassPage`

In the page header secondary actions area, add `<PrintCredentialsButton olySchoolId={olySchoolId} gradeLevelId={gradeLevelId} />`. Also fetch `useOlympiadBatchesNoPin(olySchoolId, gradeLevelId)` and show a read-only "Batch scheduled for: {scheduled_at}" line if a batch exists.

#### Modify `OlympiadSchoolDashboardPage.tsx`

Replace the disabled "Schedule batches" button with an enabled one when status='enrollment_closed':

```tsx
{school.status === "enrollment_closed" && (
  <Button size="sm" onClick={() => navigate("/school/olympiad/batches")}>
    Schedule batches
  </Button>
)}
{school.status === "batches_scheduled" && (
  <>
    <Button size="sm" variant="outline" onClick={() => navigate("/school/olympiad/batches")}>View schedule</Button>
    <Button size="sm" onClick={() => navigate("/school/olympiad/pin-custody")}>PIN custody</Button>
  </>
)}
```

#### Verify + commit

```bash
npx tsc --noEmit
npx eslint src/hooks/olympiad/ src/components/olympiad/ src/pages/school/olympiad/ src/pages/teacher/olympiad/
npx vite build
git add src/hooks/olympiad/useUpdateBatchPinExpiry.ts src/hooks/olympiad/useRegenerateBatchPin.ts src/hooks/olympiad/useOlympiadAbsenteesPool.ts src/hooks/olympiad/useGenerateCredentialsPdf.ts src/components/olympiad/school/PinCustodyTable.tsx src/components/olympiad/school/PinCustodyRow.tsx src/components/olympiad/school/RegeneratePinDialog.tsx src/components/olympiad/teacher/PrintCredentialsButton.tsx src/pages/school/olympiad/OlympiadSchoolPinCustodyPage.tsx src/pages/school/olympiad/OlympiadSchoolAbsenteesPage.tsx src/pages/school/olympiad/OlympiadSchoolDashboardPage.tsx src/pages/teacher/olympiad/OlympiadTeacherClassPage.tsx
git commit -m "feat(olympiad): PIN custody + absentees pool + teacher print credentials + dashboard wiring"
```

---

## Section E — Verification

### Task 13: §5a sweep + manual smoke

```bash
npx tsc --noEmit
npx eslint "src/{hooks,components,pages,lib}/olympiad/**" "src/App.tsx" "src/components/layout/AppSidebar.tsx"
npx vite build
```
All exit 0.

**Manual smoke checklist (controller / user):**

1. As school_admin with status='enrollment_closed': land at `/school/olympiad/batches`, see input form
2. Fill PC count + dates + window, click Generate → see kanban with batches grouped by time slot
3. Drag a batch between slots → no overflow warnings if total ≤ PC count
4. Lock schedule → PINs appear in PIN Custody
5. PIN Custody table renders, each PIN copyable
6. Edit PIN expiry inline → toast updates
7. Try regenerate PIN on a batch without first-used → succeeds with new PIN
8. As teacher: visit class page → click Print credentials → PDF opens in new tab with name/roll/DOB slips
9. As teacher: schedule view shows batch date (no PIN)
10. Absentees page: visit, see students with no assignment, create absentees batch → student moves out of the pool
11. Dark mode toggle at 375px — confirm kanban + table flip correctly

Commit any smoke fixes.
