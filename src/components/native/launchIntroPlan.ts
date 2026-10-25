// When the phone app's launch intro plays and how long it stays. PURE and import-free on
// purpose: scripts/test-launch-intro.mjs loads this file directly with Node's type
// stripping, so it may use only erasable TypeScript (no enums, no namespaces, no imports).
//
// The intro (LaunchIntro.tsx) is a full-screen layer over an app that is already usable
// underneath, so it plays once per cold start and never again in that WebView: sign-out
// reloads the page in place and must not replay it. With reduced motion it shows its
// finished frame briefly instead of animating.

export type LaunchIntroMode = "animate" | "still" | "skip";

export interface LaunchIntroInput {
  /** Inside the Capacitor shell. The website never shows the intro. */
  native: boolean;
  /** Already played in this WebView (sessionStorage), e.g. after sign-out's reload. */
  alreadyPlayed: boolean;
  /** The phone asks for reduced motion. */
  reducedMotion: boolean;
}

export function launchIntroMode({ native, alreadyPlayed, reducedMotion }: LaunchIntroInput): LaunchIntroMode {
  if (!native || alreadyPlayed) return "skip";
  return reducedMotion ? "still" : "animate";
}

export interface LaunchIntroTiming {
  /** From the first drawn frame of the intro to the start of its fade-out. */
  exitAtMs: number;
  fadeMs: number;
  /** When the layer is removed: exitAtMs + fadeMs. */
  removeAtMs: number;
}

// "animate" matches the keyframe schedule in src/index.css (launch intro block): the
// letter tiles end at 960 ms, the activity icons at 1470 ms and the loading line at
// 1750 ms, then a short hold before the fade. Change the two together.
const TIMING: Record<Exclude<LaunchIntroMode, "skip">, { exitAtMs: number; fadeMs: number }> = {
  animate: { exitAtMs: 1850, fadeMs: 280 },
  still: { exitAtMs: 800, fadeMs: 200 },
};

export function launchIntroTiming(mode: Exclude<LaunchIntroMode, "skip">): LaunchIntroTiming {
  const { exitAtMs, fadeMs } = TIMING[mode];
  return { exitAtMs, fadeMs, removeAtMs: exitAtMs + fadeMs };
}

/**
 * The intro's first frame is a copy of Android's system splash, so it must not be shown
 * before its images have decoded (the mark would be missing). The system splash stays up
 * meanwhile, so waiting is invisible; past this, show it anyway.
 */
export const MAX_ASSET_WAIT_MS = 600;

/**
 * The animation starts on the first frame the WebView draws after the system splash lets
 * go (two requestAnimationFrame callbacks). If frames never arrive, start after this.
 */
export const FIRST_FRAME_FALLBACK_MS = 1000;

/** Whatever happens, the layer is gone this long after it mounted. */
export const MAX_TOTAL_MS = 4000;
