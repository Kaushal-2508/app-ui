// Instanced quads (no gl_PointSize anywhere).
//
// GLOWS, one additive draw: window halos, lamp halos, lamp and porch pools on the ground,
// the flag floodlight, 28 fireflies and 12 golden pollen motes. Each group fades by one
// uniform; an instance whose group is at zero collapses outside the clip volume.
// SOFT, one alpha draw: the contact blobs (static ones plus figure blobs rewritten each
// frame, sun-aligned and stretched) and the curvature-matched valley mist sheets.
import {
  AdditiveBlending, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, PlaneGeometry, ShaderMaterial,
  Vector4, Color,
} from "three";
import type { IUniform } from "three";
import { mulberry32 } from "./world";

export const GLOW = { WIN: 0, LAMP: 1, LAMP_POOL: 2, PORCH_POOL: 3, FLOOD: 4, FLY: 5, MOTE: 6, PORCH: 7 };

/** One glow instance: world position, quad size, GLOW kind, seed 0..1, amplitude, linear RGB. */
export interface GlowSpot {
  x: number;
  y: number;
  z: number;
  size: number;
  kind: number;
  seed: number;
  amp: number;
  col: readonly number[];
}

/** A vertical valley mist sheet: depth, width, height, alpha. */
export interface MistSheet {
  z: number;
  w: number;
  h: number;
  a: number;
}

/** The shared uniforms the glow pass reads (a structural slice of createShared()). */
export interface GlowUniforms {
  uTime: IUniform<number>;
  uWinOn: IUniform<number>;
}

/** The shared uniforms the soft pass reads (a structural slice of createShared()). */
export interface SoftUniforms {
  uTime: IUniform<number>;
  uCurve: IUniform<number>;
  uCurveZ: IUniform<number>;
}

export function createGlows(U: GlowUniforms, spots: readonly GlowSpot[]) {
  const rnd = mulberry32(515);
  const list = spots.slice();
  // porch: a warm pool on the steps and forecourt plus a soft halo in the doorway (there
  // is no PointLight; the clay shader adds the matching warm falloff on nearby surfaces)
  list.push({ x: 0, y: 0.07, z: 1.85, size: 2.8, kind: GLOW.PORCH_POOL, seed: 0.3, amp: 0.34, col: [1, 0.72, 0.38] });
  list.push({ x: 0, y: 0.9, z: 1.5, size: 1.35, kind: GLOW.PORCH, seed: 0.4, amp: 0.16, col: [1, 0.74, 0.42] });
  // flag floodlight: a warm halo behind the cloth and a small bright spot at the pole top
  list.push({ x: 0.66, y: 4.38, z: -0.7, size: 2.3, kind: GLOW.FLOOD, seed: 0.5, amp: 0.3, col: [1, 0.86, 0.62] });
  list.push({ x: 0.02, y: 4.62, z: -0.3, size: 0.5, kind: GLOW.FLOOD, seed: 0.6, amp: 0.22, col: [1, 0.9, 0.72] });
  // 28 fireflies over the lawns (never inside the facade band)
  for (let i = 0; i < 28; i++) {
    let x = (rnd() - 0.5) * 46;
    if (Math.abs(x) < 5.2) x = Math.sign(x || 1) * (5.2 + rnd() * 3);
    list.push({ x, y: 0.3 + rnd() * 0.9, z: 1.2 + rnd() * 1.9, size: 0.16, kind: GLOW.FLY, seed: rnd(), amp: 0.85, col: [0.95, 0.9, 0.35] });
  }
  // 12 pollen motes in the golden light
  for (let i = 0; i < 12; i++) {
    const x = (rnd() < 0.5 ? -1 : 1) * (1.5 + rnd() * 9);
    list.push({ x, y: 0.3 + rnd() * 2.2, z: 1.3 + rnd() * 1.6, size: 0.075, kind: GLOW.MOTE, seed: rnd(), amp: 0.55, col: [1, 0.86, 0.6] });
  }
  const n = list.length;
  const aP = new Float32Array(n * 3), aK = new Float32Array(n * 4), aC = new Float32Array(n * 3);
  list.forEach((g, i) => {
    aP.set([g.x, g.y, g.z], i * 3);
    aK.set([g.size, g.kind, g.seed, g.amp], i * 4);
    aC.set(g.col, i * 3);
  });
  const base = new PlaneGeometry(1, 1);
  const geo = new InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute("position", base.getAttribute("position"));
  geo.setAttribute("uv", base.getAttribute("uv"));
  geo.setAttribute("aP", new InstancedBufferAttribute(aP, 3));
  geo.setAttribute("aK", new InstancedBufferAttribute(aK, 4));
  geo.setAttribute("aC", new InstancedBufferAttribute(aC, 3));
  geo.instanceCount = n;
  const uG1 = { value: new Vector4() }, uG2 = { value: new Vector4() };
  const mat = new ShaderMaterial({
    uniforms: { uTime: U.uTime, uWinOn: U.uWinOn, uG1, uG2 },
    transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false,
    vertexShader: /* glsl */ `
      attribute vec3 aP; attribute vec4 aK; attribute vec3 aC;
      uniform float uTime; uniform float uWinOn; uniform vec4 uG1; uniform vec4 uG2;
      varying vec2 vUv; varying vec3 vCol; varying float vGround;
      void main() {
        int kind = int( aK.y + 0.5 );
        float sd = aK.z * 6.2831;
        vec3 p = aP;
        float g = 0.0;
        if ( kind == 0 ) { float h = fract( aK.z * 13.37 ); g = uG1.x * smoothstep( h * 0.72, h * 0.72 + 0.28, uWinOn ); }
        else if ( kind == 1 || kind == 2 ) g = uG1.y;
        else if ( kind == 3 || kind == 7 ) g = uG1.z;
        else if ( kind == 4 ) g = uG1.w;
        else if ( kind == 5 ) {
          g = uG2.x * ( 0.25 + 0.75 * pow( 0.5 + 0.5 * sin( uTime * ( 0.7 + aK.z * 0.55 ) + sd * 3.0 ), 2.0 ) );
          p += vec3( sin( uTime * 0.21 + sd ) * 0.7 + sin( uTime * 0.53 + sd * 2.0 ) * 0.2,
                     sin( uTime * 0.37 + sd * 1.3 ) * 0.22, cos( uTime * 0.29 + sd ) * 0.35 );
        } else if ( kind == 6 ) {
          g = uG2.y * ( 0.6 + 0.4 * sin( uTime * 0.5 + sd ) );
          p.y = 0.3 + mod( aP.y + uTime * 0.05, 2.4 );
          p.x += sin( uTime * 0.23 + sd ) * 0.4;
          g *= smoothstep( 0.3, 0.6, p.y ) * ( 1.0 - smoothstep( 2.2, 2.7, p.y ) );
        }
        float a = aK.w * g;
        vUv = uv; vCol = aC * a; vGround = 0.0;
        if ( a < 0.002 ) { gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 ); return; }
        vec4 mv;
        if ( kind == 2 || kind == 3 ) {
          vec2 sz = kind == 3 ? vec2( 1.0, 0.5 ) : vec2( 1.0, 0.55 );
          mv = viewMatrix * vec4( p + vec3( position.x * aK.x * sz.x, 0.0, -position.y * aK.x * sz.y ), 1.0 );
          vGround = 1.0;
        } else {
          mv = viewMatrix * vec4( p, 1.0 );
          mv.xy += position.xy * aK.x;
        }
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vCol; varying float vGround;
      void main() {
        float r = length( vUv * 2.0 - 1.0 );
        float f = exp( -r * r * ( vGround > 0.5 ? 2.6 : 3.6 ) ) * ( 1.0 - smoothstep( 0.72, 1.0, r ) );
        gl_FragColor = vec4( vCol * f, 1.0 );
      }`,
  });
  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 30;
  return { mesh, uG1, uG2, geo, base };
}

// SOFT quads: kind 0 ground blob (radial, rotated about Y), kind 1 vertical mist sheet.
// staticBlobs rows are [x, z, sx, sz] or [x, z, sx, sz, alpha] (alpha defaults to 1).
export function createSoft(U: SoftUniforms, staticBlobs: ReadonlyArray<readonly number[]>, mistSheets: readonly MistSheet[], dynCount: number) {
  const nStatic = staticBlobs.length, nMist = mistSheets.length;
  const n = nStatic + nMist + dynCount;
  const aA = new Float32Array(n * 4), aB = new Float32Array(n * 4);
  let i = 0;
  for (const [x, z, sx, sz, a = 1] of staticBlobs) { aA.set([x, 0.058, z, 0], i * 4); aB.set([sx, sz, 0, 0.8 * a], i * 4); i++; }
  const curve = U.uCurve.value, cz = U.uCurveZ.value;
  for (const m of mistSheets) {
    const dz = Math.min(m.z - cz, 0);
    aA.set([0, -curve * dz * dz - 0.15, m.z, 0], i * 4);
    aB.set([m.w, m.h, 1, m.a], i * 4);
    i++;
  }
  const dynStart = i;
  const base = new PlaneGeometry(1, 1);
  const geo = new InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute("position", base.getAttribute("position"));
  geo.setAttribute("uv", base.getAttribute("uv"));
  const attA = new InstancedBufferAttribute(aA, 4), attB = new InstancedBufferAttribute(aB, 4);
  geo.setAttribute("aA", attA);
  geo.setAttribute("aB", attB);
  geo.instanceCount = n;
  const uBlobCol = { value: new Color("#445") }, uBlobA = { value: 0.3 };
  const uMistCol = { value: new Color("#fff") }, uMistA = { value: 0 };
  const mat = new ShaderMaterial({
    uniforms: { uTime: U.uTime, uBlobCol, uBlobA, uMistCol, uMistA },
    transparent: true, depthWrite: false, toneMapped: false,
    vertexShader: /* glsl */ `
      attribute vec4 aA; attribute vec4 aB;
      uniform float uBlobA; uniform float uMistA; uniform float uTime;
      varying vec2 vUv; varying float vKind; varying float vA;
      void main() {
        vUv = uv;
        vKind = aB.z;
        vec3 p;
        if ( aB.z < 0.5 ) {
          float c = cos( aA.w ), s = sin( aA.w );
          vec2 q = vec2( position.x * aB.x, -position.y * aB.y );
          p = vec3( aA.x + q.x * c - q.y * s, aA.y, aA.z + q.x * s + q.y * c );
          vA = aB.w * uBlobA;
        } else {
          p = vec3( aA.x + position.x * aB.x, aA.y + ( position.y + 0.5 ) * aB.y, aA.z );
          // density breathing, +-15% over 150 s
          vA = aB.w * uMistA * ( 1.0 + 0.15 * sin( uTime * 0.0419 + aA.z ) );
        }
        if ( vA < 0.002 || aB.x < 0.001 ) { gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 ); return; }
        gl_Position = projectionMatrix * viewMatrix * vec4( p, 1.0 );
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uBlobCol; uniform vec3 uMistCol;
      varying vec2 vUv; varying float vKind; varying float vA;
      void main() {
        float a;
        vec3 col;
        if ( vKind < 0.5 ) {
          float r = length( vUv * 2.0 - 1.0 );
          a = 1.0 - smoothstep( 0.0, 1.0, r ); a = a * ( 0.7 + 0.3 * a );
          col = uBlobCol;
        } else {
          float y = vUv.y;
          a = ( 1.0 - smoothstep( 0.25, 1.0, y ) ) * smoothstep( 0.0, 0.12, y );
          col = uMistCol;
        }
        gl_FragColor = vec4( col, a * vA );
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 20;
  // only the dynamic tail (figure blobs) changes per frame: upload just that range. The
  // range objects are preallocated and re-pushed each frame (three clears the list after
  // uploading, so this allocates nothing).
  const rangeA = { start: dynStart * 4, count: dynCount * 4 }, rangeB = { start: dynStart * 4, count: dynCount * 4 };
  return { mesh, uBlobCol, uBlobA, uMistCol, uMistA, attA, attB, aA, aB, dynStart, dynCount, geo, base, rangeA, rangeB };
}
