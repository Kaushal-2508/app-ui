# Olympiad Cash-Enroll Roster Form + Student Personal-Details Write-Back — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the existing-SALCI-school Olympiad cash-enroll form into Class → Section → Student dropdowns that link each enrollment to a real `profiles` row, and persist the collected DOB + guardian contact to a new `student_personal_details` table surfaced read-only on the student Profile page.

**Architecture:** New DB table (`student_personal_details`) + roster RPC (`oly_list_salci_roster_for_grade`) + a one-line fix to the latent-broken `oly_lookup_salci_student`. The `oly-cash-enroll` edge function sets `oly_students.profile_id` and upserts the details (service role, bypasses RLS). The frontend `CashEnrollSheet` splits into a roster-driven sheet (existing schools) and the unchanged manual sheet (net-new schools); the student Profile page gains a read-only details card.

**Tech Stack:** Supabase (Postgres + RLS + plpgsql + Deno edge fn), React 18 + TypeScript, TanStack Query v5, shadcn/ui (`SearchableSelect`, `Select`), Vite.

**Branch:** `feat/olympiad-cash-enroll-roster-writeback` (already created off `main`).

---

## Testing approach (read first)

This repo has **no unit-test runner**. The production-readiness gate (CLAUDE.md §5a) is the test contract:

- `npx tsc --noEmit` → exit 0
- `npx eslint <changed paths>` → zero new errors (no `any`, no `// eslint-disable`)
- `npx vite build` → exit 0

So each code task's "verify" step runs these. Migration tasks are verified by careful SQL self-review (read the file) — **do not push migrations to the production project** (`gyymkgohcijeksmrzuyw`); application happens via the user's deploy pipeline. To keep local `tsc`/`build` green without DB access, **Task 4 hand-adds the new table + RPC to `src/integrations/supabase/types.ts`** (a later `supabase gen types` regeneration produces identical output).

**Branch-guard:** before every `git commit`, run `git symbolic-ref --short HEAD` and confirm it prints `feat/olympiad-cash-enroll-roster-writeback`.

---

## File Structure

**Create:**
- `supabase/migrations/20260606120000_student_personal_details.sql` — table + RLS helpers + policies + trigger.
- `supabase/migrations/20260606120100_oly_list_salci_roster_for_grade.sql` — roster RPC.
- `supabase/migrations/20260606120200_fix_oly_lookup_salci_student_dob.sql` — fix latent crash.
- `src/hooks/olympiad/useOlympiadGradeSubjects.ts` — all active Olympiad subjects for a grade.
- `src/hooks/olympiad/useOlympiadSalciRoster.ts` — calls the roster RPC.
- `src/hooks/useStudentPersonalDetails.ts` — current student's stored details.

**Modify:**
- `src/integrations/supabase/types.ts` — add `student_personal_details` Tables block + `oly_list_salci_roster_for_grade` Functions entry.
- `supabase/functions/oly-cash-enroll/index.ts` — `profile_id` link + dup-guard + details upsert.
- `src/hooks/olympiad/useOlympiadCashEnroll.ts` — add `profile_id` to input; invalidate roster.
- `src/hooks/olympiad/useOlympiadAssignedClasses.ts` — add `grade_number`.
- `src/hooks/useProfileData.ts` — surface `admission_number` + `roll_number`.
- `src/components/olympiad/teacher/CashEnrollSheet.tsx` — split into roster + manual sheets.
- `src/pages/teacher/olympiad/OlympiadTeacherClassPage.tsx` — fetch + pass `isExistingSalciSchool`.
- `src/pages/ProfilePage.tsx` — student "Personal & guardian details" card.

---

## Task 1: Migration — `student_personal_details` table + RLS

**Files:**
- Create: `supabase/migrations/20260606120000_student_personal_details.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Student personal & guardian details (1:1 with a student profile).
-- SALCI profiles store no DOB or guardian contact; this table holds them so
-- data collected during Olympiad cash-enroll surfaces in the student portal.
-- School-managed: written by service-role edge fn (and future admin UI),
-- read by the student themselves + institution staff. Read-only to students.

create table public.student_personal_details (
  profile_id     uuid primary key references public.profiles(id) on delete cascade,
  date_of_birth  date,
  guardian_name  text,
  guardian_phone text,
  guardian_email text,
  updated_at     timestamptz not null default now(),
  updated_by     uuid references public.profiles(id) on delete set null
);

-- FK index (profile_id is the PK, already indexed). Index the author FK (§23).
create index idx_student_personal_details_updated_by
  on public.student_personal_details(updated_by);

-- updated_at maintenance (repo-standard trigger fn used by 79 other tables).
create trigger student_personal_details_set_updated_at
  before update on public.student_personal_details
  for each row execute function public.update_updated_at_column();

-- ── SECURITY DEFINER helpers (no inline cross-table EXISTS in policies — §23) ──

create or replace function public.can_view_student_details(_profile_id uuid, _viewer uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select
    _viewer = _profile_id
    or public.is_super_admin(_viewer)
    or (
      exists (
        select 1 from public.profiles stu
         where stu.id = _profile_id
           and stu.institution_id = public.get_user_institution(_viewer)
      )
      and (
        public.has_role(_viewer, 'school_admin')
        or public.has_role(_viewer, 'super_school_admin')
        or public.has_role(_viewer, 'coordinator')
        or public.has_role(_viewer, 'teacher')
      )
    );
$$;

create or replace function public.can_write_student_details(_profile_id uuid, _writer uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select
    public.is_super_admin(_writer)
    or (
      exists (
        select 1 from public.profiles stu
         where stu.id = _profile_id
           and stu.institution_id = public.get_user_institution(_writer)
      )
      and (
        public.has_role(_writer, 'school_admin')
        or public.has_role(_writer, 'super_school_admin')
        or public.has_role(_writer, 'coordinator')
      )
    );
$$;

grant execute on function public.can_view_student_details(uuid, uuid) to authenticated;
grant execute on function public.can_write_student_details(uuid, uuid) to authenticated;

-- ── RLS ──
alter table public.student_personal_details enable row level security;

create policy "view student personal details"
  on public.student_personal_details for select to authenticated
  using (public.can_view_student_details(profile_id, auth.uid()));

create policy "insert student personal details"
  on public.student_personal_details for insert to authenticated
  with check (public.can_write_student_details(profile_id, auth.uid()));

create policy "update student personal details"
  on public.student_personal_details for update to authenticated
  using (public.can_write_student_details(profile_id, auth.uid()))
  with check (public.can_write_student_details(profile_id, auth.uid()));
```

- [ ] **Step 2: Self-review the SQL**

Read the file back. Confirm: (a) `profile_id` is PK + FK with `ON DELETE CASCADE`; (b) `updated_by` is `ON DELETE SET NULL` (§21); (c) helpers are `security definer` + `set search_path = public`; (d) policies call the helpers, no inline cross-table `EXISTS`; (e) no DELETE policy (cascade covers deletion).

- [ ] **Step 3: Commit**

```bash
git symbolic-ref --short HEAD   # must be feat/olympiad-cash-enroll-roster-writeback
git add supabase/migrations/20260606120000_student_personal_details.sql
git commit -m "feat(db): student_personal_details table + RLS for student DOB/guardian"
```

---

## Task 2: Migration — `oly_list_salci_roster_for_grade` RPC

**Files:**
- Create: `supabase/migrations/20260606120100_oly_list_salci_roster_for_grade.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Roster of existing-SALCI-school students for one grade, for the Olympiad
-- cash-enroll student picker. Walks class_groups -> classes -> class_assignments
-- (role=student) -> profiles for the school's institution, LEFT JOINs the
-- stored personal details (DOB/guardian pre-fill) and the campaign's
-- oly_students (already-enrolled flag). SECURITY DEFINER: authorizes the caller
-- internally because it bypasses RLS.

create or replace function public.oly_list_salci_roster_for_grade(
  p_oly_school_id uuid,
  p_grade_level_id uuid
) returns table (
  profile_id uuid,
  full_name text,
  admission_number text,
  section_label text,
  date_of_birth date,
  guardian_name text,
  guardian_phone text,
  guardian_email text,
  already_enrolled boolean,
  enrolled_roll_number text
) language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_institution_id uuid;
  v_campaign_id uuid;
begin
  if not (
    public.oly_is_teacher_for_class(v_uid, p_oly_school_id, p_grade_level_id)
    or public.oly_is_school_admin_for(v_uid, p_oly_school_id)
    or public.is_super_admin(v_uid)
  ) then
    raise exception 'Not authorized to list students for this class';
  end if;

  select sc.institution_id, sc.campaign_id
    into v_institution_id, v_campaign_id
    from public.oly_schools sc
   where sc.id = p_oly_school_id;

  if v_institution_id is null then
    return;  -- net-new school (no SALCI institution) -> empty roster
  end if;

  return query
  with roster as (
    select distinct on (p.id)
           p.id               as r_profile_id,
           p.full_name        as r_full_name,
           p.admission_number as r_admission_number,
           c.section          as r_section_label
      from public.class_groups cg
      join public.classes c on c.class_group_id = cg.id
      join public.class_assignments ca on ca.class_id = c.id and ca.role = 'student'
      join public.profiles p on p.id = ca.user_id
     where cg.institution_id = v_institution_id
       and cg.grade_level_id = p_grade_level_id
       and p.is_active is not false
     order by p.id, ca.assigned_at desc
  )
  select r.r_profile_id,
         r.r_full_name,
         r.r_admission_number,
         r.r_section_label,
         spd.date_of_birth,
         spd.guardian_name,
         spd.guardian_phone,
         spd.guardian_email,
         (enr.id is not null) as already_enrolled,
         enr.roll_number      as enrolled_roll_number
    from roster r
    left join public.student_personal_details spd on spd.profile_id = r.r_profile_id
    left join lateral (
      select e.id, e.roll_number
        from public.oly_students e
       where e.oly_school_id = p_oly_school_id
         and e.campaign_id = v_campaign_id
         and e.status <> 'removed'
         and (
           e.profile_id = r.r_profile_id
           -- case-insensitive: profiles.admission_number is uniquely indexed on LOWER(...)
           or (r.r_admission_number is not null
               and lower(e.admission_number) = lower(r.r_admission_number))
         )
       limit 1
    ) enr on true
   order by r.r_section_label nulls first, r.r_full_name;
end;
$$;

grant execute on function public.oly_list_salci_roster_for_grade(uuid, uuid) to authenticated;
```

- [ ] **Step 2: Self-review the SQL**

Confirm: (a) authz check raises for non-teacher/admin/super; (b) `distinct on (p.id) ... order by p.id, ca.assigned_at desc` picks one (latest) section per student; (c) CTE columns are aliased `r_*` so they never collide with the `RETURNS TABLE` output names (avoids plpgsql ambiguity); (d) the lateral alias is `enr` (no self-collision); (e) `grant ... to authenticated`.

- [ ] **Step 3: Commit**

```bash
git symbolic-ref --short HEAD
git add supabase/migrations/20260606120100_oly_list_salci_roster_for_grade.sql
git commit -m "feat(db): oly_list_salci_roster_for_grade RPC for cash-enroll student picker"
```

---

## Task 3: Migration — fix latent `oly_lookup_salci_student` crash

**Files:**
- Create: `supabase/migrations/20260606120200_fix_oly_lookup_salci_student_dob.sql`

Context: the current function (migration `20260526050916`) selects `p.date_of_birth` from `profiles`, but that column does not exist — it throws at runtime when a student is found. Fix: read DOB from `student_personal_details` instead. Identical signature + return shape.

- [ ] **Step 1: Write the migration**

```sql
-- Fix: oly_lookup_salci_student selected the non-existent profiles.date_of_birth
-- (PL/pgSQL bodies are not schema-validated at CREATE, so it compiled but crashed
-- at runtime for any matched student). Read DOB from student_personal_details.
create or replace function public.oly_lookup_salci_student(
  p_school_short_code text, p_admission_number text
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_school_inst_id uuid;
  v_profile_id uuid;
  v_full_name text;
  v_dob date;
  v_class_name text;
begin
  select i.id into v_school_inst_id
    from public.institutions i
    join public.oly_schools sc on sc.institution_id = i.id
   where sc.school_short_code = upper(p_school_short_code)
     and sc.is_existing_salci_school = true;

  if v_school_inst_id is null then
    return jsonb_build_object('found', false);
  end if;

  select p.id, p.full_name, spd.date_of_birth
    into v_profile_id, v_full_name, v_dob
    from public.profiles p
    left join public.student_personal_details spd on spd.profile_id = p.id
   where p.institution_id = v_school_inst_id
     and p.admission_number = p_admission_number
     and exists (
       select 1 from public.user_roles ur where ur.user_id = p.id and ur.role = 'student'
     );

  if v_profile_id is null then
    return jsonb_build_object('found', false);
  end if;

  select c.name into v_class_name
    from public.class_assignments ca
    join public.classes c on c.id = ca.class_id
   where ca.user_id = v_profile_id
     and ca.role = 'student'
   order by ca.assigned_at desc
   limit 1;

  return jsonb_build_object(
    'found', true,
    'profile_id', v_profile_id,
    'full_name', v_full_name,
    'date_of_birth', v_dob,
    'class_name', v_class_name
  );
end;
$$;

grant execute on function public.oly_lookup_salci_student(text, text) to anon, authenticated;
```

- [ ] **Step 2: Self-review** — only the `select … into v_profile_id, v_full_name, v_dob` block changed (`p.date_of_birth` → `spd.date_of_birth` via LEFT JOIN). Signature, grants, and return shape are identical.

- [ ] **Step 3: Commit**

```bash
git symbolic-ref --short HEAD
git add supabase/migrations/20260606120200_fix_oly_lookup_salci_student_dob.sql
git commit -m "fix(db): oly_lookup_salci_student reads DOB from student_personal_details"
```

---

## Task 4: Add new table + RPC to generated types

**Files:**
- Modify: `src/integrations/supabase/types.ts`

Keeps local `tsc`/`vite build` green without DB access. Place the blocks alphabetically inside the existing `public` `Tables` and `Functions` objects.

- [ ] **Step 1: Add the `student_personal_details` Tables block**

Inside `Database.public.Tables`, add (near other `s*` tables):

```ts
      student_personal_details: {
        Row: {
          date_of_birth: string | null
          guardian_email: string | null
          guardian_name: string | null
          guardian_phone: string | null
          profile_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          date_of_birth?: string | null
          guardian_email?: string | null
          guardian_name?: string | null
          guardian_phone?: string | null
          profile_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          date_of_birth?: string | null
          guardian_email?: string | null
          guardian_name?: string | null
          guardian_phone?: string | null
          profile_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
```

- [ ] **Step 2: Add the `oly_list_salci_roster_for_grade` Functions entry**

Inside `Database.public.Functions`, add (near other `oly_*` functions):

```ts
      oly_list_salci_roster_for_grade: {
        Args: { p_oly_school_id: string; p_grade_level_id: string }
        Returns: {
          profile_id: string
          full_name: string
          admission_number: string | null
          section_label: string | null
          date_of_birth: string | null
          guardian_name: string | null
          guardian_phone: string | null
          guardian_email: string | null
          already_enrolled: boolean
          enrolled_roll_number: string | null
        }[]
      }
```

- [ ] **Step 3: Verify types compile**

Run: `npx tsc --noEmit`
Expected: exit 0 (no new errors).

- [ ] **Step 4: Commit**

```bash
git symbolic-ref --short HEAD
git add src/integrations/supabase/types.ts
git commit -m "chore(types): add student_personal_details + roster RPC to generated types"
```

---

## Task 5: Edge function — link `profile_id` + write-back details

**Files:**
- Modify: `supabase/functions/oly-cash-enroll/index.ts`

- [ ] **Step 1: Add `profile_id` to the `FormData` type**

In the `type FormData = { … }` block, add after `admission_number?: string | null;`:

```ts
  profile_id?: string | null;
```

- [ ] **Step 2: Replace the existing-school duplicate guard**

Replace the whole `if (school.is_existing_salci_school && form_data.admission_number) { … } else { … }` block with:

```ts
    // Duplicate guard. Existing schools: match by profile_id and/or admission_number
    // using typed equality (never put client text inside a PostgREST .or() filter).
    // A removed row does not count as a duplicate (mirrors the roster RPC's
    // already_enrolled), and a failed check is surfaced rather than silently skipped.
    if (school.is_existing_salci_school) {
      if (form_data.profile_id) {
        const { data: dup, error: dupErr } = await supabase
          .from("oly_students")
          .select("roll_number")
          .eq("oly_school_id", oly_school_id)
          .eq("campaign_id", school.campaign_id)
          .neq("status", "removed")
          .eq("profile_id", form_data.profile_id)
          .limit(1)
          .maybeSingle();
        if (dupErr) return json({ error: "Duplicate check failed" }, 500);
        if (dup) return json({ blocked: true, message: `Already enrolled: ${dup.roll_number}` }, 409);
      }
      if (form_data.admission_number) {
        const { data: dup, error: dupErr } = await supabase
          .from("oly_students")
          .select("roll_number")
          .eq("oly_school_id", oly_school_id)
          .eq("campaign_id", school.campaign_id)
          .neq("status", "removed")
          .eq("admission_number", form_data.admission_number)
          .limit(1)
          .maybeSingle();
        if (dupErr) return json({ error: "Duplicate check failed" }, 500);
        if (dup) return json({ blocked: true, message: `Already enrolled: ${dup.roll_number}` }, 409);
      }
    } else {
      const { data: dup } = await supabase
        .from("oly_students")
        .select("roll_number")
        .eq("oly_school_id", oly_school_id)
        .ilike("full_name", form_data.full_name)
        .eq("date_of_birth", form_data.date_of_birth)
        .eq("class_label", form_data.class_label)
        .gt("enrolled_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .limit(1)
        .maybeSingle();
      if (dup) return json({ blocked: true, message: `Already enrolled: ${dup.roll_number}` }, 409);
    }
```

- [ ] **Step 3: Set `profile_id` on the `oly_students` insert**

In the `.from("oly_students").insert({ … })` object, add after `admission_number: form_data.admission_number ?? null,`:

```ts
        profile_id: form_data.profile_id ?? null,
```

- [ ] **Step 4: Write the details back after a successful insert**

Immediately after the `if (insErr || !student) return …` line (i.e. right after the insert succeeds, before the `oly_enrollment_pending` insert), add:

```ts
    // Write the student's DOB + guardian contact back to their SALCI record so it
    // surfaces in the student portal. Best-effort: never fail the enrollment on this.
    if (form_data.profile_id) {
      const { error: spdErr } = await supabase
        .from("student_personal_details")
        .upsert(
          {
            profile_id: form_data.profile_id,
            date_of_birth: form_data.date_of_birth,
            guardian_name: form_data.parent_name,
            guardian_phone: form_data.parent_phone,
            guardian_email: form_data.parent_email ?? null,
            updated_by: userId,
          },
          { onConflict: "profile_id" },
        );
      if (spdErr) console.error("student_personal_details upsert failed", spdErr.code, spdErr.message);
    }
```

- [ ] **Step 5: Verify** — Deno edge code is not part of `tsc`/`vite build`. Re-read the file and confirm the three insert/guard edits are syntactically consistent (commas, braces). No local compile step; the deploy in Task 13 catches issues.

- [ ] **Step 6: Commit**

```bash
git symbolic-ref --short HEAD
git add supabase/functions/oly-cash-enroll/index.ts
git commit -m "feat(oly): cash-enroll links profile_id + writes back student_personal_details"
```

---

## Task 6: Hook — `useOlympiadGradeSubjects`

**Files:**
- Create: `src/hooks/olympiad/useOlympiadGradeSubjects.ts`

Replaces the roster-derived subject list (which returned `[]` for an empty class) with all active Olympiad subjects for the grade.

- [ ] **Step 1: Write the hook**

```ts
// src/hooks/olympiad/useOlympiadGradeSubjects.ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type OlympiadGradeSubject = { id: string; name: string };

// All active Olympiad subjects offered for a grade_level_id (via oly_subject_classes).
export function useOlympiadGradeSubjects(gradeLevelId: string | undefined) {
  return useQuery({
    queryKey: ["olympiad", "grade-subjects", gradeLevelId],
    queryFn: async (): Promise<OlympiadGradeSubject[]> => {
      if (!gradeLevelId) return [];
      const { data: links, error: e1 } = await supabase
        .from("oly_subject_classes")
        .select("subject_id")
        .eq("grade_level_id", gradeLevelId);
      if (e1) throw e1;
      const ids = (links ?? []).map((l) => l.subject_id);
      if (ids.length === 0) return [];
      const { data: subjects, error: e2 } = await supabase
        .from("oly_subjects")
        .select("id, name")
        .in("id", ids)
        .eq("status", "active")
        .order("name");
      if (e2) throw e2;
      return (subjects ?? []).map((s) => ({ id: s.id, name: s.name }));
    },
    enabled: !!gradeLevelId,
    staleTime: 60_000,
  });
}
```

- [ ] **Step 2: Verify** — `npx tsc --noEmit` (exit 0); `npx eslint src/hooks/olympiad/useOlympiadGradeSubjects.ts` (zero errors).

- [ ] **Step 3: Commit**

```bash
git symbolic-ref --short HEAD
git add src/hooks/olympiad/useOlympiadGradeSubjects.ts
git commit -m "feat(oly): useOlympiadGradeSubjects — all active subjects for a grade"
```

---

## Task 7: Hook — `useOlympiadSalciRoster`

**Files:**
- Create: `src/hooks/olympiad/useOlympiadSalciRoster.ts`

- [ ] **Step 1: Write the hook**

```ts
// src/hooks/olympiad/useOlympiadSalciRoster.ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type SalciRosterStudent = {
  profile_id: string;
  full_name: string;
  admission_number: string | null;
  section_label: string | null;
  date_of_birth: string | null;
  guardian_name: string | null;
  guardian_phone: string | null;
  guardian_email: string | null;
  already_enrolled: boolean;
  enrolled_roll_number: string | null;
};

// Existing-SALCI-school students for a grade, for the cash-enroll student picker.
export function useOlympiadSalciRoster(
  olySchoolId: string | undefined,
  gradeLevelId: string | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: ["olympiad", "salci-roster", olySchoolId, gradeLevelId],
    queryFn: async (): Promise<SalciRosterStudent[]> => {
      if (!olySchoolId || !gradeLevelId) return [];
      const { data, error } = await supabase.rpc("oly_list_salci_roster_for_grade", {
        p_oly_school_id: olySchoolId,
        p_grade_level_id: gradeLevelId,
      });
      if (error) throw error;
      return (data ?? []) as SalciRosterStudent[];
    },
    enabled: enabled && !!olySchoolId && !!gradeLevelId,
    staleTime: 60_000,
  });
}
```

- [ ] **Step 2: Verify** — `npx tsc --noEmit` (exit 0; depends on Task 4 types); `npx eslint src/hooks/olympiad/useOlympiadSalciRoster.ts` (zero errors).

- [ ] **Step 3: Commit**

```bash
git symbolic-ref --short HEAD
git add src/hooks/olympiad/useOlympiadSalciRoster.ts
git commit -m "feat(oly): useOlympiadSalciRoster hook over roster RPC"
```

---

## Task 8: Extend `useOlympiadAssignedClasses` with `grade_number`

**Files:**
- Modify: `src/hooks/olympiad/useOlympiadAssignedClasses.ts`

`class_label` for enrollment must be `"Class {grade_number}"` (the roll-number RPC parses the number).

- [ ] **Step 1: Add `grade_number` to the type + join + return**

In `export type AssignedClass`, add after `grade_name: string;`:

```ts
  grade_number: number | null;
```

In `type GradeJoin`, change it to:

```ts
type GradeJoin = {
  grade_name: string;
  grade_number: number | null;
  display_order: number | null;
} | null;
```

In the `.select(...)` template, change `grade_levels ( grade_name, display_order )` to:

```
          grade_levels ( grade_name, grade_number, display_order )
```

In the `rows` map return object, add after `grade_name: grade?.grade_name ?? "",`:

```ts
          grade_number: grade?.grade_number ?? null,
```

- [ ] **Step 2: Verify** — `npx tsc --noEmit` (exit 0); `npx eslint src/hooks/olympiad/useOlympiadAssignedClasses.ts` (zero errors).

- [ ] **Step 3: Commit**

```bash
git symbolic-ref --short HEAD
git add src/hooks/olympiad/useOlympiadAssignedClasses.ts
git commit -m "feat(oly): expose grade_number from useOlympiadAssignedClasses"
```

---

## Task 9: Extend `useOlympiadCashEnroll` input + invalidation

**Files:**
- Modify: `src/hooks/olympiad/useOlympiadCashEnroll.ts`

- [ ] **Step 1: Add `profile_id` to the input type**

In `export type CashEnrollInput`'s `form_data`, add after `admission_number?: string | null;`:

```ts
    profile_id?: string | null;
```

- [ ] **Step 2: Invalidate the SALCI roster on success**

In `onSuccess`, after the existing `queryClient.invalidateQueries({ queryKey: ["olympiad", "my-classes"] });` line, add:

```ts
      queryClient.invalidateQueries({ queryKey: ["olympiad", "salci-roster"] });
```

- [ ] **Step 3: Verify** — `npx tsc --noEmit` (exit 0); `npx eslint src/hooks/olympiad/useOlympiadCashEnroll.ts` (zero errors).

- [ ] **Step 4: Commit**

```bash
git symbolic-ref --short HEAD
git add src/hooks/olympiad/useOlympiadCashEnroll.ts
git commit -m "feat(oly): cash-enroll input carries profile_id; invalidate salci-roster"
```

---

## Task 10: Split `CashEnrollSheet` into roster + manual sheets

**Files:**
- Modify: `src/components/olympiad/teacher/CashEnrollSheet.tsx`

The exported `CashEnrollSheet` becomes a thin switch. The **current** component body is preserved verbatim as `ManualCashEnrollSheet` (net-new schools). A new `RosterCashEnrollSheet` implements the dropdown flow (existing schools).

- [ ] **Step 1: Add `isExistingSalciSchool` to `Props` and add the switch + imports**

Replace everything from the **top of the file through the end of the `type Props = { … }` block** (i.e. the old comment line, old imports, old `type Subject`, old `type Props`) with the block below. Leave the existing `type FormState`, `const INITIAL`, and the existing component (renamed in Step 2) in place — the new `export function CashEnrollSheet` switch is a hoisted function declaration, so placing it before `FormState`/`INITIAL` is fine.

```tsx
// src/components/olympiad/teacher/CashEnrollSheet.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { SearchableSelect, type SearchableSelectOption } from "@/components/ui/searchable-select";
import { MobileSheet } from "@/components/shared/sheets/MobileSheet";
import { SubjectPicker } from "@/components/olympiad/public/SubjectPicker";
import { useOlympiadCashEnroll } from "@/hooks/olympiad/useOlympiadCashEnroll";
import { useOlympiadAssignedClasses } from "@/hooks/olympiad/useOlympiadAssignedClasses";
import { useOlympiadGradeSubjects } from "@/hooks/olympiad/useOlympiadGradeSubjects";
import {
  useOlympiadSalciRoster, type SalciRosterStudent,
} from "@/hooks/olympiad/useOlympiadSalciRoster";

type Subject = { id: string; name: string };

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  olySchoolId: string;
  gradeLevelId: string;
  classLabel: string;
  availableSubjects: Subject[];
  isExistingSalciSchool: boolean;
};

export function CashEnrollSheet(props: Props) {
  return props.isExistingSalciSchool ? (
    <RosterCashEnrollSheet {...props} />
  ) : (
    <ManualCashEnrollSheet {...props} />
  );
}
```

- [ ] **Step 2: Rename the existing component to `ManualCashEnrollSheet`**

The current `export function CashEnrollSheet({ open, onOpenChange, olySchoolId, gradeLevelId, classLabel, availableSubjects }: Props) { … }` body (the entire form that exists today) becomes a **non-exported** function named `ManualCashEnrollSheet`. Change only its signature line to:

```tsx
function ManualCashEnrollSheet({
  open,
  onOpenChange,
  olySchoolId,
  gradeLevelId,
  classLabel,
  availableSubjects,
}: Props) {
```

Leave its `FormState`, `INITIAL`, body, JSX, and the `enroll.mutateAsync({ … })` call exactly as they are today (it does not send `profile_id`, which is correct for net-new schools). The `isExistingSalciSchool` prop is unused here — destructure only what it needs (as shown).

- [ ] **Step 3: Add the `RosterCashEnrollSheet` component**

Append this new component to the same file:

```tsx
type RosterForm = {
  gradeLevelId: string;
  sectionFilter: string; // "" = all sections
  profileId: string;
  dob: string;
  subjectIds: string[];
  guardianName: string;
  guardianPhone: string;
  guardianEmail: string;
  feeCollected: boolean;
};

const ROSTER_INITIAL: RosterForm = {
  gradeLevelId: "",
  sectionFilter: "",
  profileId: "",
  dob: "",
  subjectIds: [],
  guardianName: "",
  guardianPhone: "",
  guardianEmail: "",
  feeCollected: false,
};

function RosterCashEnrollSheet({
  open,
  onOpenChange,
  olySchoolId,
  gradeLevelId,
  classLabel: pageClassLabel,
}: Props) {
  const enroll = useOlympiadCashEnroll();
  const [form, setForm] = useState<RosterForm>({ ...ROSTER_INITIAL, gradeLevelId });

  const set = <K extends keyof RosterForm>(key: K, value: RosterForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  // The teacher's Olympiad grades for THIS school (class dropdown source).
  const { data: assigned = [] } = useOlympiadAssignedClasses();
  const myGrades = useMemo(
    () => assigned.filter((a) => a.oly_school_id === olySchoolId),
    [assigned, olySchoolId],
  );

  const { data: subjects = [] } = useOlympiadGradeSubjects(form.gradeLevelId || undefined);
  const { data: roster = [], isLoading: rosterLoading } = useOlympiadSalciRoster(
    olySchoolId,
    form.gradeLevelId || undefined,
    open,
  );

  // Default grade for a fresh open: the page's grade, else the sole assigned grade.
  // Held in a ref so the open-effect depends only on `open` and never re-runs (and
  // clobbers an in-progress selection) when `myGrades` resolves asynchronously.
  const defaultGradeRef = useRef("");
  defaultGradeRef.current =
    gradeLevelId || (myGrades.length === 1 ? myGrades[0].grade_level_id : "");

  useEffect(() => {
    if (open) setForm({ ...ROSTER_INITIAL, gradeLevelId: defaultGradeRef.current });
  }, [open]);

  // Distinct sections present in the roster.
  const sections = useMemo(() => {
    const seen = new Set<string>();
    for (const r of roster) if (r.section_label) seen.add(r.section_label);
    return Array.from(seen).sort();
  }, [roster]);

  // Auto-select the only section as the filter (still a filter, not the written value).
  // Functional update keeps `form` out of the dep array — deps are just [sections].
  useEffect(() => {
    if (sections.length === 1) {
      setForm((prev) => (prev.sectionFilter === "" ? { ...prev, sectionFilter: sections[0] } : prev));
    }
  }, [sections]);

  const selectedGrade = myGrades.find((g) => g.grade_level_id === form.gradeLevelId);
  const classLabel = selectedGrade
    ? selectedGrade.grade_number != null
      ? `Class ${selectedGrade.grade_number}`
      : selectedGrade.grade_name
    : form.gradeLevelId === gradeLevelId
      ? pageClassLabel
      : "";

  const visibleStudents = useMemo(
    () =>
      roster.filter(
        (r) => form.sectionFilter === "" || r.section_label === form.sectionFilter,
      ),
    [roster, form.sectionFilter],
  );

  const studentOptions: SearchableSelectOption[] = visibleStudents.map((s) => ({
    value: s.profile_id,
    label: s.admission_number ? `${s.full_name} · ${s.admission_number}` : s.full_name,
    description: s.already_enrolled
      ? `Already enrolled${s.enrolled_roll_number ? ` · ${s.enrolled_roll_number}` : ""}`
      : form.sectionFilter === "" && s.section_label
        ? `Section ${s.section_label}`
        : undefined,
    disabled: s.already_enrolled,
  }));

  const selectedStudent: SalciRosterStudent | undefined = roster.find(
    (r) => r.profile_id === form.profileId,
  );

  const onPickStudent = (profileId: string) => {
    const s = roster.find((r) => r.profile_id === profileId);
    setForm((prev) => ({
      ...prev,
      profileId,
      dob: s?.date_of_birth ?? "",
      guardianName: s?.guardian_name ?? "",
      guardianPhone: s?.guardian_phone ?? "",
      guardianEmail: s?.guardian_email ?? "",
    }));
  };

  const phoneOk = /^[6-9]\d{9}$/.test(form.guardianPhone);
  const canSubmit =
    !!form.profileId &&
    !!form.dob &&
    form.subjectIds.length === 3 &&
    !!form.guardianName.trim() &&
    phoneOk &&
    form.feeCollected;

  const isDirty = !!form.profileId || form.subjectIds.length > 0 || !!form.guardianName;

  const reset = () => setForm({ ...ROSTER_INITIAL, gradeLevelId });

  const onSubmit = async () => {
    if (!canSubmit || !selectedStudent) return;
    try {
      const result = await enroll.mutateAsync({
        oly_school_id: olySchoolId,
        form_data: {
          full_name: selectedStudent.full_name,
          date_of_birth: form.dob,
          class_label: classLabel,
          section_label: selectedStudent.section_label,
          grade_level_id: form.gradeLevelId,
          admission_number: selectedStudent.admission_number,
          subject_ids: form.subjectIds,
          parent_name: form.guardianName.trim(),
          parent_phone: form.guardianPhone,
          parent_email: form.guardianEmail.trim() || null,
          fee_collected: form.feeCollected,
          profile_id: form.profileId,
        },
      });
      if ("blocked" in result && result.blocked) {
        toast.error(result.message);
        return;
      }
      reset();
      onOpenChange(false);
    } catch {
      // toastError fires in the mutation's onError
    }
  };

  return (
    <MobileSheet
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
      title="Enroll cash student"
      subtitle={classLabel || undefined}
      primaryAction={{
        label: "Enroll",
        onClick: onSubmit,
        loading: enroll.isPending,
        disabled: !canSubmit,
      }}
      secondaryAction={{ label: "Cancel", onClick: () => onOpenChange(false) }}
    >
      <form
        data-dirty={isDirty ? "true" : "false"}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        className="space-y-4"
      >
        {/* Class (grade) */}
        <div className="grid gap-1.5">
          <Label className="text-xs font-medium text-ink-600">Class *</Label>
          <Select
            value={form.gradeLevelId}
            onValueChange={(v) =>
              setForm({ ...ROSTER_INITIAL, gradeLevelId: v })
            }
            disabled={myGrades.length <= 1}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select class" />
            </SelectTrigger>
            <SelectContent>
              {myGrades.map((g) => (
                <SelectItem key={g.grade_level_id} value={g.grade_level_id}>
                  {g.grade_number != null ? `Class ${g.grade_number}` : g.grade_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Section filter */}
        {sections.length > 0 && (
          <div className="grid gap-1.5">
            <Label className="text-xs font-medium text-ink-600">Section</Label>
            <Select
              value={form.sectionFilter || "__all__"}
              onValueChange={(v) => {
                set("sectionFilter", v === "__all__" ? "" : v);
                set("profileId", "");
              }}
              disabled={sections.length <= 1}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All sections</SelectItem>
                {sections.map((s) => (
                  <SelectItem key={s} value={s}>
                    Section {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Student */}
        <div className="grid gap-1.5">
          <Label className="text-xs font-medium text-ink-600">Student *</Label>
          <SearchableSelect
            value={form.profileId}
            onValueChange={onPickStudent}
            options={studentOptions}
            placeholder={rosterLoading ? "Loading students…" : "Select a student"}
            searchPlaceholder="Search by name or admission no."
            emptyText={rosterLoading ? "Loading…" : "No students found for this class."}
            disabled={rosterLoading || !form.gradeLevelId}
          />
        </div>

        {/* DOB — pre-filled if stored, else entered */}
        {form.profileId && (
          <div className="grid gap-1.5">
            <Label className="text-xs font-medium text-ink-600">Date of birth *</Label>
            <Input
              type="date"
              value={form.dob}
              onChange={(e) => set("dob", e.target.value)}
              required
            />
          </div>
        )}

        {/* Subjects */}
        {form.profileId && subjects.length > 0 && (
          <SubjectPicker
            subjects={subjects}
            value={form.subjectIds}
            onChange={(ids) => set("subjectIds", ids)}
            max={3}
          />
        )}

        {/* Guardian contact */}
        {form.profileId && (
          <fieldset className="grid gap-2">
            <legend className="text-xs font-medium text-ink-600">Guardian contact *</legend>
            <Input
              placeholder="Guardian full name"
              value={form.guardianName}
              onChange={(e) => set("guardianName", e.target.value)}
              required
            />
            <Input
              placeholder="Mobile number (10 digits)"
              value={form.guardianPhone}
              onChange={(e) => set("guardianPhone", e.target.value.replace(/\D/g, "").slice(0, 10))}
              required
            />
            <Input
              type="email"
              placeholder="Email (optional)"
              value={form.guardianEmail}
              onChange={(e) => set("guardianEmail", e.target.value)}
            />
            {form.guardianPhone && !phoneOk && (
              <p className="text-[11px] text-red-500">
                Enter a 10-digit Indian mobile (starts with 6–9)
              </p>
            )}
          </fieldset>
        )}

        {/* Fee collected */}
        {form.profileId && (
          <label className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-500/20 px-4 py-3 cursor-pointer">
            <Checkbox
              id="fee-collected"
              checked={form.feeCollected}
              onCheckedChange={(v) => set("feeCollected", !!v)}
              className="mt-0.5"
            />
            <span className="text-sm text-ink-800 dark:text-ink-300">
              <strong className="font-semibold text-amber-800 dark:text-amber-300">
                Fee collected from parent
              </strong>
              <br />
              <span className="text-xs text-ink-600">
                Check this box only after physically collecting the exam fee in cash.
              </span>
            </span>
          </label>
        )}
      </form>
    </MobileSheet>
  );
}
```

- [ ] **Step 4: Verify** — `npx tsc --noEmit` (exit 0); `npx eslint src/components/olympiad/teacher/CashEnrollSheet.tsx` (zero errors). The effects are written to satisfy `react-hooks/exhaustive-deps` without any `eslint-disable` (ref for the open-effect, functional `setForm` for the section-effect), per §5a.

- [ ] **Step 5: Commit**

```bash
git symbolic-ref --short HEAD
git add src/components/olympiad/teacher/CashEnrollSheet.tsx
git commit -m "feat(oly): roster-driven cash-enroll sheet for existing schools"
```

---

## Task 11: Pass `isExistingSalciSchool` from the teacher class page

**Files:**
- Modify: `src/pages/teacher/olympiad/OlympiadTeacherClassPage.tsx`

- [ ] **Step 1: Fetch the flag in `useOlympiadClassMeta`**

In the `useOlympiadClassMeta` `Promise.all` `oly_schools` select, change `.select("school_short_code, status, institutions(name)")` to:

```ts
          .select("school_short_code, status, is_existing_salci_school, institutions(name)")
```

In the returned object of that query function, add after `schoolStatus: school?.status ?? "enrollment_open",`:

```ts
        isExistingSalciSchool: school?.is_existing_salci_school === true,
```

- [ ] **Step 2: Pass the prop to `CashEnrollSheet`**

In the `<CashEnrollSheet … />` JSX, add after `availableSubjects={availableSubjects}`:

```tsx
        isExistingSalciSchool={meta?.isExistingSalciSchool ?? false}
```

- [ ] **Step 3: Verify** — `npx tsc --noEmit` (exit 0); `npx eslint src/pages/teacher/olympiad/OlympiadTeacherClassPage.tsx` (zero errors).

- [ ] **Step 4: Commit**

```bash
git symbolic-ref --short HEAD
git add src/pages/teacher/olympiad/OlympiadTeacherClassPage.tsx
git commit -m "feat(oly): teacher class page passes isExistingSalciSchool to cash-enroll"
```

---

## Task 12: Hook + Profile-page display for student personal details

**Files:**
- Create: `src/hooks/useStudentPersonalDetails.ts`
- Modify: `src/hooks/useProfileData.ts`
- Modify: `src/pages/ProfilePage.tsx`

- [ ] **Step 1: Write `useStudentPersonalDetails`**

```ts
// src/hooks/useStudentPersonalDetails.ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type StudentPersonalDetails = {
  date_of_birth: string | null;
  guardian_name: string | null;
  guardian_phone: string | null;
  guardian_email: string | null;
};

// The signed-in student's stored DOB + guardian contact (read-only, school-managed).
export function useStudentPersonalDetails() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["student-personal-details", user?.id],
    queryFn: async (): Promise<StudentPersonalDetails | null> => {
      if (!user?.id) return null;
      const { data, error } = await supabase
        .from("student_personal_details")
        .select("date_of_birth, guardian_name, guardian_phone, guardian_email")
        .eq("profile_id", user.id)
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
    enabled: !!user?.id,
    staleTime: 60_000,
  });
}
```

- [ ] **Step 2: Surface `admission_number` + `roll_number` from `useProfileData`**

In `src/hooks/useProfileData.ts`, in the `ProfileData` interface add after `is_active: boolean;`:

```ts
  admission_number: string | null;
  roll_number: string | null;
```

In the returned object (the `return { … }` inside `queryFn`), add after `is_active: profile.is_active,`:

```ts
        admission_number: profile.admission_number ?? null,
        roll_number: profile.roll_number ?? null,
```

- [ ] **Step 3: Verify hooks** — `npx tsc --noEmit` (exit 0; depends on Task 4 types); `npx eslint src/hooks/useStudentPersonalDetails.ts src/hooks/useProfileData.ts` (zero errors).

- [ ] **Step 4: Add the Profile-page card**

In `src/pages/ProfilePage.tsx`:

(a) Add to the lucide import on line 10 — append `, IdCard` to the existing icon list (used for the new card).

(b) Add the hook import after the `useProfileData` import (line 11):

```tsx
import { useStudentPersonalDetails } from "@/hooks/useStudentPersonalDetails";
```

(c) Inside `ProfilePage`, after `const updateProfile = useUpdateProfile();` add:

```tsx
  const { data: personalDetails } = useStudentPersonalDetails();
```

(d) Add the card JSX immediately after the closing `)}` of the `{isStudent && profile?.studentClass && ( … )}` Student Class Card block and before the `{/* Account Info Card */}` comment:

```tsx
      {/* Personal & Guardian Details (students) */}
      {isStudent && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <IdCard className="h-5 w-5" />
              Personal & Guardian Details
            </CardTitle>
            <CardDescription>Managed by your school</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <DetailRow
              label="Date of birth"
              value={
                personalDetails?.date_of_birth
                  ? format(new Date(`${personalDetails.date_of_birth}T00:00:00`), "MMMM d, yyyy")
                  : "—"
              }
            />
            <Separator />
            <DetailRow label="Admission no." value={profile?.admission_number || "—"} />
            <Separator />
            <DetailRow label="Roll no." value={profile?.roll_number || "—"} />
            <Separator />
            <DetailRow label="Guardian name" value={personalDetails?.guardian_name || "—"} />
            <Separator />
            <DetailRow label="Guardian phone" value={personalDetails?.guardian_phone || "—"} />
            <Separator />
            <DetailRow label="Guardian email" value={personalDetails?.guardian_email || "—"} />
          </CardContent>
        </Card>
      )}
```

(e) Add a small `DetailRow` helper at the bottom of the file, after the `ProfileSkeleton` function:

```tsx
function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right">{value}</span>
    </div>
  );
}
```

- [ ] **Step 5: Verify** — `npx tsc --noEmit` (exit 0); `npx eslint src/pages/ProfilePage.tsx` (zero errors).

- [ ] **Step 6: Commit**

```bash
git symbolic-ref --short HEAD
git add src/hooks/useStudentPersonalDetails.ts src/hooks/useProfileData.ts src/pages/ProfilePage.tsx
git commit -m "feat(profile): student personal & guardian details card"
```

---

## Task 13: Full production-readiness gate + edge-fn deploy note

**Files:** none (verification only)

- [ ] **Step 1: TypeScript**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 2: ESLint (all touched frontend paths)**

Run:
```bash
npx eslint src/components/olympiad/teacher/CashEnrollSheet.tsx \
  src/pages/teacher/olympiad/OlympiadTeacherClassPage.tsx \
  src/pages/ProfilePage.tsx \
  src/hooks/olympiad/useOlympiadGradeSubjects.ts \
  src/hooks/olympiad/useOlympiadSalciRoster.ts \
  src/hooks/olympiad/useOlympiadAssignedClasses.ts \
  src/hooks/olympiad/useOlympiadCashEnroll.ts \
  src/hooks/useStudentPersonalDetails.ts \
  src/hooks/useProfileData.ts
```
Expected: zero errors (no `any`, no disables beyond the two noted hook-deps lines).

- [ ] **Step 3: Production build**

Run: `npx vite build`
Expected: exit 0 (bundle-size warnings are not failures).

- [ ] **Step 4: Note the out-of-band steps (do NOT run against prod here)**

The following are performed via the user's deploy pipeline, not in this plan:
- Apply the three migrations to the Supabase project.
- Regenerate `src/integrations/supabase/types.ts` (will match the Task 4 hand-added types).
- Deploy the edge function: `npx supabase@latest functions deploy oly-cash-enroll --project-ref gyymkgohcijeksmrzuyw`.

- [ ] **Step 5: Final commit (if any verification fixups were made)**

```bash
git symbolic-ref --short HEAD
git add -A
git commit -m "chore(oly): production-readiness fixups for cash-enroll roster feature"
```

---

## Manual smoke test (after deploy, by the user)

1. As an **existing-school Olympiad teacher** with one assigned grade: open a class → "Enroll cash student". Class auto-selected; Section auto-selected if single; Student dropdown lists existing students as `Name · ADMISSION`. Already-enrolled students are greyed out.
2. Pick a student → name/DOB/guardian pre-fill if previously stored, else enter DOB + guardian. Pick 3 subjects, check fee, Enroll. Success toast with roll number.
3. Re-open and confirm the just-enrolled student now shows "Already enrolled" (disabled).
4. Log in as **that student** with their normal SALCI credentials → `/student/olympiad` shows the enrollment; `/profile` shows the "Personal & Guardian Details" card with DOB + guardian + admission/roll.
5. As a **net-new-school** Olympiad teacher: the cash-enroll form is unchanged (manual fields).
6. Existing-school **parent online** enroll (`EnrollmentFormSalci`) "Find" by admission no longer errors and returns a DOB when stored.
