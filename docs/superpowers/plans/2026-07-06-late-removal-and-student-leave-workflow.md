# Late-Removal (Student Attendance) + Student Leave Workflow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the `late` status from student attendance everywhere, and ship a student leave-application + multi-role approval workflow whose decisions retroactively auto-mark attendance (approved=present, rejected=absent).

**Architecture:** Reuse the existing dormant `leave_requests` table. A single SECURITY DEFINER RPC `review_student_leave` is the ONLY write path for a decision — it updates the request, upserts `attendance_records` for every date in the range (skipping holidays), and notifies the student, all in one transaction. Staff direct-UPDATE on `leave_requests` is revoked so attendance can never drift from a decision. New §23/§19-compliant `useStudentLeave` hooks power an Apply/Track pair on the student calendar header and a View-Leaves button + Leaves tab on the staff attendance page, both sharing one `LeaveReviewList`. Part A (`late` removal) is type-driven: dropping `late` from the two student status unions makes `tsc` surface every student-plane site.

**Tech Stack:** React 18 + TS + Vite, TanStack Query v5, Supabase Postgres (RLS + SECURITY DEFINER RPCs), shadcn/ui + custom PageShell design system, date-fns.

**Spec:** `docs/superpowers/specs/2026-07-06-late-removal-and-student-leave-workflow-design.md`

## Global Constraints

- **No unit-test runner exists in this repo.** Per-task verification = the §5a triad: `npm run typecheck` (exit 0), `npx eslint <changed-paths>` (0 errors), `npx vite build` (exit 0). DB tasks additionally: apply via `scripts/run-sql.ps1` and verify with an `information_schema`/`pg_proc`/`pg_indexes` query (the migration ledger is stale — never `supabase db push`).
- **No `any`, no eslint-disable, no `as any`.** `prefer-const` + `@typescript-eslint/no-explicit-any` are hard errors. For Supabase joined rows returning `T | T[]`, use a small inline type + a `pickOne<T>()` helper.
- **§23 scale contract:** every `useQuery` has explicit `staleTime` (≥60_000); every list query is bounded with `.range()`; counts computed server-side (`{ count, head: true }`); never `supabase.auth.getUser()` without a JWT — read from `useAuth()`; every new FK gets an index in the same migration; RLS references SECURITY DEFINER helpers only (no inline cross-table EXISTS).
- **§19 errors:** every `onError`/catch routes through `toastError(err, { fallback, context })` from `@/lib/toast`; `toast.success`/`toast.info` only for non-errors. Never `toast.error(e.message)`.
- **§17 SW dirty-form:** any form with unsaved input sets `data-dirty="true"` on the form element.
- **Design system:** pages wrap in `PageShell`; cards = `surface-card frosted-shadow rounded-card`; text = `text-ink-*`; sheets = `MobileSheet` (NOT Dialog); empty states = `EmptyState`; tabs = `MobileTabs`; error state renders BEFORE empty state; works at 375px; dark mode via tokens (no raw hex except where the existing file already does).
- **Approved leave marks `present`; rejected marks `absent`** (locked decision). Existing `status='late'` rows backfill to `present`.
- **Late removal is student-plane only.** `staff_attendance_records`, `StaffCheckInCard`, `classifyStaffCheckIn`, `AttendanceListPanel` staff "Mark Late" are OUT of scope and must remain working. Superset status maps that also carry `on_leave` (staff) — `TeacherClassAttendanceFlow` `STATUS_TONE`/`STATUS_LABEL`/`counts.late`, `useAttendanceReports` status→letter/label, `useAttendanceLists` `countStatuses` — are LEFT untouched (their `late` entries become dead-but-harmless for students and are still needed for staff).
- Prod project ref `gyymkgohcijeksmrzuyw`.

## File structure

| File | Task | Responsibility |
|---|---|---|
| `supabase/migrations/*_drop_student_late_status.sql` | A1 | backfill late→present + swap `attendance_records` CHECK |
| `src/hooks/useAttendance.ts` · `useStudentMonthAttendance.ts` · `attendanceTones.ts` · `StudentAttendancePage.tsx` · `ClassAttendanceMarker.tsx` · `StudentAttendanceWidget.tsx` | A2 | type-driven student `late` removal |
| `src/components/attendance/AttendanceMarker.tsx` | A2 | DELETE (dead code) |
| `useAttendanceAnalytics.ts` · `AttendanceAnalytics.tsx` · `StudentAttendanceCard.tsx` · `useCommandCenter.ts` | A3 | student-plane peripheral `late` cleanup |
| `supabase/migrations/*_leave_requests_hardening.sql` | B1 | FK indexes + date-order CHECK |
| `supabase/migrations/*_leave_review_helper_and_rls.sql` | B2 | `can_review_student_leave` helper + RLS rewrite |
| `supabase/migrations/*_review_student_leave_rpc.sql` | B3 | the decision RPC |
| `src/hooks/useStudentLeave.ts` | B4 | all leave hooks (new, §23/§19-clean) |
| `src/components/attendance/LeaveStatusChip.tsx` · `LeaveReviewList.tsx` | B5 | shared status chip + list |
| `src/components/attendance/ApplyLeaveSheet.tsx` · `TrackLeavesSheet.tsx` + `StudentAttendancePage.tsx` | B6 | student apply/track |
| `src/components/attendance/ViewLeavesSheet.tsx` · `StaffLeavesTab.tsx` + `ClassAttendanceMarker.tsx` + `SchoolAttendancePage.tsx` | B7 | staff review surfaces |

Execution order: A1 → A2 → A3 → B1 → B2 → B3 → B4 → B5 → B6 → B7. (Part A and Part B are independent; within B, B1–B3 are DB, B4 depends on B3, B5 depends on B4, B6/B7 depend on B4+B5.)

---

## Task A1: Migration — drop `late` from student attendance

**Files:**
- Create: `supabase/migrations/20260706190000_drop_student_late_status.sql`

**Interfaces:**
- Produces: `attendance_records.status` CHECK becomes `('present','absent','sick','casual','holiday')`; zero rows with `status='late'` remain.

- [ ] **Step 1: Write the migration**

```sql
-- Remove the 'late' status from STUDENT attendance (attendance_records only).
-- Staff attendance (staff_attendance_records) is intentionally untouched.

-- 1. Backfill: a past 'late' means the student physically showed up → present.
UPDATE public.attendance_records SET status = 'present' WHERE status = 'late';

-- 2. Swap the inline (auto-named) CHECK constraint.
ALTER TABLE public.attendance_records
  DROP CONSTRAINT attendance_records_status_check;
ALTER TABLE public.attendance_records
  ADD CONSTRAINT attendance_records_status_check
  CHECK (status IN ('present','absent','sick','casual','holiday'));
```

- [ ] **Step 2: Apply to prod + verify** (controller runs `scripts/run-sql.ps1`)

Run the backfill+DDL, then verify:
```sql
SELECT count(*) AS remaining_late FROM public.attendance_records WHERE status = 'late';
SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'attendance_records_status_check';
```
Expected: `remaining_late = 0`; constraint def lists exactly `present, absent, sick, casual, holiday` (no `late`).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260706190000_drop_student_late_status.sql
git commit -m "feat(attendance): drop 'late' status from student attendance_records (backfill->present)"
```

---

## Task A2: Frontend — type-driven student `late` removal

**Files:**
- Modify: `src/hooks/useAttendance.ts:7`
- Modify: `src/hooks/useStudentMonthAttendance.ts` (`DayAttendanceCode`, `lateCount`, percentage)
- Modify: `src/components/attendance/attendanceTones.ts` (`CODE_TONES`, `CODE_LABEL`)
- Modify: `src/pages/student/StudentAttendancePage.tsx` (Late tile, legend, chip/label)
- Modify: `src/components/attendance/ClassAttendanceMarker.tsx` (L pill, `lateCount`, chip, doc)
- Modify: `src/components/attendance/StudentAttendanceWidget.tsx` (any `late` reference)
- Delete: `src/components/attendance/AttendanceMarker.tsx` (dead code, zero imports)

**Interfaces:**
- Produces: `AttendanceStatus = "present" | "absent" | "sick" | "casual" | "holiday"`; `DayAttendanceCode = "present" | "absent" | "sick" | "casual" | "holiday" | "none"`; `StudentMonthAttendance` no longer has `lateCount`; percentage = `present / (present + absent)`.

- [ ] **Step 1: Narrow the two student status unions (the forcing functions)**

In `src/hooks/useAttendance.ts:7`:
```ts
export type AttendanceStatus = "present" | "absent" | "sick" | "casual" | "holiday";
```

In `src/hooks/useStudentMonthAttendance.ts:14`:
```ts
export type DayAttendanceCode = "present" | "absent" | "sick" | "casual" | "holiday" | "none";
```

- [ ] **Step 2: Fix `useStudentMonthAttendance` — drop `lateCount`, redefine percentage**

Remove `lateCount` from the `StudentMonthAttendance` interface (the `lateCount: number;` line), remove its computation (the `let lateCount = 0;` and the `case "late": lateCount++; break;` / any `lateCount++` line), and redefine the percentage so `late` is gone from both numerator and denominator:
```ts
// was: (present + late) / (present + late + absent)
const denom = presentCount + absentCount;
const percentage = denom === 0 ? null : (presentCount / denom) * 100;
```
Ensure the returned object no longer includes `lateCount`.

- [ ] **Step 3: Remove `late` from the shared calendar tones**

In `src/components/attendance/attendanceTones.ts` delete the `late:` line from BOTH `CODE_TONES` and `CODE_LABEL`:
```ts
export const CODE_TONES: Record<DayAttendanceCode, string> = {
  present: "bg-emerald-500/90 text-white dark:bg-emerald-400/90",
  absent:  "bg-rose-500/90 text-white dark:bg-rose-400/90",
  sick:    "bg-violet-500/90 text-white dark:bg-violet-400/90",
  casual:  "bg-violet-500/90 text-white dark:bg-violet-400/90",
  holiday: "bg-sky-500/90 text-white dark:bg-sky-400/90",
  none:    "",
};

export const CODE_LABEL: Record<DayAttendanceCode, string> = {
  present: "Present",
  absent:  "Absent",
  sick:    "Sick leave",
  casual:  "Casual leave",
  holiday: "Holiday",
  none:    "No record",
};
```

- [ ] **Step 4: Student calendar page — drop the Late tile, legend dot, and status maps**

In `src/pages/student/StudentAttendancePage.tsx`:
- Summary grid (currently `cols={2} mdCols={4}` with 4 tiles) → remove the `<StatTile label="Late" .../>` line and change the grid to three tiles:
```tsx
<StatTileGrid cols={3} mdCols={3}>
  <StatTile label="Present" value={month.data?.presentCount ?? 0} tone="mint" />
  <StatTile label="Absent" value={month.data?.absentCount ?? 0} tone="rose" />
  <StatTile label="Attendance"
    value={month.data?.percentage == null ? "—" : `${Math.round(month.data.percentage)}%`}
    tone="teal" />
</StatTileGrid>
```
- Legend (lines ~176–184): delete the `<LegendDot tone="bg-amber-500/90" label="Late" />` line. (Keep the amber `Exam period` dot — that is an event kind, not `late`.)
- `chipForStatus` (line ~286): delete `case "late": return "bg-amber-100 ...";`.
- `labelForStatus` (line ~296): delete `late: "Late",` from the map.

- [ ] **Step 5: Marking roster — remove the L pill, `lateCount`, and the late chip**

In `src/components/attendance/ClassAttendanceMarker.tsx`:
- Line ~122: delete `const lateCount = students?.filter((s) => draft[s.id] === "late").length ?? 0;`.
- Lines ~182–187: delete the `{lateCount > 0 && ( … {lateCount} late … )}` block.
- Lines ~249–256: delete the third `<StatusPill label="L" fullLabel="Late" … status "late" />` entirely (leave the Present and Absent pills).
- Line ~38 doc comment: change "…plus per-row Late." to "…Present/Absent per row.".

- [ ] **Step 6: Fix any remaining typecheck errors from the union narrowing**

Run `npm run typecheck`. Every remaining error is a student-plane `late` reference the narrowing surfaced (e.g. `StudentAttendanceWidget.tsx`, or a `status === "late"` comparison, now TS2367). Fix each by deleting the `late` branch/reference. Do NOT touch files that switch on a plain `string` and carry `on_leave` (those are staff-shared superset maps — Task A3 governs them, and they will NOT error here). If a fix is ambiguous, confirm the file reads `attendance_records` (student) not `staff_attendance_records` (staff) before removing.

- [ ] **Step 7: Delete dead code**

```bash
git rm src/components/attendance/AttendanceMarker.tsx
```
(Grep first to confirm zero imports: `grep -rn "AttendanceMarker" src/ --include=*.tsx --include=*.ts | grep -v ClassAttendanceMarker` returns nothing but the file's own definition.)

- [ ] **Step 8: Verify the §5a triad**

```
npm run typecheck                → exit 0
npx eslint src/hooks/useAttendance.ts src/hooks/useStudentMonthAttendance.ts src/components/attendance/attendanceTones.ts src/pages/student/StudentAttendancePage.tsx src/components/attendance/ClassAttendanceMarker.tsx src/components/attendance/StudentAttendanceWidget.tsx   → 0 errors
npx vite build                   → exit 0
```

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(attendance): remove 'late' from student attendance UI (types, calendar, roster)"
```

---

## Task A3: Peripheral student-plane `late` cleanup

**Files:**
- Modify: `src/hooks/useAttendanceAnalytics.ts:37,44`
- Modify: `src/components/.../AttendanceAnalytics.tsx` ("Late Arrivals" KPI)
- Modify: `src/components/attendance/StudentAttendanceCard.tsx:44,46`
- Modify: `src/hooks/useCommandCenter.ts:169,248` (cleanup)

**Interfaces:**
- Consumes: nothing new. Purely removes now-always-zero `late` displays on student-plane surfaces.

- [ ] **Step 1: `useAttendanceAnalytics` (reads `attendance_records` → student plane)**

Line 37: `const presentCount = (statusCounts["present"] || 0) + (statusCounts["late"] || 0);` → `const presentCount = statusCounts["present"] || 0;`
Line 44: `present: (counts["present"] || 0) + (counts["late"] || 0),` → `present: counts["present"] || 0,`

- [ ] **Step 2: `AttendanceAnalytics.tsx` — remove the "Late Arrivals" KPI**

Delete the KPI tile at line ~112 that renders "Late Arrivals" and any `late`-derived value feeding it. Verify the file reads student analytics (imports `useAttendanceAnalytics`) before editing.

- [ ] **Step 3: `StudentAttendanceCard.tsx` — remove the late branch (lines ~44,46)**

Delete the `late` case/label from this student card's status rendering.

- [ ] **Step 4: `useCommandCenter.ts` — drop `todayLate` (cleanup, not user-visible)**

Line 169: delete `const todayLate = attendanceToday?.statusCounts?.["late"] ?? 0;`.
Line 248: `todayPresent: todayPresent + todayLate,` → `todayPresent,`. (No visible "Late" label exists here; this is tidiness so the removed status isn't summed.)

- [ ] **Step 5: Confirm the LEFT-ALONE superset maps still compile and are documented**

Do NOT edit `useAttendanceReports.ts` (has `on_leave`), `TeacherClassAttendanceFlow.tsx` (`STATUS_TONE`/`STATUS_LABEL`/`counts.late`, has `on_leave`), or `useAttendanceLists.ts` `countStatuses` (serves `staff_attendance_records` too). Their `late` entries are dead-but-harmless for students (no student row is `late` after A1) and still power staff rows. Add a one-line comment at each `late` entry there: `// student rows are never 'late' post-2026-07; kept for the staff plane`.

- [ ] **Step 6: Verify + commit**

```
npm run typecheck → exit 0
npx eslint <the four changed files above> → 0 errors
npx vite build → exit 0
git commit -am "feat(attendance): remove student-plane 'late' displays (analytics KPI, cards, command-center)"
```

---

## Task B1: Migration — `leave_requests` hardening

**Files:**
- Create: `supabase/migrations/20260706191000_leave_requests_hardening.sql`

**Interfaces:**
- Produces: four FK indexes + `leave_requests_date_order_check` CHECK on the existing `leave_requests` table.

- [ ] **Step 1: Pre-check no existing row violates the date order** (controller, via `run-sql.ps1`)

```sql
SELECT count(*) FROM public.leave_requests WHERE end_date < start_date;
```
Expected 0. If >0, fix those rows first (they are data errors) before adding the CHECK.

- [ ] **Step 2: Write the migration**

```sql
-- §23: index every FK on leave_requests (none existed).
CREATE INDEX IF NOT EXISTS idx_leave_requests_student_created
  ON public.leave_requests (student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leave_requests_class_status
  ON public.leave_requests (class_id, status);
CREATE INDEX IF NOT EXISTS idx_leave_requests_institution_status
  ON public.leave_requests (institution_id, status);
CREATE INDEX IF NOT EXISTS idx_leave_requests_reviewed_by
  ON public.leave_requests (reviewed_by);

-- Integrity: end_date must not precede start_date.
ALTER TABLE public.leave_requests
  ADD CONSTRAINT leave_requests_date_order_check CHECK (end_date >= start_date);
```

- [ ] **Step 3: Apply + verify**

```sql
SELECT indexname FROM pg_indexes WHERE tablename = 'leave_requests' ORDER BY indexname;
SELECT conname FROM pg_constraint WHERE conname = 'leave_requests_date_order_check';
```
Expected: the four new indexes present; the CHECK present.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260706191000_leave_requests_hardening.sql
git commit -m "feat(leave): index leave_requests FKs + date-order check"
```

---

## Task B2: Migration — `can_review_student_leave` helper + RLS rewrite

**Files:**
- Create: `supabase/migrations/20260706192000_leave_review_helper_and_rls.sql`

**Interfaces:**
- Consumes: existing helpers `is_teacher_for_class(uuid,uuid)`, `is_coordinator_for_class(uuid,uuid)`, `is_institution_admin(uuid,uuid)`, `is_super_admin(uuid)`.
- Produces: `can_review_student_leave(_user uuid, _class uuid, _institution uuid) → boolean` (SECURITY DEFINER); `leave_requests` staff SELECT is class/wing/institution-scoped; staff direct UPDATE is REMOVED.

- [ ] **Step 1: Write the migration**

```sql
-- Per-row authorization helper: may this staff user act on a leave for this class?
CREATE OR REPLACE FUNCTION public.can_review_student_leave(
  _user uuid, _class uuid, _institution uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.is_teacher_for_class(_user, _class)
      OR public.is_coordinator_for_class(_user, _class)
      OR public.is_institution_admin(_user, _institution)
      OR public.is_super_admin(_user);
$$;

-- Replace the institution-wide staff policies with scoped ones.
DROP POLICY IF EXISTS "Teachers and admins can view leave requests in their institution" ON public.leave_requests;
DROP POLICY IF EXISTS "Admins can view all leave requests in institution" ON public.leave_requests;
DROP POLICY IF EXISTS "Teachers and admins can review leave requests" ON public.leave_requests;

-- Scoped SELECT for reviewers (class teacher / wing coordinator / admin / super).
CREATE POLICY "Staff view scoped student leaves"
  ON public.leave_requests FOR SELECT
  USING (public.can_review_student_leave(auth.uid(), class_id, institution_id));

-- No staff UPDATE policy: all decisions flow through review_student_leave (SECURITY
-- DEFINER, bypasses RLS). Student create/view/update-own-pending/delete-own-pending
-- policies from 20260226074822 are left intact.
```

- [ ] **Step 2: Apply + verify**

```sql
SELECT proname FROM pg_proc WHERE proname = 'can_review_student_leave';
SELECT policyname, cmd FROM pg_policies WHERE tablename = 'leave_requests' ORDER BY policyname;
```
Expected: helper exists; policies list shows the 4 student policies + "Staff view scoped student leaves" (SELECT) and NO staff UPDATE policy.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260706192000_leave_review_helper_and_rls.sql
git commit -m "feat(leave): can_review_student_leave helper + class-scoped RLS (RPC-only decisions)"
```

---

## Task B3: Migration — `review_student_leave` RPC (the decision engine)

**Files:**
- Create: `supabase/migrations/20260706193000_review_student_leave_rpc.sql`

**Interfaces:**
- Consumes: `can_review_student_leave`, `leave_requests`, `attendance_records` (UNIQUE `class_id,student_id,date`), `cal_events`, `notifications`.
- Produces: `review_student_leave(p_request_id uuid, p_decision text, p_notes text DEFAULT NULL) → jsonb` returning `{status, dates_marked, dates_skipped}`.

- [ ] **Step 1: Write the RPC**

```sql
CREATE OR REPLACE FUNCTION public.review_student_leave(
  p_request_id uuid,
  p_decision text,
  p_notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_req public.leave_requests%ROWTYPE;
  v_status text;
  v_date date;
  v_marked int := 0;
  v_skipped int := 0;
  v_is_off boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_decision NOT IN ('approved','rejected') THEN
    RAISE EXCEPTION 'Invalid decision: %', p_decision USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_req FROM public.leave_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Leave request not found' USING ERRCODE = 'P0002';
  END IF;

  -- Authorize on the request's OWN class/institution (never via a caller arg).
  IF NOT public.can_review_student_leave(v_uid, v_req.class_id, v_req.institution_id) THEN
    RAISE EXCEPTION 'Not authorized to review this leave request' USING ERRCODE = '42501';
  END IF;

  IF (v_req.end_date - v_req.start_date) > 60 THEN
    RAISE EXCEPTION 'Leave range exceeds 60 days' USING ERRCODE = '22023';
  END IF;

  UPDATE public.leave_requests
     SET status = p_decision, reviewed_by = v_uid, reviewed_at = now(),
         reviewer_notes = p_notes, updated_at = now()
   WHERE id = p_request_id;

  v_status := CASE WHEN p_decision = 'approved' THEN 'present' ELSE 'absent' END;

  v_date := v_req.start_date;
  WHILE v_date <= v_req.end_date LOOP
    -- Skip if the date is a school holiday (calendar) or already marked holiday.
    SELECT
      EXISTS (SELECT 1 FROM public.cal_events ce
              WHERE ce.institution_id = v_req.institution_id AND ce.kind = 'holiday'
                AND v_date BETWEEN ce.starts_on AND ce.ends_on)
      OR EXISTS (SELECT 1 FROM public.attendance_records ar
              WHERE ar.class_id = v_req.class_id AND ar.student_id = v_req.student_id
                AND ar.date = v_date AND ar.status = 'holiday')
      INTO v_is_off;

    IF v_is_off THEN
      v_skipped := v_skipped + 1;
    ELSE
      INSERT INTO public.attendance_records
        (institution_id, class_id, student_id, date, status, method, marked_by, remarks)
      VALUES
        (v_req.institution_id, v_req.class_id, v_req.student_id, v_date, v_status,
         'manual', v_uid,
         CASE WHEN p_decision = 'approved' THEN 'Leave approved' ELSE 'Leave rejected' END)
      ON CONFLICT (class_id, student_id, date) DO UPDATE
        SET status = EXCLUDED.status, marked_by = EXCLUDED.marked_by,
            remarks = EXCLUDED.remarks, updated_at = now();
      v_marked := v_marked + 1;
    END IF;
    v_date := v_date + 1;
  END LOOP;

  INSERT INTO public.notifications (user_id, type, title, message, link, metadata)
  VALUES (
    v_req.student_id,
    'leave_decision',
    CASE WHEN p_decision = 'approved' THEN 'Leave approved' ELSE 'Leave rejected' END,
    'Your leave from ' || v_req.start_date::text || ' to ' || v_req.end_date::text
      || CASE WHEN p_decision = 'approved' THEN ' was approved.' ELSE ' was rejected.' END
      || COALESCE(' Note: ' || NULLIF(p_notes, ''), ''),
    '/student/attendance',
    jsonb_build_object('leave_request_id', v_req.id, 'decision', p_decision)
  );

  RETURN jsonb_build_object('status', p_decision, 'dates_marked', v_marked, 'dates_skipped', v_skipped);
END;
$$;

REVOKE ALL ON FUNCTION public.review_student_leave(uuid, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.review_student_leave(uuid, text, text) TO authenticated;
```

- [ ] **Step 2: Apply + SQL smoke** (controller, via `run-sql.ps1`)

Verify existence and a dry logic check against a seeded pending request (pick any real pending row or insert a throwaway one in a transaction and ROLLBACK):
```sql
SELECT proname, prosecdef FROM pg_proc WHERE proname = 'review_student_leave';  -- prosecdef = true
```
Smoke (in a `BEGIN … ROLLBACK` block so prod data is untouched): approve a request spanning a known holiday date and assert `dates_marked` excludes the holiday and `attendance_records` got `present` rows; then call again with `'rejected'` and assert the same dates flip to `absent`. Record the returned jsonb in the report.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260706193000_review_student_leave_rpc.sql
git commit -m "feat(leave): review_student_leave RPC — retroactive attendance auto-mark + notify"
```

---

## Task B4: `useStudentLeave.ts` hooks

**Files:**
- Create: `src/hooks/useStudentLeave.ts`

**Interfaces:**
- Consumes: `review_student_leave` RPC; `leave_requests` table; `useAuth()`.
- Produces: `LeaveStatus`, `LeaveType`, `LeaveRequestRow`, `ScopedLeaveRow`; hooks `useMyLeaveRequests(page)`, `useApplyLeave()`, `useCancelLeave()`, `useScopedLeaveRequests({classId?, status?, page})`, `usePendingLeaveCount(classId?)`, `useReviewLeave()`. Page size const `LEAVE_PAGE_SIZE = 20`.

- [ ] **Step 1: Write the hooks file**

```ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { toastError } from "@/lib/toast";

export type LeaveStatus = "pending" | "approved" | "rejected";
export type LeaveType = "sick" | "personal" | "family" | "other";

export const LEAVE_PAGE_SIZE = 20;

const LEAVE_COLS =
  "id, student_id, class_id, institution_id, leave_type, start_date, end_date, reason, status, reviewed_by, reviewed_at, reviewer_notes, created_at";

export interface LeaveRequestRow {
  id: string;
  student_id: string;
  class_id: string;
  institution_id: string;
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
  reason: string;
  status: LeaveStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  reviewer_notes: string | null;
  created_at: string;
}

export interface ScopedLeaveRow extends LeaveRequestRow {
  studentName: string | null;
  studentRoll: string | null;
  className: string | null;
  classSection: string | null;
}

function pickOne<T>(v: T | T[] | null): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

/** The signed-in student's own leave requests, newest first, paginated. */
export function useMyLeaveRequests(page = 0) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my-leave-requests", user?.id, page],
    enabled: !!user?.id,
    staleTime: 60_000,
    queryFn: async (): Promise<LeaveRequestRow[]> => {
      if (!user?.id) return [];
      const from = page * LEAVE_PAGE_SIZE;
      const { data, error } = await supabase
        .from("leave_requests")
        .select(LEAVE_COLS)
        .eq("student_id", user.id)
        .order("created_at", { ascending: false })
        .range(from, from + LEAVE_PAGE_SIZE - 1);
      if (error) throw error;
      return (data ?? []) as LeaveRequestRow[];
    },
  });
}

/** Apply for leave. class_id / institution_id are passed in from the caller. */
export function useApplyLeave() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      class_id: string;
      institution_id: string;
      leave_type: LeaveType;
      start_date: string;
      end_date: string;
      reason: string;
    }) => {
      if (!user?.id) throw new Error("You must be signed in to apply for leave.");
      const { error } = await supabase.from("leave_requests").insert({
        student_id: user.id,
        class_id: input.class_id,
        institution_id: input.institution_id,
        leave_type: input.leave_type,
        start_date: input.start_date,
        end_date: input.end_date,
        reason: input.reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-leave-requests"] });
      toast.success("Leave request submitted");
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't submit your leave request.", context: "applyLeave" }),
  });
}

/** Withdraw one of the student's own PENDING requests. */
export function useCancelLeave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("leave_requests").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-leave-requests"] });
      toast.success("Leave request withdrawn");
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't withdraw the request.", context: "cancelLeave" }),
  });
}

/** Staff-scoped leave list (RLS filters to the reviewer's classes/wing/institution). */
export function useScopedLeaveRequests(opts: { classId?: string | null; status?: LeaveStatus | "all"; page?: number }) {
  const { user } = useAuth();
  const page = opts.page ?? 0;
  const status = opts.status ?? "pending";
  const classId = opts.classId ?? null;
  return useQuery({
    queryKey: ["scoped-leave-requests", user?.id, classId, status, page],
    enabled: !!user?.id,
    staleTime: 60_000,
    queryFn: async (): Promise<ScopedLeaveRow[]> => {
      const from = page * LEAVE_PAGE_SIZE;
      let q = supabase
        .from("leave_requests")
        .select(
          `${LEAVE_COLS}, student:profiles!leave_requests_student_id_fkey(full_name, roll_number), class:classes!leave_requests_class_id_fkey(name, section)`,
        )
        .order("created_at", { ascending: false })
        .range(from, from + LEAVE_PAGE_SIZE - 1);
      if (classId) q = q.eq("class_id", classId);
      if (status !== "all") q = q.eq("status", status);
      const { data, error } = await q;
      if (error) throw error;
      type Joined = LeaveRequestRow & {
        student: { full_name: string | null; roll_number: string | null } | { full_name: string | null; roll_number: string | null }[] | null;
        class: { name: string | null; section: string | null } | { name: string | null; section: string | null }[] | null;
      };
      return ((data ?? []) as unknown as Joined[]).map((r) => {
        const s = pickOne(r.student);
        const c = pickOne(r.class);
        return {
          ...r,
          studentName: s?.full_name ?? null,
          studentRoll: s?.roll_number ?? null,
          className: c?.name ?? null,
          classSection: c?.section ?? null,
        } as ScopedLeaveRow;
      });
    },
  });
}

/** Server-side pending count for badges (never fetch rows to count them). */
export function usePendingLeaveCount(classId?: string | null) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["pending-leave-count", user?.id, classId ?? "all"],
    enabled: !!user?.id,
    staleTime: 60_000,
    queryFn: async (): Promise<number> => {
      let q = supabase
        .from("leave_requests")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending");
      if (classId) q = q.eq("class_id", classId);
      const { count, error } = await q;
      if (error) throw error;
      return count ?? 0;
    },
  });
}

/** Approve/reject via the single-write-path RPC. */
export function useReviewLeave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { requestId: string; decision: "approved" | "rejected"; notes?: string }) => {
      const { error } = await supabase.rpc("review_student_leave", {
        p_request_id: input.requestId,
        p_decision: input.decision,
        p_notes: input.notes ?? null,
      });
      if (error) throw error;
    },
    onSuccess: (_d, input) => {
      qc.invalidateQueries({ queryKey: ["scoped-leave-requests"] });
      qc.invalidateQueries({ queryKey: ["pending-leave-count"] });
      qc.invalidateQueries({ queryKey: ["attendance"] });
      qc.invalidateQueries({ queryKey: ["student-month-attendance"] });
      qc.invalidateQueries({ queryKey: ["student-day-attendance"] });
      toast.success(input.decision === "approved" ? "Leave approved" : "Leave rejected");
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't update the leave request.", context: "reviewLeave" }),
  });
}
```

- [ ] **Step 2: Verify**

```
npm run typecheck → exit 0   (if the join alias `profiles!leave_requests_student_id_fkey` mis-types, adjust the embed hint to the actual FK constraint name from types.ts and re-run)
npx eslint src/hooks/useStudentLeave.ts → 0 errors
npx vite build → exit 0
```

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useStudentLeave.ts
git commit -m "feat(leave): §23/§19-compliant useStudentLeave hooks"
```

---

## Task B5: Shared `LeaveStatusChip` + `LeaveReviewList`

**Files:**
- Create: `src/components/attendance/LeaveStatusChip.tsx`
- Create: `src/components/attendance/LeaveReviewList.tsx`

**Interfaces:**
- Consumes: `LeaveRequestRow`/`ScopedLeaveRow`, `LeaveStatus` from `useStudentLeave`.
- Produces: `<LeaveStatusChip status />`; `<LeaveReviewList rows variant onApprove? onReject? onCancel? busyId? />` where `variant: "student" | "staff"`.

- [ ] **Step 1: `LeaveStatusChip.tsx`**

```tsx
import { cn } from "@/lib/utils";
import type { LeaveStatus } from "@/hooks/useStudentLeave";

const TONE: Record<LeaveStatus, string> = {
  pending:  "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
  approved: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
  rejected: "bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300",
};
const LABEL: Record<LeaveStatus, string> = { pending: "Pending", approved: "Approved", rejected: "Rejected" };

export function LeaveStatusChip({ status }: { status: LeaveStatus }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold", TONE[status])}>
      {LABEL[status]}
    </span>
  );
}
```

- [ ] **Step 2: `LeaveReviewList.tsx`**

```tsx
import { format } from "date-fns";
import { CalendarDays, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/surfaces";
import { LeaveStatusChip } from "@/components/attendance/LeaveStatusChip";
import type { LeaveRequestRow, ScopedLeaveRow } from "@/hooks/useStudentLeave";

const TYPE_LABEL: Record<string, string> = { sick: "Sick", personal: "Personal", family: "Family", other: "Other" };

function fmtRange(start: string, end: string): string {
  const s = new Date(`${start}T00:00:00`);
  const e = new Date(`${end}T00:00:00`);
  if (start === end) return format(s, "d MMM yyyy");
  return `${format(s, "d MMM")} – ${format(e, "d MMM yyyy")}`;
}

export function LeaveReviewList({
  rows, variant, onApprove, onReject, onCancel, busyId, emptyLabel,
}: {
  rows: (LeaveRequestRow | ScopedLeaveRow)[];
  variant: "student" | "staff";
  onApprove?: (id: string) => void;
  onReject?: (id: string) => void;
  onCancel?: (id: string) => void;
  busyId?: string | null;
  emptyLabel?: string;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState size="sm" icon={<CalendarDays className="h-4 w-4" />}
        title={emptyLabel ?? "No leave requests"}
        description={variant === "student" ? "Your leave requests will appear here." : "No requests to review right now."} />
    );
  }
  return (
    <ul className="space-y-2">
      {rows.map((r) => {
        const scoped = "studentName" in r ? (r as ScopedLeaveRow) : null;
        const busy = busyId === r.id;
        return (
          <li key={r.id} className="surface-card frosted-shadow rounded-card p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {scoped && (
                  <p className="text-sm font-medium text-ink-900 truncate">
                    {scoped.studentName ?? "Student"}
                    {scoped.studentRoll ? <span className="text-ink-500 font-normal"> · Roll {scoped.studentRoll}</span> : null}
                  </p>
                )}
                <p className="text-sm text-ink-800">{fmtRange(r.start_date, r.end_date)}</p>
                <p className="text-xs text-ink-500">{TYPE_LABEL[r.leave_type] ?? r.leave_type} leave</p>
              </div>
              <LeaveStatusChip status={r.status} />
            </div>
            <p className="mt-1.5 text-xs text-ink-600 whitespace-pre-wrap">{r.reason}</p>
            {r.reviewer_notes && (
              <p className="mt-1 text-xs text-ink-500 italic">Reviewer: “{r.reviewer_notes}”</p>
            )}

            {variant === "staff" && (onApprove || onReject) && (
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="outline" disabled={busy} onClick={() => onApprove?.(r.id)} className="rounded-full">
                  <Check className="h-3.5 w-3.5 mr-1 text-emerald-700" /> {r.status === "approved" ? "Approved" : "Approve"}
                </Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => onReject?.(r.id)} className="rounded-full">
                  <X className="h-3.5 w-3.5 mr-1 text-rose-700" /> {r.status === "rejected" ? "Rejected" : "Reject"}
                </Button>
              </div>
            )}
            {variant === "student" && r.status === "pending" && onCancel && (
              <div className="mt-2">
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => onCancel(r.id)} className="text-ink-500">
                  Withdraw
                </Button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 3: Verify + commit**

```
npm run typecheck → 0 · npx eslint <both files> → 0 · npx vite build → 0
git add src/components/attendance/LeaveStatusChip.tsx src/components/attendance/LeaveReviewList.tsx
git commit -m "feat(leave): shared LeaveStatusChip + LeaveReviewList"
```

---

## Task B6: Student Apply-Leave + Track-Leaves surfaces

**Files:**
- Create: `src/components/attendance/ApplyLeaveSheet.tsx`
- Create: `src/components/attendance/TrackLeavesSheet.tsx`
- Modify: `src/pages/student/StudentAttendancePage.tsx` (action row in the success branch, above the summary grid)

**Interfaces:**
- Consumes: `useApplyLeave`, `useMyLeaveRequests`, `useCancelLeave`, `LeaveReviewList`, `MobileSheet`; `useStudentClass(academicYear)` (already imported on the page) → `{ classId }`; institution id via `useEffectiveInstitutionId`.
- Produces: `<ApplyLeaveSheet open onOpenChange classId institutionId />`; `<TrackLeavesSheet open onOpenChange />`.

- [ ] **Step 1: `ApplyLeaveSheet.tsx`**

```tsx
import { useState } from "react";
import { CalendarPlus } from "lucide-react";
import { MobileSheet } from "@/components/shared/sheets";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useApplyLeave, type LeaveType } from "@/hooks/useStudentLeave";

const TODAY = () => new Date().toISOString().slice(0, 10);

export function ApplyLeaveSheet({
  open, onOpenChange, classId, institutionId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  classId: string | null;
  institutionId: string | null;
}) {
  const apply = useApplyLeave();
  const [leaveType, setLeaveType] = useState<LeaveType>("personal");
  const [startDate, setStartDate] = useState(TODAY);
  const [endDate, setEndDate] = useState(TODAY);
  const [reason, setReason] = useState("");

  const rangeDays =
    (new Date(`${endDate}T00:00:00`).getTime() - new Date(`${startDate}T00:00:00`).getTime()) / 86_400_000;
  const tooLong = rangeDays > 60;
  const canSubmit =
    !!classId && !!institutionId && reason.trim().length > 0 && startDate <= endDate && !tooLong && !apply.isPending;

  const submit = () => {
    if (!canSubmit || !classId || !institutionId) return;
    apply.mutate(
      { class_id: classId, institution_id: institutionId, leave_type: leaveType, start_date: startDate, end_date: endDate, reason: reason.trim() },
      { onSuccess: () => { setReason(""); onOpenChange(false); } },
    );
  };

  return (
    <MobileSheet
      open={open} onOpenChange={onOpenChange}
      title="Apply for leave" subtitle="Request time off — your teacher will review it."
      icon={<CalendarPlus className="h-4 w-4" />}
      primaryAction={{ label: "Submit request", onClick: submit, loading: apply.isPending, disabled: !canSubmit }}
      secondaryAction={{ label: "Cancel", onClick: () => onOpenChange(false) }}
    >
      <form data-dirty={reason.trim().length > 0 ? "true" : undefined} className="space-y-4">
        {!classId && (
          <p className="text-xs text-rose-600">You're not enrolled in a class yet — ask your admin.</p>
        )}
        {tooLong && (
          <p className="text-xs text-rose-600">Leave range can't exceed 60 days.</p>
        )}
        <div className="space-y-1.5">
          <Label>Leave type</Label>
          <Select value={leaveType} onValueChange={(v) => setLeaveType(v as LeaveType)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="sick">Sick</SelectItem>
              <SelectItem value="personal">Personal</SelectItem>
              <SelectItem value="family">Family</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>From</Label>
            <Input type="date" value={startDate} min={TODAY()} onChange={(e) => { setStartDate(e.target.value); if (e.target.value > endDate) setEndDate(e.target.value); }} />
          </div>
          <div className="space-y-1.5">
            <Label>To</Label>
            <Input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Reason</Label>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why do you need leave?" rows={3} />
        </div>
      </form>
    </MobileSheet>
  );
}
```

- [ ] **Step 2: `TrackLeavesSheet.tsx`**

```tsx
import { ClipboardList, CalendarX2 } from "lucide-react";
import { MobileSheet } from "@/components/shared/sheets";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/surfaces";
import { LeaveReviewList } from "@/components/attendance/LeaveReviewList";
import { useMyLeaveRequests, useCancelLeave } from "@/hooks/useStudentLeave";

export function TrackLeavesSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const list = useMyLeaveRequests(0);
  const cancel = useCancelLeave();
  return (
    <MobileSheet open={open} onOpenChange={onOpenChange} title="Your leave requests"
      subtitle="Track approval status." icon={<ClipboardList className="h-4 w-4" />}>
      {list.isLoading ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 rounded-card" />)}</div>
      ) : list.isError ? (
        <EmptyState size="sm" tone="rose" icon={<CalendarX2 className="h-4 w-4" />} title="Couldn't load your requests" description="Please try again in a moment." />
      ) : (
        <LeaveReviewList rows={list.data ?? []} variant="student"
          onCancel={(id) => cancel.mutate(id)} busyId={cancel.isPending ? cancel.variables ?? null : null} />
      )}
    </MobileSheet>
  );
}
```

- [ ] **Step 3: Wire the action row into `StudentAttendancePage.tsx`**

Add imports near the existing imports:
```tsx
import { CalendarPlus, ClipboardList } from "lucide-react";   // merge into the existing lucide import line
import { useUserRole } from "@/hooks/useUserRole";
import { useEffectiveInstitutionId } from "@/contexts/InstitutionContext";
import { ApplyLeaveSheet } from "@/components/attendance/ApplyLeaveSheet";
import { TrackLeavesSheet } from "@/components/attendance/TrackLeavesSheet";
import { useMyLeaveRequests } from "@/hooks/useStudentLeave";
```
Inside the component, after the existing hooks (institution resolved via the same role-context pattern the rest of the app uses — NOT `useEffectiveInstitutionId(null)`, which would return null for a plain student and break the NOT-NULL `institution_id` insert):
```tsx
const { data: roleInfo } = useUserRole();
const institutionId = useEffectiveInstitutionId(roleInfo?.institutionId ?? null);
const myLeaves = useMyLeaveRequests(0);
const hasLeaves = (myLeaves.data?.length ?? 0) > 0;
const [applyOpen, setApplyOpen] = useState(false);
const [trackOpen, setTrackOpen] = useState(false);
```
In the success branch (the `<div className="space-y-4">` that holds the summary), add this as the FIRST child, above `<StatTileGrid>`:
```tsx
<div className="flex justify-end gap-2">
  {hasLeaves && (
    <Button variant="outline" size="sm" className="rounded-full" onClick={() => setTrackOpen(true)}>
      <ClipboardList className="h-3.5 w-3.5 mr-1.5" /> Track Leaves
    </Button>
  )}
  <Button size="sm" className="rounded-full bg-brand-primary text-white hover:bg-brand-primary/90" onClick={() => setApplyOpen(true)}>
    <CalendarPlus className="h-3.5 w-3.5 mr-1.5" /> Apply Leave
  </Button>
</div>
```
At the end of the component JSX (before `</PageShell>`), mount the sheets:
```tsx
<ApplyLeaveSheet open={applyOpen} onOpenChange={setApplyOpen}
  classId={studentClass.data?.classId ?? null} institutionId={institutionId} />
<TrackLeavesSheet open={trackOpen} onOpenChange={setTrackOpen} />
```

- [ ] **Step 4: Verify + commit**

```
npm run typecheck → 0 · npx eslint src/components/attendance/ApplyLeaveSheet.tsx src/components/attendance/TrackLeavesSheet.tsx src/pages/student/StudentAttendancePage.tsx → 0 · npx vite build → 0
git add -A && git commit -m "feat(leave): student Apply Leave + Track Leaves on the attendance tab"
```

---

## Task B7: Staff View-Leaves button + Leaves tab

**Files:**
- Create: `src/components/attendance/ViewLeavesSheet.tsx`
- Create: `src/components/attendance/StaffLeavesTab.tsx`
- Modify: `src/components/attendance/ClassAttendanceMarker.tsx` (header: View Leaves button + badge)
- Modify: `src/pages/school/SchoolAttendancePage.tsx` (add "Leaves" tab for teacher/coordinator/admin)

**Interfaces:**
- Consumes: `useScopedLeaveRequests`, `usePendingLeaveCount`, `useReviewLeave`, `LeaveReviewList`, `MobileSheet`, `useScopedAttendanceClasses`.
- Produces: `<ViewLeavesSheet open onOpenChange classId className? />`; `<StaffLeavesTab />`.

- [ ] **Step 1: `ViewLeavesSheet.tsx` (class-scoped review, used from the roster header)**

```tsx
import { useState } from "react";
import { ClipboardCheck, CalendarX2 } from "lucide-react";
import { MobileSheet } from "@/components/shared/sheets";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/surfaces";
import { LeaveReviewList } from "@/components/attendance/LeaveReviewList";
import { useScopedLeaveRequests, useReviewLeave, type LeaveStatus } from "@/hooks/useStudentLeave";
import { MobileTabs } from "@/components/shared/nav";

const FILTERS: { value: LeaveStatus | "all"; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];

export function ViewLeavesSheet({
  open, onOpenChange, classId, className,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  classId: string;
  className?: string;
}) {
  const [status, setStatus] = useState<LeaveStatus | "all">("pending");
  const list = useScopedLeaveRequests({ classId, status, page: 0 });
  const review = useReviewLeave();
  const act = (id: string, decision: "approved" | "rejected") => review.mutate({ requestId: id, decision });

  return (
    <MobileSheet open={open} onOpenChange={onOpenChange} title="Leave requests"
      subtitle={className} icon={<ClipboardCheck className="h-4 w-4" />}>
      <div className="mb-3">
        <MobileTabs value={status} onValueChange={(v) => setStatus(v as LeaveStatus | "all")}
          options={FILTERS.map((f) => ({ value: f.value, label: f.label }))} />
      </div>
      {list.isLoading ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 rounded-card" />)}</div>
      ) : list.isError ? (
        <EmptyState size="sm" tone="rose" icon={<CalendarX2 className="h-4 w-4" />} title="Couldn't load leave requests" description="Please try again in a moment." />
      ) : (
        <LeaveReviewList rows={list.data ?? []} variant="staff"
          onApprove={(id) => act(id, "approved")} onReject={(id) => act(id, "rejected")}
          busyId={review.isPending ? review.variables?.requestId ?? null : null} />
      )}
    </MobileSheet>
  );
}
```

- [ ] **Step 2: `StaffLeavesTab.tsx` (all scoped classes, for the attendance page tab)**

```tsx
import { useState } from "react";
import { CalendarX2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/surfaces";
import { MobileTabs } from "@/components/shared/nav";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LeaveReviewList } from "@/components/attendance/LeaveReviewList";
import { useScopedLeaveRequests, useReviewLeave, type LeaveStatus } from "@/hooks/useStudentLeave";
import { useScopedAttendanceClasses } from "@/hooks/useClassAttendance";
import { formatClassName } from "@/lib/utils";

const FILTERS: { value: LeaveStatus | "all"; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All" },
];

export function StaffLeavesTab() {
  const [status, setStatus] = useState<LeaveStatus | "all">("pending");
  const [classId, setClassId] = useState<string>("all");
  const { data: classes } = useScopedAttendanceClasses();
  const list = useScopedLeaveRequests({ classId: classId === "all" ? null : classId, status, page: 0 });
  const review = useReviewLeave();
  const act = (id: string, decision: "approved" | "rejected") => review.mutate({ requestId: id, decision });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <MobileTabs value={status} onValueChange={(v) => setStatus(v as LeaveStatus | "all")}
          options={FILTERS.map((f) => ({ value: f.value, label: f.label }))} />
        <Select value={classId} onValueChange={setClassId}>
          <SelectTrigger className="h-9 w-[180px]"><SelectValue placeholder="All classes" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All classes</SelectItem>
            {(classes ?? []).map((c) => (
              <SelectItem key={c.id} value={c.id}>{formatClassName(c.name, c.section)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {list.isLoading ? (
        <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-card" />)}</div>
      ) : list.isError ? (
        <EmptyState tone="rose" icon={<CalendarX2 className="h-5 w-5" />} title="Couldn't load leave requests" description="Please try again in a moment." />
      ) : (
        <LeaveReviewList rows={list.data ?? []} variant="staff"
          onApprove={(id) => act(id, "approved")} onReject={(id) => act(id, "rejected")}
          busyId={review.isPending ? review.variables?.requestId ?? null : null}
          emptyLabel="No leave requests" />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Add the View-Leaves button to the roster header**

In `src/components/attendance/ClassAttendanceMarker.tsx`:
- Add imports: `import { useState } from "react";` (extend the existing `useEffect, useMemo, useState` import) is already present; add `import { CalendarCheck } from "lucide-react";` to the lucide import, `import { ViewLeavesSheet } from "@/components/attendance/ViewLeavesSheet";`, and `import { usePendingLeaveCount } from "@/hooks/useStudentLeave";`.
- Add state + count near the other hooks:
```tsx
const [leavesOpen, setLeavesOpen] = useState(false);
const pendingLeaves = usePendingLeaveCount(classId);
```
- In the "Bulk actions + summary" flex row (line ~170), place the button on the RIGHT side but OUTSIDE the `lock.canEdit` guard so it never disappears. Replace the existing right-hand block:
```tsx
<div className="flex items-center gap-2">
  <Button size="sm" variant="outline" className="rounded-full relative" onClick={() => setLeavesOpen(true)}>
    <CalendarCheck className="h-3.5 w-3.5 mr-1" /> View Leaves
    {(pendingLeaves.data ?? 0) > 0 && (
      <span className="ml-1 inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-brand-secondary text-white text-[10px] font-semibold">
        {pendingLeaves.data}
      </span>
    )}
  </Button>
  {lock.canEdit && (
    <>
      <Button size="sm" variant="outline" onClick={() => markAll("present")} className="rounded-full">
        <Check className="h-3.5 w-3.5 mr-1 text-emerald-700" /> All Present
      </Button>
      <Button size="sm" variant="outline" onClick={() => markAll("absent")} className="rounded-full">
        <X className="h-3.5 w-3.5 mr-1 text-rose-700" /> All Absent
      </Button>
    </>
  )}
</div>
```
- Before the final closing `</div>` of the component, mount:
```tsx
<ViewLeavesSheet open={leavesOpen} onOpenChange={setLeavesOpen} classId={classId}
  className={cls ? formatClassName(cls.name, cls.section) : undefined} />
```

- [ ] **Step 4: Add the "Leaves" tab to `SchoolAttendancePage.tsx`**

Add import: `import { StaffLeavesTab } from "@/components/attendance/StaffLeavesTab";` and a `ClipboardList` icon from lucide. In the `tabs` useMemo, after the coordinator/admin "Class Attendance" block (and available to teachers too), add — visible to teacher OR coordinator OR admin:
```tsx
if (isTeacher || isCoordinator || isAdmin) {
  list.push({
    value: "leaves",
    label: "Leaves",
    icon: <ClipboardList className="h-3.5 w-3.5" />,
    render: () => <StaffLeavesTab />,
  });
}
```
Place it after the existing `class-attendance` pushes so ordering reads Mark → My → Class → Leaves → … . Ensure `isTeacher`/`isCoordinator`/`isAdmin` are already in the useMemo dep array (they are: `[isTeacher, isStudent, isAdmin, isCoordinator]`).

- [ ] **Step 5: Verify + commit**

```
npm run typecheck → 0
npx eslint src/components/attendance/ViewLeavesSheet.tsx src/components/attendance/StaffLeavesTab.tsx src/components/attendance/ClassAttendanceMarker.tsx src/pages/school/SchoolAttendancePage.tsx → 0
npx vite build → 0
git add -A && git commit -m "feat(leave): staff View Leaves button + Leaves tab with approve/reject"
```

---

## Final verification (after all tasks)

- Full §5a triad clean on `main`-diff.
- Prod: `SELECT count(*) FROM attendance_records WHERE status='late'` = 0; `review_student_leave`, `can_review_student_leave` exist; leave RLS = 4 student policies + 1 staff SELECT, no staff UPDATE; 4 leave FK indexes.
- Browser smoke (user): student Apply Leave (spanning a holiday) → Track Leaves shows Pending → teacher's View Leaves badge = 1 → Approve → student calendar shows Present on those dates except the holiday → change to Reject → those dates flip to Absent → student gets a notification. Confirm no "Late" appears anywhere in student attendance (roster, calendar, analytics).
