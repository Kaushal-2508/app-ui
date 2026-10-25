# Teacher Portal — Baseline Audit (2026-08-18)

Recon only. No code changed. Purpose: give the teacher-portal overhaul a factual
starting map — what a teacher can actually reach, what is duplicated, what is
dead, and where the gating holes are.

## 1. What a teacher actually sees

Two independent navigation surfaces, hand-maintained, and they **disagree**.

### A. Sidebar — `src/components/layout/AppSidebar.tsx` (`shouldShowTeacherNav()`, ~line 648)

| Group | Items |
|---|---|
| Curriculum | Syllabus `/school/syllabus` · Question Bank `/question-bank` · Olympiad `/teacher/olympiad` |
| Exams | My Exams `/exams` · Create Exam `/exams/create` · Homework and Assignment `/homework` |
| Academics | Timetable `/teacher/my-week` · My Students `/teacher/students` · Attendance `/school/attendance` · Communication `/school/communication` · Achievements `/achievements` |
| School Management | conditional per-user override grants (timetable / staff / student manager) |
| Work | Academic Calendar `/school/calendar` · My Leaves `/staff/my-leaves` · My Salary `/staff/my-salary` · Tasks `/tasks` · Reports `/reports` · Leaderboard `/leaderboard` |

### B. Dashboard tiles — `teacherNavGroups` in `src/components/dashboards/RoleBasedDashboard.tsx` (~line 96), rendered via `NavigationHub`

| Group | Items |
|---|---|
| Exams | Snapshot `/school/snapshot` · My Exams · Create Exam · Homework |
| Work | My Students · Syllabus · Question Bank · Attendance · Tasks · Communication · Reports |
| Growth | Achievements · Leaderboard |

### Divergences (both lists are hand-written, nothing keeps them in sync)

- **Snapshot** `/school/snapshot` — on the dashboard, **missing from the sidebar**.
- **Timetable** `/teacher/my-week` — in the sidebar, **missing from the dashboard**.
- **Olympiad**, **Academic Calendar**, **My Leaves**, **My Salary** — sidebar only.
- Group taxonomy differs (Curriculum/Academics/Work vs Exams/Work/Growth); the same
  item lands under a different heading depending on which surface you came from.

## 2. Routes a teacher can reach with no nav entry anywhere

Reachable by URL (allowed by `ProtectedRoute`), linked from neither surface:

| Route | Renders | Note |
|---|---|---|
| `/analytics` | `AnalyticsPage` → `TeacherAnalyticsDashboard` | A whole teacher analytics surface with **zero entry points** |
| `/performance` | `AnalyticsPage` (identical) | **Duplicate route**, same component, same props |
| `/evaluations/hybrid` | `HybridEvaluationListPage` | Hybrid marking queue, unlinked for teachers |
| `/proctoring/live` | Live proctoring | Unlinked; also ungated by the `proctoring` feature |
| `/appointments` | PTM | Unlinked from teacher nav |
| `/school/student/:studentId` | Student detail | Deep-link only |
| `/school/attendance/user/:userId` | Staff attendance detail | Deep-link only |

Result: teachers have **two competing analytics/report surfaces**
(`Reports` → `ComprehensiveTeacherDashboard`, and the unreachable
`/analytics` → `TeacherAnalyticsDashboard`).

## 3. Dead code

| File | Lines | Status |
|---|---|---|
| `src/components/dashboards/EnhancedTeacherDashboard.tsx` | 554 | **Zero importers** — fully dead |
| `src/components/dashboards/TeacherDashboard.tsx` | 163 | **Zero importers** — dead (already flagged in CLAUDE.md §11) |

`ComprehensiveTeacherDashboard.tsx` (641 lines) is alive — but only as the
"Teacher Overview" tab inside `ReportsPage`, not as a dashboard.

## 4. Feature-gating holes (`FEATURE_URL_MAP`, `featuresData.ts`)

An unmapped URL is treated as **always visible**. Missing entries on teacher surfaces:

| Unmapped URL | Should map to |
|---|---|
| `/exams` (My Exams) | `exams` — only `/school/exams` + `/exams/create` are mapped |
| `/reports` | `reports` |
| `/analytics`, `/performance` | `reports` |
| `/school/snapshot` | `dashboard` / `reports` |
| `/evaluations/hybrid` | `evaluations` |
| `/proctoring/live` | `proctoring` |
| `/achievements`, `/leaderboard` | (no feature exists for gamification) |

So a school with `exams` switched off still shows a teacher "My Exams" tab.

## 5. Scale-gate observations (CLAUDE.md §23 / enterprise-code-quality)

| File | Finding |
|---|---|
| `TeacherStudentsPage.tsx` | 2 `useQuery`, **no `staleTime`**, **no `.range()`** on the roster fetch (`class_assignments` → `profiles.in(studentIds)`) |
| `useTeacherDashboard.ts` | 2 `useQuery`, **no `staleTime`**, 3 × `select("*")`, no pagination |
| `useTeacherClasses.ts` | 3 `useQuery`, **no `staleTime`**; `useSubjectsForClasses` uses `(mapping: any)` (hard lint error in this repo) ; `useGradeLevelFromClass` matches grade by fuzzy substring on class name |
| `useComprehensiveTeacherAnalytics.ts` | **no `staleTime`**, 3 × `select("*")` |
| `useTeacherAssignedSubjects.ts` | has `staleTime` — the one compliant hook |

## 6. Owned teacher pages (the real surface area)

`src/pages/teacher/` holds only 5 pages + olympiad:
`TeacherStudentsPage` (360) · `TeacherMyWeekPageV2` (623) · `HybridEvaluatePage` ·
`HybridEvaluationListPage` · `ScanSheetsPage` (admin-only route).

Everything else a teacher does runs on **shared `/exams`, `/homework`, `/school/*`
pages built for admins**, role-branched inside the component. There is no
`src/components/teacher/` directory at all.

## 7. Candidate work items (not yet decided)

1. **One source of truth for teacher nav** — derive sidebar + dashboard tiles from a
   single declarative list so they cannot drift.
2. **Kill duplicates** — `/performance` vs `/analytics`; `Reports` vs `Analytics`
   teacher surfaces; pick one.
3. **Delete dead dashboards** — `EnhancedTeacherDashboard`, `TeacherDashboard`.
4. **Close gating holes** — complete `FEATURE_URL_MAP` for teacher URLs.
5. **Surface or remove orphan routes** — hybrid evaluation queue, proctoring, PTM.
6. **Scale-gate pass** on the teacher hooks above (staleTime, pagination, no `select("*")`, the `any`).
7. **Decide what a teacher's home actually is** — today `/dashboard` is a link grid
   (`NavigationHub`), not a working surface. Today's classes, pending marking, due
   homework, and unplanned lessons all exist but live behind separate taps.
