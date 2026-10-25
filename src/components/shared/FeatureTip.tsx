import * as React from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverArrow, PopoverContent } from "@/components/ui/popover";

// =============================================================
// One step of a FEATURE GUIDE, pointing at `children`. Drive it with
// useFeatureTip; storage and the rules that keep it apart from the portal's
// onboarding / welcome tour live in src/lib/featureTips.ts.
//
// Labelled "Feature guide" so it never reads as the welcome tour. Built on
// Radix Popover so it works INSIDE a sheet or dialog: react-joyride (the
// onboarding tour) renders outside the modal, where a click counts as
// "outside" and would close the sheet underneath it.
// =============================================================

export interface FeatureTipProps {
  open: boolean;
  title: string;
  body: string;
  /** 0-based index of this step. */
  step: number;
  total: number;
  onNext: () => void;
  onSkip: () => void;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  /** The element the tip points at. Must forward its ref. */
  children: React.ReactElement;
}

export function FeatureTip({
  open,
  title,
  body,
  step,
  total,
  onNext,
  onSkip,
  side = "bottom",
  align = "end",
  children,
}: FeatureTipProps) {
  const last = step === total - 1;
  const anchorRef = React.useRef<HTMLDivElement>(null);
  return (
    <Popover open={open}>
      <PopoverAnchor asChild ref={anchorRef}>
        {children}
      </PopoverAnchor>
      {open && <Spotlight target={anchorRef} />}
      <PopoverContent
        side={side}
        align={align}
        sideOffset={8}
        collisionPadding={16}
        className="w-72 rounded-card border-0 p-4 shadow-card-lg"
        // Leave focus where the user is, and only Next / Skip end a step.
        onOpenAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={onSkip}
      >
        <p className="eyebrow">Feature guide</p>
        <p className="mt-1 text-sm font-semibold text-ink-900">{title}</p>
        <p className="mt-1 text-sm text-ink-600">{body}</p>
        <div className="mt-4 flex items-center justify-between gap-2">
          <Button type="button" variant="ghost" size="sm" className="px-2 text-ink-500" onClick={onSkip}>
            Skip
          </Button>
          <Button
            type="button"
            size="sm"
            className="bg-brand-primary text-white hover:bg-brand-primary/90"
            onClick={onNext}
          >
            {last ? "Got it" : `Next (Step ${step + 1} of ${total})`}
          </Button>
        </div>
        <PopoverArrow width={16} height={8} />
      </PopoverContent>
    </Popover>
  );
}

/** Space between the target and the edge of its cut-out, in px. */
const SPOTLIGHT_PAD = 6;

type Box = { top: number; left: number; width: number; height: number };

/**
 * Dims everything but `target`, like the welcome tour's overlay: one box over
 * the target whose huge shadow is the dim, so the target shows through bright.
 *
 * Rendered INSIDE the enclosing dialog / sheet when there is one, so it sits
 * under the tip's popover (portalled later at body level) and can never count
 * as an "outside" click. Clicks pass straight through it. A fixed element's
 * containing block is the viewport OR a transformed ancestor (the centred
 * sheet uses a translate), so a zero-size probe measures where (0,0) really is.
 * Position is re-read every frame while open, so the cut-out follows scrolling.
 */
function Spotlight({ target }: { target: React.RefObject<HTMLElement> }) {
  const [container, setContainer] = React.useState<HTMLElement | null>(null);
  const probeRef = React.useRef<HTMLDivElement>(null);
  const [box, setBox] = React.useState<Box | null>(null);

  React.useLayoutEffect(() => {
    const el = target.current;
    setContainer((el?.closest('[role="dialog"]') as HTMLElement | null) ?? document.body);
  }, [target]);

  React.useEffect(() => {
    if (!container) return;
    let frame = 0;
    let last = "";
    const tick = () => {
      const el = target.current;
      const probe = probeRef.current;
      if (el && probe) {
        const r = el.getBoundingClientRect();
        const origin = probe.getBoundingClientRect();
        const next: Box = {
          top: r.top - origin.top - SPOTLIGHT_PAD,
          left: r.left - origin.left - SPOTLIGHT_PAD,
          width: r.width + SPOTLIGHT_PAD * 2,
          height: r.height + SPOTLIGHT_PAD * 2,
        };
        const key = `${next.top}|${next.left}|${next.width}|${next.height}`;
        if (key !== last) {
          last = key;
          setBox(next);
        }
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [container, target]);

  if (!container) return null;
  // At body level (no dialog) stay under the popover's z-50.
  const z = container === document.body ? "z-40" : "z-50";
  return createPortal(
    <>
      <div ref={probeRef} aria-hidden className="pointer-events-none fixed left-0 top-0 h-0 w-0" />
      {box && (
        <div
          aria-hidden
          // Dim: the welcome tour's own overlay colour (react-joyride
          // overlayColor rgba(0,0,0,0.5)) in both themes, so the two match.
          className={`pointer-events-none fixed ${z} rounded-xl shadow-[0_0_0_9999px_rgb(0_0_0/0.5)] transition-all duration-200`}
          // Inline position is unavoidable: it is measured at runtime.
          style={{ top: box.top, left: box.left, width: box.width, height: box.height }}
        />
      )}
    </>,
    container,
  );
}
