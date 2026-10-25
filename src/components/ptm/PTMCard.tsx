import { Fragment, useEffect, useRef, type ReactNode } from "react";
import { format } from "date-fns";
import {
  ArrowRight,
  Calendar,
  CalendarCheck,
  CheckCircle2,
  Clock,
  MapPin,
  MessageSquareHeart,
  Pencil,
  Timer,
  Users,
  Video,
  type LucideIcon,
  AlertTriangle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { TONES, type Tone } from "@/components/shared/design-system";
import { cn } from "@/lib/utils";
import { PTMStatusBadge } from "./PTMStatusBadge";
import { PTMModeBadge } from "./PTMModeBadge";
import { PTMScopeChips } from "./PTMScopeChips";
import { JoinMeetButton } from "./JoinMeetButton";
import {
  describeBookingWindow,
  formatClockTime,
  formatPTMDate,
  formatTimeRange,
  joinNames,
  ptmBookingWindowOpen,
  ptmEffectiveStatus,
  ptmFeedbackWindow,
  slotBounds,
  slotBoundsFrom,
  type PTMEffectiveStatus,
} from "@/lib/ptm";
import type { PTMMyBooking, PTMMyFeedback, PTMOnlineMySession, PTMSchedule } from "@/hooks/ptm";

/** Per-status colour: the gradient border, the date tile and the corner glow.
 *  Past and cancelled borders are softer so what is coming stands out. */
const ACCENTS: Record<
  PTMEffectiveStatus,
  { border: string; tile: string; tileText: string; glow: string }
> = {
  scheduled: {
    border: "from-brand-primary via-sky-400 to-violet-400",
    tile: "from-brand-primary/15 to-sky-500/10 ring-brand-primary/20",
    tileText: "text-teal-700 dark:text-teal-300",
    glow: "bg-sky-500/10",
  },
  active: {
    border: "from-emerald-400 via-brand-primary to-sky-400",
    tile: "from-emerald-500/15 to-brand-primary/10 ring-emerald-500/25",
    tileText: "text-emerald-700 dark:text-emerald-300",
    glow: "bg-emerald-500/15",
  },
  completed: {
    border: "from-violet-400/70 via-brand-secondary/60 to-sky-300/60",
    tile: "from-violet-500/15 to-brand-secondary/10 ring-violet-500/20",
    tileText: "text-violet-700 dark:text-violet-300",
    glow: "bg-violet-500/10",
  },
  cancelled: {
    border: "from-rose-400/70 via-rose-300/60 to-brand-accent/60",
    tile: "from-rose-500/15 to-rose-500/5 ring-rose-500/20",
    tileText: "text-rose-700 dark:text-rose-300",
    glow: "bg-rose-500/10",
  },
};

const NO_BOOKINGS: PTMMyBooking[] = [];
const NO_SESSIONS: PTMOnlineMySession[] = [];

/** The family's place with one teacher of an online PTM (one per teacher
 *  since 2026-10-09): the booking on the session row, or the matching
 *  `ptm_my_bookings` row for a server that does not put it there. */
interface Seat {
  session: PTMOnlineMySession;
  slotTime: string | null;
  bounds: { start: Date; end: Date } | null;
  meetUri: string | null;
  canChange: boolean;
}

function seatOf(ptm: PTMSchedule, session: PTMOnlineMySession, bookings: PTMMyBooking[], seatCount: number): Seat {
  const fallback =
    bookings.find((b) => b.teacher_id === session.teacher_id) ?? (seatCount === 1 ? (bookings[0] ?? null) : null);
  const slotTime = session.slot_time ?? fallback?.slot_time ?? null;
  return {
    session,
    slotTime,
    bounds: slotTime ? slotBoundsFrom(session, () => slotBounds(ptm, slotTime)) : null,
    meetUri: session.meet_uri ?? fallback?.meet_uri ?? null,
    canChange: session.can_change !== false,
  };
}

/** The calendar tile's parts, from the plain `YYYY-MM-DD` date (local). */
function dateParts(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return null;
  const local = new Date(y, m - 1, d);
  return {
    month: format(local, "MMM"),
    day: format(local, "d"),
    year: format(local, "yyyy"),
    weekday: format(local, "EEE"),
  };
}

/** "2 Oct, 8:31 PM" from the server's `closes_at`; null when absent or bad. */
function editableUntil(closesAt: string | null | undefined): string | null {
  if (!closesAt) return null;
  const at = new Date(closesAt);
  return Number.isNaN(at.getTime()) ? null : format(at, "d MMM, h:mm a");
}

function InfoRow({
  icon: Icon,
  tone,
  label,
  alignTop,
  className,
  children,
}: {
  icon: LucideIcon;
  tone: Tone;
  label: string;
  alignTop?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const t = TONES[tone];
  return (
    <div className={cn("flex gap-3", alignTop ? "items-start" : "items-center")}>
      <span
        className={cn("inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", t.bg, t.fg)}
        aria-hidden="true"
      >
        <Icon className="h-3.5 w-3.5" />
      </span>
      <dt className="sr-only">{label}</dt>
      <dd className={cn("min-w-0 flex-1", alignTop && "py-1", className)}>{children}</dd>
    </div>
  );
}

interface Props {
  ptm: PTMSchedule;
  audience: "staff" | "student";
  /** Whether Tushar's migration has landed; write actions hide until then. */
  ready: boolean;
  /** Student: their active bookings on this PTM (in person: at most one;
   *  online: one per teacher they are with). */
  myBookings?: PTMMyBooking[];
  /** Student: the feedback they already sent, while it can still be edited. */
  myFeedback?: PTMMyFeedback | null;
  /** Student: when edits lock (server time, institution timezone). */
  feedbackClosesAt?: string | null;
  /** Student, online PTM: one row per teacher they are with, each with its
   *  booking (ptm_online_my_sessions). */
  mySessions?: PTMOnlineMySession[];
  /** Online, student: the session list failed to load (the card must not
   *  read that as "booking closed"). */
  mySessionError?: boolean;
  onRetryMySession?: () => void;
  /** From useNow(), so the Join button flips live. */
  now?: Date;
  /** The PTM a notification pointed at: ring it and scroll it into view. */
  highlight?: boolean;
  onOpen?: () => void;
  onBook?: () => void;
  onFeedback?: () => void;
}

/**
 * One PTM in the Communication tab list. The same card serves staff (who
 * open the detail page) and students (who book a slot and give feedback);
 * the status chip is computed from the time window, never read raw.
 */
export function PTMCard({
  ptm,
  audience,
  ready,
  myBookings = NO_BOOKINGS,
  myFeedback,
  feedbackClosesAt,
  mySessions = NO_SESSIONS,
  mySessionError = false,
  onRetryMySession,
  now,
  highlight,
  onOpen,
  onBook,
  onFeedback,
}: Props) {
  const status = ptmEffectiveStatus(ptm);
  const isStudent = audience === "student";
  const online = ptm.mode === "online";
  // Bring the highlighted card into view once, when it first renders.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (highlight) rootRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlight]);
  // In person: at most one booking. Online: one seat per teacher the family
  // is with (several since 2026-10-09), each with its own booking.
  const myBooking = online ? null : (myBookings[0] ?? null);
  const seats = online ? mySessions.map((s) => seatOf(ptm, s, myBookings, mySessions.length)) : [];
  const bookedSeats = seats.filter((x) => x.slotTime !== null);
  const hasBooking = online ? bookedSeats.length > 0 : !!myBooking;
  // Online: a family books with the teachers who picked their child, so a
  // session row has to be there before the button is.
  // Online, booking stays open while the meeting is under way: a family can
  // still take a slot that has not started (Naman, 2026-10-05).
  // A booked family may change or cancel only until THEIR slot starts (the
  // server's can_change, status note item 11); offering it later only earned
  // a server error (Tushar's review, 2026-10-07). With several teachers, any
  // seat still open keeps the button.
  const mySlotOpen = !online || seats.some((x) => x.slotTime === null || x.canChange);
  const canBook =
    isStudent &&
    ready &&
    ptm.slot_booking_enabled &&
    (status === "scheduled" || (online && status === "active")) &&
    ptmBookingWindowOpen(ptm) &&
    (!online || seats.length > 0) &&
    mySlotOpen;
  // A slot PTM the student can no longer book (the cutoff before the start
  // has passed, the server refuses too): say so rather than drop the button
  // silently. Not on a finished one, where it is only noise, and never when
  // the session list simply failed to load.
  const sessionFailed = online && isStudent && mySessionError;
  const bookingClosed =
    isStudent &&
    ready &&
    ptm.slot_booking_enabled &&
    !hasBooking &&
    !sessionFailed &&
    (status === "scheduled" || status === "active") &&
    !canBook;
  const feedbackWindow = ptmFeedbackWindow(ptm);
  const canFeedback = isStudent && ready && !!ptm.feedback_token && feedbackWindow === "open";
  const showOpen = !isStudent && !!onOpen;
  const showBook = canBook && !!onBook;
  const showFeedback = canFeedback && !!onFeedback;
  const feedbackSent = showFeedback && !!myFeedback;
  const editUntil = feedbackSent ? editableUntil(feedbackClosesAt) : null;
  const showSlotNote = !isStudent && ptm.slot_booking_enabled;
  const hasActions = showOpen || showBook || showFeedback;
  const accent = ACCENTS[status];
  const date = dateParts(ptm.scheduled_date);
  const teacherCount = ptm.online_teacher_ids.length;
  // Online with several teachers: "Book a slot" while any teacher is still
  // without one, "Change slots" once every teacher has one.
  const bookLabel = !hasBooking
    ? "Book a slot"
    : online && seats.length > 1
      ? bookedSeats.length < seats.length
        ? "Book a slot"
        : "Change slots"
      : "Change slot";

  return (
    // The outer layer is the highlighted boundary: its gradient shows through
    // the 1.5px gap around the card body.
    <div
      ref={rootRef}
      data-highlight={highlight ? "true" : undefined}
      className={cn(
        "group rounded-card bg-gradient-to-br p-[1.5px] frosted-shadow",
        accent.border,
        highlight && "ring-2 ring-brand-primary/40 ring-offset-2 ring-offset-background",
        showOpen &&
          "transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-card-lg motion-reduce:transition-none motion-reduce:hover:translate-y-0",
      )}
    >
      {/* overflow-hidden clips the glow to the rounded corners. */}
      <article className="relative flex h-full flex-col overflow-hidden rounded-[calc(var(--radius-card)-1.5px)] bg-surface-card">
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full blur-3xl",
            accent.glow,
          )}
        />

        {/* `relative` lifts the content over the glow and anchors the Open
            button's stretched layer; flex-col lets the footer sit at the bottom
            when grid cards share a row height. */}
        <div className="relative flex flex-1 flex-col p-4 sm:p-5">
          <div className="flex items-start gap-3 sm:gap-4">
            {date && (
              <div
                aria-hidden="true"
                className={cn(
                  "flex w-14 shrink-0 flex-col items-center rounded-2xl bg-gradient-to-br py-2 ring-1 ring-inset",
                  accent.tile,
                )}
              >
                <span className={cn("text-[11px] font-semibold uppercase tracking-[0.08em]", accent.tileText)}>
                  {date.month}
                </span>
                <span className="text-2xl font-bold leading-7 tabular-nums text-ink-900">{date.day}</span>
                <span className="text-[11px] font-medium tabular-nums text-ink-500">{date.year}</span>
              </div>
            )}
            {/* Title first for screen readers; the status chip shows above it. */}
            <div className="flex min-w-0 flex-1 flex-col items-start">
              <h3 className="text-base font-semibold leading-snug text-ink-900">{ptm.title}</h3>
              <span className="order-first mb-2 flex flex-wrap items-center gap-1.5">
                <PTMStatusBadge status={status} />
                <PTMModeBadge mode={ptm.mode} />
              </span>
              {ptm.description && (
                <p className="mt-1 line-clamp-2 text-sm text-ink-600">{ptm.description}</p>
              )}
            </div>
          </div>

          <dl className="mt-4 space-y-2 text-sm text-ink-700">
            {date ? (
              <div className="sr-only">
                <dt>Date</dt>
                <dd>{formatPTMDate(ptm.scheduled_date)}</dd>
              </div>
            ) : (
              <InfoRow icon={Calendar} tone="teal" label="Date">
                {formatPTMDate(ptm.scheduled_date)}
              </InfoRow>
            )}
            <InfoRow icon={Clock} tone="sky" label="Time">
              {date && <span className="text-ink-500">{date.weekday} · </span>}
              {formatTimeRange(ptm.start_time, ptm.end_time)}
            </InfoRow>
            {ptm.venue && (
              <InfoRow icon={MapPin} tone="peach" label="Venue" className="truncate">
                {ptm.venue}
              </InfoRow>
            )}
            {online && isStudent && seats.length > 0 && (
              <InfoRow icon={Video} tone="sky" label={seats.length === 1 ? "Teacher" : "Teachers"} className="truncate">
                Online with {joinNames(seats.map((x) => x.session.teacher_name))}
              </InfoRow>
            )}
            {online && !isStudent ? (
              <InfoRow icon={Users} tone="violet" label="Teachers">
                {teacherCount === 0
                  ? "No teachers yet"
                  : `${teacherCount} ${teacherCount === 1 ? "teacher" : "teachers"}, online`}
              </InfoRow>
            ) : (
              <InfoRow icon={Users} tone="violet" label="For" alignTop>
                <PTMScopeChips
                  scopeType={ptm.scope_type}
                  wingName={ptm.scope_wing_name}
                  classes={ptm.classes}
                  emptyLabel={online ? "Your child" : undefined}
                />
              </InfoRow>
            )}
            {isStudent && myBooking && status !== "cancelled" && (
              <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 px-3 py-2 text-emerald-700 ring-1 ring-inset ring-emerald-500/20 dark:text-emerald-300">
                <CalendarCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
                <dt className="sr-only">Your slot</dt>
                <dd className="font-medium">Your slot: {formatClockTime(myBooking.slot_time)}</dd>
              </div>
            )}
            {/* Online: one row per teacher, the booked time with its Join (the
                server's school-time bounds, the link once the room exists), or
                "no slot yet" when the family has other teachers to book with. */}
            {isStudent &&
              online &&
              status !== "cancelled" &&
              seats.map((x) =>
                x.slotTime ? (
                  <Fragment key={x.session.teacher_id}>
                    <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 px-3 py-2 text-emerald-700 ring-1 ring-inset ring-emerald-500/20 dark:text-emerald-300">
                      <CalendarCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <dt className="sr-only">Your slot</dt>
                      <dd className="min-w-0 truncate font-medium">
                        {seats.length === 1 ? "Your slot" : `With ${x.session.teacher_name}`}: {formatClockTime(x.slotTime)}
                      </dd>
                    </div>
                    {x.bounds && (
                      <div className="pt-1">
                        <dt className="sr-only">Join meeting</dt>
                        <dd>
                          <JoinMeetButton
                            meetUri={x.meetUri}
                            slotStart={x.bounds.start}
                            slotEnd={x.bounds.end}
                            bufferMinutes={ptm.slot_buffer_minutes}
                            now={now ?? new Date()}
                          />
                        </dd>
                      </div>
                    )}
                  </Fragment>
                ) : seats.length > 1 ? (
                  <div
                    key={x.session.teacher_id}
                    className="flex items-center gap-2 rounded-xl bg-muted/60 px-3 py-2 text-ink-700 ring-1 ring-inset ring-surface-stroke"
                  >
                    <Clock className="h-4 w-4 shrink-0 text-ink-500" aria-hidden="true" />
                    <dt className="sr-only">Your slot</dt>
                    <dd className="min-w-0 truncate">With {x.session.teacher_name}: no slot yet</dd>
                  </div>
                ) : null,
              )}
            {sessionFailed && (
              <div className="flex items-start justify-between gap-2 rounded-xl bg-rose-500/10 px-3 py-2 text-ink-900 ring-1 ring-inset ring-rose-500/20">
                <span className="flex min-w-0 items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="font-medium">Couldn't load your slot</span>
                    <span className="block text-xs text-ink-600">Check your connection and try again.</span>
                  </span>
                </span>
                {onRetryMySession && (
                  <Button type="button" variant="outline" size="sm" className="h-8 shrink-0 text-xs" onClick={onRetryMySession}>
                    Retry
                  </Button>
                )}
              </div>
            )}
            {bookingClosed && (
              <div className="flex items-start gap-2 rounded-xl bg-muted/60 px-3 py-2 text-ink-900 ring-1 ring-inset ring-surface-stroke">
                <Timer className="mt-0.5 h-4 w-4 shrink-0 text-ink-500" aria-hidden="true" />
                <dt className="sr-only">Slot booking</dt>
                <dd className="min-w-0">
                  <span className="font-medium">Slot booking has closed</span>
                  <span className="block text-xs text-ink-600">
                    Booking is open {describeBookingWindow(ptm)}. Ask the school if you still need a
                    time.
                  </span>
                </dd>
              </div>
            )}
            {feedbackSent && myFeedback && (
              <div className="flex items-start gap-2 rounded-xl bg-brand-secondary/10 px-3 py-2 text-ink-900 ring-1 ring-inset ring-brand-secondary/20">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-secondary" aria-hidden="true" />
                <dt className="sr-only">Your feedback</dt>
                <dd className="min-w-0">
                  <span className="font-medium">Feedback sent · {myFeedback.rating} of 5 stars</span>
                  {editUntil && (
                    <span className="block text-xs text-ink-600">You can edit it until {editUntil}</span>
                  )}
                </dd>
              </div>
            )}
          </dl>

          {(showSlotNote || hasActions) && (
            <div className="mt-auto pt-4">
              <div className="flex flex-wrap items-center gap-3 border-t border-surface-stroke pt-4">
                {showSlotNote && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-brand-accent/10 px-2 py-1 text-xs font-medium text-ink-700">
                    <Timer className="h-3.5 w-3.5 text-brand-accent" aria-hidden="true" />
                    Slot booking on, {ptm.slot_duration_minutes}-minute slots
                  </span>
                )}
                {hasActions && (
                  <div className="ml-auto flex flex-wrap gap-2">
                    {showOpen && (
                      // The whole card opens the PTM: the button's ::after layer
                      // covers the card, so there is still exactly one interactive
                      // element (no nested buttons for screen readers and keyboards).
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={onOpen}
                        aria-label={`Open ${ptm.title}`}
                        className="bg-brand-primary/10 text-teal-700 transition-colors duration-200 after:absolute after:inset-0 after:rounded-card hover:bg-brand-primary hover:text-primary-foreground group-hover:bg-brand-primary group-hover:text-primary-foreground dark:text-teal-300"
                      >
                        Open
                        <ArrowRight
                          className="ml-1 h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none"
                          aria-hidden="true"
                        />
                      </Button>
                    )}
                    {showBook && (
                      <Button variant={bookLabel === "Book a slot" ? "default" : "outline"} size="sm" onClick={onBook}>
                        {bookLabel}
                      </Button>
                    )}
                    {showFeedback &&
                      (feedbackSent ? (
                        // Already sent: editing is the secondary action, so it
                        // steps down to outline and says what it does.
                        <Button variant="outline" size="sm" onClick={onFeedback}>
                          <Pencil className="mr-1.5 h-4 w-4" aria-hidden="true" />
                          Edit feedback
                        </Button>
                      ) : (
                        <Button variant={showBook ? "outline" : "default"} size="sm" onClick={onFeedback}>
                          <MessageSquareHeart className="mr-1.5 h-4 w-4" aria-hidden="true" />
                          Give feedback
                        </Button>
                      ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </article>
    </div>
  );
}
