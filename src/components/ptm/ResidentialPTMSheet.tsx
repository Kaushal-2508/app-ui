import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarCheck, Clock, FileText, Loader2, Pencil, Plus, Users, Video } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SearchableSelectOption } from "@/components/ui/searchable-select";
import { Textarea } from "@/components/ui/textarea";
import { MobileSheet } from "@/components/shared/sheets";
import { useAuth } from "@/hooks/useAuth";
import { useNoticeClassStaffPerClass } from "@/hooks/notices";
import { sortClassRows } from "@/lib/classSort";
import { formatClassName } from "@/lib/utils";
import {
  PTM_ONLINE_DEFAULTS,
  buildSlotGrid,
  formatPTMDate,
  formatTimeRange,
  isPtmTeacherBusyError,
  isPtmTeacherNoGoogleError,
  ptmBookingWindowOpen,
  timeToMinutes,
  type PTMHat,
} from "@/lib/ptm";
import {
  classSessionErrors,
  classSessionsPayload,
  flattenForLegacyServer,
  type ClassSessionDraft,
  type MeetingHours,
} from "@/lib/ptmClassSessions";
import {
  useCreateOnlinePTM,
  useMyGoogleEmail,
  usePTMManageableScope,
  usePTMOnlinePickOptions,
  usePTMOnlinePickOptionsBySession,
  usePTMOnlineSessions,
  usePTMOnlineTeacherOptions,
  usePTMSchemaReady,
  usePTMTeacherBusyWindows,
  useSetPTMOnlineStudents,
  useUpdatePTM,
  type PTMOnlineSession,
  type PTMSchedule,
} from "@/hooks/ptm";
import { FormSection, SettingRow } from "./formParts";
import { EDIT_WINDOWS, withCurrent } from "./formOptions";
import { GoogleEmailSheet } from "./GoogleEmailSheet";
import { OnlineTimingFields, type OnlineTimingValue } from "./OnlineTimingFields";
import { ResidentialStudentPicker } from "./ResidentialStudentPicker";
import { ClassSessionsEditor } from "./ClassSessionBox";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  institutionId: string;
  hat: PTMHat;
  /** Editing an existing online PTM: one step. */
  ptm?: PTMSchedule | null;
  /** Editing as a participating teacher who may not change the PTM itself
   *  (an admin made it): only the Students section shows. */
  studentsOnly?: boolean;
  onSaved?: (ptmId: string) => void;
}

type Step = "who" | "when";

interface ResidentialForm {
  /** Admin or coordinator: one session per chosen class (hours, teachers).
   *  Empty in the teacher flow and on edit. */
  classSessions: ClassSessionDraft[];
  /** Teacher flow: the students they picked (create) or have (edit, flat PTM). */
  studentIds: string[];
  /** Teacher edit of a PTM with class sessions: my list per class session. */
  sessionStudents: Record<string, string[]>;
  title: string;
  description: string;
  scheduledDate: string;
  startTime: string;
  endTime: string;
  slotDurationMinutes: number;
  slotBufferMinutes: number;
  bookingCutoffMinutes: number;
  feedbackEditDays: number;
}

function emptyForm(): ResidentialForm {
  return {
    classSessions: [],
    studentIds: [],
    sessionStudents: {},
    title: "",
    description: "",
    scheduledDate: "",
    startTime: "",
    endTime: "",
    slotDurationMinutes: PTM_ONLINE_DEFAULTS.slotDurationMinutes,
    slotBufferMinutes: PTM_ONLINE_DEFAULTS.slotBufferMinutes,
    bookingCutoffMinutes: PTM_ONLINE_DEFAULTS.bookingCutoffMinutes,
    feedbackEditDays: PTM_ONLINE_DEFAULTS.feedbackEditDays,
  };
}

function formFrom(ptm: PTMSchedule): ResidentialForm {
  return {
    classSessions: [],
    studentIds: [],
    sessionStudents: {},
    title: ptm.title,
    description: ptm.description ?? "",
    scheduledDate: ptm.scheduled_date,
    startTime: ptm.start_time.slice(0, 5),
    endTime: ptm.end_time.slice(0, 5),
    slotDurationMinutes: ptm.slot_duration_minutes,
    slotBufferMinutes: ptm.slot_buffer_minutes,
    bookingCutoffMinutes: ptm.booking_cutoff_minutes,
    feedbackEditDays: ptm.feedback_edit_days,
  };
}

/** The session rows grouped the way the read-only edit list shows them:
 *  per class when the server sends classes, else one line per teacher. */
function groupSessions(rows: PTMOnlineSession[]): { key: string; title: string; hours: string | null; detail: string }[] {
  const byClass = new Map<string, PTMOnlineSession[]>();
  for (const r of rows) {
    const k = r.class_session_id ?? r.class_id ?? `t-${r.teacher_id}`;
    byClass.set(k, [...(byClass.get(k) ?? []), r]);
  }
  return [...byClass.entries()].map(([key, list]) => {
    const first = list[0];
    const students = list.reduce((n, r) => n + r.student_count, 0);
    const booked = list.reduce((n, r) => n + r.booked_count, 0);
    return {
      key,
      title: first.class_name ? formatClassName(first.class_name, first.class_section ?? null) : first.teacher_name,
      hours: first.start_time && first.end_time ? formatTimeRange(first.start_time, first.end_time) : null,
      detail: `${first.class_name ? `${list.map((r) => r.teacher_name).join(", ")} · ` : ""}${students} ${students === 1 ? "student" : "students"}, ${booked} booked`,
    };
  });
}

/**
 * Create or edit an online PTM (the "Online PTM" option; the code keeps the
 * older "residential" name). Two steps on create. A teacher picks students,
 * then the time. An admin or coordinator sets the time first, then the
 * classes: one box per class with its hours and teachers (class sessions,
 * 2026-10-06), because the busy check needs the date. The whole thing is one
 * server transaction (create_online_ptm). Editing: words and time in the Edit
 * sheet; a teacher's student list in the students-only sheet behind its own
 * Students button (moved into Edit on 2026-10-06, back out on 2026-10-09:
 * "give a separate button instead of edit").
 */
export function ResidentialPTMSheet({ open, onOpenChange, institutionId, hat, ptm, studentsOnly = false, onSaved }: Props) {
  const isEdit = !!ptm;
  const teacherFlow = hat === "teacher";
  const { user } = useAuth();
  // Class sessions need the server half (spec 2026-10-06); below that level
  // the boxes are flattened into today's payload.
  const probe = usePTMSchemaReady(open && !teacherFlow);
  const sessionsReady = probe.sessionsReady;

  const firstStep: Step = teacherFlow ? "who" : "when";
  const [step, setStep] = useState<Step>(firstStep);
  const [form, setForm] = useState<ResidentialForm>(emptyForm);
  const [dirty, setDirty] = useState(false);
  const [googleFor, setGoogleFor] = useState<{ id: string; name: string; self: boolean } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  // The optional description starts folded into an "Add a description" link.
  const [showDescription, setShowDescription] = useState(false);
  useEffect(() => {
    if (!open) setShowDescription(false);
  }, [open]);

  const create = useCreateOnlinePTM();
  const update = useUpdatePTM();
  const setStudents = useSetPTMOnlineStudents();
  const pending = create.isPending || update.isPending || setStudents.isPending;

  const sessions = usePTMOnlineSessions(ptm?.id ?? null, open && isEdit);
  // Teacher edit of a PTM with class sessions (probe level `sessions`): one
  // student list per class session I am in; the server scopes each to its
  // class. A flat PTM (teacher-made, or older) keeps the single list.
  // The student list is edited ONLY in the students-only sheet (Naman,
  // 2026-10-09: "for selecting students give a separate button instead of
  // edit"); the Edit sheet of a teacher-made PTM holds the details alone.
  const studentEdit = isEdit && teacherFlow && studentsOnly;
  const mySessionRows = useMemo(
    () => (studentEdit ? (sessions.data ?? []).filter((s) => s.is_me && !!s.class_session_id) : []),
    [studentEdit, sessions.data],
  );
  const perSession = mySessionRows.length > 0;
  const sessionPicks = usePTMOnlinePickOptionsBySession(
    perSession && ptm ? ptm.id : null,
    mySessionRows.map((s) => s.class_session_id as string),
  );
  // Teacher flow: every student of the classes they teach; on edit of a flat
  // PTM, the same list for this PTM (mine / taken / booked). Waits for the
  // session rows on edit so a class-session PTM never fetches the flat list.
  const pick = usePTMOnlinePickOptions(
    isEdit ? ptm.id : null,
    open && teacherFlow && (!isEdit || (studentsOnly && sessions.isSuccess && !perSession)),
  );
  // Admin flow: the hat's classes, its teacher list (names, Google flag),
  // each chosen class's staff, and who is busy that day.
  const manageable = usePTMManageableScope(hat, open && !isEdit && !teacherFlow);
  const teacherOptions = usePTMOnlineTeacherOptions(hat, open && !isEdit && !teacherFlow);
  const classIds = useMemo(() => form.classSessions.map((s) => s.classId), [form.classSessions]);
  const staff = useNoticeClassStaffPerClass(teacherFlow || isEdit ? [] : classIds);
  const busy = usePTMTeacherBusyWindows(
    form.scheduledDate || null,
    ptm?.id ?? null,
    open && !isEdit && !teacherFlow && !!form.scheduledDate,
  );
  // A teacher's Meet account is their login email unless they set another.
  const myGoogle = useMyGoogleEmail(user?.id ?? null, open && !isEdit && teacherFlow);

  // Reset when the sheet OPENS, never on a refetch while it is up.
  const wasOpen = useRef(false);
  const seededStudents = useRef(false);
  const seededSessions = useRef<Set<string>>(new Set());
  // What each session's list was when it was seeded, so a save can be applied
  // as MY adds and removes on top of whatever the server holds by then
  // (replacing it with a stale copy threw away picks made elsewhere in the
  // meantime: Tushar's review, 2026-10-07).
  const seedSnapshot = useRef<Record<string, Set<string>>>({});
  useEffect(() => {
    if (open && !wasOpen.current) {
      setForm(ptm ? formFrom(ptm) : emptyForm());
      setStep(firstStep);
      setDirty(false);
      seededStudents.current = false;
      seededSessions.current = new Set();
      seedSnapshot.current = {};
    }
    wasOpen.current = open;
  }, [open, ptm, firstStep]);

  // Edit, teacher: tick the students already mine, once per opening (and
  // once per class session); a refetch while the sheet is up must not wipe
  // the edits.
  useEffect(() => {
    if (!open || !studentEdit || seededStudents.current || !pick.data) return;
    seededStudents.current = true;
    const mine = pick.data.filter((r) => r.state === "mine").map((r) => r.student_id);
    setForm((f) => ({ ...f, studentIds: mine }));
  }, [open, studentEdit, pick.data]);
  useEffect(() => {
    if (!open || !perSession) return;
    const fresh: Record<string, string[]> = {};
    for (const s of mySessionRows) {
      const id = s.class_session_id as string;
      const rows = sessionPicks[id]?.data;
      if (!rows || seededSessions.current.has(id)) continue;
      seededSessions.current.add(id);
      fresh[id] = rows.filter((r) => r.state === "mine").map((r) => r.student_id);
      seedSnapshot.current[id] = new Set(fresh[id]);
    }
    if (Object.keys(fresh).length > 0) setForm((f) => ({ ...f, sessionStudents: { ...f.sessionStudents, ...fresh } }));
  }, [open, perSession, mySessionRows, sessionPicks]);

  const set = <K extends keyof ResidentialForm>(key: K, value: ResidentialForm[K]) => {
    setDirty(true);
    setForm((f) => ({ ...f, [key]: value }));
  };
  // The timing fields know only their own keys, a subset of the form's.
  const setTiming = <K extends keyof OnlineTimingValue>(key: K, value: OnlineTimingValue[K]) => {
    setDirty(true);
    setForm((f) => ({ ...f, [key]: value }));
  };

  const timeError = useMemo(() => {
    if (!form.startTime || !form.endTime) return null;
    if (timeToMinutes(form.endTime) <= timeToMinutes(form.startTime)) {
      return "The end time must be after the start time.";
    }
    const slots = buildSlotGrid(form.startTime, form.endTime, form.slotDurationMinutes, form.slotBufferMinutes);
    if (slots.length === 0) return "The meeting is shorter than one slot.";
    return null;
  }, [form.startTime, form.endTime, form.slotDurationMinutes, form.slotBufferMinutes]);

  // Online booking stays open per slot until the meeting ends; a PTM already
  // over could never be booked (the server refuses too).
  const bookingError = useMemo(() => {
    if (!form.scheduledDate || !form.startTime || !form.endTime) return null;
    const touches =
      !ptm || form.scheduledDate !== ptm.scheduled_date || form.startTime !== ptm.start_time.slice(0, 5);
    if (!touches) return null;
    const openNow = ptmBookingWindowOpen({
      scheduled_date: form.scheduledDate,
      start_time: form.startTime,
      end_time: form.endTime,
      status: "scheduled",
      booking_cutoff_minutes: form.bookingCutoffMinutes,
      mode: "online",
    });
    return openNow
      ? null
      : "This meeting would already be over, so no family could book a slot. Pick a later time.";
  }, [ptm, form.scheduledDate, form.startTime, form.endTime, form.bookingCutoffMinutes]);

  // ---- Admin flow: the class sessions ----
  const meeting: MeetingHours = {
    startTime: form.startTime,
    endTime: form.endTime,
    slotDurationMinutes: form.slotDurationMinutes,
    slotBufferMinutes: form.slotBufferMinutes,
  };
  const classOptions = useMemo<SearchableSelectOption[]>(
    () =>
      sortClassRows(manageable.data?.classes ?? [], (c) => c.name, (c) => c.section).map((c) => ({
        value: c.id,
        label: formatClassName(c.name, c.section),
      })),
    [manageable.data],
  );
  const labelById = useMemo(() => new Map(classOptions.map((o) => [o.value, o.label])), [classOptions]);
  const classLabel = (id: string) => labelById.get(id) ?? "Class";
  const teacherName = (id: string) => teacherOptions.data?.find((t) => t.teacher_id === id)?.full_name ?? "A teacher";
  // Everything that blocks Create, per box: hours, nobody assigned, nobody
  // picked, a teacher in two boxes at once, a teacher busy elsewhere. Cheap
  // enough to compute on every render.
  const issues =
    teacherFlow || isEdit || timeError
      ? []
      : classSessionErrors(form.classSessions, meeting, {
          date: form.scheduledDate,
          busy: busy.data ?? [],
          teachersOf: (id) => staff.teachersOf[id]?.map((t) => ({ id: t.user_id })),
          classLabel,
          teacherName,
        });
  // Today's server has no class sessions: the boxes become a flat teacher
  // list with own hours, and a teacher in two boxes gets a note.
  const flat = teacherFlow || isEdit ? null : flattenForLegacyServer(form.classSessions, meeting, teacherName, classLabel);

  // ---- Teacher edit: the student list ----
  const mine = useMemo(
    () => new Set((pick.data ?? []).filter((r) => r.state === "mine").map((r) => r.student_id)),
    [pick.data],
  );
  // Which class sessions' lists differ from the server's (per-session edit).
  const changedSessions = useMemo(() => {
    if (!perSession) return [] as string[];
    return mySessionRows
      .map((s) => s.class_session_id as string)
      .filter((id) => {
        const rows = sessionPicks[id]?.data;
        if (!rows) return false;
        const current = form.sessionStudents[id] ?? [];
        const was = new Set(rows.filter((r) => r.state === "mine").map((r) => r.student_id));
        return was.size !== current.length || current.some((sid) => !was.has(sid));
      });
  }, [perSession, mySessionRows, sessionPicks, form.sessionStudents]);
  const studentsChanged = perSession
    ? changedSessions.length > 0
    : studentEdit &&
      !!pick.data &&
      (mine.size !== form.studentIds.length || form.studentIds.some((id) => !mine.has(id)));
  const removingBooked = perSession
    ? mySessionRows.flatMap((s) => {
        const id = s.class_session_id as string;
        const current = form.sessionStudents[id] ?? [];
        return (sessionPicks[id]?.data ?? []).filter((r) => r.state === "mine" && r.booked && !current.includes(r.student_id));
      })
    : isEdit && teacherFlow
      ? (pick.data ?? []).filter((r) => r.state === "mine" && r.booked && !form.studentIds.includes(r.student_id))
      : [];
  const scheduleChanged =
    !!ptm &&
    !studentsOnly &&
    (form.title !== ptm.title ||
      form.description !== (ptm.description ?? "") ||
      form.scheduledDate !== ptm.scheduled_date ||
      form.startTime !== ptm.start_time.slice(0, 5) ||
      form.endTime !== ptm.end_time.slice(0, 5) ||
      form.slotDurationMinutes !== ptm.slot_duration_minutes ||
      form.bookingCutoffMinutes !== ptm.booking_cutoff_minutes ||
      form.feedbackEditDays !== ptm.feedback_edit_days);

  const usesLoginEmail = teacherFlow && !isEdit && myGoogle.isSuccess && !myGoogle.data && !!user?.email;

  const whenValid =
    form.title.trim().length > 0 &&
    !!form.scheduledDate &&
    !!form.startTime &&
    !!form.endTime &&
    !timeError &&
    !bookingError;
  const whoValid = teacherFlow
    ? form.studentIds.length > 0
    : form.classSessions.length > 0 && issues.length === 0 && !staff.anyLoading;
  const editChanged = studentsChanged || scheduleChanged;
  const canSubmit = !pending && (isEdit ? editChanged && (studentsOnly || whenValid) : whenValid && whoValid);

  const submitEdit = () => {
    if (!ptm || !canSubmit) return;
    setConfirmRemove(false);
    const finish = () => {
      onSaved?.(ptm.id);
      onOpenChange(false);
    };
    const saveSchedule = () =>
      update.mutate(
        {
          ptmId: ptm.id,
          title: form.title,
          description: form.description,
          venue: "",
          scheduledDate: form.scheduledDate,
          startTime: form.startTime,
          endTime: form.endTime,
          slotBookingEnabled: true,
          slotDurationMinutes: form.slotDurationMinutes,
          bookingCutoffMinutes: form.bookingCutoffMinutes,
          feedbackEditDays: form.feedbackEditDays,
        },
        { onSuccess: finish },
      );
    // Two independent facts, each its own server transaction; a failure in
    // the first leaves the sheet open with the hook's toast, nothing half
    // done (each student list is diffed whole by set_ptm_online_students).
    if (studentsChanged) {
      if (perSession) {
        // One call per class session whose list changed, in order; the hook
        // toasts each result and the first failure stops the chain.
        void (async () => {
          try {
            for (const id of changedSessions) {
              // Fresh server list first, then my adds and removes on top of it.
              const current = form.sessionStudents[id] ?? [];
              const was = seedSnapshot.current[id] ?? new Set<string>();
              const added = current.filter((sid) => !was.has(sid));
              const removed = new Set([...was].filter((sid) => !current.includes(sid)));
              const freshRows = await sessionPicks[id]?.refetch();
              const freshMine = (freshRows ?? []).filter((r) => r.state === "mine").map((r) => r.student_id);
              const merged = [...freshMine.filter((sid) => !removed.has(sid)), ...added.filter((sid) => !freshMine.includes(sid))];
              await setStudents.mutateAsync({ ptmId: ptm.id, studentIds: merged, classSessionId: id });
            }
          } catch {
            return;
          }
          if (scheduleChanged) saveSchedule();
          else finish();
        })();
        return;
      }
      setStudents.mutate(
        { ptmId: ptm.id, studentIds: form.studentIds },
        { onSuccess: () => (scheduleChanged ? saveSchedule() : finish()) },
      );
      return;
    }
    saveSchedule();
  };

  const submitCreate = () => {
    if (!canSubmit || isEdit) return;
    create.mutate(
      {
        institutionId,
        hat,
        title: form.title,
        description: form.description,
        scheduledDate: form.scheduledDate,
        startTime: form.startTime,
        endTime: form.endTime,
        slotDurationMinutes: form.slotDurationMinutes,
        slotBufferMinutes: form.slotBufferMinutes,
        bookingCutoffMinutes: form.bookingCutoffMinutes,
        feedbackEditDays: form.feedbackEditDays,
        // The union of the boxes' teachers; the server with class sessions
        // ignores it in favour of _class_sessions.
        teacherIds: teacherFlow ? null : (flat?.teacherIds ?? []),
        teacherWindows: teacherFlow || sessionsReady ? undefined : flat?.teacherWindows,
        studentIds: teacherFlow ? form.studentIds : null,
        ...(teacherFlow || !sessionsReady ? {} : { classSessions: classSessionsPayload(form.classSessions) }),
      },
      {
        onSuccess: (id) => {
          onSaved?.(id);
          onOpenChange(false);
        },
        onError: (e) => {
          // Someone else booked that teacher since the boxes loaded: refresh
          // the busy windows so the box greys them and says why.
          if (isPtmTeacherBusyError(e) && !teacherFlow) void busy.refetch();
          if (isPtmTeacherNoGoogleError(e) && !teacherFlow) void teacherOptions.refetch();
        },
      },
    );
  };

  const durationLocked = isEdit && !teacherFlow && (sessions.data ?? []).some((s) => s.booked_count > 0);
  const editWindowOptions = withCurrent(EDIT_WINDOWS, form.feedbackEditDays, (v) => ({
    value: v,
    label: `${v} ${v === 1 ? "day" : "days"} after it ends`,
  }));

  const pickedCount = form.studentIds.length;
  const pickedClasses = useMemo(() => {
    const chosen = new Set(form.studentIds);
    return new Set((pick.data ?? []).filter((r) => chosen.has(r.student_id)).map((r) => r.class_id)).size;
  }, [pick.data, form.studentIds]);
  const slotCount = timeError || !form.startTime || !form.endTime ? 0 : buildSlotGrid(form.startTime, form.endTime, form.slotDurationMinutes, form.slotBufferMinutes).length;

  const onFirstStep = step === firstStep;
  const subtitle = isEdit
    ? ptm?.title
    : teacherFlow
      ? step === "who"
        ? "Step 1 of 2: Students"
        : "Step 2 of 2: Date and time"
      : step === "when"
        ? "Step 1 of 2: Date and time"
        : "Step 2 of 2: Classes and teachers";

  const primary = isEdit
    ? {
        label: "Save changes",
        onClick: () => (removingBooked.length > 0 ? setConfirmRemove(true) : submitEdit()),
        loading: pending,
        disabled: !canSubmit,
      }
    : onFirstStep
      ? {
          label: teacherFlow ? "Next: date and time" : "Next: classes and teachers",
          onClick: () => setStep(teacherFlow ? "when" : "who"),
          disabled: teacherFlow ? !whoValid : !whenValid,
        }
      : {
          label: "Schedule online PTM",
          onClick: submitCreate,
          loading: pending,
          disabled: !canSubmit,
        };
  const secondary =
    !isEdit && !onFirstStep
      ? { label: "Back", onClick: () => setStep(firstStep), disabled: pending }
      : { label: "Cancel", onClick: () => onOpenChange(false), disabled: pending };

  const showStudents = teacherFlow && (isEdit ? studentsOnly : step === "who");
  const showTiming = isEdit ? !studentsOnly : step === "when";
  const showClasses = !isEdit && !teacherFlow && step === "who";

  return (
    <>
      <MobileSheet
        open={open}
        onOpenChange={onOpenChange}
        title={isEdit ? (studentsOnly ? "My students" : "Edit online PTM") : "Online PTM"}
        subtitle={subtitle}
        icon={isEdit ? <Pencil className="h-5 w-5" /> : <Video className="h-5 w-5" />}
        desktopWidth="md"
        primaryAction={primary}
        secondaryAction={secondary}
      >
        {/* data-dirty keeps the service worker from reloading a half-filled
            form under the user (CLAUDE.md section 17). */}
        <form
          data-dirty={dirty ? "true" : undefined}
          className="divide-y divide-surface-stroke"
          onSubmit={(e) => {
            e.preventDefault();
            if (primary.disabled) return;
            primary.onClick();
          }}
        >
          {/* ---- Teacher: students (step 1 on create; first on edit) ---- */}
          {showStudents && (
            <FormSection icon={<Users />} tone="violet" title="Students">
              <p className="text-sm text-ink-600">
                {isEdit
                  ? "Tick the students you will meet. A student can be with other teachers of this PTM too; you see who already has them. Unticking a family that has booked cancels their slot with you."
                  : "Pick the students who live away. Their families book a slot with you."}
              </p>
              {isEdit && sessions.isLoading ? (
                <p className="flex items-center gap-2 text-sm text-ink-500">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Loading…
                </p>
              ) : perSession ? (
                // One list per class session I am in: my students within that class.
                <div className="space-y-4">
                  {mySessionRows.map((s) => {
                    const id = s.class_session_id as string;
                    const q = sessionPicks[id];
                    return (
                      <div key={id} className="space-y-2" data-session-students={id}>
                        <p className="text-sm font-medium text-ink-900">
                          {s.class_name ? formatClassName(s.class_name, s.class_section ?? null) : "Class"}
                          {s.start_time && s.end_time && (
                            <span className="font-normal text-ink-500"> · {formatTimeRange(s.start_time, s.end_time)}</span>
                          )}
                        </p>
                        <ResidentialStudentPicker
                          rows={q?.data}
                          isLoading={!!q?.isLoading}
                          isError={!!q?.isError}
                          onRetry={() => q?.refetch()}
                          value={form.sessionStudents[id] ?? []}
                          onChange={(next) => set("sessionStudents", { ...form.sessionStudents, [id]: next })}
                        />
                      </div>
                    );
                  })}
                </div>
              ) : (
                <ResidentialStudentPicker
                  rows={pick.data}
                  isLoading={pick.isLoading}
                  isError={pick.isError}
                  onRetry={() => pick.refetch()}
                  value={form.studentIds}
                  onChange={(next) => set("studentIds", next)}
                />
              )}
            </FormSection>
          )}

          {/* ---- Admin edit: who is in it, read-only (the Overview changes it) ---- */}
          {isEdit && !teacherFlow && !studentsOnly && (
            <FormSection icon={<Users />} tone="violet" title="Classes and teachers">
              {sessions.isLoading ? (
                <p className="flex items-center gap-2 text-sm text-ink-500">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Loading…
                </p>
              ) : sessions.isError ? (
                <p className="text-sm text-ink-600">Couldn't load who is in this PTM.</p>
              ) : (
                <ul className="space-y-1.5 text-sm text-ink-700">
                  {groupSessions(sessions.data ?? []).map((g) => (
                    <li key={g.key}>
                      <span className="font-medium text-ink-900">{g.title}</span>
                      {g.hours && <span className="text-ink-500"> · {g.hours}</span>}
                      <span className="block text-xs text-ink-500">{g.detail}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-ink-500">Change the classes and teachers from the PTM's Overview.</p>
            </FormSection>
          )}

          {/* ---- Date and time (teacher step 2, admin step 1, edit) ---- */}
          {showTiming && (
            <>
              {/* Teacher flow: step 1 as one line, with a way back. */}
              {!isEdit && teacherFlow && (
                <div className="flex items-center justify-between gap-3 pb-3 pt-1 text-sm">
                  <p className="flex min-w-0 items-center gap-2 text-ink-700">
                    <Users className="h-4 w-4 shrink-0 text-ink-500" aria-hidden="true" />
                    <span className="truncate">
                      <span className="font-medium text-ink-900">
                        {pickedCount} {pickedCount === 1 ? "student" : "students"}
                      </span>{" "}
                      across {pickedClasses} {pickedClasses === 1 ? "class" : "classes"}
                    </span>
                  </p>
                  <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0 px-2 text-xs" onClick={() => setStep("who")}>
                    Change
                  </Button>
                </div>
              )}

              <FormSection icon={<FileText />} tone="teal" title="Details">
                <div className="space-y-1.5">
                  <Label htmlFor="rptm-title">Title</Label>
                  <Input
                    id="rptm-title"
                    value={form.title}
                    onChange={(e) => set("title", e.target.value)}
                    placeholder="e.g. Term 1 online PTM"
                    maxLength={120}
                  />
                </div>
                {/* The description is optional and usually empty, so it starts
                    as one small link instead of a tall empty box. */}
                {showDescription || isEdit || form.description.length > 0 ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="rptm-description">Description</Label>
                    <Textarea
                      id="rptm-description"
                      value={form.description}
                      onChange={(e) => set("description", e.target.value)}
                      placeholder="Optional. What families should expect."
                      rows={2}
                      maxLength={1000}
                      className="min-h-0"
                      autoFocus={showDescription && !isEdit}
                    />
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="-ml-2 h-8 gap-1 px-2 text-xs text-ink-600"
                    onClick={() => setShowDescription(true)}
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    Add a description
                  </Button>
                )}
              </FormSection>

              <FormSection icon={<Clock />} tone="sky" title="When">
                <OnlineTimingFields
                  value={form}
                  onChange={setTiming}
                  durationLocked={durationLocked}
                  bufferLocked={isEdit}
                  timeError={timeError}
                />
                {bookingError && <p className="text-sm text-rose-600 dark:text-rose-400">{bookingError}</p>}
                {usesLoginEmail && user && (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted/60 px-3 py-2 text-xs text-ink-600 ring-1 ring-inset ring-surface-stroke">
                    <span className="min-w-0">
                      Meet will use your login email, <span className="font-medium text-ink-900">{user.email}</span>.
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => setGoogleFor({ id: user.id, name: "you", self: true })}
                    >
                      Use another account
                    </Button>
                  </div>
                )}
              </FormSection>

              <FormSection icon={<CalendarCheck />} tone="peach" title="Feedback">
                {/* One row from sm up: the words left, the choice right. */}
                <div className="sm:flex sm:items-center sm:justify-between sm:gap-4">
                  <SettingRow
                    htmlFor="rptm-edit-window"
                    title="Feedback stays open"
                    description="Opens when the meeting starts; families can edit theirs until it closes."
                  />
                  <Select value={String(form.feedbackEditDays)} onValueChange={(v) => set("feedbackEditDays", Number(v))}>
                    <SelectTrigger id="rptm-edit-window" className="mt-2 sm:mt-0 sm:w-52">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {editWindowOptions.map((w) => (
                        <SelectItem key={w.value} value={String(w.value)}>
                          {w.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </FormSection>
            </>
          )}

          {/* ---- Admin step 2: one box per class ---- */}
          {showClasses && (
            <FormSection icon={<Users />} tone="violet" title="Classes and teachers">
              {/* Step 1 in one line; Back returns to it. */}
              <p className="text-xs text-ink-600">
                {formatPTMDate(form.scheduledDate)}, {formatTimeRange(form.startTime, form.endTime)} · {slotCount}{" "}
                {slotCount === 1 ? "slot" : "slots"} of {form.slotDurationMinutes} min
                {form.slotBufferMinutes > 0 ? `, ${form.slotBufferMinutes}-min gap` : ""}
              </p>
              <ClassSessionsEditor
                hat={hat}
                classOptions={classOptions}
                classesLoading={manageable.isLoading}
                classesError={manageable.isError}
                drafts={form.classSessions}
                onChange={(next) => set("classSessions", next)}
                issues={issues}
                meeting={meeting}
                date={form.scheduledDate}
                busy={busy.data ?? []}
                teacherOptions={teacherOptions.data}
                teacherOptionsLoading={teacherOptions.isLoading}
                teacherOptionsError={teacherOptions.isError}
                onRetryTeacherOptions={() => void teacherOptions.refetch()}
                staff={staff}
                classLabel={classLabel}
                onSetGoogleEmail={hat === "admin" ? (id, name) => setGoogleFor({ id, name, self: false }) : undefined}
              />
              {!sessionsReady && flat && flat.notes.length > 0 && (
                <ul className="space-y-1 rounded-xl bg-muted/60 px-3 py-2 text-xs text-ink-600 ring-1 ring-inset ring-surface-stroke">
                  {flat.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              )}
              {form.classSessions.length > 0 && (
                <p className="text-xs text-ink-500">
                  Each teacher then picks their students, from the PTM's Edit. A student can be with more than one teacher.
                </p>
              )}
            </FormSection>
          )}
        </form>
      </MobileSheet>

      {googleFor && (
        <GoogleEmailSheet
          open
          onOpenChange={(next) => !next && setGoogleFor(null)}
          userId={googleFor.id}
          displayName={googleFor.name}
          self={googleFor.self}
        />
      )}

      {/* Unticking a family that has booked cancels their slot: ask first. */}
      <AlertDialog open={confirmRemove} onOpenChange={(next) => !pending && setConfirmRemove(next)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Cancel {removingBooked.length === 1 ? "a booking" : `${removingBooked.length} bookings`}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {removingBooked.length === 1
                ? `${removingBooked[0]?.full_name}'s family has booked a slot with you. Removing them cancels it and tells them.`
                : `${removingBooked.length} of the families you are removing have booked a slot with you. Removing them cancels those bookings and tells them.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Keep them</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                submitEdit();
              }}
            >
              {pending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Remove and save
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
