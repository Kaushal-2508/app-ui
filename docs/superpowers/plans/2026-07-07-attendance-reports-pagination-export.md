# Attendance Reports — Pagination + Per-Class Export — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the admin Attendance Reports panel show a paginated (top-40 + Prev/Next) on-screen list and export a complete, per-class multi-sheet Excel — backed by server-side aggregation RPCs that fix the current 1,000-row truncation.

**Architecture:** Two admin-gated `SECURITY DEFINER` RPCs pivot attendance in Postgres (one `by_date` jsonb per person + `total_count` + `LIMIT/OFFSET`). The frontend hooks call them per page; the Excel export loops them to completion and groups students into per-class sheets. exceljs stays lazy-loaded.

**Tech Stack:** React 18 + TS + Vite, TanStack Query v5, Supabase Postgres (RLS + SECURITY DEFINER RPCs), exceljs, date-fns.

**Spec:** `docs/superpowers/specs/2026-07-07-attendance-reports-pagination-export-design.md`

## Global Constraints

- **No unit-test runner.** Per-task verification = §5a triad: `npm run typecheck` (exit 0), `npx eslint <changed-paths>` (0 errors), `npx vite build` (exit 0). DB task additionally: apply via `scripts/run-sql.ps1` + verify via `pg_proc`/live smoke (migration ledger is stale — never `supabase db push`).
- **No `any`, no eslint-disable, no `as any`.** `prefer-const` + `@typescript-eslint/no-explicit-any` are hard errors. For Supabase `Json`/joined values, cast via a narrow structural type or `unknown` + narrow — never `any`.
- **§23:** every `useQuery` has explicit `staleTime` (≥60_000); server-side aggregation (no raw-row client pivot); RPCs are `SECURITY DEFINER`, resolve institution from `auth.uid()`, admin-gated; `LIMIT/OFFSET` on a bounded admin on-demand report is allowed with a justification comment; no JWT-less `getUser`; no `select("*")`.
- **§19:** every `onError`/catch routes through `toastError(err, { fallback, context })`; `toast.success` only for successes.
- **Design system:** works at 375px; error state renders before empty state; tokens only.
- Prod project ref `gyymkgohcijeksmrzuyw`. Page size = **40**. Export fetch page = **1000**.
- Helper signatures (verified): `get_user_institution(_user_id uuid)→uuid`, `is_institution_admin(_user_id uuid,_institution_id uuid)→bool`, `is_super_admin(user_id uuid)→bool`.

## File structure

| File | Task | Responsibility |
|---|---|---|
| `supabase/migrations/20260707120000_attendance_report_rpcs.sql` | T1 | the two aggregation RPCs |
| `src/integrations/supabase/types.ts` | T2 | regen (adds the 2 RPCs) |
| `src/hooks/useAttendanceReports.ts` | T3 | RPC-backed paginated hooks `{rows,totalCount}` + fetch-all export helpers |
| `src/lib/attendanceReportExport.ts` | T4 | multi-sheet workbook builder + `safeSheetName` |
| `src/components/attendance/AttendanceReports.tsx` | T5 | pagination controls + per-class multi-sheet export wiring |

Order: T1 → T2 → T3 → T4 → T5.

---

## Task 1: Migration — the two aggregation RPCs

**Files:**
- Create: `supabase/migrations/20260707120000_attendance_report_rpcs.sql`

**Interfaces:**
- Produces: `report_student_attendance(p_from date, p_to date, p_class_id uuid, p_limit int, p_offset int)` → `TABLE(student_id uuid, full_name text, roll_number text, class_id uuid, class_name text, by_date jsonb, total_count bigint)`; `report_staff_attendance(p_from date, p_to date, p_limit int, p_offset int)` → `TABLE(staff_id uuid, full_name text, role text, by_date jsonb, total_count bigint)`. Both admin-gated, EXECUTE granted to `authenticated`.

- [ ] **Step 1: Write the migration**

```sql
-- Admin-only, server-side attendance-report pivots. Each returns one row per
-- person with a by_date jsonb (date -> raw status) + a windowed total_count,
-- paginated by LIMIT/OFFSET. Institution is resolved from auth.uid(); never
-- trusted from a client argument.

CREATE OR REPLACE FUNCTION public.report_student_attendance(
  p_from date,
  p_to date,
  p_class_id uuid DEFAULT NULL,
  p_limit int DEFAULT 40,
  p_offset int DEFAULT 0
) RETURNS TABLE (
  student_id uuid,
  full_name text,
  roll_number text,
  class_id uuid,
  class_name text,
  by_date jsonb,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_inst uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  v_inst := public.get_user_institution(v_uid);
  IF v_inst IS NULL THEN
    RAISE EXCEPTION 'No institution for user' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.is_institution_admin(v_uid, v_inst) OR public.is_super_admin(v_uid)) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH roster AS (
    SELECT DISTINCT ON (ca.user_id)
      ca.user_id AS sid,
      p.full_name AS fname,
      p.roll_number AS roll,
      c.id AS cid,
      c.name AS cname,
      c.section AS csection
    FROM public.class_assignments ca
    JOIN public.profiles p ON p.id = ca.user_id AND p.institution_id = v_inst
    JOIN public.classes c ON c.id = ca.class_id AND c.institution_id = v_inst
    WHERE ca.role = 'student'
      AND (p_class_id IS NULL OR ca.class_id = p_class_id)
    ORDER BY ca.user_id
  ),
  ranked AS (
    SELECT
      r.*,
      count(*) OVER() AS total,
      row_number() OVER (ORDER BY
        r.cname,
        r.csection NULLS FIRST,
        NULLIF(regexp_replace(COALESCE(r.roll, ''), '\D', '', 'g'), '')::int NULLS LAST,
        r.roll,
        r.fname
      ) AS rn
    FROM roster r
  )
  SELECT
    ranked.sid,
    ranked.fname,
    ranked.roll::text,  -- profiles.roll_number is varchar; RETURNS TABLE declares text
    ranked.cid,
    CASE WHEN ranked.csection IS NOT NULL AND ranked.csection <> ''
      THEN ranked.cname || ' - ' || ranked.csection
      ELSE ranked.cname END,
    COALESCE((
      SELECT jsonb_object_agg(t.d, t.s)
      FROM (
        SELECT DISTINCT ON (ar.date) ar.date::text AS d, ar.status AS s
        FROM public.attendance_records ar
        WHERE ar.student_id = ranked.sid
          AND ar.date BETWEEN p_from AND p_to
        ORDER BY ar.date, ar.class_id
      ) t
    ), '{}'::jsonb),
    ranked.total
  FROM ranked
  WHERE ranked.rn > p_offset AND ranked.rn <= p_offset + p_limit
  ORDER BY ranked.rn;
END;
$$;

CREATE OR REPLACE FUNCTION public.report_staff_attendance(
  p_from date,
  p_to date,
  p_limit int DEFAULT 40,
  p_offset int DEFAULT 0
) RETURNS TABLE (
  staff_id uuid,
  full_name text,
  role text,
  by_date jsonb,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_inst uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  v_inst := public.get_user_institution(v_uid);
  IF v_inst IS NULL THEN
    RAISE EXCEPTION 'No institution for user' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.is_institution_admin(v_uid, v_inst) OR public.is_super_admin(v_uid)) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH roster AS (
    SELECT DISTINCT ON (ur.user_id)
      ur.user_id AS sid,
      p.full_name AS fname,
      ur.role::text AS srole
    FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id AND p.institution_id = v_inst
    WHERE ur.role IN ('teacher', 'coordinator')
    ORDER BY ur.user_id, ur.role
  ),
  ranked AS (
    SELECT
      r.*,
      count(*) OVER() AS total,
      row_number() OVER (ORDER BY r.fname) AS rn
    FROM roster r
  )
  SELECT
    ranked.sid,
    ranked.fname,
    ranked.srole,
    COALESCE((
      SELECT jsonb_object_agg(sar.date::text, sar.status)
      FROM public.staff_attendance_records sar
      WHERE sar.staff_id = ranked.sid
        AND sar.institution_id = v_inst
        AND sar.date BETWEEN p_from AND p_to
    ), '{}'::jsonb),
    ranked.total
  FROM ranked
  WHERE ranked.rn > p_offset AND ranked.rn <= p_offset + p_limit
  ORDER BY ranked.rn;
END;
$$;

REVOKE ALL ON FUNCTION public.report_student_attendance(date, date, uuid, int, int) FROM public;
GRANT EXECUTE ON FUNCTION public.report_student_attendance(date, date, uuid, int, int) TO authenticated;
REVOKE ALL ON FUNCTION public.report_staff_attendance(date, date, int, int) FROM public;
GRANT EXECUTE ON FUNCTION public.report_staff_attendance(date, date, int, int) TO authenticated;
```

- [ ] **Step 2: Apply to prod + live smoke** (controller, via `scripts/run-sql.ps1`)

Apply the migration, then verify existence + behavior:
```sql
SELECT proname, prosecdef FROM pg_proc WHERE proname IN ('report_student_attendance','report_staff_attendance');
```
Expected: both present, `prosecdef = true`.

Live smoke (impersonate a real admin via the JWT-claims GUC — same pattern the leave RPC used; read-only, no writes so no cleanup needed): find an `(admin_id, institution_id)` where the admin is `school_admin`; then
```sql
SELECT set_config('request.jwt.claims','{"sub":"<admin_id>","role":"authenticated"}', false);
SELECT student_id, full_name, class_name, by_date, total_count
FROM public.report_student_attendance('<from>','<to>', NULL, 5, 0);
```
Assert: rows come back, `total_count` equals a direct roster count
`SELECT count(DISTINCT ca.user_id) FROM class_assignments ca JOIN profiles p ON p.id=ca.user_id AND p.institution_id='<inst>' JOIN classes c ON c.id=ca.class_id AND c.institution_id='<inst>' WHERE ca.role='student';`
`by_date` matches sampled `attendance_records` for a student; `offset 5` returns the next disjoint page. Repeat a 2-row check for `report_staff_attendance`. Finally confirm a NON-admin caller is blocked: set jwt sub to a student id and call → expect ERROR (HTTP 400). Record results in the report.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260707120000_attendance_report_rpcs.sql
git commit -m "feat(reports): server-side attendance-report pivot RPCs (student + staff, paginated)"
```

---

## Task 2: Regenerate Supabase types

**Files:**
- Modify: `src/integrations/supabase/types.ts`

**Interfaces:**
- Produces: typed `report_student_attendance` / `report_staff_attendance` in the generated `Database["public"]["Functions"]`, so `supabase.rpc(...)` typechecks without casts.

- [ ] **Step 1: Regenerate from prod** (controller)

```
npx supabase gen types typescript --project-id gyymkgohcijeksmrzuyw --schema public > src/integrations/supabase/types.ts
```
Confirm the diff contains `report_student_attendance` + `report_staff_attendance` and is otherwise bounded (no unrelated churn — if a large unrelated diff appears, STOP and flag it: main may have drifted).

- [ ] **Step 2: Verify + commit**

```
npm run typecheck  → exit 0
git add src/integrations/supabase/types.ts
git commit -m "chore(types): regen Supabase types for attendance-report RPCs"
```

---

## Task 3: RPC-backed paginated hooks + fetch-all export helpers

**Files:**
- Modify: `src/hooks/useAttendanceReports.ts`

**Interfaces:**
- Consumes: `report_student_attendance` / `report_staff_attendance` RPCs; `StudentReportRow` gains a `classId` field.
- Produces:
  - `REPORT_PAGE_SIZE = 40`.
  - `StudentReportRow = { studentId, fullName, rollNumber, classId, className, byDate }`.
  - `useStudentAttendanceReport(institutionId, from, to, classId, page, holidays)` → `{ rows: StudentReportRow[], totalCount: number }`.
  - `useStaffAttendanceReport(institutionId, from, to, page, holidays)` → `{ rows: StaffReportRow[], totalCount: number }`.
  - `fetchAllStudentReportRows(from, to, classId, holidays)` → `Promise<StudentReportRow[]>`.
  - `fetchAllStaffReportRows(from, to, holidays)` → `Promise<StaffReportRow[]>`.
  - `toStaffStatusCode` / `toStudentStatusCode` / `useHolidaysInRange` unchanged (kept). `buildCsv`/`downloadCsv`/`csvField` unchanged.

- [ ] **Step 1: Replace the two report hooks + add the export helpers**

Keep the top imports, `ReportStatusCode`, `StaffReportRow`, the two `toXStatusCode` functions, and `useHolidaysInRange` as they are. Add `classId` to `StudentReportRow`. Replace `useStaffAttendanceReport` and `useStudentAttendanceReport` (the two big `useQuery` hooks) with the RPC-backed versions below, and add the shared helpers + fetch-all functions. Leave `csvField`/`buildCsv`/`downloadCsv` at the bottom untouched.

```ts
import { useQuery } from "@tanstack/react-query";
import { format, eachDayOfInterval, parseISO } from "date-fns";

import { supabase } from "@/integrations/supabase/client";

export const REPORT_PAGE_SIZE = 40;

export type ReportStatusCode = "P" | "A" | "L" | "O" | "H" | "";

export interface StaffReportRow {
  staffId: string;
  fullName: string;
  role: "teacher" | "coordinator" | "school_admin" | "super_school_admin" | string;
  byDate: Record<string, ReportStatusCode>;
}

export interface StudentReportRow {
  studentId: string;
  fullName: string;
  rollNumber: string | null;
  classId: string;
  className: string;
  byDate: Record<string, ReportStatusCode>;
}

const ymd = (d: Date) => format(d, "yyyy-MM-dd");

// (keep toStaffStatusCode + toStudentStatusCode exactly as they are)

// (keep useHolidaysInRange exactly as it is)

// ── shared mapping: raw RPC by_date + holidays -> per-day ReportStatusCode ──
function datesInRange(from: string, to: string): string[] {
  return eachDayOfInterval({ start: parseISO(from), end: parseISO(to) }).map(ymd);
}

function overlay(
  raw: Record<string, string>,
  allDates: string[],
  holidays: Set<string>,
  toCode: (s: string) => ReportStatusCode,
): Record<string, ReportStatusCode> {
  const out: Record<string, ReportStatusCode> = {};
  allDates.forEach((d) => {
    if (holidays.has(d)) out[d] = "H"; // holiday wins over any record (as before)
    else out[d] = raw[d] ? toCode(raw[d]) : "";
  });
  return out;
}

type StudentRpcRow = {
  student_id: string;
  full_name: string;
  roll_number: string | null;
  class_id: string;
  class_name: string;
  by_date: Record<string, string> | null;
  total_count: number | string;
};
type StaffRpcRow = {
  staff_id: string;
  full_name: string;
  role: string;
  by_date: Record<string, string> | null;
  total_count: number | string;
};

function mapStudentRows(data: StudentRpcRow[], from: string, to: string, holidays: Set<string>): StudentReportRow[] {
  const allDates = datesInRange(from, to);
  return data.map((r) => ({
    studentId: r.student_id,
    fullName: r.full_name,
    rollNumber: r.roll_number,
    classId: r.class_id,
    className: r.class_name,
    byDate: overlay(r.by_date ?? {}, allDates, holidays, toStudentStatusCode),
  }));
}
function mapStaffRows(data: StaffRpcRow[], from: string, to: string, holidays: Set<string>): StaffReportRow[] {
  const allDates = datesInRange(from, to);
  return data.map((r) => ({
    staffId: r.staff_id,
    fullName: r.full_name,
    role: r.role,
    byDate: overlay(r.by_date ?? {}, allDates, holidays, toStaffStatusCode),
  }));
}

/** One page (REPORT_PAGE_SIZE) of the student report pivot + total row count. */
export function useStudentAttendanceReport(
  institutionId: string | null,
  from: string | null,
  to: string | null,
  classId: string | null,
  page: number,
  holidays: Set<string>,
) {
  return useQuery({
    queryKey: ["attendance-report", "students", institutionId, from, to, classId, page, holidays.size],
    enabled: !!institutionId && !!from && !!to,
    staleTime: 60_000,
    queryFn: async (): Promise<{ rows: StudentReportRow[]; totalCount: number }> => {
      if (!from || !to) return { rows: [], totalCount: 0 };
      // Bounded admin on-demand report: LIMIT/OFFSET is intentional (page-jump + count).
      const { data, error } = await supabase.rpc("report_student_attendance", {
        p_from: from,
        p_to: to,
        p_class_id: classId,
        p_limit: REPORT_PAGE_SIZE,
        p_offset: page * REPORT_PAGE_SIZE,
      });
      if (error) throw error;
      const rows = (data ?? []) as unknown as StudentRpcRow[];
      return {
        rows: mapStudentRows(rows, from, to, holidays),
        totalCount: rows.length > 0 ? Number(rows[0].total_count) : 0,
      };
    },
  });
}

/** One page (REPORT_PAGE_SIZE) of the staff report pivot + total row count. */
export function useStaffAttendanceReport(
  institutionId: string | null,
  from: string | null,
  to: string | null,
  page: number,
  holidays: Set<string>,
) {
  return useQuery({
    queryKey: ["attendance-report", "staff", institutionId, from, to, page, holidays.size],
    enabled: !!institutionId && !!from && !!to,
    staleTime: 60_000,
    queryFn: async (): Promise<{ rows: StaffReportRow[]; totalCount: number }> => {
      if (!from || !to) return { rows: [], totalCount: 0 };
      const { data, error } = await supabase.rpc("report_staff_attendance", {
        p_from: from,
        p_to: to,
        p_limit: REPORT_PAGE_SIZE,
        p_offset: page * REPORT_PAGE_SIZE,
      });
      if (error) throw error;
      const rows = (data ?? []) as unknown as StaffRpcRow[];
      return {
        rows: mapStaffRows(rows, from, to, holidays),
        totalCount: rows.length > 0 ? Number(rows[0].total_count) : 0,
      };
    },
  });
}

const EXPORT_PAGE = 1000;

/** All student rows (loops the RPC in 1000-person pages) — for the Excel export. */
export async function fetchAllStudentReportRows(
  from: string,
  to: string,
  classId: string | null,
  holidays: Set<string>,
): Promise<StudentReportRow[]> {
  const acc: StudentRpcRow[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase.rpc("report_student_attendance", {
      p_from: from,
      p_to: to,
      p_class_id: classId,
      p_limit: EXPORT_PAGE,
      p_offset: offset,
    });
    if (error) throw error;
    const batch = (data ?? []) as unknown as StudentRpcRow[];
    acc.push(...batch);
    if (batch.length < EXPORT_PAGE) break;
    offset += EXPORT_PAGE;
  }
  return mapStudentRows(acc, from, to, holidays);
}

/** All staff rows (loops the RPC in 1000-person pages) — for the Excel export. */
export async function fetchAllStaffReportRows(
  from: string,
  to: string,
  holidays: Set<string>,
): Promise<StaffReportRow[]> {
  const acc: StaffRpcRow[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase.rpc("report_staff_attendance", {
      p_from: from,
      p_to: to,
      p_limit: EXPORT_PAGE,
      p_offset: offset,
    });
    if (error) throw error;
    const batch = (data ?? []) as unknown as StaffRpcRow[];
    acc.push(...batch);
    if (batch.length < EXPORT_PAGE) break;
    offset += EXPORT_PAGE;
  }
  return mapStaffRows(acc, from, to, holidays);
}
```

- [ ] **Step 2: Verify**

```
npm run typecheck → 0   (if the RPC arg/return types fight the cast, keep the `as unknown as` narrow cast — never `any`)
npx eslint src/hooks/useAttendanceReports.ts → 0
npx vite build → 0
```

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useAttendanceReports.ts
git commit -m "feat(reports): RPC-backed paginated report hooks + fetch-all export helpers"
```

---

## Task 4: Multi-sheet workbook builder + safe sheet names

**Files:**
- Modify: `src/lib/attendanceReportExport.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `AttendanceExportSheet = { sheetName, title, subtitle, columns: AttendanceExportColumn[], rows: (string|number)[][] }`; `downloadAttendanceWorkbookMulti({ sheets: AttendanceExportSheet[], filename }): Promise<void>`; `safeSheetName(name: string, used: Set<string>): string`. The existing `downloadAttendanceWorkbook` keeps working (delegates to the shared writer).

- [ ] **Step 1: Extract a shared sheet-writer + add the multi-sheet API**

Replace the body of `attendanceReportExport.ts` from the `downloadAttendanceWorkbook` function onward with:

```ts
export interface AttendanceExportSheet {
  sheetName: string;
  title: string;
  subtitle: string;
  columns: AttendanceExportColumn[];
  rows: (string | number)[][];
}

/** Excel sheet-name rules: <=31 chars, no : \ / ? * [ ], unique within a book. */
export function safeSheetName(name: string, used: Set<string>): string {
  const base = (name.replace(/[:\\/?*[\]]/g, " ").trim().slice(0, 31) || "Sheet");
  let candidate = base;
  let n = 2;
  while (used.has(candidate.toLowerCase())) {
    const suffix = ` (${n})`;
    candidate = base.slice(0, 31 - suffix.length) + suffix;
    n++;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function downloadBlob(buf: ArrayBuffer, filename: string): void {
  const blob = new Blob([buf], { type: MIME });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadAttendanceWorkbook(input: AttendanceExportInput): Promise<void> {
  await downloadAttendanceWorkbookMulti({
    sheets: [{
      sheetName: input.sheetName,
      title: input.title,
      subtitle: input.subtitle,
      columns: input.columns,
      rows: input.rows,
    }],
    filename: input.filename,
  });
}

export async function downloadAttendanceWorkbookMulti(input: {
  sheets: AttendanceExportSheet[];
  filename: string;
}): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "SALCI";
  wb.created = new Date();

  const used = new Set<string>();
  const sheets: AttendanceExportSheet[] = input.sheets.length > 0 ? input.sheets : [{
    sheetName: "Empty", title: "No data", subtitle: "", columns: [{ header: "—", width: 10 }], rows: [],
  }];
  for (const sheet of sheets) {
    // ws is fully typed by exceljs here — write the sheet inline (no structural casts).
    const ws = wb.addWorksheet(safeSheetName(sheet.sheetName, used), {
      views: [{ state: "frozen", ySplit: 4 }],
    });
    ws.columns = sheet.columns.map((c) => ({ width: c.width }));
    const lastCol = ws.getColumn(sheet.columns.length).letter;

    ws.mergeCells(`A1:${lastCol}1`);
    const title = ws.getCell("A1");
    title.value = sheet.title;
    title.font = { bold: true, size: 14, color: { argb: C.brand } };

    ws.mergeCells(`A2:${lastCol}2`);
    const meta = ws.getCell("A2");
    meta.value = sheet.subtitle;
    meta.font = { italic: true, size: 10, color: { argb: C.metaText } };

    const header = ws.getRow(4);
    sheet.columns.forEach((c, i) => {
      const cell = header.getCell(i + 1);
      cell.value = c.header;
      cell.font = { bold: true, color: { argb: C.headerText } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.brand } };
      cell.alignment = { vertical: "middle", horizontal: c.align ?? "left" };
    });

    sheet.rows.forEach((r) => {
      const row = ws.addRow(r);
      sheet.columns.forEach((c, i) => {
        row.getCell(i + 1).alignment = { vertical: "middle", horizontal: c.align ?? "left" };
      });
    });

    ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: sheet.columns.length } };
  }

  const buf = await wb.xlsx.writeBuffer();
  downloadBlob(buf as ArrayBuffer, input.filename);
}
```
Keep the file's existing top: the header comment, `AttendanceExportColumn`, `AttendanceExportInput`, `MIME`, and `C` constants.

- [ ] **Step 2: Verify + commit**

```
npm run typecheck → 0 · npx eslint src/lib/attendanceReportExport.ts → 0 · npx vite build → 0
git add src/lib/attendanceReportExport.ts
git commit -m "feat(reports): multi-sheet xlsx builder + safeSheetName"
```

---

## Task 5: Pagination controls + per-class multi-sheet export in the panel

**Files:**
- Modify: `src/components/attendance/AttendanceReports.tsx`

**Interfaces:**
- Consumes: `REPORT_PAGE_SIZE`, `useStudentAttendanceReport(...,page,holidays)`, `useStaffAttendanceReport(...,page,holidays)`, `fetchAllStudentReportRows`, `fetchAllStaffReportRows`, `StudentReportRow` (from `useAttendanceReports`); `downloadAttendanceWorkbookMulti`, `AttendanceExportSheet` (from `attendanceReportExport`).

- [ ] **Step 1: Imports + page state + reset-on-filter**

Update the imports block:
```tsx
import { useEffect, useMemo, useState } from "react";
```
```tsx
import {
  useStaffAttendanceReport,
  useStudentAttendanceReport,
  useHolidaysInRange,
  fetchAllStudentReportRows,
  fetchAllStaffReportRows,
  REPORT_PAGE_SIZE,
  type StudentReportRow,
  type StaffReportRow,
} from "@/hooks/useAttendanceReports";
```
```tsx
import {
  downloadAttendanceWorkbookMulti,
  type AttendanceExportColumn,
  type AttendanceExportSheet,
} from "@/lib/attendanceReportExport";
```
Add page state after the existing `useState`s (near line 71):
```tsx
const [page, setPage] = useState(0);
// Reset to the first page whenever the query inputs change, so we never land
// on an out-of-range page.
useEffect(() => {
  setPage(0);
}, [mode, fromStr, toStr, classId]);
```

- [ ] **Step 2: Pass `page` to the hooks + read `{rows,totalCount}`**

Replace the two hook calls:
```tsx
const staff = useStaffAttendanceReport(
  mode === "staff" ? institutionId : null,
  mode === "staff" ? fromStr : null,
  mode === "staff" ? toStr : null,
  page,
  holidaysSet,
);
const students = useStudentAttendanceReport(
  mode === "students" ? institutionId : null,
  mode === "students" ? fromStr : null,
  mode === "students" ? toStr : null,
  classId === "all" ? null : classId,
  page,
  holidaysSet,
);
```
Replace `rowsCount` (line ~165) and add paging math:
```tsx
const isLoading = mode === "staff" ? staff.isLoading : students.isLoading;
const isError = mode === "staff" ? staff.isError : students.isError;
const totalCount = mode === "staff" ? staff.data?.totalCount ?? 0 : students.data?.totalCount ?? 0;
const totalPages = Math.max(1, Math.ceil(totalCount / REPORT_PAGE_SIZE));
```
(Do NOT build a `pageRows` union variable — mapping over `StaffReportRow[] | StudentReportRow[]` trips TS2349. Read the mode-specific hook data directly in Step 5.)

- [ ] **Step 3: Rewrite `handleDownload` for complete + per-class export**

Replace the whole `handleDownload` function:
```tsx
const handleDownload = async () => {
  if (!validRange || isExporting) return;
  const dateHeaders = dateColumns.map((d) => format(parseISO(d), "dd MMM yyyy"));
  const dateCols: AttendanceExportColumn[] = dateHeaders.map((h) => ({ header: h, width: 16, align: "center" }));
  const rangeLabel = `${format(from, "PPP")} – ${format(to, "PPP")}`;
  const span = `${dateColumns.length} day${dateColumns.length === 1 ? "" : "s"} · ${holidaysSet.size} holiday${holidaysSet.size === 1 ? "" : "s"}`;

  setIsExporting(true);
  try {
    if (mode === "staff") {
      const rows = await fetchAllStaffReportRows(fromStr, toStr, holidaysSet);
      await downloadAttendanceWorkbookMulti({
        filename: `staff-attendance-${fromStr}_to_${toStr}.xlsx`,
        sheets: [{
          sheetName: "Staff",
          title: "Staff Attendance Report",
          subtitle: `${rangeLabel} · ${rows.length} staff · ${span}`,
          columns: [
            { header: "Name", width: 24, align: "left" },
            { header: "Role", width: 14, align: "left" },
            ...dateCols,
          ],
          rows: rows.map((r) => [r.fullName, r.role, ...dateColumns.map((d) => fullCode(r.byDate[d] ?? ""))]),
        }],
      });
    } else {
      const rows = await fetchAllStudentReportRows(fromStr, toStr, classId === "all" ? null : classId, holidaysSet);
      const studentColumns: AttendanceExportColumn[] = [
        { header: "Roll", width: 8, align: "left" },
        { header: "Name", width: 24, align: "left" },
        { header: "Class", width: 18, align: "left" },
        ...dateCols,
      ];
      const rowCells = (r: StudentReportRow) => [
        r.rollNumber ?? "",
        r.fullName,
        r.className,
        ...dateColumns.map((d) => fullCode(r.byDate[d] ?? "")),
      ];
      const sheets: AttendanceExportSheet[] = [];
      if (classId === "all") {
        // One sheet per class (grouped in roster order), then an "All students" sheet.
        const groups = new Map<string, { name: string; rows: StudentReportRow[] }>();
        for (const r of rows) {
          const g = groups.get(r.classId);
          if (g) g.rows.push(r);
          else groups.set(r.classId, { name: r.className, rows: [r] });
        }
        for (const g of groups.values()) {
          sheets.push({
            sheetName: g.name,
            title: `Student Attendance — ${g.name}`,
            subtitle: `${rangeLabel} · ${g.rows.length} student${g.rows.length === 1 ? "" : "s"} · ${span}`,
            columns: studentColumns,
            rows: g.rows.map(rowCells),
          });
        }
        sheets.push({
          sheetName: "All students",
          title: "Student Attendance — All students",
          subtitle: `${rangeLabel} · ${rows.length} student${rows.length === 1 ? "" : "s"} · ${span}`,
          columns: studentColumns,
          rows: rows.map(rowCells),
        });
      } else {
        const name = rows[0]?.className ?? "Class";
        sheets.push({
          sheetName: name,
          title: `Student Attendance — ${name}`,
          subtitle: `${rangeLabel} · ${rows.length} student${rows.length === 1 ? "" : "s"} · ${span}`,
          columns: studentColumns,
          rows: rows.map(rowCells),
        });
      }
      const scope = classId === "all" ? "all-classes" : "class";
      await downloadAttendanceWorkbookMulti({ sheets, filename: `student-attendance-${scope}-${fromStr}_to_${toStr}.xlsx` });
    }
  } catch (err) {
    toastError(err, { fallback: "Couldn't generate the Excel file.", context: "attendanceExport" });
  } finally {
    setIsExporting(false);
  }
};
```

- [ ] **Step 4: Wire the row-count line + Download disabled state**

The header count line (line ~217-231): replace `rowsCount` usage with `totalCount`, and gate Download on `totalCount === 0`:
```tsx
<p className="text-xs text-ink-500">
  {isLoading
    ? "Loading…"
    : `${totalCount} row${totalCount === 1 ? "" : "s"} · ${dateColumns.length} day${dateColumns.length === 1 ? "" : "s"} · ${holidaysSet.size} holiday${holidaysSet.size === 1 ? "" : "s"}`}
</p>
```
```tsx
<Button
  onClick={() => void handleDownload()}
  disabled={!validRange || isLoading || totalCount === 0 || isExporting}
  className="h-10 rounded-xl bg-brand-primary text-white hover:bg-brand-primary/90"
>
  <Download className="h-4 w-4 mr-2" />
  {isExporting ? "Generating…" : "Download Excel"}
</Button>
```

- [ ] **Step 5: Feed the paged rows to `ReportPreview` + add pagination controls**

Replace the `<ReportPreview .../>` render block (line ~251). Build `previewRows` by branching on the mode-specific (already typed) hook data — never over a union array:
```tsx
{(() => {
  const previewRows: PreviewRow[] =
    mode === "staff"
      ? (staff.data?.rows ?? []).map((s: StaffReportRow) => ({
          key: s.staffId,
          primary: s.fullName,
          secondary: s.role,
          byDate: s.byDate,
        }))
      : (students.data?.rows ?? []).map((s: StudentReportRow) => ({
          key: s.studentId,
          primary: s.fullName,
          secondary: `${s.rollNumber ? `Roll #${s.rollNumber} · ` : ""}${s.className}`,
          byDate: s.byDate,
        }));
  return (
    <ReportPreview
      loading={isLoading}
      isError={isError}
      rows={previewRows}
      dateColumns={dateColumns}
      page={page}
      totalPages={totalPages}
      totalCount={totalCount}
      onPrev={() => setPage((p) => Math.max(0, p - 1))}
      onNext={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
    />
  );
})()}
```

Then replace the `ReportPreview` component (drop the 25-row slice; render exactly the page passed in; add controls + an error state before empty):
```tsx
function ReportPreview({
  loading,
  isError,
  rows,
  dateColumns,
  page,
  totalPages,
  totalCount,
  onPrev,
  onNext,
}: {
  loading: boolean;
  isError: boolean;
  rows: PreviewRow[];
  dateColumns: string[];
  page: number;
  totalPages: number;
  totalCount: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  if (loading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-10 rounded-xl" />
        ))}
      </div>
    );
  }
  if (isError) {
    return (
      <EmptyState
        icon={<Users className="h-7 w-7" />}
        tone="rose"
        title="Couldn't load the report"
        description="Please try again in a moment."
      />
    );
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Users className="h-7 w-7" />}
        title="No rows in this range"
        description="Try widening the date range or switching mode."
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="surface-card frosted-shadow rounded-card overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-muted text-ink-600">
              <th className="text-left font-medium px-3 py-2 sticky left-0 z-20 bg-muted min-w-[12rem]">Name</th>
              {dateColumns.map((d) => (
                <th key={d} className="font-medium px-2 py-2 text-center text-[11px] tabular-nums whitespace-nowrap min-w-[5.5rem]">
                  {format(parseISO(d), "d MMM")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[hsl(var(--surface-stroke))]">
            {rows.map((r) => (
              <tr key={r.key}>
                <td className="px-3 py-2 sticky left-0 z-10 bg-[hsl(var(--surface-card))] min-w-[12rem]">
                  <div className="font-medium text-ink-900">{r.primary}</div>
                  <div className="text-[11px] text-ink-500">{r.secondary}</div>
                </td>
                {dateColumns.map((d) => {
                  const code = r.byDate[d] ?? "";
                  return (
                    <td key={d} className="px-2 py-2 text-center min-w-[5.5rem]">
                      <CodeChip code={code} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination controls */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] text-ink-500">
          Page {page + 1} of {totalPages} · {totalCount} total
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="rounded-full" onClick={onPrev} disabled={page <= 0}>
            <ChevronLeft className="h-3.5 w-3.5 mr-1" /> Prev
          </Button>
          <Button variant="outline" size="sm" className="rounded-full" onClick={onNext} disabled={page >= totalPages - 1}>
            Next <ChevronRight className="h-3.5 w-3.5 ml-1" />
          </Button>
        </div>
      </div>
    </div>
  );
}
```
Add `ChevronLeft, ChevronRight` to the lucide-react import at the top.

- [ ] **Step 6: Verify + commit**

```
npm run typecheck → 0
npx eslint src/components/attendance/AttendanceReports.tsx → 0
npx vite build → 0
git add src/components/attendance/AttendanceReports.tsx
git commit -m "feat(reports): paginated report table (Prev/Next) + per-class multi-sheet export"
```

---

## Final verification (after all tasks)

- §5a triad clean on the branch diff.
- Prod: `report_student_attendance` / `report_staff_attendance` exist (`prosecdef=true`); non-admin blocked; `total_count` matches roster count; paging returns disjoint pages.
- Browser smoke (user): Staff + Students tabs page with Prev/Next + "Page X of Y"; "All classes" export = one tab per class + "All students" tab; single class = one tab; staff = one "Staff" sheet; holiday columns show H; a >1,000-record school shows complete data (truncation gone); works at 375px.
