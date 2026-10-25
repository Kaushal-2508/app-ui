# SALCI Olympiad Phase 4b — Exam Delivery Design

**Status:** Draft v1
**Date:** 2026-05-27
**Parent doc:** [2026-05-26-olympiad-master-decomposition-design.md](./2026-05-26-olympiad-master-decomposition-design.md)
**Source:** SALCI_Olympiad_Build_Prompt2.docx (Phase 4 — exam delivery)
**Depends on:** Phase 1, 2, 3a, 3b, 4a
**Followed by:** Phase 5 (publish + dormancy)

This phase delivers the actual exam-taking interface. Students who passed PIN validation in Phase 4a now sit the exam: 90 questions across 3 chosen subjects, 90 minutes, server-side timer, three-strike proctoring, auto-submit triggers, session resume across crashes.

The whole phase is production-hardened for **6K concurrent students** per CLAUDE.md §23. The hot writes (answer save, telemetry events) go through SECURITY DEFINER RPCs to keep sub-50ms latency.

---

## 1. Scope

In:

- DB: `oly_attempts`, `oly_questions_snapshot`, `oly_answers`, `oly_attempt_events`, plus 5 SECURITY DEFINER RPCs
- Reused helpers from existing SALCI exam engine: `src/lib/fullscreen.ts`, visibility-change detection patterns
- New parallel page `OlympiadExamAttemptPage` writing to `oly_*` (NOT the existing `ExamAttemptPage`)
- Question navigation grid, subject tabs, server-clocked timer, submit confirmation
- Auto-submit triggers: timer hits 0, 3rd proctoring violation, disconnect exceeding remaining time
- Session resume: reload + relogin during exam picks up where left off
- Submit confirmation page + dashboard post-submit state
- Extension of `oly_validate_pin` RPC to enforce `already_attempted` check (the Phase 4a TODO)

Out (deferred):

- Results publish pipeline (Phase 5)
- Result PDF + certificate (Phase 5)
- 30/60-day dormancy (Phase 5)
- Stuck-attempt cleanup cron (Phase 5)
- Live admin monitoring dashboard (Phase 5 or polish)

---

## 2. Database schema (additive migration)

One migration: `supabase/migrations/<ts>_oly_phase_4b_attempts.sql`.

### 2.1 `oly_attempts`

```sql
create table public.oly_attempts (
  id uuid primary key default gen_random_uuid(),
  oly_student_id uuid not null references public.oly_students(id) on delete cascade,
  oly_batch_id uuid not null references public.oly_batches(id) on delete restrict,
  campaign_id uuid not null references public.oly_campaigns(id) on delete restrict,

  -- Timer state (server-side authoritative). Time remaining computed as:
  --   started_at + (exam_duration_seconds * interval '1 second') - now()
  started_at timestamptz not null default now(),
  exam_duration_seconds integer not null check (exam_duration_seconds > 0),

  -- Submission state
  status text not null default 'in_progress'
    check (status in ('in_progress', 'submitted', 'auto_submitted_timer', 'auto_submitted_violation', 'auto_submitted_disconnect')),
  submitted_at timestamptz,
  submit_reason text check (submit_reason in (null, 'manual', 'timer_zero', 'violations_exceeded', 'disconnect_exceeded')),

  -- Score (computed atomically at submit by the RPC; NUMERIC for ratios)
  -- We store BOTH absolute and percentage to avoid the GENERATED COLUMN trap from CLAUDE.md §9.
  total_marks_obtained numeric,
  total_max_marks numeric,
  percentage numeric(5,2),  -- normal column, computed and written by submit RPC
  subject_scores jsonb,     -- { subject_id: { correct, total, marks_obtained, marks_max } }

  -- Telemetry counters
  proctoring_violations integer not null default 0,
  section_switches integer not null default 0,

  -- Lifecycle
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One attempt per student per campaign — enforced via unique
  unique(oly_student_id)
);
create index idx_oly_attempts_student on public.oly_attempts(oly_student_id);
create index idx_oly_attempts_batch on public.oly_attempts(oly_batch_id);
create index idx_oly_attempts_campaign on public.oly_attempts(campaign_id);
create index idx_oly_attempts_status on public.oly_attempts(status);
create index idx_oly_attempts_submitted_at on public.oly_attempts(submitted_at);

create trigger oly_attempts_set_updated_at before update on public.oly_attempts
  for each row execute function public.oly_set_updated_at();
```

### 2.2 `oly_questions_snapshot`

```sql
create table public.oly_questions_snapshot (
  id uuid primary key default gen_random_uuid(),
  oly_attempt_id uuid not null references public.oly_attempts(id) on delete cascade,
  subject_id uuid not null references public.oly_subjects(id) on delete restrict,
  question_id uuid not null references public.oly_questions(id) on delete restrict,
  topic_id uuid references public.oly_topics(id) on delete set null,
  position_in_subject integer not null,  -- 1..30

  -- Frozen content (snapshotted at start; super-admin edits to oly_questions don't affect this row)
  question_text text not null,
  option_a text not null,
  option_b text not null,
  option_c text not null,
  option_d text not null,
  correct_answer char(1) not null check (correct_answer in ('A','B','C','D')),  -- used for scoring at submit

  -- Marks per question — defaults to 1, can be varied later if needed
  marks numeric not null default 1,

  unique(oly_attempt_id, subject_id, position_in_subject)
);
create index idx_oqs_attempt on public.oly_questions_snapshot(oly_attempt_id);
create index idx_oqs_subject on public.oly_questions_snapshot(subject_id);
create index idx_oqs_question on public.oly_questions_snapshot(question_id);
create index idx_oqs_topic on public.oly_questions_snapshot(topic_id);
```

### 2.3 `oly_answers`

```sql
create table public.oly_answers (
  id uuid primary key default gen_random_uuid(),
  oly_attempt_id uuid not null references public.oly_attempts(id) on delete cascade,
  oly_question_snapshot_id uuid not null references public.oly_questions_snapshot(id) on delete cascade,
  selected_answer char(1) check (selected_answer in (null, 'A','B','C','D')),
  marked_for_review boolean not null default false,
  time_spent_seconds integer not null default 0 check (time_spent_seconds >= 0),
  answered_at timestamptz,
  updated_at timestamptz not null default now(),

  unique(oly_question_snapshot_id)
);
create index idx_oly_answers_attempt on public.oly_answers(oly_attempt_id);
create index idx_oly_answers_snapshot on public.oly_answers(oly_question_snapshot_id);
create index idx_oly_answers_selected on public.oly_answers(selected_answer);

create trigger oly_answers_set_updated_at before update on public.oly_answers
  for each row execute function public.oly_set_updated_at();
```

### 2.4 `oly_attempt_events` (telemetry)

```sql
create table public.oly_attempt_events (
  id uuid primary key default gen_random_uuid(),
  oly_attempt_id uuid not null references public.oly_attempts(id) on delete cascade,
  event_type text not null check (event_type in (
    'section_switch', 'flag', 'unflag',
    'proctoring_violation_fullscreen', 'proctoring_violation_tab_switch',
    'disconnect', 'reconnect', 'auto_save'
  )),
  payload jsonb,
  event_at timestamptz not null default now()
);
create index idx_oae_attempt on public.oly_attempt_events(oly_attempt_id);
create index idx_oae_event_type on public.oly_attempt_events(event_type);
create index idx_oae_event_at on public.oly_attempt_events(event_at);
```

### 2.5 RLS — student writes own attempt + reads own data

```sql
alter table public.oly_attempts enable row level security;
create policy "super_admin all" on public.oly_attempts for all
  using (public.is_super_admin(auth.uid())) with check (public.is_super_admin(auth.uid()));
-- Student own: SELECT + INSERT + UPDATE (UPDATE gated to in_progress status by RPC body, not by RLS — RLS is layer 1, RPC is layer 2)
create policy "student all own" on public.oly_attempts for all
  using (public.oly_student_can_read(auth.uid(), oly_student_id))
  with check (public.oly_student_can_read(auth.uid(), oly_student_id));
-- School admin SELECT only (live monitoring later)
create policy "school_admin SELECT own school" on public.oly_attempts for select
  using (exists(
    select 1 from public.oly_students s
     where s.id = oly_student_id
       and public.oly_is_school_admin_for(auth.uid(), s.oly_school_id)
  ));

alter table public.oly_questions_snapshot enable row level security;
create policy "super_admin all" on public.oly_questions_snapshot for all
  using (public.is_super_admin(auth.uid())) with check (public.is_super_admin(auth.uid()));
create policy "student SELECT own" on public.oly_questions_snapshot for select
  using (exists(
    select 1 from public.oly_attempts a
     where a.id = oly_attempt_id
       and public.oly_student_can_read(auth.uid(), a.oly_student_id)
  ));
-- School admin SELECT for monitoring
create policy "school_admin SELECT own school" on public.oly_questions_snapshot for select
  using (exists(
    select 1 from public.oly_attempts a
      join public.oly_students s on s.id = a.oly_student_id
     where a.id = oly_attempt_id
       and public.oly_is_school_admin_for(auth.uid(), s.oly_school_id)
  ));

alter table public.oly_answers enable row level security;
create policy "super_admin all" on public.oly_answers for all
  using (public.is_super_admin(auth.uid())) with check (public.is_super_admin(auth.uid()));
create policy "student all own" on public.oly_answers for all
  using (exists(
    select 1 from public.oly_attempts a
     where a.id = oly_attempt_id
       and public.oly_student_can_read(auth.uid(), a.oly_student_id)
  ))
  with check (exists(
    select 1 from public.oly_attempts a
     where a.id = oly_attempt_id
       and public.oly_student_can_read(auth.uid(), a.oly_student_id)
  ));

alter table public.oly_attempt_events enable row level security;
create policy "super_admin all" on public.oly_attempt_events for all
  using (public.is_super_admin(auth.uid())) with check (public.is_super_admin(auth.uid()));
create policy "student INSERT own" on public.oly_attempt_events for insert
  with check (exists(
    select 1 from public.oly_attempts a
     where a.id = oly_attempt_id
       and public.oly_student_can_read(auth.uid(), a.oly_student_id)
  ));
-- Note: students cannot SELECT events; only super_admin + school_admin (for forensics)
create policy "school_admin SELECT own school" on public.oly_attempt_events for select
  using (exists(
    select 1 from public.oly_attempts a
      join public.oly_students s on s.id = a.oly_student_id
     where a.id = oly_attempt_id
       and public.oly_is_school_admin_for(auth.uid(), s.oly_school_id)
  ));
```

### 2.6 RPCs

All RPCs use `SECURITY DEFINER SET search_path = public` to avoid RLS round-trip overhead and ensure consistent behavior. Each authorizes via `auth.uid()` lookup.

#### `oly_start_attempt()`

Algorithm:
1. Resolve current user → `oly_students` row
2. Check the student has a successful PIN entry in the last 5 minutes via `oly_pin_attempt_log` (gates the start)
3. Check no existing `oly_attempts` row (uniqueness — return existing attempt_id if it does exist, for idempotency on retry)
4. Look up campaign's `exam_duration_minutes` and `questions_per_subject`
5. For each of the student's 3 chosen subjects:
   - SELECT N=30 random active questions for (subject_id, grade_level_id) — `ORDER BY random() LIMIT 30`
   - If fewer than 30 active questions exist, raise error (super admin must populate bank first)
6. Bulk INSERT `oly_questions_snapshot` rows (90 total) with frozen content
7. INSERT `oly_attempts` row with `started_at = now()`, `exam_duration_seconds = duration_minutes * 60`
8. Return `{ attempt_id, exam_duration_seconds, started_at, subjects: [{ id, name, snapshot_question_ids: [...] }] }`

The whole thing is one transaction. If the random sample query is slow at scale, the snapshot insert + attempt insert + per-subject SELECT happen atomically.

#### `oly_save_answer(attempt_id, snapshot_id, selected, marked, time_spent)`

Idempotent upsert. Algorithm:
1. Verify caller owns the attempt (RLS layer 1 + body check layer 2)
2. Verify attempt status is `in_progress`
3. Verify snapshot belongs to the attempt
4. UPSERT into `oly_answers` ON CONFLICT(oly_question_snapshot_id) DO UPDATE — preserves the unique constraint
5. Returns `{ ok: true }` (lightweight — caller doesn't need echoed values)

This is the hottest write path. ~80 saves per student × 6K students = 480K saves spread over 90 minutes = ~90 saves/sec sustained. Easy for Postgres with a simple upsert.

#### `oly_submit_attempt(attempt_id, reason)`

Atomic submit + score. Algorithm:
1. Verify caller owns the attempt + status is still `in_progress`
2. Compute scores via single aggregate query:
   ```sql
   select s.subject_id,
          count(*) filter (where a.selected_answer = s.correct_answer) as correct,
          count(*) as total,
          sum(case when a.selected_answer = s.correct_answer then s.marks else 0 end) as marks_obtained,
          sum(s.marks) as marks_max
     from oly_questions_snapshot s
     left join oly_answers a on a.oly_question_snapshot_id = s.id
    where s.oly_attempt_id = p_attempt_id
    group by s.subject_id;
   ```
3. Update `oly_attempts`:
   - `status` = mapping from reason: manual→submitted, timer_zero→auto_submitted_timer, violations_exceeded→auto_submitted_violation, disconnect_exceeded→auto_submitted_disconnect
   - `submitted_at = now()`
   - `submit_reason = reason`
   - `total_marks_obtained`, `total_max_marks`, `percentage`, `subject_scores`
4. Return `{ ok: true, total_marks: ..., total_max: ..., percentage: ... }`

Server-side enforces:
- Reject if `status != 'in_progress'` (prevents double-submit)
- Reject if `now() < started_at + (exam_duration_seconds + 60) * interval '1 second'` — wait, that's wrong. We want to ALLOW submit any time within the duration. The check should be: if `reason = 'manual'`, allow regardless of timer; if `reason = 'timer_zero'`, allow only if `now() >= started_at + duration`. Defense-in-depth at the server.

#### `oly_record_event(attempt_id, event_type, payload)`

Light insert. Algorithm:
1. Verify caller owns the attempt + status is `in_progress` (no events after submit)
2. INSERT into `oly_attempt_events`
3. If `event_type` starts with `proctoring_violation_*`, ALSO increment `oly_attempts.proctoring_violations`
4. If `event_type = 'section_switch'`, ALSO increment `oly_attempts.section_switches`
5. Return `{ ok: true, total_violations: <new value> }` so client knows when to auto-submit

The violations increment is atomic via a single UPDATE.

#### `oly_get_attempt_state(attempt_id)`

Read RPC. Algorithm:
1. Verify caller owns the attempt
2. SELECT the attempt row + computed `remaining_seconds = greatest(0, exam_duration_seconds - extract(epoch from (now() - started_at)))`
3. Return `{ attempt, remaining_seconds, expired: boolean }`

Client polls this every 30s during the exam to:
- Sync the client-side timer to server clock (handles drift)
- Detect timer expiry (auto-submit when `expired=true`)

#### `oly_get_attempt_questions(attempt_id)`

Read RPC for the initial question load. Returns 90 questions grouped by subject with positions. Called once at exam start (after `oly_start_attempt`).

```sql
select
  s.subject_id, s.position_in_subject, s.id as snapshot_id,
  s.question_text, s.option_a, s.option_b, s.option_c, s.option_d, s.marks,
  -- Existing answer (for session resume)
  a.selected_answer, a.marked_for_review, a.time_spent_seconds
from oly_questions_snapshot s
left join oly_answers a on a.oly_question_snapshot_id = s.id
where s.oly_attempt_id = p_attempt_id
order by s.subject_id, s.position_in_subject;
```

For session resume, the existing answers come back too — no separate "fetch my answers" call.

### 2.7 Update `oly_validate_pin` to enforce `already_attempted`

The Phase 4a RPC has a TODO for the `oly_attempts` check. Phase 4b adds it:

```sql
-- After the school_status check, before the success branch:
select status into v_attempt_status
  from public.oly_attempts where oly_student_id = v_student.id;
if v_attempt_status is not null and v_attempt_status != 'in_progress' then
  insert into public.oly_pin_attempt_log (oly_school_id, oly_student_id, attempted_pin, ip_address, user_agent, outcome, resolved_batch_id)
    values (v_student.oly_school_id, v_student.id, v_clean_pin, p_ip, p_user_agent, 'already_attempted', v_resolved_batch_id);
  return jsonb_build_object('ok', false, 'reason', 'already_attempted');
end if;
-- If status = 'in_progress', allow PIN re-entry for session resume (no error)
```

---

## 3. Frontend — `OlympiadExamAttemptPage`

Parallel page to existing `src/pages/student/ExamAttemptPage.tsx`. Same architectural patterns (fullscreen, timer, navigation grid) but writes to `oly_*` via the new RPCs.

### 3.1 Page state machine

```
mount → fetch attempt state → 
   if no attempt: call oly_start_attempt → fetch questions
   if attempt exists with status='in_progress': fetch questions for resume
   if attempt exists with other status: redirect to /student/olympiad/exam/submitted
   if no PIN success in last 5 min: redirect to /student/olympiad/pin-entry

→ activate fullscreen (silent fallback on iOS)
→ render exam UI
→ poll timer every 30s
→ on timer 0 → auto-submit
→ on visibility-change or fullscreen-exit → record violation; if 3rd → auto-submit
→ on submit click → confirm dialog → call oly_submit_attempt → /student/olympiad/exam/submitted
```

### 3.2 Layout

- **Top bar** (sticky):
  - Subject tabs: "Math (12/30) | Science (18/30) | Hindi (5/30)" — current subject highlighted
  - Single timer (mm:ss) — red < 5 min, amber < 15 min
  - Submit button (right)

- **Left panel** (collapsed on mobile, drawer): question navigation grid for the current subject. 30 cells; each cell colored:
  - Gray: not visited
  - White (with checkmark): answered
  - Amber: marked for review
  - Both checkmark + amber: answered + flagged

- **Main area**: current question + 4 options (radio buttons) + "Mark for review" toggle + "Save & Next" button. KaTeX rendered via existing `MathText` per CLAUDE.md §8.

- **Bottom bar** (mobile): prev | question count | next

### 3.3 Hooks

- `useOlympiadStartAttempt()` — mutation calling `oly_start_attempt` RPC; idempotent (returns existing attempt on retry)
- `useOlympiadAttemptState(attemptId)` — query with `refetchInterval: 30_000` — comment justifies the polling (timer drift + auto-submit trigger)
- `useOlympiadAttemptQuestions(attemptId)` — query, `staleTime: Infinity` — questions are immutable after start
- `useOlympiadSaveAnswer()` — mutation with debounce (500ms per question); writes to local state immediately, RPC in background
- `useOlympiadSubmitAttempt()` — mutation, no retry; success redirects
- `useOlympiadRecordEvent()` — fire-and-forget telemetry; failures logged but don't block UX

### 3.4 Auto-submit triggers

**Timer:**
- Client maintains a local countdown synced from server every 30s
- Local tick: every 1s, decrement local counter
- On server poll: replace local counter with server's `remaining_seconds` (cancels client clock drift)
- On counter ≤ 0: call `oly_submit_attempt(reason='timer_zero')`
- Server also enforces in submit RPC

**Proctoring violations:**
- `visibilitychange` listener: when document hidden, record `proctoring_violation_tab_switch`
- `fullscreenchange` listener: when fullscreen exited, record `proctoring_violation_fullscreen`
- Server returns updated violation count; client warns at 1, warns at 2, auto-submits at 3
- Use `src/lib/fullscreen.ts` per CLAUDE.md §20a — iOS Safari is silently no-op

**Disconnect:**
- `online`/`offline` event listeners
- On offline: show banner "You're offline — your timer keeps running"
- On reconnect: re-poll attempt state; if `expired=true`, submit with reason='disconnect_exceeded'

### 3.5 Answer save semantics

- User clicks an option → local state updates immediately (`useState`)
- Debounced 500ms → call `oly_save_answer` RPC
- On RPC success: no UI feedback (idempotent — silently durable)
- On RPC failure: queue retry with exponential backoff (max 3 retries); show toast only if all retries fail

This pattern lets the student keep clicking through questions even if a save is mid-flight. Each save is keyed on snapshot_id, so they don't collide.

### 3.6 Mobile / iOS fullscreen

Per CLAUDE.md §20a (iPhone Safari fullscreen unsupported): on iOS, the page does NOT attempt to enter fullscreen. Instead, it shows a warning banner "iOS does not support fullscreen for exams — please do not switch apps or tabs." Proctoring violations still trigger via `visibilitychange`.

### 3.7 KaTeX rendering

Question text + 4 options use `MathText` from `@/components/ui/math-text` (CLAUDE.md §8 student-facing component). Inline `$...$` and block `$$...$$` LaTeX both supported.

---

## 4. Submit page + dashboard post-submit

### `/student/olympiad/exam/submitted`

Simple page:
- Big check icon
- "Exam submitted successfully"
- "Your results will be published soon by your school"
- Button to return to dashboard

### Dashboard updates (modify Phase 4a's `OlympiadStudentDashboardPage`)

When `useOlympiadStudentDashboard` returns an attempt with `status != 'in_progress'`:
- Hide the "Start exam" button
- Show "Exam submitted" status with timestamp
- Show "Awaiting results" badge
- Keep study material section visible

---

## 5. Acceptance criteria

- Student passes PIN entry (Phase 4a) → clicks "I'm Ready" → lands on exam page → 90 questions shown across 3 subject tabs
- Timer counts down from server-set duration
- Student answers, marks for review, switches subjects — all auto-saved
- Reload/relogin during exam picks up where left off with correct remaining time
- 3 proctoring violations auto-submit with `reason='violations_exceeded'`
- Timer reaching 0 auto-submits with `reason='timer_zero'`
- Manual submit shows confirmation dialog and atomically computes scores
- Submitted attempts cannot be re-attempted (`oly_validate_pin` rejects with `already_attempted`)
- Submission page renders correctly
- Dashboard shows post-submit state
- All RPCs are SECURITY DEFINER with explicit authorization
- All hooks have explicit `staleTime`
- The exam page chunk is lazy-loaded (no entry into main bundle)
- 6K simultaneous answer saves do not exceed DB pool — measured via `oly_save_answer` p95 < 100ms
- All FKs indexed in migration
- §5a contract passes

---

## 6. Risks and open items

- **Random question selection performance**: `ORDER BY random() LIMIT 30` over `oly_questions` may scan large bank. At 1000+ questions per subject×grade, consider `TABLESAMPLE BERNOULLI(5)` followed by `ORDER BY random() LIMIT 30`. Optimize only if start-attempt RPC > 200ms.
- **Concurrent first PIN entries**: race resolved by the atomic UPDATE pattern from Phase 4a.
- **Submit RPC score correctness**: relies on `oly_answers.selected_answer = oly_questions_snapshot.correct_answer`. Since snapshot is frozen at start, super-admin edits to the question bank don't affect scoring.
- **Telemetry volume**: `oly_attempt_events` could grow to ~500K rows per campaign (6K students × ~80 events each). Phase 5 dormancy purge handles it.
- **Page bundle size**: question UI + KaTeX may push the lazy chunk to ~40-50KB gzipped. Verify in build and consider chunk splitting if it exceeds.
- **Existing `ExamAttemptPage` reuse**: a pure-import shared component (e.g. `<ExamShell>`) would let both regular SALCI exams and Olympiad share UI. Phase 4b ships a parallel page; refactor to shared shell is Phase 5+ if it surfaces as duplication pain.
- **Stuck attempts (disconnected forever)**: Phase 5 cron sweeps `oly_attempts` where `started_at + duration < now() - 1 hour` AND status='in_progress' → auto-submit with reason='disconnect_exceeded'.
- **Page refresh during exam**: full reload triggers re-mount of OlympiadExamAttemptPage. Hook fetches state → finds attempt → calls `oly_get_attempt_questions` → resume. Total resume time should be < 2s.
- **Multi-tab attack**: a student opening the exam in two tabs would have two timers ticking on the same `oly_attempts` row. Both call `oly_save_answer` on the same snapshot; idempotent so no corruption. Server timer is single source. Acceptable.
