// Can this device run the 3D banner, and how (design spec 3.3)? Synchronous, imports no
// three, and cached in sessionStorage so the WebGL probe runs once per session.
//
//   full   live loop at 30 fps
//   still  build, render the composed still once, keep it as a poster, release the GPU
//   none   never request the three chunk; the poster or the sky gradient stays
//
// A downgrade stored this session (the frame governor fell back to the still, or the
// context was lost twice) always wins over a fresh probe; nothing ever upgrades.

export type BannerTier = "full" | "still" | "none";

// Versioned: a tier stored under an older rule set must not outlive it. v2 (2026-09-29): the
// 40 ms governor wrongly stored "still" on healthy phones; those decisions are ignored now.
const TIER_KEY = "salci-banner-tier-v2";
const LOSS_KEY = "salci-banner-losses";
const RANK: Record<BannerTier, number> = { none: 0, still: 1, full: 2 };

// Software rasterisers: a live scene there is slow and burns the CPU.
const SOFTWARE_GPU = /SwiftShader|llvmpipe|Basic Render/i;
// GPUs that can draw one still frame but not hold 30 fps at banner size.
const WEAK_GPU = /Mali-(4\d\d|T6\d\d|T7\d\d)|Adreno \(TM\) (3\d\d|4\d\d|50\d)|PowerVR/i;

let memo: BannerTier | null = null;
let batteryChecked = false;
let batteryLow = false;

function isTier(v: unknown): v is BannerTier {
  return v === "full" || v === "still" || v === "none";
}

function readSession(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null; // storage blocked (private mode, sandboxed frame)
  }
}

function writeSession(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // storage blocked: the in-memory value still holds for this page load
  }
}

// Development only: `?banner3d=force` runs the live scene even on a software GPU (headless
// Chrome has only SwiftShader), `?banner3d=still` and `?banner3d=off` pin the other
// tiers. `import.meta.env.DEV` is the literal `false` in a production build, so the
// bundler drops this whole branch there.
function devOverride(): BannerTier | null {
  if (!import.meta.env.DEV) return null;
  try {
    const v = new URLSearchParams(window.location.search).get("banner3d");
    if (v === "force") return "full";
    if (v === "still") return "still";
    if (v === "off") return "none";
  } catch {
    // no location (tests)
  }
  return null;
}

// The GPU string, "" when the browser hides it, or null when WebGL2 is unavailable or
// only available with a major performance caveat. The probe context is released at once.
function probeWebGL2(): string | null {
  let gl: WebGL2RenderingContext | null = null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    gl = canvas.getContext("webgl2", {
      failIfMajorPerformanceCaveat: true,
      powerPreference: "low-power",
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) return null;
    // Firefox and Safari answer RENDERER directly; Chrome masks it as "WebKit WebGL" and
    // needs the debug extension (asking Firefox for it logs a deprecation warning).
    let name = String(gl.getParameter(gl.RENDERER) ?? "");
    if (!name || /^webkit webgl$/i.test(name)) {
      const dbg = gl.getExtension("WEBGL_debug_renderer_info");
      if (dbg) name = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) ?? "");
    }
    return name;
  } catch {
    return null;
  } finally {
    try {
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {
      // the context is garbage either way
    }
  }
}

type NavigatorHints = Navigator & {
  connection?: { saveData?: boolean };
  deviceMemory?: number;
  getBattery?: () => Promise<{ charging: boolean; level: number }>;
};

function computeTier(): BannerTier {
  if (typeof window === "undefined" || typeof document === "undefined") return "none";
  const nav = navigator as NavigatorHints;
  if (nav.connection?.saveData) return "none";
  if (Number(readSession(LOSS_KEY)) >= 2) return "none";
  const gpu = probeWebGL2();
  if (gpu === null || SOFTWARE_GPU.test(gpu)) return "none";
  if (WEAK_GPU.test(gpu)) return "still";
  const cores = nav.hardwareConcurrency;
  const memory = nav.deviceMemory;
  if (typeof cores === "number" && typeof memory === "number" && cores <= 4 && memory <= 2) return "still";
  return "full";
}

// A phone on battery below 20% gets the still. The Battery API is async, so the banner
// starts it on mount (primeTier) and probes when its gate opens, at least 300 ms and an
// idle callback later: by then the answer is in. It only ever downgrades a "full" tier,
// so a device without usable WebGL stays "none" and never requests the three chunk.
function checkBatteryOnce(): void {
  if (batteryChecked) return;
  batteryChecked = true;
  try {
    const nav = navigator as NavigatorHints;
    if (typeof nav.getBattery !== "function") return;
    nav
      .getBattery()
      .then((b) => {
        if (b.charging || b.level >= 0.2) return;
        batteryLow = true;
        if (memo === "full") markTier("still"); // probed already: a later read sees it
      })
      .catch(() => {
        // not allowed here (permissions policy): no downgrade
      });
  } catch {
    // no Battery API
  }
}

/** The tier stored this session, without probing; null before the first probe. */
export function storedTier(): BannerTier | null {
  const forced = devOverride();
  if (forced) return forced;
  if (memo) return memo;
  const stored = readSession(TIER_KEY);
  return isTier(stored) ? stored : null;
}

/** Starts the async battery check early, so the tier probe can use its answer. No WebGL. */
export function primeTier(): void {
  if (devOverride()) return;
  checkBatteryOnce();
}

/** The device tier. Probes WebGL2 once per session; later calls read the cache. */
export function probeTier(): BannerTier {
  const forced = devOverride();
  if (forced) return forced;
  let tier = storedTier();
  if (!tier) {
    tier = computeTier();
    writeSession(TIER_KEY, tier);
  }
  memo = tier;
  if (tier === "full" && batteryLow) {
    markTier("still");
    tier = "still";
  }
  if (tier === "full") checkBatteryOnce();
  return tier;
}

/** Stores a downgrade for the rest of the session. Never upgrades. */
export function markTier(tier: BannerTier): void {
  const current = memo ?? storedTier() ?? "full";
  if (RANK[tier] >= RANK[current]) return;
  memo = tier;
  writeSession(TIER_KEY, tier);
}

/** Counts a WebGL context loss this session; the second one retires the 3D banner. */
export function noteContextLoss(): number {
  const n = (Number(readSession(LOSS_KEY)) || 0) + 1;
  writeSession(LOSS_KEY, String(n));
  if (n >= 2) markTier("none");
  return n;
}
