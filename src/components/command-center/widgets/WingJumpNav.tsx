import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

export interface JumpTarget {
  id: string;
  label: string;
}

/**
 * The reference mockup's sticky section strip, on SALCI tokens.
 *
 * The coordinator page is long — fifteen panels across seven groups — and the
 * mockup's answer was a pinned strip that both jumps and tells you where you
 * are. This is that, built from tokens so it flips in dark mode.
 *
 * NOT `MobileTabs`: that primitive owns a `value` and swaps panels. This strip
 * never hides anything, it scrolls a single continuous page and reflects
 * position. Wiring MobileTabs to scroll position would fight its auto-scroll and
 * its filled-pill "selected" semantics, which mean something different here.
 *
 * It pins below AppLayout's header via `--app-bar-height`, and it degrades:
 * without IntersectionObserver the links still jump, they just stop
 * highlighting.
 */
export function WingJumpNav({ targets }: { targets: JumpTarget[] }) {
  const [active, setActive] = useState<string | null>(targets[0]?.id ?? null);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;

    const seen = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          seen.set(e.target.id, e.isIntersecting ? e.intersectionRatio : 0);
        }
        // Topmost section still on screen wins, so scrolling down advances the
        // pill one section at a time instead of jumping to whichever slice
        // happens to be largest.
        const visible = targets.filter((t) => (seen.get(t.id) ?? 0) > 0);
        if (visible.length > 0) setActive(visible[0].id);
      },
      {
        // Ignore the strip's own band at the top of the viewport, and treat the
        // bottom half as "not yet reached".
        rootMargin: "-96px 0px -55% 0px",
        threshold: [0, 0.01, 0.25],
      },
    );

    const nodes = targets
      .map((t) => document.getElementById(t.id))
      .filter((n): n is HTMLElement => n != null);
    nodes.forEach((n) => observer.observe(n));

    return () => observer.disconnect();
  }, [targets]);

  const jump = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setActive(id);
  };

  return (
    <nav
      aria-label="Jump to section"
      className="scrollbar-hide sticky z-20 -mx-1 flex gap-1.5 overflow-x-auto bg-[hsl(var(--surface-base))]/95 px-1 py-2.5 backdrop-blur supports-[backdrop-filter]:bg-[hsl(var(--surface-base))]/80"
      style={{ top: "var(--app-bar-height, 61px)" }}
    >
      {targets.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => jump(t.id)}
          aria-current={active === t.id ? "true" : undefined}
          className={cn(
            "whitespace-nowrap rounded-full px-3 py-1.5 text-[12px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40",
            active === t.id
              ? "bg-ink-900 text-[hsl(var(--surface-card))]"
              : "text-ink-500 hover:bg-[hsl(var(--ink-400)/0.1)] hover:text-ink-900",
          )}
        >
          {t.label}
        </button>
      ))}
    </nav>
  );
}
