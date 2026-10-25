# SALCI Olympiad Phase 2 — School Onboarding + Parent Enrollment + Payment Design

**Status:** Draft v1
**Date:** 2026-05-26
**Parent doc:** [2026-05-26-olympiad-master-decomposition-design.md](./2026-05-26-olympiad-master-decomposition-design.md)
**Source:** SALCI_Olympiad_Build_Prompt2.docx (Phase 2)
**Depends on:** Phase 1 (catalog must exist before schools can enroll)

This phase delivers the channel through which schools join the Olympiad and parents enroll students. After Phase 2, a super admin can onboard a school in five minutes, a parent at that school can pay online via QR/link, and a receipt is automatically emailed.

---

## 1. Scope

In:

- DB schema for `oly_students`, `oly_enrollment_pending`, `oly_receipts` tables + RLS + storage bucket `olympiad-receipts`
- Super admin "Onboard New School" form (replaces the disabled button on the Phase 1 Schools tab)
- Auto-provisioning of new (non-SALCI) Olympiad-only institutions: institution row + school_admin auth user + set-password email + olympiad-only feature flag set
- Existing-SALCI-school onboarding path: pick from dropdown, enable `olympiad` feature flag, insert `oly_schools` row
- Per-school public payment URL `/olympiad/:schoolCode` + downloadable QR code PNG
- Public parent payment page (route outside `ProtectedRoute`, no AppLayout chrome)
- Public RPC `oly_get_public_school_payment_context(school_code)` returning narrowly-scoped public data
- Enrollment forms for both new and existing SALCI schools, with duplicate detection
- `PaymentGatewayAdapter` TypeScript interface + `StubPaymentAdapter` + `RazorpayAdapter` (test mode)
- Edge functions: `oly-payment-create-order`, `oly-payment-webhook`, `oly-receipt-generate`, `oly-refund-issue`, `oly-onboard-school`
- Roll number generation via DB RPC, format `SO{YY}-{SCHOOL_CODE}-{CLASS}-{SEQ}`
- Receipt PDF generation (server-side via `pdf-lib`, stored in storage, auto-emailed via Resend)
- Refund flow: super admin can trigger per-student or school-wide refund

Out (deferred):

- School admin / teacher portals (Phase 3 — includes the school's own view of enrolled students, batching, PIN custody, etc.)
- Cash enrollment by teachers (Phase 3)
- Exam delivery (Phase 4)
- Results pipeline + dormancy (Phase 5)

---

## 2. Database schema (additive migration)

One migration file: `supabase/migrations/<timestamp>_oly_phase_2_enrollment.sql`.

### 2.1 `oly_students`

```sql
create table public.oly_students (
  id uuid primary key default gen_random_uuid(),
  oly_school_id uuid not null references public.oly_schools(id) on delete cascade,
  campaign_id uuid not null references public.oly_campaigns(id) on delete restrict,

  -- Linkage to existing SALCI student profile, if applicable
  profile_id uuid references public.profiles(id) on delete set null,

  -- Identity (cleared on Day 60 PII purge per master spec §8)
  full_name text not null,
  date_of_birth date not null,
  class_label text not null,            -- e.g. "Class 8" (free text per docx; class is institution-level for SALCI students)
  section_label text,                   -- optional, parent enters
  grade_level_id uuid references public.grade_levels(id) on delete restrict,  -- resolved from class_label
  admission_number text,                -- only populated for existing-SALCI students

  -- Roll number — institution-scoped sequential
  roll_number text not null unique,

  -- Subjects chosen (exactly 3 per docx)
  subject_ids uuid[] not null check (cardinality(subject_ids) = 3),

  -- Parent contact (cleared on Day 60 purge)
  parent_name text not null,
  parent_phone text not null,
  parent_email text,

  -- Lifecycle
  status text not null default 'active'
    check (status in ('active', 'dormant', 'archived', 'refunded', 'removed')),
  enrolled_at timestamptz not null default now(),
  enrollment_channel text not null
    check (enrollment_channel in ('parent_online', 'teacher_cash')),

  -- Audit
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
```

### 2.2 `oly_enrollment_pending`

```sql
create table public.oly_enrollment_pending (
  id uuid primary key default gen_random_uuid(),
  oly_school_id uuid not null references public.oly_schools(id) on delete cascade,
  campaign_id uuid not null references public.oly_campaigns(id) on delete restrict,

  -- The same fields oly_students would carry on success
  full_name text not null,
  date_of_birth date not null,
  class_label text not null,
  section_label text,
  grade_level_id uuid references public.grade_levels(id),
  admission_number text,
  subject_ids uuid[] not null check (cardinality(subject_ids) = 3),
  parent_name text not null,
  parent_phone text not null,
  parent_email text,

  -- Payment state
  status text not null default 'payment_pending'
    check (status in ('payment_pending', 'paid', 'failed', 'abandoned')),
  gateway_order_id text,                -- Razorpay order_id or stub equivalent
  gateway_payment_id text,              -- only set on success
  gateway_signature text,               -- webhook signature, for audit
  failure_reason text,
  amount_paise integer not null check (amount_paise > 0),
  gst_paise integer not null check (gst_paise >= 0),
  total_paise integer not null check (total_paise > 0),

  -- Promotion linkage
  promoted_student_id uuid references public.oly_students(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_oep_school on public.oly_enrollment_pending(oly_school_id);
create index idx_oep_campaign on public.oly_enrollment_pending(campaign_id);
create index idx_oep_status on public.oly_enrollment_pending(status);
create index idx_oep_gateway_order on public.oly_enrollment_pending(gateway_order_id);
```

A scheduled cleanup job (Phase 5's `oly-dormancy-pass` will absorb this) purges rows where `status = 'payment_pending' AND created_at < now() - interval '1 hour'`. For Phase 2 we add a `pg_cron` job or a simple SQL command run from `oly-payment-create-order` (clean expired before insert).

### 2.3 `oly_receipts`

```sql
create table public.oly_receipts (
  id uuid primary key default gen_random_uuid(),
  oly_student_id uuid not null references public.oly_students(id) on delete cascade,
  receipt_number text not null unique,          -- format: RCPT-{YYYY}-{NNNNNNN} sequential per year
  storage_path text not null,                   -- olympiad-receipts/{enrollment_id}.pdf
  amount_paise integer not null,
  gst_paise integer not null,
  total_paise integer not null,
  payment_method text not null check (payment_method in ('online', 'cash')),
  gateway_payment_id text,                      -- null for cash receipts
  gateway_reference text,                       -- Razorpay payment_id formatted for display
  issued_at timestamptz not null default now(),
  emailed_at timestamptz,                       -- when receipt email was sent (null if not yet sent)
  emailed_to text                               -- email address used
);
create index idx_oly_receipts_student on public.oly_receipts(oly_student_id);
create index idx_oly_receipts_issued_at on public.oly_receipts(issued_at);
```

### 2.4 `oly_refunds`

```sql
create table public.oly_refunds (
  id uuid primary key default gen_random_uuid(),
  oly_student_id uuid not null references public.oly_students(id) on delete cascade,
  initiated_by uuid references public.profiles(id) on delete set null,
  reason text not null,
  scope text not null check (scope in ('per_student', 'school_wide')),
  amount_paise integer not null,
  gateway_refund_id text,                       -- null for cash refunds
  status text not null default 'pending'
    check (status in ('pending', 'completed', 'failed', 'offline')),
  failure_reason text,
  initiated_at timestamptz not null default now(),
  completed_at timestamptz
);
create index idx_oly_refunds_student on public.oly_refunds(oly_student_id);
create index idx_oly_refunds_status on public.oly_refunds(status);
```

### 2.5 Storage bucket

```sql
insert into storage.buckets (id, name, public)
  values ('olympiad-receipts', 'olympiad-receipts', false)
  on conflict (id) do nothing;
```

RLS on `storage.objects`:
- Super admin: full manage (already broad — keep narrow for receipts)
- School admin: SELECT only for their school's receipts
- Student: SELECT only for own receipt (Phase 4 will tighten this when student auth lands)

### 2.6 Trigger — promote pending → student on payment success

When `oly_enrollment_pending.status` flips from `payment_pending` to `paid`, an AFTER UPDATE trigger:

1. Generates roll number via `oly_generate_roll_number(school_short_code, class_label, campaign_year)`
2. Inserts the corresponding `oly_students` row
3. Sets `oly_enrollment_pending.promoted_student_id` to the new student id
4. Returns

The trigger is the single canonical promotion path. Edge functions (webhook handler) only flip the status; they don't manually insert students. This guarantees consistency and prevents promotion duplication if a webhook is replayed.

### 2.7 RLS policies

Same SECURITY DEFINER pattern from Phase 1. New helpers introduced:

- `oly_is_school_admin_for(uid uuid, oly_school_id uuid) returns boolean` — checks user is school_admin/super_school_admin/coordinator for the institution that owns this oly_school
- `oly_student_can_read(uid uuid, oly_student_id uuid) returns boolean` — checks user is the student (via profile_id), or a school admin, or super admin

Policies per table:
- `oly_students`: super_admin all; school admin SELECT own school; student SELECT self (when profile_id matches auth.uid())
- `oly_enrollment_pending`: super_admin all; school admin SELECT own school. No other read access — these contain in-flight payment data
- `oly_receipts`: super_admin all; school admin SELECT own school
- `oly_refunds`: super_admin all; school admin SELECT own school

### 2.8 Roll number generation

```sql
create or replace function public.oly_generate_roll_number(
  p_school_short_code text,
  p_class_label text,
  p_campaign_year integer
) returns text language plpgsql security definer set search_path = public as $$
declare
  v_class_int integer;
  v_seq integer;
  v_yy text := to_char(p_campaign_year, 'FM00')::text;
begin
  -- Extract numeric class from labels like "Class 8" or "8" or "VIII"
  v_class_int := nullif(regexp_replace(p_class_label, '\D', '', 'g'), '')::integer;
  if v_class_int is null then
    raise exception 'Could not extract class number from %', p_class_label;
  end if;

  -- Atomic sequential per (school, class). Lock table row to avoid races.
  select coalesce(max(
    nullif(regexp_replace(split_part(roll_number, '-', 4), '\D', '', 'g'), '')::integer
  ), 0) + 1
    into v_seq
    from public.oly_students s
    join public.oly_schools sc on sc.id = s.oly_school_id
   where sc.school_short_code = p_school_short_code
     and substring(s.class_label from '\d+') = v_class_int::text;

  return 'SO' || right(v_yy, 2) || '-' || p_school_short_code
         || '-' || lpad(v_class_int::text, 2, '0')
         || '-' || lpad(v_seq::text, 4, '0');
end;
$$;
```

(Caller must hold a row-level lock or use SERIALIZABLE isolation; for Phase 2 we accept the small race window since enrollments are not high-concurrency at this scale. If conflicts surface, promote to a SEQUENCE per (school, class) in a follow-up migration.)

---

## 3. Super admin: Onboard New School

Replaces the disabled button on the Phase 1 `OlympiadSchoolsTab`.

### 3.1 Onboarding form (a `MobileSheet`)

Fields:
- **School name** (required)
- **School short code** — 6-char alphanumeric uppercase, immutable post-creation, must be globally unique. UI: "Generate" button suggests a value (`{first 4 letters of name}{random 2 digits}`); super admin can edit or accept.
- **City** (text)
- **State** (text)
- **Primary contact**: name, email, phone
- **Participating classes** (multi-select from `grade_levels` 3–10)
- **Existing SALCI school?** (toggle)
  - If YES → `SearchableSelect` over existing institutions, search by name; on select, auto-fill name + city + state read-only.
  - If NO → all fields manually entered.
- **Price override** (paise, optional) — leave blank to inherit campaign default
- **Internal notes** (optional, super-admin-only)

### 3.2 Submit flow

For NEW schools (toggle off):
1. Call edge function `oly-onboard-school` with the form payload + `is_existing_salci_school: false`
2. Edge function (service role):
   - Creates `institutions` row with the supplied name + code derived from school_short_code
   - Inserts `institution_features` row `{ feature_id: 'olympiad', is_enabled: true }` — only this feature
   - Creates a `school_admin` auth user via `auth.admin.createUser` with `email_confirm: false`, random temp password
   - Inserts `profiles` row + `user_roles` row `{ user_id, role: 'school_admin', institution_id }`
   - Inserts `oly_schools` row with `is_existing_salci_school: false`, `school_short_code`, all metadata
   - Sends password-set link email via existing Supabase Auth `inviteUserByEmail` flow (or `generateLink` of type `recovery`)
3. Returns `{ oly_school_id, public_url, school_short_code }`

For EXISTING SALCI schools (toggle on):
1. Call same edge function with `is_existing_salci_school: true, institution_id: <selected>`
2. Edge function:
   - Enables `olympiad` feature flag on the institution (idempotent)
   - Inserts `oly_schools` row with `is_existing_salci_school: true`
   - Does NOT create a new admin (use existing school admin)
3. Returns the same shape

### 3.3 Post-onboarding view

Toast success → modal/sheet shows:
- The public URL as copyable text
- A "Download QR" button (canvas-rendered QR code via `qrcode` npm dep — already in package.json, verify)
- A "Done" button that closes the sheet and refreshes the Schools list

### 3.4 Schools tab post-Phase-2

Now shows the list of onboarded schools instead of the empty state:
- `ListRow` per school: school name, short code, status pill, enrolled-students count, revenue-collected (computed)
- Tap → school detail page `/admin/olympiad/schools/:olySchoolId` (Phase 2 ships a thin detail page — Phase 3 adds the batching kanban etc.)
- Per-row actions: regenerate QR, copy URL, archive school (super-admin only, with confirmation)

The Phase 1 disabled "Onboard New School" button becomes a live button that opens the form sheet.

---

## 4. Public parent payment page

### 4.1 Route registration

In `src/App.tsx`, add OUTSIDE the `ProtectedRoute` block:

```tsx
<Route path="/olympiad/:schoolCode" element={
  <Suspense fallback={<p>Loading...</p>}>
    <OlympiadPublicEnrollmentPage />
  </Suspense>
} />
```

`OlympiadPublicEnrollmentPage` does NOT use `AppLayout` / `AppSidebar`. It uses a dedicated `OlympiadPublicLayout` with:
- SALCI logo + small "SALCI Olympiad" wordmark
- Centered max-width card on a brand-tinted background
- Footer with SALCI GSTIN, contact email, "Need help?" link

### 4.2 Public data fetch

Single public RPC, no direct table access:

```sql
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
  -- Look up the school + its campaign in a single explicit join
  select sc.id,
         sc.school_short_code,
         sc.is_existing_salci_school,
         i.name,
         sc.price_override_paise,
         sc.participating_grade_level_ids,
         c.default_price_paise,
         c.gst_percent
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

  -- Build classes list (only the ones the school participates in)
  select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.grade_name, 'number', g.grade_number) order by g.display_order)
    from public.grade_levels g
   where g.id = any(v_grade_level_ids)
   into v_classes;

  -- Per-class subjects map: { grade_level_id: [{id, name}, ...] }
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
```

### 4.3 Form — non-SALCI path

Layout:
1. School name header (`Olympiad Enrollment — {School Name}`)
2. Brief description (super admin can override default copy in campaign settings later; Phase 2 uses a hardcoded paragraph)
3. Price card showing `₹X + 18% GST = ₹Y` breakdown (uses existing `formatOlympiadFee` from Phase 1)
4. "Start enrollment" button → expands form

Form fields (all required unless marked):
- Student full name
- Date of birth (date picker; this is the exam password in ddmmyy format)
- Class (dropdown from `classes` returned by RPC)
- Section (optional, free text)
- Subjects — checkboxes with counter `Selected: 2/3`; submit disabled until exactly 3 selected
- Parent name
- Parent phone (10 digits, Indian mobile regex `^[6-9]\d{9}$`)
- Parent email (optional — if provided, receipt is emailed)

On submit → calls `oly-payment-create-order` edge function.

### 4.4 Form — existing SALCI path

Extra field at the top:
- **Student admission number** (required)

On blur/submit of admission number: client calls `oly_lookup_salci_student(school_short_code, admission_number)` RPC:

```sql
create or replace function public.oly_lookup_salci_student(
  p_school_short_code text, p_admission_number text
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_school_inst_id uuid;
  v_profile record;
begin
  select i.id into v_school_inst_id
    from public.institutions i
    join public.oly_schools sc on sc.institution_id = i.id
   where sc.school_short_code = upper(p_school_short_code)
     and sc.is_existing_salci_school = true;

  if v_school_inst_id is null then
    return jsonb_build_object('found', false);
  end if;

  select p.id, p.full_name, p.date_of_birth,
         (select name from public.classes c
           where c.id = (
             select class_id from public.class_assignments
              where student_id = p.id limit 1
           )) as class_name
    from public.profiles p
   where p.institution_id = v_school_inst_id
     and p.admission_number = p_admission_number
     and exists (select 1 from public.user_roles ur where ur.user_id = p.id and ur.role = 'student')
   into v_profile;

  if v_profile.id is null then
    return jsonb_build_object('found', false);
  end if;

  return jsonb_build_object(
    'found', true,
    'profile_id', v_profile.id,
    'full_name', v_profile.full_name,
    'date_of_birth', v_profile.date_of_birth,
    'class_name', v_profile.class_name
  );
end;
$$;
grant execute on function public.oly_lookup_salci_student(text, text) to anon, authenticated;
```

UI behavior:
- Lookup returns name + class + section → auto-fill, read-only
- If DOB is present on profile → prefill + lock
- If DOB is missing → parent enters it; on payment success, write it back to `profiles.date_of_birth`
- Not found → error toast "Student admission number not recognized. Please contact your school to ensure the student is registered before enrolling for the Olympiad."

### 4.5 Duplicate-detection guards

In `oly-payment-create-order` edge function, BEFORE creating the gateway order:

- **Non-SALCI**: query `oly_students` for rows where `oly_school_id = X AND lower(full_name) = lower(?) AND date_of_birth = ? AND class_label = ?` AND `enrolled_at > now() - interval '24 hours'`. If found, return `{ blocked: true, existing_roll_number, message: "This student appears to be already enrolled. Roll number: {SO26-XXX-08-0042}. If this is a mistake, please contact your school." }`.

- **SALCI**: query for `oly_school_id = X AND admission_number = ? AND campaign_id = current_campaign_id`. If found, block with same shape but tightened message.

### 4.6 Money display

Every page that shows the fee uses `formatOlympiadFee(price_paise, gst_percent)` from `src/lib/olympiad/money.ts` (Phase 1). The `display` field renders `₹500 + 18% GST = ₹590`.

---

## 5. Payment adapter + Razorpay test mode

### 5.1 Interface

`src/lib/olympiad/payment/types.ts`:

```ts
export type PayerContact = {
  name: string;
  email: string | null;
  phone: string;
};

export type CreateOrderInput = {
  amountPaise: number;
  orderRef: string;       // oly_enrollment_pending.id
  payer: PayerContact;
  receipt: string;        // human-readable receipt label
};

export type CreateOrderResult = {
  transactionId: string;  // gateway-specific order id
  redirectUrl?: string;   // optional hosted-page URL
  clientPayload?: unknown;// passed to the frontend SDK if any
};

export type WebhookVerificationInput = {
  rawBody: string;
  signature: string;
  timestamp?: string;
};

export type WebhookVerificationResult =
  | { ok: true; transactionId: string; paymentId: string; orderRef: string; amountPaise: number }
  | { ok: false; reason: string };

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

export interface PaymentGatewayAdapter {
  readonly name: "stub" | "razorpay";
  createOrder(input: CreateOrderInput): Promise<CreateOrderResult>;
  verifyWebhook(input: WebhookVerificationInput): Promise<WebhookVerificationResult>;
  processRefund(input: RefundInput): Promise<RefundResult>;
}
```

### 5.2 Stub adapter

`src/lib/olympiad/payment/stubAdapter.ts`:

- `createOrder`: 500ms delay, returns `{ transactionId: 'stub_' + uuid(), redirectUrl: undefined, clientPayload: { stub: true } }`
- `verifyWebhook`: returns `{ ok: true, ... }` for any payload prefixed `stub_`
- `processRefund`: returns `{ refundId: 'stub_refund_' + uuid(), status: 'completed' }`

Used in local dev / CI. Frontend can simulate completion by calling a dev-only endpoint `oly-stub-payment-complete` (only registered when `OLY_PAYMENT_ADAPTER === 'stub'`).

### 5.3 Razorpay adapter

`src/lib/olympiad/payment/razorpayAdapter.ts`:

- `createOrder`: POST `https://api.razorpay.com/v1/orders` with `{ amount, currency: 'INR', receipt, notes: { orderRef } }`. Returns `{ transactionId: order.id, clientPayload: { key_id, order_id, prefill } }`.
- `verifyWebhook`: HMAC-SHA256 of `rawBody` with webhook secret; compare to `signature` header. Extracts `payment.entity` from payload, returns transactionId/paymentId/orderRef.
- `processRefund`: POST `https://api.razorpay.com/v1/payments/{paymentId}/refund` with `{ amount, notes: { reason } }`.

Razorpay test-mode keys live in edge function env:
- `RAZORPAY_KEY_ID` (test_xxx prefix)
- `RAZORPAY_KEY_SECRET`
- `RAZORPAY_WEBHOOK_SECRET`

Frontend SDK is the Razorpay Checkout JS, loaded via `<script src="https://checkout.razorpay.com/v1/checkout.js" async>` ONLY on the public payment page (not in main bundle).

### 5.4 Adapter selection

```ts
// src/lib/olympiad/payment/index.ts
import { stubAdapter } from "./stubAdapter";
import { razorpayAdapter } from "./razorpayAdapter";
import type { PaymentGatewayAdapter } from "./types";

export function getPaymentAdapter(): PaymentGatewayAdapter {
  const choice = (import.meta.env.VITE_OLY_PAYMENT_ADAPTER ?? "stub").toLowerCase();
  return choice === "razorpay" ? razorpayAdapter : stubAdapter;
}
```

In the edge functions, the same selection is done via `Deno.env.get("OLY_PAYMENT_ADAPTER")` (no `VITE_` prefix on the server side).

### 5.5 Edge function: `oly-payment-create-order`

Public POST endpoint. Anon JWT acceptable.

1. Parse body: `{ school_short_code, form_data: { full_name, dob, class_label, ..., subject_ids, parent_name, parent_phone, parent_email, admission_number? } }`
2. Validate inputs (Indian mobile regex, dob is a date, exactly 3 subject_ids, etc.)
3. Run duplicate-detection guard (§4.5). If blocked, return `{ blocked: true, message }`
4. Compute amount: `oly_get_public_school_payment_context` to fetch price + GST. Compute `total_paise = price_paise * (1 + gst_percent / 100)` rounded.
5. Insert `oly_enrollment_pending` row with status `payment_pending`
6. Call `getPaymentAdapter().createOrder({ amountPaise: total_paise, orderRef: pending_id, payer, receipt: ... })`
7. Update the pending row with `gateway_order_id`
8. Return `{ pending_id, transaction_id, client_payload }` — frontend uses client_payload to open Razorpay Checkout

### 5.6 Edge function: `oly-payment-webhook`

Public POST endpoint, no JWT (Razorpay signs the payload).

1. Read raw body + `X-Razorpay-Signature` header
2. Call `getPaymentAdapter().verifyWebhook({ rawBody, signature })`
3. If `ok: false` → 401 (log + drop)
4. Resolve `oly_enrollment_pending` by `gateway_order_id`. If not found → 404 (drop).
5. UPDATE pending row: set `status = 'paid'`, `gateway_payment_id`, `gateway_signature`
6. The DB trigger (§2.6) inserts the `oly_students` row + generates roll number
7. Asynchronously invoke `oly-receipt-generate` for the new student (don't block the webhook response — Razorpay times out webhooks at ~30s; receipt gen + email can take a few seconds, do it inline if fast enough, otherwise queue)
8. Return `200 { ok: true }`

### 5.7 Frontend payment handoff

The public enrollment page:
1. Submits form → calls `oly-payment-create-order` → receives `client_payload`
2. If `client_payload.key_id` present (Razorpay), opens Razorpay Checkout modal with `key`, `order_id`, `prefill.name`, `prefill.email`, `prefill.contact`
3. On Razorpay `payment.success` event (client-side callback), redirects to `/olympiad/:schoolCode/success?ref=:pending_id`
4. Success page polls (or subscribes via Supabase Realtime to `oly_enrollment_pending`) until `status = 'paid' AND promoted_student_id IS NOT NULL`, then displays roll number + "Check your email for the receipt"
5. Polling timeout: if status doesn't flip within 90s (gateway delays), shows "We're confirming your payment. Check your email shortly, or contact your school if you don't receive a receipt within 30 minutes."

For stub adapter: client_payload includes `{ stub: true }`. The frontend immediately POSTs to `oly-stub-payment-complete` to simulate the webhook, then proceeds to the success page.

---

## 6. Receipt PDF generation

### 6.1 Edge function: `oly-receipt-generate`

Triggered post-payment by `oly-payment-webhook` (or by Phase 3's cash-enrollment flow).

1. Resolve `oly_students` row + `oly_schools` + `oly_campaigns` + chosen subjects (via subject_ids)
2. Build receipt PDF using `pdf-lib` (existing dep)
3. Upload to `olympiad-receipts/{enrollment_id}.pdf`
4. Insert `oly_receipts` row with `receipt_number` from a per-year sequence `oly_receipt_seq_{YYYY}`
5. If parent_email is set: send email via Resend with the PDF attached
6. Update `oly_receipts.emailed_at` + `emailed_to`

### 6.2 PDF layout (single page, A4)

Per docx:
- SALCI logo + branding header
- "SALCI Olympiad {YEAR} — Enrollment Receipt"
- SALCI GSTIN (from `oly_campaigns.gstin`)
- School name
- Student name, roll number, class, section
- Subjects chosen (list)
- Fee breakdown table:
  ```
  Base fee:    ₹500.00
  GST (18%):   ₹90.00
  ─────────────────
  Total:       ₹590.00
  ```
- Payment method: "Online (Razorpay ref: pay_XXX)" or "Cash (Teacher: Name)" (Phase 3 fills cash receipts)
- Payment timestamp
- Receipt number (RCPT-2026-0001234)
- Footer: "This is a system-generated receipt. For queries, contact your school administration."

### 6.3 Reuse vs new

The existing `FeeReceiptViewer.tsx` is **display-only** (renders in-app preview, browser-side). For Olympiad, the canonical receipt is server-generated PDF (because it must be emailed and stored). New code path. No reuse of `FeeReceiptViewer`. However, the existing `src/lib/pdf/pdfPrimitives.ts` (font loading, A4 setup, header helpers) is reused.

### 6.4 Receipt number generation

Per-year sequence:
```sql
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
```

(Dynamic sequence creation is acceptable here since it's super-admin-gated and only fires once per year.)

---

## 7. Refund flow

### 7.1 Per-student refund (super admin)

UI: from the schools detail page (Phase 2 thin version) or super-admin refund dashboard. Click "Refund" on a student row → confirmation dialog with mandatory reason field → calls `oly-refund-issue` edge function.

### 7.2 School-wide refund (super admin)

UI: on the school detail page, "Cancel school + refund all" button. Confirmation dialog: "This will refund every paid student in {school name}. Are you sure? Type 'REFUND' to confirm."

### 7.3 Edge function `oly-refund-issue`

1. Verify caller is super_admin
2. For per-student: load the `oly_students` row + its `oly_enrollment_pending` + linked `oly_receipts`
3. For online payments: call `getPaymentAdapter().processRefund({ transactionId: pending.gateway_order_id, paymentId: pending.gateway_payment_id, amountPaise: total, reason })`
4. For cash payments: mark `oly_refunds.status = 'offline'` — no gateway call, just records the audit trail. Phase 3 teacher UI will surface "Refund offline" badges.
5. Insert `oly_refunds` row
6. Update `oly_students.status = 'refunded'`
7. Send refund-confirmation email to parent

### 7.4 Auto-refund for duplicate online payments

If `oly_enrollment_pending` row is created for a duplicate (race condition past the duplicate-detection guard), the webhook still marks it paid. A nightly job (Phase 5's dormancy pass will absorb this — for Phase 2, run via pg_cron):

```sql
-- Find duplicate paid enrollments within 7 days
select s.id as student_id, ep.gateway_payment_id, ep.total_paise
  from oly_students s
  join oly_enrollment_pending ep on ep.promoted_student_id = s.id
 where s.oly_school_id = ANY (...)
   and s.enrolled_at > now() - interval '7 days'
   and s.id != (
     select min(id) from oly_students s2
      where s2.oly_school_id = s.oly_school_id
        and lower(s2.full_name) = lower(s.full_name)
        and s2.date_of_birth = s.date_of_birth
        and s2.class_label = s.class_label
   );
```

Each match → call `oly-refund-issue`. Phase 2 ships the query inside `oly-refund-duplicates` edge function; pg_cron schedule lands in Phase 5.

---

## 8. Reuse and helpers

- `formatOlympiadFee` from `src/lib/olympiad/money.ts` (Phase 1)
- `MobileSheet`, `PageShell`, `PageHeader`, `ListRow`, `StatTile`, `EmptyState` from `@/components/shared/*`
- `toastError` from `@/lib/toast.ts` (§19)
- `invokeEdgeFunction` from `src/lib/invokeEdgeFunction.ts` (§21)
- `pdf-lib` for PDF generation (existing dep)
- `qrcode` for QR PNG (verify package.json; if missing, add)
- Existing Resend pattern from `supabase/functions/broadcast-email/` (currently being built by another track — coordinate; otherwise use existing `send-task-notifications` pattern)

---

## 9. Acceptance criteria

Mirrors docx Phase 2, tightened:

- Super admin can onboard a school in ≤ 5 minutes flat (start to public-URL-displayed)
- Public payment URL works at `/olympiad/:schoolCode` outside auth, with QR code downloadable
- Parents at non-SALCI schools can enroll a student end-to-end (form → stub payment success → roll number → receipt PDF emailed)
- Parents at SALCI schools can look up by admission number with auto-fill working
- Duplicate detection works for both flows (within 24h for non-SALCI, in-campaign for SALCI)
- Successful payment triggers receipt email
- Failed / abandoned payments leave no orphaned student records (pending rows expire after 1h)
- Refund flow works end-to-end with stub adapter
- Razorpay test mode works end-to-end (test card swiped, webhook verified, receipt emailed)
- Roll numbers follow `SO{YY}-{SCHOOL_CODE}-{CLASS}-{SEQ}` format and are unique system-wide
- Every new RLS policy uses SECURITY DEFINER helpers (no inline cross-table EXISTS)
- Every new FK indexed in same migration
- Every new `useQuery` has explicit `staleTime`
- Every onError uses `toastError`
- All money rendered as `₹X + 18% GST = ₹Y`
- No em-dashes in user-facing copy
- §5a zero-error contract passes on every touched file

---

## 10. Risks and open items

- **`profiles.admission_number` column** — Phase 2 assumes this column exists on the existing SALCI `profiles` table. If it lives elsewhere (e.g. on a `students` join table), `oly_lookup_salci_student` needs adjustment. Verify in implementation plan.
- **`qrcode` npm package** — assumed present; verify in plan. If absent, add it.
- **Resend integration** — `supabase/functions/broadcast-email/` is currently untracked / in-flight (per git status). Need to confirm whether the existing Resend client wrapper is published or still local. Worst case: introduce a new `oly-email-send` thin wrapper.
- **Razorpay account ownership** — who provisions the SALCI Razorpay merchant account? Likely Tushar (the operator). Test keys can be set up in minutes; live keys require Razorpay KYC which can take days. Out of scope for the build, but operations-blocking.
- **Webhook URL must be publicly reachable** — Supabase Edge Functions are publicly reachable by default, no extra ngrok required. But Razorpay must be configured (in their dashboard) to POST to `https://gyymkgohcijeksmrzuyw.supabase.co/functions/v1/oly-payment-webhook`. This is a one-time manual config step.
- **`generate-link` vs `inviteUserByEmail`** — different Supabase Auth flows. Verify which one the existing SALCI codebase uses for password-set emails (probably `inviteUserByEmail` since users are usually invited, not self-created).
- **Class label vs class id** — `oly_students.class_label` is free text per docx ("many small schools don't have sections"). Phase 4's exam delivery needs the `grade_level_id` for question scoping (which class's questions/topics apply). The schema includes `grade_level_id` populated from regex-extract; if a school uses a non-standard label like "VIII" (Roman numerals), the regex fails. Acceptable v1; document this.
- **Trigger error surfaces** — if `oly_generate_roll_number` raises inside the promotion trigger, the webhook handler succeeds (the UPDATE rolled back) but the student isn't created. Worth checking observability — log loudly and surface to super admin via a "stuck pending" dashboard view (Phase 3?).
