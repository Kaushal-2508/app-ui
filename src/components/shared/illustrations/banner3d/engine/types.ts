// The engine's public contract. React code imports these with `import type` only, so
// nothing from three or the engine lands outside the lazy engine chunk.

export type SceneTod = "morning" | "midday" | "golden" | "dusk" | "night";

export interface SceneOptions {
  tod?: SceneTod;
  /** "still" renders the composed pose once and never starts a loop. */
  motion?: "live" | "still";
  /** IANA zone for the tower clock (the school's local time). */
  timeZone?: string;
  /** Median frame interval above which the governor steps down (ms). */
  governorMs?: number;
  antialias?: boolean;
  onFirstFrame?(): void;
  onContextLost?(): void;
  onContextRestored?(): void;
  /** Level 1: DPR 1 and shadows off. Level 2: rendered the still and stopped. */
  onGovernor?(level: number, medianMs: number): void;
}

/** The solved composition for one banner size (framing.ts). */
export interface FrameState {
  cssW: number;
  cssH: number;
  aspect: number;
  /** 0 at 3:1 (phone) to 1 at 8:1 (laptop). */
  t: number;
  camY: number;
  camZ: number;
  /** 1 / tan(fov / 2). */
  F: number;
  /** Vertical lens shift (NDC). */
  s: number;
  zFoot: number;
  clamped: boolean;
}

export interface SceneStats {
  drawCalls: number;
  triangles: number;
  refreshDrawCalls: number;
  refreshTriangles: number;
  programs: number;
  avgFrameMs: number;
  cpuP50: number;
  cpuP95: number;
  frames: number;
  shadowRefreshes: number;
  governor: number;
  tod: SceneTod;
  running: boolean;
  dpr: number;
}

/** CSS px, top-left origin, base (undrifted) camera. */
export interface ScreenBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface ScreenProbe {
  frame: FrameState;
  finial: [number, number];
  lawnBand: [number, number];
  flag: ScreenBox;
  flagScale: number;
  pole: ScreenBox;
  tower: ScreenBox;
  school: ScreenBox;
  facade: ScreenBox;
  door: ScreenBox;
  figures: Array<ScreenBox & { i: number }>;
  trees: Array<ScreenBox & { c: string; x: number; z: number }>;
  clouds: Array<ScreenBox & { i: number }>;
  windows: Array<ScreenBox & { lvl: number }>;
  sun: { x: number; y: number; r: number; amt: number; moon: number };
  kite: ScreenBox | null;
  birds: [number, number] | null;
}

export interface SchoolScene {
  /** Phased build; yields to the main thread between phases; an abort disposes. */
  build(signal?: AbortSignal): Promise<void>;
  start(): void;
  stop(): void;
  /** Host-reported visibility (document visible AND banner on screen). */
  setVisible(visible: boolean): void;
  setTod(tod: SceneTod, fadeMs?: number): void;
  /** IANA zone for the tower clock; takes effect at once (or at build, before it). */
  setTimeZone(timeZone: string): void;
  resize(cssW: number, cssH: number, dpr?: number): void;
  /** Pointer position over the banner, -1..1 on each axis. */
  setPointer(nx: number, ny: number): void;
  renderStill(): void;
  setQuality(q: { dpr?: number; shadows?: boolean }): void;
  stats(): SceneStats;
  probe(): ScreenProbe;
  /** JPEG data URL of the current frame, at most maxCssW wide; null if unavailable. */
  capture(maxCssW?: number): string | null;
  /** Releases every GPU resource and force-loses the context. Idempotent. */
  dispose(): void;
  readonly tod: SceneTod;
  readonly running: boolean;
  /** Test harness only: render the still pose at an arbitrary scene time. */
  renderAt(t: number): void;
}

export type CreateSchoolScene = (canvas: HTMLCanvasElement, opts?: SceneOptions) => SchoolScene;
