# Onboarding Progress Dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-app Onboarding Progress Dashboard reachable from the existing Command Center → Download Report modal (new "Open Dashboard" sibling button when the Onboarding Report radio is selected), without touching the existing Excel report.

**Architecture:** A new `onboarding_snapshots` Postgres table persists a daily per-institution snapshot, written exclusively by a SECURITY DEFINER RPC `ensure_onboarding_snapshot`. The dashboard page reuses the existing `useInstitutionOnboardingProgress` hook for live data, calls the RPC on mount to materialise today's snapshot, fetches yesterday's snapshot for delta baseline, and renders 9 sections built on the project's mobile design primitives (`PageShell`, `PageHeader`, `StatTile`, `ListRow`, Recharts).

**Tech Stack:** React 18 + TypeScript + Vite, TanStack Query v5, Supabase JS v2, shadcn/ui + Tailwind, Recharts, react-router-dom v6. **No test runner in this project** — verification is `npx tsc --noEmit` + `npx eslint <paths>` + `npx vite build` + browser smoke per CLAUDE.md §5a.

**Spec:** [docs/superpowers/specs/2026-05-16-onboarding-progress-dashboard-design.md](../specs/2026-05-16-onboarding-progress-dashboard-design.md)

---

## File map

### New files

| Path | Purpose |
|---|---|
| `supabase/migrations/20260516120000_onboarding_snapshots.sql` | Table + indices + RLS + `ensure_onboarding_snapshot` RPC. **Flag for manual review — do NOT run `npx supabase db push` as part of the plan.** |
| `src/lib/onboardingDashboardMath.ts` | Pure functions for deltas, consecutive-zero-day counting, alert derivation, and tier bucketing. No React, no Supabase. |
| `src/hooks/useOnboardingDashboard.ts` | Composing hook: live progress + snapshot upsert mutation + prior-day baseline query + last-30-snapshots query. Returns the aggregated dashboard view-model. |
| `src/pages/school/OnboardingDashboardPage.tsx` | Top-level page wired to `PageShell` + `PageHeader` + the 9 sections. |
| `src/components/onboarding-dashboard/SummaryBanner.tsx` | Section 1 — `StatTileGrid` (total / fully complete / avg % / generated). |
| `src/components/onboarding-dashboard/DeltaBar.tsx` | Section 2 — horizontal delta chip strip. "First report" empty state. |
| `src/components/onboarding-dashboard/AlertCards.tsx` | Section 3 — conditional render of 0–4 alert variants. |
| `src/components/onboarding-dashboard/KpiCards.tsx` | Section 4 — 6 `StatTile`s with delta badges. |
| `src/components/onboarding-dashboard/ProgressTrendChart.tsx` | Section 5 — Recharts `LineChart` or single-day summary. |
| `src/components/onboarding-dashboard/DistributionAndFunnel.tsx` | Section 6 — side-by-side tier distribution + milestone funnel. |
| `src/components/onboarding-dashboard/CompletedTeachersList.tsx` | Section 7 — `ListRow`s with "New today" badge. |
| `src/components/onboarding-dashboard/PerTeacherTable.tsx` | Section 8 — filterable table. |
| `src/components/onboarding-dashboard/PendingTasksGrid.tsx` | Section 9 — per-teacher cards `< 100 %` with close-today / stuck-for-X pills. |

### Modified files

| Path | Change |
|---|---|
| `src/components/command-center/ReportModal.tsx` | When `reportType === "onboarding"`, render `[Generate & Download Excel] [Open Dashboard]` side by side; other radios unchanged. |
| `src/App.tsx` | New lazy import + new `<Route path="/school/onboarding-dashboard">` mirroring `/school/command-center`. |

---

## Task 1: Database migration (table + RPC + RLS)

**Files:**
- Create: `supabase/migrations/20260516120000_onboarding_snapshots.sql`

**This migration is flagged for manual review. DO NOT run `npx supabase db push` in this task. Hand off to the user once the SQL file lands.**

- [ ] **Step 1.1: Create the migration file**

Write this exact SQL:

```sql
-- =============================================================
-- onboarding_snapshots — per-institution daily snapshot of teacher
-- + coordinator onboarding-journey progress. Powers the in-app
-- Onboarding Progress Dashboard delta + trend views.
--
-- Writes happen ONLY via ensure_onboarding_snapshot() below
-- (SECURITY DEFINER, first-of-day wins). Reads are scoped to
-- school admins / coordinators at that institution + super_admin.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.onboarding_snapshots (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id           UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  snapshot_date            DATE NOT NULL,
  total_users              INT  NOT NULL,
  fully_complete_count     INT  NOT NULL,
  avg_completion_percent   NUMERIC(5,2) NOT NULL,
  milestone_counts         JSONB NOT NULL,
  per_user_data            JSONB NOT NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by               UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  UNIQUE (institution_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS onboarding_snapshots_institution_date_idx
  ON public.onboarding_snapshots (institution_id, snapshot_date DESC);

ALTER TABLE public.onboarding_snapshots ENABLE ROW LEVEL SECURITY;

-- Read-only access for school admins, coordinators at the same institution,
-- and super_admins. Writes always go through ensure_onboarding_snapshot().
DROP POLICY IF EXISTS "Onboarding snapshots readable by institution staff"
  ON public.onboarding_snapshots;

CREATE POLICY "Onboarding snapshots readable by institution staff"
ON public.onboarding_snapshots
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'super_admin'::public.app_role)
  OR institution_id IN (
    SELECT p.institution_id
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND (
        public.has_role(p.id, 'school_admin'::public.app_role)
        OR public.has_role(p.id, 'super_school_admin'::public.app_role)
        OR public.has_role(p.id, 'coordinator'::public.app_role)
      )
  )
);

-- =============================================================
-- ensure_onboarding_snapshot — idempotent "today's snapshot exists"
-- guarantee. Computes counts from get_institution_onboarding_progress
-- and INSERTs only if today's row is missing (first-of-day wins).
-- Returns today's snapshot row (newly inserted OR pre-existing).
-- =============================================================

CREATE OR REPLACE FUNCTION public.ensure_onboarding_snapshot(_institution_id UUID)
RETURNS public.onboarding_snapshots
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller          UUID := auth.uid();
  v_today           DATE := current_date;
  v_existing        public.onboarding_snapshots;
  v_rows            JSONB;
  v_total           INT;
  v_complete        INT;
  v_avg             NUMERIC(5,2);
  v_milestone_cnt   JSONB;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Authorisation: super_admin OR school_admin/super_school_admin at this institution.
  IF NOT public.has_role(v_caller, 'super_admin'::public.app_role)
     AND NOT EXISTS (
       SELECT 1 FROM public.profiles p
       WHERE p.id = v_caller
         AND p.institution_id = _institution_id
         AND (
           public.has_role(p.id, 'school_admin'::public.app_role)
           OR public.has_role(p.id, 'super_school_admin'::public.app_role)
         )
     )
  THEN
    RAISE EXCEPTION 'Not authorised for institution %', _institution_id
      USING ERRCODE = '42501';
  END IF;

  -- Fast path: today's snapshot already exists.
  SELECT * INTO v_existing
  FROM public.onboarding_snapshots
  WHERE institution_id = _institution_id
    AND snapshot_date = v_today
  LIMIT 1;

  IF FOUND THEN
    RETURN v_existing;
  END IF;

  -- Compute fresh aggregates from the existing per-user RPC.
  WITH rows AS (
    SELECT *
    FROM public.get_institution_onboarding_progress(_institution_id)
  )
  SELECT
    COALESCE(jsonb_agg(to_jsonb(rows)), '[]'::jsonb),
    COUNT(*)::int,
    COUNT(*) FILTER (WHERE is_journey_completed)::int,
    COALESCE(ROUND(AVG(completion_percent)::numeric, 2), 0)::numeric(5,2),
    jsonb_build_object(
      'first_task_assigned',            COUNT(*) FILTER (WHERE first_task_assigned)::int,
      'first_task_completed',           COUNT(*) FILTER (WHERE first_task_completed)::int,
      'first_study_material_uploaded',  COUNT(*) FILTER (WHERE first_study_material_uploaded)::int,
      'first_exam_published',           COUNT(*) FILTER (WHERE first_exam_published)::int,
      'first_result_validated',         COUNT(*) FILTER (WHERE first_result_validated)::int
    )
  INTO v_rows, v_total, v_complete, v_avg, v_milestone_cnt
  FROM rows;

  -- First-of-day insert; if a concurrent caller already inserted, return that row.
  INSERT INTO public.onboarding_snapshots (
    institution_id, snapshot_date, total_users, fully_complete_count,
    avg_completion_percent, milestone_counts, per_user_data, created_by
  )
  VALUES (
    _institution_id, v_today, v_total, v_complete,
    v_avg, v_milestone_cnt, v_rows, v_caller
  )
  ON CONFLICT (institution_id, snapshot_date) DO NOTHING
  RETURNING * INTO v_existing;

  IF v_existing.id IS NULL THEN
    SELECT * INTO v_existing
    FROM public.onboarding_snapshots
    WHERE institution_id = _institution_id AND snapshot_date = v_today;
  END IF;

  RETURN v_existing;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_onboarding_snapshot(UUID) TO authenticated;
```

- [ ] **Step 1.2: Verify file is syntactically valid SQL by reading it back**

Run: open the file, confirm the heredoc rendered cleanly, no trailing backticks or markdown artifacts.

- [ ] **Step 1.3: Commit the migration**

```bash
git add supabase/migrations/20260516120000_onboarding_snapshots.sql
git commit -m "feat(onboarding): migration for onboarding_snapshots table + RPC

Adds public.onboarding_snapshots (institution_id, snapshot_date, totals,
milestone_counts jsonb, per_user_data jsonb) with UNIQUE(institution, date)
plus a SECURITY DEFINER ensure_onboarding_snapshot RPC that first-of-day
inserts via get_institution_onboarding_progress. Caller must be super_admin
or school/super_school_admin at the target institution. SELECT-only RLS
admits the same callers + coordinators.

Flagged for manual review — do not auto-apply on production."
```

- [ ] **Step 1.4: Hand off to user**

State explicitly in your status update: "Migration written but NOT pushed. Run `npx supabase db push` manually after review."

---

## Task 2: Pure math module (deltas, zero-day, alerts)

**Files:**
- Create: `src/lib/onboardingDashboardMath.ts`

Pure functions only — no React, no Supabase. Easy to read, easy to reason about.

- [ ] **Step 2.1: Write the module**

```typescript
import type { InstitutionOnboardingRow } from "@/hooks/useOnboardingJourney";

export type MilestoneKey =
  | "first_task_assigned"
  | "first_task_completed"
  | "first_study_material_uploaded"
  | "first_exam_published"
  | "first_result_validated";

export const MILESTONE_KEYS: MilestoneKey[] = [
  "first_task_assigned",
  "first_task_completed",
  "first_study_material_uploaded",
  "first_exam_published",
  "first_result_validated",
];

export const MILESTONE_LABELS: Record<MilestoneKey, string> = {
  first_task_assigned: "First task created or received",
  first_task_completed: "First task completed",
  first_study_material_uploaded: "First study material uploaded",
  first_exam_published: "First exam published",
  first_result_validated: "First result validated or published",
};

export interface SnapshotRow {
  id: string;
  institution_id: string;
  snapshot_date: string; // ISO date "YYYY-MM-DD"
  total_users: number;
  fully_complete_count: number;
  avg_completion_percent: number;
  milestone_counts: Record<MilestoneKey, number>;
  per_user_data: SnapshotPerUserRow[];
  created_at: string;
  created_by: string | null;
}

export interface SnapshotPerUserRow {
  user_id: string;
  full_name: string | null;
  email: string | null;
  role: string | null;
  first_task_assigned: boolean;
  first_task_completed: boolean;
  first_study_material_uploaded: boolean;
  first_exam_published: boolean;
  first_result_validated: boolean;
  completed_count: number;
  completion_percent: number;
  is_journey_completed: boolean;
}

export interface Deltas {
  fullyComplete: number;
  avgCompletion: number; // percentage points
  milestones: Record<MilestoneKey, number>;
  hasBaseline: boolean;
}

const ZERO_DELTAS: Deltas = {
  fullyComplete: 0,
  avgCompletion: 0,
  milestones: {
    first_task_assigned: 0,
    first_task_completed: 0,
    first_study_material_uploaded: 0,
    first_exam_published: 0,
    first_result_validated: 0,
  },
  hasBaseline: false,
};

function liveAggregates(rows: InstitutionOnboardingRow[]) {
  const total = rows.length;
  const fullyComplete = rows.filter((r) => r.isJourneyCompleted).length;
  const avgCompletion =
    total === 0
      ? 0
      : rows.reduce((s, r) => s + Number(r.completionPercent ?? 0), 0) / total;
  const milestones: Record<MilestoneKey, number> = {
    first_task_assigned: rows.filter((r) => r.firstTaskAssigned).length,
    first_task_completed: rows.filter((r) => r.firstTaskCompleted).length,
    first_study_material_uploaded: rows.filter((r) => r.firstStudyMaterialUploaded).length,
    first_exam_published: rows.filter((r) => r.firstExamPublished).length,
    first_result_validated: rows.filter((r) => r.firstResultValidated).length,
  };
  return { total, fullyComplete, avgCompletion, milestones };
}

export function computeDeltas(
  live: InstitutionOnboardingRow[],
  baseline: SnapshotRow | null,
): Deltas {
  if (!baseline) return ZERO_DELTAS;
  const liveAgg = liveAggregates(live);
  const milestoneDeltas = {} as Record<MilestoneKey, number>;
  for (const key of MILESTONE_KEYS) {
    milestoneDeltas[key] = liveAgg.milestones[key] - (baseline.milestone_counts[key] ?? 0);
  }
  return {
    fullyComplete: liveAgg.fullyComplete - baseline.fully_complete_count,
    avgCompletion: Math.round((liveAgg.avgCompletion - Number(baseline.avg_completion_percent)) * 100) / 100,
    milestones: milestoneDeltas,
    hasBaseline: true,
  };
}

const ZERO_LOOKBACK_DAYS = 30;
export const STUCK_TRIGGER_DAYS = 3;
export const STUCK_SEVERE_DAYS = 7;

/**
 * For each user in `live`, count how many consecutive days (from today
 * back) the user was at 0 % completion. Today's check uses `live` (current
 * state); prior days use snapshots. Lookback is capped at 30 days.
 */
export function buildZeroDayMap(
  live: InstitutionOnboardingRow[],
  snapshots: SnapshotRow[],
): Map<string, number> {
  const map = new Map<string, number>();
  const todayZeros = new Set(
    live.filter((r) => Number(r.completionPercent) === 0).map((r) => r.userId),
  );
  if (todayZeros.size === 0) return map;

  // Snapshots sorted descending by date (today/yesterday first).
  const sorted = [...snapshots].sort((a, b) => b.snapshot_date.localeCompare(a.snapshot_date));

  for (const userId of todayZeros) {
    let streak = 1; // counting today
    for (let i = 0; i < Math.min(sorted.length, ZERO_LOOKBACK_DAYS); i++) {
      const snap = sorted[i];
      // Skip if this snapshot IS today's — we already counted live state.
      // We can detect that by comparing to current_date ISO from caller's tz,
      // but safer: treat any snapshot whose per_user row says 0 % as a hit and
      // break when the streak chain breaks.
      const userRow = snap.per_user_data.find((u) => u.user_id === userId);
      if (!userRow) break;
      if (Number(userRow.completion_percent) === 0) {
        streak += 1;
      } else {
        break;
      }
    }
    map.set(userId, streak);
  }
  return map;
}

export type AlertSeverity = "info" | "warning" | "critical" | "success";
export type AlertKind = "escalation" | "closeToDone" | "bottleneck" | "momentum";

export interface DashboardAlert {
  kind: AlertKind;
  severity: AlertSeverity;
  title: string;
  body: string;
}

const BOTTLENECK_THRESHOLD = 0.3; // 30 %
const MOMENTUM_THRESHOLD_PP = 5;

export function deriveAlerts(args: {
  live: InstitutionOnboardingRow[];
  deltas: Deltas;
  zeroDayMap: Map<string, number>;
}): DashboardAlert[] {
  const { live, deltas, zeroDayMap } = args;
  const total = live.length;
  const alerts: DashboardAlert[] = [];
  if (total === 0) return alerts;

  // Escalation: any user stuck >= 3 days. Critical at >= 7.
  const stuck = [...zeroDayMap.entries()]
    .filter(([, days]) => days >= STUCK_TRIGGER_DAYS)
    .sort((a, b) => b[1] - a[1]);
  if (stuck.length > 0) {
    const severeCount = stuck.filter(([, days]) => days >= STUCK_SEVERE_DAYS).length;
    const top = stuck.slice(0, 3).map(([uid, days]) => {
      const u = live.find((r) => r.userId === uid);
      return `${u?.fullName ?? "Unknown"} (${days}d)`;
    }).join(", ");
    alerts.push({
      kind: "escalation",
      severity: severeCount > 0 ? "critical" : "warning",
      title: `${stuck.length} ${stuck.length === 1 ? "person is" : "people are"} stuck at 0 %`,
      body: `Longest: ${top}. ${severeCount > 0 ? `${severeCount} of them ${severeCount === 1 ? "is" : "are"} 7+ days in.` : "Worth a quick nudge."}`,
    });
  }

  // Close-to-done: at 80 % completion (4 of 5 steps).
  const closeCount = live.filter((r) => Number(r.completionPercent) === 80).length;
  if (closeCount > 0) {
    alerts.push({
      kind: "closeToDone",
      severity: "info",
      title: `${closeCount} ${closeCount === 1 ? "person is" : "people are"} one step away from done`,
      body: "One more milestone unlocks 100 % for each of them today.",
    });
  }

  // Bottleneck: study material upload OR result validation below 30 % of total.
  const sm = live.filter((r) => r.firstStudyMaterialUploaded).length;
  const rv = live.filter((r) => r.firstResultValidated).length;
  const bottlenecks: string[] = [];
  if (sm / total < BOTTLENECK_THRESHOLD) bottlenecks.push(`study material upload (${sm}/${total})`);
  if (rv / total < BOTTLENECK_THRESHOLD) bottlenecks.push(`result validation (${rv}/${total})`);
  if (bottlenecks.length > 0) {
    alerts.push({
      kind: "bottleneck",
      severity: "warning",
      title: "Most of your team hasn't crossed a key milestone yet",
      body: `Bottleneck${bottlenecks.length > 1 ? "s" : ""}: ${bottlenecks.join(" and ")}.`,
    });
  }

  // Momentum: average completion jumped >= 5 percentage points today.
  if (deltas.hasBaseline && deltas.avgCompletion >= MOMENTUM_THRESHOLD_PP) {
    alerts.push({
      kind: "momentum",
      severity: "success",
      title: `Avg completion jumped ${deltas.avgCompletion.toFixed(1)} points since yesterday`,
      body: "Whatever your team did today, it's working.",
    });
  }

  return alerts;
}

export type Tier = "100" | "80" | "60" | "40" | "20" | "0";
export const TIER_BUCKETS: Tier[] = ["100", "80", "60", "40", "20", "0"];

export function tierOf(percent: number): Tier {
  if (percent >= 100) return "100";
  if (percent >= 80) return "80";
  if (percent >= 60) return "60";
  if (percent >= 40) return "40";
  if (percent >= 20) return "20";
  return "0";
}

export function distributionByTier(live: InstitutionOnboardingRow[]): Record<Tier, number> {
  const buckets: Record<Tier, number> = { "100": 0, "80": 0, "60": 0, "40": 0, "20": 0, "0": 0 };
  for (const r of live) buckets[tierOf(Number(r.completionPercent))] += 1;
  return buckets;
}

/** IDs that are at 100 % today but were NOT in yesterday's fully-complete set. */
export function newlyCompletedToday(
  live: InstitutionOnboardingRow[],
  baseline: SnapshotRow | null,
): Set<string> {
  const todayIds = new Set(live.filter((r) => r.isJourneyCompleted).map((r) => r.userId));
  if (!baseline) return new Set();
  const baselineIds = new Set(
    baseline.per_user_data.filter((u) => u.is_journey_completed).map((u) => u.user_id),
  );
  const result = new Set<string>();
  for (const id of todayIds) if (!baselineIds.has(id)) result.add(id);
  return result;
}
```

- [ ] **Step 2.2: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: exit 0. If errors mention the new file, fix inline (no `any`, no eslint-disable).

- [ ] **Step 2.3: Verify ESLint on the new file**

Run: `npx eslint src/lib/onboardingDashboardMath.ts`
Expected: clean.

- [ ] **Step 2.4: Commit**

```bash
git add src/lib/onboardingDashboardMath.ts
git commit -m "feat(onboarding): pure math module for dashboard (deltas, alerts, tiers)"
```

---

## Task 3: Composing data hook

**Files:**
- Create: `src/hooks/useOnboardingDashboard.ts`

- [ ] **Step 3.1: Write the hook**

```typescript
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  useInstitutionOnboardingProgress,
  type InstitutionOnboardingRow,
} from "@/hooks/useOnboardingJourney";
import {
  computeDeltas,
  buildZeroDayMap,
  deriveAlerts,
  distributionByTier,
  newlyCompletedToday,
  type Deltas,
  type DashboardAlert,
  type SnapshotRow,
  type Tier,
} from "@/lib/onboardingDashboardMath";

export interface OnboardingDashboardData {
  live: InstitutionOnboardingRow[];
  baseline: SnapshotRow | null;       // yesterday's (or most recent prior) snapshot
  trend: SnapshotRow[];                // last 30 snapshots ASC by date (today inclusive once written)
  deltas: Deltas;
  alerts: DashboardAlert[];
  zeroDayMap: Map<string, number>;
  distribution: Record<Tier, number>;
  newlyCompleted: Set<string>;
  isLoading: boolean;
  isError: boolean;
}

/**
 * Wraps the live onboarding query and snapshot reads. Also fires the
 * SECURITY DEFINER ensure_onboarding_snapshot RPC once on mount to
 * materialise today's snapshot (idempotent — first-of-day wins).
 */
export function useOnboardingDashboard(
  institutionId: string | null | undefined,
): OnboardingDashboardData {
  const queryClient = useQueryClient();

  const liveQuery = useInstitutionOnboardingProgress(institutionId, !!institutionId);

  const baselineQuery = useQuery({
    queryKey: ["onboarding-dashboard", "baseline", institutionId],
    enabled: !!institutionId,
    queryFn: async (): Promise<SnapshotRow | null> => {
      if (!institutionId) return null;
      const { data, error } = await supabase
        .from("onboarding_snapshots" as never)
        .select("*")
        .eq("institution_id", institutionId)
        .lt("snapshot_date", new Date().toISOString().slice(0, 10))
        .order("snapshot_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as SnapshotRow | null) ?? null;
    },
    staleTime: 5 * 60 * 1000,
  });

  const trendQuery = useQuery({
    queryKey: ["onboarding-dashboard", "trend", institutionId],
    enabled: !!institutionId,
    queryFn: async (): Promise<SnapshotRow[]> => {
      if (!institutionId) return [];
      const thirty = new Date();
      thirty.setDate(thirty.getDate() - 30);
      const { data, error } = await supabase
        .from("onboarding_snapshots" as never)
        .select("*")
        .eq("institution_id", institutionId)
        .gte("snapshot_date", thirty.toISOString().slice(0, 10))
        .order("snapshot_date", { ascending: true });
      if (error) throw error;
      return (data as SnapshotRow[] | null) ?? [];
    },
    staleTime: 5 * 60 * 1000,
  });

  const ensureMutation = useMutation({
    mutationFn: async (): Promise<SnapshotRow | null> => {
      if (!institutionId) return null;
      const { data, error } = await supabase.rpc(
        "ensure_onboarding_snapshot" as never,
        { _institution_id: institutionId } as never,
      );
      if (error) throw error;
      // RPC returns a single row (composite type). supabase-js returns
      // it either as an object or as a single-element array depending on
      // codegen lag; handle both shapes.
      if (Array.isArray(data)) return (data[0] as SnapshotRow) ?? null;
      return (data as SnapshotRow | null) ?? null;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["onboarding-dashboard", "trend", institutionId] });
    },
  });

  // Fire-and-forget snapshot ensure on mount / institutionId change.
  useEffect(() => {
    if (!institutionId) return;
    ensureMutation.mutate();
    // We intentionally do not depend on ensureMutation; it's a stable handle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [institutionId]);

  const live = liveQuery.data ?? [];
  const baseline = baselineQuery.data ?? null;
  const trend = trendQuery.data ?? [];

  const deltas = computeDeltas(live, baseline);
  const zeroDayMap = buildZeroDayMap(live, trend);
  const alerts = deriveAlerts({ live, deltas, zeroDayMap });
  const distribution = distributionByTier(live);
  const newlyCompleted = newlyCompletedToday(live, baseline);

  return {
    live,
    baseline,
    trend,
    deltas,
    alerts,
    zeroDayMap,
    distribution,
    newlyCompleted,
    isLoading: liveQuery.isLoading || baselineQuery.isLoading || trendQuery.isLoading,
    isError: liveQuery.isError || baselineQuery.isError || trendQuery.isError,
  };
}
```

**Note on `as never` casts:** the new `onboarding_snapshots` table and `ensure_onboarding_snapshot` RPC are not in `src/integrations/supabase/types.ts` yet (typegen lags). Using `as never` on the table/RPC names lets us bypass the codegen union without falling back to `any` — the return shape is then narrowed via the explicit `SnapshotRow` cast. This matches CLAUDE.md §5a's "narrow inline type, not `any`" rule.

The one `eslint-disable-next-line react-hooks/exhaustive-deps` is unavoidable because `ensureMutation` is a stable mutation handle from React Query and adding it to deps would re-fire the effect on every render. This is the standard pattern for "fire mutation once on mount."

- [ ] **Step 3.2: Run tsc + eslint**

Run: `npx tsc --noEmit`
Expected: exit 0.

Run: `npx eslint src/hooks/useOnboardingDashboard.ts`
Expected: clean.

- [ ] **Step 3.3: Commit**

```bash
git add src/hooks/useOnboardingDashboard.ts
git commit -m "feat(onboarding): useOnboardingDashboard composing hook

Live progress + snapshot baseline + 30-day trend + ensure_onboarding_snapshot
fire-and-forget on mount. Aggregates deltas/alerts/zero-day map via pure
onboardingDashboardMath module."
```

---

## Task 4: Route wiring + ReportModal edit + empty page shell

**Files:**
- Create: `src/pages/school/OnboardingDashboardPage.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/command-center/ReportModal.tsx`

- [ ] **Step 4.1: Create the page shell**

`src/pages/school/OnboardingDashboardPage.tsx`:

```tsx
import { useEffectiveInstitution } from "@/hooks/useEffectiveInstitution";
import { useOnboardingDashboard } from "@/hooks/useOnboardingDashboard";
import { PageShell, PageHeader } from "@/components/shared/page";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, Printer } from "lucide-react";

export default function OnboardingDashboardPage() {
  const { institutionId, institutionName } = useEffectiveInstitution();
  const data = useOnboardingDashboard(institutionId);

  const today = new Date().toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <PageShell>
      <PageHeader
        title="Onboarding Progress"
        subtitle={`${institutionName ?? "School"} · Generated ${today}`}
        primaryAction={{
          label: "Print",
          icon: Printer,
          onClick: () => window.print(),
        }}
      />

      {data.isLoading && (
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      )}

      {data.isError && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Couldn't load onboarding data. Please refresh the page.
          </AlertDescription>
        </Alert>
      )}

      {!data.isLoading && !data.isError && (
        <div className="space-y-6">
          {/* Sections plugged in by tasks 5-11 */}
          <p className="text-sm text-ink-600">
            Loaded {data.live.length} teacher{data.live.length === 1 ? "" : "s"} and coordinator
            {data.live.length === 1 ? "" : "s"}. Sections wire up in subsequent tasks.
          </p>
        </div>
      )}
    </PageShell>
  );
}
```

**Verify the `PageHeader` API:** before saving, open `src/components/shared/page/PageHeader.tsx` and confirm that `primaryAction` accepts `{ label, icon, onClick }`. If the API differs (some projects use `{ label, icon: Icon, onClick }` where `icon` is a component reference), adjust accordingly. Match the existing call-site pattern from `src/pages/school/SchoolStudentsPage.tsx` exactly.

- [ ] **Step 4.2: Add the lazy import + route in `src/App.tsx`**

Find the existing line:

```tsx
const CommandCenterPage = lazy(() => import("./pages/school/CommandCenterPage"));
```

Add directly below it:

```tsx
const OnboardingDashboardPage = lazy(() => import("./pages/school/OnboardingDashboardPage"));
```

Find the existing route block:

```tsx
<Route path="/school/command-center" element={
  <ProtectedRoute allowedRoles={["school_admin", "super_school_admin", "super_admin"]}>
    <Suspense fallback={<p>Loading...</p>}>
      <CommandCenterPage />
    </Suspense>
  </ProtectedRoute>
} />
```

Add directly after it:

```tsx
<Route path="/school/onboarding-dashboard" element={
  <ProtectedRoute allowedRoles={["school_admin", "super_school_admin", "super_admin"]}>
    <Suspense fallback={<p>Loading...</p>}>
      <OnboardingDashboardPage />
    </Suspense>
  </ProtectedRoute>
} />
```

- [ ] **Step 4.3: Edit `ReportModal.tsx` to add the "Open Dashboard" sibling button**

Add `useNavigate` to the imports at the top of the file:

```tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
```

Inside the component, near the existing `useState` calls, add:

```tsx
const navigate = useNavigate();

const handleOpenDashboard = () => {
  onOpenChange(false);
  navigate("/school/onboarding-dashboard");
};
```

Find the existing Generate button block:

```tsx
{/* Generate button */}
<Button onClick={handleGenerate} disabled={generating} className="w-full">
  {generating ? (
    <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Generating…</>
  ) : (
    isOnboardingReport ? "Generate & Download Excel" : "Generate & Download PDF"
  )}
</Button>
```

Replace with:

```tsx
{/* Action row — onboarding gets a second sibling "Open Dashboard" button */}
{isOnboardingReport ? (
  <div className="flex flex-col sm:flex-row gap-3">
    <Button onClick={handleGenerate} disabled={generating} className="flex-1">
      {generating ? (
        <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Generating…</>
      ) : (
        "Generate & Download Excel"
      )}
    </Button>
    <Button
      variant="secondary"
      onClick={handleOpenDashboard}
      disabled={generating}
      className="flex-1"
    >
      Open Dashboard
    </Button>
  </div>
) : (
  <Button onClick={handleGenerate} disabled={generating} className="w-full">
    {generating ? (
      <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Generating…</>
    ) : (
      "Generate & Download PDF"
    )}
  </Button>
)}
```

- [ ] **Step 4.4: Run all three production-readiness checks**

Run: `npx tsc --noEmit`
Expected: exit 0.

Run: `npx eslint src/pages/school/OnboardingDashboardPage.tsx src/App.tsx src/components/command-center/ReportModal.tsx`
Expected: clean.

Run: `npx vite build`
Expected: exit 0 (bundle-size warnings OK).

- [ ] **Step 4.5: Browser smoke**

Run dev server (`npm run dev`), open the school-admin Command Center, click "Download Report", select "Onboarding Report" radio. Expected:
- Two buttons appear side by side: `[Generate & Download Excel]` and `[Open Dashboard]`.
- Other 3 radios still show their single PDF button.
- Click "Open Dashboard" → modal closes, route changes to `/school/onboarding-dashboard`, page renders with the "Loaded N teachers…" placeholder.
- Click "Generate & Download Excel" → still downloads the existing Excel as before.

- [ ] **Step 4.6: Commit**

```bash
git add src/pages/school/OnboardingDashboardPage.tsx src/App.tsx src/components/command-center/ReportModal.tsx
git commit -m "feat(onboarding): dashboard route + ReportModal Open Dashboard button

Onboarding radio now renders two buttons side by side (existing Excel +
new Open Dashboard). Other report types unchanged. Dashboard route
mirrors /school/command-center protection (school_admin, super_school_admin,
super_admin). Page is a stub that consumes useOnboardingDashboard; sections
plug in next."
```

---

## Task 5: Summary banner + delta bar sections

**Files:**
- Create: `src/components/onboarding-dashboard/SummaryBanner.tsx`
- Create: `src/components/onboarding-dashboard/DeltaBar.tsx`
- Modify: `src/pages/school/OnboardingDashboardPage.tsx` (plug in sections)

- [ ] **Step 5.1: Write `SummaryBanner.tsx`**

```tsx
import { StatTile, StatTileGrid } from "@/components/shared/surfaces";
import { Users, CheckCircle2, TrendingUp, Calendar } from "lucide-react";
import type { OnboardingDashboardData } from "@/hooks/useOnboardingDashboard";

interface Props {
  data: OnboardingDashboardData;
}

export function SummaryBanner({ data }: Props) {
  const total = data.live.length;
  const fullyComplete = data.live.filter((r) => r.isJourneyCompleted).length;
  const avgCompletion =
    total === 0
      ? 0
      : data.live.reduce((s, r) => s + Number(r.completionPercent ?? 0), 0) / total;
  const generated = new Date().toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <StatTileGrid mdCols={2} lgCols={4}>
      <StatTile
        label="Total teachers + coordinators"
        value={total.toString()}
        icon={<Users className="h-5 w-5" />}
        tone="teal"
      />
      <StatTile
        label="Fully complete"
        value={fullyComplete.toString()}
        icon={<CheckCircle2 className="h-5 w-5" />}
        tone="mint"
      />
      <StatTile
        label="Avg completion"
        value={`${Math.round(avgCompletion)}%`}
        icon={<TrendingUp className="h-5 w-5" />}
        tone="violet"
      />
      <StatTile
        label="Generated"
        value={generated}
        icon={<Calendar className="h-5 w-5" />}
        tone="peach"
      />
    </StatTileGrid>
  );
}
```

**Before saving**, open `src/components/shared/surfaces/StatTileGrid.tsx` and confirm it accepts `mdCols` + `lgCols` props (or whatever the prop is called in this project — match the existing call-site in `SchoolStudentsPage.tsx`). Adjust if the API differs.

- [ ] **Step 5.2: Write `DeltaBar.tsx`**

```tsx
import { ArrowUp, ArrowDown, Minus, Sunrise } from "lucide-react";
import type { OnboardingDashboardData } from "@/hooks/useOnboardingDashboard";
import { MILESTONE_KEYS, MILESTONE_LABELS } from "@/lib/onboardingDashboardMath";
import { cn } from "@/lib/utils";

interface Props {
  data: OnboardingDashboardData;
}

function DeltaChip({ label, value, suffix }: { label: string; value: number; suffix?: string }) {
  const positive = value > 0;
  const negative = value < 0;
  const Icon = positive ? ArrowUp : negative ? ArrowDown : Minus;
  return (
    <div className="flex items-center gap-2 rounded-lg bg-white/60 px-3 py-2 text-sm dark:bg-white/5">
      <Icon
        className={cn(
          "h-4 w-4",
          positive && "text-emerald-600",
          negative && "text-rose-600",
          !positive && !negative && "text-ink-400",
        )}
      />
      <span className="text-ink-600">{label}</span>
      <span
        className={cn(
          "ml-auto font-semibold tabular-nums",
          positive && "text-emerald-700",
          negative && "text-rose-700",
          !positive && !negative && "text-ink-700",
        )}
      >
        {positive ? "+" : ""}
        {value}
        {suffix ?? ""}
      </span>
    </div>
  );
}

export function DeltaBar({ data }: Props) {
  if (!data.deltas.hasBaseline) {
    return (
      <div className="surface-card frosted-shadow flex items-center gap-3 rounded-card p-4 text-sm">
        <Sunrise className="h-5 w-5 text-brand-primary" />
        <div>
          <p className="font-semibold text-ink-900">First report</p>
          <p className="text-ink-600">
            Day-over-day deltas appear once tomorrow's snapshot is taken.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="surface-card frosted-shadow rounded-card p-4">
      <p className="eyebrow mb-3">Since yesterday</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <DeltaChip label="Fully complete" value={data.deltas.fullyComplete} />
        <DeltaChip
          label="Avg completion"
          value={data.deltas.avgCompletion}
          suffix="pp"
        />
        {MILESTONE_KEYS.map((k) => (
          <DeltaChip key={k} label={MILESTONE_LABELS[k]} value={data.deltas.milestones[k]} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 5.3: Plug into the page**

Replace the placeholder paragraph in `OnboardingDashboardPage.tsx` with:

```tsx
import { SummaryBanner } from "@/components/onboarding-dashboard/SummaryBanner";
import { DeltaBar } from "@/components/onboarding-dashboard/DeltaBar";

// inside the !isLoading && !isError block:
<div className="space-y-6">
  <SummaryBanner data={data} />
  <DeltaBar data={data} />
</div>
```

- [ ] **Step 5.4: tsc + eslint + build + smoke**

```bash
npx tsc --noEmit
npx eslint src/components/onboarding-dashboard/SummaryBanner.tsx src/components/onboarding-dashboard/DeltaBar.tsx src/pages/school/OnboardingDashboardPage.tsx
npx vite build
```

All three exit 0. Open the dashboard route in the browser, confirm the 4 stat tiles render and the delta bar shows "First report" (since no snapshots exist yet on a fresh dev DB — once the RPC fires, "Since yesterday" only shows on day 2).

- [ ] **Step 5.5: Commit**

```bash
git add src/components/onboarding-dashboard/SummaryBanner.tsx src/components/onboarding-dashboard/DeltaBar.tsx src/pages/school/OnboardingDashboardPage.tsx
git commit -m "feat(onboarding): summary banner + delta bar sections"
```

---

## Task 6: Alert cards + KPI cards sections

**Files:**
- Create: `src/components/onboarding-dashboard/AlertCards.tsx`
- Create: `src/components/onboarding-dashboard/KpiCards.tsx`
- Modify: `src/pages/school/OnboardingDashboardPage.tsx`

- [ ] **Step 6.1: Write `AlertCards.tsx`**

```tsx
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle, Sparkles, ListChecks, TimerReset } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DashboardAlert, AlertKind, AlertSeverity } from "@/lib/onboardingDashboardMath";

interface Props {
  alerts: DashboardAlert[];
}

const ICON_BY_KIND: Record<AlertKind, typeof AlertTriangle> = {
  escalation: TimerReset,
  closeToDone: ListChecks,
  bottleneck: AlertTriangle,
  momentum: Sparkles,
};

const TONE_BY_SEVERITY: Record<AlertSeverity, string> = {
  info: "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900/40 dark:bg-sky-950/40 dark:text-sky-100",
  warning: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-100",
  critical: "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-100",
  success: "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-100",
};

export function AlertCards({ alerts }: Props) {
  if (alerts.length === 0) return null;
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {alerts.map((a, i) => {
        const Icon = ICON_BY_KIND[a.kind];
        return (
          <Alert key={`${a.kind}-${i}`} className={cn("rounded-card", TONE_BY_SEVERITY[a.severity])}>
            <Icon className="h-4 w-4" />
            <AlertTitle className="font-semibold">{a.title}</AlertTitle>
            <AlertDescription className="text-sm opacity-90">{a.body}</AlertDescription>
          </Alert>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 6.2: Write `KpiCards.tsx`**

Six metrics: fully complete, avg completion %, in-progress count, stuck-at-one-step-only (= at 20 %), study material uploaded count, result validated count. Each gets a delta badge if a baseline exists.

```tsx
import { StatTile, StatTileGrid } from "@/components/shared/surfaces";
import { CheckCircle2, Percent, Loader2, Pin, BookOpen, ClipboardCheck } from "lucide-react";
import type { OnboardingDashboardData } from "@/hooks/useOnboardingDashboard";

interface Props {
  data: OnboardingDashboardData;
}

function deltaSuffix(delta: number, suffix = ""): string | undefined {
  if (!Number.isFinite(delta) || delta === 0) return undefined;
  return `${delta > 0 ? "+" : ""}${delta}${suffix} vs yesterday`;
}

export function KpiCards({ data }: Props) {
  const { live, deltas } = data;
  const total = live.length;
  const fullyComplete = live.filter((r) => r.isJourneyCompleted).length;
  const avgCompletion = total === 0
    ? 0
    : live.reduce((s, r) => s + Number(r.completionPercent ?? 0), 0) / total;
  const inProgress = live.filter((r) => {
    const p = Number(r.completionPercent);
    return p > 0 && p < 100;
  }).length;
  const stuckOneStep = live.filter((r) => Number(r.completionPercent) === 20).length;
  const studyMaterial = live.filter((r) => r.firstStudyMaterialUploaded).length;
  const resultValidated = live.filter((r) => r.firstResultValidated).length;

  return (
    <StatTileGrid mdCols={2} lgCols={3}>
      <StatTile
        label="Fully complete"
        value={fullyComplete.toString()}
        icon={<CheckCircle2 className="h-5 w-5" />}
        tone="mint"
        sublabel={deltas.hasBaseline ? deltaSuffix(deltas.fullyComplete) : undefined}
      />
      <StatTile
        label="Average completion"
        value={`${Math.round(avgCompletion)}%`}
        icon={<Percent className="h-5 w-5" />}
        tone="violet"
        sublabel={deltas.hasBaseline ? deltaSuffix(deltas.avgCompletion, "pp") : undefined}
      />
      <StatTile
        label="In progress"
        value={inProgress.toString()}
        icon={<Loader2 className="h-5 w-5" />}
        tone="sky"
      />
      <StatTile
        label="Stuck at 1 step only"
        value={stuckOneStep.toString()}
        icon={<Pin className="h-5 w-5" />}
        tone="peach"
      />
      <StatTile
        label="Study material uploaded"
        value={studyMaterial.toString()}
        icon={<BookOpen className="h-5 w-5" />}
        tone="teal"
        sublabel={deltas.hasBaseline ? deltaSuffix(deltas.milestones.first_study_material_uploaded) : undefined}
      />
      <StatTile
        label="Result validated"
        value={resultValidated.toString()}
        icon={<ClipboardCheck className="h-5 w-5" />}
        tone="rose"
        sublabel={deltas.hasBaseline ? deltaSuffix(deltas.milestones.first_result_validated) : undefined}
      />
    </StatTileGrid>
  );
}
```

**Before saving:** open `src/components/shared/surfaces/StatTile.tsx` and confirm `sublabel` is an actual prop. If not, use whatever the project's prop is for the small caption under the value (could be `caption`, `delta`, or you may need to wrap children). Match an existing call-site that shows a delta.

- [ ] **Step 6.3: Plug into page**

```tsx
import { AlertCards } from "@/components/onboarding-dashboard/AlertCards";
import { KpiCards } from "@/components/onboarding-dashboard/KpiCards";

// inside the success block, in order:
<SummaryBanner data={data} />
<DeltaBar data={data} />
<AlertCards alerts={data.alerts} />
<KpiCards data={data} />
```

- [ ] **Step 6.4: tsc + eslint + build + smoke**

```bash
npx tsc --noEmit
npx eslint src/components/onboarding-dashboard/AlertCards.tsx src/components/onboarding-dashboard/KpiCards.tsx src/pages/school/OnboardingDashboardPage.tsx
npx vite build
```

Open the dashboard in the browser. Confirm alerts only render when their condition is true (you may see no alerts at all on a fresh dev DB — that's correct). Confirm 6 KPI tiles render with sensible numbers.

- [ ] **Step 6.5: Commit**

```bash
git add src/components/onboarding-dashboard/AlertCards.tsx src/components/onboarding-dashboard/KpiCards.tsx src/pages/school/OnboardingDashboardPage.tsx
git commit -m "feat(onboarding): conditional alert cards + KPI cards"
```

---

## Task 7: Progress trend chart

**Files:**
- Create: `src/components/onboarding-dashboard/ProgressTrendChart.tsx`
- Modify: `src/pages/school/OnboardingDashboardPage.tsx`

- [ ] **Step 7.1: Write `ProgressTrendChart.tsx`**

```tsx
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { format, parseISO } from "date-fns";
import { CalendarDays } from "lucide-react";
import type { OnboardingDashboardData } from "@/hooks/useOnboardingDashboard";

interface Props {
  data: OnboardingDashboardData;
}

export function ProgressTrendChart({ data }: Props) {
  if (data.trend.length === 0) {
    return null;
  }

  // Single-day = today's snapshot only. Show a summary card instead of a sparse chart.
  if (data.trend.length === 1) {
    const only = data.trend[0];
    return (
      <div className="surface-card frosted-shadow rounded-card p-5">
        <div className="flex items-center gap-3">
          <CalendarDays className="h-5 w-5 text-brand-primary" />
          <div>
            <p className="eyebrow">Trend</p>
            <p className="text-sm text-ink-700">
              Today's snapshot is your first data point. A trend chart appears here once you have
              two or more days of history.
            </p>
            <p className="mt-2 text-sm text-ink-600">
              Today: <span className="font-semibold text-ink-900">{only.fully_complete_count}</span>{" "}
              fully complete, avg{" "}
              <span className="font-semibold text-ink-900">
                {Math.round(Number(only.avg_completion_percent))}%
              </span>
              .
            </p>
          </div>
        </div>
      </div>
    );
  }

  const chartData = data.trend.map((s) => ({
    date: s.snapshot_date,
    fullyComplete: s.fully_complete_count,
    avgCompletion: Number(s.avg_completion_percent),
  }));

  return (
    <div className="surface-card frosted-shadow rounded-card p-5">
      <p className="eyebrow mb-3">Progress over time</p>
      <div style={{ width: "100%", height: 280 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11 }}
              tickFormatter={(v) => format(parseISO(v as string), "d MMM")}
            />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip
              labelFormatter={(v) => format(parseISO(v as string), "PPP")}
              formatter={(value: number, name) =>
                name === "Avg completion %"
                  ? [`${Math.round(value)}%`, name]
                  : [value, name]
              }
            />
            <Legend />
            <Line
              type="monotone"
              dataKey="fullyComplete"
              name="Fully complete"
              stroke="hsl(var(--brand-primary))"
              strokeWidth={2}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="avgCompletion"
              name="Avg completion %"
              stroke="hsl(var(--brand-secondary))"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
```

The explicit `<div style={{ width: "100%", height: 280 }}>` wrapper is the CLAUDE.md §20a Phase 8 Recharts fix — `h-72` Tailwind classes collapse inside flex/grid parents on mobile and the chart silently disappears.

- [ ] **Step 7.2: Plug into page**

```tsx
import { ProgressTrendChart } from "@/components/onboarding-dashboard/ProgressTrendChart";

// after KpiCards:
<ProgressTrendChart data={data} />
```

- [ ] **Step 7.3: tsc + eslint + build + smoke**

```bash
npx tsc --noEmit
npx eslint src/components/onboarding-dashboard/ProgressTrendChart.tsx src/pages/school/OnboardingDashboardPage.tsx
npx vite build
```

Smoke: on fresh DB you'll see the "first data point" card. To see the actual chart, you can manually insert a second snapshot row in Studio for `current_date - 1`.

- [ ] **Step 7.4: Commit**

```bash
git add src/components/onboarding-dashboard/ProgressTrendChart.tsx src/pages/school/OnboardingDashboardPage.tsx
git commit -m "feat(onboarding): progress trend chart with single-day fallback"
```

---

## Task 8: Distribution panel + milestone funnel

**Files:**
- Create: `src/components/onboarding-dashboard/DistributionAndFunnel.tsx`
- Modify: `src/pages/school/OnboardingDashboardPage.tsx`

- [ ] **Step 8.1: Write `DistributionAndFunnel.tsx`**

```tsx
import type { OnboardingDashboardData } from "@/hooks/useOnboardingDashboard";
import { MILESTONE_KEYS, MILESTONE_LABELS, TIER_BUCKETS, type Tier } from "@/lib/onboardingDashboardMath";
import { cn } from "@/lib/utils";

interface Props {
  data: OnboardingDashboardData;
}

const TIER_COLOR: Record<Tier, string> = {
  "100": "bg-emerald-500",
  "80":  "bg-teal-500",
  "60":  "bg-sky-500",
  "40":  "bg-amber-500",
  "20":  "bg-orange-500",
  "0":   "bg-rose-500",
};

function DistributionPanel({ data }: Props) {
  const total = data.live.length;
  return (
    <div className="surface-card frosted-shadow rounded-card p-5">
      <p className="eyebrow mb-3">Where everyone stands</p>
      <div className="space-y-3">
        {TIER_BUCKETS.map((tier) => {
          const count = data.distribution[tier];
          const pct = total === 0 ? 0 : Math.round((count / total) * 100);
          return (
            <div key={tier}>
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="text-ink-700">{tier}% tier</span>
                <span className="tabular-nums text-ink-900">
                  {count} <span className="text-ink-500">({pct}%)</span>
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-ink-100 dark:bg-white/10">
                <div
                  className={cn("h-full rounded-full transition-all", TIER_COLOR[tier])}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MilestoneFunnel({ data }: Props) {
  const total = data.live.length;
  return (
    <div className="surface-card frosted-shadow rounded-card p-5">
      <p className="eyebrow mb-3">Milestone funnel</p>
      <div className="space-y-3">
        {MILESTONE_KEYS.map((key) => {
          const count = data.live.filter((r) => {
            switch (key) {
              case "first_task_assigned": return r.firstTaskAssigned;
              case "first_task_completed": return r.firstTaskCompleted;
              case "first_study_material_uploaded": return r.firstStudyMaterialUploaded;
              case "first_exam_published": return r.firstExamPublished;
              case "first_result_validated": return r.firstResultValidated;
            }
          }).length;
          const pct = total === 0 ? 0 : Math.round((count / total) * 100);
          const delta = data.deltas.milestones[key];
          return (
            <div key={key}>
              <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                <span className="text-ink-700">{MILESTONE_LABELS[key]}</span>
                <span className="flex items-center gap-2 tabular-nums">
                  <span className="text-ink-900">{count}</span>
                  <span className="text-ink-500">({pct}%)</span>
                  {data.deltas.hasBaseline && delta !== 0 && (
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[11px] font-semibold",
                        delta > 0
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                          : "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
                      )}
                    >
                      {delta > 0 ? "+" : ""}
                      {delta}
                    </span>
                  )}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-ink-100 dark:bg-white/10">
                <div
                  className="h-full rounded-full bg-brand-primary transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function DistributionAndFunnel({ data }: Props) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <DistributionPanel data={data} />
      <MilestoneFunnel data={data} />
    </div>
  );
}
```

- [ ] **Step 8.2: Plug into page after the trend chart**

```tsx
import { DistributionAndFunnel } from "@/components/onboarding-dashboard/DistributionAndFunnel";

// after ProgressTrendChart:
<DistributionAndFunnel data={data} />
```

- [ ] **Step 8.3: tsc + eslint + build + smoke**

```bash
npx tsc --noEmit
npx eslint src/components/onboarding-dashboard/DistributionAndFunnel.tsx src/pages/school/OnboardingDashboardPage.tsx
npx vite build
```

Smoke: confirm both panels render side by side on `lg+` and stack on mobile. Check that tier counts add up to the total. Toggle dark mode — bars and tinted delta chips should remain readable.

- [ ] **Step 8.4: Commit**

```bash
git add src/components/onboarding-dashboard/DistributionAndFunnel.tsx src/pages/school/OnboardingDashboardPage.tsx
git commit -m "feat(onboarding): tier distribution + milestone funnel panels"
```

---

## Task 9: Completed teachers list + per-teacher table

**Files:**
- Create: `src/components/onboarding-dashboard/CompletedTeachersList.tsx`
- Create: `src/components/onboarding-dashboard/PerTeacherTable.tsx`
- Modify: `src/pages/school/OnboardingDashboardPage.tsx`

- [ ] **Step 9.1: Write `CompletedTeachersList.tsx`**

```tsx
import { ListRow, EmptyState } from "@/components/shared/surfaces";
import { Award, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import type { OnboardingDashboardData } from "@/hooks/useOnboardingDashboard";

interface Props {
  data: OnboardingDashboardData;
}

function initials(name: string | null | undefined): string {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

export function CompletedTeachersList({ data }: Props) {
  const completed = data.live
    .filter((r) => r.isJourneyCompleted)
    .sort((a, b) => (a.fullName ?? "").localeCompare(b.fullName ?? ""));

  return (
    <div className="surface-card frosted-shadow rounded-card p-5">
      <div className="mb-3 flex items-center gap-2">
        <Award className="h-5 w-5 text-brand-primary" />
        <p className="eyebrow">Fully onboarded ({completed.length})</p>
      </div>

      {completed.length === 0 ? (
        <EmptyState
          icon={Award}
          title="No one's reached 100% yet"
          description="They will appear here once they cross every milestone."
        />
      ) : (
        <div className="space-y-1">
          {completed.map((r) => (
            <ListRow
              key={r.userId}
              leading={
                <Avatar>
                  <AvatarFallback>{initials(r.fullName)}</AvatarFallback>
                </Avatar>
              }
              title={r.fullName ?? "—"}
              subtitle={r.email ?? r.role ?? ""}
              trailing={
                data.newlyCompleted.has(r.userId) ? (
                  <Badge className="gap-1 bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/40 dark:text-emerald-200">
                    <Sparkles className="h-3 w-3" /> New today
                  </Badge>
                ) : null
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
```

**Before saving:** open `src/components/shared/surfaces/ListRow.tsx` and confirm the prop names — likely `leading`, `title`, `subtitle`, `trailing` based on `SchoolStudentsPage`. If different, match the existing API. Likewise, confirm `EmptyState` props (`icon`, `title`, `description`).

- [ ] **Step 9.2: Write `PerTeacherTable.tsx`**

```tsx
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Check, X, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { MILESTONE_KEYS, MILESTONE_LABELS, type MilestoneKey } from "@/lib/onboardingDashboardMath";
import type { InstitutionOnboardingRow } from "@/hooks/useOnboardingJourney";

interface Props {
  rows: InstitutionOnboardingRow[];
}

const TIER_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "All tiers" },
  { value: "100", label: "100%" },
  { value: "80",  label: "80%" },
  { value: "60",  label: "60%" },
  { value: "40",  label: "40%" },
  { value: "20",  label: "20%" },
  { value: "0",   label: "0%" },
];

function YesNo({ ok }: { ok: boolean }) {
  return ok ? (
    <Check className="h-4 w-4 text-emerald-600" aria-label="Yes" />
  ) : (
    <X className="h-4 w-4 text-rose-500" aria-label="No" />
  );
}

function milestoneOf(row: InstitutionOnboardingRow, key: MilestoneKey): boolean {
  switch (key) {
    case "first_task_assigned": return row.firstTaskAssigned;
    case "first_task_completed": return row.firstTaskCompleted;
    case "first_study_material_uploaded": return row.firstStudyMaterialUploaded;
    case "first_exam_published": return row.firstExamPublished;
    case "first_result_validated": return row.firstResultValidated;
  }
}

export function PerTeacherTable({ rows }: Props) {
  const [search, setSearch] = useState("");
  const [tier, setTier] = useState<string>("all");
  const [missing, setMissing] = useState<string>("all");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (q) {
        const hay = `${r.fullName ?? ""} ${r.email ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (tier !== "all") {
        const tierFloor = Number(tier);
        const pct = Number(r.completionPercent);
        if (pct < tierFloor || pct >= tierFloor + 20) return false;
        // Special case 100 tier — match exactly.
        if (tierFloor === 100 && pct !== 100) return false;
      }
      if (missing !== "all") {
        if (milestoneOf(r, missing as MilestoneKey)) return false;
      }
      return true;
    });
  }, [rows, search, tier, missing]);

  return (
    <div className="surface-card frosted-shadow rounded-card p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="eyebrow">Per-teacher detail</p>
        <p className="text-sm text-ink-500 tabular-nums">{filtered.length} shown</p>
      </div>

      <div className="mb-4 grid gap-2 sm:grid-cols-3 print:hidden">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email"
            className="pl-9"
          />
        </div>
        <Select value={tier} onValueChange={setTier}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {TIER_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={missing} onValueChange={setMissing}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any milestone status</SelectItem>
            {MILESTONE_KEYS.map((k) => (
              <SelectItem key={k} value={k}>Missing: {MILESTONE_LABELS[k]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-x-auto print:overflow-visible">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="hidden sm:table-cell">Email</TableHead>
              {MILESTONE_KEYS.map((k) => (
                <TableHead key={k} className="text-center">{k.replace("first_", "").replace(/_/g, " ")}</TableHead>
              ))}
              <TableHead className="text-right">Progress</TableHead>
              <TableHead className="text-right">%</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((r) => (
              <TableRow key={r.userId}>
                <TableCell className="font-medium">{r.fullName ?? "—"}</TableCell>
                <TableCell className="hidden sm:table-cell text-ink-600">{r.email ?? "—"}</TableCell>
                {MILESTONE_KEYS.map((k) => (
                  <TableCell key={k} className="text-center">
                    <span className="inline-flex"><YesNo ok={milestoneOf(r, k)} /></span>
                  </TableCell>
                ))}
                <TableCell className="text-right">
                  <div className="ml-auto h-2 w-24 overflow-hidden rounded-full bg-ink-100 dark:bg-white/10">
                    <div
                      className={cn("h-full rounded-full bg-brand-primary")}
                      style={{ width: `${Number(r.completionPercent)}%` }}
                    />
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">{Math.round(Number(r.completionPercent))}%</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {filtered.length === 0 && (
        <p className="mt-4 text-center text-sm text-ink-500">No matches.</p>
      )}
    </div>
  );
}
```

- [ ] **Step 9.3: Plug both into the page**

```tsx
import { CompletedTeachersList } from "@/components/onboarding-dashboard/CompletedTeachersList";
import { PerTeacherTable } from "@/components/onboarding-dashboard/PerTeacherTable";

// after DistributionAndFunnel:
<CompletedTeachersList data={data} />
<PerTeacherTable rows={data.live} />
```

- [ ] **Step 9.4: tsc + eslint + build + smoke**

```bash
npx tsc --noEmit
npx eslint src/components/onboarding-dashboard/CompletedTeachersList.tsx src/components/onboarding-dashboard/PerTeacherTable.tsx src/pages/school/OnboardingDashboardPage.tsx
npx vite build
```

Smoke: search a teacher name → list narrows; pick a tier → only those rows show; pick a "Missing: …" filter → only teachers without that milestone. At 375 px the email column is hidden, the table still scrolls horizontally cleanly.

- [ ] **Step 9.5: Commit**

```bash
git add src/components/onboarding-dashboard/CompletedTeachersList.tsx src/components/onboarding-dashboard/PerTeacherTable.tsx src/pages/school/OnboardingDashboardPage.tsx
git commit -m "feat(onboarding): completed list + filterable per-teacher table"
```

---

## Task 10: Pending tasks grid + print mode + final verification

**Files:**
- Create: `src/components/onboarding-dashboard/PendingTasksGrid.tsx`
- Modify: `src/pages/school/OnboardingDashboardPage.tsx`

- [ ] **Step 10.1: Write `PendingTasksGrid.tsx`**

```tsx
import { Check, X, AlertTriangle, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  MILESTONE_KEYS,
  MILESTONE_LABELS,
  STUCK_TRIGGER_DAYS,
  STUCK_SEVERE_DAYS,
  type MilestoneKey,
} from "@/lib/onboardingDashboardMath";
import type { InstitutionOnboardingRow } from "@/hooks/useOnboardingJourney";

interface Props {
  rows: InstitutionOnboardingRow[];
  zeroDayMap: Map<string, number>;
}

function milestoneOf(row: InstitutionOnboardingRow, key: MilestoneKey): boolean {
  switch (key) {
    case "first_task_assigned": return row.firstTaskAssigned;
    case "first_task_completed": return row.firstTaskCompleted;
    case "first_study_material_uploaded": return row.firstStudyMaterialUploaded;
    case "first_exam_published": return row.firstExamPublished;
    case "first_result_validated": return row.firstResultValidated;
  }
}

export function PendingTasksGrid({ rows, zeroDayMap }: Props) {
  const pending = rows
    .filter((r) => !r.isJourneyCompleted)
    .sort((a, b) => Number(b.completionPercent) - Number(a.completionPercent));

  if (pending.length === 0) {
    return (
      <div className="surface-card frosted-shadow rounded-card p-6 text-center text-sm text-ink-600">
        Everyone has finished onboarding. Nothing pending.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="eyebrow">Still onboarding ({pending.length})</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {pending.map((r) => {
          const pct = Number(r.completionPercent);
          const closeToDone = pct === 80;
          const stuckDays = zeroDayMap.get(r.userId) ?? 0;
          const stuck = stuckDays >= STUCK_TRIGGER_DAYS;
          const severe = stuckDays >= STUCK_SEVERE_DAYS;
          return (
            <div
              key={r.userId}
              className={cn(
                "surface-card frosted-shadow rounded-card p-4",
                severe && "ring-1 ring-rose-400/60",
              )}
            >
              <div className="mb-2 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-ink-900">{r.fullName ?? "—"}</p>
                  <p className="truncate text-xs text-ink-500">{r.email ?? r.role ?? ""}</p>
                </div>
                <span className="shrink-0 text-sm font-semibold tabular-nums text-ink-700">
                  {Math.round(pct)}%
                </span>
              </div>

              <ul className="space-y-1 text-sm">
                {MILESTONE_KEYS.map((k) => {
                  const ok = milestoneOf(r, k);
                  return (
                    <li key={k} className="flex items-center gap-2">
                      {ok ? (
                        <Check className="h-3.5 w-3.5 text-emerald-600" />
                      ) : (
                        <X className="h-3.5 w-3.5 text-ink-400" />
                      )}
                      <span className={cn("truncate", ok ? "text-ink-600 line-through" : "text-ink-800")}>
                        {MILESTONE_LABELS[k]}
                      </span>
                    </li>
                  );
                })}
              </ul>

              <div className="mt-3 flex flex-wrap gap-2">
                {closeToDone && (
                  <Badge className="gap-1 bg-amber-100 text-amber-800 hover:bg-amber-100 dark:bg-amber-900/40 dark:text-amber-200">
                    <Clock className="h-3 w-3" /> Could finish today
                  </Badge>
                )}
                {stuck && (
                  <Badge
                    className={cn(
                      "gap-1",
                      severe
                        ? "bg-rose-100 text-rose-800 hover:bg-rose-100 dark:bg-rose-900/40 dark:text-rose-200"
                        : "bg-orange-100 text-orange-800 hover:bg-orange-100 dark:bg-orange-900/40 dark:text-orange-200",
                    )}
                  >
                    <AlertTriangle className="h-3 w-3" /> Stuck for {stuckDays} day{stuckDays === 1 ? "" : "s"}
                  </Badge>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 10.2: Plug into page (last section) AND add print mode wrapper**

In `OnboardingDashboardPage.tsx`, replace the final render block with:

```tsx
{!data.isLoading && !data.isError && (
  <div className="space-y-6 print:space-y-4">
    <SummaryBanner data={data} />
    <DeltaBar data={data} />
    <AlertCards alerts={data.alerts} />
    <KpiCards data={data} />
    <ProgressTrendChart data={data} />
    <DistributionAndFunnel data={data} />
    <CompletedTeachersList data={data} />
    <PerTeacherTable rows={data.live} />
    <PendingTasksGrid rows={data.live} zeroDayMap={data.zeroDayMap} />
  </div>
)}
```

Also wrap the outer `<PageShell>` with a print stylesheet block. Simplest implementation — add this at the top of the page module (above the default export), so it injects once when the component mounts:

```tsx
const PRINT_CSS = `
@media print {
  html, body { background: white !important; }
  aside, nav, header[data-app-header] { display: none !important; }
  .surface-gradient { background: white !important; }
  .surface-card { box-shadow: none !important; border: 1px solid rgba(0,0,0,0.1) !important; }
  .print\\:hidden { display: none !important; }
}
`;
```

Add a `<style>` element inside the page:

```tsx
return (
  <PageShell>
    <style>{PRINT_CSS}</style>
    <PageHeader ... />
    ...
  </PageShell>
);
```

The `PageHeader` action button needs `print:hidden` too — verify the project's PageHeader already hides actions in print (most likely it does via a global rule). If not, add `print:hidden` to actions explicitly when modifying the existing PageHeader is out of scope here.

- [ ] **Step 10.3: Final production-readiness checks (FULL pass)**

```bash
npx tsc --noEmit
npx eslint src/components/onboarding-dashboard/ src/hooks/useOnboardingDashboard.ts src/lib/onboardingDashboardMath.ts src/pages/school/OnboardingDashboardPage.tsx src/App.tsx src/components/command-center/ReportModal.tsx
npx vite build
```

All three exit 0.

- [ ] **Step 10.4: Browser smoke (full)**

1. Dev server up. Log in as a school admin.
2. Go to Command Center → click "Download Report" → select "Onboarding Report" → confirm two buttons appear.
3. Click "Generate & Download Excel" → confirm the existing Excel still downloads (no regression).
4. Re-open modal → "Onboarding Report" → "Open Dashboard" → confirm navigation closes modal and lands on the dashboard.
5. Verify all 9 sections render with sensible numbers.
6. Resize to 375 px width — confirm: no horizontal scroll, header doesn't wrap awkwardly, all sections stack and remain readable, per-teacher table scrolls horizontally inside its card.
7. Toggle dark mode (via the theme toggle if available, else `<html class="dark">` in DevTools) — confirm surfaces, text scale, shadows, badges all flip cleanly. No leftover greys.
8. Click "Print" — confirm the print preview hides sidebar/header/filters/kebab and renders the whole dashboard on white.
9. Open Command Center as a teacher account — confirm the route `/school/onboarding-dashboard` returns the protected-route redirect (not the dashboard).
10. Quick smoke on the existing Excel report flow as super_school_admin and super_admin — same behaviour.

- [ ] **Step 10.5: Commit**

```bash
git add src/components/onboarding-dashboard/PendingTasksGrid.tsx src/pages/school/OnboardingDashboardPage.tsx
git commit -m "feat(onboarding): pending tasks grid + print mode + page wiring complete"
```

- [ ] **Step 10.6: Final summary update**

State explicitly to the user:
- "All 10 tasks complete. Migration is in place but NOT applied — run `npx supabase db push` after reviewing `supabase/migrations/20260516120000_onboarding_snapshots.sql`."
- "Until the migration runs, the dashboard page will throw on the snapshot reads. The live data (banner + KPIs + per-teacher table + pending grid) will still render because they use the existing RPC. The trend / delta / completed-list 'new today' / pending stuck-pills will degrade gracefully to empty/zero baseline."

---

## Self-review notes (filled in during plan-writing)

**Spec coverage:** Every spec section maps to a task —
- Database table & RPC → Task 1
- Math (deltas/alerts/zero-day) → Task 2
- Data hook → Task 3
- Entry button + route → Task 4
- Summary banner → Task 5
- Delta bar → Task 5
- Alert cards → Task 6
- KPI cards → Task 6
- Progress trend → Task 7
- Distribution + Funnel → Task 8
- Completed teachers → Task 9
- Per-teacher table → Task 9
- Pending tasks grid → Task 10
- Print support → Task 10
- Production-readiness checks → embedded at the end of every task

**Placeholders:** none. Every step has the actual code; the only `TBD-ish` element is "verify the `PageHeader` / `StatTile` / `ListRow` prop API before saving" — that's a deliberate guard, not a placeholder, because those primitives' exact prop names live in code the executor will be looking at anyway.

**Type consistency:** `SnapshotRow`, `Deltas`, `DashboardAlert`, `Tier`, `MilestoneKey`, `OnboardingDashboardData` are all defined exactly once (in `onboardingDashboardMath.ts` or `useOnboardingDashboard.ts`) and re-imported wherever they're consumed. `InstitutionOnboardingRow` is imported from the existing `useOnboardingJourney.ts`. No drift.

**Scope:** all 10 tasks ship together to deliver one user-visible feature. No task is independently shippable except Task 1 (DB migration sits unused until Task 3 lands), which is fine.

---

## Out of scope (explicitly)

- A snapshot cleanup / retention cron — not needed at small institution scale.
- Realtime / websocket subscriptions — React Query refetch is sufficient.
- A cross-institution super-admin overview — single institution, same as Excel.
- Tests — the project has no test runner. Verification is tsc + eslint + build + manual smoke.
- Changes to `get_institution_onboarding_progress`, `useInstitutionOnboardingProgress`, the existing Excel generator, or the other 3 report types.
