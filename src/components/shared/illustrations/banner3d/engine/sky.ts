// The sky: one full-screen triangle at depth 1.0, drawn LAST among the opaques with the
// depth test on, so early-z skips every covered pixel and stars can never land on the
// hills, clouds or the flag. Screen-anchored three-stop gradient, sun or moon disc,
// sparse stars. Plus the birds (a V of five, flap in the vertex shader).
import { BufferAttribute, BufferGeometry, Color, DoubleSide, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, ShaderMaterial, Vector3, Vector4 } from "three";
import type { IUniform, Vector2 } from "three";
import { SKY_GLSL } from "./materials";

/** The shared uniforms SKY_GLSL's skyAt() reads, plus uTime (a structural slice of createShared()). */
export interface SkyUniforms {
  uTime: IUniform<number>;
  uSkyHor: IUniform<Color>;
  uSkyMid: IUniform<Color>;
  uSkyTop: IUniform<Color>;
  uGlowCol: IUniform<Color>;
  uGlowAmt: IUniform<number>;
  uGlowSize: IUniform<number>;
  uDisc: IUniform<Vector2>;
  uAspect: IUniform<number>;
  uRes: IUniform<Vector2>;
}

export function createSky(U: SkyUniforms) {
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const own = {
    uDiscCol: { value: new Color() }, uDiscSize: { value: 0.08 }, uDiscAmt: { value: 1 }, uMoon: { value: 0 },
    uStars: { value: 0 }, uStarT: { value: 0.955 }, uStarR: { value: 1 }, uDpr: { value: 1 },
    // CSS px, from the top-left: the flag's box (plus pole) that stars keep clear of
    uFlagBox: { value: new Vector4(0, 0, 0, 0) },
  };
  const mat = new ShaderMaterial({
    uniforms: {
      uTime: U.uTime, uSkyHor: U.uSkyHor, uSkyMid: U.uSkyMid, uSkyTop: U.uSkyTop, uGlowCol: U.uGlowCol,
      uGlowAmt: U.uGlowAmt, uGlowSize: U.uGlowSize, uDisc: U.uDisc, uAspect: U.uAspect, uRes: U.uRes, ...own,
    },
    depthTest: true, depthWrite: false, toneMapped: false,
    vertexShader: /* glsl */ `void main() { gl_Position = vec4( position.xy, 1.0, 1.0 ); }`,
    fragmentShader: /* glsl */ `
      ${SKY_GLSL}
      uniform float uTime; uniform vec3 uDiscCol; uniform float uDiscSize; uniform float uDiscAmt; uniform float uMoon;
      uniform float uStars; uniform float uStarT; uniform float uStarR; uniform float uDpr; uniform vec4 uFlagBox;
      float crater( vec2 q, vec2 c, float r ) { return 1.0 - smoothstep( r * 0.55, r, length( q - c ) ); }
      void main() {
        vec2 ndc = gl_FragCoord.xy / uRes * 2.0 - 1.0;
        vec3 col = skyAt( ndc );
        vec2 p = vec2( ndc.x * uAspect, ndc.y ), c = vec2( uDisc.x * uAspect, uDisc.y );
        float d = length( p - c );
        if ( uStars > 0.001 ) {
          // sparse stars on a 6 CSS px grid; twinkle +-25% over 4 to 15 s. Density and size
          // scale with the aspect (uStarT, uStarR: fewer, finer stars on the phone). None in
          // the 20 px top corner squares or within 10 px of the flag and its pole.
          vec2 css = gl_FragCoord.xy / uDpr;
          vec2 cssT = vec2( css.x, uRes.y / uDpr - css.y ); // from the top-left
          float cssW = uRes.x / uDpr;
          vec2 id = floor( css / 6.0 );
          vec2 f = css - id * 6.0;
          float h = cHash( id );
          bool corner = cssT.y < 22.0 && ( cssT.x < 22.0 || cssT.x > cssW - 22.0 );
          bool nearFlag = cssT.x > uFlagBox.x - 10.0 && cssT.x < uFlagBox.z + 10.0 && cssT.y > uFlagBox.y - 10.0 && cssT.y < uFlagBox.w + 10.0;
          if ( h > uStarT && !corner && !nearFlag ) {
            vec2 o = vec2( cHash( id + 3.1 ), cHash( id + 7.7 ) ) * 4.0 + 1.0;
            float big = step( 0.88, cHash( id + 1.7 ) ) * step( 0.8, uStarR );
            float rad = ( mix( 0.42, 0.75, cHash( id + 2.3 ) ) + big * 0.4 ) * uStarR;
            float per = mix( 4.0, 15.0, cHash( id + 5.1 ) );
            float tw = 1.0 + 0.25 * sin( uTime * 6.2832 / per + h * 40.0 );
            float s = ( 1.0 - smoothstep( rad - 0.3, rad + 0.6, length( f - o ) ) ) * tw;
            s *= smoothstep( -0.15, 0.35, ndc.y ) * smoothstep( 0.1, 0.42, d );
            col += vec3( 1.0, 0.96, 0.88 ) * s * uStars * ( 0.55 + 0.35 * big );
          }
        }
        float px = 2.0 / uRes.y;
        float disc = 1.0 - smoothstep( uDiscSize - px * 1.3, uDiscSize + px * 1.3, d );
        vec3 dc = uDiscCol;
        if ( uMoon > 0.5 ) {
          vec2 q = ( p - c ) / uDiscSize;
          float cr = crater( q, vec2( -0.3, 0.25 ), 0.26 ) + crater( q, vec2( 0.32, -0.12 ), 0.2 ) + crater( q, vec2( -0.05, -0.45 ), 0.16 ) + crater( q, vec2( 0.28, 0.45 ), 0.12 );
          dc *= 1.0 - 0.1 * clamp( cr, 0.0, 1.0 );
          dc *= 0.9 + 0.1 * clamp( dot( q, vec2( 0.6, 0.6 ) ) + 0.5, 0.0, 1.0 );
        } else {
          col += uDiscCol * uDiscAmt * 0.18 * exp( -max( d - uDiscSize, 0.0 ) / ( uDiscSize * 0.35 ) );
        }
        if ( uMoon < 0.5 ) dc = max( dc, col + 0.07 );
        col = mix( col, dc, disc * uDiscAmt );
        gl_FragColor = vec4( col, 1.0 );
        #include <colorspace_fragment>
        gl_FragColor.rgb += ( cHash( gl_FragCoord.xy ) - 0.5 ) / 255.0;
      }`,
  });
  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1e6;
  return { mesh, own };
}

// A V of five, flapping at 0.9 Hz with a 0.07 Hz glide envelope; one draw.
export function createBirds(U: SkyUniforms) {
  const pos: number[] = [], w: number[] = [];
  const tri = (a: readonly number[], b: readonly number[], c: readonly number[], wa: number, wb: number, wc: number) => { pos.push(...a, ...b, ...c); w.push(wa, wb, wc); };
  for (const s of [-1, 1]) {
    tri([0, 0.03, 0], [0, -0.03, 0], [s * 0.3, 0.06, 0], 0, 0, 0.4);
    tri([s * 0.3, 0.06, 0], [s * 0.26, 0.015, 0], [s * 0.62, 0.02, 0], 0.4, 0.4, 1);
  }
  tri([-0.06, 0, 0], [0.06, 0, 0], [0, -0.07, 0], 0, 0, 0);
  const geo = new InstancedBufferGeometry();
  geo.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute("aW", new BufferAttribute(new Float32Array(w), 1));
  const V = [[0, 0, 0], [-0.9, -0.3, 0.4], [0.9, -0.34, 1.1], [-1.8, -0.62, 1.7], [1.75, -0.66, 2.3]];
  geo.setAttribute("aOff", new InstancedBufferAttribute(new Float32Array(V.flat()), 3));
  geo.instanceCount = V.length;
  const uFlock = { value: new Vector3() }, uBirdCol = { value: new Color() }, uBirdAmt = { value: 1 };
  const mat = new ShaderMaterial({
    uniforms: { uTime: U.uTime, uFlock, uBirdCol, uBirdAmt, uRes: U.uRes, uSkyHor: U.uSkyHor, uSkyMid: U.uSkyMid, uSkyTop: U.uSkyTop, uGlowCol: U.uGlowCol, uGlowAmt: U.uGlowAmt, uGlowSize: U.uGlowSize, uDisc: U.uDisc, uAspect: U.uAspect },
    side: DoubleSide, toneMapped: false,
    vertexShader: /* glsl */ `
      attribute float aW; attribute vec3 aOff;
      uniform float uTime; uniform vec3 uFlock; uniform float uBirdAmt;
      void main() {
        vec3 p = position * 1.3;
        float ph = aOff.z;
        float glide = 0.35 + 0.65 * smoothstep( -0.3, 0.6, sin( uTime * 0.44 + ph * 1.7 ) );
        float flap = sin( uTime * 5.65 + ph * 6.2831 ) * glide;
        p.y += flap * ( 0.2 * aW + 0.12 * aW * aW ) * 1.3;
        vec3 wp = uFlock + vec3( aOff.x * 1.2, aOff.y * 1.1 + 0.08 * sin( uTime * 0.8 + ph ), 0.0 ) + p;
        gl_Position = projectionMatrix * viewMatrix * vec4( wp, 1.0 );
        if ( uBirdAmt < 0.02 ) gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );
      }`,
    fragmentShader: /* glsl */ `
      ${SKY_GLSL}
      uniform vec3 uBirdCol; uniform float uBirdAmt;
      void main() {
        vec3 sky = skyAt( gl_FragCoord.xy / uRes * 2.0 - 1.0 );
        gl_FragColor = vec4( mix( sky, uBirdCol, 0.72 * uBirdAmt ), 1.0 );
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false;
  return { mesh, uFlock, uBirdCol, uBirdAmt };
}
