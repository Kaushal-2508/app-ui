# Admin dashboard accuracy audit, 2026-10-05

> **REVERTED 2026-10-07 on Tushar's instruction.** He asked on 2026-10-05 to fix the dashboard's values only; this pass also rewrote copy and meanings across the page. Every function below is back to its pre-2026-10-05 body (migration `20261007150000_dash5_undo_accuracy_pass.sql`), the five helpers it added are dropped, and the page's code is back to before `dbd7231f`. One change was kept: `useProctoring.ts` no longer adds proctoring counts from the browser (the trigger counts each event once). The findings below are a record, not the live state.


Scope: `/school/command-center` (`CommandCenterV5Page`), all seven sections. Every displayed value was traced to its live prod function body (`pg_get_functiondef`), called as a real admin, and recounted independently from raw tables at Alliance International School (real data) and Salci National School (demo seed, the school in Tushar's screenshot). Read-only; nothing was written during the audit. Recount SQL lives in the 2026-10-05 session scratchpad (`audit/<section>/`).

Verdict counts are approximate (about 230 displayed values): at Alliance most raw counts reproduce exactly; the defects are shared root causes, wrong denominators and copy that states something false. Salci National is much worse because of R1 and R2.

Status column: `open` until fixed; update it when a fix ships (CLAUDE.md 27).

## Root causes (fix these, not the symptoms)

| # | Root cause | Where | Effect | Status |
|---|---|---|---|---|
| R1 | A class mapped into several wings is counted once per wing | `dash5_atom_rows` (`cls`/`prs`/`chapstate`), `dash5_tree.tot`, `dash5_exam_papers` (`k` multiplier), `dash5_exam_pipeline.a0`, `dash5_student_rows.base` (arbitrary wing), `dash5_needs_by_wing`, `dash5_chronic_absentees` | Salci National: 17 to 18 classes in 2 or 3 wings. Footer 305 students / 60 classes vs 252 / 42; coverage 5.4% shown vs 2.3% real (one subject 170%); "51 of 66" lessons is really 25 of 31; "114 papers" is 58; "8 of 9 appeared" shown as "18 of 9"; students split across wings arbitrarily. Alliance has none today. | fixed (160500 core/tree/report, 161000 students, 162000 teachers, 163000 academics); attendance 164000, needs 165000 |
| R2 | Results kept only when the exam's subject id equals the class's mapped subject id | `dash5_atom_rows.scores/papers/pend`, `dash5_teacher_activity.acc`, `dash5_assign_context` | `universal_subjects` has one row per grade. Alliance drops 499 Science results (Middle wing 58.9 shown vs 60.7; Urvashi Sharma 57.5% vs 67.2%). Salci National drops 2,016 of 2,065 results: "School average 48.9% across 114 papers" is really 62.2% on 2,053 results; Junior Wing's 62.5% rests on 8 results; Neuww and Science show "No papers yet" with 256 and 72 results. | fixed (160000 rule + 160500, 162000, 163000) |
| R3 | `auth.users.last_sign_in_at` used as activity | `dash5_teacher_activity.seen`, `dash5_student_rows.act7` | Teachers: "Last active" overstated for 75 of 90 at Alliance; 41 shown "Minimal" vs 21 real; 30 engagement labels wrong. Students: portal adoption 26.5% shown vs 35.7% real (141 active students shown inactive). "Never signed in" counts are correct (verified 0 false positives). | fixed: teachers 162000, students 161000, digest 166000 |
| R4 | Unpublished results inside every average, while copy says they are excluded | `dash5_atom_rows.scores`, `dash5_student_rows.sc`, `dash5_subject_roster`; copy in `dash5_assign_context`, `dash5_school_wide_needs`, PaperDrawer | 3,001 unpublished Alliance results counted (61.2% vs 62.2% published-only; 137 students change band). Decision needed: include (fix copy) or exclude. | fixed, decision: published only (160000, all sections) |
| R5 | "Lessons taught / covered" counts `tt_lesson_plans.status='done'` claims, all dates | `dash5_atom_rows.lessons` | Alliance "2,326 of 4,001 planned": 304 rows are future-dated, only 738 were planned ahead, 329 "done" rows have no syllabus record that day. Evidence-based: 1,997 of 3,697 due to date. `tt_lesson_plans.planned_at` is stamped on every row, so "planned" cannot be measured. | fixed (160500): lessons due to date, taught = syllabus log that day |
| R6 | Performance band composite scores missing inputs as 0 and measures coverage against 100% mid-year | `dash5_composite`, `dash5_band` | Every wing and 52 of 53 Alliance classes read "Attention"; 44 of 53 cannot reach Excellent even at 100/100/100; empty classes and an empty wing show "Attention". Decision needed on the new rule. | fixed, decision: fair composite (160000 + 160500, 162000) |
| R7 | Stat-card denominators | `dash_admin_roster_counts` + `Dash5StatCards` | Students present divides by the whole roll: "426 not present" vs 132 real (294 are in 10 unmarked sections). Teachers present counts all staff incl. admins: 74/97 vs 74/90 teachers; Salci Nat 0/58 vs 0/52. | fixed (160500 + Dash5StatCards) |
| R8 | "Papers"/"held" means status published, not sat; publish date used as the exam date | `dash5_atom_rows.papers`, `dash5_exam_pipeline`, `dash5_exam_papers`, `dash5_paper_detail` | 1,827 "papers" = exam x section pairs; 685 have no marks. Pipeline "Held, results out 1,717" vs 1,032; "On the calendar" can only ever be 0 (statuses ready/active never used). 277 papers plotted more than 3 days after they were sat. | fixed for tree/scatter (160500, 163000); pipeline 165000 |
| R9 | Papers conducted / homework set attributed by teacher, not by the row's classes | `dash5_tree_targets` | Junior Wing "0 published" although 9 papers were set (by the admin); Alliance Middle 643 shown vs 351 set to its classes; a teacher's whole output repeats in every row. "41 / 0" reads as 41 of 0 (no target). | fixed (160500 dash5_tree_targets + TargetCell) |
| R10 | Teacher engagement label rules | `dash5_teacher_activity.level` | "fewer than 2 papers" forces Minimal (teachers with 49 homework and daily attendance read Minimal); Strong needs 45 homework all-time. Decision needed. | fixed, decision: work-based + info button (162000) |
| R11 | Attendance day set and denominator | `dash5_attendance_series`, `dash5_chronic_absentees` | Any date with one register row is a "school day" (Sunday 1.6% shown where 100% of those marked were present); a weekday with no register vanishes; students divided by the whole roll; "in today" shown for students not marked today; leave counted as an absence streak. | fixed (164000): school days, present of those registered, honest in-today |
| R12 | Task suggestions and assignees | `dash5_task_suggestions` (pace hard-coded 74), `resolve_flag_assignee` (no role check, arbitrary admin, dormant "..." account) | "Bring N classes back to the 74% pace line" (real pace 51.4%); tasks routed to plain teachers as wing owners; approved suggestions re-offered. | fixed (165000): year pace, coordinator-only owners, active admins by name |
| R13 | Proctoring high-severity events counted twice | trigger `update_proctoring_session_metrics` plus `useProctoring.ts:330-335` | 40,330 shown vs 20,275 logged. Review page has no route, so 1,604 sessions can never be cleared. | client double count removed (useProctoring.ts); dashboard counts events (165000) |
| R14 | Coordinator-card tasks read `tasks.wing_id`, which nothing writes | `dash5_coordinators.tsk` | "Tasks closed" and "Overdue" always empty; Alliance has 32 overdue coordinator tasks. | fixed (162000) |
| R15 | Subject performance averages | `dash_school_subject_performance`, `dash_subject_performance` | Absent students counted as 0% (Punjabi 53.7 vs 64.6); no year window in the class view; "Maths"/"Mathematics" split; class view mixes two sources (16.2% vs 22.8% for the same subject). | fixed (163000) |
| R16 | Homework submission % credits submissions from other classes and drafts | `dash5_atom_rows.hw` | 1,372 of 2,826 credited submissions belong to other classes. Online submission only (paper homework is marked without a submission). | fixed (160500) |
| R17 | Wing membership by "first wing" | `dash5_teacher_activity.scope`, `dash5_coordinators.quiet` | Wing filter shows 13 of a wing's 25 teachers (also on the Coordinator Console). | fixed (162000) |

## Smaller defects (each one line)

- Roll numbers always blank: `dash5_student_rows` returns `NULL::text`; `profiles.roll_number` is filled for 1,395 of 1,545 Alliance students. (DB)
- Tree subject row hard-codes ", 1 partly done" (Dash5Tree.tsx:181). (UI)
- Band cuts disagree: PaperDrawer `bandOf` and the subject chart use 82/74/66; `dash5_band` uses 84/75.5/66. (UI)
- Band donut level-3 footer always says 100% (divides by an already-filtered total). Donut footer says bands are a composite; they are marks only. (UI)
- Students "sat n / N" counts absent-only attempts and students no longer in the class (Math 27/26). (DB)
- "Test submission" counts papers marked absent as sat. (DB)
- Pass rate fixed at 35%; 602 papers set their own pass mark. (DB or label)
- At-risk "under half the homework in" chip shown on 793 of 793 rows although that rule flagged nobody. (DB)
- Subjects with no syllabus drawn as 0% coverage and sorted "worst". (UI)
- Empty wing drawn as a red 0% bar; empty wing listed with "0 items". (UI)
- "Message parents" link opens a drawer that cannot send. (UI)
- "Task suggestions by SALCI AI" heading vs "not generated by a model" footer. (UI)
- Communication chips render nothing on a failed load (CLAUDE.md 6). (UI)
- "Classes averaging below 70%: sustained across more than one cycle" (no multi-cycle test exists); "Board eligibility risk" shown for Pre Nursery. (copy)
- `dash_current_academic_year` uses UTC `CURRENT_DATE` (CLAUDE.md 24; matters only around 1 April). (DB)
- Pending papers counted per class-subject pair (110 / 37) where the unit is papers (103 / 36). (DB)

## Data questions found, not code bugs

- 2,759 Alliance results (11%) are exactly 0%, 2,466 from marks-only uploads and 1,003 in optional subjects; 105 papers have more than 30% exact zeros. They look like non-takers or marks never entered. Leaving exact zeros out would move the school average from 61.5% to 69.1%.
- 463 non-absent `offline_student_marks` rows on published Alliance exams have no `final_results` row, and hybrid-plane attempts never produce `final_results`: both are missing from every average.
- Salci National's multi-wing class mappings (R1) look like seed mess; whether a class may belong to two wings at all is a product decision.


## Fix log, 2026-10-05

Migrations (all under supabase/migrations/): 20261005160000 counting rules (dash5_counted_results, dash5_year_pace, 5-arg dash5_composite, dash5_band_or_null), 160500 core (atom, tree, tree targets, roster counts, subject chapters), 160700 report core, 161000 students, 162000 teachers, 163000 academics, 166000 insights digest + events: APPLIED. 164000 attendance and 165000 needs/communication: their prod apply was refused by the permission system for subagents; applied by the coordinator after the owner's explicit go-ahead, re-tested first. All 10 APPLIED.

Smaller defects: roll numbers, '1 partly done', band cuts, donut footers, students sat, test submission, homework chip, no-syllabus rows, empty wing, 'Message parents', 'SALCI AI' headings, communication error chip: fixed in the same migrations and UI. The insights digest weakest-class card was also wrong (27.5% shown, 32.8% real at Alliance) and the 'Insights by SALCI AI' heading named a model that does not exist.

Open after this pass: approved suggestions re-offered (needs a rule code on tasks); proctoring review page has no route (deliberately NOT routed: it is read-only and lacks error states; reviews happen per student in the evaluation workspace; a bulk 'clear old flags on published papers' action needs the owner's yes); optional-subject zeros (see Data questions; the blank-paper rule only removes papers where EVERY result is 0); wing coverage leaves out classes with no students (deliberate); the at-risk 72% vs 75% floor mismatch.
