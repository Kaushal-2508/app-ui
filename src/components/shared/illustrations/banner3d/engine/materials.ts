// Clay shading: MeshLambertMaterial plus a small set of patches (the production shading).
//
// Three programs share this file: "static" (the two merged world meshes), "inst" (every
// InstancedMesh: trees, bushes, flowers, clouds; all carry vertex AND instance colours so
// they share one program) and "fig" (the single merged figures mesh). Behaviour per
// surface is chosen by a per-vertex kind code, never by a define, so no state change can
// ever trigger a recompile.
//
// Fill-rate notes (the banner is fill-bound on integrated GPUs):
//  - the atmosphere colour (the screen-anchored sky behind a fragment) is evaluated per
//    VERTEX and interpolated; the fragment only computes the fog amount (one exp);
//  - lawn, field and water noise read a 64x64 tiling noise texture instead of hashing;
//  - there is no PointLight: the porch light is a cheap analytic falloff term.
import {
  Color, DataTexture, LinearFilter, LinearMipmapLinearFilter, MeshLambertMaterial, RGBAFormat, RepeatWrapping,
  ShaderChunk, UnsignedByteType, Vector2, Vector3, Vector4,
} from "three";
import type { IUniform } from "three";

// Shadow receive was half the frame on integrated GPUs: three's PCF path takes five
// Vogel-disk taps rotated by per-pixel noise (a sqrt, sin and cos per tap). The static
// clay shadows only need a soft edge, so the clay programs use four hardware-PCF taps
// on a fixed rotated grid (each tap is itself a bilinear 2x2 compare): no trig, no noise.
const PCF_RE = /float phi = interleavedGradientNoise\( gl_FragCoord\.xy \) \* PI2;[\s\S]*?\) \* 0\.2;/;
const CHEAP_SHADOW_PARS = (() => {
  const src = ShaderChunk.shadowmap_pars_fragment;
  if (!PCF_RE.test(src)) return null; // a future three changed the chunk: keep its own
  return src.replace(PCF_RE, `vec2 rg = vec2( radius, radius * shadowMapSize.x / shadowMapSize.y ) * 0.8;
				shadow = (
					texture( shadowMap, vec3( shadowCoord.xy + vec2( -rg.x, -0.38 * rg.y ), shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vec2( rg.x, 0.38 * rg.y ), shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vec2( -0.38 * rg.x, rg.y ), shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vec2( 0.38 * rg.x, -rg.y ), shadowCoord.z ) )
				) * 0.25;`);
})();

export const KIND = {
  CLAY: 0, LAWN: 1, WATER: 2, BACK: 3, HOUR: 4, MINUTE: 5, CLOUD: 6, FOLIAGE: 7, PATH: 8,
  FIG: 9, FAR: 10, POLE: 11, LAMP: 12, FIELD: 13, FLOWER: 14, BOAT: 15, GLASS: 16, BUS: 17, DOOR: 18,
};

// Value-noise lattice: four independent channels of 64x64 random bytes, bilinear and
// mipmapped. texture(uNoise, p / 64.0) is a smooth noise with unit lattice spacing in p.
function noiseTexture(): DataTexture {
  const N = 64, data = new Uint8Array(N * N * 4);
  let a = 0x2545f491;
  const rnd = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  for (let i = 0; i < data.length; i++) data[i] = Math.floor(rnd() * 256);
  const t = new DataTexture(data, N, N, RGBAFormat, UnsignedByteType);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

export function createShared() {
  return {
    uTime: { value: 0 },
    uCurve: { value: 0.0062 }, uCurveZ: { value: -2.5 },
    uRimCol: { value: new Color() }, uRim: { value: 0.3 },
    uWinA: { value: new Color("#ffc46a") }, uWinB: { value: new Color("#ffe0a8") },
    uWinOn: { value: 0 }, uWinK: { value: 0.62 },
    uGlassRefl: { value: 0.08 },
    uLawn: { value: new Color("#a3d39a") }, uNight: { value: 0 },
    uWaterA: { value: new Color() }, uWaterB: { value: new Color() },
    uClock: { value: new Vector2() }, uClockC: { value: new Vector3(0, 3.43, 0.09) },
    uPoleEm: { value: 0 }, uLampEm: { value: 0 },
    uCloudCol: { value: new Color("#ffffff") }, uCloudEm: { value: new Color("#303030") },
    uBoat: { value: new Vector3() },
    uGust: { value: new Vector4(1.2, 26.4, 3.2, 1.0) }, // speed u/s, spacing (22 s * 1.2), width, strength
    uNoise: { value: noiseTexture() },
    uPorch: { value: 0 }, uBackHue: { value: 0 }, uFigLift: { value: 0 },
    // atmosphere: the same screen-anchored sky the sky pass draws
    uSkyHor: { value: new Color() }, uSkyMid: { value: new Color() }, uSkyTop: { value: new Color() },
    uGlowCol: { value: new Color() }, uGlowAmt: { value: 0.5 }, uGlowSize: { value: 0.5 },
    uDisc: { value: new Vector2() }, uAspect: { value: 6.6 }, uRes: { value: new Vector2(1, 1) },
    uProj: { value: new Vector2(12, -1.3) }, // (1/tan(fov/2), vertical lens shift)
    uFogDensity: { value: 0.014 }, uFogStart: { value: 44 }, uFogMax: { value: 0.7 },
  };
}
/** The per-scene uniform set every program shares (one object per scene instance). */
export type SharedUniforms = ReturnType<typeof createShared>;
/** Which clay program: the two merged world meshes, every InstancedMesh, or the figures. */
export type ClayVariant = "static" | "inst" | "fig";

export const SKY_GLSL = /* glsl */ `
uniform vec3 uSkyHor; uniform vec3 uSkyMid; uniform vec3 uSkyTop; uniform vec3 uGlowCol;
uniform float uGlowAmt; uniform float uGlowSize; uniform vec2 uDisc; uniform float uAspect; uniform vec2 uRes;
vec3 skyAt( vec2 ndc ) {
  float y = ndc.y * 0.5 + 0.5;
  vec3 c = mix( uSkyHor, uSkyMid, smoothstep( 0.18, 0.64, y ) );
  c = mix( c, uSkyTop, smoothstep( 0.56, 1.06, y ) );
  vec2 dd = ( ndc - uDisc ) * vec2( uAspect, 1.0 );
  float d = length( dd );
  c += uGlowCol * uGlowAmt * ( exp( -( d * d ) / ( uGlowSize * uGlowSize ) ) * 0.7 + exp( -d / ( uGlowSize * 2.2 ) ) * 0.3 );
  vec3 hi = max( c - 0.78, 0.0 );
  return c - hi + hi / ( 1.0 + hi * 3.0 );
}
float cHash( vec2 p ) { p = fract( p * vec2( 123.34, 456.21 ) ); p += dot( p, p + 45.32 ); return fract( p.x * p.y ); }
`;

// Figure rig: every person and moving prop is one merged mesh; vertices carry the figure
// index, a limb code and a pivot. Per figure: A = (x, y, z, yaw), B = (step phase, arm
// angle, bob, stride; stride < 0 means seated), C = (squash, lean, visibility, roll).
export const FIG_COUNT = 11;
const FIG_PARS = /* glsl */ `
attribute float aFig; attribute float aLimb; attribute vec3 aPivot;
uniform vec4 uFigA[ ${FIG_COUNT} ]; uniform vec4 uFigB[ ${FIG_COUNT} ]; uniform vec4 uFigC[ ${FIG_COUNT} ];
varying float vVis;
vec3 fRX( vec3 p, float a ) { float c = cos( a ), s = sin( a ); return vec3( p.x, p.y * c - p.z * s, p.y * s + p.z * c ); }
vec3 fRY( vec3 p, float a ) { float c = cos( a ), s = sin( a ); return vec3( p.x * c + p.z * s, p.y, -p.x * s + p.z * c ); }
vec3 fRZ( vec3 p, float a ) { float c = cos( a ), s = sin( a ); return vec3( p.x * c - p.y * s, p.x * s + p.y * c, p.z ); }
`;
const FIG_SETUP = /* glsl */ `
int fIdx = int( aFig + 0.5 );
vec4 FA = uFigA[ fIdx ]; vec4 FB = uFigB[ fIdx ]; vec4 FC = uFigC[ fIdx ];
int fLimb = int( aLimb + 0.5 );
float fSit = max( -FB.w, 0.0 );
float fSw = sin( FB.x ) * max( FB.w, 0.0 );
float fRaise = step( 0.01, abs( FB.y ) );
vVis = FC.z;
`;
// limb rotation, then roll, lean, (squash for positions), yaw
const FIG_ROT = (v: string) => /* glsl */ `
  if ( fLimb == 1 ) ${v} = fRX( ${v}, fSw - fSit * 1.45 );
  else if ( fLimb == 2 ) ${v} = fRX( ${v}, -fSw - fSit * 1.45 );
  else if ( fLimb == 3 ) ${v} = fRX( ${v}, -fSw * 0.8 - fSit * 0.55 );
  else if ( fLimb == 4 ) ${v} = fRZ( fRX( ${v}, fSw * 0.8 * ( 1.0 - fRaise ) - fSit * 0.55 ), FB.y );
  else if ( fLimb == 5 ) ${v} = fRZ( fRX( ${v}, -0.18 * fRaise ), FB.y );
  else if ( fLimb == 6 ) ${v} = fRZ( ${v}, FB.y );
`;

export function clayMaterial(
  U: SharedUniforms,
  variant: ClayVariant,
  extraUniforms: Record<string, IUniform<unknown>> | null = null,
): MeshLambertMaterial {
  const m = new MeshLambertMaterial({ vertexColors: true });
  const isFig = variant === "fig";
  m.customProgramCacheKey = () => "clay-" + variant;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U, extraUniforms || {});
    let vs = sh.vertexShader;
    let fs = sh.fragmentShader;

    vs = vs.replace("#include <common>", /* glsl */ `#include <common>
uniform float uTime; uniform float uCurve; uniform float uCurveZ;
uniform vec2 uClock; uniform vec3 uClockC; uniform vec4 uGust; uniform vec3 uBoat;
varying vec4 vSurf; varying vec3 vWPos; varying vec3 vFogC;
${isFig ? FIG_PARS : "attribute vec4 aSurf;"}
${SKY_GLSL}
vec3 srgbOut( vec3 c ) { return mix( c * 12.92, 1.055 * pow( max( c, vec3( 0.0 ) ), vec3( 0.41667 ) ) - 0.055, step( vec3( 0.0031308 ), c ) ); }
vec3 clockRot( vec3 p, float a ) { vec3 q = p - uClockC; float c = cos( a ), s = sin( a ); return uClockC + vec3( q.x * c + q.y * s, -q.x * s + q.y * c, q.z ); }
float gustAt( float x ) { float u = fract( ( x - uTime * uGust.x ) / uGust.y ); float d = ( u - 0.5 ) * uGust.y; return exp( -d * d / ( uGust.z * uGust.z ) ); }
`);

    if (variant === "inst") {
      // the instance colour tints only the parts that ask for it (canopy yes, trunk no)
      vs = vs.replace("#include <color_vertex>", /* glsl */ `
vColor = vec4( 1.0 );
vColor.rgb *= color;
#ifdef USE_INSTANCING_COLOR
vColor.rgb *= mix( vec3( 1.0 ), instanceColor.rgb, aSurf.y );
#endif`);
    }

    if (isFig) {
      vs = vs.replace("#include <beginnormal_vertex>", /* glsl */ `
${FIG_SETUP}
vec3 objectNormal = vec3( normal );
${FIG_ROT("objectNormal")}
objectNormal = fRY( fRX( fRZ( objectNormal, FC.w ), FC.y ), FA.w );`);
      vs = vs.replace("#include <begin_vertex>", /* glsl */ `
vSurf = vec4( 0.0, 0.0, 9.0, 0.0 );
vec3 transformed = position - aPivot;
${FIG_ROT("transformed")}
transformed += aPivot;
transformed = fRX( fRZ( transformed, FC.w ), FC.y );
transformed.y *= FC.x; transformed.xz *= inversesqrt( max( FC.x, 0.2 ) );
transformed = fRY( transformed, FA.w ) + FA.xyz + vec3( 0.0, FB.z, 0.0 );`);
    } else {
      vs = vs.replace("#include <begin_vertex>", /* glsl */ `
vec3 transformed = vec3( position );
vSurf = aSurf;
int vk = int( aSurf.z + 0.5 );
if ( vk == 4 ) transformed = clockRot( transformed, uClock.x );
else if ( vk == 5 ) transformed = clockRot( transformed, uClock.y );
else if ( vk == 15 ) {
  vec3 q = transformed - uBoat;
  transformed.y += sin( uTime * 1.1 ) * 0.018 + ( q.x * 0.55 + q.z * 0.45 ) * 0.03 * sin( uTime * 0.9 + 1.0 );
}`);
    }

    vs = vs.replace("#include <project_vertex>", /* glsl */ `
vec4 cwp = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
cwp = instanceMatrix * cwp;
#endif
cwp = modelMatrix * cwp;
${isFig ? "int vk = 9;" : ""}
#ifdef USE_INSTANCING
if ( vk == 7 || vk == 10 || vk == 14 ) {
  float hh = max( position.y - ( vk == 14 ? 0.0 : 0.5 ), 0.0 ) * length( instanceMatrix[ 1 ].xyz );
  vec3 ip = instanceMatrix[ 3 ].xyz;
  float ph = ip.x * 0.41 + ip.z * 0.27;
  float g = gustAt( ip.x );
  float base = sin( uTime * 0.795 + ph ) * 0.6 + sin( uTime * 1.698 + ph * 1.3 ) * 0.4;
  float amp = vk == 14 ? 0.5 : ( vk == 10 ? 0.5 : 1.0 );
  cwp.x += ( base * ( 0.011 + 0.022 * g ) + 0.022 * g * uGust.w ) * amp * hh * hh;
  cwp.z += sin( uTime * 0.61 + ph * 0.8 ) * 0.004 * amp * hh * hh;
}
#endif
vWPos = cwp.xyz;
if ( vk != 6 ) { float cdz = min( cwp.z - uCurveZ, 0.0 ); cwp.y -= uCurve * cdz * cdz; }
vec4 mvPosition = viewMatrix * cwp;
gl_Position = projectionMatrix * mvPosition;
// atmosphere colour for this vertex: the sky behind it on screen (output space)
vFogC = srgbOut( skyAt( gl_Position.xy / gl_Position.w ) );
${isFig ? "if ( FC.z <= 0.001 ) gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );" : ""}`);

    if (CHEAP_SHADOW_PARS) fs = fs.replace("#include <shadowmap_pars_fragment>", CHEAP_SHADOW_PARS);
    fs = fs.replace("#include <common>", /* glsl */ `#include <common>
uniform float uTime; uniform vec3 uRimCol; uniform float uRim;
uniform vec3 uWinA; uniform vec3 uWinB; uniform float uWinOn; uniform float uWinK; uniform float uGlassRefl;
uniform vec3 uLawn; uniform float uNight; uniform vec3 uWaterA; uniform vec3 uWaterB;
uniform float uPoleEm; uniform float uLampEm; uniform vec3 uCloudCol; uniform vec3 uCloudEm;
uniform vec2 uProj; uniform float uFogDensity; uniform float uFogStart; uniform float uFogMax;
uniform sampler2D uNoise; uniform float uPorch; uniform float uBackHue; uniform float uFigLift;
varying vec4 vSurf; varying vec3 vWPos; varying vec3 vFogC;
${isFig ? "varying float vVis;" : ""}
${SKY_GLSL}
`);

    fs = fs.replace("#include <color_fragment>", /* glsl */ `#include <color_fragment>
int kind = int( vSurf.z + 0.5 );
${isFig ? "if ( cHash( gl_FragCoord.xy * 0.73 ) > vVis ) discard;" : ""}
vec3 waterEm = vec3( 0.0 );
if ( kind == 1 || kind == 13 ) {
  float gn = texture2D( uNoise, vWPos.xz * 0.0065625 ).r;          // lattice 0.42 per unit
  float gn2 = texture2D( uNoise, vWPos.xz * 0.00171875 + 0.37 ).g; // lattice 0.11 per unit
  vec3 base = kind == 1 ? uLawn * diffuseColor.rgb : diffuseColor.rgb;
  base *= 0.94 + 0.12 * gn;
  base = mix( base, base * vec3( 1.04, 1.03, 0.92 ), gn2 * 0.45 );
  diffuseColor.rgb = base;
} else if ( kind == 2 ) {
  // the river mirrors the sky above it (same screen x), over a deep tint, with shimmer
  // bands stretched along x the way low-angle reflections streak (0.8 rad/s)
  vec2 wq = vWPos.xz;
  float wsA = texture2D( uNoise, wq * vec2( 0.014, 0.117 ) + vec2( uTime * 0.0044, uTime * 0.0025 ) ).b;
  float wsB = texture2D( uNoise, wq * vec2( 0.034, 0.203 ) - vec2( uTime * 0.0031, uTime * 0.0037 ) ).a;
  vec2 fn = gl_FragCoord.xy / uRes * 2.0 - 1.0;
  vec3 wc = mix( uWaterA, skyAt( vec2( fn.x, 0.5 ) ), 0.28 );
  float spark = smoothstep( 0.5, 0.8, wsA * wsB * 1.8 );
  wc = mix( wc, uWaterB, spark * 0.65 + 0.06 * wsA );
  float edge = vColor.r;                 // 1 mid-channel, darker toward the banks
  wc *= 0.42 + 0.58 * edge * edge;
  waterEm = wc * 0.62;
  diffuseColor.rgb = wc * 0.3;
} else if ( kind == 6 ) {
  diffuseColor.rgb = uCloudCol;
}
// night: grade the albedo toward its own luminance, keeping hue (saturation x0.6)
float albL = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
diffuseColor.rgb = mix( diffuseColor.rgb, vec3( albL ), 0.4 * uNight * ( kind == 6 || kind == 2 ? 0.0 : 1.0 ) );`);

    fs = fs.replace("#include <emissivemap_fragment>", /* glsl */ `#include <emissivemap_fragment>
float winLvl = vSurf.x;
if ( winLvl > 0.0 ) {
  float wh = fract( vSurf.w * 13.37 );
  float won = smoothstep( wh * 0.72, wh * 0.72 + 0.28, uWinOn );
  totalEmissiveRadiance += mix( uWinA, uWinB, fract( vSurf.w * 7.13 ) ) * winLvl * won * uWinK;
  diffuseColor.rgb *= 1.0 - 0.6 * won * min( winLvl, 1.0 );
}
if ( kind == 16 ) {
  // glass mirrors the (screen-anchored) sky in the reflected direction: the golden-hour
  // sunset reflection; a lit window shows its room instead
  vec3 wN = inverseTransformDirection( normal, viewMatrix );
  vec3 vdir = normalize( vWPos - cameraPosition );
  vec3 rr = reflect( vdir, wN );
  float rz = max( abs( rr.z ), 0.05 );
  vec2 rn = vec2( clamp( uProj.x / uAspect * rr.x / rz * 3.0, -1.4, 1.4 ), uProj.x * rr.y / max( length( rr.xz ), 0.05 ) - uProj.y );
  float offLit = 1.0 - clamp( winLvl * 1.6 * uWinOn, 0.0, 1.0 );
  totalEmissiveRadiance += skyAt( rn ) * uGlassRefl * offLit;
  diffuseColor.rgb *= 1.0 - uGlassRefl * 0.6 * offLit;
}
if ( kind == 2 ) totalEmissiveRadiance += waterEm;
else if ( kind == 11 ) totalEmissiveRadiance += diffuseColor.rgb * uPoleEm;
else if ( kind == 12 ) totalEmissiveRadiance += vec3( 1.0, 0.82, 0.55 ) * uLampEm * 1.2;
else if ( kind == 6 ) totalEmissiveRadiance += uCloudEm;
else if ( kind == 9 ) totalEmissiveRadiance += diffuseColor.rgb * uFigLift;
else if ( kind == 17 ) totalEmissiveRadiance += diffuseColor.rgb * 0.12 * uNight;
// porch light: warm falloff around the doorway (replaces a PointLight); the teal door
// takes only a quarter of it so it stays teal under the lamp
if ( uPorch > 0.001 && ( kind == 0 || kind == 8 || kind == 9 || kind == 18 ) ) {
  vec3 pq = vWPos - vec3( 0.0, 1.0, 1.7 );
  float pk = uPorch / ( 1.0 + dot( pq, pq ) * 2.4 );
  totalEmissiveRadiance += vec3( 1.0, 0.68, 0.38 ) * diffuseColor.rgb * pk * ( kind == 18 ? 0.22 : 0.85 );
}`);

    fs = fs.replace("#include <aomap_fragment>", /* glsl */ `#include <aomap_fragment>
float aoH = 0.5, aoMin = 0.62, rimK = 1.0;
if ( kind == 3 ) { aoMin = 1.0; rimK = 0.7; }
else if ( kind == 6 ) { aoMin = 1.0; rimK = 1.3; }
else if ( kind == 7 ) { aoH = 1.1; aoMin = 0.72; rimK = 1.2; }
else if ( kind == 10 ) { aoH = 1.0; aoMin = 0.75; rimK = 1.1; }
else if ( kind == 14 ) { aoH = 0.3; aoMin = 0.8; rimK = 0.8; }
else if ( kind == 1 || kind == 2 || kind == 8 || kind == 13 ) { aoMin = 1.0; rimK = 0.0; }
else if ( kind == 9 ) { aoH = 0.42; aoMin = 0.72; rimK = 1.25; }
float aoT = clamp( vWPos.y / aoH, 0.0, 1.0 );
aoT = aoT * aoT * ( 3.0 - 2.0 * aoT );
float aoF = mix( aoMin, 1.0, aoT );
reflectedLight.indirectDiffuse *= aoF;
reflectedLight.directDiffuse *= mix( 1.0, aoF, 0.45 );`);

    fs = fs.replace("#include <opaque_fragment>", /* glsl */ `
float cFr = 1.0 - clamp( dot( normal, normalize( vViewPosition ) ), 0.0, 1.0 );
outgoingLight += uRimCol * uRim * rimK * pow( cFr, 2.6 ) * ( 0.35 + 0.65 * diffuseColor.rgb );
// hue keeping: re-colour the lit result with the albedo's own hue at the lit luminance.
// Night foliage and lawn keep their greens and the gulmohar its coral; the far hills keep
// sage under the orange golden key (no khaki); the bus stays yellow under moonlight.
float hk = 0.0;
if ( kind == 7 || kind == 10 || kind == 1 || kind == 13 ) hk = ( kind == 1 ? 0.7 : 0.9 ) * uNight;
if ( kind == 3 || kind == 10 ) hk = max( hk, uBackHue );
if ( kind == 17 ) hk = 0.75 * uNight;
if ( hk > 0.0 ) {
  vec3 lw = vec3( 0.2126, 0.7152, 0.0722 );
  vec3 hueKept = diffuseColor.rgb / max( dot( diffuseColor.rgb, lw ), 1e-3 ) * dot( outgoingLight, lw );
  outgoingLight = mix( outgoingLight, hueKept, hk );
}
#include <opaque_fragment>`);

    fs = fs.replace("#include <fog_fragment>", /* glsl */ `
{
  float fogK = 1.0;
  if ( kind == 3 ) fogK = 1.6; else if ( kind == 6 ) fogK = 0.2; else if ( kind == 10 ) fogK = 1.3; else if ( kind == 1 ) fogK = 0.55;
  float fd = length( vWPos - cameraPosition );
  float fogA = clamp( ( 1.0 - exp( -max( fd - uFogStart, 0.0 ) * uFogDensity ) ) * fogK, 0.0, uFogMax );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, vFogC, fogA );
}`);

    sh.vertexShader = vs;
    sh.fragmentShader = fs;
  };
  return m;
}
