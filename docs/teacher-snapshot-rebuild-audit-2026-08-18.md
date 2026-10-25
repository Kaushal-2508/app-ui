# Teacher Snapshot Rebuild — Feasibility Audit (2026-08-18)

Method: 6 parallel investigation agents over code + **live prod SQL** (project
`gyymkgohcijeksmrzuyw`), each adversarially verified by a second agent instructed
to refute. 56 findings survived, 2 refuted. Two dimensions (scope-leak fix list,
data-availability) died on API connection errors and were re-run.

Verdict in one line: **the root-cause scope fix (§1) is real, correct and
unblocked. Roughly half of the §2 page structure cannot be built as written,
because the data sources it names are empty.**

---

## A. The scope leak is confirmed, and worse than the spec assumed

**Every `dash_scoped_*` function resolves the teacher to `class_id` only.**
`dash_resolve_scoped_classes()` teacher branch is:

```sql
SELECT array_agg(DISTINCT ca.class_id) FROM class_assignments ca
JOIN classes c ... WHERE ca.user_id = auth.uid() AND ca.role = 'teacher'
```

`subject_id` is never referenced. Of the 17 `dash_scoped_*` functions in prod,
**11 never mention `subject_id` at all**, and the 5 that do mention it use it as a
GROUP BY axis, not as a filter on the teacher's own subjects.

That is exactly why the live screenshot shows a one-subject teacher a "Subjects by
performance" chart listing Art, English Core, English, Hindi, Computer Science,
Physical Education, Science, Social Studies and Mathematics.

Two leaks are worse than the subject problem and are already shipped:

- **`TeachersTable` is mounted on the teacher Snapshot** (`ScopedSnapshotPage.tsx:113`)
  and exposes peer teachers' **attendance %, last login and flags** to any teacher.
  This is the HR-monitoring surface the spec's own hard rule forbids.
- **`ClassesTable` deep-links to a route teachers are barred from** — the click
  bounces to `/dashboard`.

Plus the KPI headline "SCHOOL AVERAGE THIS TERM 46.8%", which the spec forbids
outright.

## B. The PRD citation the spec builds its security boundary on is wrong

> spec §1: "per PRD §17, `is_assigned_to_class()` and friends already exist for this — use them"

**`is_assigned_to_class()` checks neither subject nor role.** PRD §17
(`PRDDocument.tsx:1160-1198`) says only "Check class assignment"; the word
"subject" does not appear in that range, and the prod function body confirms it.

So the instruction to reuse the existing helpers, followed literally, would build
the new security boundary on a helper that cannot express the boundary. The
subject-pair concept **is** in the PRD — but in §5, not §17.

`teacher_roster_student_ids` self-authorises as claimed, but likewise **returns no
subject dimension**, so it cannot back per-subject tiles on its own.

Confirmed as cited: **PRD §31** (the `dash_*`/`dash_scoped_*` sibling rule) and
**PRD §29** (homework tables shipped and in real use).
**PRD §12.3** is only partially correct — the four bands exist but their
boundaries are ambiguous and **no shipped surface implements them**, so we are
defining them, not reusing them.

## C. Sections that cannot be built as written — empty data

| Spec | Named source | Prod reality |
|---|---|---|
| **§2.5 Weak chapters** | `concept_mastery` | **0 rows. Zero functions in the database reference it.** |
| **§2.5 Weak chapters** | `student_topic_performance` | **0 rows, no writer anywhere in the repo.** Also has no `subject_id`, no `class_id` |
| **§2.6** `concept_mastery.trend` chip | `concept_mastery` | same table, 0 rows |
| **§2.4** score % + delta vs last term | `class_aggregates` | **13 rows, last written 2026-02-17.** `subject_id` FK points at the legacy 6-row `subjects` table |

§2.5 as specified is not "thin", it is **un-renderable**. Built literally it ships
a permanently empty card — the identical failure that just got the Reports tab
deleted.

## D. Named reusable components that do not exist or are dead

| Spec names | Reality |
|---|---|
| `usePacingTracker` | **Dead.** Its RPC `get_pacing_summary` was DROPPED from prod by migration `20260418150000:30`. Mounting it 404s. Zero importers, so nobody noticed |
| `TopicHeatmap.tsx` | Component is fine and reusable — its only data feed is the 0-row table |
| `ConceptMasteryCard.tsx` | Exists, student-scoped, 0-row source. Can only ever render its "no weak concepts" empty state |
| `AttendanceMarker` | **Does not exist.** Closest is `ClassAttendanceMarker`, and the teacher attendance surface is **not deep-linkable to a class** |
| `LessonPlanPanel` | **Does not exist.** Closest is `LessonPlanDialogV2`, which needs a full `TeacherWeekSlot` object and cannot be opened from a dashboard |
| "message parent via Communication Hub" | **No such entry point, and no parent role exists in production.** The Communication Hub messages STUDENTS |
| `useSubjectDetailAnalytics` | Exists but is institution-wide, unbounded, and reads the two dead tables |
| `useClassDetailAnalytics` | Exists, class-parameterised, but performs **zero authorisation** |
| `EvaluateAttemptPage` | Exists, teacher-allowed, deep-linkable. The one clean reuse |

## E. §2.2 / §3 engagement score + leaderboard is not viable on current data

- **"Digital attendance %" is uncomputable.** `attendance_records.method` is
  `'manual'` on **100% of 33,669 rows**. The metric is a constant 0 for everyone.
- **"Syllabus logging cadence"** has **8 lifetime recorders out of 213 teachers**
  (4 in the last 60 days). `tt_lesson_plans` is no better: 6 owners in 60 days.
- **Grading turnaround** is measurable (columns `submitted_at` / `finalized_at` /
  `finalized_by` are real) but only **6.4% of submitted attempts are finalized**.
- **Homework turnaround** is clean but thin — 17 teachers in 60 days.

The decisive number: **exactly 1 of 213 teachers has all four inputs in a 60-day
window. Only 61 have any.** A fixed-weight composite over that is not a ranking,
it is noise. A truthful leaderboard today would rank roughly a dozen teachers.

**Wing resolution is a genuine hole**, and the spec's premise is partly wrong:
16 teachers *are* directly wing-assigned. But 51 teachers span 2 wings, 4 span 3,
13 have none, and only **390 of 1,297 classes are wing-mapped at all**. With a
sane 5-teacher cohort floor, every wing collapses to institution-wide in practice.

**Unrelated live security bug found on the way:** `badge_leaderboard(_limit)`
grants EXECUTE to **PUBLIC (including anon)** and returns `user_id` + **email**
with a caller-controlled limit. One-line REVOKE, out of scope here, but it should
be fixed.

## F. The mockup vs the design system

- **The entire mockup palette is raw hex with no dark-mode counterpart.** 8 colour
  decisions have no both-modes equivalent and **two invert into invisibility**.
- **The page-spanning gradient banner is the one pattern the design system
  explicitly rejected** (checklist rule 14).
- Mockup teal and violet are **not** the SALCI brand colours.
- **The mockup is drawn for a 2-pair teacher. The median teacher has 4 pairs and
  the 90th percentile has 10** — four of its patterns break at real data volume.
- Good news: **zero new design tokens are actually required.** Every mockup
  semantic already has a token pair or an engine in the system.
- `ListRow` is one card *per row*; every mockup list is hairline rows *inside* one
  card, so the primitive needs a flat variant.

## G. What IS viable, and should be built

| Spec | Source | Status |
|---|---|---|
| §2.3 ungraded on own exams | `student_exam_attempts.evaluation_status` via `exams.created_by` | VIABLE |
| §2.3 unmarked homework | `homework_*` via `created_by` (1,467 assignments / 639 submissions) | VIABLE |
| §2.6 homework non-submission | `homework_submissions` absent, trailing 5 | VIABLE |
| §2.6 test non-attempt | `student_exam_attempts` absent, trailing 3 | VIABLE |
| §2.6 attendance signal | `attendance_records` (33,669 rows, current) | VIABLE |
| §2.7 portal adoption | `user_activity_log` rollup + `auth.refresh_tokens` (13,519 rows, ~7 months backfill) | VIABLE |
| §2.8 syllabus coverage | `dash_scoped_syllabus_coverage` already exists and is scope-aware | VIABLE |
| §2.9 attendance trend | existing widget | VIABLE, just needs the scope fix |

**§2.7 is more valuable than the spec assumes: 1,472 accounts have never signed
in, against 1,418 that have.** The never-logged-in banner is about half the user
base, not an edge case.

The replacement for §2.5's dead sources is **`exam_questions.tags`** (6,977 of
8,602 questions tagged) joined through `teacher_overrides` → `student_answers` →
attempts → exams. That gives genuine per-chapter weakness **scoped to the
teacher's own exams**, on live data.

## H2. WHAT SHIPPED (2026-08-18)

All three phases applied to prod. Migrations:
`20260818140000_teacher_scoped_dashboard.sql`,
`20260818150000_teacher_action_queue_and_pairs.sql`,
`20260818160000_teacher_dashboard_phase3.sql`.

| Spec | Status | Notes |
|---|---|---|
| §1 scope fix | DONE | `dash_resolve_scoped_pairs()` + `dash_teacher_kpi_summary` + `dash_teacher_subject_performance`. Diff test: Teacher2 46.8%→38.9%, Teacher4 46.8%→null |
| §2.1 header chips + scope note | DONE | pairs rendered from the same RPC that enforces scope |
| §2.2 leaderboard | DEFERRED | owner's call: 1 of 213 teachers has all four inputs |
| §2.3 action queue | DONE | `dash_teacher_action_queue()` |
| §2.4 my classes & subjects | DONE | `dash_teacher_class_subjects()`, off `final_results` not `class_aggregates` |
| §2.5 weak chapters | DONE | `dash_teacher_weak_chapters()` off `exam_questions.tags` |
| §2.6 students needing attention | DONE | `dash_teacher_students_attention()`, 4 signals, unified list + filter row |
| §2.7 portal adoption | DONE | `student_activity_daily` + cron job 23 (00:20 daily) + `dash_teacher_portal_adoption()`. Backfill: 4,162 rows / 860 students / from 2026-01-27 |
| §2.8 syllabus coverage | DONE | `dash_teacher_syllabus_coverage()`, coverage + recency only, no pacing language |
| §2.9 attendance trend | DONE | inherits the Phase 1 scope fix |
| §2.10 footer scope note | DONE | mirrors the header |
| §3 engagement score | DEFERRED | with §2.2 |

`TeachersTable` is unmounted for teachers. The dead `/school/class/:id` links are inert for teachers.

### Traps hit and fixed while building
- `CREATE TEMP TABLE` is illegal inside a `STABLE` function — replaced with a uuid[].
- **`auth.refresh_tokens.user_id` is `character varying`, not `uuid`** — the join to
  `profiles` needs an explicit `::uuid` cast or it fails with a type mismatch.
- `get_display_name_for()` does not exist in SQL (it is the TS `getDisplayName`).
- The Management API returns HTTP 400 with an EMPTY body on any SQL error, so a
  failed multi-statement migration gives no diagnostic — bisect by section.

### Known characteristic, not a bug
40.1% of `teacher_overrides` rows are zero-mark while the mean is 59.6%: 6,998 of
7,755 are auto-graded MCQs, so marks are bimodal. Weak-chapter lists therefore
saturate at 0.0% for genuinely-missed tags. Verified real, not a grading defect.

## H. Recommended sequencing

1. **Phase 1 — scope fix only.** Subject-aware resolver + amended/new
   `dash_scoped_*` functions, unmount `TeachersTable`, remove the school-average
   KPI, fix the `ClassesTable` dead link. No visual change. Independently
   shippable and makes the current page correct.
2. **Phase 2 — action queue + my classes & subjects** on live data (§2.3, §2.4
   rebuilt off `final_results` rather than `class_aggregates`).
3. **Phase 3 — students needing attention** (§2.6) minus the `trend` chip.
4. **Phase 4 — portal adoption** (§2.7) incl. the `student_activity_daily` rollup.
5. **Phase 5 — weak chapters** (§2.5) rebuilt on `exam_questions.tags`.
6. **Deferred — engagement score + leaderboard** (§2.2/§3) until the inputs have
   adoption. Revisit when more than ~1 teacher in 213 has the data.
