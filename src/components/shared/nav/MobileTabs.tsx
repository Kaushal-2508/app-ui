import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

export interface MobileTabOption {
  value: string;
  label: string;
  count?: number;
  icon?: React.ReactNode;
}

export interface MobileTabsProps {
  value: string;
  onValueChange: (value: string) => void;
  options: MobileTabOption[];
  /** "default" 40px (top-level tabs) or "compact" 32px (nested sub-tabs). */
  density?: "default" | "compact";
  /**
   * "primary" — floating pills, active filled brand-teal (top-level strips).
   * "segmented" — a contained, hairline-bordered track whose active item is a
   * surface-card thumb; visually subordinate, for sub-tabs nested under a
   * primary strip (e.g. the Olympiad Exam tab's Schedule / PINs / Absentees).
   */
  variant?: "primary" | "segmented";
  className?: string;
}

/**
 * Horizontal scroll-snap row of pill tabs. Single source of truth for tab
 * strips on mobile across teacher / coordinator pages. Auto-scrolls the
 * active pill into view on mount and whenever `value` changes.
 *
 * Overflow affordance:
 *   * an edge-fade mask-image fades content at the side(s) that have
 *     hidden tabs beyond
 *   * a small clickable chevron (Left / Right) appears at that edge.
 *     Tapping it scrolls the strip ~60 % of its width in that direction.
 *   * both indicators auto-hide when the strip fits without overflow,
 *     so non-overflowing layouts (e.g. 4 short tabs on desktop) stay clean.
 */
export function MobileTabs({
  value,
  onValueChange,
  options,
  density = "default",
  variant = "primary",
  className,
}: MobileTabsProps) {
  const isSegmented = variant === "segmented";
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const activeBtnRef = React.useRef<HTMLButtonElement | null>(null);
  const isMountedRef = React.useRef(false);
  // Edge-fade visibility — only fade the sides that actually have hidden
  // content beyond them. Without this, a non-overflowing strip (e.g. 4 short
  // tabs that fit the viewport) had its leftmost pill rendered translucent
  // because the mask was unconditional.
  const [fadeLeft, setFadeLeft] = React.useState(false);
  const [fadeRight, setFadeRight] = React.useState(false);

  /* ---------------------------------------------------------------- thumb --
   * The selected tab used to be painted by the button itself, so moving the
   * selection meant one pill's background disappearing and another's appearing:
   * a pop, however well it cross-faded. There is now ONE thumb that slides to
   * whichever tab is active, the way a segmented control does.
   *
   * It is measured from the live button rather than computed from widths, so it
   * stays correct with icons, count badges, a scrolled strip and any font.
   */
  const btnRefs = React.useRef(new Map<string, HTMLButtonElement>());
  const [thumb, setThumb] = React.useState<{ x: number; y: number; w: number; h: number } | null>(null);
  // No animation on the first measure, or the thumb visibly flies in from the
  // left edge on every mount.
  const [animate, setAnimate] = React.useState(false);
  const optionKey = options.map((o) => o.value).join("|");

  const measure = React.useCallback(() => {
    const btn = btnRefs.current.get(value);
    if (!btn) { setThumb(null); return; }
    setThumb({ x: btn.offsetLeft, y: btn.offsetTop, w: btn.offsetWidth, h: btn.offsetHeight });
  }, [value]);

  React.useLayoutEffect(() => {
    measure();
  }, [measure, optionKey, density, variant]);

  React.useEffect(() => {
    const raf = requestAnimationFrame(() => setAnimate(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  // Re-measure when the strip or any pill changes size: a count badge arriving,
  // a font swapping in, or the container reflowing all move the target.
  React.useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measure());
    const c = containerRef.current;
    if (c) ro.observe(c);
    btnRefs.current.forEach((b) => ro.observe(b));
    return () => ro.disconnect();
  }, [measure, optionKey]);

  // Auto-scroll the active pill into view (centered) on value change.
  // Manual horizontal-only scroll — `scrollIntoView({ block: "nearest" })`
  // would also fire a vertical impulse on the nearest vertically-scrollable
  // ancestor (e.g. PageShell), causing the page to jump on tab switches.
  // On first mount the scroll is instant to avoid first-paint jank; subsequent
  // value changes animate smoothly.
  React.useEffect(() => {
    const container = containerRef.current;
    const btn = activeBtnRef.current;
    if (!container || !btn) return;
    const target = btn.offsetLeft + btn.offsetWidth / 2 - container.clientWidth / 2;
    container.scrollTo({
      left: Math.max(0, target),
      behavior: isMountedRef.current ? "smooth" : "instant",
    });
    isMountedRef.current = true;
  }, [value]);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const update = () => {
      const { scrollLeft, scrollWidth, clientWidth } = container;
      setFadeLeft(scrollLeft > 4);
      setFadeRight(scrollLeft + clientWidth < scrollWidth - 4);
    };

    update();
    container.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(container);

    return () => {
      container.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [options.length]);

  const sizeClasses = isSegmented
    ? "h-7 px-3.5 text-[13px]"
    : density === "compact"
      ? "h-8 px-3 text-[13px]"
      : "h-10 px-4 text-sm";

  // Build mask only for sides that actually overflow. No overflow → no mask
  // (so the active pill renders fully opaque, on top of the page gradient).
  // The fade is 44px: the 28px chevron sits over the strip's edge, and with a
  // 24px fade the label under it was still half legible, so five pages showed
  // a cut word ("Assig", "Exam Plannin") beside the arrow (2026-09-18 audit).
  // The wider fade takes that label to transparent before the chevron starts.
  const maskClass =
    fadeLeft && fadeRight
      ? "[mask-image:linear-gradient(to_right,transparent_0,black_44px,black_calc(100%_-_44px),transparent_100%)] [-webkit-mask-image:linear-gradient(to_right,transparent_0,black_44px,black_calc(100%_-_44px),transparent_100%)]"
      : fadeLeft
      ? "[mask-image:linear-gradient(to_right,transparent_0,black_44px)] [-webkit-mask-image:linear-gradient(to_right,transparent_0,black_44px)]"
      : fadeRight
      ? "[mask-image:linear-gradient(to_right,black_calc(100%_-_44px),transparent_100%)] [-webkit-mask-image:linear-gradient(to_right,black_calc(100%_-_44px),transparent_100%)]"
      : "";

  // Click-to-scroll for the chevron indicators. ~60% of the visible width
  // moves "about a tab and a half" worth of content per tap, which feels
  // natural without overshooting.
  const scrollByDirection = (dir: -1 | 1) => {
    const c = containerRef.current;
    if (!c) return;
    c.scrollBy({ left: dir * c.clientWidth * 0.6, behavior: "smooth" });
  };

  const indicatorSize = density === "compact" ? "h-6 w-6" : "h-7 w-7";
  const indicatorIconSize = density === "compact" ? "h-3 w-3" : "h-3.5 w-3.5";

  return (
    <div
      className={cn(
        "relative",
        // Segmented: a self-sized, hairline-bordered track the thumb moves
        // inside — visually one level below the floating primary pills.
        isSegmented &&
          "w-fit max-w-full rounded-full border border-[hsl(var(--surface-stroke))] bg-ink-400/5 p-1 dark:bg-ink-400/10",
        className,
      )}
    >
      <div className={maskClass}>
        <div
          ref={containerRef}
          role="tablist"
          className={cn(
            "relative flex overflow-x-auto scrollbar-hide snap-x snap-mandatory",
            isSegmented ? "gap-1" : "gap-2 py-1",
          )}
        >
          {thumb && (
            <span
              aria-hidden
              className={cn(
                "pointer-events-none absolute left-0 top-0 rounded-full",
                isSegmented
                  ? "bg-[hsl(var(--surface-card))] shadow-[0_2px_8px_-2px_hsl(var(--shadow-card))]"
                  : "bg-brand-primary shadow-[0_4px_12px_-2px_hsl(var(--brand-primary)/0.4)]",
                // Transform and width, so it slides and stretches between pills
                // of different lengths on the compositor rather than by relayout.
                // The curve is the one iOS uses for a segmented control: quick
                // to leave, long to settle, no overshoot.
                //
                // Written as an arbitrary PROPERTY, not as the `ease-` shorthand with
                // an arbitrary value. (Do not spell that shorthand out here either:
                // Tailwind scans comments as content and warns about it again.)
                // tailwindcss-animate registers its own `ease-*` for animation timing
                // alongside Tailwind's built-in one for transition timing, so the
                // shorthand matches two utilities, and Tailwind resolves that by
                // emitting NEITHER: it warned on every dev build and the curve was
                // absent from the compiled CSS from b24e42de (2026-09-16) until this
                // was fixed on 2026-09-22. Naming the property leaves nothing to
                // guess. Keep it this way.
                animate &&
                  "transition-[transform,width] duration-300 [transition-timing-function:cubic-bezier(0.32,0.72,0,1)]",
                "motion-reduce:transition-none",
              )}
              style={{
                transform: `translate3d(${thumb.x}px, ${thumb.y}px, 0)`,
                width: thumb.w,
                height: thumb.h,
              }}
            />
          )}
          {options.map((option) => {
            const isActive = option.value === value;
            return (
              <button
                key={option.value}
                ref={(el) => {
                  if (el) btnRefs.current.set(option.value, el);
                  else btnRefs.current.delete(option.value);
                  if (isActive) activeBtnRef.current = el;
                }}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => onValueChange(option.value)}
                className={cn(
                  "snap-start shrink-0 inline-flex items-center gap-2 rounded-full font-medium whitespace-nowrap duration-200",
                  // Above the thumb, which is painted behind them.
                  "relative z-[1]",
                  // Only the LABEL colour cross-fades now; the background is the
                  // thumb's job. (The old class here was transition-[colors,...],
                  // and `colors` is a Tailwind group name, not a CSS property, so
                  // it matched nothing and never animated anything anyway.)
                  "transition-[color,background-color] ease-out motion-reduce:transition-none",
                  // Brand focus ring instead of the browser's default blue
                  // outline, which reads as a rendering glitch on a teal pill.
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40",
                  sizeClasses,
                  "bg-transparent",
                  isSegmented
                    ? isActive
                      ? "font-semibold text-brand-primary"
                      : "text-ink-600 hover:text-ink-900"
                    : isActive
                      ? "text-white"
                      : "text-ink-600 hover:bg-ink-400/10 hover:text-ink-900",
                )}
              >
                {option.icon && <span className="shrink-0">{option.icon}</span>}
                <span>{option.label}</span>
                {typeof option.count === "number" && (
                  <span
                    className={cn(
                      "inline-flex items-center justify-center rounded-full px-2 text-xs font-semibold tabular-nums",
                      density === "compact" || isSegmented ? "h-4" : "h-5",
                      isSegmented
                        ? isActive
                          ? "bg-brand-primary/10 text-brand-primary"
                          : "bg-ink-400/15 text-ink-700"
                        : isActive
                          ? "bg-white/20 text-white"
                          : "bg-ink-400/15 text-ink-700",
                    )}
                  >
                    {option.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Overflow indicators — outside the mask wrapper so they stay opaque.
          Only render when there is actually hidden content in that direction. */}
      {fadeLeft && (
        <button
          type="button"
          aria-label="Scroll tabs left"
          onClick={() => scrollByDirection(-1)}
          className={cn(
            "absolute left-0 top-1/2 -translate-y-1/2 z-10",
            "inline-flex items-center justify-center rounded-full",
            "bg-[hsl(var(--surface-card))] border border-[hsl(var(--surface-stroke))]",
            "shadow-[0_2px_8px_-2px_hsl(var(--shadow-card))] text-ink-700",
            "hover:bg-ink-400/10 active:scale-95 transition-transform",
            indicatorSize,
          )}
        >
          <ChevronLeft className={indicatorIconSize} />
        </button>
      )}
      {fadeRight && (
        <button
          type="button"
          aria-label="Scroll tabs right"
          onClick={() => scrollByDirection(1)}
          className={cn(
            "absolute right-0 top-1/2 -translate-y-1/2 z-10",
            "inline-flex items-center justify-center rounded-full",
            "bg-[hsl(var(--surface-card))] border border-[hsl(var(--surface-stroke))]",
            "shadow-[0_2px_8px_-2px_hsl(var(--shadow-card))] text-ink-700",
            "hover:bg-ink-400/10 active:scale-95 transition-transform",
            indicatorSize,
          )}
        >
          <ChevronRight className={indicatorIconSize} />
        </button>
      )}
    </div>
  );
}
