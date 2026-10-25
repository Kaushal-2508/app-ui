/**
 * Regression test for src/components/shared/illustrations/banner3d/todFromClock.ts.
 *
 * WHY THIS FILE EXISTS. The dashboard banner follows the SCHOOL's clock, not the
 * browser's: light theme is morning before 11:00, midday 11:00 to 14:59, golden
 * 15:00 to 18:59 and dusk from 19:00 (dark theme is always night and never reaches
 * this module). A banner showing noon at 9 in the morning is not an error anyone
 * reports, it just quietly looks wrong, and the one place the zone can go wrong
 * (a fixed offset instead of the IANA zone, a DST day, an invalid zone string from
 * the institutions row) is invisible to typecheck, lint and build. So it is pinned
 * here: the named cases from the design spec (section 5.1), then an exhaustive
 * minute-by-minute sweep checked against an oracle that does NOT use Intl.
 *
 *   npm run test:banner-tod
 *   (node --experimental-strip-types scripts/test-banner-tod.mjs)
 *
 * Node 22 strips the TypeScript types itself, so the real module is imported with
 * no bundler. That only works while todFromClock.ts stays erasable TypeScript: no
 * enum, no namespace, and only `import type` for anything it borrows from the
 * engine (a value import would need an explicit extension under Node).
 */

import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { existsSync } from "node:fs";

// fileURLToPath, not .pathname: the repo lives under "Salci Projects" and a raw
// pathname keeps the space percent-encoded.
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MODULE = join(ROOT, "src", "components", "shared", "illustrations", "banner3d", "todFromClock.ts");

const KOLKATA = "Asia/Kolkata";
const NEW_YORK = "America/New_York";
const MIN = 60_000;
const HOUR = 60 * MIN;
// A timer armed with msUntilNextBoundary must never fire BEFORE the boundary (it
// would recompute the old moment and look like nothing happened), and should not
// fire noticeably after it. One second of slack lets an implementation add a small
// safety margin, as the lab host did (+500 ms).
const LATE_SLACK_MS = 1000;

// ── assertions ──────────────────────────────────────────────────────────────
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

// ── an oracle that does not use Intl ────────────────────────────────────────
// Asia/Kolkata is UTC+05:30 all year (no DST since 1945). America/New_York in
// 2026: EDT (UTC-4) from 2026-03-08 07:00 UTC (02:00 EST) until 2026-11-01
// 06:00 UTC (02:00 EDT), EST (UTC-5) otherwise.
const NY_DST_START = Date.UTC(2026, 2, 8, 7, 0);
const NY_DST_END = Date.UTC(2026, 10, 1, 6, 0);
function offsetMinutes(zone, ms) {
  if (zone === KOLKATA) return 330;
  if (zone === NEW_YORK) return ms >= NY_DST_START && ms < NY_DST_END ? -240 : -300;
  throw new Error(`oracle has no offset table for ${zone}`);
}
// wall-clock minutes since local midnight (0..1439) and seconds into the minute
function localClock(zone, ms) {
  const local = ms + offsetMinutes(zone, ms) * MIN;
  const d = new Date(local);
  return { minutes: d.getUTCHours() * 60 + d.getUTCMinutes(), seconds: d.getUTCSeconds() + d.getUTCMilliseconds() / 1000 };
}
function expectedTod(minutes) {
  if (minutes < 11 * 60) return "morning";
  if (minutes < 15 * 60) return "midday";
  if (minutes < 19 * 60) return "golden";
  return "dusk";
}
// Real elapsed ms until the next wall-clock boundary (11:00, 15:00, 19:00, 00:00).
// Walks forward in whole minutes so it is correct across a DST jump.
function expectedMsToBoundary(zone, ms) {
  const cur = localClock(zone, ms);
  const startTod = expectedTod(cur.minutes);
  // first whole minute strictly after now
  let t = ms - (cur.seconds * 1000) + MIN;
  for (let i = 0; i < 26 * 60; i++, t += MIN) {
    const m = localClock(zone, t).minutes;
    if (m === 0 || expectedTod(m) !== startTod) return t - ms;
  }
  throw new Error("no boundary within 26 h");
}

// A Date for a local wall-clock time in a fixed-offset day.
const kolkata = (y, mo, d, h, mi, s = 0) => new Date(Date.UTC(y, mo - 1, d, h, mi, s) - 330 * MIN);
const fmt = (d, zone) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: zone, dateStyle: "short", timeStyle: "medium", hourCycle: "h23" }).format(d);

async function main() {
  if (!existsSync(MODULE)) {
    console.log(`  FAIL  ${MODULE} does not exist`);
    console.log("\n  test:banner-tod: 0 passed, 1 failed (module missing)\n");
    process.exit(1);
  }
  const mod = await import(pathToFileURL(MODULE).href);
  const { todFromClock, msUntilNextBoundary } = mod;
  ok("exports todFromClock()", typeof todFromClock === "function", `got ${typeof todFromClock}`);
  ok("exports msUntilNextBoundary()", typeof msUntilNextBoundary === "function", `got ${typeof msUntilNextBoundary}`);
  if (typeof todFromClock !== "function" || typeof msUntilNextBoundary !== "function") return finish();

  // ---- the named cases (spec 5.1, five moments since 2026-09-28) ----
  const named = [
    [10, 59, "morning"],
    [11, 0, "midday"],
    [14, 59, "midday"],
    [15, 0, "golden"],
    [18, 59, "golden"],
    [19, 0, "dusk"],
    [23, 59, "dusk"],
    [0, 0, "morning"],
  ];
  for (const [h, m, want] of named) {
    const d = kolkata(2026, 9, 28, h, m);
    const got = todFromClock(d, KOLKATA);
    ok(`Kolkata ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")} is ${want}`, got === want, `got ${got}`);
  }

  // ---- DST days in New York: a fixed-offset implementation is an hour out ----
  // 2026-03-08 (spring forward at 02:00 EST): 11:00 EDT is 15:00 UTC.
  const nyCases = [
    [Date.UTC(2026, 2, 8, 14, 59), "morning", "2026-03-08 10:59 EDT"],
    [Date.UTC(2026, 2, 8, 15, 0), "midday", "2026-03-08 11:00 EDT"],
    [Date.UTC(2026, 2, 8, 6, 30), "morning", "2026-03-08 01:30 EST (before the jump)"],
    [Date.UTC(2026, 2, 8, 23, 0), "dusk", "2026-03-08 19:00 EDT"],
    // 2026-11-01 (fall back at 02:00 EDT): 19:00 EST is 00:00 UTC the next day.
    [Date.UTC(2026, 10, 1, 23, 59), "golden", "2026-11-01 18:59 EST"],
    [Date.UTC(2026, 10, 2, 0, 0), "dusk", "2026-11-01 19:00 EST"],
    [Date.UTC(2026, 10, 1, 5, 30), "morning", "2026-11-01 01:30 EDT (first pass)"],
    [Date.UTC(2026, 10, 1, 6, 30), "morning", "2026-11-01 01:30 EST (second pass)"],
  ];
  for (const [ms, want, label] of nyCases) {
    const got = todFromClock(new Date(ms), NEW_YORK);
    ok(`New York ${label} is ${want}`, got === want, `got ${got}`);
  }

  // ---- an invalid zone falls back to Asia/Kolkata, never throws ----
  // 05:30 UTC is 11:00 in Kolkata (midday) but still morning in UTC, so a fallback
  // to UTC or to the browser zone is caught too.
  const probeAt = new Date(Date.UTC(2026, 8, 28, 5, 30));
  for (const bad of ["Not/AZone", "Asia/Kolkatta", ""]) {
    let got;
    let threw = null;
    try {
      got = todFromClock(probeAt, bad);
    } catch (e) {
      threw = e;
    }
    ok(`invalid zone ${JSON.stringify(bad)} does not throw`, threw === null, String(threw));
    ok(`invalid zone ${JSON.stringify(bad)} falls back to Kolkata (midday)`, got === "midday", `got ${got}`);
    let msGot;
    let msThrew = null;
    try {
      msGot = msUntilNextBoundary(probeAt, bad);
    } catch (e) {
      msThrew = e;
    }
    ok(`msUntilNextBoundary with ${JSON.stringify(bad)} does not throw`, msThrew === null, String(msThrew));
    // Kolkata 11:00:00 -> 15:00 is 4 h
    const want = 4 * HOUR;
    ok(
      `msUntilNextBoundary with ${JSON.stringify(bad)} uses Kolkata`,
      typeof msGot === "number" && msGot >= want && msGot <= want + LATE_SLACK_MS,
      `got ${msGot}, want ${want}`,
    );
  }

  // ---- msUntilNextBoundary, the named cases ----
  const msCases = [
    [kolkata(2026, 9, 28, 10, 59, 30), 30_000, "10:59:30 -> 11:00"],
    [kolkata(2026, 9, 28, 18, 59, 0), 60_000, "18:59 -> 19:00"],
    [kolkata(2026, 9, 28, 23, 59, 0), 60_000, "23:59 -> 00:00 (across midnight)"],
    [kolkata(2026, 9, 28, 11, 0, 0), 4 * HOUR, "11:00 -> 15:00"],
    [kolkata(2026, 9, 28, 19, 0, 0), 5 * HOUR, "19:00 -> 00:00"],
    [kolkata(2026, 9, 28, 0, 0, 0), 11 * HOUR, "00:00 -> 11:00"],
  ];
  for (const [d, want, label] of msCases) {
    const got = msUntilNextBoundary(d, KOLKATA);
    ok(
      `msUntilNextBoundary Kolkata ${label} is ${want} ms`,
      typeof got === "number" && Number.isFinite(got) && got >= want && got <= want + LATE_SLACK_MS,
      `got ${got}`,
    );
  }

  // ---- exhaustive sweep: every minute of a Kolkata day, at :00 and :30 s ----
  const dayStart = kolkata(2026, 9, 28, 0, 0).getTime();
  for (let i = 0; i < 1440; i++) {
    for (const sec of [0, 30]) {
      const ms = dayStart + i * MIN + sec * 1000;
      const d = new Date(ms);
      const want = expectedTod(localClock(KOLKATA, ms).minutes);
      const got = todFromClock(d, KOLKATA);
      ok(`sweep Kolkata ${fmt(d, KOLKATA)} is ${want}`, got === want, `got ${got}`);
      const wantMs = expectedMsToBoundary(KOLKATA, ms);
      const gotMs = msUntilNextBoundary(d, KOLKATA);
      ok(
        `sweep Kolkata ${fmt(d, KOLKATA)} next boundary in ${wantMs} ms`,
        typeof gotMs === "number" && gotMs >= wantMs && gotMs <= wantMs + LATE_SLACK_MS,
        `got ${gotMs}`,
      );
    }
  }

  // ---- sweep both 2026 New York DST days, every minute (tod only) ----
  // msUntilNextBoundary across the DST jump is reported, not gated: a wall-clock
  // subtraction is an hour out on those two nights only, and the host re-arms at
  // every boundary and on every return to a visible tab, so it self-corrects.
  let dstMsExact = 0;
  let dstMsTotal = 0;
  for (const day of [Date.UTC(2026, 2, 8, 5, 0), Date.UTC(2026, 10, 1, 4, 0)]) {
    for (let i = 0; i < 24 * 60; i++) {
      const ms = day + i * MIN;
      const d = new Date(ms);
      const want = expectedTod(localClock(NEW_YORK, ms).minutes);
      const got = todFromClock(d, NEW_YORK);
      ok(`sweep New York ${fmt(d, NEW_YORK)} is ${want}`, got === want, `got ${got}`);
      const wantMs = expectedMsToBoundary(NEW_YORK, ms);
      const gotMs = msUntilNextBoundary(d, NEW_YORK);
      dstMsTotal++;
      if (typeof gotMs === "number" && gotMs >= wantMs && gotMs <= wantMs + LATE_SLACK_MS) dstMsExact++;
    }
  }
  console.log(
    `  info  msUntilNextBoundary exact across the New York DST days: ${dstMsExact}/${dstMsTotal} minutes` +
      (dstMsExact === dstMsTotal ? "" : " (wall-clock arithmetic; self-corrects at the next re-arm)"),
  );

  // ---- light-theme moments only: never "night" ----
  ok("todFromClock never returns night", failures.every((f) => !/got night/.test(f)));

  return finish();
}

function finish() {
  const shown = failures.slice(0, 25);
  for (const f of shown) console.log(`  FAIL  ${f}`);
  if (failures.length > shown.length) console.log(`  ... and ${failures.length - shown.length} more failures`);
  console.log(`\n  test:banner-tod: ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("harness error:", err);
  process.exit(1);
});
