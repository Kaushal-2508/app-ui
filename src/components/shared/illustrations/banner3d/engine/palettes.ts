// Lighting states per time of day, and the crossfade between them.
//
// Every value here lands in a uniform or a light property, so a state change never
// recompiles a shader. Colours are sRGB hex; they become THREE.Color (linear working
// space) once, at build time. The crossfade writes into ONE preallocated state object,
// so a running fade allocates nothing.
import { Color } from "three";
import type { SceneTod } from "./types";

export const TODS: SceneTod[] = ["morning", "midday", "golden", "dusk", "night"];

// One lighting state as authored: colours are sRGB hex strings, vectors are number arrays
// (disc and birdAt are NDC (x, y); keyDir is an unnormalised world direction), the rest
// are scalars. Field ORDER matters at runtime (it is RAW.morning's literal order that
// builds the key lists below), not here.
interface RawPalette {
  skyHor: string; skyMid: string; skyTop: string;
  disc: number[]; discSize: number; discAmt: number; moon: number; discCol: string;
  glowCol: string; glowSize: number; glowAmt: number;
  keyDir: number[]; keyCol: string; keyInt: number;
  shadowInt: number; shadowRadius: number;
  hemiSky: string; hemiGround: string; hemiInt: number;
  fillCol: string; fillInt: number;
  rimCol: string; rim: number;
  fogDensity: number; fogStart: number; fogMax: number;
  mistCol: string; mistAmt: number;
  lawn: string; night: number; glass: number; backHue: number; figLift: number;
  waterA: string; waterB: string;
  blobCol: string; blobAlpha: number;
  cloudCol: string; cloudEm: string; cloudExtra: number; cloudFlat: number;
  birdCol: string; birds: number; birdAt: number[];
  winOn: number; porch: number; lamps: number; flood: number; poleEm: number;
  stars: number; flies: number; motes: number;
}
type KeysOf<T> = { [K in keyof RawPalette]: RawPalette[K] extends T ? K : never }[keyof RawPalette];
type ColorKey = KeysOf<string>;
type NumKey = KeysOf<number>;
type VecKey = KeysOf<number[]>;

/** A live lighting state: colours are THREE.Color (linear working space). */
export type PaletteState = { [K in keyof RawPalette]: RawPalette[K] extends string ? Color : RawPalette[K] };

// Section 2.3 of the approved design, plus the DUSK state the owner approved later
// (a blend of golden and night: deepening sky, windows switching on, first stars, no
// harsh sun). Numbers are the starting points; the pixel probes are the contract.
//   waterA  deep water tint (the river also mirrors the sky above it)
//   waterB  shimmer highlight
//   backHue hue kept on the far hills and far trees (0..1), stops golden khaki
//   figLift emissive lift on the people so faces never go black after sunset
//   birdAt  NDC anchor of the flock at the composed still time (x, y)
const RAW: Record<SceneTod, RawPalette> = {
  morning: {
    skyHor: "#fde4cf", skyMid: "#d9eeee", skyTop: "#8fcbd9",
    disc: [-0.74, 0.5], discSize: 0.085, discAmt: 1, moon: 0, discCol: "#fff8e6",
    glowCol: "#ffe2c0", glowSize: 0.5, glowAmt: 0.62,
    keyDir: [-0.8, 0.37, 0.48], keyCol: "#ffe6c8", keyInt: 2.3,
    shadowInt: 0.75, shadowRadius: 2.5,
    hemiSky: "#d4eaff", hemiGround: "#d9e3c6", hemiInt: 1.45,
    fillCol: "#fff3e8", fillInt: 0.32,
    rimCol: "#fff6ea", rim: 0.34,
    fogDensity: 0.016, fogStart: 44, fogMax: 0.72,
    mistCol: "#f5f7f2", mistAmt: 0.65,
    lawn: "#9ad8a2", night: 0, glass: 0.08, backHue: 0.15, figLift: 0,
    waterA: "#4f9fbd", waterB: "#f4fcfa",
    blobCol: "#51616f", blobAlpha: 0.36,
    cloudCol: "#ffffff", cloudEm: "#3c3c3c", cloudExtra: 1, cloudFlat: 1,
    birdCol: "#5f6485", birds: 1, birdAt: [-0.25, 0.47],
    winOn: 0, porch: 0, lamps: 0, flood: 0, poleEm: 0,
    stars: 0, flies: 0, motes: 0,
  },
  midday: {
    skyHor: "#eef7f0", skyMid: "#bfe3ec", skyTop: "#79bfd5",
    disc: [0.45, 1.25], discSize: 0.1, discAmt: 0, moon: 0, discCol: "#fffdf3",
    glowCol: "#fff4d8", glowSize: 0.55, glowAmt: 0.5,
    keyDir: [0.3, 0.9, 0.3], keyCol: "#fffaf1", keyInt: 2.55,
    shadowInt: 0.8, shadowRadius: 2.0,
    hemiSky: "#e8f6ff", hemiGround: "#d6e8c6", hemiInt: 1.25,
    fillCol: "#ffffff", fillInt: 0.26,
    rimCol: "#ffffff", rim: 0.28,
    fogDensity: 0.011, fogStart: 46, fogMax: 0.66,
    mistCol: "#ffffff", mistAmt: 0,
    lawn: "#a2d09a", night: 0, glass: 0.08, backHue: 0.1, figLift: 0,
    waterA: "#46a2c2", waterB: "#f6fdfc",
    blobCol: "#4b5b66", blobAlpha: 0.34,
    cloudCol: "#ffffff", cloudEm: "#2c2c2c", cloudExtra: 1, cloudFlat: 1,
    birdCol: "#5a6182", birds: 1, birdAt: [0.42, 0.66],
    winOn: 0, porch: 0, lamps: 0, flood: 0, poleEm: 0,
    stars: 0, flies: 0, motes: 0,
  },
  golden: {
    skyHor: "#ffd4a0", skyMid: "#f8bcab", skyTop: "#b9a8de",
    disc: [0.8, 0.46], discSize: 0.115, discAmt: 1, moon: 0, discCol: "#fff4d8",
    glowCol: "#ffc27e", glowSize: 0.75, glowAmt: 0.85,
    keyDir: [0.9, 0.27, 0.34], keyCol: "#ffc48a", keyInt: 3.6,
    shadowInt: 0.9, shadowRadius: 2.0,
    hemiSky: "#c9b8e6", hemiGround: "#f0c9ad", hemiInt: 0.9,
    fillCol: "#ffe2cf", fillInt: 0.34,
    rimCol: "#ffc892", rim: 0.62,
    fogDensity: 0.017, fogStart: 44, fogMax: 0.72,
    mistCol: "#ffdcc0", mistAmt: 0.18,
    lawn: "#92d596", night: 0, glass: 0.35, backHue: 0.86, figLift: 0.03,
    waterA: "#4f7fae", waterB: "#fff0d6",
    blobCol: "#6a4a7e", blobAlpha: 0.42,
    cloudCol: "#fff3ea", cloudEm: "#6a4640", cloudExtra: 1, cloudFlat: 1,
    birdCol: "#5e4660", birds: 1, birdAt: [-0.4, 0.52],
    winOn: 0, porch: 0, lamps: 0, flood: 0, poleEm: 0,
    stars: 0, flies: 0, motes: 1,
  },
  dusk: {
    skyHor: "#f0a88c", skyMid: "#8c78ad", skyTop: "#2f3764",
    disc: [0.84, 0.1], discSize: 0.1, discAmt: 0, moon: 0, discCol: "#fff0d8",
    glowCol: "#ffa982", glowSize: 0.85, glowAmt: 0.5,
    keyDir: [0.92, 0.16, 0.36], keyCol: "#f1b0a8", keyInt: 1.45,
    shadowInt: 0.42, shadowRadius: 3.0,
    hemiSky: "#9690cc", hemiGround: "#d2abaa", hemiInt: 1.42,
    fillCol: "#d9c8f2", fillInt: 0.52,
    rimCol: "#ffb39a", rim: 0.46,
    fogDensity: 0.014, fogStart: 44, fogMax: 0.7,
    mistCol: "#9d8cb6", mistAmt: 0.14,
    lawn: "#a0dc92", night: 0.28, glass: 0.2, backHue: 0.65, figLift: 0.09,
    waterA: "#434f8a", waterB: "#ffd6c0",
    blobCol: "#3f3560", blobAlpha: 0.3,
    cloudCol: "#e0bfcb", cloudEm: "#4a3848", cloudExtra: 1, cloudFlat: 0.85,
    birdCol: "#3f3a58", birds: 0, birdAt: [-0.4, 0.52],
    winOn: 0.86, porch: 0.8, lamps: 0.9, flood: 0.75, poleEm: 0.5,
    stars: 0.62, flies: 0.55, motes: 0,
  },
  night: {
    skyHor: "#3a4270", skyMid: "#242a4c", skyTop: "#1b2038",
    disc: [0.66, 0.5], discSize: 0.075, discAmt: 1, moon: 1, discCol: "#fff3d6",
    glowCol: "#8f9fff", glowSize: 0.35, glowAmt: 0.25,
    keyDir: [0.55, 0.62, 0.56], keyCol: "#c8cfee", keyInt: 0.95,
    shadowInt: 0.55, shadowRadius: 3.0,
    hemiSky: "#3e4a86", hemiGround: "#1b2040", hemiInt: 1.0,
    fillCol: "#8a86c8", fillInt: 0.3,
    rimCol: "#8fa2ff", rim: 0.45,
    fogDensity: 0.013, fogStart: 44, fogMax: 0.72,
    mistCol: "#4a5078", mistAmt: 0.22,
    lawn: "#a3d39a", night: 1, glass: 0.06, backHue: 0, figLift: 0.15,
    waterA: "#1d2a5a", waterB: "#95a6dc",
    blobCol: "#070a1c", blobAlpha: 0.45,
    cloudCol: "#8a91ad", cloudEm: "#4a5174", cloudExtra: 0, cloudFlat: 0.45,
    birdCol: "#1b2038", birds: 0, birdAt: [-0.4, 0.52],
    winOn: 1, porch: 1, lamps: 1, flood: 1, poleEm: 0.8,
    stars: 1, flies: 1, motes: 0,
  },
};

const COLOR_KEYS: ColorKey[] = [];
const NUM_KEYS: NumKey[] = [];
const VEC_KEYS: VecKey[] = [];
for (const [k, v] of Object.entries(RAW.morning)) {
  if (typeof v === "string") COLOR_KEYS.push(k as ColorKey);
  else if (Array.isArray(v)) VEC_KEYS.push(k as VecKey);
  else NUM_KEYS.push(k as NumKey);
}
// Values that must not slide across the frame: they swap at the fade midpoint while
// the thing they drive is dipped to zero (sun disc, key direction, moon).
const STEPPED = new Set(["disc", "keyDir", "moon"]);

function makeState(src: RawPalette | null): PaletteState {
  const s = {} as PaletteState; // every key is written by the three loops below
  for (const k of COLOR_KEYS) s[k] = new Color(src ? src[k] : "#000000");
  for (const k of NUM_KEYS) s[k] = src ? src[k] : 0;
  for (const k of VEC_KEYS) s[k] = src ? src[k].slice() : [0, 0, 0].slice(0, RAW.morning[k].length);
  return s;
}

export const PALETTES = Object.fromEntries(
  TODS.map((t): [SceneTod, PaletteState] => [t, makeState(RAW[t])]),
) as Record<SceneTod, PaletteState>;
export const newState = (): PaletteState => makeState(null);

export function copyState(out: PaletteState, a: PaletteState): PaletteState {
  for (const k of COLOR_KEYS) out[k].copy(a[k]);
  for (const k of NUM_KEYS) out[k] = a[k];
  for (const k of VEC_KEYS) { const o = out[k], v = a[k]; for (let i = 0; i < v.length; i++) o[i] = v[i]; }
  return out;
}

// k: eased fade progress 0..1. Allocation-free.
export function lerpState(out: PaletteState, a: PaletteState, b: PaletteState, k: number): PaletteState {
  const half = k < 0.5;
  for (let i = 0; i < COLOR_KEYS.length; i++) { const n = COLOR_KEYS[i]; out[n].lerpColors(a[n], b[n], k); }
  for (let i = 0; i < NUM_KEYS.length; i++) {
    const n = NUM_KEYS[i];
    out[n] = STEPPED.has(n) ? (half ? a[n] : b[n]) : a[n] + (b[n] - a[n]) * k;
  }
  for (let i = 0; i < VEC_KEYS.length; i++) {
    const n = VEC_KEYS[i], o = out[n], va = a[n], vb = b[n];
    if (STEPPED.has(n)) { const src = half ? va : vb; for (let j = 0; j < o.length; j++) o[j] = src[j]; }
    else for (let j = 0; j < o.length; j++) o[j] = va[j] + (vb[j] - va[j]) * k;
  }
  return out;
}

// Pure: which light-theme state the school clock asks for. Dark theme is always "night".
// Before 11:00 morning, 11:00 to 14:59 midday, 15:00 to 18:59 golden, 19:00 onward dusk.
export function todFromClock(date = new Date(), timeZone = "Asia/Kolkata"): SceneTod {
  const { h } = clockParts(date, timeZone);
  return h < 11 ? "morning" : h < 15 ? "midday" : h < 19 ? "golden" : "dusk";
}

// One Intl.DateTimeFormat per time zone, built once (building one costs ~10 ms at 4x
// CPU; the clock asks every minute). An invalid zone falls back to the school default.
const FMT = new Map<string, Intl.DateTimeFormat>();
function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = FMT.get(timeZone);
  if (f) return f;
  const opts: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" };
  try { f = new Intl.DateTimeFormat("en-GB", { timeZone, ...opts }); }
  catch { f = FMT.get("Asia/Kolkata") || new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", ...opts }); }
  FMT.set(timeZone, f);
  return f;
}

export function clockParts(date = new Date(), timeZone = "Asia/Kolkata"): { h: number; m: number; s: number } {
  const parts = formatterFor(timeZone).formatToParts(date);
  let h = 0, m = 0, s = 0;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.type === "hour") h = Number(p.value); else if (p.type === "minute") m = Number(p.value); else if (p.type === "second") s = Number(p.value);
  }
  return { h: h % 24, m, s };
}
