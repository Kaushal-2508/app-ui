import { useEffect, useMemo, useState } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { formatDistance } from "date-fns";
import {
  AlertTriangle,
  ArrowRightLeft,
  CalendarCheck,
  CheckCircle2,
  GraduationCap,
  Loader2,
  MessageSquare,
  MessageSquareHeart,
  UserPlus,
  Users,
  Video,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { MobileSheet } from "@/components/shared/sheets";
import { EmptyState, ListRow, StatTile, StatTileGrid } from "@/components/shared/surfaces";
import { StudentRemarksPanel } from "@/components/communication/StudentRemarksPanel";
import { formatClassName } from "@/lib/utils";
import {
  buildSlotGrid,
  canEditOwnSession,
  describeEditWindow,
  formatPTMDate,
  formatTimeRange,
  isSlotInProgress,
  ptmEffectiveStatus,
  ptmEndsAt,
  ptmStartsAt,
  sentenceCase,
  slotBounds,
  slotBoundsFrom,
  type PTMHat,
} from "@/lib/ptm";
import {
  usePTMOnlineBookingGrid,
  usePTMOnlineBookingGrids,
  useSetPTMBookingAttended,
  type PTMOnlineSession,
  type PTMOnlineSlotRow,
  type PTMSchedule,
} from "@/hooks/ptm";
import { Fact } from "./Fact";
import { JoinMeetButton } from "./JoinMeetButton";
import { SlotGrid } from "./SlotGrid";

/**
 * The staff detail of an online PTM: the Overview and Bookings tabs that
 * replace the class-based ones. The Feedback tab is shared with in-person
 * PTMs (the classes come from the participants). A teacher's student list
 * is edited from the PTM's Edit sheet since 2026-10-06 (Naman: "no need of
 * edit my students button, just move this to edit").
 */

type Sessions = Pick<UseQueryResult<PTMOnlineSession[]>, "data" | "isLoading" | "isError" | "refetch">;

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

/** The session rows of one class session (probe level `sessions`), or of
 *  the whole PTM when the server sends no classes. */
interface ClassGroup {
  key: string;
  classSessionId: string | null;
  label: string | null;
  hours: string | null;
  rows: PTMOnlineSession[];
  studentCount: number;
  bookedCount: number;
  attendedCount: number;
}

function groupByClass(rows: PTMOnlineSession[]): ClassGroup[] {
  const map = new Map<string, ClassGroup>();
  for (const r of rows) {
    const key = r.class_session_id ?? r.class_id ?? "all";
    const g = map.get(key) ?? {
      key,
      classSessionId: r.class_session_id ?? null,
      label: r.class_name ? formatClassName(r.class_name, r.class_section ?? null) : null,
      hours: r.start_time && r.end_time ? formatTimeRange(r.start_time, r.end_time) : null,
      rows: [],
      studentCount: 0,
      bookedCount: 0,
      attendedCount: 0,
    };
    g.rows.push(r);
    map.set(key, g);
  }
  for (const g of map.values()) {
    // Each row is one teacher's own list.
    g.studentCount = g.rows.reduce((n, r) => n + r.student_count, 0);
    g.bookedCount = g.rows.reduce((n, r) => n + r.booked_count, 0);
    g.attendedCount = g.rows.reduce((n, r) => n + r.attended_count, 0);
  }
  return [...map.values()];
}

/** The Bookings tab's "every class" / "every teacher" pick. */
const ALL = "all";

/** A booked slot in the everyone view, tagged with its teacher. */
type BookedRow = PTMOnlineSlotRow & { teacher_name: string };

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function OnlineOverviewTab({
  ptm,
  hat,
  sessions,
  now,
  canManage,
  onSetGoogleEmail,
  onChangeTeachers,
  onChangeClassSessions,
  onSwapTeacher,
}: {
  ptm: PTMSchedule;
  hat: PTMHat;
  sessions: Sessions;
  now: Date;
  /** canManagePTM: the creator under their hat, or an admin. */
  canManage: boolean;
  /** Opens the Google-account sheet: for yourself, or (admin) for a teacher. */
  onSetGoogleEmail: (teacherId: string, name: string, self: boolean) => void;
  /** Admin or the creating coordinator: change the flat teacher list. */
  onChangeTeachers: () => void;
  /** Same, for a PTM with class sessions (probe level `sessions`). */
  onChangeClassSessions: () => void;
  /** Admin: hand one teacher's session to another. */
  onSwapTeacher: (session: PTMOnlineSession) => void;
}) {
  const rows = useMemo(() => sessions.data ?? [], [sessions.data]);
  const me = rows.find((s) => s.is_me) ?? null;
  const mayEdit = canEditOwnSession(ptm, hat, !!me, now);
  const groups = useMemo(() => groupByClass(rows), [rows]);
  const hasClasses = groups.some((g) => g.label !== null);
  const gap = ptm.slot_buffer_minutes > 0 ? `, ${ptm.slot_buffer_minutes}-min gap` : "";
  // The teacher list is editable until the meeting ends; a teacher-made PTM
  // has exactly one teacher, fixed.
  const status = ptmEffectiveStatus(ptm, now);
  const live = status === "scheduled" || status === "active";
  const canChangeTeachers = canManage && live && ptm.created_as_role !== "teacher";
  const canSwap = hat === "admin" && live;

  // "At a glance" (Naman, 2026-10-06, from a 1500px screen: "too much empty
  // space, add some colours and elements"): the numbers an admin scans for,
  // counted per teacher, plus how far the meeting has run. Slot capacity
  // follows each teacher's own hours.
  const glance = useMemo(() => {
    const slotsOf = (start: string, end: string) =>
      buildSlotGrid(start, end, ptm.slot_duration_minutes, ptm.slot_buffer_minutes).length;
    let capacity = 0;
    for (const g of groups) {
      for (const r of g.rows) capacity += slotsOf(r.start_time ?? ptm.start_time, r.end_time ?? ptm.end_time);
    }
    return {
      teachers: new Set(rows.map((r) => r.teacher_id)).size,
      students: groups.reduce((n, g) => n + g.studentCount, 0),
      booked: groups.reduce((n, g) => n + g.bookedCount, 0),
      attended: groups.reduce((n, g) => n + g.attendedCount, 0),
      capacity,
      perTeacher: slotsOf(ptm.start_time, ptm.end_time),
    };
  }, [rows, groups, ptm.start_time, ptm.end_time, ptm.slot_duration_minutes, ptm.slot_buffer_minutes]);
  const startsAt = ptmStartsAt(ptm);
  const endsAt = ptmEndsAt(ptm);
  const span = Math.max(1, endsAt.getTime() - startsAt.getTime());
  const elapsed = Math.min(Math.max(0, now.getTime() - startsAt.getTime()), span);
  const progressPct = status === "active" ? Math.round((elapsed / span) * 100) : status === "completed" ? 100 : 0;
  const progressLabel =
    status === "active"
      ? `Happening now · ${Math.floor(elapsed / 60_000)} min in`
      : status === "scheduled"
        ? `Starts ${formatDistance(startsAt, now, { addSuffix: true })}`
        : status === "completed"
          ? "Ended"
          : "Cancelled";
  const bookedPct = glance.capacity > 0 ? Math.round((glance.booked / glance.capacity) * 100) : 0;

  const teacherRow = (s: PTMOnlineSession, inClass: boolean) => (
    <ListRow
      key={`${s.class_session_id ?? ""}-${s.teacher_id}`}
      as="li"
      leading={
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-primary/10 text-sm font-semibold text-teal-700 dark:text-teal-300">
          {initials(s.teacher_name) || "?"}
        </span>
      }
      title={
        <span className="flex items-center gap-2">
          <span className="truncate">{s.teacher_name}</span>
          {s.is_me && (
            <Badge variant="secondary" className="shrink-0 text-[10px]">
              You
            </Badge>
          )}
        </span>
      }
      subtitle={
        s.student_count === 0
          ? "No students picked yet"
          : (
              // Two short lines rather than one that truncates at 375px.
              <>
                <span className="block truncate">
                  {plural(s.student_count, "student", "students")} · {s.booked_count} booked · {s.attended_count} attended
                </span>
                {!inClass && s.start_time && s.end_time && (
                  <span className="block truncate">{formatTimeRange(s.start_time, s.end_time)}</span>
                )}
              </>
            )
      }
      trailing={
        <span className="flex items-center gap-1">
          {/* Not a blocker since 2026-10-05: Meet uses the login email
              unless another Google account is set. */}
          {!s.has_google_email &&
            (hat === "admin" || s.is_me ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs text-ink-500"
                onClick={() => onSetGoogleEmail(s.teacher_id, s.is_me ? "you" : s.teacher_name, s.is_me)}
              >
                Login email
              </Button>
            ) : (
              <span className="text-xs text-ink-500">Login email</span>
            ))}
          {/* Swap hands one teacher's students and bookings over. */}
          {canSwap && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs"
              aria-label={`Swap ${s.teacher_name}`}
              onClick={() => onSwapTeacher(s)}
            >
              <ArrowRightLeft className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              Swap
            </Button>
          )}
        </span>
      }
      inlineAction={
        // How far this teacher's list is booked.
        s.student_count > 0 ? (
          <div className="flex w-full items-center gap-2">
            <Progress
              value={Math.min(100, (s.booked_count / s.student_count) * 100)}
              className="h-1.5 flex-1 bg-brand-primary/10"
              aria-label={`${s.booked_count} of ${s.student_count} families booked`}
            />
            <span className="shrink-0 text-[11px] text-ink-500">
              {Math.round(Math.min(100, (s.booked_count / s.student_count) * 100))}% booked
            </span>
          </div>
        ) : undefined
      }
    />
  );

  return (
    // Two columns from lg up: the cards left, "At a glance" right, so a wide
    // screen is not one stretched column. On a phone the glance comes first.
    <div className="grid gap-4 lg:grid-cols-3">
      <aside className="min-w-0 lg:order-last">
        <section className="surface-card frosted-shadow rounded-card space-y-4 p-4 sm:p-5">
          <h3 className="text-base font-semibold text-ink-900">At a glance</h3>
          <div className="rounded-xl bg-gradient-to-br from-brand-primary/15 via-brand-primary/5 to-transparent p-3 ring-1 ring-inset ring-brand-primary/15">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
              <span className="flex items-center gap-1.5 font-medium text-ink-900">
                {status === "active" && (
                  <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" aria-hidden="true" />
                )}
                {progressLabel}
              </span>
              <span className="text-ink-500">{formatTimeRange(ptm.start_time, ptm.end_time)}</span>
            </div>
            <Progress value={progressPct} className="mt-2 h-2 bg-brand-primary/15" aria-label="Meeting progress" />
            <p className="mt-1.5 text-[11px] text-ink-500">
              {formatPTMDate(ptm.scheduled_date)} · {glance.perTeacher} slots of {ptm.slot_duration_minutes} min per teacher
            </p>
          </div>
          {/* A failed teacher list must not read as zeros (Tushar's review,
              2026-10-07): the tiles say N/A and the card below shows the error. */}
          <StatTileGrid cols={2} mdCols={2}>
            <StatTile label="Teachers" value={sessions.isError ? "N/A" : glance.teachers} icon={<Users className="h-4 w-4" />} tone="violet" />
            <StatTile label="Students" value={sessions.isError ? "N/A" : glance.students} icon={<GraduationCap className="h-4 w-4" />} tone="teal" />
            <StatTile label="Booked" value={sessions.isError ? "N/A" : glance.booked} icon={<CalendarCheck className="h-4 w-4" />} tone="mint" />
            <StatTile label="Attended" value={sessions.isError ? "N/A" : glance.attended} icon={<CheckCircle2 className="h-4 w-4" />} tone="peach" />
          </StatTileGrid>
          <div>
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-medium text-ink-900">Slots booked</span>
              <span className="text-ink-500">
                {sessions.isError ? "N/A" : `${glance.booked} of ${glance.capacity} · ${bookedPct}%`}
              </span>
            </div>
            <Progress value={sessions.isError ? 0 : bookedPct} className="mt-1.5 h-1.5 bg-brand-primary/10" aria-label="Slots booked" />
            <p className="mt-1 text-[11px] text-ink-500">Families book until each slot starts, even once the meeting is under way.</p>
          </div>
        </section>
      </aside>

      <div className="min-w-0 space-y-4 lg:col-span-2">
      {/* Four short facts in one row from sm up (Naman, 2026-10-06: "too much
          empty space"); the old "For" chips and the notes under each fact
          are gone, the class list below carries that. */}
      <section className="surface-card frosted-shadow rounded-card p-4 sm:p-5">
        <h3 className="text-base font-semibold text-ink-900">Details</h3>
        {ptm.description && (
          <p className="mt-1.5 whitespace-pre-wrap text-sm text-ink-700">{ptm.description}</p>
        )}
        <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Fact icon={<Video />} tone="sky" label="Format">
            Google Meet
          </Fact>
          <Fact icon={<CalendarCheck />} tone="mint" label="Slots">
            {ptm.slot_duration_minutes} min{gap}
          </Fact>
          <Fact icon={<Users />} tone="violet" label="Booking">
            Until each slot starts
          </Fact>
          <Fact icon={<MessageSquareHeart />} tone="peach" label="Feedback">
            {sentenceCase(describeEditWindow(ptm.feedback_edit_days))}
          </Fact>
        </dl>
      </section>

      <section className="surface-card frosted-shadow rounded-card p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-ink-900">{hasClasses ? "Classes and teachers" : "Teachers"}</h3>
            <p className="mt-0.5 text-sm text-ink-600">
              {hasClasses
                ? "One session per class; each teacher runs their own slots."
                : "Each runs their own session in this window."}
            </p>
          </div>
          {canChangeTeachers && (
            <Button variant="outline" size="sm" onClick={hasClasses ? onChangeClassSessions : onChangeTeachers}>
              <Users className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {hasClasses ? "Change classes" : "Change teachers"}
            </Button>
          )}
        </div>
        <div className="mt-3 space-y-3">
          {sessions.isLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-6 w-6 animate-spin text-ink-500" aria-label="Loading" />
            </div>
          ) : sessions.isError ? (
            <EmptyState
              size="sm"
              icon={<AlertTriangle className="h-7 w-7" />}
              tone="rose"
              reason="error"
              title="Couldn't load the teachers"
              description="Check your connection and try again."
              action={{ label: "Retry", onClick: () => sessions.refetch() }}
            />
          ) : rows.length === 0 ? (
            <EmptyState
              size="sm"
              icon={<Users className="h-7 w-7" />}
              reason="noData"
              title="No teachers in this PTM"
              description="Cancel it and schedule a new one with the teachers who will run it."
            />
          ) : hasClasses ? (
            groups.map((g) => (
              <div key={g.key} className="overflow-hidden rounded-xl border border-surface-stroke">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 bg-brand-primary/[0.05] px-3 py-2">
                  <p className="text-sm font-semibold text-ink-900">{g.label ?? "Class"}</p>
                  <p className="text-xs text-ink-500">
                    {g.hours ?? formatTimeRange(ptm.start_time, ptm.end_time)}
                    {` · ${plural(g.rows.length, "teacher", "teachers")}`}
                  </p>
                </div>
                <ul className="divide-y divide-surface-stroke border-t border-surface-stroke">
                  {g.rows.map((s) => teacherRow(s, true))}
                </ul>
              </div>
            ))
          ) : (
            <ul className="space-y-2">{rows.map((s) => teacherRow(s, false))}</ul>
          )}
          {me && me.student_count === 0 && mayEdit && (
            <p className="flex items-start gap-2 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-500/25 dark:text-amber-200">
              <UserPlus className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>You have not picked your students yet. Use the Students button above; their families are then told and book a slot with you.</span>
            </p>
          )}
          {me && !me.has_google_email && (
            <GoogleWarning
              text="No Google account set: Meet uses your login email. Set another if you join with a different one."
              onFix={() => onSetGoogleEmail(me.teacher_id, "you", true)}
            />
          )}
          {me && me.meet_failed_count > 0 && (
            <p className="flex items-start gap-2 text-sm text-rose-700 dark:text-rose-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {me.meet_failed_count} {me.meet_failed_count === 1 ? "slot has" : "slots have"} no meeting link after
              several tries. Tell the school.
            </p>
          )}
        </div>
      </section>
      </div>
    </div>
  );
}

function GoogleWarning({ text, onFix }: { text: string; onFix: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-500/25 dark:text-amber-200">
      <span className="flex min-w-0 items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{text}</span>
      </span>
      <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={onFix}>
        Add Google account
      </Button>
    </div>
  );
}

export function OnlineBookingsTab({
  ptm,
  hat,
  institutionId,
  sessions,
  now,
  onPickStudents,
}: {
  ptm: PTMSchedule;
  hat: PTMHat;
  institutionId: string;
  sessions: Sessions;
  now: Date;
  /** Opens the teacher's own Students sheet. */
  onPickStudents: () => void;
}) {
  // ALL = every class / every teacher in scope (Naman, 2026-10-09: "show all
  // the booked meetings and then if any filter is applied"); a scope of one
  // (teacher, class) goes straight to that teacher's whole grid.
  const [groupKey, setGroupKey] = useState<string>(ALL);
  const [teacherId, setTeacherId] = useState<string>(ALL);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [remarksFor, setRemarksFor] = useState<{ id: string; name: string } | null>(null);
  const setAttended = useSetPTMBookingAttended();

  // A teacher may read only their own grid; offering other teachers' grids
  // only earned a permission error dressed as "check your connection"
  // (Tushar's review, 2026-10-07).
  const list = useMemo(() => {
    const all = sessions.data ?? [];
    return hat === "teacher" ? all.filter((r) => r.is_me) : all;
  }, [sessions.data, hat]);
  const groups = useMemo(() => groupByClass(list), [list]);
  const hasClasses = groups.some((g) => g.label !== null);
  // Keep both picks valid when the sessions change under them.
  useEffect(() => {
    if (groupKey !== ALL && !groups.some((g) => g.key === groupKey)) setGroupKey(ALL);
  }, [groups, groupKey]);
  const group = groupKey === ALL ? null : (groups.find((g) => g.key === groupKey) ?? null);
  const scopeRows = useMemo(() => (group ? group.rows : list), [group, list]);
  useEffect(() => {
    if (teacherId !== ALL && !scopeRows.some((s) => s.teacher_id === teacherId)) setTeacherId(ALL);
  }, [scopeRows, teacherId]);

  // The teacher filter lists each teacher once: across all classes a teacher
  // can sit in two class sessions, and then their pick spans both.
  const teacherOptions = useMemo(() => {
    const seen = new Set<string>();
    return scopeRows.filter((s) => (seen.has(s.teacher_id) ? false : (seen.add(s.teacher_id), true)));
  }, [scopeRows]);
  const teacherRows = useMemo(
    () => (teacherId === ALL ? scopeRows : scopeRows.filter((s) => s.teacher_id === teacherId)),
    [scopeRows, teacherId],
  );
  // One (teacher, class) in scope: that teacher's whole grid, free slots
  // included. Otherwise the booked meetings of everyone in scope, soonest first.
  const current = teacherRows.length === 1 ? teacherRows[0] : null;
  const grid = usePTMOnlineBookingGrid(
    ptm.id,
    current?.teacher_id ?? null,
    !!current && current.student_count > 0,
    current?.class_session_id ?? null,
  );
  const everyone = useMemo(
    () =>
      current
        ? []
        : teacherRows
            .filter((r) => r.student_count > 0)
            .map((r) => ({ teacherId: r.teacher_id, classSessionId: r.class_session_id ?? null, teacherName: r.teacher_name })),
    [current, teacherRows],
  );
  const grids = usePTMOnlineBookingGrids(ptm.id, everyone);
  const bookedRows = useMemo(() => {
    const out: BookedRow[] = [];
    grids.data.forEach((rows, i) => {
      for (const r of rows ?? []) if (r.booking_id) out.push({ ...r, teacher_name: everyone[i]?.teacherName ?? "" });
    });
    return out.sort((a, b) => a.slot_time.localeCompare(b.slot_time) || a.teacher_name.localeCompare(b.teacher_name));
  }, [grids.data, everyone]);

  if (sessions.isLoading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="h-6 w-6 animate-spin text-ink-500" aria-label="Loading" />
      </div>
    );
  }
  if (sessions.isError) {
    return (
      <EmptyState
        icon={<AlertTriangle className="h-7 w-7" />}
        tone="rose"
        reason="error"
        title="Couldn't load the sessions"
        description="Check your connection and try again."
        action={{ label: "Retry", onClick: () => sessions.refetch() }}
      />
    );
  }
  if (list.length === 0) {
    return (
      <EmptyState
        icon={<Users className="h-7 w-7" />}
        reason="noData"
        title="No teachers in this PTM"
        description="Cancel it and schedule a new one with the teachers who will run it."
      />
    );
  }

  const booked = (grid.data ?? []).filter((s) => !!s.booking_id).length;
  const total = (grid.data ?? []).filter((s) => !s.off_grid).length;
  const hours = group?.hours ?? (current?.start_time && current?.end_time ? formatTimeRange(current.start_time, current.end_time) : null);

  const onToggleAttended = (bookingId: string, attended: boolean) => {
    if (setAttended.isPending) return;
    setPendingId(bookingId);
    setAttended.mutate({ bookingId, attended }, { onSettled: () => setPendingId(null) });
  };
  const onRemarks = hat === "teacher" ? (id: string, name: string) => setRemarksFor({ id, name }) : undefined;
  // "Now" on the slot in progress, booked or not, the class under the name
  // and, in the everyone view, the teacher: whoever scans the list sees who
  // meets whom, and whose turn it is, at a glance.
  const renderMeta = (slot: PTMOnlineSlotRow, teacher: string | null) => {
    const bounds = slotBoundsFrom(slot, () => slotBounds(ptm, slot.slot_time));
    const live = isSlotInProgress(bounds.start, bounds.end, now);
    const cls = slot.booking_id && slot.class_name ? formatClassName(slot.class_name, slot.class_section) : null;
    const where = [teacher, cls].filter(Boolean).join(" · ");
    if (!live && !where) return null;
    return (
      <span className="inline-flex items-center gap-1.5">
        {live && (
          <Badge className="h-5 rounded-full bg-emerald-500/15 px-1.5 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300">
            Now
          </Badge>
        )}
        {where}
      </span>
    );
  };
  // One room per booked slot, every one "On hold" except the slot whose
  // turn it is (Naman, 2026-10-05).
  const renderActions = (slot: PTMOnlineSlotRow) => {
    if (!slot.booking_id) return null;
    const bounds = slotBoundsFrom(slot, () => slotBounds(ptm, slot.slot_time));
    return (
      <JoinMeetButton
        meetUri={slot.meet_uri}
        slotStart={bounds.start}
        slotEnd={bounds.end}
        bufferMinutes={ptm.slot_buffer_minutes}
        now={now}
        role="teacher"
        size="sm"
      />
    );
  };

  return (
    <section className="surface-card frosted-shadow rounded-card space-y-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex w-full flex-wrap gap-3 sm:w-auto">
          {hasClasses && groups.length > 1 && (
            <div className="w-full space-y-2 sm:w-56">
              <Label htmlFor="ptm-bookings-class">Class</Label>
              <Select value={groupKey} onValueChange={setGroupKey}>
                <SelectTrigger id="ptm-bookings-class">
                  <SelectValue placeholder="All classes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All classes</SelectItem>
                  {groups.map((g) => (
                    <SelectItem key={g.key} value={g.key}>
                      {g.label ?? "Class"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {teacherOptions.length > 1 ? (
            <div className="w-full space-y-2 sm:w-64">
              <Label htmlFor="ptm-bookings-teacher">Teacher</Label>
              <Select value={teacherId} onValueChange={setTeacherId}>
                <SelectTrigger id="ptm-bookings-teacher">
                  <SelectValue placeholder="All teachers" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All teachers</SelectItem>
                  {teacherOptions.map((s) => (
                    <SelectItem key={s.teacher_id} value={s.teacher_id}>
                      {s.teacher_name}
                      {s.is_me ? " (you)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <h3 className="self-end text-base font-semibold text-ink-900">{scopeRows[0]?.teacher_name}</h3>
          )}
        </div>
        {current
          ? grid.data && (
              <p className="text-sm text-ink-600">
                {booked} of {total} slots booked
                {hours && (
                  <span className="block text-xs text-ink-500">
                    {hasClasses ? "Hours" : "Own hours"}: {hours}
                  </span>
                )}
              </p>
            )
          : !grids.isLoading &&
            !grids.isError && (
              <p className="text-sm text-ink-600">
                {plural(bookedRows.length, "booked meeting", "booked meetings")}
                <span className="block text-xs text-ink-500">
                  {everyone.length === 0
                    ? "No teacher has picked students yet"
                    : `${plural(everyone.length, "teacher", "teachers")} with students`}
                </span>
              </p>
            )}
      </div>

      {current ? (
        current.student_count === 0 ? (
        <EmptyState
          size="sm"
          icon={<UserPlus className="h-7 w-7" />}
          reason="noData"
          title="No students picked yet"
          description={
            current.is_me
              ? "Pick the students you will meet; their families then book a slot."
              : `${current.teacher_name} has not picked their students yet.`
          }
          action={current.is_me && canEditOwnSession(ptm, hat, true, now) ? { label: "Pick students", onClick: onPickStudents } : undefined}
        />
      ) : grid.isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-ink-500" aria-label="Loading slots" />
        </div>
      ) : grid.isError ? (
        <EmptyState
          size="sm"
          icon={<AlertTriangle className="h-7 w-7" />}
          tone="rose"
          reason="error"
          title="Couldn't load the slots"
          description="Check your connection and try again."
          action={{ label: "Retry", onClick: () => grid.refetch() }}
        />
      ) : (
        <SlotGrid<PTMOnlineSlotRow>
          slots={grid.data ?? []}
          mode="staff"
          attendedPendingId={pendingId}
          onToggleAttended={onToggleAttended}
          onRemarks={onRemarks}
          disabled={setAttended.isPending}
          renderMeta={(slot) => renderMeta(slot, null)}
          renderActions={renderActions}
        />
      )
      ) : grids.isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-ink-500" aria-label="Loading bookings" />
        </div>
      ) : grids.isError ? (
        <EmptyState
          size="sm"
          icon={<AlertTriangle className="h-7 w-7" />}
          tone="rose"
          reason="error"
          title="Couldn't load the bookings"
          description="Check your connection and try again."
          action={{ label: "Retry", onClick: () => grids.refetch() }}
        />
      ) : bookedRows.length === 0 ? (
        <EmptyState
          size="sm"
          icon={<CalendarCheck className="h-7 w-7" />}
          reason="noData"
          title="No bookings yet"
          description={
            everyone.length === 0
              ? "No teacher in this PTM has picked students yet, so there is nothing to book."
              : "Families have not booked a slot with these teachers yet. Pick a teacher above to see their free slots."
          }
        />
      ) : (
        <SlotGrid<BookedRow>
          slots={bookedRows}
          mode="staff"
          attendedPendingId={pendingId}
          onToggleAttended={onToggleAttended}
          onRemarks={onRemarks}
          disabled={setAttended.isPending}
          renderMeta={(slot) => renderMeta(slot, slot.teacher_name)}
          renderActions={renderActions}
        />
      )}

      <MobileSheet
        open={!!remarksFor}
        onOpenChange={(open) => !open && setRemarksFor(null)}
        title="Remarks"
        subtitle={remarksFor?.name}
        icon={<MessageSquare className="h-5 w-5" />}
        desktopWidth="md"
      >
        <div className="p-4">
          {remarksFor && (
            <StudentRemarksPanel
              studentId={remarksFor.id}
              studentName={remarksFor.name}
              institutionId={institutionId}
            />
          )}
        </div>
      </MobileSheet>
    </section>
  );
}
