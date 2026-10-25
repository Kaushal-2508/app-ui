// The national flag: exact colours in every mode.
//
// 3:2, saffron #FF9933 / white #FFFFFF / India green #138808, navy #000080 Ashoka Chakra
// with 24 spokes, centred, diameter 0.925 of the white band. toneMapped:false, fog:false,
// no per-mode tint; the cloth fold shading multiplies luminance only, inside 0.90 to 1.04.
//
// Cloth: two travelling waves (0.41 Hz and 0.23 Hz, incommensurate) whose amplitude grows
// from the hoist, about 1.5 wavelengths across the fly so one to two soft S-folds always
// read; finite-difference fold normals; the fly edge flutters in and out and the top and
// bottom edges ripple. The whole flag scales up a little on narrow (phone) aspects so it
// stays at least 24 CSS px wide there; the scale pivots on the hoist centre.
import { CanvasTexture, DoubleSide, Mesh, PlaneGeometry, SRGBColorSpace, ShaderMaterial } from "three";
import type { IUniform } from "three";

/** The shared uniforms the flag reads (a structural slice of materials' createShared()). */
export interface FlagUniforms {
  uTime: IUniform<number>;
}

export const FLAG_W = 1.32;
export const FLAG_H = 0.88;
export const POLE_R = 0.04;
export const FLAG_CENTER_Y = 4.39; // spans 3.95 to 4.83 at scale 1
export const FLAG_YAW = -0.3; // free end swings toward the camera so the folds read
export const FINIAL_Z = -0.35;
// flag scale by frame t (0 = 3:1 phone, 1 = 8:1 laptop); at 1.12 the top reaches 4.88,
// still under the finial top (4.93)
export const flagScaleFor = (t: number) => 1.12 + (1.0 - 1.12) * Math.min(1, Math.max(0, t / 0.5));

function flagCanvas(): HTMLCanvasElement {
  const W = 480, H = 320, TAU = Math.PI * 2;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d");
  g.fillStyle = "#FF9933"; g.fillRect(0, 0, W, H / 3 + 1);
  g.fillStyle = "#FFFFFF"; g.fillRect(0, H / 3, W, H / 3 + 1);
  g.fillStyle = "#138808"; g.fillRect(0, (2 * H) / 3, W, H / 3 + 1);
  const cx = W / 2, cy = H / 2, R = ((H / 3) * 0.925) / 2;
  g.fillStyle = g.strokeStyle = "#000080";
  const rimW = R * 0.1;
  g.lineWidth = rimW;
  g.beginPath(); g.arc(cx, cy, R - rimW / 2, 0, TAU); g.stroke();
  g.beginPath(); g.arc(cx, cy, R * 0.19, 0, TAU); g.fill();
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * TAU, ca = Math.cos(a), sa = Math.sin(a), nx = -sa, ny = ca;
    const r0 = R * 0.12, rm = R * 0.36, r1 = R * 0.9, wm = R * 0.062, w1 = R * 0.016;
    g.beginPath();
    g.moveTo(cx + ca * r0, cy + sa * r0);
    g.lineTo(cx + ca * rm + nx * wm, cy + sa * rm + ny * wm);
    g.lineTo(cx + ca * r1 + nx * w1, cy + sa * r1 + ny * w1);
    g.lineTo(cx + ca * r1 - nx * w1, cy + sa * r1 - ny * w1);
    g.lineTo(cx + ca * rm - nx * wm, cy + sa * rm - ny * wm);
    g.closePath(); g.fill();
    const b = a + TAU / 48; // the 24 small semicircles on the rim, between spokes
    g.beginPath(); g.arc(cx + Math.cos(b) * (R - rimW), cy + Math.sin(b) * (R - rimW), R * 0.045, 0, TAU); g.fill();
  }
  return c;
}

export function createFlag(U: FlagUniforms) {
  const tex = new CanvasTexture(flagCanvas());
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  const geo = new PlaneGeometry(FLAG_W, FLAG_H, 28, 12);
  geo.translate(FLAG_W / 2, 0, 0);
  const W = FLAG_W.toFixed(3);
  const mat = new ShaderMaterial({
    uniforms: { uTime: U.uTime, map: { value: tex } },
    side: DoubleSide,
    toneMapped: false,
    fog: false,
    vertexShader: /* glsl */ `
      uniform float uTime; varying vec2 vUv; varying float vShade;
      // phase of the main travelling wave at a point (0.41 Hz)
      float ph( vec2 q ) { return q.x * 7.1 - uTime * 2.576 + q.y * 1.2; }
      float cloth( vec2 q ) {
        float u = clamp( q.x / ${W}, 0.0, 1.0 );
        float amp = 0.012 + 0.1 * pow( u, 0.85 );
        return ( sin( ph( q ) ) * 0.72 + sin( q.x * 4.3 - uTime * 1.445 + q.y * 2.1 + 1.3 ) * 0.4 ) * amp;
      }
      void main() {
        vUv = uv;
        vec3 p = position;
        float u = clamp( p.x / ${W}, 0.0, 1.0 );
        float z = cloth( p.xy );
        // finite-difference fold normal
        float e = 0.02;
        float dzdx = ( cloth( p.xy + vec2( e, 0.0 ) ) - cloth( p.xy - vec2( e, 0.0 ) ) ) / ( 2.0 * e );
        float dzdy = ( cloth( p.xy + vec2( 0.0, e ) ) - cloth( p.xy - vec2( 0.0, e ) ) ) / ( 2.0 * e );
        vec3 n = normalize( vec3( -dzdx, -dzdy, 1.0 ) );
        // luminance-only fold shading, centred on 0.97 and saturating at the contract's
        // limits (0.90 in the troughs facing away, 1.04 on the crests facing the light)
        vec3 L = normalize( vec3( -0.5, 0.35, 0.8 ) );
        float lit = ( dot( n, L ) - L.z ) * 3.2;
        vShade = 0.97 + 0.07 * clamp( lit, -1.0, 1.0 );
        p.z += z;
        p.y -= 0.035 * u * u;                                       // slight droop
        p.y += 0.032 * u * sin( ph( p.xy ) + 0.9 );                 // edge ripple
        p.x -= 0.03 * u * u * ( 0.7 + 0.3 * sin( uTime * 1.445 ) )  // fly-end flutter
             + 0.045 * u * u * ( 0.5 + 0.5 * sin( ph( vec2( ${W}, p.y ) ) ) );
        gl_Position = projectionMatrix * modelViewMatrix * vec4( p, 1.0 );
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map; varying vec2 vUv; varying float vShade;
      void main() {
        vec4 c = texture2D( map, vUv );
        gl_FragColor = vec4( c.rgb * vShade, 1.0 );
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new Mesh(geo, mat);
  mesh.position.set(POLE_R * 0.6, FLAG_CENTER_Y, FINIAL_Z);
  mesh.rotation.y = FLAG_YAW;
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  return { mesh, tex };
}
