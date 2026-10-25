import type { ReactNode } from "react";
import { useDroppable } from "@dnd-kit/core";

import { cn } from "@/lib/utils";
import type { BoardDropData } from "./types";

interface BoardColumnProps<T, S extends string> {
  droppableId: string;
  status: S;
  label: string;
  items: T[];
  getId: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  /** Hidden in grouped layouts, where one shared header row sits above every lane. */
  showHeader?: boolean;
  /** Give the body its own vertical scroll (ungrouped layout only). */
  scrollBody?: boolean;
  /**
   * Desktop only. The board's height is being supplied by the page (which has
   * locked itself to the viewport), so the body takes what is left of the
   * column instead of guessing a cap from `100dvh`.
   */
  fillHeight?: boolean;
  /** Optional control in the header, e.g. a "+" on the first column. */
  action?: ReactNode;
  className?: string;
}

/**
 * One status column. The body is the drop target, so a card released over the
 * header still lands in the column (the header is part of the same wrapper
 * but the ring highlights the whole column while hovering).
 */
export function BoardColumn<T, S extends string>({
  droppableId,
  status,
  label,
  items,
  getId,
  renderItem,
  showHeader = true,
  scrollBody = false,
  fillHeight = false,
  action,
  className,
}: BoardColumnProps<T, S>) {
  const data: BoardDropData<S> = { status };
  const { setNodeRef, isOver } = useDroppable({ id: droppableId, data });

  return (
    <section
      // The WHOLE lane is the drop target, header and empty space included.
      // With the ref on the card list, the target ended right under the last
      // card, so a drop into the empty part of a column (or into an empty
      // column's lower half) did nothing unless the pointer crossed an
      // existing card (reproduced 2026-09-16).
      ref={setNodeRef}
      aria-label={label}
      className={cn(
        // A visibly recessed lane: darker than the backdrop with an inset
        // hairline, so the cards read as sitting inside a track rather than
        // floating on the page (the old bg-muted/50 was near-invisible on the
        // pastel gradient).
        "flex flex-col rounded-2xl bg-ink-400/15 ring-1 ring-inset ring-ink-400/25 transition-colors dark:bg-white/[0.05] dark:ring-white/10",
        fillHeight && "md:min-h-0",
        isOver && "bg-primary/10 ring-2 ring-primary/50",
        className,
      )}
    >
      {showHeader && (
        <header className="flex items-center justify-between gap-2 px-3 pt-3 pb-2">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-xs font-semibold uppercase tracking-wide text-ink-700">
              {label}
            </h3>
            <span className="shrink-0 rounded-full bg-surface-card px-2 py-0.5 text-[11px] font-semibold tabular-nums text-ink-700 shadow-card-sm">
              {items.length}
            </span>
          </div>
          {action}
        </header>
      )}
      {/* Two ways to bound the scroll body.
          `fillHeight` is the honest one: the page has locked itself to the
          viewport, so the column simply takes what is left after its header
          and the body ends exactly at the bottom of the screen.
          Without it the cap has to be guessed from `100dvh`, which is what
          every phone-width board still does (there the page scrolls). A guess
          that is too small leaves the board floating above a band of empty
          page, which is what `100dvh - 320px` did. */}
      <div
        className={cn(
          // overflow-x hidden: a card must never make the column scroll
          // sideways. `overflow-y-auto` alone turns overflow-x into `auto`,
          // and dnd-kit's auto-scroller will happily use it (see
          // BoardDraggable for the clipped-column bug this caused).
          "min-h-[60px] space-y-2 overflow-x-hidden px-2 pb-2",
          !showHeader && "pt-2",
          // Default overscroll (auto), deliberately. `none`/`contain` trapped
          // the wheel: with the board filling the viewport and every column
          // its own scroller, a user at the top of a column could not scroll
          // the page back up to the header at all (reproduced 2026-09-15).
          // Chaining to the page at the column's edge is the expected feel.
          scrollBody &&
            "max-h-[calc(100dvh-var(--app-bar-height,61px)-10rem)] overflow-y-auto",
          // Three overlapping bounds, on purpose. `flex-1` alone is the exact
          // fit, but it only works while every ancestor between here and the
          // page is a flex column with a bounded height. That chain is six
          // elements long, and when one link is missing this box has NO bound
          // at all: a 30-card column grows to ~3000px and the page scrolls
          // through a screen of nothing. So the viewport also sets a floor and
          // a ceiling directly on the body, and the three agree to within a
          // few pixels. ~28rem is the chrome above and below it (title,
          // filters, search, column header, footnote). The 220px arm keeps the
          // columns usable on a very short window, where the shell scrolls.
          fillHeight &&
            "md:min-h-[max(140px,calc(100dvh-30rem))] md:max-h-[calc(100dvh-26rem)] md:flex-1 md:overflow-y-auto",
        )}
      >
        {items.map((item) => (
          <div key={getId(item)}>{renderItem(item)}</div>
        ))}
      </div>
    </section>
  );
}
