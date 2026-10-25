import { useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { AlertTriangle, ArrowRightLeft, Loader2, Users } from "lucide-react";

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
import { Label } from "@/components/ui/label";
import { SearchableSelect, type SearchableSelectOption } from "@/components/ui/searchable-select";
import { MobileSheet } from "@/components/shared/sheets";
import { EmptyState } from "@/components/shared/surfaces";
import { formatPTMDate, ptmBusyWindow, windowsOverlap, type PTMHat } from "@/lib/ptm";
import {
  usePTMOnlineTeacherOptions,
  usePTMTeacherBusyWindows,
  useSetPTMOnlineTeachers,
  useSwapPTMOnlineTeacher,
  type PTMBusyWindow,
  type PTMOnlineSession,
  type PTMSchedule,
} from "@/hooks/ptm";
import { ParticipatingTeacherPicker } from "./ParticipatingTeacherPicker";

/**
 * The two admin actions on an online PTM's teachers after it exists:
 * change the list (set_ptm_online_teachers) and hand one teacher's session
 * to another (swap_ptm_online_teacher). Each is one server transaction; the
 * sheets only collect the choice and say what the server did.
 */

function clock(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "" : format(at, "h:mm a");
}

export function ChangeTeachersSheet({
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
  /** The sessions query has loaded: only then is the list seeded and Save
   *  allowed. Seeding from an empty, still-loading list and saving removed
   *  every other teacher (Tushar's review, 2026-10-07). */
  sessionsReady: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSetGoogleEmail?: (teacherId: string, name: string) => void;
}) {
  const options = usePTMOnlineTeacherOptions(hat, open);
  const busy = usePTMTeacherBusyWindows(ptm.scheduled_date, ptm.id, open);
  const save = useSetPTMOnlineTeachers();
  const [value, setValue] = useState<string[]>([]);
  const [confirmRemove, setConfirmRemove] = useState(false);

  // Seed from the current teachers once per opening, and only once they
  // have actually loaded.
  const seeded = useRef(false);
  useEffect(() => {
    if (!open) {
      seeded.current = false;
      setConfirmRemove(false);
      return;
    }
    if (seeded.current || !sessionsReady) return;
    seeded.current = true;
    setValue(sessions.map((s) => s.teacher_id));
  }, [open, sessions, sessionsReady]);

  const current = useMemo(() => new Set(sessions.map((s) => s.teacher_id)), [sessions]);
  const chosen = useMemo(() => new Set(value), [value]);
  const changed = seeded.current && (current.size !== chosen.size || [...chosen].some((id) => !current.has(id)));
  const removing = sessions.filter((s) => !chosen.has(s.teacher_id));
  const removingBooked = removing.filter((s) => s.booked_count > 0);
  // What a save removes for good: the teachers without bookings, and every
  // student they had picked (their families get "meeting removed").
  const removingFree = removing.filter((s) => s.booked_count === 0);
  const studentsLosingPlace = removingFree.reduce((n, s) => n + s.student_count, 0);

  // Teachers being added whose other PTM overlaps this one: the server will
  // refuse them (busy); say so before the round trip.
  const window = useMemo(() => ptmBusyWindow(ptm), [ptm]);
  const names = useMemo(() => new Map((options.data ?? []).map((t) => [t.teacher_id, t.full_name])), [options.data]);
  const conflicts = useMemo<{ id: string; name: string; window: PTMBusyWindow }[]>(() => {
    const out: { id: string; name: string; window: PTMBusyWindow }[] = [];
    for (const b of busy.data ?? []) {
      if (!chosen.has(b.teacher_id) || current.has(b.teacher_id)) continue;
      if (!windowsOverlap(window, { start: new Date(b.starts_at), end: new Date(b.ends_at) })) continue;
      out.push({ id: b.teacher_id, name: names.get(b.teacher_id) ?? "A teacher", window: b });
    }
    return out;
  }, [busy.data, chosen, current, window, names]);

  const doSave = () => {
    if (!changed || save.isPending) return;
    setConfirmRemove(false);
    save.mutate({ ptmId: ptm.id, teacherIds: value }, { onSuccess: () => onOpenChange(false) });
  };
  // A save that removes anyone asks first, naming who and what goes.
  const submit = () => (removingFree.length > 0 ? setConfirmRemove(true) : doSave());

  return (
    <>
    <MobileSheet
      open={open}
      onOpenChange={(next) => !save.isPending && onOpenChange(next)}
      title="Change teachers"
      subtitle={`${ptm.title}, ${formatPTMDate(ptm.scheduled_date)}`}
      icon={<Users className="h-5 w-5" />}
      desktopWidth="md"
      primaryAction={{
        label: "Save teachers",
        onClick: submit,
        loading: save.isPending,
        disabled: !sessionsReady || !changed || save.isPending || value.length === 0 || conflicts.length > 0,
      }}
      secondaryAction={{ label: "Cancel", onClick: () => onOpenChange(false), disabled: save.isPending }}
    >
      <div className="space-y-4">
        <p className="text-sm text-ink-600">
          A teacher whose families have already booked stays on the list; swap them instead. New teachers
          pick their own students afterwards.
        </p>
        <ParticipatingTeacherPicker
          options={options.data}
          busy={busy.data}
          isLoading={options.isLoading}
          isError={options.isError}
          onRetry={() => options.refetch()}
          value={value}
          onChange={setValue}
          onSetGoogleEmail={onSetGoogleEmail}
        />
        {removingBooked.length > 0 && (
          <p className="flex items-start gap-2 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-500/25 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              {removingBooked.map((s) => s.teacher_name).join(", ")}{" "}
              {removingBooked.length === 1 ? "has" : "have"} bookings, so the server will keep{" "}
              {removingBooked.length === 1 ? "them" : "them all"} and say so.
            </span>
          </p>
        )}
        {conflicts.length > 0 && (
          <ul className="space-y-1 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-500/25 dark:text-amber-200">
            {conflicts.map((c) => (
              <li key={`${c.id}-${c.window.ptm_id}`} className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>
                  {c.name} is in "{c.window.title}" {clock(c.window.starts_at)} to {clock(c.window.ends_at)}. Untick
                  them to save.
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </MobileSheet>

    <AlertDialog open={confirmRemove} onOpenChange={(next) => !save.isPending && setConfirmRemove(next)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Remove {removingFree.length === 1 ? removingFree[0].teacher_name : `${removingFree.length} teachers`} from this PTM?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {removingFree.map((s) => s.teacher_name).join(", ")}{" "}
            {removingFree.length === 1 ? "leaves" : "leave"} the PTM.{" "}
            {studentsLosingPlace > 0
              ? `${studentsLosingPlace} ${studentsLosingPlace === 1 ? "student they picked loses" : "students they picked lose"} their place and ${studentsLosingPlace === 1 ? "that family is" : "those families are"} told the meeting was removed.`
              : "They had not picked any students yet."}
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

export function SwapTeacherSheet({
  ptm,
  hat,
  from,
  sessions,
  onClose,
}: {
  ptm: PTMSchedule;
  hat: PTMHat;
  /** The session being handed over; null closes the sheet. */
  from: PTMOnlineSession | null;
  sessions: PTMOnlineSession[];
  onClose: () => void;
}) {
  const open = !!from;
  const options = usePTMOnlineTeacherOptions(hat, open);
  const busy = usePTMTeacherBusyWindows(ptm.scheduled_date, ptm.id, open);
  const swap = useSwapPTMOnlineTeacher();
  const [toId, setToId] = useState<string>("");
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    if (!open) {
      setToId("");
      setConfirm(false);
    }
  }, [open]);

  const inPtm = useMemo(() => new Set(sessions.map((s) => s.teacher_id)), [sessions]);
  const window = useMemo(() => ptmBusyWindow(ptm), [ptm]);
  const busyByTeacher = useMemo(() => {
    const map = new Map<string, PTMBusyWindow>();
    for (const b of busy.data ?? []) {
      if (map.has(b.teacher_id)) continue;
      if (windowsOverlap(window, { start: new Date(b.starts_at), end: new Date(b.ends_at) })) map.set(b.teacher_id, b);
    }
    return map;
  }, [busy.data, window]);

  const selectOptions = useMemo<SearchableSelectOption[]>(
    () =>
      (options.data ?? [])
        .filter((t) => !inPtm.has(t.teacher_id))
        .map((t) => {
          const clash = busyByTeacher.get(t.teacher_id);
          return {
            value: t.teacher_id,
            label: t.full_name,
            description: clash
              ? `Busy ${clock(clash.starts_at)} to ${clock(clash.ends_at)} with "${clash.title}"`
              : !t.has_google_email
                ? "Google account not set; joins with their login email"
                : `${t.class_count} ${t.class_count === 1 ? "class" : "classes"}`,
            // Only a clash blocks; a missing Google account is not a reason
            // (2026-10-05, same rule as the create sheet).
            disabled: !!clash,
          };
        }),
    [options.data, inPtm, busyByTeacher],
  );
  const to = (options.data ?? []).find((t) => t.teacher_id === toId) ?? null;

  const doSwap = () => {
    if (!from || !to || swap.isPending) return;
    swap.mutate(
      { ptmId: ptm.id, fromTeacherId: from.teacher_id, toTeacherId: to.teacher_id, toName: to.full_name },
      {
        onSuccess: () => {
          setConfirm(false);
          onClose();
        },
      },
    );
  };

  return (
    <>
      <MobileSheet
        open={open}
        onOpenChange={(next) => !next && !swap.isPending && onClose()}
        title="Swap teacher"
        subtitle={from ? `${from.teacher_name}'s session` : undefined}
        icon={<ArrowRightLeft className="h-5 w-5" />}
        desktopWidth="md"
        primaryAction={{
          label: to ? `Hand over to ${to.full_name}` : "Hand over",
          onClick: () => setConfirm(true),
          loading: swap.isPending,
          disabled: !to || swap.isPending,
        }}
        secondaryAction={{ label: "Cancel", onClick: onClose, disabled: swap.isPending }}
      >
        <div className="space-y-4">
          {from && (
            <p className="text-sm text-ink-600">
              {from.student_count} {from.student_count === 1 ? "student" : "students"} and {from.booked_count}{" "}
              {from.booked_count === 1 ? "booking" : "bookings"} move to the new teacher, who keeps the same slots
              and the rooms already made. The families are told the teacher changed.
            </p>
          )}
          {options.isLoading ? (
            <p className="flex items-center gap-2 text-sm text-ink-500">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Loading teachers…
            </p>
          ) : options.isError ? (
            <EmptyState
              size="sm"
              icon={<AlertTriangle className="h-7 w-7" />}
              tone="rose"
              reason="error"
              title="Couldn't load the teachers"
              description="Check your connection and try again."
              action={{ label: "Retry", onClick: () => options.refetch() }}
            />
          ) : selectOptions.length === 0 ? (
            <p className="text-sm text-ink-600">No other teacher is available to take this session.</p>
          ) : (
            <div className="space-y-1.5">
              <Label>New teacher</Label>
              <SearchableSelect
                value={toId}
                onValueChange={setToId}
                options={selectOptions}
                placeholder="Choose a teacher"
                searchPlaceholder="Search teachers"
                emptyText="No teacher matches."
              />
            </div>
          )}
        </div>
      </MobileSheet>

      <AlertDialog open={confirm} onOpenChange={(next) => !swap.isPending && setConfirm(next)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hand {from?.teacher_name}'s session to {to?.full_name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {from?.booked_count
                ? `${from.booked_count} ${from.booked_count === 1 ? "family has" : "families have"} booked; they keep their slot and room and are told the teacher changed.`
                : "Nobody has booked yet; the students move over and can book with the new teacher."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={swap.isPending}>Keep {from?.teacher_name}</AlertDialogCancel>
            <AlertDialogAction
              disabled={swap.isPending}
              onClick={(e) => {
                e.preventDefault();
                doSwap();
              }}
            >
              {swap.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Hand over
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
