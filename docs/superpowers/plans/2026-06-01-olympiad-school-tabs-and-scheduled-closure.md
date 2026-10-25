# Olympiad School-Side Tabs + Scheduled Enrollment Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the four school-side Olympiad sidebar entries into one tabbed shell (Part A), and turn "Close enrollment" into a schedulable future last-enrollment date with real-time blocking + daily auto-advance (Part B).

**Architecture:** Part A adds an `OlympiadSchoolShell` (PageShell + MobileTabs + Outlet) mirroring the super-admin `OlympiadAdminPage`; the four pages lose their own `PageShell` and become tab content. Part B adds an `enrollment_closes_at` column + two RPCs (`oly_enrollment_is_open`, `oly_advance_scheduled_closures`), reworks `oly-close-enrollment` into schedule/now/cancel modes, gates all enrollment entry points on the open-helper, and calls the advance RPC from the daily dormancy cron.

**Tech Stack:** React 18 + TypeScript, Vite, TanStack Query v5, Supabase (PostgreSQL + RLS + Edge Functions/Deno + pg_cron), shadcn/ui, react-router-dom v6.

**Spec:** [docs/superpowers/specs/2026-06-01-olympiad-school-tabs-and-scheduled-closure-design.md](../specs/2026-06-01-olympiad-school-tabs-and-scheduled-closure-design.md)

**Branch:** `olympiad/phase-1`. **No test infrastructure** — verify each task via §5a: `npx tsc --noEmit` (exit 0), `npx eslint <touched>` (no new errors), `npx vite build` (exit 0). Edge functions are verified by deploy + manual check. Migrations applied via `npx supabase db push`.

---

## Verified facts (read before starting)

- `OlympiadAdminPage.tsx` is the shell pattern to mirror: `MobileTabs` props are `value`, `onValueChange`, `options` (array of `{ value, label }`), `className`; nav via `navigate(path)`.
- The four school pages each wrap in `<PageShell>` + a `<PageHeader title="SALCI Olympiad" .../>`: `OlympiadSchoolDashboardPage` (PageShell at the top-level return), `OlympiadSchoolBatchesPage` (PageShell lines ~52-56), `OlympiadSchoolPinCustodyPage` (~16-20), `OlympiadSchoolAbsenteesPage` (~83-87). They also early-return `<PageShell>…spinner/notfound…</PageShell>`.
- `useOlympiadMySchool()` returns `MyOlympiadSchool` (id, campaign_id, school_short_code, status, is_existing_salci_school, participating_grade_level_ids, institution_name); `staleTime: 60_000`.
- `App.tsx` school-olympiad routes are at lines ~796 (`/school/olympiad`), 803 (teachers), 810 (share), 817 (batches), 824 (pin-custody), 831 (absentees), 838 (publish-status). All `lazy()`-loaded under `ProtectedRoute` + `Suspense`.
- `AppSidebar.tsx` lists the four entries at lines ~399-418 (Olympiad / Olympiad Batches / Olympiad PINs / Olympiad Absentees) within a role block.
- `useUserRole()` returns `{ data: { role } }`-shaped role info (used in `AppLayout`); use it to gate the PINs tab.
- `oly-close-enrollment` currently: gates on `oly_is_school_admin_for`/`is_super_admin`, requires `status='enrollment_open'`, flips to `enrollment_closed`, audit `action:'enrollment_closed'`.
- `oly-cash-enroll` checks `if (school.status !== "enrollment_open")` at line ~106 (after selecting the school at ~101).
- `oly-payment-create-order` selects `oly_schools` at line ~53 (verify whether it gates on enrollment_open; add the gate if missing).
- `oly-dormancy-pass`: `serve` at ~18, `summary` object at ~37, Step A (`oly_cleanup_stuck_attempts`) at ~39, Step B (`oly_dormancy_day30`) at ~45. Service-role client named `supabase`.
- `oly_audit_log.action` is a CHECK constraint; last set in migration `20260527004820`. Read it before extending.
- IST end-of-day: `23:59:59.999` Asia/Kolkata for date `YYYY-MM-DD` equals `${date}T18:29:59.999Z` (UTC+5:30). Today's IST date: `new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })`.

---

# PART A — Tab consolidation

## Task A1: `OlympiadSchoolShell`

**Files:** Create `src/pages/school/olympiad/OlympiadSchoolShell.tsx`

- [ ] **Step 1: Create the shell.** PINs tab hidden for non-admin roles.

```tsx
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { Medal } from "lucide-react";
import { PageShell } from "@/components/shared/page/PageShell";
import { PageHeader } from "@/components/shared/page/PageHeader";
import { MobileTabs } from "@/components/shared/nav/MobileTabs";
import { useOlympiadMySchool } from "@/hooks/olympiad/useOlympiadMySchool";
import { useUserRole } from "@/hooks/useUserRole";

type Tab = { value: string; label: string; path: string };

const BASE_TABS: Tab[] = [
  { value: "dashboard", label: "Olympiad dashboard", path: "/school/olympiad" },
  { value: "batches",   label: "Batches",            path: "/school/olympiad/batches" },
  { value: "pins",      label: "PINs",               path: "/school/olympiad/pin-custody" },
  { value: "absentees", label: "Absentees",          path: "/school/olympiad/absentees" },
];

function resolveActive(pathname: string): string {
  if (pathname.startsWith("/school/olympiad/batches")) return "batches";
  if (pathname.startsWith("/school/olympiad/pin-custody")) return "pins";
  if (pathname.startsWith("/school/olympiad/absentees")) return "absentees";
  return "dashboard";
}

export default function OlympiadSchoolShell() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { data: school } = useOlympiadMySchool();
  const { data: roleInfo } = useUserRole();

  // PIN custody is admin-only (coordinators have no PIN access).
  const isAdmin = roleInfo?.role === "school_admin" || roleInfo?.role === "super_school_admin" || roleInfo?.role === "super_admin";
  const tabs = isAdmin ? BASE_TABS : BASE_TABS.filter((t) => t.value !== "pins");
  const active = resolveActive(pathname);

  return (
    <PageShell>
      <PageHeader
        title="SALCI Olympiad"
        subtitle={school?.institution_name}
        icon={<Medal className="h-6 w-6" />}
      />
      <MobileTabs
        value={active}
        onValueChange={(v) => {
          const tab = tabs.find((t) => t.value === v);
          if (tab) navigate(tab.path);
        }}
        options={tabs.map((t) => ({ value: t.value, label: t.label }))}
        className="mb-4"
      />
      <Outlet />
    </PageShell>
  );
}
```

> If `useUserRole`'s returned shape differs (e.g. `roleInfo.roles` array), read the hook and adapt the `isAdmin` check. The role values are `school_admin | super_school_admin | coordinator | super_admin`.

- [ ] **Step 2: Verify** — `npx tsc --noEmit`, `npx eslint src/pages/school/olympiad/OlympiadSchoolShell.tsx`.
- [ ] **Step 3: Commit** — `git add src/pages/school/olympiad/OlympiadSchoolShell.tsx && git commit -m "feat(olympiad): OlympiadSchoolShell tabbed wrapper for school-side olympiad"`

## Task A2: Strip `PageShell` from the four tab pages

**Files:** Modify `OlympiadSchoolDashboardPage.tsx`, `OlympiadSchoolBatchesPage.tsx`, `OlympiadSchoolPinCustodyPage.tsx`, `OlympiadSchoolAbsenteesPage.tsx`

- [ ] **Step 1: For EACH of the four pages:** read it, then remove the outer `<PageShell>` wrapper so the page renders its content directly (a `<div className="space-y-4 py-4">` or fragment). Specifically:
  1. Remove the `import { PageShell } from "@/components/shared/page/PageShell";` line.
  2. In the main return, replace `<PageShell> … </PageShell>` with the inner content (keep everything inside).
  3. In the early-return loading/not-found branches, replace `<PageShell><…spinner…/></PageShell>` with just `<div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-ink-500" /></div>` (drop the PageShell).
  4. **Dashboard only:** also remove the page-level `<PageHeader title="SALCI Olympiad" subtitle={school.institution_name} />` (the shell now owns the title). Keep the phase-pill + action-button row and everything below it.
  5. **Batches / PINs / Absentees:** if their `<PageHeader>` carries a *page-specific* title (e.g. "Exam batches"), KEEP it as a sub-heading; if it duplicates "SALCI Olympiad", remove it. Use judgment per page — keep page-specific section context.

  Do not change any data hooks, dialogs, or logic — only the chrome wrappers.

- [ ] **Step 2: Verify** — `npx tsc --noEmit`, `npx eslint src/pages/school/olympiad/OlympiadSchoolDashboardPage.tsx src/pages/school/olympiad/OlympiadSchoolBatchesPage.tsx src/pages/school/olympiad/OlympiadSchoolPinCustodyPage.tsx src/pages/school/olympiad/OlympiadSchoolAbsenteesPage.tsx`. (Routes still flat until A3 — pages render fine standalone meanwhile, just without the tab strip.)
- [ ] **Step 3: Commit** — `git add src/pages/school/olympiad/ && git commit -m "feat(olympiad): strip PageShell from the 4 school-olympiad tab pages"`

## Task A3: Routes — nest the four under the shell

**Files:** Modify `src/App.tsx`

- [ ] **Step 1:** Add a `lazy()` declaration near the other school-olympiad ones (~line 37):

```tsx
const OlympiadSchoolShell = lazy(() => import("@/pages/school/olympiad/OlympiadSchoolShell"));
```

- [ ] **Step 2:** Replace the four flat routes (`/school/olympiad`, `/school/olympiad/batches`, `/school/olympiad/pin-custody`, `/school/olympiad/absentees` — the dashboard + batches + pin-custody + absentees ones, NOT teachers/share/publish-status) with a nested block. Match the EXISTING `ProtectedRoute allowedRoles={[...]}` + `Suspense` wrapper used on the current `/school/olympiad` route (copy its `allowedRoles` exactly):

```tsx
<Route path="/school/olympiad" element={
  <ProtectedRoute allowedRoles={[/* copy from the existing /school/olympiad route */]}>
    <Suspense fallback={<p>Loading...</p>}>
      <OlympiadSchoolShell />
    </Suspense>
  </ProtectedRoute>
}>
  <Route index element={<OlympiadSchoolDashboardPage />} />
  <Route path="batches" element={<OlympiadSchoolBatchesPage />} />
  <Route path="pin-custody" element={<OlympiadSchoolPinCustodyPage />} />
  <Route path="absentees" element={<OlympiadSchoolAbsenteesPage />} />
</Route>
```

Leave `/school/olympiad/teachers`, `/school/olympiad/share`, `/school/olympiad/publish-status` exactly as they are (separate routes). If the pin-custody route previously had a *stricter* `allowedRoles` than the dashboard (e.g. excluding coordinator), preserve that intent: keep coordinators out of the PINs tab via Task A1's gating, and — if the original pin-custody route excluded coordinators — the parent shell `allowedRoles` should still allow coordinators to reach the dashboard, so do NOT tighten the parent; the tab gating handles PIN access. (Read the current per-route `allowedRoles` to confirm.)

- [ ] **Step 3: Verify** — `npx tsc --noEmit`, `npx eslint src/App.tsx`.
- [ ] **Step 4: Commit** — `git add src/App.tsx && git commit -m "feat(olympiad): nest school-olympiad pages under the tab shell"`

## Task A4: Sidebar — collapse four entries to one

**Files:** Modify `src/components/layout/AppSidebar.tsx`

- [ ] **Step 1:** In every role block that lists them, remove the three entries `Olympiad Batches` (`/school/olympiad/batches`), `Olympiad PINs` (`/school/olympiad/pin-custody`), and `Olympiad Absentees` (`/school/olympiad/absentees`). Keep the single `{ title: "Olympiad", url: "/school/olympiad", icon: Medal }`. Remove now-unused icon imports (`CalendarClock`, `KeyRound`, `UserX`) ONLY if no other sidebar item uses them (grep first: `grep -n "CalendarClock\|KeyRound\|UserX" src/components/layout/AppSidebar.tsx`).
- [ ] **Step 2: Verify** — `npx tsc --noEmit`, `npx eslint src/components/layout/AppSidebar.tsx`.
- [ ] **Step 3: Commit** — `git add src/components/layout/AppSidebar.tsx && git commit -m "feat(olympiad): collapse 4 school-olympiad sidebar entries into one"`

## Task A5: Part A build + smoke

- [ ] **Step 1: Full §5a** — `npx tsc --noEmit` (0), `npx eslint "src/pages/school/olympiad/**" src/App.tsx src/components/layout/AppSidebar.tsx` (clean), `npx vite build` (0).
- [ ] **Step 2: Manual smoke** — `npm run dev`, sign in as a school_admin of an onboarded olympiad school: sidebar shows ONE "Olympiad"; opening it shows tabs (Olympiad dashboard default · Batches · PINs · Absentees); each tab renders its content with no double-PageShell; as a coordinator the PINs tab is absent. At 375px the tab strip scroll-snaps; dark mode flips.
- [ ] **Step 3: Commit** (only if smoke fixes were needed).

---

# PART B — Scheduled enrollment closure

## Task B1: Migration — column + 2 RPCs + audit enum

**Files:** Create `supabase/migrations/<TS>_oly_scheduled_enrollment_closure.sql` (`<TS>` via `[DateTime]::UtcNow.ToString('yyyyMMddHHmmss')`, must sort after the latest migration)

- [ ] **Step 1: Read** the current `oly_audit_log_action_check` constraint (most recently set in `supabase/migrations/20260527004820_oly_phase_5b_dormancy.sql`) so you can recreate it with the FULL existing set + the two new actions.
- [ ] **Step 2: Write the migration:**

```sql
-- Scheduled enrollment closure: a future "last enrollment date" + helpers.

alter table public.oly_schools
  add column if not exists enrollment_closes_at timestamptz;

-- Read-only: is enrollment currently open for this school?
create or replace function public.oly_enrollment_is_open(p_oly_school_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select s.status = 'enrollment_open'
     and (s.enrollment_closes_at is null or now() < s.enrollment_closes_at)
  from public.oly_schools s where s.id = p_oly_school_id;
$$;
grant execute on function public.oly_enrollment_is_open(uuid) to authenticated, service_role;

-- Daily cron pass: flip schools past their scheduled close to enrollment_closed.
create or replace function public.oly_advance_scheduled_closures()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  update public.oly_schools
     set status = 'enrollment_closed', updated_at = now()
   where status = 'enrollment_open'
     and enrollment_closes_at is not null
     and enrollment_closes_at <= now();
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'advanced', v_n);
end;
$$;
revoke execute on function public.oly_advance_scheduled_closures() from authenticated, public;
grant execute on function public.oly_advance_scheduled_closures() to service_role;

-- Extend audit-log actions (DROP + recreate with cumulative set + 2 new).
alter table public.oly_audit_log drop constraint if exists oly_audit_log_action_check;
alter table public.oly_audit_log add constraint oly_audit_log_action_check
  check (action in (
    /* paste the FULL existing list from 20260527004820 here, then append: */
    'enrollment_close_scheduled','enrollment_close_cancelled'
  ));
```

Replace the comment with the actual cumulative list read in Step 1 — do NOT drop any existing value.

- [ ] **Step 3: Apply + regen + verify:**
```
npx supabase db push
npx supabase gen types typescript --project-id gyymkgohcijeksmrzuyw > src/integrations/supabase/types.ts
npx tsc --noEmit
```
- [ ] **Step 4: Commit** — `git add supabase/migrations/ src/integrations/supabase/types.ts && git commit -m "feat(olympiad): enrollment_closes_at + open-check + auto-advance RPCs + audit actions"`

## Task B2: `useOlympiadMySchool` returns `enrollment_closes_at`

**Files:** Modify `src/hooks/olympiad/useOlympiadMySchool.ts`

- [ ] **Step 1:** Add `enrollment_closes_at: string | null;` to `MyOlympiadSchool`; add `enrollment_closes_at` to the `.select(...)` column string; add `enrollment_closes_at: data.enrollment_closes_at ?? null` to the returned object.
- [ ] **Step 2: Verify** — `npx tsc --noEmit`, `npx eslint src/hooks/olympiad/useOlympiadMySchool.ts`.
- [ ] **Step 3: Commit** — `git add src/hooks/olympiad/useOlympiadMySchool.ts && git commit -m "feat(olympiad): surface enrollment_closes_at from useOlympiadMySchool"`

## Task B3: `oly-close-enrollment` — schedule / now / cancel modes

**Files:** Modify `supabase/functions/oly-close-enrollment/index.ts`

- [ ] **Step 1: Read** the file. Change the body parse to `{ oly_school_id, mode, closes_at }` where `mode: "schedule" | "now" | "cancel"` (default `"now"` for backward-compat). Keep the existing auth + school-admin/super-admin gate + the `status === 'enrollment_open'` precondition. Then branch:

```ts
const { oly_school_id, mode = "now", closes_at } = (await req.json()) as {
  oly_school_id: string; mode?: "schedule" | "now" | "cancel"; closes_at?: string;
};
// … existing: load school (id, campaign_id, status), gate admin/super, require status==='enrollment_open' …

if (mode === "schedule") {
  if (!closes_at || new Date(closes_at).getTime() <= Date.now()) {
    return json({ error: "closes_at must be a future timestamp" }, 400);
  }
  const { error } = await supabase.from("oly_schools")
    .update({ enrollment_closes_at: closes_at }).eq("id", oly_school_id);
  if (error) return json({ error: error.message }, 500);
  await supabase.from("oly_audit_log").insert({
    campaign_id: school.campaign_id, oly_school_id, actor_id: userId,
    actor_role: isSuper ? "super_admin" : "school_admin",
    action: "enrollment_close_scheduled", after_json: { enrollment_closes_at: closes_at },
  });
  return json({ ok: true }, 200);
}

if (mode === "cancel") {
  const { error } = await supabase.from("oly_schools")
    .update({ enrollment_closes_at: null }).eq("id", oly_school_id);
  if (error) return json({ error: error.message }, 500);
  await supabase.from("oly_audit_log").insert({
    campaign_id: school.campaign_id, oly_school_id, actor_id: userId,
    actor_role: isSuper ? "super_admin" : "school_admin",
    action: "enrollment_close_cancelled",
  });
  return json({ ok: true }, 200);
}

// mode === "now" — existing behavior, also clear any scheduled date.
const { error: updErr } = await supabase.from("oly_schools")
  .update({ status: "enrollment_closed", enrollment_closes_at: null }).eq("id", oly_school_id);
if (updErr) return json({ error: updErr.message }, 500);
await supabase.from("oly_audit_log").insert({
  campaign_id: school.campaign_id, oly_school_id, actor_id: userId,
  actor_role: isSuper ? "super_admin" : "school_admin",
  action: "enrollment_closed",
  before_json: { status: "enrollment_open" }, after_json: { status: "enrollment_closed" },
});
return json({ ok: true }, 200);
```

Keep the existing variable names (`school`, `userId`, `isSuper`, `isAdmin`) — adapt to the real ones in the file.

- [ ] **Step 2: Deploy** — `npx supabase@latest functions deploy oly-close-enrollment --project-ref gyymkgohcijeksmrzuyw`.
- [ ] **Step 3: Commit** — `git add supabase/functions/oly-close-enrollment/ && git commit -m "feat(olympiad): oly-close-enrollment schedule/now/cancel modes"`

## Task B4: `useCloseEnrollment` — mode param

**Files:** Modify `src/hooks/olympiad/useCloseEnrollment.ts`

- [ ] **Step 1:** Replace the mutationFn signature + success copy:

```ts
export function useCloseEnrollment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { olySchoolId: string; mode: "schedule" | "now" | "cancel"; closesAt?: string }) => {
      return invokeEdgeFunction<{ ok: true }>("oly-close-enrollment", {
        oly_school_id: input.olySchoolId,
        mode: input.mode,
        closes_at: input.closesAt,
      });
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ["olympiad"] });
      toast.success(
        vars.mode === "schedule" ? "Closing date scheduled"
        : vars.mode === "cancel" ? "Scheduled close cancelled"
        : "Enrollment closed",
      );
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't update enrollment.", context: "useCloseEnrollment" }),
  });
}
```

- [ ] **Step 2: Verify** — `npx tsc --noEmit` (will flag the old `CloseEnrollmentDialog` call site — fixed in B5), `npx eslint src/hooks/olympiad/useCloseEnrollment.ts`.
- [ ] **Step 3: Commit** — `git add src/hooks/olympiad/useCloseEnrollment.ts && git commit -m "feat(olympiad): useCloseEnrollment mode param"`

## Task B5: `CloseEnrollmentDialog` — schedule / now / cancel

**Files:** Modify `src/components/olympiad/school/CloseEnrollmentDialog.tsx`

- [ ] **Step 1: Replace the whole component** with the scheduling dialog (uses shadcn `Input type="date"`, IST end-of-day):

```tsx
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { useCloseEnrollment } from "@/hooks/olympiad/useCloseEnrollment";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  olySchoolId: string;
  scheduledCloseAt?: string | null; // current enrollment_closes_at, if any
};

// End of the given IST calendar date as a UTC ISO timestamptz (23:59:59.999 IST = 18:29:59.999Z same date).
function endOfDayISTISO(dateStr: string): string {
  return `${dateStr}T18:29:59.999Z`;
}
function todayIST(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

export function CloseEnrollmentDialog({ open, onOpenChange, olySchoolId, scheduledCloseAt }: Props) {
  const close = useCloseEnrollment();
  const preset = scheduledCloseAt ? new Date(scheduledCloseAt).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) : "";
  const [date, setDate] = useState(preset);
  const [confirmNow, setConfirmNow] = useState("");

  const submit = async (mode: "schedule" | "now" | "cancel") => {
    try {
      await close.mutateAsync({
        olySchoolId,
        mode,
        closesAt: mode === "schedule" ? endOfDayISTISO(date) : undefined,
      });
      onOpenChange(false);
      setConfirmNow("");
    } catch { /* toastError fires */ }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Enrollment closing date</AlertDialogTitle>
          <AlertDialogDescription>
            Schedule the last date students can enroll. Enrollment stays open through that day (IST) and closes automatically.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="grid gap-1.5 py-2">
          <Label className="text-xs font-medium text-ink-600">Last enrollment date</Label>
          <Input type="date" min={todayIST()} value={date} onChange={(e) => setDate(e.target.value)} />
          <Button className="mt-2" disabled={!date || close.isPending} onClick={() => submit("schedule")}>
            {close.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {scheduledCloseAt ? "Update closing date" : "Schedule"}
          </Button>
          {scheduledCloseAt && (
            <Button variant="outline" className="mt-1" disabled={close.isPending} onClick={() => submit("cancel")}>
              Cancel scheduled date
            </Button>
          )}
        </div>

        <div className="border-t border-surface-stroke pt-3 space-y-1.5">
          <Label className="text-xs font-medium text-ink-600">Or close immediately — type CLOSE</Label>
          <Input value={confirmNow} onChange={(e) => setConfirmNow(e.target.value)} placeholder="CLOSE" />
          <Button
            variant="destructive"
            className="w-full"
            disabled={confirmNow !== "CLOSE" || close.isPending}
            onClick={() => submit("now")}
          >
            Close enrollment now
          </Button>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>Done</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

> Per CLAUDE.md §20a, the dialog ScrollArea fork applies to `DialogContent` not `AlertDialogContent`; `AlertDialog` is safe here. The `Input type="date"` invisible-text fix in `index.css` covers styling.

- [ ] **Step 2: Verify** — `npx tsc --noEmit`, `npx eslint src/components/olympiad/school/CloseEnrollmentDialog.tsx`.
- [ ] **Step 3: Commit** — `git add src/components/olympiad/school/CloseEnrollmentDialog.tsx && git commit -m "feat(olympiad): CloseEnrollmentDialog schedule/now/cancel with IST end-of-day"`

## Task B6: Dashboard — scheduled-date display + derived closed

**Files:** Modify `src/pages/school/olympiad/OlympiadSchoolDashboardPage.tsx`

- [ ] **Step 1:** Compute effective state + format the scheduled date, and pass `scheduledCloseAt` to the dialog. Near the top of the component (after `school` is available):

```tsx
const closesAt = school.enrollment_closes_at ? new Date(school.enrollment_closes_at) : null;
const effectiveClosed = school.status === "enrollment_closed"
  || (school.status === "enrollment_open" && closesAt !== null && Date.now() >= closesAt.getTime());
const closesDateLabel = closesAt
  ? closesAt.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" })
  : null;
```

- [ ] **Step 2:** In the action-row, replace the existing `enrollment_open` button block. When `status === 'enrollment_open' && !effectiveClosed`:
  - If `closesAt` is set (future): show a line `Enrollment closes on {closesDateLabel}` + a button "Manage closing date" → opens the dialog.
  - Else: button "Close enrollment" → opens the dialog.
  When `effectiveClosed` (status closed OR past the scheduled date): show the existing `enrollment_closed` actions ("Schedule batches" / "View teachers"). Gate those on `effectiveClosed` instead of `status === 'enrollment_closed'` so they appear immediately at the deadline. Example:

```tsx
{school.status === "enrollment_open" && !effectiveClosed && (
  <div className="flex flex-col items-end gap-1">
    {closesDateLabel && <span className="text-xs text-ink-600">Enrollment closes on {closesDateLabel}</span>}
    <Button variant={closesDateLabel ? "outline" : "destructive"} size="sm" onClick={() => setCloseOpen(true)}>
      {closesDateLabel ? "Manage closing date" : "Close enrollment"}
    </Button>
  </div>
)}
{effectiveClosed && school.status !== "batches_scheduled" && (
  <>
    <Button size="sm" onClick={() => navigate("/school/olympiad/batches")}>Schedule batches</Button>
    <NavLink to="/school/olympiad/teachers"><Button size="sm" variant="outline">View teachers</Button></NavLink>
  </>
)}
{/* keep the existing batches_scheduled block unchanged */}
```

- [ ] **Step 3:** Update the dialog render to pass the scheduled date:

```tsx
<CloseEnrollmentDialog open={closeOpen} onOpenChange={setCloseOpen} olySchoolId={school.id} scheduledCloseAt={school.enrollment_closes_at} />
```

- [ ] **Step 4: Verify** — `npx tsc --noEmit`, `npx eslint src/pages/school/olympiad/OlympiadSchoolDashboardPage.tsx`, `npx vite build`.
- [ ] **Step 5: Commit** — `git add src/pages/school/olympiad/OlympiadSchoolDashboardPage.tsx && git commit -m "feat(olympiad): dashboard shows scheduled close date + derives effective-closed"`

## Task B7: Enforce open-check at enrollment entry points

**Files:** Modify `supabase/functions/oly-cash-enroll/index.ts`, `supabase/functions/oly-payment-create-order/index.ts`

- [ ] **Step 1 (cash-enroll):** Replace the `if (school.status !== "enrollment_open")` block (~line 106) with an `oly_enrollment_is_open` RPC check:

```ts
const { data: isOpen } = await supabase.rpc("oly_enrollment_is_open", { p_oly_school_id: school.id });
if (!isOpen) {
  return json({ error: "Enrollment is closed for this school." }, 409);
}
```

- [ ] **Step 2 (payment-create-order):** Read the file; after it loads the target `oly_schools` row (~line 53), add the same gate before creating the Razorpay order / pending row:

```ts
const { data: isOpen } = await supabase.rpc("oly_enrollment_is_open", { p_oly_school_id: <schoolIdVar> });
if (!isOpen) {
  return json({ error: "Enrollment is closed for this school." }, 409);
}
```

Use the file's real school-id variable. If the function resolves the school by short code, pass the resolved `id`.

- [ ] **Step 3: Deploy both** — `npx supabase@latest functions deploy oly-cash-enroll --project-ref gyymkgohcijeksmrzuyw && npx supabase@latest functions deploy oly-payment-create-order --project-ref gyymkgohcijeksmrzuyw`.
- [ ] **Step 4:** (Public page) Read `src/pages/olympiad/OlympiadPublicEnrollmentPage.tsx` (or its resolve hook). If it gates enrollment UI on the school's open state, ensure it treats a set-and-past `enrollment_closes_at` (or `status !== 'enrollment_open'`) as closed — surface an "Enrollment closed" message. If it relies solely on the order edge function's rejection, the 409 from Step 2 already covers it; add a friendly message mapping if needed.
- [ ] **Step 5: Verify + Commit** — `npx tsc --noEmit`, `npx eslint <touched src>` if any; `git add supabase/functions/oly-cash-enroll/ supabase/functions/oly-payment-create-order/ <any src> && git commit -m "feat(olympiad): block enrollment at end-of-day via oly_enrollment_is_open"`

## Task B8: Daily cron auto-advance

**Files:** Modify `supabase/functions/oly-dormancy-pass/index.ts`

- [ ] **Step 1:** Add a new step at the start of the pass (after the `summary` object, before/after Step A), calling the advance RPC:

```ts
// ── Step 0: advance scheduled enrollment closures ─────────────────────────
const { data: advanced, error: advErr } = await supabase.rpc("oly_advance_scheduled_closures");
summary.scheduled_closures = advanced ?? null;
if (advErr) summary.scheduled_closures_error = advErr.message;
```

- [ ] **Step 2: Deploy** — `npx supabase@latest functions deploy oly-dormancy-pass --project-ref gyymkgohcijeksmrzuyw --no-verify-jwt`.
- [ ] **Step 3: Commit** — `git add supabase/functions/oly-dormancy-pass/ && git commit -m "feat(olympiad): dormancy cron advances scheduled enrollment closures"`

## Task B9: Part B build + smoke

- [ ] **Step 1: Full §5a** — `npx tsc --noEmit` (0), `npx eslint "src/pages/school/olympiad/**" "src/components/olympiad/school/**" "src/hooks/olympiad/**"` (clean), `npx vite build` (0).
- [ ] **Step 2: Manual smoke** (school_admin of an `enrollment_open` school):
  - "Close enrollment" → dialog shows date picker + "Close now". Pick a future date → "Schedule" → dashboard shows "Enrollment closes on {date}" + "Manage closing date".
  - Re-open → change the date / cancel → reflected. "Close now" (type CLOSE) → immediate `enrollment_closed`.
  - With a scheduled date in the past (set `enrollment_closes_at` to yesterday via SQL), the public payment page + cash-enroll reject new enrollments; the dashboard shows "Schedule batches" (derived).
  - Run `select public.oly_advance_scheduled_closures();` → that school's status flips to `enrollment_closed`.
- [ ] **Step 3: Commit** (only if smoke fixes were needed).

---

## Self-Review

- **Spec coverage:** §2.1 shell (A1), §2.2 routes (A3), §2.3 PageShell strip (A2), §2.4 sidebar (A4); §3.1 schema (B1), §3.2 edge-fn modes (B3), §3.3 real-time enforcement (B7), §3.4 cron advance (B1+B8), §3.5 dashboard+dialog (B5+B6), §3.6 IST (B5). Covered.
- **Placeholders:** the migration's audit-list is intentionally "read + paste cumulative" (B1 Step 1) — not a placeholder, an instruction to avoid dropping prior actions. App.tsx `allowedRoles` is "copy from existing" (A3) to avoid guessing the role set.
- **Type consistency:** `enrollment_closes_at: string | null` (B2) matches the dialog prop `scheduledCloseAt?: string | null` (B5) and dashboard usage (B6); `useCloseEnrollment` `{ olySchoolId, mode, closesAt? }` (B4) matches the dialog call (B5); RPC names `oly_enrollment_is_open` / `oly_advance_scheduled_closures` consistent across B1/B7/B8.
- **§23/§5a:** new RPCs SECURITY DEFINER + search_path; `oly_advance_scheduled_closures` service_role-only; no `select("*")`; hooks keep explicit staleTime; no `any`/eslint-disable.
