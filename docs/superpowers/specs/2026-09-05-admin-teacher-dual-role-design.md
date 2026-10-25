# Admin + Teacher dual role

**Date:** 2026-09-05
**Status:** Approved, ready for implementation planning
**Related:** CLAUDE.md §25 (teacher authority scope), §9a (destructive writes go through RPCs), §11 (dashboard scope), `.claude/skills/teacher-authority-scope` §3 (the dual-role scope trap)

## Goal

A school administrator can hold the `teacher` role on the same account and switch between an Admin view and a Teacher view, exactly the way an existing coordinator+teacher user switches today. The entry point is a third item in the `...` menu on Manage Administrators.

## Decisions taken

| Question | Decision |
|---|---|
| What does the toggle actually change? | A real scope switch. Teacher view shows only their own classes, subjects and students. |
| Is an admin+teacher counted as teaching staff elsewhere? | Yes, a teacher like any other. No exclusions from teacher counts, the substitute pool, PTM booking, notices, staff attendance, or the onboarding metric. |
| Where does the switcher live? | Same as coordinator+teacher: the Switch view row on Home, plus the existing per-page switcher on Exams. |
| Implementation shape? | Mirror the coordinator+teacher pattern site by site. No new shared `useEffectiveRole` abstraction. |

## Starting state (verified against prod and the working tree, 2026-09-05)

* Roles live only in `public.user_roles`. The sole unique key is `UNIQUE (user_id, role, institution_id)`. There are **no triggers** on the table and **no** `profiles.role` column.
* The repo migration `20260105065338` adds `user_roles_single_role_per_institution UNIQUE (user_id, institution_id)` under a comment claiming one role per user. **That constraint does not exist in prod** and nothing drops it. Do not reason from that file, and do not replay it: it would now fail against the 7 existing dual-role users.
* Prod holds 7 dual-role users, **all** of them coordinator+teacher. **Zero** hold `school_admin` + `teacher`. This is greenfield.
* `ViewRole` is `"teacher" | "coordinator"`, declared twice: `ActiveRoleContext.tsx:4` and `RoleSwitcher.tsx:4`.
* `hasDualRole` is `isTeacher && isCoordinator` (`ActiveRoleContext.tsx:20`); `hasDualTeacherCoordinatorRole` is the same test on `UserRoleInfo` (`useUserRole.ts:83`).
* `primaryRole` is a first-match against `["super_admin","super_school_admin","school_admin","coordinator","teacher","employee","student"]`, so an admin+teacher resolves to `school_admin` everywhere.
* `ProtectedRoute` gates with `allowedRoles.some(r => roleInfo.roles.includes(r))` against the **full roles array**. Route access therefore widens the instant the role row lands; no view toggle can ever close a route.

## Non-goal, stated explicitly

**The toggle cannot reduce what the admin is permitted to do.** Every server-side gate is an OR-union with the admin branch first (`user_can_grade_exam`, the homework insert policy, `can_edit_student_details`, `admin-operations`), and none accepts an acting-as parameter. Teacher view re-scopes what is *shown* and what the pickers *offer*. It is not a security boundary, and no UI copy may imply that it is.

## Design

### 1. Write path: one RPC, not a client probe-then-insert

Two new `SECURITY DEFINER SET search_path = public` functions.

```
grant_teacher_role(_user_id uuid, _pairs jsonb) returns jsonb
revoke_teacher_role(_user_id uuid) returns jsonb
```

`grant_teacher_role`:
1. Authority gate: `is_institution_admin(auth.uid(), <target institution>)` or `is_super_admin(auth.uid())`. Fails closed on `auth.uid() IS NULL`.
2. Resolves the target's institution from `profiles.institution_id` (the same source `is_institution_admin` uses, so the two cannot disagree).
3. `INSERT INTO user_roles (user_id, role, institution_id, granted_by) VALUES (..., 'teacher', ..., auth.uid()) ON CONFLICT (user_id, role, institution_id) DO NOTHING` — idempotent against the real unique key, no TOCTOU probe.
4. Delegates the class/subject rows to the existing `set_staff_class_assignments(_user_id, _pairs, 'teacher', NULL, 'subject')`, which already holds the advisory lock, writes `subject_class_group_mappings` so the fanout trigger maintains the dual-table invariant, and logs its own audit delta.
5. `log_audit_event` for the role grant itself.

`revoke_teacher_role` deletes only the `('teacher', institution)` row, then calls `set_staff_class_assignments` with empty pairs so the teaching assignments are removed in the same transaction and land in the `class_assignment_deletions` ledger. It refuses if the target holds no other role, so it can never orphan an account.

Both carry `REVOKE ALL ... FROM PUBLIC`, `REVOKE ALL ... FROM anon` **by name**, then `GRANT EXECUTE ... TO authenticated` (§26: Supabase default privileges grant `anon` EXECUTE, and `REVOKE FROM PUBLIC` does not strip it).

Why an RPC rather than copying `PromoteToCoordinatorDialog`: that dialog probes then inserts, omits `granted_by`, writes no audit row, and calls bare `supabase.auth.getUser()`. The grant plus the assignment rows are two dependent writes, and §9a requires one RPC.

### 2. UI: the third menu item

`ManageAdminsPage` gains **Add to teacher** between Edit designation and Remove admin, opening a dialog modelled on `PromoteToCoordinatorDialog` but collecting class + subject pairs through the same picker `AssignTeacherClassSubjectDialog` uses.

**At least one pair is required.** A `teacher` role row with zero `class_assignments` is inert: `teacher_controls_student` requires `subject_id IS NOT NULL`, so the account would have no students, no roster, no exams and an empty picker everywhere. Requiring a pair mirrors the coordinator dialog requiring a wing.

Rows for admins who also hold the teacher role render a Teacher badge, so an operator can see the account is dual before acting on it.

**Remove from teacher** appears on those rows, calling `revoke_teacher_role`.

### 3. Fixing "Remove admin" before it becomes destructive

`deleteAdminMutation` calls `admin-operations delete_user` → `auth.admin.deleteUser` → the full §21 cascade, while its own confirmation reads "They will lose all admin privileges but their account will remain active."

Change, with **zero behaviour change for any user who exists today**:

* Target holds only admin roles → unchanged, still deletes the account.
* Target also holds `teacher` or `coordinator` → revokes only the admin role row, and the confirmation says exactly that.

### 4. View switch, mirroring the existing pairing

* `useUserRole` gains `hasDualAdminTeacherRole: isSchoolAdmin && isTeacher`.
* `ViewRole` widens to `"admin" | "teacher" | "coordinator"` in **both** declaration sites.
* `ActiveRoleContext` exposes `hasDualRole` (either pairing) plus which pairing is active, and **validates the persisted value against the roles actually held** — a stale `"admin"` must never apply to a coordinator+teacher, and the current code applies any stored value to every user.
* Default: the coordinator pairing keeps defaulting to `"teacher"` (no change for the 7 live users); the admin pairing defaults to `"admin"`, so gaining the role never silently drops a principal into teacher view.
* `RoleSwitcher` renders Admin/Teacher or Teacher/Coordinator depending on the pairing, keeping the current visual.
* `RoleBasedDashboard.getEffectiveRole` and the switcher mount cover both pairings.
* `AppSidebar` gains `shouldShowAdminNav()` mirroring `shouldShowTeacherNav`/`shouldShowCoordinatorNav`, and the `if (roleInfo?.isSchoolAdmin)` block is gated on it. This also removes the duplicate React key that two nav groups both named "Work" would otherwise produce, and stops the sidebar being two portals stacked together.
* The five Shape-A sites (`SchoolClassesPage`, `SchoolStudentsPage`, `SchoolTeachersPage`, `SchoolSyllabusPage`, `useExamClassHierarchy`) and five Shape-B sites (`CommunicationPage`, `NoticeBoard`, `MessagesTab`, `MessagingPanel`, `useHomeworkScope`) each extend their **own existing idiom** to the second pairing.
* `SchoolSnapshotPage` routes to `ScopedSnapshotPage` when an admin is in teacher view; `ScopedSnapshotPage` derives its `DashboardScope` from the view role rather than raw booleans.
* `ExamsPage.canSwitchScope` currently excludes admins outright (`&& !isSchoolAdminView`); it extends to the new pairing.
* `AchievementsPage` resolves its badge ladder from the view role, so the onboarding journey panel that explains a badge lock actually renders. Without this the admin's badges silently stop with nothing on screen to explain why, because `useAutoBadgeAward` gates on holding a teacher role while `AchievementsPage` gates on `primaryRole`.

### 5. The one database scope change

The `dash_teacher_*` family derives its entire scope from `dash_resolve_scoped_pairs()`, an IF/ELSIF ladder that checks admin first and whose admin branch emits `subject_id = NULL` — which downstream predicates such as `(pr.sid IS NULL OR pr.sid = es.subject_id)` read as "every subject". An admin+teacher in teacher view would therefore see the whole school on a page whose own footer promises "only your own assigned classes".

New `dash_resolve_teacher_pairs()`: no ladder, just `class_assignments` for `auth.uid()` where `role = 'teacher'`, fail-closed on NULL `auth.uid()`. The `dash_teacher_*` family is repointed at it. Defensible independently of this feature: a function named `dash_teacher_*` must never return institution-wide rows.

`dash_resolve_scoped_pairs` and `dash_resolve_scoped_classes` keep their ladder; the admin and coordinator dashboards depend on it.

### 6. Correctness fixes this feature makes load-bearing

| Site | Defect |
|---|---|
| `AppSidebar` identity block | reads `profile.roles[0].role` from an unordered fetch, so the label under the user's own name flips between "School Admin" and "Teacher" across page loads |
| `AttendanceHistoryView:102` | `.maybeSingle()` on `user_roles` with no role filter returns `PGRST116` for any 2-role user; the error is destructured away and the person is silently labelled "Teacher". Already misfiring for the 7 live dual-role users. |
| `useWorkforceData:191` | hides Owners by filtering **role rows**, so a `super_school_admin` granted `teacher` becomes visible to every school_admin. Exclude by user, not by role row. |
| `ManageAdminsPage:73` | admins query never handles `error`, so an RLS failure renders "No administrators yet" over 0/0 stat tiles (§6: error state before empty state, and it must cover the tiles) |

## Testing

* Grant is idempotent: running it twice adds one role row and no duplicate assignments.
* Revoke removes the role row and the assignments, and refuses on a user with no other role.
* A stale `salci_dashboard_role_preference` of `"admin"` is discarded for a coordinator+teacher.
* An admin+teacher in teacher view sees only their own classes on Snapshot, Exams, Homework, Syllabus, Question Bank and My Students; in admin view sees institution-wide.
* The 7 existing coordinator+teacher users see no behaviour change anywhere.
* "Remove admin" on an admin-only target still deletes the account; on a dual-role target it revokes only the admin role.
* Zero-error contract (§5a): `npm run typecheck`, `npx eslint <changed>`, `npx vite build` all clean.

## Scale Gate

Every new query carries an explicit `staleTime`, no `select("*")`, list reads bounded with `.range()`, counts server-side, the grant mutation single-flight guarded and idempotent via `ON CONFLICT`, both new RPCs `SECURITY DEFINER` with `anon` revoked by name, and no new `refetchInterval`.
