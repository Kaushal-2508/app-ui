import { useEffect, useRef, useState } from "react";
import { BookOpen, ClipboardCheck, FlaskConical, Music, Pencil, Trophy, type LucideIcon } from "lucide-react";

import { hideSplash, isNativePlatform } from "@/lib/native";
import {
  FIRST_FRAME_FALLBACK_MS,
  MAX_ASSET_WAIT_MS,
  MAX_TOTAL_MS,
  launchIntroMode,
  launchIntroTiming,
  type LaunchIntroMode,
} from "./launchIntroPlan";

// Set once the intro has played in this WebView. Sign-out reloads the page in place
// (AppLayout's window.location.replace), and that must not replay the intro; a cold
// start gets a new WebView and an empty sessionStorage.
const PLAYED_KEY = "salci-launch-intro-played";

// The five letter tiles, cut from public/Logo-trim.png by the shell's
// scripts/launch-assets.mjs, which also writes the mark and Android's splash icon.
const TILES = ["s", "a", "l", "c", "i"] as const;

// School life around the logo: reading, writing, science, attendance, sports, music.
// The tone classes are written out in full (index.css, launch intro block).
const ACTIVITIES: ReadonlyArray<{ key: string; Icon: LucideIcon; toneClass: string }> = [
  { key: "reading", Icon: BookOpen, toneClass: "launch-chip-teal" },
  { key: "writing", Icon: Pencil, toneClass: "launch-chip-orange" },
  { key: "science", Icon: FlaskConical, toneClass: "launch-chip-violet" },
  { key: "attendance", Icon: ClipboardCheck, toneClass: "launch-chip-teal" },
  { key: "sports", Icon: Trophy, toneClass: "launch-chip-orange" },
  { key: "music", Icon: Music, toneClass: "launch-chip-violet" },
];

type Phase = "hold" | "play" | "exit" | "done";

function alreadyPlayed(): boolean {
  try {
    return sessionStorage.getItem(PLAYED_KEY) === "1";
  } catch {
    return false;
  }
}

function markPlayed(): void {
  try {
    sessionStorage.setItem(PLAYED_KEY, "1");
  } catch {
    /* storage blocked: the intro may play again after sign-out, which is harmless */
  }
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The phone app's launch screen, drawn over the app on a cold start while the first
 * screen loads underneath, then faded away (about 2 s). Mounted once by NativeBootstrap,
 * renders nothing on the website, and owns the hand-over from Android's system splash:
 *
 * 1. Its first frame is a copy of the system splash (the mark alone, 136 px, centred on
 *    --launch-bg), so it waits for its images to decode, bounded by MAX_ASSET_WAIT_MS.
 * 2. Then it hides the system splash. Capacitor's splash holds back every draw of the
 *    app until then, so this cannot wait for a paint.
 * 3. The animation starts on the first frame the WebView draws afterwards, so its
 *    opening is not spent behind the splash's fade.
 *
 * A timer removes the layer MAX_TOTAL_MS after mount whatever happens, so a stalled
 * step can never leave the app covered. Decorative: hidden from assistive tech.
 */
export function LaunchIntro() {
  const [mode] = useState<LaunchIntroMode>(() =>
    launchIntroMode({
      native: isNativePlatform(),
      alreadyPlayed: alreadyPlayed(),
      reducedMotion: prefersReducedMotion(),
    }),
  );
  const [phase, setPhase] = useState<Phase>("hold");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (mode === "skip") {
      // No intro: hide the splash after the app's first paint, as before the intro
      // existed (a no-op on the website and after an in-app reload).
      const id = window.requestAnimationFrame(() => hideSplash());
      return () => window.cancelAnimationFrame(id);
    }
    markPlayed();

    let cancelled = false;
    const timers: number[] = [];
    const frames: number[] = [];
    const later = (fn: () => void, ms: number) => {
      timers.push(
        window.setTimeout(() => {
          if (!cancelled) fn();
        }, ms),
      );
    };
    const start = () => setPhase((p) => (p === "hold" ? "play" : p));

    later(() => setPhase("done"), MAX_TOTAL_MS);

    const images = Array.from(rootRef.current?.querySelectorAll("img") ?? []);
    const decoded = Promise.all(images.map((img) => img.decode().catch(() => undefined)));
    const waited = new Promise<void>((resolve) => later(resolve, MAX_ASSET_WAIT_MS));
    void Promise.race([decoded, waited]).then(() => {
      if (cancelled) return;
      hideSplash();
      frames.push(
        window.requestAnimationFrame(() => {
          frames.push(window.requestAnimationFrame(start));
        }),
      );
      later(start, FIRST_FRAME_FALLBACK_MS);
    });

    return () => {
      cancelled = true;
      for (const id of timers) window.clearTimeout(id);
      for (const id of frames) window.cancelAnimationFrame(id);
    };
  }, [mode]);

  useEffect(() => {
    if (mode === "skip" || (phase !== "play" && phase !== "exit")) return;
    const { exitAtMs, fadeMs } = launchIntroTiming(mode);
    const id = window.setTimeout(
      () => setPhase(phase === "play" ? "exit" : "done"),
      phase === "play" ? exitAtMs : fadeMs,
    );
    return () => window.clearTimeout(id);
  }, [mode, phase]);

  if (mode === "skip" || phase === "done") return null;

  return (
    <div ref={rootRef} className="launch-intro" data-mode={mode} data-phase={phase} aria-hidden="true">
      <div className="launch-backdrop" />
      <img className="launch-mark" src="/splash/launch-mark.webp" alt="" draggable={false} />
      <div className="launch-tiles">
        {TILES.map((letter) => (
          <img key={letter} className="launch-tile" src={`/splash/launch-tile-${letter}.webp`} alt="" draggable={false} />
        ))}
      </div>
      <p className="launch-tagline">
        Self Analysis for Learning
        <br />
        &amp; Competency Improvement
      </p>
      <div className="launch-chips">
        {ACTIVITIES.map(({ key, Icon, toneClass }) => (
          <div key={key} className={`launch-chip ${toneClass}`}>
            <Icon strokeWidth={1.9} />
          </div>
        ))}
      </div>
      <div className="launch-track">
        <div className="launch-fill" />
      </div>
    </div>
  );
}
