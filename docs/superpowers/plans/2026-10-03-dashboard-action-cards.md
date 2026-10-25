# Dashboard Action Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the teacher, coordinator and school admin dashboards, replace the Clay School banner with swipeable clay cards (check-in, substitution, leave, check-out) whenever the signed-in person has one of those to act on today, and show the banner again when nothing is due.

**Architecture:** One read-only SECURITY DEFINER RPC, `my_dashboard_actions(p_view)`, answers everything for one dashboard load: counts and one line of context, on the school's clock, scoped by the view the dashboard shows (it can only narrow). A pure, import-free module parses that answer and produces the card order and words (Node-tested). One hook fetches it under the `["staff-attendance", "my-actions", …]` key, so the existing writes refresh it. A `DashboardTopSlot` component takes the banner's exact box: sky while loading, error card on failure, the card deck when something is due, the 3D banner otherwise. Check-in and check-out reuse the existing mutations through one shared flow hook that the greeting button also uses.

**Tech Stack:** React 18, TypeScript, Vite, TanStack Query v5, Supabase (Postgres 15 PL/pgSQL), shadcn/ui, Tailwind, Node 22 (`--experimental-strip-types`) for the pure-logic test, Playwright (`playwright-core` + system Chrome) for the browser check.

**Spec:** [docs/superpowers/specs/2026-10-03-dashboard-action-cards-design.md](../specs/2026-10-03-dashboard-action-cards-design.md). Read it first; this plan argues from it.

## Global Constraints

Every task's requirements include these. Values are copied from the spec and CLAUDE.md.

- **No em-dashes (`—`) in any user-facing text.** Use `·`, a comma, a colon or "to". Code comments are exempt.
- **Card order is fixed:** check-in, substitution, leave, check-out (`CARD_ORDER`).
- **Who sees what (owner's decisions, 2026-10-03):**
  - Check-in and check-out: any staff view (teacher, coordinator, school_admin, super_school_admin) with the `attendance` feature on; never students or super admins.
  - Substitution: admin and coordinator views only, and only on a day the school has at least one real staff check-in.
  - Leave: teacher view, student leave of the sections they teach. Coordinator view, their wings' student leave plus staff leave. Admin view, staff leave only (**never student leave**), never their own request.
- **Check-in card visible until `staff_check_out_time`.** Hidden on holidays, non-working days and on-leave days.
- **Substitution and leave cards open the existing screens:** `/staff/workday?tab=substitutions`, `/school/attendance?tab=leaves`, `/staff/workday?tab=staff-leaves`. Check-in and check-out act in the card.
- **Check-out is NEVER blocked.** Record it on the tap, then teachers get the dismissible `CheckOutSyllabusSheet`.
- **UI:** shadcn/ui only, so no raw `<button>`/`<input>`. Colours come from CSS variables only (`brand-primary`, `ink-*`, `destructive`, the clay tokens). Spacing stays on Tailwind's 4/8/12/16/24 scale, with no inline styles. Every layout must work at 375 px and flip fully in dark mode.
- **§6:** the error state renders BEFORE the empty state. Every error toast goes through `toastError`; never use `toast.error(e.message)`.
- **§23 Scale Gate:** `staleTime` ≥ 60_000 on every new query, no `select("*")` in new or touched queries, aggregates computed server-side, no `refetchInterval`, and every listener and timer is cleaned up.
- **§24:** every time comparison uses the institution's timezone (`institutions.timezone`, default `Asia/Kolkata`).
- **§25:** each dashboard passes ITS OWN view (`"teacher"`, `"coordinator"`, `"admin"`), never the raw `activeViewRole`, and scopes are never unioned. `ViewRole` is imported from `@/contexts/ActiveRoleContext` and never redeclared.
- **§26:** apply SQL through `scripts/run-sql.ps1`, never `supabase db push`. REVOKE from `anon` BY NAME, and verify in `information_schema.routine_privileges` and `pg_proc`, never the migration ledger.
- **`src/integrations/supabase/types.ts`:** hand-splice the one new entry. Never regenerate it wholesale.
- **Do not touch** `vite.config.ts`, `src/App.tsx`, `src/main.tsx`, `src/integrations/supabase/client.ts`, `src/lib/queryPersist.ts`, `public/sw.js` or `vercel.json`.
- **Git:**
  - Work in the worktree on `feat/dashboard-action-cards`, committing as the repo's configured author (Kavach), with every commit message ending in `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
  - **Never push.** Pushing `main` deploys production, and that is Tushar's call.
  - Never stage `supabase/.temp/cli-latest`, `.agents/`, `.claude/settings.json`, `.claude/skills/minimalist-ui/`, `.claude/skills/shadcn/`, `.claude/skills/web-design-guidelines/` or `skills-lock.json`.
- **Never open `.env`.** Task 0 copies it into the worktree without reading it; it holds only public `VITE_` values.
- **Every command in Tasks 1 to 7 runs in the worktree** `D:\Salci Projects\Salci-Main-Portal\_wt-action-cards`, except the steps that say "from the main checkout" (Task 0, Task 7 step 10) or "from the harness folder". Shells do not keep a folder between calls (a subagent's start in the main checkout), so:
  - start every Git Bash command with `cd "/d/Salci Projects/Salci-Main-Portal/_wt-action-cards" &&`;
  - start every PowerShell block with `Set-Location -LiteralPath 'D:\Salci Projects\Salci-Main-Portal\_wt-action-cards'`;
  - give Read, Edit and Write absolute worktree paths;
  - before every commit, `git branch --show-current` must print `feat/dashboard-action-cards`.
  Running anything in the main checkout by mistake edits what Tushar's localhost:8080 serves and commits straight onto `main`.
- **The stale-import pass has 7 errors before any change**, all in files Task 6 touches. They are out of scope (§5a): leave them alone, and treat any OTHER error as yours. The 7 are:
  - `RoleBasedDashboard.tsx`: `schoolAdminNavGroups` (55:7), `user` (202:11)
  - `SchoolAdminCommandCenter.tsx`: `Avatar` (10:10), `AvatarFallback` (10:18), `Badge` (11:10), `featuresLoading` (176:40), `initials` (184:9)

## Review Focus

These are the conditions the spec implies but no ordinary unit test would hit, most likely first. Each line names the step that pins it.

1. **The next morning, or a dashboard left open across midnight:** yesterday's cards or yesterday's check-out button must never show.
   - Task 2 tests `schoolClock` across the IST midnight.
   - Task 1 check 29 has `refresh_in_s` land on the school's midnight, and check 19 has 00:30 IST (still the previous UTC day) carry the school's date.
   - Task 4 adds the date to the greeting button's key.
   - Task 7 step 7 asserts that both persisted keys, the cards' and the greeting button's, end with today.
2. **A double tap on Check in or Check out:** one request, one row.
   - Task 4 adds the single-flight refs and drops the card from the cached answer on success.
   - Task 7 step 6 fires two clicks in one task, before React can re-render or disable the button, and asserts exactly one POST for check-in and one PATCH for check-out.
3. **Scope must never widen** (a teacher asking for the admin view, a coordinator with no wing, admin plus coordinator, teacher plus coordinator in the teacher view).
   - Task 1 SQL checks:
     - 8 to 11: view narrowing;
     - 36 and 52: the pass is never due in a teacher view;
     - 51 to 54: teacher plus coordinator, admin plus coordinator;
     - 55: no wing;
     - 58: the wrapper takes the caller from the JWT.
   - Task 6 passes each dashboard's own view.
   - Task 7 step 5 asserts that the `p_view` each of the three dashboards sends is its own view.
   - Task 7 step 8 checks the real request and answer per profile.
4. **A failed or malformed answer must show the error card with Retry, never the banner or old cards.**
   - Task 2: `parseDashboardActions` throws on a non-object and on an unknown version.
   - Task 7 step 5: a stubbed 500 shows "Couldn't load your day", the greeting button stays, and, with the dev `?banner3d=force` making that check able to fail, the 3D engine is never requested while cards or the error card show.
   - Task 7 step 6: a refresh that fails AFTER a good answer shows the error card, not the old cards.
5. **Long text and up to three cards at every width:** no horizontal page scroll, text truncates inside its card, the dots stay tappable and the box stays at the banner's height.
   - Task 7 step 5 runs the "long" stub at 375, 768, 1024 and 1440.
   - It asserts that every title, detail and button lies inside its card's rectangle, and that `elementFromPoint` at each dot's centre hits that dot.

---

## Task 0: Start the work (docs commit, worktree)

**Files:**
- Commit: `docs/superpowers/specs/2026-10-03-dashboard-action-cards-design.md`, `docs/superpowers/plans/2026-10-03-dashboard-action-cards.md`

- [ ] **Step 1: Commit the spec and this plan on main (docs only; safe if another session pushes main)**

Run in PowerShell from the main checkout `D:\Salci Projects\Salci-Main-Portal\salci-eco-core-main`:

```powershell
Set-Location -LiteralPath 'D:\Salci Projects\Salci-Main-Portal\salci-eco-core-main'
git add -- docs/superpowers/specs/2026-10-03-dashboard-action-cards-design.md docs/superpowers/plans/2026-10-03-dashboard-action-cards.md
# The pathspec keeps this commit docs-only even if another session staged something.
git commit -m @'
docs: dashboard action cards spec and plan

Check-in, substitution, leave and check-out cards replace the dashboard
banner when the signed-in person has something to do today.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
'@ -- docs/superpowers/specs/2026-10-03-dashboard-action-cards-design.md docs/superpowers/plans/2026-10-03-dashboard-action-cards.md
git status --short
```

Expected: one commit. `git status --short` still lists only:
- the other sessions' untracked tooling: `.agents/`, `.claude/settings.json`, `.claude/skills/...` and `skills-lock.json`;
- the modified CLI cache `supabase/.temp/cli-latest`.

- [ ] **Step 2: Create the worktree with its OWN node_modules and the env file**

The worktree does NOT share `node_modules` through a junction. Sharing it has two failure modes:
- `git worktree remove` (git 2.50) follows the junction and deletes main's packages, and a PowerShell 5.1 `Remove-Item` on the junction prompts and fails in a non-interactive shell, so the removal does not happen first;
- a second Vite dev server rewrites main's `node_modules/.vite` cache under Tushar's running 8080 server.

A real install avoids both.

```powershell
Set-Location -LiteralPath 'D:\Salci Projects\Salci-Main-Portal\salci-eco-core-main'
git worktree add "D:\Salci Projects\Salci-Main-Portal\_wt-action-cards" -b feat/dashboard-action-cards
# Copy WITHOUT opening it (public VITE_ values only); the dev server and the client need it.
Copy-Item -LiteralPath "D:\Salci Projects\Salci-Main-Portal\salci-eco-core-main\.env" -Destination "D:\Salci Projects\Salci-Main-Portal\_wt-action-cards\.env"
Set-Location -LiteralPath 'D:\Salci Projects\Salci-Main-Portal\_wt-action-cards'
npm ci --prefer-offline --no-audit --no-fund
git branch --show-current
(Get-Item "D:\Salci Projects\Salci-Main-Portal\_wt-action-cards\node_modules").LinkType
```

Expected:
- `npm ci` finishes. If it fails with EPERM, find the stray `esbuild.exe`/`vite` in `Get-CimInstance Win32_Process`, but never stop Tushar's own 8080 server without asking.
- `feat/dashboard-action-cards` is printed.
- The last line prints nothing, because this is a real folder and not a link.

All later tasks run inside `D:\Salci Projects\Salci-Main-Portal\_wt-action-cards` (Global Constraints).

---

## Task 1: The read-only RPC `my_dashboard_actions`

**Files:**
- Create: `supabase/migrations/20261003120000_my_dashboard_actions.sql`
- Create: `scripts/test-dashboard-actions.sql`
- Modify: `src/integrations/supabase/types.ts` (one entry between `mark_support_ticket_read` and `my_optional_slot_choices`, about line 15007)
- Modify: `src/hooks/dashboard/useCoord.ts:326` (one cast; without it the new entry tips `npm run typecheck` into TS2589)

**Interfaces:**
- Consumes (verified live on prod 2026-10-03):
  - `get_user_institution(uuid) → uuid`
  - `is_super_admin(uuid) → boolean`
  - `is_institution_admin(uuid, uuid) → boolean`
  - `_staff_leave_workdays(uuid, date, date) → SETOF date`
  - `student_in_class(uuid, uuid) → boolean`
  - `can_review_staff_leave(uuid, uuid, uuid) → boolean`
  - `tt_dow_to_text(date)` (test only)
- Produces: `public.my_dashboard_actions(p_view text DEFAULT NULL) RETURNS jsonb`, callable by `authenticated` only. It returns:
  ```json
  {"v":1,"date":"YYYY-MM-DD","view":"admin|coordinator|teacher|null",
   "check_in":{"state":"due|absent","by":"HH:MM","until":"HH:MM"}|null,
   "cover":{"pending":n,"next":{"label":"…","class_name":"…","section":"…|null","start":"HH:MM"}}|null,
   "leave":{"students":n,"staff":n,"oldest_days":n}|null,
   "check_out":{"record_id":"uuid","since":"HH:MM"}|null,
   "pass_due":bool,"refresh_in_s":n|null}
  ```
  It also produces the owner-only twin `public._my_dashboard_actions(p_uid uuid, p_view text, p_now timestamptz)`.

- [ ] **Step 1: Write the acceptance suite (it fails until the functions exist)**

Create `scripts/test-dashboard-actions.sql`:

```sql
-- Dashboard action cards acceptance suite: my_dashboard_actions / _my_dashboard_actions
-- (migration 20261003120000). Uses real prod people and periods on a FUTURE working day
-- (nobody writes future-dated attendance, covers or holidays), pins the clock through the
-- private twin, then rolls everything back. Assertions RECORD instead of raising, so one
-- failure cannot hide the rest; counts that prod may already hold are checked as deltas.
-- Run: powershell -File scripts/run-sql.ps1 -SqlFile scripts/test-dashboard-actions.sql -OutFile "$env:TEMP\actions.json"
BEGIN;

CREATE TEMP TABLE t_out(n serial, result text, label text, detail text);
GRANT ALL ON t_out TO PUBLIC;
GRANT USAGE ON SEQUENCE t_out_n_seq TO PUBLIC;

CREATE FUNCTION pg_temp.chk(p_pass boolean, p_label text, p_detail text DEFAULT '')
RETURNS void LANGUAGE plpgsql AS $chk$
BEGIN
  INSERT INTO t_out(result, label, detail)
  VALUES (CASE WHEN coalesce(p_pass, false) THEN 'PASS' ELSE 'FAIL' END, p_label, p_detail);
END $chk$;

CREATE FUNCTION pg_temp.skip(p_label text, p_detail text DEFAULT '')
RETURNS void LANGUAGE plpgsql AS $skip$
BEGIN
  INSERT INTO t_out(result, label, detail) VALUES ('SKIP', p_label, p_detail);
END $skip$;

CREATE FUNCTION pg_temp.as_user(p_uid uuid)
RETURNS void LANGUAGE plpgsql AS $as$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END $as$;

-- The school's wall clock on day d at time t, as the timestamptz the twin receives.
CREATE FUNCTION pg_temp.at_local(p_tz text, p_d date, p_t time)
RETURNS timestamptz LANGUAGE sql AS $at$ SELECT (p_d + p_t) AT TIME ZONE p_tz $at$;

CREATE FUNCTION pg_temp.no_cards(js jsonb)
RETURNS boolean LANGUAGE sql AS $nc$
  SELECT js->>'check_in' IS NULL AND js->>'cover' IS NULL AND js->>'leave' IS NULL AND js->>'check_out' IS NULL
$nc$;

DO $test$
DECLARE
  v_inst uuid; v_tz text; v_slot uuid; v_class uuid; v_t0 uuid; v_day text; v_ay text;
  v_start time; v_end time; v_label text; v_class_name text;
  v_admin uuid; v_teacher uuid; v_coord uuid; v_wing uuid; v_student uuid; v_other_student uuid;
  v_d date; v_e date; v_row uuid; v_txt text; v_js jsonb;
  v_t_students int; v_c_students int; v_a_staff int; v_c_staff int;
BEGIN
  -- ── 1. grants and source ───────────────────────────────────────────────
  PERFORM pg_temp.chk(to_regprocedure('public.my_dashboard_actions(text)') IS NOT NULL
                  AND to_regprocedure('public._my_dashboard_actions(uuid,text,timestamp with time zone)') IS NOT NULL,
    'both functions exist');
  PERFORM pg_temp.chk(NOT has_function_privilege('anon', 'public.my_dashboard_actions(text)', 'EXECUTE'),
    'anon cannot call my_dashboard_actions');
  PERFORM pg_temp.chk(has_function_privilege('authenticated', 'public.my_dashboard_actions(text)', 'EXECUTE'),
    'authenticated can call my_dashboard_actions');
  PERFORM pg_temp.chk(NOT has_function_privilege('anon', 'public._my_dashboard_actions(uuid,text,timestamp with time zone)', 'EXECUTE')
                  AND NOT has_function_privilege('authenticated', 'public._my_dashboard_actions(uuid,text,timestamp with time zone)', 'EXECUTE'),
    'nobody but the owner can call the twin');
  PERFORM pg_temp.chk(
    (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = 'public.my_dashboard_actions(text)'::regprocedure)
    AND NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = 'public._my_dashboard_actions(uuid,text,timestamp with time zone)'::regprocedure),
    'the wrapper is SECURITY DEFINER, the twin is not');
  SELECT p.prosrc INTO v_txt FROM pg_proc p
   WHERE p.oid = 'public._my_dashboard_actions(uuid,text,timestamp with time zone)'::regprocedure;
  PERFORM pg_temp.chk(v_txt NOT ILIKE '%now()%' AND v_txt NOT ILIKE '%current_date%'
                  AND v_txt NOT ILIKE '%''UTC''%' AND v_txt NOT ILIKE '%auth.uid%',
    'the twin reads only the caller and clock it is given');

  -- ── fixture ────────────────────────────────────────────────────────────
  -- A timetabled period (between 09:00 and 15:00) in a school that has a plain school admin,
  -- a student in that class and a second plain teacher of that class; prefer a school with a
  -- plain coordinator who holds a wing there.
  SELECT s.id, s.institution_id, s.class_id, s.teacher_id, s.day, s.academic_year,
         ps.start_time, ps.end_time, ps.label, c.name, COALESCE(i.timezone, 'Asia/Kolkata')
    INTO v_slot, v_inst, v_class, v_t0, v_day, v_ay, v_start, v_end, v_label, v_class_name, v_tz
    FROM public.tt_slots s
    JOIN public.tt_period_slots ps ON ps.id = s.period_slot_id
    JOIN public.classes c ON c.id = s.class_id AND COALESCE(c.is_active, true)
    JOIN public.institutions i ON i.id = s.institution_id
   WHERE s.teacher_id IS NOT NULL
     AND s.slot_type NOT IN ('free', 'break')
     AND ps.start_time >= time '09:00' AND ps.end_time <= time '15:00'
     AND EXISTS (SELECT 1 FROM public.user_roles ur
                  WHERE ur.institution_id = s.institution_id AND ur.role = 'school_admin'
                    AND NOT public.is_super_admin(ur.user_id)
                    AND public.get_user_institution(ur.user_id) = s.institution_id
                    AND NOT EXISTS (SELECT 1 FROM public.user_roles x
                                     WHERE x.user_id = ur.user_id AND x.role IN ('teacher', 'coordinator')))
     AND EXISTS (SELECT 1 FROM public.class_assignments st WHERE st.class_id = s.class_id AND st.role = 'student')
     AND EXISTS (SELECT 1 FROM public.class_assignments ta
                  WHERE ta.class_id = s.class_id AND ta.role = 'teacher' AND ta.user_id <> s.teacher_id
                    AND public.get_user_institution(ta.user_id) = s.institution_id
                    AND EXISTS (SELECT 1 FROM public.user_roles r
                                 WHERE r.user_id = ta.user_id AND r.institution_id = s.institution_id AND r.role = 'teacher')
                    AND NOT EXISTS (SELECT 1 FROM public.user_roles x
                                     WHERE x.user_id = ta.user_id
                                       AND x.role IN ('school_admin', 'super_school_admin', 'coordinator', 'super_admin')))
   ORDER BY EXISTS (SELECT 1 FROM public.user_roles ur
                      JOIN public.wing_assignments wa ON wa.user_id = ur.user_id
                      JOIN public.wings w ON w.id = wa.wing_id AND w.institution_id = s.institution_id
                     WHERE ur.institution_id = s.institution_id AND ur.role = 'coordinator'
                       AND NOT EXISTS (SELECT 1 FROM public.user_roles x
                                        WHERE x.user_id = ur.user_id
                                          AND x.role IN ('teacher', 'school_admin', 'super_school_admin', 'super_admin'))) DESC,
            s.id
   LIMIT 1;

  IF v_slot IS NULL THEN
    PERFORM pg_temp.skip('fixture', 'no school has a plain admin, a timetabled period and a second plain teacher');
    RETURN;
  END IF;

  SELECT ur.user_id INTO v_admin FROM public.user_roles ur
   WHERE ur.institution_id = v_inst AND ur.role = 'school_admin'
     AND NOT public.is_super_admin(ur.user_id)
     AND public.get_user_institution(ur.user_id) = v_inst
     AND NOT EXISTS (SELECT 1 FROM public.user_roles x WHERE x.user_id = ur.user_id AND x.role IN ('teacher', 'coordinator'))
   ORDER BY ur.user_id LIMIT 1;
  SELECT ta.user_id INTO v_teacher FROM public.class_assignments ta
   WHERE ta.class_id = v_class AND ta.role = 'teacher' AND ta.user_id <> v_t0
     AND public.get_user_institution(ta.user_id) = v_inst
     AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = ta.user_id AND r.institution_id = v_inst AND r.role = 'teacher')
     AND NOT EXISTS (SELECT 1 FROM public.user_roles x WHERE x.user_id = ta.user_id
                      AND x.role IN ('school_admin', 'super_school_admin', 'coordinator', 'super_admin'))
   ORDER BY ta.user_id LIMIT 1;
  SELECT st.user_id INTO v_student FROM public.class_assignments st
   WHERE st.class_id = v_class AND st.role = 'student' ORDER BY st.user_id LIMIT 1;
  SELECT ur.user_id INTO v_other_student FROM public.user_roles ur
   WHERE ur.institution_id = v_inst AND ur.role = 'student' AND NOT public.student_in_class(ur.user_id, v_class)
   ORDER BY ur.user_id LIMIT 1;
  SELECT ur.user_id, wa.wing_id INTO v_coord, v_wing
    FROM public.user_roles ur
    JOIN public.wing_assignments wa ON wa.user_id = ur.user_id
    JOIN public.wings w ON w.id = wa.wing_id AND w.institution_id = v_inst
   WHERE ur.institution_id = v_inst AND ur.role = 'coordinator'
     AND public.get_user_institution(ur.user_id) = v_inst
     AND NOT EXISTS (SELECT 1 FROM public.user_roles x WHERE x.user_id = ur.user_id
                      AND x.role IN ('teacher', 'school_admin', 'super_school_admin', 'super_admin'))
   ORDER BY ur.user_id, wa.wing_id LIMIT 1;

  -- The test day: the first working day after today that falls on the period's weekday.
  SELECT d INTO v_d
    FROM public._staff_leave_workdays(v_inst, (now() AT TIME ZONE v_tz)::date + 1, (now() AT TIME ZONE v_tz)::date + 21) AS d
   WHERE public.tt_dow_to_text(d) = v_day
   ORDER BY d LIMIT 1;

  PERFORM pg_temp.chk(v_admin IS NOT NULL AND v_teacher IS NOT NULL AND v_student IS NOT NULL AND v_d IS NOT NULL,
    'fixture found', format('inst=%s day=%s period=%s %s-%s class=%s admin=%s teacher=%s coord=%s student=%s',
      v_inst, v_d, v_label, v_start, v_end, v_class_name, v_admin, v_teacher, v_coord, v_student));
  IF v_admin IS NULL OR v_teacher IS NULL OR v_student IS NULL OR v_d IS NULL THEN
    RETURN;
  END IF;

  -- Known settings for the school (rolled back): 08:00 to 16:00, 30 minutes of grace.
  INSERT INTO public.attendance_settings (institution_id, staff_check_in_time, staff_check_out_time,
                                          staff_late_check_in_allowed, staff_late_grace_minutes)
  VALUES (v_inst, time '08:00', time '16:00', true, 30)
  ON CONFLICT (institution_id) DO UPDATE
    SET staff_check_in_time = EXCLUDED.staff_check_in_time,
        staff_check_out_time = EXCLUDED.staff_check_out_time,
        staff_late_check_in_allowed = EXCLUDED.staff_late_check_in_allowed,
        staff_late_grace_minutes = EXCLUDED.staff_late_grace_minutes;

  -- Clean slate on the test day (an approved leave may already have written on_leave rows).
  DELETE FROM public.staff_attendance_records WHERE institution_id = v_inst AND date = v_d;
  DELETE FROM public.tt_substitutions t USING public.tt_slots s
   WHERE s.id = t.slot_id AND s.institution_id = v_inst AND t.date = v_d;

  -- ── 2. view resolution: p_view can only narrow ─────────────────────────
  v_js := public._my_dashboard_actions(v_teacher, 'admin', pg_temp.at_local(v_tz, v_d, time '07:00'));
  PERFORM pg_temp.chk(v_js->>'view' = 'teacher', 'a teacher asking for the admin view gets the teacher view', v_js->>'view');
  v_js := public._my_dashboard_actions(v_admin, 'teacher', pg_temp.at_local(v_tz, v_d, time '07:00'));
  PERFORM pg_temp.chk(v_js->>'view' = 'admin', 'an admin who does not teach gets the admin view', v_js->>'view');
  IF v_coord IS NOT NULL THEN
    v_js := public._my_dashboard_actions(v_coord, NULL, pg_temp.at_local(v_tz, v_d, time '07:00'));
    PERFORM pg_temp.chk(v_js->>'view' = 'coordinator', 'a coordinator with no view asked gets the coordinator view', v_js->>'view');
    v_js := public._my_dashboard_actions(v_coord, 'admin', pg_temp.at_local(v_tz, v_d, time '07:00'));
    PERFORM pg_temp.chk(v_js->>'view' = 'coordinator', 'a coordinator asking for the admin view stays coordinator', v_js->>'view');
  ELSE
    PERFORM pg_temp.skip('coordinator view resolution', 'no plain coordinator with a wing in the fixture school');
  END IF;

  -- ── 3. empty answers ───────────────────────────────────────────────────
  v_js := public._my_dashboard_actions(NULL, 'teacher', pg_temp.at_local(v_tz, v_d, time '07:00'));
  PERFORM pg_temp.chk(pg_temp.no_cards(v_js) AND v_js->>'view' IS NULL, 'no caller: no cards', v_js::text);
  v_js := public._my_dashboard_actions(v_student, 'teacher', pg_temp.at_local(v_tz, v_d, time '07:00'));
  PERFORM pg_temp.chk(pg_temp.no_cards(v_js) AND v_js->>'view' IS NULL, 'a student: no cards', v_js::text);
  -- Prod's only super admin has no school, which would short-circuit before the super-admin
  -- test; give the plain admin (who has one) the role for a moment instead (rolled back).
  INSERT INTO public.user_roles (user_id, role, institution_id) VALUES (v_admin, 'super_admin', NULL);
  v_js := public._my_dashboard_actions(v_admin, 'admin', pg_temp.at_local(v_tz, v_d, time '07:00'));
  PERFORM pg_temp.chk(pg_temp.no_cards(v_js) AND v_js->>'view' IS NULL, 'a super admin who has a school: no cards', v_js::text);
  DELETE FROM public.user_roles WHERE user_id = v_admin AND role = 'super_admin';

  -- ── 4. check-in and check-out ──────────────────────────────────────────
  v_js := public._my_dashboard_actions(v_teacher, 'teacher', pg_temp.at_local(v_tz, v_d, time '07:00'));
  PERFORM pg_temp.chk(v_js->'check_in'->>'state' = 'due' AND v_js->'check_in'->>'by' = '08:00'
                  AND v_js->'check_in'->>'until' = '16:00',
    'no row before check-in time: due, by 08:00, until 16:00', v_js->>'check_in');
  PERFORM pg_temp.chk(v_js->>'date' = to_char(v_d, 'YYYY-MM-DD'), 'the answer carries the school''s date', v_js->>'date');
  PERFORM pg_temp.chk((v_js->>'refresh_in_s')::int = 32400, 'refresh lands on check-out time, nine hours away', v_js->>'refresh_in_s');
  PERFORM pg_temp.chk(v_js->>'cover' IS NULL, 'teacher view before any check-in: no cover', v_js::text);
  v_js := public._my_dashboard_actions(v_teacher, 'teacher', pg_temp.at_local(v_tz, v_d, time '00:30'));
  PERFORM pg_temp.chk(v_js->>'date' = to_char(v_d, 'YYYY-MM-DD'),
    'just after the school''s midnight (still the previous UTC day): the school''s date', v_js->>'date');
  v_js := public._my_dashboard_actions(v_teacher, 'teacher', pg_temp.at_local(v_tz, v_d, time '10:00'));
  PERFORM pg_temp.chk(v_js->'check_in'->>'state' = 'due', 'still due when late', v_js->>'check_in');
  v_js := public._my_dashboard_actions(v_teacher, 'teacher', pg_temp.at_local(v_tz, v_d, time '16:00'));
  PERFORM pg_temp.chk(v_js->>'check_in' IS NULL, 'gone at check-out time', v_js->>'check_in');

  INSERT INTO public.staff_attendance_records (institution_id, staff_id, date, status, auto_marked_absent)
  VALUES (v_inst, v_teacher, v_d, 'absent', true) RETURNING id INTO v_row;
  v_js := public._my_dashboard_actions(v_teacher, 'teacher', pg_temp.at_local(v_tz, v_d, time '09:00'));
  PERFORM pg_temp.chk(v_js->'check_in'->>'state' = 'absent', 'auto-marked absent: the card says so', v_js->>'check_in');
  UPDATE public.staff_attendance_records SET auto_marked_absent = false WHERE id = v_row;
  v_js := public._my_dashboard_actions(v_teacher, 'teacher', pg_temp.at_local(v_tz, v_d, time '09:00'));
  PERFORM pg_temp.chk(v_js->'check_in'->>'state' = 'absent', 'admin-marked absent: the same card', v_js->>'check_in');
  UPDATE public.staff_attendance_records SET status = 'on_leave' WHERE id = v_row;
  v_js := public._my_dashboard_actions(v_teacher, 'teacher', pg_temp.at_local(v_tz, v_d, time '09:00'));
  PERFORM pg_temp.chk(v_js->>'check_in' IS NULL AND v_js->>'check_out' IS NULL, 'on leave: no check-in, no check-out', v_js::text);

  UPDATE public.staff_attendance_records
     SET status = 'present', check_in_at = pg_temp.at_local(v_tz, v_d, time '08:05')
   WHERE id = v_row;
  v_js := public._my_dashboard_actions(v_teacher, 'teacher', pg_temp.at_local(v_tz, v_d, time '15:59'));
  PERFORM pg_temp.chk(v_js->>'check_in' IS NULL AND v_js->>'check_out' IS NULL, 'checked in, before check-out time: nothing', v_js::text);
  PERFORM pg_temp.chk((v_js->>'refresh_in_s')::int = 60, 'checked in: refresh lands on check-out time', v_js->>'refresh_in_s');
  v_js := public._my_dashboard_actions(v_teacher, 'teacher', pg_temp.at_local(v_tz, v_d, time '16:00'));
  PERFORM pg_temp.chk(v_js->'check_out'->>'record_id' = v_row::text AND v_js->'check_out'->>'since' = '16:00',
    'at check-out time: a check-out card for today''s row', v_js->>'check_out');
  UPDATE public.staff_attendance_records SET check_out_at = pg_temp.at_local(v_tz, v_d, time '16:10') WHERE id = v_row;
  v_js := public._my_dashboard_actions(v_teacher, 'teacher', pg_temp.at_local(v_tz, v_d, time '16:20'));
  PERFORM pg_temp.chk(v_js->>'check_out' IS NULL, 'checked out: the card is gone', v_js->>'check_out');
  DELETE FROM public.staff_attendance_records WHERE id = v_row;

  v_js := public._my_dashboard_actions(v_teacher, 'teacher', pg_temp.at_local(v_tz, v_d, time '23:30'));
  PERFORM pg_temp.chk((v_js->>'refresh_in_s')::int = 1800, 'late evening: refresh at the school''s midnight', v_js->>'refresh_in_s');

  INSERT INTO public.cal_events (institution_id, academic_year, title, kind, starts_on, ends_on)
  VALUES (v_inst, v_ay, 'Action cards test holiday', 'holiday', v_d, v_d);
  v_js := public._my_dashboard_actions(v_teacher, 'teacher', pg_temp.at_local(v_tz, v_d, time '07:00'));
  PERFORM pg_temp.chk(v_js->>'check_in' IS NULL, 'holiday: no check-in card', v_js->>'check_in');
  v_js := public._my_dashboard_actions(v_admin, 'admin', pg_temp.at_local(v_tz, v_d, time '09:00'));
  PERFORM pg_temp.chk((v_js->>'pass_due')::boolean IS FALSE, 'holiday: the attendance pass is not due', v_js->>'pass_due');
  DELETE FROM public.cal_events WHERE institution_id = v_inst AND title = 'Action cards test holiday';

  SELECT g::date INTO v_e
    FROM generate_series((now() AT TIME ZONE v_tz)::date + 1, (now() AT TIME ZONE v_tz)::date + 14, interval '1 day') AS g
   WHERE NOT EXISTS (SELECT 1 FROM public._staff_leave_workdays(v_inst, g::date, g::date))
   ORDER BY 1 LIMIT 1;
  IF v_e IS NULL THEN
    PERFORM pg_temp.skip('non-working day: no check-in card', 'the school works every day of the next two weeks');
  ELSE
    v_js := public._my_dashboard_actions(v_teacher, 'teacher', pg_temp.at_local(v_tz, v_e, time '07:00'));
    PERFORM pg_temp.chk(v_js->>'check_in' IS NULL, 'non-working day: no check-in card', format('%s %s', v_e, v_js->>'check_in'));
  END IF;

  -- ── 5. pass_due ────────────────────────────────────────────────────────
  v_js := public._my_dashboard_actions(v_admin, 'admin', pg_temp.at_local(v_tz, v_d, time '08:29'));
  PERFORM pg_temp.chk((v_js->>'pass_due')::boolean IS FALSE, 'before check-in time + grace: pass not due', v_js->>'pass_due');
  PERFORM pg_temp.chk((v_js->>'refresh_in_s')::int = 60, 'admin before the cutoff: refresh lands on the cutoff', v_js->>'refresh_in_s');
  v_js := public._my_dashboard_actions(v_admin, 'admin', pg_temp.at_local(v_tz, v_d, time '08:31'));
  PERFORM pg_temp.chk((v_js->>'pass_due')::boolean IS TRUE, 'after check-in time + grace: pass due for the admin view', v_js->>'pass_due');
  v_js := public._my_dashboard_actions(v_teacher, 'teacher', pg_temp.at_local(v_tz, v_d, time '08:31'));
  PERFORM pg_temp.chk((v_js->>'pass_due')::boolean IS FALSE, 'teacher view after the cutoff: the pass is never due', v_js->>'pass_due');
  IF v_coord IS NOT NULL THEN
    v_js := public._my_dashboard_actions(v_coord, 'coordinator', pg_temp.at_local(v_tz, v_d, time '08:31'));
    PERFORM pg_temp.chk((v_js->>'pass_due')::boolean IS TRUE, 'coordinator view after the cutoff: the pass is due', v_js->>'pass_due');
  END IF;

  -- ── 6. cover ───────────────────────────────────────────────────────────
  INSERT INTO public.tt_substitutions (slot_id, date, original_teacher_id, status, source)
  VALUES (v_slot, v_d, v_t0, 'pending', 'auto');
  v_js := public._my_dashboard_actions(v_admin, 'admin', pg_temp.at_local(v_tz, v_d, v_start - interval '1 minute'));
  PERFORM pg_temp.chk(v_js->>'cover' IS NULL, 'no staff check-in that day: no cover card', v_js->>'cover');

  INSERT INTO public.staff_attendance_records (institution_id, staff_id, date, check_in_at, status)
  VALUES (v_inst, v_admin, v_d, pg_temp.at_local(v_tz, v_d, time '07:55'), 'present');
  v_js := public._my_dashboard_actions(v_admin, 'admin', pg_temp.at_local(v_tz, v_d, v_start - interval '1 minute'));
  PERFORM pg_temp.chk((v_js->'cover'->>'pending')::int = 1
                  AND v_js->'cover'->'next'->>'label' = v_label
                  AND v_js->'cover'->'next'->>'class_name' = v_class_name
                  AND v_js->'cover'->'next'->>'start' = to_char(v_start, 'HH24:MI'),
    'admin: the pending period, with its label, class and start', v_js->>'cover');
  PERFORM pg_temp.chk((v_js->>'refresh_in_s')::int <= extract(epoch FROM (v_end - (v_start - interval '1 minute')))::int,
    'refresh no later than the open period''s end', v_js->>'refresh_in_s');
  v_js := public._my_dashboard_actions(v_admin, 'admin', pg_temp.at_local(v_tz, v_d, v_end));
  PERFORM pg_temp.chk(v_js->>'cover' IS NULL, 'the period is over: no longer counted', v_js->>'cover');
  v_js := public._my_dashboard_actions(v_teacher, 'teacher', pg_temp.at_local(v_tz, v_d, v_start - interval '1 minute'));
  PERFORM pg_temp.chk(v_js->>'cover' IS NULL, 'teacher view: never a cover card', v_js->>'cover');

  IF v_coord IS NOT NULL THEN
    INSERT INTO public.wing_class_mappings (wing_id, class_id) VALUES (v_wing, v_class)
    ON CONFLICT (wing_id, class_id) DO NOTHING;
    v_js := public._my_dashboard_actions(v_coord, 'coordinator', pg_temp.at_local(v_tz, v_d, v_start - interval '1 minute'));
    PERFORM pg_temp.chk((v_js->'cover'->>'pending')::int = 1, 'coordinator: a pending period in their wing counts', v_js->>'cover');
  ELSE
    PERFORM pg_temp.skip('coordinator cover', 'no plain coordinator with a wing in the fixture school');
  END IF;

  -- ── 7. leave (deltas: prod may already hold pending requests) ──────────
  v_js := public._my_dashboard_actions(v_teacher, 'teacher', pg_temp.at_local(v_tz, v_d, time '09:00'));
  v_t_students := COALESCE((v_js->'leave'->>'students')::int, 0);
  v_js := public._my_dashboard_actions(v_admin, 'admin', pg_temp.at_local(v_tz, v_d, time '09:00'));
  v_a_staff := COALESCE((v_js->'leave'->>'staff')::int, 0);
  IF v_coord IS NOT NULL THEN
    v_js := public._my_dashboard_actions(v_coord, 'coordinator', pg_temp.at_local(v_tz, v_d, time '09:00'));
    v_c_students := COALESCE((v_js->'leave'->>'students')::int, 0);
    v_c_staff := COALESCE((v_js->'leave'->>'staff')::int, 0);
  END IF;

  INSERT INTO public.leave_requests (institution_id, student_id, class_id, leave_type, start_date, end_date,
                                     reason, status, source, created_at)
  VALUES (v_inst, v_student, v_class, 'sick', v_d, v_d, 'action cards test', 'pending', 'student',
          pg_temp.at_local(v_tz, v_d, time '09:00') - interval '3 days');
  IF v_other_student IS NOT NULL THEN
    -- a request filed against this class by a student who is not (or no longer) in it
    INSERT INTO public.leave_requests (institution_id, student_id, class_id, leave_type, start_date, end_date,
                                       reason, status, source)
    VALUES (v_inst, v_other_student, v_class, 'sick', v_d, v_d, 'action cards test stranded', 'pending', 'student');
  END IF;
  INSERT INTO public.staff_leave_requests (institution_id, user_id, leave_type, start_date, end_date, reason, status)
  VALUES (v_inst, v_teacher, 'casual', v_d, v_d, 'action cards test', 'pending'),
         (v_inst, v_admin, 'casual', v_d, v_d, 'action cards test own', 'pending');

  v_js := public._my_dashboard_actions(v_teacher, 'teacher', pg_temp.at_local(v_tz, v_d, time '09:00'));
  PERFORM pg_temp.chk((v_js->'leave'->>'students')::int = v_t_students + 1,
    'teacher: their section''s pending leave counts once; a stranded request does not',
    format('%s -> %s', v_t_students, v_js->>'leave'));
  PERFORM pg_temp.chk((v_js->'leave'->>'oldest_days')::int >= 3, 'oldest waiting covers the request filed 3 days ago', v_js->>'leave');
  PERFORM pg_temp.chk((v_js->'leave'->>'staff')::int = 0, 'teacher: never staff leave', v_js->>'leave');

  v_js := public._my_dashboard_actions(v_admin, 'admin', pg_temp.at_local(v_tz, v_d, time '09:00'));
  PERFORM pg_temp.chk(COALESCE((v_js->'leave'->>'students')::int, 0) = 0, 'admin: never student leave (owner, 2026-10-03)', v_js->>'leave');
  PERFORM pg_temp.chk((v_js->'leave'->>'staff')::int = v_a_staff + 1,
    'admin: a teacher''s pending leave counts, their own does not', format('%s -> %s', v_a_staff, v_js->>'leave'));

  IF v_coord IS NOT NULL THEN
    v_js := public._my_dashboard_actions(v_coord, 'coordinator', pg_temp.at_local(v_tz, v_d, time '09:00'));
    PERFORM pg_temp.chk((v_js->'leave'->>'students')::int = v_c_students + 1,
      'coordinator: their wing''s pending student leave counts', format('%s -> %s', v_c_students, v_js->>'leave'));
    PERFORM pg_temp.chk((v_js->'leave'->>'staff')::int = v_c_staff + 1,
      'coordinator: a wing teacher''s leave counts, an admin''s does not', format('%s -> %s', v_c_staff, v_js->>'leave'));

    -- Dual roles are never unioned (§25): the wing coordinator also teaches (rolled back).
    INSERT INTO public.user_roles (user_id, role, institution_id) VALUES (v_coord, 'teacher', v_inst);
    v_js := public._my_dashboard_actions(v_coord, NULL, pg_temp.at_local(v_tz, v_d, v_start - interval '1 minute'));
    PERFORM pg_temp.chk(v_js->>'view' = 'teacher', 'teacher+coordinator: the default view is teacher', v_js->>'view');
    v_js := public._my_dashboard_actions(v_coord, 'teacher', pg_temp.at_local(v_tz, v_d, v_start - interval '1 minute'));
    PERFORM pg_temp.chk(v_js->>'cover' IS NULL AND COALESCE((v_js->'leave'->>'staff')::int, 0) = 0
                    AND (v_js->>'pass_due')::boolean IS FALSE,
      'teacher+coordinator in the teacher view: no wing cover, no staff leave, no pass kick', v_js::text);
    v_js := public._my_dashboard_actions(v_coord, 'coordinator', pg_temp.at_local(v_tz, v_d, v_start - interval '1 minute'));
    PERFORM pg_temp.chk(v_js->>'view' = 'coordinator' AND (v_js->'cover'->>'pending')::int = 1
                    AND (v_js->'leave'->>'staff')::int = v_c_staff + 1,
      'teacher+coordinator in the coordinator view: the wing scope', v_js::text);
    DELETE FROM public.user_roles WHERE user_id = v_coord AND role = 'teacher' AND institution_id = v_inst;

    -- An admin who also coordinates: the coordinator view's staff leave is the wing rung only.
    INSERT INTO public.user_roles (user_id, role, institution_id) VALUES (v_coord, 'school_admin', v_inst);
    v_js := public._my_dashboard_actions(v_coord, 'coordinator', pg_temp.at_local(v_tz, v_d, time '09:00'));
    PERFORM pg_temp.chk(v_js->>'view' = 'coordinator' AND (v_js->'leave'->>'staff')::int = v_c_staff + 1,
      'admin+coordinator in the coordinator view: wing staff leave only, never the whole school', v_js::text);
    DELETE FROM public.user_roles WHERE user_id = v_coord AND role = 'school_admin' AND institution_id = v_inst;

    DELETE FROM public.wing_assignments WHERE user_id = v_coord;
    v_js := public._my_dashboard_actions(v_coord, 'coordinator', pg_temp.at_local(v_tz, v_d, v_start - interval '1 minute'));
    PERFORM pg_temp.chk(v_js->>'cover' IS NULL AND COALESCE((v_js->'leave'->>'students')::int, 0) = 0
                    AND COALESCE((v_js->'leave'->>'staff')::int, 0) = 0,
      'a coordinator with no wing: no cover, no leave (never the whole school)', v_js::text);
  ELSE
    PERFORM pg_temp.skip('coordinator leave', 'no plain coordinator with a wing in the fixture school');
  END IF;

  -- ── 8. no settings row: the client defaults, and the pass would do nothing ─
  DELETE FROM public.attendance_settings WHERE institution_id = v_inst;
  v_js := public._my_dashboard_actions(v_admin, 'admin', pg_temp.at_local(v_tz, v_d, time '08:31'));
  PERFORM pg_temp.chk((v_js->>'pass_due')::boolean IS FALSE, 'no settings row: pass not due', v_js->>'pass_due');
  v_js := public._my_dashboard_actions(v_teacher, 'teacher', pg_temp.at_local(v_tz, v_d, time '07:00'));
  PERFORM pg_temp.chk(v_js->'check_in'->>'by' = '08:00' AND v_js->'check_in'->>'until' = '16:00',
    'no settings row: 08:00 to 16:00, the client defaults', v_js->>'check_in');

  -- ── 9. the public wrapper, as the signed-in user (LAST: it switches role) ─
  PERFORM pg_temp.as_user(v_teacher);
  v_js := public.my_dashboard_actions('admin');
  PERFORM pg_temp.chk(v_js->>'view' = 'teacher', 'wrapper: the caller comes from the JWT and the view cannot widen', v_js->>'view');
  PERFORM pg_temp.as_user(v_student);
  v_js := public.my_dashboard_actions(NULL);
  PERFORM pg_temp.chk(v_js->>'view' IS NULL AND pg_temp.no_cards(v_js), 'wrapper: a student gets the empty answer', v_js::text);
END
$test$;

SELECT json_agg(json_build_object('n', n, 'r', result, 'label', label, 'detail', detail) ORDER BY n) AS result
FROM t_out;

ROLLBACK;
```

- [ ] **Step 2: Run it and watch it fail**

```powershell
powershell -File scripts/run-sql.ps1 -SqlFile scripts/test-dashboard-actions.sql -OutFile "$env:TEMP\actions.json"
Get-Content "$env:TEMP\actions.json"
```

Expected: `HTTP ERROR 400` with `ERROR: 42883: function "public.my_dashboard_actions(text)" does not exist` (section 1's `has_function_privilege` raises first; the transaction is rolled back and leaves nothing).

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261003120000_my_dashboard_actions.sql`:

```sql
-- Dashboard action cards: one read-only answer per staff dashboard load.
-- Spec: docs/superpowers/specs/2026-10-03-dashboard-action-cards-design.md
--
-- my_dashboard_actions(p_view) tells the signed-in staff member what is waiting for them
-- TODAY, on the school's own clock (CLAUDE.md §24):
--   check_in   no check-in yet (or marked absent) on a working day, before check-out time
--   cover      pending substitutions in their scope whose period has not ended; admin and
--              coordinator views only, and only on a day the school has at least one real
--              staff check-in (schools that never check in raise a cover for every period)
--   leave      pending leave they may decide: teacher view, student leave of the sections
--              they teach; coordinator view, student leave of their wings plus the staff
--              leave of their wings' teachers (can_review_staff_leave's coordinator rung
--              only, so an admin who also coordinates never gets admin scope there, §25);
--              admin view, staff leave only (owner, 2026-10-03: admins do not see student
--              leave on the card)
--   check_out  checked in, not checked out, at or after check-out time
-- Counts and one line of context only, never row lists.
--
-- p_view is a REQUEST that can only narrow (the task_status_counts pattern): it is honoured
-- only when the caller holds that role, otherwise the default view applies (admin, else
-- teacher, else coordinator: the same default ActiveRoleContext picks).
--
-- _my_dashboard_actions holds the logic with the caller and the clock passed in, so
-- scripts/test-dashboard-actions.sql can pin the time. Only its owner may execute it; the
-- public wrapper passes the JWT's user and the transaction clock.

CREATE OR REPLACE FUNCTION public._my_dashboard_actions(p_uid uuid, p_view text, p_now timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_empty     CONSTANT jsonb := jsonb_build_object(
                'v', 1, 'date', NULL, 'view', NULL, 'check_in', NULL, 'cover', NULL,
                'leave', NULL, 'check_out', NULL, 'pass_due', false, 'refresh_in_s', NULL);
  v_inst      uuid;
  v_admin     boolean;
  v_coord     boolean;
  v_teacher   boolean;
  v_view      text;
  v_tz        text;
  v_local     timestamp;
  v_today     date;
  v_time      time;
  v_has_set   boolean;
  v_in        time;
  v_out       time;
  v_grace     integer;
  v_late_ok   boolean;
  v_cutoff    interval;
  v_workday   boolean;
  v_has_row   boolean;
  v_row_id    uuid;
  v_status    text;
  v_in_at     timestamptz;
  v_out_at    timestamptz;
  v_check_in  jsonb;
  v_check_out jsonb;
  v_cover     jsonb;
  v_leave     jsonb;
  v_pass_due  boolean := false;
  v_n_cover   integer;
  v_first_end time;
  v_next_lbl  text;
  v_next_cls  text;
  v_next_sec  text;
  v_next_at   time;
  v_students  integer := 0;
  v_staff     integer := 0;
  v_oldest_s  timestamptz;
  v_oldest    timestamptz;
  v_waits     interval[];
  v_refresh   integer;
BEGIN
  IF p_uid IS NULL OR p_now IS NULL THEN
    RETURN v_empty;
  END IF;

  v_inst := public.get_user_institution(p_uid);
  IF v_inst IS NULL OR public.is_super_admin(p_uid) THEN
    RETURN v_empty;
  END IF;

  -- Roles inside the caller's own school. (Prod has no staff role row that points at
  -- another school than the profile's, checked 2026-10-03.)
  v_admin   := public.is_institution_admin(p_uid, v_inst);
  v_coord   := EXISTS (SELECT 1 FROM public.user_roles r
                        WHERE r.user_id = p_uid AND r.institution_id = v_inst AND r.role = 'coordinator');
  v_teacher := EXISTS (SELECT 1 FROM public.user_roles r
                        WHERE r.user_id = p_uid AND r.institution_id = v_inst AND r.role = 'teacher');
  IF NOT (v_admin OR v_coord OR v_teacher) THEN
    RETURN v_empty;  -- students and employees get no cards
  END IF;

  v_view := CASE
    WHEN p_view = 'admin'       AND v_admin   THEN 'admin'
    WHEN p_view = 'coordinator' AND v_coord   THEN 'coordinator'
    WHEN p_view = 'teacher'     AND v_teacher THEN 'teacher'
    WHEN v_admin   THEN 'admin'
    WHEN v_teacher THEN 'teacher'
    ELSE 'coordinator'
  END;

  -- The school's wall clock (§24).
  SELECT i.timezone INTO v_tz FROM public.institutions i WHERE i.id = v_inst;
  v_tz    := COALESCE(v_tz, 'Asia/Kolkata');
  v_local := p_now AT TIME ZONE v_tz;
  v_today := v_local::date;
  v_time  := v_local::time;

  -- The school's settings, or the defaults the client falls back to (DEFAULT_ATTENDANCE_SETTINGS).
  SELECT s.staff_check_in_time, s.staff_check_out_time, s.staff_late_grace_minutes, s.staff_late_check_in_allowed
    INTO v_in, v_out, v_grace, v_late_ok
    FROM public.attendance_settings s
   WHERE s.institution_id = v_inst;
  v_has_set := FOUND;
  IF NOT v_has_set THEN
    v_in := time '08:00'; v_out := time '16:00'; v_grace := 30; v_late_ok := true;
  END IF;
  -- The moment the attendance pass starts marking: check-in time plus grace (no grace when
  -- late check-in is off), the rule tt_run_attendance_pass_for_institution applies.
  v_cutoff := make_interval(mins => CASE WHEN v_late_ok THEN v_grace ELSE 0 END);

  v_workday := EXISTS (SELECT 1 FROM public._staff_leave_workdays(v_inst, v_today, v_today));

  SELECT r.id, r.status, r.check_in_at, r.check_out_at
    INTO v_row_id, v_status, v_in_at, v_out_at
    FROM public.staff_attendance_records r
   WHERE r.staff_id = p_uid AND r.date = v_today;
  v_has_row := FOUND;

  -- 1. Check-in, every view. A row the person did not write themselves (on leave, holiday,
  --    marked present by an admin) means there is nothing to check in to; an absent row means
  --    a self check-in would collide with it, so the card only says so.
  IF v_workday AND v_time < v_out THEN
    IF NOT v_has_row THEN
      v_check_in := jsonb_build_object('state', 'due',
                      'by', to_char(v_in, 'HH24:MI'), 'until', to_char(v_out, 'HH24:MI'));
    ELSIF v_in_at IS NULL AND v_status = 'absent' THEN
      v_check_in := jsonb_build_object('state', 'absent',
                      'by', to_char(v_in, 'HH24:MI'), 'until', to_char(v_out, 'HH24:MI'));
    END IF;
  END IF;

  -- 4. Check-out, every view; today's row id so the card can never touch another day's row.
  IF v_has_row AND v_in_at IS NOT NULL AND v_out_at IS NULL AND v_time >= v_out THEN
    v_check_out := jsonb_build_object('record_id', v_row_id, 'since', to_char(v_out, 'HH24:MI'));
  END IF;

  -- 2. Cover, admin and coordinator views, on a day the school really checks in.
  IF v_view IN ('admin', 'coordinator')
     AND EXISTS (SELECT 1 FROM public.staff_attendance_records a
                  WHERE a.institution_id = v_inst AND a.date = v_today AND a.check_in_at IS NOT NULL) THEN
    SELECT count(*) OVER (), min(ps.end_time) OVER (), ps.label, c.name, c.section, ps.start_time
      INTO v_n_cover, v_first_end, v_next_lbl, v_next_cls, v_next_sec, v_next_at
      FROM public.tt_substitutions t
      JOIN public.tt_slots s         ON s.id = t.slot_id AND s.institution_id = v_inst
      JOIN public.tt_period_slots ps ON ps.id = s.period_slot_id
      JOIN public.classes c          ON c.id = s.class_id AND c.institution_id = v_inst
                                    AND COALESCE(c.is_active, true)
     WHERE t.status = 'pending'
       AND t.date = v_today
       AND ps.end_time > v_time
       AND (v_view = 'admin' OR EXISTS (
             -- every wing the coordinator holds, as Workday's list and
             -- tt_user_can_edit_class_slots do; no wing means nothing, never the whole school
             SELECT 1
               FROM public.wing_assignments wa
               JOIN public.wings w ON w.id = wa.wing_id AND w.institution_id = v_inst
               JOIN public.wing_class_mappings wcm ON wcm.wing_id = wa.wing_id
              WHERE wa.user_id = p_uid AND wcm.class_id = s.class_id))
     ORDER BY ps.start_time, c.name, c.section
     LIMIT 1;
    IF COALESCE(v_n_cover, 0) > 0 THEN
      v_cover := jsonb_build_object(
        'pending', v_n_cover,
        'next', jsonb_build_object('label', v_next_lbl, 'class_name', v_next_cls,
                                   'section', v_next_sec, 'start', to_char(v_next_at, 'HH24:MI')));
    END IF;
  END IF;

  -- 3. Leave the caller may decide, by view. Student requests count only while the student
  --    is still in the class: review_student_leave refuses the others, so they would pin the
  --    card for ever.
  IF v_view = 'teacher' THEN
    -- every teacher row on the section, with or without a subject (can_review_student_leave)
    SELECT count(*), min(l.created_at) INTO v_students, v_oldest_s
      FROM public.leave_requests l
     WHERE l.institution_id = v_inst
       AND l.status = 'pending'
       AND EXISTS (SELECT 1 FROM public.class_assignments ca
                    WHERE ca.user_id = p_uid AND ca.class_id = l.class_id AND ca.role = 'teacher')
       AND public.student_in_class(l.student_id, l.class_id);
  ELSIF v_view = 'coordinator' THEN
    SELECT count(*), min(l.created_at) INTO v_students, v_oldest_s
      FROM public.leave_requests l
     WHERE l.institution_id = v_inst
       AND l.status = 'pending'
       AND EXISTS (SELECT 1
                     FROM public.wing_assignments wa
                     JOIN public.wings w ON w.id = wa.wing_id AND w.institution_id = v_inst
                     JOIN public.wing_class_mappings wcm ON wcm.wing_id = wa.wing_id
                    WHERE wa.user_id = p_uid AND wcm.class_id = l.class_id)
       AND public.student_in_class(l.student_id, l.class_id);
  END IF;

  IF v_view = 'admin' THEN
    -- can_review_staff_leave refuses the caller's own request
    SELECT count(*), min(sl.created_at) INTO v_staff, v_oldest
      FROM public.staff_leave_requests sl
     WHERE sl.institution_id = v_inst
       AND sl.status = 'pending'
       AND public.can_review_staff_leave(p_uid, sl.user_id, v_inst);
  ELSIF v_view = 'coordinator' THEN
    -- can_review_staff_leave's coordinator rung ONLY (20260928160000): a teacher of a class in
    -- one of the caller's wings, who is neither an admin nor a coordinator. Calling the helper
    -- here would hand an admin who also coordinates the whole school in the coordinator view.
    SELECT count(*), min(sl.created_at) INTO v_staff, v_oldest
      FROM public.staff_leave_requests sl
     WHERE sl.institution_id = v_inst
       AND sl.status = 'pending'
       AND sl.user_id <> p_uid
       AND NOT public.is_institution_admin(sl.user_id, v_inst)
       AND NOT EXISTS (SELECT 1 FROM public.user_roles r
                        WHERE r.user_id = sl.user_id AND r.institution_id = v_inst AND r.role = 'coordinator')
       AND EXISTS (SELECT 1
                     FROM public.class_assignments ca
                     JOIN public.classes cl ON cl.id = ca.class_id AND cl.institution_id = v_inst
                     JOIN public.wing_class_mappings wcm ON wcm.class_id = ca.class_id
                     JOIN public.wing_assignments wa ON wa.wing_id = wcm.wing_id
                    WHERE ca.user_id = sl.user_id AND ca.role = 'teacher' AND wa.user_id = p_uid);
  END IF;

  IF COALESCE(v_students, 0) + COALESCE(v_staff, 0) > 0 THEN
    v_oldest := LEAST(v_oldest, v_oldest_s);  -- LEAST skips NULLs
    v_leave := jsonb_build_object(
      'students', COALESCE(v_students, 0),
      'staff', COALESCE(v_staff, 0),
      'oldest_days', GREATEST(0, v_today - (v_oldest AT TIME ZONE v_tz)::date));
  END IF;

  -- The attendance pass would mark now: let the admin or coordinator dashboard kick it once
  -- instead of waiting up to 15 minutes for the cron (no settings row: the pass does nothing).
  v_pass_due := v_view IN ('admin', 'coordinator') AND v_has_set AND v_workday
                AND (v_time - v_in) >= v_cutoff;

  -- refresh_in_s: the next moment this answer can change by the clock alone.
  v_waits := ARRAY[interval '24 hours' - (v_time - time '00:00')];          -- the school's midnight
  IF v_time < v_out AND (v_check_in IS NOT NULL OR (v_in_at IS NOT NULL AND v_out_at IS NULL)) THEN
    v_waits := v_waits || (v_out - v_time);                                  -- check-out time
  END IF;
  -- (Nothing in the answer changes at check-in time: the "late" wording is the client's.)
  IF v_view IN ('admin', 'coordinator') AND v_has_set AND v_workday AND NOT v_pass_due THEN
    v_waits := v_waits || ((v_in - v_time) + v_cutoff);                      -- the pass becomes due
  END IF;
  IF v_first_end IS NOT NULL THEN
    v_waits := v_waits || (v_first_end - v_time);                            -- an open period ends
  END IF;
  SELECT ceil(extract(epoch FROM min(w)))::integer INTO v_refresh
    FROM unnest(v_waits) AS w
   WHERE w > interval '0';

  RETURN jsonb_build_object(
    'v', 1,
    'date', to_char(v_today, 'YYYY-MM-DD'),
    'view', v_view,
    'check_in', v_check_in,
    'cover', v_cover,
    'leave', v_leave,
    'check_out', v_check_out,
    'pass_due', v_pass_due,
    'refresh_in_s', v_refresh);
END
$fn$;

CREATE OR REPLACE FUNCTION public.my_dashboard_actions(p_view text DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT public._my_dashboard_actions((SELECT auth.uid()), p_view, now());
$fn$;

-- The twin trusts its arguments, so nobody but its owner may call it (§26: anon by name;
-- REVOKE FROM PUBLIC does not strip Supabase's default grants).
REVOKE ALL ON FUNCTION public._my_dashboard_actions(uuid, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._my_dashboard_actions(uuid, text, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public._my_dashboard_actions(uuid, text, timestamptz) FROM authenticated;

REVOKE ALL ON FUNCTION public.my_dashboard_actions(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.my_dashboard_actions(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.my_dashboard_actions(text) TO authenticated;

COMMENT ON FUNCTION public.my_dashboard_actions(text) IS
  'Dashboard action cards (2026-10-03): check-in, cover, leave and check-out due today for the caller, in the view they request (it can only narrow). Read-only. Spec docs/superpowers/specs/2026-10-03-dashboard-action-cards-design.md';
```

- [ ] **Step 4: Apply it to production and verify against the catalogue (never the ledger)**

```powershell
powershell -File scripts/run-sql.ps1 -SqlFile supabase/migrations/20261003120000_my_dashboard_actions.sql -OutFile "$env:TEMP\mig.json"
Set-Content -Path "$env:TEMP\verify-actions.sql" -Encoding utf8 -Value @'
select json_build_object(
  'fns', (select json_agg(json_build_object('name', p.proname, 'args', pg_get_function_identity_arguments(p.oid), 'definer', p.prosecdef, 'vol', p.provolatile))
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('my_dashboard_actions', '_my_dashboard_actions')),
  'grants', (select json_agg(json_build_object('fn', routine_name, 'grantee', grantee) order by routine_name, grantee)
               from information_schema.routine_privileges
              where routine_schema = 'public' and routine_name in ('my_dashboard_actions', '_my_dashboard_actions')
                and privilege_type = 'EXECUTE')) as v;
'@
powershell -File scripts/run-sql.ps1 -SqlFile "$env:TEMP\verify-actions.sql" -OutFile "$env:TEMP\verify-actions.json"
Get-Content "$env:TEMP\verify-actions.json"
```

Expected: `HTTP 201` twice. Two functions: `my_dashboard_actions(p_view text)` with definer `true` and vol `s`, and `_my_dashboard_actions(p_uid uuid, p_view text, p_now timestamp with time zone)` with definer `false`. In the grants, `my_dashboard_actions` lists `authenticated`, `postgres` and `service_role` and **no `anon`**; `_my_dashboard_actions` lists only `postgres` and `service_role`.

- [ ] **Step 5: Run the acceptance suite and see it pass**

```powershell
powershell -File scripts/run-sql.ps1 -SqlFile scripts/test-dashboard-actions.sql -OutFile "$env:TEMP\actions.json"
python -c "import json; d=json.load(open(r'$env:TEMP\actions.json',encoding='utf-8-sig')); rows=d[0]['result']; rows=json.loads(rows) if isinstance(rows,str) else rows; bad=[r for r in rows if r['r']!='PASS']; print(len(rows),'checks;', 'ALL PASS' if not bad else bad)"
```

Expected: `59 checks; ALL PASS`. A SKIP line is acceptable only for the coordinator cases, when the fixture school has no plain coordinator with a wing. The 2026-10-05 dry run of exactly this migration and suite, rolled back on prod, had 59 PASS and 0 SKIP.

- [ ] **Step 6: Splice the generated-types entry**

In `src/integrations/supabase/types.ts`, find:

```ts
      mark_support_ticket_read: {
        Args: { p_ticket_id: string }
        Returns: undefined
      }
      my_optional_slot_choices: {
```

Replace with:

```ts
      mark_support_ticket_read: {
        Args: { p_ticket_id: string }
        Returns: undefined
      }
      my_dashboard_actions: { Args: { p_view?: string }; Returns: Json }
      my_optional_slot_choices: {
```

That entry alone makes `npm run typecheck` fail:

```
src/hooks/dashboard/useCoord.ts(326,13): error TS2589: Type instantiation is excessively deep and possibly infinite.
```

The cause is `useCoord.ts`'s `rpc()` helper. It casts the function name to `Parameters<typeof supabase.rpc>[0]`, which makes TypeScript instantiate `rpc`'s signature over all 500+ generated names. That is already at TypeScript's limit, and ANY new function with arguments tips it over. (The 2026-10-05 review measured this: a different name, the multi-line form, a required argument, every variant failed; only `Args: never` passed.) The helper already casts `args as never` and `data as unknown as T`, and `useRunAttendancePass.ts` uses the same cast, so `name as never` loses no type safety.

Skip this edit if line 326 already reads `name as never,` (another session may land the same fix first). In `src/hooks/dashboard/useCoord.ts` replace:

```ts
    name as Parameters<typeof supabase.rpc>[0],
```

with:

```ts
    // `as never` like args: rpc's signature instantiated over all 500+ generated names sits
    // at TypeScript's limit, and one more spliced function tips it into TS2589.
    name as never,
```

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 7: Commit**

```powershell
git add -- supabase/migrations/20261003120000_my_dashboard_actions.sql scripts/test-dashboard-actions.sql src/integrations/supabase/types.ts src/hooks/dashboard/useCoord.ts
git commit -m @'
feat(dashboard): my_dashboard_actions RPC for the action cards

One read-only call per staff dashboard load: check-in, cover, leave and
check-out due today on the school's clock, scoped by the view the
dashboard shows (it can only narrow). Applied to prod via run-sql.ps1;
scripts/test-dashboard-actions.sql: 59 checks pass (rolled back).
useCoord's rpc() helper now casts the function name `as never`: with one
more spliced function, its Parameters<typeof supabase.rpc> cast hit TS2589.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 2: Pure card logic `src/lib/dashboardActions.ts`

**Files:**
- Create: `src/lib/dashboardActions.ts`
- Create: `scripts/test-dashboard-actions.mjs`
- Modify: `package.json` (one script line)

**Interfaces:**
- Consumes: the RPC JSON from Task 1 (snake_case), and `ViewRole` (type only) from `@/contexts/ActiveRoleContext`.
- Produces (exact exports, used by Tasks 3, 4 and 6):
  - `DASHBOARD_ACTIONS_KEY: readonly ["staff-attendance", "my-actions"]`
  - `COVER_LINK = "/staff/workday?tab=substitutions"`
  - `type CheckInAction = { state: "due" | "absent"; by: string; until: string }`
  - `type CoverNext = { label; className; section: string | null; start }`
  - `type CoverAction = { pending: number; next: CoverNext | null }`
  - `type LeaveAction = { students; staff; oldestDays }`
  - `type CheckOutAction = { recordId; since }`
  - `type DashboardActions = { date; view: ViewRole | null; checkIn; cover; leave; checkOut; passDue: boolean; refreshInS: number | null }`
  - `type ActionCardKind = "check_in" | "cover" | "leave" | "check_out"`
  - `CARD_ORDER`, `type CardCopy = { title; detail }`, `type CardLink = { label; to }`
  - Functions:
    - `parseDashboardActions(raw: unknown): DashboardActions` (throws on a non-object)
    - `dueCards(a): ActionCardKind[]`
    - `ownsCheckButton(a | null | undefined): boolean`
    - `formatClock(hhmm): string`
    - `checkInCopy(c, nowHHMM): CardCopy`
    - `coverCopy(c, formatClass): CardCopy`
    - `leaveCopy(l): CardCopy`
    - `leaveLinks(l): CardLink[]`
    - `checkOutCopy(c): CardCopy`
    - `refreshDelayMs(a | null | undefined): number | null`
    - `schoolClock(date: Date, timeZone: string): { date: string; time: string }`

- [ ] **Step 1: Write the failing test**

Create `scripts/test-dashboard-actions.mjs`:

```js
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
eq("key: nested under staff-attendance", m.DASHBOARD_ACTIONS_KEY, ["staff-attendance", "my-actions"]);

console.log(`\n  test:dashboard-actions: ${pass} passed, ${fail} failed\n`);
for (const f of failures) console.log(`  FAIL  ${f}`);
process.exit(fail === 0 ? 0 : 1);
```

In `package.json`, after the `"test:banner-tod": …` line, add:

```json
    "test:dashboard-actions": "node --experimental-strip-types scripts/test-dashboard-actions.mjs",
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test:dashboard-actions`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/lib/dashboardActions.ts`.

- [ ] **Step 3: Write the module**

Create `src/lib/dashboardActions.ts`:

```ts
// Dashboard action cards, the PURE part: parses my_dashboard_actions() and turns it into
// ordered cards and their words. Erasable TypeScript with no value imports on purpose: the
// Node test (scripts/test-dashboard-actions.mjs) loads this file directly with type
// stripping, so it may use no enum, no namespace, and only `import type`.
// Spec: docs/superpowers/specs/2026-10-03-dashboard-action-cards-design.md

import type { ViewRole } from "@/contexts/ActiveRoleContext";

/**
 * Every query key of the cards starts with these two, so the writes that already
 * invalidate ["staff-attendance"] (check-in, check-out, the admin override, the attendance
 * pass, both staff-leave decisions) refresh the cards without knowing about them.
 */
export const DASHBOARD_ACTIONS_KEY = ["staff-attendance", "my-actions"] as const;

/** Where the substitution card sends its Assign button. */
export const COVER_LINK = "/staff/workday?tab=substitutions";
const STUDENT_LEAVE_LINK = "/school/attendance?tab=leaves";
const STAFF_LEAVE_LINK = "/staff/workday?tab=staff-leaves";

export interface CheckInAction {
  state: "due" | "absent";
  /** staff_check_in_time, "HH:MM" on the school's clock */
  by: string;
  /** staff_check_out_time, "HH:MM": the card stops showing then */
  until: string;
}

export interface CoverNext {
  label: string;
  className: string;
  section: string | null;
  /** the period's start, "HH:MM" */
  start: string;
}

export interface CoverAction {
  pending: number;
  next: CoverNext | null;
}

export interface LeaveAction {
  students: number;
  staff: number;
  oldestDays: number;
}

export interface CheckOutAction {
  /** today's staff_attendance_records row, never another day's */
  recordId: string;
  /** staff_check_out_time, "HH:MM" */
  since: string;
}

export interface DashboardActions {
  date: string | null;
  view: ViewRole | null;
  checkIn: CheckInAction | null;
  cover: CoverAction | null;
  leave: LeaveAction | null;
  checkOut: CheckOutAction | null;
  passDue: boolean;
  refreshInS: number | null;
}

export type ActionCardKind = "check_in" | "cover" | "leave" | "check_out";

/** The owner's order (2026-10-03): check-in, substitution, leave, check-out. */
export const CARD_ORDER: readonly ActionCardKind[] = ["check_in", "cover", "leave", "check_out"];

export interface CardCopy {
  title: string;
  detail: string;
}

export interface CardLink {
  label: string;
  to: string;
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const whole = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
const isView = (v: unknown): v is ViewRole => v === "admin" || v === "coordinator" || v === "teacher";

function parseCheckIn(v: unknown): CheckInAction | null {
  if (!isObj(v)) return null;
  const state = v.state === "due" || v.state === "absent" ? v.state : null;
  const by = text(v.by);
  const until = text(v.until);
  return state && by && until ? { state, by, until } : null;
}

function parseCover(v: unknown): CoverAction | null {
  if (!isObj(v)) return null;
  const pending = whole(v.pending);
  if (pending === 0) return null;
  const n = v.next;
  let next: CoverNext | null = null;
  if (isObj(n)) {
    const label = text(n.label);
    const className = text(n.class_name);
    const start = text(n.start);
    if (label && className && start) next = { label, className, section: text(n.section), start };
  }
  return { pending, next };
}

function parseLeave(v: unknown): LeaveAction | null {
  if (!isObj(v)) return null;
  const students = whole(v.students);
  const staff = whole(v.staff);
  if (students + staff === 0) return null;
  return { students, staff, oldestDays: whole(v.oldest_days) };
}

function parseCheckOut(v: unknown): CheckOutAction | null {
  if (!isObj(v)) return null;
  const recordId = text(v.record_id);
  const since = text(v.since);
  return recordId && since ? { recordId, since } : null;
}

/**
 * The RPC's jsonb, checked field by field. A malformed card is dropped; an answer that is
 * not an object at all THROWS, so the slot shows its error card instead of reading a broken
 * answer as "nothing to do" (CLAUDE.md §6).
 */
export function parseDashboardActions(raw: unknown): DashboardActions {
  if (!isObj(raw)) throw new Error("my_dashboard_actions returned an unexpected answer");
  // A newer server shape must never read as "nothing due" on an older client (the Android
  // shell keeps its bundled build until a store update): an unknown version is an error.
  if (raw.v !== 1) throw new Error("my_dashboard_actions answered in an unknown version");
  const refresh = raw.refresh_in_s;
  return {
    date: text(raw.date),
    view: isView(raw.view) ? raw.view : null,
    checkIn: parseCheckIn(raw.check_in),
    cover: parseCover(raw.cover),
    leave: parseLeave(raw.leave),
    checkOut: parseCheckOut(raw.check_out),
    passDue: raw.pass_due === true,
    refreshInS: typeof refresh === "number" && Number.isFinite(refresh) && refresh > 0 ? refresh : null,
  };
}

/** The due cards, in CARD_ORDER. */
export function dueCards(a: DashboardActions): ActionCardKind[] {
  return CARD_ORDER.filter((k) =>
    k === "check_in" ? a.checkIn !== null
      : k === "cover" ? a.cover !== null
        : k === "leave" ? a.leave !== null
          : a.checkOut !== null,
  );
}

/**
 * True while a card speaks for the person's own check-in or check-out (including "Marked
 * absent"): the small greeting button then steps aside, so there are never two of them.
 */
export function ownsCheckButton(a: DashboardActions | null | undefined): boolean {
  return !!a && (a.checkIn !== null || a.checkOut !== null);
}

/** "HH:MM" (or "HH:MM:SS") to minutes since midnight, or null. */
function minutesOf(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

/** "08:00" -> "8:00 AM", "16:00:00" -> "4:00 PM"; anything else comes back unchanged. */
export function formatClock(hhmm: string): string {
  const total = minutesOf(hhmm);
  if (total === null) return hhmm;
  const h = Math.floor(total / 60);
  const m = String(total % 60).padStart(2, "0");
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${h < 12 ? "AM" : "PM"}`;
}

/**
 * `nowHHMM` is the school's clock ("HH:MM"), so "late" flips at the school's check-in time.
 * From that minute on (>=): a tap at 08:00:30 is already recorded late (classifyStaffCheckIn).
 */
export function checkInCopy(c: CheckInAction, nowHHMM: string): CardCopy {
  if (c.state === "absent") return { title: "Marked absent today", detail: "Ask your admin to change it." };
  const now = minutesOf(nowHHMM);
  const by = minutesOf(c.by);
  const late = now !== null && by !== null && now >= by;
  return {
    title: "Check in for today",
    detail: late ? "Checking in now is recorded as late." : `Check in by ${formatClock(c.by)}`,
  };
}

/** `formatClass` is formatClassName from "@/lib/utils" (passed in to keep this file import-free). */
export function coverCopy(c: CoverAction, formatClass: (name: string, section: string | null) => string): CardCopy {
  const title = c.pending === 1 ? "1 period needs a substitute" : `${c.pending} periods need a substitute`;
  const detail = c.next
    ? `Next: ${c.next.label}, ${formatClass(c.next.className, c.next.section)} at ${formatClock(c.next.start)}`
    : "Assign a teacher before the period starts.";
  return { title, detail };
}

export function leaveCopy(l: LeaveAction): CardCopy {
  const total = l.students + l.staff;
  const parts: string[] = [];
  if (l.students > 0) parts.push(l.students === 1 ? "1 student" : `${l.students} students`);
  if (l.staff > 0) parts.push(`${l.staff} staff`);
  const age =
    l.oldestDays <= 0 ? "filed today"
      : l.oldestDays === 1 ? "oldest 1 day"
        : `oldest ${l.oldestDays} days`;
  return {
    title: total === 1 ? "1 leave request waiting" : `${total} leave requests waiting`,
    detail: `${parts.join(", ")} · ${age}`,
  };
}

/** One button per screen that holds the requests: students on Attendance, staff on Workday. */
export function leaveLinks(l: LeaveAction): CardLink[] {
  if (l.students > 0 && l.staff > 0) {
    return [
      { label: "Students", to: STUDENT_LEAVE_LINK },
      { label: "Staff", to: STAFF_LEAVE_LINK },
    ];
  }
  return [{ label: "Review", to: l.staff > 0 ? STAFF_LEAVE_LINK : STUDENT_LEAVE_LINK }];
}

export function checkOutCopy(c: CheckOutAction): CardCopy {
  return { title: "Time to check out", detail: `Check-out opened at ${formatClock(c.since)}` };
}

/**
 * When to ask the server again: one second after the moment it named (refresh_in_s), never
 * sooner than 30 seconds, so a clock skew can never become a fetch loop. Null: no timer.
 */
export function refreshDelayMs(a: DashboardActions | null | undefined): number | null {
  if (!a || a.refreshInS === null) return null;
  return Math.max(30_000, Math.ceil(a.refreshInS) * 1000 + 1000);
}

const DEFAULT_ZONE = "Asia/Kolkata";
const CLOCKS = new Map<string, Intl.DateTimeFormat>();
const CLOCK_OPTIONS: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
};

function clockFor(timeZone: string): Intl.DateTimeFormat {
  const cached = CLOCKS.get(timeZone);
  if (cached) return cached;
  let f: Intl.DateTimeFormat;
  try {
    f = new Intl.DateTimeFormat("en-CA", { ...CLOCK_OPTIONS, timeZone });
  } catch {
    // RangeError for a zone this runtime does not know: the platform default (§24).
    f = new Intl.DateTimeFormat("en-CA", { ...CLOCK_OPTIONS, timeZone: DEFAULT_ZONE });
  }
  CLOCKS.set(timeZone, f);
  return f;
}

/** The school's calendar date ("YYYY-MM-DD") and wall-clock time ("HH:MM") at `date`. */
export function schoolClock(date: Date, timeZone: string): { date: string; time: string } {
  const parts = clockFor(timeZone || DEFAULT_ZONE).formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  // Some engines print midnight as "24" even with hourCycle h23.
  const hour = part("hour") === "24" ? "00" : part("hour");
  return { date: `${part("year")}-${part("month")}-${part("day")}`, time: `${hour}:${part("minute")}` };
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `npm run test:dashboard-actions`
Expected: `test:dashboard-actions: 68 passed, 0 failed` (the 2026-10-05 dry run of exactly this file pair printed that).

- [ ] **Step 5: Typecheck and lint the module**

Run (Git Bash): `npm run typecheck && npx eslint src/lib/dashboardActions.ts`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```powershell
git add -- src/lib/dashboardActions.ts scripts/test-dashboard-actions.mjs package.json
git commit -m @'
feat(dashboard): pure card logic for the action cards

Parses my_dashboard_actions, orders the cards (check-in, cover, leave,
check-out), words them without em-dashes, and keys them on the school's
date. test:dashboard-actions: 68 checks pass.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 3: Data hooks and cache wiring

**Files:**
- Create: `src/hooks/useMyDashboardActions.ts`
- Create: `src/hooks/useAttendancePassKick.ts`
- Modify: `src/lib/substitutions.ts:30-34` (`invalidateSubstitutionCaches`)
- Modify: `src/lib/attendanceCache.ts:34-39` (`LEAVE_KEYS`)
- Modify: `src/hooks/useRunAttendancePass.ts:22-40` (a `quiet` option)

**Interfaces:**
- Consumes: everything from Task 2; `supabase.rpc("my_dashboard_actions")` typed by Task 1; `useAuth`, `useUserRole`, `useInstitutionFeatures`, `useInstitutionTimezone`, `onAppStateChange` (from `@/lib/native`, returns its unsubscribe), and `useRunAttendancePass`.
- Produces:
  - `useMyDashboardActions(view: ViewRole | null): MyDashboardActions`, where `MyDashboardActions` is `{ gatePending: boolean; enabled: boolean; data: DashboardActions | undefined; isError: boolean; dataUpdatedAt: number; refetch: () => void }`.
  - `useDashboardActionsRefresh(actions: MyDashboardActions): void`.
  - `attendancePassKey(institutionId: string, now?: Date): string`.
  - `useAttendancePassKick(institutionId: string | null, due: boolean, opts?: { spread?: boolean; quiet?: boolean }): void`.
  - `useRunAttendancePass(opts?: { quiet?: boolean })`; existing callers are unchanged.

There is no unit-test harness for React hooks in this repo. The gate for this task is typecheck plus lint; behaviour is proved in the browser in Task 7.

- [ ] **Step 1: Create `src/hooks/useMyDashboardActions.ts`**

```ts
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { ViewRole } from "@/contexts/ActiveRoleContext";
import { useAuth } from "@/hooks/useAuth";
import { useInstitutionFeatures } from "@/hooks/useInstitutionFeatures";
import { useInstitutionTimezone } from "@/hooks/useInstitutionTimezone";
import { useUserRole } from "@/hooks/useUserRole";
import { onAppStateChange } from "@/lib/native";
import {
  DASHBOARD_ACTIONS_KEY,
  parseDashboardActions,
  refreshDelayMs,
  schoolClock,
  type DashboardActions,
} from "@/lib/dashboardActions";

export interface MyDashboardActions {
  /** Roles or features are still loading: show the plain sky, not the 3D scene yet. */
  gatePending: boolean;
  /** A staff view with the attendance feature on: the cards apply to this dashboard. */
  enabled: boolean;
  data: DashboardActions | undefined;
  isError: boolean;
  dataUpdatedAt: number;
  refetch: () => void;
}

/**
 * Today's action cards for the dashboard being shown (spec 2026-10-03), from ONE read-only
 * RPC that counts on the server (§23). `view` is that dashboard's own view, never the raw
 * activeViewRole (it reads "teacher" for single-role accounts); the server can only narrow
 * it (§25). Students and super admins never call it.
 *
 * Safe to call from several components on one dashboard: they share one cache entry. Mount
 * useDashboardActionsRefresh once per dashboard for the clock and return-to-app refreshes.
 */
export function useMyDashboardActions(view: ViewRole | null): MyDashboardActions {
  const { user } = useAuth();
  const { data: roleInfo, isLoading: roleLoading } = useUserRole();
  const { isFeatureEnabled, isLoading: featuresLoading } = useInstitutionFeatures();
  const timeZone = useInstitutionTimezone();

  const isStaff =
    !!roleInfo && !roleInfo.isSuperAdmin && (roleInfo.isSchoolAdmin || roleInfo.isCoordinator || roleInfo.isTeacher);
  const gatePending = !!view && (roleLoading || featuresLoading);
  const enabled = !!view && !!user?.id && !gatePending && isStaff && isFeatureEnabled("attendance");
  // The school's date is part of the key: the query cache is persisted for a day, and a
  // date-less key would hand this morning yesterday's cards until the refetch landed.
  const schoolDate = schoolClock(new Date(), timeZone).date;

  const query = useQuery({
    queryKey: [...DASHBOARD_ACTIONS_KEY, user?.id ?? null, view, schoolDate],
    queryFn: async (): Promise<DashboardActions> => {
      const { data, error } = await supabase.rpc("my_dashboard_actions", { p_view: view ?? undefined });
      if (error) throw error;
      return parseDashboardActions(data);
    },
    enabled,
    staleTime: 60_000,
  });

  const { refetch } = query;
  return {
    gatePending,
    enabled,
    data: query.data,
    isError: query.isError,
    dataUpdatedAt: query.dataUpdatedAt,
    refetch: () => {
      void refetch();
    },
  };
}

/**
 * Keeps one dashboard's cards in step with the clock and with the person coming back:
 *   - one timer to the moment the server named (check-out time, a period ending, the
 *     cutoff, the school's midnight), measured from when that answer arrived (a restored
 *     answer is already partly through its wait) and re-armed by every new answer. Every
 *     dashboard of a school shares those moments, so each one adds its own 0 to 20 s
 *     spread instead of all asking in the same second;
 *   - a refetch on return to the tab or the app when the answer is over a minute old.
 *     onAppStateChange also covers the native shell; plain window focus/blur is ignored
 *     because a tab return also fires visibilitychange (one request, not two).
 * cancelRefetch: false makes a second call join the fetch already in flight. No polling and
 * no realtime channel (§23); both listeners are cleaned up on unmount.
 */
export function useDashboardActionsRefresh(actions: MyDashboardActions): void {
  const queryClient = useQueryClient();
  const { enabled, dataUpdatedAt } = actions;
  const delay = refreshDelayMs(actions.data);
  const updatedAt = useRef(dataUpdatedAt);
  const [spread] = useState(() => Math.floor(Math.random() * 20_000));

  useEffect(() => {
    updatedAt.current = dataUpdatedAt;
  }, [dataUpdatedAt]);

  useEffect(() => {
    if (!enabled || delay === null) return;
    const wait = Math.max(30_000, delay - (Date.now() - dataUpdatedAt)) + spread;
    const id = window.setTimeout(() => {
      void queryClient.invalidateQueries({ queryKey: DASHBOARD_ACTIONS_KEY }, { cancelRefetch: false });
    }, wait);
    return () => window.clearTimeout(id);
  }, [enabled, delay, dataUpdatedAt, spread, queryClient]);

  useEffect(() => {
    if (!enabled) return;
    return onAppStateChange((active, source) => {
      if (!active || source === "focus" || Date.now() - updatedAt.current < 60_000) return;
      void queryClient.invalidateQueries({ queryKey: DASHBOARD_ACTIONS_KEY }, { cancelRefetch: false });
    });
  }, [enabled, queryClient]);
}
```

- [ ] **Step 2: Create `src/hooks/useAttendancePassKick.ts`**

```ts
import { useEffect } from "react";
import { format } from "date-fns";

import { useRunAttendancePass } from "@/hooks/useRunAttendancePass";

/** One sessionStorage flag per school per day, shared by Workday and the dashboards. */
export function attendancePassKey(institutionId: string, now: Date = new Date()): string {
  return `salci:att-pass:${institutionId}:${format(now, "yyyy-MM-dd")}`;
}

export interface AttendancePassKickOptions {
  /**
   * Wait a random 20 to 60 s first. Every admin and coordinator dashboard of a school turns
   * due at the same cutoff, which is also a 15-minute cron tick, and two passes for one
   * school at once can collide on UNIQUE(staff_id, date): the pass's absent-row insert has
   * no ON CONFLICT (20260925140000), so the loser raises 23505.
   */
  spread?: boolean;
  /** No error toast: the kick ran without the person asking, and the cron is the safety net. */
  quiet?: boolean;
}

/**
 * Runs tt_run_attendance_pass_for_institution once per browser session per school per day
 * once `due` turns true, instead of waiting up to 15 minutes for the cron: today's
 * auto-absent staff rows and pending substitutions then exist when an admin or coordinator
 * looks. Callers decide `due` (admin or coordinator view, past the cutoff); the server
 * refuses everyone else with 42501, so never pass true for a teacher view.
 *
 * The flag is set right before the call; if the call fails the flag stays and the cron is
 * the safety net. Storage that throws (a locked-down WebView, a private window) skips the
 * kick for the same reason.
 */
export function useAttendancePassKick(
  institutionId: string | null,
  due: boolean,
  opts: AttendancePassKickOptions = {},
): void {
  // `mutate` is referentially stable across renders (TanStack Query).
  const { mutate: runPass } = useRunAttendancePass({ quiet: opts.quiet === true });
  const spread = opts.spread === true;
  useEffect(() => {
    if (!due || !institutionId) return;
    const fire = () => {
      const key = attendancePassKey(institutionId);
      try {
        if (sessionStorage.getItem(key)) return;
        sessionStorage.setItem(key, "1");
      } catch {
        return;
      }
      runPass(institutionId);
    };
    if (!spread) {
      fire();
      return;
    }
    const id = window.setTimeout(fire, 20_000 + Math.floor(Math.random() * 40_000));
    return () => window.clearTimeout(id);
  }, [due, institutionId, spread, runPass]);
}
```

- [ ] **Step 2b: Let a background kick fail quietly**

In `src/hooks/useRunAttendancePass.ts` replace:

```ts
export function useRunAttendancePass() {
  const qc = useQueryClient();
  return useMutation({
```

with:

```ts
export function useRunAttendancePass(opts: { quiet?: boolean } = {}) {
  const qc = useQueryClient();
  const quiet = opts.quiet === true;
  return useMutation({
```

and replace:

```ts
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't sync attendance.", context: "runAttendancePass" }),
```

with:

```ts
    onError: (err: Error) => {
      // The dashboard's kick runs without the person asking and the 15-minute cron is the
      // safety net, so it only logs; Workday's kick still says so on screen.
      if (quiet) {
        console.warn("[attendance pass]", err.message);
        return;
      }
      toastError(err, { fallback: "Couldn't sync attendance.", context: "runAttendancePass" });
    },
```

- [ ] **Step 3: Refresh the cards after a cover is assigned**

In `src/lib/substitutions.ts`, add the import after the existing `import { supabase } …` line:

```ts
import { DASHBOARD_ACTIONS_KEY } from "@/lib/dashboardActions";
```

and replace:

```ts
export function invalidateSubstitutionCaches(queryClient: QueryClient): void {
  queryClient.invalidateQueries({ queryKey: ["timetable-v2", "substitutions"] });
  queryClient.invalidateQueries({ queryKey: ["substitutions"] });
  queryClient.invalidateQueries({ queryKey: ["dash5", "coord", "cover"] });
}
```

with:

```ts
export function invalidateSubstitutionCaches(queryClient: QueryClient): void {
  queryClient.invalidateQueries({ queryKey: ["timetable-v2", "substitutions"] });
  queryClient.invalidateQueries({ queryKey: ["substitutions"] });
  queryClient.invalidateQueries({ queryKey: ["dash5", "coord", "cover"] });
  // the dashboard's substitution card (useMyDashboardActions)
  queryClient.invalidateQueries({ queryKey: DASHBOARD_ACTIONS_KEY });
}
```

- [ ] **Step 4: Refresh the cards after a student-leave decision**

In `src/lib/attendanceCache.ts`, add after the `import type { QueryClient } …` line:

```ts
import { DASHBOARD_ACTIONS_KEY } from "@/lib/dashboardActions";
```

and replace:

```ts
const LEAVE_KEYS = [
  ["scoped-leave-requests"], // ViewLeavesSheet + StaffLeavesTab
  ["pending-leave-count"], // the roster header badge
  ["my-leave-requests"], // the student's own Track Leaves
  ["leave-requests"], // legacy useLeaveRequests, still mounted by useCommandCenter
] as const;
```

with:

```ts
const LEAVE_KEYS = [
  ["scoped-leave-requests"], // ViewLeavesSheet + StaffLeavesTab
  ["pending-leave-count"], // the roster header badge
  ["my-leave-requests"], // the student's own Track Leaves
  ["leave-requests"], // legacy useLeaveRequests, still mounted by useCommandCenter
  DASHBOARD_ACTIONS_KEY, // the dashboard's leave card (useMyDashboardActions)
] as const;
```

Check-in, check-out, the admin override (`useUpsertStaffAttendance`), the attendance pass and both staff-leave decision hooks (`useReviewStaffLeave` and the HR copy in `useStaffLeave`) already invalidate the `["staff-attendance"]` prefix, so they need no change.

- [ ] **Step 5: Gate the task**

Run (Git Bash):

```bash
npm run typecheck
npx eslint src/hooks/useMyDashboardActions.ts src/hooks/useAttendancePassKick.ts src/hooks/useRunAttendancePass.ts src/lib/substitutions.ts src/lib/attendanceCache.ts
npx eslint --rule '{"@typescript-eslint/no-unused-vars":["error",{"argsIgnorePattern":"^_"}]}' src/hooks/useMyDashboardActions.ts src/hooks/useAttendancePassKick.ts src/hooks/useRunAttendancePass.ts src/lib/substitutions.ts src/lib/attendanceCache.ts
npm run test:cache
```

Expected: typecheck exits 0; both eslint runs print no errors (a `react-refresh` warning is acceptable only on files that already had one); `test:cache` passes as before.

- [ ] **Step 6: Commit**

```powershell
git add -- src/hooks/useMyDashboardActions.ts src/hooks/useAttendancePassKick.ts src/hooks/useRunAttendancePass.ts src/lib/substitutions.ts src/lib/attendanceCache.ts
git commit -m @'
feat(dashboard): hooks for the action cards and their cache wiring

useMyDashboardActions keys the RPC under staff-attendance with the
school's date (staleTime 60s); one refresh timer and one resume listener
per dashboard; useAttendancePassKick shares Workday's once-a-day guard.
Cover and student-leave writes now refresh the cards.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 4: One check-in/out flow for the greeting button and the cards

**Files:**
- Create: `src/hooks/useStaffCheckFlow.ts`
- Create: `src/components/attendance/StaffCheckSheets.tsx`
- Modify: `src/hooks/useStaffAttendance.ts:95-117` (`useTodayStaffAttendance`)
- Modify: `src/components/attendance/StaffCheckInCard.tsx` (whole file)

**Interfaces:**
- Consumes: `useCheckInStaff` (`mutate({ institutionId, settings }, { onSuccess, onSettled })`), `useCheckOutStaff` (`mutate(recordId, { onSuccess, onSettled })`), `useAttendanceSettings`, `useEffectiveAttendanceSettings`, `useTeacherPendingSyllabusDays({ includeToday: false, enabled })`, `useEffectiveInstitutionId`, `useMyDashboardActions` and `ownsCheckButton` (Tasks 2 and 3).
- Produces:
  - `useStaffCheckFlow(): StaffCheckFlow`, where `StaffCheckFlow` is `{ institutionId: string | null; settings: AttendanceSettingsRow | null; settingsLoading: boolean; isTeacher: boolean; checkIn: () => void; checkOut: (recordId: string) => void; checkingIn: boolean; checkingOut: boolean; backlogOpen: boolean; setBacklogOpen: (open: boolean) => void; syllabusOpen: boolean; setSyllabusOpen: (open: boolean) => void }`.
  - `<StaffCheckSheets flow={…} />`.
  - `<StaffCheckInCard compact? view? />`, where `view?: ViewRole` makes the compact button step aside while the dashboard's cards own check-in or check-out.

- [ ] **Step 1: Date the today-row key (the greeting button's next-morning bug)**

In `src/hooks/useStaffAttendance.ts`, replace the whole `useTodayStaffAttendance` function, with its doc comment, with:

```ts
const STAFF_ATTENDANCE_COLUMNS =
  "id, institution_id, staff_id, date, check_in_at, check_out_at, status, auto_marked_absent, remarks, created_at, updated_at";

/**
 * Fetch today's staff attendance row for the signed-in user.
 * Returns `null` (not undefined) when the row doesn't exist yet so the
 * card UI can branch on `data === null` without `isLoading` ambiguity.
 *
 * The date is in the key: the query cache is persisted for a day, and the
 * date-less key handed the next morning yesterday's row (with its Check out
 * button, which updated yesterday's row by id) until the refetch landed.
 * Every write still invalidates the ["staff-attendance"] prefix.
 */
export function useTodayStaffAttendance() {
  const { user } = useAuth();
  const today = todayStr();
  return useQuery({
    queryKey: ["staff-attendance", "today", user?.id, today],
    queryFn: async (): Promise<StaffAttendanceRecord | null> => {
      if (!user?.id) return null;
      const { data, error } = await supabase
        .from("staff_attendance_records")
        .select(STAFF_ATTENDANCE_COLUMNS)
        .eq("staff_id", user.id)
        .eq("date", today)
        .maybeSingle();
      if (error) throw error;
      return (data as StaffAttendanceRecord | null) ?? null;
    },
    enabled: !!user?.id,
    staleTime: 60_000,
  });
}
```

- [ ] **Step 2: Create `src/hooks/useStaffCheckFlow.ts`**

```ts
import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useEffectiveInstitutionId } from "@/contexts/InstitutionContext";
import {
  useAttendanceSettings,
  useEffectiveAttendanceSettings,
  type AttendanceSettingsRow,
} from "@/hooks/useAttendance";
import { useCheckInStaff, useCheckOutStaff } from "@/hooks/useStaffAttendance";
import { useTeacherPendingSyllabusDays } from "@/hooks/useSyllabusProgress";
import { useUserRole } from "@/hooks/useUserRole";
import { DASHBOARD_ACTIONS_KEY, type DashboardActions } from "@/lib/dashboardActions";

export interface StaffCheckFlow {
  institutionId: string | null;
  /** The school's settings merged over the defaults (null without an institution). */
  settings: AttendanceSettingsRow | null;
  settingsLoading: boolean;
  isTeacher: boolean;
  checkIn: () => void;
  checkOut: (recordId: string) => void;
  checkingIn: boolean;
  checkingOut: boolean;
  backlogOpen: boolean;
  setBacklogOpen: (open: boolean) => void;
  syllabusOpen: boolean;
  setSyllabusOpen: (open: boolean) => void;
}

/**
 * The staff member's own check-in and check-out, shared by the greeting button
 * (StaffCheckInCard) and the dashboard action cards, so both record the same way and
 * open the same teacher sheets afterwards:
 *   check in  -> CheckInBacklogSheet, only when there are unlogged days;
 *   check out -> CheckOutSyllabusSheet, dismissible. Check-out is NEVER blocked.
 * Render <StaffCheckSheets flow={…} /> from a component that stays mounted when the button
 * or card that started the action disappears.
 *
 * Single flight: a ref, not isPending, guards each action, because a second tap in the
 * same frame still sees the old isPending (§23: mutations are idempotent). On success the
 * dashboard's card is dropped from the cached answer at once, so there is no second tap in
 * the gap before the refetch lands. The database's UNIQUE(staff_id, date) and the friendly
 * 23505 toast stay as the last line.
 */
export function useStaffCheckFlow(): StaffCheckFlow {
  const queryClient = useQueryClient();
  const { data: roleInfo } = useUserRole();
  const institutionId = useEffectiveInstitutionId(roleInfo?.institutionId ?? null);
  const settings = useEffectiveAttendanceSettings(institutionId);
  const { isLoading: settingsLoading } = useAttendanceSettings(institutionId);
  const checkInMutation = useCheckInStaff();
  const checkOutMutation = useCheckOutStaff();
  const isTeacher = !!roleInfo?.isTeacher;
  const [backlogOpen, setBacklogOpen] = useState(false);
  const [syllabusOpen, setSyllabusOpen] = useState(false);
  const checkInFlight = useRef(false);
  const checkOutFlight = useRef(false);
  // Same cache key as the My Week chip (staleTime 60s, teachers only): the backlog sheet
  // opens only when there is a backlog, never as an empty sheet every morning.
  const pendingBacklog = useTeacherPendingSyllabusDays({ includeToday: false, enabled: isTeacher });

  const checkIn = () => {
    if (!institutionId || checkInFlight.current) return;
    checkInFlight.current = true;
    checkInMutation.mutate(
      { institutionId, settings },
      {
        onSuccess: () => {
          queryClient.setQueriesData<DashboardActions>({ queryKey: DASHBOARD_ACTIONS_KEY }, (old) =>
            old ? { ...old, checkIn: null } : old,
          );
          if (isTeacher && (pendingBacklog.data?.unresolved_day_count ?? 0) > 0) setBacklogOpen(true);
        },
        onSettled: () => {
          checkInFlight.current = false;
        },
      },
    );
  };

  const checkOut = (recordId: string) => {
    if (checkOutFlight.current) return;
    checkOutFlight.current = true;
    checkOutMutation.mutate(recordId, {
      // Everyone checks out on the tap; teachers then get the syllabus sheet for today's
      // classes, which they can dismiss (it gated the check-out until 2026-09-11).
      onSuccess: () => {
        queryClient.setQueriesData<DashboardActions>({ queryKey: DASHBOARD_ACTIONS_KEY }, (old) =>
          old ? { ...old, checkOut: null } : old,
        );
        if (isTeacher) setSyllabusOpen(true);
      },
      onSettled: () => {
        checkOutFlight.current = false;
      },
    });
  };

  return {
    institutionId,
    settings,
    settingsLoading,
    isTeacher,
    checkIn,
    checkOut,
    checkingIn: checkInMutation.isPending,
    checkingOut: checkOutMutation.isPending,
    backlogOpen,
    setBacklogOpen,
    syllabusOpen,
    setSyllabusOpen,
  };
}
```

- [ ] **Step 3: Create `src/components/attendance/StaffCheckSheets.tsx`**

```tsx
import { CheckInBacklogSheet } from "@/components/lesson-completion/CheckInBacklogSheet";
import { CheckOutSyllabusSheet } from "@/components/lesson-completion/CheckOutSyllabusSheet";
import type { StaffCheckFlow } from "@/hooks/useStaffCheckFlow";

/** The teacher-only sheets that follow a check-in or check-out (see useStaffCheckFlow). */
export function StaffCheckSheets({ flow }: { flow: StaffCheckFlow }) {
  if (!flow.isTeacher) return null;
  return (
    <>
      <CheckOutSyllabusSheet open={flow.syllabusOpen} onOpenChange={flow.setSyllabusOpen} />
      <CheckInBacklogSheet open={flow.backlogOpen} onOpenChange={flow.setBacklogOpen} />
    </>
  );
}
```

- [ ] **Step 4: Rewrite `src/components/attendance/StaffCheckInCard.tsx`**

Replace the whole file with:

```tsx
import { type ReactNode } from "react";
import { format, parseISO } from "date-fns";
import { AlertTriangle, CalendarOff, Check, Clock, LogIn, LogOut, Palmtree, RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StaffCheckSheets } from "@/components/attendance/StaffCheckSheets";
import type { ViewRole } from "@/contexts/ActiveRoleContext";
import { useMyDashboardActions } from "@/hooks/useMyDashboardActions";
import { useStaffCheckFlow } from "@/hooks/useStaffCheckFlow";
import {
  useTodayStaffAttendance,
  classifyStaffCheckIn,
  type StaffAttendanceStatus,
} from "@/hooks/useStaffAttendance";
import { formatClock, ownsCheckButton } from "@/lib/dashboardActions";
import { cn } from "@/lib/utils";

// Token colours only, so both themes flip through the variables (design system).
const STATUS_CHIP: Record<StaffAttendanceStatus, { label: string; tone: string }> = {
  present:  { label: "Present",  tone: "bg-brand-primary/10 text-brand-primary" },
  late:     { label: "Late",     tone: "bg-signal-warn/10 text-signal-warn" },
  absent:   { label: "Absent",   tone: "bg-destructive/10 text-destructive" },
  on_leave: { label: "On leave", tone: "bg-brand-secondary/15 text-ink-700" },
  holiday:  { label: "Holiday",  tone: "bg-ink-400/10 text-ink-600" },
};

function StatusChip({ status }: { status: StaffAttendanceStatus }) {
  const { label, tone } = STATUS_CHIP[status];
  return (
    <span className={cn("inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wide", tone)}>
      {label}
    </span>
  );
}

export interface StaffCheckInCardProps {
  compact?: boolean;
  /**
   * The dashboard this compact button sits on. While that dashboard's action cards speak
   * for today's check-in or check-out (or say "Marked absent"), the button steps aside, so
   * there are never two of them (spec 2026-10-03). Leave it out anywhere else (Workday).
   */
  view?: ViewRole;
}

/**
 * Today's self-attendance for staff (teachers, coordinators, school admins). States:
 *
 *   - Loading, or a failed read (error before empty, §6: a failed read must never offer a
 *     Check in that may collide with a row it could not see).
 *   - Holiday, on leave, or marked absent (by the attendance pass or an admin): no action,
 *     because a self check-in would collide with the row (23505).
 *   - Not checked in yet: "Check in", previewing whether it will be recorded as late.
 *   - Checked in: "Check out", which is never blocked; teachers then get the dismissible
 *     syllabus sheet.
 *   - Checked out: both times, no actions.
 *
 * `compact` is the one small teal button in the dashboard greeting; the full card is on
 * Workday. Both share useStaffCheckFlow with the dashboard's action cards. Times read on the
 * 12-hour clock, like the cards.
 */
export function StaffCheckInCard({ compact = false, view }: StaffCheckInCardProps = {}) {
  const flow = useStaffCheckFlow();
  const todayQuery = useTodayStaffAttendance();
  const actions = useMyDashboardActions(compact && view ? view : null);

  if (!flow.institutionId) return null;

  const today = todayQuery.data ?? null;
  const loading = todayQuery.isLoading || flow.settingsLoading;
  const todayLabel = format(new Date(), "EEEE, d MMM");
  const checkInTimeLabel = formatClock(flow.settings ? flow.settings.staff_check_in_time : "08:00");
  const checkOutTimeLabel = formatClock(flow.settings ? flow.settings.staff_check_out_time : "16:00");
  // Absent with no check-in, whether the attendance pass or an admin wrote it.
  const markedAbsent = today?.status === "absent" && !today.check_in_at;
  const retry = () => {
    void todayQuery.refetch();
  };

  const pill = (label: string, icon: ReactNode, tone: "teal" | "rose" = "teal") => (
    <span
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-full px-3 text-sm font-medium",
        tone === "rose" ? "bg-destructive/10 text-destructive" : "bg-brand-primary/10 text-brand-primary",
      )}
    >
      {icon}
      {label}
    </span>
  );

  // Compact: ONE small teal button for the dashboard header (asked 2026-09-26: "just a small
  // button, not a bar, teal"). Once the day is closed it becomes a small inert pill. Icons
  // inside a Button need no size or margin: the Button sizes them and spaces them (gap-2).
  const renderCompact = (): ReactNode => {
    // While the cards show their error card they own nothing, so the button stays.
    if (view && !actions.isError && ownsCheckButton(actions.data)) return null;
    // Wait for the dashboard's answer too, so the button does not flash in and then step
    // aside a moment later when a check-in card arrives.
    const actionsPending = !!view && (actions.gatePending || (actions.enabled && !actions.data && !actions.isError));
    if (loading || actionsPending) return <Skeleton className="h-9 w-28 rounded-full" />;
    if (todayQuery.isError) {
      return (
        <Button
          size="sm"
          variant="outline"
          className="h-9 rounded-full px-3"
          aria-label="Couldn't load your check-in. Retry"
          onClick={retry}
        >
          <RotateCw />
          Retry
        </Button>
      );
    }
    if (today?.status === "holiday") return pill("Holiday", <CalendarOff className="h-4 w-4" />);
    if (today?.status === "on_leave") return pill("On leave", <Palmtree className="h-4 w-4" />);
    if (markedAbsent) return pill("Marked absent", <AlertTriangle className="h-4 w-4" />, "rose");
    if (today?.check_in_at) {
      if (today.check_out_at) {
        return pill(`Checked out ${format(parseISO(today.check_out_at), "h:mm a")}`, <Check className="h-4 w-4" />);
      }
      const recordId = today.id;
      return (
        <Button
          size="sm"
          title={`Checked in at ${format(parseISO(today.check_in_at), "h:mm a")}`}
          onClick={() => flow.checkOut(recordId)}
          disabled={flow.checkingOut}
          /* Same fill as the teacher chip in the app-bar role switcher. */
          className="h-9 rounded-full bg-brand-primary px-4 text-white shadow-card-sm hover:bg-brand-primary/90"
        >
          <LogOut />
          {flow.checkingOut ? "Checking out…" : "Check out"}
        </Button>
      );
    }
    const preview = flow.settings ? classifyStaffCheckIn(new Date(), flow.settings) : "present";
    return (
      <Button
        size="sm"
        title={preview === "present" ? `Check in by ${checkInTimeLabel}` : `Past ${checkInTimeLabel}: will be recorded as late`}
        onClick={flow.checkIn}
        disabled={flow.checkingIn}
        className="h-9 rounded-full bg-brand-primary px-4 text-white shadow-card-sm hover:bg-brand-primary/90"
      >
        <LogIn />
        {flow.checkingIn ? "Checking in…" : "Check in"}
      </Button>
    );
  };

  const notice = (icon: ReactNode, iconTone: string, title: string, body: string, chip: ReactNode) => (
    <div className="surface-card frosted-shadow rounded-card p-4 sm:p-6">
      <p className="eyebrow">Today · {todayLabel}</p>
      <div className="mt-2 flex items-start gap-3">
        <span className={cn("inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl", iconTone)}>{icon}</span>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-ink-900">{title}</h3>
          <p className="mt-1 text-sm text-ink-600">{body}</p>
        </div>
        {chip}
      </div>
    </div>
  );

  const renderFull = (): ReactNode => {
    if (loading) {
      return (
        <div className="surface-card frosted-shadow rounded-card p-4 sm:p-6">
          <Skeleton className="mb-3 h-4 w-24" />
          <Skeleton className="mb-2 h-7 w-48" />
          <Skeleton className="mt-4 h-10 w-32" />
        </div>
      );
    }
    if (todayQuery.isError) {
      return notice(
        <AlertTriangle className="h-5 w-5" />,
        "bg-destructive/10 text-destructive",
        "Couldn't load your check-in",
        "Check your connection and try again.",
        <Button variant="outline" size="sm" className="rounded-xl" onClick={retry}>
          <RotateCw />
          Retry
        </Button>,
      );
    }
    if (today?.status === "holiday") {
      return notice(<CalendarOff className="h-5 w-5" />, "bg-brand-primary/10 text-brand-primary",
        "Holiday", "No check-in needed today.", <StatusChip status="holiday" />);
    }
    if (today?.status === "on_leave") {
      return notice(<Palmtree className="h-5 w-5" />, "bg-brand-primary/10 text-brand-primary",
        "On leave today", "No check-in needed today.", <StatusChip status="on_leave" />);
    }
    if (today && markedAbsent) {
      return notice(<AlertTriangle className="h-5 w-5" />, "bg-destructive/10 text-destructive",
        "Marked absent",
        today.auto_marked_absent
          ? `You didn't check in by ${checkInTimeLabel}. Contact your admin if this is wrong.`
          : "Your admin marked you absent today. Contact them if this is wrong.",
        <StatusChip status="absent" />);
    }

    if (today?.check_in_at) {
      const checkedInAt = format(parseISO(today.check_in_at), "h:mm a");
      const checkedOutAt = today.check_out_at ? format(parseISO(today.check_out_at), "h:mm a") : null;
      const recordId = today.id;
      // Records written before the manual check-in cap may say "absent" although the person
      // checked in; show them as late (display only).
      const displayedStatus: StaffAttendanceStatus =
        today.status === "absent" && !today.auto_marked_absent ? "late" : today.status;
      return (
        <div className="surface-card frosted-shadow rounded-card p-4 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="eyebrow">Today · {todayLabel}</p>
              <h3 className="mt-1 text-lg font-semibold text-ink-900 sm:text-xl">Checked in at {checkedInAt}</h3>
              {checkedOutAt && <p className="mt-1 text-sm text-ink-600">Checked out at {checkedOutAt}</p>}
            </div>
            <StatusChip status={displayedStatus} />
          </div>
          {!checkedOutAt && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button onClick={() => flow.checkOut(recordId)} disabled={flow.checkingOut} variant="outline" className="rounded-xl">
                <LogOut />
                {flow.checkingOut ? "Checking out…" : "Check Out"}
              </Button>
              <span className="inline-flex items-center text-xs text-ink-500">
                <Clock className="mr-1 h-3.5 w-3.5" />
                Window closes at {checkOutTimeLabel}
              </span>
            </div>
          )}
        </div>
      );
    }

    // Not checked in yet: preview what tapping now would record (manual check-ins are
    // capped at "late", see useStaffAttendance.ts).
    const previewStatus = flow.settings ? classifyStaffCheckIn(new Date(), flow.settings) : "present";
    const displayStatus: StaffAttendanceStatus = previewStatus === "absent" ? "late" : previewStatus;
    const previewLabel =
      previewStatus === "present"
        ? `On time · check-in by ${checkInTimeLabel}`
        : previewStatus === "absent"
          ? "Very late · past grace period, but check-in will be recorded as late"
          : `Late · within grace period (cut-off was ${checkInTimeLabel})`;
    return (
      <div className="surface-card frosted-shadow rounded-card p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="eyebrow">Today · {todayLabel}</p>
            <h3 className="mt-1 text-lg font-semibold text-ink-900 sm:text-xl">Mark your attendance</h3>
            <p className="mt-1 text-sm text-ink-600">{previewLabel}</p>
          </div>
          {displayStatus !== "present" && <StatusChip status={displayStatus} />}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button onClick={flow.checkIn} disabled={flow.checkingIn} className="rounded-xl bg-brand-primary text-white hover:bg-brand-primary/90">
            {flow.checkingIn ? <Check /> : <LogIn />}
            {flow.checkingIn ? "Checking in…" : "Check In"}
          </Button>
          <span className="inline-flex items-center text-xs text-ink-500">
            <Clock className="mr-1 h-3.5 w-3.5" />
            Window: {checkInTimeLabel} to {checkOutTimeLabel}
          </span>
        </div>
      </div>
    );
  };

  return (
    <>
      {compact ? renderCompact() : renderFull()}
      {/* One element at one position in every branch: a check-in flips the branch above,
          and the open backlog sheet must not be unmounted by it (that wiped its picker
          state and flickered the sheet). */}
      <StaffCheckSheets flow={flow} />
    </>
  );
}
```

Deliberate visible changes on Workday and in the greeting:
- times read "8:00 AM", like the cards;
- the old "Window: in – out" label used an en-dash and now reads "in to out";
- the status chips take token colours;
- spacing moved onto the 4/8/12/16/24 scale (no more `p-5`, `mt-0.5`, `px-2.5`, `gap-1.5` or `mr-1.5`), and icons inside a Button take its own `gap-2` and `size-4`.

- [ ] **Step 5: Gate the task**

Run (Git Bash):

```bash
npm run typecheck
npx eslint src/hooks/useStaffCheckFlow.ts src/components/attendance/StaffCheckSheets.tsx src/hooks/useStaffAttendance.ts src/components/attendance/StaffCheckInCard.tsx
npx eslint --rule '{"@typescript-eslint/no-unused-vars":["error",{"argsIgnorePattern":"^_"}]}' src/hooks/useStaffCheckFlow.ts src/components/attendance/StaffCheckSheets.tsx src/hooks/useStaffAttendance.ts src/components/attendance/StaffCheckInCard.tsx
npm run test:cache
```

Expected: typecheck exits 0; no eslint errors in either run; `test:cache` passes.

- [ ] **Step 6: Commit**

```powershell
git add -- src/hooks/useStaffCheckFlow.ts src/components/attendance/StaffCheckSheets.tsx src/hooks/useStaffAttendance.ts src/components/attendance/StaffCheckInCard.tsx
git commit -m @'
feat(attendance): one check-in/out flow for the greeting button and the cards

useStaffCheckFlow holds the mutations, single-flight refs and the teacher
sheets; StaffCheckInCard uses it, gains On leave, admin-set Marked absent
and an error state with Retry, and steps aside while the dashboard's
cards own the check-in. The today-row key now carries the date, so the
next morning never restores yesterday's Check out button.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 5: Deep links, and the shared kick on Workday

**Files:**
- Modify: `src/pages/staff/WorkdayPage.tsx` (imports at lines 1-2 and 43; the tab state at line 68; the kick at lines 97-117)
- Modify: `src/pages/school/SchoolAttendancePage.tsx` (imports at line 1; the tab state at lines 145-146)

**Interfaces:**
- Consumes: `useAttendancePassKick` (Task 3), `isPastCutoff` and `useEffectiveAttendanceSettings` (existing), and `useSearchParams` from `react-router-dom` v6.
- Produces: `/staff/workday?tab=attendance|leaves|staff-attendance|staff-leaves|substitutions` and `/school/attendance?tab=<value>` open that tab. A tab the viewer's role does not have falls back to the page default.

- [ ] **Step 1: WorkdayPage imports**

In `src/pages/staff/WorkdayPage.tsx` replace:

```tsx
import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
```

with:

```tsx
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
```

and replace:

```tsx
import { useRunAttendancePass } from "@/hooks/useRunAttendancePass";
```

with:

```tsx
import { useAttendancePassKick } from "@/hooks/useAttendancePassKick";
```

- [ ] **Step 2: WorkdayPage tab from the URL**

Replace:

```tsx
type WorkdayTab = "attendance" | "leaves" | "staff-attendance" | "staff-leaves" | "substitutions";
```

with:

```tsx
type WorkdayTab = "attendance" | "leaves" | "staff-attendance" | "staff-leaves" | "substitutions";

const WORKDAY_TABS: readonly string[] = ["attendance", "leaves", "staff-attendance", "staff-leaves", "substitutions"];
const isWorkdayTab = (v: string | null): v is WorkdayTab => v !== null && WORKDAY_TABS.includes(v);
```

and replace:

```tsx
  const [tab, setTab] = useState<WorkdayTab>("attendance");
```

with:

```tsx
  const [searchParams] = useSearchParams();
  // ?tab= opens a tab directly: the dashboard's substitution and leave cards link to
  // ?tab=substitutions and ?tab=staff-leaves. A tab this person's view does not have falls
  // back to My Attendance through safeTab below, as a stale click always did.
  const [tab, setTab] = useState<WorkdayTab>(() => {
    const requested = searchParams.get("tab");
    return isWorkdayTab(requested) ? requested : "attendance";
  });
```

- [ ] **Step 3: WorkdayPage kick through the shared hook**

Replace the block from `// Materialize today's auto-absent staff rows + pending substitutions the` through the closing `}, [reviewsStaff, institutionId, effectiveSettings, runPass]);` with:

```tsx
  // Materialize today's auto-absent staff rows + pending substitutions the moment an
  // admin/coordinator opens the staff side past local cutoff, instead of waiting up to 15 min
  // for the cron. Same once-a-day sessionStorage flag as the dashboards (useAttendancePassKick),
  // so it waits for the school's REAL settings row: the effective settings are the 08:00
  // defaults while loading and for a school with no row (where the pass does nothing), and
  // spending the shared flag then would skip the dashboard's kick for the rest of the day.
  const settingsQuery = useAttendanceSettings(institutionId);
  const effectiveSettings = useEffectiveAttendanceSettings(institutionId);
  useAttendancePassKick(
    institutionId,
    reviewsStaff && settingsQuery.isSuccess && !!settingsQuery.data && !!effectiveSettings && isPastCutoff(effectiveSettings),
  );
```

and replace:

```tsx
import { useEffectiveAttendanceSettings } from "@/hooks/useAttendance";
```

with:

```tsx
import { useAttendanceSettings, useEffectiveAttendanceSettings } from "@/hooks/useAttendance";
```

- [ ] **Step 4: SchoolAttendancePage tab from the URL**

In `src/pages/school/SchoolAttendancePage.tsx` replace:

```tsx
import { useMemo, useState } from "react";
```

with:

```tsx
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
```

and replace:

```tsx
  const defaultValue = tabs[0]?.value ?? "leaves";
  const [activeTab, setActiveTab] = useState<string>(defaultValue);
```

with:

```tsx
  const [searchParams] = useSearchParams();
  const defaultValue = tabs[0]?.value ?? "leaves";
  // ?tab= opens a tab directly (the dashboard's leave card links to ?tab=leaves); a tab this
  // person's view does not have falls back to the default through safeActive below.
  const [activeTab, setActiveTab] = useState<string>(() => searchParams.get("tab") ?? defaultValue);
```

- [ ] **Step 5: Gate the task**

Run (Git Bash):

```bash
npm run typecheck
npx eslint src/pages/staff/WorkdayPage.tsx src/pages/school/SchoolAttendancePage.tsx
npx eslint --rule '{"@typescript-eslint/no-unused-vars":["error",{"argsIgnorePattern":"^_"}]}' src/pages/staff/WorkdayPage.tsx src/pages/school/SchoolAttendancePage.tsx
```

Expected: typecheck exits 0; no eslint errors (the stale-import pass proves `format`, `useEffect` and `useRunAttendancePass` are gone).

- [ ] **Step 6: Commit**

```powershell
git add -- src/pages/staff/WorkdayPage.tsx src/pages/school/SchoolAttendancePage.tsx
git commit -m @'
feat(attendance): ?tab= deep links on Workday and Attendance

The dashboard's substitution and leave cards open the right tab; a tab
the viewer's role lacks falls back as before. Workday's attendance-pass
kick moves to useAttendancePassKick, shared with the dashboards.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 6: The cards on the three staff dashboards

**Files:**
- Modify: `src/index.css` (one token in `:root` after `--clay-tile-shadow-hover` at about line 186, the same token in `.dark` at about line 408, and `.clay-card` after the `.clay-tone-rose` line at about line 942, inside the same `@layer components` block)
- Create: `src/components/dashboards/actions/ActionCard.tsx`
- Create: `src/components/dashboards/actions/ActionCardDeck.tsx`
- Create: `src/components/dashboards/actions/DashboardTopSlot.tsx`
- Modify: `src/components/dashboards/NavigationHub.tsx` (imports, props, lines 110-111 and 122)
- Modify: `src/components/dashboards/RoleBasedDashboard.tsx:239-241`
- Modify: `src/components/dashboards/CoordinatorDashboard.tsx` (line 24 import, lines 41-42 and 51)
- Modify: `src/components/dashboards/SchoolAdminCommandCenter.tsx` (import lines 13-17, lines 286-287 and 301)

**Interfaces:**
- Consumes: Tasks 2 to 4, `SchoolSceneIllustration`, `ClayPebble` and `Tone` from `@/components/shared/surfaces`, `formatClassName` from `@/lib/utils`, and shadcn `Button` with `asChild`.
- Produces:
  - `<DashboardTopSlot view={ViewRole} />`.
  - `<ActionCard tone icon title detail actions? />`.
  - `<ActionCardDeck items={DeckItem[]} />`, with `DeckItem = { key: string; label: string; node: ReactNode }` and `SLOT_BOX`.
  - `NavigationHub` gains `actionsView?: ViewRole`.

- [ ] **Step 1: The card slab in `src/index.css`**

Make three insertions, each inside a block that already exists.

(a) In `:root`, find:

```css
    --clay-tile-shadow-hover: inset 0 1px 0 hsl(0 0% 100% / 0.7), 0 2px 4px hsl(25 35% 20% / 0.06),
      0 22px 36px -18px hsl(25 35% 20% / 0.36);
```

and add right after it:

```css
    /* The action card's shadow below 1024px: flat enough that the swipe row, a horizontal
       scroller (which clips), never cuts it off. */
    --clay-card-shadow-flat: inset 0 1px 0 hsl(0 0% 100% / 0.7), 0 1px 2px hsl(25 35% 20% / 0.06);
```

(b) In `.dark`, find:

```css
    --clay-tile-shadow-hover: inset 0 1px 0 hsl(0 0% 100% / 0.06), 0 2px 4px hsl(0 0% 0% / 0.30),
      0 24px 38px -18px hsl(0 0% 0% / 0.80);
```

and add right after it:

```css
    --clay-card-shadow-flat: inset 0 1px 0 hsl(0 0% 100% / 0.06), 0 1px 2px hsl(0 0% 0% / 0.30);
```

(c) Find:

```css
  .clay-tone-rose   { --clay-g: var(--clay-rose);   --clay-g-ink: var(--clay-rose-ink); }
```

and add right after it, still inside the same block:

```css

  /* Dashboard action cards (2026-10-03, DashboardTopSlot): the clay tile's slab without its
     hover lift, because the card is not a link (its buttons are). Below 1024px the cards sit
     in a horizontal scroller, which clips a deep shadow, so they float only from 1024px. */
  .clay-card {
    position: relative;
    border-radius: 22px;
    border: 1px solid hsl(var(--surface-stroke));
    background:
      radial-gradient(120% 95% at 100% 0%, hsl(var(--clay-g) / 0.16) 0%, transparent 58%),
      linear-gradient(180deg, hsl(var(--clay-card-top)), hsl(var(--clay-card-bot)));
    box-shadow: var(--clay-card-shadow-flat);
  }
  @media (min-width: 1024px) {
    .clay-card { box-shadow: var(--clay-tile-shadow-hover); }
  }
```

Every variable used is defined in both `:root` and `.dark` (design system rule).

- [ ] **Step 2: Create `src/components/dashboards/actions/ActionCard.tsx`**

```tsx
import { type ReactNode } from "react";

import { ClayPebble, type Tone } from "@/components/shared/surfaces";
import { cn } from "@/lib/utils";

// Written out in full so Tailwind keeps every class (index.css "Clay tiles").
const CLAY_TONE: Record<Tone, string> = {
  teal: "clay-tone-teal",
  violet: "clay-tone-violet",
  peach: "clay-tone-peach",
  mint: "clay-tone-mint",
  sky: "clay-tone-sky",
  rose: "clay-tone-rose",
};

export interface ActionCardProps {
  tone: Tone;
  icon: ReactNode;
  title: string;
  detail: string;
  actions?: ReactNode;
}

/**
 * One floating clay card (index.css .clay-card): pebble, title, one line of detail, buttons.
 * Fits the banner's box at every width. Below 1024px it is the only card in view (the deck
 * swipes), one line each: 104px tall on a phone, 86px inside its border and px-3 py-2 for a
 * 40px pebble row, an 8px gap and 32px buttons. From 1024px the cards sit side by side and
 * the title and detail may wrap to two lines (160px box, p-4).
 */
export function ActionCard({ tone, icon, title, detail, actions }: ActionCardProps) {
  return (
    <article className={cn("clay-card flex h-full min-w-0 flex-col justify-between gap-2 px-3 py-2 lg:p-4", CLAY_TONE[tone])}>
      <div className="flex min-w-0 items-start gap-3">
        <ClayPebble tone={tone} size="sm">
          {icon}
        </ClayPebble>
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-semibold leading-[18px] text-ink-900 lg:line-clamp-2 lg:whitespace-normal lg:leading-5">
            {title}
          </h3>
          <p className="mt-1 line-clamp-1 text-[13px] leading-[18px] text-ink-600 lg:line-clamp-2">{detail}</p>
        </div>
      </div>
      {actions ? <div className="flex flex-wrap items-center justify-end gap-2">{actions}</div> : null}
    </article>
  );
}
```

- [ ] **Step 3: Create `src/components/dashboards/actions/ActionCardDeck.tsx`**

```tsx
import { useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** The banner's box at every width: the cards, the waiting sky and the error card share it. */
export const SLOT_BOX = "h-28 sm:h-32 md:h-36 lg:h-40 xl:h-44";

export interface DeckItem {
  key: string;
  /** read out by the position dots */
  label: string;
  node: ReactNode;
}

/**
 * The due cards in the banner's box. Below 1024px (phones, and tablets beside the open
 * sidebar, where three cards cannot fit): one card per view, swiped with CSS scroll-snap,
 * with position dots (a 24px button each). From 1024px: every card side by side. No
 * carousel library (§23 bundle).
 */
export function ActionCardDeck({ items }: { items: DeckItem[] }) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const current = Math.min(active, Math.max(0, items.length - 1));

  const onScroll = () => {
    const row = rowRef.current;
    if (!row || row.clientWidth === 0) return;
    setActive(Math.round(row.scrollLeft / row.clientWidth));
  };

  const goTo = (i: number) => {
    const row = rowRef.current;
    if (!row) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    row.scrollTo({ left: i * row.clientWidth, behavior: reduce ? "auto" : "smooth" });
  };

  return (
    <section aria-label="Things to do today" className={cn("relative", SLOT_BOX)}>
      <div
        ref={rowRef}
        onScroll={onScroll}
        className="scrollbar-hide flex h-full snap-x snap-mandatory overflow-x-auto py-1 lg:snap-none lg:gap-3 lg:overflow-visible lg:py-0"
      >
        {items.map((item) => (
          <div key={item.key} className="h-full w-full shrink-0 snap-center lg:w-auto lg:min-w-0 lg:flex-1 lg:shrink">
            {item.node}
          </div>
        ))}
      </div>
      {items.length > 1 && (
        <div className="absolute bottom-1 left-2 flex lg:hidden">
          {items.map((item, i) => (
            <Button
              key={item.key}
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6 rounded-full p-0 hover:bg-transparent"
              aria-label={`Show card ${i + 1} of ${items.length}: ${item.label}`}
              aria-current={i === current ? "true" : undefined}
              onClick={() => goTo(i)}
            >
              <span
                className={cn(
                  "block h-1.5 rounded-full transition-all duration-200",
                  i === current ? "w-4 bg-brand-primary" : "w-1.5 bg-ink-500",
                )}
              />
            </Button>
          ))}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Create `src/components/dashboards/actions/DashboardTopSlot.tsx`**

```tsx
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CalendarClock, LogIn, LogOut, RotateCw, UserPlus2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StaffCheckSheets } from "@/components/attendance/StaffCheckSheets";
import { SchoolSceneIllustration } from "@/components/shared/illustrations";
import type { ViewRole } from "@/contexts/ActiveRoleContext";
import { useAttendancePassKick } from "@/hooks/useAttendancePassKick";
import { useInstitutionTimezone } from "@/hooks/useInstitutionTimezone";
import {
  useDashboardActionsRefresh,
  useMyDashboardActions,
  type MyDashboardActions,
} from "@/hooks/useMyDashboardActions";
import { useStaffCheckFlow, type StaffCheckFlow } from "@/hooks/useStaffCheckFlow";
import {
  COVER_LINK,
  checkInCopy,
  checkOutCopy,
  coverCopy,
  dueCards,
  leaveCopy,
  leaveLinks,
  schoolClock,
  type DashboardActions,
} from "@/lib/dashboardActions";
import { cn, formatClassName } from "@/lib/utils";
import { ActionCard } from "./ActionCard";
import { ActionCardDeck, SLOT_BOX, type DeckItem } from "./ActionCardDeck";

// Icons inside a Button need no size or margin: the Button sizes them and spaces them (gap-2).
const PRIMARY = "h-8 rounded-full bg-brand-primary px-4 text-white hover:bg-brand-primary/90";
const SECONDARY = "h-8 rounded-full px-4";

/** The banner's sky with nothing on it: shown while the answer is on its way, so the 3D
 *  scene never starts only to give way to cards a moment later. */
function SkyBox() {
  return (
    <div
      className={cn("relative w-full overflow-hidden rounded-card scene-banner border border-white/40 dark:border-white/10", SLOT_BOX)}
      aria-hidden
    />
  );
}

/** The banner as the slot shows it: the sky box usually came first and is the same
 *  gradient, so no second fade-in (`.scene-banner-anim` sits outside Tailwind's layers,
 *  hence the `!`). */
function Banner() {
  return <SchoolSceneIllustration className="!animate-none" />;
}

/** Error before empty (§6): a failed answer must never read as "nothing to do". The
 *  greeting button stays while this shows, so check-in and check-out remain possible. */
function ActionsErrorCard({ onRetry }: { onRetry: () => void }) {
  return (
    <section aria-label="Things to do today" className={SLOT_BOX}>
      <ActionCard
        tone="rose"
        icon={<AlertTriangle />}
        title="Couldn't load your day"
        detail="Check your connection and try again."
        actions={
          <Button size="sm" variant="outline" className={SECONDARY} onClick={onRetry}>
            <RotateCw />
            Retry
          </Button>
        }
      />
    </section>
  );
}

function buildItems(a: DashboardActions, flow: StaffCheckFlow, nowHHMM: string): DeckItem[] {
  const items: DeckItem[] = [];
  for (const kind of dueCards(a)) {
    if (kind === "check_in" && a.checkIn) {
      const copy = checkInCopy(a.checkIn, nowHHMM);
      const absent = a.checkIn.state === "absent";
      items.push({
        key: kind,
        label: copy.title,
        node: (
          <ActionCard
            tone={absent ? "rose" : "teal"}
            icon={absent ? <AlertTriangle /> : <LogIn />}
            title={copy.title}
            detail={copy.detail}
            actions={
              absent ? undefined : (
                <Button
                  size="sm"
                  className={PRIMARY}
                  onClick={flow.checkIn}
                  disabled={flow.checkingIn || flow.settingsLoading || !flow.institutionId}
                >
                  <LogIn />
                  {flow.checkingIn ? "Checking in…" : "Check in"}
                </Button>
              )
            }
          />
        ),
      });
    } else if (kind === "cover" && a.cover) {
      const copy = coverCopy(a.cover, formatClassName);
      items.push({
        key: kind,
        label: copy.title,
        node: (
          <ActionCard
            tone="peach"
            icon={<UserPlus2 />}
            title={copy.title}
            detail={copy.detail}
            actions={
              <Button asChild size="sm" className={PRIMARY}>
                <Link to={COVER_LINK}>Assign</Link>
              </Button>
            }
          />
        ),
      });
    } else if (kind === "leave" && a.leave) {
      const copy = leaveCopy(a.leave);
      items.push({
        key: kind,
        label: copy.title,
        node: (
          <ActionCard
            tone="violet"
            icon={<CalendarClock />}
            title={copy.title}
            detail={copy.detail}
            actions={leaveLinks(a.leave).map((link, i) => (
              <Button key={link.to} asChild size="sm" variant={i === 0 ? "default" : "outline"} className={i === 0 ? PRIMARY : SECONDARY}>
                <Link to={link.to}>{link.label}</Link>
              </Button>
            ))}
          />
        ),
      });
    } else if (kind === "check_out" && a.checkOut) {
      const copy = checkOutCopy(a.checkOut);
      const recordId = a.checkOut.recordId;
      items.push({
        key: kind,
        label: copy.title,
        node: (
          <ActionCard
            tone="mint"
            icon={<LogOut />}
            title={copy.title}
            detail={copy.detail}
            actions={
              <Button size="sm" className={PRIMARY} onClick={() => flow.checkOut(recordId)} disabled={flow.checkingOut}>
                <LogOut />
                {flow.checkingOut ? "Checking out…" : "Check out"}
              </Button>
            }
          />
        ),
      });
    }
  }
  return items;
}

/**
 * The cards for a dashboard where they apply (a staff view with the attendance feature on).
 * It owns the check-in flow, the attendance-pass kick and the teacher sheets, so a school
 * with attendance off makes none of those requests (spec §1: as fast as today).
 */
function ActiveTopSlot({ actions }: { actions: MyDashboardActions }) {
  // Owned here, not by a card: a check-in removes its card, and the teacher's follow-up
  // sheet must survive that.
  const flow = useStaffCheckFlow();
  // spread: every admin and coordinator dashboard of the school turns due at the same cutoff;
  // quiet: a background kick never toasts (the cron is the safety net).
  useAttendancePassKick(flow.institutionId, actions.data?.passDue === true, { spread: true, quiet: true });
  const timeZone = useInstitutionTimezone();

  // While a check-in card is due, re-render once a minute so its line turns "late" at the
  // school's check-in time without a request: nothing in the server's answer changes then.
  const checkInDue = actions.data?.checkIn?.state === "due";
  const [, setMinuteTick] = useState(0);
  useEffect(() => {
    if (!checkInDue) return;
    const id = window.setInterval(() => setMinuteTick((t) => t + 1), 60_000);
    return () => window.clearInterval(id);
  }, [checkInDue]);

  let content: ReactNode;
  if (actions.isError) {
    // Checked BEFORE the data: TanStack keeps the last answer when a refetch fails, and the
    // persisted cache restores this morning's, so "has data" never means "is current".
    content = <ActionsErrorCard onRetry={actions.refetch} />;
  } else if (!actions.data) {
    content = <SkyBox />;
  } else {
    const items = buildItems(actions.data, flow, schoolClock(new Date(), timeZone).time);
    content = items.length > 0 ? <ActionCardDeck items={items} /> : <Banner />;
  }

  return (
    <>
      {content}
      <StaffCheckSheets flow={flow} />
    </>
  );
}

/**
 * The top of a staff dashboard (spec 2026-10-03). When something is waiting for this person
 * today (check in, a period without a substitute, leave to decide, check out), floating clay
 * cards take the banner's exact box, in that order; otherwise the Clay School banner shows.
 * The banner mounts only when no card is due, so its 3D engine is never downloaded on the
 * way to showing cards.
 *
 * `view` is THIS dashboard's view: teacher hub "teacher", coordinator dashboard
 * "coordinator", admin landing "admin" (§25: one hat at a time; the server can only narrow).
 */
export function DashboardTopSlot({ view }: { view: ViewRole }) {
  const actions = useMyDashboardActions(view);
  useDashboardActionsRefresh(actions);
  if (actions.gatePending) return <SkyBox />;
  if (!actions.enabled) return <Banner />;
  return <ActiveTopSlot actions={actions} />;
}
```

- [ ] **Step 5: Teacher hub (NavigationHub + RoleBasedDashboard)**

In `src/components/dashboards/NavigationHub.tsx`, after the line `import { StaffCheckInCard } from "@/components/attendance/StaffCheckInCard";` add:

```tsx
import type { ViewRole } from "@/contexts/ActiveRoleContext";
import { DashboardTopSlot } from "./actions/DashboardTopSlot";
```

Replace:

```tsx
  showCheckIn?: boolean;
}
```

with:

```tsx
  showCheckIn?: boolean;
  /**
   * The view whose action cards replace the banner when something is due (spec 2026-10-03).
   * Only the teacher dashboard passes it; the school admin's category sub-grid keeps the
   * banner.
   */
  actionsView?: ViewRole;
}
```

Replace:

```tsx
export function NavigationHub({ roleName, navGroups, showCheckIn = false }: NavigationHubProps) {
```

with:

```tsx
export function NavigationHub({ roleName, navGroups, showCheckIn = false, actionsView }: NavigationHubProps) {
```

Replace:

```tsx
      {/* Decorative scene banner — sits at the top of the dashboard. */}
      <SchoolSceneIllustration />
```

with:

```tsx
      {/* The day's action cards when something is due, else the Clay School banner. */}
      {actionsView ? <DashboardTopSlot view={actionsView} /> : <SchoolSceneIllustration />}
```

Replace:

```tsx
          {checkInVisible && <StaffCheckInCard compact />}
```

with:

```tsx
          {checkInVisible && <StaffCheckInCard compact view={actionsView} />}
```

In `src/components/dashboards/RoleBasedDashboard.tsx` replace:

```tsx
        return <NavigationHub roleName="Teacher" navGroups={teacherNavGroups} showCheckIn />;
```

with:

```tsx
        // actionsView: the day's action cards replace the banner when something is due.
        return <NavigationHub roleName="Teacher" navGroups={teacherNavGroups} showCheckIn actionsView="teacher" />;
```

- [ ] **Step 6: Coordinator dashboard**

In `src/components/dashboards/CoordinatorDashboard.tsx` replace:

```tsx
import { SchoolSceneIllustration } from "@/components/shared/illustrations";
```

with:

```tsx
import { DashboardTopSlot } from "./actions/DashboardTopSlot";
```

Replace:

```tsx
      {/* Decorative scene banner — sits at the top of the dashboard. */}
      <SchoolSceneIllustration />
```

with:

```tsx
      {/* The day's action cards when something is due, else the Clay School banner. */}
      <DashboardTopSlot view="coordinator" />
```

Replace:

```tsx
        extras={isFeatureEnabled("attendance") ? <StaffCheckInCard compact /> : undefined}
```

with:

```tsx
        extras={isFeatureEnabled("attendance") ? <StaffCheckInCard compact view="coordinator" /> : undefined}
```

- [ ] **Step 7: School admin landing**

In `src/components/dashboards/SchoolAdminCommandCenter.tsx` replace:

```tsx
import { NavigationHub, type NavGroup } from "./NavigationHub";
```

with:

```tsx
import { NavigationHub, type NavGroup } from "./NavigationHub";
import { DashboardTopSlot } from "./actions/DashboardTopSlot";
```

Delete the line:

```tsx
import { SchoolSceneIllustration } from "@/components/shared/illustrations";
```

Replace:

```tsx
      {/* Decorative scene banner — sits at the top of the dashboard. */}
      <SchoolSceneIllustration />
```

with:

```tsx
      {/* The day's action cards when something is due, else the Clay School banner. */}
      <DashboardTopSlot view="admin" />
```

Replace:

```tsx
          {checkInVisible && <StaffCheckInCard compact />}
```

with:

```tsx
          {checkInVisible && <StaffCheckInCard compact view="admin" />}
```

(Search for `<SchoolSceneIllustration />` in each file first: each replacement above must match exactly one occurrence. The sub-grid branch of `SchoolAdminCommandCenter` renders `NavigationHub` without `actionsView`, so it keeps the banner.)

- [ ] **Step 8: Gate the task**

Run (Git Bash):

```bash
FILES="src/components/dashboards/actions/ActionCard.tsx src/components/dashboards/actions/ActionCardDeck.tsx src/components/dashboards/actions/DashboardTopSlot.tsx src/components/dashboards/NavigationHub.tsx src/components/dashboards/RoleBasedDashboard.tsx src/components/dashboards/CoordinatorDashboard.tsx src/components/dashboards/SchoolAdminCommandCenter.tsx"
npm run typecheck
npx eslint $FILES
npx eslint --rule '{"@typescript-eslint/no-unused-vars":["error",{"argsIgnorePattern":"^_"}]}' $FILES
grep -rn "—" src/components/dashboards/actions/ src/lib/dashboardActions.ts src/components/attendance/StaffCheckInCard.tsx || echo "no em-dash in the new files"
```

Expected:
- typecheck exits 0;
- the plain eslint run prints no errors;
- the stale-import run exits 1 with exactly the 7 pre-existing errors listed in Global Constraints and no other;
- the grep prints `no em-dash in the new files`.

- [ ] **Step 9: Commit**

```powershell
git add -- src/index.css src/components/dashboards/actions src/components/dashboards/NavigationHub.tsx src/components/dashboards/RoleBasedDashboard.tsx src/components/dashboards/CoordinatorDashboard.tsx src/components/dashboards/SchoolAdminCommandCenter.tsx
git commit -m @'
feat(dashboard): action cards replace the banner when something is due

DashboardTopSlot shows check-in, substitution, leave and check-out cards
in the banner's box on the teacher hub, coordinator dashboard and admin
landing: swipe with dots below 1024px, side by side from 1024px, sky while
loading, an error card with Retry, the Clay School banner when nothing
is due. The greeting button steps aside while a card owns the check-in.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 7: Bundle cap, full gate, real-browser check, merge to main

**Files:**
- Modify: `scripts/check-banner-chunk.mjs:58-66` (only if the Dashboard chunk outgrew 52.5 kB)
- Modify: `.claude/skills/timetable-module/SKILL.md` (append a section)
- Scratch (never committed), all in `C:\Users\tusha\AppData\Local\Temp\claude\d--Salci-Projects-Salci-Main-Portal-salci-eco-core-main\b3b9ebcc-6993-4814-b4bd-f33d8829a994\scratchpad\harness\` (it already holds `playwright-core`): `login-8081.mjs`, `action-cards-check.mjs`, `action-cards-interact.mjs`, `action-cards-key.mjs`. The three signed-in profiles go in sibling folders `chrome-profile-teacher-8081`, `chrome-profile-coordinator-8081` and `chrome-profile-admin-8081`; delete them when Task 7 ends.

- [ ] **Step 1: Build and read the Dashboard chunk size**

Run (Git Bash): `cd "/d/Salci Projects/Salci-Main-Portal/_wt-action-cards" && set -o pipefail && npx vite build 2>&1 | tail -5 && npm run check:banner-chunk`

Expected: build exit 0. In `check:banner-chunk`, every line PASSes except possibly `the banner's chunk is at most 52.50 kB minified`.

- [ ] **Step 2: If that one line fails, raise the cap by exactly what the cards add**

Take the measured size N kB printed on the `scene-banner-anim` line. Set `MAX_DASHBOARD_BYTES` to ceil(N × 1.05 / 0.5) × 500 bytes; for example, N = 58.31 gives `61_500`. Append this sentence to the comment block above the constant:

```js
// 2026-10-03: the dashboard action cards (DashboardTopSlot, the deck and its cards,
// useMyDashboardActions, the shared check-in flow and src/lib/dashboardActions.ts) joined
// the chunk: N kB measured with them. Same ~5% headroom rule.
```

Write the real measured number in place of `N`. Also update the header line near the top of the script (about line 25, "larger than 52.5 kB minified") to the new cap. Re-run `npm run check:banner-chunk`; expected: all PASS. If the line already passed, change nothing.

- [ ] **Step 3: The full gate (§5a + repo tests)**

Run (Git Bash):

```bash
# types.ts is generated; its one spliced line is proved by typecheck, not lint
CHANGED=$(git diff --name-only main...HEAD -- 'src/**/*.ts' 'src/**/*.tsx' | grep -v 'integrations/supabase/types.ts' | tr '\n' ' ')
npm run typecheck
npx eslint $CHANGED
npx eslint --rule '{"@typescript-eslint/no-unused-vars":["error",{"argsIgnorePattern":"^_"}]}' $CHANGED
npx vite build
npm run check:banner-chunk
npm run test:cache
npm run test:banner
npm run test:banner-tod
npm run test:dashboard-actions
```

Expected:
- every command exits 0, and the last prints `68 passed, 0 failed`;
- the one exception is the stale-import run, which exits 1 with exactly the 7 pre-existing errors listed in Global Constraints.

- [ ] **Step 4: Dev server and three sign-ins**

Start the worktree's dev server on its own port. Run it in the background and leave it up for steps 5 to 8:

```bash
npx vite --port 8081 --strictPort
```

Spec §7 asks for a teacher, a coordinator and a school admin. Each one gets its own Chrome profile, `chrome-profile-<view>-8081`, next to the harness folder. Create `…\scratchpad\harness\login-8081.mjs` (the harness folder named in **Files** above):

```js
import { chromium } from "playwright-core";
import path from "node:path";
import { fileURLToPath } from "node:url";

const who = process.argv[2];
if (!["teacher", "coordinator", "admin"].includes(who)) {
  console.log("usage: node login-8081.mjs <teacher|coordinator|admin>");
  process.exit(2);
}
const here = path.dirname(fileURLToPath(import.meta.url));
const ctx = await chromium.launchPersistentContext(path.resolve(here, `../chrome-profile-${who}-8081`), {
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: false,
  viewport: null,
  args: ["--window-size=1100,860"],
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto("http://localhost:8081/login");
const ok = await page
  .waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30 * 60_000 })
  .then(() => true)
  .catch(() => false);
if (ok) await page.waitForTimeout(4000);
console.log(JSON.stringify({ who, loggedIn: ok, url: page.url() }));
await ctx.close();
```

Ask Tushar to sign in himself; no credentials pass through Claude. He runs `node login-8081.mjs teacher`, then `coordinator`, then `admin` from the harness folder, each time in a school that has the attendance feature on:
- `teacher`: an account whose dashboard is the teacher hub;
- `coordinator`: an account that lands on the coordinator dashboard;
- `admin`: a school admin.

If one of the three kinds of account is not available, write down which, and run steps 5 and 8 for the other two.

- [ ] **Step 5: Stubbed answers on every dashboard (layout, order, scope wiring)**

Create `…\scratchpad\harness\action-cards-check.mjs`. It stubs `my_dashboard_actions` and every `staff_attendance_records` request, so nothing is written to production. It also records the `p_view` each dashboard sends.

```js
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// usage: node action-cards-check.mjs <teacher|coordinator|admin> [full]
const VIEW = process.argv[2];
const FULL = process.argv[3] === "full";
if (!["teacher", "coordinator", "admin"].includes(VIEW)) {
  console.log("usage: node action-cards-check.mjs <teacher|coordinator|admin> [full]");
  process.exit(2);
}
const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, "../shots/action-cards", VIEW);
fs.mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:8081";
const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

const base = { v: 1, date: TODAY, view: null, check_in: null, cover: null, leave: null, check_out: null, pass_due: false, refresh_in_s: 3600 };
const SCENARIOS = {
  three: { ...base, check_in: { state: "due", by: "08:00", until: "16:00" },
    cover: { pending: 4, next: { label: "Period 3", class_name: "8", section: "B", start: "10:40" } },
    leave: { students: 2, staff: 1, oldest_days: 3 } },
  long: { ...base, check_in: { state: "due", by: "08:00", until: "16:00" },
    cover: { pending: 99, next: { label: "Period 10 (Double, Practical Lab)", class_name: "Class 12 Science Biology", section: "Section A", start: "13:40" } },
    leave: { students: 120, staff: 14, oldest_days: 45 } },
  checkout: { ...base, check_out: { record_id: "00000000-0000-0000-0000-000000000000", since: "16:00" } },
  absent: { ...base, check_in: { state: "absent", by: "08:00", until: "16:00" } },
  none: { ...base },
  error: null,
};
const EXPECT_TITLES = {
  three: ["Check in for today", "4 periods need a substitute", "3 leave requests waiting"],
  long: ["Check in for today", "99 periods need a substitute", "134 leave requests waiting"],
  checkout: ["Time to check out"],
  absent: ["Marked absent today"],
  none: [],
  error: ["Couldn't load your day"],
};
// The greeting's Check in / Check out button: hidden while a card owns them, back for the
// error card (so check-in stays possible) and when nothing is due.
const EXPECT_GREETING = { three: 0, long: 0, checkout: 0, absent: 0, none: 1, error: 1 };
const BOX = { 375: 112, 768: 144, 1024: 160, 1440: 176 };
const RUNS = FULL
  ? Object.keys(SCENARIOS).flatMap((name) => [
      ...[375, 768, 1024, 1440].map((width) => ({ name, theme: "light", width })),
      ...[375, 1440].map((width) => ({ name, theme: "dark", width })),
    ])
  : [{ name: "three", theme: "light", width: 375 }, { name: "three", theme: "dark", width: 1440 }, { name: "none", theme: "light", width: 1440 }];

const ctx = await chromium.launchPersistentContext(path.resolve(here, `../chrome-profile-${VIEW}-8081`), {
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  serviceWorkers: "block",
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"],
  viewport: { width: 1440, height: 900 },
});
const results = [];
for (const { name, theme, width } of RUNS) {
  const payload = SCENARIOS[name];
  const page = await ctx.newPage();
  const engineRequests = [];
  const writes = [];
  const views = [];
  page.on("request", (r) => { if (r.url().includes("bannerEngine")) engineRequests.push(r.url()); });
  await page.addInitScript((t) => {
    const want = t === "dark";
    const apply = () => { const el = document.documentElement; if (el && el.classList.contains("dark") !== want) el.classList.toggle("dark", want); };
    new MutationObserver(apply).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
    apply();
  }, theme);
  // The app persists the query cache; a restored answer under 60 s old would skip the stub
  // and this run would show the previous run's cards.
  await page.addInitScript(() => { try { localStorage.removeItem("salci-query-cache-v1"); } catch { /* storage blocked */ } });
  await page.route("**/rest/v1/rpc/my_dashboard_actions*", (route) => {
    views.push(route.request().postDataJSON()?.p_view ?? null);
    return payload === null
      ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "stub failure" }) })
      : route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
  });
  // Fail-safe: no request to the attendance table reaches production from this run.
  await page.route("**/rest/v1/staff_attendance_records**", (route) => {
    const req = route.request();
    if (req.method() === "GET") return route.fulfill({ status: 200, contentType: "application/json", body: "null" });
    writes.push(req.method());
    return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({
      id: "00000000-0000-0000-0000-000000000001", institution_id: "x", staff_id: "x", date: TODAY,
      check_in_at: new Date().toISOString(), check_out_at: null, status: "present", auto_marked_absent: false,
      remarks: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }) });
  });
  await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
  // ?banner3d=force (dev only): headless Chrome has only a software GPU, which the banner
  // treats as "no 3D" and never fetches its engine, so the engine checks could not fail.
  await page.goto(`${BASE}/dashboard?banner3d=force`);
  // the slot (cards, error card or banner) or the login form, whichever comes first; the
  // error card needs roles, features, one failed request and the app's one retry
  await page.waitForSelector('section[aria-label="Things to do today"], .scene-banner-anim, input[type="password"]', { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(500);
  if (new URL(page.url()).pathname.startsWith("/login")) { console.log(`ERROR: ${VIEW} profile signed out; run login-8081.mjs ${VIEW}`); process.exit(2); }
  if (name === "none") {
    // nothing due: the banner must mount and fetch its engine
    await page.waitForRequest((r) => r.url().includes("bannerEngine"), { timeout: 20_000 }).catch(() => {});
  } else {
    // longer than the banner's settle (8 s) and idle (3 s) caps: a wrongly mounted banner
    // would have fetched its engine by now
    await page.waitForTimeout(12_000);
  }
  const r = await page.evaluate(() => {
    const section = document.querySelector('section[aria-label="Things to do today"]');
    const cards = section ? [...section.querySelectorAll("article")] : [];
    const titles = cards.map((c) => c.querySelector("h3")?.textContent?.trim() ?? "");
    // every text and control stays inside its own card (it truncates, it never spills)
    const escaped = [];
    for (const card of cards) {
      const box = card.getBoundingClientRect();
      if (box.right < 0 || box.left > window.innerWidth) continue; // a swiped-away card
      for (const el of card.querySelectorAll("h3, p, a, button")) {
        const b = el.getBoundingClientRect();
        if (b.width === 0 && b.height === 0) continue;
        if (b.left < box.left - 0.5 || b.right > box.right + 0.5 || b.top < box.top - 0.5 || b.bottom > box.bottom + 0.5) {
          escaped.push(`${el.tagName}:${(el.textContent ?? "").trim().slice(0, 30)}`);
        }
      }
    }
    const dots = section ? [...section.querySelectorAll('button[aria-label^="Show card"]')].filter((b) => b.offsetParent !== null) : [];
    const dotsHit = dots.every((d) => {
      const b = d.getBoundingClientRect();
      const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return hit === d || d.contains(hit);
    });
    const banner = !!document.querySelector(".scene-banner-anim");
    const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    const boxH = section ? Math.round(section.getBoundingClientRect().height) : null;
    const greetingButtons = [...document.querySelectorAll("header button, header a")]
      .map((b) => (b.textContent ?? "").trim())
      .filter((t) => /^(Check in|Check out)$/.test(t)).length;
    return { titles, escaped, dots: dots.length, dotsHit, banner, overflow, boxH, greetingButtons };
  });
  const want = EXPECT_TITLES[name];
  const shot = `${name}-${theme}-${width}.png`;
  await page.screenshot({ path: path.join(OUT, shot) });
  const swipes = width < 1024 && want.length > 1;
  results.push({
    name, theme, width, shot, ...r, views,
    titlesOk: JSON.stringify(r.titles) === JSON.stringify(want),
    bannerOk: name === "none" ? r.banner : !r.banner,
    engineOk: name === "none" ? engineRequests.length > 0 : engineRequests.length === 0,
    boxOk: name === "none" ? true : r.boxH === BOX[width],
    fitsOk: r.escaped.length === 0,
    dotsOk: (swipes ? r.dots === want.length : r.dots === 0) && r.dotsHit,
    overflowOk: r.overflow === 0,
    greetingOk: r.greetingButtons === EXPECT_GREETING[name],
    viewsOk: views.length > 0 && views.every((v) => v === VIEW),
    writes: writes.length,
  });
  await page.close();
}
const keys = ["titlesOk", "bannerOk", "engineOk", "boxOk", "fitsOk", "dotsOk", "overflowOk", "greetingOk", "viewsOk"];
const bad = results.filter((x) => !keys.every((k) => x[k]) || x.writes !== 0);
console.log(JSON.stringify({ view: VIEW, runs: results.length, failures: bad }, null, 1));
await ctx.close();
```

Run from the harness folder:
1. `node action-cards-check.mjs admin full`;
2. `node action-cards-check.mjs teacher`;
3. `node action-cards-check.mjs coordinator`.

Expected: `"failures": []` each time (36 runs for the full matrix, 3 for each quick run). The quick runs prove that each dashboard renders the cards and sends ITS OWN view (`viewsOk`).

Then open the screenshots and check by eye:
- the cards look like the clay tiles and fill the banner's box;
- at 768 one card shows with dots; at 1024 and 1440 the cards sit side by side;
- dark mode flips;
- the "long" cards truncate their text and keep their buttons;
- the error card is rose with Retry.

- [ ] **Step 6: Interactions: swipe, double taps, a failed refresh (Review Focus 2 and 4)**

Create `…\scratchpad\harness\action-cards-interact.mjs`:

```js
import { chromium } from "playwright-core";
import path from "node:path";
import { fileURLToPath } from "node:url";

// usage: node action-cards-interact.mjs <teacher|coordinator|admin>
const VIEW = process.argv[2] ?? "admin";
const here = path.dirname(fileURLToPath(import.meta.url));
const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const ANSWER = { v: 1, date: TODAY, view: null, check_in: null, cover: null, leave: null, check_out: null, pass_due: false, refresh_in_s: 3600 };
const ROW = {
  id: "00000000-0000-0000-0000-000000000001", institution_id: "x", staff_id: "x", date: TODAY,
  check_in_at: new Date().toISOString(), check_out_at: null, status: "present", auto_marked_absent: false,
  remarks: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
};
const DECK = 'section[aria-label="Things to do today"]';

const ctx = await chromium.launchPersistentContext(path.resolve(here, `../chrome-profile-${VIEW}-8081`), {
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  serviceWorkers: "block",
  viewport: { width: 375, height: 812 },
});

/** A page whose RPC answers come from `answers` in order (the last repeats; null = HTTP 500),
 *  and whose attendance-table writes are counted and answered here, never by production. */
async function open(answers) {
  const page = await ctx.newPage();
  const writes = [];
  let calls = 0;
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => { try { localStorage.removeItem("salci-query-cache-v1"); } catch { /* storage blocked */ } });
  await page.route("**/rest/v1/rpc/my_dashboard_actions*", (route) => {
    const a = answers[Math.min(calls++, answers.length - 1)];
    return a === null
      ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "stub failure" }) })
      : route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(a) });
  });
  await page.route("**/rest/v1/staff_attendance_records**", async (route) => {
    const req = route.request();
    if (req.method() === "GET") return route.fulfill({ status: 200, contentType: "application/json", body: "null" });
    writes.push(req.method());
    await new Promise((r) => setTimeout(r, 400)); // a slow network invites a second tap
    return route.fulfill({ status: req.method() === "POST" ? 201 : 200, contentType: "application/json", body: JSON.stringify(ROW) });
  });
  await page.goto("http://localhost:8081/dashboard");
  return { page, writes };
}

const out = {};

// 1. Swipe: tapping the third dot scrolls to the third card and marks that dot current.
{
  const { page } = await open([{ ...ANSWER, check_in: { state: "due", by: "08:00", until: "16:00" },
    cover: { pending: 2, next: { label: "Period 3", class_name: "8", section: "B", start: "10:40" } },
    leave: { students: 1, staff: 0, oldest_days: 0 } }]);
  const dot = page.locator(`${DECK} button[aria-label^="Show card 3 of 3"]`);
  await dot.waitFor({ state: "visible", timeout: 20_000 });
  await dot.click();
  await page.waitForTimeout(500);
  out.swipe = await page.evaluate((sel) => {
    const row = document.querySelector(`${sel} > div`);
    const third = document.querySelector(`${sel} button[aria-label^="Show card 3 of 3"]`);
    return {
      current: third?.getAttribute("aria-current") === "true",
      scrolled: !!row && Math.abs(row.scrollLeft - 2 * row.clientWidth) <= 2,
    };
  }, DECK);
  await page.close();
}

// 2. Double tap on Check in: two clicks in ONE task, before React can re-render or disable
//    the button, so only the single-flight ref can stop the second write.
{
  const { page, writes } = await open([{ ...ANSWER, check_in: { state: "due", by: "08:00", until: "16:00" } }]);
  const btn = page.locator(`${DECK} article button`, { hasText: "Check in" });
  await btn.waitFor({ state: "visible", timeout: 20_000 });
  await btn.evaluate((b) => { b.click(); b.click(); });
  await page.waitForTimeout(1500);
  out.checkInWrites = writes.filter((m) => m === "POST").length;
  await page.close();
}

// 3. The same for Check out, a PATCH of today's row.
{
  const { page, writes } = await open([{ ...ANSWER, check_out: { record_id: ROW.id, since: "16:00" } }]);
  const btn = page.locator(`${DECK} article button`, { hasText: "Check out" });
  await btn.waitFor({ state: "visible", timeout: 20_000 });
  await btn.evaluate((b) => { b.click(); b.click(); });
  await page.waitForTimeout(1500);
  out.checkOutWrites = writes.filter((m) => m === "PATCH").length;
  await page.close();
}

// 4. A refresh that fails AFTER a good answer shows the error card, never the old cards or
//    the banner (TanStack keeps the old data beside the error).
{
  const { page } = await open([{ ...ANSWER, check_in: { state: "due", by: "08:00", until: "16:00" },
    leave: { students: 1, staff: 0, oldest_days: 0 } }, null]);
  const btn = page.locator(`${DECK} article button`, { hasText: "Check in" });
  await btn.waitFor({ state: "visible", timeout: 20_000 });
  await btn.click(); // the check-in's invalidation makes the app ask again; that answer fails
  await page.waitForTimeout(5000); // the refetch fails, and so does the app's one retry
  out.staleError = await page.evaluate(() => ({
    errorCard: document.body.innerText.includes("Couldn't load your day"),
    oldLeaveCard: document.body.innerText.includes("1 leave request waiting"),
    banner: !!document.querySelector(".scene-banner-anim"),
  }));
  await page.close();
}

const ok = out.swipe.current && out.swipe.scrolled && out.checkInWrites === 1 && out.checkOutWrites === 1
  && out.staleError.errorCard && !out.staleError.oldLeaveCard && !out.staleError.banner;
console.log(JSON.stringify({ view: VIEW, ...out, ok }));
await ctx.close();
```

Run `node action-cards-interact.mjs admin` from the harness folder.
Expected: `"ok": true`. Every write was answered by the stub, so nothing reached production.

- [ ] **Step 7: Next-morning keys (Review Focus 1)**

Create `…\scratchpad\harness\action-cards-key.mjs`. It opens the dashboard once WITHOUT stubs and reads the persisted cache. Both dated keys must carry today:
- the cards' `["staff-attendance","my-actions",…]`, on the school's date;
- the greeting button's `["staff-attendance","today",…]`, on the browser's date. In India the two are the same.

```js
import { chromium } from "playwright-core";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VIEW = process.argv[2] ?? "teacher";
const here = path.dirname(fileURLToPath(import.meta.url));
const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const ctx = await chromium.launchPersistentContext(path.resolve(here, `../chrome-profile-${VIEW}-8081`), {
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, serviceWorkers: "block",
});
const page = await ctx.newPage();
await page.goto("http://localhost:8081/dashboard");
await page.waitForTimeout(6000); // the persister writes about a second after each fetch
const keys = await page.evaluate(() => {
  const found = { actions: [], today: [] };
  const walk = (v) => {
    if (Array.isArray(v)) {
      if (v[0] === "staff-attendance" && v[1] === "my-actions") found.actions.push(v);
      if (v[0] === "staff-attendance" && v[1] === "today") found.today.push(v);
      v.forEach(walk);
    } else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  try { walk(JSON.parse(localStorage.getItem("salci-query-cache-v1") ?? "null")); } catch { /* not persisted yet */ }
  return found;
});
const dated = (list) => list.length > 0 && list.every((k) => k[k.length - 1] === TODAY);
console.log(JSON.stringify({ TODAY, keys, ok: dated(keys.actions) && dated(keys.today) }));
await ctx.close();
```

Run `node action-cards-key.mjs teacher` from the harness folder.
Expected: `"ok": true`. If either list is empty, the profile is not a staff account in a school with attendance on; use one that is and run it again.

- [ ] **Step 8: Deep links and real data, per profile (Review Focus 3)**

For each signed-in profile, with no stubs:
1. **Deep links.** Open `/staff/workday?tab=substitutions`, `/staff/workday?tab=staff-leaves` and `/school/attendance?tab=leaves`, and screenshot each at 375 px.
   - For `admin` and `coordinator`, the named tab is selected.
   - For `teacher`, Workday falls back to My Attendance, and Attendance opens Student Leaves.
2. **Real answer.** Open `/dashboard` and capture both sides of the call: the request body's `p_view` (`page.waitForRequest(r => r.url().includes("my_dashboard_actions"))`, then `.postDataJSON()`) and the response (`page.waitForResponse(...)`, its status and JSON).
   - Expected: status 200; `p_view` equals the profile's view; the answer's `view` equals it too.
   - Screenshot the top of the dashboard at 375 and 1440, light and dark.

On an admin or coordinator account past the cutoff, this run may trigger today's attendance pass for the school (`pass_due`), 20 to 60 seconds after the page opens. That is the same write the 15-minute cron makes, and the feature's intended behaviour.

- [ ] **Step 9: Record the module invariants for future agents**

Append to `.claude/skills/timetable-module/SKILL.md`:

```markdown
## Dashboard action cards (2026-10-03)
The staff dashboards' top slot (`DashboardTopSlot`) shows check-in, substitution, leave and check-out cards from ONE read-only RPC, `my_dashboard_actions(p_view)`, with the logic in the owner-only twin `_my_dashboard_actions(uid, view, now)` (acceptance suite: `scripts/test-dashboard-actions.sql`). Spec: `docs/superpowers/specs/2026-10-03-dashboard-action-cards-design.md`.
* The cover count needs a real staff check-in that day (schools that never check in raise a cover for every period) and skips periods already over; admin and coordinator views only.
* Admins never get STUDENT leave on the card (owner's rule); leave counts use `can_review_staff_leave` and `student_in_class`, so a stranded request never pins the card.
* The query key is `["staff-attendance", "my-actions", uid, view, schoolDate]`: any write that invalidates `["staff-attendance"]` refreshes the cards. A new write path that changes check-in, covers or leave must invalidate that prefix (or `DASHBOARD_ACTIONS_KEY`).
* `pass_due` lets an admin or coordinator dashboard kick `tt_run_attendance_pass_for_institution` once a day (`useAttendancePassKick`, the same sessionStorage flag as Workday).
```

Commit everything from steps 2 and 9:

```powershell
git add -- scripts/check-banner-chunk.mjs .claude/skills/timetable-module/SKILL.md
git commit -m @'
chore(dashboard): chunk cap for the action cards and module notes

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
'@
```

(If step 2 changed nothing, stage only the SKILL.md.)

- [ ] **Step 10: Merge into main (no push), re-gate, remove the worktree safely**

Stop the 8081 dev server first. Fetch from Git Bash (PowerShell here has GCM_INTERACTIVE=never and GIT_TERMINAL_PROMPT=0, so its fetch fails with "could not read Username" and `origin/main` stays stale):

```bash
cd "/d/Salci Projects/Salci-Main-Portal/salci-eco-core-main" && timeout 60 git fetch origin main && git log --oneline -1 origin/main && git rev-list --left-right --count HEAD...origin/main
```

If `origin/main` is ahead of local `main` (another session pushed), stop and ask Tushar how to bring local `main` up to date first. Never reset his checkout without asking. Then, in PowerShell from the main checkout:

```powershell
Set-Location -LiteralPath 'D:\Salci Projects\Salci-Main-Portal\salci-eco-core-main'
git merge --no-ff feat/dashboard-action-cards -m @'
Merge feat/dashboard-action-cards: dashboard action cards

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
'@
git diff --stat HEAD~1 HEAD -- src/integrations/supabase/types.ts
```

If main moved and the merge touched `types.ts` on both sides, check that the merged file still contains `my_dashboard_actions` and everything main added; regenerate only when the auto-merge visibly dropped lines (§5a, compare `git diff HEAD~1 HEAD --stat`). Re-run the full gate of step 3 on main's tree. Use Git Bash in the main checkout, with the same commands but `CHANGED=$(git diff --name-only HEAD~1 HEAD -- 'src/**/*.ts' 'src/**/*.tsx' | grep -v 'integrations/supabase/types.ts' | tr '\n' ' ')`. Expected: the same results as step 3.

Remove the worktree from PowerShell. Its `node_modules` is its own real folder (Task 0), so deleting it touches nothing of main's. The guard below still refuses if it ever finds a link.

```powershell
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath 'D:\Salci Projects\Salci-Main-Portal\salci-eco-core-main'
$wt = 'D:\Salci Projects\Salci-Main-Portal\_wt-action-cards'
if ((Get-Item -LiteralPath "$wt\node_modules").LinkType) { throw 'node_modules is a LINK: remove it with [System.IO.Directory]::Delete first, never git worktree remove' }
Remove-Item -LiteralPath "$wt\.env"
git -C $wt status --porcelain   # expected: empty (everything is committed and merged)
git worktree remove --force $wt
if (-not (Test-Path -LiteralPath 'D:\Salci Projects\Salci-Main-Portal\salci-eco-core-main\node_modules\.bin')) { throw 'main node_modules damaged' }
git branch -d feat/dashboard-action-cards
```

Do NOT push. Tell Tushar the cards are on his localhost:8080 (main), list the commits, and ask whether to push.

- [ ] **Step 11: Update the auto-memory**

Write `C:\Users\tusha\.claude\projects\d--Salci-Projects-Salci-Main-Portal-salci-eco-core-main\memory\project_dashboard_action_cards.md` (type `project`). It records:
- the RPC names and the twin;
- the owner's four answers;
- the key prefix rule;
- that the merge is unpushed;
- the scratch harness paths.

Add one line to `MEMORY.md` in the index's style, naming the merge commit's short hash and that day's date, for example: `- [Dashboard action cards](project_dashboard_action_cards.md) — merged 1a2b3c4d 2026-10-04, NOT pushed; RPC my_dashboard_actions live`. Then delete the three scratch `chrome-profile-*-8081` folders.
