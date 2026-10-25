// Composition is SOLVED per aspect, not cropped.
//
// The camera is level (no pitch, no roll), so verticals stay true. Two pixel pins give a
// 2x2 linear system in F = 1/tan(fov/2) and the vertical lens shift s (written into
// projectionMatrix.elements[9]):
//   ndc_y = F * k - s,  k = (y - camY) / (camZ - z)   (tangent of the ray below level)
//   pin 1: the flag finial lands 8 CSS px below the top edge
//   pin 2: the nearest walker lane's foot line (phone) or the verge front (8:1) lands
//          6 CSS px above the bottom edge
// The horizontal shift keeps the school at 50% of the width; camera drift and pointer
// parallax are pure translations with a compensating lens shift, so the school plane
// stays put and only depth separates.
import type { PerspectiveCamera } from "three";
import type { FrameState } from "./types";

export const FINIAL = { y: 4.93, z: -0.35 };
export const SCHOOL_TARGET_Y = 1.4;
export const LANE_NEAR_Z = 3.62;
export const VERGE_FRONT_Z = 4.9;
export const ROAD_Z = 3.4;
export const CAM_Z = 40;
const TOP_PIN_PX = 8;
const BOTTOM_PIN_PX = 6;
const MAX_HALF_WIDTH = 26; // at the road, above about 9.4:1

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function createFrame(): FrameState {
  return { cssW: 1166, cssH: 176, aspect: 6.6, t: 0.7, camY: 6, camZ: CAM_Z, F: 12, s: -1.3, zFoot: 4.5, clamped: false };
}

export function solveFraming(fr: FrameState, cssW: number, cssH: number): FrameState {
  const aspect = cssW / cssH;
  const t = clamp01((aspect - 3) / 5);
  const descent = (lerp(6.5, 7.5, t) * Math.PI) / 180;
  const camZ = CAM_Z;
  const camY = SCHOOL_TARGET_Y + camZ * Math.tan(descent);
  const nTop = 1 - (2 * TOP_PIN_PX) / cssH;
  const nBot = -1 + (2 * BOTTOM_PIN_PX) / cssH;
  const zFoot = lerp(LANE_NEAR_Z, VERGE_FRONT_Z, t);
  const k1 = (FINIAL.y - camY) / (camZ - FINIAL.z);
  const k2 = (0 - camY) / (camZ - zFoot);
  let F = (nTop - nBot) / (k1 - k2);
  let clamped = false;
  const hw = ((camZ - ROAD_Z) * aspect) / F;
  if (hw > MAX_HALF_WIDTH) { F = ((camZ - ROAD_Z) * aspect) / MAX_HALF_WIDTH; clamped = true; }
  const s = F * k1 - nTop;
  Object.assign(fr, { cssW, cssH, aspect, t, camY, camZ, F, s, zFoot, clamped });
  return fr;
}

// Half of the visible width (world units) at depth z, for the base (undrifted) camera.
export const halfWidthAt = (fr: FrameState, z: number) => ((fr.camZ - z) * fr.aspect) / fr.F;

// World point -> CSS px for the base camera (drift ignored). Used by probe() and layout.
export function projectCss<T extends { x: number; y: number }>(fr: FrameState, x: number, y: number, z: number, out: T): T {
  const d = fr.camZ - z;
  const nx = ((fr.F / fr.aspect) * x) / d;
  const ny = (fr.F * (y - fr.camY)) / d - fr.s;
  out.x = (nx * 0.5 + 0.5) * fr.cssW;
  out.y = (0.5 - ny * 0.5) * fr.cssH;
  return out;
}

// World y at depth z whose projection lands at NDC height ny (base camera).
export const yForNdc = (fr: FrameState, ny: number, z: number) => fr.camY + ((ny + fr.s) / fr.F) * (fr.camZ - z);

// Apply to a PerspectiveCamera. (ox, oy): drift + parallax offset of the camera.
export function applyCamera(camera: PerspectiveCamera, fr: FrameState, ox: number, oy: number): void {
  camera.position.set(ox, fr.camY + oy, fr.camZ);
  camera.rotation.set(0, 0, 0);
  // no updateMatrixWorld() here: renderer.render() updates the (parentless) camera itself,
  // and nothing else reads the camera matrices between frames
  const e = camera.projectionMatrix.elements;
  // compensating lens shift: the school plane (z = 0) keeps its screen position
  e[8] = (-(fr.F / fr.aspect) * ox) / fr.camZ;
  e[9] = fr.s - (fr.F * oy) / fr.camZ;
  // projectionMatrixInverse is deliberately NOT refreshed per frame: nothing in the
  // banner reads it (no raycasting, no screen-space passes), and the invert cost a
  // matrix inversion every frame.
}

export function setupProjection(camera: PerspectiveCamera, fr: FrameState): void {
  camera.fov = (2 * Math.atan(1 / fr.F) * 180) / Math.PI;
  camera.aspect = fr.aspect;
  camera.updateProjectionMatrix();
}
