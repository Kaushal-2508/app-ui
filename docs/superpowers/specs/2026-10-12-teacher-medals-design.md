# Teacher medals: earned standings above the badge set

**Date:** 2026-10-12. **Owner:** Naman (frontend, branch `naman-erp`). **DB half:** Tushar (section 6).
**Asked for by:** Naman, from the `/achievements` teacher view: "different levels of achievement,
bronze, silver, gold, diamond, that only come when the achievement is completed; make some tasks that
are not done easily; every teacher has its medal."

## 1. The problem

The teacher on the 2026-10-12 screenshot held **Platinum Rank** with 685 points and 24 of 50
badges. The rank comes from `badge_rank_for_points()` (bronze at 0, silver 100, gold 300, platinum
600, diamond 1000), which hands every teacher a rank on day one and reaches platinum on first-time
badges alone (Roll Call, Lesson Logged and the other "do it once" rungs are 10 to 15 points each).
A rank that is given, and climbs that fast, says nothing about the teacher.

## 2. Decisions

1. **Four medals: Bronze, Silver, Gold, Diamond.** No platinum. The badge tiers keep all five
   plus legendary; the medal ladder is a separate, shorter thing a teacher can hold in their head.
2. **A medal is earned, never given.** There is no medal until every Bronze requirement is met.
   "No medal yet" is a real state the hero renders.
3. **Points alone never earn a medal.** Each medal has a points floor AND a set of **keystone
   badges** that must all be held. The floor is the breadth; the keystones are the depth.
4. **Medals are taken in order.** Gold cannot be held without Silver, even with every Gold
   requirement met. The ladder section shows such a rung as "Locked, earn the Silver Medal first".
5. **Keystones are inside the teacher's own control.** Attendance, lessons, planning ahead,
   chapters, papers, publishing, marking, results, remarks, homework. Tasks, cover periods and
   leave reviews still carry points but are never keystones: a teacher nobody assigns a task to
   must still be able to reach Diamond.
6. **A keystone is addressed by metric + threshold, never by badge id or name.** Ids differ per
   environment and names get renamed. The engine resolves each rule to the catalog row with that
   metric and the smallest `criteria_value` at or above the threshold, so a harder badge landing in
   the DB re-points the ladder with a one-number edit.
7. **Derived on the frontend for now** from the `teacher_achievements()` payload (catalog, earned,
   progress, points). No new query, no new table. Section 6 is what moves it server-side.
8. **Nothing that gates a medal is a minute's work** (Naman, 2026-10-12: "not completed within 1
   minute, or 1 day"). First-time rungs (threshold 1: Roll Call, Paper Out, Homework Set, Red Pen,
   Results In and the rest) carry points but are never keystones; every keystone threshold is 5 or
   more, and Bronze needs attendance on 10 DISTINCT days, the one metric that cannot be rushed.
   With medals taken in order, no medal can be earned inside a day. The badges themselves are DB
   rows, so making every BADGE take days is section 6a.
9. **Show the stage and what is left, nothing else** (Naman, 2026-10-12, third round: "no need to
   show all the data, just which stage and what to do for reaching the next stage"). The
   four-medal strip and the full requirement panel were removed; the page shows the medal held
   (hero) and the OPEN requirements of the next medal as to-dos. Met requirements, blurbs and the
   medals beyond the next one are not rendered. The engine still computes the whole ladder.

## 3. The ladder (the single source: `src/components/achievements/teacher/medals.ts`)

The live teacher catalog carries 50 badges and 2,245 points. Floors sit a little above what each
medal's own keystones and their lower rungs add up to (about 175, 540, 1,260 and 1,785), so a floor
always asks for some breadth beyond the keystones instead of being implied by them.

| Medal | Title | Points floor | Keystones (badge, metric at threshold) |
|---|---|---|---|
| Bronze | Settled in | 100 | Register Keeper (attendance 10 days), Course Keeper (lessons 10), Paper Trail (exams 10), Regular Setter (homework 5) |
| Silver | Consistent | 600 | Never Misses (attendance 30 days), Week Ready (planned ahead 10), Chapter Closer (chapters 10), Regular Examiner (published 25), Marking Marathon (answers 25), Report Ready (results 10), Class Mentor (students remarked 10) |
| Gold | Complete teacher | 1,300 | Syllabus Shepherd (lessons 50), Term Ready (planned ahead 40), Curriculum Complete (chapters 40), Exam Architect (exams 25), Century of Scripts (answers 100), Results Veteran (results 25), Every Student Seen (students remarked 30), Practice Architect (homework 15), Feedback Loop (homework marked 5) |
| Diamond | Master of the craft | 1,900 | Question Master (exams 50), Publishing Pro (published 50), Marking Machine (answers 200), Question Vault (questions 50) |

24 of the 50 badges are keystones; the other 26 (every first-time rung, Task Champion and the
teamwork ladders among them) are prestige and points only. No keystone has a threshold under 5.

**Assumption to confirm with Naman.** The ask said "100 points for bronze, 100 for silver, then
gold then diamond". Read literally as 100-point steps, Diamond would be 400 points, which the
screenshot teacher already clears, so the floors climb instead. They are one table; any other
numbers are a one-line edit each.

The screenshot teacher under this ladder: **Bronze Medal, Silver next, 3 of 8 met, bar at 46%**
(points 420 of 600, Week Ready, Chapter Closer, Report Ready and Class Mentor open).
`medals.test.mjs` pins that case.

## 4. What the teacher sees (`/achievements`, teacher and coordinator)

- **Medal progress card** (`TeacherHero.tsx`), under a "Medal progress ›" header, in the
  VIP-progress layout Naman picked from a reference on 2026-10-12: the medal emblem (new
  `MedalDisc`, a round medal on a ribbon, deliberately not the heraldic badge shield), the
  teacher's name with a chevron, one percentage with an info button, a pale-to-saturated bar in
  the colour of the next medal, the medal held at the bar's left end and the next one at its right
  ("No medal" / "Bronze" for a new teacher, "Diamond" / "Highest medal" at the top). The percentage
  is the MEAN progress across the next medal's requirements, rounded down (`medalProgressRatio`),
  so the bar moves on the eleventh register rather than only when a whole badge lands; the info
  popover says so in one sentence. A calm `surface-card`, not a teal HeroCard (the reference is a
  quiet dark panel, which the card surface is in dark mode). The header, the name and both chevrons
  scroll to the ladder. The payload's `rank` / `next_rank_at` are no longer read on this surface.
- **The to-do dropdown inside the card** (`NextMedalTodo.tsx`, fifth round: "instead of this
  bottom column add a dropdown in above column"): under the bar, a "What's left for the Silver
  Medal" row with the open count and a chevron, collapsed by default; the name's chevron toggles
  the same list. Expanded, it lists ONLY the open requirements as to-dos: "Earn 155 more points"
  (445 of 600), "Week Ready: 4 more lessons planned ahead to go" with a percent. A badge row is a
  button that opens that badge's category tab below (the same action as the violet card's "View
  badge"). Met requirements are not listed. A requirement whose progress has reached the target
  but has no award yet reads "Complete. The badge is on its way." Diamond held or an empty
  catalog: no dropdown, the name is plain text. The grid is `lg:items-start` so the violet card
  keeps its height while the dropdown is open.
- **Badge tiles**: a keystone tile shows "Needed for the Gold Medal" under its status line
  (new optional `note` prop on `BadgeTile`).
- **States that must stay reachable:** no medal yet; medal held with a next; Diamond held with
  nothing next; a keystone the school's badge set lacks ("Badge not available yet", with the
  quantity it would need), which keeps its medal out of reach rather than waiving it; progress at
  100% but not yet awarded (the evaluator runs on the next event) is NOT met.
- **Catalog empty:** the card does not render; the violet card already says the badge set is off.

Design-system notes: medal colours are the `--tier-*` tokens (both themes), so a Gold Medal and a
gold badge are the same gold; locked discs use `--tier-locked*`; no new token, no `index.css` edit.

### 4b. Home (teacher hub and coordinator dashboard)

"It must be seen in home page" (Naman, 2026-10-12, fourth round), then, on seeing the full card
there, "dont make it this big, just a small near name". So Home gets `MedalChip`
(`src/components/dashboards/MedalChip.tsx`): a 24px medal disc, "Bronze · 63% to Silver" and a
chevron, on the subtitle line under the greeting ("Teacher · School", the chip beside it, wrapping
under on a phone) on the teacher `NavigationHub` (`showMedal`) and under the header on
`CoordinatorDashboard`. Tapping it opens `/achievements`, where the full card and the to-do list
live. It reads `useTeacherAchievements()`, the one request Achievements already makes (same query
key, 60s staleTime), so Home and Achievements share a cache entry; no second RPC. Not feature-gated,
because `/achievements` is not either (no `FEATURE_URL_MAP` entry). States: error first (a muted
"Medal unavailable, tap to retry" chip, never a silent disappearance), then loading (a chip-sized
skeleton), then empty (badge set off: nothing on Home; Achievements explains). Admins never see it:
the chip reads the teacher ladder.

## 5. Engine and test

`buildMedalLadder(payload)` walks the four rules bottom-up and returns every step with its
requirements, met count and status (`earned` / `next` / `locked`), plus `current` and `next`.
`keystoneBadgesByMedal(catalog)` feeds the tile notes. The module is erasable TypeScript
(`import type` only) so `medals.test.mjs` beside it runs the real module under
`node --experimental-strip-types` against the live 50-row catalog: every rule must match a catalog
row exactly, no keystone may be a teamwork metric, a first-time rung (threshold under 5) or appear
under two medals, Bronze must need 10 distinct attendance days, floors must bind on their own,
medals must be taken in order, the progress ratio must be the mean of the requirement ratios, and
no blurb may carry an em-dash. 148 checks.

Suggested for `scripts/` once Tushar moves it: `"test:medals": "node --experimental-strip-types
scripts/test-teacher-medals.mjs"`.

## 6. NEEDS DB (Tushar)

### 6a. Harder badges ("tasks that are not done easily")

**Every badge should take days, not a click.** 18 of the 50 live rows have threshold 1 (Roll
Call, Lesson Logged, Planned Ahead, Topic Ticked, First Paper, Paper Out, Question Smith, AI
Co-author, Template Maker, Shared Blueprint, Red Pen, Results In, Knows Their Names, Homework Set,
Marked and Returned, Task Starter, Stepped In, Gatekeeper) and are earned in a minute. The medal
ladder already ignores them (section 2.8), but they still sit on the tiles as "achievements".
Options, Tushar's call: (a) fold them into the Onboarding Journey and deactivate the rows; (b) keep
them as 5-point "first step" rungs; (c) raise each to 3 or 5. Beyond thresholds, only
`attendance_days_marked` counts DISTINCT DAYS; every other metric is a row count that a bulk
action can reach in an afternoon. A day-aware twin for the daily metrics (`lesson_log_days`,
`planning_days`, `marking_days`: distinct institution-local dates with at least one event) is what
would make "not within a day" true for every badge, and needs evaluator work plus a measure script.

The hardest live rungs are a term's work (30 attendance days, 50 lessons, 50 papers). Year-scale
rungs on the SAME eighteen metrics need only catalog rows, no evaluator change: `evaluate_teacher_badges`
already awards every rung of a metric. Proposed rows (`badge_type='teacher'`, `criteria_type='count'`,
icons from the existing `BadgeIcon` map; repeats are fine):

| Name | Description | Category | Tier | Metric | Threshold | Points | display_order |
|---|---|---|---|---|---|---|---|
| Iron Register | Mark attendance on 100 days | classroom | platinum | attendance_days_marked | 100 | 150 | 280 |
| Full Year Register | Mark attendance on 180 days | classroom | diamond | attendance_days_marked | 180 | 250 | 281 |
| Hundred Lessons | Complete 100 lessons | classroom | platinum | lessons_taught | 100 | 150 | 282 |
| Year of Lessons | Complete 200 lessons | classroom | diamond | lessons_taught | 200 | 250 | 283 |
| Year Planned | Plan 100 lessons ahead of time | classroom | platinum | lessons_planned_ahead | 100 | 150 | 284 |
| Whole Syllabus | Complete 80 chapters | classroom | platinum | syllabus_topics_completed | 80 | 150 | 285 |
| Hundred Papers | Create 100 exams | assessment | diamond | exams_created | 100 | 250 | 260 |
| Examiner in Chief | Publish 100 exams | assessment | platinum | exams_published | 100 | 150 | 261 |
| Question Forge | Write 200 questions into the question bank | assessment | platinum | questions_authored | 200 | 150 | 262 |
| Five Hundred Scripts | Evaluate 500 answers | marking | diamond | answers_evaluated | 500 | 250 | 270 |
| Fifty Results | Publish results for 50 exams | marking | platinum | results_published | 50 | 150 | 271 |
| Whole School Knows | Write remarks for 100 different students | marking | platinum | students_remarked | 100 | 150 | 272 |
| Homework Habit | Set 50 pieces of homework | homework | platinum | homework_created | 50 | 120 | 290 |
| Every Piece Returned | Mark 25 homework assignments as checked | homework | platinum | homework_marked | 25 | 120 | 291 |
| Pillar of the Staffroom | Complete 60 tasks | teamwork | diamond | tasks_completed | 60 | 200 | 295 |
| Always Covering | Cover 40 periods as a substitute | teamwork | platinum | substitutions_covered | 40 | 120 | 296 |

Run `scripts/measure-staff-badge-ladders-round2.sql` (or a sibling) first so the thresholds sit
where a handful of teachers, not none, would already qualify. These add about 2,760 points; once
they land, re-tune the floors in `MEDAL_RULES` (Diamond to roughly 3,000) and re-point Diamond's
keystones to the year-scale rungs (attendance 100, lessons 100, planned ahead 100) with one-number
edits. `medals.test.mjs` will fail until its fixture carries the new rows, which is the reminder.

Genuinely new metrics (an attendance STREAK of consecutive working days, marking returned within N
days) need evaluator work and a measured source; not required for this, listed so they are not
re-invented.

### 6b. The medal, server-side

So a medal has an earned date, a notification and one source of truth:

- `teacher_medal_rules` (or the rule table inside a function) mirroring section 3, and
  `teacher_medal_for(_user_id)` returning `(medal, next_medal, requirements jsonb)`.
- `user_medals (user_id, medal, earned_at, institution_id)` written by `evaluate_teacher_badges`
  right after `user_badges`, once per medal, with the same `ON CONFLICT DO NOTHING` idempotency
  and the same `(select auth.uid())` RLS style as `user_badges`; index on `(user_id)`.
- `teacher_achievements()` gains `medal`, `medal_earned_at` and `next_medal`. The frontend table
  then becomes a mirror (the way `RANK_FLOOR` mirrored `badge_rank_for_points`), with the engine kept
  only to render the requirement rows.

### 6c. "Every teacher has its medal" beyond this page

`badge_leaderboard` returns points and per-tier badge counts, not which badges, so a keystone-gated
medal cannot be derived on the leaderboard client-side. Add `medal` to its row (from 6b) and the
leaderboard podium, the rankings list and the staff/teacher lists can show each teacher's disc with
`MedalDisc size="sm"`. Until then the medal shows only on `/achievements`.

## 7. Out of scope, on purpose

- The student surface (`PlayerCard`, `badge_rank_for_points`) is untouched.
- No new query, no `refetchInterval`, no realtime: the ladder is a pure function of the one
  payload the page already fetches (`staleTime` 60s).
- `index.css`, `App.tsx` and the other load-bearing files are untouched.
