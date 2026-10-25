import { useEffect, useRef, useState } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { onAppStateChange } from "@/lib/native/appState";
import { isNativePlatform } from "@/lib/native/platform";
import { importDecorative } from "@/lib/decorativeImports";
import { useInstitutionTimezone } from "@/hooks/useInstitutionTimezone";
import type { CreateSchoolScene, SchoolScene, SceneTod } from "./engine/types";
import { markTier, noteContextLoss, primeTier, probeTier, storedTier, type BannerTier } from "./capability";
import { getPoster, posterBucket, putPoster, type PosterBucket } from "./posterCache";
import { useBannerTod } from "./useBannerTod";

/* ------------------------------------------------------------------ tuning */
// Sharpness is set by a pixel budget, not one density for every screen: the laptop banner
// (1168x176) renders at 1.5x, where MSAA on the soft clay look is indistinguishable from 2x
// and fill rate is the GPU budget; the phone banner (343x112) has a fifth of the pixels, so
// it renders at the screen's own density (up to 3x). A 2.5x Android phone at 1.5x looked
// visibly soft (2026-09-29); at 2.5x it drew 858x280 px at the same frame rate as 515x168.
const PIXEL_BUDGET = 1168 * 176 * 1.5 * 1.5;
const DPR_MAX = 3;
// The governor's limit (median ms between rendered frames). Not 40: a steady 24 fps is a
// normal cadence for this 30 fps loop on 48 and 72 Hz displays (41.7 ms), and 40 froze the
// banner on a healthy Adreno 710 phone whose frames cost 1.5 ms (2026-09-29). Only a device
// below about 16 fps is struggling.
const GOVERNOR_MS = 60;
// Web: if the dashboard's queries have not settled by then, the network is slow and
// the banner must not compete with it; keep the fallback for this mount.
const SETTLE_TIMEOUT_MS = 8000;
// "Settled" = no query fetching for this long, so a dependent query that starts a
// render after its parent resolves does not read as settled in between.
const SETTLE_QUIET_MS = 300;
const IDLE_TIMEOUT_MS = 3000;
// WKWebView and Safari have no requestIdleCallback.
const IDLE_FALLBACK_MS = 250;
const FADE_IN_MS = 600;
const FADE_OUT_MS = 200;
// Design spec 3.6: no restore within 3 s means the context is gone for good.
const RESTORE_WAIT_MS = 3000;
// A loss this soon after a return from the background is the backgrounding case
// (iOS 17 drops the context of a hidden WebView), not a failing GPU.
const RESUME_GRACE_MS = 2000;
const POSTER_MAX_CSS_W = 1400;
// The still tier shows its poster as the banner, and the frame holds the tower clock at
// the minute it was captured: reuse one only this fresh, else render the still again.
const STILL_POSTER_MAX_AGE_MS = 5 * 60_000;

// Written literally so Tailwind generates every class the canvas ever carries:
// opacity-0 opacity-100 duration-200 [transition-duration:600ms]
// Not duration-* with a bracketed value: tailwindcss-animate also owns duration-*, so
// Tailwind finds that ambiguous, warns, and generates nothing (the fade ran at 150ms).
// Do not spell that class out here either: Tailwind scans comments too.
const CANVAS_CLASS = "absolute inset-0 block h-full w-full opacity-0 transition-opacity ease-out [transition-duration:600ms]";

/* --------------------------------------------------------------- controller */
interface BannerEnv {
  /** Covers the banner exactly: observers and pointer listeners live here. */
  host: HTMLDivElement;
  /** Empty element React never renders into: the canvas is appended here. */
  slot: HTMLDivElement;
  queryClient: QueryClient;
  tod: SceneTod;
  timeZone(): string;
  showPoster(url: string | null): void;
}

interface BannerController {
  setTod(tod: SceneTod, fadeMs: number): void;
  setTimeZone(timeZone: string): void;
  dispose(): void;
}

type Phase = "gate" | "opening" | "live" | "still" | "fallback";

async function loadEngine(): Promise<CreateSchoolScene> {
  // The ONLY runtime import of the engine: three and the engine land in one lazy chunk.
  // It is decorative, so a failed download rejects here (the banner keeps its fallback)
  // instead of main.tsx reloading the dashboard under the user (src/lib/decorativeImports.ts).
  const mod: { createSchoolScene?: unknown } | undefined = await importDecorative(() => import("./engine/bannerEngine"));
  const create: unknown = mod ? mod.createSchoolScene : undefined;
  if (typeof create !== "function") throw new Error("banner engine unavailable");
  return create as CreateSchoolScene;
}

function devWarn(message: string, err?: unknown): void {
  if (import.meta.env.DEV) console.warn(`[banner3d] ${message}`, err ?? "");
}

/**
 * The imperative lifecycle of one mounted banner (design spec 3.2 and 3.5 to 3.8). It
 * owns every observer, listener, timer, the canvas and the scene; `dispose()` releases
 * all of them and is idempotent, so a StrictMode remount starts from nothing.
 */
function runBanner(env: BannerEnv): BannerController {
  const { host, slot, queryClient } = env;
  let disposed = false;
  let phase: Phase = "gate";
  let tier: BannerTier = "full";
  let tod: SceneTod = env.tod;

  let scene: SchoolScene | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let build: AbortController | null = null;
  let canvasShown = false;
  let fadeToken = 0;
  let govLevel = 0;
  let lost = false;
  let rebuiltAfterLoss = false;
  let restoreTimer = 0;
  let stillGen = 0;

  // The poster under the canvas: what a context loss reveals. posterSeq orders the
  // async IndexedDB reads against fresh captures so a late read never wins.
  let fallbackPoster: string | null = null;
  let posterSeq = 0;

  // gate and pause inputs
  let onScreen = typeof IntersectionObserver === "undefined";
  let docVisible = document.visibilityState === "visible";
  let appActive = true;
  let settled = false;
  let lastResumeAt = 0;
  const reducedMq = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  let reduced = !!reducedMq?.matches;

  // size, cached from the ResizeObserver (and the pointer's entry point)
  let width = 0;
  let height = 0;
  let left = 0;
  let top = 0;
  let bucket: PosterBucket = "wide";

  const timers = new Set<number>();
  const cleanups: Array<() => void> = [];

  function later(fn: () => void, ms: number): number {
    const id = window.setTimeout(() => {
      timers.delete(id);
      if (!disposed) fn();
    }, ms);
    timers.add(id);
    return id;
  }
  function cancel(id: number): void {
    if (!id) return;
    window.clearTimeout(id);
    timers.delete(id);
  }

  function measure(): void {
    const r = host.getBoundingClientRect();
    width = r.width;
    height = r.height;
    left = r.left;
    top = r.top;
    bucket = posterBucket(width, height);
  }
  function dpr(): number {
    if (govLevel >= 1) return 1; // the governor stepped down; a resize must not undo it
    const budget = width > 0 && height > 0 ? Math.sqrt(PIXEL_BUDGET / (width * height)) : 1.5;
    return Math.max(1, Math.min(window.devicePixelRatio || 1, DPR_MAX, budget));
  }
  function hostActive(): boolean {
    return docVisible && appActive;
  }

  /* ---- posters */
  function lookupPoster(want: SceneTod): void {
    const seq = posterSeq;
    const b = bucket;
    void getPoster(want, b).then((url) => {
      if (disposed || seq !== posterSeq || want !== tod || phase === "still") return;
      posterSeq++;
      fallbackPoster = url;
      env.showPoster(url);
    });
  }
  function capturePoster(s: SchoolScene): string | null {
    if (lost) return null;
    let url: string | null = null;
    try {
      url = s.capture(POSTER_MAX_CSS_W);
    } catch (err) {
      devWarn("capture failed", err);
    }
    if (!url) return null;
    posterSeq++;
    fallbackPoster = url;
    void putPoster(s.tod, bucket, url);
    return url;
  }

  /* ---- canvas and scene */
  function makeScene(create: CreateSchoolScene, motion: "live" | "still", at: SceneTod): SchoolScene {
    const c = document.createElement("canvas");
    c.className = CANVAS_CLASS;
    c.setAttribute("aria-hidden", "true");
    slot.appendChild(c);
    canvas = c;
    const s: SchoolScene = create(c, {
      tod: at,
      motion,
      timeZone: env.timeZone(),
      governorMs: GOVERNOR_MS,
      onContextLost: () => {
        if (scene === s) onLost();
      },
      onContextRestored: () => {
        if (scene === s) onRestored();
      },
      onGovernor: (level) => {
        if (scene === s) onGovernor(level);
      },
    });
    scene = s;
    s.resize(Math.max(1, width), Math.max(1, height), dpr());
    return s;
  }

  function teardownScene(): void {
    if (build) build.abort();
    build = null;
    fadeToken++;
    const s = scene;
    const c = canvas;
    scene = null;
    canvas = null;
    canvasShown = false;
    lost = false;
    cancel(restoreTimer);
    restoreTimer = 0;
    if (s) {
      try {
        s.dispose(); // releases every GPU resource and force-loses the context
      } catch (err) {
        devWarn("dispose failed", err);
      }
    }
    if (c) c.remove();
  }

  function fadeCanvasIn(): void {
    const c = canvas;
    if (!c) return;
    const token = ++fadeToken;
    const finish = () => {
      c.removeEventListener("transitionend", onEnd);
      if (disposed || token !== fadeToken || canvas !== c) return;
      canvasShown = true;
      if (fallbackPoster) env.showPoster(fallbackPoster);
    };
    const onEnd = (e: TransitionEvent) => {
      if (e.propertyName === "opacity") finish();
    };
    c.addEventListener("transitionend", onEnd);
    c.classList.remove("duration-200");
    c.classList.add("[transition-duration:600ms]");
    void c.getBoundingClientRect(); // commit opacity-0 so the change below transitions
    c.classList.remove("opacity-0");
    c.classList.add("opacity-100");
    // transitionend never fires in a hidden tab or when nothing changed
    later(finish, FADE_IN_MS + 150);
  }

  function fadeCanvasOut(): void {
    const c = canvas;
    fadeToken++;
    canvasShown = false; // what shows under the canvas now: the poster, else the sky gradient
    if (fallbackPoster) env.showPoster(fallbackPoster);
    if (!c) return;
    c.classList.remove("[transition-duration:600ms]", "opacity-100");
    c.classList.add("duration-200", "opacity-0");
  }

  /* ---- pause and resume (spec 3.5) */
  function sync(): void {
    const s = scene;
    if (!s || phase !== "live") return;
    const visible = hostActive() && onScreen;
    if (visible && !reduced && !lost && govLevel < 2) s.start();
    else s.stop();
    s.setVisible(visible);
  }

  function resume(): void {
    lastResumeAt = performance.now();
    // lost in the background and never restored: rebuild once on a fresh canvas
    if (lost && scene && (phase === "live" || phase === "opening")) rebuildFresh();
  }

  /* ---- context loss (spec 3.6) */
  function onLost(): void {
    if (disposed || (phase !== "live" && phase !== "opening")) return;
    lost = true;
    scene?.stop();
    fadeCanvasOut();
    cancel(restoreTimer);
    const background = !hostActive() || performance.now() - lastResumeAt < RESUME_GRACE_MS;
    if (background) {
      // not the GPU failing: wait for a restore, else rebuild (now if visible, else on resume)
      if (hostActive()) restoreTimer = later(rebuildFresh, RESTORE_WAIT_MS);
      return;
    }
    if (noteContextLoss() >= 2) {
      giveUp(); // the second loss this session retires the 3D banner
      return;
    }
    restoreTimer = later(giveUp, RESTORE_WAIT_MS);
  }

  function onRestored(): void {
    if (disposed || !scene) return;
    cancel(restoreTimer);
    restoreTimer = 0;
    lost = false;
    if (phase === "live") {
      fadeCanvasIn();
      sync();
    }
  }

  function rebuildFresh(): void {
    if (disposed) return;
    if (rebuiltAfterLoss) {
      giveUp();
      return;
    }
    rebuiltAfterLoss = true;
    teardownScene(); // a force-lost canvas is never reused
    phase = "opening";
    void buildLive();
  }

  function giveUp(): void {
    markTier("none");
    fadeCanvasOut();
    teardownScene();
    phase = "fallback";
  }

  /* ---- governor (spec 3.3) */
  function onGovernor(level: number): void {
    govLevel = Math.max(govLevel, level);
    if (level < 2) return;
    markTier("still");
    // The engine renders its still right after this callback returns; settle next task.
    later(settleToStill, 0);
  }

  function settleToStill(): void {
    const s = scene;
    if (!s || phase !== "live") return;
    phase = "still";
    s.stop();
    s.renderStill();
    const url = capturePoster(s);
    if (url) env.showPoster(url);
    // fade the canvas out over the poster, then release the GPU
    fadeCanvasOut();
    later(() => {
      if (scene === s) teardownScene();
    }, FADE_OUT_MS + 50);
  }

  /* ---- builds */
  async function buildLive(): Promise<void> {
    let create: CreateSchoolScene;
    try {
      create = await loadEngine();
    } catch (err) {
      devWarn("engine chunk failed to load", err);
      if (!disposed) phase = "fallback";
      return;
    }
    if (disposed) return;
    if (storedTier() === "still") {
      // downgraded while the chunk downloaded (a late battery answer): render the still
      tier = "still";
      phase = "still";
      await renderStillPoster();
      return;
    }
    const s = makeScene(create, "live", tod);
    const ac = new AbortController();
    build = ac;
    try {
      await s.build(ac.signal);
    } catch (err) {
      if (disposed || ac.signal.aborted || scene !== s) return;
      // the probe said yes but no renderer could be made: do not retry this session
      devWarn("build failed", err);
      markTier("none");
      teardownScene();
      phase = "fallback";
      return;
    }
    if (disposed || ac.signal.aborted || scene !== s) return;
    build = null;
    phase = "live";
    if (govLevel >= 1) s.setQuality({ dpr: 1, shadows: false });
    if (!lost) {
      // build() rendered the composed still pose, the frame the loop starts from, so
      // the poster, the first frame and the reduced-motion frame are one image
      capturePoster(s);
      fadeCanvasIn();
    }
    sync();
  }

  async function renderStillPoster(): Promise<void> {
    const gen = ++stillGen;
    const want = tod;
    const b = bucket;
    const cached = await getPoster(want, b, STILL_POSTER_MAX_AGE_MS);
    if (disposed || gen !== stillGen) return;
    if (cached) {
      if (build) teardownScene(); // an older still build for another moment: stop it
      posterSeq++;
      fallbackPoster = cached;
      env.showPoster(cached);
      return;
    }
    let create: CreateSchoolScene;
    try {
      create = await loadEngine();
    } catch (err) {
      devWarn("engine chunk failed to load", err);
      if (!disposed) phase = "fallback"; // later changes only look up posters
      return;
    }
    if (disposed || gen !== stillGen) return;
    teardownScene();
    const s = makeScene(create, "still", want);
    const ac = new AbortController();
    build = ac;
    try {
      await s.build(ac.signal);
    } catch (err) {
      if (disposed || ac.signal.aborted || scene !== s) return;
      devWarn("still build failed", err);
      markTier("none");
      teardownScene();
      phase = "fallback"; // no renderer on this device: never build again this mount
      return;
    }
    if (disposed || ac.signal.aborted || scene !== s) return;
    if (gen !== stillGen) {
      teardownScene(); // superseded while it built: release its context and clock timer
      return;
    }
    build = null;
    const url = capturePoster(s);
    teardownScene(); // still tier: one frame, then every GPU resource goes back
    if (url) env.showPoster(url);
  }

  async function open(): Promise<void> {
    // Probed here, in idle time, not on mount: a first-of-session WebGL context
    // creation costs tens of ms on a phone. The battery check started on mount
    // (primeTier), so its answer is in by now; buildLive reads the tier once more.
    tier = probeTier();
    if (tier === "none") {
      phase = "fallback";
      return;
    }
    if (tier === "still") {
      phase = "still";
      await renderStillPoster();
      return;
    }
    await buildLive();
  }

  /* ---- the gate (spec 3.2 step 3 and 4) */
  function maybeOpen(): void {
    if (disposed || phase !== "gate") return;
    if (!onScreen || !hostActive() || !settled) return;
    phase = "opening";
    const run = () => {
      void open().catch((err) => {
        devWarn("open failed", err);
        if (!disposed) phase = "fallback";
      });
    };
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(
        () => {
          if (!disposed) run();
        },
        { timeout: IDLE_TIMEOUT_MS },
      );
      cleanups.push(() => window.cancelIdleCallback(id));
    } else {
      later(run, IDLE_FALLBACK_MS);
    }
  }

  function setTod(next: SceneTod, fadeMs: number): void {
    if (disposed || next === tod) return;
    tod = next;
    if (phase === "still") {
      void renderStillPoster(); // the cached still for the new moment, else one rebuild
      return;
    }
    if (scene) scene.setTod(next, phase === "live" && !reduced ? fadeMs : 0);
    lookupPoster(next);
  }

  // The school's zone resolved after the scene was made: move the tower hands with the
  // sky. (A later scene reads env.timeZone() when it is made.)
  function setTimeZone(tz: string): void {
    if (disposed || !scene || (phase !== "live" && phase !== "opening")) return;
    scene.setTimeZone(tz);
  }

  /* ---- mount */
  measure();
  lookupPoster(tod); // paint the cached poster over the sky gradient as soon as it is read

  // A tier retired earlier this session: the fallback is all there is.
  if (storedTier() === "none") {
    phase = "fallback";
  } else {
    primeTier(); // the async battery check, so the probe at the gate can use it

    // queries settled: no fetch in flight for SETTLE_QUIET_MS, observed once (latched)
    let unsubCache: (() => void) | null = null;
    let quietTimer = 0;
    let settleTimer = 0;
    const latchSettled = () => {
      if (settled) return;
      settled = true;
      if (unsubCache) unsubCache();
      unsubCache = null;
      cancel(quietTimer);
      cancel(settleTimer);
      maybeOpen();
    };
    const checkQuiet = () => {
      if (settled) return;
      if (queryClient.isFetching() > 0) {
        cancel(quietTimer);
        quietTimer = 0;
        return;
      }
      if (!quietTimer) {
        quietTimer = later(() => {
          quietTimer = 0;
          if (queryClient.isFetching() === 0) latchSettled();
        }, SETTLE_QUIET_MS);
      }
    };
    // One task late: the dashboard's own queries subscribe in this same commit.
    later(() => {
      unsubCache = queryClient.getQueryCache().subscribe(checkQuiet);
      checkQuiet();
    }, 0);
    settleTimer = later(() => {
      if (settled) return;
      // native: the chunk is local, so proceed; web: a slow network, keep the fallback
      if (queryClient.isFetching() === 0 || isNativePlatform()) latchSettled();
      else {
        if (unsubCache) unsubCache();
        unsubCache = null;
        cancel(quietTimer);
        phase = "fallback";
      }
    }, SETTLE_TIMEOUT_MS);
    cleanups.push(() => {
      if (unsubCache) unsubCache();
      unsubCache = null;
    });

    // on screen
    if (typeof IntersectionObserver !== "undefined") {
      const io = new IntersectionObserver(
        (entries) => {
          const e = entries[entries.length - 1];
          onScreen = !!e && (e.isIntersecting || e.intersectionRatio > 0);
          maybeOpen();
          sync();
        },
        { rootMargin: "0px", threshold: 0 },
      );
      io.observe(host);
      cleanups.push(() => io.disconnect());
    }

    // document visibility
    const onVisibility = () => {
      const v = document.visibilityState === "visible";
      if (v === docVisible) return;
      docVisible = v;
      if (v) resume();
      maybeOpen();
      sync();
    };
    document.addEventListener("visibilitychange", onVisibility);
    cleanups.push(() => document.removeEventListener("visibilitychange", onVisibility));

    // native app to the background and back ("focus" events are the web's, ignored:
    // a devtools click or the notification shade must not pause the scene)
    if (isNativePlatform()) {
      cleanups.push(
        onAppStateChange((active, source) => {
          if (source !== "native" || active === appActive) return;
          appActive = active;
          if (active) resume();
          maybeOpen();
          sync();
        }),
      );
    }

    // reduced motion, live: turning it on renders the still, off resumes the loop
    if (reducedMq && typeof reducedMq.addEventListener === "function") {
      const onReduced = (e: MediaQueryListEvent) => {
        reduced = e.matches;
        if (reduced && scene && phase === "live") {
          scene.setPointer(0, 0);
          scene.renderStill();
        }
        sync();
      };
      reducedMq.addEventListener("change", onReduced);
      cleanups.push(() => reducedMq.removeEventListener("change", onReduced));
    }

    // pointer parallax (spec 2.5): fine hovering pointers only, on the banner only
    const finePointer = typeof window.matchMedia === "function" && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    if (finePointer) {
      const onEnter = () => {
        // the page may have scrolled since the last resize: refresh the cached origin
        const r = host.getBoundingClientRect();
        left = r.left;
        top = r.top;
      };
      const onMove = (e: PointerEvent) => {
        if (e.pointerType === "touch" || !scene || phase !== "live" || reduced || width <= 0 || height <= 0) return;
        scene.setPointer(((e.clientX - left) / width) * 2 - 1, ((e.clientY - top) / height) * 2 - 1);
      };
      const onLeave = () => {
        if (scene) scene.setPointer(0, 0);
      };
      host.addEventListener("pointerenter", onEnter, { passive: true });
      host.addEventListener("pointermove", onMove, { passive: true });
      host.addEventListener("pointerleave", onLeave, { passive: true });
      cleanups.push(() => {
        host.removeEventListener("pointerenter", onEnter);
        host.removeEventListener("pointermove", onMove);
        host.removeEventListener("pointerleave", onLeave);
      });
    }
  }

  // resize: one ResizeObserver, coalesced to one frame (the engine skips no-op sizes)
  if (typeof ResizeObserver !== "undefined") {
    let raf = 0;
    const ro = new ResizeObserver(() => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        if (disposed) return;
        const before = bucket;
        measure();
        if (scene && (phase === "live" || phase === "opening")) scene.resize(Math.max(1, width), Math.max(1, height), dpr());
        if (bucket === before) return;
        // the banner changed shape (a rotated phone): posters are per shape
        if (phase === "still") void renderStillPoster();
        else if (!canvasShown) lookupPoster(tod);
      });
    });
    ro.observe(host);
    cleanups.push(() => {
      ro.disconnect();
      if (raf) window.cancelAnimationFrame(raf);
    });
  }

  // Development only: a handle for the headless checks. Nothing global in production.
  if (import.meta.env.DEV) {
    const w = window as Window & { __banner3d?: unknown };
    const handle = {
      get scene() {
        return scene;
      },
      get phase() {
        return phase;
      },
      get tier() {
        return tier;
      },
      get tod() {
        return tod;
      },
      get canvasShown() {
        return canvasShown;
      },
    };
    w.__banner3d = handle;
    cleanups.push(() => {
      if (w.__banner3d === handle) delete w.__banner3d;
    });
  }

  return {
    setTod,
    setTimeZone,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const id of timers) window.clearTimeout(id);
      timers.clear();
      for (const fn of cleanups.splice(0)) {
        try {
          fn();
        } catch (err) {
          devWarn("cleanup failed", err);
        }
      }
      teardownScene(); // aborts an in-flight build, disposes the scene, removes the canvas
    },
  };
}

/* ---------------------------------------------------------------- component */
/**
 * The dashboard banner's content. Until the 3D scene is up, the banner shows its sky
 * gradient (the wrapper's .scene-banner background, zero bytes) or, on a return visit, the
 * cached poster of the scene. The real-time 3D "Clay School" scene then cross-fades in once
 * the page's own data has loaded and the main thread is idle. Weak devices keep a single
 * rendered still; devices without usable WebGL never download three and keep the sky.
 * Decorative only: hidden from assistive tech, nothing focusable, no text.
 */
export function Banner3DLayer() {
  const timeZone = useInstitutionTimezone();
  const { tod, fadeMs } = useBannerTod(timeZone);
  const queryClient = useQueryClient();

  const hostRef = useRef<HTMLDivElement>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const ctlRef = useRef<BannerController | null>(null);
  const todRef = useRef(tod);
  const tzRef = useRef(timeZone);

  const [poster, setPoster] = useState<string | null>(null);
  const [posterReady, setPosterReady] = useState(false);

  useEffect(() => {
    tzRef.current = timeZone;
    ctlRef.current?.setTimeZone(timeZone);
  }, [timeZone]);

  useEffect(() => {
    const host = hostRef.current;
    const slot = slotRef.current;
    if (!host || !slot) return;
    const ctl = runBanner({
      host,
      slot,
      queryClient,
      tod: todRef.current,
      timeZone: () => tzRef.current,
      showPoster: (url) => {
        setPoster(url);
        if (!url) setPosterReady(false);
      },
    });
    ctlRef.current = ctl;
    return () => {
      ctl.dispose();
      if (ctlRef.current === ctl) ctlRef.current = null;
    };
  }, [queryClient]);

  useEffect(() => {
    todRef.current = tod;
    ctlRef.current?.setTod(tod, fadeMs);
  }, [tod, fadeMs]);

  return (
    <div ref={hostRef} className="absolute inset-0" aria-hidden="true">
      {poster && (
        <img
          src={poster}
          alt=""
          aria-hidden="true"
          draggable={false}
          decoding="async"
          onLoad={() => setPosterReady(true)}
          className={cn(
            "pointer-events-none absolute inset-0 h-full w-full select-none object-cover",
            posterReady ? "opacity-100" : "opacity-0",
          )}
        />
      )}
      <div ref={slotRef} className="absolute inset-0" />
    </div>
  );
}
