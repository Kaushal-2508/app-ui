# Attendance — Timezone Fix, Instant Materialization, Admin Override — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make staff auto-mark-absent fire correctly for IST schools, materialize absent rows + pending substitutions instantly when a school admin lands on the Attendance page past cutoff, and let admins manually override any teacher's attendance (even after auto-mark).

**Architecture:** Three coordinated changes. (A) One DB migration adds `institutions.timezone`, splits `tt_run_attendance_cron_pass()` into a reusable per-institution function, fixes its timezone math, and decouples auto-mark from the substitution toggle. (B) A new `useRunAttendancePass` mutation calls the new RPC; `SchoolAttendancePage` fires it once per session on admin/coordinator view if local cutoff has passed; `useScopedStaffAttendance` adds a client-side "absent (syncing)" preview for the brief roundtrip window. (C) `useUpsertStaffAttendance` mutation + per-row kebab menu in `AttendanceListPanel` for manual override. Existing trigger `tt_substitutions_cancel_on_late_checkin_trg` already cancels pending subs when status flips to present/late.

**Tech Stack:** PostgreSQL (functions + pg_cron), Supabase RPCs, React + TanStack Query v5, shadcn/ui `DropdownMenu`.

**Spec:** [docs/superpowers/specs/2026-05-25-attendance-tz-fix-and-admin-override-design.md](../specs/2026-05-25-attendance-tz-fix-and-admin-override-design.md)

---

## File Manifest

| File | Action | Responsibility |
|---|---|---|
| `supabase/migrations/20260525120000_attendance_tz_fix_and_admin_override.sql` | Create | Add `institutions.timezone`, new `tt_run_attendance_pass_for_institution(uuid)` RPC, rewrite `tt_run_attendance_cron_pass()` to delegate, verify/add RLS for admin UPDATE/DELETE on `staff_attendance_records`. |
| `src/hooks/useRunAttendancePass.ts` | Create | TanStack mutation that calls the per-institution RPC and invalidates the relevant queries. |
| `src/hooks/useStaffAttendance.ts` | Modify | Add `isPastCutoff(settings)` helper. Add `useUpsertStaffAttendance` mutation for admin override (status + optional remarks, with delete-on-clear semantics). |
| `src/hooks/useAttendanceLists.ts` | Modify | Accept a `settings` arg or read it internally; for `kind=teachers`, when `now() > cutoff` (local) and row has `status=null`, expose `derivedStatus: "absent"` + `derived: true` so the UI can render an "Absent · syncing" pill. |
| `src/pages/school/SchoolAttendancePage.tsx` | Modify | When admin or coordinator AND institution-local now > cutoff AND sessionStorage flag unset → call `useRunAttendancePass` once. |
| `src/components/attendance/AttendanceListPanel.tsx` | Modify | Render derived "Absent · syncing" pill; for admins/coordinators on `kind=teachers`, add a per-row kebab `DropdownMenu` with Mark Present / Late / Absent / On Leave / Clear. Show subtle "Overridden" microcopy when applicable. |
| `.claude/CLAUDE.md` | Modify | Add §24 "Attendance auto-mark — institution-local timezone" invariant so future agents don't reintroduce the UTC bug. |

---

## Task 1: Write the DB migration

**Files:**
- Create: `supabase/migrations/20260525120000_attendance_tz_fix_and_admin_override.sql`

- [ ] **Step 1: Create migration file with full SQL**

```sql
-- 20260525120000_attendance_tz_fix_and_admin_override.sql
--
-- Attendance — timezone fix + instant materialization RPC + admin override.
-- See docs/superpowers/specs/2026-05-25-attendance-tz-fix-and-admin-override-design.md
--
-- Three changes:
--  (A1) institutions.timezone column (default 'Asia/Kolkata' — all current
--       SALCI institutions are Indian; future non-IST schools change the column).
--  (A2) tt_run_attendance_pass_for_institution(uuid) — reusable per-inst body
--       with institution-local time-of-day comparison, decoupled from the
--       substitution feature flag (sub flag now only gates sub generation).
--  (A3) tt_run_attendance_cron_pass() rewritten to delegate to (A2).
--  (C3) RLS UPDATE/DELETE policies on staff_attendance_records for admin
--       override (verify-or-add).

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- (A1) institutions.timezone
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.institutions
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata';

COMMENT ON COLUMN public.institutions.timezone IS
  'IANA timezone name (e.g. Asia/Kolkata). Used by attendance cron to compare local time-of-day to staff_check_in_time, and by any future feature that needs institution-local time. Defaults to Asia/Kolkata since SALCI is India-only today.';

-- ─────────────────────────────────────────────────────────────────────
-- (A2) tt_run_attendance_pass_for_institution(uuid)
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tt_run_attendance_pass_for_institution(p_institution_id UUID)
RETURNS TABLE(institution_id UUID, staff_marked INT, subs_generated INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_today DATE := CURRENT_DATE;
  v_settings RECORD;
  v_tz TEXT;
  v_marked INT := 0;
  v_subs   INT := 0;
BEGIN
  -- Caller authorization. The cron job invokes this with no auth context
  -- (auth.uid() is null) and is trusted. Otherwise require an admin or
  -- coordinator role scoped to the requested institution.
  IF auth.uid() IS NOT NULL AND NOT (
        public.has_role(auth.uid(), 'super_admin'::app_role)
     OR public.has_role(auth.uid(), 'super_school_admin'::app_role)
     OR EXISTS (
          SELECT 1 FROM public.user_roles ur
          WHERE ur.user_id = auth.uid()
            AND ur.institution_id = p_institution_id
            AND ur.role IN ('school_admin'::app_role, 'coordinator'::app_role)
        )
  ) THEN
    RAISE EXCEPTION 'not authorized to run attendance pass for institution %', p_institution_id
      USING ERRCODE = '42501';
  END IF;

  SELECT s.staff_check_in_time, s.staff_late_check_in_allowed,
         s.staff_late_grace_minutes, s.staff_substitution_enabled,
         i.timezone
  INTO v_settings
  FROM public.attendance_settings s
  JOIN public.institutions i ON i.id = s.institution_id
  WHERE s.institution_id = p_institution_id;

  IF NOT FOUND THEN
    RETURN; -- no settings row → nothing to do
  END IF;

  v_tz := COALESCE(v_settings.timezone, 'Asia/Kolkata');

  -- Cutoff check in INSTITUTION-LOCAL time-of-day (was UTC — that's the
  -- bug that wedged auto-mark for every IST institution).
  IF (now() AT TIME ZONE v_tz)::time
       < (v_settings.staff_check_in_time
          + CASE WHEN v_settings.staff_late_check_in_allowed
                 THEN make_interval(mins => v_settings.staff_late_grace_minutes)
                 ELSE INTERVAL '0' END)
  THEN
    institution_id := p_institution_id; staff_marked := 0; subs_generated := 0;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Holiday short-circuit (unchanged behavior).
  IF EXISTS (
    SELECT 1 FROM public.cal_events e
    WHERE e.institution_id = p_institution_id
      AND e.kind = 'holiday'
      AND v_today BETWEEN e.starts_on AND e.ends_on
  ) THEN
    institution_id := p_institution_id; staff_marked := 0; subs_generated := 0;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Auto-mark absent for every staff member with at least one slot today
  -- and no row yet. Runs REGARDLESS of staff_substitution_enabled (the
  -- pre-existing cron coupled the two — wrong: schools that don't want
  -- auto-subs still need correct attendance).
  WITH staff_today AS (
    SELECT DISTINCT s.teacher_id AS staff_id
    FROM public.tt_slots s
    WHERE s.institution_id = p_institution_id
      AND s.day            = public.tt_dow_to_text(v_today)
      AND s.teacher_id IS NOT NULL
  ),
  inserted AS (
    INSERT INTO public.staff_attendance_records
      (institution_id, staff_id, date, status, auto_marked_absent)
    SELECT p_institution_id, st.staff_id, v_today, 'absent', TRUE
    FROM staff_today st
    WHERE NOT EXISTS (
      SELECT 1 FROM public.staff_attendance_records sa
      WHERE sa.staff_id = st.staff_id AND sa.date = v_today
    )
    RETURNING staff_id
  )
  SELECT COUNT(*)::INT INTO v_marked FROM inserted;

  -- Subs only if the institution opted in.
  IF v_settings.staff_substitution_enabled THEN
    v_subs := public.tt_create_pending_subs_for_absent_staff(p_institution_id, v_today);
  END IF;

  institution_id := p_institution_id;
  staff_marked   := v_marked;
  subs_generated := v_subs;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.tt_run_attendance_pass_for_institution(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tt_run_attendance_pass_for_institution(UUID) TO authenticated;

COMMENT ON FUNCTION public.tt_run_attendance_pass_for_institution(UUID) IS
  'Auto-mark absent + generate pending subs for one institution. Idempotent (UNIQUE constraints). Called by tt_run_attendance_cron_pass every 15 min AND by the client when an admin/coordinator lands on the Attendance page past cutoff (skips the 15-min cron lag).';

-- ─────────────────────────────────────────────────────────────────────
-- (A3) tt_run_attendance_cron_pass() — now just a loop
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tt_run_attendance_cron_pass()
RETURNS TABLE(institution_id UUID, staff_marked INT, subs_generated INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT s.institution_id FROM public.attendance_settings s LOOP
    RETURN QUERY SELECT * FROM public.tt_run_attendance_pass_for_institution(r.institution_id);
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.tt_run_attendance_cron_pass() IS
  '15-min fallback. Loops every institution with attendance_settings and calls tt_run_attendance_pass_for_institution. Live admin views fire the per-institution function directly via RPC so they do not wait for the next tick.';

-- ─────────────────────────────────────────────────────────────────────
-- (C3) RLS UPDATE/DELETE policies on staff_attendance_records
-- ─────────────────────────────────────────────────────────────────────
-- The base table already has SELECT + INSERT policies from phase-1. Admin
-- override needs UPDATE + DELETE for admins/coordinators scoped to their
-- institution. We drop any same-named policy first so the migration is
-- idempotent across re-runs.

DROP POLICY IF EXISTS "Admins can update staff attendance" ON public.staff_attendance_records;
CREATE POLICY "Admins can update staff attendance"
  ON public.staff_attendance_records
  FOR UPDATE
  USING (
    public.has_role(auth.uid(), 'super_admin'::app_role)
    OR public.has_role(auth.uid(), 'super_school_admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.institution_id = staff_attendance_records.institution_id
        AND ur.role IN ('school_admin'::app_role, 'coordinator'::app_role)
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin'::app_role)
    OR public.has_role(auth.uid(), 'super_school_admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.institution_id = staff_attendance_records.institution_id
        AND ur.role IN ('school_admin'::app_role, 'coordinator'::app_role)
    )
  );

DROP POLICY IF EXISTS "Admins can delete staff attendance" ON public.staff_attendance_records;
CREATE POLICY "Admins can delete staff attendance"
  ON public.staff_attendance_records
  FOR DELETE
  USING (
    public.has_role(auth.uid(), 'super_admin'::app_role)
    OR public.has_role(auth.uid(), 'super_school_admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.institution_id = staff_attendance_records.institution_id
        AND ur.role IN ('school_admin'::app_role, 'coordinator'::app_role)
    )
  );

-- Admin INSERT (override on a day with no row yet — e.g. mark a teacher
-- "On leave" before cutoff so the cron skips them).
DROP POLICY IF EXISTS "Admins can insert staff attendance" ON public.staff_attendance_records;
CREATE POLICY "Admins can insert staff attendance"
  ON public.staff_attendance_records
  FOR INSERT
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin'::app_role)
    OR public.has_role(auth.uid(), 'super_school_admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.institution_id = staff_attendance_records.institution_id
        AND ur.role IN ('school_admin'::app_role, 'coordinator'::app_role)
    )
  );

COMMIT;
```

- [ ] **Step 2: Verify the file lints with sqlfluff or simple grep for typos**

```bash
# We don't run sqlfluff in CI for this repo — eyeball-check that:
# - every CREATE / DROP / ALTER / COMMENT is terminated with ;
# - every $$ is paired
# - column / function names match production schema (verified in spec)
grep -c "^\(CREATE\|DROP\|ALTER\|COMMENT\)" supabase/migrations/20260525120000_attendance_tz_fix_and_admin_override.sql
# Expected: ≥ 9 (1 ALTER, 1 COMMENT col, 2 CREATE FUNCTION, 2 COMMENT fn, 3 DROP + 3 CREATE POLICY)
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260525120000_attendance_tz_fix_and_admin_override.sql
git commit -m "feat(attendance): timezone-aware cron + per-inst RPC + admin RLS

Fixes wedged auto-mark for IST schools (cron compared UTC time-of-day
to a wall-clock TIME stored as IST). Splits per-institution body into
a reusable SECURITY DEFINER RPC so admins can materialize today's
absent rows + pending substitutions instantly on page view instead of
waiting up to 15 min for the next cron tick. Decouples auto-mark from
the substitution toggle — sub flag now only gates sub generation, not
the absence row itself."
```

---

## Task 2: Deploy migration to production + backfill

**Files:** none modified — production-only operation.

- [ ] **Step 1: Apply the migration**

```powershell
npx supabase@latest db push --project-ref gyymkgohcijeksmrzuyw --include-all
```

Expected: prints `Applying migration 20260525120000_attendance_tz_fix_and_admin_override.sql...` and exits 0. If push refuses because of drift, run `npx supabase@latest db diff --project-ref gyymkgohcijeksmrzuyw` first and resolve.

- [ ] **Step 2: Smoke-verify the function exists and the column was added**

Run this SQL via Supabase SQL Editor (or the Management API):

```sql
SELECT proname FROM pg_proc
 WHERE proname IN ('tt_run_attendance_pass_for_institution','tt_run_attendance_cron_pass');
SELECT column_name FROM information_schema.columns
 WHERE table_name='institutions' AND column_name='timezone';
```

Expected: 2 rows for functions, 1 row for the column.

- [ ] **Step 3: Backfill today by running the cron pass once**

```sql
SELECT * FROM public.tt_run_attendance_cron_pass();
```

Expected: one row per institution with `attendance_settings`, e.g.
```
institution_id | staff_marked | subs_generated
salci-uuid     | ~36          | ~211
```

- [ ] **Step 4: Verify rows materialized for Salci National School**

```sql
SELECT status, auto_marked_absent, COUNT(*) FROM staff_attendance_records sar
 JOIN institutions i ON i.id=sar.institution_id
 WHERE i.name ILIKE '%salci national%' AND sar.date=CURRENT_DATE
 GROUP BY 1,2;

SELECT status, COUNT(*) FROM tt_substitutions ts
 JOIN tt_slots s ON s.id=ts.slot_id
 JOIN institutions i ON i.id=s.institution_id
 WHERE i.name ILIKE '%salci national%' AND ts.date=CURRENT_DATE
 GROUP BY 1;
```

Expected: `staff_attendance_records` shows `absent / auto=true / ~36`. `tt_substitutions` shows `pending / ~211`.

- [ ] **Step 5: Negative-auth check (non-admin)**

```sql
-- Run as a student JWT in the SQL editor (set "Run as" → student). Or
-- temporarily via supabase.rpc from a student session. Expect 42501.
SELECT * FROM public.tt_run_attendance_pass_for_institution('<salci-id>');
```

Expected: `ERROR: not authorized to run attendance pass for institution ...` with code 42501.

---

## Task 3: Create `useRunAttendancePass` hook

**Files:**
- Create: `src/hooks/useRunAttendancePass.ts`

- [ ] **Step 1: Write the hook**

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/toast";

interface AttendancePassResult {
  institution_id: string;
  staff_marked: number;
  subs_generated: number;
}

/**
 * Materialize today's auto-absent rows + pending substitutions for a
 * single institution. Wraps the DB function tt_run_attendance_pass_for_institution
 * which is idempotent (UNIQUE(staff_id,date) + UNIQUE(slot_id,date)).
 *
 * Used by SchoolAttendancePage to skip the 15-min cron lag when an admin
 * lands on the page past the institution-local cutoff. Cron continues to
 * fire as a fallback.
 */
export function useRunAttendancePass() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (institutionId: string): Promise<AttendancePassResult[]> => {
      const { data, error } = await supabase.rpc(
        "tt_run_attendance_pass_for_institution" as never,
        { p_institution_id: institutionId } as never,
      );
      if (error) throw error;
      return (data ?? []) as AttendancePassResult[];
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["attendance-list"] });
      qc.invalidateQueries({ queryKey: ["substitutions"] });
      qc.invalidateQueries({ queryKey: ["staff-attendance"] });
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't sync attendance.", context: "runAttendancePass" }),
  });
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: exit 0 (no new errors in this file). If `supabase.rpc` complains about the function name not being in generated types — that's expected; the `as never` cast is the existing pattern in this repo for newly-deployed RPCs not yet in `types.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useRunAttendancePass.ts
git commit -m "feat(attendance): useRunAttendancePass hook

Calls tt_run_attendance_pass_for_institution RPC and invalidates the
attendance-list / substitutions / staff-attendance query caches on
success. Errors flow through toastError per §19."
```

---

## Task 4: Add `isPastCutoff` helper + `useUpsertStaffAttendance` mutation

**Files:**
- Modify: `src/hooks/useStaffAttendance.ts`

- [ ] **Step 1: Add `isPastCutoff` helper at the top of the file (after `windowDateFor`)**

Insert immediately after the `windowDateFor` function (around line 41):

```ts
/**
 * True iff current local clock is past `staff_check_in_time + grace`.
 * Used by:
 *   - SchoolAttendancePage  → decide whether to kick the RPC materializer
 *   - useScopedStaffAttendance → decide whether null-status rows should
 *     render as derived "Absent · syncing"
 *
 * Browser local time is fine: SALCI is India-only and laptops/phones in
 * the field will be IST. The server's authoritative cutoff still runs in
 * institution-local timezone (see tt_run_attendance_pass_for_institution
 * + institutions.timezone).
 */
export function isPastCutoff(
  settings: Pick<
    AttendanceSettingsRow,
    "staff_check_in_time" | "staff_late_check_in_allowed" | "staff_late_grace_minutes"
  > | null,
  ref: Date = new Date(),
): boolean {
  if (!settings) return false;
  const cutoff = windowDateFor(settings.staff_check_in_time, ref);
  if (settings.staff_late_check_in_allowed) {
    cutoff.setMinutes(cutoff.getMinutes() + (settings.staff_late_grace_minutes ?? 0));
  }
  return ref.getTime() > cutoff.getTime();
}
```

- [ ] **Step 2: Add the `useUpsertStaffAttendance` mutation at the bottom of the file**

Append after `useCheckOutStaff` (around line 173):

```ts
/**
 * Admin override — upsert today's staff_attendance_records row for an
 * arbitrary staff member. `auto_marked_absent` is forced to false so the
 * card UI knows the row is admin-set. Passing `status: null` deletes the
 * row (Clear status).
 *
 * Flipping a previously-absent teacher to present/late automatically
 * cancels their pending tt_substitutions via the existing trigger
 * `tt_substitutions_cancel_on_late_checkin_trg`.
 */
export function useUpsertStaffAttendance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      institutionId: string;
      staffId: string;
      status: StaffAttendanceStatus | null;
      remarks?: string;
    }) => {
      const today = todayStr();
      if (params.status === null) {
        const { error } = await supabase
          .from("staff_attendance_records" as never)
          .delete()
          .eq("staff_id", params.staffId)
          .eq("date", today);
        if (error) throw error;
        return null;
      }
      const payload = {
        institution_id: params.institutionId,
        staff_id: params.staffId,
        date: today,
        status: params.status,
        auto_marked_absent: false,
        check_in_at:
          params.status === "present" || params.status === "late"
            ? new Date().toISOString()
            : null,
        remarks: params.remarks ?? null,
      };
      const { data, error } = await supabase
        .from("staff_attendance_records" as never)
        .upsert(payload, { onConflict: "staff_id,date" })
        .select()
        .single();
      if (error) throw error;
      return data as StaffAttendanceRecord;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["attendance-list"] });
      qc.invalidateQueries({ queryKey: ["substitutions"] });
      qc.invalidateQueries({ queryKey: ["staff-attendance"] });
      toast.success("Attendance updated");
    },
    onError: (err: Error) =>
      toastError(err, {
        fallback: "Couldn't update attendance.",
        context: "upsertStaffAttendance",
      }),
  });
}
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 4: ESLint touched file**

```bash
npx eslint src/hooks/useStaffAttendance.ts
```

Expected: 0 errors. If `@typescript-eslint/no-explicit-any` complains about the upsert payload's `as never` cast — replace with a small inline type per §5a; do NOT add `// eslint-disable-next-line` or `as any`.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useStaffAttendance.ts
git commit -m "feat(attendance): isPastCutoff helper + useUpsertStaffAttendance

isPastCutoff(settings, ref) is reused by SchoolAttendancePage (decide
whether to call the RPC materializer) and useScopedStaffAttendance
(decide whether null-status rows should preview as 'Absent · syncing').

useUpsertStaffAttendance lets admins override any teacher's status for
today; the existing tt_substitutions_cancel_on_late_checkin_trg handles
pending-sub cleanup when status flips back to present/late."
```

---

## Task 5: Add derived `Absent · syncing` preview in `useScopedStaffAttendance`

**Files:**
- Modify: `src/hooks/useAttendanceLists.ts`

- [ ] **Step 1: Extend `StaffListRow` with `derived` flag**

Change the interface (around line 14):

```ts
export interface StaffListRow {
  id: string;
  fullName: string;
  email: string;
  status: StaffAttendanceStatus | null;
  /**
   * True when `status` was derived client-side (no DB row exists yet but
   * local cutoff has passed). The list UI renders a "syncing" pill in
   * this case; mutations never read this — they always upsert against
   * the DB row identity.
   */
  derived: boolean;
  /** True iff the DB row had auto_marked_absent=true (vs admin-set). */
  autoMarkedAbsent: boolean;
  /** True when an admin upsert replaced an earlier auto-marked row. */
  overridden: boolean;
  checkInAt: string | null;
  checkOutAt: string | null;
  classCount: number;
}
```

- [ ] **Step 2: Update the `useScopedStaffAttendance` queryFn to populate the new fields**

Inside the existing hook (around line 122), change the SELECT to include `auto_marked_absent, created_at, updated_at`, and the row builder to derive the new fields.

Replace this block:
```ts
      const { data: sar, error: sarErr } = await supabase
        .from("staff_attendance_records" as never)
        .select("staff_id, status, check_in_at, check_out_at")
        .in("staff_id", staffIds)
        .eq("date", todayStr());
```

With:
```ts
      const { data: sar, error: sarErr } = await supabase
        .from("staff_attendance_records" as never)
        .select("staff_id, status, check_in_at, check_out_at, auto_marked_absent, created_at, updated_at")
        .in("staff_id", staffIds)
        .eq("date", todayStr());
```

And replace the SarRow type + row builder:
```ts
      type SarRow = {
        staff_id: string;
        status: StaffAttendanceStatus;
        check_in_at: string | null;
        check_out_at: string | null;
      };
      const sarMap = new Map<string, SarRow>();
      ((sar ?? []) as SarRow[]).forEach((s) => sarMap.set(s.staff_id, s));

      const rows: StaffListRow[] = staffIds.map((id) => {
        const p = roster.get(id)!;
        const today = sarMap.get(id);
        return {
          id,
          fullName: p.full_name,
          email: p.email,
          status: today?.status ?? null,
          checkInAt: today?.check_in_at ?? null,
          checkOutAt: today?.check_out_at ?? null,
          classCount: classCount.get(id) ?? 0,
        };
      });
```

With:
```ts
      type SarRow = {
        staff_id: string;
        status: StaffAttendanceStatus;
        check_in_at: string | null;
        check_out_at: string | null;
        auto_marked_absent: boolean;
        created_at: string;
        updated_at: string;
      };
      const sarMap = new Map<string, SarRow>();
      ((sar ?? []) as SarRow[]).forEach((s) => sarMap.set(s.staff_id, s));

      // Derived "Absent · syncing" preview for teachers who have no row
      // yet AND local cutoff has passed. The DB cron / page-view RPC
      // will materialize a real row within ~1–2s; the preview keeps the
      // list honest in the interim.
      const settings = settingsForCutoff;
      const pastCutoff = isPastCutoff(settings);

      const rows: StaffListRow[] = staffIds.map((id) => {
        const p = roster.get(id)!;
        const today = sarMap.get(id);
        const hasRow = !!today;
        const derived = !hasRow && pastCutoff && role === "teacher";
        const overridden =
          hasRow && !today!.auto_marked_absent &&
          new Date(today!.updated_at).getTime() - new Date(today!.created_at).getTime() > 1000;
        return {
          id,
          fullName: p.full_name,
          email: p.email,
          status: today?.status ?? (derived ? "absent" : null),
          derived,
          autoMarkedAbsent: today?.auto_marked_absent ?? false,
          overridden,
          checkInAt: today?.check_in_at ?? null,
          checkOutAt: today?.check_out_at ?? null,
          classCount: classCount.get(id) ?? 0,
        };
      });
```

- [ ] **Step 3: Add `useEffectiveAttendanceSettings` import and use it inside the hook**

At the top of `useAttendanceLists.ts`:

```ts
import { useEffectiveAttendanceSettings } from "@/hooks/useAttendance";
import { isPastCutoff } from "@/hooks/useStaffAttendance";
```

Inside `useScopedStaffAttendance`, after the existing `institutionId` resolution (around line 48):
```ts
  const settingsForCutoff = useEffectiveAttendanceSettings(institutionId);
```

And add it to the query key so changing settings refreshes the derivation:
```ts
    queryKey: [
      "attendance-list", "staff", role, institutionId, isCoord,
      wingClassIds.sort().join(","),
      // Derived rows depend on local cutoff — bucket by HH:mm to avoid
      // re-keying on every second. Re-derives once per minute, which is
      // good enough for a cutoff that moves at minute granularity.
      `${settingsForCutoff?.staff_check_in_time ?? ""}|${settingsForCutoff?.staff_late_grace_minutes ?? ""}|${new Date().toISOString().slice(0, 16)}`,
    ],
```

- [ ] **Step 4: Update the `useScopedStudentsAttendance` row type IF the StudentListRow needs the same fields**

For now, students get no syncing preview (no auto-mark cron for students). Leave `StudentListRow` alone. The `useAttendanceCounts` already treats `status === null` as `none` so no count change needed.

- [ ] **Step 5: Typecheck + lint**

```bash
npx tsc --noEmit
npx eslint src/hooks/useAttendanceLists.ts
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useAttendanceLists.ts
git commit -m "feat(attendance): derived 'syncing' preview for past-cutoff teachers

When local time is past staff_check_in_time + grace and a teacher has
no row yet, expose status='absent' + derived=true so the list panel
can render an 'Absent · syncing' pill while the page-view RPC kicks
off the DB materialization. Also surfaces autoMarkedAbsent + overridden
fields used by the admin-override microcopy."
```

---

## Task 6: Wire kickoff RPC into `SchoolAttendancePage`

**Files:**
- Modify: `src/pages/school/SchoolAttendancePage.tsx`

- [ ] **Step 1: Add imports**

After the existing imports (around line 27):

```ts
import { useEffect } from "react";
import { format } from "date-fns";
import { useRunAttendancePass } from "@/hooks/useRunAttendancePass";
import { useEffectiveInstitutionId } from "@/contexts/InstitutionContext";
import { useEffectiveAttendanceSettings } from "@/hooks/useAttendance";
import { isPastCutoff } from "@/hooks/useStaffAttendance";
```

And replace `useMemo, useState` with `useEffect, useMemo, useState`:

```ts
import { useEffect, useMemo, useState } from "react";
```

- [ ] **Step 2: Add the kickoff effect right after the `roleInfo` destructure (after line 53)**

```ts
  // Materialize today's auto-absent rows + pending substitutions instantly
  // when an admin/coordinator lands here past local cutoff, instead of
  // waiting up to 15 min for the next cron tick. Idempotent on the server
  // (UNIQUE constraints). Guarded with sessionStorage so we don't re-fire
  // on every tab switch within the same session.
  const institutionId = useEffectiveInstitutionId(roleInfo?.institutionId ?? null);
  const settings = useEffectiveAttendanceSettings(institutionId);
  const runPass = useRunAttendancePass();

  useEffect(() => {
    if (!(isAdmin || isCoordinator)) return;
    if (!institutionId || !settings) return;
    if (!isPastCutoff(settings)) return;
    const key = `salci:att-pass:${institutionId}:${format(new Date(), "yyyy-MM-dd")}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");  // set BEFORE the call so React 18 StrictMode double-renders cannot double-fire
    runPass.mutate(institutionId);
    // runPass is stable; intentionally exclude it from deps to avoid the
    // exhaustive-deps "useless re-render" warning chain.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, isCoordinator, institutionId, settings]);
```

If the project's eslint config rejects the `eslint-disable-next-line` comment (it shouldn't — that one is allowed), use a `useRef(runPass)` pattern instead.

- [ ] **Step 3: Typecheck + build**

```bash
npx tsc --noEmit
npx eslint src/pages/school/SchoolAttendancePage.tsx
```

Expected: 0 new errors.

- [ ] **Step 4: Commit**

```bash
git add src/pages/school/SchoolAttendancePage.tsx
git commit -m "feat(attendance): fire RPC materializer on admin page view

When the viewer is school admin or coordinator and the institution-local
cutoff has passed, fire tt_run_attendance_pass_for_institution once per
session (per institution per day). Skips the 15-min cron lag — admins
landing on the page past cutoff see the correct state in 1-2s instead
of waiting for the next tick."
```

---

## Task 7: Render "syncing" pill + admin per-row action menu in `AttendanceListPanel`

**Files:**
- Modify: `src/components/attendance/AttendanceListPanel.tsx`

- [ ] **Step 1: Imports**

Add to the existing imports:

```ts
import { MoreVertical, Check, Clock, X, CalendarOff, Eraser } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useUserRole } from "@/hooks/useUserRole";
import { useEffectiveInstitutionId } from "@/contexts/InstitutionContext";
import {
  useUpsertStaffAttendance,
  type StaffAttendanceStatus,
} from "@/hooks/useStaffAttendance";
```

- [ ] **Step 2: Extend `BaseRow` to carry derived/auto/overridden flags**

```ts
interface BaseRow {
  id: string;
  fullName: string;
  email: string;
  status: string | null;
  derived: boolean;
  autoMarkedAbsent: boolean;
  overridden: boolean;
  primary: string;
  secondary: string;
}
```

And in `buildBaseRow` (around line 125), extend the staff branch:

```ts
  if (kind === "students") {
    const r = row as StudentListRow;
    return {
      id: r.id,
      fullName: r.fullName,
      email: r.email,
      status: r.status,
      derived: false,
      autoMarkedAbsent: false,
      overridden: false,
      primary: r.fullName,
      secondary: `${r.rollNumber ? `Roll #${r.rollNumber} · ` : ""}${r.className}`,
    };
  }
  const r = row as StaffListRow;
  const checkInBit = r.checkInAt ? ` · in ${format(parseISO(r.checkInAt), "h:mm a")}` : "";
  return {
    id: r.id,
    fullName: r.fullName,
    email: r.email,
    status: r.status,
    derived: r.derived,
    autoMarkedAbsent: r.autoMarkedAbsent,
    overridden: r.overridden,
    primary: r.fullName,
    secondary: `${r.classCount} class${r.classCount === 1 ? "" : "es"}${checkInBit}`,
  };
```

- [ ] **Step 3: Update `StatusPill` to render the syncing variant**

Replace the existing `StatusPill`:

```tsx
function StatusPill({ status, derived }: { status: string | null; derived?: boolean }) {
  if (!status) {
    return (
      <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide bg-ink-400/15 text-ink-600 dark:text-ink-300">
        Not marked
      </span>
    );
  }
  if (derived) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide",
          STATUS_TONE.absent,
        )}
        title="Cutoff has passed — syncing with server"
      >
        Absent
        <span className="text-[9px] font-normal opacity-70 normal-case">· syncing</span>
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide",
        STATUS_TONE[status] ?? "bg-ink-400/15 text-ink-600",
      )}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}
```

- [ ] **Step 4: Add `RowActions` component (admin/coordinator only) above `AttendanceListPanel`**

```tsx
const STATUS_ACTIONS: { label: string; status: StaffAttendanceStatus | null; icon: React.ReactNode }[] = [
  { label: "Mark Present",  status: "present",  icon: <Check className="h-3.5 w-3.5 mr-2" /> },
  { label: "Mark Late",     status: "late",     icon: <Clock className="h-3.5 w-3.5 mr-2" /> },
  { label: "Mark Absent",   status: "absent",   icon: <X className="h-3.5 w-3.5 mr-2" /> },
  { label: "Mark On Leave", status: "on_leave", icon: <CalendarOff className="h-3.5 w-3.5 mr-2" /> },
  { label: "Clear status",  status: null,       icon: <Eraser className="h-3.5 w-3.5 mr-2" /> },
];

function RowActions({
  staffId,
  institutionId,
  disabled,
}: {
  staffId: string;
  institutionId: string;
  disabled: boolean;
}) {
  const upsert = useUpsertStaffAttendance();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-full"
          onClick={(e) => e.stopPropagation()}
          aria-label="Attendance actions"
          disabled={disabled || upsert.isPending}
        >
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuLabel>Set today's status</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {STATUS_ACTIONS.map((a) => (
          <DropdownMenuItem
            key={a.label}
            onSelect={() =>
              upsert.mutate({ institutionId, staffId, status: a.status })
            }
          >
            {a.icon}
            {a.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 5: Hook actions menu into the row's trailing slot for admin/coordinator on `kind=teachers` or `kind=coordinators`**

Inside `AttendanceListPanel`, add right after the `useState` for search:

```ts
  const { data: roleInfo } = useUserRole();
  const institutionId = useEffectiveInstitutionId(roleInfo?.institutionId ?? null);
  const canManage =
    (roleInfo?.isSchoolAdmin || roleInfo?.isSuperAdmin || roleInfo?.isCoordinator) ?? false;
  const showActions = canManage && (kind === "teachers" || kind === "coordinators") && !!institutionId;
```

Then in the trailing slot of the `<ListRow>` (around line 254), replace:

```tsx
              trailing={
                <div className="flex items-center gap-2">
                  <StatusPill status={r.status} />
                  <ChevronRight className="h-4 w-4 text-ink-400 shrink-0" />
                </div>
              }
```

With:

```tsx
              trailing={
                <div className="flex items-center gap-1.5">
                  <StatusPill status={r.status} derived={r.derived} />
                  {r.overridden && (
                    <span
                      className="hidden sm:inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide bg-ink-400/10 text-ink-500"
                      title="Admin override"
                    >
                      Overridden
                    </span>
                  )}
                  {showActions && (
                    <RowActions
                      staffId={r.id}
                      institutionId={institutionId!}
                      disabled={false}
                    />
                  )}
                  <ChevronRight className="h-4 w-4 text-ink-400 shrink-0" />
                </div>
              }
```

- [ ] **Step 6: Update `useAttendanceCounts` call so derived rows count as absent**

Replace the `counts` computation (around line 208):

```ts
  const counts = useAttendanceCounts(filtered);
```

With:

```ts
  // For the header chips, treat derived "syncing" rows as absent so the
  // count doesn't lie during the brief RPC roundtrip.
  const countableRows = useMemo(
    () => filtered.map((r) => (r.derived ? { ...r, status: "absent" } : r)),
    [filtered],
  );
  const counts = useAttendanceCounts(countableRows);
```

- [ ] **Step 7: Typecheck + lint + build**

```bash
npx tsc --noEmit
npx eslint src/components/attendance/AttendanceListPanel.tsx
npx vite build
```

Expected: all exit 0. Bundle delta should be negligible (no new heavy deps; DropdownMenu/Button are already in the main chunk).

- [ ] **Step 8: Commit**

```bash
git add src/components/attendance/AttendanceListPanel.tsx
git commit -m "feat(attendance): admin per-row action menu + syncing pill

- 'Absent · syncing' pill for client-derived rows past cutoff
- Per-row kebab DropdownMenu for admins/coordinators on teacher +
  coordinator lists: Mark Present / Late / Absent / On Leave / Clear
- Subtle 'Overridden' tag when admin upsert replaced an auto-marked row
- Header counts include derived rows as absent (no count lying)"
```

---

## Task 8: Add §24 invariant to CLAUDE.md

**Files:**
- Modify: `.claude/CLAUDE.md`

- [ ] **Step 1: Append the new section before §23.7 closing (or as a new §24)**

Insert at the bottom of the file:

```markdown
## 24. Attendance Auto-Mark — Institution-Local Timezone (CRITICAL)

`staff_check_in_time` and `staff_check_out_time` are bare `TIME` columns
that store institution-local wall-clock (IST for SALCI). Any code that
compares them to `now()` MUST convert `now()` into the institution's
timezone first via `(now() AT TIME ZONE i.timezone)::time` where `i` is
joined from `institutions`. The default value of `institutions.timezone`
is `'Asia/Kolkata'`.

**The 2026-05-25 bug:** `tt_run_attendance_cron_pass()` used
`(now() AT TIME ZONE 'UTC')::time` — for an IST institution with
`check_in_time = 08:00`, the cron only fired when UTC clock-of-day
passed 08:00 (= 13:30 IST), well after school's done. Auto-mark
was effectively dead for every IST school.

**Live callers:**
- DB: `tt_run_attendance_pass_for_institution(uuid)` (entry point for
  both cron and client RPC). Always uses `(now() AT TIME ZONE v_tz)`.
- Frontend: `isPastCutoff(settings)` in [src/hooks/useStaffAttendance.ts](../src/hooks/useStaffAttendance.ts).
  Compares browser local time to settings. Safe for SALCI today
  (India-only); for a future non-IST school the front-end will need to
  read `institutions.timezone` too.

**Page-view RPC kick.** `SchoolAttendancePage` calls
`tt_run_attendance_pass_for_institution` once per session (per
`institutionId` per date) when an admin/coordinator lands on the page
past local cutoff. Skips the 15-min cron lag. Guarded by `sessionStorage`
key `salci:att-pass:{institutionId}:{YYYY-MM-DD}`. Cron remains the
fallback.

**Auto-mark is decoupled from `staff_substitution_enabled`.** Schools
that don't want auto-subs still need correct attendance. The sub flag
only gates `tt_create_pending_subs_for_absent_staff()`; absence rows are
inserted unconditionally.

**Admin override.** `useUpsertStaffAttendance` upserts any teacher's
row for today (status + optional remarks) with `auto_marked_absent=false`.
Existing trigger `tt_substitutions_cancel_on_late_checkin_trg` cancels
pending subs when status flips to present/late. RLS adds UPDATE/DELETE/
INSERT policies for super_admin / super_school_admin / school_admin /
coordinator.
```

- [ ] **Step 2: Commit**

```bash
git add .claude/CLAUDE.md
git commit -m "docs(claude): §24 attendance auto-mark IST invariant

Locks in the timezone contract so a future agent doesn't reintroduce
the UTC bug. Notes the page-view RPC kick, the sub-flag decoupling,
and the admin override path."
```

---

## Task 9: Production verification

**Files:** none.

- [ ] **Step 1: Manual smoke at 375 px (DevTools or iPhone)**

1. Sign in as `tushar@salci.in` (school admin for Salci National School).
2. Open `/school/attendance`. Verify:
   - Teacher Attendance tab: teachers without check-ins show **Absent** pill (after the kick fires) or **Absent · syncing** for the first ~1s.
   - Substitutions tab: shows pending sub rows for absent teachers' periods today.
   - Header counts no longer say "44 No record" — they show "~36 Absent / ~8 No record" (teachers without slots today have no record).
3. Per-row kebab on a Teacher row → **Mark Present**.
4. Verify the status flips to Present in the list, sub rows for that teacher's later periods disappear from the Substitutions tab.
5. Same teacher → kebab → **Clear status**. Row reverts to "Not marked" (briefly) then back to **Absent** after the next refetch.

- [ ] **Step 2: Dark mode toggle**

The new pill + dropdown items must flip cleanly. If anything stays cream/white, missing `.dark` override per §20a Phase 9.

- [ ] **Step 3: Final build + checks**

```bash
npx tsc --noEmit
npx eslint src/hooks/useRunAttendancePass.ts src/hooks/useStaffAttendance.ts src/hooks/useAttendanceLists.ts src/pages/school/SchoolAttendancePage.tsx src/components/attendance/AttendanceListPanel.tsx
npx vite build
```

Expected: all exit 0.

- [ ] **Step 4: Final commit if any drive-by fixes surfaced**

If steps 1-3 surface no issues, skip. Otherwise fix + commit before declaring done.

---

## Self-Review (planning phase)

- **Spec coverage:**
  - Part A (timezone fix + RPC + sub decoupling + RLS) → Task 1 + Task 2 ✓
  - Part B (instant materialization) → Task 3 (hook) + Task 6 (page wire) + Task 5 (preview) ✓
  - Part C (admin override) → Task 4 (mutation) + Task 7 (UI menu) ✓
- **Placeholder scan:** None — every step has code or a concrete command.
- **Type consistency:** `StaffAttendanceStatus` reused across hooks. `useEffectiveAttendanceSettings` used in both `SchoolAttendancePage` and `useScopedStaffAttendance`. `RPC` payload shape matches Task 1's `RETURNS TABLE` columns.
- **Trigger reuse:** `tt_substitutions_cancel_on_late_checkin_trg` already exists in production (verified by query) and fires on UPDATE OF status — Task 7's UPSERT path benefits without code.
