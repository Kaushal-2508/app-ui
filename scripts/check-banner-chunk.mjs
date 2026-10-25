/**
 * Bundle guard for the 3D dashboard banner (design spec section 3.2).
 *
 * WHY THIS FILE EXISTS. three.js plus the banner engine is one lazy chunk of about
 * 660 kB min, a documented exception to the §23 500 kB rule on the promise that it
 * is NEVER part of the first download: not on /login, not before the dashboard's own
 * data. That promise is one careless import away from breaking. A value import of the
 * engine from React code, a `manualChunks` rule that matches three, or an engine file
 * that imports "@/lib/..." all fold three into the entry or split it so the lazy chunk
 * gains static imports, and every user then downloads 660 kB more before sign-in.
 * Typecheck, lint and build all stay green when that happens, so it is checked here,
 * on the built output.
 *
 *   npx vite build && npm run check:banner-chunk
 *
 * FAILS when any of these hold:
 *   - no chunk in dist/ contains three (searched by the "isWebGLRenderer" string),
 *   - more than one chunk contains it (three was split or duplicated),
 *   - that chunk has any static import (import ... from "./x.js", import "./x.js",
 *     export ... from "./x.js"; dynamic import("./x.js") does not count),
 *   - it is inside the static closure of dist/index.html (entry scripts plus
 *     modulepreload links, following static imports recursively),
 *   - it is larger than 665 kB minified or 182 kB gzip (see MAX_CHUNK_BYTES),
 *   - the banner's own chunk (the Dashboard chunk: the one JS file carrying the
 *     "scene-banner-anim" class) is missing, duplicated, or larger than 56.5 kB
 *     minified (see MAX_DASHBOARD_BYTES),
 *   - the dashboard action cards' logic (src/lib/dashboardActions.ts, found by its
 *     CARDS_MARKER message) is missing, duplicated, or inside the static closure of
 *     dist/index.html. The shared cache helpers in the entry import only the cards'
 *     query key (src/lib/dashboardActionsKey.ts); importing that key from
 *     dashboardActions.ts once put the whole module into everyone's first download.
 * There is deliberately no hard-coded entry-size baseline: the entry changes with
 * every feature. The entry size is printed so a reviewer can compare it by eye.
 *
 * Static imports are read with Rollup's own parser (rollup/parseAst, already in
 * node_modules through Vite), so a minified `import{a as b}from"./x.js"` is found
 * and an `import("./x.js")` or a file name inside a string is not. If that module
 * is ever unavailable the script falls back to a regex tuned for minified output
 * and says so.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

// fileURLToPath, not .pathname: the repo lives under "Salci Projects".
const ROOT = fileURLToPath(new URL("..", import.meta.url));
// DIST_DIR points the check at another build output (a saved experiment); default dist/.
const DIST = process.env.DIST_DIR ? resolve(process.env.DIST_DIR) : join(ROOT, "dist");
const MARKER = "isWebGLRenderer"; // set on every WebGLRenderer; survives minification
const BANNER_MARKER = "scene-banner-anim"; // the banner card's own class: finds the Dashboard chunk
const CARDS_MARKER = "answered in an unknown version"; // parseDashboardActions' error: finds the cards' logic
// Size caps, in bytes (Vite prints kB as 1000 bytes). Set from the APPROVED lab build,
// not from the spec's estimate. The spec guessed the engine at about 25 kB min, for a
// 600 kB / 155 kB gz chunk; the lab engine (lab/v1-realtime/engine/*.js) actually
// minifies to 86.85 kB, and the TypeScript port to 87.09 kB (esbuild, three external,
// 2026-09-28). With three r186 and the two addons the built chunk is 657.51 kB min /
// 178.52 kB gz, so no faithful port can fit 650 kB. The caps leave about 1% headroom:
// a real regression (a second three copy, `import * as THREE`, a new addon, a stray
// dependency in an engine file) trips them; a small engine tweak does not.
const MAX_CHUNK_BYTES = 665_000;
const MAX_CHUNK_GZ_BYTES = 182_000;
// The Dashboard chunk (every role dashboard renders the banner from it). It carries the
// banner's host layer (gate, tier probe, poster cache, clock hooks) but no drawn fallback:
// the old SVG scene was deleted on 2026-09-29 to keep the dashboard light. Measured then at
// 43.50 kB min / 14.76 kB gz as Vite prints it (43.59 kB of file bytes, what this script
// measures), lighter than the 46.80 kB before the 3D banner existed. On 2026-09-29 main
// added the super-admin showcase dashboard and the staff check-in buttons to the same chunk:
// 49.88 kB measured with them. The cap leaves about 5% headroom over that, and a re-added
// SVG fallback (about 17 kB) or a library pulled in by value still trips it.
// 2026-10-03: the dashboard action cards (DashboardTopSlot, the deck and its cards; the
// hooks and src/lib/dashboardActions.ts sit in the shared StaffCheckInCard chunk) joined the
// chunk: 53.72 kB measured with them, from 49.11 kB on main the same day. Same ~5% headroom rule.
const MAX_DASHBOARD_BYTES = 56_500;

// ── output helpers ──────────────────────────────────────────────────────────
let pass = 0;
let fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}${detail ? `  (${detail})` : ""}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`);
  }
};
const info = (label, text) => console.log(`  ${label.padEnd(18)}${text}`);
const kB = (bytes) =>
  `${(bytes / 1000).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kB`;
const rel = (file) => relative(DIST, file).split(sep).join("/");

const sources = new Map();
function read(file) {
  let code = sources.get(file);
  if (code === undefined) {
    code = readFileSync(file, "utf8");
    sources.set(file, code);
  }
  return code;
}
const sizes = (file) => {
  const buf = readFileSync(file);
  return { min: buf.length, gz: gzipSync(buf).length };
};
const sizeText = (file) => {
  const s = sizes(file);
  return `${kB(s.min)} min / ${kB(s.gz)} gzip`;
};

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.m?js$/.test(name)) out.push(p);
  }
  return out;
}

// ── static-import scanner ───────────────────────────────────────────────────
let parseAst = null;
try {
  ({ parseAst } = await import("rollup/parseAst"));
} catch {
  parseAst = null;
}

// Fallback only. Anchored to a statement start so text inside identifiers does not
// match; `import(` and `import.meta` cannot match because a quote or a binding
// clause must follow the keyword.
const STATIC_IMPORT_RE =
  /(?:^|[;}\n])\s*(?:import\s*(?:[\w$]+\s*,?\s*)?(?:\{[^}]*\}|\*\s*as\s*[\w$]+)?\s*(?:from\s*)?|export\s*(?:\*(?:\s*as\s*[\w$]+)?|\{[^}]*\})\s*from\s*)["']([^"'\n]+)["']/g;

function staticSpecifiers(file) {
  const code = read(file);
  if (parseAst) {
    const ast = parseAst(code);
    const out = [];
    for (const node of ast.body) {
      const isStatic =
        node.type === "ImportDeclaration" ||
        node.type === "ExportAllDeclaration" ||
        (node.type === "ExportNamedDeclaration" && node.source);
      if (isStatic && node.source && typeof node.source.value === "string") out.push(node.source.value);
    }
    return out;
  }
  return [...code.matchAll(STATIC_IMPORT_RE)].map((m) => m[1]);
}

function exportedNames(file) {
  if (!parseAst) return null;
  const names = [];
  for (const node of parseAst(read(file)).body) {
    if (node.type === "ExportNamedDeclaration") {
      for (const s of node.specifiers ?? []) names.push(s.exported?.name ?? s.exported?.value);
      const decl = node.declaration;
      if (decl?.id?.name) names.push(decl.id.name);
      for (const d of decl?.declarations ?? []) if (d.id?.name) names.push(d.id.name);
    } else if (node.type === "ExportDefaultDeclaration") {
      names.push("default");
    }
  }
  return names;
}

// A specifier from a built file -> an absolute path inside dist/, or null for
// anything that is not a local file (a URL, a bare specifier, a data: URI).
function resolveSpecifier(spec, fromFile) {
  const clean = spec.split(/[?#]/)[0];
  if (/^[a-z][a-z0-9+.-]*:/i.test(clean)) return null;
  if (clean.startsWith("/")) return join(DIST, clean);
  if (clean.startsWith("./") || clean.startsWith("../")) return resolve(dirname(fromFile), clean);
  return null;
}

// ── dist/index.html: entry scripts + modulepreload links ────────────────────
function attr(tag, name) {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return m ? (m[1] ?? m[2] ?? m[3]) : null;
}
function htmlRoots(html, htmlFile) {
  const entries = [];
  const preloads = [];
  for (const tag of html.match(/<script\b[^>]*>/gi) ?? []) {
    const src = attr(tag, "src");
    if (!src) continue;
    const p = resolveSpecifier(src.startsWith("/") || src.startsWith(".") ? src : `./${src}`, htmlFile);
    if (p) entries.push(p);
  }
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const relAttr = (attr(tag, "rel") ?? "").toLowerCase().split(/\s+/);
    const href = attr(tag, "href");
    if (!href || !relAttr.includes("modulepreload")) continue;
    const p = resolveSpecifier(href.startsWith("/") || href.startsWith(".") ? href : `./${href}`, htmlFile);
    if (p) preloads.push(p);
  }
  return { entries, preloads };
}

// Breadth-first over static imports; `via` remembers who pulled each file in, so a
// failure can print the chain from index.html to the three chunk.
function staticClosure(roots) {
  const via = new Map();
  const missing = [];
  const queue = [];
  for (const r of roots) {
    if (!via.has(r)) {
      via.set(r, "index.html");
      queue.push(r);
    }
  }
  while (queue.length) {
    const file = queue.shift();
    if (!existsSync(file)) {
      missing.push(rel(file));
      continue;
    }
    for (const spec of staticSpecifiers(file)) {
      const dep = resolveSpecifier(spec, file);
      if (dep && !via.has(dep)) {
        via.set(dep, file);
        queue.push(dep);
      }
    }
  }
  return { via, missing };
}
function chainTo(file, via) {
  const chain = [rel(file)];
  let cur = via.get(file);
  while (cur && cur !== "index.html") {
    chain.push(rel(cur));
    cur = via.get(cur);
  }
  chain.push("index.html");
  return chain.reverse().join(" -> ");
}

// ── main ────────────────────────────────────────────────────────────────────
function main() {
  const htmlFile = join(DIST, "index.html");
  if (!existsSync(htmlFile)) {
    console.log(`  FAIL  ${htmlFile} not found: run \`npx vite build\` first`);
    console.log("\n  check:banner-chunk: 0 passed, 1 failed\n");
    process.exit(1);
  }
  const builtAt = statSync(htmlFile).mtime;
  console.log(`\n  check:banner-chunk  dist/ built ${builtAt.toISOString().replace("T", " ").slice(0, 19)} UTC`);
  if (!parseAst) console.log("  note: rollup/parseAst unavailable, static imports read with the regex fallback");
  console.log("");

  const files = walk(DIST);
  const threeChunks = files.filter((f) => read(f).includes(MARKER));
  const bannerChunks = files.filter((f) => read(f).includes(BANNER_MARKER));
  const cardChunks = files.filter((f) => read(f).includes(CARDS_MARKER));

  const html = read(htmlFile);
  const { entries, preloads } = htmlRoots(html, htmlFile);
  const { via, missing } = staticClosure([...entries, ...preloads]);

  // ---- report ----
  const chunk = threeChunks.length === 1 ? threeChunks[0] : null;
  if (chunk) {
    info("three chunk", `${rel(chunk)}  ${sizeText(chunk)}`);
    const names = exportedNames(chunk);
    if (names) info("  exports", names.length ? names.join(", ") : "(none)");
    const base = chunk.split(sep).pop();
    const loaders = files.filter((f) => f !== chunk && read(f).includes(base)).map(rel);
    info("  referenced by", loaders.length ? loaders.join(", ") : "(nothing: the chunk is never loaded)");
  } else if (threeChunks.length > 1) {
    for (const f of threeChunks) info("three in", `${rel(f)}  ${sizeText(f)}`);
  }
  for (const e of entries) info("entry", `${rel(e)}  ${existsSync(e) ? sizeText(e) : "(missing)"}`);
  let closureMin = 0;
  let closureGz = 0;
  for (const f of via.keys()) {
    if (!existsSync(f)) continue;
    const s = sizes(f);
    closureMin += s.min;
    closureGz += s.gz;
  }
  info(
    "initial download",
    `${via.size} JS file${via.size === 1 ? "" : "s"} (entry + ${preloads.length} modulepreload + their static imports)  ${kB(closureMin)} min / ${kB(closureGz)} gzip`,
  );
  if (bannerChunks.length) {
    for (const f of bannerChunks) info(BANNER_MARKER, `${rel(f)}  ${sizeText(f)}`);
  } else {
    info(BANNER_MARKER, "(no JS chunk contains it)");
  }
  console.log("");

  // ---- assertions ----
  ok(
    "a chunk contains three",
    threeChunks.length > 0,
    threeChunks.length ? rel(threeChunks[0]) : `no .js file under dist/ contains "${MARKER}"; is the engine imported by the banner layer?`,
  );
  ok(
    "exactly one chunk contains three",
    threeChunks.length <= 1,
    threeChunks.length > 1 ? `found in ${threeChunks.map(rel).join(", ")}` : "",
  );
  // Every chunk that carries three is held to the same rules, so a split build also
  // says whether the pieces landed in the initial download.
  for (const f of threeChunks) {
    const label = threeChunks.length > 1 ? ` [${rel(f)}]` : "";
    const imports = staticSpecifiers(f);
    ok(
      `the three chunk has no static imports${label}`,
      imports.length === 0,
      imports.length ? `imports ${imports.join(", ")}` : "0 imports",
    );
    ok(
      `the three chunk is outside the static closure of index.html${label}`,
      !via.has(f),
      via.has(f) ? `pulled in by ${chainTo(f, via)}` : `${via.size} files in the closure`,
    );
    const { min, gz } = sizes(f);
    ok(`the three chunk is at most ${kB(MAX_CHUNK_BYTES)} minified${label}`, min <= MAX_CHUNK_BYTES, kB(min));
    ok(`the three chunk is at most ${kB(MAX_CHUNK_GZ_BYTES)} gzip${label}`, gz <= MAX_CHUNK_GZ_BYTES, kB(gz));
  }
  ok(
    `exactly one chunk carries the banner (${BANNER_MARKER})`,
    bannerChunks.length === 1,
    bannerChunks.length === 1 ? rel(bannerChunks[0]) : `found in ${bannerChunks.length} chunks${bannerChunks.length ? `: ${bannerChunks.map(rel).join(", ")}` : ""}`,
  );
  for (const f of bannerChunks) {
    const { min } = sizes(f);
    const label = bannerChunks.length > 1 ? ` [${rel(f)}]` : "";
    ok(`the banner's chunk is at most ${kB(MAX_DASHBOARD_BYTES)} minified${label}`, min <= MAX_DASHBOARD_BYTES, kB(min));
  }
  ok(
    "the action cards' logic is in exactly one chunk, outside the static closure of index.html",
    cardChunks.length === 1 && !via.has(cardChunks[0]),
    cardChunks.length !== 1
      ? `found in ${cardChunks.length} chunks${cardChunks.length ? `: ${cardChunks.map(rel).join(", ")}` : ""}`
      : via.has(cardChunks[0])
        ? `pulled in by ${chainTo(cardChunks[0], via)}`
        : rel(cardChunks[0]),
  );
  ok("index.html names an entry script", entries.length > 0, entries.map(rel).join(", "));
  ok(
    "every file in the static closure exists",
    missing.length === 0,
    missing.length ? `missing ${missing.join(", ")}` : "",
  );

  console.log(`\n  check:banner-chunk: ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

try {
  main();
} catch (err) {
  console.error("check error:", err);
  process.exit(1);
}
