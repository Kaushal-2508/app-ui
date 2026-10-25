import { useEffect, useState } from "react";

/**
 * Subscribes to a CSS media query. Initialises from the live value so the
 * first render already knows the breakpoint, avoiding a mobile-then-desktop
 * flash on wide screens.
 *
 * Use it only when two components must NOT both be mounted (e.g. a sheet on
 * phones vs an inline pane on desktop); when hiding is enough, prefer
 * Tailwind's responsive classes.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(query).matches
      : false,
  );

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}
