import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarCheck, Loader2 } from "lucide-react";

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
import { MobileSheet } from "@/components/shared/sheets";
import { EmptyState } from "@/components/shared/surfaces";
import { JoinMeetButton } from "./JoinMeetButton";
import { SlotGrid } from "./SlotGrid";
import { useNow } from "@/hooks/useNow";
import {
  describeBookingWindow,
  formatClockTime,
  formatPTMDate,
  formatTimeRange,
  ptmBookingWindowOpen,
  slotBounds,
  slotBoundsFrom,
  slotHasStarted,
  windowsOverlap,
} from "@/lib/ptm";
import {
  useBookPTMSlot,
  useCancelPTMBooking,
  usePTMBookingGrid,
  usePTMOnlineBookingGrid,
  type PTMOnlineMySession,
  type PTMSchedule,
  type PTMSlotRow,
} from "@/hooks/ptm";

interface Props {
  ptm: PTMSchedule | null;
  /** Online PTM: one row per teacher the student is with, each with its
   *  booking (several since 2026-10-09). */
  mySessions?: PTMOnlineMySession[];
  onClose: () => void;
}

const NO_SESSIONS: PTMOnlineMySession[] = [];

/**
 * A student books, moves or cancels their family's slot. The grid is their
 * own class's (the RPC resolves it), or, for an online PTM, one teacher's:
 * with several teachers the family books with each in turn (spec
 * 2026-10-09). One active booking per student per teacher and one family
 * per slot are unique indexes on the server, so a race just comes back as
 * "that slot was just taken".
 */
export function BookSlotSheet({ ptm, mySessions = NO_SESSIONS, onClose }: Props) {
  const ptmId = ptm?.id ?? null;
  const online = ptm?.mode === "online";
  // Several teachers (spec 2026-10-09): one grid per teacher, chosen with the
  // pills above the tiles. The teacher is sent to the server only then, so a
  // server that knows one teacher per student sees the call it knows.
  const multi = online && mySessions.length > 1;
  const [teacherId, setTeacherId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  useEffect(() => {
    setSelected(null);
    setConfirmCancel(false);
    setTeacherId(null);
  }, [ptmId]);

  // The teacher whose grid is up: the family's pick, else the first still
  // without a slot, else the first.
  const session = multi
    ? (mySessions.find((s) => s.teacher_id === teacherId) ?? mySessions.find((s) => !s.booking_id) ?? mySessions[0])
    : (mySessions[0] ?? null);
  const classGrid = usePTMBookingGrid(ptmId, null, !!ptm && !online);
  const onlineGrid = usePTMOnlineBookingGrid(ptmId, multi ? session.teacher_id : null, !!ptm && online);
  const grid = online ? onlineGrid : classGrid;
  const book = useBookPTMSlot();
  const cancel = useCancelPTMBooking();
  const now = useNow();

  const mine = useMemo(() => grid.data?.find((s) => s.is_mine) ?? null, [grid.data]);
  // The family's slots with the OTHER teachers of this PTM: a tile at the
  // same time is greyed before the server refuses it.
  const otherSlots = useMemo(
    () =>
      ptm && multi
        ? mySessions
            .filter((s) => s.teacher_id !== session.teacher_id && s.slot_time)
            .map((s) => ({ name: s.teacher_name, ...slotBoundsFrom(s, () => slotBounds(ptm, s.slot_time as string)) }))
        : [],
    [ptm, multi, mySessions, session],
  );
  // Online: a tile that has started is "Past"; one clashing with the family's
  // slot with another teacher names that teacher.
  const unavailableReason = (slot: PTMSlotRow): { short: string; long: string } | null => {
    if (!online || !ptm) return null;
    const bounds = slotBoundsFrom(slot as { slot_starts_at?: string; slot_ends_at?: string }, () => slotBounds(ptm, slot.slot_time));
    if (slotHasStarted(bounds.start, now)) return { short: "Past", long: "already started" };
    const other = otherSlots.find((o) => windowsOverlap(bounds, o));
    return other ? { short: "Your other slot", long: `your slot with ${other.name}` } : null;
  };
  const windowOpen = ptm ? ptmBookingWindowOpen(ptm) : false;
  const pending = book.isPending || cancel.isPending;
  // Online rows carry the server's school-time bounds and the family's link.
  const mineOnline = mine as (PTMSlotRow & { meet_uri?: string | null; slot_starts_at?: string; slot_ends_at?: string }) | null;
  const mineBounds = ptm && mine ? slotBoundsFrom(mineOnline ?? {}, () => slotBounds(ptm, mine.slot_time)) : null;
  // Online: my booked slot can be moved or cancelled only until it starts
  // (the server's can_change; the slot's own start as the fallback). After
  // that the sheet says so instead of offering buttons the server refuses
  // (Tushar's review, 2026-10-07).
  const mineStarted = online && mineBounds ? slotHasStarted(mineBounds.start, now) : false;
  const canChangeMine = online && mine ? (session?.can_change ?? !mineStarted) && !mineStarted : windowOpen;
  const mineMeetUri = mineOnline?.meet_uri ?? null;

  const primaryLabel = !selected
    ? mine
      ? "Pick a new slot"
      : "Pick a slot"
    : mine
      ? `Move to ${formatClockTime(selected)}`
      : `Book ${formatClockTime(selected)}`;

  return (
    <>
      <MobileSheet
        open={!!ptm}
        onOpenChange={(open) => !open && !pending && onClose()}
        title={mine ? "Change your slot" : online && session ? `Book a slot with ${session.teacher_name}` : "Book a slot"}
        // Online: the teacher's (or class session's) own hours when narrower
        // than the meeting's.
        subtitle={
          ptm
            ? `${formatPTMDate(ptm.scheduled_date)}, ${formatTimeRange(
                session?.teacher_start_time || session?.session_start_time || ptm.start_time,
                session?.teacher_end_time || session?.session_end_time || ptm.end_time,
              )}`
            : undefined
        }
        icon={<CalendarCheck className="h-5 w-5" />}
        desktopWidth="md"
        primaryAction={{
          label: primaryLabel,
          onClick: () => {
            if (!ptm || !selected) return;
            const current = session?.teacher_id ?? null;
            book.mutate(
              {
                ptmId: ptm.id,
                slotTime: selected,
                replace: !!mine,
                teacherId: multi ? current : null,
                teacherName: multi ? session?.teacher_name : null,
              },
              {
                onSuccess: () => {
                  // Several teachers: carry on with the next one still without
                  // a slot; close once every teacher has one.
                  const next = multi ? mySessions.find((s) => s.teacher_id !== current && !s.booking_id) : undefined;
                  if (!next) {
                    onClose();
                    return;
                  }
                  setTeacherId(next.teacher_id);
                  setSelected(null);
                },
              },
            );
          },
          loading: book.isPending,
          disabled: !selected || pending || !windowOpen || (!!mine && !canChangeMine),
        }}
        secondaryAction={
          mine
            ? { label: "Cancel my slot", onClick: () => setConfirmCancel(true), disabled: pending || !windowOpen || !canChangeMine }
            : { label: "Not now", onClick: onClose, disabled: pending }
        }
      >
        <div className="space-y-4 p-4">
          {online && mine && !canChangeMine && (
            <p className="rounded-xl bg-muted/60 px-3 py-2 text-sm text-ink-700 ring-1 ring-inset ring-surface-stroke">
              Your slot has started, so it can't be moved or cancelled any more. Use Join on the PTM card.
            </p>
          )}
          {ptm && (
            <div className="space-y-1 text-sm text-ink-700">
              {ptm.venue && (
                <p>
                  <span className="text-ink-500">Venue: </span>
                  {ptm.venue}
                </p>
              )}
              {online && (
                <p>
                  Online on Google Meet{session ? ` with ${session.teacher_name}` : ""}. Your Join button on the
                  PTM card turns on two minutes before your slot.
                </p>
              )}
              <p className="text-xs text-ink-500">
                {ptm.slot_duration_minutes}-minute slots. You can book or change your slot{" "}
                {describeBookingWindow(ptm)}.
              </p>
            </div>
          )}

          {multi && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-ink-700">Booking with</p>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Teacher">
                {mySessions.map((s) => {
                  const active = s.teacher_id === session?.teacher_id;
                  return (
                    <Button
                      key={s.teacher_id}
                      type="button"
                      size="sm"
                      variant={active ? "default" : "outline"}
                      aria-pressed={active}
                      disabled={pending}
                      className="h-9 rounded-full"
                      onClick={() => {
                        setTeacherId(s.teacher_id);
                        setSelected(null);
                      }}
                    >
                      {s.slot_time && <CalendarCheck className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
                      {s.teacher_name}
                      {s.slot_time && <span className="ml-1 opacity-80">· {formatClockTime(s.slot_time)}</span>}
                    </Button>
                  );
                })}
              </div>
            </div>
          )}

          {!windowOpen ? (
            <EmptyState
              size="sm"
              icon={<AlertTriangle className="h-7 w-7" />}
              tone="peach"
              reason="noData"
              title="Booking has closed"
              description="The time to book or change a slot for this meeting has passed."
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
            <SlotGrid
              slots={(grid.data ?? []) as PTMSlotRow[]}
              mode="student"
              selected={selected}
              onSelect={(slot) => setSelected((prev) => (prev === slot ? null : slot))}
              disabled={pending}
              // Online: a slot that has already started is greyed "Past"; the
              // rest stay bookable while the meeting is under way. A slot at
              // the same time as the family's slot with another teacher is
              // greyed too, naming that teacher.
              isUnavailable={(slot) => !!unavailableReason(slot)}
              unavailableLabel={unavailableReason}
            />
          )}

          {mine && (
            <p className="text-sm text-ink-700">
              Your current slot is{" "}
              <span className="font-medium text-brand-primary">{formatClockTime(mine.slot_time)}</span>.
            </p>
          )}
          {online && mine && mineBounds && ptm && (
            <JoinMeetButton
              meetUri={mineMeetUri}
              slotStart={mineBounds.start}
              slotEnd={mineBounds.end}
              bufferMinutes={ptm.slot_buffer_minutes}
              now={now}
            />
          )}
        </div>
      </MobileSheet>

      <AlertDialog open={confirmCancel} onOpenChange={(open) => !open && !cancel.isPending && setConfirmCancel(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel your slot?</AlertDialogTitle>
            <AlertDialogDescription>
              Your {mine ? formatClockTime(mine.slot_time) : ""} slot{multi && session ? ` with ${session.teacher_name}` : ""} will be freed for another family.
              You can book again while booking is open.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancel.isPending}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              disabled={cancel.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (!mine?.booking_id) return;
                cancel.mutate(
                  { bookingId: mine.booking_id },
                  {
                    onSuccess: () => {
                      setConfirmCancel(false);
                      onClose();
                    },
                  },
                );
              }}
            >
              {cancel.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Cancel slot
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
