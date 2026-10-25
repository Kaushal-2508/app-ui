import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Loader2, Users } from "lucide-react";

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
import { MobileSheet } from "@/components/shared/sheets";
import type { SearchableSelectOption } from "@/components/ui/searchable-select";
import { useNoticeClassStaffPerClass } from "@/hooks/notices";
import { sortClassRows } from "@/lib/classSort";
import { formatClassName } from "@/lib/utils";
import { formatPTMDate, type PTMHat } from "@/lib/ptm";
import {
  classSessionErrors,
  classSessionsPayload,
  draftsFromSessions,
  type ClassSessionDraft,
  type MeetingHours,
} from "@/lib/ptmClassSessions";
import {
  usePTMManageableScope,
  usePTMOnlineTeacherOptions,
  usePTMTeacherBusyWindows,
  useSetPTMOnlineClassSessions,
  type PTMOnlineSession,
  type PTMSchedule,
} from "@/hooks/ptm";
import { ClassSessionsEditor } from "./ClassSessionBox";

/**
 * Change the classes, hours and teachers of an admin-made online PTM after
 * it exists (probe level `sessions` only). The same boxes as the create
 * form, seeded from the current sessions; saved as ONE replacement list that
 * `set_ptm_online_class_sessions` diffs in a single transaction. A class or
 * teacher with bookings, or hours that would strand a booking, is kept and
 * named by the server. Students are not edited here: each session's teachers
 * pick them (Edit on the PTM), or Swap hands a whole session over.
 */
export function ClassSessionsSheet({
  ptm,
  hat,
  sessions,
  sessionsReady,
  open,
  onOpenChange,
  onSetGoogleEmail,
}: {
  ptm: PTMSchedule;
  hat: PTMHat;
  sessions: PTMOnlineSession[];
  /** The sessions query has loaded: only then are the boxes seeded and Save
   *  allowed (seeding from a still-empty list and saving would remove every
   *  class and teacher; Tushar's review, 2026-10-07). */
  sessionsReady: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSetGoogleEmail?: (teacherId: string, name: string) => void;
}) {
  const scope = usePTMManageableScope(hat, open);
  const teacherOptions = usePTMOnlineTeacherOptions(hat, open);
  const busy = usePTMTeacherBusyWindows(ptm.scheduled_date, ptm.id, open);
  const save = useSetPTMOnlineClassSessions();
  const [drafts, setDrafts] = useState<ClassSessionDraft[]>([]);
  const [confirmRemove, setConfirmRemove] = useState(false);

  // Seed once per opening, and only once the sessions have loaded; a refetch
  // while the sheet is up keeps the edits.
  const seeded = useRef(false);
  useEffect(() => {
    if (!open) {
      seeded.current = false;
      setConfirmRemove(false);
      return;
    }
    if (seeded.current || !sessionsReady) return;
    seeded.current = true;
    setDrafts(draftsFromSessions(sessions));
  }, [open, sessions, sessionsReady]);

  const meeting: MeetingHours = {
    startTime: ptm.start_time.slice(0, 5),
    endTime: ptm.end_time.slice(0, 5),
    slotDurationMinutes: ptm.slot_duration_minutes,
    slotBufferMinutes: ptm.slot_buffer_minutes,
  };

  const classOptions = useMemo<SearchableSelectOption[]>(
    () =>
      sortClassRows(scope.data?.classes ?? [], (c) => c.name, (c) => c.section).map((c) => ({
        value: c.id,
        label: formatClassName(c.name, c.section),
      })),
    [scope.data],
  );
  const labelById = useMemo(() => {
    const m = new Map(classOptions.map((o) => [o.value, o.label]));
    // A class in the PTM but outside the hat's current scope still needs a name.
    for (const s of sessions) if (s.class_id && s.class_name && !m.has(s.class_id)) m.set(s.class_id, formatClassName(s.class_name, s.class_section ?? null));
    return m;
  }, [classOptions, sessions]);
  const classLabel = (id: string) => labelById.get(id) ?? "Class";
  const teacherName = (id: string) =>
    teacherOptions.data?.find((t) => t.teacher_id === id)?.full_name ??
    sessions.find((s) => s.teacher_id === id)?.teacher_name ??
    "A teacher";

  const staff = useNoticeClassStaffPerClass(drafts.map((d) => d.classId));
  // Cheap enough to compute on every render (a handful of boxes).
  const issues = classSessionErrors(drafts, meeting, {
    date: ptm.scheduled_date,
    busy: busy.data ?? [],
    teachersOf: (id) => staff.teachersOf[id]?.map((t) => ({ id: t.user_id })),
    classLabel,
    teacherName,
  });

  const original = useMemo(() => JSON.stringify(classSessionsPayload(draftsFromSessions(sessions))), [sessions]);
  const payload = classSessionsPayload(drafts);
  const changed = seeded.current && JSON.stringify(payload) !== original;
  // Every (class, teacher) place the save drops, split by whether the server
  // will keep it (bookings) or really remove it (and its picked students).
  const removing = sessions.filter(
    (s) => !drafts.some((d) => d.classId === s.class_id && d.teacherIds.includes(s.teacher_id)),
  );
  const removingBooked = removing.filter((s) => s.booked_count > 0);
  const removingFree = removing.filter((s) => s.booked_count === 0);
  const removedClasses = [...new Set(removing.map((s) => s.class_id).filter((id): id is string => !!id && !drafts.some((d) => d.classId === id)))];
  const studentsLosingPlace = removingFree.reduce((n, s) => n + s.student_count, 0);

  const doSave = () => {
    if (!changed || save.isPending || issues.length > 0 || drafts.length === 0) return;
    setConfirmRemove(false);
    save.mutate({ ptmId: ptm.id, classSessions: payload }, { onSuccess: () => onOpenChange(false) });
  };
  // A save that drops a class or a teacher asks first, naming what goes.
  const submit = () => (removingFree.length > 0 ? setConfirmRemove(true) : doSave());

  return (
    <>
    <MobileSheet
      open={open}
      onOpenChange={(next) => !save.isPending && onOpenChange(next)}
      title="Classes and teachers"
      subtitle={`${ptm.title}, ${formatPTMDate(ptm.scheduled_date)}`}
      icon={<Users className="h-5 w-5" />}
      desktopWidth="md"
      primaryAction={{
        label: "Save changes",
        onClick: submit,
        loading: save.isPending,
        disabled: !sessionsReady || !changed || save.isPending || issues.length > 0 || drafts.length === 0 || staff.anyLoading,
      }}
      secondaryAction={{ label: "Cancel", onClick: () => onOpenChange(false), disabled: save.isPending }}
    >
      <div className="space-y-4">
        <p className="text-sm text-ink-600">
          New teachers pick their own students afterwards. A teacher whose families have booked stays; swap them instead.
        </p>
        <ClassSessionsEditor
          hat={hat}
          classOptions={classOptions}
          classesLoading={scope.isLoading}
          classesError={scope.isError}
          drafts={drafts}
          onChange={setDrafts}
          issues={issues}
          meeting={meeting}
          date={ptm.scheduled_date}
          busy={busy.data ?? []}
          teacherOptions={teacherOptions.data}
          teacherOptionsLoading={teacherOptions.isLoading}
          teacherOptionsError={teacherOptions.isError}
          onRetryTeacherOptions={() => void teacherOptions.refetch()}
          staff={staff}
          classLabel={classLabel}
          onSetGoogleEmail={onSetGoogleEmail}
        />
        {removingBooked.length > 0 && (
          <p className="flex items-start gap-2 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-500/25 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              {removingBooked.map((s) => `${s.teacher_name} (${classLabel(s.class_id ?? "")})`).join(", ")}{" "}
              {removingBooked.length === 1 ? "has" : "have"} bookings, so the server will keep{" "}
              {removingBooked.length === 1 ? "them" : "them all"} and say so.
            </span>
          </p>
        )}
      </div>
    </MobileSheet>

    <AlertDialog open={confirmRemove} onOpenChange={(next) => !save.isPending && setConfirmRemove(next)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {removedClasses.length > 0
              ? `Remove ${removedClasses.length === 1 ? classLabel(removedClasses[0]) : `${removedClasses.length} classes`} from this PTM?`
              : `Remove ${removingFree.length === 1 ? removingFree[0].teacher_name : `${removingFree.length} teachers`} from this PTM?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {removedClasses.length > 0 && `${removedClasses.map(classLabel).join(", ")} ${removedClasses.length === 1 ? "leaves" : "leave"} the PTM with ${removedClasses.length === 1 ? "its" : "their"} teachers. `}
            {removedClasses.length === 0 && `${removingFree.map((s) => `${s.teacher_name} (${classLabel(s.class_id ?? "")})`).join(", ")} ${removingFree.length === 1 ? "leaves" : "leave"}. `}
            {studentsLosingPlace > 0
              ? `${studentsLosingPlace} ${studentsLosingPlace === 1 ? "student loses" : "students lose"} their place and ${studentsLosingPlace === 1 ? "that family is" : "those families are"} told the meeting was removed.`
              : "No student had been picked there yet."}
            {removingBooked.length > 0 && ` ${removingBooked.map((s) => s.teacher_name).join(", ")} ${removingBooked.length === 1 ? "has" : "have"} bookings and will be kept.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={save.isPending}>Keep them</AlertDialogCancel>
          <AlertDialogAction
            disabled={save.isPending}
            onClick={(e) => {
              e.preventDefault();
              doSave();
            }}
          >
            {save.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Remove and save
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
