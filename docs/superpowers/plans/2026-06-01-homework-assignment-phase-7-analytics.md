# Homework & Assignment — Phase 7 (Analytics Rollup) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Surface assignment marks in the existing analytics dashboards as a **separate** "Homework & Assignment" metric block — average marks %, submission rate, on-time rate, totals — scoped per the existing rules (teacher = own classes, coordinator = wing, school/super-school admin = institution-wide; super-admin via the school-view picker). Server-aggregated per §23.1. **Never touches exam metrics, SLHI (which doesn't exist), or report cards.**

**Architecture:** One SECURITY DEFINER RPC `homework_analytics_rollup(_institution_id)` resolves the caller's accessible class set from their role (admin → all institution classes; coordinator → wing via `wing_assignments`/`wing_class_mappings`; teacher → `class_assignments`), aggregates over carries-marks, published/checked assignments linked to those classes, and returns a jsonb rollup (avg %, submission/on-time rates, counts). A `useHomeworkAnalytics(institutionId)` hook calls it; a reusable `<HomeworkAnalyticsSection institutionId?>` renders the StatTiles and is dropped into `TeacherAnalyticsDashboard` (teacher+coordinator) and `SchoolAnalyticsDashboard` (admins + super-admin school-view). No exam code touched.

**Tech Stack:** Supabase plpgsql RPC, React 18 + TS, TanStack Query, §20a `StatTile`/`StatTileGrid`. Verify: `tsc`/`eslint`/`vite build`; RPC via `db push`.

**Branch:** `homework/phase-7-analytics` (off `homework/phase-6-notify @ 1383922`, verified). **Spec:** §Analytics / §10.

---

## File structure
**Create:** `supabase/migrations/20260601096000_homework_analytics_rpc.sql`; `src/hooks/useHomeworkAnalytics.ts`; `src/components/analytics/HomeworkAnalyticsSection.tsx`.
**Modify:** `src/integrations/supabase/types.ts` (regen); `src/components/analytics/TeacherAnalyticsDashboard.tsx`; `src/components/analytics/SchoolAnalyticsDashboard.tsx`.

---

## Task 1: `homework_analytics_rollup` RPC (migration)

**Files:** Create `supabase/migrations/20260601096000_homework_analytics_rpc.sql`

- [ ] **Step 1: Write the migration**

```sql
-- =====================================================================
-- Homework & Assignment — Phase 7: role-scoped marks analytics rollup.
-- SECURITY DEFINER; scope derived from caller role within _institution_id:
--   admin/super_admin -> all institution classes
--   coordinator       -> wing classes (wing_assignments/wing_class_mappings)
--   teacher           -> own class_assignments classes
-- Aggregates carries-marks, published/checked assignments. Separate from
-- exam metrics; never writes report cards.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.homework_analytics_rollup(_institution_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_is_admin  boolean;
  v_is_coord  boolean;
  v_is_teacher boolean;
  v_result    jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'forbidden' USING errcode = '42501'; END IF;
  IF _institution_id IS NULL THEN RAISE EXCEPTION 'Institution is required.'; END IF;

  v_is_admin   := public.is_super_admin(v_uid) OR public.is_institution_admin(v_uid, _institution_id);
  v_is_coord   := (NOT v_is_admin)
                  AND public.has_role(v_uid, 'coordinator'::app_role)
                  AND public.get_user_institution(v_uid) = _institution_id;
  v_is_teacher := (NOT v_is_admin) AND (NOT v_is_coord)
                  AND public.has_role(v_uid, 'teacher'::app_role)
                  AND public.get_user_institution(v_uid) = _institution_id;

  IF NOT (v_is_admin OR v_is_coord OR v_is_teacher) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  WITH scoped_classes AS (
    SELECT c.id AS class_id
    FROM public.classes c
    WHERE c.institution_id = _institution_id
      AND (
        v_is_admin
        OR (v_is_coord AND public.is_coordinator_for_class(v_uid, c.id))
        OR (v_is_teacher AND EXISTS (
              SELECT 1 FROM public.class_assignments ca
              WHERE ca.user_id = v_uid AND ca.class_id = c.id AND ca.role = 'teacher'))
      )
  ),
  scoped_assignments AS (
    SELECT DISTINCT h.id, h.max_marks
    FROM public.homework_assignments h
    JOIN public.homework_assignment_classes hac ON hac.homework_assignment_id = h.id
    JOIN scoped_classes sc ON sc.class_id = hac.class_id
    WHERE h.institution_id = _institution_id
      AND h.carries_marks = true
      AND h.status IN ('published','checked')
  ),
  graded AS (
    SELECT r.marks_awarded, sa.max_marks
    FROM public.homework_results r
    JOIN scoped_assignments sa ON sa.id = r.homework_assignment_id
    WHERE r.status = 'graded' AND r.marks_awarded IS NOT NULL AND sa.max_marks > 0
  ),
  subs AS (
    SELECT s.is_late
    FROM public.homework_submissions s
    JOIN scoped_assignments sa ON sa.id = s.homework_assignment_id
  ),
  expected AS (
    SELECT count(*)::numeric AS slots
    FROM scoped_assignments sa
    JOIN public.homework_assignment_classes hac ON hac.homework_assignment_id = sa.id
    JOIN public.class_assignments ca ON ca.class_id = hac.class_id AND ca.role = 'student'
  )
  SELECT jsonb_build_object(
    'total_assignments', (SELECT count(*) FROM scoped_assignments),
    'graded_count',      (SELECT count(*) FROM graded),
    'avg_percentage',    (SELECT round(avg(marks_awarded / max_marks * 100), 1) FROM graded),
    'submission_count',  (SELECT count(*) FROM subs),
    'expected_count',    (SELECT slots FROM expected),
    'submission_rate',   (SELECT CASE WHEN (SELECT slots FROM expected) > 0
                            THEN round(((SELECT count(*) FROM subs)::numeric / (SELECT slots FROM expected)) * 100, 1)
                            ELSE NULL END),
    'on_time_rate',      (SELECT CASE WHEN count(*) > 0
                            THEN round((count(*) FILTER (WHERE is_late = false))::numeric / count(*) * 100, 1)
                            ELSE NULL END FROM subs),
    'computed_at',       now()
  ) INTO v_result;

  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.homework_analytics_rollup(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.homework_analytics_rollup(uuid) TO authenticated;
```

- [ ] **Step 2: Confirm timestamp sorts last** (`20260601096000` > `…095000`).
- [ ] **Step 3: Dry-run + apply to prod**
```bash
npx supabase db push --linked --dry-run   # "Would push" = ONLY 20260601096000_homework_analytics_rpc.sql
npx supabase db push --linked --yes
```
- [ ] **Step 4: Regen types + verify**
```bash
npx supabase gen types typescript --project-id gyymkgohcijeksmrzuyw > src/integrations/supabase/types.ts
grep -c "homework_analytics_rollup" src/integrations/supabase/types.ts   # >= 1
npx tsc --noEmit   # 0
```
- [ ] **Step 5: Commit**
```bash
git add supabase/migrations/20260601096000_homework_analytics_rpc.sql src/integrations/supabase/types.ts
git commit -F - <<'EOF'
feat(homework): role-scoped analytics rollup RPC (applied to prod) + regen types

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 2: `useHomeworkAnalytics` hook

**Files:** Create `src/hooks/useHomeworkAnalytics.ts`

```ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface HomeworkAnalytics {
  total_assignments: number;
  graded_count: number;
  avg_percentage: number | null;
  submission_count: number;
  expected_count: number;
  submission_rate: number | null;
  on_time_rate: number | null;
  computed_at: string;
}

export function useHomeworkAnalytics(institutionId: string | null) {
  return useQuery({
    queryKey: ["homework-analytics", institutionId],
    enabled: !!institutionId,
    staleTime: 60_000,
    queryFn: async (): Promise<HomeworkAnalytics | null> => {
      const { data, error } = await supabase.rpc("homework_analytics_rollup", { _institution_id: institutionId! });
      if (error) throw error;
      return (data as unknown as HomeworkAnalytics | null) ?? null;
    },
  });
}
```

- [ ] Verify (`tsc`/`eslint`) + commit → `feat(homework): useHomeworkAnalytics hook`.

---

## Task 3: `HomeworkAnalyticsSection` component

**Files:** Create `src/components/analytics/HomeworkAnalyticsSection.tsx`

- [ ] **Step 1: Build it**

A self-contained titled section. If `institutionId` prop is omitted, it falls back to `useEffectiveInstitution().institutionId` (so the teacher/coordinator dashboard — which has no institutionId — works).

```tsx
import { useEffectiveInstitution } from "@/hooks/useEffectiveInstitution";
import { useHomeworkAnalytics } from "@/hooks/useHomeworkAnalytics";
import { StatTile, StatTileGrid, EmptyState } from "@/components/shared/surfaces";
import { Skeleton } from "@/components/ui/skeleton";
import { ClipboardList, Percent, Send, Clock } from "lucide-react";

export function HomeworkAnalyticsSection({ institutionId }: { institutionId?: string | null }) {
  const eff = useEffectiveInstitution();
  const inst = institutionId !== undefined ? institutionId : eff.institutionId;
  const { data, isLoading } = useHomeworkAnalytics(inst ?? null);

  const pct = (v: number | null | undefined) => (v == null ? "—" : `${v}%`);

  return (
    <section className="space-y-3">
      <div>
        <p className="eyebrow">Homework & Assignment</p>
        <h2 className="text-lg font-semibold text-ink-900">Assignment marks</h2>
      </div>
      {isLoading ? (
        <StatTileGrid cols={2} mdCols={4}>
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-card" />)}
        </StatTileGrid>
      ) : !data || data.total_assignments === 0 ? (
        <EmptyState icon={<ClipboardList className="h-7 w-7" />} title="No homework marks yet"
          description="Published, graded homework will show here." tone="teal" />
      ) : (
        <StatTileGrid cols={2} mdCols={4}>
          <StatTile label="Avg marks" value={pct(data.avg_percentage)} icon={<Percent className="h-5 w-5" />} tone="teal" />
          <StatTile label="Submission rate" value={pct(data.submission_rate)} icon={<Send className="h-5 w-5" />} tone="sky" />
          <StatTile label="On-time rate" value={pct(data.on_time_rate)} icon={<Clock className="h-5 w-5" />} tone="mint" />
          <StatTile label="Assignments" value={data.total_assignments} icon={<ClipboardList className="h-5 w-5" />} tone="violet" />
        </StatTileGrid>
      )}
    </section>
  );
}
```

> **Implementer:** confirm `StatTile`/`StatTileGrid`/`EmptyState` prop shapes (Phase-2 recon: `StatTileGrid` has `cols`/`mdCols`; `StatTile` has `label`/`value`/`icon`/`tone`). Confirm the `.eyebrow` class + `text-ink-900` tokens exist (they do — §20a). No `any`.

- [ ] **Step 2: Verify + commit** (`tsc`/`eslint`/`vite build`) → `feat(homework): HomeworkAnalyticsSection (assignment-marks rollup tiles)`.

---

## Task 4: Inject into the analytics dashboards

**Files:** Modify `src/components/analytics/TeacherAnalyticsDashboard.tsx`, `src/components/analytics/SchoolAnalyticsDashboard.tsx`

- [ ] **Step 1: TeacherAnalyticsDashboard** (teacher + coordinator) — import `HomeworkAnalyticsSection` and render it within the dashboard's top-level `<div className="space-y-6">`, after the exam stats grid (no `institutionId` prop → it uses the effective institution, scoped by role server-side). Place it so it reads as a distinct block (it has its own heading). Do NOT modify any exam analytics.

- [ ] **Step 2: SchoolAnalyticsDashboard** (school/super-school admin + super-admin school-view) — the component receives `institutionId`. Render `<HomeworkAnalyticsSection institutionId={institutionId} />` in the overview tab/section, after the existing overview stats, before/after the exam-health block. (It returns null when `institutionId` is null, same as the dashboard's own guard — but the dashboard already early-returns on no institutionId, so it's safe.) Do NOT modify exam/proctoring analytics.

- [ ] **Step 3: Verify + commit**
```bash
npx tsc --noEmit
npx eslint src/components/analytics/TeacherAnalyticsDashboard.tsx src/components/analytics/SchoolAnalyticsDashboard.tsx src/components/analytics/HomeworkAnalyticsSection.tsx src/hooks/useHomeworkAnalytics.ts
npx vite build
git add src/components/analytics/
git commit -F - <<'EOF'
feat(homework): surface assignment-marks analytics in teacher + school dashboards

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 5: Phase verification

- [ ] `tsc` 0 · `eslint` (all new/changed files) 0 · `vite build` 0.
- [ ] **Manual smoke (user step):** as a teacher with graded homework → the "Assignment marks" tiles show avg %, submission/on-time rate, count (scoped to own classes). As school-admin → institution-wide. As coordinator → wing-scoped. Exam analytics unchanged. No data → graceful empty state. 375px + dark mode.

---

## Self-review
**Spec coverage:** separate "assignment marks" metric block → Task 3 + 4; role scope (teacher own / coordinator wing / admin institution) → RPC role branches; server-aggregated (§23.1) → RPC; exam metrics/SLHI/report-cards untouched → only additive sections, no exam code changed. Super-admin sees it via the school-view picker (SchoolAnalyticsDashboard).
**Security:** RPC gated (admin/coord/teacher within the institution, else 42501); REVOKE public/GRANT authenticated; coordinator strictly wing-scoped via `is_coordinator_for_class`; no PII returned (aggregates only).
**Correctness:** carries_marks + published/checked filter; div-by-zero guarded (`max_marks > 0`, slots > 0, count > 0 → NULL); per-class breakdown intentionally **deferred** (multi-class attribution complexity) — top-level rollup satisfies the brief; can add `by_class` in Phase 8.
**Type consistency:** `HomeworkAnalytics` shape matches the RPC's jsonb keys; RPC name matches across migration/types/hook.
