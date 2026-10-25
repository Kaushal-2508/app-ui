import { useEffect, useMemo, useState } from "react";
import type { SceneTod } from "./engine/types";
import { msUntilNextBoundary, todFromClock, type ClockTod } from "./todFromClock";

/** Crossfade lengths (design spec 2.3): theme toggle and clock boundary. */
export const THEME_FADE_MS = 1400;
export const CLOCK_FADE_MS = 8000;
// Fire just after the boundary, so the formatter reads the new hour.
const BOUNDARY_SLACK_MS = 500;

interface TodState {
  dark: boolean;
  clock: ClockTod;
  fadeMs: number;
}

function readDark(): boolean {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark");
}

/**
 * The banner's time of day: the dark theme is always "night"; the light theme follows
 * the school's wall clock (morning, midday, golden, dusk). `fadeMs` says how the last
 * change should crossfade: 0 on mount, 1400 for a theme toggle, 8000 for a clock
 * boundary.
 *
 * The theme is read from `<html class="dark">` (AppLayout toggles it from the user's
 * preference) through a MutationObserver. The clock re-arms one timeout per boundary
 * and recomputes on every return to a visible document, because background tabs and a
 * suspended phone app delay timers.
 */
export function useBannerTod(timeZone: string): { tod: SceneTod; fadeMs: number } {
  const [state, setState] = useState<TodState>(() => ({
    dark: readDark(),
    clock: todFromClock(new Date(), timeZone),
    fadeMs: 0,
  }));

  // Theme: one MutationObserver on <html>'s class attribute.
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const dark = root.classList.contains("dark");
      setState((s) => (s.dark === dark ? s : { ...s, dark, fadeMs: THEME_FADE_MS }));
    };
    apply(); // the class may have flipped between the first render and this effect
    const mo = new MutationObserver(apply);
    mo.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);

  // Clock: a timeout to the next boundary, re-armed after each one and on every
  // return to a visible document. Re-runs when the school's zone resolves.
  useEffect(() => {
    let timer = 0;
    const check = () => {
      const clock = todFromClock(new Date(), timeZone);
      setState((s) => (s.clock === clock ? s : { ...s, clock, fadeMs: CLOCK_FADE_MS }));
    };
    const arm = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        check();
        arm();
      }, msUntilNextBoundary(new Date(), timeZone) + BOUNDARY_SLACK_MS);
    };
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      check();
      arm();
    };
    check();
    arm();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [timeZone]);

  return useMemo<{ tod: SceneTod; fadeMs: number }>(
    () => ({ tod: state.dark ? "night" : state.clock, fadeMs: state.fadeMs }),
    [state],
  );
}
