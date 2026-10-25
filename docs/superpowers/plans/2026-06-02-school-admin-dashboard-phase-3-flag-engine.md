# School-Admin Dashboard — Phase 3: Flag Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Phase 1 + 2 are done. DB migrations apply to prod (gyymkgohcijeksmrzuyw) on confirmation; additive only.

**Goal:** Populate and manage `dashboard_flags` — detect the 20 flag conditions, run the Red→Amber→Blue→Gone lifecycle, auto-create tasks for Critical flags, and wire the flags feed + auto-create banner + per-flag task actions into the dashboard UI. After this, "Decisions waiting" and every table's "active flags" count reflect reality.

**Architecture:** A single idempotent `dash_evaluate_flags(p_institution_id)` recomputes all conditions and merges them into `dashboard_flags` keyed on `(institution_id, flag_code, subject_key)`. It runs on an on-open kick RPC (sessionStorage-guarded, §24 pattern) — no pg_cron assumed. Critical flags auto-create a task (server-side, in the evaluator). Flag→task actions are SECURITY DEFINER RPCs that mirror `useCreateTask`. Detection thresholds = the constants baked into the SQL (mirrors spec §8.6); the riskiest layer, so the evaluator is validated against real prod data before UI wiring.

**Tech Stack:** Supabase plpgsql, React + TanStack Query, existing primitives.

> ⚠️ **Trust gate (spec §16):** a flag that fires wrongly destroys trust faster than one that doesn't fire. After applying the evaluator, run it for Alliance (rich exam data) + Salci and eyeball the produced flags before any UI wiring. Attendance/adoption flags are largely dormant in current prod (Alliance has 0 attendance; institutions are past onboarding grace) — that's correct, not a miss.

---

## Reference: the 20-flag catalog
Detection rules, severities, cold-start, and assignees are in the committed spec `docs/superpowers/specs/2026-06-02-school-admin-dashboard-rebuild-design.md` §8.6. Implement those thresholds exactly. Codes: A1-A7 (attendance), E1-E7 (exams), AD1-AD6 (adoption, kill-switch gated).

## Schema recap (from Phase 1)
`dashboard_flags(id, institution_id, flag_code, category, severity, status['red'|'amber'|'blue'], subject_type, subject_key, title, description, metric_value, context jsonb, link_url, assignee_id, task_id, auto_created, first_detected_at, last_evaluated_at, resolved_at, created_at, updated_at)`. Partial unique index on `(institution_id, flag_code, subject_key) WHERE resolved_at IS NULL`. `tasks(institution_id, title, description, task_type, priority int, due_date, status, wing_id)` + `task_assignments(task_id, assignee_id, assigner_id, supervisor_id)` + `notifications(user_id, title, message, type, link, metadata)`. `institutions.dashboard_adoption_flags_enabled`.

---

## Task 1: `resolve_flag_assignee` helper

**File:** `supabase/migrations/20260602110000_flag_assignee.sql`

Deterministic assignee per spec §8.4 (first hit wins, ends at principal). Signature `resolve_flag_assignee(p_institution_id uuid, p_subject_type text, p_subject_key text) RETURNS uuid`, SECURITY DEFINER.

- [ ] **Step 1: SQL**

```sql
CREATE OR REPLACE FUNCTION public.resolve_flag_assignee(
  p_institution_id uuid, p_subject_type text, p_subject_key text)
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; v_class uuid;
BEGIN
  -- normalise the class in context
  IF p_subject_type = 'class' THEN
    v_class := p_subject_key::uuid;
  ELSIF p_subject_type = 'student' THEN
    SELECT ca.class_id INTO v_class FROM class_assignments ca
      WHERE ca.user_id = p_subject_key::uuid AND ca.role='student' LIMIT 1;
  ELSIF p_subject_type = 'exam' THEN
    SELECT ec.class_id INTO v_class FROM exam_classes ec WHERE ec.exam_id = p_subject_key::uuid LIMIT 1;
  END IF;

  -- class/student/exam -> class teacher (subject_id IS NULL) -> wing coordinator
  IF v_class IS NOT NULL THEN
    SELECT ca.user_id INTO v_uid FROM class_assignments ca
      WHERE ca.class_id = v_class AND ca.role='teacher' AND ca.subject_id IS NULL LIMIT 1;
    IF v_uid IS NOT NULL THEN RETURN v_uid; END IF;
    SELECT wa.user_id INTO v_uid FROM wing_class_mappings m
      JOIN wing_assignments wa ON wa.wing_id = m.wing_id
      WHERE m.class_id = v_class LIMIT 1;
    IF v_uid IS NOT NULL THEN RETURN v_uid; END IF;
  END IF;

  -- subject -> any teacher of that subject (then fall through to principal)
  IF p_subject_type = 'subject' THEN
    SELECT ca.user_id INTO v_uid FROM class_assignments ca
      JOIN classes c ON c.id = ca.class_id AND c.institution_id = p_institution_id
      WHERE ca.role='teacher' AND ca.subject_id = p_subject_key::uuid LIMIT 1;
    IF v_uid IS NOT NULL THEN RETURN v_uid; END IF;
  END IF;

  -- fallback: a school_admin of the institution (the principal)
  SELECT ur.user_id INTO v_uid FROM user_roles ur
    WHERE ur.institution_id = p_institution_id AND ur.role = 'school_admin' LIMIT 1;
  RETURN v_uid;  -- may be null if none; callers tolerate null assignee
END $$;
GRANT EXECUTE ON FUNCTION public.resolve_flag_assignee(uuid,text,text) TO authenticated;
```

- [ ] **Step 2:** apply + verify `SELECT public.resolve_flag_assignee('<inst>','school','school');` returns a school_admin uuid. Commit.

---

## Task 2: `dash_evaluate_flags` — detection + merge + auto-task

**File:** `supabase/migrations/20260602110100_flag_evaluator.sql`

The evaluator builds a `detected` set (one row per currently-true condition), then merges:
1. **Upsert** detected rows: insert new as `red`; on the partial-unique conflict, refresh `last_evaluated_at`, `metric_value`, `title`, `description`.
2. **Resolve** vanished conditions: for the flag_codes the run evaluated, set `resolved_at = now()` on open rows whose `(flag_code, subject_key)` is no longer detected.
3. **Auto-task** Critical reds lacking a task: create task + assignment + notification via `resolve_flag_assignee`, set `status='amber'`, `task_id`, `auto_created=true`, `assignee_id`.
4. **Blue** transition: open flags with a `task_id` whose task is `completed`/`rejected` but still detected → `status='blue'`.

- [ ] **Step 1: SQL** — single SECURITY DEFINER function. Build `detected` as a TEMP-less CTE materialised into a temp table inside the function (so it can be referenced by upsert + resolve + auto-task). Skeleton:

```sql
CREATE OR REPLACE FUNCTION public.dash_evaluate_flags(p_institution_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inst uuid; v_tz text; v_today date; v_ay_start date; v_ay_end date;
  v_adopt boolean; v_age_days int; v_codes text[]; v_rec record;
  v_new int := 0; v_resolved int := 0; v_tasks int := 0;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  SELECT timezone, (CURRENT_DATE - created_at::date), dashboard_adoption_flags_enabled
    INTO v_tz, v_age_days, v_adopt FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz,'Asia/Kolkata'))::date;
  SELECT start_date,end_date INTO v_ay_start,v_ay_end FROM public.dash_current_academic_year(v_inst);
  v_ay_start := COALESCE(v_ay_start, v_today - INTERVAL '12 months')::date;
  v_ay_end   := COALESCE(v_ay_end, v_today)::date;

  CREATE TEMP TABLE _detected (
    flag_code text, category text, severity text, subject_type text, subject_key text,
    title text, description text, metric_value numeric, link_url text
  ) ON COMMIT DROP;

  -- ===== one INSERT INTO _detected ... per flag code, each guarded by its cold-start =====
  -- (implement all 20 per spec §8.6; examples below show the shape for each family)

  -- E1: >=5 drafts older than 7 days  (school-scoped)
  INSERT INTO _detected SELECT 'E1','exams','warning','school','school',
    'Exams are still in draft', n||' exams have been in draft for over a week.',
    n, '/school/exams'
  FROM (SELECT count(*) n FROM exams WHERE institution_id=v_inst AND status='draft'
        AND created_at < now()-INTERVAL '7 days') s WHERE s.n >= 5;

  -- E4: class avg on a <=30d published exam < 40% OR pass-rate < 50%  (class-scoped, Critical)
  INSERT INTO _detected
  SELECT 'E4','exams','critical','class', a.class_id::text,
    'A class scored very low in a recent exam',
    c.name||coalesce(' '||c.section,'')||' averaged '||round(avg(fr.percentage))||'% in '||e.title||'.',
    round(avg(fr.percentage),1), '/school/class/'||a.class_id
  FROM final_results fr
  JOIN student_exam_attempts a ON a.id=fr.attempt_id
  JOIN exams e ON e.id=a.exam_id AND e.institution_id=v_inst AND e.status IN ('published','active','completed')
       AND COALESCE(e.published_at::date,e.scheduled_date::date,e.created_at::date) > v_today-30
  JOIN classes c ON c.id=a.class_id
  GROUP BY a.class_id, e.id, e.title, c.name, c.section
  HAVING avg(fr.percentage) < 40;   -- (pass-rate variant optional; keep avg<40 for v1)

  -- A1: class 5-school-day attendance < 70% AND >=12pp below 30-day school baseline (Critical)
  --   cold-start: class has >=14 days of attendance AND >=10 students. (Dormant where no attendance.)
  -- A4: student missed >=6 of last 20 working days (Warning), cold-start >=10 days, CAP top 25.
  -- AD1: classes with 0 teacher assignments (Critical) — gated: only if v_adopt AND v_age_days>14.
  -- AD3: staff last_sign_in_at > 7 days (Warning) — gated.
  -- ... implement the remaining codes (A2,A3,A5,A6,A7,E2,E3,E5,E6,E7,AD2,AD4,AD5,AD6) per §8.6.
  -- Adoption codes: wrap each INSERT in `IF v_adopt AND v_age_days > <grace> THEN ... END IF;`

  v_codes := ARRAY(SELECT DISTINCT flag_code FROM _detected)
             || ARRAY['A1','A2','A3','A4','A5','A6','A7','E1','E2','E3','E4','E5','E6','E7']; -- codes evaluated even if none detected, so they resolve
  IF v_adopt THEN v_codes := v_codes || ARRAY['AD1','AD2','AD3','AD4','AD5','AD6']; END IF;

  -- (1) UPSERT
  INSERT INTO dashboard_flags (institution_id,flag_code,category,severity,subject_type,subject_key,
                               title,description,metric_value,link_url,status,first_detected_at,last_evaluated_at)
  SELECT v_inst,flag_code,category,severity,subject_type,subject_key,title,description,metric_value,link_url,
         'red', now(), now() FROM _detected
  ON CONFLICT (institution_id,flag_code,subject_key) WHERE resolved_at IS NULL
  DO UPDATE SET last_evaluated_at=now(), metric_value=EXCLUDED.metric_value,
                title=EXCLUDED.title, description=EXCLUDED.description;
  GET DIAGNOSTICS v_new = ROW_COUNT;

  -- (2) RESOLVE vanished
  UPDATE dashboard_flags df SET resolved_at=now()
  WHERE df.institution_id=v_inst AND df.resolved_at IS NULL
    AND df.flag_code = ANY(v_codes)
    AND NOT EXISTS (SELECT 1 FROM _detected d WHERE d.flag_code=df.flag_code AND d.subject_key=df.subject_key);
  GET DIAGNOSTICS v_resolved = ROW_COUNT;

  -- (3) AUTO-TASK critical reds lacking a task
  FOR v_rec IN SELECT * FROM dashboard_flags
    WHERE institution_id=v_inst AND resolved_at IS NULL AND severity='critical'
      AND status='red' AND task_id IS NULL
  LOOP
    DECLARE v_assignee uuid; v_task uuid; v_ttype task_type;
    BEGIN
      v_assignee := public.resolve_flag_assignee(v_inst, v_rec.subject_type, v_rec.subject_key);
      v_ttype := CASE WHEN v_rec.category='exams' THEN 'exam_related'::task_type
                      WHEN v_rec.category='attendance' THEN 'student_support'::task_type
                      ELSE 'administrative'::task_type END;
      INSERT INTO tasks (institution_id,title,description,task_type,priority,status,due_date)
        VALUES (v_inst, v_rec.title, v_rec.description, v_ttype, 3, 'open', (v_today+2)::timestamptz)
        RETURNING id INTO v_task;
      IF v_assignee IS NOT NULL THEN
        INSERT INTO task_assignments (task_id,assignee_id,assigner_id) VALUES (v_task, v_assignee, v_assignee);
        INSERT INTO notifications (user_id,title,message,type,link,metadata)
          VALUES (v_assignee,'New task from dashboard', v_rec.title, 'task_assigned','/tasks',
                  jsonb_build_object('task_id',v_task,'flag_id',v_rec.id));
      END IF;
      UPDATE dashboard_flags SET status='amber', task_id=v_task, assignee_id=v_assignee, auto_created=true
        WHERE id=v_rec.id;
      v_tasks := v_tasks + 1;
    END;
  END LOOP;

  -- (4) BLUE: task closed but condition persists
  UPDATE dashboard_flags df SET status='blue'
  WHERE df.institution_id=v_inst AND df.resolved_at IS NULL AND df.task_id IS NOT NULL
    AND df.status='amber'
    AND EXISTS (SELECT 1 FROM tasks t WHERE t.id=df.task_id AND t.status IN ('completed','rejected'));

  RETURN jsonb_build_object('detected', (SELECT count(*) FROM _detected),
                            'resolved', v_resolved, 'auto_tasks', v_tasks);
END $$;
GRANT EXECUTE ON FUNCTION public.dash_evaluate_flags(uuid) TO authenticated;
```

- [ ] **Step 2:** Implement ALL 20 detection INSERTs per §8.6 (the skeleton shows E1/E4 + the families; fill A1-A7, E2/E3/E5/E6/E7, AD1-AD6 with their thresholds + cold-start). Adoption INSERTs guarded by `IF v_adopt AND v_age_days > grace`.
- [ ] **Step 3:** Apply to prod. Validate: `SELECT public.dash_evaluate_flags('<alliance-inst>');` → returns counts; then `SELECT flag_code,severity,status,title,count(*) FROM dashboard_flags WHERE institution_id='<alliance>' AND resolved_at IS NULL GROUP BY 1,2,3,4`. Eyeball: do the fired flags make sense? Re-run the evaluator → counts stable (idempotent, no duplicates). Resolve test: confirm a no-longer-true condition flips `resolved_at`.
- [ ] **Step 4:** Register migration + commit.

---

## Task 3: Flag→task action RPCs

**File:** `supabase/migrations/20260602110200_flag_task_rpcs.sql`

- [ ] **Step 1: SQL** — three SECURITY DEFINER RPCs, admin-gated via `dash_resolve_institution`:
  - `dash_create_task_from_flag(p_flag_id uuid, p_assignee_id uuid DEFAULT NULL)` — for a non-critical flag the principal chooses to action: create task (mirror the evaluator's task insert), default assignee from `resolve_flag_assignee` if `p_assignee_id` null, link + set `status='amber'`, `task_id`, `assignee_id`, `auto_created=false`. Guard: flag belongs to caller's institution; no-op if already has a task.
  - `dash_reassign_flag_task(p_flag_id uuid, p_assignee_id uuid)` — update the linked `task_assignments.assignee_id` + `dashboard_flags.assignee_id`; notify the new assignee.
  - `dash_cancel_flag_task(p_flag_id uuid)` — set the linked task `status='rejected'` (or delete if just created), then revert the flag: `status='red'`, `task_id=NULL`, `auto_created=false`.
- [ ] **Step 2:** apply + verify each runs (create a task from a non-critical flag on Alliance, reassign, cancel → flag back to red). Register + commit.

---

## Task 4: On-open kick + flag hooks (UI data layer)

**Files:** `src/hooks/dashboard/useDashboardData.ts` (extend), `src/hooks/dashboard/useFlagActions.ts` (new)

- [ ] **Step 1:** `useEvaluateFlagsOnOpen()` — on mount, once per institution per hour, call `supabase.rpc("dash_evaluate_flags", {})` guarded by `sessionStorage` key `salci:dash-flags:{institutionId}:{YYYY-MM-DD-HH}` (mirror §24's attendance page-view kick). On success, invalidate the `["dash","flags"]` + `["dash","kpi"]` query keys so the feed + "Decisions waiting" refresh. Never block render; swallow errors quietly (the cron/next-open retries).
- [ ] **Step 2:** `useFlagActions()` — `useMutation`s for `dash_create_task_from_flag`, `dash_reassign_flag_task`, `dash_cancel_flag_task`; each invalidates `["dash","flags"]` + `["dash","kpi"]` and `toastError` on failure, `toast.success` on success.
- [ ] **Step 3:** tsc/eslint; commit.

## Task 5: FlagsFeed (real) + AutoCreatedBanner + lifecycle

**Files:** rewrite `src/components/command-center/FlagsFeed.tsx`; new `AutoCreatedBanner.tsx`, `FlagCard.tsx`; wire into `CommandCenterPage`.

- [ ] **Step 1: FlagCard** — one flag row: severity dot (critical=red, warning=amber, info=blue) + status chip (Red/Amber/Blue meaning per spec §8.2 — "New", "Task created", "Task closed, still open"), plain title + 2-line description, a "View" link to `link_url`, and actions: if no task → "Create a task" (calls create); if task (amber/blue) → "Give to someone else" (reassign) + "Cancel task" (cancel). Use existing primitives + tokens.
- [ ] **Step 2: FlagsFeed** — consumes `useDashboardFlags()` + calls `useEvaluateFlagsOnOpen()`. Group by category (Attendance / Exams / Adoption), within each sort severity then newest (RPC already sorts). Section `id="dash-flags"`. Empty → the Phase-2 EmptyState.
- [ ] **Step 3: AutoCreatedBanner** — thin amber banner shown when ≥1 flag has `auto_created=true AND status='amber'` detected this session: "N tasks were created automatically — Review." Expands a panel listing each auto-task with flag context + "Give to someone else" / "Cancel this task". Mount in the header's `bannerSlot`.
- [ ] **Step 4:** Wire into `CommandCenterPage` (FlagsFeed already placed; pass the banner into `DashboardHeader bannerSlot`). The reassign UI needs an assignee picker — reuse the existing coordinator/teacher picker pattern from `useTasks`/the task-create dialog (grep `useCoordinatorsInInstitution`); keep it a simple `MobileSheet` or `Select`.
- [ ] **Step 5:** tsc/eslint/build all 0. Commit.

---

## Self-review (author)
**Spec coverage:** assignee resolution §8.4 ✓(T1); 20-flag detection + Red/Amber/Blue/Gone lifecycle + Critical auto-task + idempotent merge §8.2/8.3/8.6 ✓(T2); flag→task create/reassign/cancel §8.3 ✓(T3); on-open kick §5.2/§24 ✓(T4); feed grouping + banner + lifecycle UI + kill-switch (adoption gated in evaluator) ✓(T2,T5). 
**Risk/known:** attendance + adoption flags are dormant in current prod (no attendance; institutions past grace with teachers assigned) — validate what CAN fire (exam flags on Alliance) and confirm idempotency + resolve. The pass-rate variant of E4 and the per-student A4 cap are simplifications noted inline. The Blue→back-to-Amber (task reopened) edge is not handled in v1 (rare; next evaluator pass re-derives).
**Placeholder note:** Task 2 Step 2 requires filling the remaining detection INSERTs from spec §8.6 — the skeleton fixes the exact merge/auto-task algorithm so each INSERT only needs its WHERE + cold-start.
