# Late-Removal (Student Attendance) + Student Leave Workflow — Design Spec

Date: 2026-07-06 · Status: approved for planning · Owner: Kavach/Tushar

## 0. Summary

Two coupled changes to student attendance:

**(A)** Remove the `late` status from **student** attendance everywhere — DB value, roster
button, calendar tile, formulas, reports. Staff check-in's own late/grace subsystem is
untouched.

**(B)** Student leave workflow on the existing `leave_requests` table: students apply for
leave (From–To range + reason) from the student Attendance tab; class teachers, wing
coordinators, and admins approve/reject from the staff attendance page; a decision
auto-writes `attendance_records` for every date in the range (**approved = present,
rejected = absent**), retroactively overwriting any existing mark — even days after the
dates passed. Decisions are reversible.

## 1. Locked decisions

| # | Decision | Choice |
|---|---|---|
| 1 | "Late" removal scope | **Student attendance only** (`attendance_records` plane). Staff (`staff_attendance_records`, StaffCheckInCard, classifyStaffCheckIn, AttendanceListPanel "Mark Late") untouched. |
| 2 | Approved leave marks the day as | ~~**`present`**~~ **SUPERSEDED 2026-09-03 → `leave`** (see note below). |
| 3 | Leave date selection | **From–To range** (single day = same date). One request = one contiguous block; "multiple leaves" = multiple requests over time. |
| 4 | Existing `status='late'` rows | **Backfill to `present`** in the same migration that swaps the CHECK. |
| 5 | Where staff see leaves | **Both**: "View Leaves" button in the class-roster header (teacher/admin, class-filtered) **and** a "Leaves" tab on `/school/attendance` for teacher/coordinator/admin (coordinators' only surface). |
| 6 | Decisions reversible? | **Yes** — approved ⇄ rejected any time; every change re-writes the attendance marks for the range. |

> **Decision #2 superseded — 2026-09-03** (migration `20260903120000_teacher_marked_student_leave.sql`).
> Teachers can now mark leave straight from the roster as a third per-row state, which
> needs a status the roster can render and re-read. Approved leave therefore writes
> **`leave`**, a sixth value on `attendance_records_status_check`, and drops out of the
> student-facing `present / (present + absent)` percentage instead of inflating it.
>
> "Zero dashboard-RPC changes" no longer holds, but **no dashboard number moves**: the 15
> `dash_*` attendance ratios and `dash_evaluate_flags` rule A4 were amended in the same
> apply from `IN ('present','late')` to `IN ('present','late','leave')`, which reproduces
> exactly the old behaviour of a leave day stored as `present`. Without the A4 amendment
> every school-granted leave would have read as truancy and auto-raised a flag plus an
> auto-task. Historic `present` + `'Leave approved'` rows are backfilled to `leave`.
>
> Two live bugs in this spec's own workflow were fixed alongside it: the
> `enforce_student_attendance_edit_window` trigger (added 2026-08-11, after this spec) had
> been aborting every leave decision on a future or out-of-window date, and an approval
> stamped `marked_by` with the reviewer, which locked the whole class-day read-only for the
> class teacher. Details in the `timetable-module` skill.

## 2. Part A — remove `late` from student attendance

### 2.1 DB migration

One migration (`*_drop_student_late_status.sql`), applied to prod via
`scripts/run-sql.ps1` (migration ledger is stale — verify via `information_schema`, never
`db push`):

```sql
UPDATE public.attendance_records SET status = 'present' WHERE status = 'late';

ALTER TABLE public.attendance_records
  DROP CONSTRAINT attendance_records_status_check;   -- auto-name of the inline CHECK
ALTER TABLE public.attendance_records
  ADD CONSTRAINT attendance_records_status_check
  CHECK (status IN ('present','absent','sick','casual','holiday'));
```

Backfill-to-present first, or the ADD CONSTRAINT fails on existing rows.
`staff_attendance_records` CHECK (`'present','late','absent','on_leave','holiday'`) is NOT
touched.

### 2.2 Frontend removal surface (student domain only)

| File | Change |
|---|---|
| `src/hooks/useAttendance.ts:7` | `AttendanceStatus` union drops `'late'`. |
| `src/components/attendance/ClassAttendanceMarker.tsx` | Remove the L/"Late" StatusPill (≈249–256), `lateCount` (≈122), the amber "N late" summary chip (≈182–187), doc comment. Roster becomes Present/Absent per row. |
| `src/components/attendance/TeacherClassAttendanceFlow.tsx` | Remove `STATUS_TONE.late` (27), `STATUS_LABEL.late` (35), `counts.late` chip (172–176). |
| `src/components/attendance/attendanceTones.ts` | Drop `late` from `CODE_TONES` / `CODE_LABEL`; `DayAttendanceCode` consumers updated. |
| `src/hooks/useStudentMonthAttendance.ts` | `DayAttendanceCode` drops `'late'`; remove `lateCount`; percentage becomes `present / (present + absent)` (was `(present+late)/(present+late+absent)`). |
| `src/pages/student/StudentAttendancePage.tsx` | Late stat tile removed → 3 tiles (Present / Absent / Attendance %); `chipForStatus`/`labelForStatus` drop late; grid color map drops late. |
| `src/components/attendance/StudentAttendanceWidget.tsx` | Late rendering path removed (uses shared tones). |
| `src/hooks/useAttendanceReports.ts:28,39` | Drop `'late' → 'L'` mapping. |
| `src/hooks/useAttendanceAnalytics.ts:37,44` | `present+late` → `present`. |
| `src/components/.../AttendanceAnalytics.tsx:112` | Remove "Late Arrivals" KPI. |
| `src/hooks/useCommandCenter.ts:169` | Remove `todayLate`. |
| `src/components/attendance/StudentAttendanceCard.tsx:44,46` | Remove late branch. |
| `src/hooks/useAttendanceLists.ts:320` | `counts.late` — VERIFY plane first: this hook powers `AttendanceListPanel` (staff lists). If it aggregates `staff_attendance_records`, leave it untouched; remove only student-plane usage. |
| `src/components/attendance/AttendanceMarker.tsx` | **Delete** — dead code (zero imports), carries the 5-status pill row. |

Dashboard/flag RPCs filtering `ar.status IN ('present','late')` keep working (the `'late'`
arm never matches after backfill) — intentionally NOT churned in this feature.

## 3. Part B — student leave workflow

### 3.1 Data model (reuse `leave_requests`)

Existing table (migration `20260226074822`): `id, institution_id, student_id, class_id,
leave_type CHECK ('sick','personal','family','other') DEFAULT 'personal', start_date,
end_date, reason NOT NULL, status CHECK ('pending','approved','rejected') DEFAULT
'pending', reviewed_by, reviewed_at, reviewer_notes, created_at, updated_at`. Kept as-is
plus, in one new migration:

- **FK indexes** (none exist — §23): `(student_id, created_at DESC)`, `(class_id, status)`,
  `(institution_id, status)`, `(reviewed_by)`.
- **CHECK** `leave_requests_date_order_check`: `end_date >= start_date`.
- Range-length cap (≤ 60 days) enforced in the RPC (not a CHECK, so old rows can't break).

### 3.2 Authorization helper + RLS rewrite

New SECURITY DEFINER helper (STABLE, `search_path=public`):

```
can_review_student_leave(_user uuid, _class uuid, _institution uuid) → boolean
  = is_teacher_for_class(_user,_class)
    OR is_coordinator_for_class(_user,_class)
    OR is_institution_admin(_user,_institution)
    OR is_super_admin(_user)
```

RLS on `leave_requests` (replace the institution-wide staff policies):

- Students (unchanged): SELECT own · INSERT own (`student_id = auth.uid()`) · UPDATE/DELETE
  own while `status='pending'`.
- Staff SELECT: `can_review_student_leave(auth.uid(), class_id, institution_id)` —
  class-scoped teachers, wing-scoped coordinators, institution admins, super admins.
- Staff direct UPDATE: **dropped**. All decisions flow through the RPC (single write path;
  attendance can never drift from a decision).

### 3.3 Decision RPC (the one write path)

`review_student_leave(p_request_id uuid, p_decision text, p_notes text DEFAULT NULL) → jsonb`
— SECURITY DEFINER, `search_path=public,pg_temp`:

1. Load request; `RAISE` if not found. Auth:
   `can_review_student_leave(auth.uid(), class_id, institution_id)` — never authorize via
   COALESCE-on-argument.
2. Validate `p_decision IN ('approved','rejected')`; range ≤ 60 days.
3. `UPDATE leave_requests SET status=p_decision, reviewed_by=auth.uid(),
   reviewed_at=now(), reviewer_notes=p_notes` — allowed from ANY current status
   (pending → decided, approved ⇄ rejected re-decisions).
4. For each date `d` in `[start_date, end_date]`: **skip** if a `cal_events` row
   (`kind='holiday'`, same institution) covers `d`, or an existing attendance row for the
   student/class/date has `status='holiday'`. Otherwise UPSERT `attendance_records`
   `(institution_id, class_id, student_id, date, status, method='manual',
   marked_by=auth.uid(), remarks)` `ON CONFLICT (class_id,student_id,date) DO UPDATE SET
   status, marked_by, remarks, updated_at` — `approved→'present'`, `rejected→'absent'`.
   This gives retroactivity for free (past dates simply get overwritten) and idempotent
   re-decisions.
5. INSERT `notifications` row for the student: type `leave_decision`, title
   "Leave approved"/"Leave rejected", message with the date range + reviewer notes, link
   `/student/attendance`.
6. Return `jsonb: {status, dates_marked, dates_skipped}`.

Known quirk (accepted): a rejected leave that INSERTs a brand-new absent row also fires
the existing `trigger_notify_student_absent` AFTER INSERT trigger → the student may get
both "Marked Absent" and "Leave rejected" notifications. Manual roster re-marking after a
decision wins (it is simply the later write).

### 3.4 Frontend — hooks

New `src/hooks/useStudentLeave.ts` (the dormant `useLeaveRequests.ts` stays untouched —
`useCommandCenter` consumes it; it is dead-scaffolding quality and must not be extended).
All hooks: `useAuth()` context (never JWT-less `getUser`), explicit column lists,
`staleTime: 60_000`, `.range()` pagination, `toastError` on every onError.

- `useMyLeaveRequests(page)` — student's own requests, newest first, paginated.
- `useApplyLeave()` — INSERT (leave_type, start_date, end_date, reason); single-flight via
  `isPending` gate.
- `useCancelLeave()` — DELETE own pending row.
- `useScopedLeaveRequests({ classId?, status?, page })` — staff list; RLS scopes rows;
  paginated; query key includes all filters.
- `usePendingLeaveCount(classId?)` — `{ count, head: true }` server-side count for badges.
- `useReviewLeave()` — calls the RPC; invalidates leave + attendance query keys
  (`['attendance']`, student month/day keys).

### 3.5 Frontend — student UI (`/student/attendance` header)

In `StudentAttendancePage` PageHeader extras (next to year/month nav, the user-marked
spot):

- **"Apply Leave"** button (always visible) → `MobileSheet` form: leave-type Select
  (sick/personal/family/other), From/To date pickers, reason Textarea (required), submit.
  Form sets `data-dirty="true"` while editing (§17 SW contract). The INSERT's `class_id`
  comes from the existing `useStudentClass(academicYear)` hook (current-AY class) and
  `institution_id` from the student's profile — if the student has no class assignment,
  the submit is disabled with a "You're not enrolled in a class yet" hint.
- **"Track Leaves"** button appears to its LEFT once the student has ≥1 request (any
  status) → `MobileSheet` list: Pending/Approved/Rejected status chips, date range,
  reason, reviewer notes, Cancel action on pending rows. Students can apply again at any
  time, including while others are pending.

### 3.6 Frontend — staff UI

- **"View Leaves" button** in the `ClassAttendanceMarker` roster header (the user-marked
  spot), placed OUTSIDE the `lock.canEdit` guard so it never disappears; shows a
  pending-count badge (`usePendingLeaveCount(classId)`); opens a `MobileSheet` listing
  that class's requests with Approve / Reject (+ optional note dialog). Decided rows show
  the decision + a "Change decision" action (re-runs the RPC with the other verdict).
- **"Leaves" tab** on `SchoolAttendancePage` for teacher, coordinator, admin (coordinators'
  only surface — they never see the marking roster). Same list component, all scoped
  classes (RLS enforces server-side), class filter + status filter (default Pending),
  paginated.

Both surfaces share one `LeaveReviewList` component (`src/components/attendance/`), built
on the design-system primitives (EmptyState, status chips, `surface-card`); error state
renders before empty state (§6).

### 3.7 Feature gating & routes

No new routes. All surfaces live inside already-gated pages (`/student/attendance` and
`/school/attendance` are mapped to the `attendance` feature in FEATURE_URL_MAP).

## 4. Non-goals

- Staff late/grace subsystem, `staff_leave_requests` (HR), and staff `on_leave` — untouched.
- Cleaning `('present','late')` filters out of dashboard RPCs — deferred (harmless).
- Leave balances/quotas, overlap prevention across requests, attachment uploads — out of
  scope (YAGNI).
- Migrating `useLeaveRequests.ts` / `LeaveRequestForm.tsx` / `LeaveApprovalPanel.tsx` — the
  new build supersedes them for this flow; old files stay for Command Center until a
  separate cleanup.

## 5. Error handling

- RPC failures surface via `toastError` (never raw Postgres). Preflight, user-friendly
  throws for: range too long (>60 days), reason empty, end before start.
- Staff list: `isError` gate renders BEFORE the empty state.
- Idempotency: apply is single-flight; review RPC is idempotent per (request, decision).

## 6. Testing / verification

- §5a triad on every task: `npm run typecheck`, `npx eslint <files>`, `npx vite build`.
- Migrations applied to prod via `scripts/run-sql.ps1`; verified via `pg_constraint` /
  `pg_proc` / `pg_indexes` queries (ledger is stale).
- Prod backfill verification: `SELECT count(*) FROM attendance_records WHERE
  status='late'` must be 0 after Part A.
- RPC smoke (SQL): approve a seeded pending request spanning a holiday → present rows
  written except the holiday date; flip to rejected → same dates become absent.
- Browser smoke (user): student applies → Track Leaves shows pending → teacher's View
  Leaves badge increments → approve → student calendar shows present on those dates →
  change decision → absent.
