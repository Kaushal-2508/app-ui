# Admin Dashboard v5 — design

**Status:** SHIPPED 2026-09-16 on `feat/admin-dashboard-v5`. `/school/command-center` serves it; the old page is deleted.
**Replaces:** the current `/school/command-center` (`CommandCenterPage` + `dash/` components)
**Design of record:** [public/report_reference/salci-admin-dashboard-v5.html](../../../public/report_reference/salci-admin-dashboard-v5.html)

Tushar's instruction: reproduce that reference exactly. Only colours and small
element styling move to the live SALCI theme. Nothing is added, removed or
"improved" on top of it.

## 1. Why the current page is being replaced

Replayed as a real Alliance admin (1,545 students, 53 active classes) the current
Command Center reads as a wall of undifferentiated alarm: 777 students "need
help", 263 decisions waiting, 263 flags of which 236 share one sentence, 90 staff,
9 explainer paragraphs. Against the Salci National demo seed it reads as empty.
Neither state tells a principal what to do. The v5 reference answers that with a
single spine: **wing → class → subject → chapter**, every number below a row the
sum of the rows inside it.

## 2. The atom, and where each field comes from

Everything above the subject row is DERIVED. The subject row (one class × one
subject) is the only source of truth. Class = sum / weighted mean of its
subjects; wing = sum of its classes; school = sum of its wings. Attendance is the
one exception: it is logged per class per day and rolls up student-weighted.

| Atom field | Source in prod | Notes |
|---|---|---|
| `students` | `institution_student_ids()` ∩ `class_assignments` | canonical roster, never hand-counted |
| `chapters` | `chapter_topics` per (subject, class_group) | the unit SALCI drills to; never below chapter |
| `chaptersDone` / `chaptersPartial` | `syllabus_progress_events` | two-timeline syllabus; `dash_syllabus_coverage` already reads this |
| `coverHalf` | derived: done×2 + partial×1 | coverage = earned ÷ (chapters×2) |
| `lessonsPlanned` / `lessonsTaught` | `tt_lesson_plans` (`status='done'` = taught) | gated on the `timetable` feature |
| `papers` (year) | `exams` × `exam_subjects` | distinct exam events |
| `wkDone` / `wkPlanned` | `exams` in the current Mon→today week | held vs scheduled |
| `papersPublished` / `pendingGrading` | `exams.status` | backlog can never exceed papers held |
| `papersPlanned` / `papersDraft` / `papersScheduled` | `exams` + status | pipeline parts must sum to the plan |
| `accRaw` | `final_results.percentage` via `student_exam_attempts` | mean of the subject's papers; attempts-weighted upward |
| `attempts` | count of `final_results` rows | the weight for every score rollup |
| `hwAssigned` / `hwSubmitted` | `homework_assignments` + `homework_assignment_classes/_subjects` + `homework_submissions` | % = submitted ÷ (assignments × students) |
| `attendance` | `attendance_records` | class level, student-weighted upward |
| wings | `wings` + `wing_class_mappings` | **active classes only** (see §5) |

All sixteen exist. Nothing in the reference needs inventing.

## 3. The two formulas, applied identically at every level

```
composite = 0.45×accuracy + 0.25×syllabus + 0.15×attendance + 0.15×lessonPct
band      = ≥84 Excellent · ≥75.5 Good · ≥66 Watch · else Attention
```

Student bands are a different cut, off the student's own mean mark:
`≥85 exc · ≥72 good · ≥60 watch · else att`.

One SQL implementation of each, called everywhere. A second copy is how the
KPI and the table start disagreeing (`SEVERITY_WEIGHTS` already did that once).

## 4. Sections, and what each needs

| # | Section | New RPC | Reuses |
|---|---|---|---|
| 1 | Four stat cards | `dash5_tree` totals | |
| 2 | School performance drill (wings→classes→subjects→chapter drawer) | `dash5_tree`, `dash5_subject_chapters` | |
| 3 | Insights by SALCI AI | extend `dash_admin_digest` | |
| 4 | Task suggestions by SALCI AI | `dash5_task_suggestions` | `create_task_group` to approve |
| 5 | Events | | `dash_recent_events` |
| 6 | Are your students using SALCI + adoption drill | `dash5_student_tree` | `dash_admin_portal_adoption` |
| 7 | Where students stand (donut drill) + score distribution | `dash5_score_distribution` | `dash_student_distribution` |
| 8 | Students who need attention | `dash5_students_at_risk` | `dash_students_attention` |
| 9 | Teachers by activity + Coordinator by wing | `dash5_teacher_activity` | `dash_teachers_table`, `dash_wing_performance` |
| 10 | Class-wise average performance (drillable bars) | `dash5_tree` | |
| 11 | Exam performance over time (scatter + trend) | `dash5_exam_papers` | `dash_exam_trend` |
| 12 | Subject-wise performance | | `dash_subject_performance` |
| 13 | Exam pipeline | `dash5_exam_pipeline` | |
| 14 | Syllabus coverage drill | `dash5_syllabus_tree` | `dash_syllabus_coverage` |
| 15 | Attendance trend + by wing | `dash5_attendance_series` | `dash_attendance_trend` |
| 16 | Chronic absentees (window × threshold × streak) | `dash5_chronic_absentees` | |
| 17 | Needs your attention, by wing | `dash5_needs_by_wing` | `dash_get_flags` |
| 18 | Communication | | notices + PTM |

## 5. Decisions taken

* **"by SALCI AI" is the deterministic rule engine, not a model call.** Every
  bullet the reference shows is an observation about a number this page already
  holds. `dash_admin_digest` computes those in SQL: instant, free, explainable,
  and structurally unable to invent a statistic about a real child. The label
  stays as the reference has it; the implementation stays deterministic. Revisit
  only on an explicit instruction to spend model calls here.
* **Wing membership is active classes only.** `wing_class_mappings` outlives a
  section (Alliance: 113 classes, 53 active, 107 still mapped). Fixed for
  `dash_wing_performance` in `20260914120000`; every v5 RPC inherits the rule.
* **Subjects dedupe on `initcap(lower(btrim(name)))`.** `universal_subjects`
  carries one row per subject per grade (Alliance: 16 Punjabi, 13 English). Same
  fix, same migration, same rule here.
* **Distinct subjects and subject-class pairs are different numbers** and the
  reference prints both. A wing teaching English across 10 classes offers ONE
  subject and has TEN rows to staff. Never conflate them.
* **Chapter is the floor.** SALCI drills wing → class → subject → chapter and
  stops. No topic-level view.
* **A subject with no paper is excluded from average score, not counted as
  zero**, and the page says so. That exclusion is why a class can show 6 subjects
  and 3 papers.
* **Scale.** Every tree RPC aggregates in SQL and returns one level at a time;
  the client never fetches rows to count them (§23). One `staleTime: 60_000`
  query per card, `scope` in every key.

## 6. Phases

1. **DB — the tree.** `dash5_tree`, `dash5_subject_chapters`, composite/band
   helpers. Verified against Alliance before any UI.
2. **Shell + Overview.** Route, tabs, four cards, drill table + chapter drawer,
   insights, task suggestions, events.
3. **Students.** Adoption alert + drill, donut drill, score distribution, risk list.
4. **Teachers + Academics.** Activity, coordinators, perf bars, exam scatter,
   subject bars, pipeline, syllabus drill.
5. **Attendance + Needs + Communication.** Trend, by wing, chronic absentees,
   needs by wing, comms page.
6. **Drawers, actions, polish.** Every drawer panel, the assign flows, 375px,
   dark mode, the §5a gate and the Scale Gate.

## 7. The drawers (shipped 2026-09-17)

The reference draws SEVEN detail panels. They ship as FIVE, because a subject's
coverage, its roster and its assign panel are three views of the same
`(class, subject)` pair and belong in one drawer rather than three that each
have to be closed to reach the next.

| Drawer | Opened from | RPC |
|---|---|---|
| Assign | the Action column, at any of the three tree levels | `dash5_assign_context` |
| Subject (Coverage / Students / Assign) | a subject row in the tree | `dash5_subject_chapters`, `dash5_subject_roster`, `dash5_assign_context` |
| Paper | a dot on the exam scatter, or a row in the list under it | `dash5_paper_detail` |
| Never signed in | the adoption banner | `dash5_never_signed_in` |
| Student | an at-risk row, or a chronic absentee | `dash5_student_context` |

Rules these established:

* **One write path.** Every assign control on the page goes through
  `useDash5CreateTask` → `create_task_group`, the transactional RPC the Tasks
  page uses. Multi-assignee tasks are a fan-out (CLAUDE.md §11), so the assignee
  list goes to the RPC and is never written row by row from the client.
* **The owner FALLS BACK and says so.** `dash5_assign_context` resolves subject
  teacher → class teacher → wing coordinator → school admin, and returns
  `target.exact = false` when the person named is a stand-in. The drawer prints
  the difference rather than quietly assigning a subject task to a coordinator.
  Alliance's Primary wing has no coordinator at all, so this path is live, not
  theoretical.
* **Pace is the year elapsed, not 74%.** The reference hardcodes a 74% pace
  line. A school three weeks into the session is not behind for having covered a
  fifth of the book, so the suggestions measure against
  `(today - ay_start) / (ay_end - ay_start)`, the same figure
  `dash5_exam_pipeline` uses.
* **Suggestions are suppressed when the condition behind them is absent.** A
  wing that is on pace is not offered a catch-up task. An empty list renders as
  a sentence saying nothing is behind, never as a blank section.
* **Prod SQL must be plain ASCII.** `scripts/run-sql.ps1` goes through
  PowerShell 5.1, which mangles non-ASCII in a request body: a middot baked into
  a label reached the database as `Â·`. Labels are composed on the client.
* **Everything in a drawer is bounded.** The subject roster caps at 200 (hard
  ceiling 400), the never-signed-in list at 100 (ceiling 300), and each discloses
  its true total beside the count returned.

Each phase ships as its own commit with the gate run. The old page stays routed
until phase 5 lands, so `main` is never left with a half-built dashboard.

## 8. Element inventory (parity pass, 2026-09-17)

Phases 1 to 6 shipped every SECTION of the reference but not every element
inside them, and the difference was not visible from the section list. This is
the full inventory, so the next reader can check the page against it rather than
re-deriving it from a 3,700-line HTML file.

| Reference element | Component |
|---|---|
| `cards4` | `Dash5StatCards` |
| School performance drill + Action column | `Dash5Tree` |
| Insights, Task suggestions, Events | `InsightCards`, `Dash5TaskSuggestions`, `EventsCard` |
| `adoptAlert` | `Dash5AdoptionAlert` (opens the never-signed-in drawer) |
| Student adoption drill | `Dash5StudentTree` |
| `donutChart` + `donutBars` | `Dash5BandDonut` |
| `distChart` + `distWing` | `Dash5ScoreDistribution` |
| `riskBar` + `riskPanel` | `Dash5AtRisk` |
| `teacherActTbl`, `coordTbl` | `Dash5TeacherActivity`, `Dash5Coordinators` |
| `perfChart` | `Dash5ClassPerformance` (columns, not rows) |
| `examChart` + `exFrom`/`exTo` + `tvExam` | `Dash5ExamScatter` |
| `subjChart` + `subjNote` | `Dash5SubjectPerformance` |
| `pipeTarget` + `examPipe` | `Dash5ExamPipeline` |
| `sylSummary` + `sylBars` | `Dash5SyllabusCoverage` |
| `ovAttChart`, `wingAttBars` | `Dash5AttendanceTrend`, `Dash5AttendanceByWing` |
| `absPanel` + `absReset` | `Dash5ChronicAbsentees` |
| `needsWings` + hand-over | `Dash5NeedsByWing` |
| `ovNeeds` | `Dash5SchoolWideNeeds` |
| Circulars, PTM, `commBars` | `Dash5Communication` |
| The seven drawers | `Dash5Drawers` (five panels, see section 7) |

Two elements are deliberately NOT reproduced as drawn:

* **The reference's reach bars include push delivery and open rates.** SALCI has
  no outbound channel switched on (CLAUDE.md §11), so those would be invented
  numbers. `dash5_communication` returns `channels_live: false` and the card
  says why the rest is absent.
* **The reference's pace line is a hardcoded 74%.** Everywhere on this page pace
  is the share of the academic year elapsed, so a school three weeks into the
  session is not told it is behind.
