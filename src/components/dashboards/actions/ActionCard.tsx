import { type ReactNode } from "react";

import type { Tone } from "@/components/shared/surfaces";
import { cn } from "@/lib/utils";
import { CLAY_TONE } from "./actionCardStyles";

export interface ActionCardProps {
  tone: Tone;
  icon: ReactNode;
  /** a short category above the title, from 768px ("Attendance", "Leave") */
  eyebrow: string;
  title: string;
  detail: string;
  actions?: ReactNode;
}

// The glass pebble: top right below 768px (the pager owns the bottom right), then in the
// colour field between the words and the pager. A lone card has no pager, so it sits further
// right and centred.
const ART_IN_DECK =
  "right-4 top-3 h-11 w-11 sm:right-6 sm:top-4 sm:h-12 sm:w-12 md:left-[57%] md:right-auto md:top-1/2 md:h-16 md:w-16 md:-translate-x-1/2 md:-translate-y-1/2 lg:left-[61%] xl:left-[64%] xl:h-[84px] xl:w-[84px]";
const ART_ALONE =
  "right-4 top-1/2 h-11 w-11 -translate-y-1/2 sm:right-6 sm:h-12 sm:w-12 md:left-[78%] md:right-auto md:h-16 md:w-16 md:-translate-x-1/2 xl:left-[82%] xl:h-[84px] xl:w-[84px]";

/**
 * One bold card of the dashboard's action deck (index.css .action-slide): the clay tone's deep
 * colour with white type, a category line, the title, one line of detail and the buttons,
 * plus a glass pebble that fills the right side. It fills the banner's box at every width.
 * `position` is its place in the deck; a deck of one has no pager, so its pebble moves right.
 */
export function ActionCard({
  tone,
  icon,
  eyebrow,
  title,
  detail,
  actions,
  position,
}: ActionCardProps & { position: { index: number; count: number } }) {
  const alone = position.count === 1;
  return (
    <article
      aria-roledescription="slide"
      aria-label={`${position.index + 1} of ${position.count}: ${title}`}
      className={cn(
        "action-slide flex h-full w-full shrink-0 snap-start snap-always flex-col px-4 py-3 sm:px-6 sm:py-4 md:pb-3 lg:pb-4 lg:pt-5 xl:px-8 xl:pb-5 xl:pt-6",
        actions ? "justify-between" : "justify-center",
        CLAY_TONE[tone],
      )}
    >
      <div className={cn("action-art absolute", alone ? ART_ALONE : ART_IN_DECK)} aria-hidden>
        <span className="action-bloom" />
        <span className="action-ring action-ring-3" />
        <span className="action-ring action-ring-2" />
        <span className="action-ring action-ring-1" />
        <span className="action-glass">{icon}</span>
      </div>
      <div className="relative min-w-0 pr-14 sm:pr-16 md:max-w-[46%] md:pr-0 lg:max-w-[48%] xl:max-w-[52%]">
        <p className="action-eyebrow hidden md:flex">{eyebrow}</p>
        <h3 className="truncate text-[15px] font-semibold leading-5 tracking-tight sm:text-[17px] sm:leading-6 md:mt-1 lg:text-[22px] lg:font-bold lg:leading-7 xl:text-[24px] xl:leading-[30px]">
          {title}
        </h3>
        <p className="action-detail mt-1 truncate text-[13px] leading-[18px] sm:text-sm sm:leading-5 xl:text-[15px] xl:leading-[22px]">
          {detail}
        </p>
      </div>
      {actions ? <div className="relative flex min-w-0 items-center gap-2">{actions}</div> : null}
    </article>
  );
}
