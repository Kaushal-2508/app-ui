/**
 * Regression test for src/lib/dashboardActions.ts, the pure part of the dashboard action
 * cards (spec docs/superpowers/specs/2026-10-03-dashboard-action-cards-design.md).
 *
 * WHY THIS FILE EXISTS. The cards turn one RPC answer into the first thing a teacher,
 * coordinator or school admin sees every morning. A card out of order, a wrong plural, an
 * em-dash on screen, a broken answer read as "nothing to do", a cache key that keeps
 * yesterday, or a refresh timer that spins in a loop are all invisible to typecheck, lint and
 * build. They are pinned here.
 *
 *   npm run test:dashboard-actions
 *   (node --experimental-strip-types scripts/test-dashboard-actions.mjs)
 *
 * Node strips the TypeScript itself, so the real module is imported with no bundler; that
 * only works while dashboardActions.ts stays erasable TypeScript with `import type` only.
 */

import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";

// fileURLToPath, not .pathname: the repo lives under "Salci Projects".
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const m = await import(pathToFileURL(join(ROOT, "src", "lib", "dashboardActions.ts")).href);
// The key lives apart, so the entry chunk's cache helpers never pull in the cards' logic.
const k = await import(pathToFileURL(join(ROOT, "src", "lib", "dashboardActionsKey.ts")).href);

let pass = 0;
let fail = 0;
const failures = [];
const ok = (name, cond, detail = "") => {
  if (cond) pass++;
  else {
    fail++;
    failures.push(`${name}${detail ? ` -- ${detail}` : ""}`);
  }
};
const eq = (name, got, want) =>
  ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const throws = (name, fn) => {
  try {
    fn();
    ok(name, false, "did not throw");
  } catch {
    ok(name, true);
  }
};

const FULL = {
  v: 1,
  date: "2026-10-05",
  view: "coordinator",
  check_in: { state: "due", by: "08:00", until: "16:00" },
  cover: { pending: 4, next: { label: "Period 3", class_name: "8", section: "B", start: "10:40" } },
  leave: { students: 2, staff: 1, oldest_days: 3 },
  check_out: null,
  pass_due: true,
  refresh_in_s: 1740,
};
const parse = (over) => m.parseDashboardActions({ ...FULL, ...over });

// ── parse ─────────────────────────────────────────────────────────────────
const full = m.parseDashboardActions(FULL);
eq("parse: view", full.view, "coordinator");
eq("parse: date", full.date, "2026-10-05");
eq("parse: check-in", full.checkIn, { state: "due", by: "08:00", until: "16:00" });
eq("parse: cover", full.cover, { pending: 4, next: { label: "Period 3", className: "8", section: "B", start: "10:40" } });
eq("parse: leave", full.leave, { students: 2, staff: 1, oldestDays: 3 });
eq("parse: no check-out", full.checkOut, null);
eq("parse: pass due", full.passDue, true);
eq("parse: refresh", full.refreshInS, 1740);
const empty = m.parseDashboardActions({
  v: 1, date: null, view: null, check_in: null, cover: null, leave: null, check_out: null, pass_due: false, refresh_in_s: null,
});
eq("parse: the empty answer has no cards", m.dueCards(empty), []);
eq("parse: the empty answer never kicks the pass", empty.passDue, false);
eq("parse: an unknown view is no view", parse({ view: "principal" }).view, null);
eq("parse: half a check-in is no check-in", parse({ check_in: { state: "due" } }).checkIn, null);
eq("parse: an unknown check-in state is no check-in", parse({ check_in: { state: "late", by: "08:00", until: "16:00" } }).checkIn, null);
eq("parse: zero covers is no cover card", parse({ cover: { pending: 0, next: null } }).cover, null);
eq("parse: a cover without a usable next keeps its count", parse({ cover: { pending: 2, next: { label: "P1" } } }).cover, { pending: 2, next: null });
eq("parse: a cover's section may be null", parse({ cover: { pending: 1, next: { label: "P1", class_name: "UKG", section: null, start: "09:00" } } }).cover.next.section, null);
eq("parse: zero leave is no leave card", parse({ leave: { students: 0, staff: 0, oldest_days: 0 } }).leave, null);
eq("parse: a check-out needs today's row id", parse({ check_out: { since: "16:00" } }).checkOut, null);
eq("parse: a check-out", parse({ check_out: { record_id: "r1", since: "16:00" } }).checkOut, { recordId: "r1", since: "16:00" });
eq("parse: a negative refresh is no refresh", parse({ refresh_in_s: -5 }).refreshInS, null);
eq("parse: pass_due must be exactly true", parse({ pass_due: "true" }).passDue, false);
throws("parse: null is an error, never 'nothing to do'", () => m.parseDashboardActions(null));
throws("parse: an array is an error", () => m.parseDashboardActions([]));
throws("parse: a string is an error", () => m.parseDashboardActions("{}"));
throws("parse: an unknown version is an error", () => m.parseDashboardActions({ ...FULL, v: 2 }));

// ── order ─────────────────────────────────────────────────────────────────
eq("order: check-in, cover, leave, check-out",
  m.dueCards(parse({ check_out: { record_id: "r1", since: "16:00" } })), ["check_in", "cover", "leave", "check_out"]);
eq("order: missing cards keep the others in order",
  m.dueCards(parse({ check_in: null, cover: null, check_out: { record_id: "r1", since: "16:00" } })), ["leave", "check_out"]);
eq("order: CARD_ORDER is the owner's order", m.CARD_ORDER, ["check_in", "cover", "leave", "check_out"]);

// ── the greeting button steps aside ───────────────────────────────────────
ok("greeting: steps aside for a due check-in", m.ownsCheckButton(full));
ok("greeting: steps aside for 'Marked absent'", m.ownsCheckButton(parse({ check_in: { state: "absent", by: "08:00", until: "16:00" } })));
ok("greeting: steps aside for a check-out", m.ownsCheckButton(parse({ check_in: null, check_out: { record_id: "r", since: "16:00" } })));
ok("greeting: stays when only cover and leave are due", !m.ownsCheckButton(parse({ check_in: null })));
ok("greeting: stays while there is no answer", !m.ownsCheckButton(undefined) && !m.ownsCheckButton(null));

// ── clock words ───────────────────────────────────────────────────────────
eq("clock: 08:00", m.formatClock("08:00"), "8:00 AM");
eq("clock: 16:00:00", m.formatClock("16:00:00"), "4:00 PM");
eq("clock: 00:05", m.formatClock("00:05"), "12:05 AM");
eq("clock: 12:30", m.formatClock("12:30"), "12:30 PM");
eq("clock: 23:59", m.formatClock("23:59"), "11:59 PM");
eq("clock: garbage comes back unchanged", m.formatClock("soon"), "soon");
eq("clock: an impossible hour comes back unchanged", m.formatClock("25:00"), "25:00");

// ── copy ──────────────────────────────────────────────────────────────────
const copies = [];
const keep = (c) => {
  copies.push(c.title, c.detail);
  return c;
};
eq("check-in: before check-in time", keep(m.checkInCopy(full.checkIn, "07:59")), { title: "Check in for today", detail: "Check in by 8:00 AM" });
eq("check-in: from the check-in minute on it is late", keep(m.checkInCopy(full.checkIn, "08:00")), { title: "Check in for today", detail: "Checking in now is recorded as late." });
eq("check-in: after check-in time", keep(m.checkInCopy(full.checkIn, "08:01")), { title: "Check in for today", detail: "Checking in now is recorded as late." });
eq("check-in: marked absent", keep(m.checkInCopy({ state: "absent", by: "08:00", until: "16:00" }, "09:00")),
  { title: "Marked absent today", detail: "Ask your admin to change it." });
const fmtClass = (name, section) => (section ? `${name} - ${section}` : name);
eq("cover: plural, with the next period", keep(m.coverCopy(full.cover, fmtClass)),
  { title: "4 periods need a substitute", detail: "Next: Period 3, 8 - B at 10:40 AM" });
eq("cover: singular", keep(m.coverCopy({ pending: 1, next: null }, fmtClass)).title, "1 period needs a substitute");
eq("cover: without a next period", m.coverCopy({ pending: 1, next: null }, fmtClass).detail, "Assign a teacher before the period starts.");
eq("cover: a class with no section", keep(m.coverCopy({ pending: 2, next: { label: "Period 1", className: "UKG", section: null, start: "09:00" } }, fmtClass)).detail,
  "Next: Period 1, UKG at 9:00 AM");
eq("leave: students and staff", keep(m.leaveCopy(full.leave)), { title: "3 leave requests waiting", detail: "2 students, 1 staff · oldest 3 days" });
eq("leave: one student from today", keep(m.leaveCopy({ students: 1, staff: 0, oldestDays: 0 })), { title: "1 leave request waiting", detail: "1 student · filed today" });
eq("leave: staff for a day", keep(m.leaveCopy({ students: 0, staff: 2, oldestDays: 1 })), { title: "2 leave requests waiting", detail: "2 staff · oldest 1 day" });
eq("leave links: students only", m.leaveLinks({ students: 1, staff: 0, oldestDays: 0 }), [{ label: "Review", to: "/school/attendance?tab=leaves" }]);
eq("leave links: staff only", m.leaveLinks({ students: 0, staff: 1, oldestDays: 0 }), [{ label: "Review", to: "/staff/workday?tab=staff-leaves" }]);
eq("leave links: both", m.leaveLinks(full.leave),
  [{ label: "Students", to: "/school/attendance?tab=leaves" }, { label: "Staff", to: "/staff/workday?tab=staff-leaves" }]);
eq("cover link", m.COVER_LINK, "/staff/workday?tab=substitutions");
eq("check-out", keep(m.checkOutCopy({ recordId: "r", since: "16:00" })), { title: "Time to check out", detail: "Check-out opened at 4:00 PM" });
const dash = copies.find((t) => t.includes("\u2014"));
ok("copy: no em-dash anywhere a user reads (CLAUDE.md UI rules)", dash === undefined, dash ?? "");

// ── refresh timer ─────────────────────────────────────────────────────────
eq("refresh: none named, no timer", m.refreshDelayMs(empty), null);
eq("refresh: no answer, no timer", m.refreshDelayMs(undefined), null);
eq("refresh: never sooner than 30 s", m.refreshDelayMs(parse({ refresh_in_s: 5 })), 30_000);
eq("refresh: one second after the named moment", m.refreshDelayMs(full), 1_741_000);
eq("refresh: a whole day fits a timer", m.refreshDelayMs(parse({ refresh_in_s: 86_400 })), 86_401_000);

// ── the school's clock (Asia/Kolkata is UTC+05:30 all year) ────────────────
eq("school clock: 18:29Z is 23:59 the same day in IST",
  m.schoolClock(new Date(Date.UTC(2026, 9, 3, 18, 29)), "Asia/Kolkata"), { date: "2026-10-03", time: "23:59" });
eq("school clock: 18:30Z is midnight, the NEXT day in IST",
  m.schoolClock(new Date(Date.UTC(2026, 9, 3, 18, 30)), "Asia/Kolkata"), { date: "2026-10-04", time: "00:00" });
eq("school clock: another zone keeps its own date",
  m.schoolClock(new Date(Date.UTC(2026, 9, 3, 18, 30)), "America/New_York"), { date: "2026-10-03", time: "14:30" });
eq("school clock: an unknown zone falls back to Asia/Kolkata",
  m.schoolClock(new Date(Date.UTC(2026, 9, 3, 18, 30)), "Mars/Olympus"), { date: "2026-10-04", time: "00:00" });
eq("school clock: an empty zone falls back to Asia/Kolkata",
  m.schoolClock(new Date(Date.UTC(2026, 9, 3, 2, 0)), ""), { date: "2026-10-03", time: "07:30" });

// ── the cache key ─────────────────────────────────────────────────────────
eq("key: nested under staff-attendance", k.DASHBOARD_ACTIONS_KEY, ["staff-attendance", "my-actions"]);
ok("key: not exported by the logic module (it would pull the logic into the entry)", !("DASHBOARD_ACTIONS_KEY" in m));

console.log(`\n  test:dashboard-actions: ${pass} passed, ${fail} failed\n`);
for (const f of failures) console.log(`  FAIL  ${f}`);
process.exit(fail === 0 ? 0 : 1);
