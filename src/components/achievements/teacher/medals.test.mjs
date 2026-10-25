/**
 * Regression test for medals.ts, the pure engine behind the teacher medal ladder.
 *
 * WHY THIS FILE EXISTS. The ladder decides, from one RPC payload, which medal a
 * teacher holds, which one is next and which requirement is still open. A
 * keystone rule that no longer matches a catalog row, a medal earned out of
 * order, a points floor that stops binding, "next" landing on two rungs at
 * once, or an em-dash in a blurb are all invisible to typecheck, lint and
 * build. They are pinned here against the LIVE 50-row teacher catalog (the
 * seeds in 20260818120000, 20260904150000 and 20260904160000).
 *
 *   node --experimental-strip-types src/components/achievements/teacher/medals.test.mjs
 *
 * It sits beside the module rather than under scripts/ because the naman-erp
 * branch edits src/, docs/ and public/ only; moving it to scripts/ and adding a
 * package.json entry is a one-line job for Tushar. Node strips the TypeScript
 * itself, which only works while medals.ts stays erasable (`import type` only).
 */

import { fileURLToPath, pathToFileURL } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const m = await import(pathToFileURL(`${here}medals.ts`).href);

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

/* ── The live catalog, as seeded ──────────────────────────────────────── */

// [name, category, tier, metric, threshold, points, display_order]
const ROWS = [
  ["Roll Call", "classroom", "bronze", "attendance_days_marked", 1, 10, 210],
  ["Register Keeper", "classroom", "silver", "attendance_days_marked", 10, 30, 211],
  ["Never Misses", "classroom", "gold", "attendance_days_marked", 30, 70, 212],
  ["Lesson Logged", "classroom", "bronze", "lessons_taught", 1, 10, 213],
  ["Course Keeper", "classroom", "silver", "lessons_taught", 10, 35, 214],
  ["Syllabus Shepherd", "classroom", "gold", "lessons_taught", 50, 90, 215],
  ["Planned Ahead", "classroom", "bronze", "lessons_planned_ahead", 1, 10, 216],
  ["Week Ready", "classroom", "silver", "lessons_planned_ahead", 10, 30, 217],
  ["Term Ready", "classroom", "gold", "lessons_planned_ahead", 40, 80, 218],
  ["Topic Ticked", "classroom", "bronze", "syllabus_topics_completed", 1, 10, 219],
  ["Chapter Closer", "classroom", "silver", "syllabus_topics_completed", 10, 35, 220],
  ["Curriculum Complete", "classroom", "gold", "syllabus_topics_completed", 40, 90, 221],
  ["First Paper", "assessment", "bronze", "exams_created", 1, 15, 220],
  ["Paper Trail", "assessment", "silver", "exams_created", 10, 40, 221],
  ["Exam Architect", "assessment", "gold", "exams_created", 25, 80, 222],
  ["Question Master", "assessment", "platinum", "exams_created", 50, 150, 223],
  ["Paper Out", "assessment", "bronze", "exams_published", 1, 15, 224],
  ["Regular Examiner", "assessment", "silver", "exams_published", 25, 40, 225],
  ["Publishing Pro", "assessment", "gold", "exams_published", 50, 80, 226],
  ["Question Smith", "assessment", "bronze", "questions_authored", 1, 15, 227],
  ["Bank Builder", "assessment", "silver", "questions_authored", 10, 40, 228],
  ["Question Vault", "assessment", "gold", "questions_authored", 50, 90, 229],
  ["AI Co-author", "assessment", "bronze", "ai_questions_saved", 1, 10, 230],
  ["Template Maker", "assessment", "bronze", "templates_created", 1, 15, 231],
  ["Shared Blueprint", "assessment", "silver", "templates_shared", 1, 25, 232],
  ["Red Pen", "marking", "bronze", "answers_evaluated", 1, 10, 230],
  ["Marking Marathon", "marking", "silver", "answers_evaluated", 25, 35, 231],
  ["Century of Scripts", "marking", "gold", "answers_evaluated", 100, 75, 232],
  ["Marking Machine", "marking", "platinum", "answers_evaluated", 200, 150, 233],
  ["Results In", "marking", "bronze", "results_published", 1, 15, 234],
  ["Report Ready", "marking", "silver", "results_published", 10, 40, 235],
  ["Results Veteran", "marking", "gold", "results_published", 25, 80, 236],
  ["Knows Their Names", "marking", "bronze", "students_remarked", 1, 15, 237],
  ["Class Mentor", "marking", "silver", "students_remarked", 10, 40, 238],
  ["Every Student Seen", "marking", "gold", "students_remarked", 30, 90, 239],
  ["Homework Set", "homework", "bronze", "homework_created", 1, 10, 240],
  ["Regular Setter", "homework", "silver", "homework_created", 5, 25, 241],
  ["Practice Architect", "homework", "gold", "homework_created", 15, 55, 242],
  ["Marked and Returned", "homework", "silver", "homework_marked", 1, 20, 243],
  ["Feedback Loop", "homework", "gold", "homework_marked", 5, 60, 244],
  ["Task Starter", "teamwork", "bronze", "tasks_completed", 1, 10, 250],
  ["Team Player", "teamwork", "silver", "tasks_completed", 5, 30, 251],
  ["Task Master", "teamwork", "gold", "tasks_completed", 15, 60, 252],
  ["Task Champion", "teamwork", "platinum", "tasks_completed", 30, 110, 253],
  ["Stepped In", "teamwork", "bronze", "substitutions_covered", 1, 10, 254],
  ["Reliable Cover", "teamwork", "silver", "substitutions_covered", 5, 30, 255],
  ["Always There", "teamwork", "gold", "substitutions_covered", 15, 60, 256],
  ["Gatekeeper", "teamwork", "bronze", "leave_reviews_done", 1, 10, 257],
  ["Fair Reviewer", "teamwork", "silver", "leave_reviews_done", 10, 30, 258],
  ["Leave Steward", "teamwork", "gold", "leave_reviews_done", 30, 60, 259],
];

const idOf = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
const CATALOG = ROWS.map(([name, category, tier, metric, value, points, order]) => ({
  id: idOf(name),
  name,
  description: `${name} description`,
  icon_name: "award",
  category,
  tier,
  points,
  criteria_type: "count",
  criteria_metric: metric,
  criteria_value: value,
  display_order: order,
}));
const byName = new Map(CATALOG.map((b) => [b.name, b]));

ok("fixture has the 50 live rows", CATALOG.length === 50, `got ${CATALOG.length}`);
eq(
  "fixture carries 2,245 points",
  CATALOG.reduce((s, b) => s + b.points, 0),
  2245,
);

/** Payload for a teacher holding the named badges with the points those badges carry. */
function payload(names, overrides = {}) {
  const earned = names.map((n) => {
    const b = byName.get(n);
    if (!b) throw new Error(`unknown badge in test: ${n}`);
    return { badge_id: b.id, earned_at: "2026-09-01T04:30:00Z", period_key: null };
  });
  const points = names.reduce((s, n) => s + byName.get(n).points, 0);
  return {
    points,
    rank: "bronze",
    next_rank_at: 100,
    catalog: CATALOG,
    earned,
    progress: {},
    ...overrides,
  };
}

const statuses = (ladder) => ladder.steps.map((s) => `${s.medal}:${s.status}`);
const nameOfRule = (k) => {
  const b = m.resolveKeystone(k, CATALOG);
  return b ? b.name : null;
};

/* ── 1. The rule table matches the catalog exactly ─────────────────────── */

for (const medal of m.MEDAL_ORDER) {
  for (const k of m.MEDAL_RULES[medal].keystones) {
    const b = m.resolveKeystone(k, CATALOG);
    ok(
      `${medal} keystone ${k.metric}>=${k.min} resolves to an exact row`,
      b !== null && b.criteria_value === k.min,
      b ? `resolved to ${b.name} (${b.criteria_value})` : "no row",
    );
  }
}
eq("ladder order", m.MEDAL_ORDER, ["bronze", "silver", "gold", "diamond"]);
eq(
  "floors climb",
  m.MEDAL_ORDER.map((x) => m.MEDAL_RULES[x].pointsFloor),
  [100, 600, 1300, 1900],
);

// Nothing that gates a medal is a minute's work: no first-time rung is a
// keystone, and Bronze needs attendance on ten distinct days, so no medal can
// be earned inside a day (the others follow by order).
for (const medal of m.MEDAL_ORDER) {
  for (const k of m.MEDAL_RULES[medal].keystones) {
    ok(`${medal} keystone ${k.metric}>=${k.min} is not a first-time rung`, k.min >= 5, `min=${k.min}`);
  }
}
ok(
  "bronze needs 10 distinct attendance days",
  m.MEDAL_RULES.bronze.keystones.some((k) => k.metric === "attendance_days_marked" && k.min >= 10),
);

// No two medals may name the same badge, or the tile note would have to pick.
{
  const seen = new Map();
  for (const medal of m.MEDAL_ORDER) {
    for (const k of m.MEDAL_RULES[medal].keystones) {
      const key = `${k.metric}:${k.min}`;
      ok(`keystone ${key} appears once`, !seen.has(key), `also in ${seen.get(key)}`);
      seen.set(key, medal);
    }
  }
}

// Every keystone is within the teacher's own control: no teamwork metric.
for (const medal of m.MEDAL_ORDER) {
  for (const k of m.MEDAL_RULES[medal].keystones) {
    ok(
      `${medal} keystone ${k.metric} is not a teamwork metric`,
      !["tasks_completed", "substitutions_covered", "leave_reviews_done"].includes(k.metric),
    );
  }
}

// User-facing copy carries no em-dash (CLAUDE.md UI rules).
for (const medal of m.MEDAL_ORDER) {
  const r = m.MEDAL_RULES[medal];
  ok(`${medal} copy has no em-dash`, !/—/.test(`${r.title}${r.blurb}${m.MEDAL_LABEL[medal]}`));
}

/* ── 2. Nothing is given ───────────────────────────────────────────────── */

{
  const l = m.buildMedalLadder(undefined);
  eq("no payload: no medal, bronze next", [l.current, l.next], [null, "bronze"]);
  eq("no payload: statuses", statuses(l), ["bronze:next", "silver:locked", "gold:locked", "diamond:locked"]);
  eq("no payload: bronze has 0 of 5 met", [l.steps[0].metCount, l.steps[0].total], [0, 5]);
  ok("no payload: keystones unresolved", l.steps[0].requirements.slice(1).every((r) => r.badge === null));
}
{
  const l = m.buildMedalLadder(payload([]));
  eq("fresh teacher with catalog: no medal", [l.current, l.next], [null, "bronze"]);
  ok(
    "fresh teacher: bronze keystones resolve to real rows",
    l.steps[0].requirements.slice(1).every((r) => r.badge !== null && r.met === false),
  );
}

/* ── 3. The 2026-10-12 screenshot teacher: platinum rank, bronze medal ─── */

{
  const names = [
    "Roll Call", "Register Keeper", "Never Misses",
    "Lesson Logged", "Course Keeper",
    "Planned Ahead", "Topic Ticked",
    "First Paper", "Paper Trail", "Paper Out", "Regular Examiner",
    "Red Pen", "Marking Marathon", "Results In",
    "Homework Set", "Regular Setter",
    "Task Starter", "Team Player",
  ];
  const p = payload(names);
  eq("screenshot teacher: 420 points", p.points, 420);
  const l = m.buildMedalLadder(p);
  eq("screenshot teacher: bronze held, silver next", [l.current, l.next], ["bronze", "silver"]);
  eq("screenshot teacher: statuses", statuses(l), ["bronze:earned", "silver:next", "gold:locked", "diamond:locked"]);
  const silver = l.steps[1];
  eq("screenshot teacher: silver 3 of 8", [silver.metCount, silver.total], [3, 8]);
  const open = silver.requirements.filter((r) => !r.met);
  eq("screenshot teacher: the points floor is open too", open[0].kind, "points");
  eq(
    "screenshot teacher: silver badge gaps",
    open.filter((r) => r.kind === "badge").map((r) => r.badge.name),
    ["Week Ready", "Chapter Closer", "Report Ready", "Class Mentor"],
  );
  // Bar: mean of (420/600, 1, 0, 0, 1, 1, 0, 0) = 3.7 / 8.
  eq("screenshot teacher: silver progress ratio", Math.round(m.medalProgressRatio(silver) * 10000), 4625);
  // The dropdown lists exactly the open ones, points first.
  const todo = m.openRequirements(l);
  eq("screenshot teacher: five open to-dos, points first", [todo.length, todo[0].kind], [5, "points"]);
  eq(
    "screenshot teacher: to-do badges",
    todo.slice(1).map((r) => r.badge.name),
    ["Week Ready", "Chapter Closer", "Report Ready", "Class Mentor"],
  );
  eq("screenshot teacher: bronze progress ratio is 1", m.medalProgressRatio(l.steps[0]), 1);
}

/* ── 4. The points floor binds on its own ──────────────────────────────── */

{
  // Every bronze keystone held, but the points forced below the floor.
  const l = m.buildMedalLadder(
    payload(m.MEDAL_RULES.bronze.keystones.map(nameOfRule), { points: 60 }),
  );
  eq("floor binds: bronze still next", [l.current, l.next], [null, "bronze"]);
  const open = l.steps[0].requirements.filter((r) => !r.met);
  eq("floor binds: the one open requirement is points", open.map((r) => r.kind), ["points"]);
  eq("floor binds: have/need carried", [open[0].have, open[0].need], [60, 100]);
}

/* ── 5. Medals are taken in order ──────────────────────────────────────── */

{
  const gold = m.MEDAL_RULES.gold.keystones.map(nameOfRule);
  const silverButOne = m.MEDAL_RULES.silver.keystones.map(nameOfRule).filter((n) => n !== "Week Ready");
  const bronze = m.MEDAL_RULES.bronze.keystones.map(nameOfRule);
  const l = m.buildMedalLadder(payload([...bronze, ...silverButOne, ...gold], { points: 1400 }));
  eq("in order: silver is next, not gold", [l.current, l.next], ["bronze", "silver"]);
  eq("in order: gold locked even with its own requirements met", l.steps[2].status, "locked");
  eq("in order: gold reports all met", [l.steps[2].metCount, l.steps[2].total], [10, 10]);
  eq("in order: gold ratio is 1 while locked", m.medalProgressRatio(l.steps[2]), 1);
}

/* ── 6. Everything held: diamond, nothing next ─────────────────────────── */

{
  const l = m.buildMedalLadder(payload(ROWS.map((r) => r[0])));
  eq("everything: diamond, nothing next", [l.current, l.next], ["diamond", null]);
  eq("everything: all earned", statuses(l), ["bronze:earned", "silver:earned", "gold:earned", "diamond:earned"]);
  eq("everything: every ratio 1", l.steps.map(m.medalProgressRatio), [1, 1, 1, 1]);
  eq("everything: nothing left to do", m.openRequirements(l).length, 0);
}
{
  const l = m.buildMedalLadder(undefined);
  eq("no payload: bronze ratio 0", m.medalProgressRatio(l.steps[0]), 0);
  eq("no payload: unresolved keystone ratio 0", m.requirementRatio(l.steps[0].requirements[1]), 0);
}

/* ── 7. Progress at target is not an award ─────────────────────────────── */

{
  const p = payload(["Course Keeper", "Paper Out", "Homework Set"], {
    points: 150,
    progress: { [idOf("Register Keeper")]: { current: 10, target: 10 } },
  });
  const l = m.buildMedalLadder(p);
  const reg = l.steps[0].requirements.find((r) => r.kind === "badge" && r.badge.name === "Register Keeper");
  eq("progress at target: not met until awarded", reg.met, false);
  eq("progress at target: progress row carried for the bar", reg.progress, { current: 10, target: 10 });
  eq("progress at target: ratio reads 1 while met stays false", m.requirementRatio(reg), 1);
  eq("progress at target: bronze still next", l.next, "bronze");
}

/* ── 8. Catalog gaps ───────────────────────────────────────────────────── */

{
  // Without Register Keeper the bronze attendance keystone takes the next rung up.
  const thinner = CATALOG.filter((b) => b.name !== "Register Keeper");
  eq(
    "gap: resolves to the smallest row at or above",
    m.resolveKeystone({ metric: "attendance_days_marked", min: 10 }, thinner).name,
    "Never Misses",
  );
  // With no attendance badge at all the keystone is a hole and bronze is out of reach.
  const noAttendance = CATALOG.filter((b) => b.criteria_metric !== "attendance_days_marked");
  const names = ROWS.map((r) => r[0]).filter((n) => !/Roll Call|Register Keeper|Never Misses/.test(n));
  const l = m.buildMedalLadder({ ...payload(names), catalog: noAttendance });
  eq("hole: no medal even with everything else", [l.current, l.next], [null, "bronze"]);
  const hole = l.steps[0].requirements.find((r) => r.kind === "badge" && r.badge === null);
  ok("hole: the unresolved keystone is reported", hole !== undefined && hole.met === false);
}

/* ── 9. Keystone map for the tile notes ────────────────────────────────── */

{
  const map = m.keystoneBadgesByMedal(CATALOG);
  eq("keystone map: 24 badges are keystones", map.size, 24);
  eq("keystone map: Register Keeper is bronze", map.get(idOf("Register Keeper")), "bronze");
  eq("keystone map: Never Misses is silver", map.get(idOf("Never Misses")), "silver");
  eq("keystone map: Term Ready is gold", map.get(idOf("Term Ready")), "gold");
  eq("keystone map: Question Master is diamond", map.get(idOf("Question Master")), "diamond");
  eq("keystone map: Marking Machine is diamond", map.get(idOf("Marking Machine")), "diamond");
  eq("keystone map: Roll Call (first time) is not a keystone", map.has(idOf("Roll Call")), false);
  eq("keystone map: Paper Out (first time) is not a keystone", map.has(idOf("Paper Out")), false);
  eq("keystone map: Task Champion is not a keystone", map.has(idOf("Task Champion")), false);
}

eq("medalBelow", m.MEDAL_ORDER.map(m.medalBelow), [null, "bronze", "silver", "gold"]);

/* ── Report ────────────────────────────────────────────────────────────── */

console.log(`medals: ${pass} passed, ${fail} failed`);
for (const f of failures) console.log(`  FAIL ${f}`);
process.exit(fail === 0 ? 0 : 1);
