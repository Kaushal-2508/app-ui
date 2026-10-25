# SALCI Olympiad — School-Side Tabs + Scheduled Enrollment Closure Design

**Status:** Approved (design gate) — 2026-06-01
**Surface:** school-side Olympiad (`/school/olympiad/*`) — school_admin / super_school_admin (+ coordinator where already permitted)
**Depends on:** the shipped Olympiad module (Phases 1–5b + super-admin restructure) on `olympiad/phase-1`

Two related enhancements to the onboarded-SALCI-school Olympiad experience:

1. **A.** Collapse the four separate sidebar entries (Olympiad / Olympiad Batches / Olympiad PINs / Olympiad Absentees) into **one** "Olympiad" entry that opens a tabbed shell (Olympiad dashboard default + Batches + PINs + Absentees).
2. **B.** Change "Close enrollment" from an immediate action into a **scheduled future "last enrollment date"** (with close-now + edit/cancel), auto-advancing the school to `enrollment_closed` when the date arrives.

---

## 1. Confirmed decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Close-enrollment dialog | Schedule a future date **and** a Close-now option |
| Editing a scheduled date | Editable / cancellable anytime before it hits |
| On-date behavior | Auto-advance to `enrollment_closed` (daily cron flip) + block new enrollments at end-of-day (real-time) |
| Teachers / Share | Stay as dashboard action buttons, NOT tabs |
| Tabs | Olympiad dashboard (default) · Batches · PINs · Absentees |

---

## 2. Part A — Tab consolidation

### 2.1 Shell

New `src/pages/school/olympiad/OlympiadSchoolShell.tsx`, mirroring the super-admin `OlympiadAdminPage` pattern:

- `PageShell` + `PageHeader` (title "SALCI Olympiad", subtitle = school name from `useOlympiadMySchool`) + `MobileTabs` + `<Outlet>`.
- Tabs (options): `{ value: "dashboard", label: "Olympiad dashboard", path: "/school/olympiad" }`, `batches` → `/school/olympiad/batches`, `pins` → `/school/olympiad/pin-custody`, `absentees` → `/school/olympiad/absentees`.
- `resolveActive(pathname)` maps the path to the active tab (default `dashboard`).
- **PINs tab gating:** the PINs tab option is only included when the current user is school-admin-level (`school_admin` / `super_school_admin`). Coordinators (if they reach this surface) do not see the PINs tab — consistent with the existing rule that coordinators have no PIN custody access. Resolve role via the existing `useUserRole` hook.

### 2.2 Routes (`src/App.tsx`)

Convert the flat `/school/olympiad` + siblings into a nested tree under the shell:

```
/school/olympiad            → OlympiadSchoolShell
  index                     → OlympiadSchoolDashboardPage (content only)
  batches                   → OlympiadSchoolBatchesPage (content only)
  pin-custody               → OlympiadSchoolPinCustodyPage (content only)
  absentees                 → OlympiadSchoolAbsenteesPage (content only)
```

`/school/olympiad/teachers`, `/school/olympiad/share`, `/school/olympiad/publish-status` stay as **separate** routes (own `PageShell`), unchanged — reached from dashboard buttons.

The parent shell route keeps the existing `ProtectedRoute` role guard. The standalone teachers/share/publish-status routes keep theirs (PIN-sensitive batches/absentees gating is preserved by the per-page logic; the pin-custody route's existing role guard is preserved by gating the tab + keeping the route protected).

### 2.3 Page changes (PageShell strip)

`OlympiadSchoolDashboardPage`, `OlympiadSchoolBatchesPage`, `OlympiadSchoolPinCustodyPage`, `OlympiadSchoolAbsenteesPage`: remove the outer `<PageShell>` (and the page-level `<PageHeader title="SALCI Olympiad" />` where it merely duplicates the shell title) so they render as tab content. Each keeps its own internal section headings, loading/empty states, dialogs, and logic. The dashboard keeps its phase pill + action-button row (Close enrollment / Schedule batches / Publish) inside the dashboard tab.

> Note: these pages currently early-return `<PageShell>...loading/notfound...</PageShell>`. After the strip, those early returns render plain content (the shell already wraps them). If a page is reached standalone (it won't be, post-routing), it would render without chrome — acceptable since all entry is via the shell.

### 2.4 Sidebar (`src/components/layout/AppSidebar.tsx`)

Remove the three entries `Olympiad Batches`, `Olympiad PINs`, `Olympiad Absentees`. Keep the single `Olympiad` → `/school/olympiad` entry. Done for every role block that currently lists the four (school_admin / super_school_admin). `FEATURE_URL_MAP` entries for the sub-routes remain (so `ProtectedRoute` still gates direct URLs by the `olympiad` feature flag).

---

## 3. Part B — Scheduled enrollment closure

### 3.1 Schema (migration)

Add to `oly_schools`:

```sql
alter table public.oly_schools
  add column if not exists enrollment_closes_at timestamptz;
```

`NULL` = no scheduled close (open until a manual close). When set, it is the **end-of-day-IST instant** of the chosen last-enrollment date (i.e. the date at `23:59:59.999 Asia/Kolkata`, stored as the equivalent `timestamptz`).

No new FK, no index needed (filtered only in a daily cron over a small table + per-school reads).

### 3.2 Edge function — extend `oly-close-enrollment`

Accept a `mode`:

- `{ oly_school_id, mode: "schedule", closes_at }` — validates `closes_at` is in the future; requires `status = 'enrollment_open'`; sets `enrollment_closes_at = closes_at` (status unchanged). Audit `action: 'enrollment_close_scheduled'`.
- `{ oly_school_id, mode: "now" }` — the current behavior: requires `status = 'enrollment_open'`; sets `status = 'enrollment_closed'`, clears `enrollment_closes_at`. Audit `action: 'enrollment_closed'`.
- `{ oly_school_id, mode: "cancel" }` — requires `status = 'enrollment_open'`; sets `enrollment_closes_at = NULL`. Audit `action: 'enrollment_close_cancelled'`.

Keep the existing school-admin/super-admin gate (`oly_is_school_admin_for` / `is_super_admin`). The two new audit actions are added to the `oly_audit_log.action` CHECK constraint in the same migration. **The implementer must read the latest constraint definition first** (most recently set in the Phase 5b migration `20260527004820`) and DROP + recreate with the full cumulative set **plus** `enrollment_close_scheduled` and `enrollment_close_cancelled` — never drop a prior action value.

`closes_at` is sent by the client as the end-of-day-IST ISO string (computed client-side via `Asia/Kolkata`); the edge function trusts it after the future-date validation.

### 3.3 Real-time enforcement (block new enrollments at end-of-day)

A single SECURITY DEFINER helper decides whether enrollment is open:

```sql
create or replace function public.oly_enrollment_is_open(p_oly_school_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select s.status = 'enrollment_open'
     and (s.enrollment_closes_at is null or now() < s.enrollment_closes_at)
  from public.oly_schools s where s.id = p_oly_school_id;
$$;
```

Apply at every enrollment entry point (replace the current `status = 'enrollment_open'` checks):

- `oly-cash-enroll` (teacher cash enrollment) — gate on `oly_enrollment_is_open`.
- `oly-payment-create-order` (online order creation) — gate on `oly_enrollment_is_open`.
- The public enrollment page's resolve/"can enroll" path (`OlympiadPublicEnrollmentPage` via its resolve RPC/hook) — surface "Enrollment closed" when not open.

This blocks new cash + online enrollments precisely at `enrollment_closes_at`, before any cron runs. In-flight online payments already created complete as today.

### 3.4 Status auto-advance (daily cron)

Add a pass to the existing daily `oly-dormancy-pass` (4 AM IST cron). New RPC:

```sql
create or replace function public.oly_advance_scheduled_closures()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  update public.oly_schools
     set status = 'enrollment_closed'
   where status = 'enrollment_open'
     and enrollment_closes_at is not null
     and enrollment_closes_at <= now();
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'advanced', v_n);
end;
$$;
```

The `oly-dormancy-pass` edge function calls `oly_advance_scheduled_closures()` at the start of its run. (Grant: `service_role` only — invoked by the cron, like the other dormancy RPCs.) This flips the stage the morning after the deadline so the school can schedule batches.

### 3.5 Dashboard display + dialog

**`OlympiadSchoolDashboardPage`** (now the dashboard tab):

- Derive **effective open** client-side: `status === 'enrollment_open' && (!closes_at || nowIST < closes_at)`.
- When `status === 'enrollment_open'`:
  - If `enrollment_closes_at` is **unset**: the action button reads **"Close enrollment"** → opens the dialog (schedule / close-now).
  - If `enrollment_closes_at` is **set and in the future**: show an info line **"Enrollment closes on {date} (IST)"** + a **"Manage closing date"** button (edit / cancel / close-now).
  - If `enrollment_closes_at` is **set and past** (cron not run yet): treat as effectively closed — show the `enrollment_closed` actions ("Schedule batches"), so they don't wait for the 4 AM pass.
- `useOlympiadMySchool` must return `enrollment_closes_at` (add to its select + type).

**New `CloseEnrollmentDialog`** (rework the existing one) — a single dialog with:
- A date picker (shadcn `Calendar`/`Input type=date`) restricted to **future** dates.
- A primary **"Schedule"** action (sets the date, mode `schedule`).
- A secondary **"Close now"** action (type-to-confirm "CLOSE", mode `now`) — preserves the existing safety gate for the irreversible immediate close.
- When already scheduled: a **"Cancel scheduled date"** action (mode `cancel`) + the date pre-filled for editing.

`useCloseEnrollment` mutation widened to take `{ olySchoolId, mode, closesAt? }` and invalidate `["olympiad"]`.

### 3.6 End-of-day IST semantics

The chosen date D means enrollment is allowed **through** D. `closes_at` = D at `23:59:59.999` Asia/Kolkata, converted to a UTC `timestamptz`. Compute client-side using `Intl`/`toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })`-style construction (the codebase already does IST date math in `useStaffAttendance` / exam-day helpers — follow that pattern; do NOT use bare `new Date(dateString)` which parses as UTC midnight). Per CLAUDE.md §24, any DB-side comparison uses `now()` directly against the stored `timestamptz` (the value already encodes the IST end-of-day instant), so no `AT TIME ZONE` juggling is needed in the cron/helper.

---

## 4. Components & files summary

**Create:**
- `src/pages/school/olympiad/OlympiadSchoolShell.tsx`
- `supabase/migrations/<ts>_oly_scheduled_enrollment_closure.sql` (column + 2 RPCs + audit-enum extension)

**Modify:**
- `src/App.tsx` (nest the 4 routes under the shell)
- `src/components/layout/AppSidebar.tsx` (collapse 4 → 1 entry)
- `OlympiadSchoolDashboardPage.tsx`, `OlympiadSchoolBatchesPage.tsx`, `OlympiadSchoolPinCustodyPage.tsx`, `OlympiadSchoolAbsenteesPage.tsx` (strip PageShell)
- `src/components/olympiad/school/CloseEnrollmentDialog.tsx` (schedule / now / cancel)
- `src/hooks/olympiad/useCloseEnrollment.ts` (mode param)
- `src/hooks/olympiad/useOlympiadMySchool.ts` (return `enrollment_closes_at`)
- `supabase/functions/oly-close-enrollment/index.ts` (modes)
- `supabase/functions/oly-cash-enroll/index.ts`, `oly-payment-create-order/index.ts` (use `oly_enrollment_is_open`)
- `supabase/functions/oly-dormancy-pass/index.ts` (call `oly_advance_scheduled_closures`)
- `src/integrations/supabase/types.ts` (regenerated)

---

## 5. Production-readiness contract

Per CLAUDE.md §5a + §23:
- `npx tsc --noEmit` exit 0, `npx eslint <touched>` no new errors, `npx vite build` exit 0.
- New RPCs SECURITY DEFINER `SET search_path = public`; `oly_enrollment_is_open` is read-only and may be granted to `authenticated`; `oly_advance_scheduled_closures` granted to `service_role` only.
- All new `useQuery` hooks set explicit `staleTime`. No `select("*")`. No client-side `.length` over capped reads.
- All `onError` → `toastError`. Mobile-first primitives (`PageShell`/`MobileTabs`/`MobileSheet` or shadcn `AlertDialog`/`Calendar`).
- No `any`/`as any`/eslint-disable.
- New audit-log actions added to the CHECK constraint in the migration (cumulative).

## 6. Acceptance criteria

- School admin sees ONE "Olympiad" sidebar entry; opening it shows tabs (Olympiad dashboard default · Batches · PINs · Absentees); PINs tab hidden for coordinators.
- All four tab contents render correctly (no double-PageShell, no missing chrome).
- "Close enrollment" opens a dialog offering Schedule (future date) + Close now; a scheduled date is editable/cancellable.
- After scheduling, the dashboard shows "Enrollment closes on {date}"; new cash + online enrollments are blocked at end-of-day IST; the stage auto-advances to `enrollment_closed` by the next 4 AM pass (dashboard reflects closed immediately at deadline via the derived check).
- §5a green; both new edge-function behaviors deployed; migration applied.

## 7. Out of scope

- No change to batch generation, PIN custody, absentee, exam, or publish logic — only the page chrome (PageShell strip) for tabs.
- Teachers / Share / Publish-status remain separate routes.
- No per-class enrollment deadlines (single school-wide date).
