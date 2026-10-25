# Student Activity Data Export — Design

**Date:** 2026-07-07
**Status:** Approved (design)
**Area:** Admin attendance-reports panel — a new "Download Activity" button in the **Students** view of `AttendanceReports.tsx`, backed by two new `SECURITY DEFINER` RPCs and the multi-sheet xlsx builder from the attendance-reports feature.
**Branch:** builds on `feat/attendance-reports-pagination-export` (same panel, same export infrastructure).

## 1. Problem / goal

Admins want a downloadable per-student activity report: last login, exams taken/submitted, homework submitted, rechecks raised, and an attendance summary — plus a detailed timestamped event log. Today the only per-student "activity" surface is `ViewUserSheet` (single user, client-federates 9 mostly-staff tables) and `useTeacherActivityExport` (staff bulk export). Neither covers students at scale, and no admin student-activity export exists.

## 2. Locked decisions

- **PDF-opens: DEFERRED.** Study-material opens are not tracked anywhere (pure client `window.open()`). Out of scope; a follow-up would add a `material_access_logs` table + open-logging.
- **Olympiad attempts: OUT.** (Separate `oly_students` identity plane; not requested.)
- **Shape: Summary + detailed event log** → a 2-sheet `.xlsx` ("Summary" + "Activity log").
- **Sources:** last login + school exams (always) + homework activity + recheck requests + attendance summary.
- **Approach:** two admin-gated `SECURITY DEFINER` RPCs (server-side aggregation), mirroring `report_student_attendance`. NOT client-side federation (would truncate at PostgREST's 1,000-row cap for 1,500-student schools — §23).
- **Export-only:** no on-screen preview table for activity (the button generates the workbook directly).

## 3. Architecture

### 3.1 Two RPCs (new migration)

Both mirror `report_student_attendance` exactly for the roster/auth/pagination scaffold: resolve `v_inst = COALESCE(p_institution_id, get_user_institution(auth.uid()))`; raise `42501` if not `is_institution_admin(v_uid, v_inst) OR is_super_admin(v_uid)`; student roster = `class_assignments`(role='student') → `profiles`(inst) → `classes`(inst), optional `p_class_id`, `DISTINCT ON (user_id) ORDER BY user_id, class_id`; order by class/section/numeric-roll/name; `row_number()` pagination + `count(*) OVER()` total; grants to `authenticated`.

**A. `report_student_activity(p_from date, p_to date, p_class_id uuid DEFAULT NULL, p_limit int DEFAULT 40, p_offset int DEFAULT 0, p_institution_id uuid DEFAULT NULL)`**
Returns `TABLE(student_id uuid, full_name text, roll_number text, class_name text, last_sign_in_at timestamptz, exams_taken bigint, exams_submitted bigint, homework_submitted bigint, homework_late bigint, rechecks_raised bigint, present_days bigint, absent_days bigint, marked_days bigint, total_count bigint)`.
Per page-row aggregates (scalar subqueries on the student id, all index-backed):
- `last_sign_in_at`: `(SELECT au.last_sign_in_at FROM auth.users au WHERE au.id = sid)`. A `SECURITY DEFINER` function owned by the migration role can read `auth.users` (as `handle_new_user` does). **Fallback if a permission error appears at apply time:** drop the column from the RPC and merge last-login client-side via the existing `get_last_sign_in` edge-function action (chunked by 500), like `useTeacherActivityExport`.
- `exams_taken`: `count(*) FROM student_exam_attempts WHERE student_id=sid AND started_at::date BETWEEN p_from AND p_to`.
- `exams_submitted`: same, `AND is_submitted AND submitted_at::date BETWEEN p_from AND p_to`.
- `homework_submitted`: `count(*) FROM homework_submissions WHERE student_id=sid AND submitted_at::date BETWEEN p_from AND p_to`; `homework_late`: `AND is_late`.
- `rechecks_raised`: `count(*) FROM recheck_requests WHERE requested_by=sid AND requested_at::date BETWEEN p_from AND p_to`.
- `present_days`/`absent_days`/`marked_days`: from `attendance_records WHERE student_id=sid AND date BETWEEN p_from AND p_to`, counting `status='present'`, `status='absent'`, and all rows respectively.

**B. `report_student_activity_events(p_from date, p_to date, p_class_id uuid DEFAULT NULL, p_limit int DEFAULT 1000, p_offset int DEFAULT 0, p_institution_id uuid DEFAULT NULL)`**
Returns `TABLE(student_id uuid, full_name text, roll_number text, class_name text, event_at timestamptz, event_type text, detail text, total_count bigint)`.
Body: same auth + roster CTE (as a set of eligible student ids), then a `UNION ALL` of events joined to the roster, restricted to the range:
- Exam started → `('exam_started', exams.title)` at `started_at` (where `started_at` in range).
- Exam submitted → `('exam_submitted', exams.title)` at `submitted_at` (where `is_submitted` and `submitted_at` in range).
- Homework submitted → `('homework_submitted', homework.title)` at `submitted_at`.
- Recheck requested → `('recheck_requested', exams.title or '')` at `requested_at`.
Ordered by `full_name, event_at`; `row_number()` pagination + `count(*) OVER()` total. (Attendance daily marks and last-login are NOT events — they live in the summary only.)

### 3.2 Export helper (`src/hooks/useStudentActivityExport.ts`)

A new module with:
- `fetchAllStudentActivity(institutionId, from, to, classId)` → loops `report_student_activity` in 1,000-row pages → `StudentActivitySummaryRow[]`.
- `fetchAllStudentActivityEvents(institutionId, from, to, classId)` → loops `report_student_activity_events` in 1,000-row pages → `StudentActivityEventRow[]`.
- `downloadStudentActivityWorkbook({ institutionId, from, to, classId, rangeLabel })`: fetches both, builds a 2-sheet workbook via `downloadAttendanceWorkbookMulti` (from `attendanceReportExport.ts`), filename `student-activity-<scope>-<from>_to_<to>.xlsx`. `toastError` on failure.

**Summary sheet** columns: Roll · Name · Class · Last login (formatted `dd MMM yyyy, HH:mm` or "Never") · Exams taken · Exams submitted · Homework submitted · Homework late · Rechecks · Present · Absent · Attendance % (`present/(present+absent)`, "—" when no marked days).
**Activity log sheet** columns: Roll · Name · Class · When (`dd MMM yyyy, HH:mm`) · Activity (human label: "Exam started"/"Exam submitted"/"Homework submitted"/"Recheck requested") · Detail (title).

### 3.3 Component wiring (`AttendanceReports.tsx`)

A second button beside "Download Excel", shown in **Students** mode: **"Download Activity"** (with an `Activity`/`FileClock` icon), disabled when `!validRange || totalCount === 0 || isExporting || isActivityExporting`. Own `isActivityExporting` state; on click calls `downloadStudentActivityWorkbook({ institutionId, from: fromStr, to: toStr, classId: classId==='all'?null:classId, rangeLabel })`. Reuses the panel's existing From/To + Class + institution (incl. managed-institution).

## 4. Error handling

- RPC auth failures → `toastError` (42501 → friendly). Export wrapped in try/finally with `isActivityExporting` single-flight guard.
- Empty range guarded by the existing `validRange` check. An institution with zero activity still produces a valid (mostly-empty) workbook.
- If `auth.users` proves unreadable by the definer at apply time, take the edge-function fallback (§3.1) — no design change to the sheets, only the last-login source.

## 5. §23 / §19 compliance

- Server-side aggregation; both RPCs admin-gated, institution from `auth.uid()`, paginated + counted, index-backed subqueries; `p_institution_id` secured by the same gate (non-super-admin can't cross tenants).
- Export loops in 1,000-row pages (no client truncation); no `select("*")`; no JWT-less `getUser`; `toastError`; exceljs stays lazy-loaded; no `any`.

## 6. Testing / verification

- **§5a triad:** typecheck / eslint / build clean.
- **RPC live-smoke (prod):** as an impersonated admin on the 1,539-student institution — `report_student_activity` returns correct per-student counts (spot-check one student against raw `student_exam_attempts`/`homework_submissions`/`attendance_records`), `last_sign_in_at` populated where the user has signed in, `total_count` matches roster; `report_student_activity_events` returns ordered events joined to titles; both block a non-admin (42501); super-admin `p_institution_id` impersonation works, cross-tenant blocked. Confirm the definer can read `auth.users.last_sign_in_at` (else switch to the edge-fn fallback).
- **Browser smoke (user):** Students tab → Download Activity → 2-sheet workbook opens; Summary has one row per student with sensible last-login/exam/homework/attendance numbers; Activity log has timestamped events; a single-class filter narrows both; works at 375px (button wraps).

## 7. Files

- **Create:** `supabase/migrations/<ts>_student_activity_rpcs.sql` (both RPCs); `src/hooks/useStudentActivityExport.ts`.
- **Modify:** `src/integrations/supabase/types.ts` (regen); `src/components/attendance/AttendanceReports.tsx` (the Download Activity button + handler).

## 8. Open risks

- `auth.users` readability by the SECURITY DEFINER function — high-confidence yes (precedent: `handle_new_user`), but verified at apply time with the edge-fn fallback ready.
- The event log for a wide range on a large school can be large; it's an admin on-demand export looped in pages, covered by a loading state (acceptable, same as the attendance export).
- Recheck "detail" title depends on the `recheck_requests → attempt → exam` join path; if the direct exam link is absent, `detail` is left blank rather than failing.
