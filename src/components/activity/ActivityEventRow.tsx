import { ArrowRight, ChevronRight } from "lucide-react";
import { format } from "date-fns";

import { TONES, type Tone } from "@/components/shared/design-system";
import { cn } from "@/lib/utils";
import { SourceIcon } from "./SourceIcon";
import { SOURCE_META, actionPhrase, humanize, statusTone, type ActivityEvent } from "./activityModel";

export function StatusChip({ status, tone }: { status: string; tone?: Tone | null }) {
  const t = tone ? TONES[tone] : null;
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center whitespace-nowrap rounded-md px-1.5 text-[11px] font-medium leading-none",
        t ? cn(t.bg, t.fg) : "bg-ink-400/10 text-ink-700",
      )}
    >
      {humanize(status)}
    </span>
  );
}

interface ActivityEventRowProps {
  event: ActivityEvent;
  onOpen: (event: ActivityEvent) => void;
}

/**
 * One timeline row: source disc, "Actor did X to Entity" sentence, a quiet
 * meta line (source, entity kind, status move, reason) and the clock time on
 * the right. The day itself lives in the group header above, so the row only
 * repeats what changes between rows.
 */
export function ActivityEventRow({ event, onOpen }: ActivityEventRowProps) {
  const meta = SOURCE_META[event.source];
  const t = TONES[meta.tone];
  const time = format(new Date(event.createdAt), "h:mm a");

  return (
    <button
      type="button"
      onClick={() => onOpen(event)}
      className="group flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-ink-400/5 focus-visible:bg-ink-400/5 focus-visible:outline-none sm:px-5"
    >
      <span
        className={cn(
          // Raised disc: hairline inset highlight + soft shadow + a top-left
          // sheen, and a small lift when the row is hovered.
          "relative mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl shadow-card-sm ring-1 ring-inset ring-white/60 transition-transform duration-200 group-hover:-translate-y-0.5 dark:ring-white/10",
          t.bg,
          t.fg,
        )}
      >
        <span className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/60 to-transparent dark:from-white/10" aria-hidden />
        <SourceIcon source={event.source} className="relative h-5 w-5" />
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-[15px] leading-[22px] text-ink-900">
          <span className="font-semibold">{event.actor.name}</span>{" "}
          <span className="text-ink-600">{actionPhrase(event.action)}</span>{" "}
          <span className="font-semibold break-words">{event.entity.name}</span>
        </p>

        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] leading-5 text-ink-500">
          <span className={cn("inline-flex h-5 items-center rounded-md px-1.5 text-[11px] font-semibold uppercase tracking-[0.04em]", t.bg, t.fg)}>
            {meta.short}
          </span>
          <span className="capitalize">{humanize(event.entity.type)}</span>
          {(event.fromStatus || event.toStatus) && (
            <>
              <span aria-hidden className="text-ink-400">·</span>
              <span className="inline-flex items-center gap-1">
                {event.fromStatus && <StatusChip status={event.fromStatus} />}
                {event.fromStatus && event.toStatus && <ArrowRight className="h-3 w-3 text-ink-400" aria-hidden />}
                {event.toStatus && <StatusChip status={event.toStatus} tone={statusTone(event.toStatus)} />}
              </span>
            </>
          )}
          {event.reason && (
            // One flex item, so the separator can never wrap onto a line of its own.
            <span className="inline-flex min-w-0 max-w-full items-center gap-2">
              <span aria-hidden className="text-ink-400">·</span>
              <span className="truncate italic text-ink-600">"{event.reason}"</span>
            </span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1 self-center">
        <span className="text-[13px] tabular-nums text-ink-600">{time}</span>
        <ChevronRight className="h-4 w-4 text-ink-400 transition-transform group-hover:translate-x-0.5" aria-hidden />
      </div>
    </button>
  );
}
