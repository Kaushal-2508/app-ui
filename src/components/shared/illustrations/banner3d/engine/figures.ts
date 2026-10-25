// People and moving props: ONE merged mesh, animated in the vertex shader.
//
// Figures: 0 teacher, 1 father, 2..6 children K1..K5, 7 ball, 8 swing, 9 telescope, 10 kite.
// Stylised clay forms: sleeves, forearms and mitten hands, ears and a nose bump, dot eyes
// and a soft blush, a range of Indian skin tones, and a hand-pressed "thumbprint" wobble
// baked into the normals. The cast director below decides who is on stage per time of
// day; walkers swap identity only at their next off-screen wrap, standers use a 0.6 s
// screen-door dissolve.
import { Color, Mesh, Vector3, Vector4, BoxGeometry, BufferGeometry, BufferAttribute, type Material } from "three";
import { Builder, P, TAU, cap, cyl, lathe, rbox, sph } from "./world";
import { FIG_COUNT } from "./materials";
import { halfWidthAt, yForNdc } from "./framing";
import type { FrameState, SceneTod } from "./types";

type V3 = [number, number, number];
/** A part's colour: a CSS string, or a function of the (placed) vertex position. */
type PartColor = string | ((x: number, y: number, z: number) => string);
/** Placement of one part (Euler XYZ rotation). */
interface Place { pos?: V3; rot?: V3; scale?: V3 }

export const F = { T: 0, P: 1, K1: 2, K2: 3, K3: 4, K4: 5, K5: 6, BALL: 7, SWING: 8, SCOPE: 9, KITE: 10 };
const HEIGHT: number[] = [1.16, 1.18, 0.83, 0.83, 0.83, 0.83, 0.83, 0.2, 1.4, 0.72, 0.5];
const WIDTH: number[] = [0.46, 0.42, 0.36, 0.36, 0.36, 0.36, 0.36, 0.2, 1.1, 0.4, 0.5];
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const fract = (x: number) => x - Math.floor(x);
const smooth = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const tone = (c: string, k: number) => "#" + new Color(c).multiplyScalar(k).getHexString();
const blushOf = (skin: string) => "#" + new Color(skin).lerp(new Color("#ff8a8a"), 0.3).getHexString();

// The road is flat now (the footbridge carries the ghat lane, not the road).
export const roadY = (_x?: number): number => 0.02;

// Indian skin tones, light wheat to deep brown (low saturation; the warm key adds the rest)
const SKIN = { light: "#e3bd9c", wheat: "#c99472", medium: "#a8745a", brown: "#865a42", deep: "#5e3e2f" };

interface KidLook { skin: string; shirt: string; bottom: string; tie: string; bag: string; girl?: boolean; ribbon?: string }

/* ---------------------------------------------------------------- geometry */
function buildGeometry(): BufferGeometry {
  const B = new Builder({ aFig: 1, aLimb: 1, aPivot: 3 });
  const part = (fig: number, geo: BufferGeometry, color: PartColor, o: Place = {}, limb = 0, pivot: V3 = [0, 0, 0]) => {
    const opts = { ...o, aFig: [fig], aLimb: [limb], aPivot: pivot };
    return B.add(geo, color, opts);
  };

  // a mitten hand: a flattened palm with a thumb bump toward the body's front
  function mitten(fig: number, x: number, y: number, z: number, skin: string, r: number, limb: number, pv: V3) {
    part(fig, sph(r, 7, 5), skin, { pos: [x, y, z], scale: [0.8, 1.2, 0.72] }, limb, pv);
    part(fig, sph(r * 0.45, 5, 3), skin, { pos: [x - Math.sign(x) * r * 0.35, y + r * 0.35, z + r * 0.62] }, limb, pv);
  }
  function faceParts(fig: number, skin: string, y: number, r: number, zf: number) {
    for (const s of [-1, 1]) {
      part(fig, sph(r * 0.24, 6, 4), skin, { pos: [s * r * 0.97, y - r * 0.05, -r * 0.05], scale: [0.55, 1, 0.8] }); // ears
      part(fig, sph(r * 0.14, 5, 3), "#221c2a", { pos: [s * r * 0.36, y + r * 0.02, zf] }); // eyes
      part(fig, sph(r * 0.17, 5, 3), blushOf(skin), { pos: [s * r * 0.6, y - r * 0.28, zf - r * 0.14], scale: [1, 0.6, 0.45] });
    }
    part(fig, sph(r * 0.16, 6, 4), tone(skin, 0.9), { pos: [0, y - r * 0.12, zf + r * 0.06], scale: [0.85, 0.75, 0.8] }); // nose
  }

  function kid(fig: number, o: KidLook) {
    const legC = o.girl ? "#f4f1ec" : o.skin;
    for (const s of [-1, 1]) {
      const limb = s < 0 ? 1 : 2, pv: V3 = [s * 0.055, 0.2, 0];
      part(fig, sph(0.05, 6, 4), P.shoe, { pos: [s * 0.055, 0.028, 0.02], scale: [0.9, 0.6, 1.3] }, limb, pv);
      part(fig, cyl(0.03, 0.032, 0.17, 6), legC, { pos: [s * 0.055, 0.12, 0] }, limb, pv);
    }
    part(fig, cap(0.12, 0.16, 3, 10), (x, y) => (y < 0.325 ? o.bottom : o.shirt), { pos: [0, 0.37, 0] });
    if (o.girl) part(fig, cyl(0.125, 0.168, 0.15, 10), o.bottom, { pos: [0, 0.25, 0] });
    part(fig, new BoxGeometry(0.036, 0.12, 0.02), o.tie, { pos: [0, 0.455, 0.113], rot: [-0.12, 0, 0] });
    for (const s of [-1, 1]) {
      const limb = s < 0 ? 3 : 4, pv: V3 = [s * 0.14, 0.5, 0];
      part(fig, cap(0.04, 0.04, 2, 7), o.shirt, { pos: [s * 0.145, 0.47, 0], rot: [0, 0, s * 0.2] }, limb, pv); // short sleeve
      part(fig, cap(0.029, 0.09, 2, 6), o.skin, { pos: [s * 0.158, 0.385, 0.004], rot: [0, 0, s * 0.1] }, limb, pv); // forearm
      mitten(fig, s * 0.163, 0.315, 0.008, o.skin, 0.036, limb, pv);
    }
    part(fig, sph(0.13, 11, 8), o.skin, { pos: [0, 0.69, 0] });
    part(fig, sph(0.138, 11, 5, 0, TAU, 0, Math.PI * 0.52), P.hair, { pos: [0, 0.697, -0.008], rot: [-0.38, 0, 0] });
    part(fig, sph(0.07, 8, 4), P.hair, { pos: [0.02, 0.79, 0.07], scale: [1.35, 0.45, 0.8], rot: [0, 0, -0.2] }); // fringe
    if (o.girl) for (const s of [-1, 1]) {
      part(fig, cap(0.034, 0.12, 2, 5), P.hair, { pos: [s * 0.112, 0.58, -0.06], rot: [0, 0, s * 0.12] });
      part(fig, sph(0.038, 6, 4), o.ribbon, { pos: [s * 0.12, 0.49, -0.06], scale: [1.25, 0.8, 1] });
    }
    faceParts(fig, o.skin, 0.695, 0.13, 0.121);
    part(fig, rbox(0.2, 0.23, 0.1, 0.04, 1), o.bag, { pos: [0, 0.42, -0.165] });
    part(fig, new BoxGeometry(0.206, 0.09, 0.112), tone(o.bag, 0.82), { pos: [0, 0.5, -0.163] });
    for (const s of [-1, 1]) part(fig, new BoxGeometry(0.026, 0.19, 0.02), o.bag, { pos: [s * 0.07, 0.47, 0.104] });
  }

  function teacher(fig: number, skin: string) {
    const saree = "#a896dc", sareeD = "#8b78c6", border = P.orange;
    part(fig, lathe([[0, 0], [0.2, 0], [0.215, 0.04], [0.19, 0.25], [0.15, 0.5], [0.135, 0.58], [0, 0.6]], 12), (x, y) => (y < 0.065 ? border : saree));
    part(fig, cap(0.13, 0.14, 3, 10), saree, { pos: [0, 0.72, 0] });
    // pallu: a sculpted drape, not a baton. In front a broad band in the deeper saree tone
    // runs from the waist on the raised-arm side up over the other shoulder, edged by a
    // thin orange border; behind it falls from that shoulder down the back.
    part(fig, cap(0.06, 0.3, 2, 8), sareeD, { pos: [-0.005, 0.73, 0.1], rot: [0.05, 0, 0.66], scale: [1.35, 1, 0.34] });
    part(fig, cap(0.013, 0.33, 2, 5), border, { pos: [0.032, 0.7, 0.118], rot: [0.05, 0, 0.66], scale: [1, 1, 0.5] });
    part(fig, cap(0.07, 0.3, 2, 8), sareeD, { pos: [-0.1, 0.66, -0.1], rot: [0.14, 0, -0.08], scale: [1.1, 1, 0.45] });
    part(fig, sph(0.07, 8, 4), border, { pos: [-0.11, 0.48, -0.118], scale: [1.1, 0.28, 0.5] });
    part(fig, sph(0.12, 12, 9), skin, { pos: [0, 1.03, 0] });
    part(fig, sph(0.127, 12, 5, 0, TAU, 0, Math.PI * 0.52), P.hair, { pos: [0, 1.036, -0.008], rot: [-0.32, 0, 0] });
    part(fig, sph(0.068, 8, 6), P.hair, { pos: [0, 1.05, -0.12] });
    part(fig, sph(0.011, 6, 4), "#d6334a", { pos: [0, 1.072, 0.118] });
    faceParts(fig, skin, 1.035, 0.12, 0.112);
    // left arm holds the teal book; right arm waves / points (limb 5)
    const lp: V3 = [-0.155, 0.84, 0];
    part(fig, cap(0.045, 0.04, 2, 7), sareeD, { pos: [-0.158, 0.8, 0], rot: [0, 0, -0.18] }, 3, lp);
    part(fig, cap(0.032, 0.15, 2, 6), skin, { pos: [-0.166, 0.69, 0.012], rot: [0, 0, -0.14] }, 3, lp);
    mitten(fig, -0.172, 0.595, 0.02, skin, 0.038, 3, lp);
    part(fig, rbox(0.13, 0.17, 0.045, 0.015, 1), "#249ca2", { pos: [-0.17, 0.62, 0.08], rot: [0.1, 0.3, 0] }, 3, lp);
    const rp: V3 = [0.155, 0.86, 0.01];
    part(fig, cap(0.045, 0.04, 2, 7), sareeD, { pos: [0.158, 0.815, 0.01] }, 5, rp);
    part(fig, cap(0.032, 0.15, 2, 6), skin, { pos: [0.16, 0.705, 0.01] }, 5, rp);
    mitten(fig, 0.162, 0.605, 0.012, skin, 0.038, 5, rp);
  }

  function father(fig: number, skin: string) {
    const kurta = "#45b0ab";
    for (const s of [-1, 1]) {
      const limb = s < 0 ? 1 : 2, pv: V3 = [s * 0.06, 0.34, 0];
      part(fig, sph(0.05, 8, 6), P.shoe, { pos: [s * 0.06, 0.028, 0.02], scale: [0.9, 0.6, 1.3] }, limb, pv);
      part(fig, cyl(0.045, 0.05, 0.34, 8), "#f3ece0", { pos: [s * 0.06, 0.19, 0] }, limb, pv);
    }
    part(fig, lathe([[0, 0.3], [0.175, 0.3], [0.165, 0.46], [0.14, 0.7], [0.125, 0.86], [0, 0.91]], 12), kurta);
    part(fig, new BoxGeometry(0.02, 0.2, 0.02), "#2d8f8a", { pos: [0, 0.8, 0.13] });
    part(fig, sph(0.12, 12, 9), skin, { pos: [0, 1.04, 0] });
    part(fig, sph(0.127, 12, 5, 0, TAU, 0, Math.PI * 0.5), P.hair, { pos: [0, 1.05, -0.008], rot: [-0.3, 0, 0] });
    part(fig, cap(0.02, 0.1, 2, 6), P.hair, { pos: [0, 0.99, 0.112], rot: [0, 0, Math.PI / 2] }); // moustache
    faceParts(fig, skin, 1.045, 0.12, 0.113);
    for (const s of [-1, 1]) {
      const limb = s < 0 ? 3 : 4, pv: V3 = [s * 0.16, 0.85, 0];
      part(fig, cap(0.04, 0.2, 3, 7), kurta, { pos: [s * 0.165, 0.73, 0.0], rot: [0, 0, s * 0.1] }, limb, pv);
      mitten(fig, s * 0.176, 0.575, 0.01, skin, 0.04, limb, pv);
    }
  }

  const KIDS: Array<[number, KidLook]> = [
    [F.K1, { skin: SKIN.light, shirt: P.white, bottom: P.navy, tie: P.navy, bag: "#f7a13a" }],
    [F.K2, { skin: SKIN.medium, shirt: P.white, bottom: P.tealU, tie: P.tealU, bag: "#9b89d6", girl: true, ribbon: "#f26e4f" }],
    [F.K3, { skin: SKIN.deep, shirt: P.white, bottom: P.navy, tie: P.navy, bag: "#3db0b2" }],
    [F.K4, { skin: SKIN.wheat, shirt: P.white, bottom: P.navy, tie: P.navy, bag: "#f06f5b", girl: true, ribbon: "#ffffff" }],
    [F.K5, { skin: SKIN.brown, shirt: P.white, bottom: P.tealU, tie: P.tealU, bag: "#f7a13a" }],
  ];
  teacher(F.T, SKIN.wheat);
  father(F.P, SKIN.brown);
  for (const [f, o] of KIDS) kid(f, o);

  // beach ball, six gores
  const gores = [P.orange, "#ffffff", "#3fb3b5", "#ffffff", "#f5c34e", "#ffffff"];
  part(F.BALL, sph(0.1, 12, 8), (x, y, z) => gores[Math.floor((((Math.atan2(z, x) / TAU) + 1) % 1) * 6) % 6], { pos: [0, 0, 0] });

  // teal A-frame swing: the bar runs front to back, the seat swings left to right
  {
    const bar = 1.35, legX = 0.5, zs = 0.42, lean = Math.atan2(legX, bar);
    for (const z of [-zs, zs]) for (const s of [-1, 1]) part(F.SWING, cyl(0.03, 0.035, Math.hypot(legX, bar), 6), "#2d9da2", { pos: [s * legX / 2, bar / 2, z], rot: [0, 0, s * lean] });
    part(F.SWING, cyl(0.035, 0.035, zs * 2 + 0.1, 6), "#2d9da2", { pos: [0, bar, 0], rot: [Math.PI / 2, 0, 0] });
    const pv: V3 = [0, bar, 0];
    for (const z of [-0.14, 0.14]) part(F.SWING, cyl(0.008, 0.008, bar - 0.4, 3), "#8c8aa0", { pos: [0, (bar + 0.4) / 2, z] }, 6, pv);
    part(F.SWING, rbox(0.2, 0.04, 0.36, 0.015, 1), P.orange, { pos: [0, 0.38, 0] }, 6, pv);
  }
  // telescope on a tripod
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + 0.4;
    part(F.SCOPE, cyl(0.012, 0.015, 0.52, 5), "#4a4d66", { pos: [Math.cos(a) * 0.1, 0.24, Math.sin(a) * 0.1], rot: [Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35] });
  }
  part(F.SCOPE, cyl(0.04, 0.055, 0.5, 12), (x, y) => (Math.abs(y - 0.62) < 0.03 ? "#2d9da2" : "#f4f1ec"), { pos: [0.06, 0.6, 0], rot: [0, 0, -0.95] });
  // kite (patang): two-sided diamond with a tail
  {
    const T: V3 = [0, 0.3, 0], R: V3 = [0.23, 0.04, 0], Bm: V3 = [0, -0.2, 0], L: V3 = [-0.23, 0.04, 0], C: V3 = [0, 0.04, 0.02];
    const tris: Array<[V3, V3, V3, string]> = [[T, L, C, P.orange], [T, C, R, "#ffffff"], [L, Bm, C, "#ffffff"], [C, Bm, R, P.orange], [[0, -0.2, 0], [-0.06, -0.3, 0], [0.06, -0.3, 0], "#3fb3b5"]];
    for (const [a, b, c, col] of tris) for (const flip of [false, true]) {
      const g = new BufferGeometry();
      g.setAttribute("position", new BufferAttribute(new Float32Array(flip ? [...a, ...c, ...b] : [...a, ...b, ...c]), 3));
      g.computeVertexNormals();
      part(F.KITE, g, col);
    }
  }
  const g = B.build();
  // thumbprint: a smooth low-frequency wobble in the people's normals (a function of the
  // position, so neighbouring faces agree and nothing looks faceted)
  const pA = g.attributes.position.array, nA = g.attributes.normal.array, fA = g.attributes.aFig.array;
  for (let i = 0; i < fA.length; i++) {
    if (fA[i] > 6.5) continue;
    const x = pA[i * 3], y = pA[i * 3 + 1], z = pA[i * 3 + 2];
    const nx = nA[i * 3] + 0.2 * Math.sin(x * 37 + y * 23.1) * Math.cos(z * 31 + y * 11);
    const ny = nA[i * 3 + 1] + 0.2 * Math.sin(y * 41 + z * 17.3) * Math.cos(x * 29 + 1.3);
    const nz = nA[i * 3 + 2] + 0.2 * Math.sin(z * 39 + x * 19.7) * Math.cos(y * 27 + 0.7);
    const l = Math.hypot(nx, ny, nz) || 1;
    nA[i * 3] = nx / l; nA[i * 3 + 1] = ny / l; nA[i * 3 + 2] = nz / l;
  }
  g.boundingSphere.radius = 1e4;
  return g;
}

/* ------------------------------------------------------------------ casts */
interface Walker { f: number; dx: number; lane: number }
interface WalkGroup { dir: number; speed: number; xStill: number; members: Walker[] }
type StandAct = "greet" | "idle" | "farewell" | "point" | "look";
interface Stander { f: number; x: number; z: number; ry: number; act: StandAct }
export interface Cast {
  groups: WalkGroup[];
  standers: Stander[];
  swing?: { rider: number; amp: number };
  ball?: { a: number; b: number; xa: number; xb: number; z: number };
  kite?: { holder: number; x: number; z: number; kx: number; ny: number };
  scope?: { x: number; z: number };
}

// Walker groups move as a unit and wrap outside the visible width (half-width + 1.4 +
// group extent), so a family never splits across the edges.
const CASTS: Record<SceneTod, Cast> = {
  morning: {
    groups: [{ dir: 1, speed: 0.48, xStill: -2.35, members: [
      { f: F.K1, dx: 0.62, lane: 3.28 }, { f: F.P, dx: 0.08, lane: 3.36 }, { f: F.K2, dx: -0.34, lane: 3.62 }, { f: F.K3, dx: -0.96, lane: 3.52 }] }],
    standers: [{ f: F.T, x: 0, z: 1.62, ry: 0, act: "greet" }],
    swing: { rider: -1, amp: 0.052 },
  },
  midday: {
    groups: [{ dir: -1, speed: 0.45, xStill: 3.05, members: [{ f: F.K3, dx: 0, lane: 3.4 }, { f: F.K5, dx: 0.56, lane: 3.62 }] }],
    standers: [{ f: F.T, x: 0, z: 1.62, ry: 0, act: "idle" }],
    // recess catch, inside the phone frame: a lob one way, a bounce pass back
    ball: { a: F.K1, b: F.K2, xa: -3.3, xb: -2.0, z: 2.1 },
    swing: { rider: F.K4, amp: 0.28 },
  },
  golden: {
    groups: [{ dir: -1, speed: 0.46, xStill: -2.7, members: [
      { f: F.K1, dx: -0.62, lane: 3.3 }, { f: F.P, dx: -0.06, lane: 3.36 }, { f: F.K4, dx: 0.4, lane: 3.62 }, { f: F.K3, dx: 0.98, lane: 3.5 }] }],
    standers: [{ f: F.T, x: 0, z: 1.62, ry: 0, act: "farewell" }],
    // the kite flier stands in the open lawn gap between the school and the bus; the kite
    // flies almost straight above, so the string crosses only lawn, hills and sky
    kite: { holder: F.K5, x: 6.05, z: 2.4, kx: 6.0, ny: 0.26 },
    swing: { rider: -1, amp: 0.02 },
  },
  dusk: {
    groups: [{ dir: -1, speed: 0.42, xStill: -2.9, members: [{ f: F.P, dx: 0, lane: 3.36 }, { f: F.K2, dx: 0.44, lane: 3.6 }] }],
    standers: [{ f: F.T, x: 0, z: 1.62, ry: 0, act: "farewell" }],
    swing: { rider: -1, amp: 0.015 },
  },
  night: {
    groups: [],
    standers: [
      { f: F.T, x: 1.95, z: 2.05, ry: 0.55, act: "point" }, { f: F.K2, x: 2.62, z: 2.3, ry: 1.1, act: "look" },
      { f: F.K3, x: 3.35, z: 1.95, ry: -0.2, act: "look" },
    ],
    scope: { x: 2.95, z: 2.25 },
    swing: { rider: -1, amp: 0.0 },
  },
};
// Composed poses (section 2.6): morning, the teacher's greeting at full raise; midday, the
// ball aloft at the top of the lob with the swing mid-arc; golden and dusk, the farewell
// wave with walkers mid-stride; night, the telescope group. The live loop starts here.
export const STILL_T: Record<SceneTod, number> = { morning: 10.4, midday: 16.9, golden: 16.2, dusk: 7.2, night: 9.0 };
const SWING_POS: V3 = [-10.1, 0, 1.3];
const WALK_MARGIN = 1.4;

const NONE = 0, WALK = 1, STAND = 2, PROP = 3;

interface Role { kind: number; x: number; z: number; g: number }

// role key per figure in a cast: what it does and where (a change of key = dissolve)
function roleOf(c: Cast, f: number, out: Role): Role {
  out.kind = NONE; out.x = 0; out.z = 0; out.g = -1;
  for (let g = 0; g < c.groups.length; g++) { const ms = c.groups[g].members; for (let j = 0; j < ms.length; j++) if (ms[j].f === f) { out.kind = WALK; out.g = g; return out; } }
  for (let j = 0; j < c.standers.length; j++) { const s = c.standers[j]; if (s.f === f) { out.kind = STAND; out.x = s.x; out.z = s.z; return out; } }
  if (c.ball && (f === c.ball.a || f === c.ball.b || f === F.BALL)) { out.kind = PROP; out.x = 100 + f; return out; }
  if (c.kite && (f === c.kite.holder || f === F.KITE)) { out.kind = PROP; out.x = 200 + f; return out; }
  if (c.scope && f === F.SCOPE) { out.kind = PROP; out.x = 300; return out; }
  if (c.swing && c.swing.rider === f) { out.kind = PROP; out.x = 400; return out; }
  if (f === F.SWING) { out.kind = PROP; out.x = 500; return out; }
  return out;
}

/* ----------------------------------------------------------------- figures */
/** The per-figure rig uniforms handed to the "fig" clay program. */
export type FigUniforms = { uFigA: { value: Vector4[] }; uFigB: { value: Vector4[] }; uFigC: { value: Vector4[] } };
/** Hand end and kite end of the kite string, world space; `on` while the kite is shown. */
export interface KiteState { hx: number; hy: number; hz: number; tx: number; ty: number; tz: number; on: boolean }
/** Set by the scene: the solved frame (walker wrap widths, kite height) and the still time. */
export interface FiguresEnv { frame: FrameState | null; stillT: number }

export function createFigures<M extends Material>(makeMaterial: (figU: FigUniforms) => M) {
  const geometry = buildGeometry();
  const A: Vector4[] = [], Bv: Vector4[] = [], C: Vector4[] = [];
  for (let i = 0; i < FIG_COUNT; i++) { A.push(new Vector4(0, -50, 0, 0)); Bv.push(new Vector4()); C.push(new Vector4(1, 0, 0, 0)); }
  const figU: FigUniforms = { uFigA: { value: A }, uFigB: { value: Bv }, uFigC: { value: C } };
  const material = makeMaterial(figU);
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  mesh.castShadow = false;

  // runtime state, all preallocated
  const vis = new Float32Array(FIG_COUNT); // current visibility 0..1
  const want = new Float32Array(FIG_COUNT); // target visibility
  const hold = new Uint8Array(FIG_COUNT); // 1: fading out of its old role before taking the new one
  const kindNow = new Uint8Array(FIG_COUNT);
  const figXZ = new Float32Array(FIG_COUNT * 3); // x, z, blob type (0 none, 1 person, 2 ball, 3 prop, 4 rider)
  let cast: Cast = CASTS.morning, oldCast: Cast | null = null;
  const groupShift = new Float32Array(4), groupLive = new Uint8Array(4);
  const oldShift = new Float32Array(4), oldWrap0 = new Float32Array(4), oldLive = new Uint8Array(4);
  const kiteState: KiteState = { hx: 0, hy: 0, hz: 0, tx: 0, ty: 0, tz: 0, on: false };
  const env: FiguresEnv = { frame: null, stillT: 0 };
  const rA: Role = { kind: 0, x: 0, z: 0, g: -1 }, rB: Role = { kind: 0, x: 0, z: 0, g: -1 };
  const V = new Vector3();

  function spanL(g: WalkGroup) {
    let ext = 0, lane = 3.4;
    for (let j = 0; j < g.members.length; j++) { const m = g.members[j]; ext = Math.max(ext, Math.abs(m.dx)); lane = Math.max(lane, m.lane); }
    return halfWidthAt(env.frame, lane) + WALK_MARGIN + ext;
  }
  const groupU = (g: WalkGroup, shift: number, t: number) => g.xStill + g.dir * g.speed * (t - env.stillT) + shift;
  function wrapCount(g: WalkGroup, shift: number, t: number) { const L = spanL(g); return Math.floor((groupU(g, shift, t) + L) / (2 * L)); }
  function groupX(g: WalkGroup, shift: number, t: number) { const L = spanL(g); const u = groupU(g, shift, t); return u - Math.floor((u + L) / (2 * L)) * 2 * L; }
  function walkingOld(f: number) {
    if (!oldCast) return false;
    for (let g = 0; g < oldCast.groups.length; g++) {
      if (!oldLive[g]) continue;
      const ms = oldCast.groups[g].members;
      for (let j = 0; j < ms.length; j++) if (ms[j].f === f) return true;
    }
    return false;
  }
  const busy = (f: number) => hold[f] === 1 || walkingOld(f);

  function setCast(tod: string, immediate: boolean, t: number) {
    const next = (CASTS as Record<string, Cast | undefined>)[tod] || CASTS.midday;
    if (immediate) {
      cast = next; oldCast = null;
      for (let g = 0; g < 4; g++) { groupShift[g] = 0; groupLive[g] = 1; oldLive[g] = 0; }
      for (let i = 0; i < FIG_COUNT; i++) { roleOf(cast, i, rB); kindNow[i] = rB.kind; hold[i] = 0; want[i] = vis[i] = rB.kind ? 1 : 0; }
      return;
    }
    if (next === cast) return;
    // live walker groups of the outgoing cast keep crossing until their next wrap
    oldCast = cast;
    for (let g = 0; g < 4; g++) oldLive[g] = 0;
    for (let g = 0; g < oldCast.groups.length; g++) {
      oldShift[g] = groupShift[g];
      oldLive[g] = groupLive[g];
      oldWrap0[g] = wrapCount(oldCast.groups[g], oldShift[g], t);
    }
    cast = next;
    for (let g = 0; g < 4; g++) groupLive[g] = 0;
    for (let i = 0; i < FIG_COUNT; i++) {
      roleOf(oldCast, i, rA); roleOf(cast, i, rB);
      kindNow[i] = rB.kind;
      if (walkingOld(i)) { hold[i] = 0; want[i] = 1; continue; }
      const same = rA.kind === rB.kind && rA.kind !== WALK && rA.x === rB.x && rA.z === rB.z;
      if (same && vis[i] > 0) { hold[i] = 0; want[i] = 1; }
      else if (vis[i] > 0.001) { hold[i] = 1; want[i] = 0; }
      else { hold[i] = 0; want[i] = rB.kind && rB.kind !== WALK ? 1 : 0; }
    }
  }

  function setFig(i: number, x: number, y: number, z: number, yaw: number, blobType: number) { A[i].set(x, y, z, yaw); figXZ[i * 3] = x; figXZ[i * 3 + 1] = z; figXZ[i * 3 + 2] = blobType; }

  function walker(m: Walker, g: WalkGroup, gx: number, t: number, j: number) {
    const i = m.f, adult = i === F.P;
    const x = gx + m.dx;
    const rate = adult ? 0.8 : 1.0; // gait cycles per second: kids 2 steps/s, adults 1.6
    // every member is mid-stride (feet on the ground) at the composed still time
    const ph = TAU * (rate * (t - env.stillT) + 0.25 + (j % 2) * 0.5);
    const bob = Math.abs(Math.cos(ph));
    const sq = 1 + (0.036 * bob - 0.06 * Math.pow(1 - bob, 3)) * (adult ? 0.5 : 1);
    setFig(i, x, roadY(x) + (adult ? 0.018 : 0.03) * bob, m.lane, g.dir * (Math.PI / 2 - 0.5), 1);
    Bv[i].set(ph, 0, 0, adult ? 0.34 : 0.5);
    C[i].set(sq, 0.04, vis[i], 0);
  }

  function update(t: number, dt: number) {
    // 0.6 s screen-door dissolve toward each target
    const k = Math.min(1, dt / 0.6);
    for (let i = 0; i < FIG_COUNT; i++) {
      const w = want[i];
      vis[i] = vis[i] < w ? Math.min(w, vis[i] + k) : Math.max(w, vis[i] - k);
      if (hold[i] && vis[i] <= 0.001) { hold[i] = 0; want[i] = kindNow[i] && kindNow[i] !== WALK ? 1 : 0; }
    }
    for (let i = 0; i < FIG_COUNT; i++) { if (!hold[i]) figXZ[i * 3 + 2] = 0; C[i].z = vis[i]; }

    // outgoing walker groups finishing their crossing
    if (oldCast) {
      let anyOld = false;
      for (let g = 0; g < oldCast.groups.length; g++) {
        if (!oldLive[g]) continue;
        const G = oldCast.groups[g];
        if (wrapCount(G, oldShift[g], t) !== oldWrap0[g]) {
          oldLive[g] = 0;
          for (let j = 0; j < G.members.length; j++) { const f = G.members[j].f; vis[f] = 0; want[f] = kindNow[f] && kindNow[f] !== WALK ? 1 : 0; }
          continue;
        }
        anyOld = true;
        const gx = groupX(G, oldShift[g], t);
        for (let j = 0; j < G.members.length; j++) walker(G.members[j], G, gx, t, j);
      }
      if (!anyOld) oldCast = null;
    }
    // incoming walker groups enter from off-screen once all their members are free
    for (let g = 0; g < cast.groups.length; g++) {
      const G = cast.groups[g];
      if (!groupLive[g]) {
        let free = true;
        for (let j = 0; j < G.members.length; j++) { const f = G.members[j].f; if (busy(f) || vis[f] > 0.01) free = false; }
        if (!free) continue;
        const entry = -G.dir * (spanL(G) - 0.01);
        groupShift[g] = entry - (G.xStill + G.dir * G.speed * (t - env.stillT));
        groupLive[g] = 1;
        for (let j = 0; j < G.members.length; j++) { const f = G.members[j].f; want[f] = 1; vis[f] = 1; C[f].z = 1; }
      }
      const gx = groupX(G, groupShift[g], t);
      for (let j = 0; j < G.members.length; j++) if (!walkingOld(G.members[j].f)) walker(G.members[j], G, gx, t, j);
    }
    // standers: breathing 0.25 Hz 2%; the teacher waves in pulses (2.5 s of every 9 s, 0.5 Hz)
    for (let j = 0; j < cast.standers.length; j++) {
      const s = cast.standers[j], i = s.f;
      if (busy(i)) continue;
      const br = 1 + 0.02 * Math.sin(TAU * 0.25 * t + s.x * 1.7);
      let arm = 0, lean = 0;
      if (s.act === "greet" || s.act === "farewell") {
        const c = (((t + (s.act === "farewell" ? 3.1 : 0)) % 9) + 9) % 9;
        const w = smooth(0, 0.45, c) * (1 - smooth(2.1, 2.5, c));
        arm = lerp(0.1, 2.35, w) + 0.3 * Math.sin(t * Math.PI) * w;
      } else if (s.act === "point") { arm = 2.25 + 0.05 * Math.sin(t * 0.9); lean = -0.05; }
      else if (s.act === "look") lean = -0.13 + 0.02 * Math.sin(t * 0.4 + s.x);
      setFig(i, s.x, 0, s.z, s.ry + (s.act === "look" ? 0.05 * Math.sin(t * 0.4) : 0), 1);
      Bv[i].set(0, arm, 0, 0);
      C[i].set(br, lean, vis[i], 0);
    }
    // ball game, 2.6 s per pass: A lobs over the top (apex 1.12), B bounce-passes back
    // (25% squash on the bounce); the ball is held for a beat at each end, arms up to
    // throw and to catch, and the catcher bobs as it lands.
    const Bc = cast.ball;
    if (Bc && !busy(Bc.a) && !busy(Bc.b)) {
      const Pd = 2.6, n = Math.floor(t / Pd), u = fract(t / Pd), fromA = n % 2 === 0;
      const x0 = fromA ? Bc.xa + 0.2 : Bc.xb - 0.2, x1 = fromA ? Bc.xb - 0.2 : Bc.xa + 0.2;
      const q = clamp01((u - 0.1) / 0.8);
      const hand = 0.5;
      let y: number, sq = 1;
      if (fromA) y = hand + 4 * 0.62 * q * (1 - q);
      else if (q < 0.5) { const s = q / 0.5; y = hand + (0.1 - hand) * s * s; }
      else { const s = (q - 0.5) / 0.5; y = 0.1 + (hand - 0.1) * (1 - (1 - s) * (1 - s)); }
      if (!fromA) sq = 1 - 0.25 * Math.exp(-((q - 0.5) * (q - 0.5)) / 0.0008);
      setFig(F.BALL, lerp(x0, x1, q), y, Bc.z, 0, 2);
      Bv[F.BALL].set(0, 0, 0, 0);
      C[F.BALL].set(sq, 0, vis[F.BALL], q > 0 && q < 1 ? -t * 4 * (fromA ? 1 : -1) : 0);
      for (let j = 0; j < 2; j++) {
        const who = j === 0 ? Bc.a : Bc.b, x = j === 0 ? Bc.xa : Bc.xb, isA = j === 0;
        const near = isA === fromA ? u : 1 - u; // 0 at this child's own throw/catch moment
        const e = Math.exp(-((near - 0.08) * (near - 0.08)) / 0.003);
        setFig(who, x, 0.06 * e, Bc.z, isA ? Math.PI / 2 - 0.4 : -Math.PI / 2 + 0.4, 1);
        const sy = 1 + 0.06 * e - 0.05 * Math.exp(-Math.pow(near - 0.14, 2) / 0.002);
        Bv[who].set(0, lerp(0.25, 1.95, 1 - smooth(0.12, 0.24, near)), 0, 0);
        C[who].set(sy, 0, vis[who], 0);
      }
    }
    // swing: pendulum, 3.2 s period
    {
      const sw = cast.swing;
      const amp = sw ? sw.amp : 0, rider = sw ? sw.rider : -1;
      const ang = amp * Math.sin((TAU / 3.2) * t);
      setFig(F.SWING, SWING_POS[0], 0, SWING_POS[2], 0, 3);
      Bv[F.SWING].set(0, ang, 0, 0);
      C[F.SWING].set(1, 0, vis[F.SWING], 0);
      if (rider >= 0 && !busy(rider)) {
        const len = 1.35 - 0.4;
        const sx = SWING_POS[0] + Math.sin(ang) * len, sy = 1.35 - Math.cos(ang) * len;
        setFig(rider, sx - Math.sin(ang) * 0.2, sy - 0.2 * Math.cos(ang) + 0.02, SWING_POS[2], Math.PI / 2 - 0.3, 4);
        Bv[rider].set(0, 0, 0, -1);
        C[rider].set(1, -ang, vis[rider], 0);
      }
    }
    // kite: figure-eight and roll (0.42 and 0.84 rad/s); the string sags from the hand
    kiteState.on = false;
    const kc = cast.kite;
    if (kc && !busy(kc.holder)) {
      const i = kc.holder, fr = env.frame;
      setFig(i, kc.x, 0, kc.z, 0.3 + 0.05 * Math.sin(t * 0.5), 1);
      Bv[i].set(0, 2.2 + 0.08 * Math.sin(t * 0.84), 0, 0);
      C[i].set(1 + 0.018 * Math.sin(t * 1.3), -0.06, vis[i], 0);
      const kz = 0.9;
      const kx = kc.kx + 0.28 * Math.sin(t * 0.42);
      const ky = yForNdc(fr, kc.ny, kz) + 0.14 * Math.sin(t * 0.84 + 0.6);
      setFig(F.KITE, kx, ky, kz, -0.2, 0);
      Bv[F.KITE].set(0, 0, 0, 0);
      C[F.KITE].set(1, 0.1, vis[F.KITE], 0.22 * Math.sin(t * 0.42 + 0.9));
      figPoint(i, 0.163, 0.315, 0.008, 0.14, 0.5, 0, V);
      kiteState.hx = V.x; kiteState.hy = V.y; kiteState.hz = V.z;
      const roll = C[F.KITE].w, cy = Math.cos(-0.2), sy2 = Math.sin(-0.2);
      const lx = 0.05 * Math.sin(roll), ly = -0.05 * Math.cos(roll);
      kiteState.tx = kx + lx * cy; kiteState.ty = ky + ly; kiteState.tz = kz - lx * sy2;
      kiteState.on = vis[F.KITE] > 0.5;
    }
    const sc = cast.scope;
    if (sc && !busy(F.SCOPE)) { setFig(F.SCOPE, sc.x, 0, sc.z, 0, 3); Bv[F.SCOPE].set(0, 0, 0, 0); C[F.SCOPE].set(1, 0, vis[F.SCOPE], 0); }
    for (let i = 0; i < FIG_COUNT; i++) if (vis[i] <= 0.001) A[i].y = -50;
  }

  // CPU copy of the vertex rig for one limb-4 point (the kite string's hand end).
  function figPoint(i: number, px: number, py: number, pz: number, pvx: number, pvy: number, pvz: number, out: Vector3) {
    const a = Bv[i].y;
    let x = px - pvx, y = py - pvy, z = pz - pvz;
    const c = Math.cos(a), s = Math.sin(a);
    const x2 = x * c - y * s, y2 = x * s + y * c;
    x = x2 + pvx; y = y2 + pvy; z = z + pvz;
    const l = C[i].y, cl = Math.cos(l), sl = Math.sin(l);
    const y3 = y * cl - z * sl, z3 = y * sl + z * cl;
    y = y3 * C[i].x; z = z3;
    const w = A[i].w, cw = Math.cos(w), sw = Math.sin(w);
    out.set(x * cw + z * sw + A[i].x, y + A[i].y + Bv[i].z, -x * sw + z * cw + A[i].z);
    return out;
  }

  return { mesh, material, figU, geometry, update, setCast, kiteState, env, vis, figXZ, HEIGHT, WIDTH, A, castOf: () => cast };
}

/** What createFigures returns (the scene reads mesh, env, update, setCast, kiteState, vis, figXZ, A, HEIGHT, WIDTH). */
export type Figures = ReturnType<typeof createFigures>;
