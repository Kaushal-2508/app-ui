import { useEffect, useRef, useState } from "react";

/**
 * Renders its children only once the section has been reached.
 *
 * The v5 dashboard is one long scroll with a jump nav, and mounting all seven
 * sections at once cost 9.7 SECONDS of database work per page load on Alliance,
 * because five RPCs each rebuilt a 1,545-student aggregate. Wall clock hid it
 * (the browser fires them in parallel) but the work is what multiplies by
 * concurrent admins, and that is the shape that took the platform down in
 * May 2026.
 *
 * So a section's queries do not exist until someone goes looking. The <section>
 * wrapper always renders, so the jump nav and the scroll spy still have their
 * anchor; only the contents wait. Once shown it stays shown, because unmounting
 * on scroll-away would refetch on every pass.
 */
export function LazySection({
  id, className, children, rootMargin = "300px", forceShow = false,
}: {
  id: string;
  className?: string;
  children: React.ReactNode;
  rootMargin?: string;
  /**
   * Mount now, without waiting to scroll into view. The page sets this on every
   * section up to a tapped tab BEFORE it measures where to scroll: a jump
   * measured against 220px placeholders lands thousands of pixels short once
   * the real content mounts underneath it.
   */
  forceShow?: boolean;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [shown, setShown] = useState(forceShow);

  useEffect(() => {
    if (forceShow) setShown(true);
  }, [forceShow]);

  useEffect(() => {
    if (shown) return;
    const node = ref.current;
    if (!node) return;
    // No IntersectionObserver (very old browser, or a test environment): show
    // everything rather than render a permanently empty page.
    if (typeof IntersectionObserver === "undefined") { setShown(true); return; }
    const obs = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) setShown(true); },
      { rootMargin },
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, [shown, rootMargin]);

  return (
    <section id={id} ref={ref} className={className}>
      {shown ? children : <div className="min-h-[220px]" aria-hidden />}
    </section>
  );
}
