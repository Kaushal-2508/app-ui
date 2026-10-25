# Admin + Teacher Dual Role Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A school administrator can hold the `teacher` role on the same account and switch between Admin and Teacher views, exactly the way an existing coordinator+teacher user switches today.

**Architecture:** Mirror the existing coordinator+teacher mechanism rather than introducing a shared abstraction. `ViewRole` widens from two values to three, `ActiveRoleContext` derives the list of view roles a user may choose from, and each of the ten existing dual-role sites extends its own idiom. One new pair of `SECURITY DEFINER` RPCs backs the grant and revoke; one new resolver fixes the teacher dashboard scope.

**Tech Stack:** React 18 + TypeScript + Vite, TanStack Query v5, shadcn/ui, Supabase (Postgres + RLS), PowerShell for prod SQL via `scripts/run-sql.ps1`.

**Spec:** `docs/superpowers/specs/2026-09-05-admin-teacher-dual-role-design.md`

## Global Constraints

- **There is no test framework in this repo.** `package.json` has no vitest/jest/testing-library. Every task's verification is `npm run typecheck`, `npx eslint <changed paths>`, `npx vite build`, plus the named manual checks. Do not scaffold a test runner.
- **Zero-error contract (CLAUDE.md §5a):** `npm run typecheck` (never bare `npx tsc --noEmit`, it is a no-op), `npx eslint <changed-paths>` with zero errors, `npx vite build` exit code 0. Bundle-size warnings are not failures.
- `prefer-const` and `@typescript-eslint/no-explicit-any` are HARD errors. Never suppress with `eslint-disable` or `as any`.
- **No em-dashes (`—`) in user-facing text.** Labels, toasts, empty states, dialog copy. Use "N/A", a comma, a colon, `·`, or "to".
- shadcn/ui components only. No raw HTML buttons or inputs. Colors from CSS variables. Spacing on Tailwind's 4/8/12/16/24 scale. No inline styles. Works at 375px. Dark mode flips.
- **`DialogContent` auto-wraps children in a ScrollArea** (project fork). Never add `max-h-*`, `flex`, `overflow-*` or `h-full` to `DialogContent`, the inner `<form>`, `DialogHeader` or `DialogFooter`. Only `sm:max-w-[...]` for width.
- **All error toasts go through `toastError(err, { fallback, context })`** from `src/lib/toast.ts`. Never `toast.error(error.message)`. `toast.success` only for success.
- **Error state renders BEFORE the empty state**, and must cover stat tiles and headers, not just the list.
- **New SECURITY DEFINER functions:** `SET search_path = public`, then `REVOKE ALL ... FROM PUBLIC`, `REVOKE ALL ... FROM anon` **by name**, then `GRANT EXECUTE ... TO authenticated`.
- **Prod SQL goes through `scripts/run-sql.ps1`** (Management API). `supabase_migrations.schema_migrations` is NOT maintained; verify against `pg_proc` / `information_schema` / `pg_indexes`, never the ledger.
- **Never replay `supabase/migrations/20260105065338_baf66628-46c8-4567-a9b8-216caf390cb2.sql`.** It adds `UNIQUE (user_id, institution_id)` to `user_roles`, that constraint does not exist in prod, and replaying it would fail against the 7 existing dual-role users.
- Commit after each task. Do not push unless asked.

## File Structure

**Created:**
- `supabase/migrations/20260906120000_admin_teacher_role_grant_rpcs.sql` — `grant_teacher_role` + `revoke_teacher_role`
- `supabase/migrations/20260906130000_dash_resolve_teacher_pairs.sql` — ladder-free teacher scope resolver + repointed `dash_teacher_*`
- `src/components/school/GrantTeacherRoleDialog.tsx` — the "Add to teacher" dialog

**Modified (core mechanism):** `src/hooks/useUserRole.ts`, `src/contexts/ActiveRoleContext.tsx`, `src/components/dashboards/RoleSwitcher.tsx`, `src/components/dashboards/RoleBasedDashboard.tsx`, `src/components/layout/AppSidebar.tsx`

**Modified (Shape-A, effectiveRole ternary):** `src/pages/school/SchoolClassesPage.tsx`, `src/pages/school/SchoolStudentsPage.tsx`, `src/pages/school/SchoolTeachersPage.tsx`, `src/pages/school/SchoolSyllabusPage.tsx`, `src/hooks/useExamClassHierarchy.ts`

**Modified (Shape-B, isDualRole ternary):** `src/pages/school/CommunicationPage.tsx`, `src/components/notices/NoticeBoard.tsx`, `src/components/communication/MessagesTab.tsx`, `src/components/communication/MessagingPanel.tsx`, `src/hooks/useHomeworkScope.ts`

**Modified (surfaces):** `src/pages/ExamsPage.tsx`, `src/pages/school/SchoolSnapshotPage.tsx`, `src/pages/school/ScopedSnapshotPage.tsx`, `src/pages/school/ManageAdminsPage.tsx`, `src/pages/AchievementsPage.tsx`

**Modified (correctness fixes):** `src/components/attendance/AttendanceHistoryView.tsx`, `src/hooks/useWorkforceData.ts`

---

### Task 1: Grant and revoke RPCs

**Files:**
- Create: `supabase/migrations/20260906120000_admin_teacher_role_grant_rpcs.sql`

**Interfaces:**
- Produces: `public.grant_teacher_role(_user_id uuid, _pairs jsonb) returns jsonb` and `public.revoke_teacher_role(_user_id uuid) returns jsonb`. Both return `{ granted: bool, added_count: int, removed_count: int }`.
- Consumes: existing `public.set_staff_class_assignments(_user_id uuid, _pairs jsonb, _role app_role, _scope_class_ids uuid[], _kind text) returns jsonb`, `public.is_institution_admin(_user_id uuid, _institution_id uuid)`, `public.is_super_admin(user_id uuid)`, `public.log_audit_event(...)`.

- [ ] **Step 1: Read the two functions this migration depends on**

Run and read, so the call signature and the audit-event signature are copied exactly rather than guessed:

```bash
sed -n '1,220p' "supabase/migrations/20260807120000_set_staff_class_assignments_rpc.sql"
```

Confirm the exact parameter order of `set_staff_class_assignments` and the exact signature of `log_audit_event` as called at the end of that function. Use those verbatim below.

- [ ] **Step 2: Write the migration**

```sql
-- Admin + Teacher dual role: grant and revoke the teacher role on an existing
-- account, in one transaction, with attribution and an audit trail.
--
-- Why an RPC and not the PromoteToCoordinatorDialog shape: that dialog probes
-- then inserts (a TOCTOU race against UNIQUE(user_id, role, institution_id)),
-- omits granted_by, and writes no audit row. The grant plus the class/subject
-- rows are two dependent writes, and CLAUDE.md 9a requires one RPC.

CREATE OR REPLACE FUNCTION public.grant_teacher_role(
  _user_id uuid,
  _pairs   jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_inst  uuid;
  v_granted boolean := false;
  v_assign jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;

  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'No user supplied' USING ERRCODE = '22004';
  END IF;

  -- Institution comes from profiles, the same source is_institution_admin uses,
  -- so the authority check and the row we write can never disagree.
  SELECT p.institution_id INTO v_inst FROM public.profiles p WHERE p.id = _user_id;

  IF v_inst IS NULL THEN
    RAISE EXCEPTION 'That account is not attached to an institution yet.'
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT (public.is_institution_admin(v_actor, v_inst) OR public.is_super_admin(v_actor)) THEN
    RAISE EXCEPTION 'You do not have permission to grant roles here.'
      USING ERRCODE = '42501';
  END IF;

  IF jsonb_array_length(COALESCE(_pairs, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'Pick at least one class and subject. A teacher with no assignments cannot see any students.'
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.user_roles (user_id, role, institution_id, granted_by)
  VALUES (_user_id, 'teacher', v_inst, v_actor)
  ON CONFLICT (user_id, role, institution_id) DO NOTHING;

  v_granted := FOUND;

  -- Delegate the teaching rows: this already holds the advisory lock, writes
  -- subject_class_group_mappings so the fanout trigger keeps the dual-table
  -- invariant, and logs its own audit delta.
  v_assign := public.set_staff_class_assignments(_user_id, _pairs, 'teacher'::app_role, NULL, 'subject');

  PERFORM public.log_audit_event(
    'user_roles',
    _user_id,
    'teacher_role_granted',
    jsonb_build_object('institution_id', v_inst, 'granted_by', v_actor, 'role_row_created', v_granted)
  );

  RETURN jsonb_build_object(
    'granted',       v_granted,
    'added_count',   COALESCE((v_assign->>'added_count')::int, 0),
    'removed_count', COALESCE((v_assign->>'removed_count')::int, 0)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_teacher_role(_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_inst  uuid;
  v_other int;
  v_assign jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;

  SELECT p.institution_id INTO v_inst FROM public.profiles p WHERE p.id = _user_id;

  IF v_inst IS NULL THEN
    RAISE EXCEPTION 'That account is not attached to an institution yet.'
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT (public.is_institution_admin(v_actor, v_inst) OR public.is_super_admin(v_actor)) THEN
    RAISE EXCEPTION 'You do not have permission to change roles here.'
      USING ERRCODE = '42501';
  END IF;

  -- Never strand an account with no role at all.
  SELECT count(*) INTO v_other
  FROM public.user_roles ur
  WHERE ur.user_id = _user_id AND ur.role <> 'teacher';

  IF v_other = 0 THEN
    RAISE EXCEPTION 'This is their only role. Removing it would leave the account with no access.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Clear the teaching rows in the same transaction. Every DELETE lands in
  -- class_assignment_deletions via trg_log_class_assignment_deletion.
  v_assign := public.set_staff_class_assignments(_user_id, '[]'::jsonb, 'teacher'::app_role, NULL, 'subject');

  DELETE FROM public.user_roles
  WHERE user_id = _user_id AND role = 'teacher' AND institution_id = v_inst;

  PERFORM public.log_audit_event(
    'user_roles',
    _user_id,
    'teacher_role_revoked',
    jsonb_build_object('institution_id', v_inst, 'revoked_by', v_actor,
                       'assignments_removed', COALESCE((v_assign->>'removed_count')::int, 0))
  );

  RETURN jsonb_build_object(
    'granted',       false,
    'added_count',   0,
    'removed_count', COALESCE((v_assign->>'removed_count')::int, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.grant_teacher_role(uuid, jsonb)  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grant_teacher_role(uuid, jsonb)  FROM anon;
REVOKE ALL ON FUNCTION public.revoke_teacher_role(uuid)        FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_teacher_role(uuid)        FROM anon;
GRANT EXECUTE ON FUNCTION public.grant_teacher_role(uuid, jsonb)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_teacher_role(uuid)        TO authenticated;
```

If Step 1 showed a different `log_audit_event` signature, adapt both `PERFORM` calls to it exactly. Do not invent a signature.

- [ ] **Step 3: Apply to prod and verify against the catalog, not the ledger**

```powershell
powershell -File scripts/run-sql.ps1 -File supabase/migrations/20260906120000_admin_teacher_role_grant_rpcs.sql
```

Then verify:

```sql
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args, p.prosecdef
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN ('grant_teacher_role','revoke_teacher_role');

SELECT routine_name, grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
  AND routine_name IN ('grant_teacher_role','revoke_teacher_role')
ORDER BY routine_name, grantee;
```

Expected: two rows with `prosecdef = true`; grantee list contains `authenticated` and **does not** contain `anon`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260906120000_admin_teacher_role_grant_rpcs.sql
git commit -m "feat(roles): add grant_teacher_role and revoke_teacher_role RPCs"
```

---

### Task 2: Ladder-free teacher scope resolver

**Files:**
- Create: `supabase/migrations/20260906130000_dash_resolve_teacher_pairs.sql`

**Interfaces:**
- Produces: `public.dash_resolve_teacher_pairs() RETURNS TABLE(class_id uuid, subject_id uuid)`.
- Consumed by: every `dash_teacher_*` function, replacing `dash_resolve_scoped_pairs()`.

**Why:** `dash_resolve_scoped_pairs()` is an IF/ELSIF ladder that checks admin first and whose admin branch returns `subject_id = NULL`, which downstream predicates such as `(pr.sid IS NULL OR pr.sid = es.subject_id)` treat as "every subject". An admin+teacher in teacher view would see the whole school on a page whose own footer promises only their assigned classes.

- [ ] **Step 1: Dump the current bodies from prod**

```powershell
powershell -File scripts/run-sql.ps1 -Query "SELECT p.proname, pg_get_functiondef(p.oid) AS def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'dash_teacher_%' ORDER BY p.proname;"
```

Save the output. The family is: `dash_teacher_action_queue`, `dash_teacher_attendance_trend`, `dash_teacher_class_subjects`, `dash_teacher_exam_trend`, `dash_teacher_header`, `dash_teacher_kpi_summary`, `dash_teacher_portal_adoption`, `dash_teacher_portal_laggards`, `dash_teacher_roster_gap`, `dash_teacher_student_distribution`, `dash_teacher_students_attention`, `dash_teacher_subject_performance`, `dash_teacher_syllabus_chapters`, `dash_teacher_syllabus_coverage`, `dash_teacher_weak_chapters`. **Confirm the list from the query output rather than trusting this one**, and note any function that does not call `dash_resolve_scoped_pairs()`.

- [ ] **Step 2: Write the new resolver, then paste each dumped body with one line changed**

```sql
-- The teacher scope, with no role ladder. dash_resolve_scoped_pairs() checks
-- admin FIRST and its admin branch emits subject_id = NULL, which downstream
-- predicates read as a wildcard, so an admin who also teaches would get the
-- whole school on their teacher dashboard. A function named dash_teacher_*
-- must never return institution-wide rows.
CREATE OR REPLACE FUNCTION public.dash_resolve_teacher_pairs()
RETURNS TABLE(class_id uuid, subject_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_inst uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN;  -- fail closed, never fall through
  END IF;

  v_inst := public.get_user_institution(v_uid);
  IF v_inst IS NULL THEN
    RAISE EXCEPTION 'dashboard: no institution context';
  END IF;

  RETURN QUERY
  SELECT DISTINCT ca.class_id, ca.subject_id
  FROM public.class_assignments ca
  JOIN public.classes c ON c.id = ca.class_id
  WHERE ca.user_id = v_uid
    AND ca.role = 'teacher'
    AND c.institution_id = v_inst
    AND COALESCE(c.is_active, true);
END;
$$;

REVOKE ALL ON FUNCTION public.dash_resolve_teacher_pairs() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dash_resolve_teacher_pairs() FROM anon;
GRANT EXECUTE ON FUNCTION public.dash_resolve_teacher_pairs() TO authenticated;

-- Then, for EACH dash_teacher_* definition dumped in Step 1, append its
-- CREATE OR REPLACE verbatim with exactly one substitution:
--   public.dash_resolve_scoped_pairs()  ->  public.dash_resolve_teacher_pairs()
-- Change nothing else. Do not reformat, do not "improve" the bodies.
```

- [ ] **Step 3: Apply and verify no `dash_teacher_*` still calls the ladder**

```powershell
powershell -File scripts/run-sql.ps1 -File supabase/migrations/20260906130000_dash_resolve_teacher_pairs.sql
```

```sql
SELECT p.proname
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname LIKE 'dash_teacher_%'
  AND p.prosrc LIKE '%dash_resolve_scoped_pairs%';
```

Expected: **zero rows.** Also confirm `dash_resolve_scoped_pairs` and `dash_resolve_scoped_classes` still exist unchanged (the admin and coordinator dashboards depend on them):

```sql
SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND proname IN ('dash_resolve_scoped_pairs','dash_resolve_scoped_classes');
```

- [ ] **Step 4: Manual check that nothing regressed for existing users**

Sign in as an existing coordinator+teacher and load `/school/snapshot`. The widgets must show the same numbers as before this change. Sign in as a school_admin and load `/school/command-center`. Unchanged.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260906130000_dash_resolve_teacher_pairs.sql
git commit -m "fix(dashboard): dash_teacher_* resolve their own scope instead of the admin-first ladder"
```

---

### Task 3: The core switch mechanism

**Files:**
- Modify: `src/hooks/useUserRole.ts` (interface at 7-22, return at 70-84, null-user return at 30-43)
- Modify: `src/contexts/ActiveRoleContext.tsx` (whole file)
- Modify: `src/components/dashboards/RoleSwitcher.tsx` (whole file)

**Interfaces:**
- Produces: `ViewRole = "admin" | "teacher" | "coordinator"`; `useActiveRole()` returns `{ activeViewRole, setActiveViewRole, hasDualRole, viewRoles }` where `viewRoles: ViewRole[]`; `UserRoleInfo.hasDualAdminTeacherRole: boolean`.
- `hasDualRole` keeps its existing meaning "this user can switch views", and is now `viewRoles.length > 1`.

- [ ] **Step 1: Add the flag to `useUserRole`**

In the `UserRoleInfo` interface, after `hasDualTeacherCoordinatorRole` (line 21):

```ts
  /** True if user has both a school-admin role and the teacher role */
  hasDualAdminTeacherRole: boolean;
```

In the null-user early return (after line 42) add `hasDualAdminTeacherRole: false,`. In the main return (after line 83) add:

```ts
        hasDualAdminTeacherRole: (roles.includes("school_admin") || isSuperSchoolAdmin) && isTeacher,
```

- [ ] **Step 2: Rewrite `ActiveRoleContext.tsx`**

```tsx
import { createContext, useContext, useState, useEffect, useMemo, ReactNode } from "react";
import { useUserRole } from "@/hooks/useUserRole";

export type ViewRole = "admin" | "teacher" | "coordinator";

const ROLE_PREFERENCE_KEY = "salci_dashboard_role_preference";

interface ActiveRoleContextType {
  activeViewRole: ViewRole;
  setActiveViewRole: (role: ViewRole) => void;
  /** True when this user can switch views at all. */
  hasDualRole: boolean;
  /** The views this user may choose between, in display order. */
  viewRoles: ViewRole[];
}

const ActiveRoleContext = createContext<ActiveRoleContextType | undefined>(undefined);

export function ActiveRoleProvider({ children }: { children: ReactNode }) {
  const { data: roleInfo } = useUserRole();

  /**
   * Which views this account may wear.
   *
   * "admin" is offered ONLY to a school admin who also holds the teacher role,
   * so an admin+coordinator (or a plain admin) is completely unaffected and
   * keeps today's behaviour. "teacher" and "coordinator" keep the exact
   * teacher+coordinator pairing that shipped in 607aeca.
   *
   * Note super_admin is deliberately absent: platform admins are never scoped.
   */
  const viewRoles = useMemo<ViewRole[]>(() => {
    const isAdminTeacher = Boolean(roleInfo?.isSchoolAdmin && roleInfo?.isTeacher);
    const isTeacherCoordinator = Boolean(roleInfo?.isTeacher && roleInfo?.isCoordinator);
    const list: ViewRole[] = [];
    if (isAdminTeacher) list.push("admin");
    if (isAdminTeacher || isTeacherCoordinator) list.push("teacher");
    if (isTeacherCoordinator) list.push("coordinator");
    return list;
  }, [roleInfo?.isSchoolAdmin, roleInfo?.isTeacher, roleInfo?.isCoordinator]);

  const hasDualRole = viewRoles.length > 1;

  // The first entry is the default: "teacher" for a teacher+coordinator (no
  // change for the 7 live dual-role users), "admin" for an admin+teacher, so
  // gaining the teacher role never silently drops a principal into teacher view.
  const defaultViewRole: ViewRole = viewRoles[0] ?? "teacher";

  const [activeViewRole, setActiveViewRoleState] = useState<ViewRole>(defaultViewRole);

  // Restore the saved preference, but only if it is a view this user actually
  // holds. The old code applied any stored value to every user, so a stale
  // "admin" would otherwise leak onto a coordinator+teacher.
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(ROLE_PREFERENCE_KEY);
    } catch { /* storage unavailable */ }

    const isValid = (v: string | null): v is ViewRole =>
      v === "admin" || v === "teacher" || v === "coordinator";

    if (isValid(saved) && viewRoles.includes(saved)) {
      setActiveViewRoleState(saved);
    } else {
      setActiveViewRoleState(defaultViewRole);
    }
  }, [viewRoles, defaultViewRole]);

  const setActiveViewRole = (role: ViewRole) => {
    setActiveViewRoleState(role);
    try { localStorage.setItem(ROLE_PREFERENCE_KEY, role); } catch { /* noop */ }
  };

  const value = useMemo(
    () => ({ activeViewRole, setActiveViewRole, hasDualRole, viewRoles }),
    [activeViewRole, hasDualRole, viewRoles],
  );

  return <ActiveRoleContext.Provider value={value}>{children}</ActiveRoleContext.Provider>;
}

export function useActiveRole() {
  const context = useContext(ActiveRoleContext);
  if (!context) {
    throw new Error("useActiveRole must be used within ActiveRoleProvider");
  }
  return context;
}
```

- [ ] **Step 3: Rewrite `RoleSwitcher.tsx` to render from `viewRoles`**

Keep the visual identical to the screenshot: a `Switch view:` label and pill buttons.

```tsx
import { GraduationCap, ClipboardList, Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ViewRole } from "@/contexts/ActiveRoleContext";

export type { ViewRole };

const VIEW_META: Record<ViewRole, { label: string; Icon: typeof Shield }> = {
  admin: { label: "Admin", Icon: Shield },
  teacher: { label: "Teacher", Icon: GraduationCap },
  coordinator: { label: "Coordinator", Icon: ClipboardList },
};

interface RoleSwitcherProps {
  activeRole: ViewRole;
  onRoleChange: (role: ViewRole) => void;
  /** The views this user may choose between. */
  roles: ViewRole[];
}

export function RoleSwitcher({ activeRole, onRoleChange, roles }: RoleSwitcherProps) {
  if (roles.length < 2) return null;

  return (
    <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg border">
      <span className="text-sm text-muted-foreground">Switch view:</span>
      <div className="flex gap-2">
        {roles.map((role) => {
          const { label, Icon } = VIEW_META[role];
          return (
            <button
              key={role}
              type="button"
              onClick={() => onRoleChange(role)}
              aria-pressed={activeRole === role}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                activeRole === role
                  ? "bg-primary text-primary-foreground"
                  : "bg-background hover:bg-accent text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

The old file declared its own `export type ViewRole` duplicate. It now re-exports the context's single declaration, so the two can never diverge.

- [ ] **Step 4: Verify**

```bash
npm run typecheck
npx eslint src/hooks/useUserRole.ts src/contexts/ActiveRoleContext.tsx src/components/dashboards/RoleSwitcher.tsx
```

Typecheck will report errors at `RoleSwitcher` call sites (the new required `roles` prop). That is expected and is fixed in Task 4. Everything else must be clean.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useUserRole.ts src/contexts/ActiveRoleContext.tsx src/components/dashboards/RoleSwitcher.tsx
git commit -m "feat(roles): widen ViewRole to admin/teacher/coordinator and derive available views"
```

---

### Task 4: Dashboard router and sidebar

**Files:**
- Modify: `src/components/dashboards/RoleBasedDashboard.tsx:202`, `:216-221`, `:256-261`
- Modify: `src/components/layout/AppSidebar.tsx:186`, `:252-261`, and the `if (roleInfo?.isSchoolAdmin)` block at `:475`

- [ ] **Step 1: `RoleBasedDashboard`**

Line 202 becomes:

```tsx
  const { activeViewRole, setActiveViewRole, hasDualRole, viewRoles } = useActiveRole();
```

Replace `getEffectiveRole` (216-221) with:

```tsx
  // Which dashboard to show. "admin" maps back to the concrete admin role so
  // the switch below keeps its existing cases untouched.
  const getEffectiveRole = () => {
    if (!hasDualRole) return roleInfo.primaryRole;
    if (activeViewRole === "admin") return roleInfo.primaryRole;
    return activeViewRole;
  };
```

Replace the switcher mount (256-261) with:

```tsx
      {hasDualRole && (
        <RoleSwitcher
          activeRole={activeViewRole}
          onRoleChange={setActiveViewRole}
          roles={viewRoles}
        />
      )}
```

- [ ] **Step 2: `AppSidebar` view helpers**

Line 186 becomes:

```tsx
  const { activeViewRole, hasDualRole } = useActiveRole();
```

(unchanged, but confirm it still destructures only what it uses). Replace 252-261 with:

```tsx
  // For dual-role users, determine which role's navigation to show
  const shouldShowTeacherNav = () => {
    if (!hasDualRole) return roleInfo?.isTeacher;
    return activeViewRole === "teacher";
  };

  const shouldShowCoordinatorNav = () => {
    if (!hasDualRole) return roleInfo?.isCoordinator;
    return activeViewRole === "coordinator";
  };

  // An admin who also teaches gets ONE portal at a time, the same way a
  // teacher+coordinator does. Without this the sidebar renders the admin
  // groups AND the teacher groups stacked, including two groups both named
  // "Work", which collide on key={group.group}.
  const shouldShowAdminNav = () => {
    if (!hasDualRole) return roleInfo?.isSchoolAdmin;
    return activeViewRole === "admin";
  };
```

- [ ] **Step 3: Gate the admin nav block**

At line 475, change:

```tsx
    if (roleInfo?.isSchoolAdmin) {
```

to:

```tsx
    if (shouldShowAdminNav()) {
```

Read the surrounding block first and confirm line 475 is the school-admin nav group push and not the super-admin block at 389 (which must stay ungated: super admins are never scoped).

- [ ] **Step 4: Verify**

```bash
npm run typecheck
npx eslint src/components/dashboards/RoleBasedDashboard.tsx src/components/layout/AppSidebar.tsx
npx vite build
```

All three must be clean now. Manual: sign in as an existing coordinator+teacher, confirm the Home switcher still reads Teacher | Coordinator and the sidebar still swaps exactly as before.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboards/RoleBasedDashboard.tsx src/components/layout/AppSidebar.tsx
git commit -m "feat(roles): dashboard and sidebar honour the admin view role"
```

---

### Task 5: The five Shape-A sites

**Files:**
- Modify: `src/pages/school/SchoolClassesPage.tsx:43-48`
- Modify: `src/pages/school/SchoolStudentsPage.tsx:142-147`
- Modify: `src/pages/school/SchoolTeachersPage.tsx:109-117`
- Modify: `src/pages/school/SchoolSyllabusPage.tsx:999`, `:1018-1020`
- Modify: `src/hooks/useExamClassHierarchy.ts:150`, `:154-156`

Each site currently reads `roleInfo?.hasDualTeacherCoordinatorRole ? activeViewRole : roleInfo?.primaryRole`. The replacement is **identical at all five sites** and is repeated inline deliberately, matching how this pattern already lives in the codebase.

- [ ] **Step 1: Apply the same edit five times**

Change the destructure to pull `hasDualRole`:

```ts
  const { activeViewRole, hasDualRole } = useActiveRole();
```

Then replace the ternary. In `SchoolClassesPage` the variable is `effectiveRole`; in `SchoolStudentsPage` and `SchoolSyllabusPage` it is `rawEffectiveRole`; in `SchoolTeachersPage` and `useExamClassHierarchy` it is `effectiveRole`. Keep each name as it is and change only the right-hand side:

```ts
  // Determine effective role - one hat at a time, never a union.
  // "admin" maps back to the concrete admin role so every downstream
  // comparison against "school_admin" / "super_school_admin" is unchanged.
  const effectiveRole = hasDualRole
    ? (activeViewRole === "admin" ? roleInfo?.primaryRole : activeViewRole)
    : roleInfo?.primaryRole;
```

In `useExamClassHierarchy` the role object is named `userRole`, not `roleInfo`. Use `userRole?.primaryRole` there.

- [ ] **Step 2: Verify**

```bash
npm run typecheck
npx eslint src/pages/school/SchoolClassesPage.tsx src/pages/school/SchoolStudentsPage.tsx src/pages/school/SchoolTeachersPage.tsx src/pages/school/SchoolSyllabusPage.tsx src/hooks/useExamClassHierarchy.ts
```

Confirm no site still references `hasDualTeacherCoordinatorRole`:

```bash
npx rg "hasDualTeacherCoordinatorRole" src/pages/school src/hooks/useExamClassHierarchy.ts
```

Expected: no matches.

- [ ] **Step 3: Commit**

```bash
git add src/pages/school/SchoolClassesPage.tsx src/pages/school/SchoolStudentsPage.tsx src/pages/school/SchoolTeachersPage.tsx src/pages/school/SchoolSyllabusPage.tsx src/hooks/useExamClassHierarchy.ts
git commit -m "feat(roles): Classes, Students, Teachers, Syllabus and exam hierarchy follow the admin view role"
```

---

### Task 6: The five Shape-B sites

**Files:**
- Modify: `src/pages/school/CommunicationPage.tsx:16`, `:29-38`
- Modify: `src/components/notices/NoticeBoard.tsx:61`, `:63-70`
- Modify: `src/components/communication/MessagesTab.tsx:26`, `:29-36`
- Modify: `src/components/communication/MessagingPanel.tsx:22`, `:24-27`
- Modify: `src/hooks/useHomeworkScope.ts:43`, `:50-59`

These sites compute `isAdmin` from the raw boolean, so an admin+teacher is never a teacher on them. Each `isAdmin` must respect the active view, and `isDualRole` must come from the context rather than `useUserRole`.

- [ ] **Step 1: `CommunicationPage.tsx`**

Line 16 becomes `const { activeViewRole, hasDualRole } = useActiveRole();`. Replace 29-38:

```tsx
  // Derive effective role flags respecting activeViewRole for dual-role users
  const isAdmin = Boolean(roleInfo?.isSchoolAdmin) && (!hasDualRole || activeViewRole === "admin");

  const isTeacher = hasDualRole
    ? activeViewRole === "teacher"
    : roleInfo?.isTeacher && !roleInfo?.isSchoolAdmin && !roleInfo?.isCoordinator;

  const isCoordinator = hasDualRole
    ? activeViewRole === "coordinator"
    : roleInfo?.isCoordinator && !roleInfo?.isSchoolAdmin;
```

- [ ] **Step 2: `NoticeBoard.tsx`**

Line 61 becomes `const { activeViewRole, hasDualRole } = useActiveRole();`. Replace 63-70:

```tsx
  const isAdmin = Boolean(roleInfo?.isSchoolAdmin) && (!hasDualRole || activeViewRole === "admin");
  const isCoordinator = hasDualRole
    ? activeViewRole === "coordinator"
    : Boolean(roleInfo?.isCoordinator) && !roleInfo?.isSchoolAdmin;
  const isTeacher = hasDualRole
    ? activeViewRole === "teacher"
    : Boolean(roleInfo?.isTeacher) && !roleInfo?.isSchoolAdmin && !roleInfo?.isCoordinator;
```

Leave `canPublish` and `isTeacherOnly` (line 72-73) as they are; they now follow automatically.

- [ ] **Step 3: `MessagesTab.tsx`**

Line 26 becomes `const { activeViewRole, hasDualRole } = useActiveRole();`. Replace 29-36 with the same three expressions as Step 2 (identical text, `isAdmin` / `isCoordinator` / `isTeacher`).

- [ ] **Step 4: `MessagingPanel.tsx`**

Line 22 becomes `const { activeViewRole, hasDualRole } = useActiveRole();`. Replace 24-27:

```tsx
  const isTeacher = hasDualRole
    ? activeViewRole === "teacher"
    : roleInfo?.isTeacher && !roleInfo?.isSchoolAdmin && !roleInfo?.isCoordinator;
```

- [ ] **Step 5: `useHomeworkScope.ts`**

Line 43 already destructures `{ activeViewRole, hasDualRole }`. Replace 50-59:

```ts
  const isAdminScope =
    (!!roleInfo?.isSchoolAdmin || !!roleInfo?.isSuperAdmin) &&
    (!hasDualRole || activeViewRole === "admin");
  const isTeacherScope =
    !isAdminScope &&
    (hasDualRole
      ? activeViewRole === "teacher"
      : !!roleInfo?.isTeacher && !roleInfo?.isCoordinator);
  const isCoordinatorScope =
    !isAdminScope &&
    !isTeacherScope &&
    (hasDualRole ? activeViewRole === "coordinator" : !!roleInfo?.isCoordinator);
```

- [ ] **Step 6: Verify**

```bash
npm run typecheck
npx eslint src/pages/school/CommunicationPage.tsx src/components/notices/NoticeBoard.tsx src/components/communication/MessagesTab.tsx src/components/communication/MessagingPanel.tsx src/hooks/useHomeworkScope.ts
npx vite build
```

- [ ] **Step 7: Commit**

```bash
git add src/pages/school/CommunicationPage.tsx src/components/notices/NoticeBoard.tsx src/components/communication/MessagesTab.tsx src/components/communication/MessagingPanel.tsx src/hooks/useHomeworkScope.ts
git commit -m "feat(roles): communication, notices and homework scopes follow the admin view role"
```

---

### Task 7: ExamsPage

**Files:**
- Modify: `src/pages/ExamsPage.tsx:132`, `:134`, `:179-183`, `:509-513`

`canSwitchScope` currently ends in `&& !isSchoolAdminView`, which removes the switcher from every admin. `isSchoolAdminView` must respect the view, and the switcher must appear for the new pairing. `isManagingAsAdmin` (a super admin managing an institution) stays admin unconditionally.

- [ ] **Step 1: Edit**

Line 132 becomes:

```tsx
  const { activeViewRole, setActiveViewRole, hasDualRole, viewRoles } = useActiveRole();
```

Line 134 becomes:

```tsx
  // A super admin managing an institution is always admin. A school admin who
  // also teaches follows the toggle.
  const isAdminCapable = !!roleInfo?.isSchoolAdmin || isManagingAsAdmin;
  const isSchoolAdminView =
    isAdminCapable && (isManagingAsAdmin || !hasDualRole || activeViewRole === "admin");
```

Replace 179-183:

```tsx
  const canSwitchScope = hasDualRole && !isManagingAsAdmin;
  const isCoordinatorScope =
    !isSchoolAdminView &&
    !!roleInfo?.isCoordinator &&
    (!canSwitchScope || activeViewRole === "coordinator");
```

Update the doc comment above (160-178) so it no longer says the switcher is removed from admins.

- [ ] **Step 2: Pass the roles to the local `ScopeSwitcher`**

Read `ExamsPage.tsx:1188-1239` (the local `ScopeSwitcher` built on shadcn `ToggleGroup`). Add a `roles: ViewRole[]` prop and render one `ToggleGroupItem` per entry, using the same labels as `RoleSwitcher`: Admin, Teacher, Coordinator. Then at 509-513:

```tsx
          canSwitchScope ? (
            <ScopeSwitcher value={activeViewRole} onChange={setActiveViewRole} roles={viewRoles} />
          ) : undefined
```

- [ ] **Step 3: Check the title and empty-state copy**

Read `getPageTitle` / `getPageDescription` around 475-486 and add an admin-view branch if one is missing, so the header does not say "My Exams" while showing institution-wide rows. No em-dashes.

- [ ] **Step 4: Verify**

```bash
npm run typecheck
npx eslint src/pages/ExamsPage.tsx
```

Manual: as a coordinator+teacher, `/exams` still shows the Teacher | Coordinator toggle and the same lists as before.

- [ ] **Step 5: Commit**

```bash
git add src/pages/ExamsPage.tsx
git commit -m "feat(exams): admin+teacher users can switch the exam list scope"
```

---

### Task 8: Snapshot routing

**Files:**
- Modify: `src/pages/school/SchoolSnapshotPage.tsx:15-20`
- Modify: `src/pages/school/ScopedSnapshotPage.tsx` (the `isTeacherScope` line, near 324-337)

`SchoolSnapshotPage` sends every admin to `ComprehensivePrincipalDashboard`, so the whole `dash_teacher_*` family is unreachable for an admin+teacher no matter what the toggle says. This is the single file that would make the feature a no-op end to end.

- [ ] **Step 1: `SchoolSnapshotPage`**

```tsx
import { useActiveRole } from "@/contexts/ActiveRoleContext";
```

Replace 15-20:

```tsx
  const { activeViewRole, hasDualRole } = useActiveRole();
  const isAdminRole = roleInfo?.roles?.some(r => ['school_admin', 'super_school_admin', 'super_admin'].includes(r));
  // An admin who also teaches gets the scoped snapshot while the toggle says
  // Teacher. Everyone else keeps today's behaviour: admin wins.
  const isAdmin = isAdminRole && (!hasDualRole || activeViewRole === "admin");
  const isScopedOnly =
    !isAdmin && (roleInfo?.isCoordinator === true || roleInfo?.isTeacher === true);
```

`isAdmin` is also used at line 40 to gate the Promote Students block, which is correct: in teacher view that block should not render.

- [ ] **Step 2: `ScopedSnapshotPage`**

Read the tail of the file. Replace the `isTeacherScope` derivation with one that reads the view role, keeping today's outcome for a teacher+coordinator:

```tsx
  const { activeViewRole, hasDualRole } = useActiveRole();
  // A teacher who is ALSO a coordinator keeps the coordinator (wing) view
  // unless they have switched. An admin+teacher who got here is in teacher view
  // by definition, so they get the teacher scope.
  const isTeacherScope = hasDualRole
    ? activeViewRole === "teacher"
    : !!roleInfo?.isTeacher && !roleInfo?.isCoordinator;
```

- [ ] **Step 3: Verify**

```bash
npm run typecheck
npx eslint src/pages/school/SchoolSnapshotPage.tsx src/pages/school/ScopedSnapshotPage.tsx
npx vite build
```

Manual: as a coordinator+teacher, `/school/snapshot` renders exactly as before.

- [ ] **Step 4: Commit**

```bash
git add src/pages/school/SchoolSnapshotPage.tsx src/pages/school/ScopedSnapshotPage.tsx
git commit -m "feat(dashboard): admin+teacher reaches the teacher snapshot in teacher view"
```

---

### Task 9: The grant dialog and the menu item

**Files:**
- Create: `src/components/school/GrantTeacherRoleDialog.tsx`
- Modify: `src/pages/school/ManageAdminsPage.tsx`

**Interfaces:**
- Consumes: `grant_teacher_role(_user_id, _pairs)` and `revoke_teacher_role(_user_id)` from Task 1.
- Produces: `<GrantTeacherRoleDialog open onOpenChange userId userName institutionId />`.

- [ ] **Step 1: Read the class/subject picker to reuse**

```bash
sed -n '360,500p' "src/components/school/AssignTeacherClassSubjectDialog.tsx"
```

Reuse its class + subject selection UI and its query shape. Do **not** reuse its mutation: this dialog calls the new RPC.

- [ ] **Step 2: Build the dialog**

Requirements, all mandatory:
- At least one class + subject pair before Save is enabled. Helper text: "Pick at least one class and subject. A teacher with no assignments cannot see any students."
- Mutation calls `supabase.rpc("grant_teacher_role", { _user_id: userId, _pairs: pairs })`.
- Single-flight: the Save button is `disabled={mutation.isPending}`.
- `onSuccess`: `toast.success("Teacher role added")`, then invalidate `["institution-admins"]`, `["user-role-info"]`, `["school-teachers", institutionId]`, and call `invalidateUserAssignments(queryClient, userId)`.
- `onError`: `toastError(e, { fallback: "Couldn't add the teacher role.", context: "grantTeacherRole" })`.
- Every `useQuery` in the file sets an explicit `staleTime` of at least `60_000`.
- No `select("*")`. Explicit column lists.
- No em-dashes anywhere in the copy.
- Pass plain children to `DialogContent`; add no scroll or flex scaffolding.

- [ ] **Step 3: Extend the admins query so rows know their other roles**

In `ManageAdminsPage.tsx`, the query at 73-110 fetches only `school_admin` / `super_school_admin` rows. Add a second bounded read for the same user ids and hang two booleans off each row:

```ts
      const { data: otherRoles, error: otherRolesError } = await supabase
        .from("user_roles")
        .select("user_id, role")
        .in("user_id", userIds)
        .in("role", ["teacher", "coordinator"])
        .eq("institution_id", institutionId)
        .range(0, 999);

      if (otherRolesError) throw otherRolesError;
```

Add `is_teacher: boolean` and `has_other_role: boolean` to the `AdminUser` interface and set them in the merge at 99-107.

- [ ] **Step 4: Handle the query error (CLAUDE.md §6)**

Change line 73 to `const { data: admins, isLoading: adminsLoading, error: adminsError } = useQuery({...})`. Render an error state **before** the empty state, and make the stat tiles show `"N/A"` rather than `0` when `adminsError` is set. The tiles are at 340-353 and the empty state at 369-379.

- [ ] **Step 5: Add the menu items**

In the `DropdownMenuContent` (433-462), insert **after** "Edit designation" (line 453) and **before** "Remove admin":

```tsx
                        {!admin.is_teacher ? (
                          <DropdownMenuItem onClick={() => handleGrantTeacher(admin)}>
                            <GraduationCap className="h-4 w-4 mr-2" />
                            Add to teacher
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem onClick={() => handleRevokeTeacher(admin)}>
                            <GraduationCap className="h-4 w-4 mr-2" />
                            Remove from teacher
                          </DropdownMenuItem>
                        )}
```

Add `GraduationCap` to the `lucide-react` import on line 24. Add a `Teacher` badge to the row title block (after line 411) when `admin.is_teacher`, so an operator can see the account is dual before acting on it.

- [ ] **Step 6: Fix the "Remove admin" footgun**

`deleteAdminMutation` (180-198) calls `delete_user`, which permanently deletes the auth account and cascades, while the confirmation at 594-597 says the account will remain active. Change the mutation to branch on the row:

```ts
    mutationFn: async (admin: AdminUser) => {
      // Someone who only holds admin roles is deleted outright, exactly as
      // before. Someone who also teaches or coordinates keeps their account:
      // we drop only the admin role row, which is what this button has always
      // claimed to do.
      if (admin.has_other_role) {
        const { error } = await supabase
          .from("user_roles")
          .delete()
          .eq("id", admin.role_id);
        if (error) throw error;
        // A blocked DELETE is indistinguishable from success under RLS, so
        // prove the row is gone (CLAUDE.md §6).
        const { data: still, error: checkError } = await supabase
          .from("user_roles")
          .select("id")
          .eq("id", admin.role_id)
          .maybeSingle();
        if (checkError) throw checkError;
        if (still) throw new Error("You do not have permission to remove that administrator.");
        return { revokedOnly: true };
      }
      await invokeAdminOperation<{ success: boolean }>({
        action: "delete_user",
        data: { userId: admin.id },
      });
      return { revokedOnly: false };
    },
```

Update the call site at 603 to pass `selectedAdmin` rather than `selectedAdmin.id`, invalidate `["user-role-info"]` in `onSuccess` alongside `["institution-admins"]`, and make the `AlertDialogDescription` (594-597) say what will actually happen for each case:

```tsx
              {selectedAdmin?.has_other_role ? (
                <>Remove <strong>{selectedAdmin?.full_name}</strong> as an administrator? They keep their account and their other roles, and lose admin access only.</>
              ) : (
                <>Remove <strong>{selectedAdmin?.full_name}</strong>? This permanently deletes their account and everything they created. This cannot be undone.</>
              )}
```

- [ ] **Step 7: Migrate the two raw error toasts**

`updateDesignationMutation.onError` (170-176) and `promoteAdminMutation.onError` (219-225) use `toast({ description: error.message })`, which leaks raw Postgres text (§19). Replace both with `toastError(error, { fallback: "...", context: "..." })`.

- [ ] **Step 8: Verify**

```bash
npm run typecheck
npx eslint src/pages/school/ManageAdminsPage.tsx src/components/school/GrantTeacherRoleDialog.tsx
npx vite build
```

Manual, on a test account: grant the teacher role to a non-owner admin, confirm the Teacher badge appears, confirm running it twice does not create a duplicate assignment, then revoke and confirm both the role row and the assignments are gone.

- [ ] **Step 9: Commit**

```bash
git add src/pages/school/ManageAdminsPage.tsx src/components/school/GrantTeacherRoleDialog.tsx
git commit -m "feat(admins): add and remove the teacher role from Manage Administrators"
```

---

### Task 10: Achievements badge ladder

**Files:**
- Modify: `src/pages/AchievementsPage.tsx:506-519`, `:547-549`

`useAutoBadgeAward` blocks every badge award for anyone holding a teacher or coordinator role until their onboarding journey is complete, but `AchievementsPage` picks its ladder from `primaryRole`, which stays `school_admin`. The admin's badges would silently stop with nothing on screen explaining why.

- [ ] **Step 1: Resolve the badge type from the view role**

Read 500-560 first. Change `getEffectiveBadgeType()` so that a user holding the teacher role resolves to the `"teacher"` ladder when the active view is `"teacher"`:

```tsx
  const getEffectiveBadgeType = () => {
    if (roleInfo?.primaryRole === "student") return "student";
    if (hasDualRole && activeViewRole === "teacher") return "teacher";
    if (roleInfo?.primaryRole === "teacher" || roleInfo?.primaryRole === "coordinator") return "teacher";
    return null;
  };
```

Import `useActiveRole` and destructure `{ activeViewRole, hasDualRole }`.

- [ ] **Step 2: Verify**

```bash
npm run typecheck
npx eslint src/pages/AchievementsPage.tsx
```

Manual: as an admin+teacher in teacher view, `/achievements` shows the teaching ladder and the onboarding journey panel that explains any lock. In admin view it renders as it does today.

- [ ] **Step 3: Commit**

```bash
git add src/pages/AchievementsPage.tsx
git commit -m "fix(achievements): admin+teacher sees the teaching ladder and its onboarding gate"
```

---

### Task 11: Three correctness fixes this feature makes load-bearing

**Files:**
- Modify: `src/components/layout/AppSidebar.tsx` (identity block, around 131-134)
- Modify: `src/components/attendance/AttendanceHistoryView.tsx:102-107`
- Modify: `src/hooks/useWorkforceData.ts:191-195`

- [ ] **Step 1: Deterministic sidebar identity label**

`const primaryRole = profile?.roles?.[0]?.role;` reads the first row of an unordered fetch, so for a two-role user the label under their own name flips between page loads. Use the role hook's deterministic value instead:

```tsx
  const roleLabel = roleInfo?.primaryRole
    ? roleInfo.primaryRole.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
    : "User";
```

Read the block first and keep the surrounding JSX untouched. Remove the now-unused `primaryRole` local if nothing else uses it.

- [ ] **Step 2: `AttendanceHistoryView` multi-role fix**

```ts
      const { data: roleRows, error: roleError } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .in("role", ["coordinator", "teacher"])
        .range(0, 9);

      if (roleError) throw roleError;
      const isCoord = (roleRows ?? []).some((r) => r.role === "coordinator");
```

`.maybeSingle()` with no role filter returns `PGRST116` for any user with two role rows, and the current code destructures the error away and silently labels them "Teacher". This is already misfiring for the 7 live coordinator+teacher users.

- [ ] **Step 3: `useWorkforceData` Owner exclusion**

The exclusion filters **role rows**, so a `super_school_admin` who also holds `teacher` has a matching row and slips through, exposing the Owner's task load to every school_admin. Exclude by user:

```ts
      } else if (isSchoolAdmin) {
        // Owners stay hidden from peer admins. Exclude by USER, not by role
        // row: a super_school_admin who also teaches has a teacher row and
        // would otherwise slip through this filter.
        const ownerIds = new Set(
          (allRoles || []).filter(r => r.role === "super_school_admin").map(r => r.user_id)
        );
        visibleUserIds = new Set(
          (allRoles || [])
            .filter(r => ["coordinator", "teacher"].includes(r.role) && !ownerIds.has(r.user_id))
            .map(r => r.user_id)
        );
      }
```

- [ ] **Step 4: Verify**

```bash
npm run typecheck
npx eslint src/components/layout/AppSidebar.tsx src/components/attendance/AttendanceHistoryView.tsx src/hooks/useWorkforceData.ts
npx vite build
```

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/AppSidebar.tsx src/components/attendance/AttendanceHistoryView.tsx src/hooks/useWorkforceData.ts
git commit -m "fix(roles): deterministic role label, multi-role attendance lookup, owner exclusion by user"
```

---

### Task 12: Full verification and skill updates

- [ ] **Step 1: Full zero-error pass**

```bash
npm run typecheck
npx eslint src
npx vite build
```

All three clean. `npx eslint src` may surface pre-existing errors in files this change never touched: leave those alone and say so in the summary, per CLAUDE.md §5a.

- [ ] **Step 2: Confirm no dual-role site was missed**

```bash
npx rg "hasDualTeacherCoordinatorRole" src
```

Expected: only `src/hooks/useUserRole.ts` (the definition) and `src/components/prd/PRDDocument.tsx` (documentation prose). Any other hit is a site that still ignores the admin pairing.

- [ ] **Step 3: Regression sweep for the 7 existing dual-role users**

As a coordinator+teacher account, confirm each of these is byte-identical to before: `/dashboard` switcher labels, sidebar contents in both views, `/exams` list and toggle, `/school/snapshot`, `/homework`, `/school/syllabus`, `/school/communication`, `/achievements`.

- [ ] **Step 4: Update the skills**

Add a section to `.claude/skills/teacher-authority-scope/SKILL.md` §3 recording that `ViewRole` now has three values, that `hasDualRole` means "can switch views", that `viewRoles[0]` is the default, and that the toggle is presentation-only because every server-side gate is an OR-union with the admin branch first. Add one line to CLAUDE.md §25 pointing at it. Respect the 200-line cap on CLAUDE.md.

- [ ] **Step 5: Commit**

```bash
git add .claude docs
git commit -m "docs(roles): record the admin+teacher view switch invariants"
```

---

## Self-Review

**Spec coverage:** Grant RPC → Task 1. Revoke → Tasks 1 and 9. Dialog and menu item → Task 9. "Remove admin" footgun → Task 9 Step 6. `ViewRole` widening, context validation, defaults, switcher → Task 3. Dashboard and sidebar → Task 4. Shape-A five → Task 5. Shape-B five → Task 6. ExamsPage → Task 7. Snapshot pages → Task 8. `dash_resolve_teacher_pairs` → Task 2. Achievements → Task 10. The four correctness fixes → Task 9 Step 4 (admins query error) and Task 11 (other three). Testing and Scale Gate → folded into each task's verify step plus Task 12.

**Type consistency:** `ViewRole` is declared once in `ActiveRoleContext.tsx` and re-exported by `RoleSwitcher.tsx` (Task 3 Step 3), so the previous duplicate declaration cannot diverge. `hasDualRole` keeps its name and its "can switch views" meaning at all 14 existing call sites. `viewRoles` is added, never renamed. `RoleSwitcher` gains a required `roles` prop, which is why Task 3 Step 4 expects call-site errors that Task 4 clears.

**Ordering note:** Tasks 1 and 2 are database-only and ship safely ahead of any frontend, satisfying CLAUDE.md §2 (a migration that narrows behaviour must not land before the frontend that stops depending on it). Nothing here drops a column.
