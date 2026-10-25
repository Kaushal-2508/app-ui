---
name: teacher-authority-scope
description: Who a teacher or coordinator may see and act on — teacher_controls_student() as the canonical predicate, subject-scoped rosters, the optional-choice dormancy gate, the dual-role (teacher+coordinator) scope trap, and the error-masking defect class that makes a failed query read as "zero students". Use when touching any teacher or coordinator surface, teacher_roster_student_ids, teacher_controls_student, can_edit_student_details, optional_choices_recorded, student_visible_subject_ids, student_blocked_subject_ids, dash_teacher_* RPCs, TeacherStudentsPage, ExamsPage scope gates, ActiveRoleContext/useActiveRole, or any isTeacher/isCoordinator branch.
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# Teacher & Coordinator Authority Scope

Three separate hazards live here and they interact. Read all three before changing any teacher-visible surface.

Migrations: `20260826150000_teacher_subject_scoped_control.sql`, `20260826120000_subject_aware_teacher_roster.sql`, `20260825150000_optional_dormant_until_chosen.sql`, `20260826140000_revoke_teacher_optional_choice_edits.sql`. Audits: [docs/teacher-portal-audit-2026-08-18.md](../../../docs/teacher-portal-audit-2026-08-18.md), `docs/teacher-snapshot-rebuild-audit-2026-08-18.md`.

## 1. Teacher authority is SUBJECT-scoped (policy, 2026-08-26)

A teacher's authority extends **exactly to the students taking that teacher's subject(s)**, per `(class, subject)` assignment row.

```
teacher_controls_student(_teacher, _student)   -- THE canonical predicate
```

**Compose this predicate. Never test `class_assignments` directly — class-sharing is NOT authority any more.**

Three explicit rulings from that policy decision:
* **Subject-less ("class teacher" / pastoral) assignment rows grant NO student access at all.** 9 teachers platform-wide held only such rows and now see empty student surfaces until given subject rows. This is intended: a blank roster for a pastoral-only teacher is correct, not a bug.
* **Student-details editing narrows the same way** (roll number, name, guardian info) via `can_edit_student_details`.
* **Teacher dashboard cards narrow too**, including the previously-deliberate whole-class "pastoral" rosters (adoption / laggards / attention).

**THE EXCEPTIONS: attendance and PTMs.** Marking and viewing class attendance stays **whole-class**. No attendance surface reads these helpers, and the attendance parts of `dash_teacher_kpi_summary` are deliberately left class-based. Do not "fix" that inconsistency.

**PTMs are whole-section too** (Tushar, 2026-09-29, migration `20260929170000_ptm_teacher_scope.sql`). A PTM is about the whole child, not one subject, so the PTM rules read `is_class_teacher_of(_user, _class)`: ANY `class_assignments` teacher row on the class, **with or without a subject**, plus the teacher role and an active profile. That one helper feeds `ptm_classes_for_hat` (scope picker, create, dashboard, feedback list), `can_manage_ptm`, `can_view_ptm_feedback` (booking-grid names, attendance ticks, the `ptm_feedback_select` policy, voice-note reads) and `cancel_ptm_booking`. So every teacher of a section sees that section's family feedback and voice notes, on purpose. `teacher_controls_student` and the optional-choice gate do not apply here. Two rules: (1) despite its name the helper is PTM-only and means "teaches this class", never reuse it for marks, homework or student details, which stay subject-scoped; (2) this is the one place a subject-less row still grants something, so the bullet above about pastoral rows is about student data, not PTMs. Proven by section 10 of `scripts/test-ptm.sql` (a real teacher with only a subject row).

`teacher_controls_student` is TRUE when either:
1. the teacher holds a `class_assignments` row with `role='teacher'` AND `subject_id IS NOT NULL` on a class the student is in, and the subject passes the dormancy test in §2; or
2. legacy optional-batch teaching: the student is in an `optional_batches` row whose `teacher_id` is the teacher.

`teacher_roster_student_ids(_teacher, _class_ids)` is the set-returning companion (feeds `TeacherStudentsPage` and every `dash_teacher_*` roster). Two things in it are load-bearing:
* **The caller guard must fail CLOSED on `auth.uid() IS NULL`.** It used to fall through, because `NULL <> _teacher` is NULL and `IF NULL` skips the block. It is now an explicit empty return. Any similar guard you write needs the same explicit NULL branch.
* Only the teacher themselves, a super admin, a school admin / super_school_admin, or a coordinator may query it.

Related helpers narrowing the student side: `student_visible_subject_ids`, `student_blocked_subject_ids`, `can_view_student_optional_choices`. Teachers **cannot** change a student's optional subjects (revoked 2026-08-26).

## 2. Optional narrowing is DORMANT until a section records choices

**An optional subject narrows nothing until the school has actually recorded at least one active choice for that `(subject, section)`.** Until then it behaves as compulsory: whole class, fully visible. The moment real choices land, enrolled-only narrowing switches on for that section automatically.

The switch is `optional_choices_recorded(_subject, _class)` and **every** optional filter must be gated behind it.

Why this exists — the Alliance incident, 2026-08-25. AIS flagged subjects optional in May but never recorded a single senior-class choice, and all three narrowing helpers **failed CLOSED on missing data**:
* `teacher_roster_student_ids`: optional → enrolled-only → **0 students** (6 teachers, up to 12 classes each)
* `student_blocked_subject_ids`: optional + unenrolled → blocked, which hid exams and homework and made `trg_enforce_exam_subject_enrollment` refuse attempt starts (**3,827 live student-subject blocks**)
* `student_visible_subject_ids`: optional + unenrolled → absent

**`student_optional_enrollments.class_id` is NULL on every real row** — the optional-groups writer never populates it. So "has this section recorded choices?" must join through `class_assignments`. **Never key on `soe.class_id`.**

The canonical three-branch shape, reproduced identically in `teacher_controls_student` and `teacher_roster_student_ids` — keep them in sync:

```sql
AND (
  scm.is_optional IS NOT TRUE                                  -- compulsory / unmapped -> whole class
  OR NOT public.optional_choices_recorded(ca_t.subject_id, ca_t.class_id)  -- optional but dormant -> whole class
  OR EXISTS (SELECT 1 FROM public.student_optional_enrollments soe          -- optional + in use -> enrolled only
             WHERE soe.student_id = _student
               AND soe.subject_id = ca_t.subject_id
               AND soe.is_active = true)
)
```

See the `optional-subjects` skill for the enrollment model itself.

## 3. The dual-role scope trap (teacher + coordinator, and admin + teacher)

**The role scopes stay STRICTLY separate. Never union the lists.** A teacher does not see colleagues' data merely because she also coordinates, and an admin in teacher view sees only what she teaches.

Scope must be a **strict switch on `activeViewRole`** from `useActiveRole()` / `ActiveRoleContext`:

```ts
const { activeViewRole, hasDualRole, viewRoles } = useActiveRole();
// admin view       -> the whole institution
// teacher view     -> own subject students / own exams
// coordinator view -> the wing
```

**`ViewRole` has THREE values since 2026-09-05: `"admin" | "teacher" | "coordinator"`.** It is declared once, in `ActiveRoleContext.tsx`; `RoleSwitcher.tsx` re-exports it rather than declaring its own copy (it used to, and the two could drift).

* `viewRoles` is the list this account may choose between, derived from the roles held. `"admin"` is offered **only** to a school admin who ALSO holds `teacher`, so a plain admin, and an admin+coordinator, are untouched. `hasDualRole` is simply `viewRoles.length > 1`.
* **The default is `viewRoles[0]`**, which yields `"teacher"` for a teacher+coordinator (unchanged) and `"admin"` for an admin+teacher, so gaining the teacher role never silently drops a principal into teacher view.
* The persisted `salci_dashboard_role_preference` is **validated against `viewRoles`** before it is applied. It used to be applied to every user regardless of the roles they held.
* `AppSidebar` gates the admin nav block on `shouldShowAdminNav()`, mirroring the two existing helpers. Without that an admin+teacher gets the admin groups AND the teacher groups stacked, including two groups both named "Work" that collide on `key={group.group}` and on the persisted open-groups list.

**The toggle is presentation-only. It cannot reduce authority.** Every server-side gate is an OR-union with the admin branch first (`can_edit_student_details`, `user_can_grade_exam`, the homework insert policy, `admin-operations`), and none takes an acting-as parameter. Never write UI copy implying teacher view limits what an admin may do.

The grant and revoke path is `grant_teacher_role(_user_id, _pairs)` / `revoke_teacher_role(_user_id)` (`src/lib/staffAssignments.ts`), reached from the Manage Administrators `...` menu. The grant **requires at least one class+subject pair**: a `teacher` role row with no `class_assignments` is inert, because `teacher_controls_student` requires `subject_id IS NOT NULL`. "Remove admin" on a user who also teaches revokes only the admin role row; on an admin-only user it still deletes the account, as it always did.

`dash_teacher_*` RPCs resolve scope through `dash_resolve_teacher_pairs()`, **not** `dash_resolve_scoped_pairs()`. The latter is an admin-first ladder whose admin branch emits `subject_id = NULL`, which downstream predicates read as "every subject", so an admin+teacher would see the whole school on the teacher snapshot.

**Never gate on `isCoordinator && !isTeacher && !isSchoolAdmin`** or any other `isXOnly` boolean. That shape is false for every dual-role user and silently drops them into the narrower branch. `ExamsPage` carried exactly that gate from 2026-01-21 (eight days before `ActiveRoleContext` landed) until 2026-09-02: all three Alliance coordinators hold both roles, so all three got the teacher query while the page still read "My Exams" — one of them saw **35 exams out of the 356 in her wing** (fix `2697332`). Other dual-role surfaces were migrated to the switcher one by one; check for stragglers before adding a new gate.

Two more facts about adopting `activeViewRole`:
* **It defaults to `viewRoles[0]`** (`"teacher"` for teacher+coordinator, `"admin"` for admin+teacher). Since 2026-09-09 the compact `RoleSwitcher` sits in the app bar (`AppLayout`) for every dual-role user on every page, so a surface may read `activeViewRole` without mounting its own switcher.
* **The app-bar chip is a real switcher now** (it was an inert `roleInfo.primaryRole` label until 2026-09-09; single-role users still see the label). Page-local switchers (the `ScopeSwitcher` in `ExamsPage`, the old dashboard strip) duplicate the same context: remove them rather than add more.

Coordinators themselves are wing-scoped (`wing_assignments` × `wing_class_mappings`, helper `is_coordinator_for_class`) — and `is_coordinator_for_class` checks neither the `coordinator` role nor the institution, so compose it with explicit `has_role` and institution guards.

The one place a union IS correct: `can_set_user_photo` (see `profile-photos` skill), because setting a photo is the same act under either hat.

## 4. Error masking — "the teacher sees zero" is usually a broken query

73 teacher surfaces were swept on 2026-08-26; 5 were broken. The dominant defect, and the thing to check first on any "teacher sees no data" report:

> **A failed query resolving as zero rows.** Never write `const { data } = useQuery(...)` without handling `error`.

Rules that came out of that sweep:
* **Render the error state BEFORE the empty state** (CLAUDE.md §6), and **the error state must cover the stat tiles and header, not just the list** — a broken query that only guards the list still shows "0 students" in the tiles.
* Distinguish "the query failed" from "this filter matched nothing" from "this section is genuinely empty" in the copy. One 2026-08-26 report turned out to be a filter on a genuinely empty section (fix `5ce701f`).
* An empty result where rows are expected is usually RLS — check `institution_id` context and whether a DEFINER helper fell through on NULL `auth.uid()` (§1).
* Before concluding "the roster filter is wrong", check whether the teacher holds only subject-less assignment rows (§1) or whether an optional dormancy gate is missing (§2). Both produce a legitimately-empty roster for different reasons.

## 5. Teacher dashboards

Teacher scope on `/school/snapshot` is its **own** `DashboardScope` value `"teacher"`, backed by a `dash_teacher_*` RPC family (prod 2026-08-18) — separate from `dash_*` (admin) and `dash_scoped_*` (coordinator). **Never branch on `scope === "scoped"` for a teacher**, or teachers fall through to institution-wide figures. Full dashboard invariants: `command-center-dashboards` skill.

## 6. Grants

Every helper here is `SECURITY DEFINER SET search_path = public` and carries `REVOKE ALL ... FROM PUBLIC` **and** `REVOKE ALL ... FROM anon` by name, then `GRANT EXECUTE ... TO authenticated`. `anon` held EXECUTE on all of these via Supabase's default privileges until 2026-08-25; `REVOKE FROM PUBLIC` does not remove it. See `prod-operations` skill.
