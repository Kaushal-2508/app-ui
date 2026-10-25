import { cn } from "@/lib/utils";
import { Banner3DLayer } from "./banner3d/Banner3DLayer";

export interface SchoolSceneIllustrationProps {
  className?: string;
}

/**
 * The role dashboards' scene banner: the "Clay School", a real-time 3D scene of a school
 * with its village, bus stop, river and people, in five moments. The dark theme is
 * always night; the light theme follows the school's own clock (morning, midday,
 * golden hour, dusk) and crossfades at 11:00, 15:00 and 19:00. The tower clock shows
 * the school's real local time. Design: docs/superpowers/specs/2026-09-28-clay-school-banner-3d-design.md.
 *
 * Layers (banner3d/Banner3DLayer.tsx):
 *   1. `.scene-banner` gradient on this wrapper, the sky behind everything.
 *   2. On a return visit, a cached poster of the 3D scene for this moment (IndexedDB),
 *      painted as soon as it is read. The old SVG scene was removed on 2026-09-29 to
 *      keep the dashboard light: until the canvas is up, the sky gradient is the fallback.
 *   3. The WebGL canvas, which cross-fades in only after the dashboard's own queries
 *      have settled and the main thread is idle. three and the engine are one lazy
 *      chunk, never part of the entry and never loaded on /login.
 *
 * Devices without usable WebGL2 (or with Save-Data on) keep the sky (and any cached
 * poster) and never download three; weak GPUs get one rendered still; reduced motion gets the composed
 * still pose. The loop runs at 30 fps and stops whenever the banner is off screen, the
 * tab is hidden or the phone app is in the background.
 *
 * Purely decorative: `aria-hidden`, nothing focusable, no text. Same props and the same
 * box on every call site, so the four dashboards did not change.
 */
export function SchoolSceneIllustration({ className }: SchoolSceneIllustrationProps) {
  return (
    <div
      className={cn(
        "scene-banner-anim relative w-full overflow-hidden rounded-card scene-banner",
        "h-28 sm:h-32 md:h-36 lg:h-40 xl:h-44",
        "border border-white/40 dark:border-white/10",
        className,
      )}
      aria-hidden
    >
      <Banner3DLayer />
    </div>
  );
}
