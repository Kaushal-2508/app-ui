// The static world and the instanced foliage.
//
// Two merged static meshes share the "static" clay program: CASTERS (big volumes that
// write the shadow map) and RECEIVERS (facade detail, props, then the ground plane: road,
// river, hills near to far and the lawn LAST, so early-z rejects the ground under
// everything drawn before it). Every vertex carries aSurf = (glow level, tint, kind,
// seed). All foliage, flowers and clouds are InstancedMesh on the one "inst" program.
import {
  BufferAttribute, BufferGeometry, CatmullRomCurve3, Color, CylinderGeometry, ExtrudeGeometry,
  IcosahedronGeometry, InstancedMesh, LatheGeometry, Matrix4, OctahedronGeometry, Quaternion,
  Euler, Shape, SphereGeometry, TorusGeometry, Vector2, Vector3, BoxGeometry, CapsuleGeometry,
} from "three";
import type { Curve, Material } from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { KIND } from "./materials";

/* ------------------------------------------------------------------ types */
/** A colour for a part: a CSS string, or a function of the (placed) vertex position. */
export type ColorFn = (x: number, y: number, z: number) => string;
/** null keeps the geometry's own "color" attribute. */
export type PartColor = string | ColorFn | null;
export type GlowFn = (x: number, y: number, z: number) => number;

/** Options for Builder.add. Any other key names an extra attribute (see the constructor). */
export interface AddOptions {
  pos?: readonly number[];
  rot?: readonly number[];
  scale?: readonly number[];
  kind?: number;
  tint?: number;
  seed?: number;
  glow?: number | GlowFn;
  [extra: string]: unknown;
}

/** A glow quad placed by the static world (glows.ts builds them). */
export interface GlowSpot {
  x: number;
  y: number;
  z: number;
  size: number;
  kind: number;
  seed: number;
  amp: number;
  col: [number, number, number];
}

/** A static contact blob: [x, z, sx, sz] (glows.ts reads an optional 5th alpha). */
export type SoftBlob = number[];

export interface WindowInfo {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  lvl: number;
}

export interface GeomInfo {
  windows: WindowInfo[];
  door: { x0: number; x1: number; y0: number; y1: number; z: number } | null;
  boat: [number, number, number];
}

/** x, z, scale, colour, [sx, sy] canopy stretch */
export type TreeRow = [x: number, z: number, scale: number, color: string, sx?: number, sy?: number];
/** x, z, scale */
export type CypressRow = [x: number, z: number, scale: number];

type IMesh = InstancedMesh<BufferGeometry, Material>;
type Row0 = readonly [number, ...unknown[]];

export const TAU = Math.PI * 2;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export function mulberry32(a: number): () => number {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------------------------------------------------------------- palette */
// Brand: teal #249ca2, orange #fa920e, lilac hsl(257 35% 62%).
export const P = {
  wall: "#fbf0df", wall2: "#fff6e9", plinth: "#eab59a", trim: "#93d3cd",
  roof: "#4fb4b5", roofD: "#2d9da2", door: "#248f95", frame: "#ffffff",
  glass: "#86b9cb", glassHi: "#c4e2ec", winFrame: "#6cc2bc", orange: "#f7a24a", orangeD: "#e98a2c", lilac: "#a695d9",
  path: "#f1ddc6", court: "#f4e3cc", step: "#efe4d6", bank: "#b9a283",
  shoe: "#3a3850", navy: "#34507e", tealU: "#2f9398", white: "#fbfaf6", hair: "#2a2230",
};

/* ------------------------------------------------------------ geometry kit */
export const rbox = (w: number, h: number, d: number, r = 0.06, s = 1) =>
  new RoundedBoxGeometry(w, h, d, s, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));
export const box = (w: number, h: number, d: number) => new BoxGeometry(w, h, d);
export const sph = (r: number, ws = 12, hs = 8, ...rest: [phiStart?: number, phiLength?: number, thetaStart?: number, thetaLength?: number]) =>
  new SphereGeometry(r, ws, hs, ...rest);
export const cyl = (rt: number, rb: number, h: number, rs = 10) => new CylinderGeometry(rt, rb, h, rs, 1);
export const cap = (r: number, len: number, cs = 3, rs = 8) => new CapsuleGeometry(r, len, cs, rs);
export const lathe = (pts: ReadonlyArray<readonly number[]>, seg = 10, p0 = 0, pl = TAU) =>
  new LatheGeometry(pts.map(([x, y]) => new Vector2(x, y)), seg, p0, pl);

function roundedShape(pts: ReadonlyArray<readonly number[]>, r: number) {
  const s = new Shape();
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n];
    const a = new Vector2(p0[0] - p1[0], p0[1] - p1[1]).normalize().multiplyScalar(r);
    const b = new Vector2(p2[0] - p1[0], p2[1] - p1[1]).normalize().multiplyScalar(r);
    if (i === 0) s.moveTo(p1[0] + a.x, p1[1] + a.y); else s.lineTo(p1[0] + a.x, p1[1] + a.y);
    s.quadraticCurveTo(p1[0], p1[1], p1[0] + b.x, p1[1] + b.y);
  }
  s.closePath();
  return s;
}
// Soft triangular prism: cross-section in XY (width x height), extruded along Z.
export function prism(width: number, height: number, length: number, r = 0.08, bevel = 0.03) {
  const s = roundedShape([[-width / 2, 0], [width / 2, 0], [0, height]], r);
  const g = new ExtrudeGeometry(s, { depth: length, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 2 });
  g.translate(0, 0, -length / 2);
  return g;
}
function archShape(w: number, h: number) {
  const s = new Shape();
  s.moveTo(-w / 2, 0); s.lineTo(-w / 2, h - w / 2);
  s.absarc(0, h - w / 2, w / 2, Math.PI, 0, true);
  s.lineTo(w / 2, 0); s.closePath();
  return s;
}
const arch = (w: number, h: number, d: number) => new ExtrudeGeometry(archShape(w, h), { depth: d, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 1, curveSegments: 7 });

// Displaced icosphere: the blobby clay canopy / bush / cloud lump.
export function blob(detail: number, seed: number, amt = 0.16, flatten = 0.8): BufferGeometry {
  let g: BufferGeometry = new IcosahedronGeometry(1, detail);
  g.deleteAttribute("normal"); g.deleteAttribute("uv");
  g = mergeVertices(g);
  const r = mulberry32(seed);
  const bumps: Array<[Vector3, number]> = [];
  for (let i = 0; i < 6; i++) bumps.push([new Vector3(r() * 2 - 1, r() * 1.6 - 0.4, r() * 2 - 1).normalize(), 0.5 + r() * 0.6]);
  const p = g.attributes.position, v = new Vector3(), n = new Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    n.copy(v).normalize();
    let s = 1;
    for (const [b, w] of bumps) s += amt * w * Math.pow(Math.max(0, n.dot(b)), 5);
    v.multiplyScalar(s);
    if (v.y < 0) v.y *= flatten;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

// A clay mound: y = cos(r*pi/2)^1.25, round on top and meeting the ground TANGENTIALLY,
// so overlapping hills read as one rolling ridge (a hemisphere meets the ground at 90
// degrees and its sides stack into vertical stair steps). Only the camera-facing 250
// degrees are built; the rest is never seen.
function mound(seg = 12, R = 6) {
  const pts: number[][] = [];
  for (let i = R; i >= 0; i--) { const r = i / R; pts.push([r, Math.pow(Math.cos((r * Math.PI) / 2), 1.25)]); }
  return lathe(pts, seg, -0.7 * Math.PI, 1.4 * Math.PI);
}

/* ---------------------------------------------------------------- builder */
// Accumulates painted, placed parts and merges them into one geometry with
// position, normal, color and aSurf (glow, tint, kind, seed). Colour strings are parsed
// once each (cached); a geometry that is already non-indexed is used in place (every
// source is a temporary made for this call).
const _m = new Matrix4(), _q = new Quaternion(), _e = new Euler(), _p = new Vector3(), _s = new Vector3(), _c = new Color();
const ZERO3: readonly number[] = [0, 0, 0], ONE3: readonly number[] = [1, 1, 1];
const RGB = new Map<string, [number, number, number]>();
function rgbOf(c: string): [number, number, number] {
  let v = RGB.get(c);
  if (!v) { _c.set(c); v = [_c.r, _c.g, _c.b]; RGB.set(c, v); }
  return v;
}
export class Builder {
  geos: BufferGeometry[];
  /** Extra per-part attributes: name -> item size; each part passes its value as o[name]. */
  extra: Record<string, number> | null;
  constructor(extra: Record<string, number> | null = null) { this.geos = []; this.extra = extra; }
  // color: a CSS string, a function (x, y, z) -> CSS string, or null to keep the
  // geometry's own "color" attribute
  add(geo: BufferGeometry, color: PartColor, o: AddOptions = {}): this {
    // Parts stay INDEXED (a non-indexed source gets a trivial index): the merged mesh then
    // shares vertices and the GPU's post-transform cache runs each one once. De-indexing
    // tripled the vertex work, and on integrated GPUs the vertex stage was a third of the
    // phone frame.
    const g = geo;
    if (!g.index) {
      const n = g.attributes.position.count, idx = new Array<number>(n);
      for (let i = 0; i < n; i++) idx[i] = i;
      g.setIndex(idx);
    }
    const keepColor = color === null;
    for (const k of Object.keys(g.attributes)) if (k !== "position" && k !== "normal" && !(keepColor && k === "color")) g.deleteAttribute(k);
    g.clearGroups();
    if (!g.attributes.normal) g.computeVertexNormals();
    if (o.pos || o.rot || o.scale) {
      const r = o.rot || ZERO3, t = o.pos || ZERO3, sc = o.scale || ONE3;
      _e.set(r[0], r[1], r[2]);
      _m.compose(_p.set(t[0], t[1], t[2]), _q.setFromEuler(_e), _s.set(sc[0], sc[1], sc[2]));
      g.applyMatrix4(_m);
    }
    const pa = g.attributes.position.array, n = g.attributes.position.count;
    const surf = new Float32Array(n * 4);
    const kind = o.kind ?? KIND.CLAY, tint = o.tint ?? 0, seed = o.seed ?? 0;
    const glowFn = typeof o.glow === "function" ? o.glow : null, glow0 = typeof o.glow === "number" ? o.glow || 0 : 0;
    let col: Float32Array | null = null;
    if (!keepColor) {
      col = new Float32Array(n * 3);
      const colorFn = typeof color === "function" ? color : null;
      const fixed = colorFn ? null : rgbOf(color as string);
      for (let i = 0; i < n; i++) {
        const c = fixed || rgbOf(colorFn(pa[i * 3], pa[i * 3 + 1], pa[i * 3 + 2]));
        col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
      }
    }
    for (let i = 0; i < n; i++) {
      surf[i * 4] = glowFn ? glowFn(pa[i * 3], pa[i * 3 + 1], pa[i * 3 + 2]) : glow0;
      surf[i * 4 + 1] = tint; surf[i * 4 + 2] = kind; surf[i * 4 + 3] = seed;
    }
    if (col) g.setAttribute("color", new BufferAttribute(col, 3));
    g.setAttribute("aSurf", new BufferAttribute(surf, 4));
    if (this.extra) for (const [name, size] of Object.entries(this.extra)) {
      const v = (o[name] as ArrayLike<number> | undefined) ?? new Array<number>(size).fill(0);
      const a = new Float32Array(n * size);
      for (let i = 0; i < n; i++) for (let j = 0; j < size; j++) a[i * size + j] = v[j];
      g.setAttribute(name, new BufferAttribute(a, size));
    }
    this.geos.push(g);
    return this;
  }
  build(): BufferGeometry {
    const g = mergeGeometries(this.geos, false);
    this.geos.forEach((x) => x.dispose());
    this.geos = [];
    if (!g) throw new Error("mergeGeometries returned null");
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/* ------------------------------------------------------------ the river */
// Behind the school at z about -6.4. On the right flank it swings forward under the
// ghat footbridge (x about 13.9), bends right in front of the ghat steps and recedes to
// the right edge. Its front bank stays behind the road (z < 2.6), so the bottom band of
// the banner is the cream path only.
const RIVER_PTS = [
  [-80, -6.8], [-52, -6.1], [-30, -6.8], [-14, -6.2], [-3, -6.7], [5, -6.3], [9.2, -5.7],
  [11.8, -4.4], [13.2, -2.6], [13.85, -0.6], [14.5, 0.7], [15.9, 1.3], [18.2, 1.3], [20.3, 0.5],
  [22.6, -0.9], [26, -2.2], [32, -3.1], [45, -3.5], [80, -3.8],
];
export const riverCurve = new CatmullRomCurve3(RIVER_PTS.map(([x, z]) => new Vector3(x, 0, z)), false, "centripetal");
const riverHalfW = (z: number) => 0.62 + 0.16 * smooth(-5.5, -3, z) + 0.05 * Math.sin(z * 0.7);
// cross: vertices across the ribbon; edge=true writes a grey "color" that falls from 1
// mid-channel toward the banks (the water shader darkens by it)
function ribbon(curve: Curve<Vector3>, N: number, halfW: (z: number, x: number) => number, y: number, cross = 3, edge = false) {
  const pos: number[] = [], idx: number[] = [], col: number[] = [];
  const p = new Vector3(), tg = new Vector3();
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    curve.getPointAt(u, p); curve.getTangentAt(u, tg);
    const nx = -tg.z, nz = tg.x, len = Math.hypot(nx, nz) || 1;
    const w = halfW(p.z, p.x);
    for (let j = 0; j < cross; j++) {
      const k = (j / (cross - 1)) * 2 - 1;
      pos.push(p.x + (nx / len) * w * k, y, p.z + (nz / len) * w * k);
      if (edge) { const v = 1 - 0.5 * k * k; col.push(v, v, v); }
    }
  }
  for (let i = 0; i < N; i++) for (let j = 0; j < cross - 1; j++) {
    const a = i * cross + j, b = (i + 1) * cross + j;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  if (edge) g.setAttribute("color", new BufferAttribute(new Float32Array(col), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  if (g.attributes.normal.getY(0) < 0) { g.index.array.reverse(); g.computeVertexNormals(); }
  return g;
}

/* ============================================================== STATIC */
export interface StaticWorld {
  casters: BufferGeometry;
  receivers: BufferGeometry;
  glowSpots: GlowSpot[];
  blobs: SoftBlob[];
  geomInfo: GeomInfo;
}

// Built in sections; pause() yields to the main thread between them (and throws the
// caller's abort sentinel when the build was cancelled), so no single task is long.
export async function buildStatic(pause: () => Promise<void> = async () => {}): Promise<StaticWorld> {
  const H = new Builder(), D = new Builder(), G = new Builder();
  const rnd = mulberry32(20260924);
  const PL = 0.18;
  const glowSpots: GlowSpot[] = []; // { x, y, z, size, kind, seed, amp, col }
  const blobs: SoftBlob[] = []; // static contact blobs: [x, z, sx, sz]
  const geomInfo: GeomInfo = { windows: [], door: null, boat: [0, 0, 0] };

  // 55% lit, 23% half, 22% dark, shuffled deterministically
  const winLevels: number[] = [];
  const NWIN = 19;
  for (let i = 0; i < NWIN; i++) winLevels.push(i < Math.round(NWIN * 0.55) ? 1 : i < Math.round(NWIN * 0.78) ? 0.5 : 0);
  const wr = mulberry32(77);
  for (let i = NWIN - 1; i > 0; i--) { const j = Math.floor(wr() * (i + 1)); [winLevels[i], winLevels[j]] = [winLevels[j], winLevels[i]]; }
  let winIdx = 0;
  const nextWin = () => winLevels[winIdx++ % NWIN];
  const windowAt = (x: number, y: number, z: number, w = 0.42, h = 0.48) => {
    const lvl = nextWin(), seed = wr();
    D.add(box(w + 0.12, h + 0.12, 0.04), P.winFrame, { pos: [x, y, z + 0.02] });
    D.add(box(w, h, 0.02), (px, py) => (py > y + h * 0.12 ? P.glassHi : P.glass), {
      pos: [x, y, z + 0.045], kind: KIND.GLASS, seed,
      glow: (px, py) => lvl * (0.8 + 0.3 * ((py - (y - h / 2)) / h)),
    });
    D.add(box(0.028, h, 0.02), P.frame, { pos: [x, y, z + 0.06] });
    D.add(box(w + 0.16, 0.05, 0.1), P.trim, { pos: [x, y - h / 2 - 0.08, z + 0.06] });
    if (lvl > 0) glowSpots.push({ x, y, z: z + 0.14, size: 0.62, kind: 0, seed, amp: 0.22 * lvl, col: [1, 0.66, 0.32] });
    geomInfo.windows.push({ x, y, z, w, h, lvl });
  };

  /* ---- the school on its plinth */
  H.add(rbox(10.5, PL, 2.3, 0.07, 2), P.plinth, { pos: [0, PL / 2, 0.05] });
  for (const s of [-1, 1]) {
    const cx = s * 3.125;
    H.add(rbox(3.75, 1.9, 1.7, 0.1, 2), P.wall, { pos: [cx, PL + 0.95, -0.1] });
    H.add(rbox(3.89, 0.1, 0.62, 0.04, 1), P.trim, { pos: [cx, PL + 0.99, 0.93] });
    D.add(box(3.89, 0.14, 0.05), P.wall2, { pos: [cx, PL + 1.1, 1.215] });
    for (const px of [-1.7, -0.85, 0, 0.85, 1.7]) H.add(cyl(0.052, 0.058, 0.95, 7), P.frame, { pos: [cx + px, PL + 0.47, 1.14] });
    for (const wx of [-1.23, -0.41, 0.41, 1.23]) { windowAt(cx + wx, PL + 0.5, 0.75); windowAt(cx + wx, PL + 1.5, 0.75); }
    const roof = prism(2.15, 0.52, 4.01, 0.1);
    roof.rotateY(Math.PI / 2);
    H.add(roof, P.roof, { pos: [cx, PL + 1.9, -0.1] });
    H.add(rbox(4.05, 0.08, 2.0, 0.03, 1), P.roofD, { pos: [cx, PL + 1.92, -0.1] });
    D.add(rbox(3.45, 0.3, 0.3, 0.13, 1), "#7fc08b", { pos: [cx, 0.15, 1.44] }); // hedge
  }
  // central entrance block
  H.add(rbox(2.5, 2.25, 2.1, 0.1, 2), P.wall2, { pos: [0, PL + 1.125, 0.05] });
  D.add(box(2.56, 0.1, 2.16), P.trim, { pos: [0, PL + 1.1, 0.05] });
  H.add(prism(2.9, 0.78, 2.4, 0.12), P.roof, { pos: [0, PL + 2.25, 0.05] });
  H.add(rbox(3.0, 0.08, 2.48, 0.03, 1), P.roofD, { pos: [0, PL + 2.27, 0.05] });
  // gable oculus
  D.add(new TorusGeometry(0.13, 0.03, 5, 14), P.winFrame, { pos: [0, PL + 2.52, 1.3] });
  D.add(cyl(0.12, 0.12, 0.02, 14), P.glass, { pos: [0, PL + 2.52, 1.29], rot: [Math.PI / 2, 0, 0], glow: 0.7, seed: 0.13, kind: KIND.GLASS });
  glowSpots.push({ x: 0, y: PL + 2.52, z: 1.4, size: 0.45, kind: 0, seed: 0.13, amp: 0.2, col: [1, 0.75, 0.42] });
  // door (its own kind: stays teal under the porch light), frame, awning, steps, pillars
  D.add(arch(0.8, 1.12, 0.05), P.frame, { pos: [0, PL, 1.08] });
  D.add(arch(0.62, 1.0, 0.05), P.door, { pos: [0, PL, 1.1], kind: KIND.DOOR });
  D.add(box(0.02, 0.62, 0.02), P.roofD, { pos: [0, PL + 0.5, 1.17], kind: KIND.DOOR });
  D.add(sph(0.022, 6, 4), "#f2c14e", { pos: [0.09, PL + 0.48, 1.17] });
  D.add(sph(0.022, 6, 4), "#f2c14e", { pos: [-0.09, PL + 0.48, 1.17] });
  geomInfo.door = { x0: -0.4, x1: 0.4, y0: PL, y1: PL + 1.12, z: 1.1 };
  H.add(rbox(1.34, 0.08, 0.46, 0.035, 1), P.orange, { pos: [0, PL + 1.2, 1.3] });
  D.add(rbox(1.2, 0.12, 0.3, 0.04, 1), P.step, { pos: [0, 0.06, 1.34] });
  for (const s of [-1, 1]) H.add(cyl(0.045, 0.05, 1.16, 7), P.frame, { pos: [s * 0.56, 0.12 + 0.58, 1.42] });
  // glyph-free signboard: a carved border panel with a lotus medallion, no lettering
  {
    const sy = PL + 1.6, sz = 1.11;
    D.add(rbox(1.36, 0.42, 0.04, 0.05, 1), P.orange, { pos: [0, sy, sz] });
    D.add(box(1.26, 0.33, 0.05), "#fff3e2", { pos: [0, sy, sz + 0.01] });
    for (const yy of [-0.128, 0.128]) D.add(box(1.14, 0.02, 0.02), P.roofD, { pos: [0, sy + yy, sz + 0.042] });
    for (const xx of [-0.56, 0.56]) D.add(box(0.02, 0.276, 0.02), P.roofD, { pos: [xx, sy, sz + 0.042] });
    const by = sy - 0.075;
    for (const [a, dz, c] of [[-1.05, 0, "#f7b5c4"], [1.05, 0, "#f7b5c4"], [-0.52, 0.006, "#f39bb1"], [0.52, 0.006, "#f39bb1"], [0, 0.012, "#ee7f9c"]] satisfies Array<[number, number, string]>) {
      D.add(sph(0.05, 8, 6), c, { pos: [Math.sin(a) * 0.058, by + Math.cos(a) * 0.058, sz + 0.05 + dz], rot: [0, 0, -a], scale: [0.62, 1.4, 0.35] });
    }
    D.add(rbox(0.34, 0.034, 0.02, 0.012, 1), P.roofD, { pos: [0, by - 0.005, sz + 0.058] });
    for (const xx of [-0.36, 0.36]) D.add(new OctahedronGeometry(0.036, 0), P.orange, { pos: [xx, sy - 0.01, sz + 0.05], scale: [1, 1, 0.4] });
  }
  // clock tower (cap top 3.72); the clock shows the school's local time via uClock
  H.add(rbox(0.82, 1.3, 0.82, 0.07, 2), P.wall2, { pos: [0, 2.98, -0.35] });
  H.add(rbox(0.98, 0.12, 0.98, 0.04, 1), P.roofD, { pos: [0, 3.66, -0.35] });
  D.add(box(0.9, 0.06, 0.9), P.trim, { pos: [0, 3.2, -0.35] });
  D.add(cyl(0.2, 0.2, 0.03, 18), P.frame, { pos: [0, 3.43, 0.06], rot: [Math.PI / 2, 0, 0] });
  D.add(new TorusGeometry(0.2, 0.028, 5, 18), P.roofD, { pos: [0, 3.43, 0.075] });
  for (let i = 0; i < 12; i += 3) { const a = (i / 12) * TAU; D.add(box(0.018, 0.035, 0.01), P.roofD, { pos: [Math.sin(a) * 0.155, 3.43 + Math.cos(a) * 0.155, 0.082], rot: [0, 0, -a] }); }
  D.add(box(0.026, 0.1, 0.012), P.navy, { pos: [0, 3.43 + 0.05, 0.088], kind: KIND.HOUR });
  D.add(box(0.018, 0.145, 0.012), P.navy, { pos: [0, 3.43 + 0.07, 0.096], kind: KIND.MINUTE });
  D.add(cyl(0.02, 0.02, 0.02, 8), P.navy, { pos: [0, 3.43, 0.1], rot: [Math.PI / 2, 0, 0] });
  // flagpole on the tower: the finial (top 4.93) is the highest point in the scene
  D.add(cyl(0.06, 0.08, 0.06, 8), P.roofD, { pos: [0, 3.75, -0.35] });
  H.add(cyl(0.04, 0.04, 1.16, 8), "#eef1f6", { pos: [0, 3.72 + 0.58, -0.35], kind: KIND.POLE });
  D.add(sph(0.05, 8, 6), "#f2c14e", { pos: [0, 4.88, -0.35], kind: KIND.POLE });
  await pause();

  /* ---- left flank: gulmohar on its chabutra, swing (a figure), bench, village, lamps */
  D.add(cyl(0.72, 0.78, 0.22, 18), P.court, { pos: [-7.2, 0.11, 1.0] });
  D.add(new TorusGeometry(0.72, 0.045, 5, 22), P.trim, { pos: [-7.2, 0.225, 1.0], rot: [Math.PI / 2, 0, 0] });
  for (const [bx, bz] of [[-11.9, 2.1]]) {
    D.add(rbox(0.8, 0.07, 0.26, 0.03, 1), P.orange, { pos: [bx, 0.26, bz] });
    D.add(box(0.07, 0.24, 0.22), P.roofD, { pos: [bx - 0.3, 0.12, bz] });
    D.add(box(0.07, 0.24, 0.22), P.roofD, { pos: [bx + 0.3, 0.12, bz] });
  }
  // village: three pastel houses, one flat-roofed with a black rooftop water tank
  {
    const houseWindow = (x: number, y: number, z: number, w: number, h: number) => {
      const lvl = nextWin(), seed = wr();
      D.add(box(w + 0.08, h + 0.08, 0.03), P.frame, { pos: [x, y, z - 0.005] });
      D.add(box(w, h, 0.04), P.glass, { pos: [x, y, z], kind: KIND.GLASS, seed, glow: (px, py) => lvl * (0.8 + 0.3 * ((py - (y - h / 2)) / h)) });
      if (lvl > 0) glowSpots.push({ x, y, z: z + 0.12, size: 0.6, kind: 0, seed, amp: 0.24 * lvl, col: [1, 0.7, 0.36] });
    };
    { const hx = -14.6, hz = -2.0, s = 1.0;
      H.add(rbox(1.5, 1.05, 1.15, 0.07, 1), "#ffe0c8", { pos: [hx, 0.525, hz] });
      H.add(rbox(1.62, 0.12, 1.27, 0.04, 1), "#f6c4a2", { pos: [hx, 1.1, hz] });
      H.add(cyl(0.21, 0.21, 0.32, 12), "#2b2d34", { pos: [hx + 0.38, 1.32, hz - 0.15] });
      D.add(cyl(0.12, 0.2, 0.05, 12), "#3a3d46", { pos: [hx + 0.38, 1.5, hz - 0.15] });
      D.add(box(0.3, 0.52, 0.04), P.door, { pos: [hx - 0.4, 0.26, hz + 0.585] });
      houseWindow(hx + 0.3, 0.6, hz + 0.585, 0.34, 0.3);
      blobs.push([hx, hz + 0.2, 2.2 * s, 1.6 * s]); }
    for (const [hx, hz, s, wall, roof] of [[-17.4, -3.1, 0.92, "#f1e9ff", "#e8917a"], [-20.4, -2.0, 1.04, "#fff3d6", P.roof]] satisfies Array<[number, number, number, string, string]>) {
      H.add(rbox(1.5 * s, 1.0 * s, 1.15 * s, 0.08, 1), wall, { pos: [hx, 0.5 * s, hz] });
      const r = prism(1.4 * s, 0.55 * s, 1.75 * s, 0.08);
      r.rotateY(Math.PI / 2);
      H.add(r, roof, { pos: [hx, 1.0 * s, hz] });
      D.add(box(0.3 * s, 0.5 * s, 0.04), P.door, { pos: [hx - 0.35 * s, 0.25 * s, hz + 0.585 * s] });
      houseWindow(hx + 0.3 * s, 0.55 * s, hz + 0.585 * s, 0.32 * s, 0.28 * s);
      blobs.push([hx, hz + 0.2, 2.2 * s, 1.6 * s]);
    }
  }
  const lamp = (lx: number, lz: number, h = 1.2) => {
    D.add(cyl(0.03, 0.04, h, 6), "#6f7494", { pos: [lx, h / 2, lz] });
    D.add(sph(0.085, 8, 6), "#fff3d2", { pos: [lx, h + 0.05, lz], kind: KIND.LAMP });
    D.add(cyl(0.07, 0.05, 0.05, 6), "#6f7494", { pos: [lx, h + 0.14, lz] });
    glowSpots.push({ x: lx, y: h + 0.05, z: lz + 0.08, size: 0.85, kind: 1, seed: rnd(), amp: 0.55, col: [1, 0.78, 0.46] });
    glowSpots.push({ x: lx, y: 0.03, z: lz + 0.1, size: 2.3, kind: 2, seed: rnd(), amp: 0.2, col: [1, 0.72, 0.4] });
    blobs.push([lx, lz, 0.35, 0.3]);
  };
  lamp(-10.5, 2.72);
  lamp(-16.5, 2.72);
  await pause();

  /* ---- right flank: bus + stop, lane, footbridge, river, ghat + boat, fields */
  {
    const x = 8.6, z = 1.45, Y = "#f7c44f", YD = "#e8a53a", GL = "#9cc8d8", TY = "#3e4258";
    H.add(rbox(3.0, 0.98, 1.14, 0.26, 2), Y, { pos: [x, 0.74, z], kind: KIND.BUS });
    D.add(rbox(2.86, 0.1, 1.04, 0.05, 1), "#fbe3a2", { pos: [x, 1.24, z], kind: KIND.BUS });
    D.add(rbox(3.03, 0.12, 1.17, 0.05, 1), YD, { pos: [x, 0.38, z], kind: KIND.BUS });
    for (let i = 0; i < 5; i++) D.add(rbox(0.4, 0.32, 0.04, 0.06, 1), (px, py) => (py > 1.0 ? "#c9e5ee" : GL), { pos: [x - 1.12 + i * 0.47, 0.95, z + 0.57], kind: KIND.GLASS, seed: rnd() });
    D.add(box(0.05, 0.38, 0.92), GL, { pos: [x + 1.49, 0.95, z], kind: KIND.GLASS });
    D.add(box(2.9, 0.055, 0.03), P.tealU, { pos: [x, 0.7, z + 0.575] });
    for (const wx of [-0.95, 0.95]) {
      D.add(cyl(0.22, 0.22, 0.16, 12), TY, { pos: [x + wx, 0.23, z + 0.5], rot: [Math.PI / 2, 0, 0] });
      D.add(cyl(0.1, 0.1, 0.17, 8), "#d9dde6", { pos: [x + wx, 0.23, z + 0.51], rot: [Math.PI / 2, 0, 0] });
    }
    D.add(sph(0.065, 8, 6), "#fff4d4", { pos: [x + 1.49, 0.52, z + 0.4] });
    D.add(box(0.1, 0.06, 1.2), "#cfd3dc", { pos: [x + 1.53, 0.3, z] });
    blobs.push([x, z, 3.4, 1.5]);
    // small teal bus-stop sign (glyph-free)
    D.add(cyl(0.025, 0.03, 1.05, 6), "#6f7494", { pos: [10.45, 0.525, 2.55] });
    D.add(rbox(0.36, 0.28, 0.04, 0.05, 1), P.roofD, { pos: [10.45, 1.0, 2.57] });
    D.add(box(0.24, 0.05, 0.02), P.white, { pos: [10.45, 1.02, 2.6] });
  }
  // white-parapet arched footbridge carrying the ghat lane over the river (x about 13.9)
  const BR = { x0: 12.35, x1: 15.45, xm: 13.9, top: 0.42, ah: 0.3, aw: 1.9, z: -0.6, d: 0.9 };
  {
    const { x0, x1, xm, top, ah, aw } = BR;
    const deckY = (x: number) => 0.04 + (top - 0.04) * Math.cos(((x - xm) / (x1 - xm)) * (Math.PI / 2)) ** 2;
    const s = new Shape();
    s.moveTo(x0, 0);
    for (let i = 0; i <= 18; i++) { const xx = lerp(x0, x1, i / 18); s.lineTo(xx, deckY(xx)); }
    s.lineTo(x1, 0);
    s.lineTo(xm + aw / 2, 0);
    for (let i = 0; i <= 12; i++) { const a = (i / 12) * Math.PI; s.lineTo(xm + (aw / 2) * Math.cos(a), ah * Math.sin(a)); }
    s.lineTo(x0, 0);
    const bg = new ExtrudeGeometry(s, { depth: BR.d, bevelEnabled: false, curveSegments: 1 });
    bg.translate(0, 0, BR.z - BR.d / 2);
    H.add(bg, "#f3eee6", { kind: KIND.CLAY });
    for (const pz of [BR.z - BR.d / 2, BR.z + BR.d / 2 - 0.08]) {
      const ps = new Shape();
      ps.moveTo(x0 + 0.1, deckY(x0 + 0.1));
      for (let i = 0; i <= 18; i++) { const xx = lerp(x0 + 0.1, x1 - 0.1, i / 18); ps.lineTo(xx, deckY(xx) + 0.15); }
      for (let i = 18; i >= 0; i--) { const xx = lerp(x0 + 0.1, x1 - 0.1, i / 18); ps.lineTo(xx, deckY(xx) - 0.01); }
      const pg = new ExtrudeGeometry(ps, { depth: 0.08, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 1, curveSegments: 1 });
      pg.translate(0, 0, pz);
      D.add(pg, "#ffffff", {});
    }
    for (const px of [x0 + 0.12, x1 - 0.12]) {
      D.add(rbox(0.13, 0.32, 0.13, 0.03, 1), "#ffffff", { pos: [px, 0.19, BR.z + BR.d / 2 + 0.02] });
      D.add(sph(0.045, 8, 6), "#fff3d2", { pos: [px, 0.4, BR.z + BR.d / 2 + 0.02], kind: KIND.LAMP });
      glowSpots.push({ x: px, y: 0.4, z: BR.z + BR.d / 2 + 0.1, size: 0.5, kind: 1, seed: rnd(), amp: 0.4, col: [1, 0.78, 0.46] });
    }
  }
  // ghat: a terrace with a small chhatri; four steps come DOWN toward the camera into the
  // river where it bends right in front of them
  {
    const tz0 = -1.0, tz1 = 0.25, gx = 17.2, stone = ["#e9dcc7", "#dccdb5"];
    H.add(rbox(2.9, 0.5, tz1 - tz0, 0.04, 1), "#e4d5bd", { pos: [gx, 0.25, (tz0 + tz1) / 2] });
    for (let k = 0; k < 4; k++) {
      const h = 0.4 - k * 0.1;
      H.add(box(2.6, h, 0.19), stone[k % 2], { pos: [gx, h / 2, tz1 + 0.095 + k * 0.19] });
    }
    const cx = 17.75, cz = -0.55;
    for (const [dx, dz] of [[-0.26, -0.26], [0.26, -0.26], [-0.26, 0.26], [0.26, 0.26]]) H.add(cyl(0.035, 0.035, 0.5, 6), "#fbf6ea", { pos: [cx + dx, 0.75, cz + dz] });
    H.add(rbox(0.7, 0.07, 0.7, 0.03, 1), "#f6e8d2", { pos: [cx, 1.03, cz] });
    H.add(sph(0.3, 12, 6, 0, TAU, 0, Math.PI / 2), "#f2b979", { pos: [cx, 1.06, cz] });
    D.add(sph(0.04, 6, 4), P.orange, { pos: [cx, 1.4, cz] });
    // the lane arrives from the bridge onto the terrace
    D.add(rbox(0.42, 0.04, 0.6, 0.02, 1), P.path, { pos: [15.62, 0.022, BR.z], kind: KIND.PATH });
    // moored boat, bobbing in the static shader (kind BOAT), lying along the current
    const bx = 16.95, bz = 1.45, yaw = 1.47;
    const hull = lathe([[0, -0.1], [0.14, -0.08], [0.2, 0.0], [0.21, 0.07], [0.0, 0.07]], 12);
    hull.scale(1.3, 1.3, 4.2);
    D.add(hull, (px, py) => (py > 0.1 ? P.orange : "#9a6a48"), { pos: [bx, 0.1, bz], rot: [0, yaw, 0], kind: KIND.BOAT });
    D.add(box(0.46, 0.03, 0.12), "#7a5236", { pos: [bx, 0.19, bz], rot: [0, yaw, 0], kind: KIND.BOAT });
    D.add(cyl(0.012, 0.012, 1.2, 4), "#6b4a33", { pos: [bx - 0.1, 0.22, bz - 0.12], rot: [0.25, 0.2, 1.2], kind: KIND.BOAT }); // oar
    geomInfo.boat = [bx, 0.1, bz];
    D.add(cyl(0.02, 0.02, 0.7, 5), "#8a6446", { pos: [18.7, 0.3, 0.98] }); // mooring post
  }
  await pause();

  /* ---- the ground, drawn after everything above it (early-z): flat paths first, then
     the hills near to far, then the lawn */
  G.add(rbox(11.4, 0.05, 1.9, 0.02, 1), P.court, { pos: [0, 0.025, 2.0], kind: KIND.PATH });
  G.add(rbox(1.1, 0.045, 0.6, 0.02, 1), P.court, { pos: [0, 0.03, 2.95], kind: KIND.PATH });
  G.add(rbox(140, 0.04, 1.05, 0.02, 1), P.path, { pos: [0, 0.02, 3.4], kind: KIND.PATH });
  // the ghat lane: leaves the road after the bus stop and curves back onto the bridge
  {
    const lane = new CatmullRomCurve3([[11.35, 3.05], [11.55, 1.7], [11.85, 0.2], [12.35, -0.55], [12.7, -0.6]].map(([x, z]) => new Vector3(x, 0, z)), false, "centripetal");
    G.add(ribbon(lane, 24, () => 0.3, 0.022, 2), P.path, { kind: KIND.PATH });
  }
  G.add(ribbon(riverCurve, 260, (z) => riverHalfW(z) + 0.2, 0.012, 2), P.bank, { kind: KIND.PATH });
  G.add(ribbon(riverCurve, 260, riverHalfW, 0.03, 5, true), null, { kind: KIND.WATER });
  // mustard field patches with row stripes, behind and beside the receding river
  for (const [fx, fz, fw, fd, c0, c1] of [[21.2, -1.7, 3.4, 1.2, "#f1d04c", "#e3bf3a"], [24.8, 0.35, 3.2, 1.3, "#e8cf5a", "#d8b93e"], [19.3, -3.0, 2.4, 1.0, "#b9d67a", "#a7c86a"]] satisfies Array<[number, number, number, number, string, string]>) {
    G.add(rbox(fw, 0.06, fd, 0.03, 1), (px) => (Math.floor((px - fx) * 3.2) % 2 === 0 ? c0 : c1), { pos: [fx, 0.03, fz], kind: KIND.FIELD });
  }
  // backdrop hills: three rows of clay mounds, fogged into the sky
  {
    const rows = [
      { z: -17, xs: 7.5, sx: [5.5, 8.5], sy: [1.4, 2.4], sz: 3.5, cols: ["#afdca2", "#a6d7a0", "#b8dfa6"] },
      { z: -27, xs: 9, sx: [7.5, 11.5], sy: [2.8, 4.2], sz: 5, cols: ["#9fcfbf", "#a8d3c4", "#96c8bb"] },
      { z: -42, xs: 12, sx: [10.5, 15.5], sy: [6.4, 8.8], sz: 7, cols: ["#b3bfe2", "#bcc5e6", "#aab8de"] },
    ];
    for (const r of rows) for (let x = -64; x <= 64; x += r.xs) {
      const sx = lerp(r.sx[0], r.sx[1], rnd()), sy = lerp(r.sy[0], r.sy[1], rnd());
      G.add(r.z < -35 ? mound(10, 5) : mound(), r.cols[Math.floor(rnd() * r.cols.length)], {
        pos: [x + (rnd() - 0.5) * r.xs * 0.6, -0.05, r.z + (rnd() - 0.5) * 3], scale: [sx, sy, r.sz], kind: KIND.BACK,
      });
    }
  }
  // lawn: the near strip (z 20 to -4, no fog there) is one quad per row; the far part is
  // an 18-column grid so the per-vertex atmosphere colour follows the sky across x
  {
    const pos: number[] = [], idx: number[] = [];
    const rowsN = 24, rowsF = 36, COLS = 18;
    for (let j = 0; j <= rowsN; j++) { const z = lerp(20, -4, j / rowsN); pos.push(-140, 0, z, 140, 0, z); }
    for (let j = 0; j < rowsN; j++) { const a = j * 2; idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
    const base = pos.length / 3;
    for (let j = 0; j <= rowsF; j++) { const z = lerp(-4, -95, (j / rowsF) ** 1.35); for (let c = 0; c <= COLS; c++) pos.push(lerp(-140, 140, c / COLS), 0, z); }
    for (let j = 0; j < rowsF; j++) for (let c = 0; c < COLS; c++) { const a = base + j * (COLS + 1) + c, b = a + COLS + 1; idx.push(a, a + 1, b, b, a + 1, b + 1); }
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
    g.setIndex(idx);
    const nrm = new Float32Array(pos.length);
    for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
    g.setAttribute("normal", new BufferAttribute(nrm, 3));
    G.add(g, "#ffffff", { kind: KIND.LAWN });
  }
  await pause();

  const casters = H.build();
  await pause();
  D.geos.push(...G.geos);
  G.geos = [];
  const receivers = D.build();
  return { casters, receivers, glowSpots, blobs, geomInfo };
}

/* ============================================================= FOLIAGE */
// Each species is one InstancedMesh; canopies are tinted by the instance colour, trunks
// are not (aSurf.y). Lists are sorted by |x| so resize() can trim `count` to what is on
// screen at the current aspect.
const G1 = "#93cc85", G2 = "#86c49a", G3 = "#a3d58f", GUL = "#ef6b4f", JAC = "#b7a4e0";
export const TREES: TreeRow[] = [
  // x, z, scale, colour, [sx, sy] canopy stretch
  [-7.2, 1.0, 1.32, GUL, 1.3, 0.86], [-6.35, -1.15, 1.05, G1],
  [-12.9, -2.7, 1.1, G3], [-18.6, 0.3, 1.2, JAC, 1.12, 0.96],
  [-23.2, -0.6, 1.08, G1], [-24.6, 0.9, 1.15, G2], [14.6, -3.0, 1.12, G1],
  [19.0, -2.0, 1.18, GUL, 1.25, 0.86], [26.2, -0.6, 1.15, G1], [28.4, 0.7, 1.0, G2],
  [-26.9, -0.3, 1.1, G3], [-29.2, 0.9, 1.0, G1], [30.6, -1.0, 1.05, G3], [-32.5, -0.8, 1.1, G2], [33.4, 0.5, 1.1, G1],
];
export const CYPRESS: CypressRow[] = [[-8.5, -1.7, 1.0], [-15.4, 2.2, 1.0], [-24.9, 2.2, 1.02], [24.4, 2.35, 0.98]];

export interface Foliage {
  /** Every species mesh; userData.xs holds [x, z, reach] per instance, sorted by |x|. */
  meshes: IMesh[];
  /** Contact blobs: [x, z, sx, sz]. */
  blobs: SoftBlob[];
  treeMesh: IMesh;
  pillMesh: IMesh;
}

export function buildFoliage(instMat: Material): Foliage {
  const rnd = mulberry32(4242);
  const tmpM = new Matrix4(), tmpQ = new Quaternion(), tmpV = new Vector3(), tmpS = new Vector3(), tmpC = new Color();
  const setInst = (mesh: IMesh, i: number, x: number, y: number, z: number, sx: number, sy = sx, sz = sx, ry = 0) => {
    tmpQ.setFromAxisAngle(tmpV.set(0, 1, 0), ry);
    tmpM.compose(tmpV.set(x, y, z), tmpQ, tmpS.set(sx, sy, sz));
    mesh.setMatrixAt(i, tmpM);
  };
  const blobs: SoftBlob[] = [];
  const meshes: IMesh[] = [];
  const sortAbs = (a: Row0, b: Row0) => Math.abs(a[0]) - Math.abs(b[0]);

  // round tree: canopy (tinted) + trunk (not)
  const treeGeo = new Builder().add(
    (() => { const c = blob(2, 5, 0.2, 0.78); c.scale(0.62, 0.56, 0.62); c.translate(0, 1.28, 0); return c; })(),
    "#ffffff", { kind: KIND.FOLIAGE, tint: 1 },
  ).add((() => { const t = cyl(0.055, 0.09, 1.0, 6); t.translate(0, 0.5, 0); return t; })(), "#b58868", { kind: KIND.FOLIAGE, tint: 0 }).build();
  const trees = TREES.slice().sort(sortAbs);
  const treeMesh: IMesh = new InstancedMesh(treeGeo, instMat, trees.length);
  trees.forEach(([x, z, s, c, sx = 1, sy = 1], i) => {
    setInst(treeMesh, i, x, 0, z, s * sx, s * sy, s * sx, rnd() * TAU);
    treeMesh.setColorAt(i, tmpC.set(c));
    blobs.push([x, z, 1.5 * s * sx, 1.2 * s * sx]);
  });
  treeMesh.userData.xs = trees.map((t) => [t[0], t[1], 0.9 * t[2] * (t[4] || 1)]);
  treeMesh.castShadow = true; treeMesh.receiveShadow = true;
  meshes.push(treeMesh);

  // cypress (pill tree) + short trunk
  const pillGeo = new Builder().add(lathe([[0, 0.14], [0.2, 0.2], [0.3, 0.5], [0.31, 0.95], [0.25, 1.45], [0.13, 1.85], [0, 2.02]], 8), "#ffffff", { kind: KIND.FOLIAGE, tint: 1 })
    .add((() => { const t = cyl(0.05, 0.07, 0.3, 5); t.translate(0, 0.15, 0); return t; })(), "#b58868", { kind: KIND.FOLIAGE }).build();
  const pills = CYPRESS.slice().sort(sortAbs);
  const pillMesh: IMesh = new InstancedMesh(pillGeo, instMat, pills.length);
  pills.forEach(([x, z, s], i) => { setInst(pillMesh, i, x, 0, z, s); pillMesh.setColorAt(i, tmpC.set("#6aae85")); blobs.push([x, z, 0.8 * s, 0.7 * s]); });
  pillMesh.userData.xs = pills.map((t) => [t[0], t[1], 0.35 * t[2]]);
  pillMesh.castShadow = true; pillMesh.receiveShadow = true;
  meshes.push(pillMesh);

  // far bank clumps (z -9 to -12): low-poly canopy + trunk, fogged. None behind the
  // village roofs or the ghat (the flanks were too dense); edge clumps sit fully in or out.
  const far: Array<[number, number, number, string]> = [];
  for (const cx of [-58, -46, -33, -20, -7, 3.5, 31, 41, 50, 60]) {
    const n = 2 + Math.floor(rnd() * 3);
    for (let k = 0; k < n; k++) far.push([cx + (k - n / 2) * 1.05 + (rnd() - 0.5) * 0.4, -9.2 - rnd() * 2.6, 0.72 + rnd() * 0.35, [G1, G2, G3, "#7fbf8c"][Math.floor(rnd() * 4)]]);
  }
  far.sort(sortAbs);
  const farGeo = new Builder().add((() => { const c = blob(1, 9, 0.2, 0.78); c.scale(0.62, 0.56, 0.62); c.translate(0, 1.28, 0); return c; })(), "#ffffff", { kind: KIND.FAR, tint: 1 })
    .add((() => { const t = cyl(0.06, 0.09, 0.9, 4); t.translate(0, 0.45, 0); return t; })(), "#c08a6a", { kind: KIND.FAR }).build();
  const farMesh: IMesh = new InstancedMesh(farGeo, instMat, far.length);
  far.forEach(([x, z, s, c], i) => { setInst(farMesh, i, x, 0, z, s, s, s, rnd() * TAU); farMesh.setColorAt(i, tmpC.set(c)); });
  farMesh.userData.xs = far.map((t) => [t[0], t[1], 0.6]);
  farMesh.receiveShadow = true;
  meshes.push(farMesh);

  // bushes: a few clusters, never a continuous row
  const bushGeo = new Builder().add((() => { const b = blob(1, 11, 0.22, 0.55); b.scale(0.36, 0.3, 0.32); b.translate(0, 0.14, 0); return b; })(), "#ffffff", { kind: KIND.FOLIAGE, tint: 1 }).build();
  const bushes: Array<[number, number, number]> = [];
  for (const [bx, bz, s] of [[-5.45, 1.6, 1.05], [-8.6, 1.95, 1.1], [-6.4, -1.3, 1.0], [6.5, -1.35, 1.0],
    [-15.8, -1.0, 1.0], [-19.3, -1.2, 1.1], [20.6, 2.2, 0.9], [-22.8, 1.6, 1.0], [26.6, 1.7, 1.0]]) bushes.push([bx, bz, s]);
  // six sparse verge clusters (low contrast, the calm bottom band)
  const VERGE = [[-12.8, 4.45], [-6.6, 4.55], [-3.3, 4.4], [4.4, 4.5], [10.9, 4.45], [18.4, 4.5]];
  for (const [vx, vz] of VERGE) bushes.push([vx, vz, 0.62], [vx + 0.34, vz + 0.1, 0.46]);
  bushes.sort(sortAbs);
  const bushMesh: IMesh = new InstancedMesh(bushGeo, instMat, bushes.length);
  bushes.forEach(([x, z, s], i) => { setInst(bushMesh, i, x, 0, z, s, s, s, rnd() * TAU); bushMesh.setColorAt(i, tmpC.set(["#86c48a", "#7dbd86", "#93cc8e"][i % 3])); });
  bushMesh.userData.xs = bushes.map((t) => [t[0], t[1], 0.4 * t[2]]);
  bushMesh.receiveShadow = true;
  meshes.push(bushMesh);

  // flowers: marigold hedges at the school front, verge clusters, bush flowers
  const flowerCols = ["#f7a24a", "#fbc54d", "#f58fa8", "#b8a4e6", "#ffffff", "#fa920e"];
  const flowers: Array<[number, number, number, string]> = [];
  for (const s of [-1, 1]) for (let k = 0; k < 14; k++) flowers.push([s * 3.125 + (k - 6.5) * 0.235 + (rnd() - 0.5) * 0.08, 0.3 + rnd() * 0.02, 1.47 + (rnd() - 0.5) * 0.14, rnd() < 0.7 ? "#f7a24a" : "#fbc54d"]);
  for (const [x, z, s] of bushes) {
    const n = 2 + Math.floor(rnd() * 3);
    for (let k = 0; k < n; k++) flowers.push([x + (rnd() - 0.5) * 0.5 * s, 0.2 * s + rnd() * 0.1 * s, z + (rnd() - 0.1) * 0.25 * s, flowerCols[Math.floor(rnd() * flowerCols.length)]]);
  }
  flowers.sort(sortAbs);
  const flowerGeo = new Builder().add(new OctahedronGeometry(0.055, 0), "#ffffff", { kind: KIND.FLOWER, tint: 1 }).build();
  const flowerMesh: IMesh = new InstancedMesh(flowerGeo, instMat, flowers.length);
  flowers.forEach(([x, y, z, c], i) => { setInst(flowerMesh, i, x, y, z, 1, 0.8, 1, rnd() * TAU); flowerMesh.setColorAt(i, tmpC.set(c)); });
  flowerMesh.userData.xs = flowers.map((t) => [t[0], t[2], 0.1]);
  flowerMesh.receiveShadow = true;
  meshes.push(flowerMesh);

  for (const m of meshes) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; m.frustumCulled = false; }
  return { meshes, blobs, treeMesh, pillMesh };
}

/* ============================================================== CLOUDS */
export interface CloudSpec {
  /** x at t = 0 (the scene drifts it by v per second and wraps it). */
  x0: number;
  /** NDC height the cloud is pinned to. */
  ny: number;
  /** Distance in front of the camera. */
  dist: number;
  s: number;
  v: number;
}

export interface Clouds {
  mesh: IMesh;
  CLOUDS: CloudSpec[];
  WRAP: number;
}

// Placed so that at every mode's composed still time each cloud is either whole or fully
// off screen at 343x112, 1072x176 and 1166x176 (no edge slivers), none covers the
// morning sun, the golden sun or the golden kite, and the phone gets two. The three even
// indices are the night wisps.
export function buildClouds(instMat: Material): Clouds {
  const parts = [[0, 0, 0, 1], [1.05, -0.18, 0.05, 0.72], [-1.0, -0.22, 0, 0.68], [0.45, 0.42, -0.1, 0.72], [-0.42, 0.3, 0.1, 0.6]];
  const b = new Builder();
  parts.forEach(([x, y, z, r], i) => { const g = blob(1, 30 + i, 0.12, 0.55); g.scale(r, r, r * 0.8); g.translate(x, y, z); b.add(g, "#ffffff", { kind: KIND.CLOUD, tint: 0 }); });
  const geo = b.build();
  const T = 12; // x targets are for t = 12 s (between the still times 7.2 and 16.2)
  const C = [
    { x: 4.0, ny: 0.29, dist: 88, s: 1.55, v: 0.12 }, { x: 27.0, ny: 0.28, dist: 92, s: 1.8, v: 0.11 },
    { x: -10.0, ny: 0.2, dist: 82, s: 1.35, v: 0.15 }, { x: -27.0, ny: 0.3, dist: 90, s: 1.85, v: 0.13 },
    { x: -34.0, ny: 0.12, dist: 84, s: 1.4, v: 0.14 }, { x: 34.5, ny: 0.1, dist: 84, s: 1.3, v: 0.16 },
  ];
  const CLOUDS: CloudSpec[] = C.map((c) => ({ x0: c.x - c.v * T, ny: c.ny, dist: c.dist, s: c.s, v: c.v }));
  const mesh: IMesh = new InstancedMesh(geo, instMat, CLOUDS.length);
  const c = new Color("#ffffff");
  for (let i = 0; i < CLOUDS.length; i++) mesh.setColorAt(i, c);
  mesh.frustumCulled = false;
  return { mesh, CLOUDS, WRAP: 62 };
}
