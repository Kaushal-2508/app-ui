# Onboarding Progress Dashboard — Design

**Date:** 2026-05-16
**Owner:** Tushar
**Status:** Approved (brainstorming) → ready for implementation plan

---

## What we're building

An in-app dashboard that visualises teacher + coordinator onboarding progress for one institution — same five-milestone data the existing Excel report shows, rendered as a live, actionable page with day-over-day deltas, conditional alerts, a trend chart, distribution + funnel views, and a filterable per-teacher table.

The existing "Download Report → Onboarding Excel" flow stays untouched. The new dashboard is reached from a second button inside the same modal, only when the "Onboarding Report" radio is selected:

```
Generate Report  (modal)
└── Onboarding Report  (radio)
    └── [ Generate & Download Excel ]   [ Open Dashboard ]   ← new sibling button
```

---

## Decisions locked in during brainstorming

1. **Entry point** — second button inside `ReportModal`, visible only when `reportType === "onboarding"`. Other 3 report types are unaffected. No new button on the Command Center header. No new sidebar item.
2. **Snapshot timing — hybrid (option c)** — store the morning snapshot per institution per day, but the page's top banner + KPI cards read **live** numbers from the existing RPC. Day-over-day delta = `live now − yesterday's frozen snapshot`. Snapshot becomes a clean historical timeline, and the user always sees true current state at the top.
3. **Stuck-at-zero alert thresholds — option (b)** — trigger after **3 consecutive days at 0 %**, look back **30 days max**. Severity visually escalates at **7+ days**.
4. **Snapshot write path** — clients never INSERT directly. A single `SECURITY DEFINER` RPC `ensure_onboarding_snapshot(_institution_id)` validates the caller and performs `INSERT … ON CONFLICT DO NOTHING`. First-of-day wins.
5. **Dashboard export** — primary action is `window.print()` (spec). Excel export is **not** duplicated on the dashboard — it stays in the existing modal, as the spec demands.

---

## Architecture

### Layer 1 — Database

**Migration file** (flag for manual review, do NOT auto-apply on production):

`supabase/migrations/{YYYYMMDD}_onboarding_snapshots.sql`

```sql
CREATE TABLE public.onboarding_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  snapshot_date date NOT NULL,
  total_users int NOT NULL,
  fully_complete_count int NOT NULL,
  avg_completion_percent numeric(5,2) NOT NULL,
  milestone_counts jsonb NOT NULL,    -- { first_task_assigned: 12, first_task_completed: 8, ... }
  per_user_data jsonb NOT NULL,        -- array of per-user rows for delta computation
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  UNIQUE (institution_id, snapshot_date)
);
```

**FK cascade** follows §21 of CLAUDE.md — `institution_id` is CASCADE (snapshot disappears with institution); `created_by` is SET NULL (snapshot survives even if the admin who triggered it is deleted).

**RLS** — SELECT only for `school_admin / super_school_admin / coordinator` at that institution plus `super_admin`. No INSERT / UPDATE / DELETE policies at all — the RPC is the only writer.

**RPC** `ensure_onboarding_snapshot(_institution_id uuid)` — `SECURITY DEFINER`:

1. Validates the caller is `super_admin` OR is `school_admin / super_school_admin` at the given institution. Raises otherwise.
2. Calls `get_institution_onboarding_progress(_institution_id)` internally and aggregates:
   - `total_users` = row count
   - `fully_complete_count` = count where `is_journey_completed`
   - `avg_completion_percent` = mean of `completion_percent`
   - `milestone_counts` = JSON object with each of 5 keys → count of `TRUE`
   - `per_user_data` = JSON array of `{ user_id, completion_percent, milestones... }`
3. `INSERT … ON CONFLICT (institution_id, snapshot_date) DO NOTHING` keyed on `(institution_id, current_date)`.
4. Returns the snapshot row that exists for today (whether newly inserted or pre-existing).

### Layer 2 — Frontend hooks + math

`src/hooks/useOnboardingDashboard.ts` — single composing hook:
- `live` = `useInstitutionOnboardingProgress(institutionId)` (already exists, no change)
- `snapshot` = `useMutation` calling `ensure_onboarding_snapshot` once on mount, fire-and-forget. Idempotent.
- `prior` = `useQuery` for `SELECT * FROM onboarding_snapshots WHERE institution_id = ? AND snapshot_date < current_date ORDER BY snapshot_date DESC LIMIT 1` — yesterday or most recent prior snapshot for delta baseline.
- `trend` = `useQuery` for `SELECT * FROM onboarding_snapshots WHERE institution_id = ? AND snapshot_date >= current_date - 30 ORDER BY snapshot_date ASC` — last 30 snapshots for chart + zero-day counting.
- Combines into `{ live, deltas, alerts, trend, zeroDayMap, isLoading, isError, refetch }`.

`src/lib/onboardingDashboardMath.ts` — pure, easily-testable functions:
- `computeDeltas(live, baseline)` → returns deltas for fully-complete, avg %, each milestone.
- `countConsecutiveZeroDays(userId, snapshots)` → number of consecutive days (from today backwards) the user was at 0 %. Capped at lookback window.
- `deriveAlerts({ live, deltas, snapshots, zeroDayMap })` → array of `Alert` objects, only includes alerts whose condition is true:
  - `escalation` — any user with `zeroDayMap[userId] >= 3`. Severity = `critical` if any `>= 7`.
  - `closeToDone` — count of users at exactly 80 %.
  - `bottleneck` — fires when `firstStudyMaterialUploaded` count OR `firstResultValidated` count is below 30 % of total.
  - `momentum` — `deltas.avgCompletion >= +5` percentage points.

### Layer 3 — Page + sections

`src/pages/school/OnboardingDashboardPage.tsx` — composes per CLAUDE.md §20a/§20b:

```tsx
<PageShell>
  <PageHeader
    title="Onboarding Progress"
    subtitle={`${schoolName} · Generated ${todayStr}`}
    primaryAction={{ label: "Print", icon: Printer, onClick: () => window.print() }}
  />
  <SummaryBanner data={data} />
  <DeltaBar data={data} />
  <AlertCards alerts={data.alerts} />
  <KpiCards data={data} />
  <ProgressTrendChart trend={data.trend} />
  <DistributionAndFunnel data={data} />
  <CompletedTeachersList data={data} />
  <PerTeacherTable rows={data.live} zeroDayMap={data.zeroDayMap} />
  <PendingTasksGrid rows={data.live} zeroDayMap={data.zeroDayMap} />
</PageShell>
```

**Section breakdown:**

| Section | Component | Primitives used |
|---|---|---|
| SummaryBanner | top 4-tile snapshot | `StatTileGrid` + 4× `StatTile` |
| DeltaBar | horizontal strip of day-over-day chips; "First report" empty state if no prior snapshot | `surface-card frosted-shadow` + delta chips |
| AlertCards | conditional 0–4 callouts, only true conditions render | shadcn `Alert` variants tinted via tokens |
| KpiCards | 6 metrics with delta badges | `StatTileGrid` |
| ProgressTrendChart | Recharts `LineChart` for `fully_complete_count` + `avg_completion_percent` over date; single-day summary card when `trend.length === 1` | `ResponsiveContainer` inside `<div style={{width:"100%", height:256}}>` per §20a Phase 8 |
| DistributionAndFunnel | side-by-side on `lg+`, stacked on mobile. Left: proportional bars for tiers `100/80/60/40/20/0`. Right: 5 funnel rows with count + % + delta | plain divs with brand-tinted bars |
| CompletedTeachersList | `ListRow` per fully-complete teacher; `"New today"` pill if absent from yesterday's snapshot completed set | `ListRow` |
| PerTeacherTable | search input + tier filter + missing-milestone filter via `FilterRow` (or `FilterSheet` if filters >= 3). All teachers, live row count. | shadcn `Table` + `FilterRow` |
| PendingTasksGrid | one card per teacher `< 100 %`. Cards at 80 % → "Close today" pill. Cards stuck at 0 % for `>= 3` days → "Stuck for X days" pill (red at `>= 7`) | grid of `surface-card frosted-shadow` cards |

### Layer 4 — Wiring

1. `src/components/command-center/ReportModal.tsx`
   - When `reportType === "onboarding"`: render two buttons in a `flex gap-3` row instead of the single full-width Excel button. `[ Generate & Download Excel ]` stays exactly as today; `[ Open Dashboard ]` (secondary variant) navigates via `useNavigate` to `/school/onboarding-dashboard`, closes the modal, and does not generate Excel.
   - When any other report type is selected, the modal renders the existing single button.

2. `src/App.tsx`
   - New `lazy(() => import("./pages/school/OnboardingDashboardPage"))`.
   - New `<Route path="/school/onboarding-dashboard" element={<ProtectedRoute allowedRoles={["school_admin", "super_school_admin", "super_admin"]}>...}/>` — mirrors `/school/command-center` exactly.

---

## Print mode

Tailwind `print:` utilities on the page:

- `AppLayout`'s sidebar + header: already hidden in print by repo-wide print CSS (verify).
- `PageHeader` action buttons + kebab: `print:hidden`.
- `FilterRow` / search inputs / kebabs in `PerTeacherTable`: `print:hidden`.
- Page background: `print:bg-white print:[--surface-base:white]`.
- All `surface-card frosted-shadow` cards: `print:shadow-none print:border print:border-black/10`.
- `PerTeacherTable`: renders all rows (no virtualization), no horizontal scroll, columns wrap if needed.

---

## What is guaranteed NOT to change

| Surface | Behaviour |
|---|---|
| Command Center header "Download Report" button | unchanged |
| Existing 3 report types (Compliance / Inspection / Academic) | unchanged |
| Existing onboarding Excel generation logic | unchanged |
| `get_institution_onboarding_progress` RPC | unchanged |
| `get_user_onboarding_progress` RPC | unchanged |
| `useMyOnboardingProgress` hook | unchanged |
| `useInstitutionOnboardingProgress` hook | unchanged (consumed, not modified) |
| Migration application | flagged for manual review, not auto-pushed |
| Route protection model | mirrors Command Center exactly |
| Sidebar nav | no new items |

---

## File inventory

### New files

| Path | Purpose |
|---|---|
| `supabase/migrations/{YYYYMMDD}_onboarding_snapshots.sql` | table + RPC + RLS — flag for manual review |
| `src/hooks/useOnboardingDashboard.ts` | composing data hook |
| `src/lib/onboardingDashboardMath.ts` | pure functions (deltas / alerts / zero-day) |
| `src/pages/school/OnboardingDashboardPage.tsx` | page composition |
| `src/components/onboarding-dashboard/SummaryBanner.tsx` | section 1 |
| `src/components/onboarding-dashboard/DeltaBar.tsx` | section 2 |
| `src/components/onboarding-dashboard/AlertCards.tsx` | section 3 |
| `src/components/onboarding-dashboard/KpiCards.tsx` | section 4 |
| `src/components/onboarding-dashboard/ProgressTrendChart.tsx` | section 5 |
| `src/components/onboarding-dashboard/DistributionAndFunnel.tsx` | section 6 |
| `src/components/onboarding-dashboard/CompletedTeachersList.tsx` | section 7 |
| `src/components/onboarding-dashboard/PerTeacherTable.tsx` | section 8 |
| `src/components/onboarding-dashboard/PendingTasksGrid.tsx` | section 9 |

### Edited files

| Path | Change |
|---|---|
| `src/components/command-center/ReportModal.tsx` | conditional 2-button footer when `reportType === "onboarding"` |
| `src/App.tsx` | new lazy import + protected route |

---

## Production-readiness checklist (per CLAUDE.md §5a)

Before claiming done:
- `npx tsc --noEmit` exits 0 — no `any`, no `// @ts-expect-error`. Supabase types lag for the new table + RPC → define narrow inline types in the hook file (e.g. `type OnboardingSnapshotRow = { ... }`).
- `npx eslint <touched files>` — no new errors over baseline. No `// eslint-disable-next-line`.
- `npx vite build` — exits 0.
- All `onError` / `catch` toasts go through `toastError(err, { fallback, context })` from `src/lib/toast.ts` per §6/§19.
- All shadcn components: no custom raw HTML buttons / inputs.
- 375 px width: header doesn't wrap, no horizontal scroll, cards float, tab strips scroll-snap.
- Dark mode: page surface, cards, text scale, shadows all flip cleanly. No hardcoded greys.

---

## Out of scope

- Editing onboarding milestone definitions or their underlying SQL — that lives in `salci-module-notes` territory and is unrelated to this build.
- Adding the dashboard to any role's main sidebar — explicitly opted out.
- Live websocket / realtime updates — the page is "load-time fresh" via React Query, no subscription channel.
- Cross-institution super-admin overview — single institution only, same as the Excel report.
- Snapshot retention / cleanup job — table grows unbounded for now; a future migration can prune > 1 year old rows if needed.
