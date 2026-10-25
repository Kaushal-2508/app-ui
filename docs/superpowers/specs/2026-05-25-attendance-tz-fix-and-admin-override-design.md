# Attendance — Timezone Fix, Instant Materialization, Admin Override

**Date:** 2026-05-25
**Author:** Claude (with tushar@salci.in)
**Status:** Approved for implementation
**Scope:** `staff_attendance_records`, `attendance_settings`, `tt_substitutions`, school-admin Attendance page

## Problem

Three compounding gaps on the school-admin Attendance page:

1. **Teachers never auto-marked absent during school hours.** All teachers sit on "Not marked" indefinitely. Root cause: `tt_run_attendance_cron_pass()` compares **UTC** time-of-day to `staff_check_in_time` which is stored as **institution-local** wall-clock (IST for SALCI). For an `08:00 IST` cutoff, the cron only fires after `08:00 UTC = 13:30 IST` — i.e. after school's done. The Salci National School DB confirms it: 211 timetable slots scheduled for today, 0 `staff_attendance_records`, 0 `tt_substitutions` rows, and 16 cron runs in the last 4 hours that all hit `CONTINUE`.
2. **Substitutions tab always says "All covered".** Direct downstream of (1) — no absent rows means `tt_create_pending_subs_for_absent_staff()` has nothing to insert. The tab and its query (`usePendingSubstitutions`) work correctly; they're just looking at an empty source.
3. **Even when the cron does work, admins wait up to 15 min** between cutoff and rows appearing — and have no way to fix a wrongly auto-marked teacher who actually showed up.

The user requirement: "if a teacher did not check in, that user gets absent marked automatically; but also give admin power to mark the attendance even after absent marked."

## Goals

- Auto-mark absent fires correctly at `check_in_time + grace` in **institution-local time**.
- School admin landing on the Attendance page past cutoff sees the truth **within ~1–2s**, not 15 min later.
- School admin can manually mark any teacher Present / Late / Absent / On-leave / Clear at any time, even if the row was auto-marked.
- Marking a previously-absent teacher Present/Late automatically cancels their pending substitutions (already supported by an existing trigger — verify it stays wired).
- Zero change to: existing check-in flow, existing manual sub-assignment flow, student attendance, holidays/leave, coordinator pool semantics.

## Non-Goals

- Per-period absence (teacher present at start, leaves mid-day). Separate future feature.
- Backfilling absent rows for past days (would distort historical reports).
- Bulk admin actions (no signal needed).
- Multi-timezone support beyond the column hook (SALCI is India-only today — the column defaults to `Asia/Kolkata` so nothing else changes).
- Auto-substitute assignment (sub-pool ranking) — out of scope; admins continue to pick manually.

## Design

### Part A — Fix the cron timezone bug

**A1. Add `institutions.timezone`.**

```sql
ALTER TABLE public.institutions
  ADD COLUMN timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata';
```

Single column. Default covers every existing institution (all Indian). Future non-IST schools change the column; nothing else.

**A2. Extract per-institution body into a reusable function.**

```sql
CREATE OR REPLACE FUNCTION public.tt_run_attendance_pass_for_institution(p_institution_id UUID)
RETURNS TABLE(institution_id UUID, staff_marked INT, subs_generated INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_today DATE := CURRENT_DATE;
  v_settings RECORD;
  v_tz TEXT;
  v_marked INT := 0;
  v_subs   INT := 0;
BEGIN
  -- Caller authorization: super_admin, super_school_admin, school_admin,
  -- coordinator, or the cron job itself (no auth context).
  IF auth.uid() IS NOT NULL AND NOT (
        public.has_role(auth.uid(), 'super_admin'::app_role)
     OR public.has_role(auth.uid(), 'super_school_admin'::app_role)
     OR EXISTS (
          SELECT 1 FROM public.user_roles ur
          WHERE ur.user_id = auth.uid()
            AND ur.institution_id = p_institution_id
            AND ur.role IN ('school_admin'::app_role, 'coordinator'::app_role)
        )
  ) THEN
    RAISE EXCEPTION 'not authorized to run attendance pass for institution %', p_institution_id
      USING ERRCODE = '42501';
  END IF;

  SELECT s.staff_check_in_time, s.staff_late_check_in_allowed,
         s.staff_late_grace_minutes, s.staff_substitution_enabled,
         i.timezone
  INTO v_settings
  FROM public.attendance_settings s
  JOIN public.institutions i ON i.id = s.institution_id
  WHERE s.institution_id = p_institution_id;

  IF NOT FOUND THEN
    RETURN; -- no settings row → nothing to do
  END IF;

  v_tz := COALESCE(v_settings.timezone, 'Asia/Kolkata');

  -- Cutoff check in INSTITUTION-LOCAL time-of-day.
  IF (now() AT TIME ZONE v_tz)::time
       < (v_settings.staff_check_in_time
          + CASE WHEN v_settings.staff_late_check_in_allowed
                 THEN make_interval(mins => v_settings.staff_late_grace_minutes)
                 ELSE INTERVAL '0' END)
  THEN
    institution_id := p_institution_id; staff_marked := 0; subs_generated := 0;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Holiday short-circuit (unchanged).
  IF EXISTS (
    SELECT 1 FROM public.cal_events e
    WHERE e.institution_id = p_institution_id
      AND e.kind = 'holiday'
      AND v_today BETWEEN e.starts_on AND e.ends_on
  ) THEN
    institution_id := p_institution_id; staff_marked := 0; subs_generated := 0;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Auto-mark absent (always, regardless of substitution toggle).
  WITH staff_today AS (
    SELECT DISTINCT s.teacher_id AS staff_id
    FROM public.tt_slots s
    WHERE s.institution_id = p_institution_id
      AND s.day            = public.tt_dow_to_text(v_today)
      AND s.teacher_id IS NOT NULL
  ),
  inserted AS (
    INSERT INTO public.staff_attendance_records
      (institution_id, staff_id, date, status, auto_marked_absent)
    SELECT p_institution_id, st.staff_id, v_today, 'absent', TRUE
    FROM staff_today st
    WHERE NOT EXISTS (
      SELECT 1 FROM public.staff_attendance_records sa
      WHERE sa.staff_id = st.staff_id AND sa.date = v_today
    )
    RETURNING staff_id
  )
  SELECT COUNT(*)::INT INTO v_marked FROM inserted;

  -- Subs only if the institution opted in.
  IF v_settings.staff_substitution_enabled THEN
    v_subs := public.tt_create_pending_subs_for_absent_staff(p_institution_id, v_today);
  END IF;

  institution_id := p_institution_id;
  staff_marked   := v_marked;
  subs_generated := v_subs;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.tt_run_attendance_pass_for_institution(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tt_run_attendance_pass_for_institution(UUID) TO authenticated;
```

**A3. Rewrite `tt_run_attendance_cron_pass()` to delegate.**

```sql
CREATE OR REPLACE FUNCTION public.tt_run_attendance_cron_pass()
RETURNS TABLE(institution_id UUID, staff_marked INT, subs_generated INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE r RECORD; BEGIN
  FOR r IN SELECT s.institution_id FROM public.attendance_settings s LOOP
    RETURN QUERY SELECT * FROM public.tt_run_attendance_pass_for_institution(r.institution_id);
  END LOOP;
END; $$;
```

The cron continues firing every 15 min as a safety net (`*/15 * * * *`). It's now a fallback — the page-view RPC kick (Part B) handles the live-admin case.

**A4. Backfill once after deploy.** Call `tt_run_attendance_cron_pass()` once manually so today's absent rows materialize without waiting for the next tick.

### Part B — Eliminate the lag

**B1. Client mutation `useRunAttendancePass(institutionId)`.**

```ts
// src/hooks/useRunAttendancePass.ts
export function useRunAttendancePass() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (institutionId: string) => {
      const { data, error } = await supabase.rpc(
        "tt_run_attendance_pass_for_institution" as never,
        { p_institution_id: institutionId },
      );
      if (error) throw error;
      return data as { institution_id: string; staff_marked: number; subs_generated: number }[];
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["attendance-list"] });
      qc.invalidateQueries({ queryKey: ["substitutions"] });
      qc.invalidateQueries({ queryKey: ["staff-attendance"] });
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't sync attendance.", context: "runAttendancePass" }),
  });
}
```

**B2. Auto-kick from `SchoolAttendancePage`.**

On mount, if `institutionId` resolved AND it's past cutoff in institution-local time AND a `sessionStorage` flag for `salci:att-pass:{institutionId}:{YYYY-MM-DD}` is unset → fire the mutation once and set the flag. Local cutoff check uses the same fields already loaded by `useEffectiveAttendanceSettings`.

```ts
useEffect(() => {
  if (!institutionId || !settings) return;
  const key = `salci:att-pass:${institutionId}:${todayStr()}`;
  if (sessionStorage.getItem(key)) return;
  if (!isPastCutoff(settings)) return; // helper uses settings.staff_check_in_time + grace, local now
  sessionStorage.setItem(key, "1");    // set BEFORE the call so re-renders don't double-fire
  runPass.mutate(institutionId);
}, [institutionId, settings, runPass]);
```

Failure path: if the mutation errors, we leave the sessionStorage flag set (don't retry-storm) and the cron's 15-min fallback eventually closes the gap. The `toastError` surfaces the failure.

**B3. Client-side "syncing" preview in `useScopedStaffAttendance`.**

The hook receives `settings` and computes `isPastCutoff` locally. For rows with `status === null` past cutoff it returns `derivedStatus: "absent" as const, derived: true`. The list panel renders an `Absent · syncing` chip during the brief window between RPC start and DB roundtrip. Once the RPC returns and the query invalidates, real rows replace the derived state. **The DB write remains the source of truth — derived state never leaks into mutations.**

### Part C — Admin override

**C1. Mutation.**

```ts
// src/hooks/useStaffAttendance.ts (additive)
export function useUpsertStaffAttendance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      institutionId: string;
      staffId: string;
      status: StaffAttendanceStatus | null; // null = clear (delete row)
      remarks?: string;
    }) => {
      const today = todayStr();
      if (params.status === null) {
        const { error } = await supabase
          .from("staff_attendance_records" as never)
          .delete()
          .eq("staff_id", params.staffId)
          .eq("date", today);
        if (error) throw error;
        return null;
      }
      const payload = {
        institution_id: params.institutionId,
        staff_id: params.staffId,
        date: today,
        status: params.status,
        auto_marked_absent: false,
        check_in_at: (params.status === "present" || params.status === "late")
          ? new Date().toISOString() : null,
        remarks: params.remarks ?? null,
      };
      const { data, error } = await supabase
        .from("staff_attendance_records" as never)
        .upsert(payload, { onConflict: "staff_id,date" })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["attendance-list"] });
      qc.invalidateQueries({ queryKey: ["substitutions"] });
      qc.invalidateQueries({ queryKey: ["staff-attendance"] });
      toast.success("Attendance updated");
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't update attendance.", context: "upsertStaffAttendance" }),
  });
}
```

**C2. Per-row action menu.**

In `AttendanceListPanel`, when `kind="teachers"` AND the viewer is `school_admin` / `super_school_admin` / `coordinator`, append a kebab DropdownMenu to each row's trailing slot with:

- Mark Present
- Mark Late
- Mark Absent
- Mark On Leave
- Clear status

Rows that were auto-marked then admin-overridden show a subtle "Overridden" pill: heuristic is `auto_marked_absent=false AND updated_at > created_at + interval 1s` (the cron inserts and never updates; an admin upsert against an existing auto row flips `auto_marked_absent` to false AND bumps `updated_at`). Cosmetic only; if this turns out to be wrong it has no behavioural impact.

**C3. RLS check.**

Verify `staff_attendance_records` has an UPDATE policy that admits `school_admin / super_school_admin / coordinator` writing rows where `institution_id = get_user_institution(auth.uid())`. If missing, add it in the same migration. The DELETE policy needs the same shape.

**C4. Sub auto-cancellation.**

Existing trigger `tt_substitutions_cancel_on_late_checkin_trg` fires on `INSERT OR UPDATE OF status` and cancels still-pending subs for the teacher's future periods today when status flips to present/late. No new code — just keep it.

## Data Flow

```
School admin opens /attendance
  ├─ useScopedStaffAttendance fetches today's rows; derives "absent (syncing)" for null past cutoff
  ├─ SchoolAttendancePage useEffect: past cutoff && !sessionFlag → rpc('tt_run_attendance_pass_for_institution')
  │     ├─ DB inserts absent rows for staff with no row + tt_slots today
  │     └─ DB inserts pending tt_substitutions for absent teachers' slots (if sub flag on)
  ├─ Mutation onSuccess invalidates queries → real rows replace derived
  └─ Substitutions tab shows pending subs

Admin clicks kebab > Mark Present on a row:
  └─ useUpsertStaffAttendance upserts row (auto_marked_absent=false, check_in_at=now())
        └─ trigger tt_substitutions_cancel_on_late_checkin_trg cancels pending subs for that teacher

Cron tick every 15 min (fallback):
  └─ tt_run_attendance_cron_pass loops institutions, calls per-inst RPC
        └─ idempotent — UNIQUE(staff_id, date) + UNIQUE(slot_id, date)
```

## Error Handling

- RPC failure → `toastError` with context `runAttendancePass`, sessionStorage flag stays set so we don't retry-storm. Cron fills the gap.
- UPSERT failure → `toastError` with context `upsertStaffAttendance`. Row stays in previous state.
- RLS rejection on RPC for a non-admin viewer (defense-in-depth) → 42501, surfaced as "You don't have permission…" via `errorMessages`.
- Trigger failure on sub cancellation is logged but doesn't block the override.

## Testing

- **DB unit (manual):** call `tt_run_attendance_pass_for_institution(<salci_id>)` from SQL editor: returns one row `(institution_id, staff_marked=N, subs_generated=M)`. Re-call: returns `(.., 0, 0)` (idempotent).
- **Timezone:** verify cron pass returns `staff_marked=0` when called before local cutoff and non-zero after.
- **Override:** mark a teacher Present via the kebab; verify their `tt_substitutions` pending rows for periods after `now()+5min` flip to `cancelled`.
- **Clear:** mark a teacher Present, then Clear; row vanishes; next cron tick or page-view re-creates the absent row.
- **Negative auth:** student account calling the RPC gets 42501.
- **Visual:** at 375 px width, kebab is reachable, "Absent · syncing" pill renders without layout shift, action menu items are tappable.
- **Production smoke:** after deploy + backfill, today's Salci National School Teacher Attendance tab shows ~36 Absent rows (the count of distinct teachers in `tt_slots` for Monday), and Substitutions tab shows 211 pending sub rows.

## Production Readiness (§5a)

- `npx tsc --noEmit` → 0
- `npx eslint <touched paths>` → 0 new errors
- `npx vite build` → 0
- No new `select("*")`, no missing `staleTime`, no `useEffect` without cleanup (the kickoff effect's only side-effect is sessionStorage + a mutation call — no subscriptions to clean up).

## Rollout

1. Push migration to production.
2. Run `SELECT * FROM public.tt_run_attendance_cron_pass();` once via SQL editor to backfill today.
3. Verify Salci National School Teacher Attendance + Substitutions tabs populate.
4. Merge frontend PR.

## Risks

- **Trigger cascade depth.** Cancelling many subs when an admin marks an entire grade Present → existing trigger handles each row independently; no recursion. Verified by reading current trigger fn.
- **Concurrent admin clicks.** Two admins overriding the same teacher race on UPSERT; the last write wins (by row UPDATE timestamp). Acceptable — same teacher, manual override.
- **Timezone column not honored elsewhere.** If a future feature reads `institutions.timezone`, great. For now nothing else does, so adding it is risk-free.
- **Cron drops to delegated RPC.** Behavior is identical — the per-inst function does exactly what the inline loop body did, plus the timezone fix and the auto-mark/sub split.
