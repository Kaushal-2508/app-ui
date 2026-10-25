import { useId, useState } from "react";
import { ChevronDown, ChevronRight, Info, Trophy } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import { MedalDisc } from "../MedalDisc";
import { MEDAL_BAR_FILL, MEDAL_SHORT_LABEL } from "../medalStyles";
import { MEDAL_LABEL, medalProgressRatio, type MedalLadder } from "./medals";

/** "Medal progress", the small section heading above the card. */
export function MedalProgressHeading({ className }: { className?: string }) {
  return (
    <h2
      className={cn(
        "inline-flex items-center gap-2 px-1 text-[17px] font-semibold leading-6 text-ink-900",
        className,
      )}
    >
      <Trophy className="h-5 w-5 text-brand-primary" aria-hidden="true" />
      Medal progress
    </h2>
  );
}

export interface MedalProgressCardProps {
  /** Teacher's display name, the card's title. */
  name: string;
  /** From `buildMedalLadder()`. */
  ladder: MedalLadder;
  /**
   * The to-do list for the next medal, kept behind a dropdown inside the
   * card. `count` is what the toggle shows. Omit it (empty catalog, Diamond
   * held) and the card has no dropdown and the name is plain text.
   */
  todo?: { count: number; content: React.ReactNode };
  className?: string;
}

/**
 * The medal held, how far the next one is, and (behind a dropdown) what is
 * left to get there.
 *
 * The layout is the VIP-progress pattern Naman picked on 2026-10-12: emblem,
 * name with a chevron, one percentage with an info button, a pale-to-saturated
 * bar in the colour of the next medal, the medal held at the left end and the
 * next one at the right. A calm `surface-card`, not a teal HeroCard: the
 * reference is a quiet dark panel, and in dark mode the card surface IS that
 * panel.
 *
 * The dropdown replaced a separate card below the hero the same day
 * ("instead of this bottom column add a dropdown in above column"). Collapsed
 * by default; the name's chevron and the "What's left" row both toggle it.
 *
 * The percentage is the MEAN progress across the next medal's requirements
 * (`medalProgressRatio`), rounded DOWN, so the bar moves on the day a teacher
 * marks their eleventh register rather than only when a whole badge lands,
 * and never overstates.
 *
 * "No medal yet" is a real state, not an error: a medal is earned by meeting
 * every requirement of its rung, so a new teacher holds none. The emblem then
 * shows the NEXT medal drained of colour, the thing to work toward, rather
 * than a bronze disc that would claim something not yet true.
 */
export function MedalProgressCard({ name, ladder, todo, className }: MedalProgressCardProps) {
  const [expanded, setExpanded] = useState(false);
  const todoId = `medal-todo-${useId().replace(/:/g, "")}`;
  const { current, next } = ladder;
  const nextStep = next ? (ladder.steps.find((s) => s.medal === next) ?? null) : null;
  const pct = nextStep ? Math.floor(medalProgressRatio(nextStep) * 100) : 100;
  const bar = next ?? "diamond";
  const title = current ? MEDAL_LABEL[current] : "No medal yet";
  const leftLabel = current ? MEDAL_SHORT_LABEL[current] : "No medal";
  const rightLabel = next ? MEDAL_SHORT_LABEL[next] : "Highest medal";
  const barLabel = next ? `Progress toward the ${MEDAL_LABEL[next]}` : "Every medal earned";
  const hasTodo = !!todo && !!next && todo.count > 0;
  const explain =
    nextStep && next
      ? `${pct}% is the average progress across the ${nextStep.total} requirements for the ${MEDAL_LABEL[next]}, ${nextStep.metCount} of them already met.${hasTodo ? " Open the list below to see what is left." : ""}`
      : "You hold the Diamond Medal, the highest there is. Every requirement is met.";
  const toggle = () => setExpanded((v) => !v);

  return (
    <div className={cn("surface-card frosted-shadow rounded-card p-4 sm:p-5", className)}>
      <div className="flex items-center gap-4 sm:gap-5">
        <MedalDisc medal={current ?? bar} earned={current !== null} size="lg" label={title} />

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            {hasTodo ? (
              <button
                type="button"
                onClick={toggle}
                aria-expanded={expanded}
                aria-controls={todoId}
                className="inline-flex min-w-0 items-center gap-0.5 rounded-md text-left text-[20px] font-bold leading-7 text-ink-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40"
              >
                <span className="truncate">{name}</span>
                <ChevronRight
                  className={cn(
                    "h-5 w-5 shrink-0 text-brand-primary transition-transform duration-200 motion-reduce:transition-none",
                    expanded && "rotate-90",
                  )}
                  aria-hidden="true"
                />
              </button>
            ) : (
              <p className="truncate text-[20px] font-bold leading-7 text-ink-900">{name}</p>
            )}

            <div className="flex shrink-0 items-center gap-1.5">
              <span className="text-[20px] font-bold leading-7 tabular-nums text-ink-900">{pct}%</span>
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    aria-label="How progress is measured"
                    className="grid h-6 w-6 place-items-center rounded-full bg-ink-400/15 text-ink-700 transition-colors duration-200 hover:bg-ink-400/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40"
                  >
                    <Info className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-72 text-[13px] leading-[18px] text-ink-700">
                  {explain}
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <div
            className="mt-3 h-3 overflow-hidden rounded-full bg-ink-400/15"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            aria-label={barLabel}
          >
            {/* Dynamic width is the one sanctioned inline style (same as the
                goal card's bar); a 1% fill is lifted to 3% so it shows. */}
            <div
              className={cn(
                "h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none",
                MEDAL_BAR_FILL[bar],
              )}
              style={{ width: `${pct === 0 ? 0 : Math.max(3, pct)}%` }}
            />
          </div>

          <div className="mt-2 flex items-center justify-between gap-3 text-[15px] leading-5 text-ink-600">
            <span>{leftLabel}</span>
            <span>{rightLabel}</span>
          </div>
        </div>
      </div>

      {hasTodo && next && (
        <>
          <button
            type="button"
            onClick={toggle}
            aria-expanded={expanded}
            aria-controls={todoId}
            className="mt-4 flex w-full items-center justify-between gap-3 rounded-md border-t border-[hsl(var(--surface-stroke))] pt-3 text-left text-[14px] font-medium leading-5 text-ink-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40"
          >
            <span>What's left for the {MEDAL_LABEL[next]}</span>
            <span className="inline-flex shrink-0 items-center gap-1.5 text-ink-500">
              <span className="rounded-full bg-brand-primary/10 px-2 py-0.5 text-[12px] font-semibold tabular-nums text-brand-primary">
                {todo.count}
              </span>
              <ChevronDown
                className={cn(
                  "h-4 w-4 transition-transform duration-200 motion-reduce:transition-none",
                  expanded && "rotate-180",
                )}
                aria-hidden="true"
              />
            </span>
          </button>
          <div id={todoId} hidden={!expanded} className="mt-1">
            {todo.content}
          </div>
        </>
      )}
    </div>
  );
}
