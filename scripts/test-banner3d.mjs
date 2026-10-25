/**
 * Browser test for the BUILT 3D dashboard banner engine (design spec section 5.3).
 *
 * WHY THIS FILE EXISTS. The banner draws the national flag, frames a school scene to
 * the pixel on a 343 px phone card, and holds a WebGL context on every dashboard.
 * None of that is visible to typecheck, lint or build: a flipped texture puts green on
 * top, a tone-mapping change turns saffron brown, a framing slip crops the finial or
 * drops a child into the corner under the greeting, and a missed forceContextLoss()
 * leaks one GPU context per visit until Chrome starts killing the oldest. So the real
 * chunk from dist/ is loaded into the installed Chrome and measured.
 *
 *   npx vite build && npm run test:banner
 *
 * For all five moments (morning, midday, golden, dusk, night) at 343x112 @1.5 and
 * 1168x176 @2 it checks:
 *   T-flag    saffron and green within dE00 5 of #FF9933 / #138808 at 25% from the
 *             hoist, white L* >= 95, chakra centre navy, saffron on top
 *   T-frame   from probe(): finial headroom >= 8 css px, flag >= 22 px wide and school
 *             >= 55% of the width on the phone, nothing in the 20x20 corners, the pole
 *             standing on the tower, feet >= 6 px from the bottom, no tree over the
 *             facade (phone), no walker over the door, kite >= 12 px from the sun
 *   T-budget  whole-frame draw calls <= 60, triangles <= 60k, programs <= 12
 *   T-still   motion "still" renders one frame and no more (no rAF) in 2 s
 *   T-dispose after dispose() the context is lost, and dispose() is idempotent
 * then, per size, from the screenshots (the lab's tools/analyze.py, ported):
 *   T-colour  sunlit lawn hue in its window (morning 120-140, midday 100-120 at
 *             saturation <= 0.40, golden 80-95), golden lit-to-shadow lawn ratio
 *             >= 1.35, night zenith within dE00 8 of the dark card (32,35,50), lit
 *             night windows at luminance <= 0.88 with r >= g >= b, gulmohar hue drift
 *             <= 20 deg day to night, morning vs midday mean dE00 >= 6 over the lower
 *             60% (phone)
 * and the LIVE path a full-tier device runs:
 *   T-live      the loop starts and keeps rendering; a 1.4 s crossfade (setTod) reaches
 *               the target moment's sky with no new shader program
 *   T-midbuild  setTod() while build() is running: the first frame and the running loop
 *               both show the new moment
 *   T-context   a context lost while running is reported and stops the loop; a restore
 *               renders again with the shadow map refreshed
 *   T-governor  (phone) a governorMs no frame meets steps down to level 1, then level 2,
 *               and the loop stops
 * then 20 create/dispose cycles with no "Too many active WebGL contexts" warning, the
 * abort contract (an abort mid-build disposes), and a canary that proves the warning
 * detector can see the warning at all. A WARN row means the check could not run here
 * (WEBGL_lose_context missing, a build that finished before the probe could land): it
 * is printed but does not fail the run.
 *
 * Screenshots go to <os tmpdir>/salci-banner-test with results.json. The GPU here is
 * SwiftShader (software), so no frame time is a device number; only counts, pixels
 * and geometry are asserted.
 *
 * Env: CHROME_PATH (default: the installed Chrome), BANNER_CYCLES (default 20),
 * DIST_DIR (default dist/).
 */

import http from "node:http";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { inflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";

// fileURLToPath, not .pathname: the repo lives under "Salci Projects".
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIST = process.env.DIST_DIR ? resolve(process.env.DIST_DIR) : join(ROOT, "dist");
const HARNESS_DIR = join(ROOT, "scripts", "banner-harness");
const OUT = join(tmpdir(), "salci-banner-test");
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const CHROME_ARGS = ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"];
const MARKER = "isWebGLRenderer";

const TODS = ["morning", "midday", "golden", "dusk", "night"];
const SIZES = [
  { w: 343, h: 112, dpr: 1.5, phone: true },
  { w: 1168, h: 176, dpr: 2, phone: false },
];
const CYCLES = Number(process.env.BANNER_CYCLES || 20);
const STILL_WINDOW_MS = 2000;
// Where a mid-build abort lands, counted in event-loop turns (see abortMidBuild in the
// harness page for why a millisecond delay cannot aim inside the build).
const ABORT_POINTS = [
  { name: "abort at once", kind: "none", turns: 0 },
  { name: "abort after 1 yield", kind: "yield", turns: 1 },
  { name: "abort after 3 yields", kind: "yield", turns: 3 },
  { name: "abort at 1st timer", kind: "timer", turns: 1 },
];
// Where a mid-build setTod() lands, in setTimeout(0) turns (0: during the renderer phase;
// 2 and 5 landed inside compileAsync in the reviewer's probe, the window that was broken).
const MIDBUILD_TURNS = [0, 2, 5];
// Spec section 4: programs 12 or fewer (the inventory is 10; 11 measured).
const BUDGET = { calls: 60, triangles: 60_000, programs: 12 };
const THEME_FADE_MS = 1400; // useBannerTod's theme crossfade
const SKY_MATCH_DE = 6; // a live sky sample "is" a moment within this dE00 of its still
const GOVERNOR_MAX_MS = 90_000;
const CORNER = 20;
const FINIAL_MIN = 8 - 0.05; // pinned at exactly 8; probe() rounds to 0.1 px
// F.SWING in engine/figures.ts: a flank prop that may be cut by the side edge like
// the parked bus, so the corner rule (people, flag, school) does not apply to it.
const SWING = 8;
const WALKERS = [1, 2, 3, 4, 5, 6]; // father and the five children
const PEOPLE_MAX = 6; // teacher (0) through K5 (6)

// ── results table ───────────────────────────────────────────────────────────
const rows = [];
function add(test, tod, size, status, detail) {
  rows.push({ test, tod, size, status, detail });
}
// A group of sub-assertions becomes one row: PASS when all hold, else the failures.
function group(test, tod, size, checks) {
  const bad = checks.filter((c) => !c.ok);
  const status = bad.length === 0 ? "PASS" : "FAIL";
  const detail = (bad.length ? bad : checks).map((c) => c.text).join("; ");
  add(test, tod, size, status, detail);
}
const chk = (ok, text) => ({ ok: !!ok, text });
const r1 = (x) => Math.round(x * 10) / 10;

// ── colour math: sRGB -> CIELAB (D65) and CIEDE2000 ─────────────────────────
const lin = (c) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
function toLab([r, g, b]) {
  const R = lin(r), G = lin(g), B = lin(b);
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const fx = f(X), fy = f(Y), fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
function dE00([L1, a1, b1], [L2, a2, b2]) {
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2);
  const Cb7 = ((C1 + C2) / 2) ** 7;
  const G = 0.5 * (1 - Math.sqrt(Cb7 / (Cb7 + 25 ** 7)));
  const a1p = a1 * (1 + G), a2p = a2 * (1 + G);
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const hue = (b, a) => (b === 0 && a === 0 ? 0 : ((Math.atan2(b, a) / rad) % 360 + 360) % 360);
  const h1p = hue(b1, a1p), h2p = hue(b2, a2p);
  const dLp = L2 - L1, dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad);
  const Lbp = (L1 + L2) / 2, Cbp = (C1p + C2p) / 2;
  let hbp = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) <= 180) hbp = (h1p + h2p) / 2;
    else hbp = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
  }
  const T = 1 - 0.17 * Math.cos((hbp - 30) * rad) + 0.24 * Math.cos(2 * hbp * rad) +
    0.32 * Math.cos((3 * hbp + 6) * rad) - 0.2 * Math.cos((4 * hbp - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hbp - 275) / 25) ** 2));
  const Cbp7 = Cbp ** 7;
  const Rc = 2 * Math.sqrt(Cbp7 / (Cbp7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2);
  const Sc = 1 + 0.045 * Cbp, Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
}

// ── more colour helpers, numpy-compatible (T-colour ports tools/analyze.py) ───
const lumY = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
function hsvOf([r, g, b]) {
  const R = r / 255, G = g / 255, B = b / 255;
  const mx = Math.max(R, G, B), mn = Math.min(R, G, B), d = mx - mn + 1e-9;
  let h;
  if (mx === R) h = ((((G - B) / d) % 6) + 6) % 6;
  else if (mx === G) h = (B - R) / d + 2;
  else h = (R - G) / d + 4;
  return [h * 60, (mx - mn) / (mx + 1e-9), mx];
}
// numpy.median: the mean of the two middle values for an even count
function npMedian(a) {
  if (!a.length) return NaN;
  const s = Float64Array.from(a).sort();
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
// numpy.percentile, linear interpolation
function npPercentile(a, p) {
  const s = Float64Array.from(a).sort();
  const i = ((s.length - 1) * p) / 100, lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}
const medianRgbNp = (list) => [0, 1, 2].map((ch) => npMedian(list.map((p) => p[ch])));
const mod = (x, m) => ((x % m) + m) % m;
// A screen box (CSS px) as a device-pixel slice, numpy-style: int() and clamped ends.
function cropRange(img, bx, s, inset = 0) {
  const x0 = bx.x0 * s, x1 = bx.x1 * s, y0 = bx.y0 * s, y1 = bx.y1 * s;
  const dx = (x1 - x0) * inset, dy = (y1 - y0) * inset;
  const cl = (v, max) => Math.min(max, Math.trunc(Math.max(0, v)));
  return { x0: cl(x0 + dx, img.width), x1: cl(x1 - dx, img.width), y0: cl(y0 + dy, img.height), y1: cl(y1 - dy, img.height) };
}
function pixelsIn(img, r) {
  const out = [];
  for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) out.push(img.rgb(x, y));
  return out;
}

// ── PNG decoding (8-bit, non-interlaced: what Chrome's screenshots are) ─────
function decodePng(buf) {
  const SIG = [137, 80, 78, 71, 13, 10, 26, 10];
  if (SIG.some((b, i) => buf[i] !== b)) throw new Error("screenshot is not a PNG");
  let off = 8, width = 0, height = 0, depth = 0, ctype = 0, interlace = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("latin1", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      ctype = data[9];
      interlace = data[12];
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    off += 12 + len;
  }
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[ctype];
  if (depth !== 8 || !channels || interlace !== 0) {
    throw new Error(`unsupported PNG: depth ${depth}, colour type ${ctype}, interlace ${interlace}`);
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const px = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? px[dst + x - channels] : 0;
      const b = y > 0 ? px[dst - stride + x] : 0;
      const c = x >= channels && y > 0 ? px[dst - stride + x - channels] : 0;
      let v = raw[src + x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`bad PNG filter ${filter}`);
      px[dst + x] = v & 255;
    }
  }
  const rgb = (x, y) => {
    const cx = Math.min(width - 1, Math.max(0, x)), cy = Math.min(height - 1, Math.max(0, y));
    const i = (cy * width + cx) * channels;
    return channels < 3 ? [px[i], px[i], px[i]] : [px[i], px[i + 1], px[i + 2]];
  };
  return { width, height, rgb };
}

// ── T-flag ──────────────────────────────────────────────────────────────────
const TARGET = { saffron: [255, 153, 51], white: [255, 255, 255], green: [19, 136, 8], navy: [0, 0, 128] };
const TARGET_LAB = Object.fromEntries(Object.entries(TARGET).map(([k, v]) => [k, toLab(v)]));
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
};
const medianRgb = (list) => [0, 1, 2].map((ch) => median(list.map((p) => p[ch])));

function flagChecks(img, pr, size) {
  const sx = img.width / size.w, sy = img.height / size.h;
  const f = pr.flag;
  const X0 = f.x0 * sx, X1 = f.x1 * sx, Y0 = f.y0 * sy, Y1 = f.y1 * sy;
  const fw = X1 - X0, fh = Y1 - Y0;
  if (!(fw > 2 && fh > 2) || X1 < 0 || X0 > img.width || Y1 < 0 || Y0 > img.height) {
    return [chk(false, `flag box off-frame or empty (${JSON.stringify(f)})`)];
  }
  // A strip centred 25% of the way from the hoist (the flag flies +x from the pole),
  // inset 6% top and bottom; each pixel joins the nearest flag colour within dE00 25.
  const cx = X0 + 0.25 * fw, half = Math.max(1.5, 0.05 * fw);
  const clusters = { saffron: [], white: [], green: [], navy: [] };
  for (let y = Math.ceil(Y0 + 0.06 * fh); y <= Math.floor(Y1 - 0.06 * fh); y++) {
    for (let x = Math.ceil(cx - half); x <= Math.floor(cx + half); x++) {
      const p = img.rgb(x, y);
      const L = toLab(p);
      let best = null, bestD = Infinity;
      for (const k of Object.keys(TARGET_LAB)) {
        const d = dE00(L, TARGET_LAB[k]);
        if (d < bestD) { bestD = d; best = k; }
      }
      if (bestD < 25) clusters[best].push({ p, y });
    }
  }
  const band = (k) => {
    const c = clusters[k];
    if (c.length < 3) return null;
    const rgb = medianRgb(c.map((e) => e.p));
    return { rgb, n: c.length, dE: dE00(toLab(rgb), TARGET_LAB[k]), L: toLab(rgb)[0], y: c.reduce((s, e) => s + e.y, 0) / c.length };
  };
  const sf = band("saffron"), wh = band("white"), gr = band("green");
  const out = [];
  out.push(sf ? chk(sf.dE <= 5, `saffron dE00 ${sf.dE.toFixed(2)} rgb(${sf.rgb})`) : chk(false, "no saffron pixels at 25% from the hoist"));
  out.push(gr ? chk(gr.dE <= 5, `green dE00 ${gr.dE.toFixed(2)} rgb(${gr.rgb})`) : chk(false, "no green pixels at 25% from the hoist"));
  out.push(wh ? chk(wh.L >= 95, `white L* ${wh.L.toFixed(1)}`) : chk(false, "no white pixels at 25% from the hoist"));
  out.push(chk(sf && wh && gr && sf.y < wh.y && wh.y < gr.y, sf && gr ? "saffron on top" : "band order unknown"));
  // the chakra: middle of the white band, 30% to 62% across (the cloth folds toward the fly)
  let navy = 0, darkest = Infinity;
  for (let y = Math.ceil(Y0 + 0.38 * fh); y <= Math.floor(Y0 + 0.62 * fh); y++) {
    for (let x = Math.ceil(X0 + 0.3 * fw); x <= Math.floor(X0 + 0.62 * fw); x++) {
      const p = img.rgb(x, y);
      if (p[2] > p[0] + 40) {
        navy++;
        darkest = Math.min(darkest, toLab(p)[0]);
      }
    }
  }
  out.push(chk(navy > 0 && darkest < 30, navy ? `chakra navy ${navy} px, darkest L* ${darkest.toFixed(0)}` : "no navy chakra pixels"));
  return out;
}

// ── T-frame ─────────────────────────────────────────────────────────────────
const hit = (b, c) => !(b.x1 < c[0] || b.x0 > c[2] || b.y1 < c[1] || b.y0 > c[3]);
function frameChecks(pr, size) {
  const { w, h } = size;
  const out = [chk(pr.finial[1] >= FINIAL_MIN, `finial ${r1(pr.finial[1])} px from the top`)];
  if (size.phone) {
    const fw = pr.flag.x1 - pr.flag.x0;
    out.push(chk(fw >= 22, `flag ${r1(fw)} px wide`));
    const sw = (pr.school.x1 - pr.school.x0) / w;
    out.push(chk(sw >= 0.55, `school ${(sw * 100).toFixed(1)}% of the width`));
  }
  const corners = [[0, 0, CORNER, CORNER], [w - CORNER, 0, w, CORNER], [0, h - CORNER, CORNER, h], [w - CORNER, h - CORNER, w, h]];
  const things = [["flag", pr.flag], ["school", pr.school], ...pr.figures.filter((f) => f.i !== SWING).map((f) => [`figure ${f.i}`, f])];
  const inCorner = things.filter(([, b]) => corners.some((c) => hit(b, c))).map(([n]) => n);
  out.push(chk(inCorner.length === 0, inCorner.length ? `in a corner: ${inCorner.join(", ")}` : "corners clear"));
  const { pole, tower } = pr;
  const onTower = pole.x0 >= tower.x0 && pole.x1 <= tower.x1 && pole.y1 >= tower.y0 - 0.5 && pole.y1 <= tower.y1;
  out.push(chk(onTower, onTower ? "pole on the tower" : `pole ${JSON.stringify(pole)} outside tower ${JSON.stringify(tower)}`));
  return out;
}
// The rest of spec 5.3 T-frame (section 2.1 safe zones and 2.7 rows 10 and 17).
function frameLayoutChecks(pr, size) {
  const { w, h } = size;
  const out = [];
  const feet = pr.figures.filter((f) => f.i <= PEOPLE_MAX).map((f) => f.y1);
  if (feet.length) out.push(chk(Math.max(...feet) <= h - 6 + 0.5, `lowest foot ${r1(h - Math.max(...feet))} px from the bottom`));
  const fac = pr.facade, door = pr.door;
  if (size.phone) {
    const over = pr.trees.filter((t) => t.x1 > 0 && t.x0 < w && hit(t, [fac.x0, fac.y0, fac.x1, fac.y1])).map((t) => t.c);
    out.push(chk(over.length === 0, over.length ? `trees over the facade: ${over.join(", ")}` : "no tree over the facade"));
  }
  const atDoor = pr.figures.filter((f) => WALKERS.includes(f.i) && hit(f, [door.x0, door.y0, door.x1, door.y1]) && f.y1 > door.y1 + 1).map((f) => f.i);
  out.push(chk(atDoor.length === 0, atDoor.length ? `walkers over the door: ${atDoor.join(", ")}` : "no walker over the door"));
  if (pr.kite && pr.sun.amt > 0.1) {
    const k = pr.kite, s = pr.sun;
    const d = Math.hypot(Math.max(k.x0 - s.x, 0, s.x - k.x1), Math.max(k.y0 - s.y, 0, s.y - k.y1)) - s.r;
    out.push(chk(d >= 12, `kite ${r1(d)} px from the sun disc`));
  }
  return out;
}

// ── T-colour (spec 5.3; the lab's tools/analyze.py, same masks and statistics) ─
const LAWN_HUE = { morning: [120, 140], midday: [100, 120], golden: [80, 95] };
const DARK_CARD = [32, 35, 50];

// sunlit lawn: green pixels in the lawn band, the brightest 40% of them
function lawnChecks(shot) {
  const { img, probe, size, tod } = shot;
  const win = LAWN_HUE[tod];
  if (!win) return [];
  const s = img.width / size.w;
  const [b0, b1] = probe.lawnBand;
  const rows = { x0: 0, x1: img.width, y0: Math.min(img.height, Math.trunc(Math.max(0, b0 * s))), y1: Math.min(img.height, Math.trunc(Math.max(0, b1 * s))) };
  const green = [];
  for (const p of pixelsIn(img, rows)) {
    const [h, sat, v] = hsvOf(p);
    if (p[1] > p[0] && p[1] > p[2] && sat > 0.12 && h > 60 && h < 170) green.push([h, sat, v]);
  }
  if (green.length <= 50) return [chk(false, `lawn: only ${green.length} green pixels in the lawn band`)];
  const thr = npPercentile(green.map((g) => g[2]), 60);
  const top = green.filter((g) => g[2] >= thr);
  const hue = npMedian(top.map((g) => g[0]));
  const sat = npMedian(top.map((g) => g[1]));
  const ok = win[0] <= hue && hue <= win[1] && (tod !== "midday" || sat <= 0.4);
  return [chk(ok, `lawn sunlit hue ${hue.toFixed(0)} (window ${win[0]} to ${win[1]}) sat ${sat.toFixed(2)}`)];
}

// golden: the lawn under shadow vs the same pixels with the shadow map off
function goldenShadowCheck(shot) {
  const { img, noShadow: ns } = shot;
  if (!ns || ns.width !== img.width || ns.height !== img.height) return [chk(false, "golden: no matching no-shadow shot")];
  const litA = [], shadA = [];
  for (let y = Math.trunc(img.height * 0.55); y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const p = img.rgb(x, y), q = ns.rgb(x, y);
      if (!(p[1] > p[0] * 0.8 && q[1] > q[2])) continue;
      const a = lumY(p), bb = lumY(q);
      if (a < bb * 0.8) shadA.push(a);
      else if (Math.abs(a - bb) < bb * 0.03) litA.push(a);
    }
  }
  if (shadA.length <= 30 || litA.length <= 30) return [chk(false, `golden shadow sample too small: lit ${litA.length}, shadowed ${shadA.length}`)];
  const ratio = npMedian(litA.map(Math.sqrt)) / npMedian(shadA.map(Math.sqrt));
  const ratioY = npMedian(litA) / npMedian(shadA);
  return [chk(ratio >= 1.35 || ratioY >= 1.35, `golden lit/shadow lawn ${ratio.toFixed(2)} (perceptual) / ${ratioY.toFixed(2)} (Y), ${shadA.length} shadowed px`)];
}

// night: the zenith against the dark card, and no lit window blown out or off-hue
function nightChecks(shot) {
  const { img, probe } = shot;
  const s = img.width / shot.size.w;
  const zen = medianRgbNp(pixelsIn(img, { x0: 0, x1: Math.trunc(img.width * 0.3), y0: 0, y1: Math.trunc(img.height * 0.12) }));
  const dz = dE00(toLab(zen), toLab(DARK_CARD));
  const out = [chk(dz <= 8, `night zenith rgb(${zen.map(Math.round)}) dE00 ${dz.toFixed(1)} vs the dark card`)];
  let maxL = 0, order = true, lit = 0;
  for (const wb of probe.windows) {
    if (wb.lvl < 1) continue;
    const px = pixelsIn(img, cropRange(img, wb, s, 0.15));
    if (!px.length) continue;
    lit++;
    let best = -1, bi = 0;
    for (let i = 0; i < px.length; i++) {
      const L = lumY(px[i]);
      if (L > best) { best = L; bi = i; }
    }
    maxL = Math.max(maxL, best);
    const p = px[bi];
    order = order && p[0] >= p[1] && p[1] >= p[2];
  }
  out.push(chk(lit > 0, `${lit} lit windows on screen`));
  out.push(chk(maxL <= 0.88, `window max luminance ${maxL.toFixed(2)}`));
  out.push(chk(order, order ? "window pixels r >= g >= b" : "a window's brightest pixel is not r >= g >= b"));
  return out;
}

// the gulmohar canopy (TREES[0]) keeps its coral hue at night
function canopyHue(shot, tb) {
  const s = shot.img.width / shot.size.w;
  const r = cropRange(shot.img, tb, s, 0.12);
  r.y1 = r.y0 + Math.max(1, Math.trunc((r.y1 - r.y0) * 0.55));
  let sn = 0, cs = 0, n = 0;
  for (const p of pixelsIn(shot.img, r)) {
    const [h, sat] = hsvOf(p);
    if (sat > 0.18 && (h < 60 || h > 300)) {
      sn += Math.sin((h * Math.PI) / 180);
      cs += Math.cos((h * Math.PI) / 180);
      n++;
    }
  }
  return n > 10 ? mod((Math.atan2(sn / n, cs / n) * 180) / Math.PI, 360) : null;
}

function colourRows(label, size, shots) {
  const at = (tod) => shots.get(`${tod}|${label}`);
  for (const tod of ["morning", "midday", "golden"]) {
    const shot = at(tod);
    if (!shot) continue;
    const checks = lawnChecks(shot);
    if (tod === "golden") checks.push(...goldenShadowCheck(shot));
    group("T-colour", tod, label, checks);
  }
  const night = at("night"), midday = at("midday"), morning = at("morning");
  if (night) {
    const checks = nightChecks(night);
    const tb = midday && midday.probe.trees[0];
    if (tb && tb.x1 >= 0) {
      const hd = canopyHue(midday, tb), hn = canopyHue(night, tb);
      if (hd === null || hn === null) checks.push(chk(false, `gulmohar canopy not found (day ${hd}, night ${hn})`));
      else {
        const drift = Math.abs(mod(hn - hd + 180, 360) - 180);
        checks.push(chk(drift <= 20, `gulmohar hue ${hd.toFixed(0)} by day, ${hn.toFixed(0)} at night: drift ${drift.toFixed(0)} deg`));
      }
    }
    group("T-colour", "night", label, checks);
  }
  if (size.phone && morning && midday && morning.img.width === midday.img.width && morning.img.height === midday.img.height) {
    const a = morning.img, b = midday.img;
    let sum = 0, n = 0;
    for (let y = Math.trunc(a.height * 0.4); y < a.height; y++) {
      for (let x = 0; x < a.width; x++) {
        sum += dE00(toLab(a.rgb(x, y)), toLab(b.rgb(x, y)));
        n++;
      }
    }
    const mean = sum / n;
    group("T-colour", "morning vs midday", label, [chk(mean >= 6, `mean dE00 ${mean.toFixed(1)} over the lower 60%`)]);
  }
}

// ── static server for dist/ + the harness page ──────────────────────────────
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
};
const notFound = [];
function serve() {
  const server = http.createServer((req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }
    const inHarness = pathname.startsWith("/harness/");
    const base = inHarness ? HARNESS_DIR : DIST;
    const file = resolve(base, `.${inHarness ? pathname.slice("/harness".length) : pathname}`);
    if (file !== base && !file.startsWith(base + sep)) {
      res.writeHead(403).end();
      return;
    }
    if (!existsSync(file) || !statSync(file).isFile()) {
      notFound.push(pathname);
      res.writeHead(404, { "content-type": "text/plain" }).end("not found");
      return;
    }
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
    res.end(readFileSync(file));
  });
  return new Promise((ok, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => ok(server));
  });
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.m?js$/.test(name)) out.push(p);
  }
  return out;
}

function within(promise, ms, what) {
  let timer;
  const t = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${Math.round(ms / 1000)} s`)), ms);
  });
  return Promise.race([promise, t]).finally(() => clearTimeout(timer));
}
const firstLine = (e) => String((e && e.message) || e).split("\n")[0].slice(0, 240);

// ── console capture (every page) ────────────────────────────────────────────
// Errors raised while the context-loss probe runs are charged to its own T-context row
// (which fails on them), not to T-console, so the failure names the step that caused it.
// Every message is tagged with the step that was running, so a warning can be traced.
const consoleErrors = [];
const probeErrors = [];
const consoleWarnings = new Map(); // text -> steps it appeared in
let tooManyContexts = 0;
let probePhase = false;
let step = "load";
const TOO_MANY = /Too many active WebGL contexts/i;
function wire(page, where) {
  const push = (text) => (probePhase ? probeErrors : consoleErrors).push(`${where} ${step}: ${text}`);
  page.on("console", (m) => {
    const text = m.text();
    if (TOO_MANY.test(text)) tooManyContexts++;
    if (m.type() === "error") push(text.slice(0, 200));
    else if (m.type() === "warning") {
      const key = text.slice(0, 160);
      if (!consoleWarnings.has(key)) consoleWarnings.set(key, new Set());
      consoleWarnings.get(key).add(`${step} ${where}`);
    }
  });
  page.on("pageerror", (e) => push(`pageerror ${firstLine(e)}`));
}

// ── one scene: build, still window, probe, screenshot, dispose ──────────────
const results = [];
// `${tod}|${label}` -> { img, noShadow, probe, size, tod }: T-colour and the live sky
// references read the stills after every moment at a size has been shot.
const shots = new Map();
async function runScene(page, tod, size) {
  const label = `${size.w}x${size.h}@${size.dpr}`;
  const record = { tod, size: label };
  results.push(record);
  try {
    step = `${tod} build`;
    const opened = await within(page.evaluate((o) => window.harness.open(o), { tod, w: size.w, h: size.h }), 180_000, `build ${tod} ${label}`);
    record.opened = opened;
    step = `${tod} still window`;
    const still = await within(page.evaluate((ms) => window.harness.still(ms), STILL_WINDOW_MS), 70_000, "still window");
    record.still = still;
    step = `${tod} measure`;
    const { probe, stats } = await page.evaluate(() => window.harness.measure());
    record.probe = probe;
    record.stats = stats;
    const png = await page.screenshot({ clip: { x: 0, y: 0, width: size.w, height: size.h }, type: "png" });
    const shotFile = join(OUT, `${tod}__${size.w}x${size.h}@${size.dpr}x.png`);
    writeFileSync(shotFile, png);
    record.screenshot = shotFile;
    const img = decodePng(png);
    const shot = { img, noShadow: null, probe, size, tod };
    shots.set(`${tod}|${label}`, shot);

    group("T-flag", tod, label, flagChecks(img, probe, size));
    group("T-frame", tod, label, [...frameChecks(probe, size), ...frameLayoutChecks(probe, size)]);
    const calls = Math.max(stats.drawCalls, stats.refreshDrawCalls);
    const tris = Math.max(stats.triangles, stats.refreshTriangles);
    group("T-budget", tod, label, [
      chk(calls <= BUDGET.calls, `calls ${stats.drawCalls} (shadow frame ${stats.refreshDrawCalls})`),
      chk(tris <= BUDGET.triangles, `tris ${(stats.triangles / 1000).toFixed(1)}k (${(stats.refreshTriangles / 1000).toFixed(1)}k)`),
      chk(stats.programs <= BUDGET.programs, `programs ${stats.programs}`),
    ]);
    group("T-still", tod, label, [
      chk(opened.framesAfterBuild === 1, `${opened.framesAfterBuild} frame after build`),
      chk(opened.firstFrameAfterBuild === 1 && still.firstFrame === 1, `onFirstFrame x${still.firstFrame}`),
      chk(still.frames === 0, `+${still.frames} frames in ${STILL_WINDOW_MS / 1000} s`),
      chk(still.raf === 0, `${still.raf} rAF`),
      chk(!still.running, still.running ? "loop running" : "loop stopped"),
    ]);
    if (tod === "golden") {
      // last on this scene: it switches the shadow map off
      step = `${tod} no-shadow twin`;
      await page.evaluate(() => window.harness.noShadow());
      const twin = await page.screenshot({ clip: { x: 0, y: 0, width: size.w, height: size.h }, type: "png" });
      writeFileSync(join(OUT, `${tod}__${size.w}x${size.h}@${size.dpr}x__noshadow.png`), twin);
      shot.noShadow = decodePng(twin);
    }
  } catch (e) {
    add("T-run", tod, label, "FAIL", firstLine(e));
  } finally {
    step = `${tod} dispose`;
    try {
      const c = await within(page.evaluate(() => window.harness.close()), 15_000, "dispose");
      record.close = c;
      if (!c.none) {
        group("T-dispose", tod, label, [
          chk(c.threw === null, c.threw ? `dispose threw: ${c.threw}` : "dispose ok"),
          chk(c.created > 0 && c.lostMs >= 0, c.created === 0 ? "no WebGL context was created" : c.lostMs >= 0 ? `context lost after ${c.lostMs} ms` : "context still live 1 s after dispose"),
          chk(c.again === null, c.again ? `second dispose threw: ${c.again}` : "idempotent"),
        ]);
      }
    } catch (e) {
      add("T-dispose", tod, label, "FAIL", firstLine(e));
    }
  }
  return record;
}

// ── lifecycle: 20 cycles, abort mid-build, dispose before build ─────────────
async function runLifecycle(page, size) {
  const label = `${size.w}x${size.h}@${size.dpr}`;
  const base = { tod: "midday", w: size.w, h: size.h };
  step = "cycles";
  try {
    const cy = await within(page.evaluate((o) => window.harness.cycles(o), { ...base, n: CYCLES }), 30 * 60_000, "cycles");
    results.push({ lifecycle: "cycles", size: label, ...cy });
    group("T-dispose", `${CYCLES} cycles`, label, [
      chk(cy.done === CYCLES && cy.errors.length === 0, cy.errors.length ? `errors: ${cy.errors.slice(0, 2).join(" | ")}` : `${cy.done}/${CYCLES} built and disposed`),
      chk(cy.notLost === 0, `${cy.notLost} contexts not lost`),
      chk(true, `build median ${median(cy.buildMs)} ms`),
    ]);
  } catch (e) {
    add("T-dispose", `${CYCLES} cycles`, label, "FAIL", firstLine(e));
  }
  for (const point of ABORT_POINTS) {
    const { name } = point;
    step = name;
    try {
      const a = await within(page.evaluate((o) => window.harness.abortMidBuild(o), { ...base, ...point }), 60_000, name);
      results.push({ lifecycle: name, size: label, ...a });
      if (a.finishedBeforeAbort) {
        add("T-abort", name, label, "WARN", "build finished before the abort, so the abort path was not exercised");
        continue;
      }
      group("T-abort", name, label, [
        chk(a.lostMs >= 0, a.created === 0 ? "no context created" : a.lostMs >= 0 ? `context lost after ${a.lostMs} ms` : "context still live 5 s after the abort"),
        chk(!a.running, a.running ? "loop running" : "loop stopped"),
        chk(a.disposeThrew === null, a.disposeThrew ? `dispose after abort threw: ${a.disposeThrew}` : "dispose after abort ok"),
        chk(true, a.rejected ? `build rejected: ${a.rejected}` : "build resolved"),
      ]);
    } catch (e) {
      add("T-abort", name, label, "FAIL", firstLine(e));
    }
  }
  step = "dispose before build";
  try {
    const d = await within(page.evaluate((o) => window.harness.disposeBeforeBuild(o), base), 60_000, "dispose before build");
    results.push({ lifecycle: "dispose before build", size: label, ...d });
    group("T-abort", "dispose first", label, [
      chk(d.created === 0 || d.lostMs >= 0, d.created === 0 ? "no context created" : d.lostMs >= 0 ? "context lost" : "a live context was left behind"),
      chk(d.firstFrame === 0, `onFirstFrame x${d.firstFrame}`),
      chk(true, d.rejected ? `build rejected: ${d.rejected}` : "build resolved"),
    ]);
  } catch (e) {
    add("T-abort", "dispose first", label, "FAIL", firstLine(e));
  }
}

// ── the live path: loop, crossfade, setTod mid-build, context loss, governor ──
// Sky samples, CSS px: the top rows, clear of the finial and flag in the middle. The
// per-channel median ignores the odd cloud or star over a point.
function skyPoints(size) {
  return [0.04, 0.12, 0.2, 0.28, 0.36, 0.64, 0.72, 0.8, 0.88, 0.96].map((f) => [Math.round(f * size.w), 3]);
}
function skyOfShot(shot, pts) {
  const s = shot.img.width / shot.size.w;
  return medianRgbNp(pts.map(([x, y]) => shot.img.rgb(Math.round(x * s), Math.round(y * s))));
}
const skyDe = (px, ref) => (px && px.length ? dE00(toLab(medianRgbNp(px)), toLab(ref)) : Infinity);

async function runLive(page, size) {
  const label = `${size.w}x${size.h}@${size.dpr}`;
  const pts = skyPoints(size);
  const golden = shots.get(`golden|${label}`), night = shots.get(`night|${label}`);
  if (!golden || !night) {
    add("T-live", "-", label, "FAIL", "no golden or night still to compare the live sky against");
    return;
  }
  const refGolden = skyOfShot(golden, pts), refNight = skyOfShot(night, pts);
  const base = { w: size.w, h: size.h };

  // T-live: build, start, run; crossfade golden -> night over the theme fade
  step = "live loop";
  let opened = false;
  try {
    const o = await within(page.evaluate((a) => window.harness.openLive(a), { ...base, tod: "golden" }), 60_000, "live build");
    opened = true;
    const run = await within(page.evaluate((ms) => window.harness.runFor(ms), 2000), 30_000, "live run");
    const before = await page.evaluate((p) => window.harness.sample(p), pts);
    const dBefore = skyDe(before, refGolden);
    group("T-live", "golden", label, [
      chk(o.running && run.running, run.running ? "loop running" : "loop not running after start()"),
      chk(run.frames >= 3, `+${run.frames} frames, ${run.raf} rAF in 2 s`),
      chk(dBefore <= SKY_MATCH_DE, `live sky dE00 ${dBefore.toFixed(1)} from the golden still`),
    ]);
    step = "live crossfade";
    await page.evaluate(([t, ms]) => window.harness.setTod(t, ms), ["night", THEME_FADE_MS]);
    const t0 = Date.now();
    let dNight = Infinity;
    while (Date.now() - t0 < 15_000) {
      await page.waitForTimeout(400);
      dNight = skyDe(await page.evaluate((p) => window.harness.sample(p), pts), refNight);
      if (dNight <= SKY_MATCH_DE) break;
    }
    const after = await page.evaluate((ms) => window.harness.runFor(ms), 1000);
    group("T-live", "golden to night", label, [
      chk(dNight <= SKY_MATCH_DE, `sky dE00 ${dNight === Infinity ? "n/a" : dNight.toFixed(1)} from the night still after ${((Date.now() - t0) / 1000).toFixed(1)} s`),
      chk(after.tod === "night", `tod ${after.tod}`),
      chk(after.running && after.frames >= 1, after.running ? `still looping (+${after.frames} frames)` : "loop stopped after the crossfade"),
      chk(after.programs <= BUDGET.programs, `programs ${after.programs} after the crossfade`),
    ]);
  } catch (e) {
    add("T-live", "golden", label, "FAIL", firstLine(e));
  }

  // T-context on the running scene
  if (opened) {
    step = "live context loss";
    probePhase = true;
    const errorsBefore = probeErrors.length;
    try {
      const c = await within(page.evaluate(() => window.harness.contextLoss()), 30_000, "context loss");
      await page.waitForTimeout(100); // let any late console message arrive inside the phase
      results.push({ lifecycle: "context loss", size: label, ...c });
      if (c.skipped) add("T-context", "live", label, "WARN", c.skipped);
      else {
        const errs = probeErrors.slice(errorsBefore);
        group("T-context", "live", label, [
          chk(c.runningBefore, c.runningBefore ? "loop running before the loss" : "loop was not running, the check proves nothing"),
          chk(c.lostSeen === 1, `onContextLost x${c.lostSeen}`),
          chk(!c.runningWhileLost, c.runningWhileLost ? "loop ran while lost" : "stopped while lost"),
          chk(c.restoredSeen === 1, `onContextRestored x${c.restoredSeen}`),
          chk(c.framesAdded >= 1 && c.shadowRefreshesAdded >= 1, `+${c.framesAdded} frame, +${c.shadowRefreshesAdded} shadow refresh`),
          chk(errs.length === 0, errs.length ? `errors: ${errs.slice(0, 2).join(" | ")}` : "no errors"),
        ]);
      }
    } catch (e) {
      add("T-context", "live", label, "FAIL", firstLine(e));
    } finally {
      probePhase = false;
    }
    step = "live dispose";
    try {
      const c = await within(page.evaluate(() => window.harness.close()), 15_000, "dispose");
      group("T-dispose", "live", label, [
        chk(c.threw === null, c.threw ? `dispose threw: ${c.threw}` : "dispose ok"),
        chk(c.created > 0 && c.lostMs >= 0, c.lostMs >= 0 ? `context lost after ${c.lostMs} ms` : "context still live 1 s after dispose"),
        chk(c.again === null, c.again ? `second dispose threw: ${c.again}` : "idempotent"),
      ]);
    } catch (e) {
      add("T-dispose", "live", label, "FAIL", firstLine(e));
    }
  }

  // T-midbuild: the moment changes while build() runs (a theme toggle in that window)
  for (const turns of MIDBUILD_TURNS) {
    step = `setTod mid-build (${turns} turns)`;
    const name = `golden to night, ${turns} turns`;
    try {
      const m = await within(page.evaluate((a) => window.harness.setTodMidBuild(a), { ...base, from: "golden", to: "night", turns, pts }), 60_000, step);
      results.push({ lifecycle: "setTod mid-build", size: label, turns, ...m });
      if (!m.switchedBeforeDone) {
        add("T-midbuild", name, label, "WARN", "build finished before the setTod, so the mid-build path was not exercised");
        continue;
      }
      const dBuilt = skyDe(m.built, refNight), dRun = skyDe(m.running, refNight);
      group("T-midbuild", name, label, [
        chk(m.tod === "night", `tod ${m.tod}`),
        chk(dBuilt <= SKY_MATCH_DE, `built frame sky dE00 ${dBuilt.toFixed(1)} from night (${skyDe(m.built, refGolden).toFixed(1)} from golden)`),
        chk(dRun <= SKY_MATCH_DE, `running sky dE00 ${dRun.toFixed(1)} from night`),
      ]);
    } catch (e) {
      add("T-midbuild", name, label, "FAIL", firstLine(e));
    }
  }

  // T-governor (phone): two slow windows of 60 frames, then the still
  if (size.phone) {
    step = "governor";
    try {
      const g = await within(page.evaluate((a) => window.harness.governor(a), { ...base, tod: "midday", maxMs: GOVERNOR_MAX_MS }), GOVERNOR_MAX_MS + 30_000, "governor");
      results.push({ lifecycle: "governor", size: label, ...g });
      group("T-governor", "midday", label, [
        chk(g.levels.join(",") === "1,2", `onGovernor levels [${g.levels.join(", ")}] after ${(g.ms / 1000).toFixed(1)} s, ${g.frames} frames`),
        chk(g.governor === 2, `stats.governor ${g.governor}`),
        chk(g.dpr === 1, `dpr ${g.dpr} after level 1`),
        chk(!g.running, g.running ? "loop still running after level 2" : "loop stopped"),
      ]);
    } catch (e) {
      add("T-governor", "midday", label, "FAIL", firstLine(e));
    }
  }
}

// ── main ────────────────────────────────────────────────────────────────────
function printTable() {
  const head = { test: "TEST", tod: "MOMENT", size: "SIZE", status: "RESULT", detail: "DETAIL" };
  const all = [head, ...rows];
  const wd = (k) => Math.max(...all.map((r) => String(r[k]).length));
  const wT = wd("test"), wM = wd("tod"), wS = wd("size"), wR = wd("status");
  console.log("");
  for (const r of all) {
    console.log(`  ${String(r.test).padEnd(wT)}  ${String(r.tod).padEnd(wM)}  ${String(r.size).padEnd(wS)}  ${String(r.status).padEnd(wR)}  ${r.detail}`);
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });

  // T-math: the colour maths against Sharma, Wu & Dalal (2005), pairs 1 and 17
  const s1 = dE00([50, 2.6772, -79.7751], [50, 0, -82.7485]);
  const s17 = dE00([50, 2.5, 0], [73, 25, -18]);
  group("T-math", "-", "-", [
    chk(Math.abs(s1 - 2.0425) < 1e-3, `dE00 pair 1 = ${s1.toFixed(4)} (2.0425)`),
    chk(Math.abs(s17 - 27.1492) < 1e-3, `pair 17 = ${s17.toFixed(4)} (27.1492)`),
  ]);

  if (!existsSync(join(DIST, "index.html"))) {
    add("T-load", "-", "-", "FAIL", `${DIST} has no build: run \`npx vite build\` first`);
    return finish();
  }
  const chunks = walk(DIST).filter((f) => readFileSync(f, "utf8").includes(MARKER));
  if (chunks.length !== 1) {
    add("T-load", "-", "-", "FAIL", chunks.length === 0
      ? `no chunk in dist/ contains "${MARKER}": build with the engine, or see npm run check:banner-chunk`
      : `three is in ${chunks.length} chunks (${chunks.map((c) => relative(DIST, c)).join(", ")}): see npm run check:banner-chunk`);
    return finish();
  }
  const chunkUrl = `/${relative(DIST, chunks[0]).split(sep).join("/")}`;
  if (!existsSync(CHROME)) {
    add("T-load", "-", "-", "FAIL", `Chrome not found at ${CHROME}: set CHROME_PATH`);
    return finish();
  }
  let chromium;
  try {
    ({ chromium } = await import("playwright-core"));
  } catch (e) {
    add("T-load", "-", "-", "FAIL", `playwright-core is not installed (npm install): ${firstLine(e)}`);
    return finish();
  }

  const server = await serve();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: CHROME_ARGS });
  let gpu = "unknown";
  try {
    for (const size of SIZES) {
      const label = `${size.w}x${size.h}@${size.dpr}`;
      const ctx = await browser.newContext({ viewport: { width: 1200, height: 320 }, deviceScaleFactor: size.dpr });
      const page = await ctx.newPage();
      wire(page, label);
      try {
        await page.goto(`${origin}/harness/index.html`);
        await page.waitForFunction(() => window.__harnessReady === true, null, { timeout: 15_000 });
        const loaded = await within(page.evaluate((u) => window.harness.load(u), chunkUrl), 60_000, "chunk import");
        group("T-load", "-", label, [
          chk(loaded.hasCreate, loaded.hasCreate ? `${chunkUrl.slice(1)} exports createSchoolScene` : `createSchoolScene missing; exports: ${loaded.exports.join(", ")}`),
        ]);
        if (!loaded.hasCreate) continue;
        for (const tod of TODS) {
          const rec = await runScene(page, tod, size);
          if (rec.opened && gpu === "unknown") gpu = rec.opened.gpu;
        }
        colourRows(label, size, shots);
        await runLive(page, size);
        if (size.phone) await runLifecycle(page, size);
        const live = await page.evaluate(() => window.harness.liveContexts());
        group("T-dispose", "leftover", label, [chk(live === 0, `${live} live engine contexts at the end`)]);
      } catch (e) {
        add("T-run", "-", label, "FAIL", firstLine(e));
      } finally {
        await ctx.close();
      }
    }

    // Canary last, on its own page: prove the detector sees the context-limit warning.
    const seenBefore = tooManyContexts;
    const cctx = await browser.newContext();
    const cpage = await cctx.newPage();
    let canary = null;
    cpage.on("console", (m) => { if (TOO_MANY.test(m.text())) canary = (canary || 0) + 1; });
    try {
      await cpage.goto(`${origin}/harness/index.html`);
      await cpage.waitForFunction(() => window.__harnessReady === true, null, { timeout: 15_000 });
      const c = await within(cpage.evaluate((n) => window.harness.contextCanary(n), 24), 30_000, "canary");
      await cpage.waitForTimeout(300);
      results.push({ canary: c, warnings: canary });
      group("T-dispose", "no ctx warning", "all", [
        chk(seenBefore === 0, `${seenBefore} "Too many active WebGL contexts" warnings`),
        chk(canary > 0, canary > 0 ? "detector canary fired" : `detector canary did NOT fire (${c.created} contexts, ${c.lostByBrowser} lost): the warning check is blind`),
      ]);
    } catch (e) {
      add("T-dispose", "no ctx warning", "all", "FAIL", firstLine(e));
    } finally {
      await cctx.close();
    }
  } finally {
    await browser.close();
    server.close();
  }

  const errs = [...new Set(consoleErrors)];
  group("T-console", "-", "all", [
    chk(errs.length === 0, errs.length ? `${errs.length} errors: ${errs.slice(0, 3).join(" | ")}` : "no page errors or console errors"),
    chk(notFound.length === 0, notFound.length ? `404: ${[...new Set(notFound)].slice(0, 4).join(", ")}` : "no 404s"),
  ]);
  const warns = [...consoleWarnings.entries()]
    .filter(([text]) => !TOO_MANY.test(text))
    .map(([text, steps]) => ({ text, steps: [...steps] }));
  results.push({ gpu, chunk: chunkUrl, consoleWarnings: warns, consoleErrors: errs, probeErrors });
  if (warns.length) {
    console.log("\n  console warnings (not failures):");
    for (const w of warns.slice(0, 6)) {
      const more = w.steps.length > 3 ? ` +${w.steps.length - 3} more` : "";
      console.log(`    ${w.text}  [${w.steps.slice(0, 3).join("; ")}${more}]`);
    }
  }
  console.log(`  chunk ${chunkUrl.slice(1)}, GPU ${gpu}`);
  return finish();
}

function finish() {
  printTable();
  try {
    writeFileSync(join(OUT, "results.json"), JSON.stringify({ rows, results }, null, 1));
  } catch {
    // the table above is the result; the JSON is a convenience
  }
  const failed = rows.filter((r) => r.status === "FAIL").length;
  const warned = rows.filter((r) => r.status === "WARN").length;
  const passed = rows.filter((r) => r.status === "PASS").length;
  console.log(`\n  test:banner: ${passed} passed, ${failed} failed, ${warned} not exercised here  (shots: ${OUT})\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("harness error:", err);
  try {
    printTable();
  } catch {
    // nothing more to print
  }
  process.exit(1);
});
