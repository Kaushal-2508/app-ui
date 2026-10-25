import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { format, isToday, subDays, addDays, startOfDay } from "date-fns";
import {
  ArrowLeft,
  Save,
  Lock,
  Check,
  X,
  Users,
  CalendarCheck,
  CalendarDays,
  CalendarX2,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { EmptyState } from "@/components/shared/surfaces";
import { MobileSheet } from "@/components/shared/sheets";
import {
  useAttendanceByClassDate,
  useSaveClassAttendance,
  useEffectiveAttendanceSettings,
  TEACHER_LEAVE_REMARK,
  type AttendanceStatus,
  type ClassAttendanceSaveRow,
} from "@/hooks/useAttendance";
import {
  useClassStudents,
  useScopedAttendanceClasses,
  useAttendanceClassMarkers,
  computeAttendanceLock,
  otherMarkerNames,
} from "@/hooks/useClassAttendance";
import { useAuth } from "@/hooks/useAuth";
import { useUserRole } from "@/hooks/useUserRole";
import { useEffectiveInstitutionId } from "@/contexts/InstitutionContext";
import { formatClassName } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { ViewLeavesSheet } from "@/components/attendance/ViewLeavesSheet";
import { MarkLeaveSheet } from "@/components/attendance/MarkLeaveSheet";
import { usePendingLeaveCount, type LeaveType } from "@/hooks/useStudentLeave";

/**
 * One roster row's pending state. `leaveType`/`reason` are collected by
 * MarkLeaveSheet and only used when the save has to CREATE the leave record;
 * a day already covered by an approved leave keeps that record untouched.
 */
interface DraftEntry {
  status: AttendanceStatus;
  leaveType?: LeaveType;
  reason?: string;
}

const ALL_PRESENT_KEY = "present" as const;

/**
 * Single-class attendance screen. Renders the class roster sorted by roll
 * number with a default-all-present draft state — the teacher only flips
 * absentees, then taps Save. Bulk "All present"/"All absent" controls
 * remain available, plus Present/Absent/Leave per row.
 *
 * Leave (2026-09-03) is the third per-row state and the second way a student
 * gets leave: instead of applying and waiting for approval, the teacher marks
 * it here. Tapping Leave opens MarkLeaveSheet for a type + reason, and Save
 * writes the attendance row AND an already-approved `leave_requests` row in
 * one transaction, so a teacher-marked leave is indistinguishable downstream
 * from an approved application (same Leaves lists, same student
 * notification, same exam-badge exemption). Flipping a leave-marked student
 * back to present/absent withdraws the leave the teacher created, after a
 * confirmation that names them (§9a).
 *
 * Date navigation (2026-08-11): the header carries prev/next day steppers
 * plus a calendar popover. Any past date is viewable; teachers can edit only
 * dates within `student_attendance_edit_window_days` (default 2 → today,
 * yesterday, day before — backfill of unmarked days included). Older dates
 * render read-only from actual records. Admins bypass the date lock.
 * Mirrored server-side by the `enforce_student_attendance_edit_window`
 * trigger; "marked by another teacher" still locks regardless of date.
 * Tapping a roster row opens the student's attendance history
 * (/school/attendance/user/:id?kind=student); the status pills stop
 * propagation so marking never navigates.
 */
export function ClassAttendanceMarker({
  classId,
  onBack,
}: {
  classId: string;
  onBack: () => void;
}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: roleInfo } = useUserRole();
  const institutionId = useEffectiveInstitutionId(roleInfo?.institutionId ?? null);
  const settings = useEffectiveAttendanceSettings(institutionId);

  const { data: classes } = useScopedAttendanceClasses();
  const cls = classes?.find((c) => c.id === classId);
  const isAdmin = !!(roleInfo?.isSchoolAdmin || roleInfo?.isSuperAdmin);

  const [selectedDate, setSelectedDate] = useState<Date>(() => startOfDay(new Date()));
  const [calendarOpen, setCalendarOpen] = useState(false);
  const dateStr = format(selectedDate, "yyyy-MM-dd");
  const dateLabel = format(selectedDate, "d MMM yyyy");
  const viewingToday = isToday(selectedDate);

  const {
    data: students,
    isLoading: studentsLoading,
    error: studentsError,
  } = useClassStudents(classId);
  const {
    data: existingRecords,
    isLoading: recordsLoading,
    error: recordsError,
  } = useAttendanceByClassDate(classId, dateStr);
  const saveMutation = useSaveClassAttendance();

  // A failed read must never look like an empty or all-present day: with
  // `existingRecords` undefined the draft below defaults every student to
  // present, so saving would overwrite a real day (CLAUDE.md §6).
  const loadError = (studentsError ?? recordsError) as Error | null;

  const [leavesOpen, setLeavesOpen] = useState(false);
  const [leaveTarget, setLeaveTarget] = useState<{ id: string; name: string } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const pendingLeaves = usePendingLeaveCount(classId);

  const [draft, setDraft] = useState<Record<string, DraftEntry>>({});

  // Switching dates must never carry unsaved flips across — clear the draft
  // before the init effect below rebuilds it for the new date.
  useEffect(() => {
    setDraft({});
  }, [dateStr]);

  // Initialize draft: existing record wins; missing students default to "present".
  // Re-runs when the roster or existing-records snapshot changes (e.g. after
  // a save invalidation re-fetch).
  useEffect(() => {
    if (!students) return;
    setDraft((prev) => {
      const next: Record<string, DraftEntry> = {};
      students.forEach((s) => {
        const existing = existingRecords?.find((r) => r.student_id === s.id);
        const carried = prev[s.id];
        next[s.id] = existing
          ? { status: existing.status, leaveType: carried?.leaveType, reason: carried?.reason }
          : carried ?? { status: ALL_PRESENT_KEY };
      });
      return next;
    });
  }, [students, existingRecords]);

  const recordByStudent = useMemo(() => {
    const map = new Map<string, { status: AttendanceStatus; remarks: string | null }>();
    (existingRecords ?? []).forEach((r) => map.set(r.student_id, { status: r.status, remarks: r.remarks }));
    return map;
  }, [existingRecords]);

  const windowDays = settings?.student_attendance_edit_window_days ?? 2;
  const lock = useMemo(
    () =>
      computeAttendanceLock(
        existingRecords?.map((r) => ({ marked_by: r.marked_by })) ?? [],
        user?.id,
        dateStr,
        windowDays,
        isAdmin,
      ),
    [existingRecords, user?.id, dateStr, windowDays, isAdmin],
  );

  const canEdit = lock.canEdit && !loadError;

  // Name the teacher who owns this day so the lock banner can say who, not
  // just "another teacher". Same RPC and cache key as the tiles.
  const { data: markerMap } = useAttendanceClassMarkers(classId ? [classId] : [], dateStr);
  const lockedBy = otherMarkerNames(classId ? markerMap?.get(classId) : undefined, user?.id);

  const setStatus = (studentId: string, status: AttendanceStatus) => {
    if (!canEdit) return;
    setDraft((prev) => ({ ...prev, [studentId]: { ...prev[studentId], status } }));
  };

  const markAll = (status: AttendanceStatus) => {
    if (!canEdit || !students) return;
    const next: Record<string, DraftEntry> = {};
    students.forEach((s) => {
      next[s.id] = { status };
    });
    setDraft(next);
  };

  const openLeaveSheet = (studentId: string, fullName: string) => {
    if (!canEdit) return;
    setLeaveTarget({ id: studentId, name: fullName });
  };

  const confirmLeave = (leaveType: LeaveType, reason: string) => {
    if (!leaveTarget) return;
    setDraft((prev) => ({ ...prev, [leaveTarget.id]: { status: "leave", leaveType, reason } }));
    setLeaveTarget(null);
  };

  // Students recorded as on leave whom the draft no longer marks as such.
  // Saving revokes their leave, so §9a requires naming them first.
  const leaveRemovals = useMemo(() => {
    if (!students) return [];
    return students
      .filter((s) => {
        const rec = recordByStudent.get(s.id);
        const drafted = draft[s.id]?.status;
        return rec?.status === "leave" && drafted !== undefined && drafted !== "leave";
      })
      .map((s) => ({
        id: s.id,
        name: s.full_name,
        teacherMarked: recordByStudent.get(s.id)?.remarks === TEACHER_LEAVE_REMARK,
      }));
  }, [students, recordByStudent, draft]);

  const doSave = () => {
    // No institutionId guard: the RPC re-derives the institution from the
    // class (never trusting a caller-supplied one), so requiring it here would
    // only turn a not-yet-loaded context into a Save button that silently
    // does nothing.
    if (!students || students.length === 0 || !canEdit) return;
    const rows: ClassAttendanceSaveRow[] = students.map((s) => {
      const entry = draft[s.id] ?? { status: ALL_PRESENT_KEY };
      return {
        student_id: s.id,
        status: entry.status,
        leave_type: entry.status === "leave" ? entry.leaveType ?? null : null,
        reason: entry.status === "leave" ? entry.reason ?? null : null,
      };
    });
    setConfirmOpen(false);
    saveMutation.mutate(
      { classId, date: dateStr, rows },
      { onSuccess: () => onBack() },
    );
  };

  const handleSave = () => {
    if (leaveRemovals.length > 0) {
      setConfirmOpen(true);
      return;
    }
    doSave();
  };

  // Draft drives counts while editing; on view-only dates show what was
  // actually recorded (a default-present draft would misreport history).
  const countBy = (status: AttendanceStatus) =>
    canEdit
      ? students?.filter((s) => draft[s.id]?.status === status).length ?? 0
      : students?.filter((s) => recordByStudent.get(s.id)?.status === status).length ?? 0;
  const presentCount = countBy("present");
  const absentCount = countBy("absent");
  const leaveCount = countBy("leave");

  const leaveTargetRecord = leaveTarget ? recordByStudent.get(leaveTarget.id) : undefined;
  const leaveTargetNote =
    leaveTargetRecord?.status === "leave" && leaveTargetRecord.remarks !== TEACHER_LEAVE_REMARK
      ? "This student is already on approved leave for this date. Their existing leave record is kept as it is."
      : null;

  return (
    <div className="space-y-4">
      {/* Header row: back + class name + date navigation */}
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <Button variant="ghost" size="icon" onClick={onBack} aria-label="Back to classes">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <p className="eyebrow">
            {viewingToday ? "Today" : format(selectedDate, "EEEE")} · {format(selectedDate, "d MMM")}
          </p>
          <h2 className="text-lg sm:text-xl font-semibold text-ink-900 truncate">
            {cls ? formatClassName(cls.name, cls.section) : "Class"}
          </h2>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9 rounded-full"
            aria-label="Previous day"
            onClick={() => setSelectedDate((d) => subDays(d, 1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 rounded-full px-3">
                <CalendarDays className="h-3.5 w-3.5 mr-1.5" />
                {dateLabel}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={(d) => {
                  if (!d) return;
                  setSelectedDate(startOfDay(d));
                  setCalendarOpen(false);
                }}
                disabled={(d) => d > new Date()}
                defaultMonth={selectedDate}
              />
            </PopoverContent>
          </Popover>
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9 rounded-full"
            aria-label="Next day"
            disabled={viewingToday}
            onClick={() => setSelectedDate((d) => addDays(d, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Lock banner */}
      {!loadError && !lock.canEdit && lock.lockReason === "different-marker" && (
        <div className="surface-card frosted-shadow rounded-card p-4 border border-amber-200 bg-amber-50/60 dark:bg-amber-500/10 dark:border-amber-500/20">
          <div className="flex items-start gap-3">
            <Lock className="h-5 w-5 text-amber-700 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-ink-900">
                Already marked by {lockedBy ?? "another teacher"}
              </p>
              <p className="text-xs text-ink-600 mt-0.5">
                {lockedBy
                  ? `Only ${lockedBy} can edit this day's attendance.`
                  : "Only the teacher who submitted this day's attendance can edit it."}
              </p>
            </div>
          </div>
        </div>
      )}
      {!loadError && !lock.canEdit && lock.lockReason === "past-window" && (
        <div className="surface-card frosted-shadow rounded-card p-4 border border-rose-200 bg-rose-50/60 dark:bg-rose-500/10 dark:border-rose-500/20">
          <div className="flex items-start gap-3">
            <Lock className="h-5 w-5 text-rose-700 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-ink-900">View only</p>
              <p className="text-xs text-ink-600 mt-0.5">
                Attendance older than {windowDays} days can only be changed by an admin.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Bulk actions + summary. Hidden on a load error so no count is quoted
          from data we don't actually have. */}
      {!loadError && students && students.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex items-center gap-2 text-sm text-ink-600">
            <Users className="h-4 w-4" />
            <span>{students.length} students</span>
            <span className="text-ink-400">·</span>
            <span className="text-emerald-700">{presentCount} present</span>
            {absentCount > 0 && (
              <>
                <span className="text-ink-400">·</span>
                <span className="text-rose-700">{absentCount} absent</span>
              </>
            )}
            {leaveCount > 0 && (
              <>
                <span className="text-ink-400">·</span>
                <span className="text-violet-700 dark:text-violet-300">{leaveCount} on leave</span>
              </>
            )}
          </div>
          {/* Wraps so the third pill drops to a second line at 375px instead of
              pushing the page sideways. */}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" className="rounded-full relative" onClick={() => setLeavesOpen(true)}>
              <CalendarCheck className="h-3.5 w-3.5 mr-1" /> View Leaves
              {(pendingLeaves.data ?? 0) > 0 && (
                <span className="ml-1 inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-brand-secondary text-white text-[10px] font-semibold">
                  {pendingLeaves.data}
                </span>
              )}
            </Button>
            {canEdit && (
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
        </div>
      )}

      {/* Roster. Error renders BEFORE the empty state (§6). */}
      {studentsLoading || recordsLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-14 rounded-2xl" />
          ))}
        </div>
      ) : loadError ? (
        <EmptyState
          tone="rose"
          icon={<CalendarX2 className="h-7 w-7" />}
          title="Couldn't load this day's attendance"
          description="Marking is disabled until it loads, so nothing already recorded gets overwritten. Please try again in a moment."
        />
      ) : !students || students.length === 0 ? (
        <EmptyState
          icon={<Users className="h-7 w-7" />}
          title="No students in this class"
          description="Once students are assigned to this class, you'll be able to take attendance."
        />
      ) : (
        <ul className="surface-card frosted-shadow rounded-card divide-y divide-[hsl(var(--surface-stroke))] overflow-hidden">
          {students.map((s) => {
            const status = draft[s.id]?.status ?? ALL_PRESENT_KEY;
            return (
              <li
                key={s.id}
                onClick={() => navigate(`/school/attendance/user/${s.id}?kind=student`)}
                className="flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors hover:bg-ink-400/5"
              >
                <Avatar className="h-9 w-9 shrink-0">
                  <AvatarFallback className="text-xs">
                    {s.full_name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-ink-900 truncate">{s.full_name}</p>
                  <p className="text-xs text-ink-500 truncate">
                    {[
                      s.roll_number ? `Roll #${s.roll_number}` : "No roll number",
                      s.admission_number,
                    ]
                      .filter(Boolean)
                      .join(" | ")}
                  </p>
                </div>
                {/* Marking a pill must never also trigger row navigation. */}
                <div
                  className="flex items-center gap-1.5 shrink-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  {canEdit ? (
                    <>
                      <StatusPill
                        label="P"
                        fullLabel="Present"
                        active={status === "present"}
                        activeClass="bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-500/20 dark:text-emerald-300 dark:border-emerald-500/40"
                        onClick={() => setStatus(s.id, "present")}
                      />
                      <StatusPill
                        label="A"
                        fullLabel="Absent"
                        active={status === "absent"}
                        activeClass="bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-500/20 dark:text-rose-300 dark:border-rose-500/40"
                        onClick={() => setStatus(s.id, "absent")}
                      />
                      <StatusPill
                        label="L"
                        fullLabel="Leave"
                        active={status === "leave"}
                        activeClass="bg-violet-100 text-violet-800 border-violet-300 dark:bg-violet-500/20 dark:text-violet-300 dark:border-violet-500/40"
                        onClick={() => openLeaveSheet(s.id, s.full_name)}
                      />
                    </>
                  ) : (
                    <RecordedStatusPill status={recordByStudent.get(s.id)?.status ?? null} />
                  )}
                </div>
                <ChevronRight className="h-4 w-4 text-ink-400 shrink-0" />
              </li>
            );
          })}
        </ul>
      )}

      {/* Save bar */}
      {students && students.length > 0 && canEdit && (
        <div className="sticky bottom-2 z-10">
          <Button
            onClick={handleSave}
            disabled={saveMutation.isPending}
            className="w-full rounded-xl bg-brand-primary text-white hover:bg-brand-primary/90 h-12 text-base"
          >
            <Save className="h-4 w-4 mr-2" />
            {saveMutation.isPending
              ? "Saving…"
              : existingRecords && existingRecords.length > 0
                ? "Update Attendance"
                : "Submit Attendance"}
          </Button>
        </div>
      )}

      <ViewLeavesSheet
        open={leavesOpen}
        onOpenChange={setLeavesOpen}
        classId={classId}
        className={cls ? formatClassName(cls.name, cls.section) : undefined}
      />

      <MarkLeaveSheet
        open={!!leaveTarget}
        onOpenChange={(o) => { if (!o) setLeaveTarget(null); }}
        studentName={leaveTarget?.name ?? ""}
        dateLabel={dateLabel}
        initialType={leaveTarget ? draft[leaveTarget.id]?.leaveType : undefined}
        initialReason={leaveTarget ? draft[leaveTarget.id]?.reason : undefined}
        existingNote={leaveTargetNote}
        onConfirm={confirmLeave}
      />

      {/* §9a: a save that removes leave records names them first. */}
      <MobileSheet
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={leaveRemovals.length === 1 ? "Remove this leave?" : `Remove ${leaveRemovals.length} leaves?`}
        subtitle={dateLabel}
        icon={<CalendarX2 className="h-4 w-4" />}
        primaryAction={{ label: "Save anyway", onClick: doSave, loading: saveMutation.isPending }}
        secondaryAction={{ label: "Go back", onClick: () => setConfirmOpen(false) }}
      >
        <div className="space-y-3">
          <p className="text-sm text-ink-700">
            These students are recorded as on leave for this date, and you have marked them
            present or absent instead:
          </p>
          <ul className="space-y-1 text-sm text-ink-900">
            {leaveRemovals.map((r) => (
              <li key={r.id} className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-violet-500 shrink-0" aria-hidden />
                <span className="truncate">{r.name}</span>
              </li>
            ))}
          </ul>
          {leaveRemovals.some((r) => r.teacherMarked) && (
            <p className="text-xs text-ink-600">
              Leave that was marked here will be deleted.
            </p>
          )}
          {leaveRemovals.some((r) => !r.teacherMarked) && (
            <p className="text-xs text-ink-600">
              Where the student applied for the leave themselves, their request stays approved
              in the Leaves list. Only this date's attendance changes.
            </p>
          )}
        </div>
      </MobileSheet>
    </div>
  );
}

function StatusPill({
  label,
  fullLabel,
  active,
  activeClass,
  onClick,
  disabled,
}: {
  label: string;
  fullLabel: string;
  active: boolean;
  activeClass: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={fullLabel}
      title={fullLabel}
      className={cn(
        "inline-flex items-center justify-center min-w-9 h-9 rounded-full text-xs font-semibold border transition-colors",
        active
          ? activeClass
          : "bg-transparent text-ink-500 border-[hsl(var(--surface-stroke))] hover:bg-ink-400/10",
        disabled && "opacity-60 cursor-not-allowed",
      )}
    >
      {/* Letters up to md, full words from md — three word-pills plus the name,
          roll line and chevron overflow the sm-to-md band. */}
      <span className="md:hidden">{label}</span>
      <span className="hidden md:inline px-2">{fullLabel}</span>
    </button>
  );
}

const RECORDED_TONE: Record<string, string> = {
  present: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
  absent: "bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300",
  leave: "bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-300",
  sick: "bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-300",
  casual: "bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-300",
  holiday: "bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300",
};
const RECORDED_LABEL: Record<string, string> = {
  present: "Present",
  absent: "Absent",
  leave: "On leave",
  sick: "Sick",
  casual: "Casual",
  holiday: "Holiday",
};

/** Read-only status chip for view-only dates — shows what was actually recorded. */
function RecordedStatusPill({ status }: { status: AttendanceStatus | null }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide",
        status
          ? RECORDED_TONE[status] ?? "bg-ink-400/15 text-ink-600"
          : "bg-ink-400/15 text-ink-600 dark:text-ink-300",
      )}
    >
      {status ? RECORDED_LABEL[status] ?? status : "Not marked"}
    </span>
  );
}
