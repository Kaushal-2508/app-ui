# SALCI Olympiad Phase 2 — School Onboarding + Parent Enrollment + Payment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the channel through which schools join the SALCI Olympiad and parents enroll students: super-admin onboarding form, public payment URL `/olympiad/:schoolCode`, payment gateway adapter (stub + Razorpay test mode), receipt PDF generation, and refund flow.

**Architecture:** Schema additive migration drops `oly_students`, `oly_enrollment_pending`, `oly_receipts`, `oly_refunds` + storage bucket. A small set of public RPCs (`oly_get_public_school_payment_context`, `oly_lookup_salci_student`) backs the parent-facing page so it never touches tables directly. Five edge functions own the payment lifecycle: `oly-onboard-school` (super admin creates institution + admin user + oly_schools row), `oly-payment-create-order` (pending enrollment + gateway order), `oly-payment-webhook` (Razorpay HMAC verification + promotion-trigger fires), `oly-stub-payment-complete` (dev-only stub simulation), `oly-receipt-generate` (PDF via pdf-lib + Resend email), `oly-refund-issue` (gateway refund or offline marker). A `PaymentGatewayAdapter` interface lets stub and Razorpay implementations swap via `OLY_PAYMENT_ADAPTER` env. A DB AFTER UPDATE trigger on `oly_enrollment_pending` promotes pending rows to `oly_students` when status flips to `paid` — the single canonical promotion path.

**Tech Stack:** React 18 + TypeScript, Vite, TanStack Query v5, React Router v6 (with one route OUTSIDE `ProtectedRoute`), Supabase (PostgreSQL + RLS + Storage + Edge Functions), shadcn/ui + Tailwind, lucide-react, `qrcode.react@3.2` (already a dep), `pdf-lib` (existing dep), Resend (existing pattern from `send-welcome-email`), Razorpay (Orders API + Checkout JS + Webhooks).

**Spec:** [docs/superpowers/specs/2026-05-26-olympiad-phase-2-school-onboarding-and-payment-design.md](../specs/2026-05-26-olympiad-phase-2-school-onboarding-and-payment-design.md)
**Master decomposition:** [docs/superpowers/specs/2026-05-26-olympiad-master-decomposition-design.md](../specs/2026-05-26-olympiad-master-decomposition-design.md)
**Phase 1 plan (precedent):** [docs/superpowers/plans/2026-05-26-olympiad-phase-1-super-admin-catalog.md](./2026-05-26-olympiad-phase-1-super-admin-catalog.md)

**No test infrastructure in this repo** (no Vitest/Jest config). Verification gates per CLAUDE.md §5a: `npx tsc --noEmit`, `npx eslint <changed>`, `npx vite build` exit 0. Plus manual smoke at 375 px in light + dark mode per §20b.

**Engineer assumptions:** the engineer knows React + TypeScript but does NOT know SALCI's conventions. Read CLAUDE.md sections §5a (zero-error contract), §6/§19 (error translation via `toastError`), §17 (Service Worker dirty-form contract), §20a/§20b (mobile design system + new-page checklist), §22 (RLS recursion trap — no inline cross-table EXISTS), §23 (high-concurrency rules) BEFORE STARTING. Also read the Phase 1 plan as the pattern reference for hooks/sheets/RPCs.

---

## File Structure

```
supabase/
  migrations/
    <ts>_oly_phase_2_enrollment.sql             (NEW)  — schema + bucket + RLS + roll-number RPC + promotion trigger + public RPCs
  functions/
    oly-onboard-school/index.ts                 (NEW)  — super admin onboards a school
    oly-payment-create-order/index.ts           (NEW)  — public POST: creates pending + gateway order
    oly-payment-webhook/index.ts                (NEW)  — public POST: Razorpay webhook handler
    oly-stub-payment-complete/index.ts          (NEW)  — dev-only stub completion
    oly-receipt-generate/index.ts               (NEW)  — pdf-lib + Resend email
    oly-refund-issue/index.ts                   (NEW)  — gateway refund or offline marker

src/
  lib/olympiad/payment/
    types.ts                                    (NEW)  — PaymentGatewayAdapter interface + Payment* types
    stubAdapter.ts                              (NEW)  — frontend stub
    razorpayAdapter.ts                          (NEW)  — frontend Razorpay (loads Checkout JS lazily)
    index.ts                                    (NEW)  — getPaymentAdapter() factory
  hooks/olympiad/
    useOnboardSchool.ts                         (NEW)  — super admin onboard mutation
    useOlympiadSchools.ts                       (NEW)  — list onboarded schools for super admin
    useOlympiadSchool.ts                        (NEW)  — single school detail + roll-up counts
    useOlympiadEnrollSubmit.ts                  (NEW)  — public form submit + payment handoff
    useOlympiadPaymentStatus.ts                 (NEW)  — polling-based status for success page
    useOlympiadRefund.ts                        (NEW)  — super admin refund mutation
  components/olympiad/
    admin/
      OnboardSchoolSheet.tsx                    (NEW)  — MobileSheet for onboarding form
      SchoolListRow.tsx                         (NEW)  — one onboarded school row
      SchoolDetailHeader.tsx                    (NEW)  — name, status, QR, URL on school detail
      PublicPaymentLink.tsx                     (NEW)  — copyable URL + Download-QR button
      RefundConfirmDialog.tsx                   (NEW)  — AlertDialog for per-student/school-wide refund
    public/
      OlympiadPublicLayout.tsx                  (NEW)  — no-auth layout shell
      EnrollmentFormNonSalci.tsx                (NEW)  — full form
      EnrollmentFormSalci.tsx                   (NEW)  — admission lookup + reduced form
      SubjectPicker.tsx                         (NEW)  — 3-subject checkbox group with counter
      PaymentSuccessPage.tsx                    (NEW)  — polls status + shows roll number
      PaymentMethodHandoff.tsx                  (NEW)  — invokes Razorpay Checkout or stub flow
  pages/
    admin/olympiad/
      OlympiadSchoolsTab.tsx                    (EDIT) — replace empty state with live schools list + onboard button
      OlympiadSchoolDetailPage.tsx              (NEW)  — thin per-school page (QR, URL, students count, refund)
    public/
      OlympiadPublicEnrollmentPage.tsx          (NEW)  — public route entrypoint
      OlympiadPaymentSuccessPage.tsx            (NEW)  — public route success
  App.tsx                                       (EDIT) — register /olympiad/:schoolCode (public) + /admin/olympiad/schools/:olySchoolId (super_admin)
```

Each file has one responsibility. Public pages are isolated under `src/pages/public/` and `src/components/olympiad/public/` so they're easy to find and never accidentally inherit `AppLayout` chrome.

---

## Section A — Foundation (DB + public RPCs)

### Task 1: Phase 2 schema migration

**Files:**
- Create: `supabase/migrations/<ts>_oly_phase_2_enrollment.sql` — replace `<ts>` with `Get-Date -AsUTC -Format yyyyMMddHHmmss` (PowerShell on Windows)

- [ ] **Step 1.1: Generate timestamp**

```powershell
Get-Date -AsUTC -Format yyyyMMddHHmmss
```

- [ ] **Step 1.2: Write the full migration file**

```sql
-- Phase 2 — Olympiad school onboarding + parent enrollment + payment
-- Adds oly_students, oly_enrollment_pending, oly_receipts, oly_refunds tables,
-- olympiad-receipts storage bucket, promotion trigger, roll-number generator,
-- and 2 public RPCs (school payment context + SALCI student lookup).

-- =========================================================================
-- 1. oly_students — fully-enrolled students (post-payment)
-- =========================================================================
create table public.oly_students (
  id uuid primary key default gen_random_uuid(),
  oly_school_id uuid not null references public.oly_schools(id) on delete cascade,
  campaign_id uuid not null references public.oly_campaigns(id) on delete restrict,
  profile_id uuid references public.profiles(id) on delete set null,

  full_name text not null,
  date_of_birth date not null,
  class_label text not null,
  section_label text,
  grade_level_id uuid references public.grade_levels(id) on delete restrict,
  admission_number text,

  roll_number text not null unique,

  subject_ids uuid[] not null check (cardinality(subject_ids) = 3),

  parent_name text not null,
  parent_phone text not null,
  parent_email text,

  status text not null default 'active'
    check (status in ('active', 'dormant', 'archived', 'refunded', 'removed')),
  enrolled_at timestamptz not null default now(),
  enrollment_channel text not null
    check (enrollment_channel in ('parent_online', 'teacher_cash')),

  created_by uuid references public.profiles(id) on delete set null,
  removed_at timestamptz,
  removed_by uuid references public.profiles(id) on delete set null,
  removed_reason text,
  updated_at timestamptz not null default now()
);
create index idx_oly_students_school on public.oly_students(oly_school_id);
create index idx_oly_students_campaign on public.oly_students(campaign_id);
create index idx_oly_students_profile on public.oly_students(profile_id);
create index idx_oly_students_status on public.oly_students(status);
create index idx_oly_students_grade_level on public.oly_students(grade_level_id);
create index idx_oly_students_created_by on public.oly_students(created_by);
create index idx_oly_students_removed_by on public.oly_students(removed_by);

create trigger oly_students_set_updated_at before update on public.oly_students
  for each row execute function public.oly_set_updated_at();

-- =========================================================================
-- 2. oly_enrollment_pending — in-flight payment rows (auto-purged after 1h)
-- =========================================================================
create table public.oly_enrollment_pending (
  id uuid primary key default gen_random_uuid(),
  oly_school_id uuid not null references public.oly_schools(id) on delete cascade,
  campaign_id uuid not null references public.oly_campaigns(id) on delete restrict,

  full_name text not null,
  date_of_birth date not null,
  class_label text not null,
  section_label text,
  grade_level_id uuid references public.grade_levels(id) on delete restrict,
  admission_number text,
  subject_ids uuid[] not null check (cardinality(subject_ids) = 3),
  parent_name text not null,
  parent_phone text not null,
  parent_email text,

  status text not null default 'payment_pending'
    check (status in ('payment_pending', 'paid', 'failed', 'abandoned')),
  gateway_order_id text,
  gateway_payment_id text,
  gateway_signature text,
  failure_reason text,
  amount_paise integer not null check (amount_paise > 0),
  gst_paise integer not null check (gst_paise >= 0),
  total_paise integer not null check (total_paise > 0),

  promoted_student_id uuid references public.oly_students(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_oep_school on public.oly_enrollment_pending(oly_school_id);
create index idx_oep_campaign on public.oly_enrollment_pending(campaign_id);
create index idx_oep_status on public.oly_enrollment_pending(status);
create index idx_oep_gateway_order on public.oly_enrollment_pending(gateway_order_id);
create index idx_oep_grade_level on public.oly_enrollment_pending(grade_level_id);
create index idx_oep_promoted on public.oly_enrollment_pending(promoted_student_id);

create trigger oly_enrollment_pending_set_updated_at before update on public.oly_enrollment_pending
  for each row execute function public.oly_set_updated_at();

-- =========================================================================
-- 3. oly_receipts — generated receipt PDF metadata
-- =========================================================================
create table public.oly_receipts (
  id uuid primary key default gen_random_uuid(),
  oly_student_id uuid not null references public.oly_students(id) on delete cascade,
  receipt_number text not null unique,
  storage_path text not null,
  amount_paise integer not null,
  gst_paise integer not null,
  total_paise integer not null,
  payment_method text not null check (payment_method in ('online', 'cash')),
  gateway_payment_id text,
  gateway_reference text,
  issued_at timestamptz not null default now(),
  emailed_at timestamptz,
  emailed_to text
);
create index idx_oly_receipts_student on public.oly_receipts(oly_student_id);
create index idx_oly_receipts_issued_at on public.oly_receipts(issued_at);

-- =========================================================================
-- 4. oly_refunds — refund audit + state
-- =========================================================================
create table public.oly_refunds (
  id uuid primary key default gen_random_uuid(),
  oly_student_id uuid not null references public.oly_students(id) on delete cascade,
  initiated_by uuid references public.profiles(id) on delete set null,
  reason text not null,
  scope text not null check (scope in ('per_student', 'school_wide')),
  amount_paise integer not null,
  gateway_refund_id text,
  status text not null default 'pending'
    check (status in ('pending', 'completed', 'failed', 'offline')),
  failure_reason text,
  initiated_at timestamptz not null default now(),
  completed_at timestamptz
);
create index idx_oly_refunds_student on public.oly_refunds(oly_student_id);
create index idx_oly_refunds_status on public.oly_refunds(status);
create index idx_oly_refunds_initiated_by on public.oly_refunds(initiated_by);

-- =========================================================================
-- 5. Roll-number generator RPC
-- =========================================================================
create or replace function public.oly_generate_roll_number(
  p_school_short_code text,
  p_class_label text,
  p_campaign_year integer
) returns text language plpgsql security definer set search_path = public as $$
declare
  v_class_int integer;
  v_seq integer;
begin
  v_class_int := nullif(regexp_replace(p_class_label, '\D', '', 'g'), '')::integer;
  if v_class_int is null then
    raise exception 'Could not extract numeric class from %', p_class_label;
  end if;

  select coalesce(max(
    nullif(regexp_replace(split_part(roll_number, '-', 4), '\D', '', 'g'), '')::integer
  ), 0) + 1
    into v_seq
    from public.oly_students s
    join public.oly_schools sc on sc.id = s.oly_school_id
   where sc.school_short_code = upper(p_school_short_code)
     and substring(s.class_label from '\d+') = v_class_int::text;

  return 'SO' || right(p_campaign_year::text, 2)
         || '-' || upper(p_school_short_code)
         || '-' || lpad(v_class_int::text, 2, '0')
         || '-' || lpad(v_seq::text, 4, '0');
end;
$$;

-- =========================================================================
-- 6. Receipt-number generator (per-year sequence)
-- =========================================================================
create or replace function public.oly_next_receipt_number(p_year integer)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_seq_name text := format('oly_receipt_seq_%s', p_year);
  v_seq integer;
begin
  if not exists (select 1 from pg_class where relname = v_seq_name and relkind = 'S') then
    execute format('create sequence %I start 1', v_seq_name);
  end if;
  execute format('select nextval(%L)', v_seq_name) into v_seq;
  return 'RCPT-' || p_year::text || '-' || lpad(v_seq::text, 7, '0');
end;
$$;

-- =========================================================================
-- 7. Promotion trigger — fires when oly_enrollment_pending.status -> 'paid'
-- =========================================================================
create or replace function public.oly_promote_pending_to_student()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_school_short_code text;
  v_campaign_year integer;
  v_new_student_id uuid;
  v_roll_number text;
begin
  if old.status = 'paid' or new.status != 'paid' then
    return new;  -- only fire on first flip to paid
  end if;
  if new.promoted_student_id is not null then
    return new;  -- already promoted
  end if;

  select sc.school_short_code, c.campaign_year
    into v_school_short_code, v_campaign_year
    from public.oly_schools sc
    join public.oly_campaigns c on c.id = sc.campaign_id
   where sc.id = new.oly_school_id;

  v_roll_number := public.oly_generate_roll_number(
    v_school_short_code, new.class_label, v_campaign_year
  );

  insert into public.oly_students (
    oly_school_id, campaign_id,
    full_name, date_of_birth, class_label, section_label, grade_level_id, admission_number,
    roll_number, subject_ids,
    parent_name, parent_phone, parent_email,
    status, enrollment_channel
  ) values (
    new.oly_school_id, new.campaign_id,
    new.full_name, new.date_of_birth, new.class_label, new.section_label, new.grade_level_id, new.admission_number,
    v_roll_number, new.subject_ids,
    new.parent_name, new.parent_phone, new.parent_email,
    'active', 'parent_online'
  )
  returning id into v_new_student_id;

  -- Link back to the pending row
  new.promoted_student_id := v_new_student_id;

  return new;
end;
$$;

create trigger oly_promote_pending_to_student_trg
  before update on public.oly_enrollment_pending
  for each row execute function public.oly_promote_pending_to_student();

-- =========================================================================
-- 8. RLS — super_admin full access on all new tables
-- =========================================================================
alter table public.oly_students enable row level security;
create policy "super_admin all" on public.oly_students for all
  using (public.is_super_admin(auth.uid())) with check (public.is_super_admin(auth.uid()));

alter table public.oly_enrollment_pending enable row level security;
create policy "super_admin all" on public.oly_enrollment_pending for all
  using (public.is_super_admin(auth.uid())) with check (public.is_super_admin(auth.uid()));

alter table public.oly_receipts enable row level security;
create policy "super_admin all" on public.oly_receipts for all
  using (public.is_super_admin(auth.uid())) with check (public.is_super_admin(auth.uid()));

alter table public.oly_refunds enable row level security;
create policy "super_admin all" on public.oly_refunds for all
  using (public.is_super_admin(auth.uid())) with check (public.is_super_admin(auth.uid()));

-- school-admin and student SELECT policies land in Phase 3 (per master spec §3).
-- For Phase 2, the public payment page never hits these tables — only the public RPCs do.

-- =========================================================================
-- 9. Storage bucket for receipts
-- =========================================================================
insert into storage.buckets (id, name, public)
  values ('olympiad-receipts', 'olympiad-receipts', false)
  on conflict (id) do nothing;

create policy "super_admin can manage olympiad-receipts"
  on storage.objects for all
  using (bucket_id = 'olympiad-receipts' and public.is_super_admin(auth.uid()))
  with check (bucket_id = 'olympiad-receipts' and public.is_super_admin(auth.uid()));

-- =========================================================================
-- 10. Public RPC — payment context (school name, classes, subjects, price)
-- =========================================================================
create or replace function public.oly_get_public_school_payment_context(p_school_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_school_id uuid;
  v_school_short_code text;
  v_is_existing boolean;
  v_school_name text;
  v_price_override integer;
  v_grade_level_ids uuid[];
  v_campaign_default_price integer;
  v_campaign_gst numeric;
  v_classes jsonb;
  v_subjects_per_class jsonb;
begin
  select sc.id, sc.school_short_code, sc.is_existing_salci_school, i.name,
         sc.price_override_paise, sc.participating_grade_level_ids,
         c.default_price_paise, c.gst_percent
    into v_school_id, v_school_short_code, v_is_existing, v_school_name,
         v_price_override, v_grade_level_ids,
         v_campaign_default_price, v_campaign_gst
    from public.oly_schools sc
    join public.oly_campaigns c on c.id = sc.campaign_id
    join public.institutions i on i.id = sc.institution_id
   where sc.school_short_code = upper(p_school_code)
     and sc.status = 'enrollment_open'
     and c.status = 'active';

  if v_school_id is null then
    return jsonb_build_object('found', false);
  end if;

  select jsonb_agg(
    jsonb_build_object('id', g.id, 'name', g.grade_name, 'number', g.grade_number)
    order by g.display_order
  )
    from public.grade_levels g
   where g.id = any(v_grade_level_ids)
   into v_classes;

  select jsonb_object_agg(g.id::text,
    coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) order by s.name)
        from public.oly_subjects s
        join public.oly_subject_classes osc on osc.subject_id = s.id
       where osc.grade_level_id = g.id and s.status = 'active'
    ), '[]'::jsonb))
    from public.grade_levels g
   where g.id = any(v_grade_level_ids)
   into v_subjects_per_class;

  return jsonb_build_object(
    'found', true,
    'school_name', v_school_name,
    'school_short_code', v_school_short_code,
    'is_existing_salci_school', v_is_existing,
    'price_paise', coalesce(v_price_override, v_campaign_default_price),
    'gst_percent', v_campaign_gst,
    'classes', v_classes,
    'subjects_per_class', v_subjects_per_class
  );
end;
$$;

grant execute on function public.oly_get_public_school_payment_context(text) to anon, authenticated;

-- =========================================================================
-- 11. Public RPC — SALCI student admission lookup
-- =========================================================================
create or replace function public.oly_lookup_salci_student(
  p_school_short_code text, p_admission_number text
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_school_inst_id uuid;
  v_profile_id uuid;
  v_full_name text;
  v_dob date;
  v_class_name text;
begin
  select i.id into v_school_inst_id
    from public.institutions i
    join public.oly_schools sc on sc.institution_id = i.id
   where sc.school_short_code = upper(p_school_short_code)
     and sc.is_existing_salci_school = true;

  if v_school_inst_id is null then
    return jsonb_build_object('found', false);
  end if;

  select p.id, p.full_name, p.date_of_birth
    into v_profile_id, v_full_name, v_dob
    from public.profiles p
   where p.institution_id = v_school_inst_id
     and p.admission_number = p_admission_number
     and exists (
       select 1 from public.user_roles ur where ur.user_id = p.id and ur.role = 'student'
     );

  if v_profile_id is null then
    return jsonb_build_object('found', false);
  end if;

  -- Find current class via class_assignments (single active assignment expected)
  select c.name into v_class_name
    from public.class_assignments ca
    join public.classes c on c.id = ca.class_id
   where ca.student_id = v_profile_id
   order by ca.created_at desc
   limit 1;

  return jsonb_build_object(
    'found', true,
    'profile_id', v_profile_id,
    'full_name', v_full_name,
    'date_of_birth', v_dob,
    'class_name', v_class_name
  );
end;
$$;

grant execute on function public.oly_lookup_salci_student(text, text) to anon, authenticated;
```

- [ ] **Step 1.3: Apply the migration**

```bash
npx supabase db push
```
Expected: applied cleanly. If `is_super_admin` / `oly_set_updated_at` / `oly_schools` / `oly_campaigns` references fail, abort — they were added in Phase 1 and must exist.

- [ ] **Step 1.4: Regenerate types**

```bash
npx supabase gen types typescript --project-id gyymkgohcijeksmrzuyw > src/integrations/supabase/types.ts
```

- [ ] **Step 1.5: Verify**

```bash
npx tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 1.6: Commit**

```bash
git add supabase/migrations/<ts>_oly_phase_2_enrollment.sql src/integrations/supabase/types.ts
git commit -m "feat(olympiad): phase 2 schema - students, pending, receipts, refunds, public RPCs"
```

---

## Section B — Payment adapter

### Task 2: Payment adapter types + stub adapter (frontend)

**Files:**
- Create: `src/lib/olympiad/payment/types.ts`
- Create: `src/lib/olympiad/payment/stubAdapter.ts`

- [ ] **Step 2.1: types.ts**

```ts
export type PayerContact = {
  name: string;
  email: string | null;
  phone: string;
};

export type CreateOrderInput = {
  amountPaise: number;
  orderRef: string;
  payer: PayerContact;
  receipt: string;
};

export type CreateOrderResult = {
  transactionId: string;
  clientPayload: unknown;
};

export type RefundInput = {
  transactionId: string;
  paymentId: string;
  amountPaise: number;
  reason: string;
};

export type RefundResult = {
  refundId: string;
  status: "queued" | "completed" | "failed";
  failureReason?: string;
};

export type AdapterName = "stub" | "razorpay";

export interface FrontendPaymentAdapter {
  readonly name: AdapterName;
  /**
   * Renders the gateway checkout UI (e.g. Razorpay modal). Resolves when
   * the gateway confirms client-side success; rejects on cancel/failure.
   * The webhook handler is the authoritative source — this resolution is
   * just a UX signal to redirect the user to the success page.
   */
  openCheckout(input: {
    clientPayload: unknown;
    pendingId: string;
    payer: PayerContact;
  }): Promise<void>;
}
```

- [ ] **Step 2.2: stubAdapter.ts**

```ts
import type { FrontendPaymentAdapter } from "./types";
import { supabase } from "@/integrations/supabase/client";

export const stubAdapter: FrontendPaymentAdapter = {
  name: "stub",
  async openCheckout({ pendingId }) {
    // Simulate user thinking time
    await new Promise((r) => setTimeout(r, 500));
    // Hit the dev-only completion endpoint
    const { error } = await supabase.functions.invoke("oly-stub-payment-complete", {
      body: { pendingId },
    });
    if (error) throw new Error(error.message);
  },
};
```

- [ ] **Step 2.3: Verify + commit**

```bash
npx tsc --noEmit
npx eslint src/lib/olympiad/payment/
git add src/lib/olympiad/payment/
git commit -m "feat(olympiad): payment adapter types + stub adapter"
```

---

### Task 3: Razorpay frontend adapter

**Files:**
- Create: `src/lib/olympiad/payment/razorpayAdapter.ts`
- Create: `src/lib/olympiad/payment/index.ts`

- [ ] **Step 3.1: razorpayAdapter.ts**

```ts
import type { FrontendPaymentAdapter } from "./types";

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => { open(): void; on(event: string, cb: (e: unknown) => void): void };
  }
}

type RazorpayOptions = {
  key: string;
  order_id: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  prefill: { name: string; email?: string; contact: string };
  notes?: Record<string, string>;
  handler: (response: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => void;
  modal?: { ondismiss?: () => void };
};

let razorpayScriptPromise: Promise<void> | null = null;

function loadRazorpayScript(): Promise<void> {
  if (razorpayScriptPromise) return razorpayScriptPromise;
  razorpayScriptPromise = new Promise((resolve, reject) => {
    if (typeof window === "undefined") return reject(new Error("Not in browser"));
    if (window.Razorpay) return resolve();
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Razorpay Checkout"));
    document.body.appendChild(script);
  });
  return razorpayScriptPromise;
}

type RazorpayClientPayload = {
  key_id: string;
  order_id: string;
  amount_paise: number;
  school_name: string;
};

export const razorpayAdapter: FrontendPaymentAdapter = {
  name: "razorpay",
  async openCheckout({ clientPayload, payer }) {
    await loadRazorpayScript();
    if (!window.Razorpay) throw new Error("Razorpay script not loaded");

    const cp = clientPayload as RazorpayClientPayload;

    return new Promise<void>((resolve, reject) => {
      const rzp = new window.Razorpay!({
        key: cp.key_id,
        order_id: cp.order_id,
        amount: cp.amount_paise,
        currency: "INR",
        name: "SALCI Olympiad",
        description: `Enrollment fee — ${cp.school_name}`,
        prefill: {
          name: payer.name,
          email: payer.email ?? undefined,
          contact: payer.phone,
        },
        handler: () => resolve(),
        modal: { ondismiss: () => reject(new Error("Payment cancelled")) },
      });
      rzp.open();
    });
  },
};
```

- [ ] **Step 3.2: index.ts (factory)**

```ts
import type { FrontendPaymentAdapter } from "./types";
import { stubAdapter } from "./stubAdapter";
import { razorpayAdapter } from "./razorpayAdapter";

export function getPaymentAdapter(): FrontendPaymentAdapter {
  const choice = (import.meta.env.VITE_OLY_PAYMENT_ADAPTER ?? "stub").toString().toLowerCase();
  return choice === "razorpay" ? razorpayAdapter : stubAdapter;
}

export type { FrontendPaymentAdapter, PayerContact, CreateOrderInput, CreateOrderResult } from "./types";
```

- [ ] **Step 3.3: Verify + commit**

```bash
npx tsc --noEmit
npx eslint src/lib/olympiad/payment/
git add src/lib/olympiad/payment/
git commit -m "feat(olympiad): Razorpay frontend adapter + adapter factory"
```

---

### Task 4: Edge function — `oly-payment-create-order`

**Files:**
- Create: `supabase/functions/oly-payment-create-order/index.ts`

- [ ] **Step 4.1: Implement**

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
  date_of_birth: string;          // ISO yyyy-mm-dd
  class_label: string;
  section_label?: string | null;
  grade_level_id?: string | null;
  admission_number?: string | null;
  subject_ids: string[];
  parent_name: string;
  parent_phone: string;
  parent_email?: string | null;
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    // @ts-expect-error Deno.env
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    // @ts-expect-error Deno.env
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    // @ts-expect-error Deno.env
    const adapter = (Deno.env.get("OLY_PAYMENT_ADAPTER") ?? "stub").toLowerCase();
    const supabase = createClient(supabaseUrl, serviceKey);

    const { school_short_code, form_data } = (await req.json()) as {
      school_short_code: string;
      form_data: FormData;
    };

    // 1. Resolve school + campaign + price
    const { data: ctx, error: ctxErr } = await supabase.rpc("oly_get_public_school_payment_context", {
      p_school_code: school_short_code,
    });
    if (ctxErr) return json({ error: ctxErr.message }, 400);
    if (!(ctx as { found?: boolean })?.found) return json({ error: "School not found or enrollment closed" }, 404);

    const ctxData = ctx as { found: true; school_name: string; price_paise: number; gst_percent: number; is_existing_salci_school: boolean };
    const pricePaise = ctxData.price_paise;
    const gstPaise = Math.round((pricePaise * ctxData.gst_percent) / 100);
    const totalPaise = pricePaise + gstPaise;

    // 2. Resolve oly_school_id + campaign_id
    const { data: schoolRow, error: schoolErr } = await supabase
      .from("oly_schools")
      .select("id, campaign_id, is_existing_salci_school")
      .eq("school_short_code", school_short_code.toUpperCase())
      .single();
    if (schoolErr || !schoolRow) return json({ error: "School not found" }, 404);

    // 3. Validate
    if (!form_data.full_name || !form_data.date_of_birth || !form_data.class_label
        || !Array.isArray(form_data.subject_ids) || form_data.subject_ids.length !== 3
        || !form_data.parent_name || !form_data.parent_phone) {
      return json({ error: "Missing required fields" }, 400);
    }
    if (!/^[6-9]\d{9}$/.test(form_data.parent_phone)) {
      return json({ error: "Invalid Indian mobile number" }, 400);
    }

    // 4. Duplicate guard
    if (ctxData.is_existing_salci_school && form_data.admission_number) {
      const { data: dup } = await supabase
        .from("oly_students")
        .select("roll_number")
        .eq("oly_school_id", schoolRow.id)
        .eq("admission_number", form_data.admission_number)
        .eq("campaign_id", schoolRow.campaign_id)
        .limit(1)
        .maybeSingle();
      if (dup) {
        return json({ blocked: true, message: `This student is already enrolled. Roll number: ${dup.roll_number}.` }, 409);
      }
    } else {
      const { data: dup } = await supabase
        .from("oly_students")
        .select("roll_number")
        .eq("oly_school_id", schoolRow.id)
        .ilike("full_name", form_data.full_name)
        .eq("date_of_birth", form_data.date_of_birth)
        .eq("class_label", form_data.class_label)
        .gt("enrolled_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .limit(1)
        .maybeSingle();
      if (dup) {
        return json({ blocked: true, message: `This student appears to be already enrolled. Roll number: ${dup.roll_number}. If this is a mistake, please contact your school.` }, 409);
      }
    }

    // 5. Best-effort purge of expired pending rows for this school (older than 1h)
    await supabase
      .from("oly_enrollment_pending")
      .delete()
      .eq("oly_school_id", schoolRow.id)
      .eq("status", "payment_pending")
      .lt("created_at", new Date(Date.now() - 60 * 60 * 1000).toISOString());

    // 6. Insert pending row
    const { data: pending, error: insErr } = await supabase
      .from("oly_enrollment_pending")
      .insert({
        oly_school_id: schoolRow.id,
        campaign_id: schoolRow.campaign_id,
        full_name: form_data.full_name,
        date_of_birth: form_data.date_of_birth,
        class_label: form_data.class_label,
        section_label: form_data.section_label ?? null,
        grade_level_id: form_data.grade_level_id ?? null,
        admission_number: form_data.admission_number ?? null,
        subject_ids: form_data.subject_ids,
        parent_name: form_data.parent_name,
        parent_phone: form_data.parent_phone,
        parent_email: form_data.parent_email ?? null,
        amount_paise: pricePaise,
        gst_paise: gstPaise,
        total_paise: totalPaise,
      })
      .select("id")
      .single();
    if (insErr || !pending) return json({ error: insErr?.message ?? "Failed to create pending row" }, 500);

    // 7. Create gateway order
    let transactionId: string;
    let clientPayload: unknown;

    if (adapter === "razorpay") {
      // @ts-expect-error Deno.env
      const keyId = Deno.env.get("RAZORPAY_KEY_ID")!;
      // @ts-expect-error Deno.env
      const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET")!;
      const auth = btoa(`${keyId}:${keySecret}`);
      const res = await fetch("https://api.razorpay.com/v1/orders", {
        method: "POST",
        headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: totalPaise,
          currency: "INR",
          receipt: pending.id,
          notes: { orderRef: pending.id, school: ctxData.school_name },
        }),
      });
      if (!res.ok) {
        const errBody = await res.text();
        return json({ error: `Razorpay order failed: ${errBody}` }, 502);
      }
      const order = await res.json() as { id: string };
      transactionId = order.id;
      clientPayload = {
        key_id: keyId,
        order_id: order.id,
        amount_paise: totalPaise,
        school_name: ctxData.school_name,
      };
    } else {
      // stub
      transactionId = `stub_${crypto.randomUUID()}`;
      clientPayload = { stub: true };
    }

    // 8. Persist the gateway order id
    await supabase
      .from("oly_enrollment_pending")
      .update({ gateway_order_id: transactionId })
      .eq("id", pending.id);

    return json({ pending_id: pending.id, transaction_id: transactionId, client_payload: clientPayload, total_paise: totalPaise }, 200);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
```

- [ ] **Step 4.2: Deploy + commit**

```bash
npx supabase@latest functions deploy oly-payment-create-order --project-ref gyymkgohcijeksmrzuyw
git add supabase/functions/oly-payment-create-order/
git commit -m "feat(olympiad): oly-payment-create-order edge function"
```

---

### Task 5: Edge function — `oly-payment-webhook`

**Files:**
- Create: `supabase/functions/oly-payment-webhook/index.ts`

- [ ] **Step 5.1: Implement**

```ts
// @ts-expect-error Deno runtime
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-expect-error Deno runtime
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req: Request) => {
  // Public POST, no JWT auth — Razorpay signs the payload.
  try {
    // @ts-expect-error Deno.env
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    // @ts-expect-error Deno.env
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    // @ts-expect-error Deno.env
    const webhookSecret = Deno.env.get("RAZORPAY_WEBHOOK_SECRET")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const rawBody = await req.text();
    const signature = req.headers.get("X-Razorpay-Signature") ?? "";

    // Verify HMAC-SHA256(rawBody, webhookSecret) == signature
    const ok = await verifyHmac(rawBody, signature, webhookSecret);
    if (!ok) return new Response("Invalid signature", { status: 401 });

    const payload = JSON.parse(rawBody) as {
      event: string;
      payload: {
        payment: { entity: { id: string; order_id: string; amount: number; status: string } };
      };
    };

    if (payload.event !== "payment.captured" && payload.event !== "payment.authorized") {
      return new Response("Ignored event", { status: 200 });
    }

    const payment = payload.payload.payment.entity;

    // Resolve pending row
    const { data: pending, error: pErr } = await supabase
      .from("oly_enrollment_pending")
      .select("id, status, total_paise, parent_email")
      .eq("gateway_order_id", payment.order_id)
      .maybeSingle();
    if (pErr || !pending) return new Response("Pending not found", { status: 404 });

    if (pending.status === "paid") {
      return new Response("Already processed", { status: 200 });
    }

    // Promote (the trigger creates oly_students + roll_number)
    const { data: updated, error: uErr } = await supabase
      .from("oly_enrollment_pending")
      .update({
        status: "paid",
        gateway_payment_id: payment.id,
        gateway_signature: signature,
      })
      .eq("id", pending.id)
      .select("promoted_student_id, parent_email")
      .single();
    if (uErr) return new Response(uErr.message, { status: 500 });

    // Trigger receipt generation (don't await — Razorpay times out webhooks at ~30s)
    if (updated.promoted_student_id) {
      supabase.functions.invoke("oly-receipt-generate", {
        body: { oly_student_id: updated.promoted_student_id },
      }).catch(() => { /* receipt-generate logs its own errors */ });
    }

    return new Response("OK", { status: 200 });
  } catch (e) {
    return new Response((e as Error).message, { status: 500 });
  }
});

async function verifyHmac(rawBody: string, signature: string, secret: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody));
  const expected = Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  return constantTimeEqual(expected, signature);
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
```

- [ ] **Step 5.2: Deploy + commit**

```bash
npx supabase@latest functions deploy oly-payment-webhook --project-ref gyymkgohcijeksmrzuyw --no-verify-jwt
git add supabase/functions/oly-payment-webhook/
git commit -m "feat(olympiad): oly-payment-webhook with HMAC signature verification"
```

(`--no-verify-jwt` because Razorpay won't send a Supabase JWT — the signature is the auth.)

---

### Task 6: Edge function — `oly-stub-payment-complete` (dev-only)

**Files:**
- Create: `supabase/functions/oly-stub-payment-complete/index.ts`

- [ ] **Step 6.1: Implement**

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

  // Refuse if not in stub mode — prevents misuse in production.
  // @ts-expect-error Deno.env
  const adapter = (Deno.env.get("OLY_PAYMENT_ADAPTER") ?? "stub").toLowerCase();
  if (adapter !== "stub") {
    return json({ error: "Stub completion is only available when OLY_PAYMENT_ADAPTER=stub" }, 403);
  }

  try {
    // @ts-expect-error Deno.env
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    // @ts-expect-error Deno.env
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { pendingId } = (await req.json()) as { pendingId: string };
    if (!pendingId) return json({ error: "pendingId required" }, 400);

    const fakePaymentId = `stub_pay_${crypto.randomUUID()}`;
    const { data: updated, error } = await supabase
      .from("oly_enrollment_pending")
      .update({
        status: "paid",
        gateway_payment_id: fakePaymentId,
        gateway_signature: "stub_sig",
      })
      .eq("id", pendingId)
      .select("promoted_student_id")
      .single();
    if (error) return json({ error: error.message }, 500);

    if (updated.promoted_student_id) {
      supabase.functions.invoke("oly-receipt-generate", {
        body: { oly_student_id: updated.promoted_student_id },
      }).catch(() => {});
    }

    return json({ ok: true, promoted_student_id: updated.promoted_student_id }, 200);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
```

- [ ] **Step 6.2: Deploy + commit**

```bash
npx supabase@latest functions deploy oly-stub-payment-complete --project-ref gyymkgohcijeksmrzuyw
git add supabase/functions/oly-stub-payment-complete/
git commit -m "feat(olympiad): oly-stub-payment-complete dev-only completion endpoint"
```

---

## Section C — Super admin onboarding

### Task 7: Edge function — `oly-onboard-school`

**Files:**
- Create: `supabase/functions/oly-onboard-school/index.ts`

- [ ] **Step 7.1: Implement**

```ts
// @ts-expect-error Deno runtime
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-expect-error Deno runtime
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Payload = {
  campaign_id: string;
  is_existing_salci_school: boolean;
  institution_id?: string;       // required if is_existing_salci_school
  school_name?: string;          // required if !is_existing_salci_school
  institution_code?: string;     // required if !is_existing_salci_school
  school_short_code: string;
  city?: string;
  state?: string;
  primary_contact_name: string;
  primary_contact_email: string;
  primary_contact_phone: string;
  participating_grade_level_ids: string[];
  price_override_paise?: number | null;
  internal_notes?: string | null;
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
    const supabase = createClient(supabaseUrl, serviceKey);

    // Verify super_admin
    const userRes = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    const userId = userRes.data.user?.id;
    if (!userId) return json({ error: "Forbidden" }, 403);
    const { data: isSuper } = await supabase.rpc("is_super_admin", { user_id: userId });
    if (!isSuper) return json({ error: "Forbidden" }, 403);

    const body = (await req.json()) as Payload;

    // Validate short code
    if (!/^[A-Z0-9]{6}$/.test(body.school_short_code)) {
      return json({ error: "school_short_code must be 6 alphanumeric uppercase chars" }, 400);
    }

    let institutionId: string;

    if (body.is_existing_salci_school) {
      if (!body.institution_id) return json({ error: "institution_id required for existing SALCI schools" }, 400);
      institutionId = body.institution_id;

      // Enable olympiad feature flag if not already enabled
      const { error: ffErr } = await supabase
        .from("institution_features")
        .upsert({ institution_id: institutionId, feature_id: "olympiad", is_enabled: true }, { onConflict: "institution_id,feature_id" });
      if (ffErr) return json({ error: `Feature flag toggle failed: ${ffErr.message}` }, 500);
    } else {
      if (!body.school_name || !body.institution_code) {
        return json({ error: "school_name + institution_code required for new schools" }, 400);
      }

      // Create institution
      const { data: newInst, error: instErr } = await supabase
        .from("institutions")
        .insert({
          name: body.school_name,
          code: body.institution_code.toUpperCase(),
          contact_email: body.primary_contact_email,
          contact_phone: body.primary_contact_phone,
          is_active: true,
        })
        .select("id")
        .single();
      if (instErr || !newInst) return json({ error: `Institution create failed: ${instErr?.message}` }, 500);
      institutionId = newInst.id;

      // Enable ONLY the olympiad feature
      await supabase.from("institution_features").insert({
        institution_id: institutionId,
        feature_id: "olympiad",
        is_enabled: true,
      });

      // Auto-create school admin
      const tempPassword = crypto.randomUUID();
      const { data: newUser, error: userErr } = await supabase.auth.admin.createUser({
        email: body.primary_contact_email,
        password: tempPassword,
        email_confirm: true,
      });
      if (userErr || !newUser?.user) return json({ error: `Admin user create failed: ${userErr?.message}` }, 500);

      // Profile + role
      await supabase.from("profiles").insert({
        id: newUser.user.id,
        full_name: body.primary_contact_name,
        email: body.primary_contact_email,
        phone: body.primary_contact_phone,
        institution_id: institutionId,
      });
      await supabase.from("user_roles").insert({
        user_id: newUser.user.id,
        role: "school_admin",
        institution_id: institutionId,
      });

      // Generate password-set link
      const { data: linkData } = await supabase.auth.admin.generateLink({
        type: "recovery",
        email: body.primary_contact_email,
      });

      // Send welcome email (reuse existing pattern if available, else inline)
      // @ts-expect-error Deno.env
      const resendKey = Deno.env.get("RESEND_API_KEY");
      if (resendKey && linkData?.properties?.action_link) {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resendKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "SALCI Olympiad <noreply@salci.org>",
            to: body.primary_contact_email,
            subject: `Welcome to SALCI Olympiad — set your password for ${body.school_name}`,
            html: `<p>Hello ${body.primary_contact_name},</p>
<p>Your school <strong>${body.school_name}</strong> has been onboarded for the SALCI Olympiad. Click the link below to set your password and log in:</p>
<p><a href="${linkData.properties.action_link}">Set your password</a></p>
<p>Best regards,<br/>Team SALCI</p>`,
          }),
        }).catch(() => {});
      }
    }

    // Insert oly_schools row
    const { data: olySchool, error: olySchoolErr } = await supabase
      .from("oly_schools")
      .insert({
        campaign_id: body.campaign_id,
        institution_id: institutionId,
        school_short_code: body.school_short_code.toUpperCase(),
        city: body.city ?? null,
        state: body.state ?? null,
        primary_contact_name: body.primary_contact_name,
        primary_contact_email: body.primary_contact_email,
        primary_contact_phone: body.primary_contact_phone,
        participating_grade_level_ids: body.participating_grade_level_ids,
        price_override_paise: body.price_override_paise ?? null,
        is_existing_salci_school: body.is_existing_salci_school,
        internal_notes: body.internal_notes ?? null,
        created_by: userId,
      })
      .select("id, school_short_code")
      .single();
    if (olySchoolErr || !olySchool) return json({ error: `oly_schools insert failed: ${olySchoolErr?.message}` }, 500);

    return json({
      oly_school_id: olySchool.id,
      school_short_code: olySchool.school_short_code,
      institution_id: institutionId,
    }, 200);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
```

- [ ] **Step 7.2: Deploy + commit**

```bash
npx supabase@latest functions deploy oly-onboard-school --project-ref gyymkgohcijeksmrzuyw
git add supabase/functions/oly-onboard-school/
git commit -m "feat(olympiad): oly-onboard-school edge function"
```

---

### Task 8: `useOnboardSchool` + `OnboardSchoolSheet`

**Files:**
- Create: `src/hooks/olympiad/useOnboardSchool.ts`
- Create: `src/hooks/olympiad/useOlympiadInstitutions.ts` (helper for the existing-school dropdown)
- Create: `src/components/olympiad/admin/OnboardSchoolSheet.tsx`

- [ ] **Step 8.1: `useOnboardSchool.ts`**

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invokeEdgeFunction } from "@/lib/invokeEdgeFunction";
import { toastError } from "@/lib/toast";
import { toast } from "sonner";

export type OnboardSchoolInput = {
  campaign_id: string;
  is_existing_salci_school: boolean;
  institution_id?: string;
  school_name?: string;
  institution_code?: string;
  school_short_code: string;
  city?: string;
  state?: string;
  primary_contact_name: string;
  primary_contact_email: string;
  primary_contact_phone: string;
  participating_grade_level_ids: string[];
  price_override_paise?: number | null;
  internal_notes?: string | null;
};

export type OnboardSchoolResult = {
  oly_school_id: string;
  school_short_code: string;
  institution_id: string;
};

export function useOnboardSchool() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: OnboardSchoolInput): Promise<OnboardSchoolResult> => {
      return invokeEdgeFunction<OnboardSchoolResult>("oly-onboard-school", input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["olympiad", "schools"] });
      toast.success("School onboarded");
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't onboard school.", context: "useOnboardSchool" }),
  });
}
```

- [ ] **Step 8.2: `useOlympiadInstitutions.ts`** (for the existing-SALCI dropdown)

```ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type InstitutionPickerRow = { id: string; name: string; code: string };

export function useOlympiadInstitutions() {
  return useQuery({
    queryKey: ["olympiad", "institutions-pickable"],
    queryFn: async (): Promise<InstitutionPickerRow[]> => {
      const { data, error } = await supabase
        .from("institutions")
        .select("id, name, code")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as InstitutionPickerRow[];
    },
    staleTime: 5 * 60_000,
  });
}
```

- [ ] **Step 8.3: `OnboardSchoolSheet.tsx`**

```tsx
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MobileSheet } from "@/components/shared/sheets/MobileSheet";
import { useOnboardSchool, type OnboardSchoolInput } from "@/hooks/olympiad/useOnboardSchool";
import { useOlympiadInstitutions } from "@/hooks/olympiad/useOlympiadInstitutions";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  campaignId: string;
  onSuccess: (result: { oly_school_id: string; school_short_code: string }) => void;
};

function useGradeLevelMap() {
  return useQuery({
    queryKey: ["grade-levels", "olympiad"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("grade_levels")
        .select("id, grade_name, grade_number, display_order")
        .eq("is_active", true)
        .order("display_order");
      if (error) throw error;
      return (data ?? []).filter((g) => {
        const n = Number(g.grade_number);
        return Number.isFinite(n) && n >= 3 && n <= 10;
      });
    },
    staleTime: 5 * 60_000,
  });
}

function suggestShortCode(name: string): string {
  const base = name.replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0, 4) || "SCHL";
  const rand = Math.floor(10 + Math.random() * 90).toString();
  return (base + rand).slice(0, 6).padEnd(6, "X");
}

export function OnboardSchoolSheet({ open, onOpenChange, campaignId, onSuccess }: Props) {
  const onboard = useOnboardSchool();
  const { data: institutions } = useOlympiadInstitutions();
  const { data: grades } = useGradeLevelMap();

  const [isExisting, setIsExisting] = useState(false);
  const [institutionId, setInstitutionId] = useState<string>("");
  const [schoolName, setSchoolName] = useState("");
  const [institutionCode, setInstitutionCode] = useState("");
  const [shortCode, setShortCode] = useState("");
  const [city, setCity] = useState("");
  const [stateField, setStateField] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [selectedGrades, setSelectedGrades] = useState<string[]>([]);
  const [priceOverride, setPriceOverride] = useState<string>("");
  const [notes, setNotes] = useState("");

  const initialRef = useRef({ schoolName: "", contactEmail: "", shortCode: "" });

  useEffect(() => {
    if (!open) {
      setIsExisting(false); setInstitutionId(""); setSchoolName(""); setInstitutionCode("");
      setShortCode(""); setCity(""); setStateField("");
      setContactName(""); setContactEmail(""); setContactPhone("");
      setSelectedGrades([]); setPriceOverride(""); setNotes("");
      initialRef.current = { schoolName: "", contactEmail: "", shortCode: "" };
    }
  }, [open]);

  // When existing-school toggle is set and an institution is picked, autofill.
  useEffect(() => {
    if (isExisting && institutionId && institutions) {
      const inst = institutions.find((i) => i.id === institutionId);
      if (inst) {
        setSchoolName(inst.name);
        setInstitutionCode(inst.code);
        if (!shortCode) setShortCode(suggestShortCode(inst.name));
      }
    }
  }, [isExisting, institutionId, institutions, shortCode]);

  const isDirty =
    schoolName !== initialRef.current.schoolName ||
    contactEmail !== initialRef.current.contactEmail ||
    shortCode !== initialRef.current.shortCode;

  const toggleGrade = (id: string, checked: boolean) =>
    setSelectedGrades((s) => (checked ? [...new Set([...s, id])] : s.filter((g) => g !== id)));

  const canSubmit =
    !!shortCode &&
    /^[A-Z0-9]{6}$/.test(shortCode) &&
    !!contactName.trim() &&
    !!contactEmail.trim() &&
    !!contactPhone.trim() &&
    selectedGrades.length > 0 &&
    (isExisting ? !!institutionId : (!!schoolName.trim() && !!institutionCode.trim()));

  const onSubmit = async () => {
    const input: OnboardSchoolInput = {
      campaign_id: campaignId,
      is_existing_salci_school: isExisting,
      institution_id: isExisting ? institutionId : undefined,
      school_name: !isExisting ? schoolName.trim() : undefined,
      institution_code: !isExisting ? institutionCode.trim().toUpperCase() : undefined,
      school_short_code: shortCode.toUpperCase(),
      city: city.trim() || undefined,
      state: stateField.trim() || undefined,
      primary_contact_name: contactName.trim(),
      primary_contact_email: contactEmail.trim(),
      primary_contact_phone: contactPhone.trim(),
      participating_grade_level_ids: selectedGrades,
      price_override_paise: priceOverride.trim() ? Number(priceOverride) : null,
      internal_notes: notes.trim() || null,
    };
    try {
      const result = await onboard.mutateAsync(input);
      onSuccess(result);
      onOpenChange(false);
    } catch {
      // toastError fires on error path
    }
  };

  return (
    <MobileSheet open={open} onOpenChange={onOpenChange} title="Onboard a new school">
      <form
        data-dirty={isDirty ? "true" : "false"}
        onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
        className="space-y-4"
      >
        <div className="flex items-center justify-between rounded-md border border-surface-stroke p-3">
          <div>
            <p className="text-sm font-medium text-ink-900">Existing SALCI school?</p>
            <p className="text-[11px] text-ink-500">Toggle on if this institution already uses SALCI</p>
          </div>
          <Switch checked={isExisting} onCheckedChange={(v) => { setIsExisting(v); setInstitutionId(""); }} />
        </div>

        {isExisting ? (
          <div className="grid gap-1.5">
            <Label className="text-xs font-medium text-ink-600">Pick institution</Label>
            <Select value={institutionId} onValueChange={setInstitutionId}>
              <SelectTrigger><SelectValue placeholder="Select an institution" /></SelectTrigger>
              <SelectContent>
                {(institutions ?? []).map((i) => (
                  <SelectItem key={i.id} value={i.id}>{i.name} ({i.code})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <>
            <div className="grid gap-1.5">
              <Label className="text-xs font-medium text-ink-600">School name</Label>
              <Input value={schoolName} onChange={(e) => setSchoolName(e.target.value)} required />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs font-medium text-ink-600">Institution code</Label>
              <Input value={institutionCode} onChange={(e) => setInstitutionCode(e.target.value.toUpperCase())} required />
            </div>
          </>
        )}

        <div className="grid gap-1.5">
          <Label className="text-xs font-medium text-ink-600">School short code (6 char A-Z 0-9)</Label>
          <div className="flex gap-2">
            <Input
              value={shortCode}
              onChange={(e) => setShortCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))}
              placeholder="e.g. DEL042"
              maxLength={6}
            />
            <Button type="button" variant="outline"
              onClick={() => setShortCode(suggestShortCode(schoolName || "SCHL"))}>
              Suggest
            </Button>
          </div>
          <p className="text-[11px] text-ink-500">Used in roll numbers and public URL. Cannot change after creation.</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label className="text-xs font-medium text-ink-600">City</Label>
            <Input value={city} onChange={(e) => setCity(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs font-medium text-ink-600">State</Label>
            <Input value={stateField} onChange={(e) => setStateField(e.target.value)} />
          </div>
        </div>

        <fieldset className="grid gap-1.5">
          <legend className="text-xs font-medium text-ink-600">Primary contact</legend>
          <Input placeholder="Name" value={contactName} onChange={(e) => setContactName(e.target.value)} required />
          <Input type="email" placeholder="Email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} required />
          <Input placeholder="Phone (10 digits)" value={contactPhone}
            onChange={(e) => setContactPhone(e.target.value.replace(/\D/g, "").slice(0, 10))} required />
        </fieldset>

        <div className="grid gap-1.5">
          <Label className="text-xs font-medium text-ink-600">Participating classes</Label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {(grades ?? []).map((g) => (
              <label key={g.id} className="flex items-center gap-2 text-sm">
                <Checkbox checked={selectedGrades.includes(g.id)} onCheckedChange={(v) => toggleGrade(g.id, !!v)} />
                <span>{g.grade_name}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="grid gap-1.5">
          <Label className="text-xs font-medium text-ink-600">Price override (paise, optional)</Label>
          <Input type="number" value={priceOverride} onChange={(e) => setPriceOverride(e.target.value)}
            placeholder="Leave blank to use campaign default" min={100} />
        </div>

        <div className="grid gap-1.5">
          <Label className="text-xs font-medium text-ink-600">Internal notes</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" disabled={!canSubmit || onboard.isPending}>
            {onboard.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Onboard
          </Button>
        </div>
      </form>
    </MobileSheet>
  );
}
```

- [ ] **Step 8.4: Verify + commit**

```bash
npx tsc --noEmit
npx eslint src/hooks/olympiad/useOnboardSchool.ts src/hooks/olympiad/useOlympiadInstitutions.ts src/components/olympiad/admin/OnboardSchoolSheet.tsx
npx vite build
git add src/hooks/olympiad/useOnboardSchool.ts src/hooks/olympiad/useOlympiadInstitutions.ts src/components/olympiad/admin/OnboardSchoolSheet.tsx
git commit -m "feat(olympiad): onboard-school sheet + hooks"
```

---

### Task 9: `useOlympiadSchools` + Schools tab rewrite + `PublicPaymentLink`

**Files:**
- Create: `src/hooks/olympiad/useOlympiadSchools.ts`
- Create: `src/components/olympiad/admin/SchoolListRow.tsx`
- Create: `src/components/olympiad/admin/PublicPaymentLink.tsx`
- Modify: `src/pages/admin/olympiad/OlympiadSchoolsTab.tsx`

- [ ] **Step 9.1: Hook**

```ts
// src/hooks/olympiad/useOlympiadSchools.ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type OlympiadSchoolRow = {
  id: string;
  campaign_id: string;
  institution_id: string;
  institution_name: string;
  school_short_code: string;
  city: string | null;
  state: string | null;
  status: "enrollment_open" | "enrollment_closed" | "batches_scheduled" | "exam_in_progress" | "results_published" | "archived";
  is_existing_salci_school: boolean;
  enrolled_count: number;
  created_at: string;
};

export function useOlympiadSchools(campaignId: string | undefined) {
  return useQuery({
    queryKey: ["olympiad", "schools", campaignId],
    queryFn: async (): Promise<OlympiadSchoolRow[]> => {
      if (!campaignId) return [];
      const { data: schools, error } = await supabase
        .from("oly_schools")
        .select("id, campaign_id, institution_id, school_short_code, city, state, status, is_existing_salci_school, created_at, institutions(name)")
        .eq("campaign_id", campaignId)
        .order("created_at", { ascending: false });
      if (error) throw error;

      const ids = (schools ?? []).map((s) => s.id);
      const counts: Record<string, number> = {};
      if (ids.length > 0) {
        const { data: students } = await supabase
          .from("oly_students")
          .select("oly_school_id")
          .in("oly_school_id", ids)
          .eq("status", "active");
        for (const s of students ?? []) {
          counts[s.oly_school_id] = (counts[s.oly_school_id] ?? 0) + 1;
        }
      }

      return (schools ?? []).map((s) => {
        const inst = Array.isArray(s.institutions) ? s.institutions[0] : s.institutions;
        return {
          id: s.id,
          campaign_id: s.campaign_id,
          institution_id: s.institution_id,
          institution_name: (inst as { name?: string } | null)?.name ?? "(unknown)",
          school_short_code: s.school_short_code,
          city: s.city,
          state: s.state,
          status: s.status as OlympiadSchoolRow["status"],
          is_existing_salci_school: s.is_existing_salci_school,
          enrolled_count: counts[s.id] ?? 0,
          created_at: s.created_at,
        };
      });
    },
    enabled: !!campaignId,
    staleTime: 30_000,
  });
}
```

- [ ] **Step 9.2: `PublicPaymentLink.tsx`**

```tsx
import { useState } from "react";
import { Copy, Download, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import QRCode from "qrcode.react";
import { toast } from "sonner";

export function PublicPaymentLink({ schoolShortCode }: { schoolShortCode: string }) {
  const base = (import.meta.env.VITE_PUBLIC_URL ?? "https://www.salci.org").replace(/\/$/, "");
  const url = `${base}/olympiad/${schoolShortCode}`;
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    toast.success("URL copied");
    setTimeout(() => setCopied(false), 1500);
  };

  const downloadQr = () => {
    const canvas = document.getElementById(`qr-${schoolShortCode}`) as HTMLCanvasElement | null;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `olympiad-${schoolShortCode}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="surface-card frosted-shadow rounded-card p-4 space-y-3">
      <p className="eyebrow">Public payment URL</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 text-xs bg-surface-card border border-surface-stroke rounded px-2 py-1.5 truncate">{url}</code>
        <Button size="icon" variant="ghost" onClick={copy} title="Copy URL">
          {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>
      <div className="flex items-center gap-4">
        <div className="rounded-md border border-surface-stroke bg-white p-2">
          <QRCode id={`qr-${schoolShortCode}`} value={url} size={120} level="M" includeMargin />
        </div>
        <Button size="sm" variant="outline" onClick={downloadQr}>
          <Download className="h-4 w-4 mr-1" />
          Download QR
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 9.3: `SchoolListRow.tsx`**

```tsx
import { ChevronRight, ExternalLink } from "lucide-react";
import { NavLink } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import type { OlympiadSchoolRow } from "@/hooks/olympiad/useOlympiadSchools";

const STATUS_STYLE: Record<string, string> = {
  enrollment_open:    "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-300",
  enrollment_closed:  "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300",
  batches_scheduled:  "bg-sky-100 text-sky-900 dark:bg-sky-500/15 dark:text-sky-300",
  exam_in_progress:   "bg-violet-100 text-violet-900 dark:bg-violet-500/15 dark:text-violet-300",
  results_published:  "bg-slate-200 text-slate-800 dark:bg-slate-500/15 dark:text-slate-300",
  archived:           "bg-slate-100 text-slate-600 dark:bg-slate-700/40 dark:text-slate-400",
};

const STATUS_LABEL: Record<string, string> = {
  enrollment_open:    "Open",
  enrollment_closed:  "Closed",
  batches_scheduled:  "Scheduled",
  exam_in_progress:   "In Progress",
  results_published:  "Published",
  archived:           "Archived",
};

export function SchoolListRow({ school }: { school: OlympiadSchoolRow }) {
  return (
    <NavLink
      to={`/admin/olympiad/schools/${school.id}`}
      className="flex items-center gap-3 px-4 py-3 surface-card frosted-shadow rounded-card hover:bg-surface-card/80 transition-colors"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-ink-900 truncate">{school.institution_name}</p>
          {school.is_existing_salci_school && (
            <ExternalLink className="h-3 w-3 text-ink-500 flex-shrink-0" />
          )}
        </div>
        <p className="text-[11px] text-ink-500 mt-0.5">
          {school.school_short_code} · {school.enrolled_count} enrolled
          {school.city ? ` · ${school.city}` : ""}
        </p>
      </div>
      <Badge className={`text-[10px] ${STATUS_STYLE[school.status]}`} variant="secondary">
        {STATUS_LABEL[school.status]}
      </Badge>
      <ChevronRight className="h-4 w-4 text-ink-500 flex-shrink-0" />
    </NavLink>
  );
}
```

- [ ] **Step 9.4: Rewrite Schools tab**

Replace `src/pages/admin/olympiad/OlympiadSchoolsTab.tsx`:

```tsx
import { useState } from "react";
import { Loader2, Plus, Medal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/surfaces/EmptyState";
import { useOlympiadCampaigns } from "@/hooks/olympiad/useOlympiadCampaign";
import { useOlympiadSchools } from "@/hooks/olympiad/useOlympiadSchools";
import { SchoolListRow } from "@/components/olympiad/admin/SchoolListRow";
import { OnboardSchoolSheet } from "@/components/olympiad/admin/OnboardSchoolSheet";
import { PublicPaymentLink } from "@/components/olympiad/admin/PublicPaymentLink";
import { MobileSheet } from "@/components/shared/sheets/MobileSheet";

export default function OlympiadSchoolsTab() {
  const { data: campaigns } = useOlympiadCampaigns();
  const currentYear = new Date().getFullYear();
  const current = campaigns?.find((c) => c.campaign_year === currentYear) ?? null;

  const { data: schools, isLoading } = useOlympiadSchools(current?.id);
  const [onboardOpen, setOnboardOpen] = useState(false);
  const [postOnboard, setPostOnboard] = useState<{ shortCode: string } | null>(null);

  if (!current) {
    return (
      <EmptyState
        icon={<Medal className="h-8 w-8 text-ink-500" />}
        title="No active campaign"
        description="Create and activate the current-year campaign before onboarding schools."
      />
    );
  }

  return (
    <div className="space-y-4 py-4">
      <div className="flex items-center justify-between">
        <p className="eyebrow">Schools</p>
        <Button size="sm" onClick={() => setOnboardOpen(true)}>
          <Plus className="h-4 w-4 mr-1" />
          Onboard school
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-ink-500" /></div>
      ) : (schools ?? []).length === 0 ? (
        <EmptyState
          icon={<Medal className="h-8 w-8 text-ink-500" />}
          title="No schools onboarded yet"
          description="Use Onboard school to add the first one."
          action={{ label: "Onboard school", onClick: () => setOnboardOpen(true), icon: <Plus className="h-4 w-4 mr-1" /> }}
        />
      ) : (
        <div className="space-y-2">
          {(schools ?? []).map((s) => <SchoolListRow key={s.id} school={s} />)}
        </div>
      )}

      <OnboardSchoolSheet
        open={onboardOpen}
        onOpenChange={setOnboardOpen}
        campaignId={current.id}
        onSuccess={(r) => setPostOnboard({ shortCode: r.school_short_code })}
      />

      <MobileSheet
        open={!!postOnboard}
        onOpenChange={(o) => !o && setPostOnboard(null)}
        title="School onboarded"
        subtitle="Share this public URL or QR code with parents."
      >
        {postOnboard && (
          <div className="space-y-4">
            <PublicPaymentLink schoolShortCode={postOnboard.shortCode} />
            <div className="flex justify-end">
              <Button onClick={() => setPostOnboard(null)}>Done</Button>
            </div>
          </div>
        )}
      </MobileSheet>
    </div>
  );
}
```

- [ ] **Step 9.5: Verify + commit**

```bash
npx tsc --noEmit
npx eslint src/hooks/olympiad/useOlympiadSchools.ts src/components/olympiad/admin/SchoolListRow.tsx src/components/olympiad/admin/PublicPaymentLink.tsx src/pages/admin/olympiad/OlympiadSchoolsTab.tsx
npx vite build
git add src/hooks/olympiad/useOlympiadSchools.ts src/components/olympiad/admin/SchoolListRow.tsx src/components/olympiad/admin/PublicPaymentLink.tsx src/pages/admin/olympiad/OlympiadSchoolsTab.tsx
git commit -m "feat(olympiad): schools tab - live list, onboard flow, public URL/QR display"
```

---

### Task 10: School detail page (thin Phase 2 version)

**Files:**
- Create: `src/hooks/olympiad/useOlympiadSchool.ts`
- Create: `src/pages/admin/olympiad/OlympiadSchoolDetailPage.tsx`
- Modify: `src/App.tsx` (register the route)

- [ ] **Step 10.1: `useOlympiadSchool.ts`**

```ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type SchoolDetail = {
  id: string;
  campaign_id: string;
  school_short_code: string;
  institution_name: string;
  city: string | null;
  state: string | null;
  status: string;
  is_existing_salci_school: boolean;
  primary_contact_name: string;
  primary_contact_email: string;
  primary_contact_phone: string;
  enrolled_count: number;
  revenue_paise: number;
  created_at: string;
};

export function useOlympiadSchool(olySchoolId: string | undefined) {
  return useQuery({
    queryKey: ["olympiad", "school", olySchoolId],
    queryFn: async (): Promise<SchoolDetail | null> => {
      if (!olySchoolId) return null;
      const { data: school, error } = await supabase
        .from("oly_schools")
        .select("id, campaign_id, school_short_code, city, state, status, is_existing_salci_school, primary_contact_name, primary_contact_email, primary_contact_phone, created_at, institutions(name)")
        .eq("id", olySchoolId)
        .single();
      if (error) throw error;
      if (!school) return null;

      const { data: students } = await supabase
        .from("oly_students")
        .select("id")
        .eq("oly_school_id", olySchoolId)
        .eq("status", "active");
      const enrolled_count = (students ?? []).length;

      const { data: pendings } = await supabase
        .from("oly_enrollment_pending")
        .select("total_paise")
        .eq("oly_school_id", olySchoolId)
        .eq("status", "paid");
      const revenue_paise = (pendings ?? []).reduce((acc, r) => acc + (r.total_paise ?? 0), 0);

      const inst = Array.isArray(school.institutions) ? school.institutions[0] : school.institutions;
      return {
        id: school.id,
        campaign_id: school.campaign_id,
        school_short_code: school.school_short_code,
        institution_name: (inst as { name?: string } | null)?.name ?? "(unknown)",
        city: school.city,
        state: school.state,
        status: school.status,
        is_existing_salci_school: school.is_existing_salci_school,
        primary_contact_name: school.primary_contact_name,
        primary_contact_email: school.primary_contact_email,
        primary_contact_phone: school.primary_contact_phone,
        enrolled_count,
        revenue_paise,
        created_at: school.created_at,
      };
    },
    enabled: !!olySchoolId,
    staleTime: 30_000,
  });
}
```

- [ ] **Step 10.2: `OlympiadSchoolDetailPage.tsx`**

```tsx
import { useParams, NavLink } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import { PageShell } from "@/components/shared/page/PageShell";
import { PageHeader } from "@/components/shared/page/PageHeader";
import { StatTile, StatTileGrid } from "@/components/shared/surfaces";
import { useOlympiadSchool } from "@/hooks/olympiad/useOlympiadSchool";
import { PublicPaymentLink } from "@/components/olympiad/admin/PublicPaymentLink";

export default function OlympiadSchoolDetailPage() {
  const { olySchoolId } = useParams();
  const { data: school, isLoading } = useOlympiadSchool(olySchoolId);

  if (isLoading) {
    return (
      <PageShell>
        <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-ink-500" /></div>
      </PageShell>
    );
  }

  if (!school) {
    return (
      <PageShell>
        <div className="py-6 text-sm text-ink-600">
          School not found. <NavLink to="/admin/olympiad/schools" className="underline">Back to schools</NavLink>.
        </div>
      </PageShell>
    );
  }

  const revenueRupees = `₹${(school.revenue_paise / 100).toFixed(0)}`;

  return (
    <PageShell>
      <NavLink to="/admin/olympiad/schools" className="inline-flex items-center gap-1 text-sm text-ink-600 hover:text-ink-900 mb-2">
        <ArrowLeft className="h-4 w-4" /> All schools
      </NavLink>
      <PageHeader
        title={school.institution_name}
        subtitle={`${school.school_short_code} · ${school.city ?? "—"}, ${school.state ?? "—"}`}
      />

      <div className="space-y-4 py-4">
        <StatTileGrid>
          <StatTile label="Enrolled" value={school.enrolled_count.toString()} tone="teal" />
          <StatTile label="Revenue (paid)" value={revenueRupees} tone="mint" />
          <StatTile label="Status" value={school.status.replace(/_/g, " ")} tone="violet" />
        </StatTileGrid>

        <PublicPaymentLink schoolShortCode={school.school_short_code} />

        <section className="surface-card frosted-shadow rounded-card p-4 space-y-2">
          <p className="eyebrow">Primary contact</p>
          <p className="text-sm text-ink-900">{school.primary_contact_name}</p>
          <p className="text-xs text-ink-600">{school.primary_contact_email}</p>
          <p className="text-xs text-ink-600">{school.primary_contact_phone}</p>
        </section>
      </div>
    </PageShell>
  );
}
```

If `StatTile`/`StatTileGrid` are in different paths or have different prop shapes, match the existing signatures from `@/components/shared/surfaces`.

- [ ] **Step 10.3: Register route in App.tsx**

Add to the lazy imports section:
```tsx
const OlympiadSchoolDetailPage = lazy(() => import("@/pages/admin/olympiad/OlympiadSchoolDetailPage"));
```

Add this route INSIDE the super_admin block, separately (NOT as a child of `/admin/olympiad`):
```tsx
<Route path="/admin/olympiad/schools/:olySchoolId" element={
  <ProtectedRoute allowedRoles={["super_admin"]}>
    <Suspense fallback={<p>Loading...</p>}>
      <OlympiadSchoolDetailPage />
    </Suspense>
  </ProtectedRoute>
} />
```

- [ ] **Step 10.4: Verify + commit**

```bash
npx tsc --noEmit
npx eslint src/hooks/olympiad/useOlympiadSchool.ts src/pages/admin/olympiad/OlympiadSchoolDetailPage.tsx src/App.tsx
npx vite build
git add src/hooks/olympiad/useOlympiadSchool.ts src/pages/admin/olympiad/OlympiadSchoolDetailPage.tsx src/App.tsx
git commit -m "feat(olympiad): school detail page with stats + public URL"
```

---

## Section D — Public parent payment page

### Task 11: Public layout + route + payment context hook

**Files:**
- Create: `src/components/olympiad/public/OlympiadPublicLayout.tsx`
- Create: `src/hooks/olympiad/usePublicPaymentContext.ts`
- Create: `src/pages/public/OlympiadPublicEnrollmentPage.tsx`
- Modify: `src/App.tsx` (register public route OUTSIDE ProtectedRoute)

- [ ] **Step 11.1: `OlympiadPublicLayout.tsx`**

```tsx
import { Medal } from "lucide-react";

export function OlympiadPublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen surface-gradient">
      <header className="max-w-2xl mx-auto px-4 py-6 sm:py-8 flex items-center gap-2">
        <Medal className="h-6 w-6 text-brand-primary" />
        <p className="text-sm font-semibold text-ink-900">SALCI Olympiad</p>
      </header>
      <main className="max-w-2xl mx-auto px-4 pb-12">
        {children}
      </main>
      <footer className="max-w-2xl mx-auto px-4 py-6 text-[11px] text-ink-500 text-center">
        SALCI Olympiad · For queries, contact your school administration.
      </footer>
    </div>
  );
}
```

- [ ] **Step 11.2: `usePublicPaymentContext.ts`**

```ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type PublicPaymentContext = {
  found: true;
  school_name: string;
  school_short_code: string;
  is_existing_salci_school: boolean;
  price_paise: number;
  gst_percent: number;
  classes: Array<{ id: string; name: string; number: number }>;
  subjects_per_class: Record<string, Array<{ id: string; name: string }>>;
} | { found: false };

export function usePublicPaymentContext(schoolCode: string | undefined) {
  return useQuery({
    queryKey: ["olympiad", "public", "payment-context", schoolCode],
    queryFn: async (): Promise<PublicPaymentContext> => {
      if (!schoolCode) return { found: false };
      const { data, error } = await supabase.rpc("oly_get_public_school_payment_context", {
        p_school_code: schoolCode,
      });
      if (error) throw error;
      return data as PublicPaymentContext;
    },
    enabled: !!schoolCode,
    staleTime: 60_000,
  });
}
```

- [ ] **Step 11.3: `OlympiadPublicEnrollmentPage.tsx`**

```tsx
import { useState } from "react";
import { useParams, Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { OlympiadPublicLayout } from "@/components/olympiad/public/OlympiadPublicLayout";
import { usePublicPaymentContext } from "@/hooks/olympiad/usePublicPaymentContext";
import { EnrollmentFormNonSalci } from "@/components/olympiad/public/EnrollmentFormNonSalci";
import { EnrollmentFormSalci } from "@/components/olympiad/public/EnrollmentFormSalci";
import { formatOlympiadFee } from "@/lib/olympiad/money";

export default function OlympiadPublicEnrollmentPage() {
  const { schoolCode } = useParams();
  const { data, isLoading } = usePublicPaymentContext(schoolCode);
  const [showForm, setShowForm] = useState(false);

  if (isLoading) {
    return (
      <OlympiadPublicLayout>
        <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-ink-500" /></div>
      </OlympiadPublicLayout>
    );
  }

  if (!data || data.found === false) {
    return (
      <OlympiadPublicLayout>
        <div className="surface-card frosted-shadow rounded-card p-6 text-center">
          <p className="text-base font-semibold text-ink-900 mb-2">Enrollment unavailable</p>
          <p className="text-sm text-ink-600">This Olympiad URL is no longer accepting enrollments. Please contact your school for assistance.</p>
        </div>
      </OlympiadPublicLayout>
    );
  }

  const fee = formatOlympiadFee(data.price_paise, data.gst_percent);

  if (!showForm) {
    return (
      <OlympiadPublicLayout>
        <div className="surface-card frosted-shadow rounded-card p-6 space-y-4">
          <header>
            <p className="eyebrow">Olympiad Enrollment</p>
            <h1 className="text-xl sm:text-2xl font-bold text-ink-900 mt-1">{data.school_name}</h1>
          </header>
          <p className="text-sm text-ink-700">
            The SALCI Olympiad is a one-paper competitive exam covering three student-chosen subjects, taken in a proctored session at your school.
          </p>
          <div className="rounded-md border border-surface-stroke bg-surface-card p-4 text-center">
            <p className="eyebrow">Enrollment fee</p>
            <p className="text-2xl font-bold text-ink-900 mt-1">{fee.display}</p>
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="w-full bg-brand-primary text-white font-semibold py-3 rounded-md hover:opacity-90 transition"
          >
            Enroll student
          </button>
        </div>
      </OlympiadPublicLayout>
    );
  }

  return (
    <OlympiadPublicLayout>
      {data.is_existing_salci_school ? (
        <EnrollmentFormSalci context={data} />
      ) : (
        <EnrollmentFormNonSalci context={data} />
      )}
    </OlympiadPublicLayout>
  );
}
```

- [ ] **Step 11.4: Register PUBLIC route in App.tsx**

OUTSIDE the `ProtectedRoute` blocks (typically near `/login`):
```tsx
const OlympiadPublicEnrollmentPage = lazy(() => import("@/pages/public/OlympiadPublicEnrollmentPage"));
const OlympiadPaymentSuccessPage = lazy(() => import("@/pages/public/OlympiadPaymentSuccessPage"));

<Route path="/olympiad/:schoolCode" element={
  <Suspense fallback={<p>Loading...</p>}>
    <OlympiadPublicEnrollmentPage />
  </Suspense>
} />
<Route path="/olympiad/:schoolCode/success" element={
  <Suspense fallback={<p>Loading...</p>}>
    <OlympiadPaymentSuccessPage />
  </Suspense>
} />
```

- [ ] **Step 11.5: Verify + commit**

```bash
npx tsc --noEmit
npx eslint src/components/olympiad/public/OlympiadPublicLayout.tsx src/hooks/olympiad/usePublicPaymentContext.ts src/pages/public/OlympiadPublicEnrollmentPage.tsx src/App.tsx
npx vite build
git add src/components/olympiad/public/OlympiadPublicLayout.tsx src/hooks/olympiad/usePublicPaymentContext.ts src/pages/public/OlympiadPublicEnrollmentPage.tsx src/App.tsx
git commit -m "feat(olympiad): public payment page shell + route + payment context"
```

(`EnrollmentFormNonSalci` and `EnrollmentFormSalci` imports will fail until Task 12 — TypeScript will complain. Either run Task 12 immediately after, or create placeholder stubs.)

For a clean intermediate state, create temporary placeholders:

`src/components/olympiad/public/EnrollmentFormNonSalci.tsx`:
```tsx
import type { PublicPaymentContext } from "@/hooks/olympiad/usePublicPaymentContext";
export function EnrollmentFormNonSalci({ context: _ }: { context: Extract<PublicPaymentContext, { found: true }> }) {
  return <div className="surface-card frosted-shadow rounded-card p-6">Non-SALCI form — Task 12 fills this in.</div>;
}
```
Same for `EnrollmentFormSalci.tsx`. These stubs let Task 11 commit cleanly.

---

### Task 12: SubjectPicker + EnrollmentFormNonSalci + EnrollmentFormSalci + PaymentMethodHandoff

**Files:**
- Create: `src/components/olympiad/public/SubjectPicker.tsx`
- Create: `src/components/olympiad/public/PaymentMethodHandoff.tsx`
- Create: `src/hooks/olympiad/useOlympiadEnrollSubmit.ts`
- Modify: `src/components/olympiad/public/EnrollmentFormNonSalci.tsx`
- Modify: `src/components/olympiad/public/EnrollmentFormSalci.tsx`

- [ ] **Step 12.1: `SubjectPicker.tsx`**

```tsx
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

type Props = {
  subjects: Array<{ id: string; name: string }>;
  value: string[];
  onChange: (next: string[]) => void;
  max?: number;
};

export function SubjectPicker({ subjects, value, onChange, max = 3 }: Props) {
  const toggle = (id: string, checked: boolean) => {
    if (checked) {
      if (value.length >= max) return;
      onChange([...new Set([...value, id])]);
    } else {
      onChange(value.filter((v) => v !== id));
    }
  };

  return (
    <div className="grid gap-1.5">
      <Label className="text-xs font-medium text-ink-600">
        Pick exactly {max} subjects (Selected: {value.length}/{max})
      </Label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {subjects.map((s) => {
          const isOn = value.includes(s.id);
          const disabled = !isOn && value.length >= max;
          return (
            <label
              key={s.id}
              className={`flex items-center gap-2 px-3 py-2 rounded-md border text-sm ${
                isOn ? "border-brand-primary bg-brand-primary/5" : "border-surface-stroke"
              } ${disabled ? "opacity-50" : ""}`}
            >
              <Checkbox checked={isOn} disabled={disabled} onCheckedChange={(v) => toggle(s.id, !!v)} />
              <span>{s.name}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 12.2: `useOlympiadEnrollSubmit.ts`**

```ts
import { useMutation } from "@tanstack/react-query";
import { invokeEdgeFunction } from "@/lib/invokeEdgeFunction";
import { toastError } from "@/lib/toast";

export type EnrollFormData = {
  full_name: string;
  date_of_birth: string;       // yyyy-mm-dd
  class_label: string;
  section_label?: string | null;
  grade_level_id?: string | null;
  admission_number?: string | null;
  subject_ids: string[];
  parent_name: string;
  parent_phone: string;
  parent_email?: string | null;
};

export type EnrollSubmitResult = {
  pending_id: string;
  transaction_id: string;
  client_payload: unknown;
  total_paise: number;
  blocked?: false;
};

export type EnrollBlockedResult = {
  blocked: true;
  message: string;
};

export function useOlympiadEnrollSubmit() {
  return useMutation({
    mutationFn: async ({ school_short_code, form_data }: { school_short_code: string; form_data: EnrollFormData }): Promise<EnrollSubmitResult | EnrollBlockedResult> => {
      try {
        return await invokeEdgeFunction<EnrollSubmitResult>("oly-payment-create-order", { school_short_code, form_data });
      } catch (e) {
        // The edge function returns 409 with { blocked: true, message } for duplicates;
        // invokeEdgeFunction unwraps the body — re-check shape.
        const msg = (e as Error).message;
        if (msg.includes("already enrolled")) {
          return { blocked: true, message: msg };
        }
        throw e;
      }
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't start payment.", context: "useOlympiadEnrollSubmit" }),
  });
}
```

- [ ] **Step 12.3: `PaymentMethodHandoff.tsx`**

```tsx
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { getPaymentAdapter } from "@/lib/olympiad/payment";
import type { PayerContact } from "@/lib/olympiad/payment/types";
import { toast } from "sonner";

type Props = {
  pendingId: string;
  clientPayload: unknown;
  payer: PayerContact;
  schoolCode: string;
  onCancel: () => void;
};

export function PaymentMethodHandoff({ pendingId, clientPayload, payer, schoolCode, onCancel }: Props) {
  const navigate = useNavigate();
  const [opening, setOpening] = useState(true);

  useEffect(() => {
    const adapter = getPaymentAdapter();
    adapter.openCheckout({ clientPayload, pendingId, payer })
      .then(() => {
        navigate(`/olympiad/${schoolCode}/success?ref=${pendingId}`);
      })
      .catch((e: Error) => {
        toast.error(e.message || "Payment cancelled");
        setOpening(false);
        onCancel();
      });
  }, [pendingId, clientPayload, payer, schoolCode, navigate, onCancel]);

  return (
    <div className="flex flex-col items-center gap-3 py-8">
      <Loader2 className="h-6 w-6 animate-spin text-brand-primary" />
      <p className="text-sm text-ink-700">{opening ? "Opening payment..." : "Payment cancelled"}</p>
    </div>
  );
}
```

- [ ] **Step 12.4: `EnrollmentFormNonSalci.tsx`**

Replace the placeholder:

```tsx
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SubjectPicker } from "./SubjectPicker";
import { PaymentMethodHandoff } from "./PaymentMethodHandoff";
import { useOlympiadEnrollSubmit } from "@/hooks/olympiad/useOlympiadEnrollSubmit";
import { formatOlympiadFee } from "@/lib/olympiad/money";
import { toast } from "sonner";
import type { PublicPaymentContext } from "@/hooks/olympiad/usePublicPaymentContext";

type Ctx = Extract<PublicPaymentContext, { found: true }>;

export function EnrollmentFormNonSalci({ context }: { context: Ctx }) {
  const submit = useOlympiadEnrollSubmit();
  const [fullName, setFullName] = useState("");
  const [dob, setDob] = useState("");
  const [classLabel, setClassLabel] = useState("");
  const [gradeLevelId, setGradeLevelId] = useState("");
  const [sectionLabel, setSectionLabel] = useState("");
  const [subjectIds, setSubjectIds] = useState<string[]>([]);
  const [parentName, setParentName] = useState("");
  const [parentPhone, setParentPhone] = useState("");
  const [parentEmail, setParentEmail] = useState("");

  const [handoff, setHandoff] = useState<{ pendingId: string; clientPayload: unknown } | null>(null);

  const fee = formatOlympiadFee(context.price_paise, context.gst_percent);
  const subjectsForClass = gradeLevelId ? (context.subjects_per_class[gradeLevelId] ?? []) : [];

  const phoneOk = /^[6-9]\d{9}$/.test(parentPhone);
  const canSubmit =
    fullName.trim() && dob && classLabel && gradeLevelId &&
    subjectIds.length === 3 && parentName.trim() && phoneOk;

  const onClassChange = (gid: string) => {
    setGradeLevelId(gid);
    const g = context.classes.find((c) => c.id === gid);
    setClassLabel(g ? `Class ${g.number}` : "");
    setSubjectIds([]);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    const result = await submit.mutateAsync({
      school_short_code: context.school_short_code,
      form_data: {
        full_name: fullName.trim(),
        date_of_birth: dob,
        class_label: classLabel,
        section_label: sectionLabel.trim() || null,
        grade_level_id: gradeLevelId,
        subject_ids: subjectIds,
        parent_name: parentName.trim(),
        parent_phone: parentPhone,
        parent_email: parentEmail.trim() || null,
      },
    });
    if ("blocked" in result && result.blocked) {
      toast.error(result.message);
      return;
    }
    setHandoff({ pendingId: result.pending_id, clientPayload: result.client_payload });
  };

  if (handoff) {
    return (
      <PaymentMethodHandoff
        pendingId={handoff.pendingId}
        clientPayload={handoff.clientPayload}
        payer={{ name: parentName, email: parentEmail || null, phone: parentPhone }}
        schoolCode={context.school_short_code}
        onCancel={() => setHandoff(null)}
      />
    );
  }

  return (
    <form
      data-dirty={fullName || dob || classLabel ? "true" : "false"}
      onSubmit={onSubmit}
      className="surface-card frosted-shadow rounded-card p-6 space-y-4"
    >
      <header>
        <p className="eyebrow">Enroll for SALCI Olympiad</p>
        <h2 className="text-lg font-bold text-ink-900 mt-1">{context.school_name}</h2>
        <p className="text-xs text-ink-600 mt-1">Fee: {fee.display}</p>
      </header>

      <div className="grid gap-1.5">
        <Label className="text-xs font-medium text-ink-600">Student full name</Label>
        <Input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label className="text-xs font-medium text-ink-600">Date of birth</Label>
          <Input type="date" value={dob} onChange={(e) => setDob(e.target.value)} required />
        </div>
        <div className="grid gap-1.5">
          <Label className="text-xs font-medium text-ink-600">Class</Label>
          <Select value={gradeLevelId} onValueChange={onClassChange}>
            <SelectTrigger><SelectValue placeholder="Pick class" /></SelectTrigger>
            <SelectContent>
              {context.classes.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label className="text-xs font-medium text-ink-600">Section (optional)</Label>
        <Input value={sectionLabel} onChange={(e) => setSectionLabel(e.target.value)} />
      </div>

      {subjectsForClass.length > 0 && (
        <SubjectPicker subjects={subjectsForClass} value={subjectIds} onChange={setSubjectIds} max={3} />
      )}

      <fieldset className="grid gap-2">
        <legend className="text-xs font-medium text-ink-600">Parent contact</legend>
        <Input placeholder="Parent name" value={parentName} onChange={(e) => setParentName(e.target.value)} required />
        <Input placeholder="Phone (10 digits)" value={parentPhone}
          onChange={(e) => setParentPhone(e.target.value.replace(/\D/g, "").slice(0, 10))} required />
        <Input type="email" placeholder="Email (optional)" value={parentEmail}
          onChange={(e) => setParentEmail(e.target.value)} />
        {parentPhone && !phoneOk && <p className="text-[11px] text-red-500">Enter a 10-digit Indian mobile (starts with 6-9)</p>}
      </fieldset>

      <Button type="submit" disabled={!canSubmit || submit.isPending} className="w-full bg-brand-primary text-white">
        {submit.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        Pay {fee.totalRupees}
      </Button>
    </form>
  );
}
```

- [ ] **Step 12.5: `EnrollmentFormSalci.tsx`**

```tsx
import { useState } from "react";
import { Loader2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SubjectPicker } from "./SubjectPicker";
import { PaymentMethodHandoff } from "./PaymentMethodHandoff";
import { useOlympiadEnrollSubmit } from "@/hooks/olympiad/useOlympiadEnrollSubmit";
import { formatOlympiadFee } from "@/lib/olympiad/money";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { PublicPaymentContext } from "@/hooks/olympiad/usePublicPaymentContext";

type Ctx = Extract<PublicPaymentContext, { found: true }>;
type LookupResult = { found: true; profile_id: string; full_name: string; date_of_birth: string | null; class_name: string | null } | { found: false };

export function EnrollmentFormSalci({ context }: { context: Ctx }) {
  const submit = useOlympiadEnrollSubmit();
  const [admissionNumber, setAdmissionNumber] = useState("");
  const [lookup, setLookup] = useState<LookupResult | null>(null);
  const [lookupBusy, setLookupBusy] = useState(false);

  const [dob, setDob] = useState("");
  const [gradeLevelId, setGradeLevelId] = useState("");
  const [classLabel, setClassLabel] = useState("");
  const [sectionLabel, setSectionLabel] = useState("");
  const [subjectIds, setSubjectIds] = useState<string[]>([]);
  const [parentName, setParentName] = useState("");
  const [parentPhone, setParentPhone] = useState("");
  const [parentEmail, setParentEmail] = useState("");
  const [handoff, setHandoff] = useState<{ pendingId: string; clientPayload: unknown } | null>(null);

  const fee = formatOlympiadFee(context.price_paise, context.gst_percent);

  const doLookup = async () => {
    if (!admissionNumber.trim()) return;
    setLookupBusy(true);
    try {
      const { data, error } = await supabase.rpc("oly_lookup_salci_student", {
        p_school_short_code: context.school_short_code,
        p_admission_number: admissionNumber.trim(),
      });
      if (error) throw error;
      const result = data as LookupResult;
      setLookup(result);
      if (result.found) {
        if (result.date_of_birth) setDob(result.date_of_birth);
        // Try to match class_name to one of the offered classes
        const classMatch = context.classes.find((c) => result.class_name?.toLowerCase().includes(`${c.number}`));
        if (classMatch) {
          setGradeLevelId(classMatch.id);
          setClassLabel(`Class ${classMatch.number}`);
        }
      } else {
        toast.error("Student admission number not recognized. Please contact your school to ensure the student is registered before enrolling for the Olympiad.");
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLookupBusy(false);
    }
  };

  const subjectsForClass = gradeLevelId ? (context.subjects_per_class[gradeLevelId] ?? []) : [];
  const phoneOk = /^[6-9]\d{9}$/.test(parentPhone);
  const canSubmit =
    lookup?.found && admissionNumber && dob && classLabel && gradeLevelId &&
    subjectIds.length === 3 && parentName.trim() && phoneOk;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || !lookup?.found) return;
    const result = await submit.mutateAsync({
      school_short_code: context.school_short_code,
      form_data: {
        full_name: lookup.full_name,
        date_of_birth: dob,
        class_label: classLabel,
        section_label: sectionLabel.trim() || null,
        grade_level_id: gradeLevelId,
        admission_number: admissionNumber.trim(),
        subject_ids: subjectIds,
        parent_name: parentName.trim(),
        parent_phone: parentPhone,
        parent_email: parentEmail.trim() || null,
      },
    });
    if ("blocked" in result && result.blocked) {
      toast.error(result.message);
      return;
    }
    setHandoff({ pendingId: result.pending_id, clientPayload: result.client_payload });
  };

  if (handoff) {
    return (
      <PaymentMethodHandoff
        pendingId={handoff.pendingId}
        clientPayload={handoff.clientPayload}
        payer={{ name: parentName, email: parentEmail || null, phone: parentPhone }}
        schoolCode={context.school_short_code}
        onCancel={() => setHandoff(null)}
      />
    );
  }

  return (
    <form
      data-dirty={admissionNumber || parentName || subjectIds.length > 0 ? "true" : "false"}
      onSubmit={onSubmit}
      className="surface-card frosted-shadow rounded-card p-6 space-y-4"
    >
      <header>
        <p className="eyebrow">Enroll for SALCI Olympiad</p>
        <h2 className="text-lg font-bold text-ink-900 mt-1">{context.school_name}</h2>
        <p className="text-xs text-ink-600 mt-1">Fee: {fee.display}</p>
      </header>

      <div className="grid gap-1.5">
        <Label className="text-xs font-medium text-ink-600">Student admission number</Label>
        <div className="flex gap-2">
          <Input value={admissionNumber} onChange={(e) => setAdmissionNumber(e.target.value)} required />
          <Button type="button" variant="outline" disabled={lookupBusy || !admissionNumber.trim()} onClick={doLookup}>
            {lookupBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Find"}
          </Button>
        </div>
      </div>

      {lookup?.found && (
        <>
          <div className="rounded-md border border-emerald-200 bg-emerald-50 dark:bg-emerald-500/10 p-3">
            <div className="flex items-center gap-2 text-sm text-emerald-900 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4" /> Student found: <span className="font-semibold">{lookup.full_name}</span>
            </div>
            {lookup.class_name && <p className="text-[11px] text-emerald-800 dark:text-emerald-400 mt-1">Class: {lookup.class_name}</p>}
          </div>

          {!lookup.date_of_birth && (
            <div className="grid gap-1.5">
              <Label className="text-xs font-medium text-ink-600">Date of birth (we'll add this to the student record)</Label>
              <Input type="date" value={dob} onChange={(e) => setDob(e.target.value)} required />
            </div>
          )}

          <div className="grid gap-1.5">
            <Label className="text-xs font-medium text-ink-600">Section (optional)</Label>
            <Input value={sectionLabel} onChange={(e) => setSectionLabel(e.target.value)} />
          </div>

          {!gradeLevelId && (
            <div className="grid gap-1.5">
              <Label className="text-xs font-medium text-ink-600">Confirm class</Label>
              <Select value={gradeLevelId} onValueChange={(v) => {
                setGradeLevelId(v);
                const g = context.classes.find((c) => c.id === v);
                setClassLabel(g ? `Class ${g.number}` : "");
                setSubjectIds([]);
              }}>
                <SelectTrigger><SelectValue placeholder="Pick class" /></SelectTrigger>
                <SelectContent>
                  {context.classes.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          {subjectsForClass.length > 0 && (
            <SubjectPicker subjects={subjectsForClass} value={subjectIds} onChange={setSubjectIds} max={3} />
          )}

          <fieldset className="grid gap-2">
            <legend className="text-xs font-medium text-ink-600">Parent contact</legend>
            <Input placeholder="Parent name" value={parentName} onChange={(e) => setParentName(e.target.value)} required />
            <Input placeholder="Phone (10 digits)" value={parentPhone}
              onChange={(e) => setParentPhone(e.target.value.replace(/\D/g, "").slice(0, 10))} required />
            <Input type="email" placeholder="Email (optional)" value={parentEmail}
              onChange={(e) => setParentEmail(e.target.value)} />
            {parentPhone && !phoneOk && <p className="text-[11px] text-red-500">Enter a 10-digit Indian mobile (starts with 6-9)</p>}
          </fieldset>

          <Button type="submit" disabled={!canSubmit || submit.isPending} className="w-full bg-brand-primary text-white">
            {submit.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Pay {fee.totalRupees}
          </Button>
        </>
      )}
    </form>
  );
}
```

- [ ] **Step 12.6: Verify + commit**

```bash
npx tsc --noEmit
npx eslint src/components/olympiad/public/ src/hooks/olympiad/useOlympiadEnrollSubmit.ts
npx vite build
git add src/components/olympiad/public/ src/hooks/olympiad/useOlympiadEnrollSubmit.ts
git commit -m "feat(olympiad): public enrollment forms (non-SALCI + SALCI) + subject picker + payment handoff"
```

---

### Task 13: Payment success page with polling

**Files:**
- Create: `src/hooks/olympiad/useOlympiadPaymentStatus.ts`
- Create: `src/pages/public/OlympiadPaymentSuccessPage.tsx`

- [ ] **Step 13.1: Status polling hook**

```ts
// src/hooks/olympiad/useOlympiadPaymentStatus.ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type PaymentStatus = {
  status: "payment_pending" | "paid" | "failed" | "abandoned";
  promoted_student_id: string | null;
  roll_number: string | null;
};

export function useOlympiadPaymentStatus(pendingId: string | null) {
  return useQuery({
    queryKey: ["olympiad", "payment-status", pendingId],
    queryFn: async (): Promise<PaymentStatus> => {
      if (!pendingId) return { status: "payment_pending", promoted_student_id: null, roll_number: null };
      const { data, error } = await supabase
        .from("oly_enrollment_pending")
        .select("status, promoted_student_id, oly_students(roll_number)")
        .eq("id", pendingId)
        .single();
      if (error) throw error;
      const student = Array.isArray(data.oly_students) ? data.oly_students[0] : data.oly_students;
      return {
        status: data.status as PaymentStatus["status"],
        promoted_student_id: data.promoted_student_id,
        roll_number: (student as { roll_number?: string } | null)?.roll_number ?? null,
      };
    },
    enabled: !!pendingId,
    staleTime: 0,
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === "paid" || s === "failed" || s === "abandoned" ? false : 3000;
    },
    refetchIntervalInBackground: true,
  });
}
```

- [ ] **Step 13.2: Success page**

```tsx
// src/pages/public/OlympiadPaymentSuccessPage.tsx
import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { CheckCircle2, Loader2, AlertCircle } from "lucide-react";
import { OlympiadPublicLayout } from "@/components/olympiad/public/OlympiadPublicLayout";
import { useOlympiadPaymentStatus } from "@/hooks/olympiad/useOlympiadPaymentStatus";

export default function OlympiadPaymentSuccessPage() {
  const { schoolCode: _ } = useParams();
  const [params] = useSearchParams();
  const pendingId = params.get("ref");
  const { data, isLoading } = useOlympiadPaymentStatus(pendingId);

  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), 90_000);
    return () => clearTimeout(t);
  }, []);

  return (
    <OlympiadPublicLayout>
      <div className="surface-card frosted-shadow rounded-card p-8 text-center space-y-4">
        {isLoading || (!data || (data.status === "payment_pending" && !timedOut)) ? (
          <>
            <Loader2 className="h-8 w-8 animate-spin text-brand-primary mx-auto" />
            <h1 className="text-lg font-bold text-ink-900">Confirming your payment</h1>
            <p className="text-sm text-ink-600">This usually takes a few seconds.</p>
          </>
        ) : data?.status === "paid" && data.roll_number ? (
          <>
            <CheckCircle2 className="h-12 w-12 text-emerald-500 mx-auto" />
            <h1 className="text-lg font-bold text-ink-900">Enrollment confirmed</h1>
            <div className="rounded-md border border-surface-stroke bg-surface-card p-4">
              <p className="eyebrow">Roll number</p>
              <p className="text-xl font-bold text-ink-900 mt-1 tracking-wider">{data.roll_number}</p>
            </div>
            <p className="text-sm text-ink-600">A receipt with login credentials has been emailed to you (if you provided an email).</p>
          </>
        ) : (
          <>
            <AlertCircle className="h-8 w-8 text-amber-500 mx-auto" />
            <h1 className="text-lg font-bold text-ink-900">We're still confirming your payment</h1>
            <p className="text-sm text-ink-600">Check your email shortly, or contact your school if you don't receive a receipt within 30 minutes.</p>
          </>
        )}
      </div>
    </OlympiadPublicLayout>
  );
}
```

- [ ] **Step 13.3: Verify + commit**

```bash
npx tsc --noEmit
npx eslint src/hooks/olympiad/useOlympiadPaymentStatus.ts src/pages/public/OlympiadPaymentSuccessPage.tsx
npx vite build
git add src/hooks/olympiad/useOlympiadPaymentStatus.ts src/pages/public/OlympiadPaymentSuccessPage.tsx
git commit -m "feat(olympiad): payment success page with status polling"
```

(Note: the polling interval is 3s only DURING active confirmation. Once status is terminal it stops. The 90s timeout caps the spinner. This complies with §23.2 — `refetchInterval` <30s has explicit justification: "watching gateway confirmation, expected to terminate within seconds".)

---

## Section E — Receipts + refunds

### Task 14: Edge function — `oly-receipt-generate`

**Files:**
- Create: `supabase/functions/oly-receipt-generate/index.ts`

- [ ] **Step 14.1: Implement**

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
    // @ts-expect-error Deno.env
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    // @ts-expect-error Deno.env
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    // @ts-expect-error Deno.env
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const supabase = createClient(supabaseUrl, serviceKey);

    const { oly_student_id } = (await req.json()) as { oly_student_id: string };

    // Fetch student + school + campaign + receipt context
    const { data: student, error: sErr } = await supabase
      .from("oly_students")
      .select(`
        id, full_name, roll_number, class_label, section_label, subject_ids, parent_email, enrolled_at, enrollment_channel,
        oly_school_id, campaign_id,
        oly_schools ( institution_id, school_short_code, institutions ( name ) ),
        oly_campaigns:campaign_id ( campaign_year, gstin )
      `)
      .eq("id", oly_student_id)
      .single();
    if (sErr || !student) return json({ error: "Student not found" }, 404);

    const school = Array.isArray(student.oly_schools) ? student.oly_schools[0] : student.oly_schools;
    const campaign = Array.isArray(student.oly_campaigns) ? student.oly_campaigns[0] : student.oly_campaigns;
    const inst = Array.isArray((school as { institutions?: unknown[] })?.institutions)
      ? ((school as { institutions: { name: string }[] }).institutions[0])
      : ((school as { institutions: { name: string } }).institutions);
    const schoolName = inst?.name ?? "Unknown school";
    const campaignYear = (campaign as { campaign_year?: number })?.campaign_year ?? new Date().getFullYear();
    const gstin = (campaign as { gstin?: string | null })?.gstin ?? "";

    // Fetch pending row for amount + gateway info
    const { data: pending } = await supabase
      .from("oly_enrollment_pending")
      .select("amount_paise, gst_paise, total_paise, gateway_payment_id")
      .eq("promoted_student_id", oly_student_id)
      .maybeSingle();

    const amountPaise = pending?.amount_paise ?? 0;
    const gstPaise = pending?.gst_paise ?? 0;
    const totalPaise = pending?.total_paise ?? 0;
    const gatewayPaymentId = pending?.gateway_payment_id ?? "";
    const isOnline = student.enrollment_channel === "parent_online";

    // Fetch subject names
    const { data: subjects } = await supabase
      .from("oly_subjects")
      .select("name")
      .in("id", student.subject_ids ?? []);
    const subjectNames = (subjects ?? []).map((s) => s.name).join(", ");

    // Generate receipt number
    const { data: receiptNumberData } = await supabase.rpc("oly_next_receipt_number", { p_year: campaignYear });
    const receiptNumber = (receiptNumberData as string) ?? `RCPT-${campaignYear}-UNKNOWN`;

    // Build PDF
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595, 842]);  // A4
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    let y = 800;
    const line = (text: string, size: number, x: number = 50, bold = false, color: [number, number, number] = [0.1, 0.1, 0.15]) => {
      page.drawText(text, { x, y, size, font: bold ? fontBold : font, color: rgb(color[0], color[1], color[2]) });
      y -= size + 4;
    };

    line("SALCI OLYMPIAD", 22, 50, true, [0.14, 0.61, 0.64]);
    line(`${campaignYear} — Enrollment Receipt`, 12, 50, false);
    y -= 10;
    if (gstin) { line(`GSTIN: ${gstin}`, 10, 50, false, [0.4, 0.4, 0.45]); y -= 4; }

    line(`Receipt No: ${receiptNumber}`, 11, 50, true);
    line(`Issued: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`, 10, 50, false);
    y -= 16;

    line("School", 11, 50, true);
    line(schoolName, 11, 50, false);
    y -= 12;

    line("Student", 11, 50, true);
    line(`${student.full_name}`, 11, 50, false);
    line(`Roll: ${student.roll_number}   Class: ${student.class_label}${student.section_label ? " - " + student.section_label : ""}`, 10, 50, false);
    y -= 12;

    line("Subjects chosen", 11, 50, true);
    line(subjectNames, 10, 50, false);
    y -= 16;

    line("Fee breakdown", 11, 50, true);
    const rs = (p: number) => `₹${(p / 100).toFixed(2)}`;
    line(`Base fee:           ${rs(amountPaise)}`, 11, 50, false);
    line(`GST:                ${rs(gstPaise)}`, 11, 50, false);
    page.drawLine({ start: { x: 50, y: y + 4 }, end: { x: 320, y: y + 4 }, thickness: 1, color: rgb(0.7, 0.7, 0.75) });
    y -= 4;
    line(`Total:              ${rs(totalPaise)}`, 12, 50, true);
    y -= 12;

    line("Payment method", 11, 50, true);
    line(isOnline ? `Online (ref: ${gatewayPaymentId || "n/a"})` : "Cash (collected by teacher)", 11, 50, false);

    y = 60;
    line("This is a system-generated receipt. For queries, contact your school administration.", 9, 50, false, [0.5, 0.5, 0.55]);

    const pdfBytes = await pdfDoc.save();
    const storagePath = `${oly_student_id}.pdf`;

    const { error: upErr } = await supabase.storage.from("olympiad-receipts").upload(storagePath, pdfBytes, {
      contentType: "application/pdf",
      upsert: true,
    });
    if (upErr) return json({ error: `Storage upload failed: ${upErr.message}` }, 500);

    // Insert receipts row
    const { data: receiptRow, error: rErr } = await supabase
      .from("oly_receipts")
      .insert({
        oly_student_id,
        receipt_number: receiptNumber,
        storage_path: `olympiad-receipts/${storagePath}`,
        amount_paise: amountPaise,
        gst_paise: gstPaise,
        total_paise: totalPaise,
        payment_method: isOnline ? "online" : "cash",
        gateway_payment_id: isOnline ? gatewayPaymentId : null,
        gateway_reference: isOnline ? gatewayPaymentId : null,
      })
      .select("id")
      .single();
    if (rErr) return json({ error: `Receipt row insert failed: ${rErr.message}` }, 500);

    // Email if parent_email present + Resend configured
    if (student.parent_email && resendKey) {
      const { data: signedUrlData } = await supabase.storage
        .from("olympiad-receipts")
        .createSignedUrl(storagePath, 60 * 60 * 24 * 7);  // 7 days for the email link

      const emailRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "SALCI Olympiad <noreply@salci.org>",
          to: student.parent_email,
          subject: `SALCI Olympiad ${campaignYear} — Enrollment confirmed (${student.roll_number})`,
          html: `<p>Hello,</p>
<p>Thank you for enrolling <strong>${student.full_name}</strong> for the SALCI Olympiad ${campaignYear}.</p>
<p><strong>Roll number:</strong> ${student.roll_number}<br/>
<strong>Receipt:</strong> ${receiptNumber}<br/>
<strong>Amount:</strong> ${rs(totalPaise)}</p>
<p><a href="${signedUrlData?.signedUrl ?? "#"}">Download your receipt</a> (valid for 7 days)</p>
<p>Login on exam day with your roll number and date of birth (ddmmyy format).</p>
<p>Best regards,<br/>Team SALCI</p>`,
        }),
      });
      if (emailRes.ok) {
        await supabase.from("oly_receipts").update({
          emailed_at: new Date().toISOString(),
          emailed_to: student.parent_email,
        }).eq("id", receiptRow.id);
      }
    }

    return json({ ok: true, receipt_id: receiptRow.id, receipt_number: receiptNumber }, 200);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
```

- [ ] **Step 14.2: Deploy + commit**

```bash
npx supabase@latest functions deploy oly-receipt-generate --project-ref gyymkgohcijeksmrzuyw
git add supabase/functions/oly-receipt-generate/
git commit -m "feat(olympiad): oly-receipt-generate edge function (pdf-lib + Resend)"
```

---

### Task 15: Edge function — `oly-refund-issue` + super admin refund UI

**Files:**
- Create: `supabase/functions/oly-refund-issue/index.ts`
- Create: `src/hooks/olympiad/useOlympiadRefund.ts`
- Create: `src/components/olympiad/admin/RefundConfirmDialog.tsx`

- [ ] **Step 15.1: Edge function**

```ts
// supabase/functions/oly-refund-issue/index.ts
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
    const adapter = (Deno.env.get("OLY_PAYMENT_ADAPTER") ?? "stub").toLowerCase();
    const supabase = createClient(supabaseUrl, serviceKey);

    const userRes = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    const userId = userRes.data.user?.id;
    if (!userId) return json({ error: "Forbidden" }, 403);
    const { data: isSuper } = await supabase.rpc("is_super_admin", { user_id: userId });
    if (!isSuper) return json({ error: "Forbidden" }, 403);

    const { scope, oly_student_id, oly_school_id, reason } = (await req.json()) as {
      scope: "per_student" | "school_wide";
      oly_student_id?: string;
      oly_school_id?: string;
      reason: string;
    };
    if (!reason?.trim()) return json({ error: "Reason required" }, 400);

    // Resolve target students
    let studentIds: string[];
    if (scope === "per_student") {
      if (!oly_student_id) return json({ error: "oly_student_id required" }, 400);
      studentIds = [oly_student_id];
    } else {
      if (!oly_school_id) return json({ error: "oly_school_id required" }, 400);
      const { data: list } = await supabase
        .from("oly_students")
        .select("id")
        .eq("oly_school_id", oly_school_id)
        .eq("status", "active");
      studentIds = (list ?? []).map((r) => r.id);
    }

    const results: Array<{ student_id: string; status: string; refundId?: string; error?: string }> = [];

    for (const sid of studentIds) {
      const { data: pending } = await supabase
        .from("oly_enrollment_pending")
        .select("gateway_payment_id, gateway_order_id, total_paise")
        .eq("promoted_student_id", sid)
        .maybeSingle();

      const isCash = !pending?.gateway_payment_id;
      const amountPaise = pending?.total_paise ?? 0;

      let gatewayRefundId: string | null = null;
      let refundStatus: "pending" | "completed" | "failed" | "offline" = "pending";

      if (isCash) {
        refundStatus = "offline";
      } else if (adapter === "razorpay" && pending?.gateway_payment_id) {
        // @ts-expect-error Deno.env
        const keyId = Deno.env.get("RAZORPAY_KEY_ID")!;
        // @ts-expect-error Deno.env
        const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET")!;
        const auth = btoa(`${keyId}:${keySecret}`);
        const res = await fetch(`https://api.razorpay.com/v1/payments/${pending.gateway_payment_id}/refund`, {
          method: "POST",
          headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
          body: JSON.stringify({ amount: amountPaise, notes: { reason } }),
        });
        if (res.ok) {
          const body = await res.json() as { id: string; status: string };
          gatewayRefundId = body.id;
          refundStatus = body.status === "processed" ? "completed" : "pending";
        } else {
          refundStatus = "failed";
        }
      } else {
        // stub: always succeeds
        gatewayRefundId = `stub_refund_${crypto.randomUUID()}`;
        refundStatus = "completed";
      }

      const { data: refundRow } = await supabase
        .from("oly_refunds")
        .insert({
          oly_student_id: sid,
          initiated_by: userId,
          reason,
          scope,
          amount_paise: amountPaise,
          gateway_refund_id: gatewayRefundId,
          status: refundStatus,
          completed_at: refundStatus === "completed" ? new Date().toISOString() : null,
        })
        .select("id")
        .single();

      await supabase.from("oly_students").update({ status: "refunded" }).eq("id", sid);

      results.push({ student_id: sid, status: refundStatus, refundId: refundRow?.id });
    }

    return json({ ok: true, processed: results.length, results }, 200);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
```

Deploy:
```bash
npx supabase@latest functions deploy oly-refund-issue --project-ref gyymkgohcijeksmrzuyw
```

- [ ] **Step 15.2: `useOlympiadRefund.ts`**

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invokeEdgeFunction } from "@/lib/invokeEdgeFunction";
import { toastError } from "@/lib/toast";
import { toast } from "sonner";

export type RefundInput = {
  scope: "per_student" | "school_wide";
  oly_student_id?: string;
  oly_school_id?: string;
  reason: string;
};

export function useOlympiadRefund() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: RefundInput) => {
      return invokeEdgeFunction<{ ok: true; processed: number }>("oly-refund-issue", input);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["olympiad"] });
      toast.success(`Refund processed for ${data.processed} student${data.processed === 1 ? "" : "s"}`);
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't issue refund.", context: "useOlympiadRefund" }),
  });
}
```

- [ ] **Step 15.3: `RefundConfirmDialog.tsx`**

```tsx
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { useOlympiadRefund, type RefundInput } from "@/hooks/olympiad/useOlympiadRefund";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  input: Omit<RefundInput, "reason">;
  contextLabel: string;            // e.g. "Refund this student?" or "Cancel school + refund 42 students?"
  confirmWord?: string;            // typed-confirmation for school_wide
};

export function RefundConfirmDialog({ open, onOpenChange, input, contextLabel, confirmWord }: Props) {
  const refund = useOlympiadRefund();
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");

  const canSubmit = reason.trim() && (!confirmWord || typed === confirmWord);

  const onConfirm = async () => {
    try {
      await refund.mutateAsync({ ...input, reason: reason.trim() });
      onOpenChange(false);
      setReason(""); setTyped("");
    } catch { /* toast fires */ }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{contextLabel}</AlertDialogTitle>
          <AlertDialogDescription>
            This is permanent. Online payments will be refunded via the gateway. Cash payments are flagged "offline" for the school to handle physically.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="grid gap-3 py-2">
          <div className="grid gap-1.5">
            <Label className="text-xs font-medium text-ink-600">Reason (required)</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
          </div>
          {confirmWord && (
            <div className="grid gap-1.5">
              <Label className="text-xs font-medium text-ink-600">Type {confirmWord} to confirm</Label>
              <Input value={typed} onChange={(e) => setTyped(e.target.value)} />
            </div>
          )}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={!canSubmit || refund.isPending} onClick={onConfirm}>
            {refund.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Confirm refund
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

(Wire RefundConfirmDialog from the school detail page in a follow-up — for Phase 2 it's enough to have the building blocks; the schools detail page can expose a "Cancel school + refund all" button right after Task 15.)

- [ ] **Step 15.4: Wire `RefundConfirmDialog` into `OlympiadSchoolDetailPage`**

In `src/pages/admin/olympiad/OlympiadSchoolDetailPage.tsx`, add a Refund button + dialog:

```tsx
// At top:
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { RefundConfirmDialog } from "@/components/olympiad/admin/RefundConfirmDialog";

// Inside the component:
const [refundOpen, setRefundOpen] = useState(false);

// Add this section near the bottom of the rendered output, after the primary contact card:
<section className="surface-card frosted-shadow rounded-card p-4 space-y-2">
  <p className="eyebrow">Danger zone</p>
  <p className="text-xs text-ink-600">Cancel this school and refund every active student. Cash enrollments are flagged "offline" for the school to refund physically.</p>
  <Button variant="destructive" disabled={school.enrolled_count === 0} onClick={() => setRefundOpen(true)}>
    Cancel school + refund {school.enrolled_count} student{school.enrolled_count === 1 ? "" : "s"}
  </Button>
</section>

<RefundConfirmDialog
  open={refundOpen}
  onOpenChange={setRefundOpen}
  input={{ scope: "school_wide", oly_school_id: school.id }}
  contextLabel={`Cancel ${school.institution_name} and refund ${school.enrolled_count} students?`}
  confirmWord="REFUND"
/>
```

- [ ] **Step 15.5: Verify + commit**

```bash
npx tsc --noEmit
npx eslint src/hooks/olympiad/useOlympiadRefund.ts src/components/olympiad/admin/RefundConfirmDialog.tsx src/pages/admin/olympiad/OlympiadSchoolDetailPage.tsx
npx vite build
git add supabase/functions/oly-refund-issue/ src/hooks/olympiad/useOlympiadRefund.ts src/components/olympiad/admin/RefundConfirmDialog.tsx src/pages/admin/olympiad/OlympiadSchoolDetailPage.tsx
git commit -m "feat(olympiad): refund flow - edge function, hook, school-wide dialog wired"
```

---

## Section F — Verification

### Task 16: Full §5a contract sweep + manual smoke checklist

- [ ] **Step 16.1: Run the full §5a contract over all Phase 2 paths**

```bash
npx tsc --noEmit
npx eslint "src/{hooks,components,pages,lib}/olympiad/**" "src/App.tsx" "src/pages/public/**"
npx vite build
```
All three exit 0.

- [ ] **Step 16.2: Manual smoke (controller / user — agents can't drive a browser)**

Walk through with `OLY_PAYMENT_ADAPTER` env var unset (defaults to stub):

1. **Super admin** logs in → `/admin/olympiad/schools` → "Onboard school"
   - Try NEW school path → fill form → submit → see post-onboarding sheet with QR + URL
   - Verify the school appears in the list with status "Open" and "0 enrolled"
2. **Open the public URL** in a new tab `/olympiad/{shortCode}` (no auth)
   - Sees school name, fee breakdown
   - Clicks "Enroll student" → form opens
   - Fills full form, picks 3 subjects, clicks "Pay ₹590"
   - Stub adapter auto-completes → redirects to /success?ref=...
   - Polls until status flips → shows roll number
3. **Check receipt**: Supabase Storage UI → `olympiad-receipts` bucket → confirm PDF uploaded
4. **Check email** (if Resend configured): parent receives an email with download link
5. **Try duplicate enrollment** with same name + DOB + class → blocked with the existing-enrollment message
6. **Verify ROLL NUMBER format** matches `SO{YY}-{SCHOOL_CODE}-{CLASS}-{SEQ}` with 4-digit padding
7. **Super admin** opens school detail page → sees 1 enrolled → revenue card shows ₹590
8. **Cancel school** → confirmation dialog with "REFUND" word + reason → confirm → student status flips to "refunded"

For Razorpay test mode, set `OLY_PAYMENT_ADAPTER=razorpay` in `.env` and edge function secrets, configure Razorpay webhook URL to point at the deployed `oly-payment-webhook`, repeat steps 1-8 with test cards.

- [ ] **Step 16.3: Commit any smoke-test fixes**

```bash
git status
git add <fix-files>
git commit -m "fix(olympiad): phase 2 smoke-test cleanups"
```

---

## Self-Review Summary

- **Spec coverage:** every Phase 2 spec requirement maps to a task:
  - §2 schema → T1
  - §3 onboard form → T7-T9
  - §4 public page → T11-T13
  - §5 payment adapter → T2-T6
  - §6 receipt PDF → T14
  - §7 refunds → T15
  - §9 acceptance criteria → T16
- **Placeholders:** none. Every code block is complete or explicitly marked as an adaptation point ("if MobileSheet prop is named X").
- **Type consistency:** `OnboardSchoolInput`, `EnrollFormData`, `PaymentStatus`, `PublicPaymentContext`, `OlympiadSchoolRow`, `SchoolDetail` types are declared once per file and consumed by name elsewhere. `FrontendPaymentAdapter.openCheckout` signature matches between stub and Razorpay implementations.
- **Known adaptation points called out in code blocks:**
  - `MobileSheet` `subtitle` vs `description` (established in Phase 1 — implementer matches actual signature)
  - `EmptyState` `action` prop shape (established in Phase 1 — `{ label, onClick, icon? }`)
  - `StatTile` / `StatTileGrid` prop shapes (verify against existing usage in Phase 1)
  - `Select` from shadcn — `value` cannot be empty string (use sentinel like `__none`)
  - Razorpay test keys / webhook secret — controller / operator provisions, not the implementer
  - `salci.profiles.admission_number` confirmed exists (verified before plan was written)
  - `qrcode.react@3.2` confirmed installed (`qrcode.react` is the React-friendly wrapper)
  - `pdf-lib` confirmed installed (used by existing `studentReport.ts`)
  - `Resend` pattern confirmed (used by `send-welcome-email` + others)

If during execution any primitive API actually differs, match the existing source-of-truth and continue — same convention as Phase 1.
