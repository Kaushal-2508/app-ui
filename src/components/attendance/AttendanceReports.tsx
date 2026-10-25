import { useMemo, useState } from "react";
import { format, startOfMonth, parseISO, eachDayOfInterval } from "date-fns";
import { CalendarIcon, ChevronLeft, ChevronRight, Download, FileClock, Users, GraduationCap } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/shared/surfaces";
import { MobileTabs } from "@/components/shared/nav";
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
import { useUserRole } from "@/hooks/useUserRole";
import { useActiveRole } from "@/contexts/ActiveRoleContext";
import { useScopedAttendanceClasses } from "@/hooks/useClassAttendance";
import { useEffectiveInstitutionId } from "@/contexts/InstitutionContext";
import { supabase } from "@/integrations/supabase/client";
import { formatClassName, cn } from "@/lib/utils";
import { FIELD_FILL } from "@/lib/fieldStyles";
import { toastError } from "@/lib/toast";
import {
  downloadAttendanceWorkbookMulti,
  type AttendanceExportColumn,
  type WorkbookSheet,
} from "@/lib/attendanceReportExport";
import { buildAttendanceInsightsSheets } from "@/lib/attendanceInsights";
import { downloadStudentActivityWorkbook } from "@/hooks/useStudentActivityExport";

const ymd = (d: Date) => format(d, "yyyy-MM-dd");

/**
 * Attendance reports. Date-range pivot of staff or student attendance,
 * holidays auto-marked from `cal_events`. The Excel export generates
 * client-side — well-suited for the typical 30-day × 200-row scale and
 * avoids an edge-function round-trip.
 *
 * Two audiences (2026-08-11):
 *   * admin / super admin → institution-wide, Staff + Students modes.
 *   * teacher / coordinator → Students only, restricted to their own classes
 *     (teacher = assigned, coordinator = wing). The Staff/Students toggle is
 *     hidden because `report_staff_attendance` stays admin-only, and the class
 *     dropdown comes from `useScopedAttendanceClasses`. The real boundary is
 *     server-side: `report_student_attendance` / `report_student_activity`
 *     filter to the caller's classes and ignore `p_institution_id` for
 *     non-admins.
 *
 * Output legend: P present · A absent · L late · O on leave / sick /
 * casual · H holiday · blank = no record.
 */
export function AttendanceReports() {
  const { data: roleInfo } = useUserRole();
  const { activeViewRole, hasDualRole } = useActiveRole();
  const institutionId = useEffectiveInstitutionId(roleInfo?.institutionId ?? null);
  // An admin who also teaches gets the teacher report while wearing the
  // Teacher hat (§25); the RPCs still enforce the real scope server-side.
  const isAdmin =
    !!(roleInfo?.isSchoolAdmin || roleInfo?.isSuperAdmin) && (!hasDualRole || activeViewRole === "admin");

  const [from, setFrom] = useState<Date>(() => startOfMonth(new Date()));
  const [to, setTo] = useState<Date>(() => new Date());
  // Non-admins have no staff report at all — pin the mode so no code path
  // can call the admin-only report_staff_attendance RPC.
  const [modeState, setMode] = useState<"staff" | "students">("staff");
  const mode: "staff" | "students" = isAdmin ? modeState : "students";
  const [classId, setClassId] = useState<string>("all");
  const [isExporting, setIsExporting] = useState(false);
  const [isActivityExporting, setIsActivityExporting] = useState(false);
  const [page, setPage] = useState(0);

  const fromStr = ymd(from);
  const toStr = ymd(to);
  const validRange = from <= to;

  // Reset to the first page synchronously with any filter change (in the same
  // event as the setState) so the query never fires once with a stale, out-of-
  // range offset before an effect could correct it.
  const changeMode = (v: "staff" | "students") => { setMode(v); setPage(0); };
  const changeClass = (v: string) => { setClassId(v); setPage(0); };
  const changeFrom = (d: Date) => { setFrom(d); setPage(0); };
  const changeTo = (d: Date) => { setTo(d); setPage(0); };

  // One class source for every role: institution-wide for admins, wing for
  // coordinators, assigned classes for teachers.
  const { data: classes, isLoading: classesLoading } = useScopedAttendanceClasses();

  // A scoped user with no classes has nothing to report on — and the RPC
  // would answer 42501. Skip the fetch and show an empty state instead of an
  // error surface.
  const noScope = !isAdmin && !classesLoading && (classes?.length ?? 0) === 0;
  const reportInstitutionId = noScope ? null : institutionId;

  const { data: holidays } = useHolidaysInRange(reportInstitutionId, fromStr, toStr);
  const holidaysSet = useMemo(() => holidays ?? new Set<string>(), [holidays]);

  const staff = useStaffAttendanceReport(
    mode === "staff" ? reportInstitutionId : null,
    mode === "staff" ? fromStr : null,
    mode === "staff" ? toStr : null,
    page,
    holidaysSet,
  );
  const students = useStudentAttendanceReport(
    mode === "students" ? reportInstitutionId : null,
    mode === "students" ? fromStr : null,
    mode === "students" ? toStr : null,
    classId === "all" ? null : classId,
    page,
    holidaysSet,
  );

  const dateColumns = useMemo(
    () => (validRange ? eachDayOfInterval({ start: from, end: to }).map(ymd) : []),
    [from, to, validRange],
  );

  const handleDownload = async () => {
    if (!validRange || isExporting) return;
    // ISO -> "01 Jun 2026": readable AND written as text, so Excel shows the full
    // date in a sized column instead of "####".
    const dateHeaders = dateColumns.map((d) => format(parseISO(d), "dd MMM yyyy"));
    const dateCols: AttendanceExportColumn[] = dateHeaders.map((h) => ({
      header: h,
      // Wide enough for "01 Jun 2026" PLUS the AutoFilter dropdown arrow, which
      // otherwise overlaps and clips the last character(s) of the date.
      width: 16,
      align: "center",
    }));
    const rangeLabel = `${format(from, "PPP")} – ${format(to, "PPP")}`;
    const span = `${dateColumns.length} day${dateColumns.length === 1 ? "" : "s"} · ${holidaysSet.size} holiday${holidaysSet.size === 1 ? "" : "s"}`;

    setIsExporting(true);
    try {
      if (mode === "staff") {
        const rows = await fetchAllStaffReportRows(institutionId, fromStr, toStr, holidaysSet);
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
        const rows = await fetchAllStudentReportRows(institutionId, fromStr, toStr, classId === "all" ? null : classId, holidaysSet);
        const { data: instRow } = await supabase
          .from("institutions").select("name").eq("id", institutionId ?? "").maybeSingle();
        const schoolName = (instRow as { name: string } | null)?.name ?? "";
        const scopeLabel = classId === "all"
          ? "All classes"
          : rows[0]
            ? `${rows[0].className}${rows[0].section ? ` - ${rows[0].section}` : ""}`
            : "Class";

        // Tab 1 "Overview" (actionable insights) + Tab 2 "At-Risk Watchlist",
        // then the per-class (grade) attendance pivots.
        const sheets: WorkbookSheet[] = buildAttendanceInsightsSheets(rows, dateColumns, {
          schoolName,
          scopeLabel,
          rangeLabel,
        });

        // Detail tabs: one per class (grade), all sections merged, Section column.
        const perClassColumns: AttendanceExportColumn[] = [
          { header: "Roll", width: 8, align: "left" },
          { header: "Section", width: 9, align: "left" },
          { header: "Name", width: 24, align: "left" },
          ...dateCols,
        ];
        const perClassCells = (r: StudentReportRow) => [
          r.rollNumber ?? "",
          r.section ?? "",
          r.fullName,
          ...dateColumns.map((d) => fullCode(r.byDate[d] ?? "")),
        ];
        const groups = new Map<string, StudentReportRow[]>();
        for (const r of rows) {
          const g = groups.get(r.className);
          if (g) g.push(r);
          else groups.set(r.className, [r]);
        }
        for (const [grade, grows] of groups) {
          sheets.push({
            sheetName: grade,
            title: `Student Attendance: ${grade}`,
            subtitle: `${rangeLabel} · ${grows.length} student${grows.length === 1 ? "" : "s"} · ${span}`,
            columns: perClassColumns,
            rows: grows.map(perClassCells),
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

  const isLoading = mode === "staff" ? staff.isLoading : students.isLoading;
  const isError = mode === "staff" ? staff.isError : students.isError;
  const totalCount = mode === "staff" ? staff.data?.totalCount ?? 0 : students.data?.totalCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / REPORT_PAGE_SIZE));

  if (noScope) {
    return (
      <EmptyState
        icon={<GraduationCap className="h-7 w-7" />}
        title="No classes assigned to you"
        description="Attendance reports cover the classes you teach or coordinate. Once you're assigned to a class, its report will appear here."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="surface-card frosted-shadow rounded-card p-4 sm:p-5 space-y-4">
        <div>
          <p className="eyebrow">Pivot range · holiday-aware</p>
          <h3 className="mt-1 text-base sm:text-lg font-semibold text-ink-900">Attendance reports</h3>
          <p className="mt-0.5 text-xs text-ink-500">
            {isAdmin
              ? "Generate a per-day pivot for staff or students. "
              : "Generate a per-day pivot for the students in your classes. "}
            Holidays from the academic calendar are pre-filled as{" "}
            <span className="font-mono">H</span>.
          </p>
        </div>

        {isAdmin && (
          <MobileTabs
            value={mode}
            onValueChange={(v) => changeMode(v as "staff" | "students")}
            options={[
              { value: "staff",    label: "Staff",    icon: <Users className="h-3.5 w-3.5" /> },
              { value: "students", label: "Students", icon: <GraduationCap className="h-3.5 w-3.5" /> },
            ]}
          />
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <DateField label="From" value={from} onChange={changeFrom} />
          <DateField label="To" value={to} onChange={changeTo} />
          {mode === "students" && (
            <div className="space-y-1 sm:col-span-2">
              <span className="text-xs font-medium text-ink-600">Class</span>
              <Select value={classId} onValueChange={changeClass}>
                <SelectTrigger className="h-10 rounded-xl">
                  <SelectValue placeholder={isAdmin ? "All classes" : "All my classes"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{isAdmin ? "All classes" : "All my classes"}</SelectItem>
                  {(classes ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {formatClassName(c.name, c.section)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {!validRange && (
          <p className="text-sm text-rose-700">
            "From" date must be on or before "To" date.
          </p>
        )}

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
              {isExporting ? "Generating…" : "Download Attendance"}
            </Button>
          </div>
        </div>
      </div>

      {/* Code legend — full form of each attendance letter, sits above the list */}
      <div className="surface-card frosted-shadow rounded-card px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <span className="text-xs font-semibold text-ink-700">Legend</span>
          {ATTENDANCE_LEGEND.map((item) => (
            <span
              key={item.code || "none"}
              className="inline-flex items-center gap-1.5 text-xs text-ink-600"
            >
              <CodeChip code={item.code} />
              <span>{item.label}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Preview table */}
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
                secondary: `${s.rollNumber ? `Roll #${s.rollNumber} · ` : ""}${s.className}${s.section ? ` - ${s.section}` : ""}`,
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
    </div>
  );
}

function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Date;
  onChange: (d: Date) => void;
}) {
  return (
    <div className="space-y-1">
      <span className="text-xs font-medium text-ink-600">{label}</span>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" className={cn("h-10 w-full rounded-xl justify-start font-normal", FIELD_FILL)}>
            <CalendarIcon className="h-4 w-4 mr-2 shrink-0" />
            {format(value, "PPP")}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={value}
            onSelect={(d) => d && onChange(d)}
            className="p-3 pointer-events-auto"
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

interface PreviewRow {
  key: string;
  primary: string;
  secondary: string;
  byDate: Record<string, string>;
}

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
              {/* Opaque bg + z-index so date headers slide cleanly UNDER the
                  pinned Name column instead of bleeding through it. */}
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

// Single source of truth: what each attendance letter expands to. Used by the
// legend, the cell tooltips, and the CSV export (which writes the full words).
const CODE_LABELS: Record<string, string> = {
  P: "Present",
  A: "Absent",
  L: "Late",
  O: "On leave",
  H: "Holiday",
};

// Expand a stored code to its full word; blank/unknown stays as-is.
const fullCode = (code: string) => CODE_LABELS[code] ?? code;

// Legend rows shown above the table (codes + the blank "no record" case).
const ATTENDANCE_LEGEND: { code: string; label: string }[] = [
  ...Object.entries(CODE_LABELS).map(([code, label]) => ({ code, label })),
  { code: "", label: "No record" },
];

const CODE_TONES: Record<string, string> = {
  P: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
  A: "bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300",
  L: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
  O: "bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-300",
  H: "bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300",
};

function CodeChip({ code }: { code: string }) {
  if (!code) return <span className="text-ink-400">·</span>;
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center h-5 w-5 rounded-full text-[10px] font-bold",
        CODE_TONES[code] ?? "bg-ink-400/15 text-ink-700",
      )}
      title={fullCode(code)}
    >
      {code}
    </span>
  );
}
