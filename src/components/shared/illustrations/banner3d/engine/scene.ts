// createSchoolScene(canvas, opts): the engine. No document or window listeners, no
// document writes, per-instance uniforms only. The host (Banner3DLayer in production,
// index.html in the lab) owns visibility, intersection, resize and pointer observers and
// calls start / stop / setVisible / resize / setPointer / setTod.
import {
  BufferAttribute, BufferGeometry, DirectionalLight, HemisphereLight, Line, LineBasicMaterial,
  Mesh, NeutralToneMapping, PCFShadowMap, PerspectiveCamera, SRGBColorSpace, Scene, Timer,
  Vector3, WebGLRenderer,
} from "three";
import type { IUniform, InstancedMesh, Material, Object3D, Texture } from "three";
import { clayMaterial, createShared } from "./materials";
import { PALETTES, clockParts, copyState, lerpState, newState } from "./palettes";
import { applyCamera, createFrame, halfWidthAt, projectCss, setupProjection, solveFraming, yForNdc, FINIAL } from "./framing";
import { buildClouds, buildFoliage, buildStatic, TREES } from "./world";
import { F, STILL_T, createFigures } from "./figures";
import { FLAG_H, FLAG_W, FLAG_YAW, FLAG_CENTER_Y, createFlag, flagScaleFor } from "./flag";
import { createBirds, createSky } from "./sky";
import { createGlows, createSoft } from "./glows";
import type { CreateSchoolScene, SceneOptions, SceneStats, SceneTod, SchoolScene, ScreenBox, ScreenProbe } from "./types";

const TAU = Math.PI * 2;
const smooth01 = (x: number) => x * x * (3 - 2 * x);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const wrap = (x: number, L: number) => x - Math.floor((x + L) / (2 * L)) * 2 * L;
const ABORT = { abort: true }; // thrown between build phases when the build was cancelled
type Abort = typeof ABORT;
function yieldToMain(): Promise<void> {
  const g = globalThis as unknown as { scheduler?: { yield?: () => Promise<void> } };
  if (typeof g.scheduler !== "undefined" && typeof g.scheduler.yield === "function") return g.scheduler.yield();
  return new Promise<void>((r) => setTimeout(r, 0));
}

// The sibling builders' own return types (inferred there), so this file never restates them.
type World = Awaited<ReturnType<typeof buildStatic>>;
type Foliage = ReturnType<typeof buildFoliage>;
type Clouds = ReturnType<typeof buildClouds>;
type Figures = ReturnType<typeof createFigures>;
type Flag = ReturnType<typeof createFlag>;
type Sky = ReturnType<typeof createSky>;
type Birds = ReturnType<typeof createBirds>;
type Glows = ReturnType<typeof createGlows>;
type Soft = ReturnType<typeof createSoft>;
// What freeGpu() reads off an arbitrary scene node and its materials.
type Disposable3D = Object3D & { isInstancedMesh?: boolean; geometry?: BufferGeometry; material?: Material | Material[] };
type DisposableMaterial = Material & { uniforms?: Record<string, IUniform>; map?: Texture | null };

// Draw order (opaque, early-z friendly): the big occluders first, the ground under them
// last, the sky after everything.
const ORDER = { CASTERS: 0, FOLIAGE: 1, FIGURES: 2, RECEIVERS: 3, FLAG: 5, BIRDS: 6 };

export const createSchoolScene: CreateSchoolScene = (canvas, opts = {}) => {
  const o: Required<SceneOptions> = {
    tod: "midday", motion: "live", timeZone: "Asia/Kolkata", governorMs: 60, antialias: true,
    onFirstFrame() {}, onContextLost() {}, onContextRestored() {}, onGovernor() {}, ...opts,
  };
  const fr = createFrame();
  const U = createShared();
  const cur = newState(), from = newState();
  let to = PALETTES[o.tod] || PALETTES.midday;
  copyState(cur, to);
  let tod: SceneTod = PALETTES[o.tod] ? o.tod : "midday";
  let fadeT = 1, fadeDur = 1, swapped = true;

  let renderer: WebGLRenderer | null = null, scene: Scene | null = null, camera: PerspectiveCamera | null = null;
  let sun: DirectionalLight | null = null, hemi: HemisphereLight | null = null, fill: DirectionalLight | null = null;
  let world: World | null = null, foliage: Foliage | null = null, clouds: Clouds | null = null, figures: Figures | null = null;
  let flag: Flag | null = null, sky: Sky | null = null, birds: Birds | null = null, glows: Glows | null = null, soft: Soft | null = null;
  let kiteLine: Line<BufferGeometry, LineBasicMaterial> | null = null, kitePos: Float32Array | null = null;
  let built = false, disposed = false, running = false, raf = 0, firstDone = false, lostCtx = false;
  let hostVisible = true, frameDirty = false;
  let compilePending: Promise<void> | null = null, abortResolve: ((v: Abort) => void) | null = null;
  let dpr = 1, cssW = 0, cssH = 0, sized = false;
  let simT = STILL_T[tod], timeBase = 0;
  let lastRender = 0, shadowDirty = true;
  let clockTimer: ReturnType<typeof setTimeout> | undefined = undefined;
  const timer = new Timer();
  const pointer = { tx: 0, ty: 0, x: 0, y: 0 };
  const quality = { shadows: true };
  // stats (preallocated rings)
  const ringN = 60, cpuRing = new Float32Array(ringN), ivRing = new Float32Array(ringN);
  let ringI = 0, ringFill = 0;
  const st = { calls: 0, triangles: 0, steadyCalls: 0, steadyTris: 0, refreshCalls: 0, refreshTris: 0, frames: 0, shadowRefreshes: 0 };
  // governor (section 3.3): median rendered-frame interval over 60 frames
  const gov = { level: 0, n: 0, done: false, buf: new Float32Array(60), sorted: new Float32Array(60) };
  const keyDir = new Vector3(), shadowDir = { x: -1, z: 0, k: 1 };
  const shadowTarget = new Vector3(0, 0, 0.6);
  const corners: Vector3[] = [];
  for (let i = 0; i < 8; i++) corners.push(new Vector3());
  const tmpP = { x: 0, y: 0 };
  const listeners: Array<[string, EventListener]> = [];

  /* ------------------------------------------------------------ build */
  async function build(signal?: AbortSignal): Promise<void> {
    const aborted = () => disposed || !!(signal && signal.aborted);
    if (aborted()) { dispose(); return; }
    const abortP = new Promise<Abort>((r) => { abortResolve = r; });
    const onAbort = () => { if (abortResolve) abortResolve(ABORT); };
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
    const pause = async () => { await yieldToMain(); if (aborted()) throw ABORT; };
    try {
      await buildPhases(pause, aborted, abortP);
    } catch (e) {
      dispose();
      if (e !== ABORT) throw e;
    } finally {
      if (signal) signal.removeEventListener("abort", onAbort);
      abortResolve = null;
    }
  }

  async function buildPhases(pause: () => Promise<void>, aborted: () => boolean, abortP: Promise<Abort>): Promise<void> {
    // phase 1: renderer
    try {
      renderer = new WebGLRenderer({ canvas, antialias: o.antialias !== false, alpha: false, stencil: false, powerPreference: "low-power" });
    } catch (e) {
      const err = e as { message?: string } | null;
      throw new Error("webgl-unavailable: " + (err && err.message));
    }
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = NeutralToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;
    renderer.shadowMap.autoUpdate = false; // static map: refreshed on tod change, resize, context restore
    renderer.info.autoReset = false; // whole-frame counts (shadow pass included)
    const onLost = () => { lostCtx = true; stopLoop(); o.onContextLost(); };
    const onRestored = () => { restore(); };
    canvas.addEventListener("webglcontextlost", onLost, false);
    canvas.addEventListener("webglcontextrestored", onRestored, false);
    listeners.push(["webglcontextlost", onLost], ["webglcontextrestored", onRestored]);

    scene = new Scene();
    // nothing moves by its object matrix per frame: skip three's per-frame world-matrix
    // walk (the few objects that do change call updateMatrixWorld themselves). The camera
    // keeps auto-update: in r186 matrixWorldAutoUpdate=false also blocks an object's own
    // updateMatrixWorld(), and the camera moves every frame.
    scene.matrixWorldAutoUpdate = false;
    camera = new PerspectiveCamera(10, 6.6, 5, 220);
    await pause();

    // phase 2: lights and the static world (built in sections, yielding between them)
    hemi = new HemisphereLight("#ffffff", "#ffffff", 1);
    sun = new DirectionalLight("#ffffff", 2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.04;
    sun.target.position.copy(shadowTarget);
    fill = new DirectionalLight("#ffffff", 0.3);
    fill.position.set(0, 12, 40);
    scene.add(hemi, sun, sun.target, fill);

    const matStatic = clayMaterial(U, "static");
    world = await buildStatic(pause);
    const casters = new Mesh(world.casters, matStatic);
    casters.castShadow = true; casters.receiveShadow = true;
    casters.renderOrder = ORDER.CASTERS;
    const receivers = new Mesh(world.receivers, matStatic);
    receivers.receiveShadow = true;
    receivers.renderOrder = ORDER.RECEIVERS;
    casters.frustumCulled = receivers.frustumCulled = false;
    scene.add(casters, receivers);
    U.uBoat.value.fromArray(world.geomInfo.boat);
    sky = createSky(U);
    scene.add(sky.mesh);
    await pause();

    // phase 3: foliage and clouds (one instanced program)
    const matInst = clayMaterial(U, "inst");
    foliage = buildFoliage(matInst);
    for (const m of foliage.meshes) { m.renderOrder = ORDER.FOLIAGE; scene.add(m); }
    clouds = buildClouds(matInst);
    clouds.mesh.renderOrder = ORDER.FOLIAGE;
    scene.add(clouds.mesh);
    await pause();

    // phase 4: figures, flag, glows, soft quads, birds, kite string
    figures = createFigures((figU) => clayMaterial(U, "fig", figU));
    figures.env.frame = fr;
    figures.env.stillT = STILL_T[tod];
    figures.mesh.renderOrder = ORDER.FIGURES;
    scene.add(figures.mesh);
    flag = createFlag(U);
    flag.mesh.renderOrder = ORDER.FLAG;
    scene.add(flag.mesh);
    glows = createGlows(U, world.glowSpots);
    scene.add(glows.mesh);
    const mist = [{ z: -7.9, w: 280, h: 1.3, a: 0.35 }, { z: -14.6, w: 280, h: 1.9, a: 0.85 }, { z: -22.6, w: 280, h: 3.5, a: 1 }, { z: -35.2, w: 300, h: 5.6, a: 0.95 }];
    soft = createSoft(U, world.blobs.concat(foliage.blobs.map((b) => [b[0], b[1], b[2], b[3], 0.55])), mist, 24);
    scene.add(soft.mesh);
    birds = createBirds(U);
    birds.mesh.renderOrder = ORDER.BIRDS;
    scene.add(birds.mesh);
    kitePos = new Float32Array(15 * 3);
    const lg = new BufferGeometry();
    lg.setAttribute("position", new BufferAttribute(kitePos, 3));
    kiteLine = new Line(lg, new LineBasicMaterial({ color: "#6d6a86", transparent: true, opacity: 0.6, toneMapped: false }));
    kiteLine.frustumCulled = false;
    kiteLine.renderOrder = 25;
    scene.add(kiteLine);
    figures.setCast(tod, true, simT);

    resizeInternal(cssW || canvas.clientWidth || 1166, cssH || canvas.clientHeight || 176, dpr || 1);
    applyState();
    const appliedTod = tod;
    scene.updateMatrixWorld(true);
    await pause();
    // compile everything off the main thread where supported (compileAsync visits only
    // visible objects; everything is visible here). A dispose during the compile defers
    // the GPU release until three's readiness polling has finished.
    compilePending = renderer.compileAsync(scene, camera).catch(() => {}).then(() => { compilePending = null; });
    const r = await Promise.race([compilePending, abortP]);
    if (r === ABORT || aborted()) throw ABORT;
    built = true;
    if (tod !== appliedTod) {
      // setTod() during the yield or the compile above moved only `cur` and `tod`
      // (its unbuilt path): bring the uniforms and the cast up to the new moment
      applyState();
      figures.setCast(tod, true, simT);
      trimInstances();
    }
    refreshVisibility();
    updateClock();
    // first frame at the composed still pose
    simT = STILL_T[tod];
    timeBase = 0;
    figures.env.stillT = simT;
    renderNow();
  }

  /* -------------------------------------------------------- state */
  function applyState(): void {
    const s = cur;
    U.uSkyHor.value.copy(s.skyHor); U.uSkyMid.value.copy(s.skyMid); U.uSkyTop.value.copy(s.skyTop);
    U.uGlowCol.value.copy(s.glowCol); U.uGlowAmt.value = s.glowAmt; U.uGlowSize.value = s.glowSize;
    U.uDisc.value.set(s.disc[0], s.disc[1]);
    sky.own.uDiscCol.value.copy(s.discCol); sky.own.uDiscSize.value = s.discSize; sky.own.uDiscAmt.value = s.discAmt;
    sky.own.uMoon.value = s.moon; sky.own.uStars.value = s.stars * s.stars * s.stars;
    keyDir.set(s.keyDir[0], s.keyDir[1], s.keyDir[2]).normalize();
    sun.position.copy(shadowTarget).addScaledVector(keyDir, 60);
    sun.updateMatrixWorld();
    sun.color.copy(s.keyCol); sun.intensity = s.keyInt;
    sun.shadow.intensity = quality.shadows ? s.shadowInt : 0; sun.shadow.radius = s.shadowRadius;
    hemi.color.copy(s.hemiSky); hemi.groundColor.copy(s.hemiGround); hemi.intensity = s.hemiInt;
    fill.color.copy(s.fillCol); fill.intensity = s.fillInt;
    U.uPorch.value = s.porch; U.uBackHue.value = s.backHue; U.uFigLift.value = s.figLift;
    U.uRimCol.value.copy(s.rimCol); U.uRim.value = s.rim;
    U.uFogDensity.value = s.fogDensity; U.uFogStart.value = s.fogStart; U.uFogMax.value = s.fogMax;
    U.uLawn.value.copy(s.lawn); U.uNight.value = s.night; U.uGlassRefl.value = s.glass;
    U.uWaterA.value.copy(s.waterA); U.uWaterB.value.copy(s.waterB);
    U.uCloudCol.value.copy(s.cloudCol); U.uCloudEm.value.copy(s.cloudEm);
    U.uWinOn.value = s.winOn; U.uPoleEm.value = s.poleEm; U.uLampEm.value = s.lamps;
    soft.uMistCol.value.copy(s.mistCol); soft.uMistA.value = s.mistAmt;
    soft.uBlobCol.value.copy(s.blobCol); soft.uBlobA.value = s.blobAlpha;
    birds.uBirdCol.value.copy(s.birdCol); birds.uBirdAmt.value = s.birds;
    glows.uG1.value.set(s.winOn > 0.001 ? 1 : 0, s.lamps, s.porch, s.flood);
    glows.uG2.value.set(s.flies * s.flies * s.flies, s.motes, 0, 0);
    // contact shadows stretch away from the key light (about 3x the figure height at golden)
    const g = Math.hypot(keyDir.x, keyDir.z) || 1;
    shadowDir.x = -keyDir.x / g; shadowDir.z = -keyDir.z / g;
    shadowDir.k = Math.min(3.0, 1 / Math.tan(Math.asin(Math.min(0.999, keyDir.y))));
    if (built) refreshVisibility();
  }
  function refreshVisibility(): void {
    const s = cur;
    glows.mesh.visible = s.winOn > 0.002 || s.lamps > 0.002 || s.porch > 0.002 || s.flood > 0.002 || s.flies > 0.002 || s.motes > 0.002;
    birds.mesh.visible = s.birds > 0.02;
  }

  function setTod(next: SceneTod, fadeMs = 0): void {
    if (!PALETTES[next] || disposed) return;
    const same = next === tod;
    tod = next;
    to = PALETTES[next];
    if (!built) { copyState(cur, to); fadeT = 1; return; }
    const reduced = o.motion === "still" || !running;
    if (fadeMs <= 0 || reduced) {
      copyState(cur, to); fadeT = 1; swapped = true;
      applyState();
      figures.setCast(tod, true, simT);
      if (reduced) { simT = STILL_T[tod]; timeBase = 0; figures.env.stillT = simT; }
      shadowDirty = true;
      trimInstances();
      requestFrame();
      return;
    }
    if (same && fadeT >= 1) return;
    copyState(from, cur);
    fadeT = 0; fadeDur = Math.max(0.05, fadeMs / 1000); swapped = false;
    figures.setCast(tod, false, simT);
  }

  function stepFade(dt: number): void {
    if (fadeT >= 1) return;
    fadeT = Math.min(1, fadeT + dt / fadeDur);
    const k = smooth01(fadeT);
    lerpState(cur, from, to, k);
    const dip = Math.abs(1 - 2 * k);
    cur.discAmt = (k < 0.5 ? from.discAmt : to.discAmt) * dip;
    cur.glowAmt *= 0.4 + 0.6 * dip;
    cur.shadowInt = 0.2 + (cur.shadowInt - 0.2) * dip; // dips to 0.2 at the midpoint, reads as a passing cloud
    cur.keyInt *= 0.75 + 0.25 * dip;
    if (!swapped && k >= 0.5) { swapped = true; shadowDirty = true; trimInstances(); }
    applyState();
  }

  /* ------------------------------------------------------- resize */
  // Returns false when nothing changed (a ResizeObserver's first callback, a repeated
  // size): no re-render and no shadow-map refresh for a no-op.
  function resizeInternal(w: number, h: number, pixelRatio: number): boolean {
    w = Math.max(1, w); h = Math.max(1, h);
    if (sized && renderer && w === cssW && h === cssH && pixelRatio === dpr) return false;
    cssW = w; cssH = h; dpr = pixelRatio;
    solveFraming(fr, cssW, cssH);
    if (!renderer) return true;
    sized = true;
    renderer.setPixelRatio(dpr);
    renderer.setSize(cssW, cssH, false);
    setupProjection(camera, fr);
    applyCamera(camera, fr, 0, 0);
    U.uAspect.value = fr.aspect;
    U.uRes.value.set(Math.round(cssW * dpr), Math.round(cssH * dpr));
    U.uProj.value.set(fr.F, fr.s);
    if (flag) {
      const k = flagScaleFor(fr.t);
      flag.mesh.scale.set(k, k, 1);
      flag.mesh.updateMatrixWorld();
    }
    if (sky) {
      sky.own.uDpr.value = dpr;
      sky.own.uStarT.value = lerp(0.976, 0.955, fr.t);
      sky.own.uStarR.value = lerp(0.7, 1.0, fr.t);
      const fb = flagBox();
      sky.own.uFlagBox.value.set(fb.x0, fb.y0, fb.x1, fb.y1);
    }
    shadowDirty = true;
    trimInstances();
    return true;
  }
  function resize(w: number, h: number, pixelRatio = 1): void {
    if (resizeInternal(w, h, pixelRatio)) requestFrame();
  }

  // Instances are sorted by |x|; draw only what can be on screen (plus the reach of the
  // longest shadow, so an off-screen tree can still throw its golden shadow into view).
  function trimInstances(): void {
    if (!foliage) return;
    const reach = 2 + Math.min(10, 2.6 * shadowDir.k);
    for (const m of foliage.meshes) {
      const xs = m.userData.xs as number[][]; // [x, z, radius] per instance, set by buildFoliage
      let n = 0;
      for (let i = 0; i < xs.length; i++) if (Math.abs(xs[i][0]) - xs[i][2] < halfWidthAt(fr, xs[i][1]) + reach) n = i + 1;
      m.count = n;
    }
  }

  function fitShadow(): void {
    const hw = halfWidthAt(fr, -4) + 2.5;
    const sc = sun.shadow.camera;
    sun.updateMatrixWorld();
    sc.position.copy(sun.position);
    sc.lookAt(shadowTarget);
    sc.updateMatrixWorld();
    let i = 0;
    for (const x of [-hw, hw]) for (const y of [0, 5.2]) for (const z of [-7, 5.5]) corners[i++].set(x, y, z).applyMatrix4(sc.matrixWorldInverse);
    let l = Infinity, r = -Infinity, b = Infinity, t = -Infinity, n = Infinity, f = -Infinity;
    for (const c of corners) { l = Math.min(l, c.x); r = Math.max(r, c.x); b = Math.min(b, c.y); t = Math.max(t, c.y); n = Math.min(n, -c.z); f = Math.max(f, -c.z); }
    sc.left = l; sc.right = r; sc.bottom = b; sc.top = t;
    sc.near = Math.max(0.5, n - 30); sc.far = f + 5;
    sc.updateProjectionMatrix();
  }

  /* ------------------------------------------------------- animate */
  function updateScene(t: number, dt: number, live: boolean): void {
    // GPU time is rebased (see start()) so sin(uTime * k) never loses float precision
    U.uTime.value = t - timeBase;
    // camera: pure translation drift + eased pointer parallax (lens shift keeps the school put)
    let ox = 0, oy = 0;
    if (live) {
      pointer.x += (pointer.tx - pointer.x) * Math.min(1, dt * 2.5);
      pointer.y += (pointer.ty - pointer.y) * Math.min(1, dt * 2.5);
      ox = 0.45 * Math.sin((TAU * t) / 96) + 0.12 * Math.sin((TAU * t) / 41 + 1.1) + pointer.x * 0.7;
      oy = 0.03 * Math.sin((TAU * t) / 57) - pointer.y * 0.25;
    }
    applyCamera(camera, fr, ox, oy);
    figures.update(t, dt);
    // clouds drift +x with the wind and wrap far outside any frame
    const CL = clouds.CLOUDS;
    for (let i = 0; i < CL.length; i++) {
      const c = CL[i];
      const z = fr.camZ - c.dist;
      const x = wrap(c.x0 + c.v * t, clouds.WRAP);
      let s = c.s;
      if (i % 2 === 1) s *= cur.cloudExtra;
      setInst(clouds.mesh, i, x, yForNdc(fr, c.ny, z), z, s, s * 0.8 * cur.cloudFlat, s);
    }
    clouds.mesh.instanceMatrix.needsUpdate = true;
    // birds: a V drifting +x at 0.9 u/s from a per-mode anchor (retired at dusk and night)
    if (birds.mesh.visible) {
      const bz = -18, hw = halfWidthAt(fr, bz), L = hw + 4;
      birds.uFlock.value.set(wrap(cur.birdAt[0] * hw + 0.9 * (t - figures.env.stillT), L), yForNdc(fr, cur.birdAt[1], bz), bz);
    }
    // kite string
    const ks = figures.kiteState;
    kiteLine.visible = ks.on;
    if (ks.on) {
      for (let i = 0; i < 15; i++) {
        const q = i / 14;
        kitePos[i * 3] = ks.hx + (ks.tx - ks.hx) * q;
        kitePos[i * 3 + 1] = ks.hy + (ks.ty - ks.hy) * q - 0.5 * q * (1 - q) * (1 - 0.3 * q);
        kitePos[i * 3 + 2] = ks.hz + (ks.tz - ks.hz) * q;
      }
      kiteLine.geometry.attributes.position.needsUpdate = true;
    }
    writeFigureBlobs();
  }

  function setInst(mesh: InstancedMesh, i: number, x: number, y: number, z: number, sx: number, sy: number, sz: number): void {
    const e = mesh.instanceMatrix.array, k = i * 16;
    e[k] = sx; e[k + 1] = 0; e[k + 2] = 0; e[k + 3] = 0;
    e[k + 4] = 0; e[k + 5] = sy; e[k + 6] = 0; e[k + 7] = 0;
    e[k + 8] = 0; e[k + 9] = 0; e[k + 10] = sz; e[k + 11] = 0;
    e[k + 12] = x; e[k + 13] = y; e[k + 14] = z; e[k + 15] = 1;
  }

  function writeFigureBlobs(): void {
    const A = soft.aA, B = soft.aB, xz = figures.figXZ, vis = figures.vis, FA = figures.A;
    let j = soft.dynStart;
    const end = soft.dynStart + soft.dynCount;
    const rot = Math.atan2(shadowDir.z, shadowDir.x);
    for (let i = 0; i < 11 && j < end - 1; i++) {
      const type = xz[i * 3 + 2];
      if (type === 0 || vis[i] < 0.05) continue;
      let x = xz[i * 3];
      const z = xz[i * 3 + 1];
      let s = 0.45, h = 0.8, a = vis[i];
      if (i <= F.P) { s = 0.6; h = 1.1; }
      if (type === 2) {
        // the ball's shadow grows and fades as it rises
        const by = Math.max(0, FA[i].y - 0.1);
        s = 0.26 * (1 + 0.45 * by); h = 0.12; a *= 1 - 0.6 * Math.min(1, by / 1.1);
      } else if (type === 3) { s = i === F.SWING ? 1.0 : 0.45; h = i === F.SWING ? 0.9 : 0.6; }
      else if (type === 4) { x = -10.1; s = 0.4; h = 0.3; }
      A[j * 4] = x; A[j * 4 + 1] = 0.064; A[j * 4 + 2] = z; A[j * 4 + 3] = 0;
      // the view grazes the ground at about 9 degrees, so ground footprints are drawn deep in z
      B[j * 4] = s; B[j * 4 + 1] = s * 1.35; B[j * 4 + 2] = 0; B[j * 4 + 3] = a; j++;
      const L = shadowDir.k * h;
      if (L > 0.2) {
        A[j * 4] = x + shadowDir.x * L * 0.5; A[j * 4 + 1] = 0.063; A[j * 4 + 2] = z + shadowDir.z * L * 0.5; A[j * 4 + 3] = rot;
        B[j * 4] = L + s * 0.35; B[j * 4 + 1] = s * 1.0; B[j * 4 + 2] = 0; B[j * 4 + 3] = a * 0.8; j++;
      }
    }
    for (; j < end; j++) B[j * 4] = 0;
    // upload only the 24-instance dynamic tail, not the whole buffer
    soft.attA.updateRanges.push(soft.rangeA); soft.attA.needsUpdate = true;
    soft.attB.updateRanges.push(soft.rangeB); soft.attB.needsUpdate = true;
  }

  function renderNow(): void {
    if (!built || lostCtx || !renderer) return;
    frameDirty = false;
    const c0 = performance.now();
    updateScene(simT, 0, false);
    draw();
    recordCpu(performance.now() - c0);
    firstFrame();
  }
  // A one-off frame for a stopped loop: rendered now if the banner is visible, otherwise
  // deferred to the next setVisible(true) or start().
  function requestFrame(): void {
    if (!built || lostCtx || running || disposed) return;
    if (hostVisible) renderNow(); else frameDirty = true;
  }
  function draw(): void {
    renderer.info.reset();
    const refresh = shadowDirty && quality.shadows;
    if (refresh) { fitShadow(); renderer.shadowMap.needsUpdate = true; shadowDirty = false; st.shadowRefreshes++; }
    renderer.render(scene, camera);
    st.calls = renderer.info.render.calls; st.triangles = renderer.info.render.triangles; st.frames++;
    if (refresh) { st.refreshCalls = st.calls; st.refreshTris = st.triangles; }
    else { st.steadyCalls = st.calls; st.steadyTris = st.triangles; }
  }
  function firstFrame(): void { if (!firstDone) { firstDone = true; o.onFirstFrame(); } }
  function recordCpu(ms: number): void { cpuRing[ringI] = ms; }

  function loop(now: number): void {
    raf = requestAnimationFrame(loop);
    // 30 fps cap: render when at least 30 ms passed (the tolerance keeps 60 Hz at 30, not 20)
    if (lastRender && now - lastRender < 30) return;
    const iv = lastRender ? now - lastRender : 33.3;
    lastRender = now;
    timer.update(now);
    const dt = Math.min(0.1, Math.max(0, timer.getDelta()));
    simT += dt;
    if (simT - timeBase > 21600) timeBase = Math.floor(simT / 1800) * 1800; // 6 h safety net
    const c0 = performance.now();
    stepFade(dt);
    updateScene(simT, dt, true);
    draw();
    cpuRing[ringI] = performance.now() - c0;
    ivRing[ringI] = iv;
    ringI = (ringI + 1) % ringN; ringFill = Math.min(ringN, ringFill + 1);
    firstFrame();
    governor(iv);
  }

  // After the first 60 rendered frames: a median interval over governorMs drops to DPR 1
  // with shadows off (no recompile, see setQuality); if the next 60 are still slow, the
  // engine renders the still, stops, and tells the host (which switches to the still
  // tier for the session). Two checks, then it never runs again.
  function governor(iv: number): void {
    if (gov.done || o.motion === "still") return;
    gov.buf[gov.n++] = iv;
    if (gov.n < 60) return;
    gov.n = 0;
    gov.sorted.set(gov.buf);
    gov.sorted.sort();
    const med = gov.sorted[30];
    if (med <= o.governorMs) { gov.done = true; return; }
    gov.level++;
    if (gov.level === 1) { setQuality({ dpr: 1, shadows: false }); o.onGovernor(1, med); }
    else { gov.done = true; o.onGovernor(2, med); renderStill(); }
  }

  function start(): void {
    if (!built || running || disposed || lostCtx || o.motion === "still") return;
    running = true;
    frameDirty = false;
    // resuming is the one moment a jump in GPU time is invisible: rebase it here
    if (simT - timeBase > 1800) timeBase = Math.floor(simT / 1800) * 1800;
    lastRender = 0;
    timer.reset();
    timer.update(performance.now());
    raf = requestAnimationFrame(loop);
  }
  function stopLoop(): void { running = false; cancelAnimationFrame(raf); raf = 0; }

  // Host-reported visibility (document visible AND banner on screen). Stopped-loop frames
  // (clock ticks, resizes, mode changes) render only while visible.
  function setVisible(v: boolean): void {
    hostVisible = !!v;
    if (hostVisible && frameDirty) requestFrame();
  }

  function renderStill(): void {
    if (!built) return;
    stopLoop();
    simT = STILL_T[tod];
    timeBase = 0;
    figures.env.stillT = simT;
    if (fadeT < 1) { copyState(cur, to); fadeT = 1; applyState(); }
    figures.setCast(tod, true, simT);
    pointer.x = pointer.y = pointer.tx = pointer.ty = 0;
    requestFrame();
  }

  // the tower clock shows the school's local time; the uniform updates once a minute. A
  // running loop picks it up on its next frame; a stopped one renders only if visible.
  function updateClock(): void {
    if (disposed) return;
    const p = clockParts(new Date(), o.timeZone);
    U.uClock.value.set((((p.h % 12) + p.m / 60) / 12) * TAU, (p.m / 60) * TAU);
    clearTimeout(clockTimer);
    clockTimer = setTimeout(onClockTick, (60 - p.s) * 1000 + 50);
  }
  function onClockTick(): void { updateClock(); requestFrame(); }
  // The school's zone can resolve after the scene was created (the host builds with the
  // default while the institution query is still in flight); the hands follow it.
  function setTimeZone(tz: string): void {
    if (disposed || !tz || tz === o.timeZone) return;
    o.timeZone = tz;
    if (!built) return; // build() reads o.timeZone when it arms the clock
    updateClock();
    requestFrame();
  }

  // webglcontextrestored: three has re-initialised its GL state; compile the programs off
  // the main thread first, then render one frame. Restarting the loop is the HOST's call
  // (onContextRestored), so a banner paused while the context was lost stays paused.
  function restore(): void {
    if (disposed || !renderer) return;
    shadowDirty = true;
    compilePending = renderer.compileAsync(scene, camera).catch(() => {}).then(() => { compilePending = null; });
    compilePending.then(() => {
      if (disposed) return;
      lostCtx = false;
      requestFrame();
      o.onContextRestored();
    });
  }

  function setPointer(nx: number, ny: number): void { pointer.tx = Math.max(-1, Math.min(1, nx)); pointer.ty = Math.max(-1, Math.min(1, ny)); }
  // Quality changes never recompile a shader. Shadows off keeps sun.castShadow ON
  // (flipping it changes the shader defines and recompiles every clay program: a 0.75 s
  // stall, exactly on the device that is already too slow); instead the map stops
  // refreshing, its intensity goes to 0 and the shadow matrix maps every point outside
  // the unit cube, so each fragment's frustum test fails and the PCF taps are skipped.
  function setQuality(q: { dpr?: number; shadows?: boolean }): void {
    if (q.dpr && renderer) resize(cssW, cssH, q.dpr);
    if (typeof q.shadows === "boolean" && sun && q.shadows !== quality.shadows) {
      quality.shadows = q.shadows;
      if (!q.shadows) {
        sun.shadow.intensity = 0;
        sun.shadow.matrix.makeScale(0, 0, 0).setPosition(5, 5, 5);
      } else {
        sun.shadow.intensity = cur.shadowInt;
        shadowDirty = true;
      }
      requestFrame();
    }
  }

  function stats(): SceneStats {
    const n = ringFill;
    const cpu = Array.from(cpuRing.slice(0, Math.max(1, n))).sort((a, b) => a - b);
    let iv = 0;
    for (let i = 0; i < n; i++) iv += ivRing[i];
    return {
      drawCalls: st.steadyCalls || st.calls, triangles: st.steadyTris || st.triangles,
      refreshDrawCalls: st.refreshCalls, refreshTriangles: st.refreshTris,
      programs: renderer ? renderer.info.programs.length : 0,
      avgFrameMs: n ? Math.round((iv / n) * 10) / 10 : 0,
      cpuP50: Math.round(cpu[Math.floor(cpu.length * 0.5)] * 100) / 100,
      cpuP95: Math.round(cpu[Math.min(cpu.length - 1, Math.floor(cpu.length * 0.95))] * 100) / 100,
      frames: st.frames, shadowRefreshes: st.shadowRefreshes, governor: gov.level, tod, running, dpr,
    };
  }

  // the flag's screen box (CSS px, top-left origin) including the pole and finial
  function flagBox(): ScreenBox {
    const k = flagScaleFor(fr.t), cx = Math.cos(FLAG_YAW), sz = -Math.sin(FLAG_YAW);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const add = (x: number, y: number, z: number) => { projectCss(fr, x, y, z, tmpP); x0 = Math.min(x0, tmpP.x); y0 = Math.min(y0, tmpP.y); x1 = Math.max(x1, tmpP.x); y1 = Math.max(y1, tmpP.y); };
    for (const u of [0, 1]) for (const v of [-0.5, 0.5]) add(0.024 + u * FLAG_W * k * cx, FLAG_CENTER_Y + v * FLAG_H * k, -0.35 + u * FLAG_W * k * sz);
    add(-0.05, FINIAL.y, FINIAL.z); add(0.05, 3.72, FINIAL.z);
    return { x0, y0, x1, y1 };
  }

  // projected screen boxes (CSS px, base camera) for the layout tests
  function probe(): ScreenProbe {
    const P = (x: number, y: number, z: number): [number, number] => { projectCss(fr, x, y, z, tmpP); return [Math.round(tmpP.x * 10) / 10, Math.round(tmpP.y * 10) / 10]; };
    const boxOf = (pts: Array<[number, number]>): ScreenBox => { const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]); return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }; };
    const k = flagScaleFor(fr.t), cx = Math.cos(FLAG_YAW), sz = -Math.sin(FLAG_YAW);
    const flagPts: Array<[number, number]> = [];
    for (const u of [0, 1]) for (const v of [-0.5, 0.5]) flagPts.push(P(0.024 + u * FLAG_W * k * cx, FLAG_CENTER_Y + v * FLAG_H * k, -0.35 + u * FLAG_W * k * sz));
    const figs: ScreenProbe["figures"] = [];
    const A = figures.A, vis = figures.vis;
    for (let i = 0; i < 11; i++) {
      if (vis[i] < 0.5 || A[i].y < -10) continue;
      const w = figures.WIDTH[i] / 2, h = figures.HEIGHT[i];
      const x = A[i].x, y = A[i].y, z = A[i].z;
      figs.push({ i, ...boxOf([P(x - w, y, z), P(x + w, y + h, z), P(x - w, y + h, z), P(x + w, y, z)]) });
    }
    const trees = TREES.map(([x, z, s, c, sx = 1, sy = 1]) => ({ c, x, z, ...boxOf([P(x - 0.72 * s * sx, 0, z), P(x + 0.72 * s * sx, (1.28 + 0.56) * s * sy, z)]) }));
    const dx = (cur.disc[0] * 0.5 + 0.5) * fr.cssW, dy = (0.5 - cur.disc[1] * 0.5) * fr.cssH;
    const CL = clouds.CLOUDS;
    const cloudBoxes = CL.map((c, i) => {
      const z = fr.camZ - c.dist, x = wrap(c.x0 + c.v * simT, clouds.WRAP), s = c.s * (i % 2 === 1 ? cur.cloudExtra : 1), y = yForNdc(fr, c.ny, z);
      return s < 0.01 ? null : { i, ...boxOf([P(x - 1.9 * s, y - 0.75 * s, z), P(x + 2.0 * s, y + 0.95 * s * cur.cloudFlat, z)]) };
    }).filter(Boolean);
    return {
      frame: { ...fr },
      finial: P(0, FINIAL.y, FINIAL.z),
      lawnBand: [P(0, 0, -2)[1], P(0, 0, 2.85)[1]],
      flag: boxOf(flagPts), flagScale: k,
      pole: boxOf([P(-0.04, 3.72, -0.35), P(0.04, 4.93, -0.35)]),
      tower: boxOf([P(-0.49, 2.33, 0.14), P(0.49, 3.72, 0.14), P(-0.49, 3.72, -0.84), P(0.49, 2.33, -0.84)]),
      school: boxOf([P(-5.25, 0, 1.2), P(5.25, 0, 1.2), P(-5.25, 3.2, -1.05), P(5.25, 3.2, -1.05)]),
      facade: boxOf([P(-5.0, 0.18, 1.24), P(5.0, 2.6, 0.75)]),
      door: boxOf([P(-0.4, 0.18, 1.1), P(0.4, 1.3, 1.1)]),
      figures: figs, trees, clouds: cloudBoxes,
      windows: world.geomInfo.windows.map((w) => ({ lvl: w.lvl, ...boxOf([P(w.x - w.w / 2, w.y - w.h / 2, w.z + 0.05), P(w.x + w.w / 2, w.y + w.h / 2, w.z + 0.05)]) })),
      sun: { x: dx, y: dy, r: cur.discSize * 0.5 * fr.cssH, amt: cur.discAmt, moon: cur.moon },
      kite: figures.kiteState.on ? boxOf([P(A[F.KITE].x - 0.25, A[F.KITE].y - 0.3, A[F.KITE].z), P(A[F.KITE].x + 0.25, A[F.KITE].y + 0.3, A[F.KITE].z)]) : null,
      birds: birds.mesh.visible ? P(birds.uFlock.value.x, birds.uFlock.value.y, birds.uFlock.value.z) : null,
    };
  }

  function capture(maxCssW = 1400): string | null {
    if (!renderer || lostCtx || !built) return null;
    renderNow();
    try {
      // at the drawing buffer's own resolution (device pixels), not CSS pixels: a CSS-size
      // poster is visibly blurry on a 2.5x phone screen
      const c = document.createElement("canvas");
      const src = renderer.domElement;
      const k = Math.min(1, maxCssW / cssW);
      c.width = Math.round(src.width * k); c.height = Math.round(src.height * k);
      c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
      return c.toDataURL("image/jpeg", 0.82);
    } catch { return null; }
  }

  // GPU release; idempotent (every reference is nulled once freed). When a compileAsync
  // is still polling, three would throw on freed materials, so the release waits for it.
  function freeGpu(): void {
    if (compilePending) { compilePending.then(freeGpu); return; }
    if (scene) {
      scene.traverse((obj) => {
        const ob = obj as Disposable3D;
        if (ob.isInstancedMesh) (obj as InstancedMesh).dispose();
        if (ob.geometry) ob.geometry.dispose();
        const ms = (Array.isArray(ob.material) ? ob.material : ob.material ? [ob.material] : []) as DisposableMaterial[];
        for (const m of ms) { for (const v of Object.values(m.uniforms || {})) if (v && v.value && v.value.isTexture) v.value.dispose(); if (m.map) m.map.dispose(); m.dispose(); }
      });
      scene = null;
    }
    if (glows) { glows.base.dispose(); glows = null; }
    if (soft) { soft.base.dispose(); soft = null; }
    if (flag) { flag.tex.dispose(); flag = null; }
    if (U.uNoise.value) { U.uNoise.value.dispose(); U.uNoise.value = null; }
    if (sun) { sun.shadow.dispose(); sun = null; }
    if (renderer) {
      const lost = renderer.getContext().isContextLost();
      renderer.dispose();
      if (!lost) renderer.forceContextLoss(); // already lost: three would warn the extension is gone
      renderer = null;
    }
    world = foliage = clouds = figures = sky = birds = kiteLine = kitePos = null;
    hemi = fill = camera = null;
  }
  function dispose(): void {
    const first = !disposed;
    disposed = true;
    built = false;
    stopLoop();
    clearTimeout(clockTimer);
    for (const [ev, fn] of listeners) canvas.removeEventListener(ev, fn);
    listeners.length = 0;
    if (abortResolve) abortResolve(ABORT);
    if (first) timer.dispose();
    freeGpu();
  }

  const api: SchoolScene = {
    build, start, stop: stopLoop, setVisible, setTod, setTimeZone, resize, setPointer, renderStill, setQuality, stats, probe, capture, dispose,
    get tod() { return tod; }, get running() { return running; },
    // test harness only: render the still pose at an arbitrary time (for the STILL_T contact sheet)
    renderAt(t: number) { if (!built) return; stopLoop(); simT = t; timeBase = 0; figures.env.stillT = STILL_T[tod]; figures.setCast(tod, true, t); renderNow(); },
  };
  return api;
};
