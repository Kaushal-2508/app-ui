import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { format } from "date-fns";
import {
  AudioLines,
  CalendarX,
  CircleCheck,
  Clock,
  GraduationCap,
  Loader2,
  Lock,
  MapPin,
  Pencil,
  Send,
  Star,
  Video,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/shared/surfaces";
import { TONES } from "@/components/shared/design-system";
import { AudioRecorder } from "./AudioRecorder";
import { AudioPlayer } from "./AudioPlayer";
import { cn, formatClassName } from "@/lib/utils";
import { PTM_TEXT_MAX, formatDuration, formatPTMDate, formatTimeRange } from "@/lib/ptm";
import {
  useSubmitPTMFeedback,
  type PTMAudioDraft,
  type PTMFeedbackContext,
  type PTMMyFeedback,
} from "@/hooks/ptm";

interface Props {
  context: PTMFeedbackContext;
  userId: string;
  /** Shown as "Done" once feedback is sent; the sheet passes its close. */
  onDone?: () => void;
  /** Pin the action row to the bottom of the scrolling parent. Only for a
   *  MobileSheet body: the bar's negative margins undo that body's px-5 py-4. */
  stickyActions?: boolean;
}

const RATING_WORDS = ["", "Poor", "Fair", "Good", "Very good", "Excellent"];
const STARS = [1, 2, 3, 4, 5];
/** On the root of a view that ends in a sticky ActionBar; see ActionBar. */
const STICKY_END = "-mb-4";

/** "Fri 2 Oct, 1:36 PM"; the year only when it is not this one. */
function formatStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return format(d, sameYear ? "EEE d MMM, h:mm a" : "EEE d MMM yyyy, h:mm a");
}

/** The calendar tile's three lines. A date-only string is local, not UTC. */
function calendarTile(date: string): { month: string; day: string; weekday: string } | null {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return null;
  const at = new Date(y, m - 1, d);
  return { month: format(at, "MMM"), day: format(at, "d"), weekday: format(at, "EEE") };
}

/** The prompt follows the rating, so the box asks the question worth answering. */
function messagePrompt(rating: number): string {
  if (rating >= 4) return "What went well? Anything the teacher should keep doing?";
  if (rating === 3) return "What would have made the meeting better?";
  if (rating >= 1) return "What didn't go well, and what would help next time?";
  return "What went well, what could be better.";
}

/** Everything the realign effect compares, so any change in a refetched row is seen. */
function feedbackStamp(f: PTMMyFeedback | null): string {
  return f ? [f.id, f.updated_at, f.rating, f.text_message ?? "", f.audio_path ?? ""].join("|") : "";
}

/** Changed more than a minute after it was first sent. */
function wasEdited(f: PTMMyFeedback): boolean {
  return new Date(f.updated_at).getTime() - new Date(f.submitted_at).getTime() > 60_000;
}

/** Date tile plus the facts a family checks: when, which class, where. */
function MeetingTicket({ context, status }: { context: PTMFeedbackContext; status?: ReactNode }) {
  const tile = calendarTile(context.scheduled_date);
  const iconClass = "mt-0.5 h-4 w-4 shrink-0 text-ink-500";
  return (
    <div className="overflow-hidden rounded-2xl border border-surface-stroke bg-muted/40">
      <div className="flex gap-4 p-4">
        {tile && (
          // Decorative: the list beside it reads the date out.
          <div
            className="flex w-14 shrink-0 flex-col items-center self-start rounded-xl bg-brand-primary/10 py-2"
            aria-hidden="true"
          >
            <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-600">
              {tile.month}
            </span>
            <span className="text-2xl font-bold leading-tight text-brand-primary">{tile.day}</span>
            <span className="text-[11px] text-ink-600">{tile.weekday}</span>
          </div>
        )}
        <ul className="min-w-0 flex-1 space-y-1 text-sm">
          <li className="flex items-start gap-2 font-semibold text-ink-900">
            <Clock className={iconClass} aria-hidden="true" />
            <span>
              <span className={tile ? "sr-only" : undefined}>{formatPTMDate(context.scheduled_date)}, </span>
              {formatTimeRange(context.start_time, context.end_time)}
            </span>
          </li>
          <li className="flex items-start gap-2 text-ink-700">
            <GraduationCap className={iconClass} aria-hidden="true" />
            <span className="min-w-0 break-words">
              {context.my_class_name
                ? formatClassName(context.my_class_name, context.my_class_section)
                : "Your class"}
            </span>
          </li>
          {context.mode === "online" && (
            <li className="flex items-start gap-2 text-ink-700">
              <Video className={iconClass} aria-hidden="true" />
              <span className="min-w-0 break-words">
                Online with {context.my_teacher_name ?? "your teacher"}
              </span>
            </li>
          )}
          {context.venue && (
            <li className="flex items-start gap-2 text-ink-700">
              <MapPin className={iconClass} aria-hidden="true" />
              <span className="min-w-0 break-words">{context.venue}</span>
            </li>
          )}
          {context.description && (
            <li className="line-clamp-2 pt-1 text-xs text-ink-500">{context.description}</li>
          )}
        </ul>
      </div>
      {status && (
        <div className="flex items-center gap-2 border-t border-surface-stroke px-4 py-2 text-xs text-ink-600">
          {status}
        </div>
      )}
    </div>
  );
}

/** Five stars on the radio pattern: one tab stop, arrow keys move and select. */
function StarInput({
  value,
  onChange,
  disabled,
  labelledBy,
}: {
  value: number;
  onChange: (n: number) => void;
  disabled?: boolean;
  labelledBy: string;
}) {
  const [hover, setHover] = useState(0);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const captionId = useId();
  const shown = hover || value;

  const choose = (n: number) => {
    onChange(n);
    refs.current[n - 1]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") next = Math.min(5, value + 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = Math.max(1, value - 1);
    else if (e.key === "Home") next = 1;
    else if (e.key === "End") next = 5;
    if (next === null) return;
    e.preventDefault();
    choose(next);
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        role="radiogroup"
        aria-labelledby={labelledBy}
        aria-describedby={captionId}
        className="flex items-center gap-1"
        onKeyDown={onKeyDown}
        onPointerLeave={() => setHover(0)}
      >
        {STARS.map((n) => (
          <Button
            key={n}
            ref={(el) => {
              refs.current[n - 1] = el;
            }}
            type="button"
            variant="ghost"
            size="icon"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} of 5, ${RATING_WORDS[n]}`}
            tabIndex={n === (value || 1) ? 0 : -1}
            disabled={disabled}
            // Mouse only: a tap fires pointerenter as well, and on touch no
            // pointerleave follows to clear it, so the preview would stick.
            onPointerEnter={(e) => {
              if (e.pointerType === "mouse") setHover(n);
            }}
            onClick={() => choose(n)}
            // The base Button forces 16px icons.
            className="h-12 w-12 rounded-xl hover:bg-brand-accent/10 focus-visible:ring-brand-accent/60 [&_svg]:size-9"
          >
            <Star
              aria-hidden="true"
              className={cn(
                "transition-colors",
                n <= shown ? "fill-brand-accent text-brand-accent" : "fill-transparent text-ink-400",
                n === value && "animate-in zoom-in-75 duration-300 motion-reduce:animate-none",
              )}
            />
          </Button>
        ))}
      </div>
      <p id={captionId} className="min-h-[20px] text-sm">
        {shown ? (
          <>
            <span className="font-semibold text-ink-900">{RATING_WORDS[shown]}</span>
            <span className="text-ink-500"> · {shown} of 5</span>
          </>
        ) : (
          <span className="text-ink-500">Tap a star to rate</span>
        )}
      </p>
    </div>
  );
}

function StarDisplay({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1" role="img" aria-label={`${value} of 5, ${RATING_WORDS[value] ?? ""}`}>
        {STARS.map((n) => (
          <Star
            key={n}
            aria-hidden="true"
            className={cn(
              "h-5 w-5",
              n <= value ? "fill-brand-accent text-brand-accent" : "fill-transparent text-ink-400",
            )}
          />
        ))}
      </div>
      <span className="text-sm font-semibold text-ink-900" aria-hidden="true">
        {RATING_WORDS[value]}
      </span>
    </div>
  );
}

/**
 * The send row. Sticky, it pins to the bottom of the sheet body: a sticky box
 * stops short of its scroller's padding, so `-bottom-4` cancels the body's
 * 16px and `-mx-5` takes it edge to edge. The matching `-mb-4` sits on the
 * view's root (STICKY_END), because the parent's space-y-6 resets a child's
 * bottom margin; without it the bar rides 16px up at the end of the scroll.
 */
function ActionBar({ sticky, children }: { sticky?: boolean; children: ReactNode }) {
  return (
    <div
      className={cn(
        "space-y-2",
        sticky &&
          "sticky -bottom-4 z-10 -mx-5 border-t border-surface-stroke bg-surface-card px-5 pt-3 pb-[max(env(safe-area-inset-bottom),16px)]",
      )}
    >
      {children}
    </div>
  );
}

/**
 * The family's feedback on one meeting: a rating, a message, a voice note.
 * The same form serves the QR token route and the "active" route. The
 * window (open, not yet open, closed) comes from the server in the school's
 * timezone; the form only renders what it is told.
 *
 * Feedback already sent opens on a summary of it with an Edit button, and a
 * save lands on the same summary under a thank-you, so a family always sees
 * what the school received.
 */
export function PTMFeedbackForm({ context, userId, onDone, stickyActions = false }: Props) {
  const existing = context.my_feedback;
  const [rating, setRating] = useState(existing?.rating ?? 0);
  const [text, setText] = useState(existing?.text_message ?? "");
  const [audio, setAudio] = useState<PTMAudioDraft | null>(null);
  const [keepExisting, setKeepExisting] = useState(!!existing?.audio_path);
  const [dirty, setDirty] = useState(false);
  const [recording, setRecording] = useState(false);
  const [editing, setEditing] = useState(!existing);
  const [justSent, setJustSent] = useState(false);
  // From a save until the refetch brings the new row. Edit waits for it, or
  // the form would reopen on the replaced recording's deleted path.
  const [awaitingSync, setAwaitingSync] = useState(false);
  const submit = useSubmitPTMFeedback();
  const questionId = useId();
  const thanksRef = useRef<HTMLHeadingElement>(null);

  const applyFeedback = useCallback((f: PTMMyFeedback | null) => {
    setRating(f?.rating ?? 0);
    setText(f?.text_message ?? "");
    setKeepExisting(!!f?.audio_path);
    setAudio(null);
  }, []);

  // Realign only when the row itself changes, never merely because `dirty`
  // cleared: on save, the fields keep what was sent until the refetch lands,
  // instead of flashing back to the old row in between. A row that lands
  // while the form is dirty is not marked synced, so it still applies once
  // dirty clears; that covers a refetch finishing before the save's
  // onSuccess runs, which happens whenever the hook awaits its invalidation.
  const stamp = feedbackStamp(existing);
  const syncedStamp = useRef(stamp);
  useEffect(() => {
    if (dirty || stamp === syncedStamp.current) return;
    syncedStamp.current = stamp;
    applyFeedback(existing);
    setAwaitingSync(false);
  }, [stamp, existing, dirty, applyFeedback]);

  // If the refetch never brings a changed row, do not hold Edit forever.
  useEffect(() => {
    if (!awaitingSync) return;
    const t = window.setTimeout(() => setAwaitingSync(false), 4000);
    return () => window.clearTimeout(t);
  }, [awaitingSync]);

  // The submit button just unmounted; hand focus to the thank-you.
  useEffect(() => {
    if (justSent) thanksRef.current?.focus();
  }, [justSent]);

  const closed = context.window_state === "closed";

  const openStatus = (
    <>
      <span className="h-2 w-2 shrink-0 rounded-full bg-[hsl(var(--status-completed))]" aria-hidden="true" />
      Feedback open until {formatStamp(context.closes_at)}
    </>
  );
  const closedStatus = (
    <>
      <Lock className="h-3.5 w-3.5 shrink-0 text-ink-500" aria-hidden="true" />
      Feedback closed {formatStamp(context.closes_at)}
    </>
  );

  if (context.window_state === "cancelled") {
    return (
      <div className="space-y-6">
        <MeetingTicket context={context} />
        <EmptyState
          icon={<CalendarX className="h-7 w-7" />}
          tone="rose"
          reason="noData"
          title="This meeting was cancelled"
          description="There is nothing to give feedback on. The school will let you know if it is rescheduled."
        />
      </div>
    );
  }

  if (context.window_state === "not_open") {
    return (
      <div className="space-y-6">
        <MeetingTicket context={context} />
        <EmptyState
          icon={<Lock className="h-7 w-7" />}
          tone="sky"
          reason="noData"
          title="Feedback opens when the meeting starts"
          description={`Come back from ${formatStamp(context.opens_at)}.`}
        />
      </div>
    );
  }

  if (closed && !existing) {
    return (
      <div className="space-y-6">
        <MeetingTicket context={context} status={closedStatus} />
        <EmptyState
          icon={<Lock className="h-7 w-7" />}
          reason="noData"
          title="Feedback has closed"
          description="No feedback was sent for this meeting before it closed."
        />
      </div>
    );
  }

  // ---- What was sent: after a save, on return, and read-only once closed.
  if (closed || !editing) {
    const message = text.trim();
    const savedAudioPath = keepExisting ? existing?.audio_path ?? null : null;
    const sentLine =
      existing && !awaitingSync
        ? `${wasEdited(existing) ? "Updated" : "Sent"} ${formatStamp(existing.updated_at)}`
        : null;

    return (
      <div className={cn("space-y-6", stickyActions && !closed && STICKY_END)}>
        <MeetingTicket context={context} status={closed ? closedStatus : openStatus} />

        {justSent && (
          <div className="flex flex-col items-center text-center">
            <span
              className={cn(
                "flex h-16 w-16 items-center justify-center rounded-full animate-in zoom-in-50 duration-300 motion-reduce:animate-none",
                TONES.mint.bg,
                TONES.mint.fg,
              )}
              aria-hidden="true"
            >
              <CircleCheck className="h-8 w-8" />
            </span>
            <h3 ref={thanksRef} tabIndex={-1} className="mt-4 text-lg font-semibold text-ink-900 focus:outline-none">
              Thank you!
            </h3>
            <p className="mt-1 max-w-xs text-sm text-ink-600">
              Your feedback has been sent to the school. It helps make the next meeting better.
            </p>
          </div>
        )}

        <section className="space-y-4 rounded-2xl border border-surface-stroke p-4">
          <div>
            <h3 className="text-sm font-semibold text-ink-900">
              {justSent || closed ? "What you sent" : "Your feedback"}
            </h3>
            {sentLine && <p className="text-xs text-ink-500">{sentLine}</p>}
          </div>
          <StarDisplay value={rating} />
          {message && (
            <p className="whitespace-pre-wrap break-words border-l-2 border-brand-primary/40 pl-3 text-sm text-ink-700">
              {message}
            </p>
          )}
          {audio ? (
            // Just sent, before the refetch brings its stored path back.
            <p className="flex items-center gap-2 text-sm text-ink-700">
              <AudioLines className="h-4 w-4 shrink-0 text-brand-primary" aria-hidden="true" />
              Voice note, {formatDuration(audio.durationSeconds)}
            </p>
          ) : savedAudioPath ? (
            <AudioPlayer
              path={savedAudioPath}
              durationSeconds={existing?.audio_duration_seconds}
              label="Play voice note"
              className="h-10 w-full bg-transparent dark:[color-scheme:dark]"
            />
          ) : null}
        </section>

        {!closed && (
          <ActionBar sticky={stickyActions}>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant={onDone ? "outline" : "default"}
                disabled={awaitingSync}
                onClick={() => {
                  setJustSent(false);
                  setEditing(true);
                }}
                className="w-full sm:w-auto"
              >
                <Pencil aria-hidden="true" />
                Edit feedback
              </Button>
              {onDone && (
                <Button type="button" onClick={onDone} className="w-full sm:w-auto sm:min-w-[120px]">
                  Done
                </Button>
              )}
            </div>
            <p className="text-center text-xs text-ink-500 sm:text-right">
              You can change it until {formatStamp(context.closes_at)}.
            </p>
          </ActionBar>
        )}
      </div>
    );
  }

  // ---- The form.
  const canSubmit = rating >= 1 && !recording && !submit.isPending && (!existing || dirty);
  const nearCap = text.length >= PTM_TEXT_MAX * 0.9;
  const hint = recording
    ? "Stop the recording to send."
    : rating === 0
      ? "Choose a star rating to send."
      : existing && !dirty
        ? "Nothing has changed yet."
        : `You can still change it until ${formatStamp(context.closes_at)}.`;

  return (
    <form
      data-dirty={dirty ? "true" : undefined}
      className={cn("space-y-6", stickyActions && STICKY_END)}
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSubmit) return;
        submit.mutate(
          {
            ptmId: context.ptm_id,
            userId,
            rating,
            text,
            audio,
            existingAudio:
              keepExisting && existing?.audio_path
                ? {
                    path: existing.audio_path,
                    durationSeconds: existing.audio_duration_seconds,
                    format: existing.audio_format,
                  }
                : null,
          },
          {
            onSuccess: () => {
              // The draft stays until the refetch: the summary shows it, and
              // the realign effect swaps in the stored path when it lands.
              setDirty(false);
              setAwaitingSync(true);
              setEditing(false);
              setJustSent(true);
            },
          },
        );
      }}
    >
      <MeetingTicket context={context} status={openStatus} />

      <section
        aria-labelledby={questionId}
        className="rounded-2xl border border-brand-accent/20 bg-brand-accent/5 px-4 py-6 text-center"
      >
        <h3 id={questionId} className="text-base font-semibold text-ink-900">
          {context.mode === "online"
            ? `How was your online meeting with ${context.my_teacher_name ?? "the teacher"}?`
            : "How was your meeting with the teachers?"}
        </h3>
        <div className="mt-4">
          <StarInput
            value={rating}
            labelledBy={questionId}
            disabled={submit.isPending}
            onChange={(n) => {
              setDirty(true);
              setRating(n);
            }}
          />
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-ink-900">Anything else to share?</h3>
            <p className="text-xs text-ink-500">Write a message, record a voice note, or both.</p>
          </div>
          <span className="shrink-0 rounded-full bg-muted px-2 py-1 text-[11px] font-medium text-ink-600">
            Optional
          </span>
        </div>

        <div className="space-y-1">
          <Label htmlFor="ptm-feedback-text" className="sr-only">
            Your message
          </Label>
          <Textarea
            id="ptm-feedback-text"
            value={text}
            onChange={(e) => {
              setDirty(true);
              setText(e.target.value.slice(0, PTM_TEXT_MAX));
            }}
            placeholder={messagePrompt(rating)}
            rows={4}
            maxLength={PTM_TEXT_MAX}
            disabled={submit.isPending}
            className="min-h-[112px] resize-none rounded-xl bg-surface-card leading-relaxed"
          />
          <p
            className={cn(
              "text-right text-xs tabular-nums",
              nearCap ? "font-medium text-signal-warn" : "text-ink-500",
            )}
          >
            {text.length} / {PTM_TEXT_MAX}
          </p>
        </div>

        <AudioRecorder
          value={audio}
          onChange={(next) => {
            setDirty(true);
            setAudio(next);
          }}
          existingPath={keepExisting ? existing?.audio_path ?? null : null}
          existingDurationSeconds={existing?.audio_duration_seconds}
          onRemoveExisting={() => {
            setDirty(true);
            setKeepExisting(false);
          }}
          onRecordingChange={setRecording}
          disabled={submit.isPending}
        />
      </section>

      <ActionBar sticky={stickyActions}>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
          {existing && (
            <Button
              type="button"
              variant="ghost"
              disabled={submit.isPending || recording}
              onClick={() => {
                applyFeedback(existing);
                setDirty(false);
                setEditing(false);
              }}
              className="w-full sm:w-auto"
            >
              Cancel
            </Button>
          )}
          <Button type="submit" disabled={!canSubmit} className="w-full sm:w-auto sm:min-w-[160px]">
            {submit.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Send aria-hidden="true" />}
            {submit.isPending ? "Sending" : existing ? "Save changes" : "Send feedback"}
          </Button>
        </div>
        <p className="text-center text-xs text-ink-500 sm:text-right" aria-live="polite">
          {hint}
        </p>
      </ActionBar>
    </form>
  );
}
