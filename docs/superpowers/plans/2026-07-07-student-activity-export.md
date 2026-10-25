# Student Activity Data Export — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a "Download Activity" button to the Students view of the Attendance Reports panel that exports a 2-sheet Excel (per-student Summary + timestamped Activity log) from two admin-gated server-side RPCs.

**Architecture:** Two `SECURITY DEFINER` RPCs (`report_student_activity` aggregates + `report_student_activity_events` event log) mirror `report_student_attendance`'s roster/auth/pagination/`p_institution_id` scaffold and aggregate server-side (no 1,000-row client truncation). A new export hook loops both to completion and packages them via the existing `downloadAttendanceWorkbookMulti` builder.

**Tech Stack:** React 18 + TS + Vite, TanStack Query v5, Supabase Postgres (SECURITY DEFINER RPCs), exceljs, date-fns.

**Spec:** `docs/superpowers/specs/2026-07-07-student-activity-export-design.md`

## Global Constraints

- **No unit-test runner.** Verification = §5a triad: `npm run typecheck` (0), `npx eslint <changed>` (0), `npx vite build` (0). DB task: apply via `scripts/run-sql.ps1` + live-smoke (ledger is stale — never `supabase db push`).
- **No `any`, no eslint-disable, no `as any`.** `prefer-const`. Supabase RPC rows cast via `as unknown as <RpcRow>` (narrow, not `any`).
- **§23:** server-side aggregation; RPCs admin-gated, institution from `auth.uid()`, `p_institution_id` for managed-school; paginated + counted; export loops in 1,000-row pages; no `select("*")`; no JWT-less `getUser`.
- **§19:** the export catch routes through `toastError(err, { fallback, context })`.
- exceljs stays a dynamic `import` (inside `downloadAttendanceWorkbookMulti`). Works at 375px. Prod ref `gyymkgohcijeksmrzuyw`.
- Helper signatures: `get_user_institution(uuid)→uuid`, `is_institution_admin(uuid,uuid)→bool`, `is_super_admin(uuid)→bool`. `profiles.roll_number` is `varchar` → cast `::text`. Column facts (verified): `student_exam_attempts(student_id,exam_id,started_at,submitted_at,is_submitted)`, `homework_submissions(student_id,homework_assignment_id,submitted_at,is_late)`, `homework_assignments(id,title)`, `recheck_requests(requested_by,requested_at)` (no exam link — recheck detail blank), `attendance_records(student_id,date,status)`, `exams(id,title)`.

## File structure

| File | Task | Responsibility |
|---|---|---|
| `supabase/migrations/20260707140000_student_activity_rpcs.sql` | A1 | the two activity RPCs |
| `src/integrations/supabase/types.ts` | A2 | regen |
| `src/hooks/useStudentActivityExport.ts` | A3 | fetch-all loops + `downloadStudentActivityWorkbook` |
| `src/components/attendance/AttendanceReports.tsx` | A4 | "Download Activity" button + handler |

Order: A1 → A2 → A3 → A4.

---

## Task A1: Migration — activity RPCs

**Files:**
- Create: `supabase/migrations/20260707140000_student_activity_rpcs.sql`

**Interfaces:**
- Produces: `report_student_activity(p_from date, p_to date, p_class_id uuid, p_limit int, p_offset int, p_institution_id uuid)` → per-student aggregate row incl. `last_sign_in_at`; `report_student_activity_events(...)` → event log row. Both admin-gated, EXECUTE to `authenticated`.

- [ ] **Step 1: Write the migration**

```sql
-- Admin-only, server-side student ACTIVITY reports. Same roster/auth/pagination
-- scaffold as report_student_attendance. Institution resolved from auth.uid()
-- with an optional p_institution_id (super_admin "Manage Institution"), guarded
-- by is_institution_admin(v_uid, v_inst) OR is_super_admin(v_uid).

CREATE OR REPLACE FUNCTION public.report_student_activity(
  p_from date,
  p_to date,
  p_class_id uuid DEFAULT NULL,
  p_limit int DEFAULT 40,
  p_offset int DEFAULT 0,
  p_institution_id uuid DEFAULT NULL
) RETURNS TABLE (
  student_id uuid,
  full_name text,
  roll_number text,
  class_name text,
  last_sign_in_at timestamptz,
  exams_taken bigint,
  exams_submitted bigint,
  homework_submitted bigint,
  homework_late bigint,
  rechecks_raised bigint,
  present_days bigint,
  absent_days bigint,
  marked_days bigint,
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
  v_inst := COALESCE(p_institution_id, public.get_user_institution(v_uid));
  IF v_inst IS NULL THEN
    RAISE EXCEPTION 'No institution for report' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.is_institution_admin(v_uid, v_inst) OR public.is_super_admin(v_uid)) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH roster AS (
    SELECT DISTINCT ON (ca.user_id)
      ca.user_id AS sid, p.full_name AS fname, p.roll_number AS roll,
      c.name AS cname, c.section AS csection
    FROM public.class_assignments ca
    JOIN public.profiles p ON p.id = ca.user_id AND p.institution_id = v_inst
    JOIN public.classes c ON c.id = ca.class_id AND c.institution_id = v_inst
    WHERE ca.role = 'student' AND (p_class_id IS NULL OR ca.class_id = p_class_id)
    ORDER BY ca.user_id, ca.class_id
  ),
  ranked AS (
    SELECT r.*, count(*) OVER() AS total,
      row_number() OVER (ORDER BY
        r.cname, r.csection NULLS FIRST,
        NULLIF(regexp_replace(COALESCE(r.roll, ''), '\D', '', 'g'), '')::int NULLS LAST,
        r.roll, r.fname
      ) AS rn
    FROM roster r
  )
  SELECT
    ranked.sid,
    ranked.fname,
    ranked.roll::text,
    CASE WHEN ranked.csection IS NOT NULL AND ranked.csection <> ''
      THEN ranked.cname || ' - ' || ranked.csection ELSE ranked.cname END,
    (SELECT au.last_sign_in_at FROM auth.users au WHERE au.id = ranked.sid),
    (SELECT count(*) FROM public.student_exam_attempts a
       WHERE a.student_id = ranked.sid AND a.started_at::date BETWEEN p_from AND p_to),
    (SELECT count(*) FROM public.student_exam_attempts a
       WHERE a.student_id = ranked.sid AND a.is_submitted AND a.submitted_at::date BETWEEN p_from AND p_to),
    (SELECT count(*) FROM public.homework_submissions h
       WHERE h.student_id = ranked.sid AND h.submitted_at::date BETWEEN p_from AND p_to),
    (SELECT count(*) FROM public.homework_submissions h
       WHERE h.student_id = ranked.sid AND h.is_late AND h.submitted_at::date BETWEEN p_from AND p_to),
    (SELECT count(*) FROM public.recheck_requests rr
       WHERE rr.requested_by = ranked.sid AND rr.requested_at::date BETWEEN p_from AND p_to),
    (SELECT count(*) FROM public.attendance_records ar
       WHERE ar.student_id = ranked.sid AND ar.date BETWEEN p_from AND p_to AND ar.status = 'present'),
    (SELECT count(*) FROM public.attendance_records ar
       WHERE ar.student_id = ranked.sid AND ar.date BETWEEN p_from AND p_to AND ar.status = 'absent'),
    (SELECT count(*) FROM public.attendance_records ar
       WHERE ar.student_id = ranked.sid AND ar.date BETWEEN p_from AND p_to),
    ranked.total
  FROM ranked
  WHERE ranked.rn > p_offset AND ranked.rn <= p_offset + p_limit
  ORDER BY ranked.rn;
END;
$$;

CREATE OR REPLACE FUNCTION public.report_student_activity_events(
  p_from date,
  p_to date,
  p_class_id uuid DEFAULT NULL,
  p_limit int DEFAULT 1000,
  p_offset int DEFAULT 0,
  p_institution_id uuid DEFAULT NULL
) RETURNS TABLE (
  student_id uuid,
  full_name text,
  roll_number text,
  class_name text,
  event_at timestamptz,
  event_type text,
  detail text,
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
  v_inst := COALESCE(p_institution_id, public.get_user_institution(v_uid));
  IF v_inst IS NULL THEN
    RAISE EXCEPTION 'No institution for report' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.is_institution_admin(v_uid, v_inst) OR public.is_super_admin(v_uid)) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH roster AS (
    SELECT DISTINCT ON (ca.user_id)
      ca.user_id AS sid, p.full_name AS fname, p.roll_number AS roll,
      c.name AS cname, c.section AS csection
    FROM public.class_assignments ca
    JOIN public.profiles p ON p.id = ca.user_id AND p.institution_id = v_inst
    JOIN public.classes c ON c.id = ca.class_id AND c.institution_id = v_inst
    WHERE ca.role = 'student' AND (p_class_id IS NULL OR ca.class_id = p_class_id)
    ORDER BY ca.user_id, ca.class_id
  ),
  events AS (
    SELECT r.sid, r.fname, r.roll, r.cname, r.csection,
      a.started_at AS ev_at, 'exam_started'::text AS ev_type, COALESCE(e.title, '') AS ev_detail
    FROM roster r
    JOIN public.student_exam_attempts a ON a.student_id = r.sid
    LEFT JOIN public.exams e ON e.id = a.exam_id
    WHERE a.started_at::date BETWEEN p_from AND p_to
    UNION ALL
    SELECT r.sid, r.fname, r.roll, r.cname, r.csection,
      a.submitted_at, 'exam_submitted', COALESCE(e.title, '')
    FROM roster r
    JOIN public.student_exam_attempts a ON a.student_id = r.sid
    LEFT JOIN public.exams e ON e.id = a.exam_id
    WHERE a.is_submitted AND a.submitted_at::date BETWEEN p_from AND p_to
    UNION ALL
    SELECT r.sid, r.fname, r.roll, r.cname, r.csection,
      h.submitted_at, 'homework_submitted', COALESCE(ha.title, '')
    FROM roster r
    JOIN public.homework_submissions h ON h.student_id = r.sid
    LEFT JOIN public.homework_assignments ha ON ha.id = h.homework_assignment_id
    WHERE h.submitted_at::date BETWEEN p_from AND p_to
    UNION ALL
    SELECT r.sid, r.fname, r.roll, r.cname, r.csection,
      rr.requested_at, 'recheck_requested', ''
    FROM roster r
    JOIN public.recheck_requests rr ON rr.requested_by = r.sid
    WHERE rr.requested_at::date BETWEEN p_from AND p_to
  ),
  ranked AS (
    SELECT ev.*, count(*) OVER() AS total,
      row_number() OVER (ORDER BY ev.fname, ev.ev_at) AS rn
    FROM events ev
  )
  SELECT
    ranked.sid, ranked.fname, ranked.roll::text,
    CASE WHEN ranked.csection IS NOT NULL AND ranked.csection <> ''
      THEN ranked.cname || ' - ' || ranked.csection ELSE ranked.cname END,
    ranked.ev_at, ranked.ev_type, ranked.ev_detail, ranked.total
  FROM ranked
  WHERE ranked.rn > p_offset AND ranked.rn <= p_offset + p_limit
  ORDER BY ranked.rn;
END;
$$;

REVOKE ALL ON FUNCTION public.report_student_activity(date, date, uuid, int, int, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.report_student_activity(date, date, uuid, int, int, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.report_student_activity_events(date, date, uuid, int, int, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.report_student_activity_events(date, date, uuid, int, int, uuid) TO authenticated;
```

- [ ] **Step 2: Apply to prod + live-smoke** (controller, via `scripts/run-sql.ps1`)

Apply, then verify:
```sql
SELECT proname, prosecdef FROM pg_proc WHERE proname IN ('report_student_activity','report_student_activity_events');
```
Expected: both, `prosecdef=true`. **Confirm `auth.users` is readable by the definer**: impersonate a real school_admin (`set_config('request.jwt.claims', '{"sub":"<admin>","role":"authenticated"}', false)`) and run `SELECT full_name, last_sign_in_at, exams_submitted, homework_submitted, present_days, total_count FROM public.report_student_activity('<from>','<to>', NULL, 5, 0);` — if it raises `permission denied for table users`, DROP the `last_sign_in_at` subquery from the RPC (return NULL) and note the client edge-fn fallback for A3; otherwise `last_sign_in_at` is populated. Spot-check one student's `exams_submitted`/`present_days` against raw `student_exam_attempts`/`attendance_records`. Run `report_student_activity_events('<from>','<to>', NULL, 5, 0)` → ordered events with titles. Confirm a non-admin caller is blocked (student jwt → HTTP 400) and super-admin `p_institution_id` impersonation works + cross-tenant blocked. Record results.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260707140000_student_activity_rpcs.sql
git commit -m "feat(activity): student-activity report RPCs (summary + event log, admin-gated)"
```

---

## Task A2: Regenerate types

**Files:**
- Modify: `src/integrations/supabase/types.ts`

- [ ] **Step 1: Regen + verify + commit**

```
npx supabase gen types typescript --project-id gyymkgohcijeksmrzuyw --schema public > src/integrations/supabase/types.ts
npm run typecheck   → exit 0
```
Confirm the diff adds `report_student_activity` + `report_student_activity_events` (bounded diff; if large unrelated churn appears, STOP and flag).
```bash
git add src/integrations/supabase/types.ts
git commit -m "chore(types): regen Supabase types for student-activity RPCs"
```

---

## Task A3: Export hook

**Files:**
- Create: `src/hooks/useStudentActivityExport.ts`

**Interfaces:**
- Consumes: `report_student_activity` / `report_student_activity_events` RPCs; `downloadAttendanceWorkbookMulti`, `AttendanceExportColumn`, `AttendanceExportSheet` from `@/lib/attendanceReportExport`.
- Produces: `downloadStudentActivityWorkbook({ institutionId, from, to, classId, rangeLabel }): Promise<void>`.

- [ ] **Step 1: Write the hook module**

```ts
import { format, parseISO } from "date-fns";

import { supabase } from "@/integrations/supabase/client";
import {
  downloadAttendanceWorkbookMulti,
  type AttendanceExportColumn,
  type AttendanceExportSheet,
} from "@/lib/attendanceReportExport";

const PAGE = 1000;

type SummaryRpcRow = {
  student_id: string;
  full_name: string;
  roll_number: string | null;
  class_name: string;
  last_sign_in_at: string | null;
  exams_taken: number | string;
  exams_submitted: number | string;
  homework_submitted: number | string;
  homework_late: number | string;
  rechecks_raised: number | string;
  present_days: number | string;
  absent_days: number | string;
  marked_days: number | string;
  total_count: number | string;
};
type EventRpcRow = {
  student_id: string;
  full_name: string;
  roll_number: string | null;
  class_name: string;
  event_at: string;
  event_type: string;
  detail: string;
  total_count: number | string;
};

const num = (v: number | string) => Number(v);
const fmtDateTime = (iso: string | null) => (iso ? format(parseISO(iso), "dd MMM yyyy, HH:mm") : "Never");
const EVENT_LABEL: Record<string, string> = {
  exam_started: "Exam started",
  exam_submitted: "Exam submitted",
  homework_submitted: "Homework submitted",
  recheck_requested: "Recheck requested",
};

async function fetchAllSummary(institutionId: string | null, from: string, to: string, classId: string | null): Promise<SummaryRpcRow[]> {
  const acc: SummaryRpcRow[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase.rpc("report_student_activity", {
      p_from: from, p_to: to, p_class_id: classId ?? undefined,
      p_limit: PAGE, p_offset: offset, p_institution_id: institutionId ?? undefined,
    });
    if (error) throw error;
    const batch = (data ?? []) as unknown as SummaryRpcRow[];
    acc.push(...batch);
    if (batch.length < PAGE) break;
    offset += PAGE;
  }
  return acc;
}

async function fetchAllEvents(institutionId: string | null, from: string, to: string, classId: string | null): Promise<EventRpcRow[]> {
  const acc: EventRpcRow[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase.rpc("report_student_activity_events", {
      p_from: from, p_to: to, p_class_id: classId ?? undefined,
      p_limit: PAGE, p_offset: offset, p_institution_id: institutionId ?? undefined,
    });
    if (error) throw error;
    const batch = (data ?? []) as unknown as EventRpcRow[];
    acc.push(...batch);
    if (batch.length < PAGE) break;
    offset += PAGE;
  }
  return acc;
}

function attendancePct(present: number, absent: number): string {
  const denom = present + absent;
  return denom === 0 ? "—" : `${Math.round((present / denom) * 100)}%`;
}

/** Build + download the 2-sheet student-activity workbook (Summary + Activity log). */
export async function downloadStudentActivityWorkbook(opts: {
  institutionId: string | null;
  from: string;
  to: string;
  classId: string | null;
  rangeLabel: string;
}): Promise<void> {
  const [summary, events] = await Promise.all([
    fetchAllSummary(opts.institutionId, opts.from, opts.to, opts.classId),
    fetchAllEvents(opts.institutionId, opts.from, opts.to, opts.classId),
  ]);

  const summaryColumns: AttendanceExportColumn[] = [
    { header: "Roll", width: 8, align: "left" },
    { header: "Name", width: 24, align: "left" },
    { header: "Class", width: 16, align: "left" },
    { header: "Last login", width: 18, align: "left" },
    { header: "Exams taken", width: 12, align: "center" },
    { header: "Exams submitted", width: 15, align: "center" },
    { header: "Homework submitted", width: 18, align: "center" },
    { header: "Homework late", width: 14, align: "center" },
    { header: "Rechecks", width: 10, align: "center" },
    { header: "Present", width: 9, align: "center" },
    { header: "Absent", width: 9, align: "center" },
    { header: "Attendance %", width: 13, align: "center" },
  ];
  const eventColumns: AttendanceExportColumn[] = [
    { header: "Roll", width: 8, align: "left" },
    { header: "Name", width: 24, align: "left" },
    { header: "Class", width: 16, align: "left" },
    { header: "When", width: 18, align: "left" },
    { header: "Activity", width: 18, align: "left" },
    { header: "Detail", width: 32, align: "left" },
  ];

  const sheets: AttendanceExportSheet[] = [
    {
      sheetName: "Summary",
      title: "Student Activity — Summary",
      subtitle: `${opts.rangeLabel} · ${summary.length} student${summary.length === 1 ? "" : "s"}`,
      columns: summaryColumns,
      rows: summary.map((r) => [
        r.roll_number ?? "",
        r.full_name,
        r.class_name,
        fmtDateTime(r.last_sign_in_at),
        num(r.exams_taken),
        num(r.exams_submitted),
        num(r.homework_submitted),
        num(r.homework_late),
        num(r.rechecks_raised),
        num(r.present_days),
        num(r.absent_days),
        attendancePct(num(r.present_days), num(r.absent_days)),
      ]),
    },
    {
      sheetName: "Activity log",
      title: "Student Activity — Log",
      subtitle: `${opts.rangeLabel} · ${events.length} event${events.length === 1 ? "" : "s"}`,
      columns: eventColumns,
      rows: events.map((e) => [
        e.roll_number ?? "",
        e.full_name,
        e.class_name,
        fmtDateTime(e.event_at),
        EVENT_LABEL[e.event_type] ?? e.event_type,
        e.detail,
      ]),
    },
  ];

  const scope = opts.classId ? "class" : "all-classes";
  await downloadAttendanceWorkbookMulti({ sheets, filename: `student-activity-${scope}-${opts.from}_to_${opts.to}.xlsx` });
}
```

- [ ] **Step 2: Verify + commit**

```
npm run typecheck → 0   (if the RPC row type fights the cast, keep the `as unknown as` narrow cast)
npx eslint src/hooks/useStudentActivityExport.ts → 0
npx vite build → 0
git add src/hooks/useStudentActivityExport.ts
git commit -m "feat(activity): student-activity export hook (2-sheet workbook)"
```

---

## Task A4: "Download Activity" button

**Files:**
- Modify: `src/components/attendance/AttendanceReports.tsx`

**Interfaces:**
- Consumes: `downloadStudentActivityWorkbook` from `@/hooks/useStudentActivityExport`.

- [ ] **Step 1: Import + state**

Add the import (near the other export import):
```tsx
import { downloadStudentActivityWorkbook } from "@/hooks/useStudentActivityExport";
```
Add a lucide icon `FileClock` to the existing lucide import. Add state after `isExporting`:
```tsx
const [isActivityExporting, setIsActivityExporting] = useState(false);
```

- [ ] **Step 2: Handler**

Add next to `handleDownload`:
```tsx
const handleActivityDownload = async () => {
  if (!validRange || isActivityExporting) return;
  setIsActivityExporting(true);
  try {
    await downloadStudentActivityWorkbook({
      institutionId,
      from: fromStr,
      to: toStr,
      classId: classId === "all" ? null : classId,
      rangeLabel: `${format(from, "PPP")} – ${format(to, "PPP")}`,
    });
  } catch (err) {
    toastError(err, { fallback: "Couldn't generate the activity file.", context: "activityExport" });
  } finally {
    setIsActivityExporting(false);
  }
};
```

- [ ] **Step 3: Button (Students mode, beside Download Excel)**

Find the Download button block (the `flex flex-wrap items-center justify-between gap-3 pt-2` row containing the count `<p>` and the single Download Excel `<Button>`). Wrap the two buttons in a right-aligned flex, adding the activity button (Students mode only) before Download Excel:
```tsx
<div className="flex flex-wrap items-center justify-between gap-3 pt-2">
  <p className="text-xs text-ink-500">
    {isLoading
      ? "Loading…"
      : `${totalCount} row${totalCount === 1 ? "" : "s"} · ${dateColumns.length} day${dateColumns.length === 1 ? "" : "s"} · ${holidaysSet.size} holiday${holidaysSet.size === 1 ? "" : "s"}`}
  </p>
  <div className="flex gap-2">
    {mode === "students" && (
      <Button
        onClick={() => void handleActivityDownload()}
        disabled={!validRange || isLoading || totalCount === 0 || isActivityExporting}
        variant="outline"
        className="h-10 rounded-xl"
      >
        <FileClock className="h-4 w-4 mr-2" />
        {isActivityExporting ? "Generating…" : "Download Activity"}
      </Button>
    )}
    <Button
      onClick={() => void handleDownload()}
      disabled={!validRange || isLoading || totalCount === 0 || isExporting}
      className="h-10 rounded-xl bg-brand-primary text-white hover:bg-brand-primary/90"
    >
      <Download className="h-4 w-4 mr-2" />
      {isExporting ? "Generating…" : "Download Excel"}
    </Button>
  </div>
</div>
```

- [ ] **Step 4: Verify + commit**

```
npm run typecheck → 0
npx eslint src/components/attendance/AttendanceReports.tsx → 0
npx vite build → 0
git add src/components/attendance/AttendanceReports.tsx
git commit -m "feat(activity): Download Activity button on the student report panel"
```

---

## Final verification (after all tasks)

- §5a triad clean.
- Prod: both RPCs exist (`prosecdef=true`); `last_sign_in_at` populated (or edge-fn fallback taken); non-admin blocked; super-admin `p_institution_id` works, cross-tenant blocked.
- Browser smoke (user): Students tab → **Download Activity** → 2-sheet `.xlsx` (Summary + Activity log); Summary has last-login + exam/homework/recheck/attendance numbers per student; Activity log has timestamped, titled events; single-class filter narrows both; button hidden in Staff mode; works at 375px.
