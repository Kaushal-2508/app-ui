# Olympiad Super-Admin Restructure — Phase 3: Aggregation RPCs + Per-School Dashboards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four SECURITY DEFINER aggregation RPCs (derived stage, payment list, result summary, schools-by-stage), then build the in-progress and done per-school detail dashboards (stage, counts, cash/online drilldown, result aggregates) and swap the Phase 2 status-split tab lists onto the derived-stage RPC.

**Architecture:** One migration adds a shared `oly_school_derived_stage(uuid)` helper and four RPCs that call it, all super-admin-gated, paginated where list-returning. Four hooks wrap them (`useQuery` for singles, `useInfiniteQuery` for lists). `OlympiadSchoolDetailPage` (kept standalone with its own `PageShell`) branches on `derived_stage` into in-progress vs done layouts; cash/online StatTiles open a `SchoolPaymentDrilldownSheet`; the done view renders a `SchoolResultSummaryCard`. `OlympiadSchoolsTab`'s in-progress/done lists switch to `useOlympiadSchoolsByStage`.

**Tech Stack:** React 18 + TypeScript, Vite, TanStack Query v5, Supabase (PostgreSQL RPC + RLS), shadcn/ui.

**Spec:** [docs/superpowers/specs/2026-05-27-olympiad-superadmin-restructure-design.md](../specs/2026-05-27-olympiad-superadmin-restructure-design.md) (§4.4, §4.5, §7).

**Depends on:** Phase 1 (routes + standalone detail page), Phase 2 (`OlympiadSchoolsTab` 3-sub-tab host, `oly_enrollment_pending` payment data).

**No test infrastructure** — verify via §5a + a SQL smoke of each RPC.

---

## Verified facts (read before starting) — corrected against shipped migrations

- **Payment/channel data** lives in `oly_enrollment_pending` (NOT `oly_receipts` for this purpose): columns `oly_school_id`, `status` (`'paid'` for completed), `total_paise`, `gst_paise`, `amount_paise`, `gateway_order_id`, `gateway_payment_id`, `promoted_student_id`, `updated_at` (the de-facto paid timestamp; there is NO `paid_at`). Cash vs online is derived from the promoted student's `oly_students.enrollment_channel` (`teacher_cash` = cash, `parent_online` = online) — mirror the existing `useOlympiadSchoolDashboard` hook.
- **Stage signals:** `oly_schools.status` enum (`enrollment_open|enrollment_closed|batches_scheduled|exam_in_progress|results_published|archived`). `oly_batches.is_absentees` (NOT NULL boolean) + `oly_batches.status` (`draft|locked|in_progress|completed|cancelled`). `oly_attempts.status` terminal = anything other than `'in_progress'` (`submitted|auto_submitted_*`); `oly_attempts.percentage` is populated by `oly_submit_attempt`.
- **Results:** `oly_results.certificate_tier IN ('gold','silver','bronze','participation','absent')` (NO 'merit'); `oly_results.class_rank` / `school_rank` (NOT `rank`); `percentage`, `total_marks_obtained`, `published_at`.
- **School type:** `oly_schools.is_existing_salci_school` (boolean). School display name via `institutions(name)` join (no `oly_schools.name`).
- **Helpers:** `is_super_admin(auth.uid())` exists and is the gate used by every Olympiad RPC.
- **`StatTile`** (`src/components/shared/surfaces/StatTile.tsx`): props `label`, `value`, `icon: ReactNode`, `tone?`, `delta?`, `className?` — NO `onClick`/`href`. To make a tile clickable, wrap it in a `<button>`. `icon` takes a node (`<Users className="h-5 w-5" />`), not a component reference. `StatTileGrid` wraps tiles.
- **`MobileSheet`** prop is `subtitle` (not `description`) + `title`.
- **`OlympiadSchoolDetailPage`** currently: own `PageShell`, back `NavLink`, `PageHeader` (title `school.institution_name`), a "View as Admin" button (`ImpersonateDialog`), an "Archive" button (enabled only when `status==='results_published'`), a `StatTileGrid` (Enrolled / Revenue / Status), `PublicPaymentLink`, contact + danger-zone (`RefundConfirmDialog`). `useParams()` (no generic). Data via `useOlympiadSchool(olySchoolId)`.

---

## File Structure

- **Create** `supabase/migrations/<ts>_oly_phase_3_aggregation_rpcs.sql` — `oly_school_derived_stage` helper + 4 RPCs.
- **Modify** `src/integrations/supabase/types.ts` — regenerated.
- **Create** `src/hooks/olympiad/useOlympiadSchoolOverview.ts` — `useQuery` over `oly_school_overview`.
- **Create** `src/hooks/olympiad/useOlympiadSchoolPaymentList.ts` — `useInfiniteQuery` over `oly_school_payment_list`.
- **Create** `src/hooks/olympiad/useOlympiadSchoolResultSummary.ts` — `useQuery` over `oly_school_result_summary`.
- **Create** `src/hooks/olympiad/useOlympiadSchoolsByStage.ts` — `useInfiniteQuery` over `oly_schools_by_stage`.
- **Create** `src/components/olympiad/admin/SchoolPaymentDrilldownSheet.tsx` — paginated student-payment list per channel.
- **Create** `src/components/olympiad/admin/SchoolResultSummaryCard.tsx` — tier counts + average + top scorers.
- **Modify** `src/pages/admin/olympiad/OlympiadSchoolDetailPage.tsx` — derived-stage branch + drilldown wiring + result summary (keep standalone PageShell).
- **Modify** `src/pages/admin/olympiad/OlympiadSchoolsTab.tsx` — swap in-progress/done lists to `useOlympiadSchoolsByStage`.

---

## Task 1: Migration — derived-stage helper + 4 RPCs

**Files:** Create `supabase/migrations/<ts>_oly_phase_3_aggregation_rpcs.sql` (timestamp via `[DateTime]::UtcNow.ToString('yyyyMMddHHmmss')`, must sort after the latest existing migration).

- [ ] **Step 1: Write the migration.** All functions `SECURITY DEFINER SET search_path = public`, super-admin-gated, `GRANT EXECUTE ... TO authenticated`.

```sql
-- Phase 3 — super-admin per-school aggregation. All SECURITY DEFINER + super_admin gated.
-- Derived stage is computed in ONE helper reused by overview + schools_by_stage.

-- all-exams-finished: >=1 non-absentee batch and all such batches completed,
-- and no in-progress attempts. Zero-batch schools never reach exam_completed.
create or replace function public.oly_school_derived_stage(p_oly_school_id uuid)
returns text language sql stable security definer set search_path = public as $$
  with sc as (select status from public.oly_schools where id = p_oly_school_id),
  batches as (
    select count(*) filter (where not is_absentees) as total,
           count(*) filter (where not is_absentees and status = 'completed') as done
    from public.oly_batches where oly_school_id = p_oly_school_id
  ),
  inflight as (
    select count(*) as n
    from public.oly_attempts a
    join public.oly_students s on s.id = a.oly_student_id
    where s.oly_school_id = p_oly_school_id and a.status = 'in_progress'
  )
  select case
    when (select status from sc) in ('results_published','archived') then 'exam_completed'
    when (select status from sc) = 'exam_in_progress'
         and (select total from batches) > 0
         and (select total from batches) = (select done from batches)
         and (select n from inflight) = 0 then 'exam_completed'
    when (select status from sc) = 'exam_in_progress' then 'exam_in_progress'
    when (select status from sc) = 'batches_scheduled' then 'exam_scheduled'
    else 'enrollment'
  end;
$$;
grant execute on function public.oly_school_derived_stage(uuid) to authenticated;

-- 1) overview: single row of stage + counts + payment split
create or replace function public.oly_school_overview(p_oly_school_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.is_super_admin(auth.uid()) then raise exception 'forbidden' using errcode = '42501'; end if;
  select jsonb_build_object(
    'derived_stage', public.oly_school_derived_stage(p_oly_school_id),
    'total_students', (select count(*) from public.oly_students s where s.oly_school_id = p_oly_school_id and s.status = 'active'),
    'attempted_count', (select count(*) from public.oly_attempts a join public.oly_students s on s.id = a.oly_student_id where s.oly_school_id = p_oly_school_id and a.status <> 'in_progress'),
    'cash_count', (select count(*) from public.oly_enrollment_pending ep join public.oly_students s on s.id = ep.promoted_student_id where ep.oly_school_id = p_oly_school_id and ep.status = 'paid' and s.enrollment_channel = 'teacher_cash'),
    'cash_paise', coalesce((select sum(ep.total_paise) from public.oly_enrollment_pending ep join public.oly_students s on s.id = ep.promoted_student_id where ep.oly_school_id = p_oly_school_id and ep.status = 'paid' and s.enrollment_channel = 'teacher_cash'), 0),
    'online_count', (select count(*) from public.oly_enrollment_pending ep join public.oly_students s on s.id = ep.promoted_student_id where ep.oly_school_id = p_oly_school_id and ep.status = 'paid' and s.enrollment_channel = 'parent_online'),
    'online_paise', coalesce((select sum(ep.total_paise) from public.oly_enrollment_pending ep join public.oly_students s on s.id = ep.promoted_student_id where ep.oly_school_id = p_oly_school_id and ep.status = 'paid' and s.enrollment_channel = 'parent_online'), 0),
    'results_published', exists (select 1 from public.oly_results r where r.oly_school_id = p_oly_school_id)
  ) into v;
  return v;
end;
$$;
grant execute on function public.oly_school_overview(uuid) to authenticated;

-- 2) payment list: paginated students per channel (cursor = updated_at desc)
create or replace function public.oly_school_payment_list(
  p_oly_school_id uuid, p_channel text, p_limit int default 50, p_cursor timestamptz default null
) returns table (
  oly_student_id uuid, full_name text, roll_number text,
  total_paise integer, gst_paise integer,
  gateway_order_id text, gateway_payment_id text, paid_at timestamptz
) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_super_admin(auth.uid()) then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select s.id, s.full_name, s.roll_number,
           ep.total_paise, ep.gst_paise,
           ep.gateway_order_id, ep.gateway_payment_id, ep.updated_at
    from public.oly_enrollment_pending ep
    join public.oly_students s on s.id = ep.promoted_student_id
    where ep.oly_school_id = p_oly_school_id
      and ep.status = 'paid'
      and s.enrollment_channel = (case when p_channel = 'cash' then 'teacher_cash' else 'parent_online' end)
      and (p_cursor is null or ep.updated_at < p_cursor)
    order by ep.updated_at desc
    limit greatest(1, least(p_limit, 200));
end;
$$;
grant execute on function public.oly_school_payment_list(uuid,text,int,timestamptz) to authenticated;

-- 3) result summary: published -> oly_results; else provisional from terminal attempts
create or replace function public.oly_school_result_summary(p_oly_school_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb; v_published boolean;
begin
  if not public.is_super_admin(auth.uid()) then raise exception 'forbidden' using errcode = '42501'; end if;
  v_published := exists (select 1 from public.oly_results r where r.oly_school_id = p_oly_school_id);
  if v_published then
    select jsonb_build_object(
      'published', true,
      'gold_count', count(*) filter (where certificate_tier = 'gold'),
      'silver_count', count(*) filter (where certificate_tier = 'silver'),
      'bronze_count', count(*) filter (where certificate_tier = 'bronze'),
      'participation_count', count(*) filter (where certificate_tier = 'participation'),
      'absent_count', count(*) filter (where certificate_tier = 'absent'),
      'avg_percentage', round(coalesce(avg(percentage) filter (where certificate_tier <> 'absent'), 0), 2),
      'top_scorers', (
        select coalesce(jsonb_agg(t), '[]'::jsonb) from (
          select s.full_name, s.roll_number, r2.percentage, r2.school_rank
          from public.oly_results r2 join public.oly_students s on s.id = r2.oly_student_id
          where r2.oly_school_id = p_oly_school_id and r2.school_rank is not null
          order by r2.school_rank asc limit 3
        ) t)
    ) into v from public.oly_results where oly_school_id = p_oly_school_id;
  else
    select jsonb_build_object(
      'published', false,
      'attempted_count', count(*),
      'avg_percentage', round(coalesce(avg(a.percentage), 0), 2),
      'top_scorers', '[]'::jsonb
    ) into v
    from public.oly_attempts a join public.oly_students s on s.id = a.oly_student_id
    where s.oly_school_id = p_oly_school_id and a.status <> 'in_progress';
  end if;
  return v;
end;
$$;
grant execute on function public.oly_school_result_summary(uuid) to authenticated;

-- 4) schools by stage bucket + type (cursor = created_at desc)
create or replace function public.oly_schools_by_stage(
  p_campaign_id uuid, p_bucket text, p_school_type text default 'all',
  p_limit int default 50, p_cursor timestamptz default null
) returns table (
  id uuid, institution_name text, school_short_code text,
  city text, state text, status text, is_existing boolean,
  enrolled_count bigint, derived_stage text, created_at timestamptz
) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_super_admin(auth.uid()) then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select sc.id, i.name, sc.school_short_code, sc.city, sc.state, sc.status,
           sc.is_existing_salci_school,
           (select count(*) from public.oly_students s where s.oly_school_id = sc.id and s.status = 'active'),
           public.oly_school_derived_stage(sc.id),
           sc.created_at
    from public.oly_schools sc
    join public.institutions i on i.id = sc.institution_id
    where sc.campaign_id = p_campaign_id
      and (p_school_type = 'all'
           or (p_school_type = 'new' and sc.is_existing_salci_school = false)
           or (p_school_type = 'existing' and sc.is_existing_salci_school = true))
      and (
        (p_bucket = 'done' and public.oly_school_derived_stage(sc.id) = 'exam_completed')
        or (p_bucket = 'in_progress' and public.oly_school_derived_stage(sc.id) <> 'exam_completed')
      )
      and (p_cursor is null or sc.created_at < p_cursor)
    order by sc.created_at desc
    limit greatest(1, least(p_limit, 200));
end;
$$;
grant execute on function public.oly_schools_by_stage(uuid,text,text,int,timestamptz) to authenticated;
```

- [ ] **Step 2: Apply + regenerate types + verify.**
```
npx supabase db push
npx supabase gen types typescript --project-id gyymkgohcijeksmrzuyw > src/integrations/supabase/types.ts
npx tsc --noEmit
```
- [ ] **Step 3: SQL smoke** (as super_admin, via Supabase SQL editor): `select public.oly_school_overview('<id>');`, `select * from public.oly_schools_by_stage('<campaign>','in_progress','all',20,null);` and `'done'` — confirm a zero-batch school never lands in `done`.
- [ ] **Step 4: Commit** — `git add supabase/migrations/ src/integrations/supabase/types.ts && git commit -m "feat(olympiad): phase 3 aggregation RPCs (derived stage, overview, payment list, result summary, schools-by-stage)"`

## Task 2: Hook `useOlympiadSchoolOverview`

**Files:** Create `src/hooks/olympiad/useOlympiadSchoolOverview.ts`

```ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface OlympiadSchoolOverview {
  derived_stage: "enrollment" | "exam_scheduled" | "exam_in_progress" | "exam_completed";
  total_students: number;
  attempted_count: number;
  cash_count: number;
  cash_paise: number;
  online_count: number;
  online_paise: number;
  results_published: boolean;
}

export function useOlympiadSchoolOverview(olySchoolId: string | undefined) {
  return useQuery({
    queryKey: ["olympiad", "school-overview", olySchoolId],
    enabled: !!olySchoolId,
    queryFn: async (): Promise<OlympiadSchoolOverview> => {
      const { data, error } = await supabase.rpc("oly_school_overview", { p_oly_school_id: olySchoolId as string });
      if (error) throw error;
      return data as unknown as OlympiadSchoolOverview;
    },
    staleTime: 30_000,
  });
}
```

- [ ] Verify (`tsc` + `eslint`) and commit: `git add src/hooks/olympiad/useOlympiadSchoolOverview.ts && git commit -m "feat(olympiad): useOlympiadSchoolOverview hook"`

## Task 3: Hook `useOlympiadSchoolPaymentList` (infinite)

**Files:** Create `src/hooks/olympiad/useOlympiadSchoolPaymentList.ts`

```ts
import { useInfiniteQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface PaymentListRow {
  oly_student_id: string;
  full_name: string;
  roll_number: string;
  total_paise: number;
  gst_paise: number;
  gateway_order_id: string | null;
  gateway_payment_id: string | null;
  paid_at: string;
}

const PAGE = 50;

export function useOlympiadSchoolPaymentList(
  olySchoolId: string | undefined, channel: "cash" | "online", enabled: boolean,
) {
  return useInfiniteQuery({
    queryKey: ["olympiad", "payment-list", olySchoolId, channel],
    enabled: enabled && !!olySchoolId,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }): Promise<PaymentListRow[]> => {
      const { data, error } = await supabase.rpc("oly_school_payment_list", {
        p_oly_school_id: olySchoolId as string,
        p_channel: channel,
        p_limit: PAGE,
        p_cursor: pageParam,
      });
      if (error) throw error;
      return (data ?? []) as unknown as PaymentListRow[];
    },
    getNextPageParam: (last) => (last.length === PAGE ? last[last.length - 1].paid_at : undefined),
    staleTime: 30_000,
  });
}
```

- [ ] Verify + commit: `git add src/hooks/olympiad/useOlympiadSchoolPaymentList.ts && git commit -m "feat(olympiad): useOlympiadSchoolPaymentList infinite hook"`

## Task 4: Hook `useOlympiadSchoolResultSummary`

**Files:** Create `src/hooks/olympiad/useOlympiadSchoolResultSummary.ts`

```ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface TopScorer { full_name: string; roll_number: string; percentage: number; school_rank: number }
export interface ResultSummary {
  published: boolean;
  gold_count?: number; silver_count?: number; bronze_count?: number;
  participation_count?: number; absent_count?: number;
  attempted_count?: number;
  avg_percentage: number;
  top_scorers: TopScorer[];
}

export function useOlympiadSchoolResultSummary(olySchoolId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["olympiad", "result-summary", olySchoolId],
    enabled: enabled && !!olySchoolId,
    queryFn: async (): Promise<ResultSummary> => {
      const { data, error } = await supabase.rpc("oly_school_result_summary", { p_oly_school_id: olySchoolId as string });
      if (error) throw error;
      return data as unknown as ResultSummary;
    },
    staleTime: 60_000,
  });
}
```

- [ ] Verify + commit: `git add src/hooks/olympiad/useOlympiadSchoolResultSummary.ts && git commit -m "feat(olympiad): useOlympiadSchoolResultSummary hook"`

## Task 5: Hook `useOlympiadSchoolsByStage` (infinite)

**Files:** Create `src/hooks/olympiad/useOlympiadSchoolsByStage.ts`

```ts
import { useInfiniteQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface StageSchoolRow {
  id: string; institution_name: string; school_short_code: string;
  city: string | null; state: string | null; status: string;
  is_existing: boolean; enrolled_count: number; derived_stage: string; created_at: string;
}

const PAGE = 50;

export function useOlympiadSchoolsByStage(
  campaignId: string | undefined,
  bucket: "in_progress" | "done",
  schoolType: "all" | "new" | "existing",
) {
  return useInfiniteQuery({
    queryKey: ["olympiad", "schools-by-stage", campaignId, bucket, schoolType],
    enabled: !!campaignId,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }): Promise<StageSchoolRow[]> => {
      const { data, error } = await supabase.rpc("oly_schools_by_stage", {
        p_campaign_id: campaignId as string,
        p_bucket: bucket,
        p_school_type: schoolType,
        p_limit: PAGE,
        p_cursor: pageParam,
      });
      if (error) throw error;
      return (data ?? []) as unknown as StageSchoolRow[];
    },
    getNextPageParam: (last) => (last.length === PAGE ? last[last.length - 1].created_at : undefined),
    staleTime: 30_000,
  });
}
```

- [ ] Verify + commit: `git add src/hooks/olympiad/useOlympiadSchoolsByStage.ts && git commit -m "feat(olympiad): useOlympiadSchoolsByStage infinite hook"`

## Task 6: `SchoolPaymentDrilldownSheet`

**Files:** Create `src/components/olympiad/admin/SchoolPaymentDrilldownSheet.tsx`

- [ ] **Step 1: Create the sheet** — flattens the infinite pages, lists students; online rows show stored gateway IDs; a "Load more" button when `hasNextPage`. Uses paise→₹ formatting (`(paise/100).toLocaleString("en-IN")`).

```tsx
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MobileSheet } from "@/components/shared/sheets/MobileSheet";
import { EmptyState } from "@/components/shared/surfaces/EmptyState";
import { useOlympiadSchoolPaymentList } from "@/hooks/olympiad/useOlympiadSchoolPaymentList";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  olySchoolId: string;
  channel: "cash" | "online";
};

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN")}`;

export function SchoolPaymentDrilldownSheet({ open, onOpenChange, olySchoolId, channel }: Props) {
  const q = useOlympiadSchoolPaymentList(olySchoolId, channel, open);
  const rows = (q.data?.pages ?? []).flat();

  return (
    <MobileSheet
      open={open}
      onOpenChange={onOpenChange}
      title={channel === "cash" ? "Cash payments" : "Online payments"}
      subtitle={`${rows.length} student${rows.length === 1 ? "" : "s"}`}
    >
      {q.isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-ink-500" /></div>
      ) : rows.length === 0 ? (
        <EmptyState title="No payments" description={`No ${channel} payments recorded yet.`} />
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.oly_student_id} className="surface-card rounded-md p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink-900 truncate">{r.full_name}</p>
                  <p className="text-xs text-ink-500">{r.roll_number}</p>
                </div>
                <p className="text-sm font-semibold text-ink-900">{rupees(r.total_paise)}</p>
              </div>
              {channel === "online" && (r.gateway_payment_id || r.gateway_order_id) && (
                <div className="mt-2 space-y-0.5 text-[11px] text-ink-500">
                  {r.gateway_payment_id && <p>Payment: <code>{r.gateway_payment_id}</code></p>}
                  {r.gateway_order_id && <p>Order: <code>{r.gateway_order_id}</code></p>}
                </div>
              )}
            </div>
          ))}
          {q.hasNextPage && (
            <Button variant="outline" className="w-full" disabled={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>
              {q.isFetchingNextPage && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Load more
            </Button>
          )}
        </div>
      )}
    </MobileSheet>
  );
}
```

> Live Razorpay payment-method detail is deferred (spec §9). Stored IDs only here.

- [ ] Verify + commit: `git add src/components/olympiad/admin/SchoolPaymentDrilldownSheet.tsx && git commit -m "feat(olympiad): SchoolPaymentDrilldownSheet (per-channel paginated payments)"`

## Task 7: `SchoolResultSummaryCard`

**Files:** Create `src/components/olympiad/admin/SchoolResultSummaryCard.tsx`

```tsx
import { type ResultSummary } from "@/hooks/olympiad/useOlympiadSchoolResultSummary";

export function SchoolResultSummaryCard({ summary }: { summary: ResultSummary }) {
  return (
    <section className="surface-card frosted-shadow rounded-card p-5 space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <p className="eyebrow">Results</p>
          <h3 className="text-base font-semibold text-ink-900">
            {summary.published ? "Published results" : "Provisional (not yet published)"}
          </h3>
        </div>
        <span className="text-sm text-ink-600">Avg {summary.avg_percentage}%</span>
      </header>

      {summary.published ? (
        <div className="grid grid-cols-3 gap-2 text-center sm:grid-cols-5">
          {[
            ["Gold", summary.gold_count], ["Silver", summary.silver_count], ["Bronze", summary.bronze_count],
            ["Participation", summary.participation_count], ["Absent", summary.absent_count],
          ].map(([label, n]) => (
            <div key={label as string} className="rounded-md bg-surface-card py-2">
              <p className="text-lg font-bold text-ink-900">{(n as number) ?? 0}</p>
              <p className="text-[11px] text-ink-500">{label}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-ink-600">{summary.attempted_count ?? 0} students attempted. Publish to finalize tiers and ranks.</p>
      )}

      {summary.top_scorers.length > 0 && (
        <div className="space-y-1.5">
          <p className="eyebrow">Top scorers</p>
          {summary.top_scorers.map((t) => (
            <div key={t.roll_number} className="flex items-center justify-between text-sm">
              <span className="text-ink-900">#{t.school_rank} {t.full_name}</span>
              <span className="text-ink-600">{t.percentage}%</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
```

- [ ] Verify + commit: `git add src/components/olympiad/admin/SchoolResultSummaryCard.tsx && git commit -m "feat(olympiad): SchoolResultSummaryCard"`

## Task 8: Detail page — in-progress vs done

**Files:** Modify `src/pages/admin/olympiad/OlympiadSchoolDetailPage.tsx`

- [ ] **Step 1: Read the current file in full.** Keep its `PageShell`, back link, `PageHeader`, "View as Admin"/"Archive" buttons, contact + danger-zone sections. Add overview-driven sections.
- [ ] **Step 2:** Add `const overview = useOlympiadSchoolOverview(olySchoolId)` and `const isDone = overview.data?.derived_stage === "exam_completed"`. Replace/augment the existing StatTileGrid with overview-driven tiles:
  - In-progress: a stage badge (from `overview.data.derived_stage`), **Total students** (`total_students`), **Attempted** (`attempted_count`, only when `derived_stage === "exam_in_progress"`), and two clickable cash/online tiles.
  - Done: a "Revenue" pair of cash/online tiles + `<SchoolResultSummaryCard summary={resultSummary.data} />` (from `useOlympiadSchoolResultSummary(olySchoolId, isDone)`).
- [ ] **Step 3:** Cash/online tiles — wrap `StatTile` in a `<button>` (StatTile has no `onClick`) that opens `SchoolPaymentDrilldownSheet` with the chosen channel:

```tsx
const [drillChannel, setDrillChannel] = useState<"cash" | "online" | null>(null);
// ...
<button type="button" onClick={() => setDrillChannel("cash")} className="text-left">
  <StatTile label="Cash collected" value={`₹${((overview.data?.cash_paise ?? 0) / 100).toLocaleString("en-IN")}`} icon={<Banknote className="h-5 w-5" />} tone="mint" />
</button>
<button type="button" onClick={() => setDrillChannel("online")} className="text-left">
  <StatTile label="Online collected" value={`₹${((overview.data?.online_paise ?? 0) / 100).toLocaleString("en-IN")}`} icon={<CreditCard className="h-5 w-5" />} tone="sky" />
</button>
// ...
{drillChannel && olySchoolId && (
  <SchoolPaymentDrilldownSheet
    open={!!drillChannel}
    onOpenChange={(o) => !o && setDrillChannel(null)}
    olySchoolId={olySchoolId}
    channel={drillChannel}
  />
)}
```

Add imports: `useState` (if absent), `Banknote`, `CreditCard` from lucide, the three new hooks, `SchoolPaymentDrilldownSheet`, `SchoolResultSummaryCard`, `StatTile`/`StatTileGrid`.

- [ ] **Step 4:** Keep the page as a standalone `PageShell` route (do NOT nest it under the tab shell). Verify — `npx tsc --noEmit`, `npx eslint src/pages/admin/olympiad/OlympiadSchoolDetailPage.tsx`, `npx vite build`.
- [ ] **Step 5: Commit** — `git add src/pages/admin/olympiad/OlympiadSchoolDetailPage.tsx && git commit -m "feat(olympiad): school detail in-progress/done dashboards + payment drilldown"`

## Task 9: Swap tab lists to derived stage

**Files:** Modify `src/pages/admin/olympiad/OlympiadSchoolsTab.tsx`

- [ ] **Step 1:** Replace the Phase 2 `useOlympiadSchools` + `DONE_STATUSES` client split for the in-progress/done sub-tabs with `useOlympiadSchoolsByStage(campaignId, bucket, type)`. The New/Onboarded `FilterChip` now feeds `schoolType` (`all`/`new`/`existing`) directly to the hook (drop client `filterByType`). Render `(q.data?.pages ?? []).flat()` via `SchoolListRow` — but `StageSchoolRow` differs from `OlympiadSchoolRow` (it has `institution_name`, `is_existing`, `derived_stage`). Map each `StageSchoolRow` to the `SchoolListRow` shape, or extend `SchoolListRow` to accept the stage row. Simplest: render a lightweight inline row (NavLink to `/admin/olympiad/schools/${row.id}` with `institution_name` + `school_short_code` + a derived-stage badge). Add a "Load more" button on `hasNextPage`.
- [ ] **Step 2:** The **Onboard** sub-tab is unchanged. Verify — `npx tsc --noEmit`, `npx eslint src/pages/admin/olympiad/OlympiadSchoolsTab.tsx`, `npx vite build`.
- [ ] **Step 3: Commit** — `git add src/pages/admin/olympiad/OlympiadSchoolsTab.tsx && git commit -m "feat(olympiad): schools in-progress/done lists use derived-stage RPC"`

## Task 10: Manual smoke

- [ ] In-progress school detail: stage badge, total/attempted counts, cash & online tiles open the drilldown (online shows gateway IDs).
- [ ] Done school detail (published): revenue split + result summary (tier counts, avg, top scorers). Done school (exam finished, unpublished): provisional summary + "not yet published" note.
- [ ] Schools tab: in-progress/done buckets partition by derived stage; New/Onboarded filter narrows; a zero-batch school stays in in-progress.

---

## Self-review

- **Spec coverage:** §4.4 (Task 1 helper), §4.5 in-progress + done (Tasks 6,7,8), §7 RPCs (Task 1) + hooks (Tasks 2–5), list swap (Task 9). Covered.
- **Placeholders:** none — complete SQL/hook/component code; Task 8/9 are precise edits over the read file.
- **§23:** all RPCs SECURITY DEFINER + super-admin gated + bounded `limit`; lists cursor-paginated; hooks set explicit `staleTime`; no `select("*")`; no client `.length` over capped reads (counts are server-side).
- **Gotchas guarded:** StatTile wrapped in button (no onClick prop); MobileSheet uses `subtitle`; detail page stays standalone PageShell; certificate_tier set verified (no 'merit'); paid timestamp = `updated_at`.
