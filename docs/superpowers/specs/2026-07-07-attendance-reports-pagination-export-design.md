# Attendance Reports — Pagination + Per-Class Export — Design

**Date:** 2026-07-07
**Status:** Approved (design)
**Area:** Admin attendance reports — `AttendanceReports.tsx`, `useAttendanceReports.ts`, `attendanceReportExport.ts` (rendered in the `/school/attendance` **Reports** tab, admin-only).

## 1. Problem

The Attendance Reports panel (staff/student per-day pivot) has three gaps:

1. **On-screen list is truncated to 25 rows** with a "download for the rest" footer — no way to page through the remaining people on screen.
2. **The Excel export is a single flat sheet** — all students mixed together, not organized by class.
3. **Pre-existing correctness bug (must fix):** the data fetch is unbounded. Per repo §23, PostgREST silently caps at **1,000 rows**. The records query (`attendance_records WHERE student_id IN (roster) AND date BETWEEN from AND to`) returns one row per (student, day-with-a-record); for any school beyond ~30–40 students over a month, it exceeds 1,000 and is **silently truncated**, so both the on-screen table and the Excel export show many students as blank/no-record when they actually have attendance. This makes the current report untrustworthy at real scale.

## 2. Goals / Non-goals

**Goals**
- On-screen: show the **top 40** rows with **page-based pagination** (Prev / Next + "Page X of Y") for both Staff and Students.
- Excel export is **complete** (every person, no truncation) and, for students, has **one sheet per class** plus an **"All students"** sheet; a single-class selection exports just that class's sheet. Staff export stays a **single "Staff" sheet**.
- Fix the truncation bug structurally by aggregating server-side.
- Zero new TypeScript/lint/build errors; §23/§19 compliant.

**Non-goals**
- No change to the attendance *marking* flow or the underlying tables.
- No new attendance statuses; the code legend (P/A/L/O/H) is unchanged.
- No CSV path changes (the existing `buildCsv`/`downloadCsv` helpers stay for any other caller; this feature uses the xlsx path).

## 3. Locked decisions

- **Pagination style:** page-based (Prev/Next + page indicator), 40 rows/page. Only the current page renders (bounded DOM for the wide date-grid).
- **Student export:** per-class tabs **+ a combined "All students" tab** when "All classes" is selected; a single class → that one tab.
- **Staff export:** single "Staff" sheet (staff aren't class-scoped). On-screen still paginates.
- **Approach:** server-side aggregation RPCs (best for users + database; §23-correct).

## 4. Architecture

### 4.1 Data layer — two `SECURITY DEFINER` RPCs (new migration)

Both aggregate the pivot in Postgres and return one row per person, paginated with a total count. Both resolve the institution from `auth.uid()` and are admin-gated (never trust a client-supplied institution).

**`report_student_attendance(p_from date, p_to date, p_class_id uuid, p_limit int, p_offset int)`**
Returns `TABLE(student_id uuid, full_name text, roll_number text, class_id uuid, class_name text, by_date jsonb, total_count bigint)`.
- Auth: `v_uid = auth.uid()` (raise if null); `v_inst = get_user_institution(v_uid)` (raise if null); require `is_institution_admin(v_uid, v_inst) OR is_super_admin(v_uid)` (raise `42501` otherwise).
- Roster: `class_assignments` (role='student') → `profiles` (same institution) → `classes` (same institution), optional `p_class_id` filter. `DISTINCT ON (user_id)` (first assignment wins, matching current "first wins" behavior).
- Order: `class_name`, `section NULLS FIRST`, numeric roll (`NULLIF(regexp_replace(coalesce(roll_number,''),'\D','','g'),'')::int NULLS LAST`), `roll_number`, `full_name`.
- `total_count = count(*) OVER()` over the full ordered roster.
- Page: `LIMIT p_limit OFFSET p_offset`.
- Per page-row `by_date`: aggregate the student's records **by date across the range, NOT class-scoped** (matches current behavior, which merges a student's records regardless of `class_id`). To avoid a duplicate-key edge (a student with two records on the same date under different classes — allowed by `UNIQUE(class_id,student_id,date)`), dedupe deterministically per date:
  `COALESCE((SELECT jsonb_object_agg(d, s) FROM (SELECT DISTINCT ON (ar.date) ar.date::text AS d, ar.status AS s FROM attendance_records ar WHERE ar.student_id = <sid> AND ar.date BETWEEN p_from AND p_to ORDER BY ar.date, ar.class_id) t), '{}'::jsonb)` — index-backed by `idx_attendance_records_student_date`. The `class_id`/`class_name` columns still reflect the student's `DISTINCT ON` primary class (for the class column + per-class export grouping).
- `class_name` = `name` + (` - ` + `section`) when section present.

**`report_staff_attendance(p_from date, p_to date, p_limit int, p_offset int)`**
Returns `TABLE(staff_id uuid, full_name text, role text, by_date jsonb, total_count bigint)`.
- Same auth gate.
- Roster: `user_roles` role IN ('teacher','coordinator') → `profiles` (same institution); `DISTINCT ON (user_id)` (first role wins, as today). Order by `full_name`.
- `by_date`: `jsonb_object_agg(date, status)` from `staff_attendance_records` (`WHERE staff_id = <sid> AND institution_id = v_inst AND date BETWEEN p_from AND p_to`), index-backed by the table's `UNIQUE(staff_id, date)`.

Grants: `REVOKE ALL … FROM public; GRANT EXECUTE … TO authenticated` (the RPC self-gates admin).

**Holidays:** the RPCs return **raw statuses only**. The frontend overlays holiday days as `H` (it already fetches the holiday set via `useHolidaysInRange`) and maps status→code — keeping the RPCs focused and reusing the existing `toStaffStatusCode` / `toStudentStatusCode` + holiday logic.

**Pagination note:** `LIMIT/OFFSET` (not keyset) is used deliberately — the roster is bounded (students/staff per institution), the report is admin-only + on-demand, and page-jump + a total count are required (keyset supports neither). A justification comment records this per §23.

### 4.2 Frontend hooks (`useAttendanceReports.ts` rewired)

- `useStudentAttendanceReport(institutionId, from, to, classId, page, holidays)` → calls `report_student_attendance` with `limit = PAGE_SIZE (40)`, `offset = page * 40`. Returns `{ rows: StudentReportRow[], totalCount: number }`. Maps each `by_date` status→`ReportStatusCode` and overlays holidays across the full date range (as today).
- `useStaffAttendanceReport(institutionId, from, to, page, holidays)` → same shape via `report_staff_attendance`.
- Both: `staleTime: 60_000`, `enabled` gated on inputs, typed RPC call (regen `types.ts` after the migration), errors thrown (component renders error state) — never JWT-less `getUser`.
- **Export path:** an async function `fetchAllStudentReportRows(...)` / `fetchAllStaffReportRows(...)` (or a single generic) that loops the RPC with `limit = 1000, offset += 1000` until a page returns `< 1000` rows, accumulating all rows + applying status→code + holiday overlay. Called on Download only (not on mount).

### 4.3 On-screen component (`AttendanceReports.tsx`)

- Add `page` state per mode; **reset to 0** whenever `from`, `to`, `classId`, or `mode` changes.
- The preview table renders the current page's rows (≤40). Below it: **Prev / Next** buttons + **"Page X of Y"** (`Y = max(1, ceil(totalCount / 40))`); Prev disabled on page 0, Next disabled on the last page. The header row-count line uses `totalCount`.
- Loading, empty (error-before-empty per §6), and 375px behavior preserved. Legend unchanged.

### 4.4 Excel export (`attendanceReportExport.ts` extended)

- Add a **multi-sheet** builder `downloadAttendanceWorkbookMulti({ sheets: AttendanceExportSheet[], filename })`, where `AttendanceExportSheet = { sheetName, title, subtitle, columns, rows }` — reusing the existing per-sheet styling (frozen header band, brand fill, autofilter, sized columns). The current single-sheet `downloadAttendanceWorkbook` is kept (or re-expressed as a one-element call) so no other caller breaks.
- **Sheet-name safety:** a `safeSheetName(name, usedSet)` helper truncates to 31 chars, strips `: \ / ? * [ ]`, and de-duplicates (`… (2)`), since class names routinely exceed Excel's limits.
- **Student "All classes":** group the complete rows by `class_id` (ordered as the roster is) into one sheet each, then append an **"All students"** sheet with everyone. Single class → one sheet. **Staff:** one "Staff" sheet.

## 5. Error handling

- RPC auth failures surface via `toastError` (translated 42501 → friendly). The component keeps error-state-before-empty-state.
- Export wraps the fetch-all loop + workbook build in try/finally with `toastError` on failure and an `isExporting` guard (single-flight).
- Empty range / invalid date range keeps the existing "From must be ≤ To" guard.

## 6. §23 / §19 compliance

- Server-side aggregation (no raw-row pivot on the client); paginated + counted; index-backed subqueries; admin-gated `SECURITY DEFINER` resolving institution from `auth.uid()`.
- Every `useQuery` has explicit `staleTime`; RPC typed (no `any`); all `onError`/catch via `toastError`; no JWT-less `getUser`; no `select("*")`.
- exceljs stays lazy-loaded (dynamic `import`).

## 7. Testing / verification

- **§5a triad:** `npm run typecheck`, `npx eslint <changed>`, `npx vite build` — all clean.
- **RPC live-smoke (prod, read-only + a throwaway-free path):** call `report_student_attendance` / `report_staff_attendance` as an impersonated admin (JWT-claims GUC) for a real institution/range and assert: correct row shape, `total_count` matches a direct roster count, `by_date` matches sampled `attendance_records`, pagination (`limit/offset`) returns disjoint pages, and a non-admin caller is blocked (42501).
- **Browser smoke (user):** Staff + Students tabs paginate (Prev/Next, page indicator); "All classes" export opens a workbook with one tab per class + an "All students" tab; single-class export has one tab; staff export is one sheet; holiday columns show H; a school with >1,000 attendance records shows complete data (truncation gone).

## 8. Files

- **Create:** `supabase/migrations/<ts>_attendance_report_rpcs.sql` (both RPCs).
- **Modify:** `src/integrations/supabase/types.ts` (regen), `src/hooks/useAttendanceReports.ts` (RPC-backed paginated hooks + fetch-all export helpers), `src/components/attendance/AttendanceReports.tsx` (pagination controls + per-class multi-sheet export), `src/lib/attendanceReportExport.ts` (multi-sheet builder + `safeSheetName`).

## 9. Open risks

- Very large single-class export (e.g. 3,000 students in one range) loops the RPC a few times — acceptable for an admin on-demand export; a loading state covers it.
- `DISTINCT ON (user_id)` means a multi-class student appears once (first class) — matches current behavior; documented, not changed here.
