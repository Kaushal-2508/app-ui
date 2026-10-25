# Dashboard banner: Clay School real-time 3D (version 1), design

Status: CHOSEN by Tushar on 2026-09-28 over the 2.5D drawing (version 3) and the Blender film
(version 2). This file is the design as approved in the lab, plus the implementation decisions
taken when it was ported into the repo (next section). Where the two disagree, the decisions win.

## 0. Implementation decisions (2026-09-28)

- **Five moments, not four.** Light theme follows the school clock: morning before 11:00, midday
  11:00 to 14:59, golden 15:00 to 18:59, dusk from 19:00 (approved after this design was written).
  Dark theme is always night.
- **No variant registry and no /admin/banner-lab page.** The choice is made.
- **No SVG fallback (Tushar, 2026-09-29: "it will make the website heavy").** The old SVG scene,
  its animations and its `--ssi-*` scene tokens are deleted; only `--ssi-sky-top/mid/bottom` stay,
  for the `.scene-banner` gradient. Until the canvas is up, and on tier `none`, the banner shows that
  sky gradient (zero bytes) or the cached poster. Sections 3.1 and 3.2 below still mention
  `SchoolSceneSvg`: read "the sky gradient" there.
- **Poster cache in IndexedDB, not localStorage.** localStorage already holds the persisted query
  cache (`src/lib/queryPersist.ts`); posters there would compete for its quota. It keeps up to
  10 posters (five moments x two shapes), not 3 (section 6.6): a light-theme day cycles four
  moments, so 3 evicted the next window's poster every time. The still tier reuses a poster only
  if it is under 5 minutes old, because the frame freezes the tower clock at capture time.
- **Bundle exception.** three plus the engine is one lazy chunk, `bannerEngine.<hash>.js`:
  657.6 kB min / 178.6 kB gz measured on 2026-09-28 (the 600 kB / 155 kB estimate below assumed
  the engine added 25 kB; it adds 87 kB, mostly GLSL). Over the §23 500 kB rule, as a documented
  exception. It never loads before the dashboard's own data and never on /login, and
  `check-banner-chunk.mjs` fails above 665 kB min / 182 kB gz.
- **Dashboard chunk budget: 45 kB (section 4 said 60 kB).** The Dashboard chunk carries the host
  layer (gate, tier probe, poster cache, clock hooks) but, since the SVG was deleted on
  2026-09-29, no drawn fallback: 43.50 kB min / 14.76 kB gz, lighter than the 46.80 kB before the
  3D banner existed (it was 61.70 kB with the SVG). Main then added the super-admin showcase
  dashboard and the staff check-in buttons to the same chunk (49.88 kB on 2026-09-29), so
  `check-banner-chunk.mjs` fails above 52.5 kB.
- **The engine entry is `engine/bannerEngine.ts`**, not `engine/index.ts` (sections 3.1, 3.2).
  The chunk is then `assets/bannerEngine.<hash>.js`. A failed download of it must never make
  main.tsx reload the dashboard: `Banner3DLayer` imports it through `importDecorative()` and
  main.tsx's `vite:preloadError` handler returns early for `isDecorativeLoadError()`
  (`src/lib/decorativeImports.ts`), so the import just rejects and the banner keeps its fallback.
- **First real-phone test (2026-09-29, Android 10, Adreno 710, 2.5x screen): two fixes.**
  (1) The governor froze the banner. Its 40 ms limit (section 3.3) read the phone's steady
  24 fps as struggling: 41.7 ms is a normal cadence for the 30 fps loop on 48 and 72 Hz displays,
  while each frame cost only 1.5 ms of CPU and 2.8x the pixels ran at the same rate. The limit
  is now 60 ms (below about 16 fps). (2) It looked blurry: the fixed 1.5x density cap is now a
  pixel budget (the laptop banner at 1.5x, about 463k px), so the phone banner renders at the
  screen's own density up to 3x, and posters are captured at device resolution
  (`POSTER_VERSION` v2 drops the old CSS-size ones).
- **Real-phone test is still the launch gate** (section 5.5).
- The lab source this was ported from (`lab/v1-realtime/engine/*.js`) is the reference for every
  number and shader; the TypeScript port is a behaviour-for-behaviour copy.

## 1. Verdict

**Direction: concept B, Soft Clay Toy School.** Two of the three judges picked it (art director and product designer, 8.5 each), and it has the top score total (24). I looked at the screenshots myself and agree. B is the only concept that looks like it belongs to the SALCI brand and not just near it: teal roofs, cream walls, an orange gulmohar, a lilac jacaranda and a teacher in a lilac saree. Its children are the most dignified figures of the four, and its phone framing keeps the school at about 58% of the width. Its night frame, with the teacher showing two children the moon through a telescope, is the frame a principal remembers.

**I am overriding the judges on one point, and it is B's renderer, not its look.** The performance judge picked C, and the numbers support that for the engine:

- B uses MeshStandardMaterial split into 10 define variants (scene.js lines 353 to 362), which makes 20 to 21 shader programs.
- B's cold time to first pixel is 2.02 s at 4x CPU. C's is 1.17 s with 13 to 15 programs.
- On a low-end Android WebView, B's startup cost is the biggest single risk.

So we ship **B's world on C's engine**: Lambert-based clay shading, C's crossfading state machine, C's lens-shift camera, C's single-mesh figures animated in the vertex shader, and C's sky-sampled atmosphere.

What I confirmed in the screenshots:

- **B morning and midday on the phone:** the two frames differ only in sun position and the kite.
- **B golden at 1400 px:** the lawn is a flat khaki-olive with barely visible tree shadows.
- **B night at 1400 px:** hundreds of stars, heavy purple cloud lumps, an electric-blue jacaranda and a brown gulmohar.
- **B phone flag:** the finial is about 5 CSS px below the top edge.
- **C's courtyard flagpole on the phone (343x112):** it stands in front of the left wing's roof and facade, which is why I reject that graft below.
- **A golden:** the long raking tree shadows on the lawn do read, which confirms that graft.

B's code has these defects, all fixed in the port:

- `document.documentElement.dataset.tod` write (line 1189)
- wall-clock time base (line 1356)
- a `new THREE.Euler` per balloon per frame (line 1319)
- DPR chosen by width (line 1375)
- sky drawn first with `depthTest:false` (lines 392 and 436)
- `gl_PointSize` sprites for halos and fireflies

**Grafts adopted**

| From | Graft | Lands as |
|---|---|---|
| A | Raking golden-hour cast shadows on a readable ground plane | Static 1024 PCF map, frustum refit to the visible strip, lilac-tinted shadow fill (section 2.3) |
| A | Warm light landing on the ground at night | Porch pool on the steps and forecourt, plus lamp pools, drawn as ground-aligned additive quads |
| A | White valley mist between hill rows, morning only | Curvature-matched mist sheets at opacity 0.65 |
| A | One slow swing instead of a twitching loop | Teal A-frame swing beside the gulmohar (left flank) |
| A | `renderStill()`, exported `todFromClock()`, `stencil:false`, whole-frame stats | Engine API and CI budget gate |
| C | Sky-sampled atmosphere fog | Every material's fog chunk replaced; hills dissolve into the sky behind them |
| C | Crossfade of every palette uniform; stars and fireflies ramp in cubically | 1.4 s on theme toggle, 8 s on a clock boundary |
| C | Level camera with off-axis lens shift (true verticals), pure-translation drift | Section 2.1; B's rolling-world curvature is kept |
| C | All figures in one merged mesh animated in the vertex shader | 1 draw call for 7 people and 3 moving props |
| C | Night discipline | About 150 stars at laptop size, zenith close to the UI navy |
| D | Flag cloth | Two travelling waves, finite-difference fold normals, 0.3 rad yaw, at least 22 CSS px wide on the phone |
| D | Sunset reflection in the window glass | Golden-hour glass samples the sky in the reflected direction |
| D | Wind-gust band travelling across x | Modulates all foliage sway |
| D | Sky drawn last at depth 1.0 with the depth test on | Early-z skips covered pixels, and stars can never draw over hills, clouds or the flag |
| D | Composed rest pose for the still | Section 2.6 |
| D | Instanced quads instead of `gl_PointSize` | One glow draw for halos, pools, fireflies and motes |

**Grafts rejected**

- **A's tilt-shift depth of field, IBL/PMREM and MSAA HalfFloat target.** A measured 9.0 ms GPU at laptop size.
- **C's courtyard flag plinth.** The pole crosses the facade on the phone.
- **A's moving bus with headlights.** A parked bus is calmer.
- **D's inked outlines and grass-blade strip.** Off-brand for clay, extra passes, and a busy bottom band.
- **B's balloon garland, its hopping kid, and running the ball game and kite at the same time.**

## 2. The scene

### 2.1 Composition

World units, school centred at x=0, +z toward the camera. Back to front:

1. **Sky.** A direction-based three-stop gradient with a screen-anchored sun or moon disc and stars at night. It is drawn last among the opaques.
2. **Clouds.** Six clay clusters at a distance of 80 to 94, wrapping at x ±62. At night there are three flattened slate wisps.
3. **Hills.** Three rows of hemisphere hills at z -17 (green), -27 (sage) and -42 (lilac-blue), bent down by B's curvature (0.0062·dz² from z -2.5). The valley mist sheets sit between the rows.
4. **River and far bank.** The river ribbon runs behind the school at z about -6.4, with far-bank tree clumps at z -9 to -12.
5. **School**, on a peach plinth:
   - two-storey wings with a pillared verandah, window grids with sills, and a hedge with marigolds;
   - a central entrance block with a gable oculus, an orange awning and a glyph-free signboard;
   - an arched teal door and steps;
   - a clock tower whose hands show the **school's real local time**, updated once a minute through a uniform;
   - the flagpole on the tower, with its finial as the highest point in the scene.
6. **Left flank, the play and village story:**
   - the gulmohar on its chabutra at x -7.2, and the teal A-frame swing at x -9.2;
   - a quiet lawn pocket from x -9.8 to -13 (one bench, nothing else);
   - a village of three pastel houses at x -14 to -21, one with a black rooftop water tank;
   - a jacaranda at x -18.6, and street lamps at x -10.5 and -16.5.
7. **Right flank, the transport and river story:**
   - the yellow bus parked at a small teal bus-stop sign at x 7.9;
   - a quiet pocket from x 10 to 12.5;
   - the river swinging forward under a white-parapet arched bridge where the road crosses at x about 14;
   - ghat steps with a moored boat at x about 17.5;
   - mustard field patches and a single gulmohar at x 20 to 24, which echoes the left side in colour only, not a mirror image.
8. **Road and verge.** The cream path at z 3.4 carries the walkers. The verge has six sparse flower clusters, never a continuous row.

**Framing is solved, not cropped.**

- The camera is level at distance 40. Its height is set so the line of sight to the school descends 6.5° (3:1) to 7.5° (8:1). There is no rotation, so verticals stay true. B's pitched view gives an edge lean of about 4° at a 31° horizontal half-angle.
- Two pixel pins give a 2×2 linear system in 1/tan(fov/2) and the vertical lens shift, written into `projectionMatrix.elements[9]` after every `updateProjectionMatrix()`:
  - the finial projects 8 CSS px below the top edge;
  - the nearest walker lane's foot line projects 6 CSS px above the bottom edge on the phone, or the verge front on the laptop.
- The horizontal shift keeps the school at 50% of the width.
- Pin targets are lerped by `t = clamp((aspect-3)/5)`. Above about 9.4:1, the half-width is clamped at 26 units, and the world is built out to ±70.

| | Phone 343x112 (3:1) | Laptop 1400x176 (8:1) |
|---|---|---|
| Visible width at the road | about 16 units | about 49 units |
| School | about 58% of width, centred | about 19% of width, centred |
| Bookends | gulmohar at the left edge, half the bus at the right edge | whole village on the left; bus stop, bridge, ghat and fields on the right |
| Flag | at least 22 CSS px wide, finial 8 px from the top | about 30 CSS px wide |
| Sun / moon | screen-anchored and on-screen: morning sun over the gulmohar, golden sun and moon at upper right | same NDC anchors |
| Clouds | 2 to 3 (world-fixed x) | 6 |

**Safe zones.**

- No figure, the flag or the school may fall inside the 20x20 CSS px corner squares.
- The bus may be cut by the side edge, since it is a bookend.
- Walkers' bounding boxes never cross the door rectangle.
- No tree bounding box overlaps the facade at 3:1.
- The kite stays at least 12 px from the sun disc.
- The bottom 12% of the strip is the cream path and flower clusters only. That band is low-contrast and moves only with ±2° gust sway.

**Flag.**

- Proportions 3:2, world size 1.32 x 0.88, texture 480x320 CanvasTexture with mipmaps.
- Colours: #FF9933 / #FFFFFF / #138808. The #000080 Ashoka Chakra has 24 spokes, is centred, and its diameter is 0.925 of the white band's height.
- The pole is 0.04 in radius. The flag spans y 3.95 to 4.83 above the tower cap (3.72), and the finial tops out at 4.93.
- `toneMapped:false` and `fog:false`, with no per-mode tint (B's night `0.92/0.93/0.98` tint is removed). Fold shading multiplies luminance only, within 0.90 to 1.04.
- At night: an additive warm floodlight halo behind the cloth, at 0.12, plus pole emissive at 0.35.
- It flies +x, the same direction as the clouds and the gust band.
- At 343x112 the chakra reads as a navy dot. The spokes are physically unresolvable at that size, and that is accepted.

**Figures.** Stylised clay forms with dot eyes and a soft blush, in a range of Indian skin tones. No caricature.

- **Teacher:** lilac saree with an orange border and pallu, holding a teal book.
- **Father:** teal kurta with white pyjama.
- **Five children:** white shirts with navy or teal bottoms and ties; orange, lilac, teal and coral bags; the girls have plaits with ribbons.
- All seven people, plus the ball, the swing seat and the telescope, are rigid or limbed "figures" in **one merged mesh**. Each figure carries three `vec4` uniforms: position+yaw; step phase, arm angle and hop; squash, lean and dissolve.
- A cast change uses a 0.6 s screen-door dither dissolve (a hash of `gl_FragCoord` against alpha), so there is no transparency sorting.
- Figures do not cast into the shadow map. They get B's sun-aligned stretched contact blobs, which are about 3x the figure's height long at golden.

### 2.2 Story beats per mode (at most 3 besides the flag and ambient motion)

| Mode | Beats | Ambient |
|---|---|---|
| Morning | Arrivals: father with K1, K2 and K3 walking right toward the gate. Teacher greeting from the doorway. | flag, clouds, birds, sway, valley mist; empty swing sways 3° |
| Midday | Recess ball game (K1 and K2) on the courtyard at x -3.55 to -1.75. K4 on the swing (laptop only; off-frame on the phone). Two walkers (K3 and K5) heading left. | flag, clouds, birds, sway |
| Golden | Departures: father with K1, K4 and K3 walking left toward home. K5 flying a patang on the right lawn. Teacher waving farewell. | flag, clouds, birds, 12 pollen motes, long shadows |
| Night | Telescope group: the teacher points at the moon while K2 and K3 look up, at x 1.95 to 3.35. | stars, 28 fireflies, lit windows, lamp and porch pools |

### 2.3 Lighting states

The light rig is constant: hemisphere, one shadow-casting directional light, a frontal fill, and a porch PointLight at intensity 0 by day. The fog type is constant (the custom atmosphere chunk). Only colours and intensities change, so no shader ever recompiles. Tone mapping is Neutral at exposure 1.0.

| | Morning (before 11:00) | Midday (11:00 to 15:00) | Golden (15:00 onward) | Night (dark theme) |
|---|---|---|---|---|
| Sky horizon / mid / zenith | #fde7d4 / #dcf0f1 / #9fd3df | #eef7f0 / #c2e5ee / #7cc0d6 | #ffd4a0 / #f8bcab / #b9a8de | #3a4270 / #242a4c / #1b2038 |
| Disc | soft sun low left (NDC -0.74, 0.50), warm glow | sun off-frame (0.45, 1.25), glow only, never behind the flag | large sun on the far hills (0.80, 0.46), apricot glow | cratered moon (0.66, 0.50), cool halo at 0.25 |
| Key light | front-left, 20° up, #ffe6c8, 2.2 | front-right, 64°, #fffaf1, 2.8 | front-right, 15°, #ffc48a, 3.2 | moon from upper right, 38°, #c8cfee, 0.95 |
| Shadows (intensity, PCF radius) | long, falling right and back (0.75, 2.5) | short pools under trees (0.80, 2.0) | long, raking left across the lawn (0.90, 2.0) | soft (0.55, 3.0) |
| Hemi sky / ground / intensity | #d4eaff / #d9e3c6 / 1.5 | #e8f6ff / #d6e8c6 / 1.45 | #c9b8e6 / #f0c9ad / 1.0 (lilac shadows) | #3e4a86 / #1b2040 / 1.0 |
| Rim | #fff6ea 0.34 | #ffffff 0.28 | #ffc892 0.62 | #8fa2ff 0.45 |
| Atmosphere | density 0.016, valley mist 0.65 #f5f7f2 | 0.011, no mist | 0.014, warm haze 0.18 | 0.013, blue mist 0.22 #4a5078 |
| Lawn albedo and acceptance hue (sunlit, HSV) | #9fd8ae, 120° to 140° (fresh mint) | #a3d39a, 100° to 120°, saturation 0.40 or less | #8fd6a0, 80° to 95° (warm green, never khaki) | day albedo × night grade (saturation 0.6, hue kept) |
| Glass | sky reflection 0.08 | 0.08 | sunset reflection 0.35 | warm glow in a 55% lit / 23% half / 22% dark mix |
| Extras | birds | birds | birds, motes | about 150 stars, fireflies, porch light 2.2, pools, flag floodlight |

Colour values are the starting points. The pixel probes in section 5 are the real contract.

- **Night windows.** Warm tone jittered per window between #ffc46a and #ffe0a8, with a vertical gradient (brighter under the ceiling). Emissive is capped so no window pixel exceeds sRGB luminance 0.88.
- **Night foliage.** The albedo grade keeps hue: the gulmohar stays coral and the jacaranda stays muted lilac.
- **Night clouds.** Three wisps flattened to y-scale 0.55, albedo #7d849f, silver-rimmed on the moon side.

**Transitions.**

- **Theme toggle:** crossfade over 1.4 s. Golden to night passes through dusk: windows switch on staggered by hash across the fade, the moon fades in after 50%, and stars and fireflies ramp in cubically.
- **Clock boundary at 11:00 or 15:00:** the same crossfade, over 8 s.
- **Sun disc:** fades out, jumps while invisible, then fades back in (C).
- **Shadows:** intensity dips to 0.2 at the midpoint. The sun direction swaps there, so the static map re-renders once, and it reads as a passing cloud.
- **Cast changes:** walkers swap identity only at their next off-screen wrap; standers use the 0.6 s dissolve.

### 2.4 Motion

Everything is driven by one accumulated, clamped time t. Nothing is keyframed, and every wrap happens outside the visible width.

| Element | Motion | Speed / period |
|---|---|---|
| Flag | two travelling waves growing from the hoist, slight droop, fold normals | 0.41 Hz and 0.23 Hz (incommensurate); amplitude 0.07 × distance from hoist |
| Walkers | hop-walk with 60% of B's squash; wrap at half-width + 1.4 | 0.45 to 0.5 u/s; kids 2.0 steps/s, adults 1.6; hop 0.03 |
| Teacher | greeting or farewell wave in pulses | 2.5 s of every 9 s, arm at 0.5 Hz |
| Ball game | throw, bounce with 25% squash, catch; catcher bob | 2.6 s per pass |
| Swing | pendulum | 3.2 s period, 16° |
| Kite | figure-eight and roll; string sags from the hand | 0.42 and 0.84 rad/s |
| Standers | breathing | 0.25 Hz, 2% |
| Clouds | drift +x | 0.11 to 0.16 u/s |
| Birds | V of 5, flap with glide envelope | 0.9 u/s, flap 0.9 Hz, glide 0.07 Hz |
| Trees, bushes, flowers | two-frequency sway, height-weighted, plus a gust band travelling +x | periods 7.9 s and 3.7 s; gust at 1.2 u/s about every 22 s |
| River | shimmer bands | 0.8 rad/s |
| Mist | density breathing | ±15% over 150 s |
| Stars / fireflies / motes | twinkle ±25% / Lissajous drift with slow pulse / slow rise | 4 to 15 s / 5 to 9 s / 0.05 u/s |
| Boat | moored bob | 1.1 rad/s, 0.018 |
| Camera | pure translation, no rotation | x = 0.45·sin(2πt/96) + 0.12·sin(2πt/41 + 1.1); y = 0.03·sin(2πt/57); at most about 1.5 px/s at laptop size |

Nothing strobes. No luminance change is faster than a 3 s period, except the flag's shading.

### 2.5 Pointer parallax

- The listener sits on the **banner element only**, and only when `(hover: hover) and (pointer: fine)` matches. The element rect is cached from the ResizeObserver, not read on every move.
- The camera translates at most ±0.7 units in x and ±0.25 in y, eased at `dt·2.5`, and eases back to centre on `pointerleave`. The school stays put while the hills and trees separate.
- No device-orientation tilt: iOS would ask for a permission gesture, which a decorative banner must never trigger.

### 2.6 Reduced-motion still

The still is a pose per mode, picked from a 60-frame contact sheet and stored as `STILL_T[tod]`. Drift and parallax are zeroed. It renders once, after `compileAsync`.

| Mode | Pose |
|---|---|
| Morning | Father and two children at the gate, mid-stride with feet near the ground. Teacher's arm raised in greeting. Flag in a clean S-fold. Bus half-visible on the phone. Long shadows falling right. |
| Midday | Ball held in K1's hands at the catch. Swing at mid-arc. |
| Golden | Walkers mid-stride with long lilac shadows. Kite aloft. Teacher waving. |
| Night | Telescope group. Fireflies at fixed positions. Stars at mean brightness. |

- The live loop **starts from this same pose**, so the poster, the first frame, the reduced-motion frame and the weak-tier frame are the same image.
- `matchMedia('(prefers-reduced-motion: reduce)')` is subscribed with a change listener. Turning it on mid-session stops the loop and re-renders the still.

### 2.7 Every judge must-fix, resolved

Source key: AD = art director, PD = product designer, PF = performance engineer.

| # | Must-fix (source) | Resolution |
|---|---|---|
| 1 | Flag exact in every mode; excluded from tone mapping, fog and grading; floodlit at night; render test (AD1, PD3, PF13) | `toneMapped:false`, `fog:false`, no mode tint, luminance-only fold shading; night floodlight halo; test T-flag |
| 2 | Pole visible at night on the phone (AD2) | Radius 0.02 → 0.04 (about 1 device px at DPR 1.5), #eef1f6 with night emissive 0.35; test: contrast at least 1.5:1 against the sky |
| 3 | Headroom at least 8 CSS px, flag at least 22 CSS px, pole never over the facade (AD3, PD3) | Finial pinned 8 px below the top; flag 1.32 x 0.88 with yaw 0.3; pole on the tower, so it cannot cross the facade; test T-frame |
| 4 | Morning distinguishable from midday on the phone by more than sky tint (AD4, PD7) | Low sun disc left vs off-frame; 20° vs 64° key; long right-falling vs pooled shadows; valley mist; lawn hue 130° vs 110°; arrivals vs recess; test: mean ΔE00 of at least 6 over the lower 60% of the phone frame |
| 5 | Golden lawn warm-green; midday not lime; sky teal-leaning (AD5) | Hue windows in 2.3; lilac hemi fill; hill tint multiplier removed; zeniths at hue 191° to 195°; test T-colour |
| 6 | Night clouds as soft wisps (AD6) | Three flattened slate wisps with silver rim |
| 7 | Night foliage keeps its hue (AD7, PD6) | Hue-preserving albedo grade plus a low-saturation moon key; test: gulmohar hue within 20° of its day hue |
| 8 | Lit/unlit window mix with interior variation, no blow-out (AD8, PD6) | 55/23/22 mix, tone jitter, vertical gradient, emissive cap; test: max L 0.88 or less and r > g > b |
| 9 | Break the 8:1 mirror symmetry (AD9, PD9) | Left flank play and village, right flank transport and river, a quiet pocket on each side |
| 10 | No tangencies; walkers clear of the entrance (AD10) | T-frame asserts no tree over the facade and no walker box over the door rectangle at 3:1 |
| 11 | Drop the balloon garland (AD11, PD8) | Removed, with its strings and per-frame Euler |
| 12 | No glitchy sky noise; sparse stars kept off the flag (AD12, PD6) | Gradient sky with no fbm; star threshold 0.984 (about 150 at laptop size); sky drawn last with the depth test on |
| 13 | Still frame composed as a poster (AD13, PD10, PF12) | Section 2.6 |
| 14 | No costly depth of field (AD14, PF9) | No post pass at all; depth comes from fog, mist and curvature |
| 15 | Parallax scoped to the banner, off on coarse pointers, at most 0.7 (PD1, PF7) | Section 2.5 |
| 16 | Crossfade at least 1.4 s (PD2, PF15) | 1.4 s theme, 8 s clock, shadow dip |
| 17 | Feet at least 6 px from the bottom; nothing in the 20 px corners (PD4) | Bottom pixel pin; corner test |
| 18 | Bottom 12% calm (PD5) | Cream path and sparse flowers; no river band, plinth bar or blade confetti |
| 19 | Night sky close to the dark card (PD6) | Zenith #1b2038 (27,32,56) vs card (32,35,50); test ΔE00 of 8 or less |
| 20 | At most about 3 motion foci; no hop, no ball and kite together (PD8) | Section 2.2 |
| 21 | Load-order hygiene (PD11, PF3) | Section 3.2 |
| 22 | Role-neutral, silent to assistive tech, no baked text (PD12) | `aria-hidden` container, nothing focusable, glyph-free signboard, one scene for all roles |
| 23 | Lifecycle and full release (PD13, PF2) | Section 3.7 |
| 24 | Context loss handled (PF1) | Section 3.6 |
| 25 | Weak-GPU safety (PF4) | Section 3.3 |
| 26 | 30 fps cap and pausing (PF5) | Sections 3.5 and 3.3 |
| 27 | Clamped accumulated time (PF6) | `THREE.Timer`, delta clamped to 0.1 s; B's wall clock removed |
| 28 | No global side effects (PF7) | No document writes, per-instance uniforms, no window or document listeners in the engine |
| 29 | Zero per-frame allocations (PF8) | All temporaries preallocated per instance; kite line buffer reused; no closures created per frame |
| 30 | Static shadow map; figures do not cast (PF10) | `autoUpdate=false`; `needsUpdate` on mode swap, resize and context restore |
| 31 | DPR by device class (PF11) | Section 3.3 |
| 32 | Bundle hygiene (PF14) | Section 3.2 |
| 33 | Validate on a real handset (PF16) | Section 5.5 is a ship gate |

## 3. Architecture for the repo

### 3.1 Files and boundaries

```
src/components/shared/illustrations/
  SchoolSceneIllustration.tsx   public; same call sites; drops lottieSrc + the dotlottie import;
                                renders the fallback layer, then the active variant
  SchoolSceneSvg.tsx            today's SVG moved here; flag fixed (see 3.9 Phase 0)
  bannerVariants.ts             registry + ACTIVE_BANNER_VARIANT constant
  banner3d/
    Banner3DLayer.tsx           React: gate, canvas lifecycle, observers, cross-fade
    useBannerTod.ts             theme + school clock -> { tod, fadeMs }
    todFromClock.ts             pure: todFromClock(date, tz), msUntilNextBoundary(date, tz)
    capability.ts               WebGL2 probe + tiering; imports no three
    posterCache.ts              localStorage poster (try/catch everywhere)
    engine/index.ts             the ONLY dynamic-import target: export createSchoolScene
    engine/{scene,framing,palettes,materials,world,figures,flag,sky,glows}.ts
src/hooks/useInstitutionTimezone.ts
src/pages/admin/BannerLabPage.tsx      lazy route /admin/banner-lab, super_admin only
scripts/check-banner-chunk.mjs  scripts/test-banner-tod.mjs  scripts/test-banner3d.mjs (+ banner-harness/)
```

**Engine rule.** `engine/*` imports only `three`, `three/addons/geometries/RoundedBoxGeometry.js`, `three/addons/utils/BufferGeometryUtils.js` and sibling engine files: never React and never `@/`. React code imports engine types with `import type` only.

Engine API:

```ts
export type SceneTod = "morning" | "midday" | "golden" | "night";
export function createSchoolScene(canvas: HTMLCanvasElement, o: {
  tod: SceneTod; motion: "live" | "still"; onFirstFrame(): void;
  onContextLost(): void; onContextRestored(): void;
}): {
  build(signal: AbortSignal): Promise<void>;          // phased, yields between phases
  start(): void; stop(): void;
  setTod(tod: SceneTod, fadeMs: number): void;
  resize(cssW: number, cssH: number, dpr: number): void;
  setPointer(nx: number, ny: number): void;
  renderStill(): void; setQuality(q: { dpr: number; shadows: boolean }): void;
  capture(maxCssW: number): string | null;             // JPEG data URL, same task as render
  stats(): { calls: number; triangles: number; programs: number; p50: number; p95: number };
  probe(): ScreenProbe;                                // projected bboxes for tests
  dispose(): void;                                     // includes forceContextLoss
};
```

Porting notes:

- The engine is written in TypeScript, with no `any` (§5a).
- `mergeGeometries` inputs are normalised with `.toNonIndexed()`, and the build throws on a `null` result.
- Clay patches (fresnel rim, height AO, glow, curvature, sway, grass noise) move onto `MeshLambertMaterial`, which has the same `aomap`, `emissivemap` and `opaque_fragment` chunks.
- **Program inventory, 10 in total:** static clay, instanced clay (all instanced geometry carries vertex colours so it shares one program), figures, sky, flag, glow quads, basic transparent (mist and blobs), birds, and two depth programs.
- **Merged into the static receive-only mesh:** ground, river (shimmer on `aSurf=2`) and props. `aGlow` becomes a `vec2(glow, isGlass)`.

### 3.2 Lazy loading: three never touches the entry and never delays data

**Chunk rules.**

- Do **not** touch `manualChunks`. That trap is measured: it folds the scene into the entry and loads three before login.
- `engine/index.ts` is referenced only by `import()` in `Banner3DLayer.tsx` and in the lab page. Rollup emits one lazy chunk (three plus the engine) with **zero static imports**.
- `scripts/check-banner-chunk.mjs` runs after `vite build` and fails the build if any of these hold:
  - the chunk containing `THREE.WebGLRenderer` is inside the static closure of `dist/index.html` (entry plus modulepreloads, following `import…from"./x.js"`);
  - that chunk has any static import;
  - the string appears in any other chunk;
  - the entry differs from the 1,161.70 kB baseline by more than 2 kB.
- **Exception to record:** the chunk is over the §23 500 kB rule. Record it as a documented exception alongside mathlive, exceljs and heic2any.

**Gate** (`Banner3DLayer`):

1. On mount, paint the fallback at once: the cached poster `<img>` if one is valid, otherwise `SchoolSceneSvg`.
2. `tier = probeTier()`, which is synchronous, cached in sessionStorage and imports no three. If the tier is `none`, stop: the fallback stays.
3. Wait for all of:
   - the IntersectionObserver reports the banner visible (rootMargin 0);
   - `document.visibilityState === "visible"`;
   - `useIsFetching() === 0` observed once, latched. If queries have not settled after 8 s: on the web, keep the fallback for this mount (slow network, don't compete); in the native shell, proceed, because the chunk is local.
4. `requestIdleCallback(cb, { timeout: 3000 })`, with a `setTimeout(cb, 250)` fallback for WKWebView.
5. `await import("./engine")`, then `build(signal)` in phases:
   1. renderer inside try/catch, with `alpha:false`, `antialias:true`, `stencil:false`, `powerPreference:"low-power"`;
   2. `yieldToMain()` (a three r186 core export), then the static world;
   3. yield, then foliage, figures, flag and glows;
   4. `await renderer.compileAsync(scene, camera)`;
   5. the first frame at `STILL_T[tod]`.
   The AbortSignal is checked between phases, so an unmount mid-build disposes whatever was already built.
6. `capture()` saves the poster, then the canvas cross-fades in (opacity 0 to 1 over 600 ms). On `transitionend` the SVG is **unmounted** so its SMIL animations stop running under the canvas.

### 3.3 Tiers and capability

| Tier | Trigger | Behaviour |
|---|---|---|
| `full` | WebGL2 with `failIfMajorPerformanceCaveat:true` succeeds, and nothing below applies | Live loop at 30 fps. DPR `min(dpr, 1.5)` if `(pointer: coarse)` or native, else `min(dpr, 2)` |
| `still` | GPU string matches `Mali-(4\d\d\|T6\d\d\|T7\d\d)\|Adreno \(TM\) (3\d\d\|4\d\d\|50\d)\|PowerVR`; or `hardwareConcurrency ≤ 4 && deviceMemory ≤ 2`; or battery not charging and below 20%; or the governor tripped earlier this session | Build, render the still once, capture the poster, `dispose()` plus `forceContextLoss()`, show the poster `<img>`. Rebuild only on a theme change |
| `none` | No WebGL2; major-performance-caveat failure; `SwiftShader\|llvmpipe\|Basic Render` in the GPU string; `navigator.connection.saveData`; two context losses this session | Poster if valid, else the SVG. The three chunk is never requested |

- **Governor.** After the first 60 rendered frames, if the median interval exceeds 40 ms, drop to DPR 1 with shadows off (contact blobs only). If the next 60 frames are still slow, render the still and switch to the `still` behaviour. The tier is stored in sessionStorage.
- **iOS.** The GPU string is only "Apple GPU", so iOS relies on the governor.
- **Reduced motion on a capable GPU.** Keep the renderer alive but stopped, and re-render on a mode change or resize.

### 3.4 Theme and clock

- **Theme:** `isDark` comes from a MutationObserver on `<html class>`. AppLayout toggles `.dark` there from `user_preferences.theme`.
- **Timezone:** `useInstitutionTimezone()`:
  - takes the institution id from `useEffectiveInstitution()`, then runs `supabase.from("institutions").select("timezone").eq("id", id).maybeSingle()`;
  - `staleTime: 30 * 60_000`, `refetchOnWindowFocus: false`;
  - falls back to `"Asia/Kolkata"` while loading, on error, when there is no institution (super admin), or when `Intl` throws `RangeError`.
  - Every role already reads its own `institutions` row in AppLayout's `header-institution` query, so the RLS path exists. Verify it with a student login in the lab.
- **Clock:** `todFromClock(now, tz)` uses `Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })`:
  - before 11:00 is morning;
  - 11:00 to 14:59 is midday;
  - 15:00 onward is golden.
  - A `setTimeout(msUntilNextBoundary)` re-arms after each boundary and is recomputed on every return to a visible state.
- **Result:** `tod = isDark ? "night" : clockTod`. `fadeMs` is 1400 for a theme change, 8000 for a clock change, and 0 on mount.

**Scale Gate for the one new query:**

1. Bounded: `maybeSingle()` by primary key. Pass.
2. No aggregate. N/A.
3. `staleTime` 30 min. Pass.
4. Explicit column. Pass.
5. No mutation. N/A.
6. No multi-write. N/A.
7. No migration. N/A.
8. Errors degrade deliberately to the default timezone. The banner is decorative, so there is no user-facing error state.
9. No `getUser()`. Pass.
10. No `refetchInterval` or subscription. Pass.

### 3.5 Pause and resume

- **The loop stops (`cancelAnimationFrame`, not just skipped renders) when any of these holds:**
  - the document is hidden;
  - the IntersectionObserver ratio is 0;
  - `onAppStateChange` reports `active=false` with source `"native"` (web `"focus"` events are ignored, so a devtools click does not pause it);
  - reduced motion is on;
  - the tier is `still`;
  - the context is lost.
- **Resume:** when every condition clears, the Timer delta is reset, so nothing jumps.
- **30 fps cap:** rAF runs every frame and renders when at least 30 ms have passed since the last render. The tolerance stops a 60 Hz display from dropping to 20 fps. iOS Low Power Mode (30 Hz rAF) meets the cap unchanged.
- **Resize:** a ResizeObserver on the card, coalesced to one rAF. It triggers `setSize(w, h, false)`, a framing re-solve, a shadow-frustum refit and `needsUpdate`, and one render if the loop is paused.

### 3.6 Context loss and fallback

1. **On `webglcontextlost`** (three already calls `preventDefault`): stop the loop, fade the canvas to 0 over 200 ms to reveal the session poster (or the re-mounted SVG), and start a 3 s timer.
2. **On `webglcontextrestored`:** set `shadowMap.needsUpdate`, render, and fade back in.
3. **Give up:** if there is no restore within 3 s, or a second loss happens this session, dispose, remove the canvas and store `tier=none` in sessionStorage.
4. **On resume** (visibility or native `appStateChange`): check `gl.isContextLost()`. If it is lost and was not restored, rebuild once on a **fresh** canvas; this is the iOS 17 backgrounding case.

### 3.7 Disposal on unmount

1. Abort any in-flight build.
2. Cancel rAF and clear the boundary timer.
3. Disconnect the IntersectionObserver, ResizeObserver and MutationObserver.
4. Remove the pointer and matchMedia listeners, and unsubscribe `onAppStateChange`.
5. Traverse the scene, disposing geometries, materials, CanvasTextures and `InstancedMesh.dispose()`.
6. `sun.shadow.dispose()`, `timer.dispose()`, `renderer.dispose()`, `renderer.forceContextLoss()`, then `canvas.remove()`.

The canvas is created imperatively inside the effect, so a remount never reuses a force-lost canvas. That keeps the effect idempotent under StrictMode.

### 3.8 Native shell (Capacitor)

- `cap sync` bundles the chunk locally, so transfer is free but parse and eval (about 62 ms at 4x CPU) are not.
- DPR is capped at 1.5 on native.
- Pause uses the App plugin through `onAppStateChange`.
- No `requestIdleCallback` on iOS, so the `setTimeout` fallback applies.
- iOS returns are cold starts, and the poster makes the first paint instant.
- No `backdrop-filter` over the canvas (the WKWebView shimmer seen before).
- Textures stay at 480 px or smaller (flag 480x320, sprites 64²).

### 3.9 Variant comparison and ship plan

- **Registry.** `bannerVariants.ts` maps `BannerVariantId` to a lazy component with one contract: `{ className?: string; debugTod?: SceneTod }`. It holds `"svg-classic"`, `"clay-3d"` and the two other variants.
- **Production switch.** `ACTIVE_BANNER_VARIANT` stays `"svg-classic"` until you choose. Flipping it is one line, and so is rolling back.
- **Preview page.** `/admin/banner-lab` is lazy and behind the same super_admin guard as the other `/admin` pages. It shows all three variants stacked:
  - at a selectable size: 343x112 phone or 1400x176 laptop, one size at a time, so there are at most 3 live WebGL contexts;
  - inside a mock of the dashboard (greeting and stat tiles) in light and dark;
  - with controls for time of day (auto, morning, midday, golden, night), simulated reduced motion, "simulate no WebGL" (forces `tier=none`), and a stats overlay (calls, triangles, programs, frame p50/p95, first-pixel ms).

**Ship order:**

- **Phase 0 (independent, ships now):**
  - drop the `@lottiefiles/dotlottie-react` import and the dependency (no call site passes `lottieSrc`): the Dashboard chunk goes from 374.37 kB / 48.41 kB gz to 47.13 kB / 12.75 kB gz;
  - fix the SVG fallback's flag tokens to exact colours in **both** themes. Today's dark tokens make the white band `220 20% 80%` grey and the chakra `220 80% 80%` light blue, and the light-theme green is `130 75% 30%`, not #138808. Also draw all 24 chakra spokes.
- **Phase 1:** add three and the engine behind the lab only. No user sees it.
- **Phase 2:** you pick. The real-phone gate (section 5.5) must pass before the constant flips.

## 4. Performance budget

**Measured.** Intel UHD through ANGLE D3D11 plus CDP CPU throttling, from the performance judge's GPU-timer harness and the research harness. These are relative numbers: tiler fill rate is not represented.

| Metric | A | B | C | D | Target for this design |
|---|---|---|---|---|---|
| GPU ms/frame, phone 514x168 (golden) | 3.17 | 1.93 | 1.85 (1.14 with a static shadow map) | 3.26 | 1.3 or less |
| GPU ms/frame, laptop 2800x352 (golden) | 9.03 | 3.69 to 4.35 | 3.4 to 3.95 | 4.48 | 3.2 or less |
| Main thread to first pixel, cold, 4x CPU | 2.56 s | 2.02 s | 1.17 s | 1.60 s | 1.2 s or less, no task over 150 ms |
| Shader programs | 22 to 24 | 20 to 21 | 13 to 15 | 25 | 12 or fewer (inventory: 10) |
| Draw calls, steady (shadow-refresh frame) | 30 to 32 | 27 to 32 (31 to 36) | 18 to 21 | 35 to 38 | 22 or fewer (28 or fewer); hard cap 60 |
| Triangles, steady (refresh frame) | 50k to 55k | 38.5k to 42.7k (45.5k to 49.7k) | 43.6k to 44.2k | 53k to 55k | 42k or fewer (50k or fewer); hard cap 60k |
| Shadow map | every frame | static | every frame | every frame | static, refit on resize or mode swap |

**Startup phases (research probe at 6x CPU).**

- Chunk import 97 ms, renderer 57 ms, scene build 129 ms, first frame 179 ms.
- With `compileAsync` the first frame drops to 132 ms.
- Steady render JS was 4.3 / 8.7 ms (median / p95) for a 58-draw probe.
- Target for this design: steady frame JS at or below 1.0 ms median and 2.0 ms p95 at 4x CPU (C's patched copy measured 0.7 ms), with zero heap growth over a 60 s run.

**Bundle.**

- three plus the two addons measured 568.43 kB min / 145.15 kB gz. The engine adds about 25 kB min, so the budget for the chunk is 600 kB min / 155 kB gz.
- The entry stays byte-identical at 1,161.70 kB.
- The Dashboard chunk stays at 60 kB or less after the dotlottie removal.
- Delivery costs one extra request per user per deploy, cached immutably after that.

**GPU memory.** 40 MB or less at laptop size with MSAA (C was estimated at about 35 MB); 12 MB or less on the phone. On tile-based Mali and Adreno GPUs, MSAA resolves on-chip and is cheap, so antialias stays on.

**Targets for real phones** (a Mali-G52-class and an Adreno 6xx-class Android through the Capacitor debug build, plus an iPhone on iOS 17 or later):

- sustained 30 fps: p95 frame interval of 36 ms or less over a 60 s recording at DPR 1.5, without the governor tripping;
- first 3D pixel within 2.5 s of the gate opening;
- no long task over 200 ms;
- dashboard INP p75 within 20 ms of the SVG build on the same device and script;
- a 10-minute soak idle on the dashboard with no context loss and a stable heap.

## 5. Testing and verification

1. **`npm run test:banner-tod`** (Node, pure). Cases in Asia/Kolkata:
   - 10:59 is morning; 11:00 and 14:59 are midday; 15:00 and 23:59 are golden; 00:00 is morning.
   - Also a DST boundary in America/New_York, an invalid timezone falling back to the default, and `msUntilNextBoundary` across midnight.
2. **`scripts/check-banner-chunk.mjs`** after every `vite build`, using the assertions in section 3.2. It is part of the §5a gate for this change, together with `npm run typecheck`, `npx eslint <changed files>`, `npx vite build` and `npm run test:cache`.
3. **`npm run test:banner`.** Adds playwright-core as a devDependency; it drives the installed Chrome as the scratch chunk harness already does. A static harness page imports the built engine chunk directly (the file name is discovered from `dist`, never guessed; this works because the chunk has zero imports). For all 4 modes, at 343x112 @1.5 and 1400x176 @2:
   - **T-flag:**
     - saffron band median within ΔE00 of 5 of #FF9933, sampled at 25% from the hoist;
     - green band within 5 of #138808;
     - white band L of 95 or more;
     - chakra centre navy (b > r + 40, L < 0.3);
     - saffron is on top (catches a flipY regression).
   - **T-frame** (from `probe()`):
     - finial headroom at least 8 CSS px;
     - flag at least 22 CSS px wide at 343x112;
     - school at least 55% of the phone width;
     - feet at least 6 px from the bottom;
     - corner squares empty;
     - pole inside the tower's bounding box;
     - no tree over the facade and no walker over the door;
     - kite at least 12 px from the sun disc.
   - **T-colour:**
     - lawn hue windows from section 2.3, and golden lit-to-shadow luminance ratio of at least 1.35;
     - morning vs midday ΔE00 of at least 6 over the lower 60% of the phone frame;
     - night zenith within ΔE00 of 8 of (32,35,50);
     - window max L of 0.88 or less with r > g > b;
     - gulmohar hue drift of 20° or less at night.
   - **T-budget:** with `renderer.info.autoReset=false` so a whole frame is counted, the draw-call, triangle and program caps from section 4.
   - **T-still:** `motion:"still"` renders exactly one frame in 2 s.
   - **T-context:** `WEBGL_lose_context` fires `onContextLost` and stops the loop; `restoreContext` re-renders with the shadow refreshed.
   - **T-dispose:** after `dispose()`, `isContextLost()` is true, and 20 create/dispose cycles log no "Too many active WebGL contexts" warning.
   - Screenshots go to an output folder for review in both themes.
4. **App level** (the existing screenshot tool at 375 px and 1440 px, light and dark, horizontal-scroll check), with one test login per role:
   - the greeting and stat tiles do not shift, and there is no sideways scroll;
   - the canvas cross-fades in after the network waterfall shows the dashboard's Supabase responses finishing;
   - `/login` downloads zero bytes of three.
   - **Reduced motion** via CDP `Emulation.setEmulatedMedia`: the still, with no rAF activity.
   - **WebGL disabled** (Chrome `--disable-webgl`): the SVG renders, the three chunk is **never requested**, and the console shows zero errors.
   - **Save-Data** is mocked through `addInitScript` on `navigator.connection`.
5. **Real phone (ship gate).** chrome://inspect on each Android handset, Safari Web Inspector on the iPhone:
   - a 60 s Performance recording against the section 4 targets;
   - 10 background/resume cycles (the banner returns or falls back, never blank);
   - rotation re-frames the scene correctly;
   - iOS Low Power Mode keeps motion speed correct;
   - TalkBack and VoiceOver skip the banner;
   - the oldest device available shows `still` tier behaviour.

## 6. Risks and open questions for you

1. **Bundle exception.** Approve one lazy chunk of about 600 kB min / 155 kB gz as a documented §23 exception (entry unchanged, +1 request per user per deploy)? The alternative is a fragile three-chunk split plus a guard. I recommend the single chunk.
2. **Evening in the light theme.** Under the agreed rule, the light theme shows golden hour from 15:00 until midnight, so a teacher entering marks at 22:00 sees a sunset. Confirm that is what you want.
3. **What I need from you:**
   - one low-end Android phone (Mali-G52 or Adreno 6xx class) and one iPhone on iOS 17 or later, running the Capacitor debug build;
   - one test login per role at a demo school.
   Without the handset, "fast on low-end Android" is unproven: every number above comes from a desktop Intel GPU.
4. **Flag placement.** The flag stays on the clock tower rather than on an assembly-ground plinth, because a courtyard pole crosses the facade on the phone (C shows it). Say if you prefer the plinth; the cost is a smaller flag on phones.
5. **Rollout.** Flip the switch for everyone at once, or one demo school first for a week? A staged rollout needs a feature-flag row, which means a database change.
6. **Poster cache and known limits.** The poster cache stores at most 3 JPEGs (about 30 to 120 kB each) in each viewer's localStorage. At phone size the children are about 13 to 15 CSS px tall with no readable faces, and the chakra is a navy dot. Those limits are physical and accepted, not bugs.