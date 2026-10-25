# SALCI Olympiad Phase 4b — Exam Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the actual exam-taking interface. Students who passed PIN entry (Phase 4a) now sit a 90-minute, 3-subject, 90-question exam with server-side timer, three-strike proctoring, auto-submit triggers, session resume, and atomic submit + score computation.

**Architecture:** All hot-path operations are SECURITY DEFINER RPCs for sub-50ms latency under 6K concurrent load. `oly_start_attempt` snapshots 30 random questions per subject in one transaction. `oly_save_answer` is idempotent UPSERT on the question-snapshot id. `oly_submit_attempt` computes scores in one aggregate query and updates status atomically. Client-side timer polls `oly_get_attempt_state` every 30s to correct drift. Three-strike proctoring uses `visibilitychange` + `fullscreenchange` events; the violation count is server-side authoritative. Session resume reads attempt + answers in a single `oly_get_attempt_questions` round-trip.

**Tech Stack:** React 18 + TypeScript, Vite, TanStack Query v5, React Router v6, Supabase (PostgreSQL + RLS + RPCs), shadcn/ui + Tailwind, KaTeX via existing `MathText`, `src/lib/fullscreen.ts` (iOS Safari safe).

**Spec:** [docs/superpowers/specs/2026-05-27-olympiad-phase-4b-exam-delivery-design.md](../specs/2026-05-27-olympiad-phase-4b-exam-delivery-design.md)
**Master:** [docs/superpowers/specs/2026-05-26-olympiad-master-decomposition-design.md](../specs/2026-05-26-olympiad-master-decomposition-design.md)
**Phase 4a (precedent):** [docs/superpowers/plans/2026-05-27-olympiad-phase-4a-student-auth-and-portal.md](./2026-05-27-olympiad-phase-4a-student-auth-and-portal.md)

**No test infrastructure** — verification via §5a (tsc + eslint + vite build) + manual smoke.

**Concurrency target:** 6K students sitting the exam simultaneously. The hot paths (save answer, record event, poll timer) are all RPCs. No edge functions in the exam loop.

**Engineer assumptions:** Read CLAUDE.md §5a, §8 (KaTeX), §17 (SW dirty-form), §19, §20a (iOS fullscreen helper), §22, **§23 (every rule applies — exam day is the highest-stakes surface)** before starting. Read Phase 4a plan for hook patterns.

---

## §23 compliance summary for Phase 4b

| Rule | Implementation |
|---|---|
| §23.1 — every FK indexed | Task 1: all 14 FKs on the 4 new tables get indexes |
| §23.1 — SECURITY DEFINER helpers | RPCs use `oly_student_can_read`; no inline cross-table EXISTS in RLS |
| §23.1 — no `auth.getUser()` without JWT | All client uses `useAuth().user`; RPCs use `auth.uid()` |
| §23.1 — no `select("*")` | All queries list explicit columns |
| §23.1 — server-side aggregation | Submit RPC scores via a single GROUP BY aggregate |
| §23.2 — explicit `staleTime` | All useQuery hooks set staleTime; question hook uses Infinity (frozen) |
| §23.2 — `refetchInterval` < 30s justified | `useOlympiadAttemptState` polls 30s with comment justifying timer drift |
| §23.5 — long-running edge fns | None — all hot paths are RPCs |
| §23.3 — lazy-loaded routes | Exam page + submit page both lazy-imported |
| §23.4 — real-time subs | None in Phase 4b |

**Pre-merge checklist (verify at end of T7):**
- [ ] `oly_save_answer` p95 < 100ms tested via k6 (deferred to load test phase — note in plan)
- [ ] All FKs indexed (verified in T1)
- [ ] No `select("*")` (verified in T2)
- [ ] All hooks have explicit `staleTime` (verified in T2)
- [ ] No `auth.getUser()` (verified in T2)
- [ ] Exam page lazy-loaded (verified in T6)
- [ ] Submit RPC idempotent on double-call (verified by status check in body)
- [ ] PIN validate now rejects `already_attempted` (verified in T1 update)

---

## File Structure

```
supabase/migrations/<ts>_oly_phase_4b_attempts.sql                    (NEW)

src/
  hooks/olympiad/
    useOlympiadStartAttempt.ts                                        (NEW)
    useOlympiadAttemptState.ts                                        (NEW) — polls every 30s
    useOlympiadAttemptQuestions.ts                                    (NEW) — staleTime Infinity
    useOlympiadSaveAnswer.ts                                          (NEW) — debounced, idempotent
    useOlympiadSubmitAttempt.ts                                       (NEW)
    useOlympiadRecordEvent.ts                                         (NEW) — fire-and-forget
  components/olympiad/exam/
    ExamSubjectTabs.tsx                                               (NEW)
    QuestionNavGrid.tsx                                               (NEW)
    QuestionDisplay.tsx                                               (NEW) — KaTeX via MathText
    ExamTimer.tsx                                                     (NEW) — local tick + server sync
    SubmitConfirmDialog.tsx                                           (NEW)
    ProctoringWarningDialog.tsx                                       (NEW)
    DisconnectBanner.tsx                                              (NEW)
  pages/student/olympiad/
    OlympiadExamAttemptPage.tsx                                       (NEW) — replaces exam-pending placeholder
    OlympiadExamSubmittedPage.tsx                                     (NEW)
    OlympiadStudentDashboardPage.tsx                                  (EDIT) — post-submit state
  App.tsx                                                             (EDIT) — register 2 new routes (replace exam-pending with exam)
```

---

## Section A — Foundation

### Task 1: Phase 4b schema migration

**Files:**
- Create: `supabase/migrations/<ts>_oly_phase_4b_attempts.sql`

The full SQL is in spec sections 2.1-2.7 (~400 lines). Transcribe verbatim. Key sections:

1. `oly_attempts` table with unique(oly_student_id) constraint + 5 indexes + updated_at trigger
2. `oly_questions_snapshot` table with unique(attempt_id, subject_id, position) + 4 indexes
3. `oly_answers` table with unique(question_snapshot_id) + 3 indexes + updated_at trigger
4. `oly_attempt_events` table with 3 indexes
5. RLS policies on all 4 tables (super_admin all + student all own + school_admin SELECT own school + student INSERT own for events)
6. `oly_start_attempt()` RPC — snapshots questions, creates attempt
7. `oly_save_answer(attempt_id, snapshot_id, selected, marked, time_spent)` RPC — idempotent UPSERT
8. `oly_submit_attempt(attempt_id, reason)` RPC — atomic submit + score compute
9. `oly_record_event(attempt_id, event_type, payload)` RPC — increments violation/section counters
10. `oly_get_attempt_state(attempt_id)` RPC — STABLE; computes `remaining_seconds`
11. `oly_get_attempt_questions(attempt_id)` RPC — bulk fetch for resume
12. UPDATE `oly_validate_pin` to enforce `already_attempted` check

- [ ] **Step 1.1: Generate timestamp**

```powershell
Get-Date -AsUTC -Format yyyyMMddHHmmss
```

- [ ] **Step 1.2: Create migration file**

Read the spec file (`docs/superpowers/specs/2026-05-27-olympiad-phase-4b-exam-delivery-design.md`) sections 2.1-2.7 for the full SQL. Transcribe each table/policy/RPC into the migration verbatim.

**Critical RPC bodies to copy carefully:**

**`oly_start_attempt()`** — full SQL skeleton:

```sql
create or replace function public.oly_start_attempt()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_student record;
  v_campaign record;
  v_subjects_per_subject integer;
  v_existing_attempt record;
  v_attempt_id uuid;
  v_pin_success boolean;
  v_subject_id uuid;
  v_inserted_count integer;
begin
  if v_uid is null then raise exception 'forbidden' using errcode = '42501'; end if;

  -- Resolve student
  select id, oly_school_id, grade_level_id, campaign_id, subject_ids
    into v_student
    from public.oly_students
   where (auth_user_id = v_uid or profile_id = v_uid) and status = 'active'
   limit 1;
  if v_student.id is null then raise exception 'No active enrollment'; end if;

  -- Idempotency — return existing attempt if already started
  select id, status into v_existing_attempt
    from public.oly_attempts
   where oly_student_id = v_student.id;
  if v_existing_attempt.id is not null then
    if v_existing_attempt.status = 'in_progress' then
      return jsonb_build_object('ok', true, 'attempt_id', v_existing_attempt.id, 'resumed', true);
    else
      raise exception 'Exam already submitted' using errcode = 'P0002';
    end if;
  end if;

  -- Gate on recent PIN success (within 15 minutes)
  select exists(
    select 1 from public.oly_pin_attempt_log
     where oly_student_id = v_student.id
       and outcome = 'success'
       and attempted_at > now() - interval '15 minutes'
  ) into v_pin_success;
  if not v_pin_success then raise exception 'PIN entry required first' using errcode = 'P0001'; end if;

  -- Get campaign settings
  select campaign_year, exam_duration_minutes, questions_per_subject
    into v_campaign
    from public.oly_campaigns where id = v_student.campaign_id;
  v_subjects_per_subject := v_campaign.questions_per_subject;

  -- Create attempt
  insert into public.oly_attempts (oly_student_id, oly_batch_id, campaign_id, exam_duration_seconds, started_at)
    select v_student.id, oba.oly_batch_id, v_student.campaign_id, v_campaign.exam_duration_minutes * 60, now()
    from public.oly_batch_assignments oba
    where oba.oly_student_id = v_student.id
    returning id into v_attempt_id;

  -- For each chosen subject, snapshot N random active questions
  foreach v_subject_id in array v_student.subject_ids loop
    insert into public.oly_questions_snapshot (
      oly_attempt_id, subject_id, question_id, topic_id, position_in_subject,
      question_text, option_a, option_b, option_c, option_d, correct_answer, marks
    )
    select v_attempt_id, v_subject_id, q.id, q.topic_id, row_number() over (order by random()),
           q.question_text, q.option_a, q.option_b, q.option_c, q.option_d, q.correct_answer, 1
      from public.oly_questions q
     where q.subject_id = v_subject_id
       and q.grade_level_id = v_student.grade_level_id
       and q.status = 'active'
     order by random()
     limit v_subjects_per_subject;

    get diagnostics v_inserted_count = row_count;
    if v_inserted_count < v_subjects_per_subject then
      raise exception 'Not enough active questions in bank for subject %', v_subject_id;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'attempt_id', v_attempt_id, 'resumed', false);
end;
$$;
grant execute on function public.oly_start_attempt() to authenticated;
```

**`oly_save_answer(attempt_id, snapshot_id, selected, marked, time_spent)`** — idempotent UPSERT:

```sql
create or replace function public.oly_save_answer(
  p_attempt_id uuid, p_snapshot_id uuid,
  p_selected text, p_marked boolean, p_time_spent integer
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_attempt_status text;
  v_belongs boolean;
begin
  if v_uid is null then raise exception 'forbidden' using errcode = '42501'; end if;

  -- Ownership check + status gate
  select a.status, exists(
    select 1 from public.oly_questions_snapshot s
     where s.id = p_snapshot_id and s.oly_attempt_id = p_attempt_id
  )
    into v_attempt_status, v_belongs
    from public.oly_attempts a
    join public.oly_students s on s.id = a.oly_student_id
   where a.id = p_attempt_id
     and (s.auth_user_id = v_uid or s.profile_id = v_uid);
  if v_attempt_status is null then raise exception 'Attempt not found or forbidden' using errcode = '42501'; end if;
  if v_attempt_status != 'in_progress' then raise exception 'Attempt closed'; end if;
  if not v_belongs then raise exception 'Question not in this attempt'; end if;
  if p_selected is not null and p_selected not in ('A','B','C','D') then raise exception 'Invalid answer'; end if;

  insert into public.oly_answers (oly_attempt_id, oly_question_snapshot_id, selected_answer, marked_for_review, time_spent_seconds, answered_at)
    values (p_attempt_id, p_snapshot_id, p_selected::char(1), p_marked, p_time_spent, case when p_selected is null then null else now() end)
  on conflict (oly_question_snapshot_id) do update set
    selected_answer = excluded.selected_answer,
    marked_for_review = excluded.marked_for_review,
    time_spent_seconds = greatest(public.oly_answers.time_spent_seconds, excluded.time_spent_seconds),
    answered_at = case when excluded.selected_answer is null then public.oly_answers.answered_at else now() end;

  return jsonb_build_object('ok', true);
end;
$$;
grant execute on function public.oly_save_answer(uuid, uuid, text, boolean, integer) to authenticated;
```

**`oly_submit_attempt(attempt_id, reason)`** — atomic submit + score:

```sql
create or replace function public.oly_submit_attempt(p_attempt_id uuid, p_reason text default 'manual')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_attempt record;
  v_now timestamptz := now();
  v_status text;
  v_subject_scores jsonb;
  v_total_obtained numeric := 0;
  v_total_max numeric := 0;
  v_percentage numeric;
begin
  if v_uid is null then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_reason not in ('manual', 'timer_zero', 'violations_exceeded', 'disconnect_exceeded') then
    raise exception 'Invalid reason';
  end if;

  -- Lock + ownership + status check
  select a.id, a.oly_student_id, a.started_at, a.exam_duration_seconds, a.status
    into v_attempt
    from public.oly_attempts a
    join public.oly_students s on s.id = a.oly_student_id
   where a.id = p_attempt_id
     and (s.auth_user_id = v_uid or s.profile_id = v_uid)
   for update;
  if v_attempt.id is null then raise exception 'Attempt not found or forbidden' using errcode = '42501'; end if;
  if v_attempt.status != 'in_progress' then
    return jsonb_build_object('ok', true, 'already_submitted', true);
  end if;

  -- Defense-in-depth: timer_zero must be enforced server-side
  if p_reason = 'timer_zero' and v_now < v_attempt.started_at + (v_attempt.exam_duration_seconds * interval '1 second') then
    raise exception 'Timer not yet expired';
  end if;

  -- Compute scores in one aggregate query
  select
    jsonb_object_agg(t.subject_id::text, jsonb_build_object(
      'correct', t.correct, 'total', t.total,
      'marks_obtained', t.marks_obtained, 'marks_max', t.marks_max
    )) as subject_scores,
    coalesce(sum(t.marks_obtained), 0) as total_obtained,
    coalesce(sum(t.marks_max), 0) as total_max
    into v_subject_scores, v_total_obtained, v_total_max
    from (
      select s.subject_id,
             count(*) filter (where a.selected_answer = s.correct_answer)::integer as correct,
             count(*)::integer as total,
             coalesce(sum(case when a.selected_answer = s.correct_answer then s.marks else 0 end), 0) as marks_obtained,
             coalesce(sum(s.marks), 0) as marks_max
        from public.oly_questions_snapshot s
        left join public.oly_answers a on a.oly_question_snapshot_id = s.id
       where s.oly_attempt_id = p_attempt_id
       group by s.subject_id
    ) t;

  v_percentage := case when v_total_max > 0 then round((v_total_obtained / v_total_max) * 100, 2) else 0 end;

  v_status := case p_reason
    when 'manual' then 'submitted'
    when 'timer_zero' then 'auto_submitted_timer'
    when 'violations_exceeded' then 'auto_submitted_violation'
    when 'disconnect_exceeded' then 'auto_submitted_disconnect'
  end;

  update public.oly_attempts set
    status = v_status,
    submitted_at = v_now,
    submit_reason = p_reason,
    total_marks_obtained = v_total_obtained,
    total_max_marks = v_total_max,
    percentage = v_percentage,
    subject_scores = v_subject_scores
   where id = p_attempt_id;

  return jsonb_build_object(
    'ok', true,
    'total_marks', v_total_obtained,
    'total_max', v_total_max,
    'percentage', v_percentage
  );
end;
$$;
grant execute on function public.oly_submit_attempt(uuid, text) to authenticated;
```

**`oly_record_event(attempt_id, event_type, payload)`** — telemetry + counter update:

```sql
create or replace function public.oly_record_event(p_attempt_id uuid, p_event_type text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_attempt record;
  v_new_violations integer;
begin
  if v_uid is null then raise exception 'forbidden' using errcode = '42501'; end if;

  select a.id, a.status, a.proctoring_violations
    into v_attempt
    from public.oly_attempts a
    join public.oly_students s on s.id = a.oly_student_id
   where a.id = p_attempt_id
     and (s.auth_user_id = v_uid or s.profile_id = v_uid);
  if v_attempt.id is null then raise exception 'Attempt not found or forbidden' using errcode = '42501'; end if;
  if v_attempt.status != 'in_progress' then
    return jsonb_build_object('ok', true, 'attempt_closed', true);
  end if;

  insert into public.oly_attempt_events (oly_attempt_id, event_type, payload)
    values (p_attempt_id, p_event_type, p_payload);

  if p_event_type like 'proctoring_violation_%' then
    update public.oly_attempts set proctoring_violations = proctoring_violations + 1
     where id = p_attempt_id
    returning proctoring_violations into v_new_violations;
  elsif p_event_type = 'section_switch' then
    update public.oly_attempts set section_switches = section_switches + 1
     where id = p_attempt_id;
    v_new_violations := v_attempt.proctoring_violations;
  else
    v_new_violations := v_attempt.proctoring_violations;
  end if;

  return jsonb_build_object('ok', true, 'total_violations', v_new_violations);
end;
$$;
grant execute on function public.oly_record_event(uuid, text, jsonb) to authenticated;
```

**`oly_get_attempt_state(attempt_id)`** — read RPC for timer sync:

```sql
create or replace function public.oly_get_attempt_state(p_attempt_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_a record;
  v_remaining integer;
  v_expired boolean;
begin
  if v_uid is null then raise exception 'forbidden' using errcode = '42501'; end if;

  select a.id, a.status, a.started_at, a.exam_duration_seconds,
         a.proctoring_violations, a.section_switches, a.submit_reason
    into v_a
    from public.oly_attempts a
    join public.oly_students s on s.id = a.oly_student_id
   where a.id = p_attempt_id
     and (s.auth_user_id = v_uid or s.profile_id = v_uid);
  if v_a.id is null then raise exception 'Attempt not found or forbidden' using errcode = '42501'; end if;

  v_remaining := greatest(0, v_a.exam_duration_seconds - extract(epoch from (now() - v_a.started_at))::integer);
  v_expired := v_remaining <= 0;

  return jsonb_build_object(
    'attempt_id', v_a.id,
    'status', v_a.status,
    'remaining_seconds', v_remaining,
    'expired', v_expired,
    'proctoring_violations', v_a.proctoring_violations,
    'section_switches', v_a.section_switches,
    'submit_reason', v_a.submit_reason
  );
end;
$$;
grant execute on function public.oly_get_attempt_state(uuid) to authenticated;
```

**`oly_get_attempt_questions(attempt_id)`** — bulk fetch for resume:

```sql
create or replace function public.oly_get_attempt_questions(p_attempt_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_owns boolean;
  v_questions jsonb;
begin
  if v_uid is null then raise exception 'forbidden' using errcode = '42501'; end if;

  select exists(
    select 1 from public.oly_attempts a
      join public.oly_students s on s.id = a.oly_student_id
     where a.id = p_attempt_id
       and (s.auth_user_id = v_uid or s.profile_id = v_uid)
  ) into v_owns;
  if not v_owns then raise exception 'Attempt not found or forbidden' using errcode = '42501'; end if;

  select jsonb_agg(jsonb_build_object(
    'snapshot_id', s.id,
    'subject_id', s.subject_id,
    'position', s.position_in_subject,
    'question_text', s.question_text,
    'option_a', s.option_a,
    'option_b', s.option_b,
    'option_c', s.option_c,
    'option_d', s.option_d,
    'marks', s.marks,
    'selected_answer', a.selected_answer,
    'marked_for_review', coalesce(a.marked_for_review, false),
    'time_spent_seconds', coalesce(a.time_spent_seconds, 0)
  ) order by s.subject_id, s.position_in_subject)
    into v_questions
    from public.oly_questions_snapshot s
    left join public.oly_answers a on a.oly_question_snapshot_id = s.id
   where s.oly_attempt_id = p_attempt_id;

  return jsonb_build_object('ok', true, 'questions', v_questions);
end;
$$;
grant execute on function public.oly_get_attempt_questions(uuid) to authenticated;
```

**Update `oly_validate_pin` to enforce already_attempted**:

```sql
create or replace function public.oly_validate_pin(
  p_pin text, p_ip text default null, p_user_agent text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
-- ... existing body ...
-- Add this check after the school_status check, before the success branch:
declare
  v_attempt_status text;
begin
  -- ... existing prelude ...
  select status into v_attempt_status from public.oly_attempts where oly_student_id = v_student.id;
  if v_attempt_status is not null and v_attempt_status != 'in_progress' then
    insert into public.oly_pin_attempt_log (oly_school_id, oly_student_id, attempted_pin, ip_address, user_agent, outcome, resolved_batch_id)
      values (v_student.oly_school_id, v_student.id, v_clean_pin, p_ip, p_user_agent, 'already_attempted', v_resolved_batch_id);
    return jsonb_build_object('ok', false, 'reason', 'already_attempted');
  end if;
  -- ... existing success branch ...
end;
$$;
```

The implementer should read the existing `oly_validate_pin` body from the Phase 4a migration and modify in place — adding the check after the existing checks, before the success branch. CREATE OR REPLACE the full function.

- [ ] **Step 1.3: Apply + regenerate types + verify**

```bash
npx supabase db push
npx supabase gen types typescript --project-id gyymkgohcijeksmrzuyw > src/integrations/supabase/types.ts
npx tsc --noEmit
```

- [ ] **Step 1.4: Commit**

```bash
git add supabase/migrations/<ts>_oly_phase_4b_attempts.sql src/integrations/supabase/types.ts
git commit -m "feat(olympiad): phase 4b schema - attempts, snapshots, answers, events + 6 RPCs

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Section B — Hooks

### Task 2: 6 production-hardened hooks

**Files:** all under `src/hooks/olympiad/`

#### `useOlympiadStartAttempt.ts`

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/toast";

export type StartAttemptResult = { ok: true; attempt_id: string; resumed: boolean };

export function useOlympiadStartAttempt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<StartAttemptResult> => {
      const { data, error } = await supabase.rpc("oly_start_attempt");
      if (error) throw error;
      return data as StartAttemptResult;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["olympiad", "student-dashboard"] });
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't start exam. Please contact your school.", context: "useOlympiadStartAttempt" }),
  });
}
```

#### `useOlympiadAttemptState.ts`

```ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type AttemptState = {
  attempt_id: string;
  status: "in_progress" | "submitted" | "auto_submitted_timer" | "auto_submitted_violation" | "auto_submitted_disconnect";
  remaining_seconds: number;
  expired: boolean;
  proctoring_violations: number;
  section_switches: number;
  submit_reason: string | null;
};

export function useOlympiadAttemptState(attemptId: string | undefined) {
  return useQuery({
    queryKey: ["olympiad", "attempt-state", attemptId],
    queryFn: async (): Promise<AttemptState | null> => {
      if (!attemptId) return null;
      const { data, error } = await supabase.rpc("oly_get_attempt_state", { p_attempt_id: attemptId });
      if (error) throw error;
      return data as AttemptState;
    },
    enabled: !!attemptId,
    // §23.2: refetchInterval=30s justified — keeps client timer synced to server,
    // detects timer expiry for auto-submit trigger. Stops once attempt is closed.
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s && s !== "in_progress" ? false : 30_000;
    },
    refetchIntervalInBackground: true,
    staleTime: 0,  // always refetch — timer is the hottest data point
  });
}
```

#### `useOlympiadAttemptQuestions.ts`

```ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type AttemptQuestion = {
  snapshot_id: string;
  subject_id: string;
  position: number;
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  marks: number;
  selected_answer: "A" | "B" | "C" | "D" | null;
  marked_for_review: boolean;
  time_spent_seconds: number;
};

export function useOlympiadAttemptQuestions(attemptId: string | undefined) {
  return useQuery({
    queryKey: ["olympiad", "attempt-questions", attemptId],
    queryFn: async (): Promise<AttemptQuestion[]> => {
      if (!attemptId) return [];
      const { data, error } = await supabase.rpc("oly_get_attempt_questions", { p_attempt_id: attemptId });
      if (error) throw error;
      return ((data as { questions: AttemptQuestion[] })?.questions ?? []) as AttemptQuestion[];
    },
    enabled: !!attemptId,
    // §23.2: questions snapshot is frozen at start — no need to refetch
    staleTime: Infinity,
    gcTime: 60 * 60_000,  // keep in cache for 1 hour
  });
}
```

#### `useOlympiadSaveAnswer.ts`

```ts
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type SaveAnswerInput = {
  attempt_id: string;
  snapshot_id: string;
  selected: "A" | "B" | "C" | "D" | null;
  marked: boolean;
  time_spent: number;
};

export function useOlympiadSaveAnswer() {
  return useMutation({
    mutationFn: async (input: SaveAnswerInput) => {
      const { data, error } = await supabase.rpc("oly_save_answer", {
        p_attempt_id: input.attempt_id,
        p_snapshot_id: input.snapshot_id,
        p_selected: input.selected,
        p_marked: input.marked,
        p_time_spent: input.time_spent,
      });
      if (error) throw error;
      return data;
    },
    // No onError toast — failures are common (network blips) and the parent
    // component handles retry with exponential backoff. Idempotent on retry.
    retry: 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 5000),
  });
}
```

#### `useOlympiadSubmitAttempt.ts`

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/toast";

export type SubmitReason = "manual" | "timer_zero" | "violations_exceeded" | "disconnect_exceeded";

export type SubmitResult = {
  ok: true;
  total_marks?: number;
  total_max?: number;
  percentage?: number;
  already_submitted?: boolean;
};

export function useOlympiadSubmitAttempt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ attempt_id, reason }: { attempt_id: string; reason: SubmitReason }): Promise<SubmitResult> => {
      const { data, error } = await supabase.rpc("oly_submit_attempt", {
        p_attempt_id: attempt_id,
        p_reason: reason,
      });
      if (error) throw error;
      return data as SubmitResult;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["olympiad"] });
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't submit exam. Please contact your school.", context: "useOlympiadSubmitAttempt" }),
    retry: 1,  // submit must succeed; one retry for transient errors
  });
}
```

#### `useOlympiadRecordEvent.ts`

```ts
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type EventType =
  | "section_switch" | "flag" | "unflag"
  | "proctoring_violation_fullscreen" | "proctoring_violation_tab_switch"
  | "disconnect" | "reconnect" | "auto_save";

export type RecordEventResult = { ok: true; total_violations?: number; attempt_closed?: boolean };

export function useOlympiadRecordEvent() {
  return useMutation({
    mutationFn: async (input: { attempt_id: string; event_type: EventType; payload?: Record<string, unknown> }): Promise<RecordEventResult> => {
      const { data, error } = await supabase.rpc("oly_record_event", {
        p_attempt_id: input.attempt_id,
        p_event_type: input.event_type,
        p_payload: input.payload ?? {},
      });
      if (error) throw error;
      return data as RecordEventResult;
    },
    // Fire-and-forget — telemetry failures shouldn't block exam UX
    retry: 0,
  });
}
```

- [ ] **Step 2.1: Create all 6 hook files** with the exact bodies above.

- [ ] **Step 2.2: Verify + commit**

```bash
npx tsc --noEmit
npx eslint src/hooks/olympiad/useOlympiadStartAttempt.ts src/hooks/olympiad/useOlympiadAttemptState.ts src/hooks/olympiad/useOlympiadAttemptQuestions.ts src/hooks/olympiad/useOlympiadSaveAnswer.ts src/hooks/olympiad/useOlympiadSubmitAttempt.ts src/hooks/olympiad/useOlympiadRecordEvent.ts
git add src/hooks/olympiad/useOlympiadStartAttempt.ts src/hooks/olympiad/useOlympiadAttemptState.ts src/hooks/olympiad/useOlympiadAttemptQuestions.ts src/hooks/olympiad/useOlympiadSaveAnswer.ts src/hooks/olympiad/useOlympiadSubmitAttempt.ts src/hooks/olympiad/useOlympiadRecordEvent.ts
git commit -m "feat(olympiad): phase 4b hooks - start, state, questions, save-answer, submit, record-event"
```

---

## Section C — Exam UI

### Task 3: Exam page components

**Files:**
- Create: `src/components/olympiad/exam/ExamSubjectTabs.tsx`
- Create: `src/components/olympiad/exam/QuestionNavGrid.tsx`
- Create: `src/components/olympiad/exam/QuestionDisplay.tsx`
- Create: `src/components/olympiad/exam/ExamTimer.tsx`
- Create: `src/components/olympiad/exam/SubmitConfirmDialog.tsx`
- Create: `src/components/olympiad/exam/ProctoringWarningDialog.tsx`
- Create: `src/components/olympiad/exam/DisconnectBanner.tsx`

#### `ExamSubjectTabs.tsx`

```tsx
import type { AttemptQuestion } from "@/hooks/olympiad/useOlympiadAttemptQuestions";

type Props = {
  subjects: Array<{ id: string; name: string }>;
  questions: AttemptQuestion[];
  activeSubjectId: string;
  onSubjectChange: (subjectId: string) => void;
};

export function ExamSubjectTabs({ subjects, questions, activeSubjectId, onSubjectChange }: Props) {
  return (
    <nav className="flex gap-2 overflow-x-auto scrollbar-hide" role="tablist">
      {subjects.map((s) => {
        const subjectQuestions = questions.filter((q) => q.subject_id === s.id);
        const answered = subjectQuestions.filter((q) => q.selected_answer !== null).length;
        const total = subjectQuestions.length;
        const isActive = s.id === activeSubjectId;
        return (
          <button
            key={s.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onSubjectChange(s.id)}
            className={`flex-shrink-0 px-4 py-2 rounded-full text-sm font-medium transition-colors ${
              isActive
                ? "bg-brand-primary text-white"
                : "bg-surface-card text-ink-700 hover:bg-surface-card/80"
            }`}
          >
            {s.name} ({answered}/{total})
          </button>
        );
      })}
    </nav>
  );
}
```

#### `QuestionNavGrid.tsx`

```tsx
import type { AttemptQuestion } from "@/hooks/olympiad/useOlympiadAttemptQuestions";

type Props = {
  questions: AttemptQuestion[];
  activePosition: number;
  onSelect: (position: number) => void;
};

export function QuestionNavGrid({ questions, activePosition, onSelect }: Props) {
  return (
    <div className="grid grid-cols-5 gap-2">
      {questions.map((q) => {
        const isActive = q.position === activePosition;
        const isAnswered = q.selected_answer !== null;
        const isFlagged = q.marked_for_review;
        return (
          <button
            key={q.snapshot_id}
            onClick={() => onSelect(q.position)}
            aria-current={isActive ? "true" : undefined}
            className={`aspect-square rounded-md text-sm font-medium transition-colors border ${
              isActive ? "ring-2 ring-brand-primary border-brand-primary" : "border-surface-stroke"
            } ${
              isAnswered && isFlagged
                ? "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300"
                : isAnswered
                ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-300"
                : isFlagged
                ? "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400"
                : "bg-surface-card text-ink-700"
            }`}
          >
            {q.position}
          </button>
        );
      })}
    </div>
  );
}
```

#### `QuestionDisplay.tsx`

```tsx
import { useState } from "react";
import { Flag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { MathText } from "@/components/ui/math-text";
import type { AttemptQuestion } from "@/hooks/olympiad/useOlympiadAttemptQuestions";

type Props = {
  question: AttemptQuestion;
  onAnswerChange: (answer: "A" | "B" | "C" | "D" | null, marked: boolean) => void;
  onPrev?: () => void;
  onNext?: () => void;
};

const OPTIONS: Array<"A" | "B" | "C" | "D"> = ["A", "B", "C", "D"];

export function QuestionDisplay({ question, onAnswerChange, onPrev, onNext }: Props) {
  const [marked, setMarked] = useState(question.marked_for_review);

  return (
    <div className="space-y-5">
      <header className="flex items-center justify-between">
        <p className="eyebrow">Question {question.position}</p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            const next = !marked;
            setMarked(next);
            onAnswerChange(question.selected_answer, next);
          }}
          className={marked ? "text-amber-600" : ""}
        >
          <Flag className="h-4 w-4 mr-1" />
          {marked ? "Marked" : "Mark for review"}
        </Button>
      </header>

      <div className="surface-card frosted-shadow rounded-card p-5">
        <MathText text={question.question_text} />
      </div>

      <fieldset className="space-y-2">
        <legend className="sr-only">Select an option</legend>
        {OPTIONS.map((letter) => {
          const optionKey = `option_${letter.toLowerCase()}` as keyof AttemptQuestion;
          const isSelected = question.selected_answer === letter;
          return (
            <label
              key={letter}
              className={`flex items-start gap-3 px-4 py-3 rounded-md border cursor-pointer transition-colors ${
                isSelected
                  ? "border-brand-primary bg-brand-primary/5"
                  : "border-surface-stroke hover:bg-surface-card/50"
              }`}
            >
              <input
                type="radio"
                name={`q-${question.snapshot_id}`}
                value={letter}
                checked={isSelected}
                onChange={() => onAnswerChange(letter, marked)}
                className="mt-1"
              />
              <div className="flex-1">
                <span className="font-medium mr-2">{letter}.</span>
                <MathText text={question[optionKey] as string} />
              </div>
            </label>
          );
        })}
      </fieldset>

      <div className="flex justify-between gap-2 pt-4">
        <Button variant="outline" onClick={onPrev} disabled={!onPrev}>
          Previous
        </Button>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            onClick={() => onAnswerChange(null, marked)}
            disabled={question.selected_answer === null}
          >
            Clear
          </Button>
          <Button onClick={onNext} disabled={!onNext}>
            Save & Next
          </Button>
        </div>
      </div>
    </div>
  );
}
```

#### `ExamTimer.tsx`

```tsx
import { useEffect, useState } from "react";
import { Clock } from "lucide-react";

type Props = {
  // Server-authoritative remaining seconds, refreshed every 30s by parent
  serverRemainingSeconds: number;
  lastSyncAt: number;  // Date.now() when serverRemainingSeconds was set
  onExpired: () => void;
};

export function ExamTimer({ serverRemainingSeconds, lastSyncAt, onExpired }: Props) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const elapsedSinceSync = Math.floor((now - lastSyncAt) / 1000);
  const remaining = Math.max(0, serverRemainingSeconds - elapsedSinceSync);

  useEffect(() => {
    if (remaining === 0) onExpired();
  }, [remaining, onExpired]);

  const mm = Math.floor(remaining / 60).toString().padStart(2, "0");
  const ss = (remaining % 60).toString().padStart(2, "0");
  const isLowRed = remaining < 300;
  const isLowAmber = remaining < 900;

  return (
    <div
      className={`flex items-center gap-2 font-mono text-lg font-semibold ${
        isLowRed ? "text-red-600" : isLowAmber ? "text-amber-600" : "text-ink-900"
      }`}
      role="timer"
      aria-live="off"
    >
      <Clock className="h-5 w-5" />
      {mm}:{ss}
    </div>
  );
}
```

#### `SubmitConfirmDialog.tsx`

```tsx
import { useState } from "react";
import { Loader2 } from "lucide-react";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  answeredCount: number;
  totalCount: number;
  onConfirm: () => Promise<void>;
};

export function SubmitConfirmDialog({ open, onOpenChange, answeredCount, totalCount, onConfirm }: Props) {
  const [busy, setBusy] = useState(false);
  const unanswered = totalCount - answeredCount;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Submit your exam?</AlertDialogTitle>
          <AlertDialogDescription>
            You have answered {answeredCount} of {totalCount} questions.
            {unanswered > 0 && (
              <> Unanswered questions will be marked as not attempted.</>
            )}
            <br /><br />
            Once submitted, you cannot make any more changes. Are you sure?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={async () => {
              setBusy(true);
              await onConfirm();
              setBusy(false);
            }}
            disabled={busy}
          >
            {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Submit exam
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

#### `ProctoringWarningDialog.tsx`

```tsx
import { AlertTriangle } from "lucide-react";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogAction,
} from "@/components/ui/alert-dialog";

type Props = {
  open: boolean;
  onAcknowledge: () => void;
  violations: number;
};

export function ProctoringWarningDialog({ open, onAcknowledge, violations }: Props) {
  const remaining = 3 - violations;

  return (
    <AlertDialog open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            Proctoring violation detected
          </AlertDialogTitle>
          <AlertDialogDescription>
            You exited fullscreen or switched tabs. This is violation <strong>{violations} of 3</strong>.
            <br /><br />
            {remaining > 0
              ? <>You have <strong>{remaining}</strong> warning{remaining === 1 ? "" : "s"} remaining. After {remaining === 1 ? "this" : "3 violations"}, your exam will be submitted automatically.</>
              : <>Your exam will now be submitted automatically.</>
            }
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction onClick={onAcknowledge}>I understand</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

#### `DisconnectBanner.tsx`

```tsx
import { WifiOff } from "lucide-react";

type Props = { offline: boolean };

export function DisconnectBanner({ offline }: Props) {
  if (!offline) return null;
  return (
    <div className="bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300 px-4 py-2 text-sm flex items-center gap-2">
      <WifiOff className="h-4 w-4" />
      You're offline. Your timer keeps running. Reconnect soon to save your answers.
    </div>
  );
}
```

- [ ] **Step 3.1: Create all 7 component files** with the exact code above.

- [ ] **Step 3.2: Verify + commit**

```bash
npx tsc --noEmit
npx eslint src/components/olympiad/exam/
git add src/components/olympiad/exam/
git commit -m "feat(olympiad): exam UI components - subject tabs, nav grid, question display, timer, dialogs"
```

---

### Task 4: `OlympiadExamAttemptPage` (the big one)

**Files:**
- Create: `src/pages/student/olympiad/OlympiadExamAttemptPage.tsx`

This is the main exam page. It orchestrates everything: state machine, timer, proctoring, auto-submit, session resume.

- [ ] **Step 4.1: Create the page**

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/shared/page/PageShell";
import {
  requestFullscreen,
  exitFullscreen,
  getFullscreenElement,
  onFullscreenChange,
  isFullscreenSupported,
} from "@/lib/fullscreen";
import { useOlympiadStudentDashboard } from "@/hooks/olympiad/useOlympiadStudentDashboard";
import { useOlympiadStartAttempt } from "@/hooks/olympiad/useOlympiadStartAttempt";
import { useOlympiadAttemptState } from "@/hooks/olympiad/useOlympiadAttemptState";
import { useOlympiadAttemptQuestions, type AttemptQuestion } from "@/hooks/olympiad/useOlympiadAttemptQuestions";
import { useOlympiadSaveAnswer } from "@/hooks/olympiad/useOlympiadSaveAnswer";
import { useOlympiadSubmitAttempt, type SubmitReason } from "@/hooks/olympiad/useOlympiadSubmitAttempt";
import { useOlympiadRecordEvent } from "@/hooks/olympiad/useOlympiadRecordEvent";
import { ExamSubjectTabs } from "@/components/olympiad/exam/ExamSubjectTabs";
import { QuestionNavGrid } from "@/components/olympiad/exam/QuestionNavGrid";
import { QuestionDisplay } from "@/components/olympiad/exam/QuestionDisplay";
import { ExamTimer } from "@/components/olympiad/exam/ExamTimer";
import { SubmitConfirmDialog } from "@/components/olympiad/exam/SubmitConfirmDialog";
import { ProctoringWarningDialog } from "@/components/olympiad/exam/ProctoringWarningDialog";
import { DisconnectBanner } from "@/components/olympiad/exam/DisconnectBanner";

export default function OlympiadExamAttemptPage() {
  const navigate = useNavigate();
  const { data: dashboardCtx } = useOlympiadStudentDashboard();
  const startAttempt = useOlympiadStartAttempt();
  const saveAnswer = useOlympiadSaveAnswer();
  const submitAttempt = useOlympiadSubmitAttempt();
  const recordEvent = useOlympiadRecordEvent();

  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [activeSubjectId, setActiveSubjectId] = useState<string | null>(null);
  const [activePosition, setActivePosition] = useState(1);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [violationWarning, setViolationWarning] = useState<number | null>(null);
  const [offline, setOffline] = useState(!navigator.onLine);

  // Local question state (mirrors server, updated optimistically + saved via debounced RPC)
  const [localQuestions, setLocalQuestions] = useState<AttemptQuestion[]>([]);
  const saveTimers = useRef<Map<string, number>>(new Map());

  const submittedRef = useRef(false);
  const lastSyncAt = useRef(Date.now());

  // 1. Start or resume attempt on mount
  useEffect(() => {
    if (!dashboardCtx?.ok) return;
    if (attemptId) return;
    startAttempt.mutate(undefined, {
      onSuccess: (data) => {
        setAttemptId(data.attempt_id);
      },
    });
  }, [dashboardCtx, attemptId, startAttempt]);

  const { data: attemptState } = useOlympiadAttemptState(attemptId ?? undefined);
  const { data: serverQuestions, isLoading: questionsLoading } = useOlympiadAttemptQuestions(attemptId ?? undefined);

  // Sync questions from server into local state once
  useEffect(() => {
    if (serverQuestions && serverQuestions.length > 0 && localQuestions.length === 0) {
      setLocalQuestions(serverQuestions);
      // Default to first subject
      if (!activeSubjectId) setActiveSubjectId(serverQuestions[0].subject_id);
    }
  }, [serverQuestions, localQuestions.length, activeSubjectId]);

  // Sync the lastSyncAt ref on state refresh
  useEffect(() => {
    if (attemptState) {
      lastSyncAt.current = Date.now();
    }
  }, [attemptState]);

  const subjects = useMemo(() => {
    if (!dashboardCtx?.ok) return [];
    return dashboardCtx.subjects;
  }, [dashboardCtx]);

  const currentSubjectQuestions = useMemo(() => {
    if (!activeSubjectId) return [];
    return localQuestions.filter((q) => q.subject_id === activeSubjectId);
  }, [localQuestions, activeSubjectId]);

  const currentQuestion = useMemo(() => {
    return currentSubjectQuestions.find((q) => q.position === activePosition) ?? null;
  }, [currentSubjectQuestions, activePosition]);

  // 2. Redirect on completed attempt
  useEffect(() => {
    if (attemptState && attemptState.status !== "in_progress") {
      navigate("/student/olympiad/exam/submitted", { replace: true });
    }
  }, [attemptState, navigate]);

  // 3. Activate fullscreen on entry (silent fallback on iOS)
  useEffect(() => {
    if (!isFullscreenSupported()) return;
    requestFullscreen(document.documentElement);
    return () => { exitFullscreen(); };
  }, []);

  // 4. Proctoring: fullscreen change
  useEffect(() => {
    if (!isFullscreenSupported() || !attemptId) return;
    const off = onFullscreenChange(() => {
      if (!getFullscreenElement() && !submittedRef.current) {
        recordEvent.mutate(
          { attempt_id: attemptId, event_type: "proctoring_violation_fullscreen" },
          {
            onSuccess: (data) => {
              if (data.total_violations && data.total_violations >= 3) {
                doAutoSubmit("violations_exceeded");
              } else if (data.total_violations) {
                setViolationWarning(data.total_violations);
              }
            },
          }
        );
      }
    });
    return () => off?.();
  }, [attemptId]);

  // 5. Proctoring: tab switch
  useEffect(() => {
    if (!attemptId) return;
    const handler = () => {
      if (document.hidden && !submittedRef.current) {
        recordEvent.mutate(
          { attempt_id: attemptId, event_type: "proctoring_violation_tab_switch" },
          {
            onSuccess: (data) => {
              if (data.total_violations && data.total_violations >= 3) {
                doAutoSubmit("violations_exceeded");
              } else if (data.total_violations) {
                setViolationWarning(data.total_violations);
              }
            },
          }
        );
      }
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [attemptId]);

  // 6. Online / offline tracking
  useEffect(() => {
    const onOnline = () => {
      setOffline(false);
      if (attemptId) recordEvent.mutate({ attempt_id: attemptId, event_type: "reconnect" });
    };
    const onOffline = () => {
      setOffline(true);
      if (attemptId) recordEvent.mutate({ attempt_id: attemptId, event_type: "disconnect" });
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [attemptId]);

  // 7. Auto-submit on timer expiry
  const doAutoSubmit = (reason: SubmitReason) => {
    if (submittedRef.current || !attemptId) return;
    submittedRef.current = true;
    submitAttempt.mutate(
      { attempt_id: attemptId, reason },
      { onSuccess: () => navigate("/student/olympiad/exam/submitted", { replace: true }) }
    );
  };

  // 8. Answer save with debounce
  const saveAnswerDebounced = (
    snapshotId: string,
    payload: { selected: "A" | "B" | "C" | "D" | null; marked: boolean; time_spent: number }
  ) => {
    if (!attemptId) return;
    const existing = saveTimers.current.get(snapshotId);
    if (existing) window.clearTimeout(existing);
    const t = window.setTimeout(() => {
      saveAnswer.mutate({
        attempt_id: attemptId,
        snapshot_id: snapshotId,
        ...payload,
      });
      saveTimers.current.delete(snapshotId);
    }, 500);
    saveTimers.current.set(snapshotId, t);
  };

  const onAnswerChange = (
    snapshotId: string,
    selected: "A" | "B" | "C" | "D" | null,
    marked: boolean
  ) => {
    setLocalQuestions((prev) =>
      prev.map((q) =>
        q.snapshot_id === snapshotId ? { ...q, selected_answer: selected, marked_for_review: marked } : q
      )
    );
    const q = localQuestions.find((x) => x.snapshot_id === snapshotId);
    if (!q) return;
    saveAnswerDebounced(snapshotId, {
      selected, marked,
      time_spent: q.time_spent_seconds + 5,  // crude — increments per save
    });
  };

  // Cleanup save timers on unmount
  useEffect(() => {
    return () => {
      saveTimers.current.forEach((t) => window.clearTimeout(t));
    };
  }, []);

  const onSubjectChange = (subjectId: string) => {
    if (subjectId === activeSubjectId) return;
    setActiveSubjectId(subjectId);
    setActivePosition(1);
    if (attemptId) {
      recordEvent.mutate({ attempt_id: attemptId, event_type: "section_switch", payload: { to_subject: subjectId } });
    }
  };

  if (!dashboardCtx?.ok || !attemptId || questionsLoading || !currentQuestion || !attemptState) {
    return (
      <PageShell>
        <div className="flex flex-col items-center justify-center py-24 gap-3">
          <Loader2 className="h-6 w-6 animate-spin text-brand-primary" />
          <p className="text-sm text-ink-600">Loading exam…</p>
        </div>
      </PageShell>
    );
  }

  const totalAnswered = localQuestions.filter((q) => q.selected_answer !== null).length;

  return (
    <div className="min-h-screen surface-gradient">
      <DisconnectBanner offline={offline} />
      <header className="sticky top-0 z-10 surface-card frosted-shadow px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0 overflow-hidden">
          <ExamSubjectTabs
            subjects={subjects}
            questions={localQuestions}
            activeSubjectId={activeSubjectId ?? subjects[0].id}
            onSubjectChange={onSubjectChange}
          />
        </div>
        <ExamTimer
          serverRemainingSeconds={attemptState.remaining_seconds}
          lastSyncAt={lastSyncAt.current}
          onExpired={() => doAutoSubmit("timer_zero")}
        />
        <Button onClick={() => setSubmitOpen(true)} className="flex-shrink-0">
          <Send className="h-4 w-4 mr-1" />
          Submit
        </Button>
      </header>

      <main className="max-w-6xl mx-auto p-4 sm:p-6 grid lg:grid-cols-[1fr,300px] gap-6">
        <section>
          <QuestionDisplay
            question={currentQuestion}
            onAnswerChange={(selected, marked) =>
              onAnswerChange(currentQuestion.snapshot_id, selected, marked)
            }
            onPrev={activePosition > 1 ? () => setActivePosition(activePosition - 1) : undefined}
            onNext={activePosition < currentSubjectQuestions.length ? () => setActivePosition(activePosition + 1) : undefined}
          />
        </section>

        <aside className="lg:sticky lg:top-24 lg:self-start surface-card frosted-shadow rounded-card p-4">
          <p className="eyebrow mb-3">Questions</p>
          <QuestionNavGrid
            questions={currentSubjectQuestions}
            activePosition={activePosition}
            onSelect={setActivePosition}
          />
        </aside>
      </main>

      <SubmitConfirmDialog
        open={submitOpen}
        onOpenChange={setSubmitOpen}
        answeredCount={totalAnswered}
        totalCount={localQuestions.length}
        onConfirm={async () => {
          await submitAttempt.mutateAsync({ attempt_id: attemptId, reason: "manual" });
          submittedRef.current = true;
          navigate("/student/olympiad/exam/submitted", { replace: true });
        }}
      />

      <ProctoringWarningDialog
        open={violationWarning !== null && violationWarning < 3}
        violations={violationWarning ?? 0}
        onAcknowledge={() => setViolationWarning(null)}
      />
    </div>
  );
}
```

- [ ] **Step 4.2: Verify + commit**

```bash
npx tsc --noEmit
npx eslint src/pages/student/olympiad/OlympiadExamAttemptPage.tsx
npx vite build
git add src/pages/student/olympiad/OlympiadExamAttemptPage.tsx
git commit -m "feat(olympiad): exam attempt page with timer + proctoring + auto-submit + session resume"
```

---

### Task 5: Submit page + dashboard post-submit + route registration

**Files:**
- Create: `src/pages/student/olympiad/OlympiadExamSubmittedPage.tsx`
- Modify: `src/pages/student/olympiad/OlympiadStudentDashboardPage.tsx`
- Modify: `src/App.tsx` (replace exam-pending route with exam route + add submitted)

#### Submit page

```tsx
import { NavLink } from "react-router-dom";
import { CheckCircle2, ArrowRight } from "lucide-react";
import { PageShell } from "@/components/shared/page/PageShell";
import { PageHeader } from "@/components/shared/page/PageHeader";
import { Button } from "@/components/ui/button";

export default function OlympiadExamSubmittedPage() {
  return (
    <PageShell>
      <PageHeader title="Exam submitted" />
      <div className="surface-card frosted-shadow rounded-card p-8 sm:p-10 text-center max-w-md mx-auto mt-6 space-y-4">
        <CheckCircle2 className="h-14 w-14 text-emerald-500 mx-auto" />
        <h1 className="text-xl font-bold text-ink-900">Exam submitted successfully</h1>
        <p className="text-sm text-ink-700">
          Your results will be published soon by your school. You will receive an email when they are ready.
        </p>
        <NavLink to="/student/olympiad">
          <Button className="w-full">
            Back to dashboard
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </NavLink>
      </div>
    </PageShell>
  );
}
```

#### Dashboard edit

In `OlympiadStudentDashboardPage.tsx`, the dashboard hook already provides `ctx.batch`. We need to also fetch attempt status. Add an additional check after the dashboard query:

```tsx
import { useOlympiadAttemptState } from "@/hooks/olympiad/useOlympiadAttemptState";
import { CheckCircle2 } from "lucide-react";

// inside the component, after the existing hooks:
// We don't know the attempt_id yet — query oly_attempts by current user via a small new helper
// For Phase 4b we extend useOlympiadStudentDashboard to include attempt status.
```

To avoid an extra hook in this phase, EXTEND `useOlympiadStudentDashboard` (which calls `oly_student_dashboard_context` RPC) to ALSO return the student's attempt state. Update the RPC SQL in Phase 4b's migration so it also returns:

```sql
'attempt', case when v_attempt.id is null then null else jsonb_build_object(
  'id', v_attempt.id, 'status', v_attempt.status, 'submitted_at', v_attempt.submitted_at,
  'submit_reason', v_attempt.submit_reason
) end
```

Where `v_attempt` is fetched alongside other dashboard data with:
```sql
select id, status, submitted_at, submit_reason into v_attempt
  from public.oly_attempts where oly_student_id = v_student.id;
```

Then in the dashboard page, branch:
```tsx
{ctx.attempt && ctx.attempt.status !== "in_progress" ? (
  <div className="surface-card frosted-shadow rounded-card p-6 space-y-2">
    <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto" />
    <p className="text-center text-base font-semibold text-ink-900">Exam submitted</p>
    <p className="text-center text-xs text-ink-500">
      Submitted on {new Date(ctx.attempt.submitted_at!).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
    </p>
    <p className="text-center text-sm text-ink-700 mt-2">
      Your results will be published by your school soon.
    </p>
  </div>
) : (
  // existing batch + countdown + Start exam block
)}
```

Update `DashboardContext` type in `useOlympiadStudentDashboard.ts` to add the `attempt` field.

#### App.tsx route changes

Replace the placeholder `OlympiadStudentExamPendingPage` route with the actual exam page. Add the submitted page.

```tsx
const OlympiadExamAttemptPage = lazy(() => import("@/pages/student/olympiad/OlympiadExamAttemptPage"));
const OlympiadExamSubmittedPage = lazy(() => import("@/pages/student/olympiad/OlympiadExamSubmittedPage"));
```

Remove the `/student/olympiad/exam-pending` route. Replace with:

```tsx
<Route path="/student/olympiad/exam" element={
  <ProtectedRoute allowedRoles={["student"]}>
    <Suspense fallback={<p>Loading...</p>}>
      <OlympiadExamAttemptPage />
    </Suspense>
  </ProtectedRoute>
} />
<Route path="/student/olympiad/exam/submitted" element={
  <ProtectedRoute allowedRoles={["student"]}>
    <Suspense fallback={<p>Loading...</p>}>
      <OlympiadExamSubmittedPage />
    </Suspense>
  </ProtectedRoute>
} />
```

Also update `OlympiadStudentPinEntryPage` to navigate to `/student/olympiad/exam` (not `/student/olympiad/exam-pending`).

Delete the file `src/pages/student/olympiad/OlympiadStudentExamPendingPage.tsx`.

- [ ] **Step 5.1: Update the migration to include attempt in dashboard context**

In the Phase 4b migration, ALSO update `oly_student_dashboard_context()` to include attempt status. Add a section to the RPC body that queries `oly_attempts` for the student and includes it in the return JSON. (Or use a separate small hook — implementer's call.)

- [ ] **Step 5.2: Update the dashboard hook type + page**

- [ ] **Step 5.3: Update App.tsx routes**

- [ ] **Step 5.4: Verify + commit**

```bash
npx tsc --noEmit
npx eslint src/pages/student/olympiad/ src/App.tsx
npx vite build
git add src/pages/student/olympiad/ src/hooks/olympiad/useOlympiadStudentDashboard.ts src/App.tsx
git commit -m "feat(olympiad): exam-submitted page + dashboard post-submit state + route wiring"
```

---

## Section D — Verification

### Task 6: §5a sweep + concurrency checklist

- [ ] **Run §5a**

```bash
npx tsc --noEmit
npx eslint "src/{hooks,components,pages,lib}/olympiad/**" "src/App.tsx"
npx vite build
```
All exit 0.

- [ ] **Concurrency checklist self-verify**:

For Phase 4b:
- [ ] All 6 hooks have explicit `staleTime` (except `useOlympiadAttemptState` which uses `staleTime: 0` + `refetchInterval: 30_000` — justified by comment)
- [ ] No `supabase.auth.getUser()` calls
- [ ] No `select("*")` 
- [ ] All FKs indexed in T1 migration
- [ ] All RPCs are SECURITY DEFINER with `auth.uid()` ownership check
- [ ] `oly_save_answer` is idempotent (UPSERT on snapshot_id unique)
- [ ] `oly_submit_attempt` rejects double-submit (status check + FOR UPDATE lock)
- [ ] Exam page lazy-loaded
- [ ] Bundle chunk size for exam page: < 50KB gzip target

- [ ] **Manual smoke** (controller/user):

1. Sign in as student → dashboard
2. On batch day, click "Start exam" → PIN entry → instructions → "I'm ready"
3. Lands on exam page → 90 questions across 3 tabs
4. Timer counts down
5. Answer some questions, switch subjects, flag for review
6. Refresh page → resumes with same state, same remaining time
7. Switch tab (or exit fullscreen) → violation warning at 1, 2
8. 3rd violation → auto-submit
9. Try to PIN-validate again → rejected with `already_attempted`
10. Dashboard shows post-submit state
11. Dark mode at 375px — confirm all flows render

Commit smoke fixes.

---

## Self-Review

- **Spec coverage**: §1-§6 of spec each map to a task
- **Placeholders**: none
- **Type consistency**: `AttemptState`, `AttemptQuestion`, `SubmitReason`, `SubmitResult`, `EventType` declared once in their hook files
- **Concurrency**: all hot paths are RPCs; `staleTime: 0 + refetchInterval: 30_000` justified inline; idempotent saves; atomic submit
- **iOS Safari**: handled via `isFullscreenSupported()` check — exam page falls back to non-fullscreen with proctoring still active via `visibilitychange`
- **PIN re-entry for session resume**: `oly_validate_pin` allows in_progress status (handled in Phase 4a's logic — re-entry doesn't fail)

### Production-scale notes

- **Bundle**: exam page is the heaviest student-facing chunk. Target < 50KB gzipped — KaTeX shouldn't be duplicated (lazy-loaded once by MathText).
- **DB load during exam**: 6K students × auto-save per question (~80 questions) = 480K saves spread over 90 min = ~90 RPS sustained on `oly_save_answer`. Trivial for Postgres with a simple upsert.
- **Timer poll**: 6K students × 1 RPC per 30s = 200 RPS on `oly_get_attempt_state`. Trivial for STABLE RPC with no writes.
- **Submit burst**: at the 90-minute mark, ~6K students auto-submit within 5 min = ~20 RPS sustained briefly. The submit RPC does an aggregate over 90 snapshot rows — ~10ms per call.

Total estimated peak DB load: ~300 RPS, well within Medium-tier headroom.
