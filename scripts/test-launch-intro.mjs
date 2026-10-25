/**
 * Regression test for src/components/native/launchIntroPlan.ts.
 *
 * WHY THIS FILE EXISTS. The phone app plays a short launch intro over the app on a
 * cold start (LaunchIntro.tsx). It is a full-screen layer above everything, so the two
 * ways it can go wrong are both invisible to typecheck, lint and build, and both are
 * bad: it plays when it should not (on the website, or again after sign-out reloads
 * the page), or it outlives its welcome (a safety cap shorter than a normal intro cuts
 * it off mid-animation; one that is missing leaves the app covered). So the decision
 * table and the timing invariants are pinned here.
 *
 *   npm run test:launch-intro
 *   (node --experimental-strip-types scripts/test-launch-intro.mjs)
 *
 * Node 22 strips the TypeScript types itself, so the real module is imported with no
 * bundler. That only works while launchIntroPlan.ts stays erasable TypeScript with no
 * imports.
 */

import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { existsSync } from "node:fs";

// fileURLToPath, not .pathname: the repo lives under "Salci Projects" and a raw
// pathname keeps the space percent-encoded.
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MODULE = join(ROOT, "src", "components", "native", "launchIntroPlan.ts");

let pass = 0;
let fail = 0;
const failures = [];
const ok = (name, cond, detail = "") => {
  if (cond) {
    pass++;
  } else {
    fail++;
    failures.push(`${name}${detail ? ` -- ${detail}` : ""}`);
  }
};

if (!existsSync(MODULE)) {
  console.error(`FAIL: ${MODULE} does not exist`);
  process.exit(1);
}

const plan = await import(pathToFileURL(MODULE).href);
const { launchIntroMode, launchIntroTiming, MAX_ASSET_WAIT_MS, FIRST_FRAME_FALLBACK_MS, MAX_TOTAL_MS } = plan;

// ── the decision table: every combination of the three inputs ──────────────
for (const native of [false, true]) {
  for (const alreadyPlayed of [false, true]) {
    for (const reducedMotion of [false, true]) {
      const got = launchIntroMode({ native, alreadyPlayed, reducedMotion });
      const want = !native || alreadyPlayed ? "skip" : reducedMotion ? "still" : "animate";
      ok(`mode native=${native} played=${alreadyPlayed} reduced=${reducedMotion}`, got === want, `got ${got}, want ${want}`);
    }
  }
}

// ── timing ──────────────────────────────────────────────────────────────────
const animate = launchIntroTiming("animate");
const still = launchIntroTiming("still");

for (const [name, t] of [["animate", animate], ["still", still]]) {
  ok(`${name}: exit is positive`, t.exitAtMs > 0, String(t.exitAtMs));
  ok(`${name}: fade is positive`, t.fadeMs > 0, String(t.fadeMs));
  ok(`${name}: removal comes right after the fade`, t.removeAtMs === t.exitAtMs + t.fadeMs, JSON.stringify(t));
}

// The intro sits in front of an app that is already usable: it must stay short.
ok("animate: gone within 2.5 s of starting", animate.removeAtMs <= 2500, String(animate.removeAtMs));
ok("still: gone within 1.2 s of starting", still.removeAtMs <= 1200, String(still.removeAtMs));
ok("still is shorter than animate", still.removeAtMs < animate.removeAtMs);

// The last entrance animation (the loading line, index.css) ends at 1750 ms; the
// exit must not start before it, or the line vanishes half drawn.
ok("animate: exit waits for the loading line", animate.exitAtMs >= 1750, String(animate.exitAtMs));

// The safety cap exists only for the broken case. The slowest normal intro (every
// image wait and the first-frame fallback used up, then the full animation) must
// finish inside it, or a slow phone would see the intro cut off.
const slowestNormal = MAX_ASSET_WAIT_MS + FIRST_FRAME_FALLBACK_MS + animate.removeAtMs;
ok("safety cap never cuts a normal intro short", MAX_TOTAL_MS > slowestNormal, `cap ${MAX_TOTAL_MS} vs slowest ${slowestNormal}`);
ok("safety cap stays short", MAX_TOTAL_MS <= 5000, String(MAX_TOTAL_MS));

if (fail > 0) {
  console.error(`test-launch-intro: ${fail} FAILED, ${pass} passed`);
  for (const f of failures) console.error(`  FAIL ${f}`);
  process.exit(1);
}
console.log(`test-launch-intro: all ${pass} checks passed`);
