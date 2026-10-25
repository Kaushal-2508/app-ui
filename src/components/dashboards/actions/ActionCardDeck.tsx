import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ActionCard, type ActionCardProps } from "./ActionCard";
import { CLAY_TONE } from "./actionCardStyles";

/** The banner's box at every width: the cards, the waiting sky and the error card share it. */
export const SLOT_BOX = "h-28 sm:h-32 md:h-36 lg:h-40 xl:h-44";

export interface DeckItem extends ActionCardProps {
  id: string;
}

/** How far card `i` sits from the first one in the scroller. */
function offsetOf(track: HTMLElement, i: number): number {
  const card = track.children[i] as HTMLElement | undefined;
  const first = track.children[0] as HTMLElement | undefined;
  return card && first ? card.offsetLeft - first.offsetLeft : 0;
}

/** The card the scroller currently rests on (or is nearest to). */
function nearest(track: HTMLElement): number {
  let best = 0;
  for (let i = 1; i < track.children.length; i++) {
    if (Math.abs(offsetOf(track, i) - track.scrollLeft) < Math.abs(offsetOf(track, best) - track.scrollLeft)) best = i;
  }
  return best;
}

/**
 * The due cards in the banner's box, ONE at a time at every width (owner, 2026-10-06): swiped
 * with CSS scroll-snap, or moved with the dots, the arrows (a mouse from 640px) and the
 * Left/Right/Home/End keys. No autoplay, no carousel library (§23 bundle). Cards off screen
 * are inert, so Tab never lands on a button nobody can see. The deck takes the shown card's
 * tone for its shadow.
 */
export function ActionCardDeck({ items }: { items: DeckItem[] }) {
  const deckRef = useRef<HTMLElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  // the card a button asked for while its smooth scroll is still on the way
  const target = useRef<number | null>(null);
  const count = items.length;
  const current = Math.min(active, Math.max(0, count - 1));
  const currentRef = useRef(current);
  currentRef.current = current;

  const onScroll = () => {
    const track = trackRef.current;
    if (!track) return;
    const i = nearest(track);
    if (target.current !== null) {
      if (i === target.current) target.current = null;
      return;
    }
    setActive(i);
  };

  const goTo = (i: number) => {
    const track = trackRef.current;
    if (!track) return;
    const to = Math.max(0, Math.min(count - 1, i));
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.current = reduce ? null : to;
    track.scrollTo({ left: offsetOf(track, to), behavior: reduce ? "auto" : "smooth" });
    setActive(to);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (count < 2) return;
    const keys: Record<string, number> = { ArrowLeft: current - 1, ArrowRight: current + 1, Home: 0, End: count - 1 };
    const to = keys[e.key];
    if (to === undefined) return;
    e.preventDefault();
    // the card holding focus is about to go inert; keep focus on the deck
    deckRef.current?.focus();
    goTo(to);
  };

  // Only the shown card is reachable by Tab and by a screen reader.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    Array.from(track.children).forEach((el, k) => {
      const card = el as HTMLElement;
      card.inert = k !== current;
      card.setAttribute("aria-hidden", k === current ? "false" : "true");
    });
  }, [current, count]);

  // A resized box (rotation, the sidebar opening) keeps the same card in view.
  useEffect(() => {
    const track = trackRef.current;
    if (!track || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      target.current = null;
      track.scrollTo({ left: offsetOf(track, currentRef.current), behavior: "auto" });
    });
    observer.observe(track);
    return () => observer.disconnect();
  }, []);

  return (
    <section
      ref={deckRef}
      aria-label="Things to do today"
      aria-roledescription="carousel"
      tabIndex={count > 1 ? 0 : undefined}
      onKeyDown={onKeyDown}
      className={cn("action-deck relative", CLAY_TONE[items[current]?.tone ?? "teal"], SLOT_BOX)}
    >
      <div
        ref={trackRef}
        onScroll={onScroll}
        className="scrollbar-hide flex h-full snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain rounded-[22px]"
      >
        {items.map(({ id, ...card }, i) => (
          <ActionCard key={id} {...card} position={{ index: i, count }} />
        ))}
      </div>
      {count > 1 && (
        <div className="action-pager absolute bottom-3 right-4 z-10 flex items-center gap-1 rounded-full p-1 sm:right-6 md:bottom-2 lg:bottom-[14px] xl:bottom-5 xl:right-8">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="action-arrow"
            aria-label="Previous card"
            disabled={current === 0}
            onClick={() => goTo(current - 1)}
          >
            <ChevronLeft />
          </Button>
          <div className="flex h-6 items-center sm:h-8">
            {items.map((item, i) => (
              <Button
                key={item.id}
                type="button"
                variant="ghost"
                size="icon"
                className="action-dot"
                aria-label={`Show card ${i + 1} of ${count}: ${item.title}`}
                aria-current={i === current ? "true" : undefined}
                onClick={() => goTo(i)}
              />
            ))}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="action-arrow"
            aria-label="Next card"
            disabled={current === count - 1}
            onClick={() => goTo(current + 1)}
          >
            <ChevronRight />
          </Button>
        </div>
      )}
    </section>
  );
}
